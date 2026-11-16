import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import {
  cutScale,
  drawingBounds,
  followTransform,
  referenceProfile,
  shownBounds,
} from './pipeline'

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

test('a node drawn bent is read as a piece per bend, its bp shared by how far along the line each bend lies', () => {
  const lengths = winding
    .slice(1)
    .map((b, i) =>
      Math.hypot(b.x - (winding[i]?.x ?? 0), b.y - (winding[i]?.y ?? 0)),
    )
  const total = lengths.reduce((sum, l) => sum + l, 0)
  let walked = 0
  expect(windingProfile.pieces).toHaveLength(winding.length - 1)
  windingProfile.pieces.forEach((piece, i) => {
    const bp0 = (10_000 * walked) / total
    walked += lengths[i] ?? 0
    expect(piece.bp0).toBeCloseTo(bp0, 6)
    expect(piece.bp1).toBeCloseTo((10_000 * walked) / total, 6)
    expect([piece.x0, piece.x1]).toEqual([winding[i]?.x, winding[i + 1]?.x])
  })
})

// A reference of whole-bp pieces whose x wanders, and jumps at some joints,
// from a fixed seed
function wanderingProfile(seed: number) {
  let state = seed
  const next = (n: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state % n
  }
  const pieces: ReferenceProfile['pieces'] = []
  let bp = 0
  let x = 0
  for (let i = 0; i < 40; i++) {
    const length = 20 + next(100)
    const x0 = next(5) === 0 ? x + next(81) - 40 : x
    x = x0 + next(121) - 60
    pieces.push({ bp0: bp, bp1: bp + length, x0, x1: x })
    bp += length
  }
  const ends = pieces
    .flatMap(p => [
      { bp: p.bp0, x: p.x0 },
      { bp: p.bp1, x: p.x1 },
    ])
    .sort((p, q) => p.bp - q.bp)
  return { profile: { pieces, ends }, end: bp }
}

// every whole-bp window, taking in each piece it meets even at a single bp
function wholeBpWidest(shown: ReferenceProfile, end: number, reach: number) {
  let widest = 0
  for (let a = 0; a + reach <= end; a++) {
    let x0 = Infinity
    let x1 = -Infinity
    for (const p of shown.pieces) {
      const lo = Math.max(a, p.bp0)
      const hi = Math.min(a + reach, p.bp1)
      if (hi >= lo) {
        for (const bp of [lo, hi]) {
          const x = p.x0 + ((p.x1 - p.x0) * (bp - p.bp0)) / (p.bp1 - p.bp0)
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
        }
      }
    }
    widest = Math.max(widest, x1 - x0)
  }
  return widest
}

test("a cut's scale finds the widest stretch where a piece's end enters a window as well as where one leaves it", () => {
  for (const seed of [1, 7, 42]) {
    const { profile: shown, end } = wanderingProfile(seed)
    for (const reach of [150, 400, 900, 1_700]) {
      const scale = defined(
        cutScale(
          shown,
          { start: 0, end },
          reach,
          { h: 0 },
          PANE.width,
          PANE.height,
          PADS,
        ),
      )
      expect(USABLE / scale).toBeCloseTo(wholeBpWidest(shown, end, reach), 6)
    }
  }
})

test("a cut's scale reads no window running past the cut's end, where the reference drawn runs on", () => {
  const runsOn = referenceProfile(
    { name: 'runs on', nodes: [node('r+', 0, 700)], edges: [] },
    {
      'r+': [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 300 },
        { x: 400, y: 300 },
      ],
    },
  )
  expect(USABLE / scaleOf(runsOn, { start: 0, end: 400 }, 200)).toBeCloseTo(100)
})

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

test("a window's stretch is kept inside the pane where the least-squares place would put some of it past the pane's edge", () => {
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
    expect(x0 * scale + t.translateX).toBeGreaterThanOrEqual(-1e-6)
    expect(x1 * scale + t.translateX).toBeLessThanOrEqual(PANE.width + 1e-6)
  }
})

test('a window running past the drawn reference keeps the part drawn under its own stretch of the pane', () => {
  const scale = scaleOf(profile, { start: 1_000, end: 4_000 }, 2_000)
  const t = placed({ start: 3_500, end: 5_500 }, scale)
  const middle = PADS.padLeft + (USABLE * (3_750 - 3_500)) / 2_000
  expect(xAtBp(3_750) * scale + t.translateX).toBeCloseTo(middle)
})

