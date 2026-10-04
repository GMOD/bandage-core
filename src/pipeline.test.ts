import { layoutScaling } from './layout/drawnScale'
import { engineKey, engineRequest, fitTransform, forceLayout } from './pipeline'

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
