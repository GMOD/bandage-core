import { serializeEl } from '../el'
import { LABEL_CHAR_PX } from '../overlayLabels'
import { loadGraph } from '../pipeline'
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
        morePasses: [
          {
            bp: 900,
            windowBp: 0,
            reversed: true,
            replacedBp: 900,
            onReferenceBp: 600,
            gapBp: 300,
          },
        ],
      },
      reference,
    ),
  ).toBe(
    "1.2 kb on GRCh38, reversed, in place of GRCh38's 1.4 kb · passes again, reversed: 600 bp on GRCh38 and 300 bp not drawn in place of GRCh38's 900 bp, of which 500 bp out of view",
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
  const reference = { bp: 700 }
  const call = { bp: 8600 }
  expect(
    walkRowReadout(
      {
        bp: 0,
        gapBp: 0,
        complete: false,
        stop: { contigEnds: true, shortBp: 580 },
      },
      reference,
      51,
      call,
    ),
  ).toBe('contig ends 580 bp before the repeat · called 8.6 kb')
  expect(
    walkRowReadout(
      {
        bp: 1500,
        gapBp: 0,
        complete: false,
        stop: { contigEnds: false, shortBp: 0 },
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
        stop: { contigEnds: true, shortBp: 0 },
      },
      reference,
    ),
  ).toBe('≥ 1.5 kb · contig ends inside the window')
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

test('a readout goes beside its bar where it fits there, clear of the row name', () => {
  const svg = serializeEl(
    walkRowsTree(rows(), {
      scaleX: 1,
      scaleY: 1,
      translateX: 40 - region.start,
      translateY: 20,
      width: 100,
      height: 400,
    }),
  )
  expect(svg).toContain('text-anchor="start"')
  expect(svg).not.toContain('text-anchor="end"')
})

// HG3 walks the window in two pieces, a gap between them
test('a readout goes inside its bar only over solid bar, past the last gap', () => {
  const bars = rows()
  const hg3 = bars.rows.find(row => row.name === 'HG3#1#ctg3')!
  const scaleX = 20
  const translateX = 40 - bars.origin * scaleX
  const along = (offset: number) => (bars.origin + offset) * scaleX + translateX
  const endX = along(barEnd(hg3))
  const gapEnd = hg3.runs.reduce(
    (end, run) => (run.gap ? Math.max(end, run.start + run.bp) : end),
    0,
  )
  const text = walkRowReadout(hg3, bars.reference)
  const textStart = endX - 6 - text.length * LABEL_CHAR_PX
  expect(textStart).toBeGreaterThan(12 + hg3.label.length * LABEL_CHAR_PX)
  expect(textStart).toBeLessThan(along(gapEnd))
  const svg = serializeEl(
    walkRowsTree(
      { ...bars, rows: [hg3] },
      {
        scaleX,
        scaleY: 1,
        translateX,
        translateY: 20,
        width: endX + 50,
        height: 400,
        measure: (shown: string) => shown.length * LABEL_CHAR_PX,
      },
    ),
  )
  expect(svg).toContain(`<title>${text}</title>`)
  expect(svg).toContain('text-anchor="start">26 bp, …</text>')
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
    anchor: 'start',
  })
  expect(roomy.x).toBeCloseTo(beside)
  expect(
    walkRowReadoutAt(bars, 1, frame(beside + cut.length * LABEL_CHAR_PX + 1)),
  ).toMatchObject({ text, shown: cut, cut: true })
  expect(walkRowReadoutAt(bars, 1, frame(beside + 10)).shown).toBe(
    '5361 kb (+5360 kb), …',
  )
  const left = longRow()
  left.rows[0] = { ...left.rows[0]!, unloadedBp: 10 }
  expect(walkRowReadoutAt(left, 1, frame(800)).shown).toBe(text)
  expect(
    walkRowReadoutAt(left, 1, frame(900), { comparing: true }),
  ).toMatchObject({ text: `${text} · not compared`, cut: false })
  expect(
    walkRowReadoutAt(left, 1, frame(beside + 10), { comparing: true }).shown,
  ).toBe('5361 kb (+5360 kb), … · not compared')
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
  expect(svg).toContain('text-anchor="start">26 bp, …</text>')
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
    'no step on GRCh38 across 120 kb · 49 kb of its own, 19 kb left out of graph'
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
      '49 kb of its own, 19 kb left out of graph',
    ],
    cut: false,
    anchor: 'start',
  })
  expect(at.lines.every(line => measure(line) <= 320)).toBe(true)
  const svg = serializeEl(walkRowsTree(bars, frame(beside + 320)))
  expect(svg).toContain(
    `<tspan x="${at.x}">no step on GRCh38 across 120 kb</tspan><tspan x="${at.x}" dy="10">49 kb of its own, 19 kb left out of graph</tspan>`,
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
  expect(walkRowReadoutAt(bars, 1, frame(beside + 200))).toMatchObject({
    lines: ['no step on GRCh38 across 120 kb · …'],
    cut: true,
  })
  expect(walkRowReadoutAt(bars, 1, frame(beside + 320, 16))).toMatchObject({
    lines: ['no step on GRCh38 across 120 kb · …'],
    cut: true,
  })
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
    'no step on GRCh38 across 850 bp · 40 bp of its own, all left out of graph',
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
