import { walkRowReadout, walkRowsKey } from './walkRowDraw'
import { walkRowRuns, walkRowsOf } from './walkRowRuns'
import { walkRows } from './walkRows'
import { gfaTables } from '../gfa/gfaTables'
import { StopColumns } from '../gfa/walkStops'
import { loadGraph } from '../pipeline'

import type { WalkRow } from './walkRows'
import type { GraphTables } from '../gfa/graphTables'
import type { PathStop } from '../types'

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
}
const repeat = { start: 2000, end: 3000 }

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
  const text = [
    'H\tVN:Z:1.1',
    ...[1, 2, 3, 4, 5, 6, 7].map(id => `S\t${id}\t*\tLN:i:1000`),
    'W\tGRCh38\t0\tchr1\t0\t7000\t>1>2>3>4>5>6>7\tws:Z:end\twe:Z:end',
    'W\tA\t1\ta\t0\t3000\t>1>2>3\tws:Z:end\twe:Z:break,bp=600,trimmed=400',
    'W\tA\t1\ta\t4000\t7000\t>5>6>7\tws:Z:break,bp=600\twe:Z:end',
    'W\tB\t1\tb\t0\t3000\t<7<6<5\tws:Z:end\twe:Z:elsewhere,chunk=GRCh38#0#chr1:20316160',
    'W\tB\t1\tb\t4000\t7000\t<3<2<1\tws:Z:break,bp=300\twe:Z:end',
  ].join('\n')
  for (const t of [tables, gfaTables(text)!]) {
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

test("a gap's parts keep their causes and chunk", () => {
  const S = [1, 2, 3, 4, 5, 6, 7].map(id => `S\t${id}\t*\tLN:i:1000`)
  const text = [
    'H\tVN:Z:1.1',
    ...S,
    'W\tGRCh38\t0\tchr1\t0\t7000\t>1>2>3>4>5>6>7\tws:Z:end\twe:Z:end',
    'W\tA\t1\ta\t0\t3000\t>1>2>3\tws:Z:end\twe:Z:break,bp=600,trimmed=400',
    'W\tA\t1\ta\t4000\t7000\t>5>6>7\tws:Z:break,bp=600\twe:Z:end',
    'W\tB\t1\tb\t0\t3000\t<7<6<5\tws:Z:end\twe:Z:elsewhere,chunk=GRCh38#0#chr1:20316160',
    'W\tB\t1\tb\t4000\t7000\t<3<2<1\tws:Z:break,bp=300\twe:Z:end',
  ].join('\n')
  const gaps = (rows: WalkRow[]) =>
    rows.map(r => [
      r.label,
      r.runs
        .filter(run => run.gap)
        .map(({ bp, cause, chunk }) => ({ bp, cause, chunk })),
    ])
  const chunk = { refName: 'GRCh38#0#chr1', start: 20316160 }
  expect(
    Object.fromEntries(
      gaps(rowsOf(gfaTables(text)!, { start: 1000, end: 6000 }).rows),
    ),
  ).toEqual({
    'A#1': [
      { bp: 400, cause: undefined, chunk: undefined },
      { bp: 600, cause: 'missing', chunk: undefined },
    ],
    'B#1': [
      { bp: 300, cause: 'missing', chunk: undefined },
      { bp: 700, cause: 'elsewhere', chunk },
    ],
  })
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
  const chunk = { refName: 'GRCh38#0#chr1', start: 65536 }
  const elsewhere = (bp: number): PathStop => ({ kind: 'elsewhere', chunk, bp })
  const end: PathStop = { kind: 'end' }
  const stops = (list: PathStop[]) => {
    const columns = new StopColumns()
    list.forEach(stop => {
      columns.push(stop)
    })
    return columns.table()
  }
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
      before: stops([
        end,
        end,
        elsewhere(0),
        elsewhere(-3000),
        elsewhere(2000),
        elsewhere(1500),
      ]),
      after: stops([
        end,
        elsewhere(0),
        elsewhere(-3000),
        elsewhere(2000),
        elsewhere(1500),
        end,
      ]),
      abridgedSteps: Float64Array.of(...Array(6).fill(Number.NaN)),
      abridgedBp: Float64Array.of(...Array(6).fill(Number.NaN)),
    },
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
      chunk,
    },
  ])
  expect(h.runs.reduce((sum, r) => sum + r.bp, 0)).toBe(h.bp)
  expect(walkRowReadout(h, { bp: 5000 })).toBe(
    '7.5 kb (+2.5 kb) · 14 k steps, 4.0 kb not loaded · 0.5 kb on nodes filed near chr1:66 kb',
  )
  expect(walkRowsOf(walkRowRuns(interleaved, region)!)).toEqual(
    walkRows(loadGraph(interleaved, 'cut'), region),
  )
})

// F's walk-file skip row: it jumps from 1500 to 3500 over the repeat
test('a haplotype that jumps over the window draws as a deletion under it', () => {
  const skips = {
    names: ['F#1#f', 'A#1#a'],
    starts: Float64Array.of(1500, 0),
    ends: Float64Array.of(3500, 5000),
  }
  const { rows } = rowsOf({ ...tables, skips })
  const f = rows.find(r => r.label === 'F#1')!
  expect(f).toMatchObject({
    name: 'F#1#f',
    sample: 'F',
    haplotype: 1,
    bp: 0,
    gapBp: 1000,
    complete: true,
  })
  expect(f.runs).toEqual([
    expect.objectContaining({
      start: 0,
      bp: 1000,
      gap: true,
      cause: 'deleted',
    }),
  ])
  // A has a walk in the cut, which says more than its skip row
  expect(rows.filter(r => r.label === 'A#1')).toHaveLength(1)
})

test('a cut whose only other haplotypes jump over the window still has rows', () => {
  const reference: GraphTables = {
    ...tables,
    walks: {
      ...tables.walks,
      names: tables.walks.names.slice(0, 1),
      starts: tables.walks.starts.slice(0, 1),
      ends: tables.walks.ends.slice(0, 1),
      offsets: tables.walks.offsets.slice(0, 2),
    },
    skips: {
      names: ['F#1#f'],
      starts: Float64Array.of(1500),
      ends: Float64Array.of(3500),
    },
  }
  expect(rowsOf(reference).rows.map(r => r.label)).toEqual(['F#1'])
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
