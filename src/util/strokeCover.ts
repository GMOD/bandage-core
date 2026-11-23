import { curvePointAt } from './geometry'

import type { BezierCurve } from './geometry'

// The cubic on screen as a polyline every point of which is within
// `tolerance` px of the curve and the curve of it: a cubic's second
// derivative is at most six times the larger second difference of its
// control points, and a chord over a parameter step of 1 / n lies within an
// eighth of that over n squared of the curve
export function flattenedPx(
  c: BezierCurve,
  scaleX: number,
  scaleY: number,
  tolerance: number,
) {
  const px = {
    x0: c.x0 * scaleX,
    y0: c.y0 * scaleY,
    cx0: c.cx0 * scaleX,
    cy0: c.cy0 * scaleY,
    cx1: c.cx1 * scaleX,
    cy1: c.cy1 * scaleY,
    x1: c.x1 * scaleX,
    y1: c.y1 * scaleY,
  }
  const bend = Math.max(
    Math.hypot(px.x0 - 2 * px.cx0 + px.cx1, px.y0 - 2 * px.cy0 + px.cy1),
    Math.hypot(px.cx0 - 2 * px.cx1 + px.x1, px.cy0 - 2 * px.cy1 + px.y1),
  )
  const n = Math.max(1, Math.ceil(Math.sqrt((0.75 * bend) / tolerance)))
  return Array.from({ length: Number.isFinite(n) ? n + 1 : 0 }, (_, k) =>
    curvePointAt(px, k / n),
  )
}
