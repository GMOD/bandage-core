import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { anchorGraph } from '../pathAnchoring'
import { walkLift } from '../walkHighlight'
import { Canvas2DRenderer } from './Canvas2DRenderer'
import { buildGeometry } from './GeometryBuilder'
import { linksAlongNodes } from './alongNodes'
import { abgrToCssRgba } from './colorBits'
import { recordingCanvas } from './recordingCanvas'

const row = (x0: number, x1: number, y = 0) => [
  { x: x0, y },
  { x: x1, y },
]

describe('linksAlongNodes', () => {
  test('a link whose ends lie 3 px or more apart along a node is along it', () => {
    expect([
      ...linksAlongNodes(
        [row(0, 10), row(10, 20), row(20, 30)],
        [{ edge: 0, a: { x: 10, y: 0 }, b: { x: 20, y: 0 } }],
      ),
    ]).toEqual([0])
  })

  test('a link whose ends lie under 3 px apart, or apart with no node between, is not', () => {
    const lines = [row(0, 10), row(12, 22), row(40, 50)]
    const links = [
      { edge: 0, a: { x: 10, y: 0 }, b: { x: 12, y: 0 } },
      { edge: 1, a: { x: 22, y: 0 }, b: { x: 40, y: 0 } },
    ]
    expect([...linksAlongNodes(lines, links)]).toEqual([])
  })

  test('a link running 1 px beside a node is along it, 2 px beside it is not', () => {
    const lines = [row(0, 30)]
    const links = [
      { edge: 0, a: { x: 5, y: 1 }, b: { x: 25, y: 1 } },
      { edge: 1, a: { x: 5, y: 2 }, b: { x: 25, y: 2 } },
    ]
    expect([...linksAlongNodes(lines, links)]).toEqual([0])
  })
})

// the reference steps A then D; an insertion X, Y, Z between them, laid in a
// row beside the reference, and a walk taking it that skips Y, whose link
// from X to Z the layout lays along Y
const graph = anchorGraph(
  convertGFAToGraph(
    parseGFA(
      [
        'S\tA\tAAAAAAAAAA',
        'S\tX\tCCCCCCCCCC',
        'S\tY\tGGGGGGGGGG',
        'S\tZ\tTTTTTTTTTT',
        'S\tD\tAAAAAAAAAA',
        'L\tA\t+\tD\t+\t0M',
        'L\tA\t+\tX\t+\t0M',
        'L\tX\t+\tY\t+\t0M',
        'L\tY\t+\tZ\t+\t0M',
        'L\tX\t+\tZ\t+\t0M',
        'L\tZ\t+\tD\t+\t0M',
        'W\tref\t0\tchr\t0\t20\t>A>D',
        'W\talt\t1\tchr\t0\t*\t>A>X>Z>D',
      ].join('\n'),
    ),
  ),
  'ref',
)
const nodePositions = {
  'A+': row(0, 10),
  'X+': row(10, 20, 20),
  'Y+': row(20, 30, 20),
  'Z+': row(30, 40, 20),
  'D+': row(40, 50),
}
const batchOf = (lifted: boolean) =>
  buildGeometry({
    nodePositions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: { scaleX: 1, scaleY: 1 },
    stranded: true,
    ...(lifted ? { highlight: walkLift(graph, [{ walk: 'alt#1#chr' }]) } : {}),
  })
const named = (ei: number) => {
  const { from, to } = graph.edges[ei]!
  return `${from.slice(0, -1)}${to.slice(0, -1)}`
}
const strokesOf = (batch: ReturnType<typeof batchOf>, link: string) => {
  const ei = graph.edges.findIndex((_, i) => named(i) === link)
  const run = batch.edgeCurveRuns.get(ei)
  return run ? batch.edgeCurves.slice(run.start, run.start + run.count) : []
}

test('only the plain link whose ends lie apart along a node it would run under is marked along', () => {
  const batch = batchOf(false)
  const links = ['AD', 'AX', 'XY', 'YZ', 'XZ', 'ZD']
  expect(links.map(link => strokesOf(batch, link).length > 0)).toEqual(
    links.map(() => true),
  )
  expect(
    links.map(link => strokesOf(batch, link).every(s => s.along === true)),
  ).toEqual([false, false, false, false, true, false])
})

test('a link along nodes is painted after them, as a skip is, and other plain links before them', () => {
  const batch = batchOf(false)
  const { canvas, strokes } = recordingCanvas()
  const renderer = new Canvas2DRenderer(canvas)
  renderer.uploadGeometry(batch)
  renderer.updateTransform({
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
    dpr: 1,
  })
  renderer.render([1, 1, 1, 1])
  const link = abgrToCssRgba(strokesOf(batch, 'XZ')[0]!.color)
  const node = abgrToCssRgba(batch.nodeStrokes[0]!.color)
  expect(strokes).toEqual([link, node, link])
})

test("a lifted walk's lane on a link along nodes is marked along too", () => {
  const lanes = strokesOf(batchOf(true), 'XZ')
  expect(lanes.length).toBeGreaterThan(0)
  expect(lanes.every(lane => lane.walk === 0 && lane.along === true)).toBe(true)
})
