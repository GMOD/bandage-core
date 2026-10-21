import { buildGeometry } from './GeometryBuilder'
import { MAX_BAND_PX, PASSES_KEY, passesKey, threadsPasses } from './walkLanes'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { walkLift } from '../walkHighlight'

import type { NodeSegment } from '../types'

const LINE = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv2\t+\tv1\t+\t0M
L\tv3\t+\tv1\t+\t0M
W\tref\t0\tchr\t0\t9\t>v1>v2>v3`

const flat: Record<string, NodeSegment[]> = {
  'v1+': [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
  'v2+': [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ],
  'v3+': [
    { x: 40, y: 0 },
    { x: 50, y: 0 },
  ],
}

function drawn(
  gfa: string,
  walks: string[],
  nodePositions: Record<string, NodeSegment[]> = flat,
  {
    scale = 1,
    deletions,
    viewportBounds,
  }: {
    scale?: number
    deletions?: number[]
    viewportBounds?: { minX: number; minY: number; maxX: number; maxY: number }
  } = {},
) {
  const graph = convertGFAToGraph(parseGFA(gfa))
  const highlight = walkLift(
    graph,
    walks.map(walk => ({ walk })),
  )!
  const batch = buildGeometry({
    axis: { scaleX: scale, scaleY: scale },
    nodePositions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 5,
    connectorThickness: 2,
    drawPaths: false,
    highlight,
    deletions: deletions && new Map(deletions.map(e => [e, ['v2+']])),
    viewportBounds,
  })
  const slice = <T>(all: T[], run?: { start: number; count: number }) =>
    run ? all.slice(run.start, run.start + run.count) : []
  return {
    highlight,
    batch,
    strokes: (id: string) =>
      slice(batch.nodeStrokes, batch.nodeStrokeRuns.get(id)),
    links: (edge: number) =>
      slice(batch.edgeCurves, batch.edgeCurveRuns.get(edge)),
  }
}

const walk = (name: string, steps: string) =>
  `W\t${name}\t1\tchr\t0\t100\t${steps}`

const DUP = `${LINE}\n${walk('dup', '>v1>v2>v1>v2>v3')}`

test('walks lifted together draw a stroke per pass, each keyed to its walk and pass', () => {
  const { strokes, links } = drawn(DUP, ['ref#0#chr', 'dup#1#chr'])
  expect(strokes('v1+').map(s => [s.walk, s.pass])).toEqual([
    [0, 0],
    [1, 0],
    [1, 1],
  ])
  expect(strokes('v3+').map(s => [s.walk, s.pass])).toEqual([
    [0, 0],
    [1, 1],
  ])
  const ys = strokes('v1+').map(s => s.points[0]!.y)
  expect(ys).toEqual([...ys].sort((a, b) => a - b))
  expect(links(0).map(c => c.pass)).toEqual([0, 0, 1])
})

test('every pass through a node draws one thread, however the walk runs', () => {
  const cases = [
    walk('w', '>v1>v2>v1>v2>v3'),
    walk('w', '<v3<v2<v1<v2<v1'),
    walk('w', '>v1>v2<v2<v1>v1'),
    `${walk('w', '>v1>v2')}\n${walk('w', '>v1>v2').replace('\t0\t100', '\t100\t200')}`,
    walk('w', '>v1>v2>v3>v1'),
  ]
  for (const line of cases) {
    const { highlight, batch, strokes } = drawn(`${LINE}\n${line}`, [
      'ref#0#chr',
      'w#1#chr',
    ])
    for (const [id, passes] of highlight.walks[1]!.passes) {
      expect(strokes(id).filter(s => s.walk === 1)).toHaveLength(passes)
    }
    const numbers = JSON.stringify(batch, (_, v: unknown) =>
      typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v,
    )
    expect(numbers).not.toContain('NaN')
  }
})

test('walks lifted together that never repeat slide each link whole by its lane where it leaves', () => {
  const bent: Record<string, NodeSegment[]> = {
    ...flat,
    'v2+': [
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ],
    'v3+': [
      { x: 40, y: 20 },
      { x: 50, y: 30 },
    ],
  }
  const gfa = `${LINE}\n${walk('alt', '>v1>v2>v3')}`
  const alone = drawn(gfa, ['ref#0#chr'], bent)
  const both = drawn(gfa, ['ref#0#chr', 'alt#1#chr'], bent)
  for (const edge of [0, 1]) {
    const [base] = alone.links(edge)
    for (const lane of both.links(edge)) {
      const [c] = lane.curves
      const [b] = base!.curves
      const dx = c!.x0 - b!.x0
      const dy = c!.y0 - b!.y0
      for (const k of ['cx0', 'cx1', 'x1'] as const) {
        expect(c![k] - b![k]).toBeCloseTo(dx, 9)
      }
      for (const k of ['cy0', 'cy1', 'y1'] as const) {
        expect(c![k] - b![k]).toBeCloseTo(dy, 9)
      }
      expect(lane.endOffsetX).toBe(lane.offsetX)
    }
  }
  for (const s of both.strokes('v1+')) {
    for (const n of s.normals!) {
      expect(Math.abs(n.nx)).toBeLessThan(1e-9)
    }
  }
})

const bandAt = (strokes: { offsetX?: number; thickness: number }[]) =>
  Math.max(...strokes.map(s => s.offsetX! + s.thickness)) -
  Math.min(...strokes.map(s => s.offsetX! - s.thickness))

test('a band of threads never grows wider than MAX_BAND_PX, and its key says when it thins', () => {
  const names = Array.from({ length: 19 }, (_, i) => `d${i}`)
  const lines = names.map((name, i) =>
    walk(name, i % 3 ? '>v1>v2>v3' : '>v1>v2>v1>v2>v1>v2>v3'),
  )
  const crowd = drawn(`${LINE}\n${lines.join('\n')}`, [
    'ref#0#chr',
    ...names.map(n => `${n}#1#chr`),
  ])
  expect(bandAt(crowd.strokes('v1+'))).toBeLessThanOrEqual(MAX_BAND_PX + 1e-9)
  expect(bandAt(crowd.strokes('v1+'))).toBeGreaterThan(MAX_BAND_PX - 1)
  expect(passesKey(crowd.highlight.walks)).toBe(`${PASSES_KEY}, thinned to fit`)

  const few = drawn(
    `${LINE}\n${walk('d', '>v1>v2>v1>v2>v1>v2>v3')}\n${walk('e', '>v1>v2>v3')}`,
    ['ref#0#chr', 'e#1#chr', 'd#1#chr'],
  )
  expect(bandAt(few.strokes('v1+'))).toBeLessThan(MAX_BAND_PX)
  expect(passesKey(few.highlight.walks)).toBe(PASSES_KEY)
})

