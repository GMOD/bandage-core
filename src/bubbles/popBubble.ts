import { stretchSpan, trimOrigins } from '../pathAnchoring'

import type { Graph } from '../types'

// The graph inside one bubble: the segments the bubble row names, with the
// links among them. The row's list includes the two backbone segments the
// bubble hangs between, so the cut keeps its anchors and every layout that
// needs a backbone still has one. A walk keeps the steps it takes inside the
// bubble, so the bubbles derived inside it still read their routes and
// lengths off the haplotypes, and carriage still sets node width. Its origin
// moves to where its first kept step starts, and its end to where its last
// ends (pathAnchoring.ts stretchSpan), so a range or position read off the
// walk is where those steps sit on its contig, as it is on the whole graph.
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
    const last = p.nodeIds.findLastIndex(id => ids.has(id))
    return [
      {
        ...p,
        nodeIds,
        ...(p.refStarts
          ? { refStarts: p.refStarts.filter((_, i) => ids.has(p.nodeIds[i]!)) }
          : {}),
        ...stretchSpan(graph, p, id => lengthOf.get(id) ?? 0, first, last),
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
    revisited: graph.revisited,
    ...(graph.depthStated ? { depthStated: true } : {}),
  }
}
