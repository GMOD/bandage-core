import { stressLayout } from './stressEngine'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { engineRequest, forceLayout } from '../pipeline'
import { layoutScaling } from './drawnScale'
import { isBackbone } from '../anchoredNodes'

import type { EngineRequest } from '../pipeline'

// chr1 as five backbone nodes with a SNP bubble (a1 beside v3) and an
// insertion (a2 between v4 and v5)
const GFA = `S\tv1\tAAAAAAAAAA\tSN:Z:chr1\tSO:i:0\tSR:i:0
S\tv2\tCCCCCCCCCC\tSN:Z:chr1\tSO:i:10\tSR:i:0
S\tv3\tG\tSN:Z:chr1\tSO:i:20\tSR:i:0
S\tv4\tTTTTTTTTTT\tSN:Z:chr1\tSO:i:21\tSR:i:0
S\tv5\tGAGAGAGAGA\tSN:Z:chr1\tSO:i:31\tSR:i:0
S\ta1\tA\tSN:Z:hap\tSO:i:0\tSR:i:1
S\ta2\tACGTACGTACGTACGT\tSN:Z:hap\tSO:i:5\tSR:i:1
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv3\t+\tv4\t+\t0M
L\tv4\t+\tv5\t+\t0M
L\tv2\t+\ta1\t+\t0M
L\ta1\t+\tv4\t+\t0M
L\tv4\t+\ta2\t+\t0M
L\ta2\t+\tv5\t+\t0M`

const graph = convertGFAToGraph(parseGFA(GFA))
const settings = {
  quality: 2,
  linearLayout: false,
  bubbleSpread: 'auto' as const,
  engine: 'stress' as const,
}
const request = engineRequest(graph, layoutScaling(graph), settings)

const polylineLength = (points: { x: number; y: number }[]) =>
  points.reduce(
    (sum, p, i) =>
      i ? sum + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) : 0,
    0,
  )

test('every node gets the chain of points FMMM would, near its drawn length', () => {
  const { nodePositions } = stressLayout(request)
  const o = request.options as Record<string, number>
  for (const node of request.graph.nodes) {
    const drawn = Math.max(
      (o.nodeLengthPerMegabase! * node.length) / 1e6,
      o.minimumNodeLength!,
    )
    const points = nodePositions[node.id]!
    expect(points.length).toBe(
      Math.max(1, Math.ceil(drawn / o.nodeSegmentLength!)) + 1,
    )
    expect(polylineLength(points) / drawn).toBeGreaterThan(0.9)
    expect(polylineLength(points) / drawn).toBeLessThan(1.1)
  }
})

test('the same request lays out the same way twice, and differently seeded', () => {
  const a = stressLayout(request)
  const b = stressLayout(request)
  expect(a).toEqual(b)
  const c = stressLayout(request, { seed: 7 })
  expect(c).not.toEqual(a)
})

test('a seeded backbone keeps its reference order along x', () => {
  const { nodePositions } = stressLayout(request)
  const xs = graph.nodes
    .filter(isBackbone)
    .sort((a, b) => a.stable.start - b.stable.start)
    .map(n => {
      const points = nodePositions[n.id]!
      return points[Math.floor(points.length / 2)]!.x
    })
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]!).toBeGreaterThan(xs[i - 1]!)
  }
})

test('a chain with free ends keeps its points evenly spaced', () => {
  const one: EngineRequest = {
    graph: {
      nodes: [{ id: 'p+', name: 'p', length: 4000, depth: 1 }],
      edges: [],
    },
    options: {
      nodeLengthPerMegabase: 10_000,
      minimumNodeLength: 5,
      nodeSegmentLength: 20,
      edgeLength: 5,
    },
  }
  const points = stressLayout(one).nodePositions['p+']!
  const steps = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y))
  const per = 40 / (points.length - 1)
  for (const step of steps) {
    expect(step / per).toBeGreaterThan(0.85)
    expect(step / per).toBeLessThan(1.15)
  }
})

test('components stack apart, and an unseeded one lies along x', () => {
  const two: EngineRequest = {
    graph: {
      nodes: [
        { id: 'p+', name: 'p', length: 4000, depth: 1 },
        { id: 'q+', name: 'q', length: 4000, depth: 1 },
      ],
      edges: [],
    },
    options: {
      nodeLengthPerMegabase: 10_000,
      minimumNodeLength: 5,
      nodeSegmentLength: 20,
      edgeLength: 5,
      componentSeparation: 30,
    },
  }
  const { nodePositions } = stressLayout(two)
  const p = nodePositions['p+']!
  const q = nodePositions['q+']!
  const spanY = (pts: typeof p) =>
    Math.max(...pts.map(v => v.y)) - Math.min(...pts.map(v => v.y))
  const spanX = (pts: typeof p) =>
    Math.max(...pts.map(v => v.x)) - Math.min(...pts.map(v => v.x))
  expect(spanY(p)).toBeLessThan(spanX(p) / 10)
  expect(
    Math.min(...q.map(v => v.y)) - Math.max(...p.map(v => v.y)),
  ).toBeCloseTo(30, 5)
})

test('forceLayout takes the stress engine through the same pipeline', async () => {
  const engine = (req: EngineRequest) =>
    Promise.resolve({ result: stressLayout(req), duration: 0 })
  const { result } = await forceLayout(graph, settings, engine)
  expect(Object.keys(result.nodePositions).sort()).toEqual(
    graph.nodes.map(n => n.id).sort(),
  )
  expect(result.stranded).toBe(true)
})
