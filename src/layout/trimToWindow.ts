import { isBackbone } from '../anchoredNodes'
import { pathOrigin, trimOrigins } from '../pathAnchoring'

import type { Graph, GraphPath, PathVisit } from '../types'

// A cut reaches past its window by the track's context, which is what lets
// walk rows see where a walk ends. A tube map is a picture of the window, so
// it draws each walk only from its first reference node overlapping the
// window to its last, and the nodes and links those stretches use.
//
// A graph with no reference node in the window, or none at all, is returned
// as it is: there is nothing to trim it to.
export function trimToWindow(
  graph: Graph,
  window: { start: number; end: number },
): Graph {
  const inWindow = new Set(
    graph.nodes
      .filter(
        n =>
          isBackbone(n) &&
          n.stable.start < window.end &&
          n.stable.start + n.length > window.start,
      )
      .map(n => n.id),
  )
  const paths = graph.paths ?? []
  if (inWindow.size === 0 || paths.length === 0) {
    return graph
  }
  const lengthOf = new Map(graph.nodes.map(n => [n.id, n.length]))

  // each walk's kept stretch, as indexes into its steps; none when it never
  // meets the window's reference
  const spans = paths.map(path => {
    let first = -1
    let last = -1
    path.nodeIds.forEach((id, i) => {
      if (inWindow.has(id)) {
        if (first < 0) {
          first = i
        }
        last = i
      }
    })
    return first < 0 ? undefined : { first, last }
  })
  if (
    spans.every(
      (span, i) =>
        span?.first === 0 && span.last === paths[i]!.nodeIds.length - 1,
    )
  ) {
    return graph
  }

  const kept = new Set<string>()
  const trimmed: GraphPath[] = []
  const stretches = new Map<string, { dropped: number; bp: number }>()
  const bpOf = (ids: string[]) =>
    ids.reduce((sum, id) => sum + (lengthOf.get(id) ?? 0), 0)
  paths.forEach((path, i) => {
    const span = spans[i]
    if (span) {
      const nodeIds = path.nodeIds.slice(span.first, span.last + 1)
      for (const id of nodeIds) {
        kept.add(id)
      }
      trimmed.push({ ...path, nodeIds })
      stretches.set(path.name, {
        dropped: bpOf(path.nodeIds.slice(0, span.first)),
        bp: bpOf(nodeIds),
      })
    }
  })

  return {
    ...graph,
    nodes: graph.nodes.filter(n => kept.has(n.id)),
    edges: graph.edges.filter(e => kept.has(e.from) && kept.has(e.to)),
    paths: trimmed,
    pathVisits:
      graph.pathVisits &&
      trimVisits(
        graph.pathVisits,
        paths,
        spans,
        new Map(graph.nodes.map(n => [n.id, n.name])),
      ),
    anchorPaths:
      graph.anchorPaths && trimOrigins(graph.anchorPaths, paths, stretches),
  }
}

// Visits are keyed by segment name and listed in walk order, and a walk in
// several pieces lists its pieces in the order the paths are, so replaying
// every path's steps consumes the visits one for one; a visit is kept when its
// step lies in the kept stretch.
function trimVisits(
  visits: Map<string, PathVisit[]>,
  paths: GraphPath[],
  spans: ({ first: number; last: number } | undefined)[],
  nameOf: Map<string, string>,
) {
  const cursor = new Map<string, number>()
  const out = new Map<string, PathVisit[]>()
  paths.forEach((path, p) => {
    const origin = pathOrigin(path.name).name
    const span = spans[p]
    path.nodeIds.forEach((id, i) => {
      const segment = nameOf.get(id) ?? id
      const list = visits.get(segment)
      if (!list) {
        return
      }
      const key = `${origin}\t${segment}`
      let at = cursor.get(key) ?? 0
      while (at < list.length && list[at]!.path !== origin) {
        at++
      }
      const visit = list[at]
      cursor.set(key, at + 1)
      if (visit && span && i >= span.first && i <= span.last) {
        const keptVisits = out.get(segment)
        if (keptVisits) {
          keptVisits.push(visit)
        } else {
          out.set(segment, [visit])
        }
      }
    })
  })
  return out
}
