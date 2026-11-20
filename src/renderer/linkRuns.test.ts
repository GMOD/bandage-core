import { LINK_HEAD_SPACING_PX, buildGeometry } from './GeometryBuilder'
import { directedRuns, spreadHeads } from './linkRuns'

import type { GraphEdge } from '../types'
import type { BuildOptions } from './GeometryBuilder'

// every export still runs as written, and its calls are counted
vi.mock(import('./linkRuns'), { spy: true })

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

describe('the heads spread along runs, kept from one build to the next', () => {
  const NODES = 20
  const walked = (i: number) => i >= 5 && i < 12
  // a chain whose every joint could hold a head, a stretch of it on two walks
  function chainOptions(): BuildOptions {
    const nodes = Array.from({ length: NODES }, (_, i) => ({
      id: `N${i}`,
      name: `N${i}`,
      length: 100,
      depth: 1 + (i % 4),
    }))
    const graph = {
      name: 'run',
      nodes,
      edges: chain(NODES).map((link, i) =>
        walked(i) ? { ...link, pathIds: ['p', 'q'] } : link,
      ),
      paths: ['p', 'q'].map(name => ({
        name,
        nodeIds: nodes.flatMap((n, i) => (walked(i) || i === 12 ? [n.id] : [])),
      })),
    }
    return {
      axis: { scaleX: 4, scaleY: 4 },
      nodePositions: Object.fromEntries(
        nodes.map((n, i) => [
          n.id,
          [
            { x: i * 10, y: 0 },
            { x: i * 10 + 10, y: 0 },
          ],
        ]),
      ),
      graph,
      nodeById: new Map(nodes.map(n => [n.id, n])),
      colorScheme: 'uniform',
      contigThickness: 6,
      connectorThickness: 2,
      drawPaths: false,
      smallSites: 'nodes',
    }
  }
  // the same build with nothing any earlier build could have kept
  const uncached = (options: BuildOptions) => {
    const graph = structuredClone(options.graph)
    return buildGeometry({
      ...options,
      graph,
      nodePositions: structuredClone(options.nodePositions),
      nodeById: new Map(graph.nodes.map(n => [n.id, n])),
      deletions: options.deletions && new Map(options.deletions),
      hiddenEdges: options.hiddenEdges && new Set(options.hiddenEdges),
    })
  }
  const spreadsIn = (build: () => unknown) => {
    const before = vi.mocked(directedRuns).mock.calls.length
    build()
    return vi.mocked(directedRuns).mock.calls.length - before
  }
  const window = (minX: number, maxX: number) => ({
    viewportBounds: { minX, maxX, minY: -50, maxY: 50 },
  })

  test('a build that differs only in its viewport does not spread them again, and draws the heads of a build that does', () => {
    const options = chainOptions()
    const whole = buildGeometry(options)
    expect(whole.arrows.length).toBeGreaterThan(2)
    for (const view of [window(0, 60), window(40, 130), window(-500, -400)]) {
      const panned = { ...options, ...view }
      expect(spreadsIn(() => buildGeometry(panned))).toBe(0)
      expect(buildGeometry(panned)).toEqual(uncached(panned))
    }
    expect(spreadsIn(() => buildGeometry(options))).toBe(0)
    expect(buildGeometry(options)).toEqual(whole)
  })

  test('a build that differs only in what it fades does not spread them again', () => {
    const options = chainOptions()
    buildGeometry(options)
    const focus = {
      highlight: {
        walks: [],
        nodeIds: new Set(['N3', 'N4']),
        edgeIndexes: new Set([3]),
        names: new Set<string>(),
      },
    }
    const focused = { ...options, ...focus }
    expect(spreadsIn(() => buildGeometry(focused))).toBe(0)
    expect(buildGeometry(focused)).toEqual(uncached(focused))
  })

  test.each<[string, (options: BuildOptions) => Partial<BuildOptions>]>([
    [
      'the graph',
      o => ({ graph: { ...o.graph, edges: o.graph.edges.toSpliced(9, 1) } }),
    ],
    ['the nodes by id', o => ({ nodeById: new Map(o.nodeById) })],
    [
      'the node positions',
      o => ({
        nodePositions: {
          ...o.nodePositions,
          N9: [
            { x: 90, y: 40 },
            { x: 100, y: 40 },
          ],
        },
      }),
    ],
    [
      'positions moved in place, with the version',
      o => {
        o.nodePositions.N9 = [
          { x: 90, y: 40 },
          { x: 100, y: 40 },
        ]
        return { version: 1 }
      },
    ],
    ['the x scale', () => ({ axis: { scaleX: 6, scaleY: 4 } })],
    ['the y scale', () => ({ axis: { scaleX: 4, scaleY: 6 } })],
    ['strands naming the ends links join', () => ({ stranded: true })],
    ['the skips', () => ({ deletions: new Map([[9, []]]) })],
    ['the hidden links', () => ({ hiddenEdges: new Set([9]) })],
    ['what is folded', () => ({ smallSites: 'hidden' })],
    ['the link thickness', () => ({ connectorThickness: 8 })],
    ['the node thickness', () => ({ contigThickness: 24 })],
    ['node width by depth', () => ({ nodeWidth: 'depth' })],
    ['link width by walks', () => ({ edgeWidth: 'walks' })],
    ['path ribbons', () => ({ drawPaths: true })],
  ])(
    'a build that changes %s spreads them again, as a build with nothing kept does',
    (_, change) => {
      const options = chainOptions()
      buildGeometry(options)
      const changed = { ...options, ...change(options) }
      expect(spreadsIn(() => buildGeometry(changed))).toBe(1)
      expect(spreadsIn(() => buildGeometry(changed))).toBe(0)
      expect(buildGeometry(changed)).toEqual(uncached(changed))
    },
  )
})
