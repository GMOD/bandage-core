import { readFileSync } from 'node:fs'

import { isBackbone } from './anchoredNodes'
import { spreadFor } from './bubbleSpreads'
import { departureTable } from './gfa/departures'
import { drawnLengthFor, layoutScaling } from './layout/drawnScale'
import { ASSUMED_FIT } from './layout/fitAssumptions'
import { layoutEngine } from './layoutEngines'
import {
  drawingBounds,
  engineKey,
  engineRequest,
  engineSettingsOf,
  fitTransform,
  forceLayout,
  layoutExtent,
  loadGraph,
  loopFloor,
} from './pipeline'

import type { BubbleSpread } from './bubbleSpreads'
import type { FitSize } from './layout/fitAssumptions'
import type { Graph, GraphNode, NodeSegment } from './types'

test('padTop moves the drawing down by the room it adds', () => {
  const bounds = { minX: 0, minY: 0, w: 100, h: 100 }
  const plain = fitTransform(bounds, 280, 280, false)!
  const padded = fitTransform(bounds, 280, 302, false, { padTop: 62 })!
  expect(padded.scale).toBe(plain.scale)
  expect(padded.translateY).toBe(plain.translateY + 22)
})

const graph: Graph = {
  name: 'pair',
  nodes: [
    { id: 'a', name: 'a', length: 1000, depth: 1 },
    { id: 'b', name: 'b', length: 1000, depth: 1 },
  ],
  edges: [{ from: 'a', to: 'b' }],
}
const engine = {
  quality: 2,
  linearLayout: false,
  bubbleSpread: 'auto' as const,
}

test('spacing and component separation scale what the engine is handed', () => {
  const plain = engineRequest(graph, layoutScaling(graph), engine).options
  const spaced = engineRequest(graph, layoutScaling(graph), {
    ...engine,
    spacing: 3,
    componentSeparation: 2,
  }).options
  expect(spaced.edgeLength).toBe((plain.edgeLength as number) * 3)
  expect(spaced.componentSeparation).toBe(
    (plain.componentSeparation as number) * 2,
  )
})

test('a layout at another spacing is cached apart', () => {
  expect(engineKey(graph, { ...engine, spacing: 2 })).not.toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, { ...engine, spacing: 1 })).toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, { ...engine, componentSeparation: 2 })).not.toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, { ...engine, showDeletionEdges: false })).not.toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, { ...engine, showDeletionEdges: true })).toBe(
    engineKey(graph, engine),
  )
})

test('a layout sized for another fit is cached apart, and one with none is the assumed fit', () => {
  expect(engineKey(graph, engine, { width: 900, height: 280 })).not.toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, engine, { width: 1200, height: 600 })).not.toBe(
    engineKey(graph, engine),
  )
  expect(engineKey(graph, engine, ASSUMED_FIT)).toBe(engineKey(graph, engine))
  expect(engineKey(graph, engine, { width: 0, height: 0 })).toBe(
    engineKey(graph, engine),
  )
})

test('a force layout draws its nodes start to end', async () => {
  const { result } = await forceLayout(graph, engine, () =>
    Promise.resolve({
      result: {
        nodePositions: {
          a: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          b: [
            { x: 20, y: 0 },
            { x: 30, y: 0 },
          ],
        },
      },
      duration: 0,
    }),
  )
  expect(result.stranded).toBe(true)
})

// FMMM drew the seeded backbone in waves, its coarsest level buckling a chain
// seeded at a quarter of the length it balances at; stress reads seeds as
// positions
test('an anchored graph seeds FMMM four times as far out as stress', () => {
  const anchored: Graph = {
    name: 'backbone',
    nodes: [0, 1, 2].map(i => ({
      id: `r${i}`,
      name: `r${i}`,
      length: 1000,
      depth: 1,
      stable: { refName: 'chr1', start: i * 1000, rank: 0 },
    })),
    edges: [
      { from: 'r0', to: 'r1' },
      { from: 'r1', to: 'r2' },
    ],
  }
  const seeds = (e: 'fmmm' | 'stress') =>
    engineRequest(anchored, layoutScaling(anchored), {
      ...engine,
      engine: e,
    }).graph.nodes.map(n => [n.x, n.y])
  const stress = seeds('stress')
  expect(stress.some(([x]) => x! > 0)).toBe(true)
  expect(seeds('fmmm')).toEqual(stress.map(([x, y]) => [x! * 4, y! * 4]))
})

