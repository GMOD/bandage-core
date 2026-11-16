import { layoutLabels } from '../labelLayout'
import { exonStretches } from './exonOutline'
import { genesOverNode, hasGeneSymbol } from './geneNames'
import { genePins } from './genePins'

import type { LabelLayoutSource } from '../labelLayout'
import type { Graph } from '../types'
import type { GenePin } from './genePins'

const GENES = ['CFH', 'CFHR3', 'CFHR1', 'CFHR4', 'CFHR2']
const HAPLOTYPES = [
  'HG00097#1',
  'HG00099#1',
  'HG00128#1',
  'HG00133#1',
  'HG01109#1',
  'HG01123#1',
  'HG01960#1',
  'HG02055#1',
]
const contigOf = (haplotype: string) => `${haplotype}#CM0001.1`

function pinOf(
  name: string,
  refName: string,
  at: { x: number; y: number },
  o: { onReference?: boolean; walks?: number; covered?: number } = {},
): GenePin {
  const nodeId = `${refName}:${name}`
  return {
    gene: { name, refName, start: 0, end: 10_000, strand: 1, exons: [] },
    exons: '',
    exonsByNode: [
      {
        nodeId,
        d: 'M0 0L1 0',
        stretches: [
          [
            { x: at.x - 1, y: at.y },
            { x: at.x + 1, y: at.y },
          ],
        ],
      },
    ],
    nodeIds: new Set([nodeId]),
    at,
    covered: o.covered ?? 1,
    onReference: o.onReference ?? false,
    walks: o.walks ?? 1,
  }
}

// every pin on a spot of its own, far enough from the rest that every name
// fits beside it
function spread(pins: GenePin[]) {
  return pins.map((pin, i) => ({
    ...pin,
    at: { x: 150 + (i % 9) * 420, y: 120 + Math.floor(i / 9) * 260 },
  }))
}

const reference = GENES.map(name =>
  pinOf(name, 'GRCh38#0#chr1', { x: 0, y: 0 }, { onReference: true }),
)
const copies = GENES.flatMap(name =>
  HAPLOTYPES.map(h => pinOf(name, contigOf(h), { x: 0, y: 0 })),
)

function chips(pins: GenePin[], liftedWalks?: string[]) {
  const source: LabelLayoutSource = {
    paneWidth: 4000,
    canvasHeight: 2000,
    axisScale: { scaleX: 1, scaleY: 1 },
    translateX: 0,
    translateY: 0,
    contigThickness: 6,
    legendSize: { width: 0, height: 0 },
    drawnRowLabels: [],
    bubbleHalos: [],
    genePins: spread(pins),
    liftedWalks,
    labelsNodeSizes: false,
    nodeLengths: new Map(),
    nodeById: undefined,
    alleleDeletions: [],
    positionsVersion: 0,
  }
  return layoutLabels(source)
    .genes.map(g => g.text)
    .sort()
}

test("forty pins of eight haplotypes' copies of five genes give five names, on the reference", () => {
  expect(copies).toHaveLength(40)
  expect(chips([...reference, ...copies])).toEqual([...GENES].sort())
})

test("lifting a walk names that walk's own copies, with its haplotype, and no other's", () => {
  expect(
    chips([...reference, ...copies], [`${contigOf('HG00128#1')}:0-250000`]),
  ).toEqual([...GENES, ...GENES.map(name => `${name} · HG00128#1`)].sort())
})

test('a gene only haplotypes carry is named once, on the copy the most walks step', () => {
  const offReference = [
    pinOf('NBPF26', contigOf('HG00133#1'), { x: 0, y: 0 }, { walks: 2 }),
    pinOf('NBPF26', contigOf('HG00128#1'), { x: 0, y: 0 }, { walks: 5 }),
    pinOf('NBPF26', contigOf('HG00099#1'), { x: 0, y: 0 }, { walks: 5 }),
  ]
  const layout = layoutLabels({
    paneWidth: 4000,
    canvasHeight: 2000,
    axisScale: { scaleX: 1, scaleY: 1 },
    translateX: 0,
    translateY: 0,
    contigThickness: 6,
    legendSize: { width: 0, height: 0 },
    drawnRowLabels: [],
    bubbleHalos: [],
    genePins: spread(offReference),
    labelsNodeSizes: false,
    nodeLengths: new Map(),
    nodeById: undefined,
    alleleDeletions: [],
    positionsVersion: 0,
  })
  expect(layout.genes.map(g => g.text)).toEqual(['NBPF26'])
  // of the two five walks step, the one on the contig whose name sorts first
  expect(layout.genes[0]!.x).toBe(150 + 2 * 420)
  expect(chips(offReference, [contigOf('HG01109#1')])).toEqual([
    'NBPF26 · HG00099#1',
  ])
})

