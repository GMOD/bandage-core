import { serializeEl } from '../el'
import { LABEL_CHAR_PX } from '../overlayLabels'
import { passBars } from '../passBar'
import { loadGraph } from '../pipeline'
import { abgrHex } from '../renderer/colorBits'
import { walkLift } from '../walkHighlight'
import { liftedRowInks, rowInkAt, rowInkOf } from './rowInks'
import {
  MISSING_INK,
  MISSING_PX,
  barEnd,
  gapStyle,
  genesOnRow,
  placeRowGenes,
  readoutTextPx,
  rowGeneBoxes,
  rowPitch,
  rowSpan,
  scaleBarTree,
  walkRowReadout,
  walkRowReadoutAt,
  walkRowsKey,
  walkRowsKeyTree,
  walkRowsTree,
} from './walkRowDraw'
import { walkRows } from './walkRows'

import type { Departure } from '../gfa/departures'
import type { WalkRowsWithCalls } from './walkRowDraw'

// Five 10 bp reference nodes on chr1 from 1000, and a 5 bp node no reference
// walk visits
const GFA = [
  'H\tVN:Z:1.1',
  ...['a', 'b', 'c', 'd', 'e'].map(id => `S\t${id}\tAAAAAAAAAA`),
  'S\tx\tCCCCC',
  'W\tGRCh38\t0\tchr1\t1000\t1050\t>a>b>c>d>e',
  'W\tHG1\t1\tctg1\t500\t545\t>a>x>c>d>e',
  'W\tHG2\t2\tctg2\t100\t150\t<e<d<c<b<a',
  'W\tHG3\t1\tctg3\t0\t20\t>a>b',
  'W\tHG3\t1\tctg3\t30\t50\t>d>e',
  'W\tHG4\t1\tctg4\t0\t20\t>a>b',
  'W\tHG4\t1\tctg4\t15\t35\t>d>e',
].join('\n')

const region = { start: 1012, end: 1038 }

function rows() {
  return walkRows(loadGraph(GFA, 'test'), region)!
}

const rowNamed = (name: string) => rows().rows.find(r => r.name === name)!

test('a row starts on its contig where the walk leaves the last reference node before the window', () => {
  expect(rowNamed('HG1#1#ctg1').bp).toBe(25)
  expect(rowNamed('HG1#1#ctg1').axis).toEqual({
    contig: 'ctg1',
    start: 510,
    reversed: false,
  })
  expect(rows().reference.axis).toEqual({
    contig: 'chr1',
    start: 1010,
    reversed: false,
  })
})

test('a walk against the reference reads its contig leftward along the row', () => {
  const row = rowNamed('HG2#2#ctg2')
  expect(row.axis).toEqual({ contig: 'ctg2', start: 140, reversed: true })
  expect(rowSpan(row.axis!, row.bp)).toEqual({ start: 110, end: 140 })
})

test('a gap between pieces keeps the contig position linear along the row', () => {
  const row = rowNamed('HG3#1#ctg3')
  expect(row.gapBp).toBe(10)
  expect(row.axis).toEqual({ contig: 'ctg3', start: 10, reversed: false })
})

test('pieces that overlap give the row no axis', () => {
  expect(rowNamed('HG4#1#ctg4').axis).toBeUndefined()
})

const gene = (name: string, start: number, end: number) => ({
  name,
  refName: 'any',
  start,
  end,
  strand: 1,
  exons: [{ start, end }],
})

test('genes land at their contig offsets, those off the bar dropped', () => {
  const bars = rows()
  const placed = placeRowGenes(
    bars.rows,
    new Map([
      ['HG1#1#ctg1', [gene('C1', 515, 525), gene('FAR', 900, 910)]],
      ['HG2#2#ctg2', [gene('C2', 120, 130)]],
    ]),
  )
  expect(placed.get('HG1#1#ctg1')).toEqual([
    { name: 'C1', start: 5, end: 15, exons: [{ start: 5, end: 15 }] },
  ])
  expect(placed.get('HG2#2#ctg2')).toEqual([
    { name: 'C2', start: 10, end: 20, exons: [{ start: 10, end: 20 }] },
  ])
})

test('a gene longer than its bar is cut to it', () => {
  const bars = rows()
  const placed = placeRowGenes(
    bars.rows,
    new Map([['HG1#1#ctg1', [gene('LONG', 400, 900)]]]),
  )
  expect(placed.get('HG1#1#ctg1')).toEqual([
    { name: 'LONG', start: 0, end: 25, exons: [{ start: 0, end: 25 }] },
  ])
})

test('a gene with no exons in the cut keeps its line on the row', () => {
  const placed = placeRowGenes(
    rows().rows,
    new Map([['HG1#1#ctg1', [{ ...gene('INTRON', 400, 900), exons: [] }]]]),
  )
  expect(placed.get('HG1#1#ctg1')).toEqual([
    { name: 'INTRON', start: 0, end: 25, exons: [] },
  ])
})

test('shorter genes take their name room first', () => {
  const boxes = rowGeneBoxes(
    [
      { name: 'LONGGENE', start: 0, end: 100, exons: [] },
      { name: 'AMY1A', start: 40, end: 60, exons: [] },
    ],
    bp => bp * 2,
    50,
  )
  expect(boxes.map(b => [b.name, !!b.label])).toEqual([
    ['LONGGENE', false],
    ['AMY1A', true],
  ])
})

test("a row's gene with no symbol keeps its box and no name, unless none of the row's genes has one", () => {
  const X = (bp: number) => bp * 2
  const lettered = (names: string[]) =>
    rowGeneBoxes(
      names.map((name, i) => ({
        name,
        start: i * 200,
        end: i * 200 + 150,
        exons: [],
      })),
      X,
      50,
      { namesAbove: 2000 },
    ).map(box => [box.name, !!box.label])
  expect(
    lettered(['AMY1A', 'LOC105378878', 'ENSG00000289697.1_PAR_Y']),
  ).toEqual([
    ['AMY1A', true],
    ['LOC105378878', false],
    ['ENSG00000289697.1_PAR_Y', false],
  ])
  expect(lettered(['LOC105378878', 'NR_046018.2'])).toEqual([
    ['LOC105378878', true],
    ['NR_046018.2', true],
  ])
})

// Narrowed beside the key at amylase, the reference row's boxes for AMY2A,
// AMY1A, AMY1B and AMY1C were too small for their names, which went missing
test('a name too long for its box on the reference row goes above it, with a leader down to the box', () => {
  const genes = [
    { name: 'LONGGENE', start: 0, end: 100, exons: [] },
    { name: 'AMY1A', start: 200, end: 205, exons: [] },
    { name: 'AMY1B', start: 207, end: 212, exons: [] },
  ]
  const X = (bp: number) => bp * 2
  const boxes = rowGeneBoxes(genes, X, 50, { namesAbove: 800 })
  expect(boxes.map(b => [b.name, b.label?.leader !== undefined])).toEqual([
    ['LONGGENE', false],
    ['AMY1A', true],
    ['AMY1B', true],
  ])
  const [, a, b] = boxes
  for (const box of [a!, b!]) {
    const { leader, y } = box.label!
    expect(y).toBeLessThan(box.y)
    expect(leader).toMatchObject({ x2: box.x + box.w / 2, y2: box.y })
    expect(leader!.y1).toBeLessThan(box.y)
  }
  const half = (5 * 5.2) / 2
  expect(a!.label!.x + half).toBeLessThan(b!.label!.x - half)
  expect(rowGeneBoxes(genes, X, 50).map(box => box.label?.leader)).toEqual([
    undefined,
    undefined,
    undefined,
  ])
  expect(
    rowGeneBoxes(genes, X, 8, { namesAbove: 800 }).map(box => !!box.label),
  ).toEqual([true, false, false])
})

