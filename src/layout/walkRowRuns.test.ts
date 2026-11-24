import fs from 'node:fs'

import { bubbleSubgraph } from '../bubbles/popBubble'
import { deletionEdges } from '../deletionEdges'
import { serializeEl } from '../el'
import { departureTable } from '../gfa/departures'
import { gfaTables } from '../gfa/gfaTables'
import { graphFromTables } from '../gfa/graphTables'
import { loadGraph } from '../pipeline'
import { fadedKey, walkHighlight } from '../walkHighlight'
import { trimToWindow } from './trimToWindow'
import {
  barEnd,
  placeRowGenes,
  walkRowReadout,
  walkRowsKey,
  walkRowsTree,
} from './walkRowDraw'
import { walkRowLinks } from './walkRowLinks'
import { walkRowRuns, walkRowsOf } from './walkRowRuns'
import { contigAlong, walkRows } from './walkRows'

import type { Departure } from '../gfa/departures'
import type { GraphTables } from '../gfa/graphTables'
import type { Graph } from '../types'
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
    trimmedBefore: new Float64Array(6),
    trimmedAfter: new Float64Array(6),
  },
  departures: departureTable(),
  revisited: 0,
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
  for (const label of ['A#1', 'B#1']) {
    expect(byLabel[label]!.stops).toEqual({
      right: { contigEnds: false, shortBp: 0 },
    })
  }
  expect(byLabel['C#1']!.stops).toEqual({
    right: { contigEnds: false, shortBp: 0 },
  })
  expect(byLabel['D#1']).toMatchObject({
    bp: 1000,
    complete: false,
    stops: { right: { contigEnds: true, shortBp: 0 } },
  })
  expect(byLabel['E#1']).toMatchObject({
    bp: 0,
    complete: false,
    stops: { right: { contigEnds: true, shortBp: 0 } },
  })
  expect(byLabel['A#1']!.axis).toEqual({ contig: 'a', start: 2000 })
  expect(byLabel['C#1']!.axis).toEqual({ contig: 'c', start: 2000 })
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
  expect(byLabel['D#1']!.stops).toEqual({
    right: {
      contigEnds: false,
      shortBp: 0,
      goesOn: { departure: leaves, near: 4000 },
    },
  })
  expect(byLabel['E#1']!.stops).toEqual({
    right: { contigEnds: false, shortBp: 0 },
  })
})

// G's and H's first W lines start on the repeat's node, 9,183,247 bp into G's
// contig, as HG00128#1's does at R1M-05 of the HPRC v2.1 audit, and at H's
// contig start
test('a walk whose first W line starts inside the window says where its contig starts, not that it ends', () => {
  const startsInside: GraphTables = {
    ...tables,
    walks: {
      names: ['GRCh38#0#chr1', 'G#1#g', 'H#1#h'],
      starts: Float64Array.of(0, 9_183_247, 0),
      ends: Float64Array.of(5000, 9_186_247, 3000),
      offsets: Int32Array.of(0, 5, 8, 11),
      steps: Int32Array.from([0, 1, 2, 3, 4, 2, 3, 4, 2, 3, 4]),
      reversed: new Uint8Array(11),
      trimmedBefore: new Float64Array(3),
      trimmedAfter: new Float64Array(3),
    },
  }
  const rows = rowsOf(startsInside)
  expect(
    Object.fromEntries(
      rows.rows.map(r => [r.label, walkRowReadout(r, rows.reference)]),
    ),
  ).toEqual({
    'G#1': '≥ 1.0 kb · 9.2 Mb before it not drawn or left out of graph',
    'H#1': '≥ 1.0 kb · contig starts inside the window',
  })
  expect(rows.rows[0]!.stops).toEqual({
    left: { contigEnds: true, shortBp: 0, start: true, contigStart: 9_183_247 },
  })
})

// D leaves on the repeat's node by a departure whose own bp all lie between
// its contig's W lines, as HG01960#1's 5,631,835 bp do at R1M-05 of the HPRC
// v2.1 audit, or a part of them
test('a walk that goes on by a departure says how much of its own bp the graph lacks', () => {
  const readout = (missingBp: number) => {
    const goesOn: GraphTables = {
      ...tables,
      departures: departureTable([
        departure('D#1#d', {
          hapStart: 3000,
          ownBp: 5_631_835,
          missingBp,
          leavePos: 3000,
          rejoinPos: 4000,
        }),
      ]),
    }
    const rows = rowsOf(goesOn)
    return walkRowReadout(
      rows.rows.find(r => r.label === 'D#1')!,
      rows.reference,
    )
  }
  expect(readout(5_631_835)).toBe(
    '≥ 1.0 kb · goes on near chr1:4 kb · 5.6 Mb left out of graph',
  )
  expect(readout(1_000_000)).toBe(
    '≥ 1.0 kb · goes on near chr1:4 kb · 5.6 Mb of its own, 1 Mb of it left out of graph',
  )
})

// R1M-05 of the HPRC v2.1 audit: every row starts 69% into the window. G's
// contig starts on node 2, 1 kb into chr1:1000-4000, and its bar starts at the
// left like any other, its colour saying where on the reference it is
test('a row whose walk starts inside the window starts at the left, and its genes with it', () => {
  const startsLate: GraphTables = {
    ...tables,
    walks: {
      names: ['GRCh38#0#chr1', 'G#1#g'],
      starts: Float64Array.of(0, 0),
      ends: Float64Array.of(5000, 3000),
      offsets: Int32Array.of(0, 5, 8),
      steps: Int32Array.from([0, 1, 2, 3, 4, 2, 3, 4]),
      reversed: new Uint8Array(8),
      trimmedBefore: new Float64Array(2),
      trimmedAfter: new Float64Array(2),
    },
  }
  const rows = walkRowsOf(
    walkRowRuns(startsLate, { start: 1000, end: 4000 }, { visits: true })!,
  )
  const [row] = rows.rows
  expect(row!.runs).toEqual([
    { start: 0, bp: 2000, onReference: true, referenceStart: 2000 },
  ])
  expect(row!.visits!.map(v => v.start)).toEqual([0, 1000])
  expect(row!.axis).toEqual({ contig: 'g', start: 0 })
  expect(
    placeRowGenes(
      rows.rows,
      new Map([
        [
          'G#1#g',
          [
            {
              name: 'X',
              refName: 'g',
              start: 500,
              end: 700,
              strand: 1,
              exons: [],
            },
          ],
        ],
      ]),
    ).get('G#1#g'),
  ).toEqual([{ name: 'X', start: 500, end: 700, exons: [] }])
  expect(walkRowsKey(rows, { ruler: true }).at(-1)).toEqual({
    swatch: { kind: 'gene' },
    label:
      "each row is that haplotype's own sequence, not on the ruler's scale",
    note: true,
  })
})

