import { isBackbone, isLoadedBackbone } from './anchoredNodes'
import { departureAt, gapParts } from './gfa/departures'
import { linkKey } from './gfa/linkKey'
import { onOtherWalks } from './otherWalks'
import { panSNContig } from './pansn'
import { pathOrigin, referenceVisitStarts } from './pathAnchoring'
import { rampPieces } from './referenceRampCss'
import { NOT_LOADED_COLOR, rampFraction } from './renderer/GeometryBuilder'
import { abgrHex } from './renderer/colorBits'
import { ownStrand } from './util/geometry'
import { pushTo } from './util/groups'
import {
  encodedColor,
  encodingStops,
  resolveEncoding,
  splitFamilies,
} from './walkEncoding'
import { liftedPasses, passInk, walkPassesOf } from './walkPasses'

import type { GraphGap } from './gfa/departures'
import type { ReferenceRamp } from './renderer/GeometryBuilder'
import type { Graph, GraphNode, GraphPath } from './types'
import type { WalkEncoding, WalkLayer } from './walkEncoding'
import type { LiftedPasses } from './walkPasses'

export interface RouteStep {
  id: string
  strand: Strand
  start: number
}

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
  backwards: Map<string, boolean[]>
  mostPasses: number
  route: readonly (readonly string[])[]
  routeSteps: readonly (readonly RouteStep[])[]
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
  // where a walk-file cut states its stretches: bp it read and kept out
  readBp?: number
  // on a thread of a folded graph (threadFold.ts): the haplotypes it stands
  // for, which its lane is as wide as, their walks' names, what they differ
  // by under the fold, and how many walks its one haplotype has
  count?: number
  members?: readonly string[]
  variation?: string
  pieces?: number
  // the figure's `countLaneScale` where it is not 1, which a lane stating a
  // count is drawn that much thinner or wider by (nodeWidths.ts laneWidthPx)
  laneScale?: number
}

