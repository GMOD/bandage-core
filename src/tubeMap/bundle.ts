import { pathSteps } from '../layout/tubeMapLayout'
import { pathOrigin } from '../pathAnchoring'

import type { Graph } from '../types'

// The walks that take one route, step for step and strand for strand, kept as
// the first one's records standing for them all, so a cohort draws a tube per
// route rather than per haplotype. The reference stays a tube of its own.
export function bundleRoutes(graph: Graph): Graph {
  const paths = graph.paths ?? []
  const steps = pathSteps(graph)
  const routes = new Map<string, string[]>()
  paths.forEach((path, i) => {
    const walk = pathOrigin(path.name).name
    const route = steps[i]!.map(s => `${s.node.id}${s.strand}`).join(',')
    const pieces = routes.get(walk)
    if (pieces) {
      pieces.push(route)
    } else {
      routes.set(walk, [route])
    }
  })
  const bundles = new Map<string, string[]>()
  for (const [walk, pieces] of routes) {
    const key = walk === graph.referencePath ? `\0${walk}` : pieces.join('|')
    const walks = bundles.get(key)
    if (walks) {
      walks.push(walk)
    } else {
      bundles.set(key, [walk])
    }
  }
  if (bundles.size === routes.size) {
    return graph
  }
  const membersOf = new Map([...bundles.values()].map(w => [w[0]!, w]))
  const kept = paths.flatMap(path => {
    const members = membersOf.get(pathOrigin(path.name).name)
    return members ? [members.length > 1 ? { ...path, members } : path] : []
  })
  return {
    ...graph,
    paths: kept,
    anchorPaths: graph.anchorPaths?.filter(p => membersOf.has(p.name)),
    pathVisits: graph.pathVisits
      ? new Map(
          [...graph.pathVisits].map(([segment, visits]) => [
            segment,
            visits.filter(v => membersOf.has(v.path)),
          ]),
        )
      : undefined,
  }
}