// R1M-06 of the HPRC v2.1 audit: rows crossing a 1 Mb window twice hold 3.9
// Mb of contig away from it between, which drew every other bar a fifth as
// wide. W walks chr1:1000-4000's nodes 1 and 2, then 7 kb away from the
// window by two departures, then 2 and 3 again.
test('a stretch away from the window draws as a break at most one width, and the axis keeps genes and the strip on the contig', () => {
  const twice: GraphTables = {
    ...tables,
    departures: departureTable([
      departure('W#1#w', {
        hapStart: 3000,
        leavePos: 3000,
        rejoinPos: 90_000,
      }),
      departure('W#1#w', {
        hapStart: 9500,
        ownBp: 500,
        leavePos: 96_500,
        rejoinPos: 2000,
      }),
    ]),
    walks: {
      names: ['GRCh38#0#chr1', 'W#1#w', 'W#1#w'],
      starts: Float64Array.of(0, 0, 10_000),
      ends: Float64Array.of(5000, 3000, 13_000),
      offsets: Int32Array.of(0, 5, 8, 11),
      steps: Int32Array.from([0, 1, 2, 3, 4, 0, 1, 2, 2, 3, 4]),
      reversed: new Uint8Array(11),
    },
  }
  const rows = rowsOf(twice, { start: 1000, end: 4000 })
  const [row] = rows.rows
  expect(row!.runs).toEqual([
    { start: 0, bp: 2000, onReference: true, referenceStart: 1000 },
    {
      start: 2000,
      bp: 45,
      onReference: false,
      gap: true,
      cause: 'away',
      heldBp: 7000,
    },
    { start: 2045, bp: 2000, onReference: true, referenceStart: 2000 },
  ])
  expect(row!.axis).toEqual({
    contig: 'w',
    start: 1000,
    breaks: [{ at: 2000, bp: 7000, drawn: 45 }],
  })
  expect(walkRowReadout(row!, rows.reference)).toBe(
    '11 kb of its contig, of which 7.0 kb away from the window',
  )
  expect(
    placeRowGenes(
      rows.rows,
      new Map([
        [
          'W#1#w',
          [
            {
              name: 'X',
              refName: 'w',
              start: 10_500,
              end: 10_700,
              strand: 1,
              exons: [],
            },
          ],
        ],
      ]),
    ).get('W#1#w'),
  ).toEqual([{ name: 'X', start: 2545, end: 2745, exons: [] }])
  expect(contigAlong(row!.axis!, 2545)).toBe(9500)
  expect(walkRowsKey(rows).at(-1)!.label).toBe(
    '// marks a stretch away from the window drawn shorter than its bp; the text beside the row sums the bp it spends away',
  )
})

// The walks' own pieces on chr1:0-5000, a kb a node, with trimmed bp stated
const walkFile = (
  walks: { name: string; start: number; steps: number[]; reversed: number[] }[],
  departures: Departure[] = [],
): GraphTables => {
  const all = [
    {
      name: 'GRCh38#0#chr1',
      start: 0,
      steps: [0, 1, 2, 3, 4],
      reversed: [0, 0, 0, 0, 0],
    },
    ...walks,
  ]
  const offsets = [0]
  for (const w of all) {
    offsets.push(offsets.at(-1)! + w.steps.length)
  }
  return {
    ...tables,
    walks: {
      names: all.map(w => w.name),
      starts: Float64Array.from(all, w => w.start),
      ends: Float64Array.from(all, w => w.start + w.steps.length * 1000),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(all.flatMap(w => w.steps)),
      reversed: Uint8Array.from(all.flatMap(w => w.reversed)),
      trimmedBefore: new Float64Array(all.length),
      trimmedAfter: new Float64Array(all.length),
    },
    departures: departureTable(departures),
  }
}

// S's contig is stored back to front and crosses chr1:1000-4000 twice: nodes
// 3 to 1 against the reference, then, 5 kb on, 3 and 2 again
test('a row stored back to front that crosses the window twice reads in stored order, every step on the reference reversed', () => {
  const rows = rowsOf(
    walkFile([
      {
        name: 'S#1#s',
        start: 0,
        steps: [4, 3, 2, 1, 0],
        reversed: [1, 1, 1, 1, 1],
      },
      { name: 'S#1#s', start: 10_000, steps: [4, 3, 2], reversed: [1, 1, 1] },
    ]),
    { start: 1000, end: 4000 },
  )
  const [row] = rows.rows
  expect(row).not.toHaveProperty('flipped')
  const walked = row!.runs.filter(run => !run.gap)
  expect(walked.length).toBeGreaterThan(0)
  expect(walked.every(run => run.reversed)).toBe(true)
  const text = walkRowReadout(row!, rows.reference)
  expect(text).toContain('5.0 kb reversed')
  expect(text).not.toContain('right to left')
})

// I walks chr1:0-5000 with nodes 1 to 3 inverted between forward flanks
test('a row with an inversion between forward flanks reads forward and marks the inversion reversed', () => {
  const rows = rowsOf(
    walkFile([
      {
        name: 'I#1#i',
        start: 0,
        steps: [0, 3, 2, 1, 4],
        reversed: [0, 1, 1, 1, 0],
      },
    ]),
    { start: 1000, end: 4000 },
  )
  const [row] = rows.rows
  expect(row!.runs).toEqual([
    {
      start: 0,
      bp: 3000,
      onReference: true,
      referenceStart: 1000,
      reversed: true,
    },
  ])
})

// J's contig starts on node 3 inside chr1:1000-4000 and walks 3 and 2 against
// the reference, then switches strand back to 4: its bar starts at the left,
// with no place under the reference claimed for it
test('a row whose walk starts inside the window against the reference starts at the left', () => {
  const rows = rowsOf(
    walkFile(
      [{ name: 'J#1#j', start: 0, steps: [3, 2, 4], reversed: [1, 1, 0] }],
      [
        departure('J#1#j', {
          hapStart: 2000,
          leavePos: 2000,
          leaveReversed: true,
          rejoinPos: 4000,
        }),
      ],
    ),
    { start: 1000, end: 4000 },
  )
  const [row] = rows.rows
  expect(row!.runs[0]).toMatchObject({
    start: 0,
    bp: 2000,
    referenceStart: 2000,
    reversed: true,
  })
  expect(row!.axis).not.toHaveProperty('offset')
})

// K starts on node 2, chr1:2000-3000, across the left edge of chr1:2500-4000;
// L on node 4, past chr1:1000-3500's right edge
test("a contig's start is said before or past the window where its first node lies outside it", () => {
  const readout = (steps: number[], region: { start: number; end: number }) => {
    const rows = rowsOf(
      walkFile([
        { name: 'K#1#k', start: 0, steps, reversed: steps.map(() => 0) },
      ]),
      region,
    )
    return walkRowReadout(rows.rows[0]!, rows.reference)
  }
  expect(readout([2, 3], { start: 2500, end: 4000 })).toBe(
    '1.5 kb · contig starts 500 bp before the window · no more of the contig on GRCh38 chr1',
  )
  expect(readout([4], { start: 1000, end: 3500 })).toBe(
    'last step on GRCh38 chr1 500 bp past the window',
  )
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
  expect(row!.axis).toEqual({ contig: 'f', start: 0 })
})

// GRCh38 over chr1:0-10,000 in ten 1 kb nodes, 0 to 9, and node 10, 300 bp
// off it; each other walk is one piece of a walk file from contig 0, stepped
// as `>0>1<2` writes it
const tenKb = (walks: Record<string, string>): GraphTables => {
  const parse = (path: string) =>
    [...path.matchAll(/([<>])(\d+)/g)].map(m => ({
      node: Number(m[2]),
      reversed: m[1] === '<' ? 1 : 0,
    }))
  const all = [
    ['GRCh38#0#chr1', '>0>1>2>3>4>5>6>7>8>9'],
    ...Object.entries(walks),
  ].map(([name, path]) => ({ name: name!, steps: parse(path!) }))
  const lengths = [...Array.from({ length: 10 }, () => 1000), 300]
  const offsets = [0]
  for (const w of all) {
    offsets.push(offsets.at(-1)! + w.steps.length)
  }
  return {
    nodes: {
      names: lengths.map((_, i) => String(i)),
      lengths: Int32Array.from(lengths),
      refs: Int32Array.from(lengths, (_, i) => (i < 10 ? 0 : -1)),
      starts: Float64Array.from(lengths, (_, i) => (i < 10 ? i * 1000 : 0)),
      ranks: Int32Array.from(lengths, (_, i) => (i < 10 ? 0 : 1)),
      refNames: ['chr1'],
    },
    links: {
      from: new Int32Array(0),
      to: new Int32Array(0),
      strands: new Uint8Array(0),
    },
    walks: {
      names: all.map(w => w.name),
      starts: new Float64Array(all.length),
      ends: Float64Array.from(all, w =>
        w.steps.reduce((bp, step) => bp + lengths[step.node]!, 0),
      ),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(all.flatMap(w => w.steps.map(step => step.node))),
      reversed: Uint8Array.from(
        all.flatMap(w => w.steps.map(step => step.reversed)),
      ),
      trimmedBefore: new Float64Array(all.length),
      trimmedAfter: new Float64Array(all.length),
    },
    departures: departureTable(),
    revisited: 0,
  }
}

