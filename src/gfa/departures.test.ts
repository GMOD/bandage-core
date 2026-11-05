import {
  departureKind as walksDepartureKind,
  placementChoice as walksPlacementChoice,
} from '@jbrowse/graph-walks'

import {
  departureAt,
  departureKind,
  departureTable,
  departureText,
  gapParts,
  placementChoice,
} from './departures'
import { convertGFAToGraph } from './gfaConverter'
import { gfaTables } from './gfaTables'
import { graphFromTables, graphTablesGFA } from './graphTables'
import { serializeEl } from '../el'
import { parseGFA } from '../gfa-core/index'
import {
  GAP_PX as WALK_GAP_PX,
  MISSING_INK,
  MISSING_PX,
  OUTSIDE_CUT as WALK_OUTSIDE_CUT,
  OWN_GAP,
  walkRowReadout,
  walkRowsKey,
  walkRowsTree,
} from '../layout/walkRowDraw'
import { walkRowRuns, walkRowsOf } from '../layout/walkRowRuns'
import { walkRows } from '../layout/walkRows'
import { loadGraph } from '../pipeline'
import { walkLift } from '../walkHighlight'
import { walkKey } from '../walkKey'

import type { Departure } from './departures'
import type { GraphTables } from './graphTables'

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

const REFERENCE = 'GRCh38#0#chr1'

// A departure of HG002#1 from 2000 to 3000 on the reference, with 1 kb of
// its own between, unless `d` says otherwise
const departure = (d: Partial<Departure> = {}): Departure => ({
  name: 'HG002#1#chr1',
  hapStart: 2000,
  ownBp: 1000,
  missingBp: 0,
  leavePos: 2000,
  leaveReversed: false,
  leavePasses: 1,
  rejoinPos: 3000,
  rejoinReversed: false,
  rejoinPasses: 1,
  fromSteps: false,
  ...d,
})

// HG002#1 in two fragments, chr1:0-2000 and 3000-5000 of its contig, with the
// bp the cut trimmed off either side of the gap and the departures over it
function twoFragments(
  departures: Departure[],
  trimmed: { after?: number; before?: number } = {},
): GraphTables {
  const tables = gfaTables(
    gfa(
      'H\tVN:Z:1.1',
      ...S(1, 2, 3, 4, 5),
      ...L([1, 2], [2, 3], [3, 4], [4, 5]),
      W(REFERENCE, 0, 5000, '>1>2>3>4>5'),
      W('HG002#1#chr1', 0, 2000, '>1>2'),
      W('HG002#1#chr1', 3000, 5000, '>4>5'),
    ),
  )!
  return {
    ...tables,
    walks: {
      ...tables.walks,
      trimmedBefore: Float64Array.of(0, 0, trimmed.before ?? 0),
      trimmedAfter: Float64Array.of(0, trimmed.after ?? 0, 0),
    },
    departures: departureTable(departures),
  }
}

// The rows of the Graph the tables load to, which the tables' own runs equal
function gapOf(tables: GraphTables, region = { start: 0, end: 5000 }) {
  const graph = loadGraph(tables, 'cut', { referencePath: REFERENCE })
  const rows = walkRows(graph, region)!
  expect(
    walkRowsOf(walkRowRuns(tables, region, { referencePath: REFERENCE })!),
  ).toEqual(rows)
  const row = rows.rows[0]!
  const gaps = row.runs.filter(r => r.gap)
  return { rows, row, gaps, gap: gaps[0]! }
}

const parts = (tables: GraphTables) =>
  gapOf(tables).gaps.map(({ bp, cause }) => [bp, cause])

test('a departure table reads back the departures it was built of', () => {
  const list = [
    departure(),
    departure({
      name: 'HG003#2#chr1',
      leaveReversed: true,
      rejoinPasses: 3,
      fromSteps: true,
    }),
  ]
  const table = departureTable(list)
  expect(list.map((_, k) => departureAt(table, k))).toEqual(list)
  expect(Array.from(table.offsets)).toEqual([0, 0, 0])
  expect(departureTable().names).toEqual([])
})

