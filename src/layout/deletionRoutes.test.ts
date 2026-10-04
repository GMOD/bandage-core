import { closableDeletions, withDeletionRoutes } from './deletionRoutes'
import { mergeRuns } from './mergeRuns'
import { deletionEdges } from '../deletionEdges'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import loadBandage from '../loadBandage'
import { forceLayout } from '../pipeline'

import type { EngineRequest, LayoutEngine } from '../pipeline'

// 2 is 20 kb of reference that 1 -> 3 skips; 4 is an allele beside 2.
const RGFA = [
  'S\t1\t*\tLN:i:8000\tSN:Z:chr6\tSO:i:0\tSR:i:0',
  'S\t2\t*\tLN:i:20000\tSN:Z:chr6\tSO:i:8000\tSR:i:0',
  'S\t3\t*\tLN:i:8000\tSN:Z:chr6\tSO:i:28000\tSR:i:0',
  'S\t4\t*\tLN:i:300\tSN:Z:HG1#1#c\tSO:i:0\tSR:i:1',
  'L\t1\t+\t2\t+\t0M',
  'L\t2\t+\t3\t+\t0M',
  'L\t1\t+\t3\t+\t0M',
  'L\t1\t+\t4\t+\t0M',
  'L\t4\t+\t3\t+\t0M',
].join('\n')

const graph = convertGFAToGraph(parseGFA(RGFA))

const engine: LayoutEngine = async request => {
  const bandage = await loadBandage()
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

function length(points: { x: number; y: number }[]) {
  let sum = 0
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(
      points[i]!.x - points[i - 1]!.x,
      points[i]!.y - points[i - 1]!.y,
    )
  }
  return sum
}

test('a deletion link runs through a node of its own, strands kept', () => {
  const deletions = deletionEdges(graph)
  const { graph: routed, routes } = withDeletionRoutes(graph, deletions)
  const id = routes.get(deletions[0]!.edgeIndex)!
  expect(routed.nodes.map(n => n.id)).toContain(id)
  expect(routed.edges).toHaveLength(graph.edges.length + 1)
  expect(routed.edges).toContainEqual({ from: '1+', fromStrand: '+', to: id })
  expect(routed.edges).toContainEqual({ from: id, to: '3+', toStrand: '+' })
  expect(routed.edges).not.toContainEqual(graph.edges[deletions[0]!.edgeIndex])
})

test('a route node never merges into a run', () => {
  // 1's end holds only the link to the route, so without `alone` the two
  // would join one chain
  const solo = convertGFAToGraph(
    parseGFA(
      [
        'S\t1\t*\tLN:i:100\tSN:Z:chr6\tSO:i:0\tSR:i:0',
        'S\t3\t*\tLN:i:100\tSN:Z:chr6\tSO:i:500\tSR:i:0',
        'L\t1\t+\t3\t+\t0M',
      ].join('\n'),
    ),
  )
  const routed = withDeletionRoutes(solo, deletionEdges(solo))
  expect(mergeRuns(routed.graph).runs.size).toBe(1)
  expect(mergeRuns(routed.graph, routed.ids).runs.size).toBe(0)
})

test('a force layout lays the deletion out as a route between its ends', async () => {
  const { result } = await forceLayout(graph, settings, engine)
  const [deletion] = deletionEdges(graph)
  const route = result.deletionRoutes?.[deletion!.edgeIndex]
  expect(route!.length).toBeGreaterThan(1)
  expect(Object.keys(result.nodePositions).sort()).toEqual(
    graph.nodes.map(n => n.id).sort(),
  )
  const from = result.nodePositions['1+']!
  const to = result.nodePositions['3+']!
  const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)
  const nearest = (p: { x: number; y: number }, ends: typeof from) =>
    Math.min(gap(p, ends[0]!), gap(p, ends.at(-1)!))
  expect(nearest(route![0]!, from)).toBeLessThan(nearest(route![0]!, to))
  expect(nearest(route!.at(-1)!, to)).toBeLessThan(
    nearest(route!.at(-1)!, from),
  )
  // half the skipped reference, give or take the simulation
  const skipped = length(result.nodePositions['2+']!)
  expect(length(route!)).toBeGreaterThan(skipped * 0.25)
  expect(length(route!)).toBeLessThan(skipped * 0.75)
  expect(result.extent).toBeDefined()
})

test('a graph without deletions lays out as before, with no routes', async () => {
  const plain = convertGFAToGraph(
    parseGFA(
      RGFA.split('\n')
        .filter(l => l !== 'L\t1\t+\t3\t+\t0M')
        .join('\n'),
    ),
  )
  const { result } = await forceLayout(plain, settings, engine)
  expect(result.deletionRoutes).toBeUndefined()
  expect(result.extent).toBeUndefined()
})

test('a force layout without deletion edges closes the bubble', async () => {
  const requests: EngineRequest[] = []
  const recording: LayoutEngine = request => {
    requests.push(request)
    return engine(request)
  }
  const { result } = await forceLayout(
    graph,
    { ...settings, showDeletionEdges: false },
    recording,
  )
  expect(result.deletionRoutes).toBeUndefined()
  expect(requests[0]!.graph.nodes).toHaveLength(graph.nodes.length)
  expect(requests[0]!.graph.edges).not.toContainEqual(
    expect.objectContaining({ from: '1+', to: '3+' }),
  )
})

test('a deletion whose skipped reference the cut lost keeps its link', async () => {
  const cut = convertGFAToGraph(
    parseGFA(
      RGFA.split('\n')
        .filter(l => !/^S\t[24]\t|\t[24]\t/.test(l))
        .join('\n'),
    ),
  )
  const [deletion] = deletionEdges(cut)
  const { result } = await forceLayout(
    cut,
    { ...settings, showDeletionEdges: false },
    engine,
  )
  expect(result.deletionRoutes?.[deletion!.edgeIndex]).toBeDefined()
})

test('a deletion keeps its link when the cut lost a link it skips', () => {
  // 2 is in the graph but nothing links 1 to it, and no allele 4 joins 1 to 3
  const cut = convertGFAToGraph(
    parseGFA(
      RGFA.split('\n')
        .filter(l => l !== 'L\t1\t+\t2\t+\t0M' && !l.includes('\t4\t'))
        .join('\n'),
    ),
  )
  expect(closableDeletions(cut, deletionEdges(cut)).size).toBe(0)
  expect(closableDeletions(graph, deletionEdges(graph)).size).toBe(1)
})
