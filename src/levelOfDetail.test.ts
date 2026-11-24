import { drawnAlongStable, isAnchored } from './anchoredNodes'
import { deletionDrawing, deletionEdges } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { departureTable, departureTails } from './gfa/departures'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { SMALL_SITE_PX, foldedSites, foldedUnderBp } from './levelOfDetail'
import { haplotypeCount, nodeInk } from './nodeWidths'
import { anchorGraph } from './pathAnchoring'
import { buildGeometry, geometryFold } from './renderer/GeometryBuilder'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { baseEdgeCurves } from './util/edgeCurves'
import { findHoveredEdge, findHoveredNode } from './util/hitDetection'
import { walkLift } from './walkHighlight'
import { MAX_ZOOM } from './zoomLimits'

import type { BuildOptions } from './renderer/GeometryBuilder'
import type { Graph, NodeSegment, PathVisit } from './types'

const load = (lines: string[]) =>
  anchorGraph(convertGFAToGraph(parseGFA(lines.join('\n'))), 'ref')

const bases = (bp: number) => 'A'.repeat(bp)

const at = (x0: number, x1: number, y = 0): NodeSegment[] => [
  { x: x0, y },
  { x: x1, y },
]

const drawings = new WeakMap<Graph, ReturnType<typeof deletionDrawing>>()
const drawingOf = (graph: Graph, show = true) => {
  const held = show ? drawings.get(graph) : undefined
  const drawing = held ?? deletionDrawing(graph, deletionEdges(graph), show)
  if (show && !held) {
    drawings.set(graph, drawing)
  }
  return drawing
}

function build(
  graph: Graph,
  positions: Record<string, NodeSegment[]>,
  scale = 1,
  more: Partial<BuildOptions> = {},
  show = true,
) {
  return buildGeometry({
    ...layoutGeometryInputs(
      { nodePositions: positions },
      drawingOf(graph, show),
    ),
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    axis: { scaleX: scale, scaleY: scale },
    ...more,
  })
}

// a reference stroke too thin to lie over a piece laid off its line, for
// tests of how long a piece is drawn
const hairline = { contigThickness: 0.02 }

const folded = (batch: ReturnType<typeof build>) =>
  [...(batch.collapsed?.nodes ?? [])].toSorted()
const drawnNodes = (batch: ReturnType<typeof build>) =>
  new Set(batch.nodeStrokeRuns.keys())
const edgeIndex = (graph: Graph, from: string, to: string) =>
  graph.edges.findIndex(e => e.from === from && e.to === to)

// a1, `altBp` long, takes the place of r2, `refBp` long, between 1 kb
// flanks, drawn one layout unit a bp, so the reference's px per bp is the
// scale; a1 is laid `rise` units off the reference
function snp(
  altBp: number,
  refBp: number,
  walks = ['W\talt\t1\tchr\t0\t*\t>r1>a1>r3'],
  rise = 1,
) {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    `S\tr2\t${bases(refBp)}`,
    `S\tr3\t${bases(1000)}`,
    `S\ta1\t${bases(altBp)}`,
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    `W\tref\t0\tchr\t0\t${2000 + refBp}\t>r1>r2>r3`,
    ...walks,
  ])
  return {
    graph,
    positions: {
      'r1+': at(0, 1000),
      'r2+': at(1000, 1000 + refBp),
      'r3+': at(1000 + refBp, 2000 + refBp),
      'a1+': at(1000, 1000 + altBp, rise),
    },
  }
}

// a skip over r2, `bp` long, between 1 kb flanks
function skip(bp: number, walks = ['W\tdel\t1\tchr\t0\t*\t>r1>r3']) {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    `S\tr2\t${bases(bp)}`,
    `S\tr3\t${bases(1000)}`,
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\tr3\t+\t0M',
    `W\tref\t0\tchr\t0\t${2000 + bp}\t>r1>r2>r3`,
    ...walks,
  ])
  return {
    graph,
    positions: {
      'r1+': at(0, 1000),
      'r2+': at(1000, 1000 + bp),
      'r3+': at(1000 + bp, 2000 + bp),
    },
  }
}

test('a site is small under SMALL_SITE_PX, which is 3 px', () => {
  expect(SMALL_SITE_PX).toBe(3)
})

// The fold measured a piece as drawn, and the force layout draws a node
// shorter than its bp, which folded a 312 bp insertion at R100k-01, and
// longer, which drew a 3 bp site as a curl at overview
describe("a piece folds by its bp at the reference's px a bp, under SMALL_SITE_PX, whatever length it is drawn", () => {
  test.each([
    [1, 1, 1.49, true],
    [1, 1, 1.51, false],
    [1, 10, 0.27, true],
    [1, 10, 0.28, false],
    [10, 1, 0.27, true],
    [10, 1, 0.28, false],
  ])(
    'a %i bp allele in place of %i bp, at %f px a bp, folds: %s',
    (altBp, refBp, scale, isFolded) => {
      const { graph, positions } = snp(altBp, refBp, undefined, 0)
      const batch = build(graph, positions, scale, hairline)
      expect(folded(batch)).toEqual(isFolded ? ['a1+'] : [])
      expect(drawnNodes(batch).has('a1+')).toBe(!isFolded)
      expect(batch.collapsed?.edges.size).toBe(isFolded ? 2 : 0)
      expect(batch.edgeCurveRuns.size).toBe(isFolded ? 2 : 4)
    },
  )

  test('an allele laid far off the reference, drawn long, folds with the same allele laid on it', () => {
    const near = snp(1, 1, undefined, 0)
    const far = snp(1, 1, undefined, 20)
    for (const [scale, isFolded] of [
      [0.1, true],
      [1.4, true],
      [1.6, false],
    ] as const) {
      for (const { graph, positions } of [near, far]) {
        expect(folded(build(graph, positions, scale, hairline))).toEqual(
          isFolded ? ['a1+'] : [],
        )
      }
    }
  })

  test('a skip is drawn as its link and the reference it skips', () => {
    const { graph, positions } = skip(2)
    for (const [scale, isFolded] of [
      [0.5, true],
      [10, false],
    ] as const) {
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.sites.map(s => s.edges)).toEqual(
        isFolded ? [[2]] : [],
      )
      expect(batch.edgeCurveRuns.has(2)).toBe(!isFolded)
      expect(drawnNodes(batch)).toEqual(new Set(['r1+', 'r2+', 'r3+']))
    }
  })

  test('a skip whose ends the layout set together is measured by the bp it skips, never by the distance between its ends', () => {
    const { graph } = skip(1000)
    // r2 laid as a loop, r1's end and r3's start at one point
    const looped = {
      'r1+': at(0, 1000),
      'r2+': [
        { x: 1000, y: 0 },
        { x: 1500, y: 1000 },
        { x: 1000, y: 0 },
      ],
      'r3+': at(1000, 2000),
    }
    const batch = build(graph, looped, 0.003)
    expect(1000 * batch.collapsed!.pxPerBp).toBeGreaterThan(SMALL_SITE_PX)
    expect(batch.collapsed?.sites).toEqual([])
    // its ends together on screen, it holds no arch and is counted as such
    expect(batch.collapsed?.tooShort.has(2)).toBe(true)
  })

  // R100k-01: a 312 bp insertion, drawn a few px long by the force layout,
  // folded at a 100 kb window where its bp comes to 3 px
  test('a 312 bp insertion drawn a px long at a 100 kb window, where its bp comes to over SMALL_SITE_PX, is drawn', () => {
    const graph = load([
      `S\tr1\t${bases(50_000)}`,
      `S\tr2\t${bases(50_000)}`,
      `S\ti1\t${bases(312)}`,
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr1\t+\ti1\t+\t0M',
      'L\ti1\t+\tr2\t+\t0M',
      'W\tref\t0\tchr\t0\t100000\t>r1>r2',
      'W\talt\t1\tchr\t0\t100312\t>r1>i1>r2',
    ])
    const positions = {
      'r1+': at(0, 50_000),
      'r2+': at(50_000, 100_000),
      'i1+': at(50_000, 50_100, 10),
    }
    const scale = 1000 / 100_000
    const batch = build(graph, positions, scale)
    expect(100 * scale).toBeLessThan(SMALL_SITE_PX)
    expect(312 * batch.collapsed!.pxPerBp).toBeGreaterThanOrEqual(SMALL_SITE_PX)
    expect(folded(batch)).toEqual([])
    expect(drawnNodes(batch).has('i1+')).toBe(true)
  })
})

// A reader's key names the fold, and the fit beside that key sets the scale
// the build folds at, so it sizes the key before building
test('geometryFold is the fold the build makes, ahead of it and kept for it', () => {
  const { graph, positions } = snp(1, 1, undefined, 0)
  const options = {
    ...layoutGeometryInputs({ nodePositions: positions }, drawingOf(graph)),
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform' as const,
    contigThickness: 0.02,
    connectorThickness: 2,
    drawPaths: false,
    axis: { scaleX: 1.3, scaleY: 1.3 },
  }
  const fold = geometryFold(options)
  expect([...fold.nodes]).toEqual(['a1+'])
  expect(buildGeometry(options).collapsed).toBe(fold)
  expect(geometryFold({ ...options, smallSites: 'nodes' }).sites).toEqual([])
})

// A curl the force layout drew of a site a few bp long, at overview, larger
// on screen than SMALL_SITE_PX, read as sequence
test('a site drawn longer than SMALL_SITE_PX folds while its bp comes to less, and comes back at the deepest zoom', () => {
  const { graph, positions: laid } = snp(1, 1)
  const positions = { ...laid, 'a1+': at(1000, 1100, 30) }
  const batch = build(graph, positions, 0.2, hairline)
  expect(polylineLength(positions['a1+']) * 0.2).toBeGreaterThan(SMALL_SITE_PX)
  expect(folded(batch)).toEqual(['a1+'])
  expect(folded(build(graph, positions, MAX_ZOOM, hairline))).toEqual([])
})

const polylineLength = (line: NodeSegment[]) =>
  line.reduce(
    (sum, p, i) =>
      i === 0
        ? 0
        : sum + Math.hypot(p.x - line[i - 1]!.x, p.y - line[i - 1]!.y),
    0,
  )

