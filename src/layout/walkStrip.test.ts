import { coalesceRuns } from './walkRowDraw'
import { walkRows } from './walkRows'
import {
  LABELLED_ROW_PX,
  segmentAt,
  stripGeneGaps,
  stripMarks,
  stripRowAt,
  walkMarksTree,
  walkStripFrame,
} from './walkStrip'
import { serializeEl } from '../el'
import { loadGraph } from '../pipeline'

// Five 10 bp reference nodes on chr1 from 1000; HG1 passes `c` twice, a
// collapsed repeat; HG2 walks the reference backwards; HG3 comes in two pieces
const GFA = [
  'H\tVN:Z:1.1',
  ...['a', 'b', 'c', 'd', 'e'].map(id => `S\t${id}\tAAAAAAAAAA`),
  'S\tx\tCCCCC',
  'W\tGRCh38\t0\tchr1\t1000\t1050\t>a>b>c>d>e',
  'W\tHG1\t1\tctg1\t500\t555\t>a>x>c>c>d>e',
  'W\tHG2\t2\tctg2\t100\t150\t<e<d<c<b<a',
  'W\tHG3\t1\tctg3\t0\t20\t>a>b',
  'W\tHG3\t1\tctg3\t30\t50\t>d>e',
].join('\n')

const region = { start: 1012, end: 1038 }

function setup() {
  const graph = loadGraph(GFA, 'test')
  const bars = walkRows(graph, region)!
  const node = (name: string) => graph.nodes.find(n => n.name === name)!
  const row = (name: string) => bars.rows.find(r => r.name === name)!
  return { graph, bars, node, row }
}

test('a node marks every pass each walk makes through it, on its own bar', () => {
  const { graph, bars, node } = setup()
  const marks = stripMarks(graph, [bars.reference, ...bars.rows], node('c'))
  expect(marks).toEqual(
    expect.arrayContaining([
      { row: 'GRCh38#0#chr1', start: 10, bp: 10 },
      { row: 'HG1#1#ctg1', start: 5, bp: 10 },
      { row: 'HG1#1#ctg1', start: 15, bp: 10 },
      { row: 'HG2#2#ctg2', start: 10, bp: 10 },
    ]),
  )
  expect(marks.filter(m => m.row === 'HG1#1#ctg1')).toHaveLength(2)
})

test('a node off the bar leaves no mark', () => {
  const { graph, bars, node } = setup()
  expect(stripMarks(graph, bars.rows, node('a'))).toEqual([])
})

test('the node under a point on a bar, forward, reversed and past a gap', () => {
  const { graph, node, row } = setup()
  const id = (name: string) => node(name).id
  expect(segmentAt(graph, row('HG1#1#ctg1'), 2, 10)).toBe(id('x'))
  expect(segmentAt(graph, row('HG1#1#ctg1'), 7, 10)).toBe(id('c'))
  expect(segmentAt(graph, row('HG2#2#ctg2'), 2, 10)).toBe(id('b'))
  expect(segmentAt(graph, row('HG3#1#ctg3'), 25, 10)).toBe(id('d'))
  expect(segmentAt(graph, row('HG3#1#ctg3'), 15, 10)).toBeUndefined()
})

test('at a coarse scale the longest node within a pixel wins', () => {
  const { graph, node, row } = setup()
  expect(segmentAt(graph, row('HG1#1#ctg1'), 4, 0.1)).toBe(node('c').id)
})

test('sub-pixel runs merge into the colour most of their bp carry', () => {
  const runs = [
    { start: 0, bp: 3, onReference: true, referenceStart: 0 },
    { start: 3, bp: 1, onReference: false },
    { start: 4, bp: 2, onReference: true, referenceStart: 4 },
    { start: 6, bp: 100, onReference: false },
    { start: 106, bp: 20, onReference: false, gap: true as const },
  ]
  expect(coalesceRuns(runs, 0.1)).toEqual([
    { start: 0, bp: 6, onReference: true, referenceStart: 0 },
    runs[3],
    runs[4],
  ])
  expect(coalesceRuns(runs, 10)).toEqual(runs)
})

test('the strip fits every row, shrinking them and dropping labels as they crowd', () => {
  const { bars } = setup()
  const roomy = walkStripFrame(bars, {
    width: 800,
    maxHeight: 400,
    labelPx: 90,
  })
  expect(roomy.rowPx).toBe(20)
  expect(roomy.labelled).toBe(true)
  const tight = walkStripFrame(bars, { width: 800, maxHeight: 40, labelPx: 90 })
  expect(tight.rowPx).toBeLessThan(LABELLED_ROW_PX)
  expect(tight.labelled).toBe(false)
  expect(tight.readouts).toBe(false)
  expect(tight.height).toBeLessThanOrEqual(40)
})

test('a point on the strip finds its row and bar offset, and ticks draw there', () => {
  const { graph, bars, node } = setup()
  const frame = walkStripFrame(bars, {
    width: 800,
    maxHeight: 400,
    labelPx: 90,
  })
  const i = 1 + bars.rows.findIndex(r => r.name === 'HG1#1#ctg1')
  const x = (bars.origin + 7) * frame.scaleX + frame.translateX
  const y = i * frame.rowPx + frame.translateY
  expect(stripRowAt(bars, frame, x, y)).toMatchObject({
    index: i,
    offset: expect.closeTo(7, 5),
  })
  const svg = serializeEl(
    walkMarksTree(
      bars,
      frame,
      stripMarks(graph, [bars.reference, ...bars.rows], node('c')),
    ),
  )
  expect(svg.match(/<rect /g)).toHaveLength(2 * 4)
})

test('a crowded strip says its genes are left out, even with no rows untracked', () => {
  const { bars } = setup()
  const roomy = walkStripFrame(bars, { width: 800, maxHeight: 400 })
  const tight = walkStripFrame(bars, { width: 800, maxHeight: 40 })
  const genes = new Map([
    [bars.reference.name, [{ name: 'G', start: 0, end: 5, exons: [] }]],
  ])
  const gaps = { untracked: 2, unread: 0 }
  expect(roomy.boxesGenes).toBe(true)
  expect(tight.boxesGenes).toBe(false)
  expect(stripGeneGaps(roomy, gaps, genes)).toBe(gaps)
  expect(stripGeneGaps(roomy, gaps, new Map())).toBeUndefined()
  expect(stripGeneGaps(tight, undefined)).toBeUndefined()
  expect(stripGeneGaps(tight, undefined, genes)).toEqual({
    untracked: 0,
    unread: 0,
    crowded: true,
  })
})