test('threads only where walks lifted together pass a node more than once', () => {
  expect(threadsPasses([{ mostPasses: 2 }])).toBe(false)
  expect(threadsPasses([{ mostPasses: 1 }, { mostPasses: 1 }])).toBe(false)
  expect(threadsPasses([{ mostPasses: 1 }, { mostPasses: 2 }])).toBe(true)
})

const zigzag: Record<string, NodeSegment[]> = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [
    `n${i}+`,
    [
      { x: i, y: i % 2 ? 0.5 : -0.5 },
      { x: i + 1, y: i % 2 ? -0.5 : 0.5 },
    ],
  ]),
)
const chain = (ids: number[]) => ids.map(i => `>n${i}`).join('')
const ZIGZAG = [
  ...Array.from({ length: 20 }, (_, i) => `S\tn${i}\tA`),
  ...Array.from({ length: 19 }, (_, i) => `L\tn${i}\t+\tn${i + 1}\t+\t0M`),
  'L\tn9\t+\tn0\t+\t0M',
  'L\tn19\t+\tn0\t+\t0M',
  'S\tb14\tA',
  'L\tn13\t+\tb14\t+\t0M',
  'L\tb14\t+\tn15\t+\t0M',
].join('\n')
const upTo = (n: number) => Array.from({ length: n }, (_, i) => i)

test('threads follow the walk smoothed, not each short node', () => {
  const gfa = `${ZIGZAG}\n${walk('a', chain(upTo(20)))}\n${walk('b', chain([...upTo(10), ...upTo(20)]))}`
  const { strokes } = drawn(gfa, ['a#1#chr', 'b#1#chr'], zigzag)
  for (let i = 6; i < 14; i++) {
    for (const s of strokes(`n${i}+`)) {
      for (const n of s.normals!) {
        expect(Math.abs(n.nx)).toBeLessThan(0.1)
        expect(n.ny).toBeGreaterThan(0.99)
      }
    }
  }
})