// Seeded at drawn length, FMMM bent the 571 bp gap's reference into waves
// 7% of its length deep
test('FMMM draws a seeded reference close to straight', async () => {
  const gap571 = loadGraph(
    readFileSync('test_data/hprc_gap571.gfa', 'utf8'),
    'gap571',
    { referencePath: 'GRCh38' },
  )
  const { result } = await forceLayout(
    gap571,
    engineSettingsOf({ engine: 'fmmm' }),
    layoutEngine,
  )
  const line = gap571.nodes
    .filter(isBackbone)
    .sort((a, b) => a.stable.start - b.stable.start)
    .flatMap(node => result.nodePositions[node.id] ?? [])
  const first = line[0]!
  const last = line.at(-1)!
  const length = Math.hypot(last.x - first.x, last.y - first.y)
  let deepest = 0
  for (const p of line) {
    deepest = Math.max(
      deepest,
      Math.abs(
        (last.x - first.x) * (first.y - p.y) -
          (first.x - p.x) * (last.y - first.y),
      ) / length,
    )
  }
  expect(deepest / length).toBeLessThan(0.03)
})

// HPRC chr1:103,618,800-103,620,300: HG00099#1 rejoins the reference inside
// the window from 30 kb of its own sequence that left it 7 kb before the cut,
// and the fit to every node drew the window's reference at a quarter of the
// pane
function tailedGraph(
  leavePos: number,
  walks: string[][] = [],
  rejoinPos = 1000,
): Graph {
  const departures = departureTable([
    {
      name: 'HG00099#1#c',
      hapStart: 0,
      ownBp: 20_000,
      missingBp: 0,
      leavePos,
      leaveReversed: false,
      leavePasses: 1,
      rejoinPos,
      rejoinReversed: false,
      rejoinPasses: 1,
      fromSteps: false,
    },
  ])
  return {
    name: 'tailed',
    nodes: [
      ...[0, 1, 2].map(i => ({
        id: `r${i}`,
        name: `r${i}`,
        length: 1000,
        depth: 1,
        stable: { refName: 'GRCh38#0#chr1', start: i * 1000, rank: 0 },
      })),
      { id: 't0', name: 't0', length: 10_000, depth: 1 },
      { id: 't1', name: 't1', length: 10_000, depth: 1 },
    ],
    edges: [
      { from: 'r0', to: 'r1' },
      { from: 'r1', to: 'r2' },
      { from: 't0', to: 't1' },
      { from: 't1', to: 'r1' },
    ],
    paths: [
      { name: 'GRCh38#0#chr1', nodeIds: ['r0', 'r1', 'r2'] },
      ...walks.map((nodeIds, i) => ({ name: `HG0000${i}#1#c`, nodeIds })),
    ],
    referencePath: 'GRCh38#0#chr1',
    departures: {
      ...departures,
      offsets: Int32Array.of(0, 2),
      steps: Int32Array.of(3, 4),
      reversed: Uint8Array.of(0, 0),
    },
  }
}

async function stressBounds(tailed: Graph) {
  const { result } = await forceLayout(
    tailed,
    engineSettingsOf({ engine: 'stress' }),
    layoutEngine,
  )
  const reference = Object.fromEntries(
    ['r0', 'r1', 'r2'].map(id => [id, result.nodePositions[id]!]),
  )
  return {
    fit: drawingBounds(result),
    nodes: layoutExtent(result.nodePositions),
    reference: layoutExtent(reference),
  }
}