test("departureKind and placementChoice say what graph-walks' do", () => {
  const ends = [
    { leavePos: 2000, rejoinPos: 3000 },
    { leavePos: 3000, rejoinPos: 2000 },
    { leavePos: 2000, rejoinPos: 2000 },
  ].flatMap(pos =>
    [false, true].flatMap(leaveReversed =>
      [false, true].map(rejoinReversed =>
        departure({ ...pos, leaveReversed, rejoinReversed }),
      ),
    ),
  )
  expect(new Set(ends.map(d => departureKind(d)))).toEqual(
    new Set(['forward', 'back', 'adjacent', 'switch']),
  )
  for (const d of ends) {
    expect(departureKind(d)).toBe(walksDepartureKind(d))
  }
  for (const [leavePasses, rejoinPasses] of [
    [1, 1],
    [2, 1],
    [1, 4],
  ] as const) {
    const d = departure({ leavePasses, rejoinPasses })
    expect(placementChoice(d)).toBe(walksPlacementChoice(d))
  }
  expect(placementChoice(departure({ rejoinPasses: 2 }))).toBe(true)
})

test('a departure in words states its stretch, ends and own bp, and makes no call', () => {
  const texts = [
    departureText(
      departure({
        leavePos: 160_620_000,
        rejoinPos: 160_674_000,
        ownBp: 120_000,
      }),
      'GRCh38',
    ),
    departureText(
      departure({ leavePos: 3000, rejoinPos: 2000, ownBp: 0 }),
      'GRCh38',
    ),
    departureText(
      departure({ rejoinReversed: true, missingBp: 400, rejoinPasses: 2 }),
    ),
    departureText(departure({ rejoinPos: 2000, ownBp: 300 }), 'GRCh38'),
  ]
  expect(texts).toEqual([
    'no step on GRCh38 across 54 kb · 120 kb of its own',
    'rejoins GRCh38 1 kb back · 0 bp of its own',
    'rejoins the reference on the other strand, 1 kb away · 1 kb of its own · 400 bp not in the graph · placement choice',
    'between adjacent steps on GRCh38 · 300 bp of its own',
  ])
  for (const text of texts) {
    expect(text).not.toMatch(/delet|insert/)
  }
})

test("a walk-file cut's departures and trimmed bp stay off the GFA it writes", () => {
  const tables = twoFragments([departure({ missingBp: 600 })], { after: 400 })
  const graph = graphFromTables(tables, 'cut')
  expect(graph.departures).toBe(tables.departures)
  expect(graph.paths![1]).toMatchObject({ trimmedAfter: 400 })
  expect(graph.paths![1]!.trimmedBefore).toBeUndefined()
  const written = graphTablesGFA(tables)
  expect(written.split('\n').at(-2)).toBe('W\tHG002\t1\tchr1\t0\t2000\t>1>2')
  const { departures: _, ...plain } = graph
  expect(convertGFAToGraph(parseGFA(written), 'cut')).toEqual({
    ...plain,
    paths: plain.paths!.map(({ trimmedAfter: __, ...path }) => path),
  })
})

// gfa-to-tabix 2's cuts wrote what lay past a walk as `ws`/`we` tags
test('W-line tags are no reason to read a GFA as text', () => {
  const text = gfa(
    ...S(1, 2),
    W('A#1#c', 0, 1000, '>1', 'ws:Z:end'),
    W('B#1#c', 0, 1000, '>2'),
  )
  const tables = gfaTables(text)!
  expect(tables.walks.names).toEqual(['A#1#c', 'B#1#c'])
  expect(graphFromTables(tables, 'cut')).toStrictEqual(
    convertGFAToGraph(parseGFA(text), 'cut'),
  )
})