// two 1 bp sites side by side on the reference's line, a1 for r2 and b1 for
// r3, with the reference's link from r2 to r3 laid 30 units long under them
test("the reference's link drawn along a run of folded sites is the reference, never painted over the nodes, though as a plain link along the alleles it is", () => {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    'S\tr2\tC',
    'S\tr3\tC',
    `S\tr4\t${bases(1000)}`,
    'S\ta1\tT',
    'S\tb1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr3\t+\tr4\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'L\tr2\t+\tb1\t+\t0M',
    'L\tb1\t+\tr4\t+\t0M',
    'W\tref\t0\tchr\t0\t2002\t>r1>r2>r3>r4',
    'W\tw\t1\tchr\t0\t*\t>r1>a1>r3>r4',
    'W\tv\t1\tchr\t0\t*\t>r1>r2>b1>r4',
  ])
  const positions = {
    'r1+': at(0, 1000),
    'r2+': at(1000, 1001),
    'r3+': at(1031, 1032),
    'r4+': at(1032, 2032),
    'a1+': at(1000, 1031, 0.5),
    'b1+': at(1001, 1032, -0.5),
  }
  const link = edgeIndex(graph, 'r2+', 'r3+')
  const alongAt = (scale: number) => {
    const batch = build(graph, positions, scale)
    const run = batch.edgeCurveRuns.get(link)
    return {
      batch,
      along: run
        ? batch.edgeCurves
            .slice(run.start, run.start + run.count)
            .some(s => s.along)
        : undefined,
    }
  }
  const zoomedOut = alongAt(0.1)
  expect(zoomedOut.batch.collapsed?.bridges.has(link)).toBe(true)
  expect(zoomedOut.along).toBe(false)
  const zoomedIn = alongAt(2)
  expect(zoomedIn.batch.collapsed?.sites).toEqual([])
  expect(zoomedIn.along).toBe(true)
})

test('a skip is measured by how far apart on the reference its ends are, whatever of the skipped reference the cut holds', () => {
  const graph = convertGFAToGraph(
    parseGFA(
      [
        `S\tr1\t${bases(1000)}\tSN:Z:chr\tSO:i:0\tSR:i:0`,
        `S\tr3\t${bases(1000)}\tSN:Z:chr\tSO:i:51000\tSR:i:0`,
        'L\tr1\t+\tr3\t+\t0M',
        'W\th1\t1\tchr\t0\t*\t>r1>r3',
      ].join('\n'),
    ),
  )
  const positions = { 'r1+': at(0, 1000), 'r3+': at(1400, 2400) }
  const link = edgeIndex(graph, 'r1+', 'r3+')
  expect(drawingOf(graph).bypassed.has(link)).toBe(true)
  for (const scale of [0.5, 5, 500]) {
    const batch = build(graph, positions, scale)
    expect(batch.collapsed?.sites).toEqual([])
    expect(batch.edgeCurveRuns.has(link)).toBe(true)
  }
  const far = build(graph, positions, 0.00005)
  expect(far.collapsed?.sites).toMatchObject([{ edges: [link], bp: 50_000 }])
})

test('nothing of no bp folds, since no zoom would draw it again', () => {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    `S\tr2\t${bases(1000)}`,
    'S\tx\t*',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr1\t+\tx\t+\t0M',
    'L\tx\t+\tr2\t+\t0M',
    'W\tref\t0\tchr\t0\t2000\t>r1>r2',
    'W\talt\t1\tchr\t0\t*\t>r1>x>r2',
  ])
  expect(graph.nodes.find(n => n.id === 'x+')?.length).toBe(0)
  const positions = {
    'r1+': at(0, 1000),
    'r2+': at(1000, 2000),
    'x+': at(1000, 1001, 20),
  }
  for (const scale of [0.0001, 1]) {
    const batch = build(graph, positions, scale)
    expect(batch.collapsed?.sites).toEqual([])
    expect(drawnNodes(batch).has('x+')).toBe(true)
  }
})

test('a site folds only where the deepest zoom draws it again', () => {
  const { graph, positions } = snp(1, 1)
  const shrunk = (by: number) =>
    Object.fromEntries(
      Object.entries(positions).map(([id, line]) => [
        id,
        line.map(p => ({ x: p.x / by, y: p.y / by })),
      ]),
    )
  expect((2 * MAX_ZOOM) / 10).toBeGreaterThanOrEqual(SMALL_SITE_PX)
  expect((2 * MAX_ZOOM) / 1000).toBeLessThan(SMALL_SITE_PX)
  expect(folded(build(graph, shrunk(10), 1))).toEqual(['a1+'])
  expect(folded(build(graph, shrunk(10), MAX_ZOOM))).toEqual([])
  for (const scale of [1, MAX_ZOOM]) {
    const batch = build(graph, shrunk(1000), scale)
    expect(folded(batch)).toEqual([])
    expect(drawnNodes(batch).has('a1+')).toBe(true)
  }
})

test('a site at exactly SMALL_SITE_PX is drawn', () => {
  const { graph, positions } = snp(2, 2, undefined, 0)
  const exact = build(graph, positions, 0.75)
  expect(exact.collapsed?.pxPerBp).toBe(0.75)
  expect(4 * 0.75).toBe(SMALL_SITE_PX)
  expect(folded(exact)).toEqual([])
  expect(drawnNodes(exact).has('a1+')).toBe(true)
  expect(folded(build(graph, positions, 0.7499))).toEqual(['a1+'])
})

// `count` 1 bp SNPs, each between 200 bp of reference, laid out two ways: a
// straight line one unit a bp, and a winding line like a force layout's, its
// short nodes floored to 15 units, its alleles off on either side at any angle
// and its long nodes drawn longer or shorter than their bp
function snpRun(count: number) {
  const lines = [`S\tr0\t${bases(200)}`]
  const straight: Record<string, NodeSegment[]> = { 'r0+': at(0, 200) }
  const winding: Record<string, NodeSegment[]> = {
    'r0+': [
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 150, y: 0 },
    ],
  }
  const refSteps = ['>r0']
  const altSteps = ['>r0']
  let x = 200
  let wx = 150
  let wy = 0
  for (let i = 1; i <= count; i++) {
    lines.push(`S\ts${i}\tC`, `S\ta${i}\tT`, `S\tr${i}\t${bases(200)}`)
    const prev = `r${i - 1}`
    lines.push(
      `L\t${prev}\t+\ts${i}\t+\t0M`,
      `L\ts${i}\t+\tr${i}\t+\t0M`,
      `L\t${prev}\t+\ta${i}\t+\t0M`,
      `L\ta${i}\t+\tr${i}\t+\t0M`,
    )
    straight[`s${i}+`] = at(x, x + 1)
    straight[`a${i}+`] = at(x, x + 1, i % 2 ? 6 : -6)
    straight[`r${i}+`] = at(x + 1, x + 201)
    const turn = (i * 2.3) % (2 * Math.PI)
    const long = 80 + ((i * 53) % 170)
    winding[`s${i}+`] = [
      { x: wx, y: wy },
      { x: wx + 15, y: wy },
    ]
    winding[`a${i}+`] = [
      { x: wx + 2, y: wy + 12 * Math.sin(turn) },
      { x: wx + 2 + 15 * Math.cos(turn), y: wy + 15 * Math.sin(turn) },
    ]
    winding[`r${i}+`] = [
      { x: wx + 15, y: wy },
      { x: wx + 15 + long / 2, y: wy + (i % 3) * 30 },
      { x: wx + 15 + long, y: wy },
    ]
    refSteps.push(`>s${i}>r${i}`)
    altSteps.push(`>a${i}>r${i}`)
    x += 201
    wx += 15 + long
    wy += i % 2 ? 25 : -10
  }
  lines.push(
    `W\tref\t0\tchr\t0\t*\t${refSteps.join('')}`,
    `W\talt\t1\tchr\t0\t*\t${altSteps.join('')}`,
  )
  return { graph: load(lines), straight, winding }
}

test('identical sites laid alike, anywhere along the reference, all fold or all stay', () => {
  const { graph, straight } = snpRun(12)
  const counts = new Set<number>()
  for (let i = 0; i <= 60; i++) {
    counts.add(folded(build(graph, straight, 0.02 * 1.1 ** i)).length)
  }
  expect(counts).toEqual(new Set([12, 0]))
})

test('identical sites laid differently, drawn at different lengths, fold together by their bp', () => {
  const { graph, winding } = snpRun(12)
  const counts = new Set<number>()
  for (let i = 0; i <= 60; i++) {
    counts.add(folded(build(graph, winding, 0.02 * 1.1 ** i)).length)
  }
  expect(counts).toEqual(new Set([12, 0]))
})

test("every folded site is under the key's N, the fold's threshold, and every site at or over it is drawn", () => {
  const { graph, winding } = snpRun(12)
  for (let i = 0; i <= 40; i++) {
    const fold = build(graph, winding, 0.02 * 1.12 ** i).collapsed!
    const under = foldedUnderBp(fold)
    for (const { bp } of fold.sites) {
      expect(bp).toBeLessThan(under)
    }
    expect(fold.sites.length === 0 || 2 < under).toBe(true)
    expect(fold.sites.length > 0 || 2 * fold.pxPerBp >= SMALL_SITE_PX).toBe(
      true,
    )
  }
})