// At amylase (chr1:103,540,000-103,780,000) RNPC3's and AMY2B's names ran
// into each other inside their neighbouring boxes on the reference row: each
// was sized at 5.2 px a letter, where their bold capitals take about 7
test('names inside neighbouring gene boxes stay clear of each other at their drawn width, and one too wide for its box goes above it', () => {
  const genes = [
    { name: 'RNPC3', start: 0, end: 28, exons: [] },
    { name: 'AMY2B', start: 28, end: 72, exons: [] },
  ]
  const X = (bp: number) => 100 + bp
  // DejaVu Sans Bold at 9 px, as walkRowsTree draws a gene's name
  const drawnPx = (name: string) => (readoutTextPx(name) * 9 * 1.13) / 11
  expect(drawnPx('RNPC3')).toBeGreaterThan(28 + 6)
  const placed = (namesAbove?: number) =>
    rowGeneBoxes(genes, X, 50, { namesAbove }).map(b => [
      b.name,
      b.label === undefined ? 'unnamed' : b.label.leader ? 'above' : 'inside',
    ])
  expect(placed(800)).toEqual([
    ['RNPC3', 'above'],
    ['AMY2B', 'inside'],
  ])
  expect(placed()).toEqual([
    ['RNPC3', 'unnamed'],
    ['AMY2B', 'inside'],
  ])
})

// At amylase, beside the key, a haplotype's AMY1 boxes were about 19 px
// against a 35 px name, and every copy went unnamed, so no row could be
// counted
test("a name wider than its box on a haplotype's row is centred on the box where it meets no other name, crosses no other gene's box and stays on the bar, after the names that fit", () => {
  const genes = [
    { name: 'RNPC3', start: 0, end: 31, exons: [] },
    { name: 'AMY1A', start: 100, end: 119, exons: [] },
    { name: 'AMY1B', start: 300, end: 319, exons: [] },
    { name: 'AMY1C', start: 330, end: 349, exons: [] },
    { name: 'AMY1D', start: 400, end: 419, exons: [] },
    { name: 'AMY1E', start: 422, end: 441, exons: [] },
    { name: 'LONGGENE', start: 500, end: 600, exons: [] },
    { name: 'AMY1F', start: 540, end: 559, exons: [] },
    { name: 'AMY1G', start: 680, end: 699, exons: [] },
  ]
  const drawnPx = (name: string) => (readoutTextPx(name) * 9 * 1.13) / 11
  expect(drawnPx('AMY1A')).toBeGreaterThan(19 + 6)
  const boxes = rowGeneBoxes(genes, bp => bp, 50, {
    ends: { x0: 0, x1: 700 },
  })
  expect(boxes.map(b => [b.name, !!b.label])).toEqual([
    ['RNPC3', true],
    ['AMY1A', true],
    ['AMY1B', true],
    ['AMY1C', false],
    ['AMY1D', false],
    ['AMY1E', false],
    ['LONGGENE', true],
    ['AMY1F', false],
    ['AMY1G', false],
  ])
  const [, a] = boxes
  expect(a!.label).toEqual({ x: 109.5, y: 53, size: 9 })
})

// SNHG1's snoRNAs lie inside its box on every haplotype at chr11:62.85M, and
// its name, which fits the box, crossed them, so the rows named SNORD22 and
// never SNHG1
test("a host gene's name that fits its box stands over the small genes inside it on a haplotype's row", () => {
  const genes = [
    { name: 'SNHG1', start: 392, end: 610, exons: [] },
    { name: 'SNORD22', start: 437, end: 443, exons: [] },
    { name: 'SNORD30', start: 474, end: 477, exons: [] },
    { name: 'SNORD29', start: 498, end: 504, exons: [] },
  ]
  const boxes = rowGeneBoxes(genes, bp => bp, 50, {
    ends: { x0: 0, x1: 900 },
  })
  expect(boxes.map(b => [b.name, !!b.label])).toEqual([
    ['SNHG1', true],
    ['SNORD22', true],
    ['SNORD30', false],
    ['SNORD29', false],
  ])
  expect(boxes[0]!.label).toMatchObject({ x: 501 })
})

// At MHC III, where genes overlap readthroughs and antisense genes, the
// haplotype rows lost PRRC2A, MSH5, VWA7, VARS1, SNHG32, EHMT2 and C2, every
// one of them a name that fits its box
test("names that fit their boxes on a haplotype's row stand over genes that overlap theirs", () => {
  const genes = [
    { name: 'VARS1', start: 100, end: 150, exons: [] },
    { name: 'VWA7', start: 140, end: 200, exons: [] },
  ]
  expect(
    rowGeneBoxes(genes, bp => bp, 50).map(b => [b.name, !!b.label]),
  ).toEqual([
    ['VARS1', true],
    ['VWA7', true],
  ])
})

// HG00128#1 at amylase carries five AMY1 copies, two with ACTG1P4 beside them
// and one with AMYP1, whose narrower boxes took the room first and left three
// copies unnamed
test("a pseudogene's name, overflowing its box more, leaves the room to the AMY1 copy beside it", () => {
  const genes = [
    { name: 'AMY1A', start: 100, end: 113, exons: [] },
    { name: 'ACTG1P4', start: 140, end: 142, exons: [] },
    { name: 'AMY1C', start: 300, end: 313, exons: [] },
    { name: 'AMYP1', start: 337, end: 346, exons: [] },
  ]
  expect(
    rowGeneBoxes(genes, bp => bp, 50, { ends: { x0: 0, x1: 900 } }).map(b => [
      b.name,
      !!b.label,
    ]),
  ).toEqual([
    ['AMY1A', true],
    ['ACTG1P4', false],
    ['AMY1C', true],
    ['AMYP1', false],
  ])
})

test('names that crowd one line above the reference row take a second, widest gene first', () => {
  const genes = [
    { name: 'SHORT', start: 200, end: 203, exons: [] },
    { name: 'WIDER', start: 199, end: 205, exons: [] },
  ]
  const [short, wider] = rowGeneBoxes(genes, bp => bp * 2, 50, {
    namesAbove: 800,
  })
  expect(wider!.label!.y).toBeGreaterThan(short!.label!.y)
  for (const box of [short!, wider!]) {
    expect(box.label!.leader).toMatchObject({
      x2: box.x + box.w / 2,
      y2: box.y,
    })
  }
})

