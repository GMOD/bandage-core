import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { anchorGraph } from '../pathAnchoring'
import { walkLift } from '../walkHighlight'
import {
  Canvas2DRenderer,
  SUBPATHS_PER_STROKE,
  WEIGHT_STEP_PX,
  arrowheadOutline,
} from './Canvas2DRenderer'
import { buildGeometry } from './GeometryBuilder'
import { FADED_ALPHA, abgrToCssRgba, packAbgr } from './colorBits'
import { recordingCanvas } from './recordingCanvas'
import { svgCanvas } from './svgCanvas'

import type { TransformUniform } from './types'

// isotropic: one scale for both axes, which is every layout but the row ones
const iso = (scale = 1) => ({ scaleX: scale, scaleY: scale })

function makeRenderer() {
  const { canvas, ...recorded } = recordingCanvas()
  return { renderer: new Canvas2DRenderer(canvas), canvas, ...recorded }
}

const TRANSFORM: TransformUniform = {
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
  dpr: 1,
}

// three nodes in a row wired A -> B -> C, so edge 0 and edge 1 are distinct
// strokes and a highlight on one must not touch the other
const nodes = [
  { id: 'A+', name: 'A', length: 10, depth: 1 },
  { id: 'B+', name: 'B', length: 10, depth: 1 },
  { id: 'C+', name: 'C', length: 10, depth: 1 },
]

function batchOf2Edges() {
  return buildGeometry({
    nodePositions: {
      'A+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'B+': [
        { x: 40, y: 0 },
        { x: 50, y: 0 },
      ],
      'C+': [
        { x: 80, y: 0 },
        { x: 90, y: 0 },
      ],
    },
    graph: {
      name: 'test',
      nodes,
      edges: [
        { from: 'A+', to: 'B+' },
        { from: 'B+', to: 'C+' },
      ],
    },
    nodeById: new Map(nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: iso(),
  })
}

function channels(rgba: string) {
  const m = /rgba\((\d+),(\d+),(\d+)/.exec(rgba)
  return [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])]
}

function expectBrighter(a: string, b: string) {
  const [r, g, bl] = channels(a)
  const [br, bg, bb] = channels(b)
  expect(r).toBeGreaterThan(br!)
  expect(g).toBeGreaterThan(bg!)
  expect(bl).toBeGreaterThan(bb!)
}

// Two edges of one colour and weight, three nodes of one colour: a drawing is
// mostly runs of one paint, and each run is one path. This is the whole
// performance story of the renderer, so it is pinned exactly.
test('strokes every edge of one paint as one path, and every node likewise', () => {
  const { renderer, strokes } = makeRenderer()
  renderer.uploadGeometry(batchOf2Edges())
  renderer.updateTransform(TRANSFORM)
  renderer.render([1, 1, 1, 1])

  expect(strokes).toHaveLength(2)
})

test('a highlighted edge is stroked brighter, apart from its neighbour', () => {
  const { renderer, strokes } = makeRenderer()
  renderer.uploadGeometry(batchOf2Edges())
  renderer.updateTransform(TRANSFORM)
  renderer.render([1, 1, 1, 1])
  const [edges, nodeStroke] = strokes as [string, string]

  strokes.length = 0
  renderer.setEdgeHighlight(1, 1.6)
  renderer.render([1, 1, 1, 1])

  // edge 0 in its own path, then the nodes, then edge 1 on top of everything
  expect(strokes).toEqual([edges, expect.any(String), nodeStroke])
  expect(strokes[1]).not.toBe(edges)
  expectBrighter(strokes[1]!, edges)
})

test('clearing the highlight restores the base stroke', () => {
  const { renderer, strokes } = makeRenderer()
  renderer.uploadGeometry(batchOf2Edges())
  renderer.updateTransform(TRANSFORM)
  renderer.setEdgeHighlight(0, 1.6)
  renderer.render([1, 1, 1, 1])
  expect(strokes).toHaveLength(3)

  strokes.length = 0
  renderer.setEdgeHighlight(null, 1.6)
  renderer.render([1, 1, 1, 1])

  expect(strokes).toHaveLength(2)
})

