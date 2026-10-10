import { pathSteps } from '../layout/tubeMapLayout'
import { pathOrigin } from '../pathAnchoring'

import type { Graph } from '../types'

// The walks that take one route, step for step and strand for strand, kept as
// the first one's records standing for them all, so a cohort draws a tube per
// route rather than per haplotype. The reference stays a tube of its own.
// `groupOf` splits a route's walks by a value of theirs, such as a sample's
// population, and those strands sit side by side, so a route reads as a stack
// of its groups.
// With `merge` false every walk keeps its tube, ordered route by route.
export function bundleRoutes(
  graph: Graph,
  groupOf: (walk: string) => string = () => '',
  merge = true,
): Graph {
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
  const routeRank = new Map<string, number>()
  const bundles = new Map<
    string,
    { rank: number; group: string; walks: string[] }
  >()
  for (const [walk, pieces] of routes) {
    const route = walk === graph.referencePath ? `\0${walk}` : pieces.join('|')
    const group = groupOf(walk)
    const rank = routeRank.get(route) ?? routeRank.size
    routeRank.set(route, rank)
    const key = `${route}\t${group}`
    const bundle = bundles.get(key)
    if (bundle) {
      bundle.walks.push(walk)
    } else {
      bundles.set(key, { rank, group, walks: [walk] })
    }
  }
  if (merge && bundles.size === routes.size) {
    return graph
  }
  const ordered = [...bundles.values()].sort(
    (a, b) => a.rank - b.rank || a.group.localeCompare(b.group),
  )
  const recordsOf = new Map<string, typeof paths>()
  for (const path of paths) {
    const walk = pathOrigin(path.name).name
    const records = recordsOf.get(walk)
    if (records) {
      records.push(path)
    } else {
      recordsOf.set(walk, [path])
    }
  }
  if (!merge) {
    return {
      ...graph,
      paths: ordered.flatMap(({ walks }) =>
        walks.flatMap(walk => recordsOf.get(walk)!),
      ),
    }
  }
  const kept = ordered.flatMap(({ walks }) =>
    recordsOf
      .get(walks[0]!)!
      .map(path => (walks.length > 1 ? { ...path, members: walks } : path)),
  )
  const keptWalks = new Set(ordered.map(b => b.walks[0]!))
  return {
    ...graph,
    paths: kept,
    anchorPaths: graph.anchorPaths?.filter(p => keptWalks.has(p.name)),
    pathVisits: graph.pathVisits?.filter(path => keptWalks.has(path)),
  }
}