test('a window past the drawn reference slides the drawing on with the ruler from where the reference left it', () => {
  const scale = scaleOf(profile, { start: 1_000, end: 4_000 }, 1_000)
  const near = placed({ start: 3_999, end: 4_999 }, scale)
  const lastX = (t: { translateX: number }) =>
    xAtBp(4_000) * scale + t.translateX
  const ruler = (window: { start: number }, bp: number) =>
    PADS.padLeft + (USABLE * (bp - window.start)) / 1_000
  expect(lastX(near)).toBeCloseTo(ruler({ start: 3_999 }, 4_000), 1)
  for (const start of [4_000, 4_500, 9_000, 1_000_000]) {
    const t = placed({ start, end: start + 1_000 }, scale)
    expect(t.scale).toBe(scale)
    expect(t.translateY).toBe(near.translateY)
    expect(lastX(t)).toBeCloseTo(ruler({ start }, 4_000), 6)
  }
  const before = placed({ start: -1_000_000, end: -999_000 }, scale)
  expect(xAtBp(1_000) * scale + before.translateX).toBeCloseTo(
    ruler({ start: -1_000_000 }, 1_000),
    6,
  )
})

test('a window whose stretch is wider than the pane is centred in it', () => {
  const t = placed({ start: 1_000, end: 4_000 }, 5)
  const left = xAtBp(1_000) * 5 + t.translateX
  const right = xAtBp(4_000) * 5 + t.translateX
  expect(left + right).toBeCloseTo(PANE.width)
})

test("the drawing is centred between the pane's top and bottom pads, and the window runs between its left and right ones", () => {
  const pads = { padLeft: 100, padTop: 30, padRight: 20, padBottom: 90 }
  const bounds = { minY: -20, h: 50 }
  const t = defined(
    followTransform(
      profile,
      { start: 2_000, end: 3_000 },
      2,
      bounds,
      PANE.width,
      PANE.height,
      pads,
    ),
  )
  const top = bounds.minY * 2 + t.translateY
  const bottom = (bounds.minY + bounds.h) * 2 + t.translateY
  expect(top - pads.padTop).toBeCloseTo(PANE.height - pads.padBottom - bottom)
  expect(top).toBeGreaterThan(pads.padTop + 1)
  const middle = xAtBp(2_500) * 2 + t.translateX
  expect(middle).toBeCloseTo((pads.padLeft + PANE.width - pads.padRight) / 2)
})

test('no room places nothing', () => {
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

// Reference profiles FMMM drew for real snapped cuts, each the cut a review
// found the drawing jumping most on in a pan when the window was kept inside
// the padding: the pieces the windows of a pan at the locus's own width reach,
// with the cut's scale at that width in a 1400 by 300 track
interface PanFixture {
  cut: [number, number]
  viewSpan: number
  level: number
  scale: number
  pieces: number[]
}

function panFixture(name: string) {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(join(__dirname, '../test_data/follow', name)),
    ).toString(),
  ) as PanFixture
  const pieces = Array.from({ length: fixture.pieces.length / 4 }, (_, i) => {
    const [bp0 = 0, bp1 = 0, x0 = 0, x1 = 0] = fixture.pieces.slice(
      4 * i,
      4 * i + 4,
    )
    return { bp0, bp1, x0, x1 }
  })
  const ends = pieces
    .flatMap(p => [
      { bp: p.bp0, x: p.x0 },
      { bp: p.bp1, x: p.x1 },
    ])
    .sort((p, q) => p.bp - q.bp)
  return { ...fixture, profile: { pieces, ends } }
}

// how far the drawn reference runs in x over the bp from `from` to `to`,
// counting where it jumps from one piece to the next
function drawnRun(
  pieces: ReferenceProfile['pieces'],
  from: number,
  to: number,
) {
  let run = 0
  pieces.forEach((q, i) => {
    const lo = Math.max(from, q.bp0)
    const hi = Math.min(to, q.bp1)
    const p = pieces[i - 1]
    if (hi > lo) {
      run += (Math.abs(q.x1 - q.x0) * (hi - lo)) / (q.bp1 - q.bp0)
    }
    if (p && p.bp1 <= to && q.bp0 >= from) {
      run += Math.abs(q.x0 - p.x1)
    }
  })
  return run
}

function stretchOf(
  pieces: ReferenceProfile['pieces'],
  window: { start: number; end: number },
) {
  let x0 = Infinity
  let x1 = -Infinity
  for (const p of pieces) {
    const lo = Math.max(window.start, p.bp0)
    const hi = Math.min(window.end, p.bp1)
    if (hi > lo) {
      for (const bp of [lo, hi]) {
        const x = p.x0 + ((p.x1 - p.x0) * (bp - p.bp0)) / (p.bp1 - p.bp0)
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
      }
    }
  }
  return { x0, x1 }
}

