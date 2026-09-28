import { referenceWalk, walkLabel } from '../layout/walkRows'

import type { MinigraphBubble } from './bubbleLine'
import type { Graph } from '../types'

// Which route each haplotype takes through each site, the shape a multi-sample
// variant matrix draws: a row per walk, a column per bubble the walks cross by
// more than one route. A derived bubble already records every route with the
// walks that take it (bubblesFromGraph), so this reads the walks' genotypes off
// the graph with no VCF.

export interface MatrixRoute {
  bp: number
  // how many walks take it
  carriers: number
}

export interface MatrixColumn {
  bubble: MinigraphBubble
  // The reference walk's route first, when it crosses the site, then the rest
  // by how many walks take them, so a route's index is its colour
  routes: MatrixRoute[]
  referenceRoute: boolean
}

export interface HaplotypeMatrix {
  // the reference walk first, then each walk after the one it differs from
  // least
  rows: { name: string; label: string }[]
  columns: MatrixColumn[]
  // cells[row][column]: the index of the route that walk takes, or -1 where it
  // does not cross the site inside the cut
  cells: number[][]
}

export const NOT_CROSSED = -1

function distance(a: number[], b: number[]) {
  let d = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      d++
    }
  }
  return d
}

// A chain from the reference, each row the unplaced one nearest the last, so
// haplotypes that share their routes sit together and a block of them reads
// as a block. Ties go to the label, which keeps the order stable.
function chainOrder(cells: number[][], labels: string[]) {
  const rest = labels
    .map((_, i) => i)
    .slice(1)
    .sort((a, b) => labels[a]!.localeCompare(labels[b]!))
  const order = [0]
  let last = 0
  while (rest.length > 0) {
    let best = 0
    let bestDistance = Infinity
    rest.forEach((row, k) => {
      const d = distance(cells[last]!, cells[row]!)
      if (d < bestDistance) {
        bestDistance = d
        best = k
      }
    })
    last = rest.splice(best, 1)[0]!
    order.push(last)
  }
  return order
}

export function haplotypeMatrix(
  graph: Graph,
  bubbles: readonly MinigraphBubble[],
): HaplotypeMatrix | undefined {
  const paths = graph.paths ?? []
  const reference = referenceWalk(graph)
  if (!reference || paths.length < 2) {
    return undefined
  }
  // a cut can hand one walk back in pieces, which share its name
  const labels = new Map([[reference.name, walkLabel(reference)]])
  for (const path of paths) {
    if (!labels.has(path.name)) {
      labels.set(path.name, walkLabel(path))
    }
  }
  const names = [...labels.keys()]

  const sites = bubbles
    .filter(b => (b.routes?.length ?? 0) >= 2)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const routeOf = names.map(() => [] as number[])
  const columns = sites.map(bubble => {
    const routes = bubble.routes!.map(route => ({
      bp: route.bp,
      walks: new Set(route.walks),
    }))
    routes.sort(
      (a, b) =>
        Number(b.walks.has(reference.name)) -
          Number(a.walks.has(reference.name)) ||
        b.walks.size - a.walks.size ||
        a.bp - b.bp,
    )
    names.forEach((name, row) => {
      routeOf[row]!.push(routes.findIndex(r => r.walks.has(name)))
    })
    return {
      bubble,
      routes: routes.map(r => ({ bp: r.bp, carriers: r.walks.size })),
      referenceRoute: routes[0]!.walks.has(reference.name),
    }
  })

  const order = chainOrder(routeOf, [...labels.values()])
  return {
    rows: order.map(row => ({
      name: names[row]!,
      label: labels.get(names[row]!)!,
    })),
    columns,
    cells: order.map(row => routeOf[row]!),
  }
}

// What a route adds or removes against the reference walk's, or against the
// reference span when the reference walk does not cross the site
export function routeDelta(column: MatrixColumn, route: number) {
  const { bubble, routes, referenceRoute } = column
  const referenceBp = referenceRoute ? routes[0]!.bp : bubble.end - bubble.start
  return routes[route]!.bp - referenceBp
}
