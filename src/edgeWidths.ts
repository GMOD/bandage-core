import type { Graph } from './types'

// How thick a link draws. Node width already says how many walks carry a
// node; a link drawn by its walks says which way they go from it, so a
// common route reads heavy and a private one a hairline, the way a Sankey
// diagram reads, without lifting a walk. One table drives the persisted enum
// and the dropdown, as NODE_WIDTHS does.
export const EDGE_WIDTHS = [
  {
    value: 'uniform',
    label: 'Uniform',
    description: 'Every link the same thickness.',
  },
  {
    value: 'walks',
    label: 'By walks',
    description:
      'Thicker the more walks take a link, on the square root of its count against the busiest link in the cut. A graph without walks draws uniform.',
  },
] as const

export type EdgeWidth = (typeof EDGE_WIDTHS)[number]['value']

const MIN_FACTOR = 0.5
const MAX_FACTOR = 4

// the most walks any one link carries, which the widths scale against
export function busiestEdge(graph: Graph) {
  let most = 0
  for (const edge of graph.edges) {
    most = Math.max(most, edge.pathIds?.length ?? 0)
  }
  return most
}

// A link's width over the connector thickness. A link no walk takes, in a
// cut that has walks, is drawn at the floor, since nothing travels it.
export function edgeWidthFactor(
  walks: number,
  busiest: number,
  edgeWidth: EdgeWidth,
) {
  if (edgeWidth === 'uniform' || busiest === 0) {
    return 1
  }
  return MIN_FACTOR + (MAX_FACTOR - MIN_FACTOR) * Math.sqrt(walks / busiest)
}
