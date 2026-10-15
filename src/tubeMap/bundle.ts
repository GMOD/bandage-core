import { pathSteps } from '../layout/tubeMapLayout'
import { pathOrigin } from '../pathAnchoring'
import { pushTo } from '../util/groups'

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
  const piecesOf = new Map<string, number[]>()
  paths.forEach((path, i) => {
    pushTo(piecesOf, pathOrigin(path.name).name, i)
  })
  const routeOf = (i: number) =>
    steps[i]!.map(s => `${s.node.id}${s.strand}`).join(',')
  const recordsOf = (walk: string) => piecesOf.get(walk)!.map(i => paths[i]!)
  const routeRank = new Map<string, number>()
  const bundles = new Map<
    string,
    { rank: number; group: string; walks: string[] }
  >()
  for (const [walk, pieces] of piecesOf) {
    const route =
      walk === graph.referencePath ? `\0${walk}` : pieces.map(routeOf).join('|')
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
  if (merge && bundles.size === piecesOf.size) {
    return graph
  }
  const ordered = [...bundles.values()].sort(
    (a, b) => a.rank - b.rank || a.group.localeCompare(b.group),
  )
  if (!merge) {
    return {
      ...graph,
      paths: ordered.flatMap(({ walks }) => walks.flatMap(recordsOf)),
    }
  }
  const kept = ordered.flatMap(({ walks }) =>
    recordsOf(walks[0]!).map(path =>
      walks.length > 1 ? { ...path, members: walks } : path,
    ),
  )
  const keptWalks = new Set(ordered.map(b => b.walks[0]!))
  return {
    ...graph,
    paths: kept,
    anchorPaths: graph.anchorPaths?.filter(p => keptWalks.has(p.name)),
    pathVisits: graph.pathVisits?.filter(path => keptWalks.has(path)),
  }
}