test('the fit frames the cut without a departure running off past its end', async () => {
  const { fit, nodes, reference } = await stressBounds(tailedGraph(-6000))
  expect(nodes.maxX - nodes.minX).toBeGreaterThan(
    2 * (reference.maxX - reference.minX),
  )
  expect(fit.minX).toBe(reference.minX)
  expect(fit.w).toBe(reference.maxX - reference.minX)
})

test('the fit frames the cut without a departure that rejoins past its end', async () => {
  const { fit, nodes, reference } = await stressBounds(
    tailedGraph(500, [], 9000),
  )
  expect(nodes.maxX - nodes.minX).toBeGreaterThan(
    2 * (reference.maxX - reference.minX),
  )
  expect(fit.minX).toBe(reference.minX)
  expect(fit.w).toBe(reference.maxX - reference.minX)
})

test('the fit frames a departure that leaves and rejoins on the cut', async () => {
  const { fit, nodes } = await stressBounds(tailedGraph(2500))
  expect(fit).toEqual({
    minX: nodes.minX,
    minY: nodes.minY,
    w: nodes.maxX - nodes.minX,
    h: nodes.maxY - nodes.minY,
  })
})

test('the fit frames the steps of a departure a walk carries', async () => {
  const { fit, nodes } = await stressBounds(tailedGraph(-6000, [['t0', 't1']]))
  expect(fit.w).toBe(nodes.maxX - nodes.minX)
})

// 20 kb of reference then 199 nodes of 500 bp, a 1 bp allele beside each
// join, and a 100 kb run of a haplotype's own leaving and rejoining the middle
function looped(anchor: boolean): Graph {
  const node = (id: string, length: number, start: number, rank: number) => ({
    id,
    name: id,
    length,
    depth: 1,
    ...(anchor ? { stable: { refName: 'chr1', start, rank } } : {}),
  })
  const reference = Array.from({ length: 200 }, (_, i) =>
    i === 0
      ? node('r0', 20_000, 0, 0)
      : node(`r${i}`, 500, 19_500 + i * 500, 0),
  )
  const alleles = reference
    .slice(1)
    .map((_, i) => node(`a${i}`, 1, 20_000 + i * 500, 1))
  return {
    name: 'looped',
    nodes: [...reference, ...alleles, node('own', 100_000, 69_500, 1)],
    edges: [
      ...alleles.flatMap((a, i) => [
        { from: `r${i}`, to: `r${i + 1}` },
        { from: `r${i}`, to: a.id },
        { from: a.id, to: `r${i + 1}` },
      ]),
      { from: 'r99', to: 'own' },
      { from: 'own', to: 'r100' },
    ],
  }
}

const arcLength = (line: NodeSegment[] = []) =>
  line
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(p.x - line[i]!.x, p.y - line[i]!.y),
      0,
    )

async function ownDrawn(
  g: Graph,
  bubbleSpread: 'auto' | 'compress',
  fit?: FitSize,
) {
  const { result } = await forceLayout(
    g,
    engineSettingsOf({ bubbleSpread }),
    layoutEngine,
    fit,
  )
  return arcLength(result.nodePositions.own)
}

const requested = (nodes: GraphNode[]) =>
  nodes.reduce((sum, n) => sum + n.length, 0) / 1000

const loopFloorOf = (g: Graph, fit?: FitSize) =>
  loopFloor(fit) *
  requested(layoutScaling(g, spreadFor('compress')).nodes.filter(isBackbone))

test('under compress a 100 kb run off the reference draws at least the loop floor, and still shorter than its bp', async () => {
  const g = looped(true)
  const compressed = await ownDrawn(g, 'compress')
  expect(compressed).toBeGreaterThanOrEqual(loopFloorOf(g))
  expect(compressed).toBeLessThan((await ownDrawn(g, 'auto')) / 3)
})

