import type { FitSize } from './layout/fitAssumptions'

export const LEGEND_INSET_PX = 6

export interface KeyFrame {
  paneWidth: number
  canvasHeight: number
  legendSize: { width: number; height: number }
  referenceStripZonePx?: number
}

// The key takes a column of its own down the pane's right edge, its width and
// an inset either side, so at the fit neither the drawing nor a walk row nor a
// readout runs under it. The fit and the rows take the pane less this column;
// a pane too narrow for both keeps the key whole and shrinks the drawing. A
// pan or zoom may draw under it, and the key keys that too (keyedView).
export function keyColumnPx({ legendSize }: Pick<KeyFrame, 'legendSize'>) {
  return legendSize.width > 0 ? legendSize.width + 2 * LEGEND_INSET_PX : 0
}

// The pane a host fits its drawing into, and sizes its force layout for: the
// pane less the key's column, so no node or gene pin lies under the key
export function fitBesideKey(
  m: Pick<KeyFrame, 'paneWidth' | 'canvasHeight' | 'legendSize'>,
) {
  return {
    width: m.paneWidth - keyColumnPx(m),
    height: m.canvasHeight,
  } satisfies FitSize
}

// The pane px the key's column covers, top to bottom
export function keyColumnBox(m: KeyFrame) {
  return {
    x0: m.paneWidth - keyColumnPx(m),
    x1: m.paneWidth,
    y0: 0,
    y1: m.canvasHeight,
  }
}

// The pane height that shows every row of the key: the key, an inset above
// and below, and the reference strip over it
export function keyHeightPx(
  m: Pick<KeyFrame, 'legendSize' | 'referenceStripZonePx'>,
) {
  return m.legendSize.height > 0
    ? m.legendSize.height + 2 * LEGEND_INSET_PX + (m.referenceStripZonePx ?? 0)
    : 0
}