test('walk rows name genes above the reference row only', () => {
  const bars = rows()
  const tiny = (name: string) => [{ name, start: 0, end: 1, exons: [] }]
  const svg = serializeEl(
    walkRowsTree(
      bars,
      {
        scaleX: 1,
        scaleY: 1,
        translateX: -900,
        translateY: 60,
        width: 800,
        height: 400,
      },
      {
        rowGenes: new Map([
          [bars.reference.name, tiny('REFGENE')],
          ['HG1#1#ctg1', tiny('ROWGENE')],
        ]),
      },
    ),
  )
  expect(svg).toContain('>REFGENE</text>')
  expect(svg).not.toContain('>ROWGENE</text>')
  expect(svg.match(/<line [^>]*stroke-opacity="0.6"/g)).toHaveLength(1)
})

test('the readout states length, change and what the cut left out', () => {
  expect(
    walkRowReadout({ bp: 240_365, gapBp: 0, complete: true }, undefined),
  ).toBe('240 kb')
  expect(
    walkRowReadout({ bp: 318_456, gapBp: 0, complete: true }, { bp: 240_365 }),
  ).toBe('318 kb (+78 kb)')
  expect(
    walkRowReadout(
      { bp: 167_867, gapBp: 19_156, complete: true },
      { bp: 240_365 },
    ),
  ).toBe('168 kb (−72 kb), of which 19 kb out of view')
})

test('a change under a kilobase reads in bp rather than rounding to 0.0 kb', () => {
  expect(
    walkRowReadout({ bp: 1741, gapBp: 0, complete: true }, { bp: 1738 }),
  ).toBe('1.7 kb (+3 bp)')
  expect(
    walkRowReadout({ bp: 2054, gapBp: 0, complete: true }, { bp: 1738 }),
  ).toBe('2.1 kb (+316 bp)')
})

test('the reference from elsewhere under a kilobase reads in bp rather than rounding to 0.0 kb', () => {
  const reference = { bp: 600, windowBp: 600, sample: 'GRCh38', revisited: 0 }
  expect(
    walkRowReadout(
      { bp: 769, windowBp: 600, gapBp: 0, complete: true, fromElsewhereBp: 20 },
      reference,
    ),
  ).toBe('600 bp, of which 20 bp GRCh38 from elsewhere')
  expect(
    walkRowReadout(
      {
        bp: 1520,
        replacedBp: 1300,
        gapBp: 0,
        complete: true,
        fromElsewhereBp: 20,
      },
      reference,
    ),
  ).toBe(
    "its own 1.5 kb and 20 bp GRCh38 from elsewhere in place of GRCh38's 1.3 kb",
  )
})

test('a pass across a window edge calls only its bases off the reference its own, and names those on it and their direction', () => {
  const reference = {
    bp: 6600,
    windowBp: 6600,
    sample: 'GRCh38',
    revisited: 0,
  }
  const axis = { contig: 'c', start: 0, reversed: true }
  expect(
    walkRowReadout(
      {
        bp: 6600,
        replacedBp: 6600,
        onReferenceBp: 6600,
        gapBp: 0,
        complete: true,
        axis,
      },
      reference,
    ),
  ).toBe('6.6 kb on GRCh38, reversed')
  expect(
    walkRowReadout(
      {
        bp: 1600,
        replacedBp: 1400,
        onReferenceBp: 1200,
        gapBp: 0,
        complete: true,
      },
      reference,
    ),
  ).toBe("its own 400 bp and 1.2 kb on GRCh38 in place of GRCh38's 1.4 kb")
  expect(
    walkRowReadout(
      {
        bp: 1700,
        replacedBp: 1400,
        onReferenceBp: 1200,
        gapBp: 500,
        complete: true,
        axis,
      },
      reference,
    ),
  ).toBe(
    "1.2 kb on GRCh38, reversed, in place of GRCh38's 1.4 kb, of which 500 bp out of view",
  )
})

test("a gap of the walk's bp off the reference reads as its own, or off the reference's path where the walk file counts nodes the reference passes twice, in the readout and the key", () => {
  const runs = [
    { start: 0, bp: 400, onReference: true },
    {
      start: 400,
      bp: 600,
      onReference: false,
      gap: true as const,
      cause: 'own' as const,
    },
  ]
  const row = { bp: 1000, windowBp: 1000, gapBp: 600, complete: true, runs }
  const reference = (revisited: number) => ({
    bp: 1000,
    windowBp: 1000,
    sample: 'GRCh38',
    revisited,
  })
  expect(walkRowReadout(row, reference(0))).toBe(
    '1.0 kb, of which 600 bp own sequence not drawn',
  )
  expect(walkRowReadout(row, reference(2))).toBe(
    "1.0 kb, of which 600 bp off GRCh38's path and not drawn",
  )
  const keyLabels = (revisited: number) => {
    const bars = rows()
    return walkRowsKey({
      ...bars,
      reference: { ...bars.reference, revisited },
      rows: [{ ...bars.rows[0]!, runs }],
    }).map(e => e.label)
  }
  expect(keyLabels(0)).toContain(
    'own sequence not drawn: in the graph off the reference, between two stretches drawn here',
  )
  expect(keyLabels(2)).toContain(
    "off GRCh38#0's path and not drawn: in the graph off the reference, between two stretches drawn here",
  )
})

test('a partial walk states a lower bound and why it stops', () => {
  const reference = { bp: 700, sample: 'GRCh38' }
  const call = { bp: 8600 }
  expect(
    walkRowReadout(
      {
        bp: 0,
        gapBp: 0,
        complete: false,
        stops: { right: { contigEnds: true, shortBp: 580 } },
      },
      reference,
      51,
      call,
    ),
  ).toBe("last step on GRCh38's path 580 bp before the repeat · called 8.6 kb")
  expect(
    walkRowReadout(
      {
        bp: 1500,
        gapBp: 0,
        complete: false,
        stops: { right: { contigEnds: false, shortBp: 0 } },
      },
      reference,
      51,
    ),
  ).toBe('≥ 1.5 kb ≈ 29 units · does not rejoin the reference in view')
  expect(
    walkRowReadout(
      {
        bp: 1500,
        gapBp: 0,
        complete: false,
        stops: { right: { contigEnds: true, shortBp: 0 } },
      },
      reference,
    ),
  ).toBe("≥ 1.5 kb · no more of the contig on GRCh38's path")
})

// R1M-05 of the HPRC v2.1 audit: HG00128#1's first W line starts 9,183,247 bp
// into its contig, the centromere side the graph builder dropped
test('a walk that starts inside the window says where its contig starts, and how much of it the graph has no row of', () => {
  const reference = { bp: 1_000_000, sample: 'GRCh38' }
  const starts = (contigStart: number, shortBp = 0) => ({
    gapBp: 0,
    complete: false,
    stops: { left: { contigEnds: true, shortBp, contigStart } },
  })
  expect(walkRowReadout({ bp: 332_000, ...starts(9_183_247) }, reference)).toBe(
    '≥ 332 kb · 9.2 Mb before it not drawn or left out of graph',
  )
  expect(walkRowReadout({ bp: 332_000, ...starts(0) }, reference)).toBe(
    '≥ 332 kb · contig starts inside the window',
  )
  expect(walkRowReadout({ bp: 0, ...starts(0, 580) }, reference)).toBe(
    'contig starts 580 bp before the window',
  )
  expect(walkRowReadout({ bp: 0, ...starts(440, 580) }, reference)).toBe(
    "first step on GRCh38's path 580 bp before the window, 440 bp before it not drawn or left out of graph",
  )
})

