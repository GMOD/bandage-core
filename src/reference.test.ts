import { backboneNodes, backbonePositions } from './anchoredNodes'
import { genePins } from './genes/genePins'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { parseGFA } from './gfa-core/index'
import { anchorFromPaths, anchorGraph } from './pathAnchoring'
import {
  backboneAssembly,
  featuresOnBackbone,
  graphBackbone,
  wellKnownSample,
} from './reference'

import type { GeneModel } from './genes/genePins'
import type { AssemblyNames } from './reference'
import type { Graph } from './types'

function load(lines: string[], reference?: string) {
  return anchorGraph(convertGFAToGraph(parseGFA(lines.join('\n'))), reference)
}

function gene(name: string, refName: string, start: number, end: number) {
  return {
    name,
    refName,
    start,
    end,
    strand: 1,
    exons: [{ start, end }],
  } satisfies GeneModel
}

// each backbone refName on a row of its own, so a pin says which it landed on
function pinned(graph: Graph, genes: GeneModel[]) {
  const nodes = backboneNodes(graph)
  const rows = [...new Set(nodes.map(n => n.stable.refName))]
  const positions = backbonePositions(nodes)
  for (const node of nodes) {
    for (const point of positions[node.id]!) {
      point.y = rows.indexOf(node.stable.refName)
    }
  }
  return genePins(graph, genes, positions).map(
    p => `${p.gene.name}@${p.at.x},${p.at.y}`,
  )
}

// what a host draws: an assembly's genes, on a backbone that binds to it
function hostPins(graph: Graph, assembly: AssemblyNames, genes: GeneModel[]) {
  const backbone = graphBackbone(graph)
  return backbone && backboneAssembly(backbone, [assembly])
    ? pinned(graph, featuresOnBackbone(genes, backbone))
    : []
}

const HG38 = { name: 'hg38', aliases: ['GRCh38'] }
const HS1 = { name: 'hs1', aliases: [] }

// GRCh38 and CHM13 walk chr6 at overlapping coordinates, so hg38's chr6:1002-
// 1008 lies over segment 1 whichever of them is the backbone.
const CHR6 = [
  'S\t1\tAAAAAAAAAA',
  'S\t2\tCCCCCCCCCC',
  'S\t3\tGGGGGGGGGG',
  'S\t4\tTTTTTTTTTT',
  'L\t1\t+\t2\t+\t0M',
  'L\t1\t+\t3\t+\t0M',
  'L\t2\t+\t4\t+\t0M',
  'L\t3\t+\t4\t+\t0M',
  'W\tGRCh38\t0\tchr6\t1000\t1030\t>1>2>4',
  'W\tCHM13\t0\tchr6\t1005\t1035\t>1>3>4',
]

describe('graphBackbone', () => {
  test('spans each rank-0 refName, with the prefixes they share', () => {
    expect(graphBackbone(load(CHR6, 'GRCh38'))).toEqual({
      contigs: [
        { refName: 'GRCh38#0#chr6', contig: 'chr6', start: 1000, end: 1030 },
      ],
      prefixes: ['GRCh38', 'GRCh38#0'],
    })
  })

  test('shares no prefix across bare names or different samples', () => {
    const rgfa = (...names: string[]) =>
      load(
        names.map(
          (name, i) => `S\ts${i}\t*\tLN:i:10\tSN:Z:${name}\tSO:i:0\tSR:i:0`,
        ),
      )
    expect(graphBackbone(rgfa('chr6'))?.prefixes).toEqual([])
    expect(
      graphBackbone(rgfa('GRCh38#0#chr6', 'CHM13#0#chr7'))?.prefixes,
    ).toEqual([])
    expect(
      graphBackbone(rgfa('GRCh38#0#chr6', 'GRCh38#1#chr6'))?.prefixes,
    ).toEqual(['GRCh38'])
    expect(graphBackbone(load(['S\t1\tACGT']))).toBeUndefined()
  })
})

describe('backboneAssembly', () => {
  const backboneOf = (sample: string) =>
    graphBackbone(anchorFromPaths(load(CHR6), sample))

  test('binds by name or alias, at sample or haplotype depth, in any case', () => {
    const grch38 = backboneOf('GRCh38')
    expect(backboneAssembly(grch38, [HS1, HG38])).toBe(HG38)
    expect(backboneAssembly(grch38, [{ name: 'grch38' }])).toBeDefined()
    expect(
      backboneAssembly(grch38, [
        { name: 'GRCh38_full', aliases: ['GRCh38#0'] },
      ]),
    ).toBeDefined()
    expect(backboneAssembly(grch38, [{ name: 'GRCh38#1' }])).toBeUndefined()
  })

  test('binds hs1 to CHM13 through the well-known samples', () => {
    const chm13 = backboneOf('CHM13')
    expect(wellKnownSample('HS1')).toBe('CHM13')
    expect(backboneAssembly(chm13, [HG38, HS1])).toBe(HS1)
    expect(backboneAssembly(chm13, [HG38])).toBeUndefined()
  })

  test('prefers an assembly the backbone names outright', () => {
    const chm13v2 = { name: 'chm13v2' }
    const chm13 = { name: 'T2T', aliases: ['CHM13'] }
    expect(backboneAssembly(backboneOf('CHM13'), [chm13v2, chm13])).toBe(chm13)
  })

  test('never binds a bare contig name', () => {
    const bare = graphBackbone(
      load(['S\ts\t*\tLN:i:10\tSN:Z:chr6\tSO:i:0\tSR:i:0']),
    )
    expect(
      backboneAssembly(bare, [HG38, { name: 'chr6', aliases: ['chr6'] }]),
    ).toBeUndefined()
    expect(backboneAssembly(undefined, [HG38])).toBeUndefined()
  })
})

