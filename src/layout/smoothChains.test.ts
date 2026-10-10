import { expect, test } from 'vitest'

import { smoothChain } from './smoothChains'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { engineSettingsOf, forceLayout } from '../pipeline'

import type { LayoutEngine } from '../pipeline'
import type { NodeSegment } from '../types'

const turns = (line: NodeSegment[]) =>
  line.slice(1, -1).map((b, k) => {
    const a = line[k]!
    const c = line[k + 2]!
    const t = Math.abs(
      Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x),
    )
    return ((t > Math.PI ? 2 * Math.PI - t : t) * 180) / Math.PI
  })

test('a straight chain keeps its points', () => {
  const line = [0, 1, 2, 3].map(x => ({ x, y: 0 }))
  expect(smoothChain(line)).toEqual(line)
})

test('a sharp corner becomes a curve through the points placed', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  const smooth = smoothChain(line)
  for (const p of line) {
    expect(smooth).toContainEqual(p)
  }
  expect(Math.max(...turns(line))).toBe(90)
  expect(Math.max(...turns(smooth))).toBeLessThan(20)
})

test('a force layout draws what its engine bent as a curve', async () => {
  const graph = convertGFAToGraph(parseGFA('S\t1\t*\tLN:i:5000'))
  const corner = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]
  const engine: LayoutEngine = async () => ({
    result: { nodePositions: { '1+': corner } },
    duration: 0,
  })
  const { result } = await forceLayout(graph, engineSettingsOf(), engine)
  expect(Math.max(...turns(result.nodePositions['1+']!))).toBeLessThan(20)
})
