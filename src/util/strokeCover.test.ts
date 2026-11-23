import { curvePointAt } from './geometry'
import { flattenedPx } from './strokeCover'

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

test('a cubic with a coordinate that is not finite flattens to nothing', () => {
  const c = { x0: 0, y0: 0, cx0: 40, cy0: 90, cx1: -30, cy1: 70, x1: 25, y1: 0 }
  expect(flattenedPx({ ...c, cx0: Infinity }, 1, 1, 0.01)).toEqual([])
  expect(flattenedPx({ ...c, cy1: NaN }, 1, 1, 0.01)).toEqual([])
})
