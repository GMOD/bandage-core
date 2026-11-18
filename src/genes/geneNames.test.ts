import { layoutLabels } from '../labelLayout'
import { exonStretches } from './exonOutline'
import {
  copyNames,
  genesOverNode,
  hasGeneSymbol,
  namedGenePins,
} from './geneNames'
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
    anchored: 1,
    body: [],
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
    graph: undefined,
    drawnInk: undefined,
    alleleDeletions: [],
    positionsVersion: 0,
    folded: undefined,
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
    graph: undefined,
    drawnInk: undefined,
    alleleDeletions: [],
    positionsVersion: 0,
    folded: undefined,
  })
  expect(layout.genes.map(g => g.text)).toEqual(['NBPF26'])
  // of the two five walks step, the one on the contig whose name sorts first
  expect(layout.genes[0]!.x).toBe(150 + 2 * 420)
  expect(chips(offReference, [contigOf('HG01109#1')])).toEqual([
    'NBPF26 · HG00099#1',
  ])
})

test("a copy's hover names its haplotype", () => {
  const copy = copies[0]!
  expect(genesOverNode([copy], copy.exonsByNode[0]!.nodeId)).toEqual([
    'CFH · HG00097#1',
  ])
})

test('of two copies on one contig the walks step alike, the earlier is named, in either order', () => {
  const at = (start: number) => {
    const pin = pinOf('NBPF26', contigOf('HG00133#1'), { x: 0, y: 0 })
    return { ...pin, gene: { ...pin.gene, start, end: start + 10_000 } }
  }
  const earlier = at(5000)
  const later = at(90_000)
  for (const pins of [
    [earlier, later],
    [later, earlier],
  ]) {
    expect(namedGenePins(pins).map(n => n.pin)).toEqual([earlier])
  }
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

test('a drawing whose genes all lack a symbol names them anyway', () => {
  const unnamed = ['LOC105378878', 'ENSG00000289697', 'NR_046018.2'].map(name =>
    pinOf(name, 'GRCh38#0#chr1', { x: 0, y: 0 }, { onReference: true }),
  )
  expect(chips(unnamed)).toEqual([
    'ENSG00000289697',
    'LOC105378878',
    'NR_046018.2',
  ])
  expect(chips([...unnamed, reference[0]!])).toEqual(['CFH'])
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
      '',
      ' ',
      'gene-LOC105378878',
      'ENSG00000289697.1_PAR_Y',
      'LOC100130417.1',
      'gene-CFH',
    ].filter(hasGeneSymbol),
  ).toEqual(['CFH', 'AMY1A', 'C4orf33', 'HLA-DRB1', 'MIR4632', 'gene-CFH'])
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
    'PAST · 500 bp of 1 kb',
    'WHOLE',
  ])
  expect(pins.map(p => [p.gene.name, p.onReference, p.walks])).toEqual([
    ['WHOLE', true, 2],
    ['PAST', true, 2],
    ['OWNWHOLE', false, 1],
    ['OWNPAST', false, 1],
  ])
})

test('two copies on one stretch of nodes are each named in full', () => {
  expect(copyNames(['C4A'])).toBe('C4A')
  expect(copyNames(['C4A', 'C4B'])).toBe('C4A, C4B')
  expect(copyNames(['VCY', 'VCY1B'])).toBe('VCY, VCY1B')
  expect(copyNames(['RBMY1E', 'RBMY1D'])).toBe('RBMY1D, RBMY1E')
  expect(copyNames(['SMN2', 'SMN1', 'SMN1'])).toBe('SMN1, SMN2')
  expect(copyNames(['CYP21A1P', 'CYP21A2'])).toBe('CYP21A1P, CYP21A2')
})

test('three or more copies that differ only in a number at the end are named as how many they are', () => {
  expect(
    copyNames(['TSPY4', 'TSPY1', 'TSPY3', 'TSPY8', 'TSPY9', 'TSPY10']),
  ).toBe('6 TSPY genes')
  expect(
    copyNames(['FAM197Y8', ...[2, 3, 4, 5, 6, 7].map(n => `FAM197Y${n}`)]),
  ).toBe('7 FAM197Y genes')
  expect(copyNames(['C4A', 'C4B', 'C4C'])).toBe('C4A, C4B, C4C')
  expect(copyNames(['TSPY4', 'TSPY1', 'TSPY3', 'RBMY1A1', 'VCY'])).toBe(
    'RBMY1A1, 3 TSPY genes, VCY',
  )
})

test("a reference copy the reference walks over a named copy's nodes is named in that copy's name", () => {
  const held = pinOf('TSPY4', 'chr1', { x: 0, y: 0 }, { onReference: true })
  const other = pinOf(
    'RBMY1A1',
    'chr1',
    { x: 500, y: 0 },
    { onReference: true },
  )
  const [ring] = held.nodeIds
  const walked = (name: string, over: [string, number][]): GenePin => ({
    ...pinOf(name, 'chr1', { x: 0, y: 0 }, { onReference: true }),
    nodeIds: new Set([`own:${name}`]),
    anchored: 0.01,
    walkedOver: new Map(over),
  })
  const pins = [
    held,
    other,
    walked('TSPY1', [[ring!, 2800]]),
    walked('TSPY3', [
      [ring!, 1500],
      ['own:TSPY3', 20],
    ]),
    walked('LOC105377224', [[ring!, 2800]]),
    walked('TSPY9', [
      [ring!, 100],
      ['elsewhere', 2700],
    ]),
  ]
  expect(namedGenePins(pins).map(n => [n.pin.gene.name, n.name])).toEqual([
    ['TSPY4', '3 TSPY genes'],
    ['RBMY1A1', 'RBMY1A1'],
  ])
})