// A rebuild renumbers the strokes, so an edge captured against the old batch
// could brighten an unrelated one. The model re-applies the current hover after
// every upload; the renderer's job is not to keep pointing at a stale run.
test('uploading a new batch drops the previous edge highlight', () => {
  const { renderer, strokes } = makeRenderer()
  renderer.uploadGeometry(batchOf2Edges())
  renderer.updateTransform(TRANSFORM)
  renderer.setEdgeHighlight(1, 1.6)
  renderer.render([1, 1, 1, 1])
  expect(strokes).toHaveLength(3)

  strokes.length = 0
  renderer.uploadGeometry(batchOf2Edges())
  renderer.render([1, 1, 1, 1])

  expect(strokes).toHaveLength(2)
})

// Node highlights are keyed by id rather than by position in the batch, so
// they survive a rebuild on their own and the hovered node lands on top.
test('a highlighted node is stroked brighter, last, and survives a rebuild', () => {
  const { renderer, strokes } = makeRenderer()
  renderer.uploadGeometry(batchOf2Edges())
  renderer.updateTransform(TRANSFORM)
  renderer.render([1, 1, 1, 1])
  const nodeStroke = strokes[1]!

  strokes.length = 0
  renderer.setNodeHighlights(new Map([['B+', 1.4]]))
  renderer.render([1, 1, 1, 1])
  expect(strokes).toHaveLength(3)
  expect(strokes[1]).toBe(nodeStroke)
  expectBrighter(strokes[2]!, nodeStroke)

  strokes.length = 0
  renderer.uploadGeometry(batchOf2Edges())
  renderer.render([1, 1, 1, 1])
  expect(strokes).toHaveLength(3)
})

// A hover layer over a canvas that drew the batch without the hover strokes
// the hovered things alone, in the colours a full render lifts them to
test('renderHighlights strokes only what is lit, over a clear', () => {
  const full = makeRenderer()
  full.renderer.uploadGeometry(batchOf2Edges())
  full.renderer.updateTransform(TRANSFORM)
  full.renderer.setNodeHighlights(new Map([['B+', 1.4]]))
  full.renderer.setEdgeHighlight(1, 1.6)
  full.renderer.render([1, 1, 1, 1])
  const [, litEdge, , litNode] = full.strokes

  const { renderer, strokes, clears } = makeRenderer()
  renderer.uploadGeometry(batchOf2Edges())
  renderer.updateTransform(TRANSFORM)
  renderer.renderHighlights()
  expect(clears()).toBe(1)
  expect(strokes).toEqual([])

  renderer.setNodeHighlights(new Map([['B+', 1.4]]))
  renderer.setEdgeHighlight(1, 1.6)
  renderer.renderHighlights()
  expect(clears()).toBe(2)
  expect(strokes).toEqual([litEdge, litNode])
})

