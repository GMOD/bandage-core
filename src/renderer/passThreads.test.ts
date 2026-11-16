import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { anchorGraph } from '../pathAnchoring'
import {
  NO_VALUE_COLOR,
  TOGETHER_DARKEST,
  WALK_SCHEMES,
  passPalette,
  schemeColor,
} from '../walkEncoding'
import { walkLift } from '../walkHighlight'
import { MOST_PASS_THREADS, passInk } from '../walkPasses'
import { Canvas2DRenderer } from './Canvas2DRenderer'
import { buildGeometry } from './GeometryBuilder'
import {
  abgrBlue,
  abgrGreen,
  abgrRed,
  contrastRatio,
  hexAbgr,
  packAbgr,
  relativeLuminance,
} from './colorBits'
import {
  HEAD_CONTRAST,
  LANE_HEAD_MIN_PX,
  LANE_HEAD_SPACING_PX,
  laneHeadInk,
  laneHeadPlacer,
} from './laneHeads'
import { svgCanvas } from './svgCanvas'
import {
  MAX_BAND_PX,
  MIN_LANE_STROKE_PX,
  MIN_THREAD_PITCH_PX,
  THREAD_PITCH_PX,
  THREAD_PX,
  threadHalfWidthPx,
  threadsFuse,
} from './walkLanes'

import type { NodeSegment } from '../types'
import type { WalkLayer } from '../walkEncoding'
import type { BuildOptions } from './GeometryBuilder'
import type { Arrowhead, EdgeCurveBatch, NodeStroke } from './types'

// the reference's nodes carry its stable coordinates, so each is drawn the
// way the reference reads it
const ON_REF = (offset: number) => `\tSN:Z:ref#0#chr\tSO:i:${offset}\tSR:i:0`

const SEGMENTS = [
  `S\tf1\tAAAAAAAAAA${ON_REF(0)}`,
  `S\ta\tCCCC${ON_REF(10)}`,
  `S\tb\tGGGG${ON_REF(14)}`,
  `S\tc\tTTTT${ON_REF(18)}`,
  `S\td\tAAAA${ON_REF(22)}`,
  'S\tx\tCCCC',
  `S\tf2\tGGGGGGGGGG${ON_REF(26)}`,
  'W\tref\t0\tchr\t0\t36\t>f1>a>b>c>d>f2',
].join('\n')

const REF = 'ref#0#chr'
const HAP = 'hap#1#ctg'
const UNIT = '>a>b>c>d'

// an L line for each pair of steps a walk takes
function linksOf(walk: string) {
  const pairs = [...walk.matchAll(/([<>])(\w+)/g)].map(m => ({
    id: m[2]!,
    strand: m[1] === '>' ? '+' : '-',
  }))
  return pairs
    .slice(1)
    .map(
      (to, i) =>
        `L\t${pairs[i]!.id}\t${pairs[i]!.strand}\t${to.id}\t${to.strand}\t0M`,
    )
}

const line = (x0: number, x1: number, y = 0): NodeSegment[] => [
  { x: x0, y },
  { x: (x0 + x1) / 2, y },
  { x: x1, y },
]

const STRAIGHT: Record<string, NodeSegment[]> = {
  'f1+': line(0, 40),
  'a+': line(60, 100),
  'b+': line(120, 160),
  'c+': line(180, 220),
  'd+': line(240, 280),
  'x+': line(260, 300, 60),
  'f2+': line(320, 360),
}

// the unit round a ring, so a walk round it twice comes back to where it
// started rather than across the drawing
const RING: Record<string, NodeSegment[]> = {
  'f1+': line(-60, 0),
  'a+': line(20, 100),
  'b+': [
    { x: 120, y: 0 },
    { x: 140, y: 40 },
    { x: 120, y: 80 },
  ],
  'c+': line(100, 20, 80),
  'd+': [
    { x: 0, y: 80 },
    { x: -20, y: 40 },
    { x: 0, y: 4 },
  ],
  'x+': line(40, 80, 140),
  'f2+': line(140, 200, -20),
}

