import {
  nodeAnchor,
  referenceStripBlocks,
  stripBlockAt,
  stripOverhang,
} from './referenceStrip'
import { computeReferenceRamp } from './renderer/GeometryBuilder'

import type { Graph, GraphNode } from './types'

function node(id: string, start: number, length: number, rank: number) {
  return {
    id,
    name: id,
    length,
    depth: 1,
    stable: { refName: 'chr1', start, rank },
  } satisfies GraphNode
}

// b and c are listed out of order, and x is an allele over b
const graph: Graph = {
  name: 'g',
  nodes: [
    node('a', 1000, 100, 0),
    node('c', 1150, 50, 0),
    node('b', 1100, 50, 0),
    node('x', 0, 40, 1),
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'a', to: 'x' },
    { from: 'x', to: 'c' },
  ],
}

test('the strip is the backbone in bp order, painted the hue of its node', () => {
  const ramp = computeReferenceRamp(graph, { start: 1000, end: 1200 })
  const blocks = referenceStripBlocks(graph, {
    colorScheme: 'reference-position',
    referenceRamp: ramp,
  })
  expect(blocks.map(b => [b.node, b.bp0, b.bp1])).toEqual([
    ['a', 1000, 1100],
    ['b', 1100, 1150],
    ['c', 1150, 1200],
  ])
  // a's midpoint is a quarter along the ramp: hue 75
  expect(blocks[0]!.color).toBe('rgba(172,217,38,1)')
  expect(new Set(blocks.map(b => b.color)).size).toBe(3)
})

test('off a lifted walk a block fades as its node does', () => {
  const blocks = referenceStripBlocks(graph, {
    colorScheme: 'uniform',
    walkNodes: new Set(['a', 'x', 'c']),
  })
  expect(blocks.map(b => b.color)).toEqual([
    'rgba(52,152,219,1)',
    expect.stringMatching(/^rgba\(52,152,219,0\.18/),
    'rgba(52,152,219,1)',
  ])
})

test('a block is hit where the linear view places its bp', () => {
  const blocks = referenceStripBlocks(graph, { colorScheme: 'uniform' })
  const frame = { scale: 0.5, translateX: -500 }
  expect(stripBlockAt(blocks, frame, 25, 4)).toBe('a')
  expect(stripBlockAt(blocks, frame, 60, 4)).toBe('b')
  expect(stripBlockAt(blocks, frame, 25, 40)).toBeUndefined()
  // reversed, the strip runs right to left
  const reversed = { scale: -0.5, translateX: 600 }
  expect(stripBlockAt(blocks, reversed, 75, 4)).toBe('a')
})

test('the overhang is the backbone drawn past each edge of the window', () => {
  const blocks = referenceStripBlocks(graph, { colorScheme: 'uniform' })
  // bp 1020 to 1180 across 80 px
  const frame = { scale: 0.5, translateX: -510 }
  expect(stripOverhang(blocks, frame, 80)).toEqual({ left: 20, right: 20 })
  expect(stripOverhang(blocks, { scale: 0.5, translateX: -500 }, 100)).toEqual({
    left: 0,
    right: 0,
  })
  // reversed, low bp is on the right
  const reversed = { scale: -0.5, translateX: 600 }
  expect(stripOverhang(blocks, reversed, 90)).toEqual({ left: 0, right: 20 })
})

test('a node is anchored at the middle of its polyline', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 5 },
  ]
  expect(nodeAnchor(points, p => ({ x: p.x * 2, y: p.y + 1 }))).toEqual({
    x: 20,
    y: 1,
  })
  expect(nodeAnchor(undefined, p => p)).toBeUndefined()
})
