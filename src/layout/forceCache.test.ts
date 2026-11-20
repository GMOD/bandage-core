import { expect, test, vi } from 'vitest'

import { ASSUMED_FIT } from './fitAssumptions'
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
  const engine = ((request: { graph: { nodes: { id: string }[] } }) => {
    calls++
    return Promise.resolve({
      result: {
        nodePositions: Object.fromEntries(
          request.graph.nodes.map(n => [n.id, [{ x: 0, y: 0 }]]),
        ),
      },
      duration: 1,
    })
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

test('a stress layout for another fit runs again, and one for no fit is the assumed fit', async () => {
  const cache = createForceLayoutCache()
  const engine = countingEngine()
  const stress: EngineSettings = { ...SETTINGS, engine: 'stress' }
  const narrow = { width: 900, height: 280 }
  const assumed = await cache.layout(GRAPH, stress, engine)
  await cache.layout(GRAPH, stress, engine, ASSUMED_FIT)
  expect(engine.calls()).toBe(1)
  expect(cache.ready(GRAPH, stress, narrow)).toBeUndefined()
  const sized = await cache.layout(GRAPH, stress, engine, narrow)
  expect(engine.calls()).toBe(2)
  expect(cache.ready(GRAPH, stress, narrow)).toBe(sized.result)
  expect(cache.ready(GRAPH, stress)).toBe(assumed.result)
})

const runsAt = async (
  settings: EngineSettings,
  fits: { width: number; height: number }[],
) => {
  const cache = createForceLayoutCache()
  const engine = countingEngine()
  for (const fit of fits) {
    await cache.layout(GRAPH, settings, engine, fit)
  }
  return engine.calls()
}

test('a layout runs again only for a fit it reads: FMMM under a proportional spread none, compress the width, stress the width and height', async () => {
  const wide = { width: 1400, height: 900 }
  const short = { width: 1400, height: 500 }
  const narrow = { width: 1000, height: 500 }
  expect(await runsAt(SETTINGS, [wide, short, narrow])).toBe(1)
  const compress: EngineSettings = { ...SETTINGS, bubbleSpread: 'compress' }
  expect(await runsAt(compress, [wide, short])).toBe(1)
  expect(await runsAt(compress, [short, narrow])).toBe(2)
  const stress: EngineSettings = { ...SETTINGS, engine: 'stress' }
  expect(await runsAt(stress, [wide, short])).toBe(2)
  expect(await runsAt(stress, [short, narrow])).toBe(2)
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

test.each(['layout', 'ready'])(
  'a layout asked for again through %s outlasts one filed after it',
  async how => {
    const cache = createForceLayoutCache(2)
    const engine = countingEngine()
    const at = (quality: number) => ({ ...SETTINGS, quality })
    await cache.layout(GRAPH, at(0), engine)
    await cache.layout(GRAPH, at(1), engine)
    const again =
      how === 'layout'
        ? (await cache.layout(GRAPH, at(0), engine)).result
        : cache.ready(GRAPH, at(0))
    await cache.layout(GRAPH, at(2), engine)
    expect(engine.calls()).toBe(3)
    expect(cache.ready(GRAPH, at(0))).toBe(again)
    expect(cache.ready(GRAPH, at(1))).toBeUndefined()
  },
)

test('a run that throws leaves nothing behind', async () => {
  const cache = createForceLayoutCache()
  const failing = vi.fn<LayoutEngine>(() =>
    Promise.reject(new Error('no engine')),
  )
  await expect(cache.layout(GRAPH, SETTINGS, failing)).rejects.toThrow(
    'no engine',
  )
  expect(cache.ready(GRAPH, SETTINGS)).toBeUndefined()
  const engine = countingEngine()
  await cache.layout(GRAPH, SETTINGS, engine)
  expect(engine.calls()).toBe(1)
})

test('an evicted run that throws late keeps the run that replaced it', async () => {
  const cache = createForceLayoutCache(1)
  let fail!: (e: Error) => void
  const slow = () =>
    new Promise((_, reject) => {
      fail = reject
    })
  const stale = cache.layout(GRAPH, SETTINGS, slow as unknown as LayoutEngine)
  const engine = countingEngine()
  await cache.layout(GRAPH, { ...SETTINGS, quality: 4 }, engine)
  const { result } = await cache.layout(GRAPH, SETTINGS, engine)
  fail(new Error('late'))
  await expect(stale).rejects.toThrow('late')
  expect(cache.ready(GRAPH, SETTINGS)).toBe(result)
})

test('a re-anchored graph keeps the layouts of the graph it came from', async () => {
  const cache = createForceLayoutCache()
  const engine = countingEngine()
  const { result } = await cache.layout(GRAPH, SETTINGS, engine)
  const reanchored = { ...GRAPH }
  cache.inherit(GRAPH, reanchored)
  expect(cache.ready(reanchored, SETTINGS)).toBe(result)
})
