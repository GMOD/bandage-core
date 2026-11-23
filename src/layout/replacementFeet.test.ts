import { loadFmmm } from '@jbrowse/graph-fmmm-layout'

import { deletionDrawing, deletionEdges } from '../deletionEdges'
import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { forceLayout, loadGraph } from '../pipeline'
import { buildGeometry } from '../renderer/GeometryBuilder'
import { layoutGeometryInputs } from '../renderer/geometryInputs'
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
