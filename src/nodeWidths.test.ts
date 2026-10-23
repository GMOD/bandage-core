import {
  frequencyKey,
  haplotypeCount,
  nodeInk,
  nodeWidthPx,
  walkLaneWidthPx,
  widthNorm,
  withFrequencies,
} from './nodeWidths'

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