test('under a monotone zoom each node changes state once at most, zooming in draws again exactly what was folded, and a pan reuses the fold', () => {
  const { graph, winding } = snpRun(12)
  const changes = new Map<string, number>()
  let before = new Set<string>()
  const scales = Array.from({ length: 80 }, (_, i) => 0.01 * 1.08 ** i)
  for (const scale of scales) {
    const now = new Set(build(graph, winding, scale).collapsed?.nodes)
    for (const id of graph.nodes.map(n => n.id)) {
      if (before.has(id) !== now.has(id) && scale !== scales[0]) {
        changes.set(id, (changes.get(id) ?? 0) + 1)
      }
    }
    before = now
  }
  expect(changes.size).toBe(12)
  expect([...changes.values()].every(n => n === 1)).toBe(true)
  const out = build(graph, winding, 0.01)
  const close = build(graph, winding, 50)
  expect(close.collapsed?.nodes.size).toBe(0)
  const restored = [...drawnNodes(close)].filter(id => !drawnNodes(out).has(id))
  expect(restored.toSorted()).toEqual(folded(out))
  expect(close.edgeCurveRuns.size).toBe(graph.edges.length)
  const fold = build(graph, winding, 0.3).collapsed
  expect(build(graph, winding, 0.3).collapsed).toBe(fold)
  build(graph, winding, 0.7)
  expect(build(graph, winding, 0.3).collapsed).toEqual(fold)
})

// p1, `placeholderBp` long and not loaded, joins r1 to a1, which rejoins the
// reference at r3; a2 hangs from p1 alone
function placeholder(placeholderBp: number) {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    'S\tr2\tC',
    `S\tr3\t${bases(1000)}`,
    `S\tp1\t*\tLN:i:${placeholderBp}\tnl:i:1`,
    'S\ta1\tT',
    'S\ta2\tG',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\tp1\t+\t0M',
    'L\tp1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'L\tp1\t+\ta2\t+\t0M',
    'W\tref\t0\tchr\t0\t2001\t>r1>r2>r3',
    'W\talt\t1\tchr\t0\t*\t>r1>p1>a1>r3',
  ])
  return {
    graph,
    positions: {
      'r1+': at(0, 1000),
      'r2+': at(1000, 1001),
      'r3+': at(1001, 2001),
      'p1+': at(1000, 1010, 20),
      'a1+': at(1010, 1011, 20),
      'a2+': at(1010, 1011, 40),
    },
  }
}

test('a not-loaded placeholder under the threshold folds with what hangs from it, and one at or above it stays', () => {
  const small = placeholder(20)
  expect(small.graph.nodes.find(n => n.name === 'p1')?.placeholder).toBe(true)
  const folding = build(small.graph, small.positions, 0.1)
  expect(folded(folding)).toEqual(['a1+', 'a2+', 'p1+'])
  expect(folding.collapsed?.sites).toMatchObject([{ bp: 23, count: 1 }])
  expect(drawnNodes(folding)).toEqual(new Set(['r1+', 'r2+', 'r3+']))
  expect(folded(build(small.graph, small.positions, 3 / 23 + 0.001))).toEqual(
    [],
  )
  const large = placeholder(5000)
  expect(folded(build(large.graph, large.positions, 0.1))).toEqual([])
})

test('nothing on the reference is folded, nor a link turning the reference back on itself', () => {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    'S\tr2\tC',
    `S\tr3\t${bases(1000)}`,
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\tr3\t-\t0M',
    'W\tref\t0\tchr\t0\t2001\t>r1>r2>r3',
    'W\tinv\t1\tchr\t0\t*\t>r1<r3',
  ])
  const positions = {
    'r1+': at(0, 1000),
    'r2+': at(1000, 1001),
    'r3-': at(1001, 2001),
  }
  for (const scale of [0.0001, 0.01, 1]) {
    const batch = build(graph, positions, scale)
    expect(batch.collapsed?.sites).toEqual([])
    expect(drawnNodes(batch)).toEqual(new Set(Object.keys(positions)))
    expect(batch.edgeCurveRuns.has(edgeIndex(graph, 'r1+', 'r3-'))).toBe(true)
  }
})

describe('a piece that turns strand, touching the same end of the reference nodes it attaches to, is never folded', () => {
  test('leaving the start of r1, read against its strand, for the start of r3', () => {
    const graph = load([
      `S\tr1\t${bases(1000)}`,
      'S\tr2\tC',
      `S\tr3\t${bases(1000)}`,
      'S\ta1\tT',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr1\t-\ta1\t+\t0M',
      'L\ta1\t+\tr3\t+\t0M',
      'W\tref\t0\tchr\t0\t2001\t>r1>r2>r3',
      'W\talt\t1\tchr\t0\t*\t<r1>a1>r3',
    ])
    const positions = {
      'r1-': at(0, 1000),
      'r2+': at(1000, 1001),
      'r3+': at(1001, 2001),
      'a1+': at(1000, 1001, 20),
    }
    for (const scale of [0.001, 0.5]) {
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.sites).toEqual([])
      expect(drawnNodes(batch).has('a1+')).toBe(true)
    }
  })

  test('leaving the end of r1 and coming back into the end of r1', () => {
    const graph = load([
      `S\tr1\t${bases(1000)}`,
      `S\tr2\t${bases(1000)}`,
      'S\tx\tT',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr1\t+\tx\t+\t0M',
      'L\tx\t+\tr1\t-\t0M',
      'W\tref\t0\tchr\t0\t2000\t>r1>r2',
      'W\tturn\t1\tchr\t0\t*\t>r1>x<r1',
    ])
    const positions = {
      'r1+': at(0, 1000),
      'r2+': at(1000, 2000),
      'x+': at(1000, 1001, 20),
    }
    for (const scale of [0.5, 0.01]) {
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.sites).toEqual([])
      expect(drawnNodes(batch).has('x+')).toBe(true)
      expect(batch.edgeCurveRuns.size).toBe(graph.edges.length)
    }
  })

  test('leaving the end of r1 and coming into the end of r2', () => {
    const graph = load([
      `S\tr1\t${bases(1000)}`,
      'S\tr2\tC',
      `S\tr3\t${bases(1000)}`,
      'S\tx\tT',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr1\t+\tx\t+\t0M',
      'L\tx\t+\tr2\t-\t0M',
      'W\tref\t0\tchr\t0\t2001\t>r1>r2>r3',
      'W\tturn\t1\tchr\t0\t*\t>r1>x<r2',
    ])
    const positions = {
      'r1+': at(0, 1000),
      'r2+': at(1000, 1001),
      'r3+': at(1001, 2001),
      'x+': at(1000, 1001, 20),
    }
    for (const scale of [0.5, 0.01]) {
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.sites).toEqual([])
      expect(drawnNodes(batch).has('x+')).toBe(true)
      expect(batch.edgeCurveRuns.size).toBe(graph.edges.length)
    }
  })
})

test('a piece with a node the layout did not place is not folded', () => {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    'S\tr2\tC',
    `S\tr3\t${bases(1000)}`,
    'S\ta1\tT',
    'S\ta2\tT',
    'S\ta3\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\ta2\t+\t0M',
    'L\ta2\t+\ta3\t+\t0M',
    'L\ta3\t+\tr3\t+\t0M',
    'W\tref\t0\tchr\t0\t2001\t>r1>r2>r3',
    'W\talt\t1\tchr\t0\t*\t>r1>a1>a2>a3>r3',
  ])
  const positions = {
    'r1+': at(0, 1000),
    'r2+': at(1000, 1001),
    'r3+': at(1001, 2001),
    'a1+': at(1000, 1001, 20),
    'a3+': at(1001, 1002, 20),
  }
  expect(build(graph, positions, 0.01).collapsed?.sites).toEqual([])
  const placed = { ...positions, 'a2+': at(1001, 1001.5, 20) }
  expect(folded(build(graph, placed, 0.01))).toEqual(['a1+', 'a2+', 'a3+'])
})

describe('a piece attached at one end folds only where the cut holds the rest of it', () => {
  // t hangs from the end of r1 alone and y steps it only through a departure
  const lines = [
    `S\tr1\t${bases(1000)}`,
    `S\tr2\t${bases(1000)}`,
    'S\tt\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr1\t+\tt\t+\t0M',
    'W\tref\t0\tchr\t0\t2000\t>r1>r2',
    'W\ty\t1\tchr\t0\t2000\t>r1>r2',
  ]
  const positions = {
    'r1+': at(0, 1000),
    'r2+': at(1000, 2000),
    't+': at(1000, 1001, 20),
  }
  const visited = (leavePos: number, held = lines, stepped = ['t+']) => {
    const graph = load(held)
    const visit: PathVisit = {
      path: 'y#1#chr',
      sample: 'y',
      start: 1000,
      strand: '+',
    }
    const departure = {
      name: 'y#1#chr',
      hapStart: 1000,
      ownBp: 1,
      missingBp: 0,
      leavePos,
      leaveReversed: false,
      leavePasses: 1,
      rejoinPos: 1000,
      rejoinReversed: false,
      rejoinPasses: 1,
      fromSteps: true,
    }
    return {
      ...graph,
      nodes: graph.nodes.map(n =>
        stepped.includes(n.id) ? { ...n, departureVisits: [visit] } : n,
      ),
      departures: {
        ...departureTable([departure]),
        offsets: Int32Array.from([0, stepped.length]),
        steps: Int32Array.from(
          stepped.map(id => graph.nodes.findIndex(n => n.id === id)),
        ),
      },
    }
  }
  const notLoaded = lines.map(line =>
    line === 'S\tt\tT' ? 'S\tt\t*\tLN:i:2\tnl:i:1' : line,
  )

  test('a departure leaving and rejoining inside the cut holds it, and it folds', () => {
    const graph = visited(500)
    expect(departureTails(graph).size).toBe(0)
    expect(folded(build(graph, positions, 0.01))).toEqual(['t+'])
  })

  test('a departure leaving from past the cut, the window holding only its way back, keeps it drawn', () => {
    const graph = visited(-93_000)
    expect([...departureTails(graph)]).toEqual(['t+'])
    for (const scale of [0.01, 0.5]) {
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.sites).toEqual([])
      expect(drawnNodes(batch).has('t+')).toBe(true)
    }
  })

  test("a departure from past the cut whose way back the cut did not load folds by the bp it states at the reference's px a bp, and is drawn again from where that comes to SMALL_SITE_PX", () => {
    const graph = visited(-93_000, notLoaded)
    expect(graph.nodes.find(n => n.id === 't+')).toMatchObject({
      length: 2,
      placeholder: true,
    })
    expect([...departureTails(graph)]).toEqual(['t+'])
    for (const scale of [0.01, 1.4999]) {
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.sites).toMatchObject([
        { nodes: ['t+'], bp: 2, count: 1 },
      ])
      expect(drawnNodes(batch).has('t+')).toBe(false)
    }
    for (const scale of [1.5, MAX_ZOOM]) {
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.sites).toEqual([])
      expect(drawnNodes(batch).has('t+')).toBe(true)
    }
  })

  test('a departure from past the cut leaving by a loaded node keeps it drawn with the stretch the cut did not load', () => {
    const graph = visited(
      -93_000,
      [...lines, 'S\tu\t*\tLN:i:2\tnl:i:1', 'L\tt\t+\tu\t+\t0M'],
      ['t+', 'u+'],
    )
    expect([...departureTails(graph)].toSorted()).toEqual(['t+', 'u+'])
    const batch = build(graph, { ...positions, 'u+': at(1001, 1002, 40) }, 0.01)
    expect(batch.collapsed?.sites).toEqual([])
    expect(drawnNodes(batch)).toEqual(new Set(['r1+', 'r2+', 't+', 'u+']))
  })
})

