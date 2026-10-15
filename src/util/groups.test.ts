import { addTo, groupBy, pushTo } from './groups'

test('pushTo and addTo start a key with its first value', () => {
  const lists = new Map<string, number[]>()
  pushTo(lists, 'a', 1)
  pushTo(lists, 'a', 2, 3)
  pushTo(lists, 'b', 4)
  expect([...lists]).toEqual([
    ['a', [1, 2, 3]],
    ['b', [4]],
  ])
  const sets = new Map<string, Set<number>>()
  addTo(sets, 'a', 1)
  addTo(sets, 'a', 1)
  expect([...sets.get('a')!]).toEqual([1])
})

test('groupBy keeps first-seen key order and item order', () => {
  expect([...groupBy(['bb', 'a', 'cc', 'd'], s => s.length)]).toEqual([
    [2, ['bb', 'cc']],
    [1, ['a', 'd']],
  ])
})
