import { namedGenePins } from './geneNames'
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

const HAPLOTYPE = 'HG00097#1#CM0001.1'
const offReference = (id: string, start: number, length: number) => ({
  ...anchored(id, start, length),
  stable: { refName: HAPLOTYPE, start, rank: 1, strand: '+' as const },
})
const gene = (name: string, refName: string, start: number, end: number) => ({
  name,
  refName,
  start,
  end,
  strand: 1,
  exons: [{ start, end }],
})
const along = (ids: string[], shift: number) =>
  Object.fromEntries(
    ids.map((id, i) => [
      id,
      [
        { x: shift + i * 100, y: 0 },
        { x: shift + (i + 1) * 100, y: 0 },
      ],
    ]),
  )

test('pins recomputed for a dragged node read no walk step again', () => {
  let stepReads = 0
  const counted = (name: string, nodeIds: string[], start: number) => ({
    name,
    start,
    get nodeIds() {
      stepReads += nodeIds.length
      return nodeIds
    },
  })
  const graph: Graph = {
    name: 'g',
    nodes: [
      anchored('r1', 0, 1000),
      anchored('r2', 1000, 1000),
      offReference('h1', 5000, 100),
    ],
    edges: [],
    paths: [
      counted('chr1', ['r1', 'r2'], 0),
      counted(HAPLOTYPE, ['r1', 'h1', 'r2'], 4500),
    ],
  }
  const genes = [
    gene('REF', 'chr1', 200, 1800),
    gene('OWN', HAPLOTYPE, 5050, 7050),
  ]
  const summary = (shift: number) =>
    genePins(graph, genes, along(['r1', 'r2', 'h1'], shift)).map(p => [
      p.gene.name,
      p.at.x,
      p.walks,
      p.covered,
    ])
  expect(summary(0)).toEqual([
    ['REF', 100, 2, 1],
    ['OWN', 300, 1, 0.775],
  ])
  const firstReads = stepReads
  expect(firstReads).toBeGreaterThan(0)
  expect(summary(30)).toEqual([
    ['REF', 130, 2, 1],
    ['OWN', 330, 1, 0.775],
  ])
  expect(summary(60)[0]![1]).toBe(160)
  expect(stepReads).toBe(firstReads)
})

// HG00097#1 at chr1:103,540,000-103,780,000: two records of one contig with
// 49 kb between them that the cut does not hold
test("a haplotype's gene is held only where its walk's records lie, not between them", () => {
  const contig = 'HG00097#1#CM094060.1'
  const own = (id: string, start: number, length: number) => ({
    ...anchored(id, start, length),
    stable: { refName: contig, start, rank: 1, strand: '+' as const },
  })
  const graph: Graph = {
    name: 'g',
    nodes: [own('h1', 104_045_549, 72_151), own('h2', 104_166_751, 48_458)],
    edges: [],
    paths: [
      { name: contig, nodeIds: ['h1'], start: 104_045_549 },
      { name: contig, nodeIds: ['h2'], start: 104_166_751 },
    ],
  }
  const [pin] = genePins(
    graph,
    [gene('SPANS', contig, 104_117_100, 104_167_000)],
    along(['h1', 'h2'], 0),
  )
  expect(pin!.covered * 49_900).toBeCloseTo(849)
  expect(pin!.walks).toBe(1)
})

// tubeMap/coarsen builds a route as a rank 1 node on the reference's refName
test('a refName is the reference where any of its nodes is rank 0, whichever comes first', () => {
  const graph: Graph = {
    name: 'g',
    nodes: [
      {
        ...anchored('route', 400, 50),
        stable: { refName: 'chr1', start: 400, rank: 1, strand: '+' as const },
      },
      anchored('r1', 0, 1000),
      offReference('a', 5000, 100),
    ],
    edges: [],
    paths: [
      { name: 'chr1', nodeIds: ['r1'], start: 0 },
      { name: HAPLOTYPE, nodeIds: ['r1', 'a'], start: 4000 },
    ],
  }
  const pins = genePins(
    graph,
    [gene('REFGENE', 'chr1', 100, 900), gene('REFGENE', HAPLOTYPE, 5010, 5090)],
    along(['route', 'r1', 'a'], 0),
  )
  expect(pins.map(p => p.onReference)).toEqual([true, false])
  expect(namedGenePins(pins, [HAPLOTYPE]).map(n => n.name)).toEqual([
    'REFGENE',
    'REFGENE · HG00097#1',
  ])
})
