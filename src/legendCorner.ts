import type { Box } from './overlayLabels'
import type { NodeSegment } from './types'
import type { AxisScale } from './util/geometry'

export const LEGEND_INSET_PX = 6

// The key sits top right, the one corner the row labels (left edge) and the
// hover tooltip (bottom right) leave free, unless the drawing runs under it
// there and leaves the bottom left clear
export type LegendCorner = 'top-right' | 'bottom-left'

export interface LegendFrame {
  paneWidth: number
  canvasHeight: number
  legendSize: { width: number; height: number }
  referenceStripZonePx?: number
}

export interface LegendCornerSource extends LegendFrame {
  axisScale: AxisScale
  translateX: number
  translateY: number
  nodePositions?: Record<string, NodeSegment[]>
  drawnRowLabels: { label: string; y: number }[]
  // false where the drawing is not the nodes' lines (the tube map), whose
  // ink they cannot measure
  labelsNodeSizes: boolean
}

// The pane px a key in `corner` covers, out to the pane's edges it touches
export function legendBox(corner: LegendCorner, m: LegendFrame) {
  const { width, height } = m.legendSize
  return corner === 'top-right'
    ? {
        x0: m.paneWidth - LEGEND_INSET_PX - width,
        x1: m.paneWidth,
        y0: 0,
        y1: (m.referenceStripZonePx ?? 0) + LEGEND_INSET_PX + height,
      }
    : {
        x0: 0,
        x1: LEGEND_INSET_PX + width,
        y0: m.canvasHeight - LEGEND_INSET_PX - height,
        y1: m.canvasHeight,
      }
}

// The part of a-b inside `box`, as the fraction of a-b from Liang-Barsky
// clipping. The fraction survives an affine map, so the clip runs in layout
// units and only the length scales.
function clippedFraction(a: NodeSegment, b: NodeSegment, box: Box) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let enter = 0
  let leave = 1
  for (const [p, q] of [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) {
        leave = 0
      }
    } else if (p < 0) {
      enter = Math.max(enter, q / p)
    } else {
      leave = Math.min(leave, q / p)
    }
  }
  return Math.max(0, leave - enter)
}

// The screen px of node line inside `box`
export function inkUnder(box: Box, m: LegendCornerSource) {
  const { scaleX, scaleY } = m.axisScale
  const layoutBox = {
    x0: (box.x0 - m.translateX) / scaleX,
    x1: (box.x1 - m.translateX) / scaleX,
    y0: (box.y0 - m.translateY) / scaleY,
    y1: (box.y1 - m.translateY) / scaleY,
  }
  let ink = 0
  for (const points of Object.values(m.nodePositions ?? {})) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!
      const b = points[i]!
      const outside =
        (a.x < layoutBox.x0 && b.x < layoutBox.x0) ||
        (a.x > layoutBox.x1 && b.x > layoutBox.x1) ||
        (a.y < layoutBox.y0 && b.y < layoutBox.y0) ||
        (a.y > layoutBox.y1 && b.y > layoutBox.y1)
      if (!outside) {
        ink +=
          clippedFraction(a, b, layoutBox) *
          Math.hypot((b.x - a.x) * scaleX, (b.y - a.y) * scaleY)
      }
    }
  }
  return ink
}

// Row labels own the left edge, so a row layout keeps the key top right. A
// bottom left with any ink in it would trade one covered piece for another.
export function legendCorner(m: LegendCornerSource) {
  const measured =
    m.legendSize.width > 0 && m.drawnRowLabels.length === 0 && m.labelsNodeSizes
  return measured &&
    inkUnder(legendBox('top-right', m), m) > 0 &&
    inkUnder(legendBox('bottom-left', m), m) === 0
    ? 'bottom-left'
    : 'top-right'
}
