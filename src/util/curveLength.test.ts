import { cubicLengthPx } from './curveLength'
import { curvePointAt } from './geometry'

import type { BezierCurve } from './geometry'

interface P {
  x: number
  y: number
}

const cubic = (p0: P, p1: P, p2: P, p3: P): BezierCurve => ({
  x0: p0.x,
  y0: p0.y,
  cx0: p1.x,
  cy0: p1.y,
  cx1: p2.x,
  cy1: p2.y,
  x1: p3.x,
  y1: p3.y,
})

// the quadratic through q0, q1, q2 as the cubic that draws it
const raised = (q0: P, q1: P, q2: P) =>
  cubic(
    q0,
    { x: q0.x + (2 / 3) * (q1.x - q0.x), y: q0.y + (2 / 3) * (q1.y - q0.y) },
    { x: q2.x + (2 / 3) * (q1.x - q2.x), y: q2.y + (2 / 3) * (q1.y - q2.y) },
    q2,
  )

// a quadratic's length in closed form: twice the integral of the root of
// at^2 + bt + c from 0 to 1
function quadraticLength(q0: P, q1: P, q2: P) {
  const ax = q0.x - 2 * q1.x + q2.x
  const ay = q0.y - 2 * q1.y + q2.y
  const bx = q1.x - q0.x
  const by = q1.y - q0.y
  const a = ax * ax + ay * ay
  const b = 2 * (ax * bx + ay * by)
  const c = bx * bx + by * by
  const antiderivative = (t: number) => {
    const root = Math.sqrt(a * t * t + b * t + c)
    return (
      ((2 * a * t + b) * root) / (4 * a) +
      ((4 * a * c - b * b) / (8 * a * Math.sqrt(a))) *
        Math.log(2 * Math.sqrt(a) * root + 2 * a * t + b)
    )
  }
  return 2 * (antiderivative(1) - antiderivative(0))
}

const chordsPx = (c: BezierCurve, n: number, scaleX = 1, scaleY = 1) => {
  let px = 0
  let last = curvePointAt(c, 0)
  for (let k = 1; k <= n; k++) {
    const p = curvePointAt(c, k / n)
    px += Math.hypot((p.x - last.x) * scaleX, (p.y - last.y) * scaleY)
    last = p
  }
  return px
}

// chords' error falls as the square of their count, which Richardson's
// extrapolation takes out of two counts
const fineLengthPx = (c: BezierCurve, scaleX = 1, scaleY = 1) =>
  (4 * chordsPx(c, 1 << 17, scaleX, scaleY) -
    chordsPx(c, 1 << 16, scaleX, scaleY)) /
  3

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const relative = (got: number, want: number) => Math.abs(got - want) / want

test('a quadratic drawn as a cubic is as long as its closed form says, to a relative 1e-12', () => {
  const random = seeded(7)
  const point = () => ({ x: random() * 200 - 100, y: random() * 200 - 100 })
  let worst = 0
  for (let i = 0; i < 500; i++) {
    const [q0, q1, q2] = [point(), point(), point()]
    worst = Math.max(
      worst,
      relative(
        cubicLengthPx(raised(q0, q1, q2), 1, 1),
        quadraticLength(q0, q1, q2),
      ),
    )
  }
  expect(worst).toBeLessThan(1e-12)
})

test('any cubic, at any scale on either axis, is as long as a fine chord sum says, to a relative 1e-10', () => {
  const random = seeded(11)
  const point = () => ({ x: random() * 50 - 25, y: random() * 50 - 25 })
  let worst = 0
  for (let i = 0; i < 200; i++) {
    const c = cubic(point(), point(), point(), point())
    const scaleX = 10 ** (random() * 4 - 3)
    const scaleY = random() < 0.5 ? scaleX : 10 ** (random() * 4 - 3)
    worst = Math.max(
      worst,
      relative(
        cubicLengthPx(c, scaleX, scaleY),
        fineLengthPx(c, scaleX, scaleY),
      ),
    )
  }
  expect(worst).toBeLessThan(1e-10)
})

test('a cubic stopping at a cusp, a loop and a straight run with uneven speed are measured to a relative 1e-10', () => {
  const cusp = cubic(
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  )
  expect(
    relative(cubicLengthPx(cusp, 1, 1), chordsPx(cusp, 1 << 20)),
  ).toBeLessThan(1e-10)
  const loop = cubic(
    { x: 0, y: 0 },
    { x: 4, y: 3 },
    { x: -2, y: 3 },
    { x: 2, y: 0 },
  )
  expect(
    relative(cubicLengthPx(loop, 3, 3), fineLengthPx(loop, 3, 3)),
  ).toBeLessThan(1e-10)
  const straight = cubic(
    { x: 0, y: 0 },
    { x: 0.1, y: 0 },
    { x: 0.2, y: 0 },
    { x: 10, y: 0 },
  )
  expect(relative(cubicLengthPx(straight, 2, 5), 20)).toBeLessThan(1e-12)
  expect(
    cubicLengthPx(
      cubic({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }),
      1,
      1,
    ),
  ).toBe(0)
})

test('eight chords come short of a curved link by more than the quadrature is off', () => {
  const link = cubic(
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 20 },
    { x: 10, y: 20 },
  )
  const exact = fineLengthPx(link)
  expect(relative(chordsPx(link, 8), exact)).toBeGreaterThan(1e-4)
  expect(relative(cubicLengthPx(link, 1, 1), exact)).toBeLessThan(1e-10)
})
