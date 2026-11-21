import { genesOverNode, namedGenePins } from './geneNames'
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

// pggb's chrY at 9.3-9.65 Mb walks the TSPY array's copies over one loop of
// nodes anchored at the first: FAM197Y8 held 98% of its span on its own
// nodes, FAM197Y2-Y7 held 3 to 21 bp of 5.6 kb each and were named round the
// knot "FAM197Y5 · 0 of 5.6 kb"
test("a reference copy whose stretch the reference walks over an earlier copy's nodes keeps its exons and is named in that copy's name", () => {
  const graph: Graph = {
    name: 'g',
    nodes: [
      anchored('r1', 0, 1000),
      anchored('r2', 1000, 1000),
      anchored('u', 3000, 10),
    ],
    edges: [],
    paths: [{ name: 'chr1', nodeIds: ['r1', 'r2', 'r1', 'u', 'r2'], start: 0 }],
  }
  const pins = genePins(
    graph,
    [gene('FIRST', 'chr1', 0, 2000), gene('LATER', 'chr1', 2000, 4010)],
    along(['r1', 'r2', 'u'], 0),
  )
  expect(
    pins.map(p => [p.gene.name, p.anchored, p.exonsByNode.map(e => e.nodeId)]),
  ).toEqual([
    ['FIRST', 1, ['r1', 'r2']],
    ['LATER', 10 / 2010, ['u']],
  ])
  expect(pins.map(p => p.walkedOver && [...p.walkedOver])).toEqual([
    undefined,
    [
      ['r1', 1000],
      ['u', 10],
      ['r2', 1000],
    ],
  ])
  expect(namedGenePins(pins).map(n => n.name)).toEqual(['FIRST, LATER'])
  expect(['r1', 'u'].map(id => genesOverNode(pins, id))).toEqual([
    ['FIRST', 'LATER'],
    ['LATER'],
  ])
})

test('a reference copy with no node of its own is pinned on the node the reference walks most of it over', () => {
  const graph: Graph = {
    name: 'g',
    nodes: [anchored('r1', 0, 1000), anchored('r2', 1000, 3000)],
    edges: [],
    paths: [{ name: 'chr1', nodeIds: ['r1', 'r2', 'r1', 'r2'], start: 0 }],
  }
  const pins = genePins(
    graph,
    [
      gene('FIRST', 'chr1', 0, 4000),
      gene('LATER', 'chr1', 4500, 6000),
      gene('PAST', 'chr1', 9000, 9500),
    ],
    along(['r1', 'r2'], 0),
  )
  expect(
    pins.map(p => [
      p.gene.name,
      p.anchored,
      [...p.nodeIds],
      p.walkedOver && [...p.walkedOver],
    ]),
  ).toEqual([
    ['FIRST', 1, ['r1', 'r2'], undefined],
    [
      'LATER',
      0,
      [],
      [
        ['r1', 500],
        ['r2', 1000],
      ],
    ],
  ])
  expect(pins[1]!.at).toEqual({ x: 150, y: 0 })
  expect(genesOverNode(pins, 'r2')).toEqual(['FIRST', 'LATER'])
})

// HPRC's C4 with HG00128#1 and HG00133#1 lifted: their CAT genes named every
// gene again beside the reference's, on the SNPs along it, as
// "C4A · HG00128#1", and STK19, which RefSeq calls WHR1, once per haplotype
test("a lifted haplotype's copy along the reference's keeps no name, its copy on its own insertion is named, and a gene only haplotypes annotate is named once", () => {
  const other = 'HG00133#1#CM0002.1'
  const graph: Graph = {
    name: 'g',
    nodes: [
      anchored('r1', 0, 1000),
      anchored('r2', 1000, 1000),
      offReference('snp', 1000, 1),
      offReference('ins', 2001, 2000),
      {
        ...anchored('snp2', 1000, 1),
        stable: { refName: other, start: 1000, rank: 1, strand: '+' as const },
      },
    ],
    edges: [],
    paths: [
      { name: 'chr1', nodeIds: ['r1', 'r2'], start: 0 },
      { name: HAPLOTYPE, nodeIds: ['r1', 'snp', 'r2', 'ins'], start: 0 },
      { name: other, nodeIds: ['r1', 'snp2', 'r2'], start: 0 },
    ],
  }
  const pins = genePins(
    graph,
    [
      gene('C4', 'chr1', 0, 2000),
      gene('C4', HAPLOTYPE, 0, 2001),
      gene('C4', HAPLOTYPE, 2001, 4001),
      gene('STK19', HAPLOTYPE, 0, 2001),
      gene('STK19', other, 0, 2001),
    ],
    along(['r1', 'r2', 'snp', 'ins', 'snp2'], 0),
  )
  expect(pins.map(p => [p.anchored, [...p.nodeIds]])).toEqual([
    [1, ['r1', 'r2']],
    [1 / 2001, ['snp']],
    [1, ['ins']],
    [1 / 2001, ['snp']],
    [1 / 2001, ['snp2']],
  ])
  expect(
    namedGenePins(pins, [HAPLOTYPE, other]).map(n => [
      n.name,
      [...n.pin.nodeIds],
    ]),
  ).toEqual([
    ['C4', ['r1', 'r2']],
    ['C4 · HG00097#1', ['ins']],
    ['STK19 · HG00097#1', ['snp']],
  ])
})

test("a haplotype's copy of a gene the reference names in another copy's name is not named again", () => {
  const graph: Graph = {
    name: 'g',
    nodes: [
      anchored('r1', 0, 1000),
      anchored('r2', 1000, 1000),
      anchored('u', 3000, 10),
      offReference('snp', 1000, 1),
      offReference('ins', 2001, 2000),
    ],
    edges: [],
    paths: [
      { name: 'chr1', nodeIds: ['r1', 'r2', 'r1', 'u', 'r2'], start: 0 },
      { name: HAPLOTYPE, nodeIds: ['r1', 'snp', 'r2', 'ins'], start: 0 },
    ],
  }
  const pins = genePins(
    graph,
    [
      gene('FIRST', 'chr1', 0, 2000),
      gene('LATER', 'chr1', 2000, 4010),
      gene('LATER', HAPLOTYPE, 0, 2001),
      gene('LATER', HAPLOTYPE, 2001, 4001),
    ],
    along(['r1', 'r2', 'u', 'snp', 'ins'], 0),
  )
  const names = (lifted: string[]) =>
    namedGenePins(pins, lifted).map(n => [n.name, [...n.pin.nodeIds]])
  expect(names([])).toEqual([['FIRST, LATER', ['r1', 'r2']]])
  expect(names([HAPLOTYPE])).toEqual([
    ['FIRST, LATER', ['r1', 'r2']],
    ['LATER · HG00097#1', ['ins']],
  ])
})
