import { isBackbone } from './anchoredNodes'
import { departureAt, gapParts } from './gfa/departures'
import { linkKey } from './gfa/linkKey'
import { panSNContig } from './pansn'
import { pathOrigin, referenceVisitStarts } from './pathAnchoring'
import { NOT_LOADED_COLOR, rampFraction } from './renderer/GeometryBuilder'
import { ownStrand } from './util/geometry'
import { encodedColor, resolveEncoding, splitFamilies } from './walkEncoding'

import type { GraphGap } from './gfa/departures'
import type { ReferenceRamp } from './renderer/GeometryBuilder'
import type { Graph, GraphNode, GraphPath } from './types'
import type { WalkEncoding, WalkLayer } from './walkEncoding'

// One walk lifted out of the drawing: the nodes it visits and the links it
// takes, how far along the walk each node is, and what it carries through the
// window against the reference walk.
export interface WalkHighlight {
  name: string
  // whether this is the graph's reference walk, which keeps the node colours
  reference: boolean
  nodeIds: Set<string>
  edgeIndexes: Set<number>
  // each node's first visit, as the fraction of the walk's bp before its
  // midpoint: 0 at the walk's start, 1 at its end
  progress: Map<string, number>
  // the same fraction at every visit, in the order the walk makes them
  passProgress: Map<string, number[]>
  passes: Map<string, number>
  mostPasses: number
  route: readonly (readonly string[])[]
  steps: number
  bp: number
  unloadedBp: number
  // where the walk's stretch of the cut sits on its own contig, from its W or
  // P record: its start where it begins and its end where it ends
  range?: { contig: string; start: number; end: number }
  // bp of the gaps between its pieces that a walk-file cut's departures say
  // the graph lacks, or are its own sequence the cut did not read
  // (gfa/departures.ts gapParts)
  missingBp: number
  ownBp: number
  // what ownBp is measured off, and Graph.revisited, which says whether it is
  // the walk's own sequence or only off that path (gfa/departures.ts ownIsExact)
  referencePath: string | undefined
  revisited: number | undefined
  // where a walk-file cut states its stretches: bp it read and kept out, and
  // bp of the contig it did not read
  readBp?: number
  unreadBp?: number
}

export interface LiftedWalk extends WalkHighlight {
  encoding: WalkEncoding
  // the lane colour at each node the walk visits
  colors: Map<string, number>
  // the colour at each visit, in the order the walk makes them
  passColors: Map<string, number[]>
}

// The walks lifted together, reference first and the rest in the order they
// were picked, each in its lane of the nodes it visits. A node or link on any
// of them keeps its ink. With no walks it is a focus, such as an open bubble:
// its nodes and links keep their own colours and the rest fades.
export interface WalkLift {
  walks: LiftedWalk[]
  // the reference interval a lane coloured by reference position spans
  referenceDomain?: { start: number; end: number }
  nodeIds: Set<string>
  edgeIndexes: Set<number>
  names: Set<string>
}

// What a lift's faded key says of the nodes it fades, or nothing where it
// fades none: that they are other haplotypes' sequence when every one lies on
// a walk the lift leaves out. Links don't decide it, since a cut keeps the
// source graph's links between the nodes it keeps even where it drops the
// walks that take them.
export function fadedKey(graph: Graph, lift: WalkLift, walks: string) {
  const lifted = new Set([...lift.names].map(n => pathOrigin(n).name))
  const other = (name: string) => !lifted.has(pathOrigin(name).name)
  const onOthers = new Set<string>()
  for (const path of graph.paths ?? []) {
    if (other(path.name)) {
      for (const id of path.nodeIds) {
        onOthers.add(id)
      }
    }
  }
  for (const gap of graph.gaps ?? []) {
    if (other(gap.name)) {
      for (const segment of gap.segments) {
        for (const id of segment.nodes) {
          onOthers.add(id)
        }
      }
    }
  }
  const nodes = graph.nodes.filter(n => !lift.nodeIds.has(n.id))
  return nodes.length > 0
    ? nodes.every(n => onOthers.has(n.id))
      ? 'only in other haplotypes'
      : `nodes and links not on ${walks}`
    : undefined
}

const isReference = (graph: Graph, name: string) =>
  !!graph.referencePath && pathOrigin(name).name === graph.referencePath

// The records of one walk in the order they lie on its contig: a cut hands a
// haplotype back as one W line per piece of its walk inside the cut's nodes,
// and vg names each piece with its own range
function piecesOf(graph: Graph, name: string) {
  const origin = pathOrigin(name).name
  return (graph.paths ?? [])
    .filter(p => pathOrigin(p.name).name === origin)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
}

const nodesById = (graph: Graph) => new Map(graph.nodes.map(n => [n.id, n]))

