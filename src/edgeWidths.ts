import { passesUncounted, walksPx } from './nodeWidths'

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
      'As thick as the walks taking a link, on the linear scale nodes by walks are drawn on, so the thicknesses at a fork add up. Uniform while a walk holds nodes not loaded, and in a graph without walks.',
  },
] as const

export type EdgeWidth = (typeof EDGE_WIDTHS)[number]['value']

// What a link width setting draws on a graph: `walks` counts the walks on
// links only where the graph has walks and every pass of them is loaded
export function drawnEdgeWidth(graph: Graph, edgeWidth: EdgeWidth): EdgeWidth {
  return edgeWidth === 'walks' &&
    (!graph.paths?.length || passesUncounted(graph))
    ? 'uniform'
    : edgeWidth
}

// A link's width in px: under `walks` its walks as a node of as many passes
// draws (nodeWidths.ts walksPx); else the connector thickness
export function linkWidthPx(
  walks: number,
  perPass: number,
  edgeWidth: EdgeWidth,
  connectorThickness: number,
) {
  return edgeWidth === 'walks' && perPass > 0
    ? walksPx(walks, perPass)
    : connectorThickness
}
