import { trimOrigins } from '../pathAnchoring'

import type { Graph } from '../types'

// The graph inside one bubble: the segments the bubble row names, with the
// links among them. The row's list includes the two backbone segments the
// bubble hangs between, so the cut keeps its anchors and every layout that
// needs a backbone still has one. A walk keeps the steps it takes inside the
// bubble, so the bubbles derived inside it still read their routes and
// lengths off the haplotypes, and carriage still sets node width. Its origin
// moves to where its first kept step starts, so a position read off the walk
// is where that step sits on its contig, as it is on the whole graph.
export function bubbleSubgraph(graph: Graph, segmentIds: string[]): Graph {
  const keep = new Set(segmentIds)
  const nodes = graph.nodes.filter(n => keep.has(n.name))
  const ids = new Set(nodes.map(n => n.id))
  const lengthOf = new Map(graph.nodes.map(n => [n.id, n.length]))
  const kept = new Map<string, { first: number; nodeIds: string[] }>()
  const paths = graph.paths?.flatMap(p => {
    const first = p.nodeIds.findIndex(id => ids.has(id))
    if (first < 0) {
      return []
    }
    const nodeIds = p.nodeIds.filter(id => ids.has(id))
    kept.set(p.name, { first, nodeIds })
    const before = p.nodeIds
      .slice(0, first)
      .reduce((sum, id) => sum + (lengthOf.get(id) ?? 0), 0)
    return [
      {
        ...p,
        nodeIds,
        ...(p.start === undefined ? {} : { start: p.start + before }),
      },
    ]
  })
  return {
    name: graph.name,
    nodes,
    edges: graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)),
    ...(paths?.length ? { paths } : {}),
    anchorPaths: trimOrigins(graph, kept),
    pathVisits: graph.pathVisits,
    anchoredBy: graph.anchoredBy,
    referencePath: graph.referencePath,
  }
}