type Strand = '+' | '-'

const strandOf = (reversed: boolean): Strand => (reversed ? '-' : '+')

// Each link by the steps that take it, read either way along it, so two links
// joining the same two nodes in different orientations stay two links
function graphIndex(graph: Graph) {
  const linkAt = new Map<string, number>()
  graph.edges.forEach((e, i) => {
    linkAt.set(
      linkKey(
        e.from,
        e.fromStrand ?? ownStrand(e.from),
        e.to,
        e.toStrand ?? ownStrand(e.to),
      ),
      i,
    )
  })
  return { byId: nodesById(graph), linkAt }
}

// The strand each step of a walk's records reads its node on: the walk's
// visits replayed in path order, as tubeMapLayout's pathSteps reads them, and
// the node's own strand where no visit is recorded
function recordStrands(
  graph: Graph,
  byId: Map<string, GraphNode>,
  origin: string,
) {
  const visits = graph.pathVisits
  const next = visits?.replay()
  const walk = visits?.pathIndex(origin) ?? -1
  const strands = new Map<GraphPath, Strand[]>()
  for (const path of graph.paths ?? []) {
    if (pathOrigin(path.name).name === origin) {
      strands.set(
        path,
        path.nodeIds.map(id => {
          const node = byId.get(id)
          const at =
            visits && next && node ? next(visits.slot(node.name), walk) : -1
          return at >= 0 && visits ? visits.strand(at) : ownStrand(id)
        }),
      )
    }
  }
  return strands
}

export function walkHighlight(graph: Graph, name: string) {
  return highlightOf(graph, name, graphIndex(graph))
}