// SV-inv-100k+ of the audit: HG00097#1's second contig, 63,664 bp, lies whole
// inside the window
test('a walk whose contig starts and ends inside the window states its length exactly', () => {
  expect(
    walkRowReadout(
      {
        bp: 63_664,
        gapBp: 0,
        complete: false,
        stops: {
          left: { contigEnds: true, shortBp: 0, contigStart: 0 },
          right: { contigEnds: true, shortBp: 0 },
        },
      },
      { bp: 572_000, sample: 'GRCh38' },
    ),
  ).toBe(
    "64 kb · contig starts inside the window · no more of the contig on GRCh38's path",
  )
})

test('the key says the colours are the graph’s alignment', () => {
  const key = walkRowsKey(rows(), { genes: { untracked: 2, unread: 0 } })
  expect(key.map(e => e.label)).toEqual([
    "on GRCh38#0's path",
    "off GRCh38#0's path",
    'out of view: in the graph, beyond the part drawn here',
    'gene',
    'no gene track for 2 rows',
  ])
})

// HG5 walks b and c inverted between forward flanks, as a carrier of an
// inversion does; HG2's contig is stored back to front
test('a stretch walked against the reference draws chevrons, the readout states its bp and the key names them', () => {
  const bars = walkRows(
    loadGraph(
      [...GFA.split('\n'), 'W\tHG5\t1\tctg5\t0\t50\t>a<c<b>d>e'].join('\n'),
      'test',
    ),
    region,
  )!
  const inverted = bars.rows.find(r => r.label === 'HG5#1')!
  expect(walkRowReadout(inverted, bars.reference)).toBe(
    '26 bp, of which 20 bp reversed',
  )
  const chevrons = (row: typeof inverted) =>
    serializeEl(
      walkRowsTree(
        { ...bars, rows: [row] },
        {
          scaleX: 20,
          scaleY: 1,
          translateX: -20_000,
          translateY: 20,
          width: 1200,
          height: 400,
        },
      ),
    ).match(/<polyline /g)?.length ?? 0
  expect(chevrons(inverted)).toBeGreaterThan(0)
  expect(chevrons(bars.rows.find(r => r.label === 'HG2#2')!)).toBe(0)
  expect(walkRowsKey(bars).map(e => e.label)).toContain(
    "walked against GRCh38#0's direction",
  )
  expect(walkRowsKey(rows()).map(e => e.label)).not.toContain(
    "walked against GRCh38#0's direction",
  )
})

test('a scale bar takes a round length about as wide as asked', () => {
  const svg = serializeEl(scaleBarTree(720 / 1_000_000, 10, 20))
  expect(svg).toContain('>100 kb</text>')
  expect(svg).toContain('x2="82"')
  expect(serializeEl(scaleBarTree(1, 0, 0, 60))).toContain('>50 bp</text>')
})

test('the key names the boxes by the annotation the host read', () => {
  const key = walkRowsKey(rows(), {
    genes: { untracked: 2, unread: 1 },
    annotation: 'TE',
  })
  expect(key.slice(-3).map(e => e.label)).toEqual([
    'TE',
    'no TE track for 2 rows',
    'TEs not read for the last 1 row',
  ])
})

test('the SVG draws every row with its genes', () => {
  const bars = rows()
  const svg = serializeEl(
    walkRowsTree(
      bars,
      {
        scaleX: 10,
        scaleY: 1,
        translateX: -10_000,
        translateY: 20,
        width: 800,
        height: 400,
      },
      {
        rowGenes: placeRowGenes(
          bars.rows,
          new Map([['HG1#1#ctg1', [gene('C1', 515, 525)]]]),
        ),
      },
    ),
  )
  expect(svg.match(/<g class="row-gene"/g)).toHaveLength(1)
  expect(svg).toContain('>C1</text>')
  expect(svg.match(/<text /g)).toHaveLength(1 + 1 + bars.rows.length)
})

test('rows fill their room down past a pixel, losing labels, readouts and gaps as they crowd', () => {
  expect(rowPitch(10, 400)).toEqual({
    rowPx: 20,
    barPx: 12,
    labelled: true,
    readouts: true,
  })
  expect(rowPitch(40, 400)).toMatchObject({ rowPx: 10, labelled: false })
  expect(rowPitch(40, 520)).toMatchObject({
    rowPx: 13,
    labelled: true,
    readouts: true,
  })
  const dense = rowPitch(465, 560)
  expect(dense.rowPx * 465).toBeLessThanOrEqual(560)
  expect(dense.barPx).toBe(dense.rowPx)
  expect(rowPitch(1000, 400).rowPx).toBeCloseTo(0.4)
  expect(rowPitch(1000, 400, 3).rowPx).toBe(3)
})

test('a dense row keeps its call inside the row, and marks a disagreeing call red', () => {
  const bars = rows()
  const [first, ...rest] = bars.rows
  const svg = serializeEl(
    walkRowsTree(
      {
        ...bars,
        unit: 5,
        rows: [{ ...first!, call: { bp: 40, agrees: false } }, ...rest],
      },
      {
        scaleX: 10,
        scaleY: 1,
        translateX: -10_000,
        translateY: 20,
        width: 800,
        height: 400,
        rowPx: 2,
        barPx: 2,
        readouts: false,
      },
    ),
  )
  expect(svg).toMatch(
    /data-testid="graph-walk-call"[^>]*height="2"[^>]*fill="#c62828"/,
  )
  expect(svg).not.toContain('<text ')
  expect(svg).not.toContain('<line ')
})

test('gene boxes fit the rows’ pitch, and crowded rows draw none', () => {
  const genes = [
    { name: 'AMY1A', start: 0, end: 50, exons: [{ start: 10, end: 20 }] },
  ]
  const [roomy] = rowGeneBoxes(genes, bp => bp * 2, 50)
  expect(roomy).toMatchObject({ y: 42, h: 16 })
  expect(roomy!.label).toBeDefined()
  const [unlettered] = rowGeneBoxes(genes, bp => bp * 2, 50, {
    rowPx: 10,
    barPx: 6,
  })
  expect(unlettered).toMatchObject({ y: 46, h: 8 })
  expect(unlettered!.label).toBeUndefined()
  expect(rowGeneBoxes(genes, bp => bp * 2, 50, { rowPx: 4, barPx: 2 })).toEqual(
    [],
  )
})

test('crowded rows say their genes are left out, and nothing else of them', () => {
  const key = walkRowsKey(rows(), {
    genes: { crowded: true, untracked: 2, unread: 0 },
  })
  expect(key.map(e => e.label).slice(-1)).toEqual([
    'genes left out: too many rows to box them in',
  ])
  expect(key.some(e => e.label.startsWith('no gene track'))).toBe(false)
})

test('under the reference ramp the SVG key paints its on-path swatch as the ramp', () => {
  const { tree } = walkRowsKeyTree(
    walkRowsKey(rows(), { ramp: { start: 0, end: 100 } }),
    0,
    0,
  )
  const svg = serializeEl(tree)
  expect(svg.match(/<linearGradient /g)).toHaveLength(1)
  expect(svg).toContain('fill="url(#walk-key-ramp-0)"')
})

