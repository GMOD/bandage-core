import { walkRowReadout, walkRowsKey } from './walkRowDraw'
import { walkRowRuns, walkRowsOf } from './walkRowRuns'
import { walkRows } from './walkRows'
import { departureTable } from '../gfa/departures'
import { gfaTables } from '../gfa/gfaTables'
import { graphFromTables } from '../gfa/graphTables'
import { loadGraph } from '../pipeline'
import { walkHighlight } from '../walkHighlight'

import type { WalkRow } from './walkRows'
import type { Departure } from '../gfa/departures'
import type { GraphTables } from '../gfa/graphTables'

// GRCh38 runs 0..4 over chr1:0-5000, a kb a node, with node 5 (300 bp) an
// expansion off it. The repeat is node 2, chr1:2000-3000. A has the
// reference's left flank from 0 and ends inside the repeat, B the same from
// 1000, and C runs against the reference from its right flank and ends
// inside too, each off the reference. D's contig ends on the repeat's node
// and E's on the left flank.
const tables: GraphTables = {
  nodes: {
    names: ['0', '1', '2', '3', '4', '5'],
    lengths: Int32Array.of(1000, 1000, 1000, 1000, 1000, 300),
    refs: Int32Array.of(0, 0, 0, 0, 0, 1),
    starts: Float64Array.of(0, 1000, 2000, 3000, 4000, 0),
    ranks: Int32Array.of(0, 0, 0, 0, 0, 1),
    refNames: ['chr1', 'alt'],
  },
  links: {
    from: new Int32Array(0),
    to: new Int32Array(0),
    strands: new Uint8Array(0),
  },
  walks: {
    names: ['GRCh38#0#chr1', 'A#1#a', 'B#1#b', 'C#1#c', 'D#1#d', 'E#1#e'],
    starts: Float64Array.of(0, 0, 0, 0, 0, 0),
    ends: Float64Array.of(5000, 3300, 2300, 2300, 3000, 2000),
    offsets: Int32Array.of(0, 5, 9, 12, 15, 18, 20),
    steps: Int32Array.of(
      ...[0, 1, 2, 3, 4],
      ...[0, 1, 2, 5],
      ...[1, 2, 5],
      ...[4, 3, 5],
      ...[0, 1, 2],
      ...[0, 1],
    ),
    reversed: Uint8Array.of(
      ...[0, 0, 0, 0, 0],
      ...[0, 0, 0, 0],
      ...[0, 0, 0],
      ...[1, 1, 1],
      ...[0, 0, 0],
      ...[0, 0],
    ),
  },
  departures: departureTable(),
}
const repeat = { start: 2000, end: 3000 }

// A departure of `name` along the reference, from `leavePos` to `rejoinPos`,
// with `ownBp` of its own between
const departure = (
  name: string,
  d: Partial<Departure> & Pick<Departure, 'leavePos' | 'rejoinPos'>,
): Departure => ({
  name,
  hapStart: 0,
  ownBp: 0,
  missingBp: 0,
  leaveReversed: false,
  leavePasses: 1,
  rejoinReversed: false,
  rejoinPasses: 1,
  fromSteps: false,
  ...d,
})

const rowsOf = (t: GraphTables, region = repeat) =>
  walkRowsOf(walkRowRuns(t, region)!)

test('a walk that ends inside the repeat measures from the flank it enters by', () => {
  const byLabel = Object.fromEntries(rowsOf(tables).rows.map(r => [r.label, r]))
  expect(byLabel['A#1']).toMatchObject({ bp: 1300, complete: false })
  expect(byLabel['B#1']).toMatchObject({ bp: 1300, complete: false })
  expect(byLabel['C#1']).toMatchObject({ bp: 300, complete: false })
  for (const label of ['A#1', 'B#1', 'C#1']) {
    expect(byLabel[label]!.stop).toEqual({ contigEnds: false, shortBp: 0 })
  }
  expect(byLabel['D#1']).toMatchObject({
    bp: 1000,
    complete: false,
    stop: { contigEnds: true, shortBp: 0 },
  })
  expect(byLabel['E#1']).toMatchObject({
    bp: 0,
    complete: false,
    stop: { contigEnds: true, shortBp: 0 },
  })
  expect(byLabel['A#1']!.axis).toEqual({
    contig: 'a',
    start: 2000,
    reversed: false,
  })
  expect(byLabel['C#1']!.axis).toEqual({
    contig: 'c',
    start: 2300,
    reversed: true,
  })
})

