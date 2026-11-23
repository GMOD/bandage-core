import { passesUncounted, walksPx } from './nodeWidths'

import type { Graph } from './types'

// How thick a link draws: by the passes the walks make along it, on the scale
// of nodes by walks, or uniform. One table drives the persisted enum and the
// dropdown, as NODE_WIDTHS does.
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
      'As thick as the passes the walks make along a link, on the linear scale of nodes by walks, so the thicknesses at a fork add up. Uniform while a walk holds nodes not loaded, and in a graph without walks.',
  },
] as const

export type EdgeWidth = (typeof EDGE_WIDTHS)[number]['value']

export const drawnEdgeWidth = (graph: Graph, edgeWidth: EdgeWidth) =>
  edgeWidth === 'walks' && (!graph.paths?.length || passesUncounted(graph))
    ? 'uniform'
    : edgeWidth

// A link's width in px: its passes at `perPass` px under `walks`, else the
// connector thickness
export const linkWidthPx = (
  passes: number,
  perPass: number,
  edgeWidth: EdgeWidth,
  connectorThickness: number,
) =>
  edgeWidth === 'walks' && perPass > 0
    ? walksPx(passes, perPass)
    : connectorThickness
