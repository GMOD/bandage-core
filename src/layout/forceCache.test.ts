import { expect, test, vi } from 'vitest'

import { createForceLayoutCache } from './forceCache'

import type { EngineSettings, LayoutEngine } from '../pipeline'
import type { Graph } from '../types'

const GRAPH = {
  name: 'g',
  nodes: [
    { id: 'a+', name: 'a', length: 10, depth: 1 },
    { id: 'b+', name: 'b', length: 10, depth: 1 },
  ],
  edges: [{ from: 'a+', to: 'b+' }],
} as unknown as Graph

const SETTINGS: EngineSettings = {
  quality: 2,
  linearLayout: false,
  bubbleSpread: 'auto',
}

function countingEngine(): LayoutEngine & { calls: () => number } {
  let calls = 0
  const engine = (async (request: { graph: { nodes: { id: string }[] } }) => {
    calls++
    return {
      result: {
        nodePositions: Object.fromEntries(
          request.graph.nodes.map(n => [n.id, [{ x: 0, y: 0 }]]),
        ),
      },
      duration: 1,
    }
  }) as unknown as LayoutEngine & { calls: () => number }
  engine.calls = () => calls
  return engine
}

test('one run serves every caller of the same settings', async () => {
  const cache = createForceLayoutCache()
  const engine = countingEngine()
  const [first, second] = await Promise.all([
    cache.layout(GRAPH, SETTINGS, engine),
    cache.layout(GRAPH, SETTINGS, engine),
  ])
  expect(engine.calls()).toBe(1)
  expect(second.result).toBe(first.result)
  expect(cache.ready(GRAPH, SETTINGS)).toBe(first.result)
  await cache.layout(GRAPH, SETTINGS, engine)
  expect(engine.calls()).toBe(1)
})

test('a layout is not ready until it lands, and other settings run again', async () => {
  const cache = createForceLayoutCache()
  const engine = countingEngine()
  const run = cache.layout(GRAPH, SETTINGS, engine)
  expect(cache.ready(GRAPH, SETTINGS)).toBeUndefined()
  await run
  await cache.layout(GRAPH, { ...SETTINGS, quality: 4 }, engine)
  expect(engine.calls()).toBe(2)
})

test('the oldest goes once the cache is full', async () => {
  const cache = createForceLayoutCache(2)
  const engine = countingEngine()
  for (const quality of [0, 1, 2]) {
    await cache.layout(GRAPH, { ...SETTINGS, quality }, engine)
  }
  expect(cache.ready(GRAPH, { ...SETTINGS, quality: 0 })).toBeUndefined()
  expect(cache.ready(GRAPH, { ...SETTINGS, quality: 2 })).toBeDefined()
})

test('a run that throws leaves nothing behind', async () => {
  const cache = createForceLayoutCache()
  const failing = vi.fn(() => Promise.reject(new Error('no engine')))
  await expect(
    cache.layout(GRAPH, SETTINGS, failing as unknown as LayoutEngine),
  ).rejects.toThrow('no engine')
  expect(cache.ready(GRAPH, SETTINGS)).toBeUndefined()
  const engine = countingEngine()
  await cache.layout(GRAPH, SETTINGS, engine)
  expect(engine.calls()).toBe(1)
})

test('a re-anchored graph keeps the layouts of the graph it came from', async () => {
  const cache = createForceLayoutCache()
  const engine = countingEngine()
  const { result } = await cache.layout(GRAPH, SETTINGS, engine)
  const reanchored = { ...GRAPH }
  cache.inherit(GRAPH, reanchored)
  expect(cache.ready(reanchored, SETTINGS)).toBe(result)
})