test('a thin shallow node over a wide deep one is painted after it', () => {
  const shallow = { id: 'S+', name: 'S', length: 2, depth: 1 }
  const deep = { id: 'D+', name: 'D', length: 10, depth: 40 }
  const { renderer, lineWidths } = makeRenderer()
  renderer.uploadGeometry(
    buildGeometry({
      nodePositions: {
        'S+': [
          { x: 4, y: 0 },
          { x: 6, y: 0 },
        ],
        'D+': [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      graph: { name: 'test', nodes: [shallow, deep], edges: [] },
      nodeById: new Map([shallow, deep].map(n => [n.id, n])),
      colorScheme: 'uniform',
      contigThickness: 6,
      connectorThickness: 2,
      drawPaths: false,
      nodeWidth: 'depth',
      axis: iso(),
    }),
  )
  renderer.updateTransform(TRANSFORM)
  renderer.render([1, 1, 1, 1])

  const [wide = 0, thin = 0] = lineWidths
  expect(lineWidths).toHaveLength(2)
  expect(thin).toBeLessThan(wide)
})

function depthBatch(
  drawn: {
    id: string
    name: string
    length: number
    depth: number
    placeholder?: true
  }[],
) {
  return buildGeometry({
    nodePositions: Object.fromEntries(
      drawn.map(n => [
        n.id,
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      ]),
    ),
    graph: { name: 'test', nodes: drawn, edges: [] },
    nodeById: new Map(drawn.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'depth',
    axis: iso(),
  })
}

test('a wide hovered node is painted after a thin plain one', () => {
  const { renderer, lineWidths } = makeRenderer()
  renderer.uploadGeometry(
    depthBatch([
      { id: 'S+', name: 'S', length: 2, depth: 1 },
      { id: 'D+', name: 'D', length: 10, depth: 40 },
    ]),
  )
  renderer.updateTransform(TRANSFORM)
  renderer.setNodeHighlights(new Map([['D+', 1.4]]))
  renderer.render([1, 1, 1, 1])

  const [thin = 0, wide = 0] = lineWidths
  expect(lineWidths).toHaveLength(2)
  expect(thin).toBeLessThan(wide)
})

test('a placeholder is painted under every loaded node, however wide they are', () => {
  const { renderer, strokes, lineWidths } = makeRenderer()
  renderer.uploadGeometry(
    depthBatch([
      { id: 'A+', name: 'A', length: 2, depth: 1 },
      { id: 'P+', name: 'P', length: 10, depth: 10, placeholder: true },
      { id: 'R+', name: 'R', length: 10, depth: 40 },
    ]),
  )
  renderer.updateTransform(TRANSFORM)
  renderer.render([1, 1, 1, 1])

  const [rim = 0, fill = 0, reference = 0, allele = 0] = lineWidths
  expect(strokes).toEqual([
    'rgba(128,128,128,1)',
    'rgba(244,244,244,1)',
    expect.any(String),
    expect.any(String),
  ])
  expect(fill).toBeLessThan(rim)
  expect(rim).toBeLessThan(reference)
  expect(allele).toBeLessThan(reference)
})

describe('nodes of nearly one depth', () => {
  const near = [30, 30.4, 31, 31.3, 45].map((depth, i) => ({
    id: `N${i}+`,
    name: `N${i}`,
    length: 10,
    depth,
  }))
  const batch = depthBatch(near)
  const widths = batch.nodeStrokes.map(s => s.thickness * 2)

  test('share a path per step of width on a raster canvas, each drawn within half a step', () => {
    const { renderer, lineWidths } = makeRenderer()
    renderer.uploadGeometry(batch)
    renderer.updateTransform({ ...TRANSFORM, dpr: 2 })
    renderer.render([1, 1, 1, 1])

    const step = 2 * WEIGHT_STEP_PX
    expect(new Set(widths).size).toBe(5)
    expect(lineWidths).toEqual([2 * 7, 2 * 5.75])
    for (const width of widths) {
      const drawn = lineWidths.map(w => w / 2)
      const nearest = Math.min(...drawn.map(d => Math.abs(d - width)))
      expect(nearest).toBeLessThanOrEqual(step / 2)
    }
  })

  test('keep a path each, at their own widths, in a figure', () => {
    const { canvas, markup } = svgCanvas(100, 100)
    const renderer = new Canvas2DRenderer(canvas)
    renderer.uploadGeometry(batch)
    renderer.updateTransform(TRANSFORM)
    renderer.render([1, 1, 1, 1])

    const written = [...markup().matchAll(/stroke-width="([\d.]+)"/g)]
    expect(written.map(([, w]) => Number(w))).toEqual(
      widths.toSorted((a, b) => b - a).map(w => +w.toFixed(1)),
    )
  })
})

function rowOfNodes(count: number, at: (i: number) => number, length: number) {
  const row = Array.from({ length: count }, (_, i) => ({
    id: `R${i}+`,
    name: `R${i}`,
    length: 10,
    depth: 1,
  }))
  return buildGeometry({
    nodePositions: Object.fromEntries(
      row.map((n, i) => [
        n.id,
        [
          { x: at(i), y: 0 },
          { x: at(i) + length, y: 0 },
        ],
      ]),
    ),
    graph: { name: 'test', nodes: row, edges: [] },
    nodeById: new Map(row.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    axis: iso(),
  })
}

describe('a paint of more subpaths than one stroke takes', () => {
  const count = 2 * SUBPATHS_PER_STROKE + 1
  const batch = rowOfNodes(count, i => i * 20, 10)

  test('is stroked in pieces of SUBPATHS_PER_STROKE on a raster canvas, every piece alike', () => {
    const { renderer, strokes, lineWidths, points } = makeRenderer()
    renderer.uploadGeometry(batch)
    renderer.updateTransform(TRANSFORM)
    renderer.render([1, 1, 1, 1])

    expect(strokes).toHaveLength(3)
    expect(new Set(strokes).size).toBe(1)
    expect(lineWidths).toEqual([6, 6, 6])
    expect(points).toHaveLength(2 * count)
  })

  test('is one path in a figure', () => {
    const { canvas, markup } = svgCanvas(100, 100)
    const renderer = new Canvas2DRenderer(canvas)
    renderer.uploadGeometry(batch)
    renderer.updateTransform(TRANSFORM)
    renderer.render([1, 1, 1, 1])

    expect(markup().match(/<path /g)).toHaveLength(1)
  })
})

test('a hairline under the width step is drawn at its own width', () => {
  const { renderer, lineWidths } = makeRenderer()
  const hair = { id: 'H+', name: 'H', length: 10, depth: 1 }
  renderer.uploadGeometry(
    buildGeometry({
      nodePositions: {
        'H+': [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      graph: { name: 'test', nodes: [hair], edges: [] },
      nodeById: new Map([[hair.id, hair]]),
      colorScheme: 'uniform',
      contigThickness: 0.1,
      connectorThickness: 2,
      drawPaths: false,
      axis: iso(),
    }),
  )
  renderer.updateTransform(TRANSFORM)
  renderer.render([1, 1, 1, 1])

  expect(lineWidths).toEqual([0.1])
})

function skipBatch(scale: number) {
  return buildGeometry({
    nodePositions: {
      'A+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'B+': [
        { x: 40, y: 0 },
        { x: 50, y: 0 },
      ],
      'C+': [
        { x: 80, y: 0 },
        { x: 90, y: 0 },
      ],
    },
    graph: {
      name: 'test',
      nodes,
      edges: [
        { from: 'A+', to: 'B+' },
        { from: 'B+', to: 'C+' },
        { from: 'A+', to: 'C+' },
      ],
    },
    nodeById: new Map(nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: iso(scale),
    deletions: new Map([[2, ['B+']]]),
  })
}

function paintsOf(batch: ReturnType<typeof skipBatch>) {
  const css = (edge: number) =>
    abgrToCssRgba(batch.edgeCurves[batch.edgeCurveRuns.get(edge)!.start]!.color)
  return {
    link: css(0),
    skip: css(2),
    node: abgrToCssRgba(batch.nodeStrokes[0]!.color),
  }
}

describe('a link that skips the reference is painted over the nodes it skips', () => {
  test.each([
    ['dashed', 1],
    ['too short to dash', 0.3],
  ])('%s', (_, scale) => {
    const { renderer, strokes } = makeRenderer()
    const batch = skipBatch(scale)
    renderer.uploadGeometry(batch)
    renderer.updateTransform(TRANSFORM)
    renderer.render([1, 1, 1, 1])

    const { link, node, skip } = paintsOf(batch)
    expect(skip).not.toBe(link)
    expect(strokes).toEqual([link, node, skip])
  })

  test('a hovered node is painted over the skip', () => {
    const { renderer, strokes } = makeRenderer()
    const batch = skipBatch(1)
    renderer.uploadGeometry(batch)
    renderer.updateTransform(TRANSFORM)
    renderer.setNodeHighlights(new Map([['B+', 1.4]]))
    renderer.render([1, 1, 1, 1])

    const { link, node, skip } = paintsOf(batch)
    expect(strokes).toEqual([link, node, skip, expect.any(String)])
    expectBrighter(strokes[3]!, node)
  })
})

describe('a link turning strand against the reference is painted over the nodes it joins', () => {
  // the reference steps >A<B>C, so its own links join the same end of B as
  // it reads B; the link from A's end into C's end reads C against it
  const onReference = (id: string, start: number, strand: '+' | '-') => ({
    id,
    name: id.slice(0, -1),
    length: 10,
    depth: 1,
    stable: { refName: 'chr', start, rank: 0, strand },
  })
  const anchored = [
    onReference('A+', 0, '+'),
    onReference('B+', 10, '-'),
    onReference('C+', 20, '+'),
  ]
  const turning = buildGeometry({
    nodePositions: {
      'A+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'B+': [
        { x: 40, y: 0 },
        { x: 30, y: 0 },
      ],
      'C+': [
        { x: 60, y: 0 },
        { x: 70, y: 0 },
      ],
    },
    graph: {
      name: 'test',
      nodes: anchored,
      edges: [
        { from: 'A+', to: 'B+', fromStrand: '+', toStrand: '-' },
        { from: 'B+', to: 'C+', fromStrand: '-', toStrand: '+' },
        { from: 'A+', to: 'C+', fromStrand: '+', toStrand: '-' },
      ],
    },
    nodeById: new Map(anchored.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: iso(),
    stranded: true,
  })
  const turnOf = (edge: number) =>
    turning.edgeCurves[turning.edgeCurveRuns.get(edge)!.start]!.turn

  test('only the link reading one reference node as the reference does and the other against it is a turn', () => {
    expect([0, 1, 2].map(turnOf)).toEqual([undefined, undefined, true])
  })

  test("it is painted after the nodes, the reference's own links before them", () => {
    const { renderer, strokes } = makeRenderer()
    renderer.uploadGeometry(turning)
    renderer.updateTransform(TRANSFORM)
    renderer.render([1, 1, 1, 1])
    const link = abgrToCssRgba(turning.edgeCurves[0]!.color)
    const node = abgrToCssRgba(turning.nodeStrokes[0]!.color)
    expect(strokes).toEqual([link, node, link])
  })
})

test("a lifted walk's lane on a link turning strand against the reference is a turn, which the renderer paints over the nodes", () => {
  // the reference steps >r1>r2>r3, the lifted walk >r1<r2>r3
  const graph = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          'S\tr1\tAAAAAAAAAA',
          'S\tr2\tCCCCCCCCCC',
          'S\tr3\tGGGGGGGGGG',
          'L\tr1\t+\tr2\t+\t0M',
          'L\tr2\t+\tr3\t+\t0M',
          'L\tr1\t+\tr2\t-\t0M',
          'L\tr2\t-\tr3\t+\t0M',
          'W\tref\t0\tchr\t0\t30\t>r1>r2>r3',
          'W\talt\t1\tchr\t0\t*\t>r1<r2>r3',
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const batch = buildGeometry({
    nodePositions: {
      'r1+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'r2+': [
        { x: 40, y: 0 },
        { x: 50, y: 0 },
      ],
      'r3+': [
        { x: 80, y: 0 },
        { x: 90, y: 0 },
      ],
    },
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: iso(),
    stranded: true,
    highlight: walkLift(graph, [{ walk: 'alt#1#chr' }]),
  })
  const turning = graph.edges.flatMap((e, i) =>
    e.fromStrand !== e.toStrand ? [i] : [],
  )
  const lanes = turning.flatMap(edge => {
    const run = batch.edgeCurveRuns.get(edge)
    return run ? batch.edgeCurves.slice(run.start, run.start + run.count) : []
  })
  expect(lanes.length).toBe(2)
  expect(lanes.every(lane => lane.walk === 0 && lane.turn)).toBe(true)
})

test('a short skip is painted after a long one it crosses', () => {
  const four = [...nodes, { id: 'D+', name: 'D', length: 10, depth: 1 }]
  const batch = buildGeometry({
    nodePositions: {
      'A+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'B+': [
        { x: 12, y: 0 },
        { x: 14, y: 0 },
      ],
      'C+': [
        { x: 16, y: 0 },
        { x: 26, y: 0 },
      ],
      'D+': [
        { x: 100, y: 0 },
        { x: 110, y: 0 },
      ],
    },
    graph: {
      name: 'test',
      nodes: four,
      edges: [
        { from: 'A+', to: 'B+' },
        { from: 'B+', to: 'C+' },
        { from: 'C+', to: 'D+' },
        { from: 'A+', to: 'C+' },
        { from: 'A+', to: 'D+' },
      ],
    },
    nodeById: new Map(four.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: iso(),
    deletions: new Map([
      [3, ['B+']],
      [4, ['B+', 'C+']],
    ]),
  })
  const widthOf = (edge: number) =>
    batch.edgeCurves[batch.edgeCurveRuns.get(edge)!.start]!.thickness * 2
  const { renderer, lineWidths } = makeRenderer()
  renderer.uploadGeometry(batch)
  renderer.updateTransform(TRANSFORM)
  renderer.render([1, 1, 1, 1])

  expect(widthOf(3)).not.toBe(widthOf(4))
  expect(lineWidths.slice(-2).map(Math.round)).toEqual(
    [widthOf(4), widthOf(3)].map(Math.round),
  )
})

test('a skip drawn as its plain link is painted after a dashed skip it crosses', () => {
  const four = [...nodes, { id: 'D+', name: 'D', length: 10, depth: 1 }]
  const batch = buildGeometry({
    nodePositions: {
      'A+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'B+': [
        { x: 10.1, y: 0 },
        { x: 10.3, y: 0 },
      ],
      'C+': [
        { x: 10.5, y: 0 },
        { x: 20, y: 0 },
      ],
      'D+': [
        { x: 100, y: 0 },
        { x: 110, y: 0 },
      ],
    },
    graph: {
      name: 'test',
      nodes: four,
      edges: [
        { from: 'A+', to: 'B+' },
        { from: 'B+', to: 'C+' },
        { from: 'C+', to: 'D+' },
        { from: 'A+', to: 'C+' },
        { from: 'A+', to: 'D+' },
      ],
    },
    nodeById: new Map(four.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: iso(),
    deletions: new Map([
      [3, ['B+']],
      [4, ['B+', 'C+']],
    ]),
  })
  const strokeOf = (edge: number) =>
    batch.edgeCurves[batch.edgeCurveRuns.get(edge)!.start]!
  const { renderer, lineWidths } = makeRenderer()
  renderer.uploadGeometry(batch)
  renderer.updateTransform(TRANSFORM)
  renderer.render([1, 1, 1, 1])

  expect(strokeOf(3)).toMatchObject({ skip: true, span: 0 })
  expect(strokeOf(4).span).toBeGreaterThan(0)
  expect(strokeOf(3).thickness).not.toBe(strokeOf(4).thickness)
  expect(lineWidths.at(-1)).toBe(strokeOf(3).thickness * 2)
})

// A thickness is quoted in CSS pixels and expanded AFTER the transform, so it
// is the one term the dpr-scaled transform does not reach. Left alone, every
// tube, connector and arrowhead came out 1/dpr of its weight on a hidpi
// display, with the positions between them correct.
//
// Asserted as "twice the backing-store pixels at twice the ratio", which is the
// same drawing in css px. The whole point is that a figure does not change
// weight with the machine it is opened on.
describe('a thickness is css pixels, whatever the device ratio', () => {
  function drawn(dpr: number) {
    const { renderer, points, lineWidths } = makeRenderer()
    renderer.uploadGeometry(batchOf2Edges())
    renderer.updateTransform({ ...TRANSFORM, scaleX: dpr, scaleY: dpr, dpr })
    renderer.render([1, 1, 1, 1])
    const xs = points.map(p => p.x)
    return {
      spanPx: Math.max(...xs) - Math.min(...xs),
      edgeWidth: lineWidths[0]!,
      nodeWidth: lineWidths[1]!,
    }
  }

  test('positions go through the transform', () => {
    // three 10-unit nodes over a 90-unit span
    expect(drawn(1).spanPx).toBeCloseTo(90, 5)
    expect(drawn(2).spanPx).toBeCloseTo(180, 5)
  })

  test('a node stroke scales its width with the ratio', () => {
    expect(drawn(1).nodeWidth).toBeCloseTo(10, 5)
    expect(drawn(2).nodeWidth).toBeCloseTo(20, 5)
  })

  test('an edge stroke scales its width with the ratio', () => {
    // connectorThickness 4 is a half-width of 2, so a 4 px stroke at ratio 1
    expect(drawn(1).edgeWidth).toBeCloseTo(4, 5)
    expect(drawn(2).edgeWidth).toBeCloseTo(8, 5)
  })
})

test('a canvas past the backing-store limit draws the same picture, coarser', () => {
  vi.stubGlobal('devicePixelRatio', 2)
  try {
    const { renderer, canvas, points, lineWidths } = makeRenderer()
    renderer.resize(5000, 100)
    expect(canvas.width).toBe(8192)
    expect(canvas.height).toBe(164)
    renderer.uploadGeometry(batchOf2Edges())
    renderer.updateTransform({ ...TRANSFORM, scaleX: 2, scaleY: 2, dpr: 2 })
    renderer.render([1, 1, 1, 1])
    const xs = points.map(p => p.x)
    const fit = 8192 / 10000
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(180 * fit, 5)
    expect(lineWidths[1]).toBeCloseTo(20 * fit, 5)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('a resize past the backing-store limit after the transform still fits', () => {
  vi.stubGlobal('devicePixelRatio', 2)
  try {
    const { renderer, points } = makeRenderer()
    renderer.uploadGeometry(batchOf2Edges())
    renderer.updateTransform({ ...TRANSFORM, scaleX: 2, scaleY: 2, dpr: 2 })
    renderer.resize(5000, 100)
    renderer.render([1, 1, 1, 1])
    const xs = points.map(p => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(
      180 * (8192 / 10000),
      5,
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('arrowheadOutline', () => {
  const head = { x: 50, y: 0, angle: 0, length: 10, halfWidth: 4 }

  test('the barbs sit a length behind the tip, either side of it', () => {
    const [tip, left, notch, right] = arrowheadOutline(
      { ...head, color: 0 },
      TRANSFORM,
    )
    expect(tip).toEqual({ x: 50, y: 0 })
    expect(left).toEqual({ x: 40, y: 4 })
    expect(right).toEqual({ x: 40, y: -4 })
    expect(notch.x).toBeGreaterThan(40)
    expect(notch.x).toBeLessThan(50)
  })

  test('every px measure scales with the ratio, like a stroke weight', () => {
    const [tip, left] = arrowheadOutline(
      { ...head, color: 0 },
      { ...TRANSFORM, scaleX: 2, scaleY: 2, dpr: 2 },
    )
    expect(tip).toEqual({ x: 100, y: 0 })
    expect(left).toEqual({ x: 80, y: 8 })
  })
})

test('faded strokes paint opaque in one layer under the rest, laid down once', () => {
  const grey = packAbgr(160, 160, 160, 255)
  const blue = packAbgr(0, 0, 255, 255)
  const line = (x: number) => [
    { x, y: 0 },
    { x: x + 10, y: 0 },
  ]
  const { canvas, markup } = svgCanvas(100, 100)
  const renderer = new Canvas2DRenderer(canvas)
  renderer.updateTransform(TRANSFORM)
  renderer.uploadGeometry({
    nodeStrokes: [
      { points: line(0), thickness: 3, color: blue },
      { points: line(5), thickness: 2, color: grey, faded: true },
      { points: line(10), thickness: 4, color: grey, faded: true },
    ],
    nodeStrokeRuns: new Map(),
    edgeCurves: [],
    edgeCurveRuns: new Map(),
    arrows: [],
    arrowRuns: new Map(),
  })
  renderer.render([1, 1, 1, 0])
  const svg = markup()
  const layer = new RegExp(`<g opacity="${FADED_ALPHA}">(.*?)</g>`).exec(svg)
  expect(layer?.[1]?.match(/stroke="rgb\(160,160,160\)"/g)).toHaveLength(2)
  expect(layer?.[1]).not.toContain('stroke-opacity')
  expect(svg.indexOf('</g>')).toBeLessThan(svg.indexOf('rgb(0,0,255)'))
})

// A context as a browser gives one, with no opacity groups, so a faded layer
// is painted into a scratch canvas and drawn from it
function screenContext(width: number, height: number) {
  const drawn: { width: number; height: number; alpha: number }[] = []
  const ctx = {
    canvas: { width, height, style: {} },
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    bezierCurveTo: () => {},
    stroke: () => {},
    fill: () => {},
    fillRect: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    drawImage: (image: { width: number; height: number }) => {
      drawn.push({
        width: image.width,
        height: image.height,
        alpha: ctx.globalAlpha,
      })
    },
  }
  return { ctx, drawn }
}

test('a screen canvas lays its faded layer down from a scratch canvas its own size, which releasing offscreen targets or disposing empties', () => {
  const scratches: { width: number; height: number }[] = []
  const getContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'getContext',
  )
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => {
      const { ctx } = screenContext(300, 150)
      scratches.push(ctx.canvas)
      return ctx
    },
  })
  try {
    const { ctx, drawn } = screenContext(800, 600)
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getContext', { value: () => ctx })
    const renderer = new Canvas2DRenderer(canvas)
    renderer.updateTransform(TRANSFORM)
    renderer.uploadGeometry({
      nodeStrokes: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          thickness: 2,
          color: packAbgr(160, 160, 160, 255),
          faded: true,
        },
      ],
      nodeStrokeRuns: new Map(),
      edgeCurves: [],
      edgeCurveRuns: new Map(),
      arrows: [],
      arrowRuns: new Map(),
    })
    renderer.render([1, 1, 1, 1])
    expect(drawn).toEqual([{ width: 800, height: 600, alpha: FADED_ALPHA }])
    expect(scratches).toEqual([{ width: 800, height: 600, style: {} }])

    renderer.releaseOffscreenTargets()
    expect(scratches).toEqual([{ width: 0, height: 0, style: {} }])

    renderer.render([1, 1, 1, 1])
    expect(drawn).toHaveLength(2)
    expect(scratches[1]).toEqual({ width: 800, height: 600, style: {} })

    renderer.dispose()
    expect(scratches[1]).toEqual({ width: 0, height: 0, style: {} })
  } finally {
    if (getContext) {
      Object.defineProperty(
        HTMLCanvasElement.prototype,
        'getContext',
        getContext,
      )
    }
  }
})
