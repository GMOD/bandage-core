import { deletionEdges } from '../deletionEdges'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import loadBandage from '../loadBandage'
import { mergeRuns } from './mergeRuns'
import { forceLayout } from '../pipeline'
import { baseEdgeCurves } from '../util/edgeCurves'
import { strandSides } from '../util/geometry'

import type { LayoutEngine } from '../pipeline'
import type { NodeSegment } from '../types'

// 1 -> 3 skips 2, a deletion. HG1's allele leaves 1, reads 5 backwards, and
// rejoins at 3 through 6 and 7, an unbranching run the engine lays as one.
// HG2's reads 5 forwards, so one pair of links reads 5 flipped.
const RGFA = [
  'S\t1\t*\tLN:i:8000\tSN:Z:chr6\tSO:i:0\tSR:i:0',
  'S\t2\t*\tLN:i:20000\tSN:Z:chr6\tSO:i:8000\tSR:i:0',
  'S\t3\t*\tLN:i:8000\tSN:Z:chr6\tSO:i:28000\tSR:i:0',
  'S\t4\t*\tLN:i:3000\tSN:Z:HG1#1#c\tSO:i:0\tSR:i:1',
  'S\t5\t*\tLN:i:2000\tSN:Z:HG1#1#c\tSO:i:3000\tSR:i:1',
  'S\t6\t*\tLN:i:2500\tSN:Z:HG1#1#c\tSO:i:5000\tSR:i:1',
  'S\t7\t*\tLN:i:2500\tSN:Z:HG1#1#c\tSO:i:7500\tSR:i:1',
  'L\t1\t+\t2\t+\t0M',
  'L\t2\t+\t3\t+\t0M',
  'L\t1\t+\t3\t+\t0M',
  'L\t1\t+\t4\t+\t0M',
  'L\t4\t+\t5\t-\t0M',
  'L\t5\t-\t6\t+\t0M',
  'L\t6\t+\t7\t+\t0M',
  'L\t7\t+\t3\t+\t0M',
  'L\t1\t+\t5\t+\t0M',
  'L\t5\t+\t3\t+\t0M',
].join('\n')

const engine: LayoutEngine = async request => {
  const bandage = await loadBandage()
  return {
    result: bandage.computeLayout(request.graph, request.options),
    duration: 0,
  }
}

const gap = (a: NodeSegment, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

test('every link joins the ends the engine joined', async () => {
  const graph = convertGFAToGraph(parseGFA(RGFA))
  expect([...mergeRuns(graph).runs.values()]).toEqual([['6+', '7+']])
  const flipped = graph.edges.filter(e => {
    const sides = strandSides(e)
    return sides.from === 'start' || sides.to === 'end'
  })
  expect(flipped).toHaveLength(2)
  const { result } = await forceLayout(
    graph,
    { quality: 1, linearLayout: false, bubbleSpread: 'auto' },
    engine,
  )
  expect(result.stranded).toBe(true)
  const deletions = deletionEdges(graph)
  expect(deletions).toHaveLength(1)
  const curves = baseEdgeCurves(
    result.nodePositions,
    graph,
    { scaleX: 1, scaleY: 1 },
    new Map(deletions.map(d => [d.edgeIndex, d.bypassed])),
    0,
    result.deletionRoutes,
    true,
  )
  graph.edges.forEach((edge, ei) => {
    const from = result.nodePositions[edge.from]!
    const to = result.nodePositions[edge.to]!
    const sides = strandSides(edge)
    const end = (segments: NodeSegment[], side: 'start' | 'end') =>
      side === 'start' ? segments[0]! : segments.at(-1)!
    const other = (side: 'start' | 'end') =>
      side === 'start' ? 'end' : 'start'
    const leaves = end(from, sides.from)
    const enters = end(to, sides.to)
    const drawn = curves.get(ei)!
    expect(gap(leaves, { x: drawn[0]!.x0, y: drawn[0]!.y0 })).toBeCloseTo(0)
    expect(
      gap(enters, { x: drawn.at(-1)!.x1, y: drawn.at(-1)!.y1 }),
    ).toBeCloseTo(0)
    if (deletions.some(d => d.edgeIndex === ei)) {
      return
    }
    const joined = gap(leaves, enters)
    expect(joined).toBeLessThan(gap(end(from, other(sides.from)), enters))
    expect(joined).toBeLessThan(gap(leaves, end(to, other(sides.to))))
  })
})
