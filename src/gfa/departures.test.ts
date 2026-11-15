import {
  departureKind as walksDepartureKind,
  placementChoice as walksPlacementChoice,
} from '@jbrowse/graph-walks'

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
import { walksThrough } from '../walksThrough'
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

test('a departure reads where its held steps break, and nothing where they run unbroken', () => {
  const table = {
    ...departureTable([departure(), departure()]),
    breakAt: Int32Array.of(-1, 2),
  }
  expect(departureAt(table, 0)).not.toHaveProperty('breakAt')
  expect(departureAt(table, 1).breakAt).toBe(2)
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

test('a departure in a walk file that counts nodes the reference passes twice states its bp off the reference path, not as its own', () => {
  const d = departure({
    leavePos: 160_620_000,
    rejoinPos: 160_674_000,
    ownBp: 120_000,
  })
  expect(departureText(d, 'GRCh38', 0)).toBe(
    'no step on GRCh38 across 54 kb · 120 kb of its own',
  )
  expect(departureText(d, 'GRCh38', 2)).toBe(
    "no step on GRCh38 across 54 kb · 120 kb off GRCh38's path",
  )
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
      0,
    ),
    departureText(
      departure({ leavePos: 3000, rejoinPos: 2000, ownBp: 0 }),
      'GRCh38',
      0,
    ),
    departureText(
      departure({ rejoinReversed: true, missingBp: 400, rejoinPasses: 2 }),
      undefined,
      0,
    ),
    departureText(departure({ rejoinPos: 2000, ownBp: 300 }), 'GRCh38', 0),
  ]
  expect(texts).toEqual([
    'no step on GRCh38 across 54 kb · 120 kb of its own',
    'rejoins GRCh38 1 kb back · 0 bp of its own',
    'rejoins the reference on the other strand, 1 kb away · 1 kb of its own, 400 bp left out of graph · placement choice',
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
  expect(graph.paths![1]).toMatchObject({ trimmedBefore: 0, trimmedAfter: 400 })
  const written = graphTablesGFA(tables)
  expect(written.split('\n').at(-2)).toBe('W\tHG002\t1\tchr1\t0\t2000\t>1>2')
  const { departures: _, ...plain } = graph
  expect(convertGFAToGraph(parseGFA(written), 'cut')).toEqual({
    ...plain,
    paths: plain.paths!.map(
      ({ trimmedBefore: _b, trimmedAfter: _a, ...path }) => path,
    ),
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
    '5.0 kb, of which 1.0 kb left out of graph',
  )
  expect(walkRowsKey(rows).map(e => e.label)).toContain(
    'left out of graph: in the assembly, but the graph builder dropped it',
  )
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
    '5.0 kb, of which 1.0 kb near chr1:20.3 Mb',
  )
  const small = gapOf(twoFragments(away(9000)))
  expect(walkRowReadout(small.row, small.rows.reference)).toBe(
    '5.0 kb, of which 1.0 kb near chr1:9 kb',
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
    '5.0 kb, of which 600 bp left out of graph, 400 bp out of view',
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
      'out of view: in the graph, beyond the part drawn here',
      { kind: 'gap', fill: WALK_OUTSIDE_CUT, px: WALK_GAP_PX },
    ],
    [
      'left out of graph: in the assembly, but the graph builder dropped it',
      { kind: 'gap', fill: MISSING_INK, px: MISSING_PX },
    ],
    [
      'own sequence not drawn: in the graph off the reference, between two stretches drawn here',
      { kind: 'gap', fill: OWN_GAP, px: WALK_GAP_PX },
    ],
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
  expect(svg).toContain('5.0 kb, of which 1.0 kb left out of graph')
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
    '5.0 kb, of which 400 bp left out of graph, 600 bp own sequence not drawn',
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
    '5.0 kb, of which 1.0 kb left out of graph · placement choice',
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

test('a lifted walk states the bp its departures say the graph lacks, and its bp off the reference as its own only where the walk file counts no node the reference passes twice', () => {
  const keyOf = (revisited: number) => {
    const graph = loadGraph(
      {
        ...twoFragments([departure({ missingBp: 300 })], { after: 400 }),
        revisited,
      },
      'cut',
      { referencePath: REFERENCE },
    )
    const [walk] = walkLift(graph, [{ walk: 'HG002#1#chr1' }])!.walks
    expect(walk).toMatchObject({ missingBp: 300, ownBp: 300 })
    return walkKey(walk!).gaps
  }
  expect(keyOf(0)).toBe(
    ', 300 bp left out of graph, 300 bp own sequence not drawn, 400 bp out of view',
  )
  expect(keyOf(2)).toBe(
    ", 300 bp left out of graph, 300 bp off GRCh38#0's path and not drawn, 400 bp out of view",
  )
  expect(keyOf(Number.NaN)).toBe(keyOf(2))
})

test('a gap with no departure in it is out of view', () => {
  const { row, gap, rows } = gapOf(twoFragments([], { after: 400 }))
  expect(gap).toEqual({ start: 2000, bp: 1000, onReference: false, gap: true })
  expect(walkRowReadout(row, rows.reference)).toBe(
    '5.0 kb, of which 1.0 kb out of view',
  )
  expect(walkRowsKey(rows).map(e => e.label)).toContain(
    'out of view: in the graph, beyond the part drawn here',
  )
})

// HG002 and HG003 leave the reference after node 2 for node 6 and rejoin at
// node 4, each in two fragments with node 6 a departure's own step alone;
// HG004 takes node 6 in its one fragment and its departure repeats it; HG005
// has no walk in the cut
function departedThroughSix(): GraphTables {
  const tables = gfaTables(
    gfa(
      'H\tVN:Z:1.1',
      ...S(1, 2, 3, 4, 5, 6),
      ...L([1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 4]),
      W(REFERENCE, 0, 5000, '>1>2>3>4>5'),
      W('HG002#1#chr1', 0, 2000, '>1>2'),
      W('HG002#1#chr1', 3000, 5000, '>4>5'),
      W('HG003#1#chr1', 0, 2000, '>1>2'),
      W('HG003#1#chr1', 3000, 5000, '>4>5'),
      W('HG004#1#chr1', 0, 5000, '>1>2>6>4>5'),
    ),
  )!
  const six = tables.nodes.names.indexOf('6')
  const names = ['HG002#1#chr1', 'HG003#1#chr1', 'HG004#1#chr1', 'HG005#1#chr1']
  return {
    ...tables,
    departures: {
      ...departureTable(
        names.map(name =>
          departure({ name, fromSteps: name === 'HG004#1#chr1' }),
        ),
      ),
      offsets: Int32Array.of(0, 1, 2, 3, 4),
      steps: Int32Array.of(six, six, six, six),
      reversed: new Uint8Array(4),
    },
  }
}

test("a node counts each shown walk that takes it as a departure's own step, once, and no walk not shown", () => {
  const graph = graphFromTables(departedThroughSix(), 'cut')
  expect(graph.nodes.find(node => node.name === '6')?.depth).toBe(3)
  expect(
    graph.edges
      .filter(e => e.from === '6+' || e.to === '6+')
      .map(e => [e.from, e.to, e.pathIds]),
  ).toEqual([
    ['2+', '6+', ['HG004#1#chr1', 'HG002#1#chr1', 'HG003#1#chr1']],
    ['6+', '4+', ['HG004#1#chr1', 'HG002#1#chr1', 'HG003#1#chr1']],
  ])
  expect(graph.nodes.find(node => node.name === '2')?.depth).toBe(4)
})

test('a node on fragments lists the walks that step on it', () => {
  const graph = graphFromTables(departedThroughSix(), 'cut')
  const two = graph.nodes.find(node => node.name === '2')!
  expect(walksThrough(graph, two)).toEqual([
    { name: REFERENCE, passes: 1 },
    { name: 'HG002#1#chr1', passes: 1 },
    { name: 'HG003#1#chr1', passes: 1 },
    { name: 'HG004#1#chr1', passes: 1 },
  ])
})

test('a node reached through departures lists each shown walk once, where its own step lies on its contig, and no walk not shown', () => {
  const graph = graphFromTables(departedThroughSix(), 'cut')
  const six = graph.nodes.find(node => node.name === '6')!
  expect(walksThrough(graph, six)).toEqual([
    { name: 'HG004#1#chr1', passes: 1 },
    { name: 'HG002#1#chr1', passes: 1 },
    { name: 'HG003#1#chr1', passes: 1 },
  ])
  expect(six.departureVisits).toEqual([
    { path: 'HG002#1#chr1', sample: 'HG002', start: 2000, strand: '+' },
    { path: 'HG003#1#chr1', sample: 'HG003', start: 2000, strand: '+' },
  ])
})

test("every node's walks are as many as its depth", () => {
  const graph = graphFromTables(departedThroughSix(), 'cut')
  for (const node of graph.nodes) {
    expect([node.name, walksThrough(graph, node).length]).toEqual([
      node.name,
      node.depth,
    ])
  }
})

// HG002's own steps 6 and 7 break after 6: 6 follows its leave step, 2, and 7
// leads to its rejoin step, 4, and the cut has no link that takes it from 6
// to 7
test("a departure's broken own steps take the links either side of the break, not one across it", () => {
  const tables = gfaTables(
    gfa(
      'H\tVN:Z:1.1',
      ...S(1, 2, 3, 4, 5, 6, 7),
      ...L([1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 7], [7, 4]),
      W(REFERENCE, 0, 5000, '>1>2>3>4>5'),
      W('HG002#1#chr1', 0, 2000, '>1>2'),
      W('HG002#1#chr1', 4000, 6000, '>4>5'),
    ),
  )!
  const { names } = tables.nodes
  const graph = graphFromTables(
    {
      ...tables,
      departures: {
        ...departureTable([departure({ ownBp: 2000 })]),
        offsets: Int32Array.of(0, 2),
        steps: Int32Array.of(names.indexOf('6'), names.indexOf('7')),
        reversed: new Uint8Array(2),
        breakAt: Int32Array.of(1),
      },
    },
    'cut',
  )
  expect(
    graph.edges
      .filter(e => ['6+', '7+'].includes(e.from))
      .concat(graph.edges.filter(e => e.from === '2+' && e.to === '6+'))
      .map(e => [e.from, e.to, e.pathIds]),
  ).toEqual([
    ['6+', '7+', undefined],
    ['7+', '4+', ['HG002#1#chr1']],
    ['2+', '6+', ['HG002#1#chr1']],
  ])
})
