import { parseRegion } from './gbzCut'

test('a region reads its bounds, commas and all', () => {
  expect(parseRegion(' chr6:160,614,798-160,647,758 ')).toEqual({
    refName: 'chr6',
    start: 160_614_798,
    end: 160_647_758,
  })
})

test('a region that ends at or before its start is refused', () => {
  expect(() => parseRegion('chr1:100-50')).toThrow('ends at or before')
  expect(() => parseRegion('chr1:100-100')).toThrow('ends at or before')
})
