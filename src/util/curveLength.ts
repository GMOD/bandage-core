import type { BezierCurve } from './geometry'

// Eight-point Gauss-Legendre quadrature on [-1, 1], its abscissae in
// symmetric pairs and the weight each pair shares
const ABSCISSAE = [
  0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363,
]
const WEIGHTS = [
  0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
]

// how far the error estimate may come to, as a share of the control polygon,
// which is never shorter than the curve
const TOLERANCE = 1e-10
const MAX_DEPTH = 40

// how fast a cubic runs on screen at t
function speedOf(c: BezierCurve, scaleX: number, scaleY: number) {
  const ax = 3 * (c.cx0 - c.x0) * scaleX
  const bx = 3 * (c.cx1 - c.cx0) * scaleX
  const dx = 3 * (c.x1 - c.cx1) * scaleX
  const ay = 3 * (c.cy0 - c.y0) * scaleY
  const by = 3 * (c.cy1 - c.cy0) * scaleY
  const dy = 3 * (c.y1 - c.cy1) * scaleY
  return (t: number) => {
    const u = 1 - t
    const a = u * u
    const b = 2 * u * t
    const d = t * t
    return Math.hypot(a * ax + b * bx + d * dx, a * ay + b * by + d * dy)
  }
}

function gaussLegendre(speed: (t: number) => number, from: number, to: number) {
  const half = (to - from) / 2
  const mid = (from + to) / 2
  let sum = 0
  for (let i = 0; i < ABSCISSAE.length; i++) {
    const x = half * ABSCISSAE[i]!
    sum += WEIGHTS[i]! * (speed(mid - x) + speed(mid + x))
  }
  return sum * half
}

function adaptive(
  speed: (t: number) => number,
  from: number,
  to: number,
  whole: number,
  tolerance: number,
  depth: number,
): number {
  const mid = (from + to) / 2
  const left = gaussLegendre(speed, from, mid)
  const right = gaussLegendre(speed, mid, to)
  return depth >= MAX_DEPTH || Math.abs(left + right - whole) <= tolerance
    ? left + right
    : adaptive(speed, from, mid, left, tolerance / 2, depth + 1) +
        adaptive(speed, mid, to, right, tolerance / 2, depth + 1)
}

// A cubic's length on screen, each axis at its own scale: its speed
// integrated by Gauss-Legendre quadrature, halving each stretch until the
// halves agree with the whole
export function cubicLengthPx(c: BezierCurve, scaleX: number, scaleY: number) {
  const leg = (x0: number, y0: number, x1: number, y1: number) =>
    Math.hypot((x1 - x0) * scaleX, (y1 - y0) * scaleY)
  const polygon =
    leg(c.x0, c.y0, c.cx0, c.cy0) +
    leg(c.cx0, c.cy0, c.cx1, c.cy1) +
    leg(c.cx1, c.cy1, c.x1, c.y1)
  const speed = speedOf(c, scaleX, scaleY)
  return adaptive(
    speed,
    0,
    1,
    gaussLegendre(speed, 0, 1),
    TOLERANCE * polygon,
    0,
  )
}