test("a row takes the backbone's genes on its own contig, bare or PanSN", () => {
  const row = rows().reference
  const contig = row.axis!.contig
  const on = { ...gene('ON', 0, 10), refName: contig }
  const panSN = { ...gene('PANSN', 0, 10), refName: `GRCh38#0#${contig}` }
  const off = { ...gene('OFF', 0, 10), refName: `${contig}_alt` }
  expect(genesOnRow(row, [on, panSN, off]).map(g => g.name)).toEqual([
    'ON',
    'PANSN',
  ])
})

const byChar = (shown: string) => shown.length * LABEL_CHAR_PX

// HG3 walks the window in two pieces, a gap between them. A readout that
// once went inside its bar where the room beside was short was drawn over
// the bar with a white halo, and at pggb chrY over bars it did not name.
test('a readout never goes over its own bar: where the room beside it is short it is cut there', () => {
  const bars = rows()
  const hg3 = bars.rows.find(row => row.name === 'HG3#1#ctg3')!
  const scaleX = 20
  const translateX = 40 - bars.origin * scaleX
  const endX = (bars.origin + barEnd(hg3)) * scaleX + translateX
  const frame = {
    scaleX,
    scaleY: 1,
    translateX,
    translateY: 20,
    width: endX + 6 + 50,
    height: 400,
    measure: byChar,
  }
  const at = walkRowReadoutAt({ ...bars, rows: [hg3] }, 1, frame)
  expect(at).toMatchObject({ x: endX + 6, shown: '26 bp, …', cut: true })
  const svg = serializeEl(walkRowsTree({ ...bars, rows: [hg3] }, frame))
  expect(svg).toContain(`<title>${walkRowReadout(hg3, bars.reference)}</title>`)
  expect(svg).toContain(`x="${endX + 6}"`)
  expect(svg).not.toContain('text-anchor')
  expect(svg).not.toContain('stroke="white" stroke-width="3"')
})

// A 5.4 Mb row over a 1 kb reference, most of it left out of the graph, at
// chr22:11,950,000-11,951,000
function longRow(): WalkRowsWithCalls {
  const on = { start: 0, bp: 1000, onReference: true, referenceStart: 0 }
  return {
    origin: 0,
    reference: {
      name: 'GRCh38#0#chr22',
      label: 'GRCh38#0',
      sample: 'GRCh38',
      bp: 1000,
      offReferenceBp: 0,
      gapBp: 0,
      complete: true,
      runs: [on],
      revisited: 0,
    },
    rows: [
      {
        name: 'HG1#1#c',
        label: 'HG1#1',
        sample: 'HG1',
        bp: 5_361_000,
        offReferenceBp: 0,
        gapBp: 5_360_000,
        complete: true,
        runs: [
          on,
          {
            start: 1000,
            bp: 5_096_000,
            onReference: false,
            gap: true,
            cause: 'missing',
          },
          {
            start: 5_097_000,
            bp: 178_000,
            onReference: false,
            gap: true,
            cause: 'elsewhere',
            near: 12_000_000,
          },
          { start: 5_275_000, bp: 86_000, onReference: false, gap: true },
        ],
      },
    ],
  }
}

// rows closer than their full pitch, which leaves no room for a second line
test('a readout too long for the room beside its bar on rows too close to wrap drops whole parts of its breakdown from the end, and says it was cut', () => {
  const bars = longRow()
  const text =
    '5361 kb (+5360 kb), of which 5096 kb left out of graph, 178 kb near chr22:12.0 Mb, 86 kb out of view'
  const cut = '5361 kb (+5360 kb), of which 5096 kb left out of graph, …'
  const frame = (width: number) => ({
    scaleX: 100 / 5_361_000,
    translateX: 0,
    width,
    rowPx: 16,
    measure: (shown: string) => shown.length * LABEL_CHAR_PX,
  })
  const beside = 106
  const roomy = walkRowReadoutAt(bars, 1, frame(800))
  expect(roomy).toMatchObject({
    text,
    shown: text,
    cut: false,
  })
  expect(roomy.x).toBeCloseTo(beside)
  expect(
    walkRowReadoutAt(bars, 1, frame(beside + cut.length * LABEL_CHAR_PX + 1)),
  ).toMatchObject({ text, shown: cut, cut: true })
  expect(walkRowReadoutAt(bars, 1, frame(beside + 10)).shown).toBe('…')
  expect(walkRowReadoutAt(bars, 1, frame(beside + 4)).shown).toBe('')
  const left = longRow()
  left.rows[0] = { ...left.rows[0]!, unloadedBp: 10 }
  expect(walkRowReadoutAt(left, 1, frame(800)).shown).toBe(text)
  expect(
    walkRowReadoutAt(left, 1, frame(900), { comparing: true }),
  ).toMatchObject({ text: `${text} · not compared`, cut: false })
  expect(
    walkRowReadoutAt(left, 1, frame(beside + 230), { comparing: true }).shown,
  ).toBe('5361 kb (+5360 kb), … · not compared')
  expect(
    walkRowReadoutAt(left, 1, frame(beside + 10), { comparing: true }).shown,
  ).toBe('')
  const hg = rows()
  const hg3 = hg.rows.find(row => row.name === 'HG3#1#ctg3')!
  const scaleX = 20
  const translateX = 40 - hg.origin * scaleX
  const endX = (hg.origin + barEnd(hg3)) * scaleX + translateX
  const full = walkRowReadout(hg3, hg.reference)
  const svg = serializeEl(
    walkRowsTree(
      { ...hg, rows: [hg3] },
      {
        scaleX,
        scaleY: 1,
        translateX,
        translateY: 20,
        width: endX + 80,
        height: 400,
        measure: (shown: string) => shown.length * LABEL_CHAR_PX,
      },
    ),
  )
  expect(full).toBe('26 bp, of which 10 bp out of view')
  expect(svg).toContain(
    `<g data-testid="graph-walk-row"><title>${full}</title>`,
  )
  expect(svg).toContain('>26 bp, …</text>')
})

