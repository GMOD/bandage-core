import { departureTable } from '../gfa/departures'
import { gfaTables } from '../gfa/gfaTables'
import { graphFromTables } from '../gfa/graphTables'
import { loadGraph } from '../pipeline'
import { fadedKey, walkHighlight } from '../walkHighlight'
import { walkRowReadout } from './walkRowDraw'
import { walkRowRuns, walkRowsOf } from './walkRowRuns'
import { walkRows } from './walkRows'

import type { Departure } from '../gfa/departures'
import type { GraphTables } from '../gfa/graphTables'
import type { WalkRow } from './walkRows'

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
    steps: Int32Array.from(
      [
        [0, 1, 2, 3, 4],
        [0, 1, 2, 5],
        [1, 2, 5],
        [4, 3, 5],
        [0, 1, 2],
        [0, 1],
      ].flat(),
    ),
    reversed: Uint8Array.from(
      [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
        [0, 0],
      ].flat(),
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
      steps: Int32Array.from(
        [
          [0, 1, 2, 3, 4],
          [5, 2, 3, 4],
        ].flat(),
      ),
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
      steps: Int32Array.from(
        [
          [0, 1],
          [3, 4],
          [0, 1, 2, 3, 4],
        ].flat(),
      ),
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
          kind: 2,
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
          kind: 3,
          bp: 600,
          missingBp: 0,
          before: 20_316_160,
          after: 20_316_900,
          steps: [],
        },
        {
          kind: 2,
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
    '0.6 kb left out of graph',
  )
  const b = walkRowReadout(rows['B#1']!, reference)
  expect(b).toContain('0.3 kb left out of graph')
  expect(b).toContain('0.1 kb own sequence not drawn')
  expect(b).toContain('0.6 kb not drawn (last seen near')
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
        before: Float64Array.from(segments, () => NaN),
        after: Float64Array.from(segments, () => NaN),
        stepOffsets: Int32Array.from(stepOffsets),
        steps: Int32Array.from(segments.flatMap(x => x.steps ?? [])),
        reversed: new Uint8Array(stepOffsets.at(-1)!),
      },
    },
  }
}

