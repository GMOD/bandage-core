import { ROW_HEIGHT_PX } from './rowSpacing'
import { walkRows } from './walkRows'
import {
  backboneNodes,
  backbonePositions,
  overlapsWindow,
} from '../anchoredNodes'

import type { RowPitch } from './walkRowDraw'
import type { WalkRows } from './walkRows'
import type { Graph, LayoutResult, RowLabel } from '../types'

// The reference walk as the backbone on row 0, at its bp, and a row per other
// walk below it. The rows themselves are not nodes: a node the renderer draws
// once cannot sit on nine rows, so WalkRowsOverlay draws each walk's bar from
// `walkRows`, and this layout only reserves the rows and states how far the
// bars reach so the fit and the pane height include them.
// The fit leaves this much past the longest bar for its readout and the legend.
const READOUT_ROOM = 1.3

// How far the bars reach, so the fit and the pane height include them. The
// model reads it again for the bars it actually draws, which a repeat pick or
// a sample filter can narrow after this layout ran, at the pitch they draw at.
export function walkRowsExtent(
  walks: WalkRows,
  pitch: Pick<RowPitch, 'rowPx' | 'readouts'> = {
    rowPx: ROW_HEIGHT_PX,
    readouts: true,
  },
) {
  let longest = walks.reference.bp
  for (const row of walks.rows) {
    longest = Math.max(longest, row.bp)
  }
  return {
    maxX: walks.origin + longest * (pitch.readouts ? READOUT_ROOM : 1),
    maxY: walks.rows.length * pitch.rowPx,
  }
}

// The label beside each walk row, the reference's first, at the pitch the rows
// are drawn at. A strip packed too dense to label has none, and a layout with
// no rows of its own states its labels itself.
export function walkRowLabels(
  rows: WalkRows | undefined,
  layout?: LayoutResult,
  pitch?: RowPitch,
): RowLabel[] {
  if (!rows) {
    return layout?.rowLabels ?? []
  }
  if (pitch && !pitch.labelled) {
    return []
  }
  return [rows.reference, ...rows.rows].map((row, i) => ({
    label: row.label,
    y: i * (pitch?.rowPx ?? ROW_HEIGHT_PX),
  }))
}

export function walkRowLayout(
  graph: Graph,
  region?: { start: number; end: number },
): LayoutResult | undefined {
  const backbone = backboneNodes(graph)
  const walks = walkRows(graph, region)
  if (backbone.length === 0 || !walks) {
    return undefined
  }
  // The bars start at the window, so row 0 draws only the backbone over it;
  // the cut's context nodes would run left of the bars, under the labels.
  const overWindow = region
    ? backbone.filter(n => overlapsWindow(n, region))
    : backbone
  const nodePositions = backbonePositions(
    overWindow.length > 0 ? overWindow : backbone,
  )
  const rowLabels: RowLabel[] = [
    { label: walks.reference.label, y: 0 },
    ...walks.rows.map((row, i) => ({
      label: row.label,
      y: (i + 1) * ROW_HEIGHT_PX,
    })),
  ]
  return {
    nodePositions,
    rowLabels,
    referenceAxis: true,
    pixelRows: true,
    extent: walkRowsExtent(walks),
  }
}
