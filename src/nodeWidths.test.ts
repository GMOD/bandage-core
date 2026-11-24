import {
  depthKey,
  frequencyKey,
  haplotypeCount,
  nodeInk,
  nodeWidthPx,
  walkLaneWidthPx,
  widthNorm,
  withFrequencies,
} from './nodeWidths'
import { loadGraph } from './pipeline'
import { buildGeometry } from './renderer/GeometryBuilder'
import { foldThreads } from './threadFold'

import type { Graph, GraphNode } from './types'

const node: GraphNode = { id: 'a+', name: 'a', length: 10, depth: 1 }
const byId = new Map([[node.id, node]])

test('a node with no lifted walks reaches half its width', () => {
  const ink = nodeInk(undefined, byId, 6, 'uniform')
  expect(ink.halfWidthPx('a+')).toBe(3)
  expect(ink.maxHalfWidthPx).toBe(3)
})

test('lifted walks reach as far as the lanes are drawn', () => {
  // three 4 px lanes where the node is 6 px wide
  expect(walkLaneWidthPx(6, 3)).toBe(4)
  const ink = nodeInk(undefined, byId, 6, 'uniform', 3)
  expect(ink.halfWidthPx('a+')).toBe(6)
  expect(ink.maxHalfWidthPx).toBe(6)
})

test('lanes that fit inside the node leave its width as the reach', () => {
  const ink = nodeInk(undefined, byId, 12, 'uniform', 2)
  expect(ink.halfWidthPx('a+')).toBe(6)
})

function graphOf(nodes: GraphNode[], walks: string[]): Graph {
  return {
    name: 'g',
    nodes,
    edges: [],
    paths: walks.map(name => ({ name, nodeIds: [] })),
  }
}

test('a node every haplotype passes once draws full width by frequency', () => {
  const nodes = [
    { id: 'a+', name: 'a', length: 10, depth: 4 },
    { id: 'b+', name: 'b', length: 10, depth: 2 },
    { id: 'c+', name: 'c', length: 10, depth: 8 },
  ]
  // two records of HG002#1 are one haplotype
  const g = graphOf(nodes, [
    'HG002#1#a',
    'HG002#1#b',
    'HG002#2#a',
    'GRCh38#0#chr1',
    'CHM13#0#chr1',
  ])
  expect(haplotypeCount(g)).toBe(4)
  const ink = nodeInk(g, new Map(nodes.map(n => [n.id, n])), 6, 'frequency')
  expect(ink.halfWidthPx('a+')).toBe(3)
  expect(ink.halfWidthPx('b+')).toBe(1.5)
  expect(ink.halfWidthPx('c+')).toBe(6)
})

test('by frequency a thread fold shares each node among its haplotypes, not its threads', () => {
  const toy = loadGraph(
    [
      'S\ta\t*\tLN:i:1000',
      'S\ts\t*\tLN:i:1',
      'S\tt\t*\tLN:i:1',
      'S\tb\t*\tLN:i:2000',
      'S\tc\t*\tLN:i:1000',
      'L\ta\t+\ts\t+\t0M',
      'L\ta\t+\tt\t+\t0M',
      'L\ts\t+\tb\t+\t0M',
      'L\tt\t+\tb\t+\t0M',
      'L\tb\t+\tc\t+\t0M',
      'L\ts\t+\tc\t+\t0M',
      'L\tt\t+\tc\t+\t0M',
      'W\tref\t0\tchr\t0\t4001\t>a>s>b>c',
      'W\th1\t1\tchr\t0\t4001\t>a>t>b>c',
      'W\th2\t1\tchr\t0\t2001\t>a>s>c',
      'W\th3\t1\tchr\t0\t2001\t>a>t>c',
    ].join('\n'),
    'toy',
    { referencePath: 'ref#0#chr' },
  )
  const fold = foldThreads(toy, 500)
  expect(fold.graph.paths).toHaveLength(3)
  expect(haplotypeCount(fold.graph)).toBe(haplotypeCount(toy))
  const ink = (g: Graph) =>
    nodeInk(g, new Map(g.nodes.map(n => [n.id, n])), 6, 'frequency')
  const aOf = (g: Graph) => g.nodes.find(n => n.name === 'a')!.id
  expect(ink(fold.graph).halfWidthPx(aOf(fold.graph))).toBe(
    ink(toy).halfWidthPx(aOf(toy)),
  )
})

