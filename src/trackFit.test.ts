import { cutScale, referenceProfile, windowScale } from './pipeline'
import {
  EDGE_RUN_GAP_PX,
  PAN_GLIDE,
  drawnSegments,
  edgeOverruns,
  grownHeight,
  reachOver,
  referenceSegments,
  windowTranslateY,
} from './trackFit'

import type { Graph, GraphNode } from './types'

const node = (id: string, start: number, length: number, rank = 0) =>
  ({
    id,
    name: id.slice(0, -1),
    length,
    depth: 1,
    stable: { refName: 'chr1', start, rank },
  }) satisfies GraphNode

// the reference along y = 0 at one layout unit per 10 bp, and a loop of two
// nodes hanging 400 units below its middle, joined to it by links
const graph: Graph = {
  name: 'loop',
  nodes: [
    node('a+', 1_000, 1_000),
    node('b+', 2_000, 1_000),
    node('c+', 3_000, 1_000),
    node('down+', 2_500, 10, 1),
    node('up+', 2_500, 10, 1),
  ],
  edges: [
    { from: 'a+', to: 'b+' },
    { from: 'b+', to: 'c+' },
    { from: 'b+', to: 'down+' },
    { from: 'down+', to: 'up+' },
    { from: 'up+', to: 'c+' },
  ],
}
const positions = {
  'a+': [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  'b+': [
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ],
  'c+': [
    { x: 200, y: 0 },
    { x: 300, y: 0 },
  ],
  'down+': [
    { x: 190, y: 380 },
    { x: 190, y: 400 },
  ],
  'up+': [
    { x: 210, y: 400 },
    { x: 210, y: 380 },
  ],
}
const PANE = { width: 1000, height: 300 }
const PADS = { padLeft: 40, padTop: 60, padRight: 40, padBottom: 40 }
const USABLE_H = PANE.height - PADS.padTop - PADS.padBottom
const profile = referenceProfile(graph, positions)
const segments = drawnSegments(graph, { nodePositions: positions })
const reference = referenceSegments(profile)
const whole = { minY: 0, h: 400 }
const cut = { start: 1_000, end: 4_000 }

function placedY(scale: number, translateX: number) {
  return windowTranslateY({
    segments,
    reference,
    scale,
    translateX,
    bounds: whole,
    paneWidth: PANE.width,
    paneHeight: PANE.height,
    pads: PADS,
  })
}

test("at the window's scale a zoom magnifies the drawing as a camera does, where the cut's height holds the fit still", () => {
  const scaleAt = (span: number) =>
    windowScale(profile, cut, span, PANE.width, PADS)!
  const fitAt = (span: number) =>
    cutScale(profile, cut, span, whole, PANE.width, PANE.height, PADS)!
  expect(fitAt(1_000)).toBeCloseTo(USABLE_H / 400)
  expect(fitAt(500)).toBeCloseTo(fitAt(1_000))
  expect(scaleAt(500) / scaleAt(1_000)).toBeCloseTo(2)
  expect(scaleAt(250) / scaleAt(500)).toBeCloseTo(2)
})

test('the drawn lines are every node and every link, from the end its strands name', () => {
  const runs = Array.from({ length: segments.length / 4 }, (_, i) =>
    Array.from(segments.slice(4 * i, 4 * i + 4)),
  )
  expect(runs).toContainEqual([200, 0, 190, 380])
  expect(runs).toContainEqual([210, 380, 200, 0])
  expect(runs).toContainEqual([190, 400, 210, 400])
  expect(runs).toHaveLength(5 + 5)
})

test('the reach over a range cuts each line where it crosses the range, and counts nothing outside it without slack', () => {
  expect(reachOver(segments, 0, 100)).toEqual({ minY: 0, maxY: 0 })
  expect(reachOver(segments, 0, 195)!.maxY).toBeCloseTo(400)
  expect(reachOver(segments, 0, 195.5)!.maxY).toBe(400)
  expect(reachOver(segments, 0, 189)).toEqual({ minY: 0, maxY: 0 })
  expect(reachOver(segments, 195, 199)).toEqual({ minY: 0, maxY: 400 })
  expect(reachOver(Float64Array.from([0, 0, 10, 100]), 2, 5)).toEqual({
    minY: 20,
    maxY: 50,
  })
})

test('with slack a line outside the range counts less the further outside it lies', () => {
  expect(reachOver(segments, 0, 100, 1)).toEqual({ minY: 0, maxY: 310 })
  expect(reachOver(segments, 0, 100, 0.5)).toEqual({ minY: 0, maxY: 355 })
})

test('a drawing that fits the pane at the scale drawn sits centred between the pads, as the fit puts it', () => {
  const scale = USABLE_H / 400
  const y = placedY(scale, 40)
  expect(y).toBeCloseTo(PADS.padTop)
  expect(400 * scale + y).toBeCloseTo(PANE.height - PADS.padBottom)
})

test('a window whose drawing is taller than the pane fills it, and keeps its reference inside the pads', () => {
  const scale = 3
  const translateX = PANE.width / 2 - 200 * scale
  const y = placedY(scale, translateX)
  expect(y).toBeGreaterThanOrEqual(PADS.padTop - 1e-9)
  expect(y).toBeLessThanOrEqual(PANE.height - PADS.padBottom)
  expect(400 * scale + y).toBeGreaterThanOrEqual(PANE.height - PADS.padBottom)
})

test('a window showing only flat reference beside a tall loop keeps the reference inside the pads', () => {
  const y = placedY(10, 40)
  expect(y).toBeGreaterThanOrEqual(PADS.padTop - 1e-9)
  expect(y).toBeLessThanOrEqual(PANE.height - PADS.padBottom + 1e-9)
})

test("a window whose drawing fits the pane is held whole, where the cut's anchor would run it past an edge", () => {
  const line = Float64Array.from([0, 0, 2_100, 0])
  const scale = 10
  const y = windowTranslateY({
    segments: Float64Array.from([
      ...line,
      50,
      0,
      50,
      15,
      2_000,
      0,
      2_000,
      -400,
    ]),
    reference: line,
    scale,
    translateX: 40,
    bounds: { minY: -400, h: 415 },
    paneWidth: PANE.width,
    paneHeight: PANE.height,
    pads: PADS,
  })
  expect(y).toBeGreaterThanOrEqual(PADS.padTop - 1e-9)
  expect(15 * scale + y).toBeLessThanOrEqual(
    PANE.height - PADS.padBottom + 1e-9,
  )
})

test("a window whose reference runs far from the cut's middle keeps it on the pane, where filling the pane alone would leave it off", () => {
  const slope = Float64Array.from([0, 0, 300, 3_000])
  const scale = 10
  const y = windowTranslateY({
    segments: Float64Array.from([
      ...slope,
      10,
      -2_000,
      10,
      0,
      10,
      0,
      10,
      2_000,
    ]),
    reference: slope,
    scale,
    translateX: 40,
    bounds: { minY: -2_000, h: 5_000 },
    paneWidth: PANE.width,
    paneHeight: PANE.height,
    pads: PADS,
  })
  const shown = [y, 96 * 10 * scale + y]
  expect(shown[0]).toBeLessThanOrEqual(PANE.height - PADS.padBottom)
  expect(shown[1]).toBeGreaterThanOrEqual(PADS.padTop)
})

test('a pan moves the drawing up or down no faster than it moves it across', () => {
  const scale = 3
  let was = placedY(scale, 600)
  for (let tx = 600; tx >= -800; tx -= 1) {
    const y = placedY(scale, tx)
    expect(Math.abs(y - was)).toBeLessThanOrEqual(PAN_GLIDE + 1e-9)
    was = y
  }
})

test('a track grown for a cut holds the cut between the pads at the scale drawn', () => {
  expect(grownHeight(whole, 0.5, PADS)).toBe(60 + 40 + 200)
})

test("where the drawing crosses the top or bottom on its way past it the edge is marked, a loop's two legs as one mark, and nowhere else", () => {
  const runs = edgeOverruns(
    segments,
    { scale: 1, translateX: 0, translateY: 100 },
    PANE.width,
    { top: 8, bottom: PANE.height },
  )
  expect(runs.top).toEqual([])
  expect(runs.bottom).toHaveLength(1)
  expect(runs.bottom[0]!.x0).toBeCloseTo(200 - (10 * 200) / 380)
  expect(runs.bottom[0]!.x1).toBeCloseTo(210 - (10 * 180) / 380)
  const inside = edgeOverruns(
    segments,
    { scale: 0.5, translateX: 0, translateY: 40 },
    PANE.width,
    { top: 8, bottom: PANE.height },
  )
  expect(inside).toEqual({ top: [], bottom: [] })
  const above = edgeOverruns(
    segments,
    { scale: 1, translateX: 0, translateY: -300 },
    PANE.width,
    { top: 8, bottom: PANE.height },
  )
  expect(above.top.length).toBeGreaterThan(0)
  expect(above.bottom).toEqual([])
})

test('runs past an edge closer than the gap are one mark, and runs further apart two', () => {
  const twoLoops = Float64Array.from([
    0,
    0,
    0,
    500,
    2 * EDGE_RUN_GAP_PX,
    0,
    2 * EDGE_RUN_GAP_PX,
    500,
  ])
  const close = Float64Array.from([
    0,
    0,
    0,
    500,
    EDGE_RUN_GAP_PX,
    0,
    EDGE_RUN_GAP_PX,
    500,
  ])
  const at = { scale: 1, translateX: 10, translateY: 0 }
  const edges = { top: 0, bottom: 300 }
  expect(edgeOverruns(twoLoops, at, 1000, edges).bottom).toHaveLength(2)
  expect(edgeOverruns(close, at, 1000, edges).bottom).toHaveLength(1)
})
