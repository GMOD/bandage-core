import { ROUTE_ID } from '@jbrowse/graph-stress-layout'

import { strandSides } from '../util/geometry'

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

// How deep an arch rises per unit of its chord, and at most, as the stress
// engine arches a route over the backbone
const ARCH = 0.25
const ARCH_CAP = 150

// A deletion the layout left out, its ends laid along the reference, draws as
// a shallow arch from end to end, on the side the stress engine arches a
// route: bowed round the reference it skips instead, as an anchored layout
// draws it, it swung far off the drawing.
export function archRoutes(
  graph: Graph,
  deletions: DeletionEdge[],
  nodePositions: Record<string, NodeSegment[]>,
) {
  const starts = new Map(
    graph.nodes.flatMap(n => (n.stable ? [[n.id, n.stable.start]] : [])),
  )
  const end = (segments: NodeSegment[], side: 'start' | 'end') =>
    side === 'start' ? segments[0]! : segments.at(-1)!
  const routes: DeletionRoutes = {}
  for (const d of deletions) {
    const from = nodePositions[d.from]
    const to = nodePositions[d.to]
    if (from?.length && to?.length) {
      const sides = strandSides(graph.edges[d.edgeIndex]!)
      const a = end(from, sides.from)
      const b = end(to, sides.to)
      const chord = Math.hypot(b.x - a.x, b.y - a.y)
      if (chord > 0) {
        const downstream =
          (starts.get(d.from) ?? 0) <= (starts.get(d.to) ?? 0) ? 1 : -1
        const rise = Math.min(ARCH * chord, ARCH_CAP) * downstream
        const n = { x: -(b.y - a.y) / chord, y: (b.x - a.x) / chord }
        routes[d.edgeIndex] = [1, 2, 3, 4, 5, 6, 7].map(k => {
          const t = k / 8
          const lift = 4 * t * (1 - t) * rise
          return {
            x: a.x + (b.x - a.x) * t - n.x * lift,
            y: a.y + (b.y - a.y) * t - n.y * lift,
          }
        })
      }
    }
  }
  return routes
}
