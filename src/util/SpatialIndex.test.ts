import { EdgeSpatialIndex, SpatialIndex } from './SpatialIndex'
import { baseEdgeCurves } from './edgeCurves'
import { curvePointAt, pathRibbonOffsets } from './geometry'
import { distanceToCubicBezier, findHoveredEdge } from './hitDetection'

import type { Graph, NodeSegment } from '../types'

const positions = {
  'A+': [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  'B+': [
    { x: 200, y: 200 },
    { x: 300, y: 200 },
  ],
  'C+': [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ],
}

test('finds nearby segments', () => {
  const index = new SpatialIndex(positions, 50)
  const results = index.query(50, 0, 10)
  const nodeIds = results.map(r => r.nodeId)
  expect(nodeIds).toContain('A+')
  expect(nodeIds).not.toContain('B+')
})

test('finds nothing when far from all segments', () => {
  const index = new SpatialIndex(positions, 50)
  const results = index.query(500, 500, 10)
  expect(results).toHaveLength(0)
})

test('finds segments near intersection', () => {
  const index = new SpatialIndex(positions, 50)
  const results = index.query(0, 0, 10)
  const nodeIds = new Set(results.map(r => r.nodeId))
  expect(nodeIds.has('A+')).toBe(true)
  expect(nodeIds.has('C+')).toBe(true)
})

test('larger radius finds more candidates', () => {
  const index = new SpatialIndex(positions, 50)
  const small = index.query(150, 100, 10)
  const large = index.query(150, 100, 200)
  expect(large.length).toBeGreaterThanOrEqual(small.length)
})

test('deduplicates entries across cells', () => {
  const index = new SpatialIndex(positions, 10)
  const results = index.query(50, 0, 20)
  const keys = results.map(r => `${r.nodeId}:${r.segmentIdx}`)
  const unique = new Set(keys)
  expect(keys.length).toBe(unique.size)
})

// A row layout puts bp on x and a 20 px row pitch on y, so one cell size taken
// from the two summed is the x size, and applied to y it swallows every row into
// one cell: the grid stops discriminating on y and each query hands the distance
// loop every row in the band. HPRC's rGFA is exactly this shape, at ~7 kb a
// segment.
test('a row layout is bucketed on both axes, not just on x', () => {
  const rows: Record<string, { x: number; y: number }[]> = {}
  for (let row = 0; row < 20; row++) {
    rows[`r${row}`] = [
      { x: 0, y: row * 20 },
      { x: 7000, y: row * 20 },
    ]
  }
  const index = new SpatialIndex(rows)

  // 5 screen px of slack on y, which is a quarter of a row
  const hits = index.query(3500, 0, 7000 * 0.001, 5)
  expect(hits.map(h => h.nodeId)).toEqual(['r0'])
})

test('a query reaches as far on y as its y radius says, not its x radius', () => {
  const rows = Object.fromEntries(
    Array.from({ length: 6 }, (_, row) => [
      `row${row}`,
      [
        { x: 0, y: row * 20 },
        { x: 7000, y: row * 20 },
      ],
    ]),
  )
  const index = new SpatialIndex(rows)
  expect(index.query(3500, 0, 3500, 5).map(h => h.nodeId)).toEqual(['row0'])
  expect(
    index
      .query(3500, 50, 1, 45)
      .map(h => h.nodeId)
      .toSorted(),
  ).toEqual(['row0', 'row1', 'row2', 'row3', 'row4'])
  expect(index.some(3500, 50, 1, 45, ({ nodeId }) => nodeId === 'row4')).toBe(
    true,
  )
  expect(index.some(3500, 0, 3500, 5, ({ nodeId }) => nodeId === 'row1')).toBe(
    false,
  )
})

test('a query far wider than its cells looks only in the cells that hold a segment', () => {
  const index = new SpatialIndex(
    {
      far: [
        { x: 5000, y: 3000 },
        { x: 5001, y: 3000 },
      ],
      near: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
    1,
  )
  const lookups = vi.spyOn(Map.prototype, 'get')
  const hits = index.query(2500, 1500, 3000)
  const looked = lookups.mock.calls.length
  lookups.mockRestore()
  expect(hits.map(h => h.nodeId)).toEqual(['near', 'far'])
  expect(looked).toBeLessThan(10)
})

test('some asks no further once a segment passes', () => {
  const index = new SpatialIndex(positions, 50)
  const asked: string[] = []
  const found = index.some(150, 100, 200, 200, ({ nodeId }) => {
    asked.push(nodeId)
    return true
  })
  expect(found).toBe(true)
  expect(asked).toHaveLength(1)
  expect(index.some(150, 100, 200, 200, () => false)).toBe(false)
  expect(index.some(500, 500, 10, 10, () => true)).toBe(false)
})

test('cells are no smaller than the smallest asked for', () => {
  const dots = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      `d${i}`,
      [
        { x: i * 10, y: 0 },
        { x: i * 10 + 1, y: 0 },
      ],
    ]),
  )
  expect(new SpatialIndex(dots).query(250, 0, 100)).toHaveLength(21)
  expect(
    new SpatialIndex(dots, undefined, { x: 500, y: 500 }).query(250, 0, 100),
  ).toHaveLength(50)
})