test('a gap across W lines is the bp the departure says the graph lacks', () => {
  const { row, gap, rows } = gapOf(
    twoFragments([departure({ missingBp: 1000 })]),
  )
  expect(gap).toMatchObject({ bp: 1000, cause: 'missing' })
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 1.0 kb not in the graph',
  )
  expect(walkRowsKey(rows).map(e => e.label)).toContain('not in the graph')
  expect(row.departures).toEqual([departure({ missingBp: 1000 })])
})

// HG002 leaves at 2000 for chr1:20.3 Mb and comes back from there at 3000
test('a gap the walk spends elsewhere on the reference names where it rejoins', () => {
  const away = (rejoinPos: number) => [
    departure({ ownBp: 0, rejoinPos }),
    departure({ hapStart: 2900, ownBp: 100, leavePos: rejoinPos + 900 }),
  ]
  const { row, gap, rows } = gapOf(twoFragments(away(20_316_160)))
  expect(gap).toMatchObject({
    bp: 1000,
    cause: 'elsewhere',
    near: 20_316_160,
  })
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 1.0 kb on nodes filed near chr1:20.3 Mb',
  )
  const small = gapOf(twoFragments(away(9000)))
  expect(walkRowReadout(small.row, small.rows.reference)).toBe(
    '5.0 kb · 1.0 kb on nodes filed near chr1:9 kb',
  )
})

// HG002 walks on along the reference past the window, to 9000, and jumps
// back to 3000: the first departure in the gap leaves from where it went
test('a gap whose first departure starts inside it names where that one leaves', () => {
  const { gap } = gapOf(
    twoFragments([departure({ hapStart: 2600, ownBp: 400, leavePos: 9000 })]),
  )
  expect(gap).toMatchObject({ cause: 'elsewhere', near: 9000 })
})

// On chr22 at 12 Mb, a haplotype runs on past what the cut keeps, then its
// W line ends: the bp it ran on are graph sequence, the rest are not
test('a gap past a trimmed walk splits into what the cut left out and what the graph lacks', () => {
  const tables = twoFragments([departure({ missingBp: 600 })], { after: 400 })
  expect(parts(tables)).toEqual([
    [400, undefined],
    [600, 'missing'],
  ])
  const { row, rows } = gapOf(tables)
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 0.6 kb not in the graph · 0.4 kb outside the extracted subgraph',
  )
  expect(
    parts(
      twoFragments([departure({ ownBp: 0, rejoinPos: 9000 })], { after: 300 }),
    ),
  ).toEqual([
    [300, undefined],
    [700, 'elsewhere'],
  ])
})

test('the key gives one entry to each way a gap draws', () => {
  const { rows } = gapOf(
    twoFragments([departure({ missingBp: 600 })], { before: 200 }),
  )
  const gaps = walkRowsKey(rows).filter(e => e.swatch.kind === 'gap')
  expect(gaps.map(e => [e.label, e.swatch])).toEqual([
    [
      'outside the extracted subgraph',
      { kind: 'gap', fill: WALK_OUTSIDE_CUT, px: WALK_GAP_PX },
    ],
    ['not in the graph', { kind: 'gap', fill: MISSING_INK, px: MISSING_PX }],
    ['of its own, not read', { kind: 'gap', fill: OWN_GAP, px: WALK_GAP_PX }],
  ])
})

test('a tree drawn over canvas bars still names what its gaps leave out', () => {
  const { rows } = gapOf(twoFragments([departure({ missingBp: 1000 })]))
  const frame = {
    scaleX: 0.1,
    scaleY: 1,
    translateX: 0,
    translateY: 20,
    width: 800,
    height: 400,
  }
  const svg = serializeEl(walkRowsTree(rows, { ...frame, bars: false }))
  expect(svg).not.toContain('<rect')
  expect(svg).toContain('5.0 kb · 1.0 kb not in the graph')
  expect(serializeEl(walkRowsTree(rows, frame))).toContain('<rect')
})

