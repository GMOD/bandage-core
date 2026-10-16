import { convertGFAToGraph } from './gfaConverter'
import { gfaTables } from './gfaTables'
import { graphFromTables, graphTablesGFA } from './graphTables'
import { parseStopTag, stopTag } from './walkStops'
import { parseGFA } from '../gfa-core/index'
import { walkRowReadout, walkRowsKey } from '../layout/walkRowDraw'
import { walkRows } from '../layout/walkRows'
import { loadGraph } from '../pipeline'

import type { PathStop } from '../types'

const S = (...ids: number[]) => ids.map(id => `S\t${id}\t*\tLN:i:1000`)
const L = (...pairs: [number, number][]) =>
  pairs.map(([a, b]) => `L\t${a}\t+\t${b}\t+\t0M`)
const W = (
  name: string,
  start: number,
  end: number,
  steps: string,
  ...tags: string[]
) =>
  [
    `W\t${name.replaceAll('#', '\t')}\t${start}\t${end}\t${steps}`,
    ...tags,
  ].join('\t')
const gfa = (...lines: string[]) => `${lines.join('\n')}\n`

// HG002#1 in two fragments 1 kb apart, the stops either side of the gap as
// `after` and `before`
function twoFragments(after: string, before: string) {
  return gfa(
    'H\tVN:Z:1.1',
    ...S(1, 2, 3, 4, 5),
    ...L([1, 2], [2, 3], [3, 4], [4, 5]),
    W(
      'GRCh38#0#chr1',
      0,
      5000,
      '>1>2>3>4>5',
      'fs:i:0',
      'ws:Z:window',
      'we:Z:window',
    ),
    W(
      'HG002#1#chr1',
      0,
      2000,
      '>1>2',
      'fs:i:0',
      'ws:Z:window',
      `we:Z:${after}`,
    ),
    W(
      'HG002#1#chr1',
      3000,
      5000,
      '>4>5',
      'fs:i:3000',
      `ws:Z:${before}`,
      'we:Z:window',
    ),
  )
}

function gapOf(text: string) {
  const graph = loadGraph(text, 'cut', { referencePath: 'GRCh38#0#chr1' })
  const rows = walkRows(graph, { start: 0, end: 5000 })!
  const row = rows.rows[0]!
  return { rows, row, gap: row.runs.find(r => r.gap)! }
}

test('a stop reads back as it was written', () => {
  const stops: PathStop[] = [
    { kind: 'window' },
    { kind: 'end' },
    { kind: 'recordEnd' },
    { kind: 'break', bp: 19021 },
    {
      kind: 'break',
      bp: 5,
      chunk: { refName: 'GRCh38#0#chr22', start: 65536 },
    },
    {
      kind: 'elsewhere',
      chunk: { refName: 'GRCh38#0#chr22', start: 20316160 },
    },
    {
      kind: 'elsewhere',
      chunk: { refName: 'GRCh38#0#chr22', start: 20316160 },
      bp: 34110,
    },
  ]
  for (const stop of stops) {
    expect(parseStopTag(stopTag(stop))).toEqual(stop)
  }
  expect(stopTag(stops[6]!)).toBe(
    'elsewhere,bp=34110,chunk=GRCh38#0#chr22:20316160',
  )
  expect(parseStopTag('sideways')).toBeUndefined()
})

test('tagged W lines read the same by tables and as text, and write back', () => {
  const text = twoFragments(
    'elsewhere,chunk=GRCh38#0#chr1:65536',
    'break,bp=1000',
  )
  const tables = gfaTables(text)!
  expect([...tables.walks.fragStarts!]).toEqual([0, 0, 3000])
  const fromTables = graphFromTables(tables, 'cut')
  expect(fromTables).toStrictEqual(convertGFAToGraph(parseGFA(text), 'cut'))
  expect(fromTables.paths![2]).toMatchObject({
    fragStart: 3000,
    before: { kind: 'break', bp: 1000 },
    after: { kind: 'window' },
  })
  expect(fromTables.paths![1]!.after).toEqual({
    kind: 'elsewhere',
    chunk: { refName: 'GRCh38#0#chr1', start: 65536 },
  })
  const written = graphTablesGFA(tables).split('\n')
  expect(written.at(-1)).toBe(
    'W\tHG002\t1\tchr1\t3000\t5000\t>4>5\tfs:i:3000\tws:Z:break,bp=1000\twe:Z:window',
  )
  expect(gfaTables(written.join('\n'))).toEqual(tables)
})

test('W lines that tag some walks and not others convert as text', () => {
  const text = gfa(
    ...S(1, 2),
    W('A#1#c', 0, 1000, '>1', 'fs:i:0'),
    W('B#1#c', 0, 1000, '>2'),
  )
  expect(gfaTables(text)).toBeUndefined()
  const graph = loadGraph(text, 'cut')
  expect(graph.paths!.map(p => p.fragStart)).toEqual([0, undefined])
})

test('a gap between two records is not in the graph', () => {
  const { row, gap, rows } = gapOf(
    twoFragments('break,bp=1000', 'break,bp=1000'),
  )
  expect(gap).toMatchObject({ bp: 1000, cause: 'missing' })
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 1.0 kb not in the graph',
  )
  expect(walkRowsKey(rows).map(e => e.label)).toContain('not in the graph')
})

test('a gap the walk spends on nodes filed elsewhere names where', () => {
  const { row, gap, rows } = gapOf(
    twoFragments(
      'elsewhere,bp=1000,chunk=GRCh38#0#chr1:20316160',
      'elsewhere,bp=1000,chunk=GRCh38#0#chr1:20381696',
    ),
  )
  expect(gap).toMatchObject({
    cause: 'elsewhere',
    chunk: { refName: 'GRCh38#0#chr1', start: 20316160 },
  })
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 1.0 kb on nodes filed near chr1:20.3 Mb',
  )
})

test('a gap between format 2 records, or a break of other bp, has no known cause', () => {
  for (const [after, before] of [
    ['recordEnd', 'recordEnd'],
    ['break,bp=400', 'break,bp=600'],
  ] as const) {
    const { row, gap, rows } = gapOf(twoFragments(after, before))
    expect(gap.cause).toBe('unknown')
    expect(walkRowReadout(row, rows.reference)).toBe(
      '5.0 kb · 1.0 kb gap, cause unknown',
    )
  }
})

test('a gap between untagged pieces reads as before', () => {
  const text = gfa(
    ...S(1, 2, 3, 4, 5),
    ...L([1, 2], [2, 3], [3, 4], [4, 5]),
    W('GRCh38#0#chr1', 0, 5000, '>1>2>3>4>5'),
    W('HG002#1#chr1', 0, 2000, '>1>2'),
    W('HG002#1#chr1', 3000, 5000, '>4>5'),
  )
  const { row, gap, rows } = gapOf(text)
  expect(gap.cause).toBeUndefined()
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 1.0 kb outside the cut',
  )
  expect(walkRowsKey(rows).map(e => e.label)).toContain(
    'walked outside the cut',
  )
})