const runsOf = (row: WalkRow) =>
  row.runs.map(run =>
    run.gap
      ? [run.cause, run.bp, run.heldBp]
      : [run.referenceStart, run.bp, run.onReference, run.reversed === true],
  )

describe('a row reads its contig as stored, each step reversed where its strand is against the reference', () => {
  // S's contig runs down chr1:1000-9000 against the reference but for nodes
  // 4 to 7, which it walks along it
  test('a contig stored back to front, with a stretch walked along GRCh38', () => {
    const rows = rowsOf(tenKb({ 'S#1#s': '<9<8>4>5>6>7<3<2<1<0' }), {
      start: 1000,
      end: 9000,
    })
    const [row] = rows.rows
    expect(runsOf(row!)).toEqual([
      [8000, 1000, true, true],
      [4000, 4000, true, false],
      [1000, 3000, true, true],
    ])
    expect(walkRowReadout(row!, rows.reference)).toBe(
      '8.0 kb, of which 4.0 kb reversed',
    )
  })

  // H-8p23 of the HPRC v2.1 audit: HG02055#1's forward contig walks 18 kb
  // into the window along GRCh38, then the 8p23.1 inversion, which fills the
  // rest of it, against GRCh38
  test('an inversion that fills the window after a forward stub', () => {
    const rows = rowsOf(tenKb({ 'H#1#h': '>0>1<8<7<6<5<4<3<2>9' }), {
      start: 1000,
      end: 9000,
    })
    const [row] = rows.rows
    expect(walkRowReadout(row!, rows.reference)).toBe(
      '8.0 kb, of which 7.0 kb reversed',
    )
    expect(runsOf(row!)).toEqual([
      [1000, 1000, true, false],
      [2000, 7000, true, true],
    ])
    expect(row!.axis).toEqual({ contig: 'h', start: 1000 })
  })

  // H-8p23 and R1M-06 of the audit overlap, and once gave chr8:11.72-12.0 Mb
  // of HG02055#1's contig opposite marks
  test('one contig in two overlapping windows gives its steps the same marks', () => {
    const t = tenKb({ 'H#1#h': '>0>1<8<7<6<5<4<3<2>9' })
    const marks = (region: { start: number; end: number }) => {
      const [row] = walkRowsOf(walkRowRuns(t, region, { visits: true })!).rows
      return new Map(
        row!.visits!.flatMap(visit => {
          const run = row!.runs.find(
            r => r.start <= visit.start && visit.start < r.start + r.bp,
          )
          return run?.onReference ? [[visit.node, run.reversed === true]] : []
        }),
      )
    }
    const wide = marks({ start: 1000, end: 6000 })
    const narrow = marks({ start: 4000, end: 9000 })
    const shared = [...narrow.keys()].filter(node => wide.has(node))
    expect(shared).toEqual(['5+', '4+'])
    for (const node of shared) {
      expect(narrow.get(node)).toBe(true)
      expect(wide.get(node)).toBe(true)
    }
  })
})

// pggb's chrY at the 18.5 Mb palindrome arm, cut to chr18,500,000-18,600,000
// and written as GFA, with three haplotypes: HG01261#1 and NA20806#1 walk
// every step of the window along GRCh38, and HG01358#1 crosses it once along
// it and once against it
test('chevrons mark the steps whose strand is against the reference, and no other, at a pggb chrY palindrome', () => {
  const gfa = fs.readFileSync(
    require.resolve('../../test_data/pggb_chrY_palindrome.gfa'),
    'utf8',
  )
  const graph = loadGraph(gfa, 'palindrome')
  const rows = walkRows(
    graph,
    { start: 18_500_000, end: 18_600_000 },
    undefined,
    { visits: true },
  )!
  // each walk's steps as the GFA states them, and the strand the reference
  // takes at each segment, both where it passes it both ways
  const lines = gfa.split('\n').filter(line => line.startsWith('W\t'))
  const stepsOf = (sample: string) =>
    lines
      .filter(line => line.split('\t')[1] === sample)
      .flatMap(line =>
        [...line.split('\t')[6]!.matchAll(/([<>])([^<>]+)/g)].map(m => ({
          segment: m[2]!,
          against: m[1] === '<',
        })),
      )
  const referenceStrand = new Map<string, boolean | 'both'>()
  for (const { segment, against } of stepsOf('GRCh38')) {
    const was = referenceStrand.get(segment)
    referenceStrand.set(
      segment,
      was === undefined || was === against ? against : 'both',
    )
  }
  const nameOf = new Map(graph.nodes.map(node => [node.id, node.name]))
  const reversedBp = (label: string) => {
    const row = rows.rows.find(r => r.label === label)!
    const steps = stepsOf(label.split('#')[0]!)
    let at = 0
    let truth = 0
    for (const visit of row.visits!) {
      const segment = nameOf.get(visit.node)
      while (at < steps.length && steps[at]!.segment !== segment) {
        at++
      }
      const strand = referenceStrand.get(segment ?? '')
      truth +=
        visit.onReference &&
        strand !== undefined &&
        strand !== 'both' &&
        steps[at]?.against !== strand
          ? visit.bp
          : 0
      at++
    }
    const flagged = row.runs
      .filter(run => run.reversed && run.onReference && !run.gap)
      .reduce((bp, run) => bp + run.bp, 0)
    return { truth, flagged, text: walkRowReadout(row, rows.reference) }
  }
  for (const label of ['HG01261#1', 'NA20806#1']) {
    const { truth, flagged, text } = reversedBp(label)
    expect([truth, flagged]).toEqual([0, 0])
    expect(text).not.toContain('reversed')
  }
  const carrier = reversedBp('HG01358#1')
  expect(carrier.truth).toBeGreaterThan(50_000)
  expect(carrier.flagged).toBe(carrier.truth)
  expect(carrier.text).toContain(
    `${Math.round(carrier.truth / 1000)} kb reversed`,
  )
})