function drawn(
  walk: string,
  layers: WalkLayer[],
  positions: Record<string, NodeSegment[]> = STRAIGHT,
  scale = 2,
) {
  const graph = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          SEGMENTS,
          `W\thap\t1\tctg\t0\t*\t${walk}`,
          ...linksOf('>f1>a>b>c>d>f2'),
          ...linksOf(walk),
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const highlight = walkLift(graph, layers)!
  const batch = buildGeometry({
    axis: { scaleX: scale, scaleY: scale },
    nodePositions: positions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 8,
    connectorThickness: 2,
    drawPaths: false,
    highlight,
  })
  const strokes = (id: string) => {
    const run = batch.nodeStrokeRuns.get(id)
    return run ? batch.nodeStrokes.slice(run.start, run.start + run.count) : []
  }
  const laneHeads = batch.arrows.filter(a => a.walk !== undefined)
  return { graph, highlight, batch, strokes, laneHeads, scale }
}

const byPass = (walk = HAP): WalkLayer => ({ walk, color: { field: 'pass' } })

const ends = (stroke: NodeStroke) => [stroke.points[0]!, stroke.points.at(-1)!]

test('a walk lifted alone and coloured by pass draws as many threads at a node as it makes visits there', () => {
  const { strokes, highlight } = drawn(`>f1${UNIT.repeat(3)}>f2`, [byPass()])
  const walk = highlight.walks[0]!
  for (const id of ['a+', 'b+', 'c+', 'd+']) {
    const threads = strokes(id).filter(s => s.walk === 0)
    expect(threads).toHaveLength(walk.passes.get(id)!)
    expect(
      threads.map(s => s.walkPass).toSorted((a = 0, b = 0) => a - b),
    ).toEqual([0, 1, 2])
    expect(threads.map(s => s.visit).toSorted((a = 0, b = 0) => a - b)).toEqual(
      [0, 1, 2],
    )
  }
  expect(strokes('f1+').map(s => s.walkPass)).toEqual([-1])
  const plain = drawn(`>f1${UNIT.repeat(3)}>f2`, [{ walk: HAP }])
  expect(plain.strokes('a+')).toHaveLength(1)
})

test('a walk lifted alone and coloured by pass with no node stepped twice draws one plain lane', () => {
  const { strokes } = drawn(`>f1${UNIT}>f2`, [byPass()])
  expect(strokes('a+').map(s => [s.walkPass, s.visit])).toEqual([
    [-1, undefined],
  ])
})

// The walk's steps, each as its node and visit, beside the pass it is on
function steps(highlight: ReturnType<typeof drawn>['highlight'], lane = 0) {
  const walk = highlight.walks[lane]!
  const visits = new Map<string, number>()
  return walk.route.flatMap((piece, p) =>
    piece.map((id, i) => {
      const visit = visits.get(id) ?? 0
      visits.set(id, visit + 1)
      return { id, visit, pass: walk.walkPasses!.stepPass[p]![i]! }
    }),
  )
}

const endOf = (b: EdgeCurveBatch) => {
  const last = b.curves.at(-1)!
  return { x: last.x1, y: last.y1 }
}

const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

