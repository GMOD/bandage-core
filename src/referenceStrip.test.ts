import { packAbgr } from '@jbrowse/core/util/colorBits'

import {
  nodeAnchor,
  referenceStripBlocks,
  stripBlockAt,
  stripOverhang,
  stripPixels,
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
  expect(blocks[0]!.colors).toEqual(['rgba(172,217,38,1)'])
  expect(new Set(blocks.map(b => b.colors[0])).size).toBe(3)
})

test('under lifted walks a block is a row per walk in its lane, pale where the walk skips it', () => {
  const ref = packAbgr(10, 20, 30, 255)
  const hap = packAbgr(40, 50, 60, 255)
  const blocks = referenceStripBlocks(graph, {
    colorScheme: 'uniform',
    walks: [
      { colors: new Map(['a', 'b', 'c'].map(id => [id, ref])) },
      { colors: new Map(['a', 'x', 'c'].map(id => [id, hap])) },
    ],
  })
  const pale = expect.stringMatching(/^rgba\(160,160,160,0\.18/)
  expect(blocks.map(b => b.colors)).toEqual([
    ['rgba(10,20,30,1)', 'rgba(40,50,60,1)'],
    ['rgba(10,20,30,1)', pale],
    ['rgba(10,20,30,1)', 'rgba(40,50,60,1)'],
  ])
  expect(blocks.map(b => b.faded)).toEqual([false, true, false])
})

test('blocks fill whole pixels, none shared, so neighbours leave no seam', () => {
  const blocks = [
    { node: 'a', bp0: 0, bp1: 10.3, colors: ['a'], faded: false },
    { node: 's', bp0: 10.3, bp1: 10.4, colors: ['s'], faded: true },
    { node: 't', bp0: 10.4, bp1: 10.5, colors: ['t'], faded: true },
    { node: 'b', bp0: 10.5, bp1: 20, colors: ['b'], faded: false },
  ]
  const px = stripPixels(blocks, { scale: 1, translateX: 0 }, 100, 1)
  // s takes its pixel from b, and t, sharing it, is not drawn
  expect(px).toEqual([
    { colors: ['a'], x0: 0, x1: 10 },
    { colors: ['s'], x0: 10, x1: 11 },
    { colors: ['b'], x0: 11, x1: 20 },
  ])
  // at dpr 2, edges land on half css px
  expect(
    stripPixels(blocks.slice(0, 1), { scale: 1, translateX: 0 }, 100, 2),
  ).toEqual([{ colors: ['a'], x0: 0, x1: 10.5 }])
  // reversed, b is leftmost
  expect(
    stripPixels(blocks, { scale: -1, translateX: 20 }, 100, 1).map(
      p => p.colors[0],
    ),
  ).toEqual(['b', 't', 'a'])
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