test('a walk running backwards keeps its lane on one side through a bubble only it takes', () => {
  const gfa = [
    'S\tv1\tAAAA',
    'S\tv2\tCC',
    'S\tv3\tGG',
    'S\tv4\tTTT',
    'L\tv1\t+\tv2\t+\t0M',
    'L\tv2\t+\tv4\t+\t0M',
    'L\tv1\t+\tv3\t+\t0M',
    'L\tv3\t+\tv4\t+\t0M',
    'W\tref\t0\tchr\t0\t9\t>v1>v2>v4',
    walk('b', '<v4<v3<v1'),
  ].join('\n')
  const apart: Record<string, NodeSegment[]> = {
    'v1+': [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    'v2+': [
      { x: 30, y: 0 },
      { x: 40, y: 0 },
    ],
    'v3+': [
      { x: 30, y: 20 },
      { x: 40, y: 20 },
    ],
    'v4+': [
      { x: 60, y: 0 },
      { x: 70, y: 0 },
    ],
  }
  const { strokes } = drawn(gfa, ['ref#0#chr', 'b#1#chr'], apart)
  const side = (id: string) =>
    Math.sign(
      strokes(id).find(s => s.walk === 1)!.points[0]!.y - apart[id]![0]!.y,
    )
  expect(side('v3+')).toBe(side('v1+'))
  expect(side('v4+')).toBe(side('v1+'))
})

test('lanes of walks that never repeat follow the walk smoothed too, on their own nodes', () => {
  const gfa = `${ZIGZAG}\n${walk('a', chain(upTo(20)))}\n${walk('b', chain(upTo(20)))}`
  const { strokes } = drawn(gfa, ['a#1#chr', 'b#1#chr'], zigzag)
  for (let i = 6; i < 14; i++) {
    for (const s of strokes(`n${i}+`)) {
      s.normals!.forEach((n, k) => {
        expect(Math.abs(n.nx)).toBeLessThan(0.1)
        expect(n.ny).toBeGreaterThan(0.99)
        const own = zigzag[`n${i}+`]![k]!
        expect(s.points[k]!.x - n.nx * s.offsetX!).toBeCloseTo(own.x, 9)
        expect(s.points[k]!.y - n.ny * s.offsetX!).toBeCloseTo(own.y, 9)
      })
    }
  }
})

test('a walk running against the first keeps the threads in their order', () => {
  const back = upTo(20).slice(5).reverse()
  const gfa = `${ZIGZAG}\n${walk('a', chain([...upTo(10), ...upTo(10)]))}\n${walk('b', back.map(i => `<n${i}`).join(''))}`
  const { strokes } = drawn(gfa, ['a#1#chr', 'b#1#chr'], zigzag)
  for (const s of strokes('n15+')) {
    expect(s.normals![0]!.ny).toBeGreaterThan(0.9)
  }
})

test('a copy keeps its thread round a bubble the other copy skips', () => {
  const twice = [
    ...upTo(20).map(i => `>n${i}`),
    ...upTo(14).map(i => `>n${i}`),
    '>b14',
    ...upTo(20)
      .slice(15)
      .map(i => `>n${i}`),
  ].join('')
  const gfa = `${ZIGZAG}\n${walk('a', chain(upTo(20)))}\n${walk('dup', twice)}`
  const bubbled = { ...zigzag, 'b14+': zigzag['n14+']! }
  const { strokes, links } = drawn(gfa, ['a#1#chr', 'dup#1#chr'], bubbled, {
    scale: 8,
  })
  const passes = (id: string) =>
    strokes(id)
      .filter(s => s.walk === 1)
      .map(s => s.pass)
  expect(passes('n5+')).toEqual([0, 1])
  expect(passes('n14+')).toEqual([0])
  expect(passes('b14+')).toEqual([1])
  const outOfBubble = 22
  expect(links(outOfBubble).map(c => c.pass)).toEqual([1])
})

// Where each node's first thread runs, without its lane offset, for two walks
// lifted round a loop of `radius` px hanging off a straight chain
function curlCentres(radius: number) {
  const curl: Record<string, NodeSegment[]> = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => {
      const t = ((i - 10) / 20) * 2 * Math.PI
      const at =
        i < 10 || i >= 30
          ? { x: i, y: 0 }
          : { x: 10 + Math.sin(t) * radius, y: radius - Math.cos(t) * radius }
      return [`c${i}+`, [at, { x: at.x + 0.01, y: at.y }]]
    }),
  )
  const ids = Array.from({ length: 40 }, (_, i) => i)
  const gfa = [
    ...ids.map(i => `S\tc${i}\tA`),
    ...ids.slice(1).map(i => `L\tc${i - 1}\t+\tc${i}\t+\t0M`),
    'L\tc39\t+\tc0\t+\t0M',
    walk('a', ids.map(i => `>c${i}`).join('')),
    walk('b', [...ids, ...ids].map(i => `>c${i}`).join('')),
  ].join('\n')
  const { strokes } = drawn(gfa, ['a#1#chr', 'b#1#chr'], curl)
  return (id: string) => {
    const [s] = strokes(id)
    const p = s!.points[0]!
    const n = s!.normals![0]!
    return { x: p.x - n.nx * s!.offsetX!, y: p.y - n.ny * s!.offsetX! }
  }
}

