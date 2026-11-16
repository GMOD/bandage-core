import { cutScale, followTransform, referenceProfile } from './pipeline'

import type { ReferenceProfile } from './pipeline'
import type { Graph, GraphNode, NodeSegment } from './types'

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
const USABLE = PANE.width - PADS.padLeft - PADS.padRight
const CENTRE = PADS.padLeft + USABLE / 2
const tall = { minY: 0, h: 50 }
const flat = { minY: 0, h: 1 }
const profile = referenceProfile(graph, positions)

function defined<T>(value: T | undefined) {
  if (value === undefined) {
    throw new Error('nothing placed')
  }
  return value
}

const scaleOf = (
  shown: ReferenceProfile,
  cut: { start: number; end: number },
  viewSpan: number,
  bounds = flat,
) =>
  defined(cutScale(shown, cut, viewSpan, bounds, PANE.width, PANE.height, PADS))

const placed = (
  window: { start: number; end: number },
  scale: number,
  shown = profile,
) =>
  defined(
    followTransform(shown, window, scale, flat, PANE.width, PANE.height, PADS),
  )

const xAtBp = (bp: number) => (bp - 1_000) / 10

test('the profile is the reference drawn piece by piece in bp order, whichever strand a node reads', () => {
  expect(profile.pieces).toEqual([
    { bp0: 1_000, bp1: 2_000, x0: 0, x1: 100 },
    { bp0: 2_000, bp1: 3_000, x0: 100, x1: 200 },
    { bp0: 3_000, bp1: 4_000, x0: 200, x1: 300 },
  ])
})

test("a cut's scale lays its widest view-width stretch of the reference across the pane, the whole cut no taller than it", () => {
  const cut = { start: 1_000, end: 4_000 }
  expect(scaleOf(profile, cut, 1_000)).toBeCloseTo(USABLE / 100)
  expect(scaleOf(profile, cut, 2_000)).toBeCloseTo(USABLE / 200)
  expect(scaleOf(profile, cut, 1_000, tall)).toBeCloseTo(200 / 50)
  expect(scaleOf(profile, { start: 1_000, end: 1_500 }, 1_000)).toBeCloseTo(
    USABLE / 50,
  )
})

// a reference that doubles back and swings out: the widest stretch is where
// the window takes in both turns
const winding: NodeSegment[] = [
  { x: 0, y: 0 },
  { x: 60, y: 0 },
  { x: 20, y: 30 },
  { x: 140, y: 0 },
  { x: 90, y: 10 },
  { x: 260, y: 0 },
]
const windingProfile = referenceProfile(
  { name: 'winding', nodes: [node('w+', 0, 10_000)], edges: [] },
  { 'w+': winding },
)

function bruteWidest(
  shown: ReferenceProfile,
  from: number,
  to: number,
  reach: number,
) {
  const x = (bp: number) => {
    const p = shown.pieces.find(q => q.bp0 <= bp && bp <= q.bp1)
    return p ? p.x0 + ((p.x1 - p.x0) * (bp - p.bp0)) / (p.bp1 - p.bp0) : NaN
  }
  let widest = 0
  for (let a = from; a <= to; a += 5) {
    let lo = Infinity
    let hi = -Infinity
    for (let bp = a; bp <= a + reach; bp += 5) {
      lo = Math.min(lo, x(bp))
      hi = Math.max(hi, x(bp))
    }
    widest = Math.max(widest, hi - lo)
  }
  return widest
}

test("a cut's scale is the widest stretch over every window it holds, not a sample of them", () => {
  for (const reach of [1_500, 3_000, 4_500]) {
    const scale = scaleOf(windingProfile, { start: 0, end: 10_000 }, reach)
    expect(USABLE / scale).toBeCloseTo(
      bruteWidest(windingProfile, 0, 10_000 - reach, reach),
      0,
    )
    expect(USABLE / scale).toBeGreaterThanOrEqual(
      bruteWidest(windingProfile, 0, 10_000 - reach, reach) - 1e-9,
    )
  }
})