// D's contig ending on the repeat's node and E's on the left flank, with D
// leaving there for 500 bp of its own and E trimmed of 700 bp past it
test('a walk goes on past its last step by a departure there or the bp the cut trimmed past it', () => {
  const leaves = departure('D#1#d', {
    hapStart: 3000,
    ownBp: 500,
    leavePos: 3000,
    rejoinPos: 4000,
  })
  const goesOn: GraphTables = {
    ...tables,
    walks: {
      ...tables.walks,
      trimmedAfter: Float64Array.of(0, 0, 0, 0, 0, 700),
    },
    departures: departureTable([leaves]),
  }
  const byLabel = Object.fromEntries(rowsOf(goesOn).rows.map(r => [r.label, r]))
  expect(byLabel['D#1']!.stop).toEqual({
    contigEnds: false,
    shortBp: 0,
    goesOn: { departure: leaves, near: 4000 },
  })
  expect(byLabel['E#1']!.stop).toEqual({ contigEnds: false, shortBp: 0 })
})

test('a walk forward along the reference that reaches only the right flank reads toward it', () => {
  const rightOnly: GraphTables = {
    ...tables,
    walks: {
      names: ['GRCh38#0#chr1', 'F#1#f'],
      starts: Float64Array.of(0, 0),
      ends: Float64Array.of(5000, 3300),
      offsets: Int32Array.of(0, 5, 9),
      steps: Int32Array.of(...[0, 1, 2, 3, 4], ...[5, 2, 3, 4]),
      reversed: new Uint8Array(9),
    },
  }
  const [row] = rowsOf(rightOnly).rows
  expect(row!.runs).toEqual([
    { start: 0, bp: 300, onReference: false, referenceStart: undefined },
    { start: 300, bp: 1000, onReference: true, referenceStart: 2000 },
  ])
  expect(row!.axis).toEqual({ contig: 'f', start: 0, reversed: false })
})

test('tables and the Graph they load to give the same rows', () => {
  for (const t of [tables, gappedCut()]) {
    for (const region of [repeat, { start: 2500, end: 3000 }, undefined]) {
      expect(walkRowsOf(walkRowRuns(t, region, { visits: true })!)).toEqual(
        walkRows(loadGraph(t, 'cut'), region, undefined, { visits: true }),
      )
    }
  }
  expect(
    rowsOf(tables, { start: 2500, end: 3000 }).rows.find(
      r => r.label === 'E#1',
    )!.stop,
  ).toEqual({ contigEnds: true, shortBp: 500 })
})

test('walks named without a haplotype field are rows of their own, on their contigs', () => {
  const twoPart: GraphTables = {
    ...tables,
    walks: {
      ...tables.walks,
      names: ['GRCh38#0#chr1', 'A#a', 'A#b', 'C#1#c', 'D#1#d', 'E#1#e'],
    },
  }
  expect(
    rowsOf(twoPart)
      .rows.filter(r => r.sample === 'A')
      .map(({ name, label, haplotype, axis }) => ({
        name,
        label,
        haplotype,
        contig: axis?.contig,
      }))
      .sort((x, y) => x.name.localeCompare(y.name)),
  ).toEqual([
    { name: 'A#a', label: 'A', haplotype: undefined, contig: 'a' },
    { name: 'A#b', label: 'A', haplotype: undefined, contig: 'b' },
  ])
})

test('a reference cut into pieces is one reference row', () => {
  const split: GraphTables = {
    ...tables,
    walks: {
      names: ['GRCh38#0#chr1', 'GRCh38#0#chr1', 'A#1#a'],
      starts: Float64Array.of(0, 3000, 0),
      ends: Float64Array.of(2000, 5000, 5000),
      offsets: Int32Array.of(0, 2, 4, 9),
      steps: Int32Array.of(...[0, 1], ...[3, 4], ...[0, 1, 2, 3, 4]),
      reversed: new Uint8Array(9),
    },
  }
  const region = { start: 2200, end: 2800 }
  const ours = walkRowsOf(
    walkRowRuns(split, region, { referencePath: 'GRCh38#0#chr1' })!,
  )
  const graph = loadGraph(split, 'cut', { referencePath: 'GRCh38#0#chr1' })
  expect(ours).toEqual(walkRows(graph, region))
  expect(ours.rows.map(r => r.label)).toEqual(['A#1'])
  expect(ours.rows[0]).toMatchObject({ bp: 1000, complete: true })
})