export interface LiftedWalk extends WalkHighlight {
  encoding: WalkEncoding
  walkPasses?: LiftedPasses
  // the lane colour at each node the walk visits
  colors: Map<string, number>
  // the colour at each visit, in the order the walk makes them
  passColors: Map<string, number[]>
  // a lane coloured by reference position across a reference node it visits
  // once, where its span takes more than one hue: the flat pieces of it, as
  // fractions of the span from its start, each in its middle's colour
  rampColors: Map<string, { from: number; to: number; color: number }[]>
  // WalkLayer.picked
  picked?: readonly string[]
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

// What a lift's faded key says of what it draws in grey, or nothing where it
// draws none: the nodes it fades, and under a lifted walk's lanes the nodes
// other walks share with it at their own width. That is other haplotypes when
// every faded node lies on a walk the lift leaves out, or no walk where some lie
// on no walk at all. Links don't decide it,
// since a cut keeps the source graph's links between the nodes it keeps even
// where it drops the walks that take them.
export function fadedKey(graph: Graph, lift: WalkLift, walks: string) {
  const onOthers = onOtherWalks(graph, lift.names)
  const faded = graph.nodes.filter(n => !lift.nodeIds.has(n.id))
  const shared =
    lift.walks.length > 0 &&
    graph.nodes.some(n => lift.nodeIds.has(n.id) && onOthers.has(n.id))
  return faded.length > 0 || shared
    ? faded.every(n => onOthers.has(n.id))
      ? 'other haplotypes'
      : onOthers.size > 0
        ? 'other haplotypes, or no walk'
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
    const start = ps.reduce(
      (least, p) => Math.min(least, p.start ?? Infinity),
      Infinity,
    )
    return Number.isFinite(start)
      ? {
          start,
          end: ps.reduce(
            (most, p) => Math.max(most, (p.start ?? 0) + bpOf(p)),
            -Infinity,
          ),
        }
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
  const backwards = new Map<string, boolean[]>()
  const passes = new Map<string, number>()
  let mostPasses = 1
  let before = 0
  const steppedOn = new Set<GraphPath>(attached)
  const routeSteps: RouteStep[][] = []
  let previous: GraphPath | undefined
  for (const piece of walked) {
    if (range) {
      before = Math.max(before, (piece.start ?? 0) - range.start)
    }
    const steps: RouteStep[] = []
    routeSteps.push(steps)
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
      steps.push({ id, strand: strands?.[i] ?? ownStrand(id), start: before })
      const at = span > 0 ? (before + length / 2) / span : 0
      if (!progress.has(id)) {
        progress.set(id, at)
      }
      const seen = passProgress.get(id)
      const turned = (strands?.[i] ?? ownStrand(id)) !== ownStrand(id)
      if (seen) {
        seen.push(at)
        backwards.get(id)?.push(turned)
      } else {
        passProgress.set(id, [at])
        backwards.set(id, [turned])
      }
      before += length
    })
    previous = piece
  }
  const departures = departuresOf(graph, name)
  let missingBp = 0
  let ownBp = 0
  let readBp = 0
  const countOwn = (gap: GraphGap) => {
    let at = gap.start
    for (const x of gap.segments) {
      const inRange = !extent || (at >= extent.start && at + x.bp <= extent.end)
      const keptBp = inRange ? x.bp : 0
      const missing = x.kind === 'own' ? Math.min(x.missingBp, keptBp) : 0
      missingBp += missing
      ownBp += x.kind === 'own' ? keptBp - missing : 0
      readBp += x.kind === 'read' ? keptBp : 0
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
    backwards,
    mostPasses,
    route: walked.map(piece => piece.nodeIds),
    routeSteps,
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
    ...(stated.length > 0 ? { readBp } : {}),
    ...(first?.count === undefined
      ? {}
      : {
          count: first.count,
          members: first.members,
          variation: first.variation,
          pieces: first.pieces,
        }),
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
  layer: WalkLayer | undefined,
  lanes: readonly string[] = [],
  taken: readonly string[] = [],
) {
  const places =
    encoding.field !== 'reference' || !ramp
      ? undefined
      : referencePlaces(graph, byId, walk, ramp)
  const walkPasses =
    encoding.field === 'pass'
      ? liftedPasses(
          walkPassesOf(walk, id => byId.get(id)?.length ?? 0, layer?.passes),
          encodedColor(encoding),
          layer?.passNames,
          lanes,
          taken,
        )
      : undefined
  const colors = new Map<string, number>()
  const passColors = new Map<string, number[]>()
  const rampColors = new Map<
    string,
    { from: number; to: number; color: number }[]
  >()
  for (const [id, progress] of walk.passProgress) {
    const node = byId.get(id)
    const pieces =
      ramp &&
      progress.length === 1 &&
      isLoadedBackbone(node) &&
      places?.get(id)?.[0] === rampFraction(node, ramp)
        ? rampPieces(
            { start: node.stable.start, bp: node.length },
            { start: ramp.start, end: ramp.start + ramp.span },
          )
        : []
    if (pieces.length > 1) {
      rampColors.set(
        id,
        pieces.map(({ from, to, t }) => ({
          from,
          to,
          color: encodedColor(encoding, t),
        })),
      )
    }
    const at = places?.get(id)
    const passed = walkPasses?.visitPass.get(id)
    const each = progress.map((t, visit) =>
      byId.get(id)?.placeholder
        ? NOT_LOADED_COLOR
        : walkPasses
          ? passInk(walkPasses, passed?.[visit] ?? -1)
          : encodedColor(encoding, places ? at?.[visit] : t),
    )
    colors.set(id, each[0]!)
    passColors.set(id, each)
  }
  return {
    colors,
    passColors,
    rampColors,
    ...(walkPasses ? { walkPasses } : {}),
  }
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
      pushTo(places, id, t)
    }
  }
  return places
}

export function walkLift(
  graph: Graph,
  layers: readonly WalkLayer[],
  ramp?: ReferenceRamp,
  { countLaneScale = 1 }: { countLaneScale?: number } = {},
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
  const laneInks = encodings.map(encoding =>
    encodingStops(encoding).map(stop => abgrHex(stop.abgr)),
  )
  const taken: string[] = []
  const walks = lifted.map(({ walk, layer }, i) => {
    const encoding = encodings[i]!
    const colored = laneColors(
      graph,
      index.byId,
      walk,
      encoding,
      ramp,
      layer,
      laneInks.filter((_, j) => j !== i).flat(),
      taken,
    )
    for (const { ink } of colored.walkPasses?.passes ?? []) {
      taken.push(abgrHex(ink))
    }
    return {
      ...walk,
      encoding,
      ...colored,
      ...(layer.picked ? { picked: layer.picked } : {}),
      ...(countLaneScale === 1 || walk.count === undefined
        ? {}
        : { laneScale: countLaneScale }),
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
          ...laneColors(
            graph,
            byId,
            walk,
            encoding,
            ramp,
            layers.find(l => l.walk === walk.name),
          ),
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
