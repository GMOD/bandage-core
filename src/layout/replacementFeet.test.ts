import { loadFmmm } from '@jbrowse/graph-fmmm-layout'

import { deletionDrawing, deletionEdges } from '../deletionEdges'
import { figureData } from '../figureData'
import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import {
  drawingBounds,
  fitTransform,
  forceLayout,
  loadGraph,
} from '../pipeline'
import { buildGeometry } from '../renderer/GeometryBuilder'
import { layoutGeometryInputs } from '../renderer/geometryInputs'
import { curvePointAt } from '../util/geometry'
import { paddedFeet } from './replacementFeet'

import type { LayoutEngine } from '../pipeline'
import type { Graph, NodeSegment } from '../types'

const bases = (bp: number) => 'A'.repeat(bp)

// SV-rep-1k-10k: 2 bp of HG01109's own in place of 1,839 bp of GRCh38, with
// no link from one end of the reference to the other
const replacement = (allele: number, replaced = 1839) =>
  loadGraph(
    [
      `S\tr1\t${bases(2000)}`,
      `S\tr2\t${bases(replaced)}`,
      `S\tr3\t${bases(2000)}`,
      `S\tx\t${bases(allele)}`,
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr1\t+\tx\t+\t0M',
      'L\tx\t+\tr3\t+\t0M',
      `W\tGRCh38\t0\tchr5\t0\t${4000 + replaced}\t>r1>r2>r3`,
      `W\tHG01109\t1\tc\t0\t${4000 + allele}\t>r1>x>r3`,
    ].join('\n'),
    'replacement',
  )

const engine: LayoutEngine = async request => {
  const bandage = await loadFmmm()
  return {
    result: bandage.computeLayout(request.graph, request.options),
    duration: 0,
  }
}

const settings = {
  quality: 1,
  linearLayout: false,
  bubbleSpread: 'auto' as const,
}

const length = (points: NodeSegment[]) =>
  points.reduce(
    (sum, p, i) =>
      i === 0
        ? 0
        : sum + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y),
    0,
  )

const named = (graph: Graph) =>
  paddedFeet(graph).map(f => [
    graph.nodes.find(n => n.id === graph.edges[f.edgeIndex]!.from)!.name,
    graph.nodes.find(n => n.id === graph.edges[f.edgeIndex]!.to)!.name,
    f.replacedBp,
  ])

// five 1 kb reference nodes and a 1 bp junction j, which `walk` takes
const fiveWith = (walk: string, reference = '>r1>r2>r3>r4>r5') =>
  loadGraph(
    [
      ...[1, 2, 3, 4, 5].map(i => `S\tr${i}\t${bases(1000)}`),
      'S\tj\tA',
      ...[1, 2, 3, 4].map(i => `L\tr${i}\t+\tr${i + 1}\t+\t0M`),
      'L\tr4\t+\tj\t+\t0M',
      'L\tj\t+\tr2\t+\t0M',
      'L\tr1\t+\tj\t+\t0M',
      'L\tj\t+\tr4\t-\t0M',
      'L\tr2\t-\tr5\t+\t0M',
      'L\tj\t+\tr4\t+\t0M',
      'L\tr2\t+\tr2\t+\t0M',
      `W\tGRCh38\t0\tchr1\t0\t*\t${reference}`,
      `W\talt\t1\tc\t0\t*\t${walk}`,
    ].join('\n'),
    'five',
  )

test('an allele under half the reference it replaces pads both its links to the reference, one over half none', () => {
  expect(named(replacement(2))).toEqual([
    ['r1', 'x', 1839],
    ['x', 'r3', 1839],
  ])
  expect(named(replacement(1000))).toEqual([])
})

test('a skip forward on one pass is padded, and a tandem duplication, an inversion and a revisited node, each with a 1 bp junction, are not', () => {
  expect(named(fiveWith('>r1>j>r4>r5'))).toEqual([
    ['r1', 'j', 2000],
    ['j', 'r4', 2000],
  ])
  expect(named(fiveWith('>r1>r2>r3>r4>j>r2>r3>r4>r5'))).toEqual([])
  expect(named(fiveWith('>r1>j<r4<r3<r2>r5'))).toEqual([])
  expect(named(fiveWith('>r1>j>r4>r5', '>r1>r2>r3>r4>r1>r2>r3>r4>r5'))).toEqual(
    [],
  )
})

