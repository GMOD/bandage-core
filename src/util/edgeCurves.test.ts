import { buildGeometry } from '../renderer/GeometryBuilder'
import { EdgeSpatialIndex } from './SpatialIndex'
import { SKIP_LEVEL_PX, baseEdgeCurves } from './edgeCurves'
import { curvePointAt } from './geometry'

import type { DeletionRoutes } from '../layout/deletionRoutes'
import type { Graph, GraphNode, NodeSegment } from '../types'
import type { BezierCurve } from './geometry'

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

// Six 10 bp backbone segments end to end, drawn 2 px each, with every skip's
// route laid on the backbone as a force layout lays a short one: sv-49's 16 bp
// skip and the 1 bp skips sharing its anchors were drawn over each other there
describe('skips at one site', () => {
  const scale = 0.2
  const axis = { scaleX: scale, scaleY: scale }
  // the widest a skip draws at the default connector, dashed
  const widestSkipPx = 2 * 2.2
  const backbone: GraphNode[] = [0, 1, 2, 3, 4, 5].map(i => ({
    id: `n${i}+`,
    name: `n${i}`,
    length: 10,
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
  const skips = (links: [number, number, number[]][]) => {
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
      { name: 'site', nodes: backbone, edges },
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

  test('two skips over one span between the same anchors rise a stroke apart', () => {
    const curves = skips([
      [0, 2, [1]],
      [0, 2, [1]],
    ])
    expect(
      Math.abs(heightPx(curves.get(1)!) - heightPx(curves.get(0)!)),
    ).toBeGreaterThanOrEqual(widestSkipPx)
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

  test('a skip whose span overlaps no other keeps the path its layout gave it', () => {
    const curves = skips([
      [0, 2, [1]],
      [3, 5, [4]],
    ])
    for (const arc of [curves.get(0)!, curves.get(1)!]) {
      expect(arc.length).toBeGreaterThan(1)
      expect(heightPx(arc)).toBeLessThan(1)
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

  test('a route that already rises past its level keeps its path', () => {
    const p = positions()
    const curves = baseEdgeCurves(
      p,
      { name: 'site', nodes: backbone, edges: [{ from: 'n0+', to: 'n3+' }] },
      axis,
      new Map([[0, ['n1+', 'n2+']]]),
      0,
      { 0: [{ x: 20, y: 200 }] },
    )
    expect(curves.get(0)!.length).toBeGreaterThan(1)
    expect(heightPx(curves.get(0)!)).toBeGreaterThan(30)
  })
})
