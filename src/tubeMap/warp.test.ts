import { referenceKnots, warpX } from './warp'

import type { TubeMapColumn } from '../layout/tubeMapLayout'

// Three reference columns of 100 bp with a 40 tube px gap between each, and a
// column of inserted sequence in the second gap.
const COLUMNS: TubeMapColumn[] = [
  { order: 0, x0: 0, x1: 20, bp0: 1000, bp1: 1100 },
  { order: 1, x0: 60, x1: 80, bp0: 1100, bp1: 1200 },
  { order: 2, x0: 100, x1: 110, bp0: 1200, bp1: 1200 },
  { order: 3, x0: 150, x1: 170, bp0: 1200, bp1: 1300 },
]

const at = (bpPerPx: number) => (bp: number) => (bp - 1000) / bpPerPx

function monotone(knots: { tx: number; sx: number }[]) {
  for (let i = 1; i < knots.length; i++) {
    expect(knots[i]!.tx).toBeGreaterThanOrEqual(knots[i - 1]!.tx)
    expect(knots[i]!.sx).toBeGreaterThanOrEqual(knots[i - 1]!.sx)
  }
}

test('zoomed in, a column keeps its bp and gives up a gap at each boundary', () => {
  const knots = referenceKnots(COLUMNS, at(0.1))
  monotone(knots)
  expect(warpX(knots, 0)).toBe(0)
  expect(warpX(knots, 170)).toBe(3000)
  // the first gap's 40 tube px, capped at 24 and taken half from each side of
  // the boundary
  expect(warpX(knots, 20)).toBe(988)
  expect(warpX(knots, 60)).toBe(1012)
  // the inserted column and both of its gaps share the second boundary's 24
  expect(warpX(knots, 150) - warpX(knots, 80)).toBe(24)
})

test('zoomed out, the gaps share half the screen', () => {
  const knots = referenceKnots(COLUMNS, at(10))
  monotone(knots)
  expect(warpX(knots, 0)).toBe(0)
  expect(warpX(knots, 170)).toBe(30)
  expect(warpX(knots, 60) - warpX(knots, 20)).toBe(7.5)
  expect(warpX(knots, 150) - warpX(knots, 80)).toBe(7.5)
})

test('a run of columns a few bp wide slides apart into the wide columns either side', () => {
  // C4's two reference nodes of 6 and 23 bp between two of thousands
  const thin: TubeMapColumn[] = [
    { order: 0, x0: 0, x1: 20, bp0: 0, bp1: 20000 },
    { order: 1, x0: 60, x1: 80, bp0: 20000, bp1: 20006 },
    { order: 2, x0: 120, x1: 140, bp0: 20006, bp1: 20029 },
    { order: 3, x0: 180, x1: 200, bp0: 20029, bp1: 26000 },
  ]
  const knots = referenceKnots(thin, at(50))
  monotone(knots)
  for (const [left, right] of [
    [20, 60],
    [80, 120],
    [140, 180],
  ] as const) {
    expect(warpX(knots, right) - warpX(knots, left)).toBeCloseTo(24)
  }
})

test('reference no column covers is room for the gap first', () => {
  const apart: TubeMapColumn[] = [
    { order: 0, x0: 0, x1: 20, bp0: 1000, bp1: 1100 },
    { order: 1, x0: 60, x1: 80, bp0: 1500, bp1: 1600 },
  ]
  const knots = referenceKnots(apart, at(1))
  expect(warpX(knots, 20)).toBe(100)
  expect(warpX(knots, 60)).toBe(500)
})

test('past either end the drawing runs at one px per tube px', () => {
  const knots = referenceKnots(COLUMNS, at(1))
  expect(warpX(knots, -20)).toBe(warpX(knots, 0) - 20)
  expect(warpX(knots, 190)).toBe(warpX(knots, 170) + 20)
})
