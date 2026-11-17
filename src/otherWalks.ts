import { pathOrigin } from './pathAnchoring'

import type { Graph } from './types'

// The nodes some walk goes through other than those `lifted` names
export function onOtherWalks(graph: Graph, lifted: ReadonlySet<string>) {
  const liftedOrigins = new Set([...lifted].map(n => pathOrigin(n).name))
  const other = (name: string) => !liftedOrigins.has(pathOrigin(name).name)
  const onOthers = new Set<string>()
  for (const path of graph.paths ?? []) {
    if (other(path.name)) {
      for (const id of path.nodeIds) {
        onOthers.add(id)
      }
    }
  }
  for (const gap of graph.gaps ?? []) {
    if (other(gap.name)) {
      for (const segment of gap.segments) {
        for (const id of segment.nodes) {
          onOthers.add(id)
        }
      }
    }
  }
  return onOthers
}
