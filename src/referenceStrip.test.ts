import { RAMP_PIECE_DEG } from './referenceRampCss'
import {
  drawReferenceStrip,
  litOutline,
  nodeAnchor,
  referenceStripBlocks,
  stripBlockAt,
  stripFadedShown,
  stripOverhang,
  stripPixels,
} from './referenceStrip'
import { computeReferenceRamp, packHsl } from './renderer/GeometryBuilder'
import { abgrToCssRgba, packAbgr } from './renderer/colorBits'
import { recordingCanvas } from './renderer/recordingCanvas'

import type { Graph, GraphNode } from './types'

function node(id: string, start: number, length: number, rank: number) {
  return {
    id,
    name: id,
    length,
    depth: 1,
    stable: { refName: 'chr1', start, rank },
  } satisfies GraphNode
}

// b and c are listed out of order, and x is an allele over b
const graph: Graph = {
  name: 'g',
  nodes: [
    node('a', 1000, 100, 0),
    node('c', 1150, 50, 0),
    node('b', 1100, 50, 0),
    node('x', 0, 40, 1),
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'a', to: 'x' },
    { from: 'x', to: 'c' },
  ],
}

test('the strip is the backbone in bp order, painted the hue of its node', () => {
  const ramp = computeReferenceRamp(graph, { start: 1000, end: 1200 })
  const blocks = referenceStripBlocks(graph, {
    colorScheme: 'reference-position',
    referenceRamp: ramp,
  })
  expect(blocks.map(b => [b.node, b.bp0, b.bp1])).toEqual([
    ['a', 1000, 1100],
    ['b', 1100, 1150],
    ['c', 1150, 1200],
  ])
  // a's midpoint is a quarter along the ramp: hue 75
  expect(blocks[0]!.colors).toEqual(['rgba(172,217,38,1)'])
  expect(new Set(blocks.map(b => b.colors[0])).size).toBe(3)
})

// A reference node the window's ramp spans drew as one block in the hue of
// its middle, as the graph drew it
test('a block the ramp spans is painted in pieces, each the hue of its own middle, in whole pixels that abut', () => {
  const ramp = computeReferenceRamp(graph, { start: 1000, end: 1200 })
  const blocks = referenceStripBlocks(graph, {
    colorScheme: 'reference-position',
    referenceRamp: ramp,
  })
  const a = blocks[0]!
  expect(a.pieces).toHaveLength(150 / RAMP_PIECE_DEG)
  a.pieces!.forEach((piece, k) => {
    const mid = 1000 + ((piece.from + piece.to) / 2) * 100
    expect(piece.colors).toEqual([
      abgrToCssRgba(packHsl(((mid - 1000) / 200) * 300, 0.7, 0.5)),
    ])
    expect(piece.from).toBeCloseTo(k / a.pieces!.length)
  })
  const [pixel] = stripPixels(blocks, { scale: 2, translateX: -2000 }, 400, 2)
  expect(pixel!.pieces![0]!.x0).toBe(pixel!.x0)
  expect(pixel!.pieces!.at(-1)!.x1).toBe(pixel!.x1)
  pixel!.pieces!.slice(1).forEach((piece, k) => {
    expect(piece.x0).toBe(pixel!.pieces![k]!.x1)
    expect(piece.x0 * 2).toBe(Math.round(piece.x0 * 2))
  })
})

test('a lane coloured by reference position cuts its row of a block where the lane is cut, and the other rows keep their one colour', () => {
  const lane = packAbgr(10, 20, 30, 255)
  const other = packAbgr(40, 50, 60, 255)
  const cut = [
    { from: 0, to: 0.5, color: packAbgr(1, 2, 3, 255) },
    { from: 0.5, to: 1, color: packAbgr(4, 5, 6, 255) },
  ]
  const [a] = referenceStripBlocks(graph, {
    colorScheme: 'reference-position',
    walks: [
      { colors: new Map([['a', lane]]), rampColors: new Map([['a', cut]]) },
      { colors: new Map([['a', other]]) },
    ],
  })
  expect(a!.pieces).toEqual([
    {
      from: 0,
      to: 0.5,
      colors: [abgrToCssRgba(cut[0]!.color), abgrToCssRgba(other)],
    },
    {
      from: 0.5,
      to: 1,
      colors: [abgrToCssRgba(cut[1]!.color), abgrToCssRgba(other)],
    },
  ])
})

