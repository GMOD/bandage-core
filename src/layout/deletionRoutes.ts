import { ROUTE_ID } from '@jbrowse/graph-stress-layout'

import type { BandageScaleOpts } from './drawnScale'
import type { DeletionEdge } from '../deletionEdges'
import type { Graph, GraphEdge, GraphNode, NodeSegment } from '../types'

// A deletion the layout has to keep, nothing else joining its ends, runs
// through a node of its own, so the simulation holds its ends apart as the
// reference it skips would and the drawing follows where it went: a deletion
// out to a segment past the window's edge reads as reaching that far. The node
// is half as long as the reference it skips: long enough to read as a route,
// short enough to read as the shortcut it is. Its id starts with ROUTE_ID,
// which the stress engine's placement arches over the backbone.
const ROUTE_FRACTION = 0.5

export type DeletionRoutes = Record<number, NodeSegment[]>

export function withDeletionRoutes(
  graph: Graph,
  deletions: DeletionEdge[],
  dropped: ReadonlySet<number> = new Set(),
) {
  const routes = new Map(
    deletions.map(d => [d.edgeIndex, `${ROUTE_ID}${d.edgeIndex}`]),
  )
  const edges: GraphEdge[] = []
  graph.edges.forEach((edge, ei) => {
    const id = routes.get(ei)
    if (dropped.has(ei)) {
      return
    }
    if (id === undefined) {
      edges.push(edge)
    } else {
      const { fromStrand, toStrand } = edge
      edges.push(
        { from: edge.from, to: id, ...(fromStrand ? { fromStrand } : {}) },
        { from: id, to: edge.to, ...(toStrand ? { toStrand } : {}) },
      )
    }
  })
  return {
    graph: {
      ...graph,
      nodes: [
        ...graph.nodes,
        ...[...routes.values()].map(id => ({
          id,
          name: id,
          length: 0,
          depth: 0,
        })),
      ],
      edges,
    },
    routes,
    ids: new Set(routes.values()),
  }
}

// The route nodes as the engine takes them, each `length` in whatever unit
// `opts` turns into drawn length. Together they draw no longer than `budget`,
// the drawn length of everything else laid out, shrunk alike to fit: the
// engine's work grows with drawn length, and a cut with hundreds of deletions
// to segments far along the reference, as a collapsed repeat's cut has, would
// otherwise spend nearly all of it on routes.
export function routeNodes(
  graph: Graph,
  deletions: DeletionEdge[],
  routes: Map<number, string>,
  drawnOf: (bp: number) => number,
  opts: BandageScaleOpts,
  budget: number,
): GraphNode[] {
  const lengths = new Map(graph.nodes.map(n => [n.id, n.length]))
  const wanted = deletions.map(d =>
    Math.max(
      opts.minimumNodeLength,
      drawnOf(d.bypassed.reduce((sum, id) => sum + (lengths.get(id) ?? 0), 0)) *
        ROUTE_FRACTION,
    ),
  )
  const total = wanted.reduce((sum, drawn) => sum + drawn, 0)
  const scale = total > budget ? budget / total : 1
  return deletions.map((d, i) => {
    const drawn = Math.max(opts.minimumNodeLength, wanted[i]! * scale)
    const id = routes.get(d.edgeIndex)!
    return {
      id,
      name: id,
      length: Math.round((drawn * 1_000_000) / opts.nodeLengthPerMegabase),
      depth: 0,
    }
  })
}

// The route nodes split back out of a finished layout, keyed by the edge each
// one stood in for.
export function takeRoutes(
  positions: Record<string, NodeSegment[]>,
  routes: Map<number, string>,
) {
  const nodePositions = { ...positions }
  const deletionRoutes: DeletionRoutes = {}
  for (const [edgeIndex, id] of routes) {
    const route = nodePositions[id]
    delete nodePositions[id]
    if (route?.length) {
      deletionRoutes[edgeIndex] = route
    }
  }
  return { nodePositions, deletionRoutes }
}
