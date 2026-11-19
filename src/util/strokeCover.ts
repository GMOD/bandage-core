import type { BezierCurve } from './geometry'

interface Point {
  x: number
  y: number
}

// A stroke on screen: lines and points, each widened by the same half-width,
// as a round-capped, round-joined stroke draws them
export interface Stroke {
  lines: readonly (readonly Point[])[]
  points: readonly Point[]
  halfWidth: number
}

type Interval = readonly [number, number]

const clipped = (from: number, to: number): Interval | undefined => {
  const lo = Math.max(0, from)
  const hi = Math.min(1, to)
  return lo <= hi ? [lo, hi] : undefined
}

// where on p→q, as its parameter, a + b t lies within [lo, hi]
function linearWithin(a: number, b: number, lo: number, hi: number) {
  return b === 0
    ? a >= lo && a <= hi
      ? clipped(0, 1)
      : undefined
    : clipped(
        Math.min((lo - a) / b, (hi - a) / b),
        Math.max((lo - a) / b, (hi - a) / b),
      )
}

const both = (a: Interval | undefined, b: Interval | undefined) =>
  a && b ? clipped(Math.max(a[0], b[0]), Math.min(a[1], b[1])) : undefined

// where on p→q lies within h of c
function nearPoint(p: Point, q: Point, c: Point, h: number) {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const fx = p.x - c.x
  const fy = p.y - c.y
  const a = dx * dx + dy * dy
  const b = 2 * (fx * dx + fy * dy)
  const k = fx * fx + fy * fy - h * h
  const discriminant = b * b - 4 * a * k
  return a === 0
    ? k <= 0
      ? clipped(0, 1)
      : undefined
    : discriminant < 0
      ? undefined
      : clipped(
          (-b - Math.sqrt(discriminant)) / (2 * a),
          (-b + Math.sqrt(discriminant)) / (2 * a),
        )
}

// where on p→q lies within h of the segment a→b: within h of either end, or
// beside the segment and within h of its line, which together make one
// interval, the stroke round a segment being convex
function nearSegment(p: Point, q: Point, a: Point, b: Point, h: number) {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const ux = length > 0 ? (b.x - a.x) / length : 0
  const uy = length > 0 ? (b.y - a.y) / length : 0
  const fx = p.x - a.x
  const fy = p.y - a.y
  const dx = q.x - p.x
  const dy = q.y - p.y
  const beside =
    length > 0
      ? both(
          linearWithin(fx * ux + fy * uy, dx * ux + dy * uy, 0, length),
          linearWithin(fx * uy - fy * ux, dx * uy - dy * ux, -h, h),
        )
      : undefined
  const parts = [nearPoint(p, q, a, h), nearPoint(p, q, b, h), beside].filter(
    (part): part is Interval => part !== undefined,
  )
  return parts.length > 0
    ? clipped(
        parts.reduce((lo, part) => Math.min(lo, part[0]), 1),
        parts.reduce((hi, part) => Math.max(hi, part[1]), 0),
      )
    : undefined
}

const SEAM = 1e-9

// whether every point of p→q lies inside the stroke, at `inset` less than its
// half-width
export function segmentInStroke(p: Point, q: Point, stroke: Stroke, inset = 0) {
  const h = stroke.halfWidth - inset
  const covers: Interval[] = []
  for (const line of stroke.lines) {
    for (let i = 1; i < line.length; i++) {
      const part = nearSegment(p, q, line[i - 1]!, line[i]!, h)
      if (part) {
        covers.push(part)
      }
    }
    const only = line.length === 1 ? nearPoint(p, q, line[0]!, h) : undefined
    if (only) {
      covers.push(only)
    }
  }
  for (const point of stroke.points) {
    const part = nearPoint(p, q, point, h)
    if (part) {
      covers.push(part)
    }
  }
  covers.sort((a, b) => a[0] - b[0])
  let reach = 0
  for (const [from, to] of covers) {
    reach = from <= reach + SEAM ? Math.max(reach, to) : reach
  }
  return h >= 0 && reach >= 1 - SEAM
}

// whether p lies inside the stroke
export const pointInStroke = (p: Point, stroke: Stroke) =>
  segmentInStroke(p, p, stroke)

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
  const x0 = c.x0 * scaleX
  const x1 = c.cx0 * scaleX
  const x2 = c.cx1 * scaleX
  const x3 = c.x1 * scaleX
  const y0 = c.y0 * scaleY
  const y1 = c.cy0 * scaleY
  const y2 = c.cy1 * scaleY
  const y3 = c.y1 * scaleY
  const bend = Math.max(
    Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2),
    Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3),
  )
  const n = Math.max(1, Math.ceil(Math.sqrt((0.75 * bend) / tolerance)))
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const d = 3 * u * t * t
    const e = t * t * t
    return {
      x: a * x0 + b * x1 + d * x2 + e * x3,
      y: a * y0 + b * y1 + d * y2 + e * y3,
    }
  })
}