const idOf = (graph: Graph, name: string) =>
  graph.nodes.find(n => n.name === name)?.id ?? name

describe('the reference is the nodes the cut loaded on it', () => {
  // p, 5 kb the cut did not load, lies on the reference between r1 and r3
  // and is drawn 10 units; a1 joins r1 to p, and a skip joins r0 to p over
  // r1's 1 bp
  const graph = load([
    `S\tr0\t${bases(1000)}`,
    'S\tr1\tC',
    'S\tp\t*\tLN:i:5000\tnl:i:1',
    `S\tr3\t${bases(1000)}`,
    'S\ta1\tT',
    'L\tr0\t+\tr1\t+\t0M',
    'L\tr1\t+\tp\t+\t0M',
    'L\tp\t+\tr3\t+\t0M',
    'L\tr0\t+\tp\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tp\t+\t0M',
    'W\tref\t0\tchr\t0\t7001\t>r0>r1>p>r3',
    'W\tskip\t1\tchr\t0\t*\t>r0>p>r3',
    'W\talt\t1\tchr\t0\t*\t>r0>r1>a1>p>r3',
  ])
  const positions = {
    'r0+': at(0, 1000),
    'r1+': at(1000, 1001),
    'p+': at(1001, 1011),
    'r3+': at(1011, 2011),
    'a1+': at(1001, 1002, 20),
  }

  test('its px a bp leaves out a reference node the cut did not load', () => {
    expect(graph.nodes.find(n => n.id === 'p+')?.placeholder).toBe(true)
    expect(build(graph, positions, 0.5).collapsed?.pxPerBp).toBeCloseTo(0.5, 9)
  })

  test('a piece or a skip reaching a reference node the cut did not load is drawn', () => {
    const skipToP = edgeIndex(graph, 'r0+', 'p+')
    expect(drawingOf(graph).bypassed.has(skipToP)).toBe(true)
    for (const scale of [0.0001, 0.01]) {
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.sites).toEqual([])
      expect(drawnNodes(batch).has('a1+')).toBe(true)
      expect(
        batch.edgeCurveRuns.has(skipToP) ||
          batch.collapsed?.tooShort.has(skipToP),
      ).toBe(true)
    }
  })
})

test('a piece joining two reference sequences is drawn', () => {
  const graph = convertGFAToGraph(
    parseGFA(
      [
        `S\tr1\t${bases(1000)}\tSN:Z:chrA\tSO:i:0\tSR:i:0`,
        `S\tr3\t${bases(1000)}\tSN:Z:chrB\tSO:i:1000\tSR:i:0`,
        'S\tx\tT',
        'L\tr1\t+\tx\t+\t0M',
        'L\tx\t+\tr3\t+\t0M',
        'W\th1\t1\tchr\t0\t*\t>r1>x>r3',
      ].join('\n'),
    ),
  )
  const positions = {
    'r1+': at(0, 1000),
    'r3+': at(1001, 2001),
    'x+': at(1000, 1001, 20),
  }
  const batch = build(graph, positions, 0.0001)
  expect(batch.collapsed?.sites).toEqual([])
  expect(drawnNodes(batch).has('x+')).toBe(true)
})

test('a piece whose link onto the reference has no curve, the layout not having placed that reference node, is drawn', () => {
  const { graph, positions } = snp(1, 1)
  const { 'r3+': _, ...placed } = positions
  const batch = build(graph, placed, 0.0001)
  expect(batch.edgeCurveRuns.has(edgeIndex(graph, 'a1+', 'r3+'))).toBe(false)
  expect(batch.collapsed?.sites).toEqual([])
  expect(drawnNodes(batch).has('a1+')).toBe(true)
})

test("the reference's px a bp is the length its nodes are drawn on screen, whichever way they run and however each axis is scaled", () => {
  const { graph } = snp(1, 1)
  const along = (x0: number, y0: number, bp: number) => [
    { x: x0, y: y0 },
    { x: x0 + 0.6 * bp, y: y0 + 0.8 * bp },
  ]
  const positions = {
    'r1+': along(0, 0, 1000),
    'r2+': along(600, 800, 1),
    'r3+': along(600.6, 800.8, 1000),
    'a1+': along(620, 800, 1),
  }
  const axis = { scaleX: 0.5, scaleY: 0.25 }
  const batch = build(graph, positions, 1, { axis })
  expect(batch.collapsed?.pxPerBp).toBeCloseTo(Math.hypot(0.3, 0.2), 9)
})

test('a piece leaving a reference node the reference reads reversed attaches at the end the reference leaves it by', () => {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    `S\tr2\t${bases(1000)}`,
    'S\tr3\tC',
    `S\tr4\t${bases(1000)}`,
    'S\ta1\tT',
    'L\tr1\t+\tr2\t-\t0M',
    'L\tr2\t-\tr3\t+\t0M',
    'L\tr3\t+\tr4\t+\t0M',
    'L\tr2\t-\ta1\t+\t0M',
    'L\ta1\t+\tr4\t+\t0M',
    'W\tref\t0\tchr\t0\t3001\t>r1<r2>r3>r4',
    'W\talt\t1\tchr\t0\t*\t>r1<r2>a1>r4',
  ])
  const r2 = graph.nodes.find(n => n.name === 'r2')
  expect(r2?.stable?.strand).toBe('-')
  const positions = {
    [idOf(graph, 'r1')]: at(0, 1000),
    [idOf(graph, 'r2')]: at(1000, 2000),
    [idOf(graph, 'r3')]: at(2000, 2001),
    [idOf(graph, 'r4')]: at(2001, 3001),
    [idOf(graph, 'a1')]: at(2000, 2001, 20),
  }
  const [site] = build(graph, positions, 0.01).collapsed?.sites ?? []
  expect(site).toMatchObject({
    nodes: [idOf(graph, 'a1')],
    start: 2000,
    end: 2001,
    bp: 2,
  })
})

test('a site no shown walk steps is drawn, an allele or a skip', () => {
  const allele = snp(1, 1, [])
  expect(folded(build(allele.graph, allele.positions, 0.01))).toEqual([])
  expect(
    drawnNodes(build(allele.graph, allele.positions, 0.01)).has('a1+'),
  ).toBe(true)
  const skipped = skip(1, [])
  const batch = build(skipped.graph, skipped.positions, 0.01)
  expect(batch.collapsed?.sites).toEqual([])
  expect(batch.edgeCurveRuns.has(2) || batch.collapsed?.tooShort.has(2)).toBe(
    true,
  )
})

test('the fold follows the skips the drawing holds and hides, on the same graph and curves', () => {
  const { graph, positions } = skip(1)
  const axis = { scaleX: 0.01, scaleY: 0.01 }
  const { deletions } = layoutGeometryInputs(
    { nodePositions: positions },
    drawingOf(graph),
  )
  const curvesAt = (version: number) =>
    baseEdgeCurves(positions, graph, axis, deletions, version)
  const skipsOf = (
    curves: ReturnType<typeof curvesAt>,
    held: typeof deletions | undefined,
    hidden?: Set<number>,
  ) =>
    foldedSites(graph, positions, axis, curves, held, hidden).sites.map(
      s => s.edges,
    )
  const curves = curvesAt(0)
  expect(skipsOf(curves, deletions)).toEqual([[2]])
  expect(skipsOf(curves, deletions, new Set([2]))).toEqual([])
  expect(skipsOf(curvesAt(1), undefined)).toEqual([])
  expect(skipsOf(curvesAt(2), deletions, new Set([2]))).toEqual([])
  expect(skipsOf(curvesAt(3), deletions)).toEqual([[2]])
})

test('a skip the drawing leaves out is not folded', () => {
  const { graph, positions } = skip(1)
  expect(drawingOf(graph, false).hidden.has(2)).toBe(true)
  const batch = build(graph, positions, 0.01, {}, false)
  expect(batch.collapsed?.sites).toEqual([])
  expect(batch.collapsed?.edges.has(2)).toBe(false)
})

describe('a site counts the shown haplotypes stepping it once each, of all of them', () => {
  // a1 and a2 make one off-reference piece, which both of x's contigs step
  const lines = [
    `S\tr1\t${bases(1000)}`,
    'S\tr2\tC',
    `S\tr3\t${bases(1000)}`,
    'S\ta1\tT',
    'S\ta2\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\ta2\t+\t0M',
    'L\ta2\t+\tr3\t+\t0M',
    'W\tref\t0\tchr\t0\t2001\t>r1>r2>r3',
    'W\tx\t1\tchr\t0\t1001\t>r1>a1',
    'W\tx\t1\tchr\t1001\t2002\t>a2>r3',
    'W\ty\t1\tchr\t0\t2001\t>r1>r2>r3',
  ]
  const positions = {
    'r1+': at(0, 1000),
    'r2+': at(1000, 1001),
    'r3+': at(1001, 2001),
    'a1+': at(1000, 1001, 20),
    'a2+': at(1001, 1002, 20),
  }

  test('two nodes of one piece and two contigs of one haplotype count once', () => {
    const graph = load(lines)
    expect(graph.paths?.length).toBe(4)
    const [site] = build(graph, positions, 0.01).collapsed?.sites ?? []
    expect(site).toMatchObject({ nodes: ['a1+', 'a2+'], count: 1, total: 3 })
    expect(site?.total).toBe(haplotypeCount(graph))
  })

  test('a haplotype stepping a piece only through a departure visit counts', () => {
    const graph = load(lines.filter(l => !l.startsWith('W\tx')))
    const unstepped = build(graph, positions, 0.01).collapsed?.sites
    expect(unstepped).toEqual([])
    const visit: PathVisit = {
      path: 'y#1#chr',
      sample: 'y',
      start: 1000,
      strand: '+',
    }
    const visited = {
      ...graph,
      nodes: graph.nodes.map(n =>
        n.id === 'a1+' ? { ...n, departureVisits: [visit] } : n,
      ),
    }
    const [site] = build(visited, positions, 0.01).collapsed?.sites ?? []
    expect(site).toMatchObject({ nodes: ['a1+', 'a2+'], count: 1, total: 2 })
  })
})

