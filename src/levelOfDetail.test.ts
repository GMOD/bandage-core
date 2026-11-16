import { deletionDrawing, deletionEdges } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import {
  SITE_EXTENT_PX,
  SITE_REACH_PX,
  TICK_MAX_PX,
  TICK_MIN_PX,
  tickEnds,
  tickHeightPx,
} from './levelOfDetail'
import { anchorGraph } from './pathAnchoring'
import { Canvas2DRenderer } from './renderer/Canvas2DRenderer'
import { TICK_COLOR, buildGeometry } from './renderer/GeometryBuilder'
import { abgrToCssRgba } from './renderer/colorBits'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { recordingCanvas } from './renderer/recordingCanvas'
import { distanceToSegment } from './util/hitDetection'
import { walkLift } from './walkHighlight'

import type { BuildOptions } from './renderer/GeometryBuilder'
import type { Tick } from './renderer/types'
import type { Graph, NodeSegment } from './types'

const load = (lines: string[]) =>
  anchorGraph(convertGFAToGraph(parseGFA(lines.join('\n'))), 'ref')

const at = (x0: number, x1: number, y = 0): NodeSegment[] => [
  { x: x0, y },
  { x: x1, y },
]

// held per graph, as a host holds them
const drawings = new WeakMap<Graph, ReturnType<typeof deletionDrawing>>()
const drawingOf = (graph: Graph) => {
  const held = drawings.get(graph)
  const drawing = held ?? deletionDrawing(graph, deletionEdges(graph), true)
  if (!held) {
    drawings.set(graph, drawing)
  }
  return drawing
}

