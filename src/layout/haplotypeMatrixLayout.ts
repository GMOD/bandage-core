import { ROW_HEIGHT_PX } from './rowSpacing'
import { bubblesFromGraph } from '../bubbles/bubblesFromGraph'
import { haplotypeMatrix } from '../bubbles/haplotypeMatrix'

import type { Graph, LayoutResult } from '../types'

// A row per walk, a column per site, the columns evenly spaced one layout unit
// apart rather than at their bp: a KIV-2 cut holds twenty SNPs in 1.5 kb beside
// a 30 kb array, and at bp the SNPs would share a few px. The matrix overlay
// draws every cell and ties each column back to its bp; the canvas draws no
// nodes.
export function haplotypeMatrixLayout(graph: Graph): LayoutResult | undefined {
  const matrix = haplotypeMatrix(graph, bubblesFromGraph(graph))
  if (!matrix) {
    return undefined
  }
  const half = ROW_HEIGHT_PX / 2
  return {
    nodePositions: {},
    rowLabels: matrix.rows.map((row, i) => ({
      label: row.label,
      y: i * ROW_HEIGHT_PX,
    })),
    pixelRows: true,
    extent: {
      minX: 0,
      minY: -half,
      maxX: Math.max(1, matrix.columns.length),
      maxY: (matrix.rows.length - 1) * ROW_HEIGHT_PX + half,
    },
    matrix,
  }
}
