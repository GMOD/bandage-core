import { loadFmmm } from '@jbrowse/graph-fmmm-layout'

import { closableLinks, offReferenceLinks } from '../deletionEdges'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
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

function graphOf(gfa: string) {
  return convertGFAToGraph(parseGFA(gfa))
}

const graph = graphOf(RGFA)

const settings = {
  quality: 1,
  linearLayout: false,
  bubbleSpread: 'auto' as const,
}

async function laidOut(cut: ReturnType<typeof graphOf>) {
  const requests: EngineRequest[] = []
  const engine: LayoutEngine = async request => {
    requests.push(request)
    const bandage = await loadFmmm()
    return {
      result: bandage.computeLayout(request.graph, request.options),
      duration: 0,
    }
  }
  const { result } = await forceLayout(cut, settings, engine)
  return { result, request: requests[0]! }
}

const joining = (from: string, to: string) =>
  expect.objectContaining({ from, to })

test('only the link that skips reference is off the reference', () => {
  expect(offReferenceLinks(graph)).toEqual([2])
})

test('a link back along the reference is off the reference too', () => {
  const duplication = graphOf(`${RGFA}\nL\t3\t+\t1\t+\t0M`)
  expect(offReferenceLinks(duplication)).toEqual([2, 5])
})

test('a force layout leaves out a deletion the rest of the graph bridges', async () => {
  const { result, request } = await laidOut(graph)
  expect(request.graph.edges).not.toContainEqual(joining('1+', '3+'))
  expect(result.deletionRoutes).toBeUndefined()
  expect(Object.keys(result.nodePositions).sort()).toEqual(
    graph.nodes.map(n => n.id).sort(),
  )
  const x = (id: string) => result.nodePositions[id]![0]!.x
  expect(x('1+')).toBeLessThan(x('2+'))
  expect(x('2+')).toBeLessThan(x('3+'))
})

test('a duplication is left out of the layout like a deletion', async () => {
  const { request } = await laidOut(graphOf(`${RGFA}\nL\t3\t+\t1\t+\t0M`))
  expect(request.graph.edges).not.toContainEqual(joining('3+', '1+'))
})

test('a deletion keeps its link when the cut lost a link it skips', () => {
  // 2 is in the graph but nothing links 1 to it, and no allele 4 joins 1 to 3
  const cut = graphOf(
    RGFA.split('\n')
      .filter(l => l !== 'L\t1\t+\t2\t+\t0M' && !l.includes('\t4\t'))
      .join('\n'),
  )
  expect(closableLinks(cut, offReferenceLinks(cut)).size).toBe(0)
  expect(closableLinks(graph, offReferenceLinks(graph)).size).toBe(1)
})