describe('genes on the backbone', () => {
  test('an hg38 gene on chr6 pins only while the GRCh38 walk is the reference', () => {
    const genes = [gene('HLA', 'chr6', 1002, 1008)]
    const onGRCh38 = load(CHR6, 'GRCh38')
    const onCHM13 = anchorFromPaths(onGRCh38, 'CHM13')
    expect(hostPins(onGRCh38, HG38, genes)).toEqual(['HLA@1005,0'])
    expect(hostPins(onCHM13, HG38, genes)).toEqual([])
    // genePins alone takes a bare contig on the one backbone refName with it
    expect(pinned(onCHM13, genes)).toEqual(['HLA@1005,0'])
  })

  test('a gene named for one sample pins on that sample only', () => {
    const genes = [gene('HLA', 'GRCh38#0#chr6', 1002, 1008)]
    const onGRCh38 = load(CHR6, 'GRCh38')
    expect(pinned(onGRCh38, genes)).toEqual(['HLA@1005,0'])
    expect(pinned(anchorFromPaths(onGRCh38, 'CHM13'), genes)).toEqual([])
  })

  test('E. coli K12 takes genes by the assembly’s name and the graph’s', () => {
    const ecoli = load([
      `S\ta\t${'A'.repeat(20)}`,
      `S\tb\t${'C'.repeat(20)}`,
      'L\ta\t+\tb\t+\t0M',
      'P\tK12#1#chr:500-540\ta+,b+\t*',
      'P\tSakai#1#chr:900-940\ta+,b+\t*',
    ])
    const genes = [
      gene('thrL', 'chr', 504, 506),
      gene('thrA', 'K12#1#chr', 524, 526),
      gene('stx2A', 'Sakai#1#chr', 504, 506),
    ]
    const backbone = graphBackbone(ecoli)!
    expect(backbone.prefixes).toEqual(['K12', 'K12#1'])
    expect(featuresOnBackbone(genes, backbone).map(g => g.refName)).toEqual([
      'K12#1#chr',
      'K12#1#chr',
    ])
    expect(hostPins(ecoli, { name: 'K12' }, genes)).toEqual([
      'thrL@505,0',
      'thrA@525,0',
    ])
  })

  test('a plant backbone of two chromosomes puts each gene on its own', () => {
    const plant = load([
      'S\tc1a\t*\tLN:i:100\tSN:Z:Col-0#1#Chr1\tSO:i:0\tSR:i:0',
      'S\tc1b\t*\tLN:i:100\tSN:Z:Col-0#1#Chr1\tSO:i:100\tSR:i:0',
      'S\tc2a\t*\tLN:i:100\tSN:Z:Col-0#1#Chr2\tSO:i:0\tSR:i:0',
      'L\tc1a\t+\tc1b\t+\t0M',
    ])
    const tair10 = { name: 'TAIR10', aliases: ['Col-0'] }
    expect(graphBackbone(plant)).toEqual({
      contigs: [
        { refName: 'Col-0#1#Chr1', contig: 'Chr1', start: 0, end: 200 },
        { refName: 'Col-0#1#Chr2', contig: 'Chr2', start: 0, end: 100 },
      ],
      prefixes: ['Col-0', 'Col-0#1'],
    })
    expect(
      hostPins(plant, tair10, [
        gene('AT1G01010', 'Chr1', 10, 20),
        gene('AT1G01020', 'Chr1', 150, 160),
        gene('AT2G01010', 'Chr2', 10, 20),
        gene('AT3G01010', 'Chr3', 10, 20),
      ]),
    ).toEqual(['AT1G01010@15,0', 'AT1G01020@155,0', 'AT2G01010@15,1'])
  })

  test('a contig two backbone refNames share pins nothing by its bare name', () => {
    const haplotypes = load([
      'S\th1\t*\tLN:i:10\tSN:Z:GRCh38#1#chr6\tSO:i:0\tSR:i:0',
      'S\th2\t*\tLN:i:10\tSN:Z:GRCh38#2#chr6\tSO:i:0\tSR:i:0',
    ])
    expect(
      pinned(haplotypes, [
        gene('A', 'chr6', 2, 4),
        gene('B', 'GRCh38#2#chr6', 2, 4),
      ]),
    ).toEqual(['B@3,1'])
    expect(
      featuresOnBackbone([gene('A', 'chr6', 2, 4)], graphBackbone(haplotypes)!),
    ).toEqual([])
  })
})