test('lanes take the chord of a curl too tight for the band to follow', () => {
  const centre = curlCentres(4)
  expect(Math.abs(centre('c20+').y)).toBeLessThan(1)
  expect(Math.hypot(centre('c2+').x - 2, centre('c2+').y)).toBeLessThan(0.5)
})

test("lanes keep to a loop wide enough for the band's inner thread", () => {
  const centre = curlCentres(10)
  expect(centre('c20+').y).toBeGreaterThan(15)
})

test('a dashed link eases its lane offset dash by dash from where it leaves to where it arrives', () => {
  const bent: Record<string, NodeSegment[]> = {
    ...flat,
    'v2+': [
      { x: 60, y: 0 },
      { x: 60, y: 60 },
    ],
  }
  const solid = drawn(DUP, ['ref#0#chr', 'dup#1#chr'], bent, { scale: 4 })
  const dashed = drawn(DUP, ['ref#0#chr', 'dup#1#chr'], bent, {
    scale: 4,
    deletions: [0],
  })
  const whole = solid.links(0).find(c => c.walk === 1 && c.pass === 0)!
  const dashes = dashed.links(0).filter(c => c.walk === 1 && c.pass === 0)
  const vector = (normal = { nx: 0, ny: 0 }, offsetX = 0) => [
    normal.nx * offsetX,
    normal.ny * offsetX,
  ]
  const from = vector(whole.normal, whole.offsetX)
  const to = vector(whole.endNormal, whole.endOffsetX)
  expect(Math.hypot(from[0]! - to[0]!, from[1]! - to[1]!)).toBeGreaterThan(0.1)
  expect(dashes.length).toBeGreaterThan(2)
  const first = vector(dashes[0]!.normal, dashes[0]!.offsetX)
  const last = vector(dashes.at(-1)!.endNormal, dashes.at(-1)!.endOffsetX)
  expect(first[0]).toBeCloseTo(from[0]!)
  expect(first[1]).toBeCloseTo(from[1]!)
  expect(last[0]).toBeCloseTo(to[0]!)
  expect(last[1]).toBeCloseTo(to[1]!)
  const gone = dashes.map(d => {
    const [x, y] = vector(d.normal, d.offsetX)
    return Math.hypot(x! - from[0]!, y! - from[1]!)
  })
  expect(gone).toEqual([...gone].sort((a, b) => a - b))
  expect(gone.at(-1)).toBeGreaterThan(gone[1]!)
})

test('a viewport only a thread reaches still draws that thread, as an unculled build does', () => {
  const edge = 0
  const all = drawn(DUP, ['ref#0#chr', 'dup#1#chr']).links(edge)
  const outer = Math.max(...all.map(l => Math.abs(l.curves[0]!.y0)))
  const viewportBounds = { minX: 12, maxX: 18, minY: outer - 0.5, maxY: 99 }
  const culled = drawn(DUP, ['ref#0#chr', 'dup#1#chr'], flat, {
    viewportBounds,
  }).links(edge)
  expect(outer).toBeGreaterThan(1)
  expect(culled.length).toBeGreaterThan(0)
  expect(all).toEqual(expect.arrayContaining(culled))
})
