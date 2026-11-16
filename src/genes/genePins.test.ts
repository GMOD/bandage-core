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

// the reference steps `b` backwards and a stranded layout draws it as its id
// reads it, so the reference's first 10 bp of it are the line's last
test('an exon on a node the reference steps against its id lands at the end the reference reads it from', () => {
  const graph: Graph = {
    name: 'g',
    nodes: [
      {
        ...anchored('b+', 100, 40),
        stable: { refName: 'chr1', start: 100, rank: 0, strand: '-' },
      },
    ],
    edges: [],
  }
  const gene = {
    name: 'G',
    refName: 'chr1',
    start: 100,
    end: 110,
    strand: 1,
    exons: [{ start: 100, end: 110 }],
  }
  const rightToLeft = {
    'b+': [
      { x: 40, y: 0 },
      { x: 0, y: 0 },
    ],
  }
  const xs = (stranded: boolean) =>
    genePins(graph, [gene], rightToLeft, stranded)[0]!
      .exonsByNode[0]!.stretches[0]!.map(p => p.x)
      .sort((a, b) => a - b)
  expect(xs(true)).toEqual([0, 10])
  expect(genePins(graph, [gene], rightToLeft, true)[0]!.at).toEqual({
    x: 5,
    y: 0,
  })
  const leftToRight = { 'b+': rightToLeft['b+'].toReversed() }
  expect(
    genePins(graph, [gene], leftToRight)[0]!.exonsByNode[0]!.stretches[0]!.map(
      p => p.x,
    ),
  ).toEqual([0, 10])
})
