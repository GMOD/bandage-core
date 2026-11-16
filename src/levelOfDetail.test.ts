import { deletionDrawing, deletionEdges } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { SMALL_SITE_PX } from './levelOfDetail'
import { haplotypeCount } from './nodeWidths'
import { anchorGraph } from './pathAnchoring'
import { buildGeometry } from './renderer/GeometryBuilder'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { findHoveredEdge, findHoveredNode } from './util/hitDetection'
import { walkLift } from './walkHighlight'

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

const folded = (batch: ReturnType<typeof build>) =>
  [...(batch.collapsed?.nodes ?? [])].toSorted()
const drawnNodes = (batch: ReturnType<typeof build>) =>
  new Set(batch.nodeStrokeRuns.keys())
const edgeIndex = (graph: Graph, from: string, to: string) =>
  graph.edges.findIndex(e => e.from === from && e.to === to)

// a1, `altBp` long, takes the place of r2, `refBp` long, between 1 kb
// flanks, drawn one layout unit a bp, so the reference's px per bp is the
// scale
function snp(
  altBp: number,
  refBp: number,
  walks = ['W\talt\t1\tchr\t0\t*\t>r1>a1>r3'],
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
      'a1+': at(1000, 1000 + altBp, 20),
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

describe('a site folds when its bp and the reference bp between its attachments come to under SMALL_SITE_PX', () => {
  test.each([
    [1, 1, 1.49, true],
    [1, 1, 1.51, false],
    [1, 10, 0.27, true],
    [1, 10, 0.28, false],
    [10, 1, 0.28, false],
  ])(
    'a %i bp allele in place of %i bp at %f px a bp folds: %s',
    (altBp, refBp, scale, isFolded) => {
      const { graph, positions } = snp(altBp, refBp)
      const batch = build(graph, positions, scale)
      expect(batch.collapsed?.pxPerBp).toBeCloseTo(scale, 9)
      expect(folded(batch)).toEqual(isFolded ? ['a1+'] : [])
      expect(drawnNodes(batch).has('a1+')).toBe(!isFolded)
      expect(batch.collapsed?.edges.size).toBe(isFolded ? 2 : 0)
      expect(batch.edgeCurveRuns.size).toBe(isFolded ? 2 : 4)
    },
  )

  test.each([
    [2, 1.49, true],
    [2, 1.51, false],
  ])('a skip over %i bp at %f px a bp folds: %s', (bp, scale, isFolded) => {
    const { graph, positions } = skip(bp)
    const batch = build(graph, positions, scale)
    expect(batch.collapsed?.sites.map(s => s.edges)).toEqual(
      isFolded ? [[2]] : [],
    )
    expect(batch.edgeCurveRuns.has(2)).toBe(!isFolded)
    expect(drawnNodes(batch)).toEqual(new Set(['r1+', 'r2+', 'r3+']))
  })
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

test('both layouts fold the same set at the same px a bp of reference, whatever their nodes are drawn at', () => {
  const { graph, straight, winding } = snpRun(12)
  const perBp = (positions: Record<string, NodeSegment[]>) =>
    build(graph, positions, 1).collapsed?.pxPerBp ?? 0
  const across = perBp(straight) / perBp(winding)
  expect(across).not.toBeCloseTo(1)
  const seen = new Set<number>()
  for (const scale of [0.5, 1, 1.2, 1.49, 1.51, 2, 4]) {
    const a = folded(build(graph, straight, scale))
    const b = folded(build(graph, winding, scale * across))
    expect(b).toEqual(a)
    seen.add(a.length)
  }
  expect(seen).toEqual(new Set([12, 0]))
})

test('identical sites anywhere on a winding reference all fold or all stay', () => {
  const { graph, winding } = snpRun(12)
  const unit = build(graph, winding, 1).collapsed?.pxPerBp ?? 0
  const counts = new Set<number>()
  for (let i = 0; i <= 60; i++) {
    const scale = ((0.5 + i * 0.05) * SMALL_SITE_PX) / 2 / unit
    counts.add(folded(build(graph, winding, scale)).length)
  }
  expect(counts).toEqual(new Set([12, 0]))
})

test('under a monotone zoom each node changes state once at most, zooming in draws again exactly what was folded, and a pan reuses the fold', () => {
  const { graph, winding } = snpRun(12)
  const changes = new Map<string, number>()
  let before = new Set<string>()
  const scales = Array.from({ length: 80 }, (_, i) => 0.05 * 1.06 ** i)
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
  const out = build(graph, winding, 0.05)
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

test('a site no shown walk steps is drawn, an allele or a skip', () => {
  const allele = snp(1, 1, [])
  expect(folded(build(allele.graph, allele.positions, 0.01))).toEqual([])
  expect(
    drawnNodes(build(allele.graph, allele.positions, 0.01)).has('a1+'),
  ).toBe(true)
  const skipped = skip(1, [])
  const batch = build(skipped.graph, skipped.positions, 0.01)
  expect(batch.collapsed?.sites).toEqual([])
  expect(batch.edgeCurveRuns.has(2)).toBe(true)
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
  const { graph, positions } = snp(1, 1)
  const highlight = walkLift(graph, [
    { walk: 'ref#0#chr' },
    { walk: 'alt#1#chr', color: { field: 'pass' } },
  ])
  const wide = Object.fromEntries(
    Object.entries(positions).map(([id, line]) => [
      id,
      line.map(p => ({ x: p.x / 100, y: p.y })),
    ]),
  )
  const into = edgeIndex(graph, 'r1+', 'a1+')
  const out = edgeIndex(graph, 'a1+', 'r3+')
  const drawn = build(graph, wide, 10, { highlight, smallSites: 'nodes' })
  expect(drawn.arrowRuns.has(into) || drawn.arrowRuns.has(out)).toBe(true)
  expect(drawn.arrows.some(a => a.node === 'a1+')).toBe(true)
  const batch = build(graph, wide, 10, { highlight })
  expect(folded(batch)).toEqual(['a1+'])
  expect(batch.nodeStrokeRuns.has('a1+')).toBe(false)
  expect(batch.arrows.some(a => a.node === 'r1+')).toBe(true)
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

test('with small sites drawn as nodes, nothing is folded and every node and link draws', () => {
  const { graph, straight } = snpRun(10)
  const batch = build(graph, straight, 0.01, { smallSites: 'nodes' })
  expect(batch.collapsed?.sites).toEqual([])
  expect(drawnNodes(batch)).toEqual(new Set(Object.keys(straight)))
  expect(batch.edgeCurveRuns.size).toBe(graph.edges.length)
})

test('a point at a folded site finds the reference node or link there, never what was folded', () => {
  const { graph, positions } = snp(1, 1)
  const axis = { scaleX: 1, scaleY: 1 }
  const batch = build(graph, positions)
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