// At AMY2A (chr1:103,618,800-103,620,300) HG00097#1's readout read "no step
// on GRCh38 across 120 kb · …", hiding how much sequence of its own the
// stretch holds and how much of it the graph left out
test('a readout too long for the room beside its bar wraps onto two lines at full pitch, keeping every amount', () => {
  const bars = longRow()
  const departure: Departure = {
    name: 'HG00097#1#c',
    hapStart: 0,
    ownBp: 49_000,
    missingBp: 19_000,
    leavePos: 103_560_000,
    leaveReversed: false,
    leavePasses: 1,
    rejoinPos: 103_680_000,
    rejoinReversed: false,
    rejoinPasses: 1,
    fromSteps: false,
  }
  bars.reference = { ...bars.reference, bp: 1500, windowBp: 1500 }
  bars.rows = [
    {
      name: 'HG00097#1#c',
      label: 'HG00097#1',
      sample: 'HG00097',
      bp: 0,
      offReferenceBp: 0,
      gapBp: 1500,
      complete: true,
      stepless: true,
      departures: [departure],
      runs: [
        {
          start: 0,
          bp: 1500,
          gap: true,
          onReference: false,
          cause: 'departure',
        },
      ],
    },
  ]
  const text =
    'no step on GRCh38 across 120 kb · 49 kb of its own, 19 kb of it left out of graph'
  const measure = (shown: string) => shown.length * LABEL_CHAR_PX
  const frame = (width: number, rowPx?: number) => ({
    scaleX: 960 / 1500,
    scaleY: 1,
    translateX: 80,
    translateY: 20,
    width,
    height: 200,
    rowPx,
    measure,
  })
  const beside = 80 + 960 + 6
  const at = walkRowReadoutAt(bars, 1, frame(beside + 320))
  expect(at).toMatchObject({
    text,
    lines: [
      'no step on GRCh38 across 120 kb',
      '49 kb of its own, 19 kb of it left out of graph',
    ],
    cut: false,
  })
  expect(at.lines.every(line => measure(line) <= 320)).toBe(true)
  const svg = serializeEl(walkRowsTree(bars, frame(beside + 320)))
  expect(svg).toContain(
    `<tspan x="${at.x}">no step on GRCh38 across 120 kb</tspan><tspan x="${at.x}" dy="10">49 kb of its own, 19 kb of it left out of graph</tspan>`,
  )
  expect(svg).not.toContain(`<title>${text}</title>`)

  // a break between a breakdown's items keeps its comma
  expect(
    walkRowReadoutAt(longRow(), 1, {
      scaleX: 100 / 5_361_000,
      translateX: 0,
      width: 106 + 360,
      measure,
    }).lines,
  ).toEqual([
    '5361 kb (+5360 kb), of which 5096 kb left out of graph,',
    '178 kb near chr22:12.0 Mb, 86 kb out of view',
  ])
  // too narrow for two lines, or rows too close for a second, it is cut
  expect(walkRowReadoutAt(bars, 1, frame(beside + 220))).toMatchObject({
    lines: ['no step on GRCh38 across 120 kb · …'],
    cut: true,
  })
  expect(walkRowReadoutAt(bars, 1, frame(beside + 320, 16))).toMatchObject({
    lines: ['no step on GRCh38 across 120 kb · …'],
    cut: true,
  })
})

// pggb chrY (chrY:14,018,230-14,024,498 and chrY:16,160,000-16,163,000):
// rows whose readouts outran the room left of the key, one cut at the key's
// edge mid-word, one drawn over its own bar
function pggbRows(): WalkRowsWithCalls {
  const on = { start: 0, onReference: true, referenceStart: 0 }
  const reference = {
    name: 'GRCh38#0#chrY',
    label: 'GRCh38#0',
    sample: 'GRCh38',
    bp: 3000,
    windowBp: 3000,
    offReferenceBp: 0,
    gapBp: 0,
    complete: true,
    revisited: 3,
    runs: [{ ...on, bp: 3000 }],
  }
  const row = (
    label: string,
    extra: Partial<WalkRowsWithCalls['rows'][number]>,
  ) => ({
    name: `${label}#c`,
    label,
    sample: label.slice(0, label.indexOf('#')),
    bp: 3000,
    windowBp: 3000,
    offReferenceBp: 0,
    gapBp: 0,
    complete: true,
    runs: [{ ...on, bp: 3000 }],
    ...extra,
  })
  return {
    origin: 0,
    reference,
    rows: [
      row('HG00126#1', {
        bp: 400,
        windowBp: 400,
        replacedBp: 6400,
        onReferenceBp: 390,
        axis: { contig: 'c', start: 0, reversed: true },
        runs: [{ ...on, bp: 400 }],
      }),
      row('HG002#1', { placementChoice: true }),
    ],
  }
}

test("every line of a readout ends before the pane's right edge and starts past its bar, wherever that edge is", () => {
  const bars = pggbRows()
  expect(walkRowReadout(bars.rows[0]!, bars.reference)).toBe(
    "10 bp off GRCh38's path and 390 bp on GRCh38, reversed, in place of GRCh38's 6.4 kb",
  )
  for (const fixture of [bars, longRow(), rows()]) {
    const longest = [fixture.reference, ...fixture.rows].reduce(
      (max, r) => Math.max(max, barEnd(r)),
      0,
    )
    const scaleX = 600 / longest
    const translateX = 80 - fixture.origin * scaleX
    for (let width = 600; width <= 1400; width += 9) {
      for (const rowPx of [12, 16, 20]) {
        const frame = { scaleX, translateX, width, rowPx, measure: byChar }
        ;[fixture.reference, ...fixture.rows].forEach((row, i) => {
          const at = walkRowReadoutAt(fixture, i, frame)
          const endX = (fixture.origin + barEnd(row)) * scaleX + translateX
          expect(at.x).toBeGreaterThan(endX)
          for (const line of at.lines.filter(shown => shown !== '')) {
            expect(at.x + byChar(line)).toBeLessThanOrEqual(width)
          }
        })
      }
    }
  }
})

// HG00126#1's readout at pggb chrY ran on past the key's edge as its first
// clause, cut mid-word there; now it ends by whole clauses before the edge
test('a readout with no breakdown to drop sheds whole clauses and joined amounts from its end', () => {
  const bars = pggbRows()
  const frame = (room: number) => {
    const scaleX = 600 / 3000
    const endX = 80 + 400 * scaleX
    return {
      scaleX,
      translateX: 80,
      width: endX + 6 + room,
      rowPx: 16,
      measure: byChar,
    }
  }
  expect(walkRowReadoutAt(bars, 1, frame(400)).shown).toBe(
    "10 bp off GRCh38's path and 390 bp on GRCh38, reversed, …",
  )
  expect(walkRowReadoutAt(bars, 1, frame(300)).shown).toBe(
    "10 bp off GRCh38's path and 390 bp on GRCh38, …",
  )
  expect(walkRowReadoutAt(bars, 1, frame(300)).cut).toBe(true)
  expect(walkRowReadoutAt(bars, 1, frame(200)).shown).toBe(
    "10 bp off GRCh38's path and …",
  )
})

// A 1.8 kb row, 1 kb of it left out of the graph, as the split fixture draws
// on a 1200 px pane
test('a readout is measured at its font, so one with room enough is drawn whole', () => {
  const on = { start: 0, bp: 400, onReference: true, referenceStart: 0 }
  const bars: WalkRowsWithCalls = {
    origin: 0,
    reference: {
      name: 'GRCh38#0#chr1',
      label: 'GRCh38#0',
      sample: 'GRCh38',
      bp: 1000,
      offReferenceBp: 0,
      gapBp: 0,
      complete: true,
      runs: [{ ...on, bp: 1000 }],
    },
    rows: [
      {
        name: 'HG002#1#c',
        label: 'HG002#1',
        sample: 'HG002',
        bp: 1800,
        offReferenceBp: 0,
        gapBp: 1000,
        complete: true,
        runs: [
          on,
          {
            start: 400,
            bp: 1000,
            onReference: false,
            gap: true,
            cause: 'missing',
          },
          { ...on, start: 1400, referenceStart: 600 },
        ],
      },
    ],
  }
  const text = '1.8 kb (+800 bp), of which 1.0 kb left out of graph'
  const frame = { scaleX: 905 / 1800, translateX: 0, width: 1200 }
  expect(walkRowReadoutAt(bars, 1, frame)).toMatchObject({
    text,
    shown: text,
    cut: false,
  })
  expect(text.length * LABEL_CHAR_PX).toBeGreaterThan(1200 - 911)
  expect(readoutTextPx(text)).toBeGreaterThan(277)
  expect(readoutTextPx(text)).toBeLessThan(1200 - 911)
})

