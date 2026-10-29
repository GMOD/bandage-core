import type { Graph } from '../types'

/**
 * The graph without its stray handles, for a layout that draws nodes. A
 * walk-file cut keeps an abridged walk's two steps wherever they lie on the
 * reference, and one past the window has no link into the cut: the steps that
 * reach it are the ones the cut did not load, so a node layout would draw it
 * alone. A stray handle is a node no link touches and only abridged walks step
 * on. Walk rows still read the full graph, which places the handle.
 */
export function withoutStrayHandles(graph: Graph): Graph {
  const paths = graph.paths ?? []
  const linked = new Set<string>()
  const stray = new Set<string>()
  if (paths.some(path => path.abridged)) {
    for (const { from, to } of graph.edges) {
      linked.add(from)
      linked.add(to)
    }
    for (const path of paths) {
      if (path.abridged) {
        for (const id of path.nodeIds) {
          if (!linked.has(id)) {
            stray.add(id)
          }
        }
      }
    }
  }
  if (stray.size > 0) {
    for (const path of paths) {
      if (!path.abridged) {
        for (const id of path.nodeIds) {
          stray.delete(id)
        }
      }
    }
  }
  return stray.size === 0
    ? graph
    : { ...graph, nodes: graph.nodes.filter(node => !stray.has(node.id)) }
}