test('a graph without walks pads nothing', () => {
  const rgfa = convertGFAToGraph(
    parseGFA(
      [
        'S\tr1\t*\tLN:i:2000\tSN:Z:chr5\tSO:i:0\tSR:i:0',
        'S\tr2\t*\tLN:i:1839\tSN:Z:chr5\tSO:i:2000\tSR:i:0',
        'S\tr3\t*\tLN:i:2000\tSN:Z:chr5\tSO:i:3839\tSR:i:0',
        'S\tx\t*\tLN:i:2\tSN:Z:HG01109#1#c\tSO:i:0\tSR:i:1',
        'L\tr1\t+\tr2\t+\t0M',
        'L\tr2\t+\tr3\t+\t0M',
        'L\tr1\t+\tx\t+\t0M',
        'L\tx\t+\tr3\t+\t0M',
      ].join('\n'),
    ),
  )
  expect(paddedFeet(rgfa)).toEqual([])
})

test('a 2 bp replacement of 1.8 kb gets a dashed route on each link, and its feet lie apart on screen', async () => {
  const graph = replacement(2)
  const { result } = await forceLayout(graph, settings, engine)
  const id = (name: string) => graph.nodes.find(n => n.name === name)!.id
  const routes = result.deletionRoutes ?? {}
  expect(
    Object.keys(routes)
      .map(Number)
      .toSorted((a, b) => a - b),
  ).toEqual([2, 3])
  const replaced = length(result.nodePositions[id('r2')]!)
  const leave = result.nodePositions[id('r1')]!.at(-1)!
  const rejoin = result.nodePositions[id('r3')]![0]!
  const arm =
    length(routes[2]!) +
    length(routes[3]!) +
    length(result.nodePositions[id('x')]!)
  expect(arm).toBeGreaterThan(replaced * 0.3)
  expect(arm).toBeLessThan(replaced * 0.8)
  expect(Math.hypot(leave.x - rejoin.x, leave.y - rejoin.y)).toBeGreaterThan(
    replaced * 0.2,
  )
  const batch = buildGeometry({
    ...layoutGeometryInputs(
      result,
      deletionDrawing(graph, deletionEdges(graph), true),
    ),
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    axis: { scaleX: 1, scaleY: 1 },
  })
  const stroke = (edge: number) =>
    batch.edgeCurves[batch.edgeCurveRuns.get(edge)!.start]!
  expect([2, 3].map(edge => stroke(edge).skip)).toEqual([true, true])
  expect([0, 1].map(edge => stroke(edge).skip)).toEqual([undefined, undefined])
})

// figure data read a padded foot as a plain link, so ggbandage painted it
// under the nodes, where it paints no skip
test('figure data marks a routed padded foot a skip, as it is drawn', async () => {
  const graph = replacement(2)
  const { result } = await forceLayout(graph, settings, engine)
  const { edges } = figureData(graph, result)
  const skips = new Set(edges.edge.filter((_, i) => edges.deletion[i]))
  expect(Object.keys(result.deletionRoutes ?? {}).map(Number)).toEqual([2, 3])
  expect([0, 1, 2, 3].map(edge => skips.has(edge))).toEqual([
    false,
    false,
    true,
    true,
  ])
})

// a 1 bp allele for 3 bp, padded, drew three of the layout's shortest nodes
// against one: the bulge of G4's short skips
test('a replacement too small for a route the layout can draw shorter than the reference is not padded', async () => {
  const graph = replacement(1, 3)
  expect(named(graph)).toEqual([
    ['r1', 'x', 3],
    ['x', 'r3', 3],
  ])
  const { result } = await forceLayout(graph, settings, engine)
  expect(result.deletionRoutes).toBeUndefined()
})