test('with walks lifted, a lane stepping a folded site runs straight along the reference there, with no head and no arrow on what was folded', () => {
  const { graph, positions } = snp(1, 1, undefined, 20)
  const highlight = walkLift(graph, [
    { walk: 'ref#0#chr' },
    { walk: 'alt#1#chr', color: { field: 'pass' } },
  ])
  const wide = Object.fromEntries(
    Object.entries(positions).map(([id, line]) => [
      id,
      line.map(p => ({ x: p.x / 50, y: p.y })),
    ]),
  )
  const into = edgeIndex(graph, 'r1+', 'a1+')
  const out = edgeIndex(graph, 'a1+', 'r3+')
  const drawn = build(graph, wide, MAX_ZOOM, { highlight })
  expect(folded(drawn)).toEqual([])
  expect(drawn.arrowRuns.has(into) || drawn.arrowRuns.has(out)).toBe(true)
  expect(drawn.arrows.some(a => a.node === 'a1+')).toBe(true)
  const batch = build(graph, wide, 0.05, { highlight })
  expect(folded(batch)).toEqual(['a1+'])
  expect(batch.nodeStrokeRuns.has('a1+')).toBe(false)
  expect(batch.arrows.filter(a => a.node === 'a1+')).toEqual([])
  expect(batch.arrowRuns.has(into)).toBe(false)
  expect(batch.arrowRuns.has(out)).toBe(false)
  const lanes = [into, out].flatMap(edge => {
    const run = batch.edgeCurveRuns.get(edge)
    return run ? batch.edgeCurves.slice(run.start, run.start + run.count) : []
  })
  expect(lanes.length).toBeGreaterThan(0)
  for (const { curves } of lanes) {
    for (const c of curves) {
      expect(Math.abs(c.y1 - c.y0)).toBeLessThan(1)
      expect(Math.abs(c.cy0 - c.y0)).toBeLessThan(1)
      expect(Math.abs(c.cy1 - c.y0)).toBeLessThan(1)
    }
  }
})

test('with walks lifted, no lane is drawn on a link inside a folded piece', () => {
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    'S\tr2\tC',
    `S\tr3\t${bases(1000)}`,
    'S\ta1\tT',
    'S\ta2\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\ta2\t+\t0M',
    'L\ta2\t+\tr3\t+\t0M',
    'W\tref\t0\tchr\t0\t2001\t>r1>r2>r3',
    'W\talt\t1\tchr\t0\t*\t>r1>a1>a2>r3',
  ])
  const positions = {
    'r1+': at(0, 1000),
    'r2+': at(1000, 1001),
    'r3+': at(1001, 2001),
    'a1+': at(1000, 1001, 0.5),
    'a2+': at(1001, 1002, 0.5),
  }
  const highlight = walkLift(graph, [{ walk: 'alt#1#chr' }])
  const batch = build(graph, positions, 0.5, { highlight })
  expect(folded(batch)).toEqual(['a1+', 'a2+'])
  expect(batch.edgeCurveRuns.has(edgeIndex(graph, 'a1+', 'a2+'))).toBe(false)
  expect(batch.edgeCurveRuns.has(edgeIndex(graph, 'r1+', 'a1+'))).toBe(true)
  expect(batch.edgeCurveRuns.has(edgeIndex(graph, 'a2+', 'r3+'))).toBe(true)
})

test("with walks lifted, each lane across a folded site leaves it as far to the side as it came in, by the reference's lanes there", () => {
  const { graph, positions } = snp(1, 1, [
    'W\talt\t1\tchr\t0\t*\t>r1>a1>r3',
    'W\tw\t2\tchr\t0\t*\t>r1>r2>r3',
    'W\tw\t3\tchr\t0\t*\t>r1>r2>r3',
    'W\tw\t4\tchr\t0\t*\t>r1>r2>r3',
  ])
  const highlight = walkLift(graph, [
    { walk: 'alt#1#chr' },
    { walk: 'w#2#chr' },
  ])
  const batch = build(graph, positions, 0.5, {
    highlight,
    nodeWidth: 'depth',
    contigThickness: 24,
  })
  expect(folded(batch)).toEqual(['a1+'])
  const laneOn = (from: string, to: string) => {
    const run = batch.edgeCurveRuns.get(edgeIndex(graph, from, to))
    return run
      ? batch.edgeCurves
          .slice(run.start, run.start + run.count)
          .find(c => c.walk === 0)
      : undefined
  }
  const into = laneOn('r1+', 'a1+')?.curves
  const out = laneOn('a1+', 'r3+')?.curves
  const onReference = batch.nodeStrokes
    .slice(
      batch.nodeStrokeRuns.get('r1+')!.start,
      batch.nodeStrokeRuns.get('r1+')!.start +
        batch.nodeStrokeRuns.get('r1+')!.count,
    )
    .find(s => s.walk === 0)!.points
  const side = onReference.at(-1)!.y
  expect(side).not.toBeCloseTo(0, 1)
  expect(into?.at(-1)?.y1).toBeCloseTo(side, 1)
  expect(out?.[0]?.y0).toBeCloseTo(side, 1)
})

test('the heads along a lift follow the fold on one graph, layout and lift', () => {
  const { graph, positions } = snp(1, 1, undefined, 20)
  const highlight = walkLift(graph, [
    { walk: 'ref#0#chr' },
    { walk: 'alt#1#chr', color: { field: 'pass' } },
  ])
  const wide = Object.fromEntries(
    Object.entries(positions).map(([id, line]) => [
      id,
      line.map(p => ({ x: p.x / 50, y: p.y })),
    ]),
  )
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const close = build(graph, wide, MAX_ZOOM, { highlight, nodeById })
  expect(close.arrows.some(a => a.node === 'a1+')).toBe(true)
  const batch = build(graph, wide, 0.05, { highlight, nodeById })
  expect(folded(batch)).toEqual(['a1+'])
  expect(batch.arrows.filter(a => a.node === 'a1+')).toEqual([])
})