// A's walk is cut 400 bp past chr1:3000 and its W line ends 600 bp later.
// B walks the reference backwards and goes on near chr1:20.3 Mb, then 300 bp
// the graph lacks, before its next W line rejoins at chr1:3000.
function gappedCut(): GraphTables {
  const t = gfaTables(
    [
      'H\tVN:Z:1.1',
      ...[1, 2, 3, 4, 5, 6, 7].map(id => `S\t${id}\t*\tLN:i:1000`),
      'W\tGRCh38\t0\tchr1\t0\t7000\t>1>2>3>4>5>6>7',
      'W\tA\t1\ta\t0\t3000\t>1>2>3',
      'W\tA\t1\ta\t4000\t7000\t>5>6>7',
      'W\tB\t1\tb\t0\t3000\t<7<6<5',
      'W\tB\t1\tb\t4000\t7000\t<3<2<1',
    ].join('\n'),
  )!
  return {
    ...t,
    walks: { ...t.walks, trimmedAfter: Float64Array.of(0, 400, 0, 0, 0) },
    departures: departureTable([
      departure('A#1#a', {
        hapStart: 3000,
        ownBp: 1000,
        missingBp: 600,
        leavePos: 3000,
        rejoinPos: 4000,
      }),
      departure('B#1#b', {
        hapStart: 3000,
        leavePos: 4000,
        leaveReversed: true,
        rejoinPos: 20_316_160,
        rejoinReversed: true,
      }),
      departure('B#1#b', {
        hapStart: 3600,
        ownBp: 400,
        missingBp: 300,
        leavePos: 20_316_900,
        leaveReversed: true,
        rejoinPos: 3000,
        rejoinReversed: true,
      }),
    ]),
  }
}

test("a gap's parts keep their causes and where the walk goes on", () => {
  const gaps = (rows: WalkRow[]) =>
    rows.map(r => [
      r.label,
      r.runs
        .filter(run => run.gap)
        .map(({ bp, cause, near }) => ({ bp, cause, near })),
    ])
  expect(
    Object.fromEntries(
      gaps(rowsOf(gappedCut(), { start: 1000, end: 6000 }).rows),
    ),
  ).toEqual({
    'A#1': [
      { bp: 400, cause: undefined, near: undefined },
      { bp: 600, cause: 'missing', near: undefined },
    ],
    'B#1': [
      { bp: 700, cause: 'elsewhere', near: 20_316_160 },
      { bp: 300, cause: 'missing', near: undefined },
    ],
  })
})

// The gapped cut as a walk-file cut states its gaps: A's 400 bp past its
// first W line are node 8, attached to its departure, then 600 bp the graph
// lacks; B's first 600 bp lie in pieces the cut did not read, then 400 bp of
// its own, 300 of them between W lines
function statedCut(): GraphTables {
  const t = gappedCut()
  const names = [...t.nodes.names, '8']
  const stretches = [
    {
      name: 'A#1#a',
      segments: [
        { kind: 0, bp: 400, missingBp: 0, before: NaN, after: NaN, steps: [7] },
        {
          kind: 3,
          bp: 600,
          missingBp: 600,
          before: NaN,
          after: NaN,
          steps: [],
        },
      ],
    },
    {
      name: 'B#1#b',
      segments: [
        {
          kind: 4,
          bp: 600,
          missingBp: 0,
          before: 20_316_160,
          after: 20_316_900,
          steps: [],
        },
        {
          kind: 3,
          bp: 400,
          missingBp: 300,
          before: NaN,
          after: NaN,
          steps: [],
        },
      ],
    },
  ]
  const segments = stretches.flatMap(g => g.segments)
  const stepOffsets = [0]
  for (const x of segments) {
    stepOffsets.push(stepOffsets.at(-1)! + x.steps.length)
  }
  return {
    ...t,
    nodes: {
      ...t.nodes,
      names,
      lengths: Int32Array.from([...t.nodes.lengths, 400]),
      refs: Int32Array.from([...t.nodes.refs, -1]),
      starts: Float64Array.from([...t.nodes.starts, 0]),
      ranks: Int32Array.from([...t.nodes.ranks, 0]),
    },
    gaps: {
      names: stretches.map(g => g.name),
      walks: Int32Array.of(1, 3),
      edges: Uint8Array.of(0, 0),
      starts: Float64Array.of(3000, 3000),
      ends: Float64Array.of(4000, 4000),
      segmentOffsets: Int32Array.of(0, 2, 4),
      segments: {
        kinds: Uint8Array.from(segments, x => x.kind),
        bp: Float64Array.from(segments, x => x.bp),
        missingBp: Float64Array.from(segments, x => x.missingBp),
        abridged: new Uint8Array(segments.length),
        before: Float64Array.from(segments, x => x.before),
        after: Float64Array.from(segments, x => x.after),
        stepOffsets: Int32Array.from(stepOffsets),
        steps: Int32Array.from(segments.flatMap(x => x.steps)),
        reversed: new Uint8Array(1),
      },
    },
  }
}

