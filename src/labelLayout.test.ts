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
import { SMALL_SITE_PX } from './levelOfDetail'
import { LABEL_PAD } from './overlayLabels'

import type { BubbleHalo } from './bubbles/bubbleHalos'
import type { InkBatch } from './drawnInk'
import type { GenePin } from './genes/genePins'
import type { GraphLabel } from './graphLabels'
import type { LabelLayoutSource } from './labelLayout'
import type { GraphNode, NodeSegment } from './types'
import type { BezierCurve } from './util/geometry'

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
    anchored: 1,
    body: [],
    onReference: true,
    walks: 1,
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
    graph: undefined,
    drawnInk: undefined,
    alleleDeletions: [],
    positionsVersion: 0,
    folded: undefined,
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

// a row's name over the loop's middle
test('a placeholder whose middle is taken writes its length further along its loop', () => {
  const loop = {
    id: 'a',
    name: 'a',
    length: 11_084,
    depth: 1,
    placeholder: true as const,
  }
  const layout = layoutLabels(
    source({
      drawnRowLabels: [{ label: 'HG00438#1', y: 250 }],
      nodePositions: {
        a: [
          { x: 40, y: 200 },
          { x: 40, y: 300 },
        ],
      },
      nodeLengths: new Map([['a', loop.length]]),
      nodeById: new Map([['a', loop]]),
    }),
  )
  expect(layout.sizes.map(l => [l.text, l.y])).toEqual([['11.1 kb', 225]])
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

// a 75 kb loop drawn under the 116 kb loop's length: the length's box takes
// every spot along it, though its middle lies 17 px from the 116 kb's
const covered = (more: Record<string, NodeSegment[]> = {}) => {
  const nodes = placeholders([116_000, 75_000])
  return {
    nodePositions: {
      p0: [
        { x: 300, y: 200 },
        { x: 324, y: 200 },
      ],
      p1: [
        { x: 317, y: 200 },
        { x: 341, y: 200 },
      ],
      ...more,
    },
    nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
    nodeById: new Map(nodes.map(n => [n.id, n])),
  }
}

test('a placeholder whose every spot is taken stacks its length beside the nearest, with a leader to it', () => {
  const { sizes } = layoutLabels(source(covered()))
  expect(sizes.map(l => l.text)).toEqual(['116 kb', '75 kb'])
  const [onLoop, stacked] = sizes
  expect(onLoop!.leader).toBeUndefined()
  expect(stacked!.leader).toEqual({ x: 329, y: 200 })
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

// A stacked length names its loop's middle, the point that tells loops on one
// spot, rather than whichever spot along the loop had the nearest clear row
test("a stacked placeholder length leads to its loop's middle, as a speck's does", () => {
  const nodes = placeholders([116_000, 116_000, 75_000])
  const { sizes } = layoutLabels(
    source({
      nodePositions: {
        p0: [
          { x: 290, y: 200 },
          { x: 320, y: 200 },
        ],
        p1: [
          { x: 360, y: 200 },
          { x: 390, y: 200 },
        ],
        p2: [
          { x: 300, y: 200 },
          { x: 380, y: 200 },
        ],
        above: [
          { x: 334, y: 184 },
          { x: 346, y: 184 },
        ],
        below: [
          { x: 334, y: 216 },
          { x: 346, y: 216 },
        ],
      },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes.map(l => l.text)).toEqual(['116 kb', '116 kb', '75 kb'])
  expect(sizes[2]!.leader).toEqual({ x: 340, y: 200 })
})

// At the amylase locus the stacked length first stood on the reference bar
// beside the loops, where it read as that bar's length
test("a stacked placeholder length keeps off other nodes' ink where it can", () => {
  const below = [
    { x: 250, y: 216 },
    { x: 380, y: 216 },
  ]
  const { sizes } = layoutLabels(source(covered({ bb: below })))
  expect(sizes.map(l => l.text)).toEqual(['116 kb', '75 kb'])
  expect(sizes[1]!.y).toBe(184)
  expect(sizes[1]!.leader).toBeDefined()
})

test('a stacked placeholder length keeps half the contig thickness clear of another node', () => {
  const twoPxBelowTheBox = [
    { x: 250, y: 226 },
    { x: 380, y: 226 },
  ]
  const stackedAt = (contigThickness: number) =>
    layoutLabels(
      source({ contigThickness, ...covered({ bb: twoPxBelowTheBox }) }),
    ).sizes[1]!.y
  expect(stackedAt(2)).toBe(216)
  expect(stackedAt(6)).toBe(184)
})

// the gap between two boxes, 0 where they touch or overlap
const gap = (a: ReturnType<typeof sizeBox>, b: ReturnType<typeof sizeBox>) =>
  Math.hypot(
    Math.max(0, a.x0 - b.x1, b.x0 - a.x1),
    Math.max(0, a.y0 - b.y1, b.y0 - a.y1),
  )

// The amylase locus under FMMM drew its 75 kb and 116 kb loops as blades
// fanning out of one knot, and a blade lost its length; drawn on a narrower
// track, two blades' "75 kb" stood 9.6 px apart, one length written twice
test('loops fanning out of one knot each keep their length, two of one length a line apart', () => {
  const nodes = placeholders([116_000, 75_000, 75_000])
  const blade = (...tip: NodeSegment[]) => [
    { x: 400, y: 200 },
    ...tip,
    { x: 400, y: 200 },
  ]
  const { sizes } = layoutLabels(
    source({
      nodePositions: {
        p0: blade({ x: 400, y: 300 }, { x: 410, y: 300 }),
        p1: blade({ x: 520, y: 150 }, { x: 528, y: 160 }),
        p2: blade({ x: 520, y: 172 }, { x: 528, y: 182 }),
      },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes.map(l => [l.node, l.text])).toEqual([
    ['p0', '116 kb'],
    ['p1', '75 kb'],
    ['p2', '75 kb'],
  ])
  sizes.forEach((a, i) => {
    for (const b of sizes.slice(i + 1)) {
      expect(apart(sizeBox(a), sizeBox(b))).toBe(true)
    }
  })
  expect(gap(sizeBox(sizes[1]!), sizeBox(sizes[2]!))).toBeGreaterThanOrEqual(13)
})

// pggb's chrY at 9.3 Mb drew twenty haplotypes' 3.7 kb placeholders as loops
// long enough to hold their length, one over another in a knot, and the
// figure stacked "3.7 kb" in a column off it, leaders into the knot
test('loops drawn on one spot, each long enough to hold its length, take one length between them, the longest, and the key counts the rest', () => {
  const nodes = placeholders([3700, 3700, 3700, 3700, 2800])
  const drop = (d: number) => [
    { x: 300 + d, y: 200 + d },
    { x: 304 + d, y: 160 + d },
    { x: 308 + d, y: 200 + d },
  ]
  const { sizes, unlabelled } = layoutLabels(
    source({
      nodePositions: Object.fromEntries(nodes.map((n, i) => [n.id, drop(i)])),
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes.map(l => [l.node, l.text])).toEqual([['p0', '3.7 kb']])
  expect(unlabelled).toEqual({ count: 4, smallest: 2800, largest: 3700 })
})

// KIV-2 buried its graph under more than a hundred stacked "1 bp" lengths;
// here loops drawn 6 px long, 20 px apart in two rows, each a spot of its own
const shortLoops = (lengths: number[]) => {
  const nodes = placeholders(lengths)
  return {
    paneWidth: 1200,
    canvasHeight: 320,
    nodePositions: Object.fromEntries(
      nodes.map((n, i) => [
        n.id,
        [
          { x: 100 + (i % 50) * 20, y: 110 + Math.floor(i / 50) * 100 },
          { x: 106 + (i % 50) * 20, y: 110 + Math.floor(i / 50) * 100 },
        ],
      ]),
    ),
    nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
    nodeById: new Map(nodes.map(n => [n.id, n])),
  }
}

// pggb's chrY at 9.3 Mb stacked a placeholder's "2.8 kb" half off the
// track's bottom edge; a loop against the left edge has no spot whole on the
// pane, and the key counts it
test("a length's box lies whole on the pane, stacked or along its node, or the length is counted", () => {
  const nodes = placeholders([2800, 5000])
  const { sizes, unlabelled } = layoutLabels(
    source({
      nodePositions: {
        p0: [
          { x: 300, y: 388 },
          { x: 302, y: 388 },
        ],
        p1: [
          { x: 4, y: 100 },
          { x: 4, y: 300 },
        ],
      },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes.map(l => l.node)).toEqual(['p0'])
  expect(sizeBox(sizes[0]!).y1).toBeLessThanOrEqual(400)
  expect(unlabelled).toEqual({ count: 1, smallest: 5000, largest: 5000 })
})

// sv-49 drew four haplotypes' 133 bp placeholders on one point, each loop
// too short to hold its length, and stacked "133 bp" four times off it; sv-48
// two specks 13 px apart on one walk, "196 bp" and "32 bp" with leaders to
// one blob
test('specks on one spot take one length between them, the longest, and the key counts the rest', () => {
  const nodes = placeholders([133, 133, 133, 133, 196, 32, 40])
  const speck = (x: number, y: number) => [
    { x, y },
    { x: x + 2, y },
  ]
  const { sizes, unlabelled } = layoutLabels(
    source({
      nodePositions: {
        p0: speck(209, 175),
        p1: speck(210, 174),
        p2: speck(209, 174),
        p3: speck(210, 175),
        p4: speck(742, 176),
        p5: speck(755, 171),
        p6: speck(775, 171),
      },
      nodeLengths: new Map(nodes.map(n => [n.id, n.length])),
      nodeById: new Map(nodes.map(n => [n.id, n])),
    }),
  )
  expect(sizes.map(l => [l.node, l.text])).toEqual([
    ['p4', '196 bp'],
    ['p0', '133 bp'],
    ['p6', '40 bp'],
  ])
  expect(unlabelled).toEqual({ count: 4, smallest: 32, largest: 133 })
})

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

test('a folded placeholder has no length and no leader, and the unlabelled count leaves it out', () => {
  const budget = nodeLabelBudget(1200, 320)
  const loops = shortLoops(Array.from({ length: 100 }, () => 1))
  const folded = new Set(Array.from({ length: 60 }, (_, i) => `p${i}`))
  const { sizes, unlabelled } = layoutLabels(source({ ...loops, folded }))
  expect(sizes.length).toBe(budget)
  expect(sizes.filter(l => folded.has(l.node))).toEqual([])
  expect(unlabelled).toEqual({ count: 40 - budget, smallest: 1, largest: 1 })
  const all = new Set(Array.from({ length: 100 }, (_, i) => `p${i}`))
  const none = layoutLabels(source({ ...loops, folded: all }))
  expect(none.sizes).toEqual([])
  expect(none.unlabelled).toBeUndefined()
})

const onReference = (id: string, start: number, length: number) => ({
  id,
  name: id,
  length,
  depth: 2,
  stable: { refName: 'chr3', start, rank: 0 },
})
const offReference = (id: string, length: number) => ({
  id,
  name: id,
  length,
  depth: 1,
  stable: { refName: 'chr3', start: 2000, rank: 1 },
})

// sv-10's 148 kb loop drew as long as the 4 kb window's reference does twice
// over and nothing on it said 148 kb: a loop of loaded nodes up from r1,
// across and down to r2, whose middle is b's
const nodesById = (nodes: GraphNode[]) => new Map(nodes.map(n => [n.id, n]))
const loopGraph = (offNodes: GraphNode[]) => ({
  nodes: [
    onReference('r1', 0, 2000),
    onReference('r2', 2000, 2000),
    ...offNodes,
  ],
  edges: [],
  paths: [
    { name: 'GRCh38', nodeIds: ['r1', 'r2'] },
    { name: 'HG00350#1', nodeIds: ['r1', ...offNodes.map(n => n.id), 'r2'] },
  ],
})
const loopPositions = {
  r1: [
    { x: 0, y: 300 },
    { x: 200, y: 300 },
  ],
  r2: [
    { x: 600, y: 300 },
    { x: 800, y: 300 },
  ],
  a: [
    { x: 200, y: 300 },
    { x: 200, y: 100 },
  ],
  b: [
    { x: 600, y: 100 },
    { x: 200, y: 100 },
  ],
  c: [
    { x: 600, y: 100 },
    { x: 600, y: 300 },
  ],
}

// what a pane paints of these nodes, 6 px wide, and of these links, 2 px
const inkOf = (
  positions: Record<string, NodeSegment[]>,
  links: BezierCurve[] = [],
): InkBatch => ({
  nodeStrokes: Object.values(positions).map(points => ({
    points,
    thickness: 3,
    color: 0,
  })),
  nodeStrokeRuns: new Map(
    Object.keys(positions).map((id, i) => [id, { start: i, count: 1 }]),
  ),
  edgeCurves: links.map(curve => ({ curves: [curve], thickness: 1, color: 0 })),
  edgeCurveRuns: new Map(links.map((_, i) => [i, { start: i, count: 1 }])),
})

const straight = (a: NodeSegment, b: NodeSegment): BezierCurve => ({
  x0: a.x,
  y0: a.y,
  cx0: a.x + (b.x - a.x) / 3,
  cy0: a.y + (b.y - a.y) / 3,
  cx1: a.x + ((b.x - a.x) * 2) / 3,
  cy1: a.y + ((b.y - a.y) * 2) / 3,
  x1: b.x,
  y1: b.y,
})

// the box a length's chip takes, as layoutLabels measures it
const chipBox = ({ text, x, y }: GraphLabel) => {
  const half = (text.length * 5.7 + 9) / 2
  return { x0: x - half, x1: x + half, y0: y - 8, y1: y + 8 }
}

const meetsBox = (
  a: NodeSegment,
  b: NodeSegment,
  box: ReturnType<typeof chipBox>,
  by: number,
) =>
  Array.from({ length: 101 }, (_, k) => ({
    x: a.x + ((b.x - a.x) * k) / 100,
    y: a.y + ((b.y - a.y) * k) / 100,
  })).some(
    p =>
      p.x >= box.x0 - by &&
      p.x <= box.x1 + by &&
      p.y >= box.y0 - by &&
      p.y <= box.y1 + by,
  )

const bigLoop = () =>
  loopGraph([
    offReference('a', 30_000),
    offReference('b', 88_000),
    offReference('c', 30_000),
  ])

test("a loop of loaded nodes writes its length at the loop's middle, read along the walk whichever way its nodes are drawn", () => {
  const graph = loopGraph([
    offReference('a', 30_000),
    offReference('b', 88_000),
    offReference('c', 30_000),
  ])
  const { sizes } = layoutLabels(
    source({
      nodePositions: loopPositions,
      nodeById: nodesById(graph.nodes),
      graph,
      drawnInk: inkOf(loopPositions),
    }),
  )
  expect(sizes.map(l => [l.node, l.text, l.x, l.y, l.leader])).toEqual([
    ['b', '148 kb', 400, 100, undefined],
  ])
})

test('a loop stepping a node not loaded writes no length of its own, and its placeholder writes its own', () => {
  const graph = loopGraph([
    { ...offReference('a', 30_000), placeholder: true as const },
    offReference('b', 88_000),
    offReference('c', 30_000),
  ])
  const { sizes } = layoutLabels(
    source({
      nodePositions: loopPositions,
      nodeById: nodesById(graph.nodes),
      nodeLengths: labelledNodeLengths(graph.nodes),
      graph,
      drawnInk: inkOf(loopPositions),
    }),
  )
  expect(sizes.map(l => [l.node, l.text])).toEqual([['a', '30 kb']])
})

test('a loop drawn too short to hold its length, or folded, writes none', () => {
  const graph = loopGraph([
    offReference('a', 30_000),
    offReference('b', 88_000),
    offReference('c', 30_000),
  ])
  const nodeById = nodesById(graph.nodes)
  const shrunk = layoutLabels(
    source({
      nodePositions: loopPositions,
      axisScale: { scaleX: 0.02, scaleY: 0.02 },
      translateX: 300,
      translateY: 200,
      nodeById,
      graph,
      drawnInk: inkOf(loopPositions),
    }),
  )
  expect(shrunk.sizes).toEqual([])
  const folded = layoutLabels(
    source({
      nodePositions: loopPositions,
      nodeById,
      graph,
      drawnInk: inkOf(loopPositions),
      folded: new Set(['a', 'b', 'c']),
    }),
  )
  expect(folded.sizes).toEqual([])
})

test('loops walks take between the same two reference nodes over mostly the same nodes write one span, and a loop two walks take writes it once', () => {
  const graph = loopGraph([
    offReference('a', 30_000),
    offReference('b', 88_000),
    offReference('c', 30_000),
  ])
  const both = {
    nodes: [...graph.nodes, offReference('c2', 9000)],
    edges: [],
    paths: [
      ...graph.paths,
      { name: 'NA21309#1', nodeIds: ['r1', 'a', 'b', 'c', 'r2'] },
      { name: 'HG002#2', nodeIds: ['r1', 'a', 'b', 'c2', 'r2'] },
    ],
  }
  const { sizes } = layoutLabels(
    source({
      nodePositions: { ...loopPositions, c2: loopPositions.c },
      nodeById: nodesById(both.nodes),
      graph: both,
      drawnInk: inkOf({ ...loopPositions, c2: loopPositions.c }),
    }),
  )
  expect(sizes.map(l => [l.node, l.text])).toEqual([['b', '127\u2013148 kb']])
})

test('loops leaving the reference at other nodes over mostly the same nodes write one span, and a loop sharing less than half a longer one writes its own', () => {
  const graph = loopGraph([
    offReference('a', 30_000),
    offReference('b', 88_000),
    offReference('c', 30_000),
  ])
  const r0 = onReference('r0', -1000, 1000)
  const both = {
    nodes: [r0, ...graph.nodes, offReference('c2', 9000)],
    edges: [],
    paths: [
      { name: 'GRCh38', nodeIds: ['r0', 'r1', 'r2'] },
      { name: 'HG00350#1', nodeIds: ['r0', 'r1', 'a', 'b', 'c', 'r2'] },
      { name: 'HG002#2', nodeIds: ['r0', 'a', 'b', 'c2', 'r2'] },
      { name: 'HG003#1', nodeIds: ['r1', 'a', 'r2'] },
    ],
  }
  const positions = {
    ...loopPositions,
    r0: [
      { x: 0, y: 380 },
      { x: 0, y: 300 },
    ],
    c2: loopPositions.c,
  }
  const { sizes } = layoutLabels(
    source({
      nodePositions: positions,
      nodeById: nodesById(both.nodes),
      graph: both,
      drawnInk: inkOf(positions),
    }),
  )
  expect(sizes.map(l => [l.node, l.text])).toEqual([
    ['b', '127\u2013148 kb'],
    ['a', '30 kb'],
  ])
})

test('loops between the same two reference nodes over other nodes each write their own length', () => {
  const graph = loopGraph([
    offReference('a', 30_000),
    offReference('b', 88_000),
    offReference('c', 30_000),
  ])
  const other = offReference('d', 6000)
  const both = {
    nodes: [...graph.nodes, other],
    edges: [],
    paths: [...graph.paths, { name: 'HG002#2', nodeIds: ['r1', 'd', 'r2'] }],
  }
  const positions = {
    ...loopPositions,
    d: [
      { x: 200, y: 300 },
      { x: 400, y: 370 },
      { x: 600, y: 300 },
    ],
  }
  const { sizes } = layoutLabels(
    source({
      nodePositions: positions,
      nodeById: nodesById(both.nodes),
      graph: both,
      drawnInk: inkOf(positions),
    }),
  )
  expect(sizes.map(l => [l.node, l.text])).toEqual([
    ['b', '148 kb'],
    ['d', '6 kb'],
  ])
})

// sv-49 wrote "634 bp" over the knot where other nodes meet its loop, and
// sv-37 "216–283 bp" over a node on the reference line
test("a loop's length over another node's ink moves along its loop to a spot clear of it", () => {
  const graph = bigLoop()
  const positions = {
    ...loopPositions,
    x: [
      { x: 400, y: 60 },
      { x: 400, y: 140 },
    ],
  }
  const { sizes } = layoutLabels(
    source({
      nodePositions: positions,
      nodeById: nodesById(graph.nodes),
      graph,
      drawnInk: inkOf(positions),
    }),
  )
  expect(sizes.map(l => [l.text, l.x, l.y, l.leader])).toEqual([
    ['148 kb', 300, 100, undefined],
  ])
})

const crossings = (spots: NodeSegment[]) =>
  Object.fromEntries(
    spots.map(({ x, y }, k) => [
      `x${k}`,
      [
        { x: x - 10, y: y - 10 },
        { x: x + 10, y: y + 10 },
      ],
    ]),
  )

// every spot along the loop that a length may take, a node crossing each
const everySpot = [
  { x: 400, y: 100 },
  { x: 300, y: 100 },
  { x: 500, y: 100 },
  { x: 200, y: 100 },
  { x: 600, y: 100 },
  { x: 200, y: 200 },
  { x: 600, y: 200 },
]

test("a loop's length with every spot along its loop over another node's ink stands off the loop's middle on a leader, clear of all ink", () => {
  const graph = bigLoop()
  const positions = { ...loopPositions, ...crossings(everySpot) }
  const { sizes } = layoutLabels(
    source({
      nodePositions: positions,
      nodeById: nodesById(graph.nodes),
      graph,
      drawnInk: inkOf(positions),
    }),
  )
  const [length] = sizes
  expect(length?.text).toBe('148 kb')
  expect(length?.leader).toEqual({ x: 400, y: 100 })
  for (const points of Object.values(positions)) {
    points.forEach((b, k) => {
      const a = points[k - 1]
      expect(a && meetsBox(a, b, chipBox(length!), 3)).toBeFalsy()
    })
  }
})

// sv-19 wrote "252 bp" over a dashed skip and two crossing strokes
test("a loop's length keeps off a link that is not its loop's", () => {
  const graph = { ...bigLoop(), edges: [{ from: 'r1', to: 'r2' }] }
  const from = { x: 380, y: 40 }
  const to = { x: 420, y: 160 }
  const at = (links: BezierCurve[]) =>
    layoutLabels(
      source({
        nodePositions: loopPositions,
        nodeById: nodesById(graph.nodes),
        graph,
        drawnInk: inkOf(loopPositions, links),
      }),
    ).sizes
  const [alone] = at([])
  expect(meetsBox(from, to, chipBox(alone!), 1)).toBe(true)
  const [length] = at([straight(from, to)])
  expect(length?.text).toBe('148 kb')
  expect(meetsBox(from, to, chipBox(length!), 1)).toBe(false)
})

// sv-26's "1.4–1.5 kb" left its loop for the nodes of the shorter loop the
// span names
test("a loop's length may cover the walks' loops drawn over it, whose lengths its span writes", () => {
  const graph = bigLoop()
  const both = {
    nodes: [...graph.nodes, offReference('c2', 9000)],
    edges: [],
    paths: [
      ...graph.paths,
      { name: 'HG002#2', nodeIds: ['r1', 'a', 'b', 'c2', 'r2'] },
    ],
  }
  const positions = {
    ...loopPositions,
    c2: [
      { x: 400, y: 60 },
      { x: 400, y: 140 },
    ],
  }
  const { sizes } = layoutLabels(
    source({
      nodePositions: positions,
      nodeById: nodesById(both.nodes),
      graph: both,
      drawnInk: inkOf(positions),
    }),
  )
  expect(sizes.map(l => [l.text, l.x, l.y, l.leader])).toEqual([
    ['127\u2013148 kb', 400, 100, undefined],
  ])
})

// sv-7 wrote "230 kb" over a curl at the foot of its own loop
test("a loop drawn back on itself under its length's box stands it off the loop, as only one stretch of its own stroke may run under the text", () => {
  const graph = bigLoop()
  const positions = {
    ...loopPositions,
    a: [
      { x: 200, y: 300 },
      { x: 200, y: 100 },
    ],
    b: [
      { x: 200, y: 100 },
      { x: 600, y: 100 },
      { x: 600, y: 108 },
      { x: 220, y: 108 },
    ],
    c: [
      { x: 220, y: 108 },
      { x: 220, y: 300 },
    ],
  }
  const { sizes } = layoutLabels(
    source({
      nodePositions: positions,
      nodeById: nodesById(graph.nodes),
      graph,
      drawnInk: inkOf(positions),
    }),
  )
  const [length] = sizes
  expect(length?.text).toBe('148 kb')
  expect(length?.leader).toBeDefined()
  expect(chipBox(length!).y1 < 97 || chipBox(length!).y0 > 111).toBe(true)
})

test("a loop's length with no spot along its loop or off it clear of ink is not written, and the key does not count it", () => {
  const graph = bigLoop()
  const rules = Object.fromEntries(
    Array.from({ length: 41 }, (_, k) => [
      `rule${k}`,
      [
        { x: 0, y: k * 10 + 5 },
        { x: 800, y: k * 10 + 5 },
      ],
    ]),
  )
  const positions = { ...loopPositions, ...rules }
  const { sizes, unlabelled } = layoutLabels(
    source({
      nodePositions: positions,
      nodeById: nodesById(graph.nodes),
      graph,
      drawnInk: inkOf(positions),
    }),
  )
  expect(sizes).toEqual([])
  expect(unlabelled).toBeUndefined()
})

test('a loop writes no length without the drawing it would stand on', () => {
  const graph = bigLoop()
  const { sizes } = layoutLabels(
    source({
      nodePositions: loopPositions,
      nodeById: nodesById(graph.nodes),
      graph,
    }),
  )
  expect(sizes).toEqual([])
})

// a host that rebuilds its batch reads it again only for a drawing that
// writes a loop's length
test('a graph whose walks make no loop does not read the drawn ink', () => {
  const graph = {
    ...bigLoop(),
    paths: [{ name: 'GRCh38', nodeIds: ['r1', 'r2'] }],
  }
  let reads = 0
  const layoutWith = (g: typeof graph) =>
    layoutLabels({
      ...source({
        nodePositions: loopPositions,
        nodeById: nodesById(g.nodes),
        graph: g,
      }),
      get drawnInk() {
        reads++
        return inkOf(loopPositions)
      },
    })
  expect(layoutWith(graph).sizes).toEqual([])
  expect(reads).toBe(0)
  expect(layoutWith(bigLoop()).sizes.map(l => l.text)).toEqual(['148 kb'])
  expect(reads).toBe(1)
})

// sv-16 at its fit wrote several "1 bp" lengths along the reference
test("a loop whose bp at the reference's px a bp comes to less than SMALL_SITE_PX writes no length, and writes it at the zoom where it comes to that", () => {
  const graph = loopGraph([
    offReference('a', 1),
    offReference('b', 1),
    offReference('c', 1),
  ])
  const at = (scale: number) =>
    layoutLabels(
      source({
        nodePositions: loopPositions,
        axisScale: { scaleX: scale, scaleY: scale },
        translateX: 400 - 400 * scale,
        translateY: 200 - 100 * scale,
        nodeById: nodesById(graph.nodes),
        graph,
        drawnInk: inkOf(loopPositions),
      }),
    ).sizes.map(l => l.text)
  // the reference's 4000 bp drawn 400 px long at scale 1, and the loop's 3 bp
  const comesTo = (SMALL_SITE_PX * 4000) / (3 * 400)
  expect(at(1)).toEqual([])
  expect(at(comesTo * 0.99)).toEqual([])
  expect(at(comesTo)).toEqual(['3 bp'])
})

test('a folded node under a label moves it no more than no node there would', () => {
  const [, alone] = layoutLabels(source(covered())).sizes
  expect(alone?.leader).toBeDefined()
  const under = covered({
    a1: [
      { x: alone!.x - 4, y: alone!.y },
      { x: alone!.x + 4, y: alone!.y },
    ],
  })
  const [, drawn] = layoutLabels(source(under)).sizes
  expect(drawn?.y).not.toBe(alone?.y)
  const [, folded] = layoutLabels(
    source({ ...under, folded: new Set(['a1']) }),
  ).sizes
  expect(folded).toEqual(alone)

  const at = { x: 300, y: 100 }
  const bb = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
  ]
  const [gene] = layoutLabels(
    source({ genePins: [pin(at)], nodePositions: { bb } }),
  ).genes
  const onGene = {
    bb,
    a1: [
      { x: gene!.x - 4, y: gene!.y - 4 },
      { x: gene!.x + 4, y: gene!.y - 4 },
    ],
  }
  const [moved] = layoutLabels(
    source({ genePins: [pin(at)], nodePositions: onGene }),
  ).genes
  expect([moved?.x, moved?.y]).not.toEqual([gene?.x, gene?.y])
  const [kept] = layoutLabels(
    source({
      genePins: [pin(at)],
      nodePositions: onGene,
      folded: new Set(['a1']),
    }),
  ).genes
  expect([kept?.x, kept?.y]).toEqual([gene?.x, gene?.y])
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

// sv-31's window, 8.2 kb inside PRKN's 1.38 Mb, was labelled "PRKN · 0 of
// 1.4 Mb", and a pggb copy holding 3 bp of its 5.6 kb "0 of 5.6 kb"
test('a gene the cut holds a sliver of says how much in the unit of the sliver, never 0', () => {
  const at = { x: 300, y: 200 }
  const gene = (end: number, held: number) => ({
    ...pin(at),
    gene: { ...pin(at).gene, name: 'PRKN', start: 0, end },
    covered: held / end,
  })
  expect(geneCoverageNote(gene(1_380_350, 8231))).toBe('8.2 kb of 1.4 Mb')
  expect(geneCoverageNote(gene(5603, 3))).toBe('3 bp of 5.6 kb')
  expect(geneCoverageNote(gene(5603, 1000))).toBe('1 of 5.6 kb')
  expect(geneCoverageNote(gene(20_000_000, 19_000_000))).toBe('19 of 20 Mb')
  expect(geneCoverageNote(gene(1_380_350, 1_352_000))).toBeUndefined()
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

// BandageJS's E. coli example pinned some 350 names, each the others crowded
// out of its stack sent to the nearest free spot with a leader, and the graph
// went under them
test('a dense gene track names the genes its stacked rows hold, and only a ration of the others crowded out stands apart with a leader', () => {
  const nodePositions = {
    bb: [
      { x: 0, y: 100 },
      { x: 800, y: 100 },
    ],
  }
  const pins = Array.from({ length: 40 }, (_, i) => {
    const p = pin({ x: 200 + i * 10, y: 100 })
    return {
      ...p,
      gene: { ...p.gene, name: `gene${String(i).padStart(2, '0')}` },
    }
  })
  const { genes } = layoutLabels(source({ genePins: pins, nodePositions }))
  const row = 11 + 2 * LABEL_PAD
  const stackRows = [124, 124 + row, 124 + 2 * row, 87, 87 - row, 87 - 2 * row]
  const inStack = genes.filter(
    label =>
      stackRows.includes(label.y) &&
      Math.abs(label.x - label.item.pin.at.x) < label.w / 2 + 0.01,
  )
  expect(inStack.length).toBeGreaterThan(0)
  expect(genes.length - inStack.length).toBeLessThanOrEqual(
    nodeLabelBudget(800, 400),
  )
  expect(genes.length).toBeLessThan(pins.length)
})

// The plugin's CFH cut, 30 bp across a 1600 by 160 pane, pins CFH and CFHR1-3
// on one point at the pane's top: its stack holds three names, the pane above
// it none, and the others were dropped though the pane is nearly empty
test('genes pinned on one point that its stack cannot hold are all named, with leaders, in a pane with room for them', () => {
  const at = { x: 800, y: 10 }
  const nodePositions = {
    bb: [
      { x: 0, y: 10 },
      { x: 1600, y: 10 },
    ],
  }
  const names = ['CFH', 'CFHR1', 'CFHR2', 'CFHR3', 'CFHR4']
  const pins = names.map(name => ({
    ...pin(at),
    gene: { ...pin(at).gene, name },
  }))
  const { genes } = layoutLabels(
    source({
      genePins: pins,
      nodePositions,
      paneWidth: 1600,
      canvasHeight: 160,
    }),
  )
  expect(genes.map(l => l.text).sort()).toEqual(names)
  for (const label of genes) {
    expect(geneLeader(label, at, 6)).toMatchObject({ x2: at.x })
  }
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

// BandageJS fits the drawing to the whole pane, so a pin can sit under the
// key's column, where every spot by it is reserved; rand-chr10-3 in the
// linear view pinned ANXA8 and FAM25G there, at the cut's end, and led both
// names under the key, FAM25G's across ANXA8's chip
test('a gene pinned under the key column is pinned where the pane shows it, and a gene the key hides is not named', () => {
  const keyLeft = 800 - 2 * LEGEND_INSET_PX - 200
  const at = { x: keyLeft + 100, y: 200 }
  const anxa8 = {
    ...pin(at),
    gene: { ...pin(at).gene, name: 'ANXA8', end: 2000 },
    body: [{ nodeId: 'bb', from: 0, to: 1 }],
  }
  const fam25g = {
    ...pin(at),
    gene: { ...pin(at).gene, name: 'FAM25G' },
    nodeIds: new Set(['end']),
    body: [{ nodeId: 'end', from: 0, to: 1 }],
  }
  const layout = layoutLabels(
    source({
      genePins: [anxa8, fam25g],
      nodePositions: {
        bb: [
          { x: keyLeft - 100, y: 200 },
          { x: keyLeft + 50, y: 200 },
        ],
        end: [
          { x: keyLeft + 50, y: 200 },
          { x: 780, y: 200 },
        ],
      },
      legendSize: { width: 200, height: 40 },
    }),
  )
  expect(layout.genes.map(l => [l.text, l.item.pin.at])).toEqual([
    ['ANXA8', { x: keyLeft, y: 200 }],
  ])
  const [label] = layout.genes
  expect(label!.x + label!.w / 2).toBeLessThanOrEqual(keyLeft)
})

// rand-chr18-1's view lies inside CELF4, whose middle is off the pane's
// left edge; its name was dropped
test('a gene whose pin is off the pane is named at the nearest point of it the pane shows', () => {
  const at = { x: -400, y: 200 }
  const celf4 = {
    ...pin(at),
    gene: { ...pin(at).gene, name: 'CELF4' },
    body: [{ nodeId: 'bb', from: 0, to: 1 }],
  }
  const layout = layoutLabels(
    source({
      genePins: [celf4],
      nodePositions: {
        bb: [
          { x: -700, y: 200 },
          { x: 300, y: 200 },
        ],
      },
    }),
  )
  expect(layout.genes.map(l => [l.text, l.item.pin.at])).toEqual([
    ['CELF4', { x: 0, y: 200 }],
  ])
})

// Pinned at the pane's left edge, rand-chr18-1's CELF4 read "CELF4 …", as
// did every gene pinned at an edge: a chip slid only whole steps of 8 px,
// short of the half of its width that brings it inside the pane
test('a name pinned at the edge of the pane slides by half its width, so its note stays', () => {
  const at = { x: 0, y: 200 }
  const celf4 = {
    ...pin(at),
    gene: { ...pin(at).gene, name: 'CELF4', end: 323_000 },
    covered: 71_800 / 323_000,
  }
  const [label] = layoutLabels(
    source({
      genePins: [celf4],
      nodePositions: {
        bb: [
          { x: 0, y: 200 },
          { x: 300, y: 200 },
        ],
      },
    }),
  ).genes
  expect(label?.text).toBe('CELF4 · 71.8 of 323 kb')
  expect(label!.x - label!.w / 2).toBe(0)
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

test('row labels past what an argument list holds lay out, the topmost row setting where bubble names go', () => {
  const rows = Array.from({ length: 200_000 }, (_, i) => ({
    label: `row ${i}`,
    y: 1000 + i,
  }))
  const layout = layoutLabels(
    source({
      drawnRowLabels: rows,
      bubbleHalos: [halo({ x: 300, y: 5000 })],
      canvasHeight: 2000,
    }),
  )
  expect(layout.bubbles.map(b => b.y)).toEqual(
    layoutLabels(
      source({
        drawnRowLabels: [rows[0]!],
        bubbleHalos: [halo({ x: 300, y: 5000 })],
        canvasHeight: 2000,
      }),
    ).bubbles.map(b => b.y),
  )
})

// A plain count, where vi.spyOn would keep every one of the hundreds of
// millions of calls a slow search makes
function withMapLookupsCounted<T>(run: () => T) {
  const get: (this: Map<unknown, unknown>, key: unknown) => unknown =
    // oxlint-disable-next-line typescript/unbound-method
    Map.prototype.get
  let lookups = 0
  // oxlint-disable-next-line no-extend-native
  Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) {
    lookups++
    return get.call(this, key)
  }
  try {
    const result = run()
    return { result, lookups }
  } finally {
    // oxlint-disable-next-line no-extend-native
    Map.prototype.get = get
  }
}

// HPRC's amylase cut under the force layout: 15,000 nodes a few layout units
// long along strands 10 px apart, fitted to a track at 0.02 px a unit, where
// no label by a node is clear of the next strand
test('the labels of a 15,000-node drawing fitted to a track lay out in under a million map lookups', () => {
  const kept = placeholders(Array.from({ length: 250 }, () => 3))
  const nodes = Array.from({ length: 15_000 }, (_, n) => {
    const strand = n % 10
    const step = Math.floor(n / 10)
    const x = 5000 + step * 40
    const y = 4000 + strand * 500 + 1000 * Math.sin(step / 200)
    return {
      id: step % 60 === 0 ? `p${(step / 60) * 10 + strand}` : `n${n}`,
      line: [
        { x, y },
        { x: x + 3, y },
      ],
    }
  })
  const genePins = Array.from({ length: 9 }, (_, g) => {
    const middle = nodes[(150 * g + 100) * 10 + 5]!
    return { ...pin(middle.line[0]!), nodeIds: new Set([middle.id]) }
  })
  const { result: layout, lookups } = withMapLookupsCounted(() =>
    layoutLabels(
      source({
        paneWidth: 1588,
        canvasHeight: 322,
        axisScale: { scaleX: 0.02, scaleY: 0.02 },
        translateX: 100,
        translateY: 20,
        legendSize: { width: 219, height: 290 },
        nodePositions: Object.fromEntries(nodes.map(n => [n.id, n.line])),
        nodeLengths: new Map(kept.map(n => [n.id, n.length])),
        nodeById: new Map(kept.map(n => [n.id, n])),
        genePins,
      }),
    ),
  )
  expect(layout.genes).toHaveLength(9)
  expect(layout.sizes).toHaveLength(nodeLabelBudget(1588, 322))
  expect(lookups).toBeLessThan(1_000_000)
})