describe('the drawing through a folded site', () => {
  const lanesOf = (batch: ReturnType<typeof build>, edge: number) => {
    const run = batch.edgeCurveRuns.get(edge)
    return run ? batch.edgeCurves.slice(run.start, run.start + run.count) : []
  }
  const strokesOf = (batch: ReturnType<typeof build>, id: string) => {
    const run = batch.nodeStrokeRuns.get(id)
    return run ? batch.nodeStrokes.slice(run.start, run.start + run.count) : []
  }

  // two 1 bp sites side by side, a1 for r2 and b1 for r3, touching at r2's
  // end, then a third, c1 for r5, with r4 drawn between; r1 is stepped by
  // four walks, r6 by two, and the rest by fewer, so their thicknesses differ
  const graph = load([
    `S\tr1\t${bases(1000)}`,
    'S\tr2\tC',
    'S\tr3\tC',
    `S\tr4\t${bases(30)}`,
    'S\tr5\tC',
    `S\tr6\t${bases(1000)}`,
    'S\ta1\tT',
    'S\tb1\tT',
    'S\tc1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr3\t+\tr4\t+\t0M',
    'L\tr4\t+\tr5\t+\t0M',
    'L\tr5\t+\tr6\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'L\tr2\t+\tb1\t+\t0M',
    'L\tb1\t+\tr4\t+\t0M',
    'L\tr4\t+\tc1\t+\t0M',
    'L\tc1\t+\tr6\t+\t0M',
    'W\tref\t0\tchr\t0\t2033\t>r1>r2>r3>r4>r5>r6',
    'W\tw\t1\tchr\t0\t*\t>r1>a1>r3>r4>c1>r6',
    'W\tw\t2\tchr\t0\t*\t>r1>r2>b1>r4>r5',
    'W\tw\t3\tchr\t0\t*\t>r1>r2>r3>r4',
  ])
  const positions = {
    'r1+': at(0, 1000),
    'r2+': at(1000, 1001),
    'r3+': at(1001, 1002),
    'r4+': at(1002, 1032),
    'r5+': at(1032, 1033),
    'r6+': at(1033, 2033),
    'a1+': at(1000, 1001, 2),
    'b1+': at(1001, 1002, -2),
    'c1+': at(1032, 1033, 2),
  }
  const depth = { nodeWidth: 'depth' as const }
  const thickness = (batch: ReturnType<typeof build>, id: string) =>
    strokesOf(batch, id)[0]?.thickness

  test('the reference through a run of folded sites is one even stroke at the thinner of the drawn nodes at its outer ends, each node in its own colour', () => {
    const drawn = build(graph, positions, 0.1, {
      ...depth,
      smallSites: 'nodes',
    })
    const own = Object.fromEntries(
      ['r1+', 'r2+', 'r3+', 'r4+', 'r5+', 'r6+'].map(id => [
        id,
        thickness(drawn, id),
      ]),
    )
    expect(new Set(Object.values(own)).size).toBeGreaterThan(2)
    const batch = build(graph, positions, 0.1, depth)
    expect(folded(batch)).toEqual(['a1+', 'b1+', 'c1+'])
    const first = Math.min(own['r1+']!, own['r4+']!)
    const second = Math.min(own['r4+']!, own['r6+']!)
    expect(thickness(batch, 'r2+')).toBe(first)
    expect(thickness(batch, 'r3+')).toBe(first)
    expect(thickness(batch, 'r5+')).toBe(second)
    for (const id of ['r1+', 'r4+', 'r6+']) {
      expect(thickness(batch, id)).toBe(own[id])
    }
    const links = [
      ['r1+', 'r2+', first],
      ['r2+', 'r3+', first],
      ['r3+', 'r4+', first],
      ['r4+', 'r5+', second],
      ['r5+', 'r6+', second],
    ] as const
    expect(new Set(batch.collapsed?.bridges.keys())).toEqual(
      new Set(links.map(([from, to]) => edgeIndex(graph, from, to))),
    )
    for (const [from, to, width] of links) {
      const [link] = lanesOf(batch, edgeIndex(graph, from, to))
      expect(link?.thickness).toBe(width)
      expect(link?.color).toBe(strokesOf(batch, from)[0]?.color)
    }
    for (const id of ['r2+', 'r3+', 'r5+']) {
      expect(strokesOf(batch, id)[0]?.color).toBe(
        strokesOf(drawn, id)[0]?.color,
      )
    }
  })

  test('with walks lifted, a link between two reference nodes of touching sites is stated as drawn only by the lanes', () => {
    const highlight = walkLift(graph, [{ walk: 'w#3#chr' }])
    const batch = build(graph, positions, 0.1, { highlight })
    expect(folded(batch)).toEqual(['a1+', 'b1+', 'c1+'])
    expect(batch.laneOnly?.nodes).toEqual(new Set(['r2+', 'r3+']))
    expect(batch.laneOnly?.edges).toEqual(
      new Set([edgeIndex(graph, 'r2+', 'r3+')]),
    )
  })

  test('a run of folded sites keeps to one reference sequence', () => {
    const tagged = convertGFAToGraph(
      parseGFA(
        [
          `S\tr1\t${bases(1000)}\tSN:Z:chrA\tSO:i:0\tSR:i:0`,
          'S\tr2\tC\tSN:Z:chrA\tSO:i:1000\tSR:i:0',
          `S\tr3\t${bases(1000)}\tSN:Z:chrA\tSO:i:1001\tSR:i:0`,
          `S\ts1\t${bases(1000)}\tSN:Z:chrB\tSO:i:0\tSR:i:0`,
          'S\ts2\tC\tSN:Z:chrB\tSO:i:1000\tSR:i:0',
          `S\ts3\t${bases(1000)}\tSN:Z:chrB\tSO:i:1001\tSR:i:0`,
          'S\ta1\tT',
          'S\tb1\tT',
          'L\tr1\t+\tr2\t+\t0M',
          'L\tr2\t+\tr3\t+\t0M',
          'L\ts1\t+\ts2\t+\t0M',
          'L\ts2\t+\ts3\t+\t0M',
          'L\tr1\t+\ta1\t+\t0M',
          'L\ta1\t+\tr3\t+\t0M',
          'L\ts1\t+\tb1\t+\t0M',
          'L\tb1\t+\ts3\t+\t0M',
          'W\th1\t1\tchrA\t0\t*\t>r1>a1>r3',
          'W\th1\t1\tchrB\t0\t*\t>s1>b1>s3',
        ].join('\n'),
      ),
    )
    const laid = {
      'r1+': at(0, 1000),
      'r2+': at(1000, 1001),
      'r3+': at(1001, 2001),
      's1+': at(0, 1000, 100),
      's2+': at(1000, 1001, 100),
      's3+': at(1001, 2001, 100),
      'a1+': at(1000, 1001, 2),
      'b1+': at(1000, 1001, 102),
    }
    const fold = build(tagged, laid, 0.1).collapsed
    expect(new Set(fold?.nodes)).toEqual(new Set(['a1+', 'b1+']))
    expect(fold?.through.get('r2+')).toMatchObject({
      from: ['r1+'],
      to: ['r3+'],
    })
    expect(fold?.through.get('s2+')).toMatchObject({
      from: ['s1+'],
      to: ['s3+'],
    })
  })

  const runLinks = [
    ['r1+', 'r2+'],
    ['r2+', 'r3+'],
    ['r3+', 'r4+'],
  ] as const

  test('the reference through a run whose nodes are all laid within SMALL_SITE_PX of the straight line between its outer attachments is drawn on that line, each point where it is laid nearest', () => {
    // at 0.1 px a unit, r2 and r3 lie up to 0.4 px off the line from r1's
    // end to r4's start, with gaps between them where their links run
    const jogged = {
      ...positions,
      'r2+': [
        { x: 1000.2, y: 4 },
        { x: 1000.6, y: -3 },
      ],
      'r3+': [
        { x: 1001.4, y: -3 },
        { x: 1001.8, y: 2 },
      ],
    }
    const batch = build(graph, jogged, 0.1, depth)
    expect(folded(batch)).toEqual(['a1+', 'b1+', 'c1+'])
    expect(strokesOf(batch, 'r2+')[0]?.points).toEqual([
      { x: 1000.2, y: 0 },
      { x: 1000.6, y: 0 },
    ])
    expect(strokesOf(batch, 'r3+')[0]?.points).toEqual([
      { x: 1001.4, y: 0 },
      { x: 1001.8, y: 0 },
    ])
    for (const [from, to] of runLinks) {
      for (const curve of lanesOf(batch, edgeIndex(graph, from, to))[0]
        ?.curves ?? []) {
        expect([curve.y0, curve.cy0, curve.cy1, curve.y1]).toEqual([0, 0, 0, 0])
      }
    }
    const drawn = build(graph, jogged, 0.1, { ...depth, smallSites: 'nodes' })
    expect(strokesOf(drawn, 'r2+')[0]?.points).toEqual(jogged['r2+'])
  })

  test("a link from a node of a straightened run that is not one of the reference's own leaves the node where it is drawn", () => {
    const skipping = load([
      `S\tr1\t${bases(1000)}`,
      'S\tr2\tC',
      'S\tr3\tC',
      `S\tr4\t${bases(300)}`,
      `S\tr5\t${bases(1000)}`,
      'S\ta1\tT',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr3\t+\tr4\t+\t0M',
      'L\tr4\t+\tr5\t+\t0M',
      'L\tr1\t+\ta1\t+\t0M',
      'L\ta1\t+\tr3\t+\t0M',
      'L\tr2\t+\tr5\t+\t0M',
      'W\tref\t0\tchr\t0\t2302\t>r1>r2>r3>r4>r5',
      'W\tw\t1\tchr\t0\t*\t>r1>a1>r3>r4>r5',
      'W\tw\t2\tchr\t0\t*\t>r1>r2>r5',
    ])
    const laid = {
      'r1+': at(0, 1000),
      'r2+': [
        { x: 1000, y: 5 },
        { x: 1001, y: 5 },
      ],
      'r3+': at(1001, 1002),
      'r4+': at(1002, 1302),
      'r5+': at(1302, 2302),
      'a1+': at(1000, 1001, 2),
    }
    const out = edgeIndex(skipping, 'r2+', 'r5+')
    const batch = build(skipping, laid, 0.1)
    expect(folded(batch)).toEqual(['a1+'])
    expect(batch.collapsed?.bridges.has(out)).toBe(false)
    const end = strokesOf(batch, 'r2+')[0]?.points.at(-1)
    expect(end).toEqual({ x: 1001, y: 0 })
    const [first] = lanesOf(batch, out)[0]?.curves ?? []
    expect({ x: first?.x0, y: first?.y0 }).toEqual(end)
    const drawn = build(skipping, laid, 0.1, { smallSites: 'nodes' })
    const [own] = lanesOf(drawn, out)[0]?.curves ?? []
    expect({ x: own?.x0, y: own?.y0 }).toEqual(laid['r2+'][1])
  })

  describe('the reference through a run meets the drawn nodes at its ends where the reference leaves and enters them, and each node in it runs the way it is laid', () => {
    // r2, 1 bp, between 1 kb flanks, a1 in its place; a layout that draws
    // each node along the strand its id names
    const laidOut = (loaded: Graph) => {
      const along = (name: string, x0: number, x1: number, y = 0) => {
        const node = loaded.nodes.find(n => n.name === name)
        return node && isAnchored(node) && !drawnAlongStable(node)
          ? at(x1, x0, y)
          : at(x0, x1, y)
      }
      return {
        [idOf(loaded, 'r1')]: along('r1', 0, 1000),
        [idOf(loaded, 'r2')]: along('r2', 1000, 1001),
        [idOf(loaded, 'r3')]: along('r3', 1001, 2001),
        [idOf(loaded, 'a1')]: along('a1', 1000, 1001, 0.5),
      }
    }
    test.each([
      {
        name: 'a node at its end read against its strand and laid along the reference',
        lines: [
          'L\tr1\t-\tr2\t+\t0M',
          'L\tr2\t+\tr3\t+\t0M',
          'L\tr1\t-\ta1\t+\t0M',
          'L\ta1\t+\tr3\t+\t0M',
          'W\tref\t0\tchr\t0\t2001\t<r1>r2>r3',
          'W\talt\t1\tchr\t0\t*\t<r1>a1>r3',
        ],
        against: [],
      },
      {
        name: 'every node read against its strand and laid against the reference',
        lines: [
          'L\tr1\t-\tr2\t-\t0M',
          'L\tr2\t-\tr3\t-\t0M',
          'L\tr1\t-\ta1\t-\t0M',
          'L\ta1\t-\tr3\t-\t0M',
          'W\tref\t0\tchr\t0\t2001\t<r1<r2<r3',
          'W\talt\t1\tchr\t0\t*\t<r1<a1<r3',
        ],
        against: ['r1', 'r2', 'r3'],
      },
    ])('$name', ({ lines, against }) => {
      const backwards = load([
        `S\tr1\t${bases(1000)}`,
        'S\tr2\tC',
        `S\tr3\t${bases(1000)}`,
        'S\ta1\tT',
        ...lines,
      ])
      const stepped = backwards.nodes.flatMap(n =>
        isAnchored(n) && n.stable.rank === 0 && !drawnAlongStable(n)
          ? [n.name]
          : [],
      )
      expect(stepped).toEqual(against)
      const laid = laidOut(backwards)
      const batch = build(backwards, laid, 0.5, { stranded: true })
      expect(folded(batch)).toEqual([idOf(backwards, 'a1')])
      expect(batch.collapsed?.through.has(idOf(backwards, 'r2'))).toBe(true)
      expect(strokesOf(batch, idOf(backwards, 'r2'))[0]?.points).toEqual(
        laid[idOf(backwards, 'r2')],
      )
    })
  })

  test('the hit test reaches as far as a reference node inside a run is drawn', () => {
    const batch = build(graph, positions, 0.1, depth)
    const byId = new Map(graph.nodes.map(n => [n.id, n]))
    const own = nodeInk(graph, byId, 6, 'depth')
    const drawnAs = nodeInk(
      graph,
      byId,
      6,
      'depth',
      0,
      batch.collapsed?.through,
    )
    expect(drawnAs.halfWidthPx('r2+')).toBe(
      strokesOf(batch, 'r2+')[0]?.thickness,
    )
    expect(own.halfWidthPx('r2+')).not.toBe(drawnAs.halfWidthPx('r2+'))
    expect(drawnAs.halfWidthPx('r1+')).toBe(own.halfWidthPx('r1+'))
  })

  test('zoomed in past the fold every reference node and link is drawn at its own thickness', () => {
    const drawn = build(graph, positions, 50, { ...depth, smallSites: 'nodes' })
    const batch = build(graph, positions, 50, depth)
    expect(folded(batch)).toEqual([])
    expect(batch.collapsed?.through.size).toBe(0)
    expect(batch.collapsed?.bridges.size).toBe(0)
    expect(batch.nodeStrokes).toEqual(drawn.nodeStrokes)
    expect(batch.edgeCurves).toEqual(drawn.edgeCurves)
  })

  test("a skip from a folded site's attachment is stroked as a skip", () => {
    const skipping = load([
      `S\tr1\t${bases(1000)}`,
      'S\tr2\tC',
      `S\tr3\t${bases(1000)}`,
      `S\tr4\t${bases(1000)}`,
      'S\ta1\tT',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr3\t+\tr4\t+\t0M',
      'L\tr1\t+\ta1\t+\t0M',
      'L\ta1\t+\tr3\t+\t0M',
      'L\tr1\t+\tr4\t+\t0M',
      'W\tref\t0\tchr\t0\t3001\t>r1>r2>r3>r4',
      'W\talt\t1\tchr\t0\t*\t>r1>a1>r3>r4',
      'W\tdel\t1\tchr\t0\t*\t>r1>r4',
    ])
    const laid = {
      'r1+': at(0, 1000),
      'r2+': at(1000, 1001),
      'r3+': at(1001, 2001),
      'r4+': at(2001, 3001),
      'a1+': at(1000, 1001, 0.5),
    }
    const skipEdge = edgeIndex(skipping, 'r1+', 'r4+')
    const before = lanesOf(
      build(skipping, laid, 0.5, { smallSites: 'nodes' }),
      skipEdge,
    )
    const batch = build(skipping, laid, 0.5)
    expect(folded(batch)).toEqual(['a1+'])
    expect(new Set(batch.collapsed?.bridges.keys())).toEqual(
      new Set([
        edgeIndex(skipping, 'r1+', 'r2+'),
        edgeIndex(skipping, 'r2+', 'r3+'),
      ]),
    )
    expect(before.length).toBeGreaterThan(0)
    expect(lanesOf(batch, skipEdge)).toEqual(before)
  })

  test('every lifted walk crossing a folded site runs straight between its attachments whichever route it takes, and the reference inside it is drawn only by those lanes', () => {
    const { graph: snpGraph, positions: snpAt } = snp(1, 1)
    const highlight = walkLift(snpGraph, [
      { walk: 'ref#0#chr' },
      { walk: 'alt#1#chr' },
    ])
    const crossing = build(snpGraph, snpAt, 0.5, {
      highlight,
      smallSites: 'nodes',
    })
    expect(crossing.nodeStrokeRuns.has('r2+')).toBe(true)
    const batch = build(snpGraph, snpAt, 0.5, { highlight })
    const [site] = batch.collapsed?.sites ?? []
    expect(batch.collapsed?.within).toEqual(new Map([['r2+', site]]))
    expect(batch.nodeStrokeRuns.has('r2+')).toBe(false)
    expect(batch.arrows.filter(a => a.node === 'r2+')).toEqual([])
    expect(batch.laneOnly).toEqual({
      nodes: new Set(['r2+']),
      edges: new Set(),
    })
    const into = [
      ...lanesOf(batch, edgeIndex(snpGraph, 'r1+', 'r2+')),
      ...lanesOf(batch, edgeIndex(snpGraph, 'r1+', 'a1+')),
    ]
    const out = [
      ...lanesOf(batch, edgeIndex(snpGraph, 'r2+', 'r3+')),
      ...lanesOf(batch, edgeIndex(snpGraph, 'a1+', 'r3+')),
    ]
    expect(new Set(into.map(l => l.walk))).toEqual(new Set([0, 1]))
    expect(new Set(out.map(l => l.walk))).toEqual(new Set([0, 1]))
    for (const lane of into) {
      expect(lane.curves.at(-1)?.x1).toBeCloseTo(site!.x, 6)
    }
    for (const lane of out) {
      expect(lane.curves[0]?.x0).toBeCloseTo(site!.x, 6)
    }
  })

  test('a lifted lane keeps its place beside the reference through a folded site, not drawn toward where the folded allele was laid out', () => {
    const { graph: snpGraph, positions: snpAt } = snp(1, 1, [
      'W\talt\t1\tchr\t0\t*\t>r1>a1>r3',
      'W\talt\t2\tchr\t0\t*\t>r1>r2>r3',
    ])
    const highlight = walkLift(snpGraph, [
      { walk: 'alt#1#chr' },
      { walk: 'alt#2#chr' },
    ])
    const batch = build(snpGraph, snpAt, 0.5, { highlight })
    expect(folded(batch)).toEqual(['a1+'])
    const ys = (walk: number) =>
      [
        ...['r1+', 'r3+'].flatMap(id =>
          strokesOf(batch, id)
            .filter(s => s.walk === walk)
            .flatMap(s => s.points.map(p => p.y)),
        ),
        ...[...batch.edgeCurveRuns.keys()].flatMap(edge =>
          lanesOf(batch, edge)
            .filter(c => c.walk === walk)
            .flatMap(c => c.curves.flatMap(b => [b.y0, b.y1])),
        ),
      ].map(y => Math.round(y * 1000) / 1000)
    for (const walk of [0, 1]) {
      expect(new Set(ys(walk)).size).toBe(1)
    }
    expect(ys(0)[0]).not.toBe(ys(1)[0])
  })

  test('a lifted lane across a folded site is as wide as on the reference it crosses from, not as on the allele that is not drawn', () => {
    const { graph: snpGraph, positions: snpAt } = snp(1, 1, [
      'W\talt\t1\tchr\t0\t*\t>r1>a1>r3',
      'W\tw\t2\tchr\t0\t*\t>r1>r2>r3',
      'W\tw\t3\tchr\t0\t*\t>r1>r2>r3',
      'W\tw\t4\tchr\t0\t*\t>r1>r2>r3',
    ])
    const highlight = walkLift(snpGraph, [
      { walk: 'alt#1#chr' },
      { walk: 'w#2#chr' },
    ])
    const options = {
      highlight,
      nodeWidth: 'depth' as const,
      contigThickness: 24,
    }
    const drawn = build(snpGraph, snpAt, 0.5, {
      ...options,
      smallSites: 'nodes',
    })
    const onAllele = strokesOf(drawn, 'a1+').find(s => s.walk === 0)
    const onReference = strokesOf(drawn, 'r1+').find(s => s.walk === 0)
    expect(onAllele?.thickness).toBeLessThan(onReference?.thickness ?? 0)
    const batch = build(snpGraph, snpAt, 0.5, options)
    expect(folded(batch)).toEqual(['a1+'])
    const across = [
      edgeIndex(snpGraph, 'r1+', 'a1+'),
      edgeIndex(snpGraph, 'a1+', 'r3+'),
    ].flatMap(edge => lanesOf(batch, edge).filter(c => c.walk === 0))
    expect(across).toHaveLength(2)
    for (const lane of across) {
      expect(lane.thickness).toBe(
        strokesOf(batch, 'r1+').find(s => s.walk === 0)?.thickness,
      )
    }
  })

  // walk 1 takes a1 for r2, then r3, inside b1's site, which touches a1's
  const laneThrough = (laid: Record<string, NodeSegment[]>) => {
    const highlight = walkLift(graph, [{ walk: 'w#1#chr' }])
    const batch = build(graph, laid, 0.1, { highlight })
    const points = (from: string, to: string) =>
      lanesOf(batch, edgeIndex(graph, from, to))
        .filter(lane => lane.walk === 0)
        .flatMap(lane =>
          lane.curves.flatMap(c => [
            { x: c.x0, y: c.y0 },
            { x: c.x1, y: c.y1 },
          ]),
        )
    return { batch, into: points('r1+', 'a1+'), out: points('r3+', 'r4+') }
  }

  test('a lifted lane crossing a run of touching folded sites is unbroken from the drawn node before the run to the one after', () => {
    const { batch, into, out } = laneThrough(positions)
    expect(folded(batch)).toEqual(['a1+', 'b1+', 'c1+'])
    expect(batch.laneOnly?.nodes).toEqual(new Set(['r2+', 'r3+', 'r5+']))
    expect(into[0]).toEqual({ x: 1000, y: 0 })
    expect(out.at(-1)).toEqual({ x: 1002, y: 0 })
    expect(into.at(-1)?.x).toBeCloseTo(out[0]?.x ?? 0, 9)
    expect(into.at(-1)?.y).toBeCloseTo(out[0]?.y ?? 0, 9)
  })

  // w crosses the 1 bp site at r2 twice, entering by a1 from its first and
  // its second visit to r1, coming round by x between; it leaves the first
  // time by a1's link to r3 and the second by r2's
  test('a lifted walk crossing a run of folded sites twice by one link meets each crossing at the slots of its own visits, unbroken', () => {
    const twice = load([
      `S\tr1\t${bases(1000)}`,
      'S\tr2\tC',
      `S\tr3\t${bases(1000)}`,
      'S\ta1\tT',
      `S\tx\t${bases(1000)}`,
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr1\t+\ta1\t+\t0M',
      'L\ta1\t+\tr3\t+\t0M',
      'L\ta1\t+\tr2\t+\t0M',
      'L\tr3\t+\tx\t+\t0M',
      'L\tx\t+\tr1\t+\t0M',
      'W\tref\t0\tchr\t0\t2001\t>r1>r2>r3',
      'W\tw\t1\tchr\t0\t*\t>r1>a1>r3>x>r1>a1>r2>r3',
    ])
    const laid = {
      'r1+': at(0, 1000),
      'r2+': at(1000, 1001),
      'r3+': at(1001, 2001),
      'a1+': at(1000, 1001, 0.5),
      'x+': at(2001, 0, 400),
    }
    const batch = build(twice, laid, 0.1, {
      highlight: walkLift(twice, [{ walk: 'ref#0#chr' }, { walk: 'w#1#chr' }]),
    })
    expect(folded(batch)).toEqual(['a1+'])
    const ends = (from: string, to: string, atEnd: boolean) =>
      lanesOf(batch, edgeIndex(twice, from, to))
        .filter(lane => lane.walk === 1)
        .map(lane => {
          const curve = atEnd ? lane.curves.at(-1)! : lane.curves[0]!
          return atEnd
            ? { x: curve.x1, y: curve.y1 }
            : { x: curve.x0, y: curve.y0 }
        })
    const into = ends('r1+', 'a1+', true)
    const out = [...ends('a1+', 'r3+', false), ...ends('r2+', 'r3+', false)]
    expect(into).toHaveLength(2)
    expect(out).toHaveLength(2)
    const apart = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y)
    expect(apart(into[0]!, into[1]!)).toBeGreaterThan(0.1)
    for (const end of into) {
      expect(out.some(start => apart(end, start) < 1e-9)).toBe(true)
    }
  })

  // Twelve 1 bp reference nodes laid half round a circle of radius 4, each
  // with an allele laid on it, odd ones taken by one walk and even ones by
  // another, so the sites touch and make one run bent 3.2 px off the line
  // between its ends at 0.8 px a unit, though each site is drawn under
  // SMALL_SITE_PX; skip leaves r0 for s2, over s1
  const arc = (() => {
    const count = 12
    const point = (k: number) => {
      const angle = Math.PI - (k * Math.PI) / count / 2
      return { x: 4 + 4 * Math.cos(angle), y: 4 * Math.sin(angle) }
    }
    const lines = [`S\tr0\t${bases(1000)}`, `S\tr13\t${bases(1000)}`]
    const laid: Record<string, NodeSegment[]> = {
      'r0+': at(-1000, 0),
      'r13+': at(8, 1008),
    }
    const steps: Record<string, string[]> = {
      ref: [],
      odd: [],
      even: [],
      skip: [],
    }
    for (let i = 1; i <= count; i++) {
      lines.push(`S\ts${i}\tC`, `S\ta${i}\tT`)
      const line = [point(2 * i - 2), point(2 * i - 1), point(2 * i)]
      laid[`s${i}+`] = line
      laid[`a${i}+`] = line
      const before = i === 1 ? 'r0' : `s${i - 1}`
      const after = i === count ? 'r13' : `s${i + 1}`
      lines.push(
        `L\t${before}\t+\ts${i}\t+\t0M`,
        `L\t${before}\t+\ta${i}\t+\t0M`,
        `L\ta${i}\t+\t${after}\t+\t0M`,
      )
      steps.ref!.push(`>s${i}`)
      steps.odd!.push(i % 2 ? `>a${i}` : `>s${i}`)
      steps.even!.push(i % 2 ? `>s${i}` : `>a${i}`)
      steps.skip!.push(...(i === 1 ? [] : [`>s${i}`]))
    }
    lines.push(
      `L\ts${count}\t+\tr13\t+\t0M`,
      'L\tr0\t+\ts2\t+\t0M',
      `W\tref\t0\tchr\t0\t2012\t>r0${steps.ref!.join('')}>r13`,
      `W\todd\t1\tchr\t0\t*\t>r0${steps.odd!.join('')}>r13`,
      `W\teven\t1\tchr\t0\t*\t>r0${steps.even!.join('')}>r13`,
      `W\tskip\t1\tchr\t0\t*\t>r0${steps.skip!.join('')}>r13`,
    )
    return { graph: load(lines), laid, top: point(count) }
  })()
  const lanePointsOn = (
    batch: ReturnType<typeof build>,
    from: string,
    to: string,
  ) =>
    lanesOf(batch, edgeIndex(arc.graph, from, to))
      .filter(lane => lane.walk === 0)
      .flatMap(lane =>
        lane.curves.flatMap(c => [
          { x: c.x0, y: c.y0 },
          { x: c.x1, y: c.y1 },
        ]),
      )

  test('the reference through a run bent more than SMALL_SITE_PX off the line between its ends is drawn where it is laid, nodes and links, at the even stroke', () => {
    const batch = build(arc.graph, arc.laid, 0.8)
    expect(folded(batch)).toHaveLength(12)
    expect(arc.top.y * 0.8).toBeGreaterThan(SMALL_SITE_PX)
    for (const id of ['s1+', 's6+', 's12+']) {
      expect(strokesOf(batch, id)[0]?.points).toEqual(arc.laid[id])
    }
  })

  test('a lifted lane crossing a run the layout bent follows the run as it is drawn, through its nodes as they are laid', () => {
    const highlight = walkLift(arc.graph, [{ walk: 'odd#1#chr' }])
    const batch = build(arc.graph, arc.laid, 0.8, { highlight })
    expect(folded(batch)).toHaveLength(12)
    const into = lanePointsOn(batch, 'r0+', 'a1+')
    const out = lanePointsOn(batch, 's12+', 'r13+')
    expect(into[0]).toEqual({ x: 0, y: 0 })
    expect(out.at(-1)).toEqual({ x: 8, y: 0 })
    const lane = [
      ...batch.edgeCurves
        .filter(c => c.walk === 0)
        .flatMap(c => c.curves.map(b => ({ x: b.x1, y: b.y1 }))),
      ...batch.nodeStrokes
        .filter(stroke => stroke.walk === 0)
        .flatMap(stroke => stroke.points),
    ]
    expect(lane.some(p => Math.abs(p.y - arc.top.y) < 1e-9)).toBe(true)
    expect(
      lane.every(p => Math.hypot(p.x - 4, p.y) > 4 - 1e-9 || p.y <= 0),
    ).toBe(true)
  })

  test('a lifted lane taking a folded skip into the run follows the run from where the skip leaves the node before it', () => {
    const highlight = walkLift(arc.graph, [{ walk: 'skip#1#chr' }])
    const batch = build(arc.graph, arc.laid, 0.8, { highlight })
    expect(batch.collapsed?.edges.has(edgeIndex(arc.graph, 'r0+', 's2+'))).toBe(
      true,
    )
    const lane = lanePointsOn(batch, 'r0+', 's2+')
    expect(lane[0]).toEqual({ x: 0, y: 0 })
    expect(lane).toContainEqual(arc.laid['s1+']![1])
  })

  test('a reference node inside a folded site no lifted walk crosses is drawn, at the even stroke', () => {
    const { graph: snpGraph, positions: snpAt } = snp(1, 1, [
      'W\talt\t1\tchr\t0\t*\t>r1>a1>r3',
      'W\tpart\t1\tchr\t0\t1000\t>r1',
    ])
    const highlight = walkLift(snpGraph, [{ walk: 'part#1#chr' }])
    const batch = build(snpGraph, snpAt, 0.5, { highlight })
    expect(folded(batch)).toEqual(['a1+'])
    expect(batch.nodeStrokeRuns.has('r2+')).toBe(true)
  })
})