// The middle copy lacks b, so at a zoom where the band follows the walk
// smoothed, b's second visit runs on the third thread
test.each([
  ['a straight drawing', STRAIGHT],
  ['a ring', RING],
])(
  'on %s each thread carries the pass of the visit it draws, and each link of the walk lands on the thread of the visit it enters',
  (_, positions) => {
    const { batch, highlight, strokes } = drawn(
      '>f1>a>b>c>d>a>c>d>a>b>c>d>x>f2',
      [{ walk: REF }, byPass()],
      positions,
      0.2,
    )
    const lane = highlight.walks.findIndex(w => w.name === HAP)
    const walked = steps(highlight, lane)
    const stepped = new Set(walked.map(s => `${s.id}\t${s.pass}`))
    const passOf = new Map(walked.map(s => [`${s.id}\t${s.visit}`, s.pass]))
    const threads = [...batch.nodeStrokeRuns].flatMap(([id, run]) =>
      batch.nodeStrokes
        .slice(run.start, run.start + run.count)
        .filter(s => s.walk === lane)
        .map(s => ({ id, s })),
    )
    expect(
      threads.filter(({ id, s }) => !stepped.has(`${id}\t${s.walkPass}`)),
    ).toEqual([])
    expect(
      threads.filter(
        ({ id, s }) => s.walkPass !== passOf.get(`${id}\t${s.visit}`),
      ),
    ).toEqual([])
    const slotIsNotVisit = threads.some(({ s }) => s.pass !== s.visit)
    expect(threads.length).toBe(walked.length)
    for (let k = 1; k < walked.length; k++) {
      const from = walked[k - 1]!
      const into = walked[k]!
      const links = batch.edgeCurves.filter(
        b =>
          b.walk === lane &&
          b.visit === from.visit &&
          strokes(from.id).some(s => s.walk === lane && s.visit === b.visit),
      )
      const nearest = (b: EdgeCurveBatch) =>
        strokes(into.id)
          .filter(s => s.walk === lane)
          .reduce<{ stroke?: NodeStroke; px: number }>(
            (best, s) => {
              const px = Math.min(...ends(s).map(p => gap(p, endOf(b))))
              return px < best.px ? { stroke: s, px } : best
            },
            { px: Infinity },
          )
      const landing = links
        .map(nearest)
        .filter(n => n.stroke?.visit === into.visit)
      expect(landing.length).toBeGreaterThan(0)
    }
    expect(slotIsNotVisit).toBe(true)
  },
)

test('past MOST_PASS_THREADS a walk takes one colour for every pass', () => {
  const inksOf = (n: number) => {
    const { strokes } = drawn(`>f1${UNIT.repeat(n)}>f2`, [byPass()])
    return new Set(strokes('a+').map(s => s.color)).size
  }
  expect(inksOf(MOST_PASS_THREADS)).toBe(MOST_PASS_THREADS)
  expect(inksOf(MOST_PASS_THREADS + 1)).toBe(1)
})

test('threads thinned under MIN_THREAD_PITCH_PX apart fuse into one band where the walk bundles its passes', () => {
  expect(MIN_THREAD_PITCH_PX).toBe(2)
  const edge = MIN_THREAD_PITCH_PX / THREAD_PITCH_PX
  expect(threadsFuse(edge)).toBe(false)
  expect(threadsFuse(edge * 0.99)).toBe(true)
  expect(threadHalfWidthPx(edge * 0.99, false)).toBeCloseTo(
    (THREAD_PX / 2) * edge * 0.99,
  )
  expect(threadHalfWidthPx(edge * 0.99, true)).toBeGreaterThan(
    (THREAD_PITCH_PX / 2) * edge * 0.99,
  )
  const halfWidths = (n: number) => {
    const { strokes } = drawn(`>f1${UNIT.repeat(n)}>f2`, [byPass()])
    return new Set(strokes('a+').map(s => s.thickness))
  }
  const loose = halfWidths(MOST_PASS_THREADS + 1)
  expect([...loose]).toEqual([THREAD_PX / 2])
  const fused = [...halfWidths(40)]
  expect(fused).toHaveLength(1)
  const pitch = fused[0]! * 2
  expect(pitch).toBeGreaterThan((THREAD_PITCH_PX * 48) / (40 * 3.5))
})

