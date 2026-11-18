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

const node = (points: { x: number; y: number }[], halfWidth = 3) => ({
  points,
  halfWidth,
})

describe('linksAlongNodes', () => {
  test('a link whose ends lie 3 px or more apart along a node is along it', () => {
    expect([
      ...linksAlongNodes(
        [node(row(0, 10)), node(row(10, 20)), node(row(20, 30))],
        [{ id: 0, a: { x: 10, y: 0 }, b: { x: 20, y: 0 } }],
      ),
    ]).toEqual([0])
  })

  test('a link whose ends lie under 3 px apart, or apart with no node between, is not', () => {
    const lines = [node(row(0, 10)), node(row(12, 22)), node(row(40, 50))]
    const links = [
      { id: 0, a: { x: 10, y: 0 }, b: { x: 12, y: 0 } },
      { id: 1, a: { x: 22, y: 0 }, b: { x: 40, y: 0 } },
    ]
    expect([...linksAlongNodes(lines, links)]).toEqual([])
  })

  test('zoomed far in, a link along a slanting node its whole length is along it, one 2 px beside it is not', () => {
    const lines = [
      node([
        { x: 0, y: 0 },
        { x: 1_000_000, y: 1_000_000 },
      ]),
    ]
    const links = [
      { id: 0, a: { x: 10, y: 10 }, b: { x: 900_000, y: 900_000 } },
      { id: 1, a: { x: 11.5, y: 8.5 }, b: { x: 900_001.5, y: 899_998.5 } },
    ]
    expect([...linksAlongNodes(lines, links)]).toEqual([0])
  })

  test('a link running 1 px beside a node is along it, 2 px beside it is not', () => {
    const lines = [node(row(0, 30))]
    const links = [
      { id: 0, a: { x: 5, y: 1 }, b: { x: 25, y: 1 } },
      { id: 1, a: { x: 5, y: 2 }, b: { x: 25, y: 2 } },
    ]
    expect([...linksAlongNodes(lines, links)]).toEqual([0])
  })

  test('a link along a node too thin to cover it, which leaves it showing, is not along it', () => {
    const lines = [node(row(0, 30), 0.4)]
    const links = [{ id: 0, a: { x: 5, y: 0.8 }, b: { x: 25, y: 0.8 } }]
    expect([...linksAlongNodes(lines, links)]).toEqual([])
  })

  test("a lane's link across other lanes that cover it is along them; a plain link there, or a lane's across its own lane or faded nodes, is not", () => {
    const band = [0, 6, 12].map(y => ({ ...node(row(0, 30, y)), walk: 1 }))
    const across = { a: { x: 10, y: 0 }, b: { x: 10, y: 12 } }
    expect([
      ...linksAlongNodes(band, [
        { id: 0, ...across },
        { id: 1, ...across, walk: 0 },
        { id: 2, ...across, walk: 1 },
      ]),
    ]).toEqual([1])
    expect([
      ...linksAlongNodes(
        band.map(line => ({ ...line, faded: true })),
        [{ id: 1, ...across, walk: 0 }],
      ),
    ]).toEqual([])
  })

  test("a lane's link the other lanes leave clear for half its length is not along them", () => {
    const lines = [0, 20].map(y => ({ ...node(row(0, 30, y)), walk: 1 }))
    const links = [{ id: 0, a: { x: 10, y: 0 }, b: { x: 10, y: 20 }, walk: 0 }]
    expect([...linksAlongNodes(lines, links)]).toEqual([])
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
        'W\tins\t1\tchr\t0\t*\t>A>X>Y>Z>D',
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
  const linkInk = abgrToCssRgba(strokesOf(batch, 'XZ')[0]!.color)
  const nodeInk = abgrToCssRgba(batch.nodeStrokes[0]!.color)
  expect(strokes).toEqual([linkInk, nodeInk, linkInk])
})

test("a lifted walk's lane on a link along nodes is marked along too", () => {
  const lanes = strokesOf(batchOf(true), 'XZ')
  expect(lanes.length).toBeGreaterThan(0)
  expect(lanes.every(lane => lane.walk === 0 && lane.along === true)).toBe(true)
})

test("a lane is judged where it is drawn: lifted beside the other walk's lane on the node it skips, it is not along it", () => {
  const batch = buildGeometry({
    nodePositions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: { scaleX: 1, scaleY: 1 },
    stranded: true,
    highlight: walkLift(graph, [{ walk: 'alt#1#chr' }, { walk: 'ins#1#chr' }]),
  })
  const lanes = strokesOf(batch, 'XZ')
  expect(lanes.map(lane => lane.walk)).toEqual([0])
  expect(lanes[0]!.along).toBeUndefined()
})

test("a lane's link that another walk's lane, on a node laid across it, would cover is marked along; with that node laid apart it is not", () => {
  const crossed = anchorGraph(
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
          'L\tX\t+\tZ\t+\t0M',
          'L\tZ\t+\tD\t+\t0M',
          'L\tA\t+\tY\t+\t0M',
          'L\tY\t+\tD\t+\t0M',
          'W\tref\t0\tchr\t0\t20\t>A>D',
          'W\talt\t1\tchr\t0\t*\t>A>X>Z>D',
          'W\tcross\t1\tchr\t0\t*\t>A>Y>D',
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const laneOfXZ = (y: { x: number; y: number }[]) => {
    const batch = buildGeometry({
      nodePositions: {
        'A+': row(0, 10),
        'X+': row(10, 20, 20),
        'Z+': row(24, 34, 20),
        'Y+': y,
        'D+': row(40, 50),
      },
      graph: crossed,
      nodeById: new Map(crossed.nodes.map(n => [n.id, n])),
      colorScheme: 'uniform',
      contigThickness: 10,
      connectorThickness: 4,
      drawPaths: false,
      axis: { scaleX: 1, scaleY: 1 },
      stranded: true,
      highlight: walkLift(crossed, [
        { walk: 'alt#1#chr' },
        { walk: 'cross#1#chr' },
      ]),
    })
    const ei = crossed.edges.findIndex(e => e.from === 'X+' && e.to === 'Z+')
    const run = batch.edgeCurveRuns.get(ei)
    return run ? batch.edgeCurves.slice(run.start, run.start + run.count) : []
  }
  const across = laneOfXZ([
    { x: 22, y: 0 },
    { x: 22, y: 40 },
  ])
  expect(across.map(lane => [lane.walk, lane.along])).toEqual([[0, true]])
  const apart = laneOfXZ(row(16, 28, 60))
  expect(apart.map(lane => [lane.walk, lane.along])).toEqual([[0, undefined]])
})
