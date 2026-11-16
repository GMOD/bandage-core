import { readFileSync, readdirSync } from 'node:fs'

import { loadGraph } from '../pipeline'
import {
  canonicalEdgeOrder,
  canonicalNodeOrder,
  compareIds,
} from './canonicalOrder'

import type { GraphEdge, GraphNode } from '../types'

const node = (id: string): GraphNode => ({ id, name: id, length: 10, depth: 1 })

const link = (
  from: string,
  to: string,
  toStrand: '+' | '-' = '+',
): GraphEdge => ({ from, to, fromStrand: '+', toStrand })

const idsInOrder = (ids: readonly string[]) =>
  canonicalNodeOrder(ids.map(node)).map(n => n.id)

const oddsThenEvens = <T>(items: readonly T[]) => [
  ...items.filter((_, i) => i % 2),
  ...items.filter((_, i) => !(i % 2)),
]

const reorderings = [
  <T>(items: readonly T[]) => items,
  <T>(items: readonly T[]) => items.toReversed(),
  oddsThenEvens,
]

test('numbers in an id compare as numbers', () => {
  expect(idsInOrder(['10', '9', '100', '2', '1'])).toEqual([
    '1',
    '2',
    '9',
    '10',
    '100',
  ])
  expect(idsInOrder(['s10', 's2', 'b', 's1a', 's1'])).toEqual([
    'b',
    's1',
    's1a',
    's2',
    's10',
  ])
})

test('ids that differ only in leading zeros or a strand suffix each take one place', () => {
  const ids = ['10+', '9+', '7', '007', '10-', '10', '07', 's2', '2+', 's02']
  const expected = [
    '2+',
    '007',
    '07',
    '7',
    '9+',
    '10',
    '10+',
    '10-',
    's02',
    's2',
  ]
  for (const reorder of reorderings) {
    expect(idsInOrder(reorder(ids))).toEqual(expected)
  }
})

test('the order is the same whatever order the nodes came in', () => {
  const ids = Array.from(
    { length: 60 },
    (_, i) => [`${i}`, `s${i}`, `${i}x${60 - i}`, `0${i}`][i % 4] ?? '',
  )
  const expected = idsInOrder(ids)
  for (const reorder of reorderings) {
    expect(idsInOrder(reorder(ids))).toEqual(expected)
  }
})

test('links go by their spelling, the same whatever order they came in', () => {
  const edges = [
    link('2', '3'),
    link('10', '1'),
    link('1', '2', '-'),
    link('1', '2'),
  ]
  for (const reorder of reorderings) {
    expect(
      canonicalEdgeOrder(reorder(edges)).map(
        e => `${e.from}>${e.to}${e.toStrand}`,
      ),
    ).toEqual(['1>2+', '1>2-', '10>1+', '2>3+'])
  }
})

const fixtureGraphs = readdirSync('test_data', { recursive: true })
  .map(String)
  .filter(file => file.endsWith('.gfa'))
  .toSorted()

test.each(fixtureGraphs)(
  'the ids of %s fall in the order the en numeric collator the label pass used gave them',
  file => {
    const ids = loadGraph(
      readFileSync(`test_data/${file}`, 'utf8'),
      file,
    ).nodes.map(n => n.id)
    const collator = new Intl.Collator('en', { numeric: true })
    expect(ids.toSorted(compareIds)).toEqual(ids.toSorted(collator.compare))
  },
)