describe('a stretch away from the window', () => {
  const region = { start: 1000, end: 9000 }

  // W walks chr1:1000-9000 in two pieces: a 50 bp stretch of its contig lies
  // between the first two, 5 kb between the second and third
  test('draws as long as its bp up to one width, with a break mark only where it draws shorter', () => {
    const t = tenKb({
      'W#1#w': '>0>1>2>3',
      'W#2#w': '>4>5>6',
      'W#3#w': '>7>8>9',
    })
    const pieces: GraphTables = {
      ...t,
      walks: {
        ...t.walks,
        names: ['GRCh38#0#chr1', 'W#1#w', 'W#1#w', 'W#1#w'],
        starts: Float64Array.of(0, 0, 4050, 12_050),
        ends: Float64Array.of(10_000, 4000, 7050, 15_050),
      },
    }
    const rows = rowsOf(pieces, region)
    const [row] = rows.rows
    expect(runsOf(row!)).toEqual([
      [1000, 3000, true, false],
      ['away', 50, 50],
      [4000, 3000, true, false],
      ['away', 120, 5000],
      [7000, 2000, true, false],
    ])
    expect(row!.axis?.breaks).toEqual([{ at: 6050, bp: 5000, drawn: 120 }])
    const svg = serializeEl(
      walkRowsTree(rows, {
        scaleX: 0.1,
        scaleY: 1,
        translateX: 0,
        translateY: 20,
        width: 2000,
        height: 400,
      }),
    )
    expect(svg.match(/data-testid="graph-walk-break"/g)).toHaveLength(1)
  })

  // pggb chrY:9.3-9.6 Mb, where rows leave the window and come back up to a
  // hundred times: V steps outside chr1:1000-9000 eight times, each a kb
  test('one each trip out of the window, so a row that leaves it often stays near the reference bar', () => {
    const trips = Array.from({ length: 8 }, (_, k) => `>${k + 1}>0`).join('')
    const rows = rowsOf(tenKb({ 'V#1#v': `>0${trips}>9` }), region)
    const [row] = rows.rows
    const away = row!.runs.filter(run => run.cause === 'away')
    expect(away).toHaveLength(7)
    expect(away.every(run => run.bp === 120 && run.heldBp === 1000)).toBe(true)
    expect(barEnd(row!)).toBe(8000 + 7 * 120)
    expect(walkRowReadout(row!, rows.reference)).toMatch(
      /^15 kb of its contig, of which 7\.0 kb away from the window/,
    )
  })

  // T crosses chr1:2000-8000, comes back to its left flank, takes 300 bp of
  // its own to the right flank in place of the window, or nothing, then
  // crosses it again
  test('is not where a pass that replaces or deletes the window goes', () => {
    const passes = (middle: string) => {
      const through = '>0>1>2>3>4>5>6>7>8>9'
      const rows = rowsOf(
        tenKb({ 'T#1#t': `${through}>0>1${middle}>8>9${through}` }),
        { start: 2000, end: 8000 },
      )
      const [row] = rows.rows
      return { runs: runsOf(row!), text: walkRowReadout(row!, rows.reference) }
    }
    expect(passes('>10')).toEqual({
      runs: [
        [2000, 6000, true, false],
        ['away', 90, 4000],
        [undefined, 300, false, false],
        ['away', 90, 4000],
        [2000, 6000, true, false],
      ],
      text: '20 kb of its contig, of which 8.0 kb away from the window · first pass: 6.0 kb · passes again: 300 bp (−5.7 kb) · passes again: 6.0 kb',
    })
    expect(passes('')).toEqual({
      runs: [
        [2000, 6000, true, false],
        ['away', 90, 8000],
        [2000, 6000, true, false],
      ],
      text: '20 kb of its contig, of which 8.0 kb away from the window · first pass: 6.0 kb · passes again: 0 bp (−6.0 kb) · passes again: 6.0 kb',
    })
  })

  test('with no window is not drawn, neither away from one nor at a place', () => {
    const rows = walkRowsOf(walkRowRuns(gappedCut())!)
    const texts = rows.rows.map(row => walkRowReadout(row, rows.reference))
    expect(texts.join(' ')).not.toMatch(/near chr|away from the window/)
    expect(texts.some(text => text.includes('not drawn'))).toBe(true)
    expect(rows.rows.flatMap(row => row.runs).some(run => run.heldBp)).toBe(
      false,
    )
  })
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
    )!.stops,
  ).toEqual({ right: { contigEnds: true, shortBp: 500 } })
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