test('a lifted lane on a node or a link is never thinner than MIN_LANE_STROKE_PX, however many passes thin its threads', () => {
  const passes = 400
  const { batch } = drawn(`>f1${UNIT.repeat(passes)}>f2`, [byPass()])
  const thinned = MAX_BAND_PX / (passes * THREAD_PITCH_PX)
  expect(threadHalfWidthPx(thinned, true) * 2).toBeLessThan(MIN_LANE_STROKE_PX)
  const lanes = [...batch.nodeStrokes, ...batch.edgeCurves].filter(
    s => s.walk !== undefined,
  )
  expect(batch.nodeStrokes.some(s => s.walk !== undefined)).toBe(true)
  expect(batch.edgeCurves.some(s => s.walk !== undefined)).toBe(true)
  expect(
    lanes.reduce((least, s) => Math.min(least, s.thickness * 2), Infinity),
  ).toBe(MIN_LANE_STROKE_PX)
})

const pointsAlongX = (heads: Arrowhead[]) => heads.map(h => Math.cos(h.angle))

test('a lane that reads nodes against the way they are drawn carries heads pointing back along them, and the reference none', () => {
  const { laneHeads, highlight } = drawn('>f1<d<c<b<a>f2', [
    { walk: REF },
    { walk: HAP },
  ])
  const hap = highlight.walks.findIndex(w => w.name === HAP)
  expect(laneHeads.length).toBeGreaterThan(0)
  expect(new Set(laneHeads.map(h => h.walk))).toEqual(new Set([hap]))
  expect(new Set(laneHeads.map(h => h.node))).toEqual(
    new Set(['a+', 'b+', 'c+', 'd+']),
  )
  for (const along of pointsAlongX(laneHeads)) {
    expect(along).toBeCloseTo(-1)
  }
  expect(laneHeads.every(h => h.against)).toBe(true)
})

test('a lane coloured by pass carries heads along it both ways it runs, at least LANE_HEAD_MIN_PX wide and LANE_HEAD_SPACING_PX apart along the lane', () => {
  const { laneHeads, scale } = drawn('>f1<d<c<b<a>f2', [
    { walk: REF },
    byPass(),
  ])
  const forward = laneHeads.filter(h => !h.against)
  const back = laneHeads.filter(h => h.against)
  expect(new Set(forward.map(h => h.node))).toEqual(new Set(['f1+', 'f2+']))
  expect(back.length).toBeGreaterThan(0)
  for (const along of pointsAlongX(forward)) {
    expect(along).toBeCloseTo(1)
  }
  for (const head of laneHeads) {
    expect(head.halfWidth * 2).toBeGreaterThanOrEqual(LANE_HEAD_MIN_PX)
  }
  const closest = laneHeads.reduce(
    (least, a, i) =>
      laneHeads
        .slice(i + 1)
        .filter(b => b.walk === a.walk)
        .reduce((most, b) => Math.min(most, gap(a, b) * scale), least),
    Infinity,
  )
  expect(closest).toBeGreaterThanOrEqual(LANE_HEAD_SPACING_PX - 1e-9)
})

test('every thread of a lane coloured by pass carries heads, and the threads side by side keep their heads apart', () => {
  const { laneHeads, strokes } = drawn(
    `>f1${UNIT.repeat(3)}>f2`,
    [byPass()],
    STRAIGHT,
    6,
  )
  const slots = new Set(strokes('a+').map(s => s.pass))
  expect(new Set(laneHeads.map(h => h.pass))).toEqual(slots)
  for (const [i, a] of laneHeads.entries()) {
    for (const b of laneHeads.slice(i + 1)) {
      expect(gap(a, b) * 6).toBeGreaterThanOrEqual(LANE_HEAD_SPACING_PX - 1e-9)
    }
  }
})

test('heads on short nodes keep their distance along the thread', () => {
  const place = laneHeadPlacer(1, 1)
  const heads = Array.from({ length: 100 }, (_, i) =>
    place({
      points: [
        { x: i * 4, y: 0 },
        { x: i * 4 + 3, y: 0 },
      ],
      halfWidth: 1,
      color: 0,
      walk: 0,
      thread: 0,
      threads: 1,
      node: `n${i}`,
      against: false,
    }),
  ).flat()
  expect(heads.length).toBeGreaterThan(4)
  for (let i = 1; i < heads.length; i++) {
    expect(heads[i]!.x - heads[i - 1]!.x).toBeGreaterThanOrEqual(
      LANE_HEAD_SPACING_PX - 1e-9,
    )
  }
})

