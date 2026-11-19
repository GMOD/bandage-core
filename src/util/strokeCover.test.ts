import { curvePointAt } from './geometry'
import { flattenedPx, pointInStroke, segmentInStroke } from './strokeCover'

const line = (...xs: [number, number][]) => xs.map(([x, y]) => ({ x, y }))
const at = (x: number, y: number) => ({ x, y })

test('a segment lies in a stroke when every point of it is within the half-width of its lines or points', () => {
  const stroke = { lines: [line([0, 0], [10, 0])], points: [], halfWidth: 3 }
  expect(segmentInStroke(at(1, 2.9), at(9, -2.9), stroke)).toBe(true)
  expect(segmentInStroke(at(1, 2.9), at(9, 3.1), stroke)).toBe(false)
  expect(segmentInStroke(at(-2, 2), at(12, -2), stroke)).toBe(true)
  expect(segmentInStroke(at(-2.5, 2), at(5, 0), stroke)).toBe(false)
  expect(segmentInStroke(at(12, 0), at(14, 0), stroke)).toBe(false)
  expect(pointInStroke(at(12.9, 0), stroke)).toBe(true)
})

test('a segment lies in a stroke that several lines and points cover between them, though none covers it alone', () => {
  const bent = {
    lines: [line([0, 0], [10, 0]), line([10, 0], [10, 10])],
    points: [],
    halfWidth: 2,
  }
  expect(segmentInStroke(at(7, 0.5), at(10.5, 4), bent)).toBe(true)
  for (const arm of bent.lines) {
    expect(
      segmentInStroke(at(7, 0.5), at(10.5, 4), { ...bent, lines: [arm] }),
    ).toBe(false)
  }
  const apart = {
    lines: [line([0, 0], [4, 0]), line([10, 0], [14, 0])],
    points: [at(7, 0)],
    halfWidth: 1.6,
  }
  expect(segmentInStroke(at(1, 0), at(13, 0), apart)).toBe(true)
  expect(segmentInStroke(at(1, 0), at(13, 0), { ...apart, points: [] })).toBe(
    false,
  )
  expect(
    segmentInStroke(at(1, 0), at(13, 0), { ...apart, halfWidth: 1.4 }),
  ).toBe(false)
})

test('a stroke inset by its whole half-width or more covers nothing', () => {
  const stroke = { lines: [line([0, 0], [10, 0])], points: [], halfWidth: 1 }
  expect(segmentInStroke(at(1, 0), at(2, 0), stroke, 0.5)).toBe(true)
  expect(segmentInStroke(at(1, 0), at(2, 0), stroke, 1.5)).toBe(false)
})

test('a flattened cubic lies within its tolerance of the curve, at any scale on either axis', () => {
  const c = {
    x0: 0,
    y0: 0,
    cx0: 40,
    cy0: 90,
    cx1: -30,
    cy1: 70,
    x1: 25,
    y1: -10,
  }
  const cases: [number, number, number][] = [
    [1, 1, 0.01],
    [0.03, 0.03, 0.01],
    [2, 0.5, 0.001],
  ]
  for (const [scaleX, scaleY, tolerance] of cases) {
    const flat = flattenedPx(c, scaleX, scaleY, tolerance)
    let worst = 0
    for (let k = 0; k <= 4000; k++) {
      const t = k / 4000
      const p = curvePointAt(c, t)
      const i = Math.min(Math.floor(t * (flat.length - 1)), flat.length - 2)
      const s = t * (flat.length - 1) - i
      const a = flat[i]!
      const b = flat[i + 1]!
      const lerp = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s }
      worst = Math.max(
        worst,
        Math.hypot(p.x * scaleX - lerp.x, p.y * scaleY - lerp.y),
      )
    }
    expect(worst).toBeLessThanOrEqual(tolerance)
    expect(flat[0]).toEqual({ x: 0, y: 0 })
    expect(flat.at(-1)?.x).toBeCloseTo(25 * scaleX, 12)
  }
})