const TRACK = { width: 1400, height: 300 }

test.each([
  'pggbY.9256605.json.gz',
  'gap571.27851264.json.gz',
  'plain.115394758.json.gz',
  'c4.32044767.json.gz',
  'gstm1.109631102.json.gz',
])(
  "a pan a ruler pixel at a time moves the drawing at most a pixel, unless it holds the window's stretch at the pane's edge, and then no further than the drawn reference runs at the window's ends, on %s",
  name => {
    const { cut, viewSpan, level, scale, profile: drawn } = panFixture(name)
    const centre = (cut[0] + cut[1]) / 2
    const step = viewSpan / TRACK.width
    const atEdge = (window: { start: number; end: number }, x: number) => {
      const { x0, x1 } = stretchOf(drawn.pieces, window)
      return (
        Math.abs(x0 * scale + x) < 1e-6 ||
        Math.abs(x1 * scale + x - TRACK.width) < 1e-6
      )
    }
    const placements: { start: number; end: number; x: number }[] = []
    for (let c = centre - level / 4; c < centre + level / 4; c += step) {
      const window = { start: c - viewSpan / 2, end: c + viewSpan / 2 }
      const { translateX } = defined(
        followTransform(
          drawn,
          window,
          scale,
          flat,
          TRACK.width,
          TRACK.height,
          PADS,
        ),
      )
      placements.push({ ...window, x: translateX })
    }
    const steps = placements.slice(1).map((after, i) => {
      const before = placements[i] ?? after
      const held = atEdge(before, before.x) || atEdge(after, after.x)
      const run =
        drawnRun(drawn.pieces, before.start, after.start) +
        drawnRun(drawn.pieces, before.end, after.end)
      return {
        at: after.start,
        moved: Math.abs(after.x - before.x),
        allowed: held ? 1 + scale * run : 1,
      }
    })
    expect(steps.length).toBeGreaterThan(300)
    expect(steps.filter(s => s.moved > s.allowed)).toEqual([])
  },
)

// a reference of four nodes along y 0, a loop 900 units tall off where the
// cut's start runs through the second node, and a bump 40 units deep between
// the third and fourth
const hung: Graph = {
  name: 'hung',
  nodes: [
    node('z+', 0, 1_000),
    node('a+', 1_000, 1_000),
    node('b+', 2_000, 1_000),
    node('c+', 3_000, 1_000),
    node('loop+', 0, 5_000, 1),
    node('bump+', 0, 300, 1),
  ],
  edges: [
    { from: 'z+', to: 'a+' },
    { from: 'a+', to: 'b+' },
    { from: 'b+', to: 'c+' },
    { from: 'z+', to: 'loop+' },
    { from: 'loop+', to: 'a+' },
    { from: 'b+', to: 'bump+' },
    { from: 'bump+', to: 'c+' },
  ],
}
const hungLayout = {
  nodePositions: {
    'z+': [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    'a+': [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ],
    'b+': [
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ],
    'c+': [
      { x: 300, y: 0 },
      { x: 400, y: 0 },
    ],
    'loop+': [
      { x: 100, y: 0 },
      { x: 60, y: -900 },
      { x: 100, y: 0 },
    ],
    'bump+': [
      { x: 300, y: 0 },
      { x: 300, y: 40 },
      { x: 300, y: 0 },
    ],
  },
}

test("a held cut's height is what its windows show, so a loop hanging from where the cut's edge runs through a reference node does not shrink the drawing, and one inside the cut still caps it", () => {
  const cut = { start: 1_500, end: 4_000 }
  const shown = defined(shownBounds(hung, hungLayout, cut))
  expect(shown).toEqual({ minY: 0, h: 40 })
  expect(drawingBounds(hungLayout)).toMatchObject({ minY: -900, h: 940 })
  const hungProfile = referenceProfile(hung, hungLayout.nodePositions)
  const usableHeight = PANE.height - PADS.padTop - PADS.padBottom
  expect(scaleOf(hungProfile, cut, 1_000, shown)).toBeCloseTo(usableHeight / 40)
  expect(
    scaleOf(hungProfile, cut, 1_000, drawingBounds(hungLayout)),
  ).toBeCloseTo(usableHeight / 940)
  expect(shownBounds(hung, hungLayout, { start: 0, end: 4_000 })).toEqual({
    minY: -900,
    h: 940,
  })
})
