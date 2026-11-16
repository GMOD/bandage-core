import {
  LABEL_DEFAULTS,
  labelledNodeLengths,
  nodeLabelBudget,
  sizeLeader,
} from './graphLabels'
import {
  LEGEND_INSET_PX,
  geneCoverageNote,
  geneLeader,
  layoutLabels,
} from './labelLayout'
import { LABEL_PAD } from './overlayLabels'

import type { BubbleHalo } from './bubbles/bubbleHalos'
import type { GenePin } from './genes/genePins'
import type { LabelLayoutSource } from './labelLayout'
import type { NodeSegment } from './types'

const bubble = {
  refName: 'chr1',
  start: 0,
  end: 1000,
  segmentCount: 3,
  pathCount: 2,
  inversion: false,
  shortestAlleleLength: 1000,
  longestAlleleLength: 1600,
  segments: 's1,s2,s3',
  shortestAllele: undefined,
  longestAllele: undefined,
}

function halo(labelAt: NodeSegment, tick = false): BubbleHalo {
  return {
    bubble,
    label: '1.6 kb, 2 routes',
    path: '',
    labelAt,
    members: 3,
    nodeIds: ['s2'],
    whole: false,
    tick,
  }
}

function pin(at: NodeSegment): GenePin {
  return {
    gene: {
      name: 'hemA',
      refName: 'chr1',
      start: 0,
      end: 1200,
      strand: 1,
      exons: [],
    },
    exons: '',
    exonsByNode: [],
    nodeIds: new Set(['bb']),
    at,
    covered: 1,
  }
}

// an exon outlined along `nodeId` from x0 to x1 at y, in layout units
function exonOn(nodeId: string, x0: number, x1: number, y: number) {
  return {
    nodeId,
    d: '',
    stretches: [
      [
        { x: x0, y },
        { x: x1, y },
      ],
    ],
  }
}

function source(overrides: Partial<LabelLayoutSource>): LabelLayoutSource {
  return {
    paneWidth: 800,
    canvasHeight: 400,
    axisScale: { scaleX: 1, scaleY: 1 },
    translateX: 0,
    translateY: 0,
    contigThickness: 6,
    legendSize: { width: 0, height: 0 },
    drawnRowLabels: [],
    bubbleHalos: [],
    genePins: [],
    labelsNodeSizes: true,
    nodeLengths: new Map(),
    nodeById: undefined,
    alleleDeletions: [],
    positionsVersion: 0,
    ...overrides,
  }
}

// `pangenome/pggb_bubble_tier` drew "1.1 kb sub, partial" over the backbone
// length beside it, because the two overlays placed their labels apart.
test('a node length gives way to the bubble label over it', () => {
  const layout = layoutLabels(
    source({
      bubbleHalos: [halo({ x: 300, y: 216 })],
      nodePositions: {
        s1: [
          { x: 200, y: 200 },
          { x: 400, y: 200 },
        ],
      },
      nodeLengths: new Map([['s1', 700]]),
    }),
  )
  expect(layout.bubbles.map(l => l.text)).toEqual(['1.6 kb, 2 routes'])
  expect(layout.sizes).toEqual([])
})

test('a node length clear of every chip keeps its label', () => {
  const layout = layoutLabels(
    source({
      bubbleHalos: [halo({ x: 300, y: 100 })],
      nodePositions: {
        s1: [
          { x: 200, y: 300 },
          { x: 400, y: 300 },
        ],
      },
      nodeLengths: new Map([['s1', 700]]),
    }),
  )
  expect(layout.sizes.map(l => l.text)).toEqual(['700 bp'])
})

// amylase's "nodes not shown" loops lost their 75 kb and 116 kb with node
// lengths turned off, the only cue to how much sequence each one holds
test('a node writes its length only where the host turns lengths on, a placeholder always', () => {
  const nodes = [
    { id: 'ref', name: 'ref', length: 700, depth: 1 },
    { id: 'off', name: 'off', length: 900, depth: 1 },
    {
      id: 'loop',
      name: 'loop',
      length: 75_000,
      depth: 1,
      placeholder: true as const,
    },
  ]
  const lengths = (nodeLengths?: boolean) =>
    layoutLabels(
      source({
        nodePositions: {
          ref: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
          ],
          off: [
            { x: 100, y: 200 },
            { x: 300, y: 200 },
          ],
          loop: [
            { x: 100, y: 300 },
            { x: 300, y: 300 },
          ],
        },
        nodeLengths: labelledNodeLengths(nodes, nodeLengths),
        nodeById: new Map(nodes.map(n => [n.id, n])),
      }),
    ).sizes.map(l => l.text)
  expect(LABEL_DEFAULTS.nodeLengths).toBe(false)
  expect(lengths(undefined)).toEqual(['75 kb'])
  expect(lengths(false)).toEqual(['75 kb'])
  expect(lengths(true)).toEqual(['75 kb', '900 bp', '700 bp'])
})