// a 13 bp allele in place of `replaced` bp, between 20 kb flanks each split
// into `pieces` nodes
const flanked = (pieces: number, replaced: number) => {
  const left = Array.from({ length: pieces }, (_, i) => `a${i}`)
  const right = Array.from({ length: pieces }, (_, i) => `b${i}`)
  const chain = (ids: string[]) =>
    ids.slice(1).map((id, i) => `L\t${ids[i]}\t+\t${id}\t+\t0M`)
  const steps = (ids: string[]) => ids.map(id => `>${id}`).join('')
  return loadGraph(
    [
      ...[...left, ...right].map(
        id => `S\t${id}\t${bases(Math.round(20_000 / pieces))}`,
      ),
      `S\tr\t${bases(replaced)}`,
      `S\tx\t${bases(13)}`,
      ...chain(left),
      ...chain(right),
      `L\t${left.at(-1)}\t+\tr\t+\t0M`,
      `L\tr\t+\t${right[0]}\t+\t0M`,
      `L\t${left.at(-1)}\t+\tx\t+\t0M`,
      `L\tx\t+\t${right[0]}\t+\t0M`,
      `W\tGRCh38\t0\tchr7\t0\t*\t${steps([...left, 'r', ...right])}`,
      `W\tHG1\t1\tc\t0\t*\t${steps([...left, 'x', ...right])}`,
    ].join('\n'),
    `flanked${pieces}`,
  )
}

test.each([1262, 13_267])(
  'whether a 13 bp allele for %i bp is padded, and its arm against the reference, do not hang on how its flanks are split into nodes',
  async replaced => {
    const drawn: { padded: boolean; ratio: number }[] = []
    for (const pieces of [1, 10, 100, 400]) {
      const graph = flanked(pieces, replaced)
      const { result } = await forceLayout(graph, settings, engine)
      const id = (name: string) => graph.nodes.find(n => n.name === name)!.id
      const routes = Object.values(result.deletionRoutes ?? {})
      const arm =
        routes.reduce((sum, route) => sum + length(route), 0) +
        length(result.nodePositions[id('x')]!)
      drawn.push({
        padded: routes.length > 0,
        ratio: arm / length(result.nodePositions[id('r')]!),
      })
    }
    expect(drawn.map(d => d.padded)).toEqual(drawn.map(() => replaced > 10_000))
    for (const { ratio } of drawn) {
      expect(ratio).toBeLessThan(1)
      expect(ratio).toBeCloseTo(drawn[0]!.ratio, 2)
    }
  },
)

