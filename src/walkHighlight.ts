import { pathOrigin } from './pathAnchoring'
import {
  NO_VALUE_COLOR,
  STRAND_T,
  resolveEncoding,
  schemeColor,
} from './walkEncoding'

import type { ReferenceRamp } from './renderer/GeometryBuilder'
import type { Graph } from './types'
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
  steps: number
  bp: number
  referenceBp?: number
}

export interface LiftedWalk extends WalkHighlight {
  encoding: WalkEncoding
  // the lane colour at each node the walk visits
  colors: Map<string, number>
}

// The walks lifted together, reference first and the rest in the order they
// were picked, each in its lane of the nodes it visits. A node or link on any
// of them keeps its ink.
export interface WalkLift {
  walks: LiftedWalk[]
  nodeIds: Set<string>
  edgeIndexes: Set<number>
  names: Set<string>
}

function referenceOf(graph: Graph) {
  // `referencePath` is the anchor name, which pathOrigin has stripped of the
  // range suffix odgi leaves on a P record's name
  return graph.referencePath
    ? graph.paths?.find(p => pathOrigin(p.name).name === graph.referencePath)
    : undefined
}

export function walkHighlight(
  graph: Graph,
  name: string,
): WalkHighlight | undefined {
  const path = graph.paths?.find(p => p.name === name)
  if (!path) {
    return undefined
  }
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const edgeAt = new Map<string, number>()
  graph.edges.forEach((e, i) => {
    edgeAt.set(`${e.from}>${e.to}`, i)
  })
  const edgeIndexes = new Set<number>()
  for (let i = 1; i < path.nodeIds.length; i++) {
    const a = path.nodeIds[i - 1]!
    const b = path.nodeIds[i]!
    const index = edgeAt.get(`${a}>${b}`) ?? edgeAt.get(`${b}>${a}`)
    if (index !== undefined) {
      edgeIndexes.add(index)
    }
  }
  const lengthOf = (id: string) => byId.get(id)?.length ?? 0
  const bp = path.nodeIds.reduce((sum, id) => sum + lengthOf(id), 0)
  const progress = new Map<string, number>()
  let before = 0
  for (const id of path.nodeIds) {
    const length = lengthOf(id)
    if (!progress.has(id)) {
      progress.set(id, bp > 0 ? (before + length / 2) / bp : 0)
    }
    before += length
  }
  const reference = referenceOf(graph)
  return {
    name,
    reference: reference === path,
    nodeIds: new Set(path.nodeIds),
    edgeIndexes,
    progress,
    steps: path.nodeIds.length,
    bp,
    referenceBp:
      reference && reference !== path
        ? reference.nodeIds.reduce((sum, id) => sum + lengthOf(id), 0)
        : undefined,
  }
}

// Each node's value for a field, mapped through the walk's scheme
function laneColors(
  graph: Graph,
  walk: WalkHighlight,
  { field, scheme }: WalkEncoding,
  ramp: ReferenceRamp | undefined,
) {
  const colors = new Map<string, number>()
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const walkPath = pathOrigin(walk.name).name
  const reference = referenceOf(graph)
  const referencePath = reference ? pathOrigin(reference.name).name : undefined
  const path = graph.paths!.find(p => p.name === walk.name)!
  const visits = new Map<string, number>()
  for (const id of path.nodeIds) {
    visits.set(id, (visits.get(id) ?? 0) + 1)
  }
  const strandOf = (segment: string, of: string | undefined) =>
    graph.pathVisits?.get(segment)?.find(v => v.path === of)?.strand
  for (const [id, progress] of walk.progress) {
    const node = byId.get(id)
    let t: number | undefined
    if (field === 'progress') {
      t = progress
    } else if (field === 'visits') {
      t = (Math.min(visits.get(id) ?? 1, 4) - 1) / 3
    } else if (field === 'reference') {
      const mid = ramp?.midpoints.get(id)
      t =
        ramp && mid !== undefined && !(node?.stable && node.stable.rank > 0)
          ? (mid - ramp.start) / ramp.span
          : undefined
    } else if (node) {
      const own = strandOf(node.name, walkPath)
      const theirs = strandOf(node.name, referencePath)
      t =
        own && theirs
          ? own === theirs
            ? STRAND_T.same
            : STRAND_T.reversed
          : undefined
    }
    colors.set(id, t === undefined ? NO_VALUE_COLOR : schemeColor(scheme, t))
  }
  return colors
}

export function walkLift(
  graph: Graph,
  layers: readonly WalkLayer[],
  ramp?: ReferenceRamp,
): WalkLift | undefined {
  const seen = new Set<string>()
  const lifted = layers
    .filter(layer => !seen.has(layer.walk) && seen.add(layer.walk))
    .flatMap(layer => {
      const walk = walkHighlight(graph, layer.walk)
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
    )
    return {
      ...walk,
      encoding,
      colors: laneColors(graph, walk, encoding, ramp),
    }
  })
  return {
    walks,
    nodeIds: new Set(walks.flatMap(w => [...w.nodeIds])),
    edgeIndexes: new Set(walks.flatMap(w => [...w.edgeIndexes])),
    names: new Set(walks.map(w => w.name)),
  }
}