// At KIV-2 (chr6:160,616,004-160,646,753) the small loop beside LPA lost its
// "11.1 kb": LPA's name, placed first and slid left, took a box 0.1 px into
// the loop's label, and with lengths on, twenty bigger nodes would have spent
// the budget before it
test("a placeholder's length is placed before a gene's name and every bigger node's length", () => {
  const big = Array.from({ length: 20 }, (_, i) => ({
    id: `n${i}`,
    length: 50_000 + i * 1000,
    at: { x: 20 + (i % 5) * 150, y: 250 + Math.floor(i / 5) * 40 },
  }))
  const nodes = [
    { id: 'bb', name: 'bb', length: 30_000, depth: 8 },
    {
      id: 'loop',
      name: 'loop',
      length: 11_084,
      depth: 1,
      placeholder: true as const,
    },
    ...big.map(n => ({ id: n.id, name: n.id, length: n.length, depth: 1 })),
  ]
  const at = { x: 300, y: 100 }
  const lpa = {
    ...pin(at),
    gene: { ...pin(at).gene, name: 'LPA', start: 0, end: 132_800 },
    covered: 32_800 / 132_800,
  }
  const layout = layoutLabels(
    source({
      genePins: [lpa],
      nodePositions: {
        bb: [
          { x: 100, y: 100 },
          { x: 500, y: 100 },
        ],
        loop: [
          { x: 330, y: 105 },
          { x: 390, y: 105 },
        ],
        ...Object.fromEntries(
          big.map(n => [n.id, [n.at, { x: n.at.x + 100, y: n.at.y }]]),
        ),
      },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  const texts = layout.sizes.map(l => l.text)
  expect(texts[0]).toBe('11.1 kb')
  expect(texts).toHaveLength(8)
  expect(texts.slice(1)).toEqual(
    big
      .slice(-7)
      .reverse()
      .map(n => `${n.length / 1000} kb`),
  )
  expect(layout.genes.map(l => l.text)).toEqual(['LPA · 32.8 of 132.8 kb'])
})

test('a placeholder whose middle is taken writes its length further along its loop', () => {
  const nodes = ['a', 'b'].map(id => ({
    id,
    name: id,
    length: 11_084,
    depth: 1,
    placeholder: true as const,
  }))
  const line = [
    { x: 300, y: 200 },
    { x: 300, y: 300 },
  ]
  const layout = layoutLabels(
    source({
      nodePositions: { a: line, b: line },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(layout.sizes.map(l => [l.text, l.y])).toEqual([
    ['11.1 kb', 250],
    ['11.1 kb', 225],
  ])
})

const placeholders = (lengths: number[]) =>
  lengths.map((length, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    length,
    depth: 1,
    placeholder: true as const,
  }))

// A size label's box as the canvas draws it: 10 px text at 5.7 px a
// character in 6 px of padding and a 3 px gap, on a 13 px line
const sizeBox = (l: { text: string; x: number; y: number }) => {
  const halfW = (l.text.length * 5.7 + 9) / 2
  return { x0: l.x - halfW, x1: l.x + halfW, y0: l.y - 8, y1: l.y + 8 }
}
const apart = (a: ReturnType<typeof sizeBox>, b: ReturnType<typeof sizeBox>) =>
  a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0

// two placeholders the layout drew on one spot: every spot along the one
// loop is the other's
test('a placeholder whose every spot is taken stacks its length beside the nearest, with a leader to it', () => {
  const nodes = placeholders([75_000, 75_000])
  const spot = [
    { x: 300, y: 200 },
    { x: 324, y: 200 },
  ]
  const { sizes } = layoutLabels(
    source({
      nodePositions: { p0: spot, p1: spot },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes.map(l => l.text)).toEqual(['75 kb', '75 kb'])
  const [onLoop, stacked] = sizes
  expect(onLoop!.leader).toBeUndefined()
  expect(stacked!.leader).toBeDefined()
  expect(stacked!.leader!.y).toBe(200)
  expect(stacked!.leader!.x).toBeGreaterThanOrEqual(300)
  expect(stacked!.leader!.x).toBeLessThanOrEqual(324)
  expect(Math.abs(stacked!.y - 200)).toBe(16)
  expect(apart(sizeBox(onLoop!), sizeBox(stacked!))).toBe(true)
  expect(sizeLeader(stacked!)).toEqual({
    x1: stacked!.x,
    y1: stacked!.y > 200 ? stacked!.y - 6.5 : stacked!.y + 6.5,
    x2: stacked!.leader!.x,
    y2: 200,
  })
  expect(sizeLeader(onLoop!)).toBeUndefined()
})

test("a placeholder whose loop is too short to hold its length stacks it off the loop's middle, with a leader to it", () => {
  const nodes = placeholders([75_000])
  const { sizes } = layoutLabels(
    source({
      nodePositions: {
        p0: [
          { x: 300, y: 200 },
          { x: 306, y: 200 },
        ],
      },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes).toHaveLength(1)
  const [stacked] = sizes
  expect(stacked!.text).toBe('75 kb')
  expect(stacked!.leader).toEqual({ x: 303, y: 200 })
  expect(Math.abs(stacked!.y - 200)).toBe(16)
})

// At the amylase locus the stacked length first stood on the reference bar
// beside the loops, where it read as that bar's length
test("a stacked placeholder length keeps off other nodes' ink where it can", () => {
  const nodes = placeholders([75_000, 75_000])
  const spot = [
    { x: 300, y: 200 },
    { x: 324, y: 200 },
  ]
  const below = [
    { x: 250, y: 216 },
    { x: 380, y: 216 },
  ]
  const lengths = new Map(nodes.map(n => [n.id, n.length]))
  const { sizes } = layoutLabels(
    source({
      nodePositions: { p0: spot, p1: spot, bb: below },
      nodeLengths: lengths,
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes.map(l => l.text)).toEqual(['75 kb', '75 kb'])
  expect(sizes[1]!.y).toBe(184)
  expect(sizes[1]!.leader).toBeDefined()
})

// The amylase locus under FMMM drew three 75 kb loops crossing beside one
// another, and the third lost its length
test('three loops crossing in one place each keep their length, none over another', () => {
  const nodes = placeholders([116_000, 75_000, 75_000])
  const loop = (dx: number, dy: number) => [
    { x: 400 + dx, y: 150 + dy },
    { x: 430 + dx, y: 135 + dy },
    { x: 440 + dx, y: 165 + dy },
    { x: 400 + dx, y: 150 + dy },
  ]
  const { sizes } = layoutLabels(
    source({
      nodePositions: { p0: loop(0, 0), p1: loop(6, 4), p2: loop(-4, 6) },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes.map(l => l.key).sort()).toEqual([
    'node:p0',
    'node:p1',
    'node:p2',
  ])
  sizes.forEach((a, i) => {
    for (const b of sizes.slice(i + 1)) {
      expect(apart(sizeBox(a), sizeBox(b))).toBe(true)
    }
  })
  for (const label of sizes.filter(l => l.leader)) {
    expect(
      Math.hypot(label.x - label.leader!.x, label.y - label.leader!.y),
    ).toBeLessThan(60)
  }
})

// KIV-2 buried its graph under more than a hundred stacked "1 bp" lengths
const shortLoops = (lengths: number[]) => {
  const nodes = placeholders(lengths)
  return {
    paneWidth: 1200,
    canvasHeight: 320,
    nodePositions: Object.fromEntries(
      nodes.map((n, i) => [
        n.id,
        [
          { x: 100 + i * 10, y: 160 },
          { x: 106 + i * 10, y: 160 },
        ],
      ]),
    ),
    nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
    nodeById: new Map(nodes.map(n => [n.id, n])),
  }
}

test('placeholder lengths stacked off their loops stand only while the pane has room for node labels, the rest counted', () => {
  const budget = nodeLabelBudget(1200, 320)
  const { sizes, unlabelled } = layoutLabels(
    source(shortLoops(Array.from({ length: 100 }, () => 1))),
  )
  expect(sizes.length).toBe(budget)
  expect(sizes.every(l => l.leader)).toBe(true)
  expect(sizes.map(l => l.node)).toEqual(
    Array.from({ length: budget }, (_, i) => `p${i}`),
  )
  expect(unlabelled).toEqual({ count: 100 - budget, smallest: 1, largest: 1 })
})

test('the stacked placeholder lengths that stand are the longest', () => {
  const budget = nodeLabelBudget(1200, 320)
  const lengths = Array.from({ length: 100 }, (_, i) => ((i * 37) % 100) + 1)
  const { sizes, unlabelled } = layoutLabels(source(shortLoops(lengths)))
  expect(sizes.map(l => l.text)).toEqual(
    Array.from({ length: budget }, (_, i) => `${100 - i} bp`),
  )
  expect(unlabelled).toEqual({
    count: 100 - budget,
    smallest: 1,
    largest: 100 - budget,
  })
})

test('a row label holds its space against a gene pin', () => {
  const at = { x: 20, y: 200 }
  const without = layoutLabels(source({ genePins: [pin(at)] }))
  expect(without.genes.map(l => l.text)).toEqual(['hemA'])
  const pinY = without.genes[0]!.y
  const layout = layoutLabels(
    source({
      genePins: [pin(at)],
      drawnRowLabels: [{ label: 'Rank 1', y: pinY - 4 }],
    }),
  )
  expect(layout.genes.map(l => l.y)).not.toContain(pinY)
})

// MHC class II lost HLA-DRB1's name under "2.7 kb ref → 0 bp–2.9 kb, 49
// alleles", placed first as the bubble's.
test('a gene name under a bubble name drops a row instead of vanishing', () => {
  const at = { x: 300, y: 100 }
  const without = layoutLabels(source({ genePins: [pin(at)] }))
  const pinY = without.genes[0]!.y
  const layout = layoutLabels(
    source({
      genePins: [pin(at)],
      bubbleHalos: [halo({ x: 300, y: pinY + 6 * 3.4 * 0.5 + 6 })],
    }),
  )
  expect(layout.bubbles.map(l => l.y)).toEqual([pinY])
  expect(layout.genes.map(l => l.text)).toEqual(['hemA'])
  expect(layout.genes[0]!.y).toBeGreaterThan(pinY)
})

// pggb's partial bubbles name only their allele, which an anchored layout
// draws a row below the reference.
test('on a row layout a bubble name goes above the top row', () => {
  const allele = { x: 300, y: 120 }
  const free = layoutLabels(source({ bubbleHalos: [halo(allele)] }))
  const rows = layoutLabels(
    source({
      bubbleHalos: [halo(allele)],
      drawnRowLabels: [
        { label: 'Reference (rank 0)', y: 100 },
        { label: 'Rank 1', y: 120 },
      ],
    }),
  )
  expect(rows.bubbles[0]!.y).toBe(free.bubbles[0]!.y - 20)
})

// A sample-row layout overflows downward, and scrolling it takes the top row
// off the pane; the band sticks to the top edge rather than following it out.
test('a scrolled row layout keeps its bubble names at the top edge', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    label: `row ${i}`,
    y: i * 20,
  }))
  const layout = layoutLabels(
    source({
      bubbleHalos: [halo({ x: 300, y: 400 })],
      drawnRowLabels: rows,
      translateY: -300,
    }),
  )
  expect(layout.bubbles.map(l => l.y)).toEqual([15])
})

test('the legend holds its own box, and no box when none is drawn', () => {
  const corner = {
    nodePositions: {
      s1: [
        { x: 700, y: 20 },
        { x: 790, y: 20 },
      ],
    },
    nodeLengths: new Map([['s1', 700]]),
  }
  expect(layoutLabels(source(corner)).sizes.map(l => l.text)).toEqual([
    '700 bp',
  ])
  expect(
    layoutLabels(source({ ...corner, legendSize: { width: 170, height: 40 } }))
      .sizes,
  ).toEqual([])
})

test("the key's column holds the pane's height under the key too", () => {
  const key = { legendSize: { width: 170, height: 40 } }
  const below = {
    nodePositions: {
      s1: [
        { x: 700, y: 380 },
        { x: 790, y: 380 },
      ],
    },
    nodeLengths: new Map([['s1', 700]]),
  }
  expect(layoutLabels(source(below)).sizes.map(l => l.text)).toEqual(['700 bp'])
  expect(layoutLabels(source({ ...below, ...key })).sizes).toEqual([])
})

test('a gene the cut carries only part of says how much, in its own unit', () => {
  const at = { x: 300, y: 200 }
  const lpa = {
    ...pin(at),
    gene: { ...pin(at).gene, name: 'LPA', start: 0, end: 132_800 },
    covered: 35_000 / 132_800,
  }
  expect(geneCoverageNote(lpa)).toBe('35 of 132.8 kb')
  expect(geneCoverageNote(pin(at))).toBeUndefined()
  expect(
    layoutLabels(source({ genePins: [lpa] })).genes.map(l => l.text),
  ).toEqual(['LPA · 35 of 132.8 kb'])
})

// `pangenome/pggb_bubble_tier` labelled K12's IS5 node `oppA`: oppA's chip
// hangs under its pin on the backbone, which is the rank-1 row, where the IS5
// node lies, and oppA starts past the element.
test("a gene's name never covers a node the gene does not lie on, nor its own where an exon is outlined", () => {
  const at = { x: 300, y: 100 }
  const backbone = {
    bb: [
      { x: 0, y: 100 },
      { x: 800, y: 100 },
    ],
  }
  const free = layoutLabels(
    source({ genePins: [pin(at)], nodePositions: backbone }),
  )
  const pinY = free.genes[0]!.y
  const element = {
    is5: [
      { x: 250, y: pinY - 4 },
      { x: 350, y: pinY - 4 },
    ],
  }
  const layout = layoutLabels(
    source({
      genePins: [pin(at)],
      nodePositions: { ...backbone, ...element },
    }),
  )
  expect(layout.genes.map(l => l.text)).toEqual(['hemA'])
  expect(layout.genes[0]!.y).not.toBe(pinY)

  const own = layoutLabels(
    source({
      genePins: [{ ...pin(at), nodeIds: new Set(['bb', 'is5']) }],
      nodePositions: { ...backbone, ...element },
    }),
  )
  expect(own.genes.map(l => l.y)).toEqual([pinY])

  const outlined = layoutLabels(
    source({
      genePins: [
        {
          ...pin(at),
          nodeIds: new Set(['bb', 'is5']),
          exonsByNode: [exonOn('is5', 280, 320, pinY - 4)],
        },
      ],
      nodePositions: { ...backbone, ...element },
    }),
  )
  expect(outlined.genes.map(l => l.text)).toEqual(['hemA'])
  expect(outlined.genes[0]!.y).not.toBe(pinY)
})

// HPRC's KIV-2 cut lost its `LPA …` once the layout turned LPA's end node to
// run down from its pin. Every row under the pin, slid either way, crossed a
// SNP allele drawn beside that node, and placement never tried the free space above.
test("a gene's name goes above its pin when its node runs on under it", () => {
  const at = { x: 300, y: 100 }
  const nodePositions = {
    bb: [at, { x: 300, y: 300 }],
    snp: [
      { x: 304, y: 100 },
      { x: 304, y: 300 },
    ],
    alt: [
      { x: 296, y: 100 },
      { x: 296, y: 300 },
    ],
  }
  const [label] = layoutLabels(
    source({ genePins: [pin(at)], nodePositions }),
  ).genes
  expect(label!.y).toBeLessThan(at.y)
  expect(geneLeader(label!, at, 6)).toEqual({
    x1: label!.x,
    y1: label!.y + 4,
    x2: at.x,
    y2: at.y - 3,
  })
})

// GSTM1 under the reference clearance hung its alleles under the line, and
// GSTM2's name, stacking up from under its pin in the pane's lower half, sat
// on the reference line over its own exons
test("a gene's name whose spots below the line are taken goes above it, never over its exons", () => {
  const at = { x: 300, y: 300 }
  const alleles = Object.fromEntries(
    Array.from({ length: 41 }, (_, i) => [
      `al${i}`,
      [
        { x: 200 + i * 5, y: 313 },
        { x: 200 + i * 5, y: 340 },
      ],
    ]),
  )
  const nodePositions = {
    bb: [
      { x: 0, y: 300 },
      { x: 800, y: 300 },
    ],
    ...alleles,
  }
  const [label] = layoutLabels(
    source({
      genePins: [{ ...pin(at), exonsByNode: [exonOn('bb', 250, 350, 300)] }],
      nodePositions,
    }),
  ).genes
  expect(label!.text).toBe('hemA')
  expect(label!.y + LABEL_PAD).toBeLessThan(at.y - 3)
})

test("a gene's name with no free spot under or over its pin stacks at the nearest free one, with a leader, rather than be dropped", () => {
  const at = { x: 300, y: 200 }
  const alleles = Object.fromEntries(
    Array.from({ length: 41 }, (_, i) => [
      `al${i}`,
      [
        { x: 200 + i * 5, y: 150 },
        { x: 200 + i * 5, y: 250 },
      ],
    ]),
  )
  const nodePositions = {
    bb: [
      { x: 0, y: 200 },
      { x: 800, y: 200 },
    ],
    ...alleles,
  }
  const [label] = layoutLabels(
    source({
      genePins: [{ ...pin(at), exonsByNode: [exonOn('bb', 200, 400, 200)] }],
      nodePositions,
    }),
  ).genes
  expect(label!.text).toBe('hemA')
  expect(Math.abs(label!.y - at.y)).toBe(76)
  expect(label!.y + LABEL_PAD + 3 < 150 || label!.y - 15 - 3 > 250).toBe(true)
  expect(geneLeader(label!, at, 6)).toMatchObject({ x2: at.x })
})

test("a gene's leader runs from the chip's top down to a pin above it, leaning where the chip slid", () => {
  expect(geneLeader({ x: 90, y: 130 }, { x: 100, y: 100 }, 6)).toEqual({
    x1: 90,
    y1: 117,
    x2: 100,
    y2: 103,
  })
})

// AMY1C at the amylase locus sat a few px left of the key, which runs the
// pane's height there: every row under and over the pin reached into the key,
// and the name was dropped
test('a gene name next to the key slides clear of it rather than vanish', () => {
  const keyLeft = 800 - 2 * LEGEND_INSET_PX - 200
  const at = { x: keyLeft - 6, y: 100 }
  const nodePositions = { bb: [{ x: keyLeft - 60, y: 100 }, at] }
  const layout = layoutLabels(
    source({
      genePins: [pin(at)],
      nodePositions,
      legendSize: { width: 200, height: 400 },
    }),
  )
  const [label] = layout.genes
  expect(label).toBeDefined()
  expect(label!.x + label!.w / 2).toBeLessThanOrEqual(keyLeft)
  expect(geneLeader(label!, at, 6).x2).toBe(at.x)
})

test('a small variant stands as a tick above its nodes, with no chip', () => {
  const { bubbles, ticks } = layoutLabels(
    source({
      bubbleHalos: [
        halo({ x: 300, y: 200 }),
        halo({ x: 500, y: 200 }, true),
        halo({ x: 900, y: 200 }, true),
      ],
    }),
  )
  expect(bubbles.map(b => b.item.labelAt.x)).toEqual([300])
  expect(ticks.map(t => [t.x, t.y])).toEqual([[500, 200 - (6 * 3.4) / 2 - 2]])
})

test('bubble names on one spot stack, and a long one falls back to its kind', () => {
  const named = (label: string, x: number) => ({
    ...halo({ x, y: 200 }),
    label,
    members: label.length,
  })
  const { bubbles } = layoutLabels(
    source({
      bubbleHalos: [
        named('0 bp–22 kb superbubble, 1584 segments, 4 routes', 400),
        named('0 bp–11 kb superbubble, 1198 segments, 5 routes', 410),
        named('11–11 kb superbubble, 488 segments, 3 routes', 420),
      ],
    }),
  )
  expect(new Set(bubbles.map(b => b.y)).size).toBe(3)
  const tight = layoutLabels(
    source({
      paneWidth: 220,
      bubbleHalos: [
        named('0 bp–22 kb superbubble, 1584 segments, 4 routes', 110),
      ],
    }),
  )
  expect(tight.bubbles.map(b => b.text)).toEqual(['0 bp–22 kb superbubble'])
})
