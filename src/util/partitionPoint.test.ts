import { partitionPoint } from './partitionPoint'

test('finds the first index where the predicate turns false', () => {
  const xs = [1, 2, 2, 2, 5]
  const below = (x: number) => partitionPoint(xs.length, i => xs[i]! < x)
  const atMost = (x: number) => partitionPoint(xs.length, i => xs[i]! <= x)
  expect([0, 1, 2, 3, 5, 6].map(below)).toEqual([0, 0, 1, 4, 4, 5])
  expect([0, 1, 2, 3, 5, 6].map(atMost)).toEqual([0, 1, 4, 4, 5, 5])
  expect(partitionPoint(0, () => true)).toBe(0)
})