// HG002#2 and HG01074#1 at GRCh38 chr22:22,800,000-22,850,000 have no step on
// 50 kb of window, inside stretches of about 150 kb and 490 kb between the
// ends of a departure
test("a stepless row reads as its departure's facts", () => {
  const runs = [
    {
      start: 0,
      bp: 50_000,
      gap: true,
      onReference: false,
      cause: 'departure',
    },
  ] as const
  const readout = (
    d: Partial<Departure>,
    reference: { bp: number; sample?: string; revisited?: number } = {
      bp: 50_000,
      sample: 'GRCh38',
      revisited: 0,
    },
  ) =>
    walkRowReadout(
      {
        bp: 0,
        gapBp: 50_000,
        complete: true,
        stepless: true,
        departures: [
          {
            name: 'HG002#2#chr22',
            hapStart: 0,
            ownBp: 0,
            missingBp: 0,
            leavePos: 22_780_000,
            leaveReversed: false,
            leavePasses: 1,
            rejoinPos: 22_780_000,
            rejoinReversed: false,
            rejoinPasses: 1,
            fromSteps: false,
            ...d,
          },
        ],
        runs: [...runs],
      },
      reference,
    )
  expect(readout({ rejoinPos: 22_930_412 })).toBe(
    'no step on GRCh38 across 150 kb · 0 bp of its own',
  )
  expect(readout({ rejoinPos: 23_267_960, ownBp: 120_000 })).toBe(
    'no step on GRCh38 across 490 kb · 120 kb of its own',
  )
  expect(readout({ rejoinPos: 24_014_567 }, { bp: 50_000, revisited: 0 })).toBe(
    'no step on the reference across 1.2 Mb · 0 bp of its own',
  )
  expect(readout({ rejoinPos: 22_780_850, missingBp: 40, ownBp: 40 })).toBe(
    'no step on GRCh38 across 850 bp · 40 bp left out of graph',
  )
  expect(gapStyle('departure')).toEqual({
    fill: MISSING_INK,
    px: MISSING_PX,
    label: 'no step on the reference',
  })
})

test("a stepless row's bar ends past its stretch, since it has no bp", () => {
  const run = {
    start: 0,
    bp: 1000,
    onReference: false,
    gap: true as const,
    cause: 'departure' as const,
  }
  expect(barEnd({ bp: 0, runs: [run] })).toBe(1000)
  expect(barEnd({ bp: 1500, runs: [{ ...run, bp: 1500 }] })).toBe(1500)
})

describe('rows in the lifted walks colours', () => {
  const graph = loadGraph(GFA, 'test')
  const bars = walkRows(graph, region)!
  const lift = walkLift(graph, [
    { walk: 'GRCh38#0#chr1', color: { field: 'progress' } },
    { walk: 'HG1#1#ctg1', color: { field: 'progress' } },
  ])!
  const inks = liftedRowInks(lift.walks)
  const frame = {
    scaleX: 10,
    scaleY: 1,
    translateX: 100 - bars.origin * 10,
    translateY: 20,
    width: 800,
    height: 400,
    rowPx: 20,
    barPx: 12,
  }
  const along = (offset: number) =>
    (bars.origin + offset) * 10 + frame.translateX
  const hg1 = bars.rows.find(r => r.name === 'HG1#1#ctg1')!
  const onlyRow = (row: typeof hg1) => ({ ...bars, rows: [row] })
  const svg = serializeEl(
    walkRowsTree(bars, frame, {
      inks,
      ramp: { start: 1000, end: 1050 },
      idPrefix: 'p',
    }),
  )
  const rowSvg = (name: string) => {
    const i = [bars.reference, ...bars.rows].findIndex(r => r.name === name)
    return svg.split('<g data-testid="graph-walk-')[i + 1]!
  }

  test("a lifted walk's row runs along its walk's ramp over the stretch of contig the bar covers", () => {
    const ink = rowInkOf(hg1, inks)!
    expect(ink.range).toEqual({ contig: 'ctg1', start: 500, end: 545 })
    const row = rowSvg('HG1#1#ctg1')
    const gradient =
      /<linearGradient id="(p-\d+-ink)" gradientUnits="userSpaceOnUse" x1="([\d.]+)" x2="([\d.]+)"[^>]*>(.*?)<\/linearGradient>/.exec(
        row,
      )!
    expect(+gradient[2]!).toBeCloseTo(along(0))
    expect(+gradient[3]!).toBeCloseTo(along(hg1.bp))
    const colors = [...gradient[4]!.matchAll(/stop-color="([^"]+)"/g)].map(
      m => m[1],
    )
    // the bar starts 10 bp into the walk's 45 and ends 10 bp short of its end
    expect(colors[0]).toBe(rowInkAt(ink, hg1, 0))
    expect(colors.at(-1)).toBe(rowInkAt(ink, hg1, hg1.bp))
    expect(colors[0]).not.toBe(ink.stops[0])
    expect(colors.at(-1)).not.toBe(ink.stops.at(-1))
    // its runs on and off the path take one paint, so they draw as one rect
    // with no seams between them
    const bar = [
      ...row.matchAll(
        /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="12" fill="([^"]+)"/g,
      ),
    ]
    expect(bar).toHaveLength(1)
    expect(+bar[0]![1]!).toBeCloseTo(along(0))
    expect(+bar[0]![2]!).toBeCloseTo(hg1.bp * 10)
    expect(bar[0]![3]).toBe(`url(#${gradient[1]})`)
  })

  test('a row no lifted walk names keeps the reference-position ramp', () => {
    const row = rowSvg('HG2#2#ctg2')
    expect(row).not.toContain('-ink')
    expect(row).not.toContain('graph-walk-on-path')
    expect(row).toMatch(
      /<linearGradient id="p-\d+-\d+"><stop offset="0" stop-color="hsl\(/,
    )
  })

  test("a grey strip over a lifted walk's row marks where it runs on the reference's path", () => {
    const strips = [
      ...rowSvg('HG1#1#ctg1').matchAll(
        /<rect data-testid="graph-walk-on-path" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="2" fill="#8c8c8c"/g,
      ),
    ].map(m => ({ x: +m[1]!, y: +m[2]!, w: +m[3]! }))
    // x, off the path, then c and d on it
    const [off, on] = hg1.runs
    expect(off!.onReference).toBe(false)
    expect(on!.onReference).toBe(true)
    expect(strips).toHaveLength(1)
    expect(strips[0]!.x).toBeCloseTo(along(on!.start))
    expect(strips[0]!.x + strips[0]!.w).toBeCloseTo(along(hg1.bp))
    const rowY = frame.translateY + 20 * (bars.rows.indexOf(hg1) + 1)
    expect(strips[0]!.y + 2).toBeLessThan(rowY - 6)
    expect(strips[0]!.y).toBeGreaterThan(rowY - 10)
    expect(rowSvg('GRCh38#0#chr1')).not.toContain('graph-walk-on-path')
  })

  test('the key names the strip, and keeps the reference ramp while a row takes it', () => {
    const reference = bars.reference.label
    const strip = `grey above: on ${reference}'s path`
    const labels = walkRowsKey(bars, {
      inks,
      ramp: { start: 1000, end: 1050 },
    }).map(e => e.label)
    expect(labels).toContain(strip)
    expect(labels).toContain(`on ${reference}'s path`)
    const onlyLifted = {
      ...bars,
      rows: bars.rows.filter(r => r.name === 'HG1#1#ctg1'),
    }
    const lifted = walkRowsKey(onlyLifted, { inks }).map(e => e.label)
    expect(lifted).toContain(strip)
    expect(lifted).not.toContain(`on ${reference}'s path`)
    expect(lifted.some(l => l.startsWith(`off ${reference}`))).toBe(false)
    expect(walkRowsKey(bars).map(e => e.label)).not.toContain(strip)
  })

  test('a walk lifted in one colour paints its row in it flat', () => {
    const flat = liftedRowInks(
      walkLift(graph, [{ walk: 'GRCh38#0#chr1' }, { walk: 'HG1#1#ctg1' }])!
        .walks,
    )
    const ink = rowInkOf(hg1, flat)!
    expect(ink.stops).toHaveLength(1)
    const row = serializeEl(walkRowsTree(onlyRow(hg1), frame, { inks: flat }))
    expect(row).not.toContain('linearGradient')
    expect(row).toContain(`fill="${ink.stops[0]}"`)
  })
})

