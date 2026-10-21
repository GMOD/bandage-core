import { gapParts } from './gfa/walkStops'
import { panSNContig } from './pansn'
import { pathOrigin } from './pathAnchoring'
import { rampFraction } from './renderer/GeometryBuilder'
import { encodedColor, resolveEncoding } from './walkEncoding'

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
  passes: Map<string, number>
  mostPasses: number
  route: readonly (readonly string[])[]
  steps: number
  bp: number
  referenceBp?: number
  // where the walk's stretch of the cut sits on its own contig, from its W or
  // P record: its start where it begins and its end where it ends
  range?: { contig: string; start: number; end: number }
  // bp of the gaps between its pieces that a walk-file cut's stops say the
  // graph lacks, or leave open (gfa/walkStops.ts gapParts)
  missingBp: number
  unknownBp: number
}

export interface LiftedWalk extends WalkHighlight {
  encoding: WalkEncoding
  // the lane colour at each node the walk visits
  colors: Map<string, number>
  // the nodes it crosses the other way from the reference walk, and their
  // bp; empty for the reference
  reversed: Set<string>
  reversedBp: number
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

function graphIndex(graph: Graph) {
  const edgeAt = new Map<string, number>()
  graph.edges.forEach((e, i) => {
    edgeAt.set(`${e.from}>${e.to}`, i)
  })
  return { byId: nodesById(graph), edgeAt }
}

export function walkHighlight(graph: Graph, name: string) {
  return highlightOf(graph, name, graphIndex(graph))
}

function highlightOf(
  graph: Graph,
  name: string,
  { byId, edgeAt }: ReturnType<typeof graphIndex>,
): WalkHighlight | undefined {
  const pieces = piecesOf(graph, name)
  const first = pieces[0]
  if (!first) {
    return undefined
  }
  const lengthOf = (id: string) => byId.get(id)?.length ?? 0
  const bpOf = (path: GraphPath) =>
    path.nodeIds.reduce((sum, id) => sum + lengthOf(id), 0)
  const bp = pieces.reduce((sum, piece) => sum + bpOf(piece), 0)
  // from the first piece's start to the furthest piece's end, gaps included
  const extentOf = (ps: GraphPath[]) => {
    const start = Math.min(...ps.map(p => p.start ?? Infinity))
    return Number.isFinite(start)
      ? { start, end: Math.max(...ps.map(p => (p.start ?? 0) + bpOf(p))) }
      : undefined
  }
  const extent = extentOf(pieces)
  const range = extent && {
    contig: first.contig ?? panSNContig(pathOrigin(name).name),
    ...extent,
  }
  // progress runs over the contig where the records place the pieces, so the
  // stretch between two pieces counts though no node draws it
  const span = range ? range.end - range.start : bp
  const nodeIds = new Set<string>()
  const edgeIndexes = new Set<number>()
  const progress = new Map<string, number>()
  const passes = new Map<string, number>()
  let mostPasses = 1
  let before = 0
  for (const piece of pieces) {
    if (range) {
      before = Math.max(before, (piece.start ?? 0) - range.start)
    }
    piece.nodeIds.forEach((id, i) => {
      nodeIds.add(id)
      const passed = (passes.get(id) ?? 0) + 1
      passes.set(id, passed)
      mostPasses = Math.max(mostPasses, passed)
      if (i > 0) {
        const a = piece.nodeIds[i - 1]!
        const index = edgeAt.get(`${a}>${id}`) ?? edgeAt.get(`${id}>${a}`)
        if (index !== undefined) {
          edgeIndexes.add(index)
        }
      }
      const length = lengthOf(id)
      if (!progress.has(id)) {
        progress.set(id, span > 0 ? (before + length / 2) / span : 0)
      }
      before += length
    })
  }
  let missingBp = 0
  let unknownBp = 0
  let end: number | undefined
  pieces.forEach((piece, p) => {
    if (end !== undefined && piece.start !== undefined && piece.start > end) {
      for (const part of gapParts(
        piece.start - end,
        pieces[p - 1]!.after,
        piece.before,
      )) {
        missingBp += part.cause === 'missing' ? part.bp : 0
        unknownBp += part.cause === 'unknown' ? part.bp : 0
      }
    }
    end = piece.start === undefined ? undefined : piece.start + bpOf(piece)
  })
  const reference = isReference(graph, name)
  // measured as `range` is, so a walk identical to a cut reference reads equal
  const referenceSpan = () => {
    const referencePieces = reference
      ? []
      : (graph.paths ?? []).filter(p => isReference(graph, p.name))
    if (referencePieces.length === 0) {
      return undefined
    }
    const e = extentOf(referencePieces)
    return e
      ? e.end - e.start
      : referencePieces.reduce((sum, piece) => sum + bpOf(piece), 0)
  }
  return {
    name,
    reference,
    range,
    nodeIds,
    edgeIndexes,
    progress,
    passes,
    mostPasses,
    route: pieces.map(piece => piece.nodeIds),
    steps: pieces.reduce((sum, piece) => sum + piece.nodeIds.length, 0),
    bp,
    referenceBp: referenceSpan(),
    missingBp,
    unknownBp,
  }
}

// Each node's value for the walk's field, through its scheme
function laneColors(
  byId: Map<string, GraphNode>,
  walk: WalkHighlight,
  encoding: WalkEncoding,
  ramp: ReferenceRamp | undefined,
) {
  const colors = new Map<string, number>()
  for (const [id, progress] of walk.progress) {
    const node = byId.get(id)
    const t =
      encoding.field === 'progress'
        ? progress
        : ramp && node
          ? rampFraction(node, ramp)
          : undefined
    colors.set(id, encodedColor(encoding, t))
  }
  return colors
}

// The nodes a walk reads on the other strand from the reference walk
function reversedNodes(
  graph: Graph,
  byId: Map<string, GraphNode>,
  walk: WalkHighlight,
) {
  const reversed = new Set<string>()
  let bp = 0
  const referencePath = graph.referencePath
  if (!referencePath || walk.reference) {
    return { reversed, bp }
  }
  const visits = graph.pathVisits
  if (!visits) {
    return { reversed, bp }
  }
  const own = visits.pathIndex(pathOrigin(walk.name).name)
  const theirs = visits.pathIndex(referencePath)
  for (const id of walk.progress.keys()) {
    const node = byId.get(id)
    const slot: number = node ? visits.slot(node.name) : -1
    const a = slot < 0 ? -1 : visits.firstBy(slot, own)
    const b = slot < 0 ? -1 : visits.firstBy(slot, theirs)
    if (a >= 0 && b >= 0 && visits.reversed[a] !== visits.reversed[b]) {
      reversed.add(id)
      bp += node!.length
    }
  }
  return { reversed, bp }
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
  const walks = lifted.map(({ walk, layer }) => {
    const encoding = resolveEncoding(
      layer,
      walk.reference,
      walk.reference ? 0 : picked++,
      lifted.length === 1,
    )
    const { reversed, bp } = reversedNodes(graph, index.byId, walk)
    return {
      ...walk,
      encoding,
      colors: laneColors(index.byId, walk, encoding, ramp),
      reversed,
      reversedBp: bp,
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
          colors: laneColors(byId, walk, encoding, ramp),
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
