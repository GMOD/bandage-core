import { buildGeometry } from '../renderer/GeometryBuilder'
import { EdgeSpatialIndex } from './SpatialIndex'
import { SKIP_LEVEL_PX, baseEdgeCurves, runsAlong } from './edgeCurves'
import { curvePointAt, distanceToSegment } from './geometry'

import type { DeletionRoutes } from '../layout/deletionRoutes'
import type { Graph, GraphNode, NodeSegment } from '../types'
import type { AxisScale, BezierCurve } from './geometry'

// a walk, which makes a graph one whose short skips arch low
const WALK = [{ name: 'a#1#chr1', nodeIds: ['n0+'] }]

const nodes: GraphNode[] = [
  { id: 'a+', name: 'a', length: 100, depth: 1 },
  { id: 'b+', name: 'b', length: 100, depth: 1 },
]
const graph = {
  name: 'test',
  nodes,
  edges: [{ from: 'a+', to: 'b+' }],
} satisfies Graph

function layout(): Record<string, NodeSegment[]> {
  return {
    'a+': [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    'b+': [
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ],
  }
}

const iso = { scaleX: 1, scaleY: 1 }

test('the same layout at the same zoom is derived once', () => {
  const positions = layout()
  expect(baseEdgeCurves(positions, graph, iso, undefined, 0)).toBe(
    baseEdgeCurves(positions, graph, iso, undefined, 0),
  )
})

// A row layout caps a skip's bow and an isotropic one does not, and at a zoom
// of 1 the two axes are the same pair of scales
test('a row layout and an isotropic one at the same scales are derived apart', () => {
  const positions = {
    ...layout(),
    'mid+': [
      { x: 100, y: 0 },
      { x: 1100, y: 0 },
    ],
    'b+': [
      { x: 1100, y: 0 },
      { x: 1200, y: 0 },
    ],
  }
  const skipped = new Map([[0, ['mid+']]])
  const farthest = (pixelRows: boolean) =>
    Math.max(
      ...baseEdgeCurves(positions, graph, { ...iso, pixelRows }, skipped, 0)
        .get(0)!
        .map(c => Math.abs(c.cy0)),
    )
  const rows = farthest(true)
  expect(farthest(false)).toBeGreaterThan(rows * 2)
})

// The reason this is shared at all: the drawing and the hit index used to build
// this curve separately, per edge, from identical arguments — so the index's
// whole construction was mostly work the geometry pass had just done. Asserted
// by object identity rather than by shape, because equal-looking curves derived
// twice is exactly the state this replaced.
test('the drawing and the hit index draw from the same curve objects', () => {
  const positions = layout()
  const shared = baseEdgeCurves(positions, graph, iso, undefined, 0)
  const batch = buildGeometry({
    nodePositions: positions,
    graph,
    nodeById: new Map(nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: iso,
  })
  const index = new EdgeSpatialIndex(positions, graph, false, iso)
  expect(batch.edgeCurves[0]!.curves).toBe(shared.get(0))
  expect(index.getCurves(0)).toBe(shared.get(0))
})

// A zoom changes the curve — control-point extension is clamped in screen terms
// — so the scales are part of the key rather than something the layout stands
// in for.
test('a zoom re-derives', () => {
  const positions = layout()
  const before = baseEdgeCurves(positions, graph, iso, undefined, 0)
  expect(
    baseEdgeCurves(positions, graph, { scaleX: 4, scaleY: 4 }, undefined, 0),
  ).not.toBe(before)
})

// A node drag moves the position objects without replacing them, so their
// identity cannot report it and the version is the only thing that can. Getting
// this wrong is silent: the drawing follows the node and the curves attached to
// it do not.
test('a version bump re-derives positions mutated in place', () => {
  const positions = layout()
  const before = baseEdgeCurves(positions, graph, iso, undefined, 0).get(0)![0]!
  for (const seg of positions['a+']!) {
    seg.y += 40
  }
  const after = baseEdgeCurves(positions, graph, iso, undefined, 1).get(0)![0]!
  expect(after.y0).toBeCloseTo(before.y0 + 40, 5)
})

// An edge whose endpoints the layout never placed has no curve, and its absence
// is the same "skip it" every consumer already applies to a missing node.
test('an edge with an unplaced endpoint has no curve', () => {
  const positions = layout()
  delete positions['b+']
  expect(baseEdgeCurves(positions, graph, iso, undefined, 0).has(0)).toBe(false)
})

// A force layout folds a long node into a V whose tips sit side by side, with
// both its neighbours off one tip: the KIV-2 cut's 241 bp insertion
describe('a folded node', () => {
  const folded: Record<string, NodeSegment[]> = {
    'a+': [
      { x: 300, y: 10 },
      { x: 108, y: 10 },
    ],
    'v+': [
      { x: 100, y: 0 },
      { x: 105, y: -20 },
      { x: 110, y: 0 },
    ],
    'b+': [
      { x: 120, y: 10 },
      { x: 300, y: 10 },
    ],
  }
  const foldedGraph = (edges: Graph['edges']): Graph => ({
    name: 'folded',
    nodes: ['a+', 'v+', 'b+'].map(id => ({
      id,
      name: id,
      length: 1,
      depth: 1,
    })),
    edges,
  })
  const ends = (g: Graph, stranded: boolean) =>
    [...baseEdgeCurves(folded, g, iso, undefined, 0, undefined, stranded)]
      .sort(([a], [b]) => a - b)
      .map(([, curves]) => [curves[0]!.x0, curves.at(-1)!.x1])

  test('joins the ends its links name when the layout is stranded', () => {
    const forward = foldedGraph([
      { from: 'a+', to: 'v+', fromStrand: '+', toStrand: '+' },
      { from: 'v+', to: 'b+', fromStrand: '+', toStrand: '+' },
    ])
    expect(ends(forward, true)).toEqual([
      [108, 100],
      [110, 120],
    ])
  })

  test('a link reading the node backwards joins its other ends', () => {
    const backwards = foldedGraph([
      { from: 'a+', to: 'v+', fromStrand: '+', toStrand: '-' },
      { from: 'v+', to: 'b+', fromStrand: '-', toStrand: '+' },
    ])
    expect(ends(backwards, true)).toEqual([
      [108, 110],
      [100, 120],
    ])
  })

  test('unstranded, both links hang off the tip nearer the neighbours', () => {
    const forward = foldedGraph([
      { from: 'a+', to: 'v+' },
      { from: 'v+', to: 'b+' },
    ])
    expect(ends(forward, false)).toEqual([
      [108, 110],
      [110, 120],
    ])
  })
})

// An insertion hangs below the node it bypasses, as the anchored layout lays
// it. Dragged left past the middle of `b`, it once pulled the link from `b`'s
// end round to its start, where the other link already left from.
describe('a dragged node', () => {
  const laid = (): Record<string, NodeSegment[]> => ({
    'a+': [
      { x: 50, y: 0 },
      { x: 115, y: 0 },
    ],
    'b+': [
      { x: 115, y: 0 },
      { x: 300, y: 0 },
    ],
    'ins+': [
      { x: 220, y: 200 },
      { x: 250, y: 200 },
    ],
  })
  const bypass: Graph = {
    name: 'bypass',
    nodes: ['a+', 'b+', 'ins+'].map(id => ({
      id,
      name: id,
      length: 1,
      depth: 1,
    })),
    edges: [
      { from: 'a+', to: 'ins+' },
      { from: 'ins+', to: 'b+' },
    ],
  }
  const ends = (positions: Record<string, NodeSegment[]>, version: number) =>
    [...baseEdgeCurves(positions, bypass, iso, undefined, version)].map(
      ([, curves]) => [curves[0]!.x0, curves.at(-1)!.x1],
    )
  const drag = (positions: Record<string, NodeSegment[]>, dx: number) => {
    for (const seg of positions['ins+']!) {
      seg.x += dx
    }
  }

  test('keeps the ends it was laid with', () => {
    const positions = laid()
    expect(ends(positions, 0)).toEqual([
      [115, 220],
      [250, 300],
    ])
    drag(positions, -35)
    expect(ends(positions, 1)).toEqual([
      [115, 185],
      [215, 300],
    ])
  })

  test('a new layout reads its ends afresh', () => {
    const positions = laid()
    drag(positions, -35)
    expect(ends(positions, 0)).toEqual([
      [115, 185],
      [215, 115],
    ])
  })
})

// Six backbone segments end to end, drawn 5 px each, with every skip's route
// laid on the backbone as a force layout lays a short one: sv-49's 16 bp skip
// and the 1 bp skips sharing its anchors were drawn over each other there
describe('skips at one site', () => {
  const scale = 0.5
  const axis = { scaleX: scale, scaleY: scale }
  // the widest a skip draws at the default connector, dashed
  const widestSkipPx = 2 * 2.2
  // each node 1 bp of a reference whose coordinates run 10 bp a node, so
  // each skip spans enough bp at the reference's px a bp to stay unfolded
  const backbone: GraphNode[] = [0, 1, 2, 3, 4, 5].map(i => ({
    id: `n${i}+`,
    name: `n${i}`,
    length: 1,
    depth: 1,
    stable: { refName: 'chr1', start: i * 10, rank: 0 },
  }))
  const positions = () =>
    Object.fromEntries(
      backbone.map((n, i) => [
        n.id,
        [
          { x: i * 10, y: 0 },
          { x: i * 10 + 10, y: 0 },
        ],
      ]),
    )
  const skips = (links: [number, number, number[]][], paths = WALK) => {
    const edges = links.map(([from, to]) => ({
      from: `n${from}+`,
      to: `n${to}+`,
    }))
    const routes: DeletionRoutes = Object.fromEntries(
      links.map(([from, to], ei) => [
        ei,
        [
          { x: from * 10 + 12, y: 0 },
          { x: to * 10 - 2, y: 0 },
        ],
      ]),
    )
    return baseEdgeCurves(
      positions(),
      { name: 'site', nodes: backbone, edges, paths },
      axis,
      new Map(
        links.map(([, , bypassed], ei) => [ei, bypassed.map(i => `n${i}+`)]),
      ),
      0,
      routes,
    )
  }
  const points = (curves: BezierCurve[], steps = 64) =>
    curves.flatMap(c =>
      Array.from({ length: steps + 1 }, (_, k) => curvePointAt(c, k / steps)),
    )
  const heightPx = (curves: BezierCurve[]) =>
    Math.max(...points(curves).map(p => Math.abs(p.y) * scale))
  // inside the loop an arc closes with its chord, by ray casting
  const enclosedBy = (curves: BezierCurve[], q: { x: number; y: number }) => {
    const loop = points(curves, 1024)
    let inside = false
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i]!
      const b = loop[j]!
      if (
        a.y > q.y !== b.y > q.y &&
        q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside
      }
    }
    return inside
  }

  test('two skips from one anchor over different spans rise a stroke apart, the longer higher', () => {
    const curves = skips([
      [0, 2, [1]],
      [0, 3, [1, 2]],
    ])
    expect(
      heightPx(curves.get(1)!) - heightPx(curves.get(0)!),
    ).toBeGreaterThanOrEqual(widestSkipPx)
  })

  // pggb chrY's 54 bp and 12 bp skips into node 465726 at 9.3 Mb, whose
  // skipped nodes the reference first walks elsewhere, so neither lists them
  test('a skip that lists no bypassed nodes takes its level from the span it skips', () => {
    const curves = skips([
      [0, 3, []],
      [1, 3, []],
    ])
    expect(
      heightPx(curves.get(0)!) - heightPx(curves.get(1)!),
    ).toBeGreaterThanOrEqual(widestSkipPx)
  })

  test('two skips over spans apart on the reference whose feet land on the same pixels both rise, a stroke apart', () => {
    const backboneLoop = {
      ...positions(),
      'n3+': [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
      'n5+': [
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ],
    }
    const curves = baseEdgeCurves(
      backboneLoop,
      {
        name: 'site',
        nodes: backbone,
        edges: [
          { from: 'n0+', to: 'n2+' },
          { from: 'n3+', to: 'n5+' },
        ],
      },
      axis,
      new Map([
        [0, ['n1+']],
        [1, ['n4+']],
      ]),
      0,
      {
        0: [{ x: 15, y: 0 }],
        1: [{ x: 15, y: 0 }],
      },
    )
    expect(
      Math.abs(heightPx(curves.get(1)!) - heightPx(curves.get(0)!)),
    ).toBeGreaterThanOrEqual(widestSkipPx)
    expect(
      Math.min(heightPx(curves.get(0)!), heightPx(curves.get(1)!)),
    ).toBeCloseTo(SKIP_LEVEL_PX, 5)
  })

  test('two skips whose feet land on the same pixels the other way round rise a stroke apart', () => {
    const turned = {
      ...positions(),
      'n3+': [
        { x: 30, y: 0 },
        { x: 20, y: 0 },
      ],
      'n5+': [
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ],
    }
    const curves = baseEdgeCurves(
      turned,
      {
        name: 'site',
        nodes: backbone,
        edges: [
          { from: 'n0+', to: 'n2+' },
          { from: 'n3+', to: 'n5+' },
        ],
      },
      axis,
      new Map([
        [0, ['n1+']],
        [1, ['n4+']],
      ]),
      0,
      {
        0: [{ x: 15, y: 0 }],
        1: [{ x: 15, y: 0 }],
      },
    )
    expect(
      Math.abs(heightPx(curves.get(1)!) - heightPx(curves.get(0)!)),
    ).toBeGreaterThanOrEqual(widestSkipPx)
  })

  test('two short skips whose spans only abut each rise one level, not stacked', () => {
    const curves = skips([
      [0, 2, [1]],
      [1, 3, [2]],
    ])
    for (const arc of [curves.get(0)!, curves.get(1)!]) {
      expect(heightPx(arc)).toBeCloseTo(SKIP_LEVEL_PX, 5)
    }
  })

  test("the same skips laid out for another graph take that graph's levels", () => {
    const deletions = new Map([
      [0, ['n1+']],
      [1, ['n4+']],
    ])
    const routes: DeletionRoutes = {
      0: [{ x: 15, y: 0 }],
      1: [{ x: 35, y: 0 }],
    }
    const drawn = (edges: Graph['edges']) =>
      baseEdgeCurves(
        positions(),
        { name: 'site', nodes: backbone, edges, paths: WALK },
        axis,
        deletions,
        0,
        routes,
      )
    const nested = drawn([
      { from: 'n0+', to: 'n2+' },
      { from: 'n0+', to: 'n5+' },
    ])
    expect(heightPx(nested.get(1)!)).toBeGreaterThanOrEqual(SKIP_LEVEL_PX)
    const apart = drawn([
      { from: 'n0+', to: 'n2+' },
      { from: 'n3+', to: 'n5+' },
    ])
    for (const arc of [apart.get(0)!, apart.get(1)!]) {
      expect(heightPx(arc)).toBeCloseTo(SKIP_LEVEL_PX, 5)
    }
  })

  test('a skip inside a longer one draws inside it, whether or not they share an anchor', () => {
    const curves = skips([
      [0, 4, [1, 2, 3]],
      [1, 3, [2]],
      [0, 2, [1]],
    ])
    const outer = curves.get(0)!
    for (const inner of [curves.get(1)!, curves.get(2)!]) {
      for (const p of points(inner).slice(1, -1)) {
        expect(enclosedBy(outer, p)).toBe(true)
      }
    }
  })

  test('a skip over one whose route rose far rises a stroke above its low arch', () => {
    const curves = baseEdgeCurves(
      positions(),
      {
        name: 'site',
        nodes: backbone,
        edges: [
          { from: 'n0+', to: 'n4+' },
          { from: 'n1+', to: 'n3+' },
        ],
        paths: WALK,
      },
      axis,
      new Map([
        [0, ['n1+', 'n2+', 'n3+']],
        [1, ['n2+']],
      ]),
      0,
      {
        0: [{ x: 25, y: 0 }],
        1: [{ x: 25, y: -400 }],
      },
    )
    // the inner skip, too short on screen for full dashes, is a low arch
    // whatever its route, and the outer rises a stroke above it
    const inner = heightPx(curves.get(1)!)
    expect(inner).toBeCloseTo(SKIP_LEVEL_PX, 5)
    expect(heightPx(curves.get(0)!) - inner).toBeGreaterThanOrEqual(
      widestSkipPx,
    )
  })

  test('two skips over one span between the same anchors rise a stroke apart', () => {
    const curves = skips([
      [0, 3, [1, 2]],
      [0, 3, [1, 2]],
    ])
    expect(
      Math.abs(heightPx(curves.get(1)!) - heightPx(curves.get(0)!)),
    ).toBeGreaterThanOrEqual(widestSkipPx)
  })

  test('in a graph without walks, two skips over a chord shorter than their rise part along their legs, the higher clear of the lower at its mid-height', () => {
    const curves = skips(
      [
        [0, 2, [1]],
        [0, 2, [1]],
      ],
      [],
    )
    const [low, high] = [curves.get(0)!, curves.get(1)!].sort(
      (a, b) => heightPx(a) - heightPx(b),
    )
    const chordPx = 10 * scale
    expect(chordPx).toBeLessThan(heightPx(high!))
    const lows = points(low!, 1024)
    const clearance = (p: { x: number; y: number }) =>
      lows.reduce(
        (near, q) => Math.min(near, Math.hypot(p.x - q.x, p.y - q.y) * scale),
        Infinity,
      )
    const midway = points(high!, 1024).filter(
      p => Math.abs(p.y) * scale >= heightPx(low!) / 2,
    )
    expect(
      midway.reduce((near, p) => Math.min(near, clearance(p)), Infinity),
    ).toBeGreaterThan(0.4)
  })

  test('lifted skips keep their feet on their anchors, a level apart', () => {
    const curves = skips([
      [0, 3, [1, 2]],
      [1, 3, [2]],
    ])
    const [outer] = curves.get(0)!
    const [inner] = curves.get(1)!
    expect(heightPx([outer!])).toBeCloseTo(2 * SKIP_LEVEL_PX, 5)
    expect(heightPx([inner!])).toBeCloseTo(SKIP_LEVEL_PX, 5)
    expect([outer!.x0, outer!.y0, outer!.x1, outer!.y1]).toEqual([10, 0, 30, 0])
    expect([inner!.x0, inner!.y0, inner!.x1, inner!.y1]).toEqual([20, 0, 30, 0])
  })

  // SV-del-100k+: a 3 kb skip followed its route node, never shorter than the
  // layout's least node, into a curl larger than the reference it skips
  test('a skip too short on screen for full dashes whose span overlaps no other is a low arch a level above its chord', () => {
    const curves = skips([
      [0, 2, [1]],
      [3, 5, [4]],
    ])
    for (const arc of [curves.get(0)!, curves.get(1)!]) {
      expect(arc).toHaveLength(1)
      expect(heightPx(arc)).toBeCloseTo(SKIP_LEVEL_PX, 5)
    }
  })

  test('two skips over spans that overlap without nesting both rise', () => {
    const curves = skips([
      [0, 3, [1, 2]],
      [1, 4, [2, 3]],
    ])
    for (const arc of [curves.get(0)!, curves.get(1)!]) {
      expect(heightPx(arc)).toBeCloseTo(SKIP_LEVEL_PX, 5)
    }
  })

  test('a short skip whose route rises far is drawn a level above its chord, not along its route', () => {
    const p = positions()
    const curves = baseEdgeCurves(
      p,
      {
        name: 'site',
        nodes: backbone,
        edges: [{ from: 'n0+', to: 'n3+' }],
        paths: WALK,
      },
      axis,
      new Map([[0, ['n1+', 'n2+']]]),
      0,
      { 0: [{ x: 20, y: 200 }] },
    )
    expect(curves.get(0)!).toHaveLength(1)
    expect(heightPx(curves.get(0)!)).toBeCloseTo(SKIP_LEVEL_PX, 5)
  })
})

// SV-del-100k+: a 3,146 bp skip rose four levels over 1 bp skips the fold
// hid, a teardrop 28 px across over 20 px of the reference it skips
test('with walks a skip nesting only folded skips rises one level, every point within the span between its feet', () => {
  const lengths = [1000, 1, 1, 1, 500, 1000]
  const starts = lengths.map((_, i) =>
    lengths.slice(0, i).reduce((sum, bp) => sum + bp, 0),
  )
  const backbone: GraphNode[] = lengths.map((length, i) => ({
    id: `n${i}+`,
    name: `n${i}`,
    length,
    depth: 1,
    stable: { refName: 'chr1', start: starts[i]!, rank: 0 },
  }))
  const positions = Object.fromEntries(
    backbone.map((n, i) => [
      n.id,
      [
        { x: starts[i]!, y: 0 },
        { x: starts[i]! + n.length, y: 0 },
      ],
    ]),
  )
  const links: [number, number][] = [
    [0, 5],
    [1, 3],
    [0, 2],
    [2, 4],
  ]
  const scale = 0.02
  const curves = baseEdgeCurves(
    positions,
    {
      name: 'site',
      nodes: backbone,
      edges: links.map(([from, to]) => ({ from: `n${from}+`, to: `n${to}+` })),
      paths: WALK,
    },
    { scaleX: scale, scaleY: scale },
    new Map(
      links.map(([from, to], ei) => [
        ei,
        backbone.slice(from + 1, to).map(n => n.id),
      ]),
    ),
    0,
    Object.fromEntries(
      links.map(([from, to], ei) => [
        ei,
        [
          { x: starts[from]! + lengths[from]!, y: 0 },
          { x: starts[to]!, y: 0 },
        ],
      ]),
    ),
  )
  const outer = curves.get(0)!
  const [left, right] = [starts[1]!, starts[5]!].map(x => x * scale)
  const drawn = outer.flatMap(c =>
    Array.from({ length: 65 }, (_, k) => curvePointAt(c, k / 64)),
  )
  expect(right! - left!).toBeLessThan(33)
  expect(
    drawn.reduce((most, p) => Math.max(most, Math.abs(p.y) * scale), 0),
  ).toBeCloseTo(SKIP_LEVEL_PX, 5)
  for (const p of drawn) {
    expect(p.x * scale).toBeGreaterThanOrEqual(left! - 1e-9)
    expect(p.x * scale).toBeLessThanOrEqual(right! + 1e-9)
  }
})

describe('a dashed skip whose route runs along the reference it skips', () => {
  const backbone: GraphNode[] = [0, 1, 2].map(i => ({
    id: `n${i}+`,
    name: `n${i}`,
    length: 10,
    depth: 1,
    stable: { refName: 'chr1', start: i * 10, rank: 0 },
  }))
  const positions = Object.fromEntries(
    backbone.map((n, i) => [
      n.id,
      [
        { x: i * 10, y: 0 },
        { x: i * 10 + 10, y: 0 },
      ],
    ]),
  )
  const skipAlong = (scale: number, route: NodeSegment[], paths = WALK) => {
    const curves = baseEdgeCurves(
      positions,
      {
        name: 'skip',
        nodes: backbone,
        edges: [{ from: 'n0+', to: 'n2+' }],
        paths,
      },
      { scaleX: scale, scaleY: scale },
      new Map([[0, ['n1+']]]),
      0,
      { 0: route },
    ).get(0)!
    let farthest = 0
    for (const c of curves) {
      for (let k = 0; k <= 32; k++) {
        farthest = Math.max(
          farthest,
          Math.abs(curvePointAt(c, k / 32).y) * scale,
        )
      }
    }
    return farthest
  }
  const along = [
    { x: 12, y: 0.5 },
    { x: 18, y: 0.5 },
  ]

  test('arches clear of the stroke of the nodes it skips', () => {
    expect(skipAlong(4, along)).toBeGreaterThan(12)
  })

  test('a route laid off the reference keeps its course', () => {
    expect(skipAlong(4, [{ x: 15, y: -10 }])).toBeGreaterThan(35)
    expect(skipAlong(4, [{ x: 15, y: -10 }])).toBeLessThan(45)
  })

  test('a skip too short on screen for full dashes is a low arch a level above its chord', () => {
    expect(skipAlong(1, along)).toBeCloseTo(SKIP_LEVEL_PX, 5)
    expect(skipAlong(1, [{ x: 15, y: -40 }])).toBeCloseTo(SKIP_LEVEL_PX, 5)
  })

  test('in a graph without walks, as the rGFA track draws, a skip too short on screen for full dashes follows its route', () => {
    expect(skipAlong(2, [{ x: 15, y: -40 }], [])).toBeGreaterThan(
      4 * SKIP_LEVEL_PX,
    )
  })
})

// runsAlong as it was in 14.3.4, testing every sample against every segment
function runsAlongEverySegment(
  curves: BezierCurve[],
  bypassed: readonly string[],
  nodePositions: Record<string, NodeSegment[]>,
  axis: AxisScale,
) {
  const screen = (p: { x: number; y: number }) => ({
    x: p.x * axis.scaleX,
    y: p.y * axis.scaleY,
  })
  const first = curves[0]!
  const last = curves.at(-1)!
  const stretch = [
    screen({ x: first.x0, y: first.y0 }),
    ...bypassed.flatMap(id => (nodePositions[id] ?? []).map(screen)),
    screen({ x: last.x1, y: last.y1 }),
  ]
  let near = 0
  let all = 0
  for (const c of curves) {
    for (let k = 0; k <= 16; k++) {
      const p = screen(curvePointAt(c, k / 16))
      let onStretch = false
      for (let i = 1; i < stretch.length && !onStretch; i++) {
        const a = stretch[i - 1]!
        const b = stretch[i]!
        onStretch = distanceToSegment(p.x, p.y, a.x, a.y, b.x, b.y) <= 12
      }
      all++
      near += onStretch ? 1 : 0
    }
  }
  return near * 2 > all
}

// mulberry32
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A stretch laid as a wandering or a level line, some of its nodes unplaced,
// some points repeated and some far jumps, and a skip whose pieces run along
// it at about the reach, or off it anywhere in the drawing, or both, or flat
// just inside or outside the reach of a level stretch
function randomSkip(seed: number) {
  const next = random(seed)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!
  const scaleX = pick([0.01, 0.1, 0.5, 1, 3, 20])
  const axis = {
    scaleX,
    scaleY: next() < 0.3 ? pick([0.01, 0.5, 1, 7]) : scaleX,
  }
  const pxX = 1 / axis.scaleX
  const pxY = 1 / axis.scaleY
  const count = pick([0, 1, 3, 40, 300, 3000])
  const level = next() < 0.3
  const positions: Record<string, NodeSegment[]> = {}
  const bypassed: string[] = []
  const line: NodeSegment[] = []
  let x = 0
  let y = 0
  for (let i = 0; i < count; i++) {
    const id = `s${i}`
    bypassed.push(next() < 0.05 ? `unplaced${i}` : id)
    const points = Array.from({ length: pick([0, 1, 2, 2, 3]) }, () => {
      const jump = next() < 0.01
      x += jump ? (next() - 0.5) * 4000 * pxX : next() * 30 * pxX
      y += level ? 0 : (next() - 0.5) * (jump ? 4000 : 30) * pxY
      return next() < 0.05 && line.length > 0 ? { ...line.at(-1)! } : { x, y }
    })
    for (const p of points) {
      line.push(p)
    }
    positions[id] = points
  }
  const course = pick(['along', 'off', 'mixed', 'rim'])
  const rim = (next() < 0.5 ? -1 : 1) * (12 + (next() - 0.5) * 0.8) * pxY
  const near = () => {
    const at = line.length > 0 ? pick(line) : { x: 0, y: 0 }
    return {
      x: at.x + (next() - 0.5) * 30 * pxX,
      y: at.y + (next() - 0.5) * 30 * pxY,
    }
  }
  const far = () => ({
    x: (next() - 0.5) * 6000 * pxX,
    y: (next() - 0.5) * 6000 * pxY,
  })
  const point = () =>
    course === 'along' || (course === 'mixed' && next() < 0.5) ? near() : far()
  const onRim = () => {
    const at = line.length > 0 ? pick(line) : { x: 0, y: 0 }
    const rimY = at.y + rim
    return {
      x0: at.x,
      y0: rimY,
      cx0: at.x + pxX,
      cy0: rimY,
      cx1: at.x + 2 * pxX,
      cy1: rimY,
      x1: at.x + 3 * pxX,
      y1: rimY,
    }
  }
  const anywhere = () => {
    const a = point()
    const b = point()
    const c = point()
    const d = point()
    return {
      x0: a.x,
      y0: a.y,
      cx0: b.x,
      cy0: b.y,
      cx1: c.x,
      cy1: c.y,
      x1: d.x,
      y1: d.y,
    }
  }
  const curves = Array.from({ length: pick([1, 2, 5, 30]) }, () =>
    course === 'rim' ? onRim() : anywhere(),
  )
  return { curves, bypassed, positions, axis }
}

test.each([1, 2, 3, 4, 5, 6, 7, 8])(
  'whether a skip runs along its stretch is what testing every sample against every segment says, seed %i',
  seed => {
    const answers = Array.from({ length: 100 }, (_, i) => {
      const { curves, bypassed, positions, axis } = randomSkip(seed * 1000 + i)
      const along = runsAlong(curves, bypassed, positions, axis)
      expect(along).toBe(
        runsAlongEverySegment(curves, bypassed, positions, axis),
      )
      return along
    })
    expect(answers.filter(Boolean).length).toBeGreaterThan(10)
    expect(answers.filter(a => !a).length).toBeGreaterThan(10)
  },
)

test('a stretch with a point at NaN reads as testing every segment does', () => {
  const positions = {
    a: [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
    ],
    b: [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ],
  }
  const curves = [
    { x0: 0, y0: 1, cx0: 10, cy0: 1, cx1: 20, cy1: 1, x1: 30, y1: 1 },
  ]
  for (const bypassed of [['a'], ['b'], ['a', 'b'], ['b', 'a']]) {
    expect(runsAlong(curves, bypassed, positions, iso)).toBe(
      runsAlongEverySegment(curves, bypassed, positions, iso),
    )
  }
})

// Testing every sample against every segment of the stretch took about 76 s
// of the browser's main thread on chrY's 14,142-node pggb window, and about
// 40 s here, past the test timeout
test('a skip over a long stretch reads the segments near each sample, not all of them', () => {
  const stretch = Array.from({ length: 5000 }, (_, i) => `r${i}`)
  const positions = Object.fromEntries(
    stretch.map((id, i) => [
      id,
      [
        { x: i * 10, y: 0 },
        { x: i * 10 + 10, y: 0 },
      ],
    ]),
  )
  const piece = (k: number, y: number) => ({
    x0: k * 490,
    y0: y,
    cx0: k * 490 + 100,
    cy0: y,
    cx1: k * 490 + 300,
    cy1: y,
    x1: k * 490 + 400,
    y1: y,
  })
  // its feet and its first `a` pieces after them on the stretch, the rest
  // well off it
  const skip = (a: number) =>
    Array.from({ length: 102 }, (_, k) =>
      piece(k, k <= a || k === 101 ? 0.5 : -2000),
    )
  const along = Array.from({ length: 202 }, (_, j) =>
    runsAlong(skip(j % 101), stretch, positions, iso),
  )
  expect(along.filter(Boolean)).toHaveLength(102)
  expect(along.indexOf(true)).toBe(50)
  expect(along.lastIndexOf(false)).toBe(150)
})