function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Many short links, which size the cells at a few px, and two that cross the
// whole drawing, as the force layout of the MHC drew
function crowdWithTwoLongLinks() {
  const random = seeded(7)
  const nodePositions: Record<string, NodeSegment[]> = {}
  const graph: Graph = { name: 'mhc', nodes: [], edges: [] }
  const addNode = (id: string, x: number, y: number) => {
    nodePositions[id] = [
      { x, y },
      { x: x + 6, y: y + 2 },
    ]
    graph.nodes.push({ id, name: id, length: 6, depth: 1 })
  }
  for (let i = 0; i < 4000; i++) {
    const x = random() * 32000
    const y = random() * 15500
    addNode(`a${i}+`, x, y)
    addNode(`b${i}+`, x + 4 + random() * 4, y + random() * 3)
    graph.edges.push({
      from: `a${i}+`,
      to: `b${i}+`,
      pathIds: i % 3 === 0 ? ['p1', 'p2'] : undefined,
    })
  }
  addNode('L0+', 0, 0)
  addNode('L1+', 32000, 15500)
  addNode('M0+', 500, 15000)
  addNode('M1+', 31500, 300)
  graph.edges.push({ from: 'L0+', to: 'L1+', pathIds: ['p1', 'p2', 'p3'] })
  graph.edges.push({ from: 'M0+', to: 'M1+' })
  return { nodePositions, graph }
}

describe('links that cross the whole drawing', () => {
  const { nodePositions, graph } = crowdWithTwoLongLinks()
  const iso = { scaleX: 1, scaleY: 1 }

  test('are not stamped into every cell their box covers', () => {
    const index = new EdgeSpatialIndex(nodePositions, graph, true, iso)
    expect(index.stamps).toBeLessThan(64 * graph.edges.length)
  })

  test('are hit where a scan of every link finds them, and nowhere else', () => {
    const curves = baseEdgeCurves(nodePositions, graph, iso, undefined, 0)
    const threshold = 10
    const nearest = (x: number, y: number) => {
      let hovered: number | null = null
      let best = threshold
      graph.edges.forEach((edge, ei) => {
        const base = curves.get(ei)!
        const offsets = edge.pathIds
          ? pathRibbonOffsets(
              nodePositions[edge.from]!,
              nodePositions[edge.to]!,
              edge.pathIds.length,
              iso,
              base,
            )
          : [{ x: 0, y: 0 }]
        for (const o of offsets) {
          for (const c of base) {
            const d = distanceToCubicBezier(x - o.x, y - o.y, c)
            if (d < best) {
              best = d
              hovered = ei
            }
          }
        }
      })
      return hovered
    }
    const random = seeded(11)
    const long = [graph.edges.length - 2, graph.edges.length - 1]
    const points = Array.from({ length: 1500 }, (_, i) => {
      const along = long[i % 2]!
      const c = curves.get(along)![0]!
      const on = curvePointAt(c, random())
      return i % 3 === 0
        ? { x: random() * 32000, y: random() * 15500 }
        : { x: on.x + (random() - 0.5) * 30, y: on.y + (random() - 0.5) * 30 }
    })
    const hits = points.map(({ x, y }) =>
      findHoveredEdge(
        nodePositions,
        graph,
        x,
        y,
        iso,
        true,
        0,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
      ),
    )
    expect(hits).toEqual(points.map(({ x, y }) => nearest(x, y)))
    expect(
      hits.filter(h => h !== null && long.includes(h)).length,
    ).toBeGreaterThan(300)
  })
})

// The order a query hands back decides which of two equally near entries is
// hovered, so a box too wide to stamp must come back where the walk of every
// cell it covers would have met it: at the first cell of the query it covers,
// column by column, and in order of adding within that cell
test('a query returns wide and stamped boxes in the order stamping all of them would', () => {
  const random = seeded(3)
  const cell = 2
  const scattered: Record<string, NodeSegment[]> = {}
  for (let i = 0; i < 300; i++) {
    const x = random() * 400
    const y = random() * 400
    const wide = i % 25 === 0
    scattered[`n${i}`] = [
      { x, y },
      {
        x: x + (wide ? 100 + random() * 300 : random() * 6),
        y: y + (wide ? 100 + random() * 300 : random() * 6),
      },
    ]
  }
  const index = new SpatialIndex(scattered, cell)
  const ranges = Object.entries(scattered).map(([nodeId, [a, b]]) => ({
    nodeId,
    cx0: Math.floor(Math.min(a!.x, b!.x) / cell),
    cx1: Math.floor(Math.max(a!.x, b!.x) / cell),
    cy0: Math.floor(Math.min(a!.y, b!.y) / cell),
    cy1: Math.floor(Math.max(a!.y, b!.y) / cell),
  }))
  for (let k = 0; k < 500; k++) {
    const x = random() * 800 - 100
    const y = random() * 800 - 100
    const r = random() * 20
    const q = {
      cx0: Math.floor((x - r) / cell),
      cx1: Math.floor((x + r) / cell),
      cy0: Math.floor((y - r) / cell),
      cy1: Math.floor((y + r) / cell),
    }
    const expected = ranges
      .map((b, rank) => ({
        nodeId: b.nodeId,
        rank,
        cx: Math.max(b.cx0, q.cx0),
        cy: Math.max(b.cy0, q.cy0),
        within:
          b.cx0 <= q.cx1 && q.cx0 <= b.cx1 && b.cy0 <= q.cy1 && q.cy0 <= b.cy1,
      }))
      .filter(b => b.within)
      .sort((a, b) => a.cx - b.cx || a.cy - b.cy || a.rank - b.rank)
      .map(b => b.nodeId)
    expect(index.query(x, y, r).map(h => h.nodeId)).toEqual(expected)
    expect(index.some(x, y, r, r, () => true)).toBe(expected.length > 0)
  }
})