function build(
  graph: Graph,
  positions: Record<string, NodeSegment[]>,
  scale = 1,
  more: Partial<BuildOptions> = {},
) {
  return buildGeometry({
    ...layoutGeometryInputs({ nodePositions: positions }, drawingOf(graph)),
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

const drawnNodes = (batch: ReturnType<typeof build>) =>
  new Set(batch.nodeStrokeRuns.keys())
const ticked = (batch: ReturnType<typeof build>) =>
  (batch.ticks ?? []).flatMap(t => t.nodes)

// r2 is the reference's allele of `width` px and a1 the alt's; the alt
// leaves r1's end and comes back at r3's start, `gap` px on
function snp(width: number, gap = 1) {
  const graph = load([
    'S\tr1\tAAAA',
    'S\tr2\tC',
    'S\tr3\tGGGG',
    'S\ta1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'W\tref\t0\tchr\t0\t9\t>r1>r2>r3',
    'W\talt\t1\tchr\t0\t9\t>r1>a1>r3',
  ])
  return {
    graph,
    positions: {
      'r1+': at(0, 100),
      'r2+': at(100, 100 + gap),
      'r3+': at(100 + gap, 200),
      'a1+': at(100, 100 + width, 10),
    },
  }
}

describe('a site is collapsed only under both thresholds', () => {
  test.each([
    [SITE_EXTENT_PX - 0.1, 1, true],
    [SITE_EXTENT_PX + 0.1, 1, false],
    [1, SITE_REACH_PX - 0.1, true],
    [1, SITE_REACH_PX + 0.1, false],
  ])(
    'an allele %f px long attached %f px apart: collapsed %s',
    (width, gap, collapsed) => {
      const { graph, positions } = snp(width, gap)
      const batch = build(graph, positions)
      expect(ticked(batch)).toEqual(collapsed ? ['a1+'] : [])
      expect(drawnNodes(batch).has('a1+')).toBe(!collapsed)
      expect(batch.collapsed?.edges.size).toBe(collapsed ? 2 : 0)
      expect(batch.edgeCurveRuns.size).toBe(collapsed ? 2 : 4)
    },
  )

  test.each([
    [SITE_EXTENT_PX - 0.1, true],
    [SITE_EXTENT_PX + 0.1, false],
  ])('a skip spanning %f px: collapsed %s', (span, collapsed) => {
    const graph = load([
      'S\tr1\tAAAA',
      'S\tr2\tC',
      'S\tr3\tGGGG',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr1\t+\tr3\t+\t0M',
      'W\tref\t0\tchr\t0\t9\t>r1>r2>r3',
      'W\tdel\t1\tchr\t0\t8\t>r1>r3',
    ])
    const batch = build(graph, {
      'r1+': at(0, 100),
      'r2+': at(100, 100 + span),
      'r3+': at(100 + span, 200),
    })
    expect(batch.ticks?.map(t => t.edges)).toEqual(collapsed ? [[2]] : [])
    expect(batch.edgeCurveRuns.has(2)).toBe(!collapsed)
    expect(drawnNodes(batch)).toEqual(new Set(['r1+', 'r2+', 'r3+']))
  })
})

test('a small component attached at two reference points more than SITE_REACH_PX apart is not collapsed', () => {
  const graph = load([
    'S\tr1\tAAAA',
    'S\tr2\tCCCCCCCC',
    'S\tr3\tGGGG',
    'S\ta1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'W\tref\t0\tchr\t0\t16\t>r1>r2>r3',
    'W\talt\t1\tchr\t0\t9\t>r1>a1>r3',
  ])
  const positions = {
    'r1+': at(0, 100),
    'r2+': at(100, 150),
    'r3+': at(150, 250),
    'a1+': at(100, 100.5, 10),
  }
  const batch = build(graph, positions)
  expect(batch.ticks).toEqual([])
  expect(drawnNodes(batch).has('a1+')).toBe(true)
})

test('nothing on the reference and no placeholder is collapsed, nor what hangs from a placeholder', () => {
  const graph = load([
    'S\tr1\tAAAA',
    'S\tr2\tC',
    'S\tr3\tGGGG',
    'S\tp1\t*\tLN:i:5000\tnl:i:1',
    'S\ta1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\tp1\t+\t0M',
    'L\tp1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'W\tref\t0\tchr\t0\t9\t>r1>r2>r3',
    'W\talt\t1\tchr\t0\t*\t>r1>p1>a1>r3',
  ])
  expect(graph.nodes.find(n => n.name === 'p1')?.placeholder).toBe(true)
  const positions = {
    'r1+': at(0, 100),
    'r2+': at(100, 100.1),
    'r3+': at(100.1, 200),
    'p1+': at(100, 100.2, 10),
    'a1+': at(100.2, 100.3, 10),
  }
  for (const scale of [0.01, 1, 100]) {
    const batch = build(graph, positions, scale)
    expect(batch.ticks).toEqual([])
    expect(drawnNodes(batch)).toEqual(new Set(Object.keys(positions)))
  }
})

test('a site no shown walk steps is drawn as it is, never as a tick', () => {
  const graph = load([
    'S\tr1\tAAAA',
    'S\tr2\tC',
    'S\tr3\tGGGG',
    'S\ta1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'W\tref\t0\tchr\t0\t9\t>r1>r2>r3',
  ])
  const { positions } = snp(1)
  const batch = build(graph, positions)
  expect(batch.ticks).toEqual([])
  expect(drawnNodes(batch).has('a1+')).toBe(true)
})

test('a tick is TICK_MIN_PX tall for one walk, TICK_MAX_PX for all of them, and in proportion between', () => {
  expect(tickHeightPx(1, 9)).toBe(TICK_MIN_PX)
  expect(tickHeightPx(9, 9)).toBe(TICK_MAX_PX)
  expect(tickHeightPx(5, 9)).toBeCloseTo((TICK_MIN_PX + TICK_MAX_PX) / 2)
  expect(tickHeightPx(1, 1)).toBe(TICK_MIN_PX)
  const graph = load([
    'S\tr1\tAAAA',
    'S\tr2\tC',
    'S\tr3\tGGGG',
    'S\ta1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'W\tref\t0\tchr\t0\t9\t>r1>r2>r3',
    'W\tx\t1\tchr\t0\t9\t>r1>a1>r3',
    'W\tx\t2\tchr\t0\t9\t>r1>a1>r3',
    'W\ty\t1\tchr\t0\t9\t>r1>r2>r3',
  ])
  const [tick] = build(graph, snp(1).positions).ticks ?? []
  expect(tick).toMatchObject({ count: 2, total: 4 })
  expect(tick?.height).toBeCloseTo(
    TICK_MIN_PX + (TICK_MAX_PX - TICK_MIN_PX) / 3,
  )
})

// SNPs every `pitch` px along a reference running left to right, their
// alleles on alternate sides of it
function snpRun(count: number, pitch: number, flip = 1) {
  const lines = ['S\tr0\tAAAA']
  const positions: Record<string, NodeSegment[]> = { 'r0+': at(0, flip * 50) }
  const refSteps = ['>r0']
  const altSteps = ['>r0']
  let x = 50
  for (let i = 1; i <= count; i++) {
    lines.push(`S\ts${i}\tC`, `S\ta${i}\tT`, `S\tr${i}\tGGGG`)
    const prev = `r${i - 1}`
    lines.push(
      `L\t${prev}\t+\ts${i}\t+\t0M`,
      `L\ts${i}\t+\tr${i}\t+\t0M`,
      `L\t${prev}\t+\ta${i}\t+\t0M`,
      `L\ta${i}\t+\tr${i}\t+\t0M`,
    )
    positions[`s${i}+`] = at(flip * x, flip * (x + 0.5))
    positions[`a${i}+`] = at(flip * x, flip * (x + 0.5), i % 2 ? 6 : -6)
    positions[`r${i}+`] = at(flip * (x + 0.5), flip * (x + pitch))
    refSteps.push(`>s${i}>r${i}`)
    altSteps.push(`>a${i}>r${i}`)
    x += pitch
  }
  lines.push(
    `W\tref\t0\tchr\t0\t*\t${refSteps.join('')}`,
    `W\talt\t1\tchr\t0\t*\t${altSteps.join('')}`,
  )
  return { graph: load(lines), positions }
}

const footAndTop = (tick: Tick, scale: number) =>
  tickEnds(tick, {
    scaleX: scale,
    scaleY: scale,
    translateX: 0,
    translateY: 0,
    dpr: 1,
  })

test('every tick stands on the same side of the reference, whichever side its alleles lie', () => {
  const right = snpRun(6, 20)
  const ticks = build(right.graph, right.positions).ticks ?? []
  expect(ticks).toHaveLength(6)
  expect(ticks.every(t => t.ny < 0 && t.nx === 0)).toBe(true)
  const left = snpRun(6, 20, -1)
  const back = build(left.graph, left.positions).ticks ?? []
  expect(back).toHaveLength(6)
  expect(back.every(t => t.ny > 0)).toBe(true)
})

test('sites closer than SITE_REACH_PX share a tick, and no tick overlaps another', () => {
  const { graph, positions } = snpRun(40, 2)
  const ticks = build(graph, positions).ticks ?? []
  const sites = ticks.flatMap(t => t.nodes)
  expect(sites.toSorted()).toEqual(
    Array.from({ length: 40 }, (_, i) => `a${i + 1}+`).toSorted(),
  )
  expect(ticks.length).toBeGreaterThan(40 / (SITE_REACH_PX / 2) - 1)
  expect(ticks.length).toBeLessThan(40)
  ticks.forEach((a, i) => {
    const [a0, a1] = footAndTop(a, 1)
    for (const b of ticks.slice(i + 1)) {
      const [b0, b1] = footAndTop(b, 1)
      const apart = Math.min(
        distanceToSegment(b0.x, b0.y, a0.x, a0.y, a1.x, a1.y),
        distanceToSegment(b1.x, b1.y, a0.x, a0.y, a1.x, a1.y),
      )
      expect(apart).toBeGreaterThan(a.thickness + b.thickness)
    }
  })
})

test('a tick is painted after everything else, over the reference, the links, the skips and the heads', () => {
  const graph = load([
    'S\tr1\tAAAA',
    'S\tr2\tC',
    'S\tr3\tGGGG',
    'S\tr4\tC',
    'S\tr5\tGGGG',
    'S\ta1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr3\t+\tr4\t+\t0M',
    'L\tr4\t+\tr5\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'L\tr1\t+\tr5\t+\t0M',
    'L\tr3\t+\tr5\t+\t0M',
    'W\tref\t0\tchr\t0\t*\t>r1>r2>r3>r4>r5',
    'W\talt\t1\tchr\t0\t*\t>r1>a1>r3>r5',
    'W\tdel\t1\tchr\t0\t*\t>r1>r5',
  ])
  const batch = build(graph, {
    'r1+': at(0, 100),
    'r2+': at(100, 101),
    'r3+': at(101, 200),
    'r4+': at(200, 201),
    'r5+': at(201, 300),
    'a1+': at(100, 101, 10),
  })
  expect(batch.ticks).toHaveLength(2)
  expect(batch.arrows.length).toBeGreaterThan(0)
  expect(batch.edgeCurves.some(e => e.skip)).toBe(true)
  const { canvas, paints } = recordingCanvas()
  const renderer = new Canvas2DRenderer(canvas)
  renderer.uploadGeometry(batch)
  renderer.updateTransform({
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
    dpr: 1,
  })
  renderer.render([1, 1, 1, 1])
  const tickInk = abgrToCssRgba(TICK_COLOR)
  const last = paints.at(-1)!
  expect(last).toMatchObject({ kind: 'stroke', style: tickInk })
  const ends = (batch.ticks ?? []).flatMap(t => footAndTop(t, 1))
  expect(last.points).toEqual(ends)
})

test('zooming in past the thresholds draws again exactly the nodes that were collapsed', () => {
  const { graph, positions } = snpRun(10, 20)
  const out = build(graph, positions, 1)
  const close = build(graph, positions, 10)
  const collapsed = ticked(out)
  expect(collapsed).toHaveLength(10)
  expect(close.ticks).toEqual([])
  const restored = [...drawnNodes(close)].filter(id => !drawnNodes(out).has(id))
  expect(restored.toSorted()).toEqual(collapsed.toSorted())
  expect(close.edgeCurveRuns.size).toBe(graph.edges.length)
})

test('the same transform draws the same ticks whatever was drawn before it', () => {
  const { graph, positions } = snpRun(12, 3)
  const fresh = build(graph, positions, 1).ticks
  build(graph, positions, 0.3)
  build(graph, positions, 7)
  expect(build(graph, positions, 1).ticks).toEqual(fresh)
  const again = snpRun(12, 3)
  build(again.graph, again.positions, 2)
  expect(build(again.graph, again.positions, 1).ticks).toEqual(fresh)
})

test('turned off, a drawing has no ticks and draws every node and link', () => {
  const { graph, positions } = snpRun(10, 20)
  const off = build(graph, positions, 1, { levelOfDetail: false })
  expect(off.ticks).toEqual([])
  expect(drawnNodes(off)).toEqual(new Set(Object.keys(positions)))
  expect(off.edgeCurveRuns.size).toBe(graph.edges.length)
})

test('with walks lifted, a lane stepping a collapsed site runs straight along the reference there, with no head on what it stands for', () => {
  const { graph, positions: laid } = snp(1)
  const { 'a1+': allele, ...rest } = laid
  const positions = { 'a1+': allele, ...rest }
  const highlight = walkLift(graph, [
    { walk: 'ref#0#chr' },
    { walk: 'alt#1#chr', color: { field: 'pass' } },
  ])!
  const batch = build(graph, positions, 1, { highlight })
  expect(ticked(batch)).toEqual(['a1+'])
  expect(batch.nodeStrokeRuns.has('a1+')).toBe(false)
  expect(batch.arrows.some(a => a.node === 'r1+')).toBe(true)
  expect(batch.arrows.filter(a => a.node === 'a1+')).toEqual([])
  const lanes = [2, 3].flatMap(edge => {
    const run = batch.edgeCurveRuns.get(edge)!
    return batch.edgeCurves.slice(run.start, run.start + run.count)
  })
  expect(lanes.length).toBeGreaterThan(0)
  for (const { curves } of lanes) {
    for (const c of curves) {
      expect(Math.abs(c.y1 - c.y0)).toBeLessThan(1)
      expect(Math.abs(c.cy0 - c.y0)).toBeLessThan(1)
      expect(Math.abs(c.cy1 - c.y0)).toBeLessThan(1)
    }
  }
  const [tick] = batch.ticks ?? []
  expect(tick!.offset).toBeGreaterThan(3)
})
