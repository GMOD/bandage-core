import { convertGFAToGraph } from './gfaConverter'
import { gfaTables } from './gfaTables'
import { graphFromTables, graphTablesGFA } from './graphTables'
import { parseStopTag, stopTag } from './walkStops'
import { parseGFA } from '../gfa-core/index'
import { walkRowReadout, walkRowsKey } from '../layout/walkRowDraw'
import { walkRows } from '../layout/walkRows'
import { loadGraph } from '../pipeline'
import { walkLift } from '../walkHighlight'
import { walkKey } from '../walkKey'

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
    W('GRCh38#0#chr1', 0, 5000, '>1>2>3>4>5', 'ws:Z:end', 'we:Z:end'),
    W('HG002#1#chr1', 0, 2000, '>1>2', 'ws:Z:end', `we:Z:${after}`),
    W('HG002#1#chr1', 3000, 5000, '>4>5', `ws:Z:${before}`, 'we:Z:end'),
  )
}

function gapOf(text: string) {
  const graph = loadGraph(text, 'cut', { referencePath: 'GRCh38#0#chr1' })
  const rows = walkRows(graph, { start: 0, end: 5000 })!
  const row = rows.rows[0]!
  const gaps = row.runs.filter(r => r.gap)
  return { rows, row, gaps, gap: gaps[0]! }
}

const parts = (text: string) =>
  gapOf(text).gaps.map(({ bp, cause }) => [bp, cause])

test('a stop reads back as it was written', () => {
  const chr22 = (start: number) => ({ refName: 'GRCh38#0#chr22', start })
  const stops: PathStop[] = [
    { kind: 'end' },
    { kind: 'end', trimmed: 1000 },
    { kind: 'break', bp: 19021 },
    { kind: 'break', bp: 5, chunk: chr22(65536), trimmed: 12 },
    { kind: 'elsewhere', chunk: chr22(20316160) },
    { kind: 'elsewhere', chunk: chr22(20316160), bp: 34110 },
  ]
  for (const stop of stops) {
    expect(parseStopTag(stopTag(stop))).toEqual(stop)
  }
  expect(stopTag(stops[3]!)).toBe(
    'break,bp=5,trimmed=12,chunk=GRCh38#0#chr22:65536',
  )
  expect(parseStopTag('sideways')).toBeUndefined()
  expect(parseStopTag('window')).toBeUndefined()
})

test('tagged W lines read the same by tables and as text, and write back', () => {
  const text = twoFragments(
    'elsewhere,chunk=GRCh38#0#chr1:65536',
    'break,bp=1000,trimmed=200',
  )
  const tables = gfaTables(text)!
  const fromTables = graphFromTables(tables, 'cut')
  expect(fromTables).toStrictEqual(convertGFAToGraph(parseGFA(text), 'cut'))
  expect(fromTables.paths![2]).toMatchObject({
    before: { kind: 'break', bp: 1000, trimmed: 200 },
    after: { kind: 'end' },
  })
  expect(fromTables.paths![1]!.after).toEqual({
    kind: 'elsewhere',
    chunk: { refName: 'GRCh38#0#chr1', start: 65536 },
  })
  const written = graphTablesGFA(tables).split('\n')
  expect(written.at(-1)).toBe(
    'W\tHG002\t1\tchr1\t3000\t5000\t>4>5\tws:Z:break,bp=1000,trimmed=200\twe:Z:end',
  )
  expect(gfaTables(written.join('\n'))).toEqual(tables)
})

test('W lines that tag some walks and not others convert as text', () => {
  const text = gfa(
    ...S(1, 2),
    W('A#1#c', 0, 1000, '>1', 'ws:Z:end'),
    W('B#1#c', 0, 1000, '>2'),
  )
  expect(gfaTables(text)).toBeUndefined()
  const graph = loadGraph(text, 'cut')
  expect(graph.paths!.map(p => p.before)).toEqual([{ kind: 'end' }, undefined])
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
  const small = gapOf(
    twoFragments(
      'elsewhere,chunk=GRCh38#0#chr1:9000',
      'elsewhere,chunk=GRCh38#0#chr1:9000',
    ),
  )
  expect(walkRowReadout(small.row, small.rows.reference)).toBe(
    '5.0 kb · 1.0 kb on nodes filed near chr1:9 kb',
  )
})

// On chr22 at 12 Mb, a haplotype runs on past what the cut keeps, then its
// record breaks: the bp it ran on are graph sequence, the break's are not
test('a gap past a trimmed walk splits into what the cut left out and what the graph lacks', () => {
  const text = twoFragments('break,bp=600,trimmed=400', 'break,bp=600')
  expect(parts(text)).toEqual([
    [400, undefined],
    [600, 'missing'],
  ])
  const { row, rows } = gapOf(text)
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 0.6 kb not in the graph · 0.4 kb outside the extracted subgraph',
  )
  expect(
    parts(
      twoFragments('end,trimmed=300', 'elsewhere,chunk=GRCh38#0#chr1:9000'),
    ),
  ).toEqual([
    [300, undefined],
    [700, 'elsewhere'],
  ])
})

test('two breaks with a record between leave the bp between them open', () => {
  expect(parts(twoFragments('break,bp=400', 'break,bp=300'))).toEqual([
    [400, 'missing'],
    [300, 'unknown'],
    [300, 'missing'],
  ])
  const { row, rows } = gapOf(twoFragments('break,bp=400', 'break,bp=300'))
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 0.7 kb not in the graph · 0.3 kb gap, cause unknown',
  )
})

test('a row walked backwards meets the parts of a gap last first', () => {
  const text = gfa(
    'H\tVN:Z:1.1',
    ...S(1, 2, 3, 4, 5, 6, 7),
    ...L([1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]),
    W('GRCh38#0#chr1', 0, 7000, '>1>2>3>4>5>6>7', 'ws:Z:end', 'we:Z:end'),
    W(
      'HG002#1#chr1',
      0,
      3000,
      '<7<6<5',
      'ws:Z:end',
      'we:Z:break,bp=600,trimmed=400',
    ),
    W('HG002#1#chr1', 4000, 7000, '<3<2<1', 'ws:Z:break,bp=600', 'we:Z:end'),
  )
  const graph = loadGraph(text, 'cut', { referencePath: 'GRCh38#0#chr1' })
  const row = walkRows(graph, { start: 1000, end: 6000 })!.rows[0]!
  expect(row.axis?.reversed).toBe(true)
  expect(row.runs.filter(r => r.gap).map(r => [r.bp, r.cause])).toEqual([
    [600, 'missing'],
    [400, undefined],
  ])
})

test('a lifted walk states the bp its record breaks leave out of the graph', () => {
  const graph = loadGraph(
    twoFragments('break,bp=600,trimmed=400', 'break,bp=600'),
    'cut',
    { referencePath: 'GRCh38#0#chr1' },
  )
  const [walk] = walkLift(graph, [{ walk: 'HG002#1#chr1' }]).walks
  expect(walkKey(walk!).gaps).toBe(
    ', 600 bp not in the graph, 400 bp outside the extracted subgraph',
  )
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
    '5.0 kb · 1.0 kb outside the extracted subgraph',
  )
  expect(walkRowsKey(rows).map(e => e.label)).toContain(
    'outside the extracted subgraph',
  )
})
