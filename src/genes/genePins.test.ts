import { genePins } from './genePins'

import type { Graph } from '../types'

const anchored = (id: string, start: number, length: number) => ({
  id,
  name: id,
  length,
  depth: 1,
  stable: { refName: 'chr1', start, rank: 0, strand: '+' as const },
})

// an rGFA `S` line of `*` with no LN tag comes in as a 0 bp node
test('a gene pinned on a 0 bp node lands on it', () => {
  const graph: Graph = {
    name: 'g',
    nodes: [anchored('b+', 0, 40), anchored('a+', 50, 0)],
    edges: [],
  }
  const [pin] = genePins(
    graph,
    [{ name: 'G', refName: 'chr1', start: 40, end: 60, strand: 1, exons: [] }],
    {
      'b+': [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      'a+': [
        { x: 50, y: 0 },
        { x: 51, y: 0 },
      ],
    },
  )
  expect(pin!.at).toEqual({ x: 50, y: 0 })
})
