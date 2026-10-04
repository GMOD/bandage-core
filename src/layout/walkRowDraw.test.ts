import {
  genesOnRow,
  placeRowGenes,
  rowGeneBoxes,
  rowSpan,
  walkRowReadout,
  walkRowsKey,
  walkRowsKeyTree,
  walkRowsTree,
} from './walkRowDraw'
import { walkRows } from './walkRows'
import { serializeEl } from '../el'
import { loadGraph } from '../pipeline'

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
  ).toBe('168 kb (−72 kb) · 19 kb outside the cut')
})

test('the key says the colours are the graph’s alignment', () => {
  const key = walkRowsKey(rows(), { genes: { untracked: 2, unread: 0 } })
  expect(key.map(e => e.label)).toEqual([
    "on GRCh38#0's path",
    "off GRCh38#0's path",
    'walked outside the cut',
    "genes, each row's own annotation",
    'no gene track for 2 rows',
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