// SV-del-100k+ at its fit: a 3,146 bp skip over 1 bp skips the fold hid drew
// a teardrop 28 px across over 20 px of the reference it skips, and an arm
// under 33 px across followed its route wherever the layout bent it
test('at the fit, a padded arm and a skip over folded skips each draw within the reference between their feet, measured in px', async () => {
  // flanks of 2 kb pieces between SNPs, which keep them apart as the
  // engine lays them, as a hosted cut's are
  const pieces = 60
  const flank = (side: string) =>
    Array.from({ length: pieces }, (_, i): [string, number][] => [
      [`${side}${i}`, 2000],
      ...(i < pieces - 1
        ? [[`${side}s${i}`, 1] satisfies [string, number]]
        : []),
    ]).flat()
  const snps = ['a', 'b'].flatMap(side =>
    Array.from({ length: pieces - 1 }, (_, i) => [
      `S\t${side}t${i}\tC`,
      `L\t${side}${i}\t+\t${side}t${i}\t+\t0M`,
      `L\t${side}t${i}\t+\t${side}${i + 1}\t+\t0M`,
    ]).flat(),
  )
  const last = `a${pieces - 1}`
  const replaced = Array.from({ length: 5 }, (_, i): [string, number] => [
    `r${i}`,
    3000,
  ])
  const deleted: [string, number][] = [
    ['d0', 3000],
    ['d1', 100],
    ['d2', 100],
    ['d3', 100],
    ['d4', 3000],
  ]
  const reference = [
    ...flank('a'),
    ...replaced,
    ['m', 5000] satisfies [string, number],
    ...deleted,
    ...flank('b'),
  ]
  const names = reference.map(([name]) => name)
  const chain = (ids: readonly string[]) =>
    ids.slice(1).map((id, i) => `L\t${ids[i]}\t+\t${id}\t+\t0M`)
  const steps = (ids: readonly string[]) => ids.map(id => `>${id}`).join('')
  const without = (...left: string[]) =>
    steps(names.filter(name => !left.includes(name)))
  const graph = loadGraph(
    [
      ...reference.map(([name, bp]) => `S\t${name}\t${bases(bp)}`),
      `S\tx\t${bases(13)}`,
      ...chain(names),
      ...snps,
      `L\t${last}\t+\tx\t+\t0M`,
      'L\tx\t+\tm\t+\t0M',
      'L\tm\t+\tb0\t+\t0M',
      'L\td0\t+\td2\t+\t0M',
      'L\td1\t+\td3\t+\t0M',
      'L\td2\t+\td4\t+\t0M',
      `W\tGRCh38\t0\tchr4\t0\t*\t${steps(names)}`,
      `W\tHG1\t1\tc\t0\t*\t${without('r0', 'r1', 'r2', 'r3', 'r4').replace(`>${last}>`, `>${last}>x>`)}`,
      `W\tHG2\t1\tc\t0\t*\t${without('d0', 'd1', 'd2', 'd3', 'd4')}`,
      `W\tHG3\t1\tc\t0\t*\t${without('d1')}`,
      `W\tHG4\t1\tc\t0\t*\t${without('d2')}`,
      `W\tHG5\t1\tc\t0\t*\t${without('d3')}`,
    ].join('\n'),
    'sv-del',
  )
  const pane = { width: 1090, height: 300 }
  const { result } = await forceLayout(graph, settings, engine, pane)
  const fit = fitTransform(
    drawingBounds(result),
    pane.width,
    pane.height,
    false,
  )!
  const axis = { scaleX: fit.scale, scaleY: fit.scale }
  const batch = buildGeometry({
    ...layoutGeometryInputs(
      result,
      deletionDrawing(graph, deletionEdges(graph), true),
    ),
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'walks',
    edgeWidth: 'walks',
    axis,
  })
  const id = (name: string) => graph.nodes.find(n => n.name === name)!.id
  const edgeOf = (from: string, to: string) =>
    graph.edges.findIndex(e => e.from === id(from) && e.to === id(to))
  const px = (p: { x: number; y: number }) => ({
    x: p.x * fit.scale,
    y: p.y * fit.scale,
  })
  // the reference as drawn from one foot through the nodes between to the
  // other, its links and all
  const referencePx = (from: string, ids: readonly string[], to: string) =>
    length([
      result.nodePositions[id(from)]!.at(-1)!,
      ...ids.flatMap(name => result.nodePositions[id(name)]!),
      result.nodePositions[id(to)]![0]!,
    ]) * fit.scale
  const drawnPx = (edge: number) => {
    const run = batch.edgeCurveRuns.get(edge)!
    return batch.edgeCurves
      .slice(run.start, run.start + run.count)
      .flatMap(stroke => stroke.curves)
      .flatMap(c =>
        Array.from({ length: 65 }, (_, k) => px(curvePointAt(c, k / 64))),
      )
  }
  const extent = (points: { x: number; y: number }[]) => {
    const spread = (vs: number[]) =>
      vs.reduce((most, v) => Math.max(most, v), -Infinity) -
      vs.reduce((least, v) => Math.min(least, v), Infinity)
    return Math.max(spread(points.map(p => p.x)), spread(points.map(p => p.y)))
  }
  // the most a link strays past its feet along their chord, or off it by
  // more than the chord is long
  const overChord = (from: string, to: string, edge: number) => {
    const a = px(result.nodePositions[id(from)]!.at(-1)!)
    const b = px(result.nodePositions[id(to)]![0]!)
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / chord
    const uy = (b.y - a.y) / chord
    const over = drawnPx(edge).reduce((most, p) => {
      const along = (p.x - a.x) * ux + (p.y - a.y) * uy
      const across = Math.abs((p.y - a.y) * ux - (p.x - a.x) * uy)
      return Math.max(most, -along, along - chord, across - chord)
    }, -Infinity)
    return { chord, over }
  }

  const replacedPx = referencePx(
    last,
    replaced.map(([name]) => name),
    'm',
  )
  for (const [from, to] of [
    [last, 'x'],
    ['x', 'm'],
  ] as const) {
    const arm = edgeOf(from, to)
    expect(batch.edgeCurveRuns.has(arm)).toBe(true)
    const { chord, over } = overChord(from, to, arm)
    expect(chord).toBeLessThan(33)
    expect(over).toBeLessThan(0.01)
    expect(extent(drawnPx(arm))).toBeLessThan(replacedPx)
  }
  expect(
    extent([
      ...drawnPx(edgeOf(last, 'x')),
      ...result.nodePositions[id('x')]!.map(px),
      ...drawnPx(edgeOf('x', 'm')),
    ]),
  ).toBeLessThan(replacedPx)

  const skip = edgeOf('m', 'b0')
  expect(batch.edgeCurveRuns.has(skip)).toBe(true)
  const { chord, over } = overChord('m', 'b0', skip)
  expect(chord).toBeLessThan(33)
  expect(over).toBeLessThan(0.01)
  expect(extent(drawnPx(skip))).toBeLessThanOrEqual(
    referencePx(
      'm',
      deleted.map(([name]) => name),
      'b0',
    ),
  )
}, 60_000)