test("a gap's parts keep their causes, in the order the contig is stored", () => {
  const gaps = (rows: WalkRow[]) =>
    rows.map(r => [
      r.label,
      r.runs
        .filter(run => run.gap)
        .map(({ bp, heldBp, cause }) => ({ bp: heldBp ?? bp, cause })),
    ])
  expect(
    Object.fromEntries(
      gaps(rowsOf(gappedCut(), { start: 1000, end: 6000 }).rows),
    ),
  ).toEqual({
    'A#1': [
      { bp: 400, cause: 'away' },
      { bp: 600, cause: 'missing' },
    ],
    'B#1': [
      { bp: 300, cause: 'missing' },
      { bp: 700, cause: 'away' },
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
          .map(({ bp, heldBp, cause }) => ({ bp: heldBp ?? bp, cause })),
      ]),
    )
  const fromTables = rowsOf(statedCut(), region).rows
  expect(gapsOf(fromTables)).toEqual({
    'A#1': [{ bp: 600, cause: 'missing' }],
    'B#1': [
      { bp: 600, cause: 'unread' },
      { bp: 400, cause: 'mixed' },
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

test("a stated gap's readout gives a mixed part's amounts, a lower bound on what the graph lacks beside pieces the cut did not read, and no place an unread walk was seen", () => {
  const rows = Object.fromEntries(
    rowsOf(statedCut(), { start: 1000, end: 6000 }).rows.map(r => [r.label, r]),
  )
  const reference = { bp: 7000, name: 'GRCh38#0#chr1', revisited: 0 }
  expect(walkRowReadout(rows['A#1']!, reference)).toContain(
    '600 bp left out of graph',
  )
  const b = walkRowReadout(rows['B#1']!, reference)
  expect(b).toContain('at least 300 bp left out of graph')
  expect(b).toContain('100 bp own sequence not drawn')
  expect(b).toContain('600 bp not drawn')
  expect(b).not.toContain('near')
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
    revisited: 0,
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
    { bp: 15, heldBp: 100, gap: true },
  ])
  expect(row.stops?.right?.goesOn).toMatchObject({ near: 9000, drawn: true })
  expect(
    walkRowReadout(row, { bp: 5000, name: 'GRCh38#0#chr1', revisited: 0 }),
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
  expect(
    walkRowReadout(row, { bp: 5000, name: 'GRCh38#0#chr1', revisited: 0 }),
  ).toContain('1 departure outside the row, 400 bp of its own in the graph')
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
  ).toBe('other haplotypes')
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
    walkRowReadout(row, { bp: 5000, name: 'GRCh38#0#chr1', revisited: 0 }),
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

// GRCh38 in two fragments, chr1:0-2000 and chr1:3000-5000, so its bar holds a
// 1 kb gap, and F leaves it at 4500 to rejoin past the cut
test("a stepless row's departure stops where a reference bar with a gap ends", () => {
  const fragments: GraphTables = {
    ...tables,
    walks: {
      names: ['GRCh38#0#chr1', 'GRCh38#0#chr1', 'A#1#a'],
      starts: Float64Array.of(0, 3000, 0),
      ends: Float64Array.of(2000, 5000, 4000),
      offsets: Int32Array.of(0, 2, 4, 8),
      steps: Int32Array.of(0, 1, 3, 4, 0, 1, 3, 4),
      reversed: new Uint8Array(8),
    },
    departures: departureTable([
      departure('F#1#f', { leavePos: 4500, rejoinPos: 9000 }),
    ]),
  }
  const { rows, reference } = walkRowsOf(walkRowRuns(fragments)!)
  expect(reference).toMatchObject({ bp: 5000, gapBp: 1000 })
  expect(rows.find(r => r.stepless)!.runs).toEqual([
    expect.objectContaining({ start: 4500, bp: 500, cause: 'departure' }),
  ])
})

test("a haplotype that walks the window counts its other contigs' departures over it on its row, and draws no row of them", () => {
  const { rows, reference } = rowsOf({
    ...tables,
    departures: departureTable([
      jumpF,
      departure('A#1#b', { leavePos: 0, rejoinPos: 5000 }),
      departure('A#1#b', { hapStart: 10, leavePos: 5000, rejoinPos: 0 }),
      departure('GRCh38#0#alt', { leavePos: 0, rejoinPos: 5000 }),
    ]),
  })
  expect(rows.map(r => r.name)).not.toContain('A#1#b')
  expect(rows.map(r => r.name)).not.toContain('GRCh38#0#alt')
  expect(rows.find(r => r.name === 'F#1#f')!.stepless).toBe(true)
  const a = rows.find(r => r.name === 'A#1#a')!
  expect(a.otherContigs).toEqual({ contigs: 1, departures: 2 })
  expect(walkRowReadout(a, reference)).toMatch(
    / · 2 departures on another contig$/,
  )
  expect(reference.otherContigs).toEqual({ contigs: 1, departures: 1 })
})

test("a walked contig's own departures are not counted as another contig's", () => {
  const { rows } = rowsOf({
    ...tables,
    departures: departureTable([
      departure('A#1#a', { leavePos: 0, rejoinPos: 5000 }),
    ]),
  })
  const a = rows.find(r => r.name === 'A#1#a')!
  expect(a.otherContigs).toBeUndefined()
})

test('two haplotypes of one sample stay separate rows', () => {
  const { rows } = rowsOf({
    ...tables,
    departures: departureTable([
      departure('A#2#a', { leavePos: 0, rejoinPos: 5000 }),
    ]),
  })
  expect(rows.find(r => r.name === 'A#2#a')?.stepless).toBe(true)
  expect(rows.find(r => r.name === 'A#1#a')!.otherContigs).toBeUndefined()
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

// Cuts of the HPRC v2.1 GRCh38 walk file (gfa-to-tabix 5.0.0, format 8) for
// eight haplotypes, read by graph-walks with its default 1 kb of context and
// written out as GFA. Every row is measured over the window itself, so an
// allele on a flank outside it, which a haplotype takes in place of the
// reference's flank node, counts for neither.
describe('a walk row measures its length against the reference over the window', () => {
  const readout = (
    file: string,
    refName: string,
    start: number,
    end: number,
  ) => {
    const graph = loadGraph(
      fs.readFileSync(`test_data/${file}`, 'utf8'),
      file,
      { referencePath: `GRCh38#0#${refName}` },
    )
    const rows = walkRows(graph, { start, end })!
    expect(rows.reference.windowBp).toBe(end - start)
    expect(walkRowReadout(rows.reference, undefined)).toBe(
      `${((end - start) / 1000).toFixed(1)} kb`,
    )
    return Object.fromEntries(
      rows.rows.map(row => [row.label, walkRowReadout(row, rows.reference)]),
    )
  }

  // chr11:5,226,500-5,227,500: SNVs only, one 40 bp right of the window that
  // all eight carry, and one 3 bp left of it on HG00128#1
  test('HBB, where every haplotype is as long as the reference', () => {
    expect(readout('hprc_hbb.gfa', 'chr11', 5_226_499, 5_227_500)).toEqual(
      Object.fromEntries(HAPLOTYPES.map(h => [h, '1.0 kb'])),
    )
  })

  // chr1:27,853,000-27,855,000: seven skip 571 bp; HG02055#1 also has a 50 bp
  // deletion, a 1 bp and a 49 bp insertion inside the window, and three carry
  // a 1 bp insertion 31 bp left of it
  test('the 571 bp gap, which seven skip and HG01123#1 walks', () => {
    expect(readout('hprc_gap571.gfa', 'chr1', 27_852_999, 27_855_000)).toEqual(
      Object.fromEntries(
        HAPLOTYPES.map(h => [
          h,
          h === 'HG01123#1' ? '2.0 kb' : '1.4 kb (−571 bp)',
        ]),
      ),
    )
  })
})

// Five 1 kb reference nodes and a 2 kb window from 1.5 kb, with walks the
// reviews of S5 drew: own sequence across a window edge, a window inside a
// replacement, a walk passing twice, and one reaching a single flank
describe('a walk row over a window between 1 kb nodes', () => {
  const reference = [0, 1, 2, 3, 4].map(
    i =>
      `S\tr${i + 1}\t*\tLN:i:1000\tSN:Z:GRCh38#0#chr1\tSO:i:${i * 1000}\tSR:i:0`,
  )
  const readouts = (walks: string[], nodes: string[], links: string[]) => {
    const gfa = [
      'H\tVN:Z:1.1',
      ...reference,
      ...nodes,
      ...['r1 r2', 'r2 r3', 'r3 r4', 'r4 r5', ...links].map(
        l => `L\t${l.split(' ')[0]}\t+\t${l.split(' ')[1]}\t+\t0M`,
      ),
      'W\tGRCh38\t0\tchr1\t0\t5000\t>r1>r2>r3>r4>r5',
      ...walks,
    ].join('\n')
    const graph = loadGraph(gfa, 'cut', { referencePath: 'GRCh38#0#chr1' })
    const rows = walkRows(graph, { start: 1500, end: 3500 })!
    expect(walkRowReadout(rows.reference, undefined)).toBe('2.0 kb')
    return Object.fromEntries(
      rows.rows.map(row => [row.label, walkRowReadout(row, rows.reference)]),
    )
  }

  test('own sequence across a window edge, or around the whole window, has no length over it', () => {
    expect(
      readouts(
        [
          'W\tA\t1\ta\t0\t5000\t>r1>a>r3>r4>r5',
          'W\tB\t1\tb\t0\t5000\t>r1>b>r5',
          'W\tG\t1\tg\t0\t5000\t>r1>r2>r3>g>r5',
          'W\tI\t1\ti\t0\t5000\t>r1>r2>i>r3>r4>r5',
          'W\tC\t1\tc\t0\t3000\t>r1>r4>r5',
        ],
        [
          'S\ta\t*\tLN:i:1000\tSN:Z:A#1#a\tSO:i:1000\tSR:i:1',
          'S\tb\t*\tLN:i:3000\tSN:Z:B#1#b\tSO:i:1000\tSR:i:1',
          'S\tg\t*\tLN:i:1000\tSN:Z:G#1#g\tSO:i:3000\tSR:i:1',
          'S\ti\t*\tLN:i:300\tSN:Z:I#1#i\tSO:i:2000\tSR:i:1',
        ],
        [
          'r1 a',
          'a r3',
          'r1 b',
          'b r5',
          'r3 g',
          'g r5',
          'r2 i',
          'i r3',
          'r1 r4',
        ],
      ),
    ).toEqual({
      'A#1': "its own 1.0 kb and 2.0 kb on GRCh38 in place of GRCh38's 3.0 kb",
      'B#1': "its own 3.0 kb in place of GRCh38's 3.0 kb",
      'G#1': "its own 1.0 kb and 2.0 kb on GRCh38 in place of GRCh38's 3.0 kb",
      'I#1': '2.3 kb (+300 bp)',
      'C#1': '500 bp (−1.5 kb)',
    })
  })

  // T's bar runs from its first step in the window to its last, its steps
  // on r5 and x outside the window a gap near chr1:4 kb, and its second pass
  // reversed
  test('a walk passing twice draws both passes and what lies between them, its stretch outside the window as a gap', () => {
    expect(
      readouts(
        [
          'W\tT\t1\tt\t0\t10300\t>r1>r2>r3>r4>r5>x<r5<r4<i<r3<r2<r1',
          'W\tR\t1\tr\t0\t5000\t<r5<r4<r3<r2<r1',
        ],
        [
          'S\tx\t*\tLN:i:100\tSN:Z:T#1#t\tSO:i:5000\tSR:i:1',
          'S\ti\t*\tLN:i:35\tSN:Z:T#1#t\tSO:i:6100\tSR:i:1',
        ],
        ['r5 x', 'r3 i', 'i r4'],
      ),
    ).toEqual({
      'T#1':
        '8.1 kb of its contig, of which 3.0 kb reversed, 2.1 kb away from the window · first pass: 2.0 kb · passes again: 2.0 kb (+35 bp) · turns back out of the window',
      'R#1': '2.0 kb, of which 2.0 kb reversed',
    })
  })

  test('a walk reaching one flank reads at least its bp inside the window, up to where it turns back', () => {
    expect(
      readouts(
        [
          'W\tO\t1\to\t0\t3000\t>r1>r2>r3',
          'W\tH\t1\th\t0\t5100\t>r1>r2>y<r2<r1',
        ],
        ['S\ty\t*\tLN:i:100\tSN:Z:H#1#h\tSO:i:2000\tSR:i:1'],
        ['r2 y'],
      ),
    ).toEqual({
      'O#1': '≥ 1.5 kb',
      'H#1':
        '≥ 1.1 kb, of which 500 bp reversed · turns back out of the window',
    })
  })
})

// Six 1 kb reference nodes and a window from 1.5 kb to 3.5 kb. J and K each
// reach the right flank r5 alone and step r6 beyond it: J first, running
// along the reference, and K last, against it
test("a row that turns back out of the window reads in stored order and places its axis at the bar's first step", () => {
  const gfa = [
    'H\tVN:Z:1.1',
    ...[0, 1, 2, 3, 4, 5].map(
      i =>
        `S\tr${i + 1}\t*\tLN:i:1000\tSN:Z:GRCh38#0#chr1\tSO:i:${i * 1000}\tSR:i:0`,
    ),
    'W\tGRCh38\t0\tchr1\t0\t6000\t>r1>r2>r3>r4>r5>r6',
    'W\tJ\t1\tj\t0\t5000\t>r6>r2>r3>r4>r5',
    'W\tK\t1\tk\t0\t5000\t<r5<r4<r3<r2<r6',
  ].join('\n')
  const graph = loadGraph(gfa, 'cut', { referencePath: 'GRCh38#0#chr1' })
  const rows = walkRows(graph, { start: 1500, end: 3500 }, undefined, {
    visits: true,
  })!
  const byLabel = Object.fromEntries(rows.rows.map(r => [r.label, r]))
  for (const [label, end, nodes] of [
    ['J#1', 'right', ['r2+', 'r3+', 'r4+']],
    ['K#1', 'right', ['r4+', 'r3+', 'r2+']],
  ] as const) {
    expect(byLabel[label]).toMatchObject({
      bp: 3000,
      stops: { [end]: { turnsBack: true } },
    })
    expect(byLabel[label]!.visits!.map(v => v.node)).toEqual(nodes)
  }
  expect(byLabel['J#1']!.axis).toEqual({ contig: 'j', start: 1000 })
  expect(byLabel['K#1']!.axis).toEqual({ contig: 'k', start: 1000 })
})

// The reference walks node 1 twice, at chr:0-10 and chr:30-40, filed as two
// pieces out of order. `hap` walks every step of it, `late` starts on node 3
// and `second` on node 1's second pass, and `short` ends on that pass.
describe('a reference that passes one node twice', () => {
  const rowsIn = (lines: string[], start: number, end: number) => {
    const graph = loadGraph(lines.join('\n'), 'twice.gfa', {
      referencePath: 'ref#0#chr',
    })
    const rows = walkRows(graph, { start, end }, undefined, { visits: true })!
    return Object.fromEntries(
      [rows.reference, ...rows.rows].map((row, i) => [
        row.label,
        {
          row,
          readout: walkRowReadout(row, i === 0 ? undefined : rows.reference),
          placement: {
            complete: row.complete,
            windowBp: row.windowBp,
            visits: row.visits?.map(v => v.node),
            runs: row.runs.map(r => [r.start, r.bp, r.referenceStart]),
          },
        },
      ]),
    )
  }
  const links = (pairs: string[]) =>
    pairs.map(l => `L\t${l.split(' ')[0]}\t+\t${l.split(' ')[1]}\t+\t0M`)
  const over = (start: number, end: number) =>
    rowsIn(
      [
        ...[1, 2, 3, 4, 5].map(n => `S\t${n}\t${'A'.repeat(10)}`),
        ...links(['1 2', '2 3', '3 1', '1 4', '4 5']),
        'W\tref\t0\tchr\t20\t60\t>3>1>4>5',
        'W\tref\t0\tchr\t0\t20\t>1>2',
        'W\thap\t1\tc\t0\t60\t>1>2>3>1>4>5',
        'W\tlate\t1\tl\t0\t30\t>3>1>4',
        'W\tsecond\t1\ts\t0\t20\t>1>4',
        'W\tshort\t1\tq\t0\t20\t>3>1',
      ],
      start,
      end,
    )

  test('the node between its two passes is flanked by the second, and the rows link', () => {
    const rows = over(20, 30)
    const between = {
      complete: true,
      windowBp: 10,
      visits: ['3+'],
      runs: [[0, 10, 20]],
    }
    expect(rows['ref#0']!.placement).toEqual(between)
    expect(rows['hap#1']!.placement).toEqual(between)
    expect(walkRowLinks([rows['ref#0']!.row, rows['hap#1']!.row])).toEqual([
      { row: 0, a0: 0, a1: 10, b0: 0, b1: 10 },
    ])
  })

  test('its second pass inside the window follows the node before it in one run', () => {
    const rows = over(20, 40)
    const both = {
      complete: true,
      windowBp: 20,
      visits: ['3+', '1+'],
      runs: [[0, 20, 20]],
    }
    expect(rows['ref#0']!.placement).toEqual(both)
    expect(rows['hap#1']!.placement).toEqual(both)
    expect(walkRowLinks([rows['ref#0']!.row, rows['hap#1']!.row])).toEqual([
      { row: 0, a0: 0, a1: 20, b0: 0, b1: 20 },
    ])
  })

  test('a window inside its second pass counts the bp of that pass inside it', () => {
    const rows = over(32, 38)
    expect(rows['ref#0']!.row.windowBp).toBe(6)
    expect(rows['hap#1']!.row.windowBp).toBe(6)
    expect(rows['hap#1']!.row.complete).toBe(true)
  })

  test('a walk starting in the window reaches its second pass as its right flank', () => {
    const { row, readout } = over(20, 30)['late#1']!
    expect(readout).toBe('≥ 10 bp')
    expect(row.visits?.map(v => v.node)).toEqual(['3+'])
    expect(row.axis).toEqual({ contig: 'l', start: 0 })
  })

  test('a walk starting on its second pass is placed from the node after it', () => {
    const { row, readout } = over(20, 30)['second#1']!
    expect(readout).toBe('')
    expect(row.complete).toBe(false)
  })

  // GFA text states no trimmed bp, so where its path ends says nothing
  test('a contig ending on its second pass has no bp in the window after it, and GFA text says nothing of its end', () => {
    const { row, readout } = over(40, 50)['short#1']!
    expect(row.bp).toBe(0)
    expect(readout).toBe('')
    expect(row.stops).toBeUndefined()
  })

  // the reference walks b twice in a row, chr:10-20 and chr:20-30
  test('each copy of a tandem repeat takes its own pass, whichever way the walk runs', () => {
    const rows = rowsIn(
      [
        ...['a', 'b', 'c'].map(n => `S\t${n}\t${'A'.repeat(10)}`),
        ...links(['a b', 'b b', 'b c']),
        'W\tref\t0\tchr\t0\t40\t>a>b>b>c',
        'W\thap\t1\tc\t0\t40\t>a>b>b>c',
        'W\trev\t1\tr\t0\t40\t<c<b<b<a',
      ],
      20,
      30,
    )
    for (const label of ['ref#0', 'hap#1', 'rev#1']) {
      expect(rows[label]!.row.complete).toBe(true)
      expect(rows[label]!.row.windowBp).toBe(10)
      expect(rows[label]!.row.visits?.map(v => v.node)).toHaveLength(1)
    }
    expect(rows['rev#1']!.row.runs.every(run => run.reversed)).toBe(true)
  })

  // the reference walks a at chr:0-10 and chr:20-30, with b between
  describe('with one node on both sides of another', () => {
    const lines = [
      ...['a', 'b'].map(n => `S\t${n}\t${'A'.repeat(10)}`),
      ...links(['a b', 'b a']),
      'W\tref\t0\tchr\t0\t30\t>a>b>a',
      'W\thap\t1\tc\t0\t30\t>a>b>a',
      'W\tshort\t1\ts\t0\t20\t>a>b',
    ]

    test('its second pass is the flank on the right of the node between', () => {
      const rows = rowsIn(lines, 10, 20)
      for (const label of ['ref#0', 'hap#1']) {
        expect(rows[label]!.placement).toEqual({
          complete: true,
          windowBp: 10,
          visits: ['b+'],
          runs: [[0, 10, 10]],
        })
      }
    })

    test('a cut that ends on its second pass has it as its outermost node', () => {
      const t = gfaTables(lines.join('\n'))!
      const rows = walkRowsOf(
        walkRowRuns(
          {
            ...t,
            walks: {
              ...t.walks,
              trimmedBefore: new Float64Array(3),
              trimmedAfter: new Float64Array(3),
            },
          },
          { start: 0, end: 30 },
          { referencePath: 'ref#0#chr' },
        )!,
      )
      expect(
        Object.fromEntries(
          rows.rows.map(row => [
            row.label,
            walkRowReadout(row, rows.reference),
          ]),
        ),
      ).toEqual({
        'hap#1': '30 bp',
        'short#1': '≥ 20 bp · no more of the contig on ref chr',
      })
    })
  })

  // the reference is two pieces 80 bp apart, each with a pass of r:
  // chr:0-10 and chr:100-110
  test('a piece of the reference that starts on the node keeps its own pass of it', () => {
    const rows = rowsIn(
      [
        ...['r', 'x', 'z'].map(n => `S\t${n}\t${'A'.repeat(10)}`),
        ...links(['r x', 'r z']),
        'W\tref\t0\tchr\t0\t20\t>r>x',
        'W\tref\t0\tchr\t100\t120\t>r>z',
        'W\thap\t1\tc\t0\t20\t>r>z',
      ],
      100,
      110,
    )
    expect(rows['ref#0']!.row.windowBp).toBe(10)
    expect(rows['ref#0']!.row.visits?.map(v => v.node)).toEqual(['r+'])
    expect(rows['hap#1']!.readout).toBe('≥ 10 bp')
  })
})

// The reference walks r at chr:1000-2000 and chr:3000-4000, a kb a node. `hap`
// walks x, 2.5 kb of its own, r once and z: the pass of r nearest x is its
// first, and a walk file's tables state which one the step takes.
describe("tables that state each step's pass", () => {
  const referenceStarts = [0, 1000, 2000, 3000, 4000]
  const stating = (hap?: number[]) => {
    const t = gfaTables(
      [
        ...['x', 'r', 'y', 'z'].map(
          (n, i) => `S\t${n}\t*\tLN:i:1000\tSN:Z:chr\tSO:i:${i * 1000}\tSR:i:0`,
        ),
        'S\ti\t*\tLN:i:2500',
        'W\tref\t0\tchr\t0\t5000\t>x>r>y>r>z',
        'W\thap\t1\tc\t0\t5500\t>x>i>r>z',
      ].join('\n'),
    )!
    return hap
      ? {
          ...t,
          walks: {
            ...t.walks,
            refStarts: Float64Array.from([...referenceStarts, ...hap]),
          },
        }
      : t
  }
  const onSecond = [0, Number.NaN, 3000, 4000]
  const onFirst = [0, Number.NaN, 1000, 4000]
  const firstPass = { start: 1000, end: 2000 }
  const secondPass = { start: 3000, end: 4000 }
  const hapOver = (t: GraphTables, region: { start: number; end: number }) => {
    const rows = walkRowsOf(walkRowRuns(t, region)!)
    const row = rows.rows[0]!
    return {
      readout: walkRowReadout(row, rows.reference),
      runs: row.runs.map(r => [r.start, r.bp, r.referenceStart]),
    }
  }

  test('a step lies at the pass stated, not at the nearest', () => {
    expect(hapOver(stating(onSecond), firstPass)).toEqual({
      readout: "2.5 kb off ref's path in place of ref's 2.0 kb",
      runs: [[0, 2500, undefined]],
    })
    expect(hapOver(stating(onSecond), secondPass)).toEqual({
      readout: '1.0 kb',
      runs: [
        [0, 2500, undefined],
        [2500, 1000, 3000],
      ],
    })
    expect(hapOver(stating(onFirst), firstPass)).toEqual({
      readout: '3.5 kb (+2.5 kb)',
      runs: [
        [0, 2500, undefined],
        [2500, 1000, 1000],
      ],
    })
    expect(hapOver(stating(onFirst), secondPass).readout).toBe('0 bp (−1.0 kb)')
  })

  test('tables that state none take the nearest pass', () => {
    expect(hapOver(stating(), firstPass)).toEqual(
      hapOver(stating(onFirst), firstPass),
    )
  })

  const classesOver = (
    t: GraphTables,
    region: { start: number; end: number },
  ) => {
    const rows = walkRowsOf(walkRowRuns(t, region)!)
    const row = rows.rows[0]!
    return {
      readout: walkRowReadout(row, rows.reference),
      runs: row.runs.map(r => [
        r.start,
        r.bp,
        r.onReference ? 'on' : r.fromElsewhere ? 'elsewhere' : 'own',
      ]),
    }
  }
  const across = { start: 1000, end: 4000 }

  test('a step stated off the reference is its own', () => {
    expect(
      classesOver(stating([0, Number.NaN, Number.NaN, 4000]), firstPass),
    ).toEqual({
      readout: "3.5 kb off ref's path in place of ref's 3.0 kb",
      runs: [[0, 3500, 'own']],
    })
    expect(
      classesOver(stating([0, Number.NaN, Number.NaN, 4000]), across),
    ).toEqual({
      readout: '3.5 kb (+500 bp)',
      runs: [[0, 3500, 'own']],
    })
  })

  test('a step stated at a pass the cut lacks is off it, and reads as the reference from elsewhere beside its own', () => {
    expect(
      classesOver(stating([0, Number.NaN, 7000, 4000]), firstPass),
    ).toEqual({
      readout:
        "2.5 kb off ref's path and 1.0 kb ref from elsewhere in place of ref's 3.0 kb",
      runs: [
        [0, 2500, 'own'],
        [2500, 1000, 'elsewhere'],
      ],
    })
    expect(classesOver(stating([0, Number.NaN, 7000, 4000]), across)).toEqual({
      readout: '3.5 kb (+500 bp), of which 1.0 kb ref from elsewhere',
      runs: [
        [0, 2500, 'own'],
        [2500, 1000, 'elsewhere'],
      ],
    })
  })

  test("the key names the reference from elsewhere beside what is off the reference's path, where a row holds any", () => {
    const offLabel = (stated: number) =>
      walkRowsKey(
        walkRowsOf(
          walkRowRuns(stating([0, Number.NaN, stated, 4000]), firstPass)!,
        ),
      )[1]!.label
    expect(offLabel(7000)).toBe("off ref#0's path, or ref#0 from elsewhere")
    expect(offLabel(Number.NaN)).toBe("off ref#0's path")
  })

  test('a walk row reads the count its tables or Graph state, and the option overrides it', () => {
    const off = [0, Number.NaN, Number.NaN, 4000]
    const readout = (
      source: GraphTables | Graph,
      o: { revisited?: number } = {},
    ) => {
      const rows = walkRowsOf(walkRowRuns(source, firstPass, o)!)
      return {
        revisited: rows.reference.revisited,
        readout: walkRowReadout(rows.rows[0]!, rows.reference),
      }
    }
    const offPath = "3.5 kb off ref's path in place of ref's 3.0 kb"
    const own = "its own 3.5 kb in place of ref's 3.0 kb"
    expect(readout(stating(off))).toEqual({ revisited: 1, readout: offPath })
    expect(readout(stating(off), { revisited: 0 })).toEqual({
      revisited: 0,
      readout: own,
    })
    expect(readout({ ...stating(off), revisited: 0 })).toEqual({
      revisited: 0,
      readout: own,
    })
    expect(readout(graphFromTables(stating(off)))).toEqual({
      revisited: 1,
      readout: offPath,
    })
    expect(readout(graphFromTables({ ...stating(off), revisited: 0 }))).toEqual(
      { revisited: 0, readout: own },
    )
  })

  test("a source that cannot count the reference's revisits reads a walk's bp off the reference as off its path", () => {
    const off = [0, Number.NaN, Number.NaN, 4000]
    const rows = walkRowsOf(
      walkRowRuns({ ...stating(off), revisited: Number.NaN }, firstPass)!,
    )
    expect(walkRowReadout(rows.rows[0]!, rows.reference)).toBe(
      "3.5 kb off ref's path in place of ref's 3.0 kb",
    )
  })

  test("a walk file that counts nodes the reference passes twice says a walk's bp off the reference are off its path, and one that counts none says they are its own", () => {
    const readout = (hap: number[], revisited: number) => {
      const rows = walkRowsOf(
        walkRowRuns(stating(hap), firstPass, { revisited })!,
      )
      return walkRowReadout(rows.rows[0]!, rows.reference)
    }
    const off = [0, Number.NaN, Number.NaN, 4000]
    const elsewhere = [0, Number.NaN, 7000, 4000]
    expect(readout(off, 0)).toBe("its own 3.5 kb in place of ref's 3.0 kb")
    expect(readout(off, 2)).toBe(
      "3.5 kb off ref's path in place of ref's 3.0 kb",
    )
    expect(readout(elsewhere, 0)).toBe(
      "its own 2.5 kb and 1.0 kb ref from elsewhere in place of ref's 3.0 kb",
    )
    expect(readout(elsewhere, 2)).toBe(
      "2.5 kb off ref's path and 1.0 kb ref from elsewhere in place of ref's 3.0 kb",
    )
  })

  test('a lone flank beside a step at a pass the cut lacks reads its walk as partial', () => {
    const t = gfaTables(
      [
        ...['x', 'r', 'y', 'z'].map(
          (n, i) => `S\t${n}\t*\tLN:i:1000\tSN:Z:chr\tSO:i:${i * 1000}\tSR:i:0`,
        ),
        'S\ti\t*\tLN:i:2500',
        'S\tj\t*\tLN:i:300',
        'W\tref\t0\tchr\t0\t5000\t>x>r>y>r>z',
        'W\tlone\t1\tl\t0\t4800\t>x>i>r>j',
        'W\tlone2\t1\tm\t0\t4800\t>j>r>i>z',
      ].join('\n'),
    )!
    const n = Number.NaN
    const lones = {
      ...t,
      walks: {
        ...t.walks,
        refStarts: Float64Array.from([
          ...referenceStarts,
          0,
          n,
          7000,
          n,
          n,
          7000,
          n,
          4000,
        ]),
      },
    }
    const rows = walkRowsOf(walkRowRuns(lones, firstPass)!)
    expect(
      rows.rows.map(row => [
        row.label,
        walkRowReadout(row, rows.reference),
        row.runs.map(r => [
          r.start,
          r.bp,
          r.referenceStart,
          ...(r.fromElsewhere ? ['elsewhere'] : []),
        ]),
      ]),
    ).toEqual([
      [
        'lone2#1',
        '≥ 4.8 kb, of which 1.0 kb ref from elsewhere',
        [
          [0, 300, undefined],
          [300, 1000, undefined, 'elsewhere'],
          [1300, 2500, undefined],
          [3800, 1000, 4000],
        ],
      ],
      [
        'lone#1',
        '≥ 4.8 kb, of which 1.0 kb ref from elsewhere',
        [
          [0, 1000, 0],
          [1000, 2500, undefined],
          [3500, 1000, undefined, 'elsewhere'],
          [4500, 300, undefined],
        ],
      ],
    ])
  })

  // the same with its links, over the whole reference or cut to its pieces
  // chr:0-3000 and chr:4000-5000, which hold r's first pass and not its second
  const linked = (reference: string[], hap?: number[]) => {
    const t = gfaTables(
      [
        ...[
          ['x', 0],
          ['r', 1000],
          ['y', 2000],
          ['z', 4000],
        ].map(
          ([n, at]) =>
            `S\t${n}\t*\tLN:i:1000\tSN:Z:ref#0#chr\tSO:i:${at}\tSR:i:0`,
        ),
        'S\ti\t*\tLN:i:2500',
        ...['x r', 'r y', 'y r', 'r z', 'x i', 'i r'].map(pair => {
          const [from, to] = pair.split(' ')
          return `L\t${from}\t+\t${to}\t+\t0M`
        }),
        ...reference,
        'W\thap\t1\tc\t0\t5500\t>x>i>r>z',
      ].join('\n'),
    )!
    const starts =
      reference.length > 1 ? [0, 1000, 2000, 4000] : referenceStarts
    return hap
      ? {
          ...t,
          walks: {
            ...t.walks,
            refStarts: Float64Array.from([...starts, ...hap]),
          },
        }
      : t
  }
  const whole = ['W\tref\t0\tchr\t0\t5000\t>x>r>y>r>z']
  const pieces = [
    'W\tref\t0\tchr\t0\t3000\t>x>r>y',
    'W\tref\t0\tchr\t4000\t5000\t>z',
  ]
  const skipsOf = (t: GraphTables) =>
    deletionEdges(graphFromTables(t)).map(d => [d.from, d.to, d.start, d.end])
  const offReference = [0, Number.NaN, Number.NaN, 4000]
  const passLacked = [0, Number.NaN, 7000, 4000]

  test("the graph's link from r to z skips nothing where the reference takes it, whichever pass hap states", () => {
    for (const hap of [
      undefined,
      onFirst,
      onSecond,
      offReference,
      passLacked,
    ]) {
      expect(skipsOf(linked(whole, hap))).toEqual([])
    }
  })

  test("the graph's link from r to z skips between the passes hap's steps state", () => {
    expect(skipsOf(linked(pieces, onFirst))).toEqual([['r+', 'z+', 2000, 4000]])
    expect(skipsOf(linked(pieces, onSecond))).toEqual([])
  })

  test("the graph's link from a step stated off the reference, or at a pass the cut lacks, skips nothing", () => {
    expect(skipsOf(linked(pieces, offReference))).toEqual([])
    expect(skipsOf(linked(pieces, passLacked))).toEqual([])
  })

  test("tables that state no pass measure the graph's link from the pass the cut holds", () => {
    expect(skipsOf(linked(pieces))).toEqual([['r+', 'z+', 2000, 4000]])
  })

  test('a Graph whose walk states a position count other than its steps is refused', () => {
    const graph = graphFromTables(stating(onSecond))
    const paths = graph.paths!.map((path, i) =>
      i === 1 ? { ...path, refStarts: path.refStarts!.subarray(1) } : path,
    )
    expect(() => walkRows({ ...graph, paths }, firstPass)).toThrow(
      'walk hap#1#c states 3 reference positions for 4 steps',
    )
  })

  test('the Graph of the tables reads the same rows, cut to a bubble or a window too', () => {
    const t = stating(onSecond)
    const graph = graphFromTables(t)
    for (const region of [firstPass, secondPass]) {
      expect(walkRows(graph, region)).toEqual(
        walkRowsOf(walkRowRuns(t, region)!),
      )
    }
    const stepsOf = (g: Graph) =>
      g.paths!.map(path =>
        path.nodeIds.map((id, k) => `${id}@${path.refStarts![k]}`).join(' '),
      )
    expect(stepsOf(bubbleSubgraph(graph, ['r', 'y', 'z']))).toEqual([
      'r+@1000 y+@2000 r+@3000 z+@4000',
      'r+@3000 z+@4000',
    ])
    expect(stepsOf(trimToWindow(graph, { start: 2000, end: 3000 }))).toEqual([
      'y+@2000',
    ])
  })
})

const HAPLOTYPES = [
  'HG00097#1',
  'HG00099#1',
  'HG00128#1',
  'HG00133#1',
  'HG01109#1',
  'HG01123#1',
  'HG01960#1',
  'HG02055#1',
]