test('a gap a walk-file cut states draws its attached steps as steps and its other segments as parts, from tables and from the Graph alike', () => {
  const region = { start: 1000, end: 6000 }
  const gapsOf = (rows: WalkRow[]) =>
    Object.fromEntries(
      rows.map(r => [
        r.label,
        r.runs
          .filter(run => run.gap)
          .map(({ bp, cause, near }) => ({ bp, cause, near })),
      ]),
    )
  const fromTables = rowsOf(statedCut(), region).rows
  expect(gapsOf(fromTables)).toEqual({
    'A#1': [{ bp: 600, cause: 'missing', near: undefined }],
    'B#1': [
      { bp: 400, cause: 'mixed', near: undefined },
      { bp: 600, cause: 'unread', near: 20_316_160 },
    ],
  })
  const a = fromTables.find(r => r.label === 'A#1')!
  expect(a.runs.filter(run => !run.gap && run.bp === 400)).toHaveLength(1)
  const fromGraph = walkRowsOf(
    walkRowRuns(graphFromTables(statedCut()), region)!,
  ).rows
  expect(gapsOf(fromGraph)).toEqual(gapsOf(fromTables))
})

test("a lifted walk counts a stated gap's attached steps as its own nodes and its missing bp as missing", () => {
  const lift = walkHighlight(graphFromTables(statedCut()), 'A#1#a')!
  expect(lift.nodeIds.has('8+')).toBe(true)
  expect(lift.missingBp).toBe(600)
  expect(lift.ownBp).toBe(0)
  expect(lift.bp).toBe(6400)
})

test("a stated gap's readout gives a mixed part's amounts and where an unread walk was last seen", () => {
  const rows = Object.fromEntries(
    rowsOf(statedCut(), { start: 1000, end: 6000 }).rows.map(r => [r.label, r]),
  )
  const reference = { bp: 7000, name: 'GRCh38#0#chr1' }
  expect(walkRowReadout(rows['A#1']!, reference)).toContain(
    '0.6 kb not in the graph',
  )
  const b = walkRowReadout(rows['B#1']!, reference)
  expect(b).toContain('0.3 kb not in the graph')
  expect(b).toContain('0.1 kb of its own, not read')
  expect(b).toContain('0.6 kb not read, last seen near')
})

// GRCh38 over five 1 kb nodes; A on node 0 at 0, then the stated stretch,
// then A again
function statedTables(
  segments: {
    kind: number
    bp: number
    missingBp?: number
    steps?: number[]
  }[],
  stretch: { start: number; end: number },
  walks: { steps: number[]; start: number; end: number }[],
  abridged?: { steps: number; bp: number },
): GraphTables {
  const all = [{ steps: [0, 1, 2, 3, 4], start: 0, end: 5000 }, ...walks]
  const offsets = [0]
  for (const w of all) {
    offsets.push(offsets.at(-1)! + w.steps.length)
  }
  const stepOffsets = [0]
  for (const x of segments) {
    stepOffsets.push(stepOffsets.at(-1)! + (x.steps ?? []).length)
  }
  return {
    nodes: {
      names: ['0', '1', '2', '3', '4', '5'],
      lengths: Int32Array.of(1000, 1000, 1000, 1000, 1000, 400),
      refs: Int32Array.of(0, 0, 0, 0, 0, -1),
      starts: Float64Array.of(0, 1000, 2000, 3000, 4000, 0),
      ranks: Int32Array.of(0, 0, 0, 0, 0, 1),
      refNames: ['chr1'],
    },
    links: {
      from: new Int32Array(0),
      to: new Int32Array(0),
      strands: new Uint8Array(0),
    },
    walks: {
      names: ['GRCh38#0#chr1', ...walks.map(() => 'A#1#a')],
      starts: Float64Array.from(all, w => w.start),
      ends: Float64Array.from(all, w => w.end),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(all.flatMap(w => w.steps)),
      reversed: new Uint8Array(offsets.at(-1)!),
      trimmedBefore: new Float64Array(all.length),
      trimmedAfter: new Float64Array(all.length),
      ...(abridged
        ? {
            abridgedSteps: Float64Array.of(NaN, abridged.steps, NaN),
            abridgedBp: Float64Array.of(NaN, abridged.bp, NaN),
          }
        : {}),
    },
    departures: departureTable(),
    gaps: {
      names: ['A#1#a'],
      walks: Int32Array.of(1),
      edges: Uint8Array.of(0),
      starts: Float64Array.of(stretch.start),
      ends: Float64Array.of(stretch.end),
      segmentOffsets: Int32Array.of(0, segments.length),
      segments: {
        kinds: Uint8Array.from(segments, x => x.kind),
        bp: Float64Array.from(segments, x => x.bp),
        missingBp: Float64Array.from(segments, x => x.missingBp ?? 0),
        abridged: new Uint8Array(segments.length),
        before: Float64Array.from(segments, () => NaN),
        after: Float64Array.from(segments, () => NaN),
        stepOffsets: Int32Array.from(stepOffsets),
        steps: Int32Array.from(segments.flatMap(x => x.steps ?? [])),
        reversed: new Uint8Array(stepOffsets.at(-1)!),
      },
    },
  }
}