test('the loop floor is sized for the fit a host passes: a narrower pane holds a longer share of the reference, the same in px', () => {
  const narrow = { width: 900, height: 280 }
  expect(loopFloor()).toBe(loopFloor(ASSUMED_FIT))
  expect(loopFloor(narrow)).toBeGreaterThan(loopFloor())
  expect(loopFloor(narrow) * (900 - 80)).toBeCloseTo(loopFloor() * (1200 - 80))
})

test('under compress a run off the reference draws at least the loop floor of the fit it was laid out for', async () => {
  const g = looped(true)
  const narrow = { width: 900, height: 280 }
  expect(await ownDrawn(g, 'compress', narrow)).toBeGreaterThanOrEqual(
    loopFloorOf(g, narrow),
  )
  expect(await ownDrawn(g, 'compress', narrow)).toBeGreaterThan(
    await ownDrawn(g, 'compress'),
  )
})

test('a force layout with no fit is the one at the assumed fit', async () => {
  const g = looped(true)
  const laidOut = (fit?: FitSize) =>
    forceLayout(
      g,
      engineSettingsOf({ bubbleSpread: 'compress' }),
      layoutEngine,
      fit,
    )
  expect((await laidOut()).result.nodePositions).toEqual(
    (await laidOut(ASSUMED_FIT)).result.nodePositions,
  )
})

test('a layout under compress says its lengths are compressed, and one under a proportional spread does not', async () => {
  const g = looped(true)
  const laidOut = (bubbleSpread: BubbleSpread) =>
    forceLayout(g, engineSettingsOf({ bubbleSpread }), layoutEngine)
  expect((await laidOut('compress')).result.compressed).toBe(true)
  for (const spread of ['auto', 'open', 'wide'] as const) {
    expect((await laidOut(spread)).result.compressed).toBeUndefined()
  }
})

test('with no reference to hide under, compress pulls a 100 kb run in by its law alone', async () => {
  expect(await ownDrawn(looped(false), 'compress')).toBeLessThan(
    loopFloorOf(looped(true)) / 2,
  )
})

test('the loop floor leaves the reference, and every proportional spread, as they were', () => {
  const g = looped(true)
  const backbone = (floor: number) =>
    layoutScaling(g, spreadFor('compress'), floor).nodes.filter(isBackbone)
  expect(backbone(loopFloor())).toEqual(backbone(0))
  for (const spread of ['auto', 'open', 'wide']) {
    expect(layoutScaling(g, spreadFor(spread), loopFloor())).toEqual(
      layoutScaling(g, spreadFor(spread)),
    )
  }
})

// looped's reference with three loops off it: 99.8 kb in one run of two
// nodes, 50 kb in one run of one, and 22.3 kb in three runs that a skip from
// the first to the last cuts apart
function loops(): Graph {
  const g = looped(true)
  const node = (id: string, length: number, start: number) => ({
    id,
    name: id,
    length,
    depth: 1,
    stable: { refName: 'chr1', start, rank: 1 },
  })
  return {
    ...g,
    nodes: [
      ...g.nodes.filter(n => n.id !== 'own'),
      node('lead', 10_000, 39_500),
      node('long', 89_842, 39_500),
      node('half', 50_000, 69_500),
      node('x1', 200, 119_500),
      node('x2', 7432, 119_500),
      node('x3', 14_664, 119_500),
    ],
    edges: [
      ...g.edges.filter(e => e.from !== 'own' && e.to !== 'own'),
      { from: 'r39', to: 'lead' },
      { from: 'lead', to: 'long' },
      { from: 'long', to: 'r40' },
      { from: 'r99', to: 'half' },
      { from: 'half', to: 'r100' },
      { from: 'r139', to: 'x1' },
      { from: 'x1', to: 'x2' },
      { from: 'x2', to: 'x3' },
      { from: 'x3', to: 'r140' },
      { from: 'x1', to: 'x3' },
    ],
  }
}

const compressed = (g: Graph) =>
  layoutScaling(g, spreadFor('compress'), loopFloor()).nodes

