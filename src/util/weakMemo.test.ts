import { weakMemo } from './weakMemo'

test('recomputes when a dep changes, per key', () => {
  const memo = weakMemo<object, number>()
  let calls = 0
  const compute = () => ++calls
  const a = {}
  const b = {}
  expect(memo(a, [1, 'x'], compute)).toBe(1)
  expect(memo(a, [1, 'x'], compute)).toBe(1)
  expect(memo(b, [1, 'x'], compute)).toBe(2)
  expect(memo(a, [2, 'x'], compute)).toBe(3)
  expect(memo(a, [2], compute)).toBe(4)
})