test('an abridged segment stays its own gap, so trimming it at a flank keeps the unread part beside it', () => {
  const t = statedTables(
    [
      { kind: 2, bp: 600 },
      { kind: 4, bp: 400 },
    ],
    { start: 1000, end: 2000 },
    [
      { steps: [0], start: 0, end: 1000 },
      { steps: [2, 3, 4], start: 2000, end: 5000 },
    ],
  )
  for (const source of [t, graphFromTables(t)]) {
    const row = walkRowsOf(walkRowRuns(source, { start: 2000, end: 3000 })!)
      .rows[0]!
    expect(row.runs.reduce((sum, run) => sum + run.bp, 0)).toBe(row.bp)
    expect(row.runs.filter(run => run.cause === 'unread')).toMatchObject([
      { bp: 400 },
    ])
  }
})

test('a lifted walk finds a stated gap after an abridged piece, which ends its abridged bp past its start', () => {
  const t = statedTables(
    [
      { kind: 0, bp: 400, steps: [5] },
      { kind: 3, bp: 600, missingBp: 600 },
    ],
    { start: 3000, end: 4000 },
    [
      { steps: [0, 2], start: 0, end: 3000 },
      { steps: [4], start: 4000, end: 5000 },
    ],
    { steps: 5, bp: 3000 },
  )
  const lift = walkHighlight(graphFromTables(t), 'A#1#a')!
  expect(lift.nodeIds.has('5+')).toBe(true)
  expect(lift.missingBp).toBe(600)
})

test("a lifted walk counts a stated row end's missing bp and steps, so none of it reads as outside", () => {
  const t = statedTables(
    [
      { kind: 3, bp: 600, missingBp: 600 },
      { kind: 0, bp: 400, steps: [5] },
    ],
    { start: 2000, end: 3000 },
    [{ steps: [0, 1], start: 0, end: 2000 }],
  )
  const lift = walkHighlight(
    graphFromTables({ ...t, gaps: { ...t.gaps!, edges: Uint8Array.of(2) } }),
    'A#1#a',
  )!
  expect(lift.nodeIds.has('5+')).toBe(true)
  expect(lift.range).toMatchObject({ start: 0, end: 3000 })
  expect(lift.bp + lift.missingBp + lift.ownBp).toBe(3000)
})

// H leaves the reference after node 0 and rejoins at node 6, and the writer
// abridged the 140 k steps and 9 kb between
const abridged: GraphTables = {
  nodes: {
    names: ['0', '1', '2', '3', '4', '5', '6'],
    lengths: Int32Array.of(1000, 1000, 1000, 1000, 1000, 1000, 1000),
    refs: Int32Array.of(0, 0, 0, 0, 0, 0, 0),
    starts: Float64Array.of(0, 1000, 2000, 3000, 4000, 5000, 6000),
    ranks: Int32Array.of(0, 0, 0, 0, 0, 0, 0),
    refNames: ['chr1'],
  },
  links: {
    from: new Int32Array(0),
    to: new Int32Array(0),
    strands: new Uint8Array(0),
  },
  walks: {
    names: ['GRCh38#0#chr1', 'H#1#h'],
    starts: Float64Array.of(0, 0),
    ends: Float64Array.of(7000, 9000),
    offsets: Int32Array.of(0, 7, 9),
    steps: Int32Array.of(0, 1, 2, 3, 4, 5, 6, 0, 6),
    reversed: new Uint8Array(9),
    abridgedSteps: Float64Array.of(Number.NaN, 140_000),
    abridgedBp: Float64Array.of(Number.NaN, 9000),
  },
  departures: departureTable(),
}

test("an abridged walk's two steps bound a gap of the bp it left out", () => {
  const [h] = rowsOf(abridged, { start: 1000, end: 6000 }).rows
  expect(h).toMatchObject({
    label: 'H#1',
    bp: 7000,
    gapBp: 7000,
    complete: true,
    abridgedSteps: 140_000,
  })
  expect(h!.estimated).toBeUndefined()
  expect(h!.runs).toEqual([
    { start: 0, bp: 7000, onReference: false, gap: true, cause: 'abridged' },
  ])
  expect(walkRowsOf(walkRowRuns(abridged)!)).toEqual(
    walkRows(loadGraph(abridged, 'cut')),
  )
})