// `middle` between flanks of `pieces` 2 kb pieces, a SNP between each, which
// keep them apart as the engine lays them, as a hosted cut's are
function snpWindow(middle: [string, number][], pieces: number) {
  const flank = (side: string) =>
    Array.from({ length: pieces }, (_, i): [string, number][] => [
      [`${side}${i}`, 2000],
      ...(i < pieces - 1
        ? [[`${side}s${i}`, 1] satisfies [string, number]]
        : []),
    ]).flat()
  const reference = [...flank('a'), ...middle, ...flank('b')]
  const names = reference.map(([name]) => name)
  return {
    names,
    last: `a${pieces - 1}`,
    lines: [
      ...reference.map(([name, bp]) => `S\t${name}\t${bases(bp)}`),
      ...names.slice(1).map((id, i) => `L\t${names[i]}\t+\t${id}\t+\t0M`),
      ...['a', 'b'].flatMap(side =>
        Array.from({ length: pieces - 1 }, (_, i) => [
          `S\t${side}t${i}\tC`,
          `L\t${side}${i}\t+\t${side}t${i}\t+\t0M`,
          `L\t${side}t${i}\t+\t${side}${i + 1}\t+\t0M`,
        ]).flat(),
      ),
    ],
  }
}

const steps = (ids: readonly string[]) => ids.map(id => `>${id}`).join('')

// a graph laid out and built at the fit of a 1090 x 300 px pane, by walks
async function drawnAtFit(graph: Graph) {
  const pane = { width: 1090, height: 300 }
  const { result } = await forceLayout(graph, settings, engine, pane)
  const fit = fitTransform(
    drawingBounds(result),
    pane.width,
    pane.height,
    false,
  )!
  const batch = buildGeometry({
    ...layoutGeometryInputs(
      result,
      deletionDrawing(graph, deletionEdges(graph), true),
    ),
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'walks',
    edgeWidth: 'walks',
    axis: { scaleX: fit.scale, scaleY: fit.scale },
  })
  return { result, fit, batch }
}