const CHAIN = 20
const CHAIN_IDS = Array.from({ length: CHAIN }, (_, i) => `n${i}`)
const CHAIN_UNIT = CHAIN_IDS.map(id => `>${id}`).join('')

// short nodes closer than LANE_HEAD_SPACING_PX, so a head on one keeps the
// next node's head off
function chain(viewportBounds?: BuildOptions['viewportBounds']) {
  const graph = convertGFAToGraph(
    parseGFA(
      [
        ...CHAIN_IDS.map(id => `S\t${id}\t${'A'.repeat(30)}`),
        ...linksOf(CHAIN_UNIT.repeat(2)),
        `W\thap\t1\tctg\t0\t*\t${CHAIN_UNIT.repeat(2)}`,
      ].join('\n'),
    ),
  )
  const positions = Object.fromEntries(
    CHAIN_IDS.map((id, i) => [`${id}+`, line(i * 35, i * 35 + 30)]),
  )
  const batch = buildGeometry({
    axis: { scaleX: 1, scaleY: 1 },
    nodePositions: positions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 8,
    connectorThickness: 2,
    drawPaths: false,
    highlight: walkLift(graph, [byPass()]),
    ...(viewportBounds ? { viewportBounds } : {}),
  })
  return batch.arrows.filter(a => a.walk !== undefined)
}

const headKey = (h: Arrowhead) =>
  `${h.node} ${h.pass} ${h.x.toFixed(3)} ${h.y.toFixed(3)} ${h.angle.toFixed(3)}`

test("a view panned in 10 px steps draws exactly the unbounded build's heads that fall inside it", () => {
  const whole = chain()
  expect(whole.length).toBeGreaterThan(CHAIN / 4)
  for (let x = -200; x <= CHAIN * 35; x += 10) {
    const bounds = { minX: x, maxX: x + 200, minY: -40, maxY: 40 }
    const inside = whole.filter(
      h =>
        h.x >= bounds.minX - h.length &&
        h.x <= bounds.maxX + h.length &&
        h.y >= bounds.minY - h.length &&
        h.y <= bounds.maxY + h.length,
    )
    expect(chain(bounds).map(headKey)).toEqual(inside.map(headKey))
  }
})

test('a head wider than its lane stands on a white halo drawn beneath every head, and a head inside its lane has none', () => {
  const thin = drawn(`>f1${UNIT.repeat(3)}>f2`, [byPass()], STRAIGHT, 6)
  expect(thin.laneHeads.length).toBeGreaterThan(0)
  for (const head of thin.laneHeads) {
    expect(head.halfWidth * 2).toBeGreaterThan(THREAD_PX)
    expect(head.halo).toBe(true)
  }
  const wide = drawn('>f1<d<c<b<a>f2', [{ walk: HAP }])
  expect(wide.laneHeads.length).toBeGreaterThan(0)
  expect(wide.laneHeads.some(h => h.halo)).toBe(false)

  const { canvas, markup } = svgCanvas(2400, 400)
  const renderer = new Canvas2DRenderer(canvas)
  renderer.uploadGeometry(thin.batch)
  renderer.updateTransform({
    scaleX: 6,
    scaleY: 6,
    translateX: 0,
    translateY: 200,
    dpr: 1,
  })
  renderer.render([1, 1, 1, 1])
  const paths = markup().match(/<path [^>]*>/g) ?? []
  const halo = paths.findIndex(p =>
    p.includes('fill="none" stroke="rgb(255,255,255)" stroke-width="3"'),
  )
  const headFills = new Set(
    thin.laneHeads.map(
      ({ color }) =>
        `fill="rgb(${abgrRed(color)},${abgrGreen(color)},${abgrBlue(color)})"`,
    ),
  )
  const firstHead = paths.findIndex(p =>
    [...headFills].some(fill => p.includes(fill)),
  )
  expect(halo).toBeGreaterThanOrEqual(0)
  expect(firstHead).toBeGreaterThan(halo)
  expect((paths[halo]!.match(/Z/g) ?? []).length).toBe(thin.laneHeads.length)
})

