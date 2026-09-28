import { bubblesFromGraph } from './bubblesFromGraph'
import { NOT_CROSSED, haplotypeMatrix, routeDelta } from './haplotypeMatrix'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { haplotypeMatrixLayout } from '../layout/haplotypeMatrixLayout'
import { anchorGraph } from '../pathAnchoring'

// Two sites: a1 for v2, and b1 for v4. Nobody takes c1 for v6, and HG4's walk
// stops at v3, before the second site.
const GFA = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\tv4\tTTT
S\tv5\tAAAA
S\tv6\tCC
S\tv7\tGGG
S\ta1\t${'T'.repeat(10)}
S\tb1\tA
S\tc1\tA
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv3\t+\tv4\t+\t0M
L\tv4\t+\tv5\t+\t0M
L\tv5\t+\tv6\t+\t0M
L\tv6\t+\tv7\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
L\tv3\t+\tb1\t+\t0M
L\tb1\t+\tv5\t+\t0M
L\tv5\t+\tc1\t+\t0M
L\tc1\t+\tv7\t+\t0M
W\tref\t0\tchr\t0\t21\t>v1>v2>v3>v4>v5>v6>v7
W\tHG1\t1\tchr\t0\t27\t>v1>a1>v3>b1>v5>v6>v7
W\tHG2\t1\tchr\t0\t29\t>v1>a1>v3>v4>v5>v6>v7
W\tHG3\t1\tchr\t0\t19\t>v1>v2>v3>b1>v5>v6>v7
W\tHG4\t1\tchr\t0\t9\t>v1>v2>v3`

const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')

test('a column per site the walks differ at, a row per walk', () => {
  const matrix = haplotypeMatrix(graph, bubblesFromGraph(graph))!
  expect(matrix.columns.map(c => c.bubble.segments)).toEqual([
    'v1,a1,v2,v3',
    'v3,b1,v4,v5',
  ])
  expect(matrix.columns.map(c => c.routes)).toEqual([
    [
      { bp: 2, carriers: 3 },
      { bp: 10, carriers: 2 },
    ],
    [
      { bp: 3, carriers: 2 },
      { bp: 1, carriers: 2 },
    ],
  ])
  expect(matrix.columns.every(c => c.referenceRoute)).toBe(true)
})

test('rows chain from the reference, each beside the one it differs from least', () => {
  const matrix = haplotypeMatrix(graph, bubblesFromGraph(graph))!
  expect(matrix.rows.map(r => r.label)).toEqual([
    'ref#0',
    'HG2#1',
    'HG1#1',
    'HG3#1',
    'HG4#1',
  ])
  expect(matrix.cells).toEqual([
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, NOT_CROSSED],
  ])
})

test("a route's delta is against the reference walk's route", () => {
  const [first, second] = haplotypeMatrix(
    graph,
    bubblesFromGraph(graph),
  )!.columns
  expect(routeDelta(first!, 1)).toBe(8)
  expect(routeDelta(second!, 1)).toBe(-2)
  expect(routeDelta(second!, 0)).toBe(0)
})

test('the layout reserves a row per walk and a unit per column, and draws no nodes', () => {
  const layout = haplotypeMatrixLayout(graph)!
  expect(layout.nodePositions).toEqual({})
  expect(layout.rowLabels!.map(r => r.y)).toEqual([0, 20, 40, 60, 80])
  expect(layout.extent).toEqual({ minX: 0, minY: -10, maxX: 2, maxY: 90 })
  expect(layout.matrix!.columns).toHaveLength(2)
})

test('a graph with one walk has no matrix', () => {
  const alone = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        GFA.split('\n')
          .filter(l => !l.startsWith('W\tHG'))
          .join('\n'),
      ),
    ),
    'ref',
  )
  expect(haplotypeMatrix(alone, bubblesFromGraph(alone))).toBeUndefined()
})
