import { formatLocus, parseLocus } from './locus'

test('a locus is 1-based and closed, in either range form or as one base', () => {
  const region = { refName: 'chr6', start: 160_614_797, end: 160_647_758 }
  expect(parseLocus('chr6:160,614,798-160,647,758')).toEqual(region)
  expect(parseLocus(' chr6:160614798..160647758 ')).toEqual(region)
  expect(parseLocus('chr6:10')).toEqual({ refName: 'chr6', start: 9, end: 10 })
  expect(formatLocus(region)).toBe('chr6:160,614,798-160,647,758')
})

test('a locus that starts at 0 or ends before it starts reads as none', () => {
  expect(parseLocus('chr6:0-10')).toBeUndefined()
  expect(parseLocus('chr6:20-10')).toBeUndefined()
  expect(parseLocus('chr6')).toBeUndefined()
})