test('an AF tag wins over the walks, and a rare allele keeps a hairline', () => {
  const g = graphOf([], ['x#1#c', 'y#1#c'])
  const n = widthNorm(g, 'frequency')
  expect(
    nodeWidthPx({ ...node, depth: 2, frequency: 0.25 }, 6, 'frequency', n),
  ).toBe(1.5)
  expect(
    nodeWidthPx({ ...node, frequency: 0.001 }, 6, 'frequency', n),
  ).toBeCloseTo(0.3)
})

test('with no walks and no AF tag a node draws at the base width', () => {
  expect(
    nodeWidthPx(
      node,
      6,
      'frequency',
      widthNorm(graphOf([node], []), 'frequency'),
    ),
  ).toBe(6)
})

test('a frequency table sets the segments it names', () => {
  const g = withFrequencies(
    graphOf([node, { ...node, id: 'b+', name: 'b' }], []),
    { b: 0.5 },
  )
  expect(g.nodes.map(n => n.frequency)).toEqual([undefined, 0.5])
})

test('the frequency key shows the widths nodes draw at', () => {
  const key = frequencyKey(6)
  expect(key.map(k => k.label)).toEqual(['100%', '50%', '10%'])
  expect(key.map(k => k.widthPx)).toEqual([6, 3, expect.closeTo(0.6)])
})

// GSTM1's key read 9, 6 and 1 walks, its middle bar the mean depth, which no
// node need have
test('the depth key shows the thickest and thinnest nodes at the widths they draw', () => {
  const nodes = [
    { id: 'r+', name: 'r', length: 900, depth: 9 },
    { id: 'g+', name: 'g', length: 300, depth: 6 },
    { id: 'p+', name: 'p', length: 5, depth: 1 },
  ]
  const graph = graphOf(nodes, [])
  const batch = buildGeometry({
    nodePositions: Object.fromEntries(
      nodes.map((n, i) => [
        n.id,
        [
          { x: i * 20, y: 0 },
          { x: i * 20 + 10, y: 0 },
        ],
      ]),
    ),
    graph,
    nodeById: new Map(nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'depth',
    axis: { scaleX: 1, scaleY: 1 },
  })
  const drawnPx = (id: string) =>
    batch.nodeStrokes[batch.nodeStrokeRuns.get(id)!.start]!.thickness * 2
  expect(depthKey(graph, 6)).toEqual([
    { depth: 9, widthPx: drawnPx('r+') },
    { depth: 1, widthPx: drawnPx('p+') },
  ])
  expect(depthKey(graphOf([nodes[0]!], []), 6)).toEqual([
    { depth: 9, widthPx: 6 },
  ])
  expect(depthKey(graph, 6, new Set(['p+']))).toEqual([
    { depth: 1, widthPx: drawnPx('p+') },
  ])
  expect(depthKey(graph, 6, new Set())).toEqual([])
})

// The layout clears alleles off the reference by the widths depth draws it
// at (layout/referenceClearance.ts), so walks must draw no node wider
test('a node by walks is never wider than by depth, so the clearance the layout leaves holds', () => {
  for (const depths of [
    [9, 9, 1, 8],
    [72, 9, 1, 3],
    [1, 1, 1, 1],
    [2, 30, 30, 1],
  ]) {
    const graph = {
      name: 'g',
      nodes: depths.map((depth, i) => ({
        id: `${i}+`,
        name: `${i}`,
        length: 100 * (i + 1),
        depth,
      })),
      edges: [],
      paths: [{ name: 'w#1#c', nodeIds: ['0+'] }],
    }
    const walks = widthNorm(graph, 'walks')
    const depth = widthNorm(graph, 'depth')
    for (const each of graph.nodes) {
      expect(nodeWidthPx(each, 6, 'walks', walks)).toBeLessThanOrEqual(
        nodeWidthPx(each, 6, 'depth', depth) + 1e-9,
      )
    }
  }
})