function highlightOf(
  graph: Graph,
  name: string,
  { byId, linkAt }: ReturnType<typeof graphIndex>,
): WalkHighlight | undefined {
  const pieces = piecesOf(graph, name)
  const first = pieces[0]
  const lengthOf = (id: string) => byId.get(id)?.length ?? 0
  const bpOf = (path: GraphPath) =>
    path.nodeIds.reduce((sum, id) => sum + lengthOf(id), 0)
  const origin = pathOrigin(name).name
  const stated = (graph.gaps ?? []).filter(
    g => pathOrigin(g.name).name === origin,
  )
  const stretches = new Map(stated.map(g => [`${g.start}\t${g.end}`, g]))
  const endOf = (piece: GraphPath) => (piece.start ?? 0) + bpOf(piece)
  const drawnBp = (gap: GraphGap) =>
    gap.segments.reduce(
      (sum, x) =>
        sum +
        (x.kind === 'steps'
          ? x.nodes.reduce((total, id) => total + lengthOf(id), 0)
          : x.bp),
      0,
    )
  const between = (p: number) => {
    const a = pieces[p - 1]
    const b = pieces[p]
    const gap =
      a?.start !== undefined && b?.start !== undefined
        ? stretches.get(`${endOf(a)}\t${b.start}`)
        : undefined
    return gap && drawnBp(gap) === gap.end - gap.start ? gap : undefined
  }
  const rowEnds = stated.filter(
    g => g.edge !== 0 && drawnBp(g) === g.end - g.start,
  )
  const strandsOf = recordStrands(graph, byId, origin)
  const stranded = (steps: GraphPath, reversed: boolean[]) => {
    strandsOf.set(steps, reversed.map(strandOf))
    return steps
  }
  const attached = [...pieces.map((_, p) => between(p)), ...rowEnds].flatMap(
    gap => {
      let at = gap?.start ?? 0
      return (gap?.segments ?? []).flatMap(x => {
        const start = at
        at += x.bp
        return x.kind === 'steps' && x.nodes.length > 0
          ? [stranded({ name, nodeIds: x.nodes, start }, x.reversed)]
          : []
      })
    },
  )
  const walked = [...pieces, ...attached].sort(
    (a, b) => (a.start ?? 0) - (b.start ?? 0) || endOf(a) - endOf(b),
  )
  const bp = walked.reduce((sum, piece) => sum + bpOf(piece), 0)
  const unloaded = (id: string) => byId.get(id)?.placeholder === true
  // from the first piece's start to the furthest piece's end, gaps included
  const extentOf = (ps: GraphPath[]) => {
    const start = Math.min(...ps.map(p => p.start ?? Infinity))
    return Number.isFinite(start)
      ? { start, end: Math.max(...ps.map(p => (p.start ?? 0) + bpOf(p))) }
      : undefined
  }
  if (walked.length === 0) {
    return undefined
  }
  const extent = extentOf(walked)
  const range = extent && {
    contig: first?.contig ?? panSNContig(pathOrigin(name).name),
    ...extent,
  }
  // progress runs over the contig where the records place the pieces, so the
  // stretch between two pieces counts though no node draws it
  const span = range ? range.end - range.start : bp
  const nodeIds = new Set<string>()
  const edgeIndexes = new Set<number>()
  const progress = new Map<string, number>()
  const passProgress = new Map<string, number[]>()
  const passes = new Map<string, number>()
  let mostPasses = 1
  let before = 0
  const steppedOn = new Set<GraphPath>(attached)
  let previous: GraphPath | undefined
  for (const piece of walked) {
    if (range) {
      before = Math.max(before, (piece.start ?? 0) - range.start)
    }
    const joins =
      previous !== undefined &&
      (steppedOn.has(previous) || steppedOn.has(piece)) &&
      previous.start !== undefined &&
      endOf(previous) === piece.start
    const last = previous?.nodeIds.at(-1)
    const lastStrand = previous && strandsOf.get(previous)?.at(-1)
    const strands = strandsOf.get(piece)
    piece.nodeIds.forEach((id, i) => {
      nodeIds.add(id)
      const passed = (passes.get(id) ?? 0) + 1
      passes.set(id, passed)
      mostPasses = Math.max(mostPasses, passed)
      const a = i > 0 ? piece.nodeIds[i - 1] : joins ? last : undefined
      if (a !== undefined) {
        const index = linkAt.get(
          linkKey(
            a,
            (i > 0 ? strands?.[i - 1] : lastStrand) ?? ownStrand(a),
            id,
            strands?.[i] ?? ownStrand(id),
          ),
        )
        if (index !== undefined) {
          edgeIndexes.add(index)
        }
      }
      const length = lengthOf(id)
      const at = span > 0 ? (before + length / 2) / span : 0
      if (!progress.has(id)) {
        progress.set(id, at)
      }
      const seen = passProgress.get(id)
      if (seen) {
        seen.push(at)
      } else {
        passProgress.set(id, [at])
      }
      before += length
    })
    previous = piece
  }
  const departures = departuresOf(graph, name)
  let missingBp = 0
  let ownBp = 0
  let readBp = 0
  let unreadBp = 0
  const countOwn = (gap: GraphGap) => {
    let at = gap.start
    for (const x of gap.segments) {
      const inRange = !extent || (at >= extent.start && at + x.bp <= extent.end)
      const keptBp = inRange ? x.bp : 0
      const missing = x.kind === 'own' ? Math.min(x.missingBp, keptBp) : 0
      missingBp += missing
      ownBp += x.kind === 'own' ? keptBp - missing : 0
      readBp += x.kind === 'read' ? keptBp : 0
      unreadBp += x.kind === 'unread' ? keptBp : 0
      at += x.bp
    }
  }
  let end: number | undefined
  pieces.forEach((piece, p) => {
    const gap = between(p)
    if (gap) {
      countOwn(gap)
    } else if (
      end !== undefined &&
      piece.start !== undefined &&
      piece.start > end
    ) {
      for (const part of gapParts(
        end,
        piece.start,
        { after: pieces[p - 1]!.trimmedAfter, before: piece.trimmedBefore },
        departures,
      )) {
        missingBp += part.cause === 'missing' ? part.bp : 0
        ownBp += part.cause === 'own' ? part.bp : 0
        readBp += part.cause === undefined ? part.bp : 0
        unreadBp += part.cause === 'elsewhere' ? part.bp : 0
      }
    }
    end = piece.start === undefined ? undefined : piece.start + bpOf(piece)
  })
  rowEnds.forEach(countOwn)
  const reference = isReference(graph, name)
  return {
    name,
    reference,
    range,
    nodeIds,
    edgeIndexes,
    progress,
    passProgress,
    passes,
    mostPasses,
    route: walked.map(piece => piece.nodeIds),
    steps: walked.reduce(
      (sum, piece) => sum + piece.nodeIds.filter(id => !unloaded(id)).length,
      0,
    ),
    bp,
    unloadedBp: walked.reduce(
      (sum, piece) =>
        sum +
        piece.nodeIds.reduce(
          (run, id) => run + (unloaded(id) ? lengthOf(id) : 0),
          0,
        ),
      0,
    ),
    missingBp,
    ownBp,
    referencePath: graph.referencePath,
    revisited: graph.revisited,
    ...(stated.length > 0 ? { readBp, unreadBp } : {}),
  }
}

// A walk's departures over a walk-file cut
function departuresOf(graph: Graph, name: string) {
  const table = graph.departures
  const out = []
  if (table) {
    for (let k = 0; k < table.names.length; k++) {
      if (pathOrigin(table.names[k]!).name === name) {
        out.push(departureAt(table, k))
      }
    }
  }
  return out
}