// records.GRCh38.gfa in graph-walks' test data: between two W lines a third
// holds 700 bp on a node with no step on the reference
test("own sequence the cut did not read is the rest of the departure's own bp", () => {
  const tables = twoFragments([departure({ missingBp: 400 })])
  expect(parts(tables)).toEqual([
    [400, 'missing'],
    [600, 'own'],
  ])
  const { row, rows } = gapOf(tables)
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 0.4 kb not in the graph · 0.6 kb of its own, not read',
  )
})

test('a departure inside a piece neither explains a gap nor lists beside the row', () => {
  const inside = departure({
    hapStart: 1000,
    ownBp: 0,
    leavePos: 1000,
    rejoinPos: 1000,
    rejoinReversed: true,
  })
  const { row, gap } = gapOf(twoFragments([inside]))
  expect(gap.cause).toBeUndefined()
  expect(row.departures).toBeUndefined()
  expect(
    gapParts(2000, 3000, {}, [inside, departure({ missingBp: 1000 })]),
  ).toEqual([{ bp: 1000, cause: 'missing' }])
})

test('a row with a departure the writer placed says so, and the key why', () => {
  const placed = twoFragments([departure({ missingBp: 1000, leavePasses: 2 })])
  const { row, rows } = gapOf(placed)
  expect(row.placementChoice).toBe(true)
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 1.0 kb not in the graph · placement choice',
  )
  expect(walkRowsKey(rows).find(e => e.note)?.label).toMatch(
    /^placement choice: /,
  )
  expect(
    gapOf(twoFragments([departure({ missingBp: 1000 })])).row.placementChoice,
  ).toBeUndefined()
})

test('a row walked backwards meets the parts of a gap last first', () => {
  const tables = gfaTables(
    gfa(
      'H\tVN:Z:1.1',
      ...S(1, 2, 3, 4, 5, 6, 7),
      ...L([1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]),
      W(REFERENCE, 0, 7000, '>1>2>3>4>5>6>7'),
      W('HG002#1#chr1', 0, 3000, '<7<6<5'),
      W('HG002#1#chr1', 4000, 7000, '<3<2<1'),
    ),
  )!
  const graph = loadGraph(
    {
      ...tables,
      walks: {
        ...tables.walks,
        trimmedAfter: Float64Array.of(0, 400, 0),
      },
      departures: departureTable([
        departure({
          hapStart: 3000,
          missingBp: 600,
          leavePos: 4000,
          leaveReversed: true,
          rejoinPos: 3000,
          rejoinReversed: true,
        }),
      ]),
    },
    'cut',
    { referencePath: REFERENCE },
  )
  const row = walkRows(graph, { start: 1000, end: 6000 })!.rows[0]!
  expect(row.axis?.reversed).toBe(true)
  expect(row.runs.filter(r => r.gap).map(r => [r.bp, r.cause])).toEqual([
    [600, 'missing'],
    [400, undefined],
  ])
})

test('a lifted walk states the bp its departures say the graph lacks', () => {
  const graph = loadGraph(
    twoFragments([departure({ missingBp: 300 })], { after: 400 }),
    'cut',
    { referencePath: REFERENCE },
  )
  const [walk] = walkLift(graph, [{ walk: 'HG002#1#chr1' }])!.walks
  expect(walk).toMatchObject({ missingBp: 300, ownBp: 300 })
  expect(walkKey(walk!).gaps).toBe(
    ', 300 bp not in the graph, 300 bp of its own, not read, 400 bp outside the extracted subgraph',
  )
})

test('a gap with no departure in it is outside the extracted subgraph', () => {
  const { row, gap, rows } = gapOf(twoFragments([], { after: 400 }))
  expect(gap).toEqual({ start: 2000, bp: 1000, onReference: false, gap: true })
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb · 1.0 kb outside the extracted subgraph',
  )
  expect(walkRowsKey(rows).map(e => e.label)).toContain(
    'outside the extracted subgraph',
  )
})
