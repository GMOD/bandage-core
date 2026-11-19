import { LINK_HEAD_SPACING_PX, buildGeometry } from './GeometryBuilder'
import { directedRuns, spreadHeads } from './linkRuns'

import type { GraphEdge } from '../types'

const chain = (n: number) =>
  Array.from({ length: n - 1 }, (_, i) => ({ from: `N${i}`, to: `N${i + 1}` }))

describe('directedRuns', () => {
  test('a chain of nodes with one link at each end is one run, in order', () => {
    const edges = chain(5)
    expect(directedRuns(edges, [3, 1, 0, 2], () => true)).toEqual([
      [0, 1, 2, 3],
    ])
  })

  test('a node with a second link at one end splits the run there', () => {
    const edges: GraphEdge[] = [...chain(5), { from: 'N2', to: 'X' }]
    expect(directedRuns(edges, [0, 1, 2, 3, 4], () => true)).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  test('a link stated the other way round, whose head points back, ends the run', () => {
    const edges: GraphEdge[] = [
      { from: 'N0', to: 'N1', fromStrand: '+', toStrand: '+' },
      { from: 'N1', to: 'N2', fromStrand: '+', toStrand: '+' },
      { from: 'N3', to: 'N2', fromStrand: '-', toStrand: '-' },
      { from: 'N3', to: 'N4', fromStrand: '+', toStrand: '+' },
      { from: 'N4', to: 'N5', fromStrand: '+', toStrand: '+' },
    ]
    expect(directedRuns(edges, [0, 1, 2, 3, 4], () => true)).toEqual([
      [0, 1],
      [3, 4],
    ])
  })

  test('only links drawn count toward a node, and only the ones a run may hold join one', () => {
    const edges: GraphEdge[] = [...chain(5), { from: 'N2', to: 'X' }]
    expect(directedRuns(edges, [0, 1, 2, 3], () => true)).toEqual([
      [0, 1, 2, 3],
    ])
    expect(directedRuns(edges, [0, 1, 2, 3], ei => ei !== 2)).toEqual([[0, 1]])
  })

  test('a ring is one run', () => {
    const edges = [...chain(4), { from: 'N3', to: 'N0' }]
    expect(directedRuns(edges, [0, 1, 2, 3], () => true)).toEqual([
      [0, 1, 2, 3],
    ])
  })
})

describe('spreadHeads', () => {
  const along = Array.from({ length: 50 }, (_, i) => i * 10)

  test('one head per spacing of the run, each nearest an even share of it', () => {
    const kept = [
      ...spreadHeads(
        along,
        along.map(() => true),
        490,
        100,
      ),
    ]
    expect(kept).toEqual([6, 18, 31, 43])
  })

  test('a run shorter than the spacing keeps one head, at its middle', () => {
    expect([
      ...spreadHeads(
        along,
        along.map(() => true),
        490,
        1000,
      ),
    ]).toEqual([24])
  })

  test('a head that does not fit is passed over for the nearest that does', () => {
    const drawable = along.map((_, i) => i !== 24 && i !== 25)
    expect([...spreadHeads(along, drawable, 490, 1000)]).toEqual([23])
  })
})

describe('heads along a run of joints', () => {
  const NODES = 20
  const graph = {
    name: 'run',
    nodes: Array.from({ length: NODES }, (_, i) => ({
      id: `N${i}`,
      name: `N${i}`,
      length: 100,
      depth: 1,
    })),
    edges: [...chain(NODES), { from: 'N9', to: 'X' }],
  }
  const nodePositions: Record<string, { x: number; y: number }[]> =
    Object.fromEntries(
      graph.nodes.map((n, i) => [
        n.id,
        [
          { x: i * 10, y: 0 },
          { x: i * 10 + 10, y: 0 },
        ],
      ]),
    )
  const withBranch = {
    ...graph,
    nodes: [...graph.nodes, { id: 'X', name: 'X', length: 100, depth: 1 }],
  }
  const build = (g: typeof graph) =>
    buildGeometry({
      axis: { scaleX: 4, scaleY: 4 },
      nodePositions: {
        ...nodePositions,
        X: [
          { x: 100, y: 30 },
          { x: 110, y: 60 },
        ],
      },
      graph: g,
      nodeById: new Map(g.nodes.map(n => [n.id, n])),
      colorScheme: 'uniform',
      contigThickness: 6,
      connectorThickness: 2,
      drawPaths: false,
    })

  test(`a run keeps one head per ${LINK_HEAD_SPACING_PX} px, never one at every joint`, () => {
    const { arrows, arrowRuns } = build({
      ...graph,
      edges: chain(NODES),
    })
    expect(arrows).toHaveLength(Math.floor((18 * 40) / LINK_HEAD_SPACING_PX))
    const xs = arrows.map(a => a.x * 4).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(LINK_HEAD_SPACING_PX / 2)
    }
    expect(arrowRuns.size).toBe(arrows.length)
  })

  test('a link off a node with a second link at that end keeps its head, and the runs either side keep theirs', () => {
    const { arrowRuns } = build(withBranch)
    const headed = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i).some(ei =>
        arrowRuns.has(ei),
      )
    expect(arrowRuns.has(NODES - 1)).toBe(true)
    expect(headed(0, 8)).toBe(true)
    expect(headed(9, NODES - 2)).toBe(true)
  })
})