const requestedOf = (g: Graph, ids: string[]) =>
  requested(compressed(g).filter(n => ids.includes(n.id)))

test('under compress a 99.8 kb loop of one run draws longer than a 22 kb loop of three', async () => {
  const { result } = await forceLayout(
    loops(),
    engineSettingsOf({ bubbleSpread: 'compress' }),
    layoutEngine,
  )
  const drawnOf = (ids: string[]) =>
    ids.reduce((sum, id) => sum + arcLength(result.nodePositions[id]), 0)
  expect(drawnOf(['lead', 'long'])).toBeGreaterThan(drawnOf(['x1', 'x2', 'x3']))
})

test('under compress the nodes of a run in a loop split its line by bp', async () => {
  const { result } = await forceLayout(
    loops(),
    engineSettingsOf({ bubbleSpread: 'compress' }),
    layoutEngine,
  )
  expect(
    arcLength(result.nodePositions.long) / arcLength(result.nodePositions.lead),
  ).toBeCloseTo(89_842 / 10_000, 0)
})

// looped's 100 kb run with a 1 bp node leading it, in the same run
function ledByOneBp(): Graph {
  const g = looped(true)
  return {
    ...g,
    nodes: [
      ...g.nodes,
      {
        id: 'tiny',
        name: 'tiny',
        length: 1,
        depth: 1,
        stable: { refName: 'chr1', start: 69_500, rank: 1 },
      },
    ],
    edges: [
      ...g.edges.filter(e => e.to !== 'own'),
      { from: 'r99', to: 'tiny' },
      { from: 'tiny', to: 'own' },
    ],
  }
}

test("under compress a 1 bp node in a run of a loop takes its drawn length's share of the run, not its bp share", async () => {
  const g = ledByOneBp()
  const { result } = await forceLayout(
    g,
    engineSettingsOf({ bubbleSpread: 'compress' }),
    layoutEngine,
  )
  const drawn = (id: string) => arcLength(result.nodePositions[id])
  const held = layoutScaling(g, spreadFor('compress')).nodes
  const heldOf = (id: string) => held.find(n => n.id === id)!.length
  const asked = heldOf('tiny') / heldOf('own')
  expect(drawn('tiny') / drawn('own') / asked).toBeCloseTo(1, 2)
})

test('under compress a loop asks the engine for more length the more bp it holds, however many runs it is cut into', () => {
  const g = loops()
  const long = requestedOf(g, ['lead', 'long'])
  const half = requestedOf(g, ['half'])
  expect(long).toBeGreaterThan(half)
  expect(half).toBeGreaterThan(requestedOf(g, ['x1', 'x2', 'x3']))
})

test('under compress a loop of one run still draws at least the loop floor', () => {
  const g = loops()
  expect(requestedOf(g, ['half'])).toBeGreaterThanOrEqual(loopFloorOf(g))
  expect(requestedOf(g, ['lead', 'long'])).toBeGreaterThanOrEqual(
    loopFloorOf(g),
  )
})

test('the runs of a loop split its length by bp', () => {
  const [x1, x2, x3] = ['x1', 'x2', 'x3'].map(id => requestedOf(loops(), [id]))
  expect(x2! / x1!).toBeCloseTo(7432 / 200, 1)
  expect(x3! / x1!).toBeCloseTo(14_664 / 200, 1)
})

test("under compress the reference asks for its law's own length beside loops", () => {
  const g = loops()
  const law = drawnLengthFor(g, spreadFor('compress').law)
  expect(
    compressed(g)
      .filter(isBackbone)
      .map(n => n.length),
  ).toEqual(
    g.nodes.filter(isBackbone).map(n => Math.round(law(n.length) * 1000)),
  )
})

test('every proportional spread hands the engine the bp of each loop and its runs', () => {
  const g = loops()
  for (const spread of ['auto', 'open', 'wide']) {
    expect(layoutScaling(g, spreadFor(spread), loopFloor()).nodes).toBe(g.nodes)
  }
})
