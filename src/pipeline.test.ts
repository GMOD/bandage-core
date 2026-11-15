import { readFileSync } from 'node:fs'

import { isBackbone } from './anchoredNodes'
import { layoutScaling } from './layout/drawnScale'
import { layoutEngine } from './layoutEngines'
import {
  engineKey,
  engineRequest,
  engineSettingsOf,
  fitTransform,
  forceLayout,
  loadGraph,
} from './pipeline'

import type { Graph } from './types'

test('padTop moves the drawing down by the room it adds', () => {
  const bounds = { minX: 0, minY: 0, w: 100, h: 100 }
  const plain = fitTransform(bounds, 280, 280, false)!
  const padded = fitTransform(bounds, 280, 302, false, { padTop: 62 })!
  expect(padded.scale).toBe(plain.scale)
  expect(padded.translateY).toBe(plain.translateY + 22)
})

const graph: Graph = {
  name: 'pair',
  nodes: [
    { id: 'a', name: 'a', length: 1000, depth: 1 },
    { id: 'b', name: 'b', length: 1000, depth: 1 },
  ],
  edges: [{ from: 'a', to: 'b' }],
}
const engine = {
  quality: 2,
  linearLayout: false,
  bubbleSpread: 'auto' as const,
}

test('spacing and component separation scale what the engine is handed', () => {
  const plain = engineRequest(graph, layoutScaling(graph), engine).options
  const spaced = engineRequest(graph, layoutScaling(graph), {
    ...engine,
    spacing: 3,
    componentSeparation: 2,
  }).options
  expect(spaced.edgeLength).toBe((plain.edgeLength as number) * 3)
  expect(spaced.componentSeparation).toBe(
    (plain.componentSeparation as number) * 2,
  )
})

test('a layout at another spacing is cached apart', () => {
  expect(engineKey(graph, { ...engine, spacing: 2 })).not.toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, { ...engine, spacing: 1 })).toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, { ...engine, componentSeparation: 2 })).not.toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, { ...engine, showDeletionEdges: false })).not.toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, { ...engine, showDeletionEdges: true })).toBe(
    engineKey(graph, engine),
  )
})

test('a force layout draws its nodes start to end', async () => {
  const { result } = await forceLayout(graph, engine, () =>
    Promise.resolve({
      result: {
        nodePositions: {
          a: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          b: [
            { x: 20, y: 0 },
            { x: 30, y: 0 },
          ],
        },
      },
      duration: 0,
    }),
  )
  expect(result.stranded).toBe(true)
})

// FMMM drew the seeded backbone in waves, its coarsest level buckling a chain
// seeded at a quarter of the length it balances at; stress reads seeds as
// positions
test('an anchored graph seeds FMMM four times as far out as stress', () => {
  const anchored: Graph = {
    name: 'backbone',
    nodes: [0, 1, 2].map(i => ({
      id: `r${i}`,
      name: `r${i}`,
      length: 1000,
      depth: 1,
      stable: { refName: 'chr1', start: i * 1000, rank: 0 },
    })),
    edges: [
      { from: 'r0', to: 'r1' },
      { from: 'r1', to: 'r2' },
    ],
  }
  const seeds = (e: 'fmmm' | 'stress') =>
    engineRequest(anchored, layoutScaling(anchored), {
      ...engine,
      engine: e,
    }).graph.nodes.map(n => [n.x, n.y])
  const stress = seeds('stress')
  expect(stress.some(([x]) => x! > 0)).toBe(true)
  expect(seeds('fmmm')).toEqual(stress.map(([x, y]) => [x! * 4, y! * 4]))
})

// Seeded at drawn length, FMMM bent the 571 bp gap's reference into waves
// 7% of its length deep
test('FMMM draws a seeded reference close to straight', async () => {
  const gap571 = loadGraph(
    readFileSync('test_data/hprc_gap571.gfa', 'utf8'),
    'gap571',
    { referencePath: 'GRCh38' },
  )
  const { result } = await forceLayout(
    gap571,
    engineSettingsOf({ engine: 'fmmm' }),
    layoutEngine,
  )
  const line = gap571.nodes
    .filter(isBackbone)
    .sort((a, b) => a.stable.start - b.stable.start)
    .flatMap(node => result.nodePositions[node.id] ?? [])
  const first = line[0]!
  const last = line.at(-1)!
  const length = Math.hypot(last.x - first.x, last.y - first.y)
  let deepest = 0
  for (const p of line) {
    deepest = Math.max(
      deepest,
      Math.abs(
        (last.x - first.x) * (first.y - p.y) -
          (first.x - p.x) * (last.y - first.y),
      ) / length,
    )
  }
  expect(deepest / length).toBeLessThan(0.03)
})