// The reference runs nodes 0..6, a kb each, and the window is chr1:2000-4000.
// Inside the window, E visits node 7's 2.5 kb, and its abridged block ends at
// node 6, past the window. L's abridged block starts at node 0, before the
// window, and includes node 8's 500 bp, and V walks L backwards. Outside the
// window each walk follows the reference, so the trim is exact.
function walkTables(
  walks: { name: string; start: number; steps: number[]; bp?: number }[],
  reference = { start: 0, steps: [0, 1, 2, 3, 4, 5, 6] },
): GraphTables {
  const lengths = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 2500, 500]
  const all = [{ name: 'GRCh38#0#chr1', ...reference }, ...walks]
  const offsets = [0]
  for (const w of all) {
    offsets.push(offsets.at(-1)! + w.steps.length)
  }
  return {
    nodes: {
      names: lengths.map((_, i) => `${i}`),
      lengths: Int32Array.from(lengths),
      refs: Int32Array.from(lengths, (_, i) => (i < 7 ? 0 : -1)),
      starts: Float64Array.from(lengths, (_, i) => (i < 7 ? i * 1000 : 0)),
      ranks: Int32Array.from(lengths, (_, i) => (i < 7 ? 0 : -1)),
      refNames: ['chr1'],
    },
    links: abridged.links,
    walks: {
      names: all.map(w => w.name),
      starts: Float64Array.from(all, w => w.start),
      ends: Float64Array.from(
        all,
        w =>
          w.start +
          ('bp' in w && w.bp !== undefined
            ? w.bp
            : w.steps.reduce((sum, n) => sum + lengths[n]!, 0)),
      ),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(all.flatMap(w => w.steps)),
      reversed: new Uint8Array(offsets.at(-1)!),
      abridgedSteps: Float64Array.from(all, w =>
        'bp' in w && w.bp !== undefined ? 10_000 : Number.NaN,
      ),
      abridgedBp: Float64Array.from(all, w =>
        'bp' in w && w.bp !== undefined ? w.bp : Number.NaN,
      ),
    },
    departures: departureTable(),
  }
}

test('an abridged block past the window gives up the reference bp there, an estimate', () => {
  const region = { start: 2000, end: 4000 }
  const rows = (t: GraphTables) =>
    Object.fromEntries(rowsOf(t, region).rows.map(r => [r.label, r]))
  const abridgedCut = walkTables([
    { name: 'E#1#e', start: 0, steps: [0, 1, 2] },
    { name: 'E#1#e', start: 3000, steps: [3, 6], bp: 6500 },
    { name: 'L#1#l', start: 0, steps: [0, 3], bp: 4500 },
    { name: 'L#1#l', start: 4500, steps: [4, 5, 6] },
    { name: 'V#1#v', start: 0, steps: [6, 5, 4] },
    { name: 'V#1#v', start: 3000, steps: [3, 0], bp: 4500 },
  ])
  const cut = rows(abridgedCut)
  const full = rows(
    walkTables([
      { name: 'E#1#e', start: 0, steps: [0, 1, 2, 3, 7, 4, 5, 6] },
      { name: 'L#1#l', start: 0, steps: [0, 1, 2, 8, 3, 4, 5, 6] },
      { name: 'V#1#v', start: 0, steps: [6, 5, 4, 3, 8, 2, 1, 0] },
    ]),
  )
  for (const label of ['E#1', 'L#1', 'V#1']) {
    expect(cut[label]).toMatchObject({
      bp: full[label]!.bp,
      complete: true,
      estimated: true,
      axis: full[label]!.axis,
    })
    expect(full[label]!.estimated).toBeUndefined()
  }
  expect(cut['E#1']!.runs.filter(r => r.gap)).toEqual([
    { start: 2000, bp: 2500, onReference: false, gap: true, cause: 'abridged' },
  ])
  expect(walkRowReadout(cut['E#1']!, { bp: 2000 })).toBe(
    '≈ 4.5 kb (+2.5 kb) · 10 k steps, 2.5 kb not loaded',
  )
  expect(
    walkRowsKey(walkRowsOf(walkRowRuns(abridgedCut, region)!)).map(
      e => e.label,
    ),
  ).toContain(
    "abridged: steps not loaded; ≈ length takes the reference's bp past the window",
  )
})