test("a lifted walk counts a stated row end's missing bp and steps, so none of it reads as outside", () => {
  const t = statedTables(
    [
      { kind: 2, bp: 600, missingBp: 600 },
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

test('a lifted walk takes the link into attached steps that follow its piece on the contig, and not one across sequence it did not read', () => {
  const t = statedTables(
    [
      { kind: 0, bp: 400, steps: [5] },
      { kind: 2, bp: 600, missingBp: 600 },
    ],
    { start: 2000, end: 3000 },
    [
      { steps: [0, 1], start: 0, end: 2000 },
      { steps: [3, 4], start: 3000, end: 5000 },
    ],
  )
  const graph = graphFromTables({
    ...t,
    links: {
      from: Int32Array.of(1, 5),
      to: Int32Array.of(5, 3),
      strands: new Uint8Array(2),
    },
  })
  const lift = walkHighlight(graph, 'A#1#a')!
  const linked = [...lift.edgeIndexes].map(
    i => `${graph.edges[i]!.from}>${graph.edges[i]!.to}`,
  )
  expect(linked).toContain('1+>5+')
  expect(linked).not.toContain('5+>3+')
})

test('two pieces that abut still draw a 0 bp step the cut attached between them', () => {
  const t = statedTables(
    [{ kind: 0, bp: 0, steps: [5] }],
    { start: 1000, end: 1000 },
    [
      { steps: [0], start: 0, end: 1000 },
      { steps: [1, 2, 3, 4], start: 1000, end: 5000 },
    ],
  )
  const zero = {
    ...t,
    nodes: {
      ...t.nodes,
      lengths: Int32Array.of(1000, 1000, 1000, 1000, 1000, 0),
    },
  }
  const runs = walkRowRuns(zero, { start: 1000, end: 2000 }, { visits: true })!
  const v = runs.visits!
  const row = Array.from({ length: v.offsets.length - 1 }, (_, i) => i).find(
    i => runs.rows[i]!.label === 'A#1',
  )!
  const visited = []
  for (let k = v.offsets[row]!; k < v.offsets[row + 1]!; k++) {
    visited.push(v.names[v.node[k]!])
  }
  expect(visited).toContain('5+')
})

// A stops on node 2 inside the window and goes on by a departure there: its
// row's end states 400 bp of attached steps on node 5, then 100 bp read
function rowEndCut(edge: number, walk = { steps: [0, 1, 2], end: 3000 }) {
  const t = statedTables(
    [
      { kind: 0, bp: 400, steps: [5] },
      { kind: 1, bp: 100 },
    ],
    { start: walk.end, end: walk.end + 500 },
    [{ steps: walk.steps, start: 0, end: walk.end }],
  )
  return {
    ...t,
    walks: { ...t.walks, trimmedAfter: Float64Array.of(0, 500) },
    departures: departureTable([
      departure('A#1#a', {
        hapStart: walk.end,
        ownBp: 500,
        leavePos: walk.end,
        rejoinPos: 9000,
      }),
    ]),
    gaps: {
      ...t.gaps!,
      edges: Uint8Array.of(edge),
      walks: Int32Array.of(edge === 3 ? -1 : 1),
    },
  }
}

test("a partial row draws its stated row end past its last fragment, and its readout leaves the departure's own bp to it", () => {
  const region = { start: 2000, end: 3000 }
  const row = rowsOf(rowEndCut(2), region).rows[0]!
  expect(row.complete).toBe(false)
  expect(row.runs.slice(-2)).toMatchObject([
    { bp: 400, onReference: false },
    { bp: 100, gap: true },
  ])
  expect(row.stop?.goesOn).toMatchObject({ near: 9000, drawn: true })
  expect(
    walkRowReadout(row, { bp: 5000, name: 'GRCh38#0#chr1' }),
  ).not.toContain('of its own')
})

test('a complete row draws the same bar with or without a stated row end past its flank', () => {
  const region = { start: 2000, end: 3000 }
  const t = rowEndCut(2, { steps: [0, 1, 2, 3, 4], end: 5000 })
  expect(rowsOf(t, region).rows[0]!.runs).toEqual(
    rowsOf({ ...t, gaps: undefined }, region).rows[0]!.runs,
  )
})

test('a row states its departures outside it in the readout, and draws none of them', () => {
  const region = { start: 2000, end: 3000 }
  const t = rowEndCut(3, { steps: [0, 1, 2, 3, 4], end: 5000 })
  const row = rowsOf(t, region).rows[0]!
  expect(row.outsideRow).toEqual({ count: 1, stepsBp: 400 })
  expect(walkRowReadout(row, { bp: 5000, name: 'GRCh38#0#chr1' })).toContain(
    '1 departure outside the row, 0.4 kb of its own in the graph',
  )
  expect(row.runs).toEqual(
    rowsOf({ ...t, gaps: undefined }, region).rows[0]!.runs,
  )
})

test("a lifted walk takes a departure's attached steps outside its row at their place on the contig", () => {
  const t = rowEndCut(3, { steps: [0, 1], end: 2000 })
  const far = {
    ...t,
    gaps: {
      ...t.gaps,
      starts: Float64Array.of(10_000),
      ends: Float64Array.of(10_500),
    },
  }
  const lift = walkHighlight(graphFromTables(far), 'A#1#a')!
  expect(lift.nodeIds.has('5+')).toBe(true)
  expect(lift.range).toMatchObject({ start: 0, end: 10_400 })
  expect(lift.progress.get('5+')).toBeCloseTo(10_200 / 10_400)
  expect(lift.readBp).toBe(0)
})

test("a lifted walk's range stops at its last drawn step, so a row end's read bp past it neither counts nor lengthens it", () => {
  const lift = walkHighlight(graphFromTables(rowEndCut(2)), 'A#1#a')!
  expect(lift.range).toMatchObject({ start: 0, end: 3400 })
  expect(lift.readBp).toBe(0)
  expect(lift.bp).toBe(3400)
})

test('a walk with no fragment lifts from its stated departures, and another walk’s attached steps are not faded as off every walk', () => {
  const t = rowEndCut(3, { steps: [0, 1], end: 2000 })
  const lone = {
    ...t,
    walks: {
      ...t.walks,
      names: ['GRCh38#0#chr1'],
      starts: t.walks.starts.subarray(0, 1),
      ends: t.walks.ends.subarray(0, 1),
      offsets: t.walks.offsets.subarray(0, 2),
      trimmedBefore: t.walks.trimmedBefore!.subarray(0, 1),
      trimmedAfter: t.walks.trimmedAfter.subarray(0, 1),
    },
  }
  const graph = graphFromTables(lone)
  const lift = walkHighlight(graph, 'A#1#a')!
  expect([...lift.nodeIds]).toEqual(['5+'])
  const reference = walkHighlight(graph, 'GRCh38#0#chr1')!
  expect(
    fadedKey(
      graph,
      {
        walks: [],
        nodeIds: reference.nodeIds,
        edgeIndexes: reference.edgeIndexes,
        names: new Set(['GRCh38#0#chr1']),
      },
      'GRCh38',
    ),
  ).toBe('only in other haplotypes')
})

test('a complete row with no flanks keeps its bar to its fragments, whatever its stated ends', () => {
  const t = rowEndCut(2, { steps: [0, 1, 2, 3, 4], end: 5000 })
  const whole = { start: 0, end: 5000 }
  const row = rowsOf(t, whole).rows[0]!
  const plain = rowsOf({ ...t, gaps: undefined }, whole).rows[0]!
  expect(row.complete).toBe(true)
  expect(row.runs).toEqual(plain.runs)
  expect(row.axis).toEqual(plain.axis)
})

test('a stepless row does not count its own departures as outside it', () => {
  const t = rowEndCut(3, { steps: [0, 1], end: 2000 })
  const lone = {
    ...t,
    walks: {
      ...t.walks,
      names: ['GRCh38#0#chr1'],
      starts: t.walks.starts.subarray(0, 1),
      ends: t.walks.ends.subarray(0, 1),
      offsets: t.walks.offsets.subarray(0, 2),
      trimmedBefore: t.walks.trimmedBefore!.subarray(0, 1),
      trimmedAfter: t.walks.trimmedAfter.subarray(0, 1),
    },
  }
  const row = rowsOf(lone, { start: 2000, end: 3000 }).rows[0]!
  expect(row.stepless).toBe(true)
  expect(row.outsideRow).toBeUndefined()
  expect(
    walkRowReadout(row, { bp: 5000, name: 'GRCh38#0#chr1' }),
  ).not.toContain('outside the row')
})

test('a lifted walk takes the links through a 0 bp step between two abutting pieces', () => {
  const t = statedTables(
    [{ kind: 0, bp: 0, steps: [5] }],
    { start: 1000, end: 1000 },
    [
      { steps: [0], start: 0, end: 1000 },
      { steps: [1, 2, 3, 4], start: 1000, end: 5000 },
    ],
  )
  const graph = graphFromTables({
    ...t,
    nodes: {
      ...t.nodes,
      lengths: Int32Array.of(1000, 1000, 1000, 1000, 1000, 0),
    },
    links: {
      from: Int32Array.of(0, 5),
      to: Int32Array.of(5, 1),
      strands: new Uint8Array(2),
    },
  })
  const lift = walkHighlight(graph, 'A#1#a')!
  expect(
    [...lift.edgeIndexes].map(
      i => `${graph.edges[i]!.from}>${graph.edges[i]!.to}`,
    ),
  ).toEqual(expect.arrayContaining(['0+>5+', '5+>1+']))
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