// review 4: 13 bp eight of nine walks carry in place of 4 kb, about 29 px of
// reference at the fit, had both feet left out under their 6 px strokes and
// was drawn about 10 px from each reference end, joined to neither
test.each([8, 1])(
  'at the fit, a short allele %i of 8 haplotypes carry in place of 4 kb is drawn linked to the reference at each end, in px',
  async carriers => {
    const { names, last, lines } = snpWindow([['r', 4000]], 30)
    const graph = loadGraph(
      [
        ...lines,
        `S\tx\t${bases(13)}`,
        `L\t${last}\t+\tx\t+\t0M`,
        'L\tx\t+\tb0\t+\t0M',
        `W\tGRCh38\t0\tchr4\t0\t*\t${steps(names)}`,
        ...Array.from({ length: 8 }, (_, i) =>
          i < carriers
            ? `W\tHG${i}\t1\tc\t0\t*\t${steps(names.filter(name => name !== 'r')).replace(`>${last}>`, `>${last}>x>`)}`
            : `W\tHG${i}\t1\tc\t0\t*\t${steps(names)}`,
        ),
      ].join('\n'),
      `carried by ${carriers}`,
    )
    const { result, fit, batch } = await drawnAtFit(graph)
    const id = (name: string) => graph.nodes.find(n => n.name === name)!.id
    const at = (p: { x: number; y: number }) => ({
      x: p.x * fit.scale,
      y: p.y * fit.scale,
    })
    const ends = (name: string) => {
      const line = result.nodePositions[id(name)]!
      return [at(line[0]!), at(line.at(-1)!)]
    }
    for (const [from, to] of [
      [last, 'x'],
      ['x', 'b0'],
    ] as const) {
      const edge = graph.edges.findIndex(
        e => e.from === id(from) && e.to === id(to),
      )
      const run = batch.edgeCurveRuns.get(edge)
      expect(run).toBeDefined()
      const strokes = batch.edgeCurves.slice(
        run!.start,
        run!.start + run!.count,
      )
      const drawn = strokes
        .flatMap(stroke => stroke.curves)
        .flatMap(c =>
          Array.from({ length: 17 }, (_, k) => at(curvePointAt(c, k / 16))),
        )
      const nearest = (points: { x: number; y: number }[]) =>
        drawn.reduce(
          (least, p) =>
            points.reduce(
              (closest, q) =>
                Math.min(closest, Math.hypot(p.x - q.x, p.y - q.y)),
              least,
            ),
          Infinity,
        )
      expect(nearest(ends(from))).toBeLessThan(2)
      expect(nearest(ends(to))).toBeLessThan(2)
      const span = Math.hypot(
        drawn.at(-1)!.x - drawn[0]!.x,
        drawn.at(-1)!.y - drawn[0]!.y,
      )
      const stroke = strokes[0]!.thickness * 2
      expect(span < 3 * stroke).toBe(carriers === 8)
      expect(strokes.every(s => s.skip === true)).toBe(carriers === 1)
    }
  },
  60_000,
)

// review 4: a 2.5 kb deletion eight of nine walks take, about 15 px across at
// the fit, was left out, and the thick reference stopped at a gap the
// hairline of the skipped reference alone crossed
test.each([8, 1])(
  'at the fit, a short deletion %i of 8 haplotypes take is drawn as a link joining the flanks, at its walks width, plain when it holds no arch',
  async carriers => {
    const { names, last, lines } = snpWindow([['d', 2500]], 30)
    const graph = loadGraph(
      [
        ...lines,
        `L\t${last}\t+\tb0\t+\t0M`,
        `W\tGRCh38\t0\tchr4\t0\t*\t${steps(names)}`,
        ...Array.from(
          { length: 8 },
          (_, i) =>
            `W\tHG${i}\t1\tc\t0\t*\t${steps(i < carriers ? names.filter(name => name !== 'd') : names)}`,
        ),
      ].join('\n'),
      `deletion carried by ${carriers}`,
    )
    const { result, fit, batch } = await drawnAtFit(graph)
    const id = (name: string) => graph.nodes.find(n => n.name === name)!.id
    const at = (p: { x: number; y: number }) => ({
      x: p.x * fit.scale,
      y: p.y * fit.scale,
    })
    const edge = graph.edges.findIndex(
      e => e.from === id(last) && e.to === id('b0'),
    )
    const run = batch.edgeCurveRuns.get(edge)
    expect(run).toBeDefined()
    const strokes = batch.edgeCurves.slice(run!.start, run!.start + run!.count)
    const drawn = strokes
      .flatMap(stroke => stroke.curves)
      .flatMap(c =>
        Array.from({ length: 17 }, (_, k) => at(curvePointAt(c, k / 16))),
      )
    const nearest = (p: { x: number; y: number }) =>
      drawn.reduce(
        (least, q) => Math.min(least, Math.hypot(p.x - q.x, p.y - q.y)),
        Infinity,
      )
    expect(nearest(at(result.nodePositions[id(last)]!.at(-1)!))).toBeLessThan(2)
    expect(nearest(at(result.nodePositions[id('b0')]![0]!))).toBeLessThan(2)
    expect(strokes[0]!.thickness * 2).toBeCloseTo(
      Math.max(1, (6 * carriers) / 9),
      5,
    )
    expect(strokes.every(s => s.skip === true)).toBe(carriers === 1)
  },
  60_000,
)
