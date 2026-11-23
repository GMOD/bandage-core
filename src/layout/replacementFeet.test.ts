import { loadFmmm } from '@jbrowse/graph-fmmm-layout'

import { deletionDrawing, deletionEdges } from '../deletionEdges'
import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { forceLayout, loadGraph } from '../pipeline'
import { buildGeometry } from '../renderer/GeometryBuilder'
import { layoutGeometryInputs } from '../renderer/geometryInputs'
import { paddedFeet } from './replacementFeet'

import type { LayoutEngine } from '../pipeline'
import type { NodeSegment } from '../types'

// SV-rep-1k-10k: 2 bp of HG01109's own in place of 1,839 bp of GRCh38, with
// no link from one end of the reference to the other
const replacement = (allele: number, extra: string[] = []) =>
  convertGFAToGraph(
    parseGFA(
      [
        'S\tr1\t*\tLN:i:2000\tSN:Z:chr5\tSO:i:0\tSR:i:0',
        'S\tr2\t*\tLN:i:1839\tSN:Z:chr5\tSO:i:2000\tSR:i:0',
        'S\tr3\t*\tLN:i:2000\tSN:Z:chr5\tSO:i:3839\tSR:i:0',
        `S\tx\t*\tLN:i:${allele}\tSN:Z:HG01109#1#c\tSO:i:0\tSR:i:1`,
        'L\tr1\t+\tr2\t+\t0M',
        'L\tr2\t+\tr3\t+\t0M',
        'L\tr1\t+\tx\t+\t0M',
        'L\tx\t+\tr3\t+\t0M',
        ...extra,
      ].join('\n'),
    ),
  )

const engine: LayoutEngine = async request => {
  const bandage = await loadFmmm()
  return {
    result: bandage.computeLayout(request.graph, request.options),
    duration: 0,
  }
}

const settings = { quality: 1, linearLayout: false, bubbleSpread: 'auto' as const }

const length = (points: NodeSegment[]) =>
  points.reduce(
    (sum, p, i) =>
      i === 0 ? 0 : sum + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y),
    0,
  )

test("an allele under half the reference it replaces pads both its links to the reference, and one over half pads none", () => {
  expect(
    paddedFeet(replacement(2)).map(f => [f.edgeIndex, f.replacedBp, f.ownBp]),
  ).toEqual([
    [2, 1839, 2],
    [3, 1839, 2],
  ])
  expect(paddedFeet(replacement(1000))).toEqual([])
})

test('an allele with a third link to the reference, or a placeholder, is not padded', () => {
  expect(paddedFeet(replacement(2, ['L\tx\t+\tr2\t+\t0M']))).toEqual([])
  const graph = replacement(2)
  expect(
    paddedFeet({
      ...graph,
      nodes: graph.nodes.map(n =>
        n.name === 'x' ? { ...n, placeholder: true as const } : n,
      ),
    }),
  ).toEqual([])
})

// SV-mul-1k-10k: five haplotypes walk 329 bp of their own in place of 4.3 kb
// of GRCh38, and another walks part of the same nodes to rejoin elsewhere, so
// the nodes off the reference meet it by more than two links
test('with walks, each walk run off the reference is an allele, padded where under half the reference it replaces, on its first and last links no other run takes', () => {
  const walked = (third: string) =>
    loadGraph(
      [
        'S\tr1\tAAAA',
        'S\tr2\t' + 'C'.repeat(4000),
        'S\tr3\tGGGG',
        'S\tr4\t' + 'T'.repeat(300),
        'S\ta\tAC',
        'S\tb\tGT',
        'L\tr1\t+\tr2\t+\t0M',
        'L\tr2\t+\tr3\t+\t0M',
        'L\tr3\t+\tr4\t+\t0M',
        'L\tr1\t+\ta\t+\t0M',
        'L\ta\t+\tb\t+\t0M',
        'L\tb\t+\tr3\t+\t0M',
        'L\ta\t+\tr2\t+\t0M',
        'W\tGRCh38\t0\tchr2\t0\t4308\t>r1>r2>r3>r4',
        'W\tfive\t1\tc\t0\t312\t>r1>a>b>r3>r4',
        third,
      ].join('\n'),
      'walked',
    )
  const feet = (g: ReturnType<typeof walked>) =>
    paddedFeet(g).map(f => [
      g.nodes.find(n => n.id === g.edges[f.edgeIndex]!.from)!.name,
      g.nodes.find(n => n.id === g.edges[f.edgeIndex]!.to)!.name,
      f.replacedBp,
    ])
  // another walk leaves r1 for a and rejoins at r2's start: it replaces
  // nothing, so the link it shares is not padded, and the next one is
  expect(feet(walked('W\tother\t1\tc\t0\t4010\t>r1>a>r2>r3'))).toEqual([
    ['a', 'b', 4000],
    ['b', 'r3', 4000],
  ])
  expect(feet(walked(''))).toEqual([
    ['r1', 'a', 4000],
    ['b', 'r3', 4000],
  ])
})

test('a 2 bp replacement of 1.8 kb gets a dashed route on each link, and its feet lie apart on screen', async () => {
  const graph = replacement(2)
  const { result } = await forceLayout(graph, settings, engine)
  const id = (name: string) => graph.nodes.find(n => n.name === name)!.id
  const routes = result.deletionRoutes ?? {}
  expect(Object.keys(routes).map(Number).sort()).toEqual([2, 3])
  const replaced = length(result.nodePositions[id('r2')]!)
  const leave = result.nodePositions[id('r1')]!.at(-1)!
  const rejoin = result.nodePositions[id('r3')]![0]!
  const arm =
    length(routes[2]!) + length(routes[3]!) + length(result.nodePositions[id('x')]!)
  // the arm is drawn about half the reference it replaces, so the reference
  // does not close on it as a loop
  expect(arm).toBeGreaterThan(replaced * 0.3)
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
