import type { BandageScaleOpts } from './drawnScale'
import type { DeletionEdge } from '../deletionEdges'
import type { Graph, GraphEdge, GraphNode, NodeSegment } from '../types'

// A deletion is a bubble whose own arm is a bare link. A force layout runs that
// link through a node of its own, so the simulation makes room for the arm like
// any other and the drawing follows where it went. The node is half as long as
// the reference it skips: long enough to read as a route, short enough to read
// as the shortcut it is.
const ROUTE_ID = '\u0000deletion:'
const ROUTE_FRACTION = 0.5

export type DeletionRoutes = Record<number, NodeSegment[]>

export function withDeletionRoutes(graph: Graph, deletions: DeletionEdge[]) {
  const routes = new Map(
    deletions.map(d => [d.edgeIndex, `${ROUTE_ID}${d.edgeIndex}`]),
  )
  const edges: GraphEdge[] = []
  graph.edges.forEach((edge, ei) => {
    const id = routes.get(ei)
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
// `opts` turns into drawn length.
export function routeNodes(
  graph: Graph,
  deletions: DeletionEdge[],
  routes: Map<number, string>,
  drawnOf: (bp: number) => number,
  opts: BandageScaleOpts,
): GraphNode[] {
  const lengths = new Map(graph.nodes.map(n => [n.id, n.length]))
  return deletions.map(d => {
    const skipped = d.bypassed.reduce(
      (sum, id) => sum + (lengths.get(id) ?? 0),
      0,
    )
    const drawn = Math.max(
      opts.minimumNodeLength,
      drawnOf(skipped) * ROUTE_FRACTION,
    )
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