describe('the row of a walk lifted by pass', () => {
  const gfa = (lines: string[]) =>
    [
      'S\ts1\t*\tLN:i:1000',
      'S\ts2\t*\tLN:i:500',
      'S\tr\t*\tLN:i:200',
      'S\tu\t*\tLN:i:3000',
      'S\ts5\t*\tLN:i:1000',
      'L\ts1\t+\ts2\t+\t0M',
      'L\ts2\t+\tr\t+\t0M',
      'L\tr\t+\tr\t+\t0M',
      'L\tr\t+\tu\t+\t0M',
      'L\tu\t+\ts5\t+\t0M',
      'P\tref#0#chr1\ts1+,s2+,r+,u+,s5+\t*',
      ...lines,
    ].join('\n')
  // hap walks `walk`, or the pieces and links `lines` give, and `name` is the
  // walk lifted by pass
  const lifted = (
    walk: string | string[],
    cut?: { start: number; end: number },
    name = 'hap#1#ctg',
  ) => {
    const graph = loadGraph(
      gfa(typeof walk === 'string' ? [`P\thap#1#ctg\t${walk}\t*`] : walk),
      'test',
    )
    const lift = walkLift(graph, [{ walk: name, color: { field: 'pass' } }])!
    const bars = walkRows(graph, cut)!
    const row = bars.rows.find(r => r.name.startsWith('hap#1#ctg'))!
    const ink = rowInkOf(row, liftedRowInks(lift.walks))!
    const passes = lift.walks[0]!.walkPasses!
    const color = (pass: number) => abgrHex(passes.passes[pass]!.ink)
    return { lift, bars, row, ink, color, own: ink.stops[0]! }
  }

  test('takes each pass colour on the nodes the walk steps again, and its own colour elsewhere', () => {
    const { row, ink, color, own } = lifted('s1+,s2+,r+,r+,u+,s5+')
    expect(ink.passes).toHaveLength(2)
    expect(rowInkAt(ink, row, 100)).toBe(own)
    expect(rowInkAt(ink, row, 1600)).toBe(color(0))
    expect(rowInkAt(ink, row, 1800)).toBe(color(1))
    expect(rowInkAt(ink, row, 3000)).toBe(own)
  })

  test('a backward row finds its passes by contig position', () => {
    // hap runs down ctg, so the cut's bar runs from contig 4900 down, and the
    // repeat's two passes, at contig 4000 to 4200 and 4200 to 4400, lie 700
    // to 900 and 500 to 700 bp along it
    const { row, ink, color, own } = lifted('s5-,u-,r-,r-,s2-,s1-', {
      start: 1200,
      end: 4500,
    })
    expect(row.axis).toEqual({ contig: 'ctg', start: 4900, reversed: true })
    expect(rowInkAt(ink, row, 400)).toBe(own)
    expect(rowInkAt(ink, row, 600)).toBe(color(1))
    expect(rowInkAt(ink, row, 800)).toBe(color(0))
    expect(rowInkAt(ink, row, 1000)).toBe(own)
  })

  test("a row with no contig position to place the passes by keeps the walk's own colour, and its pass bar", () => {
    // two overlapping pieces of hap give its cut row no axis
    const { lift, bars, row, ink, own } = lifted(
      [
        'P\thap#1#ctg:0-1900\ts1+,s2+,r+,r+\t*',
        'P\thap#1#ctg:1500-5700\tr+,u+,s5+\t*',
      ],
      { start: 1200, end: 4500 },
      'hap#1#ctg:0-1900',
    )
    expect(row.axis).toBeUndefined()
    expect(ink.passes?.length).toBeGreaterThan(0)
    expect(
      [0, 600, 800, 1500, 2000].map(offset => rowInkAt(ink, row, offset)),
    ).toEqual([own, own, own, own, own])
    expect(passBars(lift, bars)).toHaveLength(1)
  })

  test("a row that shows only some of the walk's passes keeps its pass bar", () => {
    // hap runs through the window twice, and its row draws the first time
    const { lift, bars, row, ink, color } = lifted(
      [
        'L\ts5\t+\ts1\t+\t0M',
        'P\thap#1#ctg\ts1+,s2+,r+,u+,s5+,s1+,s2+,r+,u+,s5+\t*',
      ],
      { start: 1200, end: 4500 },
    )
    expect(rowInkAt(ink, row, 600)).toBe(color(0))
    expect(passBars(lift, bars)).toHaveLength(1)
    const whole = lifted('s1+,s2+,r+,r+,u+,s5+')
    expect(passBars(whole.lift, whole.bars)).toEqual([])
  })

  test('the bar is one rect whose gradient has a hard edge at each pass', () => {
    const { bars, row, ink, color, own } = lifted('s1+,s2+,r+,r+,u+,s5+')
    const frame = {
      scaleX: 0.1,
      scaleY: 1,
      translateX: 10 - bars.origin * 0.1,
      translateY: 20,
      width: 800,
      height: 400,
      rowPx: 20,
      barPx: 12,
    }
    const svg = serializeEl(
      walkRowsTree({ ...bars, rows: [row] }, frame, {
        inks: [ink],
        idPrefix: 'p',
      }),
    )
    const stops = [
      ...svg.matchAll(/<stop offset="([\d.e-]+)" stop-color="([^"]+)"/g),
    ].map(m => ({ offset: +m[1]!, color: m[2]! }))
    const at = (offset: number) =>
      stops.findLast(s => s.offset <= offset / row.bp)!.color
    expect(stops[0]!.color).toBe(own)
    expect(at(1600)).toBe(color(0))
    expect(at(1800)).toBe(color(1))
    expect(at(3000)).toBe(own)
  })
})