test('a gene with no symbol is named nowhere, and keeps its outline and its hover', () => {
  const unnamed = pinOf(
    'ENSG00000289697',
    'GRCh38#0#chr1',
    { x: 0, y: 0 },
    {
      onReference: true,
    },
  )
  const pins = [...reference, unnamed]
  expect(chips(pins)).toEqual([...GENES].sort())
  expect(
    exonStretches(pins, () => 3).filter(s =>
      s.key.startsWith('ENSG00000289697'),
    ),
  ).toHaveLength(1)
  expect(genesOverNode(pins, unnamed.exonsByNode[0]!.nodeId)).toEqual([
    'ENSG00000289697',
  ])
})

test('a symbol is any name but an accession standing in for one', () => {
  expect(
    [
      'CFH',
      'AMY1A',
      'C4orf33',
      'HLA-DRB1',
      'MIR4632',
      'ENSG00000289697',
      'ENSG00000289697.2',
      'ENSMUSG00000026365',
      'LOC105378878',
      'NR_046018.2',
      'chr1:1001-2000',
    ].filter(hasGeneSymbol),
  ).toEqual(['CFH', 'AMY1A', 'C4orf33', 'HLA-DRB1', 'MIR4632'])
})

// GRCh38 over 0-2000; a haplotype's walk of 2100 bp from 4500 on its contig,
// through the reference's nodes and 100 bp of its own
const HAPLOTYPE = 'HG00097#1#CM0001.1'
const WALKED: Graph = {
  name: 'g',
  nodes: [
    {
      id: 'r1',
      name: 'r1',
      length: 1000,
      depth: 2,
      stable: { refName: 'GRCh38#0#chr1', start: 0, rank: 0, strand: '+' },
    },
    {
      id: 'r2',
      name: 'r2',
      length: 1000,
      depth: 2,
      stable: { refName: 'GRCh38#0#chr1', start: 1000, rank: 0, strand: '+' },
    },
    {
      id: 'h1',
      name: 'h1',
      length: 100,
      depth: 1,
      stable: { refName: HAPLOTYPE, start: 5000, rank: 1, strand: '+' },
    },
  ],
  edges: [],
  paths: [
    { name: 'GRCh38#0#chr1', nodeIds: ['r1', 'r2'], start: 0 },
    { name: HAPLOTYPE, nodeIds: ['r1', 'h1', 'r2'], start: 4500 },
  ],
}
const POSITIONS = {
  r1: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  r2: [
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ],
  h1: [
    { x: 100, y: 0 },
    { x: 100, y: 40 },
  ],
}
const gene = (name: string, refName: string, start: number, end: number) => ({
  name,
  refName,
  start,
  end,
  strand: 1,
  exons: [{ start, end }],
})

test('a name says how much of its gene the drawing holds only where part of the gene lies outside it', () => {
  const pins = genePins(
    WALKED,
    [
      gene('WHOLE', 'GRCh38#0#chr1', 200, 1800),
      gene('PAST', 'GRCh38#0#chr1', 1500, 2500),
      gene('OWNWHOLE', HAPLOTYPE, 4600, 6500),
      gene('OWNPAST', HAPLOTYPE, 5050, 7050),
    ],
    POSITIONS,
  )
  const texts = chips(
    pins.map(p => ({ ...p })),
    [HAPLOTYPE],
  )
  expect(texts).toEqual([
    'OWNPAST · HG00097#1 · 1.6 of 2 kb',
    'OWNWHOLE · HG00097#1',
    'PAST · 0.5 of 1 kb',
    'WHOLE',
  ])
  expect(pins.map(p => [p.gene.name, p.onReference, p.walks])).toEqual([
    ['WHOLE', true, 2],
    ['PAST', true, 2],
    ['OWNWHOLE', false, 1],
    ['OWNPAST', false, 1],
  ])
})