// every colour a lane can take: each scheme's ramp, with and without the
// darker floor walks lifted together take, every pass colour, and the grey of
// a node a reference-coloured walk has no value at
function laneColours() {
  const ramp = Array.from({ length: 101 }, (_, i) => i / 100)
  return [
    ...WALK_SCHEMES.flatMap(({ value }) =>
      ramp.flatMap(t => [
        schemeColor(value, t),
        schemeColor(value, t, TOGETHER_DARKEST),
      ]),
    ),
    ...passPalette('#000000', 12).map(hexAbgr),
    NO_VALUE_COLOR,
  ]
}

const WHITE = packAbgr(255, 255, 255, 255)

test('a head keeps a contrast of 3:1 with its lane where it sits inside it, and with its white halo where it is wider, down to the darkest lane colour the palette gives', () => {
  const colours = laneColours()
  const darkest = colours.reduce((a, b) =>
    relativeLuminance(b) < relativeLuminance(a) ? b : a,
  )
  expect(relativeLuminance(darkest)).toBeLessThan(0.05)
  for (const lane of [darkest, ...colours]) {
    expect(contrastRatio(laneHeadInk(lane, true), lane)).toBeGreaterThanOrEqual(
      HEAD_CONTRAST,
    )
    expect(
      contrastRatio(laneHeadInk(lane, false), WHITE),
    ).toBeGreaterThanOrEqual(HEAD_CONTRAST)
  }
  expect(HEAD_CONTRAST).toBe(3)
  expect(contrastRatio(packAbgr(0, 0, 0, 255), WHITE)).toBeCloseTo(21)
})

// The middle copy lacks b, so at this zoom b's second visit runs on the
// band's third thread
const SKIPPING = '>f1>a>b>c>d>a>c>d>a>b>c>d>x>f2'

test('each thread takes the ink of the pass of the visit it draws, not of its slot', () => {
  const { batch, highlight } = drawn(
    SKIPPING,
    [{ walk: REF }, byPass()],
    STRAIGHT,
    0.2,
  )
  const lane = highlight.walks.findIndex(w => w.name === HAP)
  const lifted = highlight.walks[lane]!.walkPasses!
  const threads = [...batch.nodeStrokeRuns].flatMap(([id, run]) =>
    batch.nodeStrokes
      .slice(run.start, run.start + run.count)
      .filter(s => s.walk === lane)
      .map(s => ({ id, s })),
  )
  expect(threads.some(({ s }) => s.pass !== s.visit)).toBe(true)
  for (const { id, s } of threads) {
    expect(s.color).toBe(passInk(lifted, lifted.visitPass.get(id)![s.visit!]!))
  }
})

// b is read forward on its first visit and backward on its second, which a
// band at this zoom draws on its third slot
test('a head points the way the visit its thread draws reads the node, not the visit of its slot', () => {
  const { highlight, laneHeads, strokes } = drawn(
    '>f1>a>b>c>d>a>c>d>a<b>c>d>x>f2',
    [{ walk: REF }, byPass()],
    STRAIGHT,
    0.5,
  )
  const lane = highlight.walks.findIndex(w => w.name === HAP)
  const turned = highlight.walks[lane]!.backwards.get('b+')!
  const visitOf = new Map(
    strokes('b+')
      .filter(s => s.walk === lane)
      .map(s => [s.pass, s.visit ?? -1]),
  )
  const onB = laneHeads.filter(h => h.walk === lane && h.node === 'b+')
  expect(
    onB.some(h => turned[h.pass ?? -1] !== turned[visitOf.get(h.pass) ?? -1]),
  ).toBe(true)
  for (const h of onB) {
    expect(h.against).toBe(turned[visitOf.get(h.pass) ?? -1])
  }
})
