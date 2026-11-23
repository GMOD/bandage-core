import {
  backboneNodes,
  backbonePositions,
  overlapsWindow,
} from '../anchoredNodes'
import { ROW_HEIGHT_PX } from './rowSpacing'
import { barEnd, readoutRoomPx, walkRowReadoutParts } from './walkRowDraw'
import { walkRows } from './walkRows'

import type { Graph, LayoutResult, RowLabel } from '../types'
import type { RowPitch, WalkRowsWithCalls } from './walkRowDraw'
import type { WalkRows } from './walkRows'

// The reference walk as the backbone on row 0, at its bp, and a row per other
// walk below it. The rows themselves are not nodes: a node the renderer draws
// once cannot sit on nine rows, so WalkRowsOverlay draws each walk's bar from
// `walkRows`, and this layout only reserves the rows and states how far the
// bars reach so the fit and the pane height include them.
// The fit leaves this much past the longest bar for its readout and the legend.
export const READOUT_ROOM = 1.3

export function longestBar(walks: WalkRows) {
  return walks.rows.reduce(
    (most, row) => Math.max(most, barEnd(row)),
    barEnd(walks.reference),
  )
}

export interface ReadoutFit {
  // px from the bars' start to the right edge the readouts end at
  widthPx: number
  measure?: (text: string) => number
  comparing?: boolean
}

// How far the bars must reach for every row's readout to be drawn whole
// beside its bar in `fit.widthPx`, as walkRowReadoutAt draws it, the bars
// keeping at least a quarter of the width
function readableReach(
  walks: WalkRowsWithCalls,
  rowPx: number,
  fit: ReadoutFit,
) {
  const { widthPx } = fit
  return [walks.reference, ...walks.rows].reduce((most, _, i) => {
    const { row, base, suffix } = walkRowReadoutParts(walks, i, fit.comparing)
    const room = readoutRoomPx(`${base}${suffix}`, rowPx, fit.measure)
    return Math.max(
      most,
      (barEnd(row) * widthPx) / Math.max(widthPx - room, widthPx / 4),
    )
  }, 0)
}

// How far the bars reach, so the fit and the pane height include them. The
// model reads it again for the bars it actually draws, which a repeat pick or
// a sample filter can narrow after this layout ran, at the pitch they draw at.
// A host that knows its width passes `fit`, and the bars then leave room for
// every readout whole.
export function walkRowsExtent(
  walks: WalkRowsWithCalls,
  pitch: Pick<RowPitch, 'rowPx' | 'readouts'> = {
    rowPx: ROW_HEIGHT_PX,
    readouts: true,
  },
  fit?: ReadoutFit,
) {
  const readable =
    pitch.readouts && fit ? readableReach(walks, pitch.rowPx, fit) : 0
  return {
    maxX:
      walks.origin +
      Math.max(
        readable,
        longestBar(walks) * (pitch.readouts ? READOUT_ROOM : 1),
      ),
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
  const walks = walkRows(graph, region)
  return walks && walkRowLayoutOf(graph, walks, region)
}

// walkRowLayout over rows already made
export function walkRowLayoutOf(
  graph: Graph,
  walks: WalkRows,
  region?: { start: number; end: number },
): LayoutResult | undefined {
  const backbone = backboneNodes(graph)
  if (backbone.length === 0) {
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
  return {
    nodePositions,
    rowLabels: walkRowLabels(walks),
    referenceAxis: true,
    pixelRows: true,
    extent: walkRowsExtent(walks),
  }
}