// H runs 7.5 kb between the flanks at nodes 0 and 6: abridged pieces of 3, 2
// and 1 kb, leaving the reference at node 1 and rejoining at node 5, alternate
// with loaded 500 bp pieces on nodes 7 and 8, then 500 bp filed elsewhere
test('gaps between loaded pieces leave out the bp an abridged row drew', () => {
  const lengths = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 500, 500]
  const interleaved: GraphTables = {
    ...abridged,
    nodes: {
      names: lengths.map((_, i) => `${i}`),
      lengths: Int32Array.from(lengths),
      refs: Int32Array.of(0, 0, 0, 0, 0, 0, 0, -1, -1),
      starts: Float64Array.of(0, 1000, 2000, 3000, 4000, 5000, 6000, 0, 0),
      ranks: Int32Array.of(0, 0, 0, 0, 0, 0, 0, -1, -1),
      refNames: ['chr1'],
    },
    walks: {
      names: ['GRCh38#0#chr1', ...Array(5).fill('H#1#h')],
      starts: Float64Array.of(0, 0, 1000, 4000, 6500, 8500),
      ends: Float64Array.of(7000, 1000, 7000, 4500, 7000, 9500),
      offsets: Int32Array.of(0, 7, 8, 10, 11, 12, 13),
      steps: Int32Array.of(...[0, 1, 2, 3, 4, 5, 6], 0, 1, 5, 7, 8, 6),
      reversed: new Uint8Array(13),
      abridgedSteps: Float64Array.of(...Array(6).fill(Number.NaN)),
      abridgedBp: Float64Array.of(...Array(6).fill(Number.NaN)),
    },
    departures: departureTable([
      departure('H#1#h', {
        hapStart: 8200,
        ownBp: 300,
        leavePos: 65_536,
        rejoinPos: 6000,
      }),
    ]),
  }
  interleaved.walks.abridgedSteps![2] = 14_000
  interleaved.walks.abridgedBp![2] = 6000
  const region = { start: 1000, end: 6000 }
  const h = rowsOf(interleaved, region).rows[0]!
  expect(h).toMatchObject({
    label: 'H#1',
    bp: 7500,
    gapBp: 4500,
    complete: true,
  })
  expect(h.runs.filter(r => r.gap)).toEqual([
    { start: 1000, bp: 4000, onReference: false, gap: true, cause: 'abridged' },
    {
      start: 7000,
      bp: 500,
      onReference: false,
      gap: true,
      cause: 'elsewhere',
      near: 65_536,
    },
  ])
  expect(h.runs.reduce((sum, r) => sum + r.bp, 0)).toBe(h.bp)
  expect(walkRowReadout(h, { bp: 5000, name: 'GRCh38#0#chr1' })).toBe(
    '7.5 kb (+2.5 kb) · 14 k steps, 4.0 kb not loaded · 0.5 kb on nodes filed near chr1:66 kb',
  )
  expect(walkRowsOf(walkRowRuns(interleaved, region)!)).toEqual(
    walkRows(loadGraph(interleaved, 'cut'), region),
  )
})

// F has no step in the cut: it leaves the reference at 1500 and rejoins it at
// 3500, over the repeat, with 120 bp of its own between
const jumpF = departure('F#1#f', {
  hapStart: 900,
  ownBp: 120,
  leavePos: 1500,
  rejoinPos: 3500,
})

test('a haplotype with no step in the window draws its departure under it', () => {
  const rejoinsA = departure('A#1#a', { leavePos: 0, rejoinPos: 5000 })
  const { rows, reference } = rowsOf({
    ...tables,
    departures: departureTable([jumpF, rejoinsA]),
  })
  const f = rows.find(r => r.label === 'F#1')!
  expect(f).toMatchObject({
    name: 'F#1#f',
    sample: 'F',
    haplotype: 1,
    bp: 0,
    offReferenceBp: 120,
    gapBp: 1000,
    complete: true,
    stepless: true,
    departures: [jumpF],
  })
  expect(f.runs).toEqual([
    expect.objectContaining({
      start: 0,
      bp: 1000,
      gap: true,
      cause: 'departure',
    }),
  ])
  expect(walkRowReadout(f, reference)).toBe(
    'no step on GRCh38 across 2 kb · 120 bp of its own',
  )
  // A has a walk in the cut, which says more than its departure; the row
  // lists the departure, which no step of it draws
  const a = rows.filter(r => r.label === 'A#1')
  expect(a).toHaveLength(1)
  expect(a[0]!.stepless).toBeUndefined()
  expect(a[0]!.departures).toEqual([rejoinsA])
})

// The window starts and ends inside the repeat's node, so the reference's bar
// runs out to its flanks, 2000..3000, and F's departure runs under all of it
test("a stepless row's departure lines up under the reference's bar", () => {
  const { reference, rows } = rowsOf(
    { ...tables, departures: departureTable([jumpF]) },
    { start: 2200, end: 2800 },
  )
  expect(reference.bp).toBe(1000)
  expect(rows.find(r => r.label === 'F#1')!.runs).toEqual([
    expect.objectContaining({ start: 0, bp: 1000, cause: 'departure' }),
  ])
})

