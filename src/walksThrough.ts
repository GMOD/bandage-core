import type { Graph, GraphNode } from './types'

export interface WalkThrough {
  name: string
  passes: number
}

/**
 * The walks that pass a node, each once with how many times, in the graph's
 * order: those whose fragments step on it, then those that reach it only
 * through a departure's own steps. On a cut's Graph the passes sum to the
 * node's depth, so the list names every walk its thickness counts.
 */
export function walksThrough(
  graph: Pick<Graph, 'paths'>,
  node: Pick<GraphNode, 'id' | 'departureVisits'>,
): WalkThrough[] {
  const passes = new Map<string, number>()
  const pass = (name: string) => passes.set(name, (passes.get(name) ?? 0) + 1)
  for (const path of graph.paths ?? []) {
    for (const id of path.nodeIds) {
      if (id === node.id) {
        pass(path.name)
      }
    }
  }
  for (const visit of node.departureVisits ?? []) {
    pass(visit.path)
  }
  return Array.from(passes, ([name, count]) => ({ name, passes: count }))
}