test('under lifted walks a block is a row per walk in its lane, pale where the walk skips it', () => {
  const ref = packAbgr(10, 20, 30, 255)
  const hap = packAbgr(40, 50, 60, 255)
  const blocks = referenceStripBlocks(graph, {
    colorScheme: 'uniform',
    walks: [
      { colors: new Map(['a', 'b', 'c'].map(id => [id, ref])) },
      { colors: new Map(['a', 'x', 'c'].map(id => [id, hap])) },
    ],
  })
  const pale: unknown = expect.stringMatching(/^rgba\(160,160,160,0\.3/)
  expect(blocks.map(b => b.colors)).toEqual([
    ['rgba(10,20,30,1)', 'rgba(40,50,60,1)'],
    ['rgba(10,20,30,1)', pale],
    ['rgba(10,20,30,1)', 'rgba(40,50,60,1)'],
  ])
  expect(blocks.map(b => b.faded)).toEqual([false, true, false])
})

test('blocks fill whole pixels, none shared, so neighbours leave no seam', () => {
  const blocks = [
    { node: 'a', bp0: 0, bp1: 10.3, colors: ['a'], faded: false },
    { node: 's', bp0: 10.3, bp1: 10.4, colors: ['s'], faded: true },
    { node: 't', bp0: 10.4, bp1: 10.5, colors: ['t'], faded: true },
    { node: 'b', bp0: 10.5, bp1: 20, colors: ['b'], faded: false },
  ]
  const px = stripPixels(blocks, { scale: 1, translateX: 0 }, 100, 1)
  // s takes its pixel from b, and t, sharing it, is not drawn
  // and, 7 px apiece on average, they draw as one band rather than in tiers
  expect(px).toEqual([
    { colors: ['a'], x0: 0, x1: 10 },
    { colors: ['s'], x0: 10, x1: 11 },
    { colors: ['b'], x0: 11, x1: 20 },
  ])
  // at dpr 2, edges land on half css px
  expect(
    stripPixels(blocks.slice(0, 1), { scale: 1, translateX: 0 }, 100, 2),
  ).toEqual([{ colors: ['a'], x0: 0, x1: 10.5 }])
  // reversed, b is leftmost
  expect(
    stripPixels(blocks, { scale: -1, translateX: 20 }, 100, 1).map(
      p => p.colors[0],
    ),
  ).toEqual(['b', 't', 'a'])
})

test('blocks wide enough to read one by one alternate tiers where they touch', () => {
  const blocks = [
    { node: 'a', bp0: 0, bp1: 20, colors: ['a'], faded: false },
    { node: 'b', bp0: 20, bp1: 40, colors: ['b'], faded: false },
    { node: 'c', bp0: 40, bp1: 60, colors: ['c'], faded: false },
    { node: 'd', bp0: 70, bp1: 90, colors: ['d'], faded: false },
  ]
  expect(
    stripPixels(blocks, { scale: 1, translateX: 0 }, 100, 1).map(p => p.tier),
  ).toEqual([0, 1, 0, 0])
})

test('a block is hit where the linear view places its bp', () => {
  const blocks = referenceStripBlocks(graph, { colorScheme: 'uniform' })
  const frame = { scale: 0.5, translateX: -500 }
  expect(stripBlockAt(blocks, frame, 25, 4)).toBe('a')
  expect(stripBlockAt(blocks, frame, 60, 4)).toBe('b')
  expect(stripBlockAt(blocks, frame, 25, 40)).toBeUndefined()
  // reversed, the strip runs right to left
  const reversed = { scale: -0.5, translateX: 600 }
  expect(stripBlockAt(blocks, reversed, 75, 4)).toBe('a')
})

test('pale is shown only while a pale block is inside the window', () => {
  const blocks = referenceStripBlocks(graph, {
    colorScheme: 'uniform',
    walks: [{ colors: new Map(['a', 'c'].map(id => [id, 0])) }],
  })
  // bp 1000 to 1100, which a fills, with b starting on its right edge
  expect(stripFadedShown(blocks, { scale: 1, translateX: -1000 }, 100)).toBe(
    false,
  )
  expect(stripFadedShown(blocks, { scale: 1, translateX: -1050 }, 100)).toBe(
    true,
  )
  // reversed, bp 1100 to 1200 runs right to left
  expect(stripFadedShown(blocks, { scale: -1, translateX: 1200 }, 100)).toBe(
    true,
  )
  expect(stripFadedShown(blocks, { scale: -1, translateX: 1100 }, 100)).toBe(
    false,
  )
})

test('the overhang is the backbone drawn past each edge of the window', () => {
  const blocks = referenceStripBlocks(graph, { colorScheme: 'uniform' })
  // bp 1020 to 1180 across 80 px
  const frame = { scale: 0.5, translateX: -510 }
  expect(stripOverhang(blocks, frame, 80)).toEqual({ left: 20, right: 20 })
  expect(stripOverhang(blocks, { scale: 0.5, translateX: -500 }, 100)).toEqual({
    left: 0,
    right: 0,
  })
  // reversed, low bp is on the right
  const reversed = { scale: -0.5, translateX: 600 }
  expect(stripOverhang(blocks, reversed, 90)).toEqual({ left: 0, right: 20 })
})

describe('a lit span is outlined as far as the strip shows it', () => {
  const caps = { lo: 11, hi: 189, width: 200 }
  const xs = (lines: { x: number }[][]) => lines.map(line => line.map(p => p.x))

  test('inside the caps, a closed box', () => {
    expect(xs(litOutline([50, 80], caps))).toEqual([[50, 50, 80, 80, 50]])
  })

  test('a point is a box the least width, round it', () => {
    expect(xs(litOutline([50, 50], caps))).toEqual([
      [48.5, 48.5, 51.5, 51.5, 48.5],
    ])
  })

  test('cut by the right cap, open there, its top and bottom running to the cap', () => {
    expect(xs(litOutline([150, 260], caps))).toEqual([
      [150, 150, 189],
      [189, 150],
    ])
  })

  test('cut by the left cap, open there', () => {
    expect(xs(litOutline([-40, 30], caps))).toEqual([[11, 30, 30, 11]])
  })

  test('cut by both, its top and bottom alone', () => {
    expect(xs(litOutline([-40, 260], caps))).toEqual([
      [11, 189],
      [189, 11],
    ])
  })

  test('wholly past an edge, the cap on that side', () => {
    expect(xs(litOutline([300, 400], caps))).toEqual([
      [189.75, 199.25, 199.25, 189.75, 189.75],
    ])
    expect(xs(litOutline([-90, -10], caps))).toEqual([
      [0.75, 10.25, 10.25, 0.75, 0.75],
    ])
  })

  test('wholly past an edge with no cap, nothing', () => {
    expect(litOutline([300, 400], { ...caps, hi: 200 })).toEqual([])
    expect(litOutline([-90, -10], { ...caps, lo: 0 })).toEqual([])
  })
})

describe('the strip wires its end caps to the lit outline', () => {
  const frame = { scale: 1, translateX: 0 }
  const strip = (bp1: number, lit: { start: number; end: number }) => {
    const { canvas, strokes, points } = recordingCanvas()
    drawReferenceStrip(
      canvas.getContext('2d')!,
      [{ node: 'a', bp0: 0, bp1, colors: ['#ff0000'], faded: false }],
      frame,
      { width: 200, lit },
    )
    return { strokes, xs: points.map(p => p.x) }
  }

  test('a span past the edge the graph runs on past outlines that cap, in the ink the triangle is drawn in', () => {
    const { strokes, xs } = strip(300, { start: 250, end: 280 })
    expect(strokes).toEqual(['#18181c'])
    expect(xs.slice(-5)).toEqual([189.75, 199.25, 199.25, 189.75, 189.75])
  })

  test('a span cut by that edge stops at its cap, open there', () => {
    expect(strip(300, { start: 150, end: 280 }).xs.slice(-5)).toEqual([
      150, 150, 189, 189, 150,
    ])
  })

  test('where the graph stops inside the pane there is no cap, and a span past the edge is not outlined', () => {
    expect(strip(150, { start: 250, end: 280 }).xs).toEqual([])
  })
})

test('a node is anchored at the middle of its polyline', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 5 },
  ]
  expect(nodeAnchor(points, p => ({ x: p.x * 2, y: p.y + 1 }))).toEqual({
    x: 20,
    y: 1,
  })
  expect(nodeAnchor(undefined, p => p)).toBeUndefined()
})

test('a node of two points, or any even number, is anchored between its middle two', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 4 },
    { x: 20, y: 4 },
    { x: 30, y: 0 },
  ]
  expect(nodeAnchor(points.slice(0, 2), p => p)).toEqual({ x: 5, y: 2 })
  expect(nodeAnchor(points, p => p)).toEqual({ x: 15, y: 4 })
  expect(nodeAnchor([], p => p)).toBeUndefined()
})