// G jumps forward over the repeat twice, the stretches overlapping, and back
// from 4500 to 2500 on a node the reference passes twice
test('a stepless row draws the reference its departures span once, and states the widest', () => {
  const g = [
    departure('G#1#g', { leavePos: 1500, rejoinPos: 2500 }),
    departure('G#1#g', { hapStart: 10, leavePos: 2200, rejoinPos: 2800 }),
    departure('G#1#g', {
      hapStart: 20,
      ownBp: 3000,
      leavePos: 4500,
      rejoinPos: 2500,
      rejoinPasses: 2,
    }),
  ]
  const { rows, reference } = rowsOf({
    ...tables,
    departures: departureTable(g),
  })
  const row = rows.find(r => r.label === 'G#1')!
  expect(row.runs.map(({ start, bp, cause }) => [start, bp, cause])).toEqual([
    [0, 1000, 'departure'],
  ])
  expect(row).toMatchObject({
    gapBp: 1000,
    offReferenceBp: 3000,
    placementChoice: true,
  })
  expect(walkRowReadout(row, reference)).toBe(
    'rejoins GRCh38 2 kb back · 3 kb of its own · placement choice · 2 more departures',
  )
  const narrowPlaced = rowsOf({
    ...tables,
    departures: departureTable([
      { ...g[0]!, leavePasses: 2 },
      { ...g[2]!, rejoinPasses: 1 },
    ]),
  })
  expect(
    walkRowReadout(
      narrowPlaced.rows.find(r => r.label === 'G#1')!,
      narrowPlaced.reference,
    ),
  ).toBe(
    'rejoins GRCh38 2 kb back · 3 kb of its own · 1 more departure · placement choice',
  )
})

test("the reference's own departures make no row", () => {
  const own = departure('GRCh38#0#chr1', { leavePos: 1500, rejoinPos: 3500 })
  expect(
    rowsOf({ ...tables, departures: departureTable([own]) }).rows.map(
      r => r.label,
    ),
  ).toEqual(rowsOf(tables).rows.map(r => r.label))
})

test('loadGraph keeps the departures, so walk rows of the Graph draw the stepless rows too', () => {
  const departing = { ...tables, departures: departureTable([jumpF]) }
  const ofGraph = walkRows(loadGraph(departing, 'cut'), repeat)!
  expect(ofGraph).toEqual(rowsOf(departing))
  expect(ofGraph.rows.find(r => r.label === 'F#1')).toMatchObject({
    gapBp: 1000,
  })
})

test('a cut whose only other haplotypes have no step in it still has rows', () => {
  const reference: GraphTables = {
    ...tables,
    walks: {
      ...tables.walks,
      names: tables.walks.names.slice(0, 1),
      starts: tables.walks.starts.slice(0, 1),
      ends: tables.walks.ends.slice(0, 1),
      offsets: tables.walks.offsets.slice(0, 2),
    },
    departures: departureTable([jumpF]),
  }
  expect(rowsOf(reference).rows.map(r => r.label)).toEqual(['F#1'])
  expect(
    walkRowRuns({ ...reference, departures: departureTable() }, repeat),
  ).toBeUndefined()
})

// In a hosted KIV-2 cut the reference walk visits the nodes near the
// window, here 1..4. E's abridged block rejoins at node 6 and L's leaves at
// node 0, both past it, so their rank 0 positions place them.
test("an abridged block's handle past the cut's reference still flanks it", () => {
  const region = { start: 2000, end: 3000 }
  const reference = { start: 1000, steps: [1, 2, 3, 4] }
  const abridgedCut = walkTables(
    [
      { name: 'E#1#e', start: 0, steps: [1] },
      { name: 'E#1#e', start: 1000, steps: [2, 6], bp: 7500 },
      { name: 'L#1#l', start: 0, steps: [0, 2], bp: 3500 },
      { name: 'L#1#l', start: 3500, steps: [3, 4] },
    ],
    reference,
  )
  const fullCut = walkTables(
    [
      { name: 'E#1#e', start: 0, steps: [1, 2, 7, 3, 4] },
      { name: 'L#1#l', start: 0, steps: [0, 1, 8, 2, 3, 4] },
    ],
    reference,
  )
  const rows = (t: GraphTables) =>
    Object.fromEntries(rowsOf(t, region).rows.map(r => [r.label, r]))
  const cut = rows(abridgedCut)
  const full = rows(fullCut)
  expect(full['E#1']).toMatchObject({ bp: 3500, complete: true })
  expect(full['L#1']).toMatchObject({ bp: 1500, complete: true })
  for (const label of ['E#1', 'L#1']) {
    expect(cut[label]).toMatchObject({
      bp: full[label]!.bp,
      complete: true,
      estimated: true,
      axis: full[label]!.axis,
    })
  }
  expect(walkRowsOf(walkRowRuns(abridgedCut, region)!)).toEqual(
    walkRows(loadGraph(abridgedCut, 'cut'), region),
  )
})