test("a cut's scale falls continuously as the view widens, so a zoom inside the cut magnifies as a camera does", () => {
  const cut = { start: 0, end: 10_000 }
  let before = scaleOf(windingProfile, cut, 2_000)
  for (let span = 2_010; span <= 6_000; span += 10) {
    const scale = scaleOf(windingProfile, cut, span)
    expect(scale).toBeLessThanOrEqual(before)
    expect(before / scale).toBeLessThan(1 + 0.01)
    before = scale
  }
})

test('the scale at any width is the widest stretch over every window that wide', () => {
  for (const span of [2_500, 3_500, 5_000, 6_000]) {
    expect(
      USABLE / scaleOf(windingProfile, { start: 0, end: 10_000 }, span),
    ).toBeCloseTo(bruteWidest(windingProfile, 0, 10_000 - span, span), 0)
  }
})

test('between snaps a pan only translates the drawing, with the reference at the window centre at the pane centre', () => {
  const scale = scaleOf(profile, { start: 1_000, end: 4_000 }, 1_000)
  const t = placed({ start: 2_000, end: 3_000 }, scale)
  expect(t.scale).toBe(scale)
  expect(xAtBp(2_500) * scale + t.translateX).toBeCloseTo(CENTRE)
  const panned = placed({ start: 2_130, end: 3_130 }, scale)
  expect(panned.scale).toBe(scale)
  expect(panned.translateY).toBe(t.translateY)
  expect(panned.translateX).toBeCloseTo(t.translateX - 13 * scale)
  expect(placed({ start: 2_000, end: 3_000 }, scale)).toEqual(t)
})

test('a window narrower than the widest is drawn narrower than the pane, and none wider', () => {
  const scale = scaleOf(profile, { start: 1_000, end: 4_000 }, 1_000)
  for (const start of [1_000, 1_400, 2_000, 2_600, 3_000]) {
    const t = placed({ start, end: start + 700 }, scale)
    const left = xAtBp(start) * scale + t.translateX
    const right = xAtBp(start + 700) * scale + t.translateX
    expect(right - left).toBeCloseTo(0.7 * USABLE)
    expect((left + right) / 2).toBeCloseTo(CENTRE)
  }
})

test("a window's stretch is kept inside the pane where the least-squares place would put some of it past an edge", () => {
  const scale = scaleOf(windingProfile, { start: 0, end: 10_000 }, 4_000)
  for (let start = 0; start <= 6_000; start += 250) {
    const window = { start, end: start + 4_000 }
    const t = placed(window, scale, windingProfile)
    let x0 = Infinity
    let x1 = -Infinity
    for (let bp = start; bp <= start + 4_000; bp += 5) {
      const p = defined(
        windingProfile.pieces.find(q => q.bp0 <= bp && bp <= q.bp1),
      )
      const x = p.x0 + ((p.x1 - p.x0) * (bp - p.bp0)) / (p.bp1 - p.bp0)
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
    }
    expect(x0 * scale + t.translateX).toBeGreaterThanOrEqual(
      PADS.padLeft - 1e-6,
    )
    expect(x1 * scale + t.translateX).toBeLessThanOrEqual(
      PANE.width - PADS.padRight + 1e-6,
    )
  }
})

test('a window running past the drawn reference keeps the part drawn under its own stretch of the pane', () => {
  const scale = scaleOf(profile, { start: 1_000, end: 4_000 }, 2_000)
  const t = placed({ start: 3_500, end: 5_500 }, scale)
  const middle = PADS.padLeft + (USABLE * (3_750 - 3_500)) / 2_000
  expect(xAtBp(3_750) * scale + t.translateX).toBeCloseTo(middle)
})

test('no reference in the window, or no room, places nothing', () => {
  expect(
    followTransform(
      profile,
      { start: 9_000, end: 9_500 },
      1,
      flat,
      PANE.width,
      PANE.height,
      PADS,
    ),
  ).toBeUndefined()
  expect(
    cutScale(profile, { start: 1_000, end: 4_000 }, 1_000, flat, 70, 300, PADS),
  ).toBeUndefined()
  expect(
    cutScale(
      { pieces: [], ends: [] },
      { start: 1_000, end: 4_000 },
      1_000,
      flat,
      1000,
      300,
      PADS,
    ),
  ).toBeUndefined()
})