test('with small sites drawn as nodes, nothing is folded and every node and link draws', () => {
  const { graph, straight } = snpRun(10)
  const batch = build(graph, straight, 0.01, { smallSites: 'nodes' })
  expect(batch.collapsed?.sites).toEqual([])
  expect(drawnNodes(batch)).toEqual(new Set(Object.keys(straight)))
  expect(batch.edgeCurveRuns.size).toBe(graph.edges.length)
})

test('a point at a folded site finds the reference node or link there, never what was folded', () => {
  const { graph, positions } = snp(1, 1, undefined, 20)
  const axis = { scaleX: 1, scaleY: 1 }
  const batch = build(graph, positions, 0.05)
  expect(folded(batch)).toEqual(['a1+'])
  const node = (x: number, y: number, collapsed: typeof batch.collapsed) =>
    findHoveredNode(positions, x, y, axis, 0, undefined, collapsed)
  expect(node(1000.5, 20, undefined)).toBe('a1+')
  expect(node(1000.5, 20, batch.collapsed)).toBeNull()
  expect(node(1000.5, 2, batch.collapsed)).toBe('r2+')
  expect(node(999, 4, batch.collapsed)).toBe('r1+')
  const edge = (x: number, y: number, collapsed: typeof batch.collapsed) =>
    findHoveredEdge(
      positions,
      graph,
      x,
      y,
      axis,
      false,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      collapsed,
    )
  const into = edgeIndex(graph, 'r1+', 'a1+')
  expect(edge(1000, 10, undefined)).toBe(into)
  expect(batch.collapsed?.edges.has(into)).toBe(true)
  const reference = [
    edgeIndex(graph, 'r1+', 'r2+'),
    edgeIndex(graph, 'r2+', 'r3+'),
  ]
  expect(reference).toContain(edge(1000, 4, batch.collapsed))
  expect(reference).toContain(edge(1000.5, 1, batch.collapsed))
})