// Each visit's value for the walk's field, through its scheme; a run of steps
// not loaded keeps its own ink
function laneColors(
  graph: Graph,
  byId: Map<string, GraphNode>,
  walk: WalkHighlight,
  encoding: WalkEncoding,
  ramp: ReferenceRamp | undefined,
) {
  const places =
    encoding.field === 'progress' || !ramp
      ? undefined
      : referencePlaces(graph, byId, walk, ramp)
  const colors = new Map<string, number>()
  const passColors = new Map<string, number[]>()
  for (const [id, progress] of walk.passProgress) {
    const at = places?.get(id)
    const each = progress.map((t, pass) =>
      byId.get(id)?.placeholder
        ? NOT_LOADED_COLOR
        : encodedColor(encoding, places ? at?.[pass] : t),
    )
    colors.set(id, each[0]!)
    passColors.set(id, each)
  }
  return { colors, passColors }
}

// Each visit's fraction along the ramp, in the order the walk makes them. A
// node the reference walks more than once takes the copy nearest where the
// walk last left the reference, as walk rows place it, so each pass through a
// collapsed repeat takes its own copy's hue
function referencePlaces(
  graph: Graph,
  byId: Map<string, GraphNode>,
  walk: WalkHighlight,
  ramp: ReferenceRamp,
) {
  const startsOf = referenceVisitStarts(graph)
  const places = new Map<string, (number | undefined)[]>()
  for (const piece of walk.route) {
    let cursor = Number.NaN
    let last = Number.NaN
    for (const id of piece) {
      const node = byId.get(id)
      let t = node && rampFraction(node, ramp)
      if (node && t !== undefined && isBackbone(node)) {
        const starts = startsOf(node)
        const len = node.length
        let at = starts[0]!
        if (starts.length > 1 && !Number.isNaN(cursor)) {
          let gap = Infinity
          for (const start of starts) {
            const g = Math.min(
              Math.abs(start - cursor),
              Math.abs(start + len - cursor),
            )
            if (g < gap) {
              at = start
              gap = g
            }
          }
          t = (at + len / 2 - ramp.start) / ramp.span
        }
        cursor = at + len === last ? at : at + len
        last = at
      }
      const seen = places.get(id)
      if (seen) {
        seen.push(t)
      } else {
        places.set(id, [t])
      }
    }
  }
  return places
}

export function walkLift(
  graph: Graph,
  layers: readonly WalkLayer[],
  ramp?: ReferenceRamp,
): WalkLift | undefined {
  const index = graphIndex(graph)
  const seen = new Set<string>()
  const lifted = layers
    .filter(layer => !seen.has(layer.walk) && seen.add(layer.walk))
    .flatMap(layer => {
      const walk = highlightOf(graph, layer.walk, index)
      return walk ? [{ walk, layer }] : []
    })
    .sort((a, b) => Number(b.walk.reference) - Number(a.walk.reference))
  if (lifted.length === 0) {
    return undefined
  }
  let picked = 0
  const encodings = splitFamilies(
    lifted.map(({ walk, layer }) =>
      resolveEncoding(
        layer,
        walk.reference,
        walk.reference ? 0 : picked++,
        lifted.length === 1,
      ),
    ),
  )
  const walks = lifted.map(({ walk }, i) => {
    const encoding = encodings[i]!
    return {
      ...walk,
      encoding,
      ...laneColors(graph, index.byId, walk, encoding, ramp),
    }
  })
  return liftOf(walks, ramp)
}

// The scale every facet panel shares, as a faceted plot shares its axes
const FACET_COLOR: Partial<WalkEncoding> = { field: 'progress', scheme: 'red' }

// A lift split into one lift per walk, each walk alone on the scale the panels
// share, unless its layer states a colour of its own
export function facetLifts(
  graph: Graph,
  lift: WalkLift,
  layers: readonly WalkLayer[],
  ramp?: ReferenceRamp,
) {
  const byId = nodesById(graph)
  return lift.walks.map(walk => {
    const stated = layers.find(l => l.walk === walk.name)?.color
    const encoding = resolveEncoding(
      { walk: walk.name, color: { ...FACET_COLOR, ...stated } },
      walk.reference,
      0,
    )
    return liftOf(
      [
        {
          ...walk,
          encoding,
          ...laneColors(graph, byId, walk, encoding, ramp),
        },
      ],
      ramp,
    )
  })
}

function liftOf(walks: LiftedWalk[], ramp?: ReferenceRamp): WalkLift {
  return {
    walks,
    referenceDomain: ramp
      ? { start: ramp.start, end: ramp.start + ramp.span }
      : undefined,
    nodeIds: new Set(walks.flatMap(w => [...w.nodeIds])),
    edgeIndexes: new Set(walks.flatMap(w => [...w.edgeIndexes])),
    names: new Set(walks.map(w => w.name)),
  }
}
