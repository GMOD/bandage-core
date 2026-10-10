import { PathVisits, PathVisitsBuilder } from './pathVisits'

import type { PathVisit } from './types'

const visit = (
  path: string,
  start: number,
  strand: '+' | '-' = '+',
): PathVisit => ({ path, sample: path.split('#')[0]!, start, strand })

const entries: [string, PathVisit[]][] = [
  ['7', [visit('A#1#c', 0), visit('B#1#c', 5, '-'), visit('A#1#c', 40)]],
  ['3', [visit('B#1#c', 9)]],
  ['5', []],
]

test('reads back as the map it was built from, in its order', () => {
  const visits = PathVisits.from(entries)
  expect([...visits]).toEqual(entries)
  expect([...visits.keys()]).toEqual(['7', '3', '5'])
  expect(visits.get('3')).toEqual([visit('B#1#c', 9)])
  expect(visits.get('9')).toBeUndefined()
  expect(visits.has('5')).toBe(true)
  expect(visits.size).toBe(3)
})

test('the builder groups visits by segment, each in the order added', () => {
  const builder = new PathVisitsBuilder()
  builder.add('7', 'A#1#c', 'A', 0, false)
  builder.add('3', 'B#1#c', 'B', 9, false)
  builder.add('7', 'B#1#c', 'B', 5, true)
  builder.add('5', 'A#1#c', 'A', 1, false)
  builder.add('7', 'A#1#c', 'A', 40, false)
  const visits = builder.build()
  expect(visits.get('7')).toEqual(entries[0]![1])
  expect([...visits.keys()]).toEqual(['7', '3', '5'])
})

test('a replay reads each path its own next visit at a segment', () => {
  const visits = PathVisits.from(entries)
  const next = visits.replay()
  const seven = visits.slot('7')
  const a = visits.pathIndex('A#1#c')
  expect(visits.start[next(seven, a)]).toBe(0)
  expect(visits.start[next(seven, a)]).toBe(40)
  expect(next(seven, a)).toBe(-1)
  expect(visits.strand(next(seven, visits.pathIndex('B#1#c')))).toBe('-')
  expect(next(visits.slot('nowhere'), a)).toBe(-1)
})

test('a filter keeps the paths and segments it is asked to', () => {
  const visits = PathVisits.from(entries).filter(
    path => path === 'B#1#c',
    segment => segment !== '5',
  )
  expect([...visits]).toEqual([
    ['7', [visit('B#1#c', 5, '-')]],
    ['3', [visit('B#1#c', 9)]],
  ])
})
