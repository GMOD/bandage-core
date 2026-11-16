import { followTransform, referenceExtent } from './pipeline'

import type { Graph, GraphNode } from './types'

const node = (id: string, start: number, length: number, rank = 0) =>
  ({
    id,
    name: id.slice(0, -1),
    length,
    depth: 1,
    stable: { refName: 'chr1', start, rank },
  }) satisfies GraphNode

// the reference left to right at one layout unit per 10 bp, the middle node
// read on its reverse strand, and an allele 50 units below
const graph: Graph = {
  name: 'follow',
  nodes: [
    node('a+', 1_000, 1_000),
    node('b-', 2_000, 1_000),
    node('c+', 3_000, 1_000),
    node('alt+', 2_000, 400, 1),
  ],
  edges: [],
}
const positions = {
  'a+': [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  'b-': [
    { x: 200, y: 0 },
    { x: 100, y: 0 },
  ],
  'c+': [
    { x: 200, y: 0 },
    { x: 300, y: 0 },
  ],
  'alt+': [
    { x: 120, y: 50 },
    { x: 160, y: 50 },
  ],
}
const PANE = { width: 1000, height: 300 }
const PADS = { padLeft: 40, padTop: 60, padRight: 40, padBottom: 40 }
const bounds = { minY: 0, h: 50 }

function defined<T>(value: T | undefined) {
  if (value === undefined) {
    throw new Error('nothing placed')
  }
  return value
}

function placed(start: number, end: number, drawing = bounds) {
  const extent = referenceExtent(graph, positions, start, end)
  return extent
    ? followTransform(
        extent,
        { start, end },
        drawing,
        PANE.width,
        PANE.height,
        PADS,
      )
    : undefined
}

test('the reference between two bp spans the layout x it is drawn over, whichever strand a node reads', () => {
  expect(referenceExtent(graph, positions, 1_500, 3_500)).toEqual({
    x0: 50,
    x1: 250,
    start: 1_500,
    end: 3_500,
  })
  expect(referenceExtent(graph, positions, 2_200, 2_600)).toEqual({
    x0: 120,
    x1: 160,
    start: 2_200,
    end: 2_600,
  })
  expect(referenceExtent(graph, positions, 9_000, 9_500)).toBeUndefined()
})

test('a bend inside a node counts the corners the stretch passes', () => {
  const bent = {
    ...positions,
    'a+': [
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 100, y: 50 },
    ],
  }
  const extent = referenceExtent(graph, bent, 1_000, 1_900)
  expect(extent?.x0).toBe(0)
  expect(extent?.x1).toBe(150)
})

test("a window's stretch of the reference runs across the pane, and a pan slides it", () => {
  const t = defined(placed(2_000, 3_000))
  expect(t.scale).toBeCloseTo(4)
  expect(100 * t.scale + t.translateX).toBeCloseTo(300)
  expect(200 * t.scale + t.translateX).toBeCloseTo(700)
  const panned = defined(placed(2_100, 3_100))
  expect(panned.scale).toBeCloseTo(t.scale)
  expect(panned.translateX).toBeCloseTo(t.translateX - 10 * t.scale)
  expect(panned.translateY).toBeCloseTo(t.translateY)
  expect(placed(2_000, 3_000)).toEqual(t)
})

test('a drawing taller than the pane at that scale is fitted to its height instead', () => {
  const t = defined(placed(2_000, 2_100, { minY: 0, h: 400 }))
  expect(t.scale).toBeCloseTo(0.5)
  expect(105 * t.scale + t.translateX).toBeCloseTo(500)
})

test('a window running past the drawn reference keeps the drawn part at its share of the pane', () => {
  const flat = { minY: 0, h: 1 }
  const t = defined(placed(3_500, 5_500, flat))
  expect(t.scale).toBeCloseTo(4.6)
  expect(250 * t.scale + t.translateX).toBeCloseTo(40)
  expect(300 * t.scale + t.translateX).toBeCloseTo(270)
  const whole = defined(placed(3_000, 4_000, flat))
  expect(300 * whole.scale + whole.translateX).toBeCloseTo(960)
})

test('no reference in the window, or no room, places nothing', () => {
  expect(placed(9_000, 9_500)).toBeUndefined()
  const extent = defined(referenceExtent(graph, positions, 2_000, 3_000))
  expect(
    followTransform(
      extent,
      { start: 2_000, end: 3_000 },
      bounds,
      70,
      300,
      PADS,
    ),
  ).toBeUndefined()
})
