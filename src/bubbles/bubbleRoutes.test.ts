import { bubblesFromGraph } from './bubblesFromGraph'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { anchorGraph } from '../pathAnchoring'

// ref walks v1 v2 v3; two haplotypes take a1 instead of v2 and one takes a2.
const GFA = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\t${'T'.repeat(6000)}
S\ta2\tG
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
L\tv1\t+\ta2\t+\t0M
L\ta2\t+\tv3\t+\t0M
W\tref\t0\tchr\t0\t9\t>v1>v2>v3
W\tHG1\t1\tchr\t0\t6007\t>v1>a1>v3
W\tHG2\t1\tchr\t0\t6007\t>v1>a1>v3
W\tHG3\t2\tchr\t0\t8\t>v1>a2>v3`

const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')

test('a derived bubble carries each route with the walks that take it', () => {
  const [bubble] = bubblesFromGraph(graph)
  expect(bubble!.routes).toEqual([
    { steps: ['v2+'], bp: 2, walks: ['ref#0#chr'] },
    { steps: ['a1+'], bp: 6000, walks: ['HG1#1#chr', 'HG2#1#chr'] },
    { steps: ['a2+'], bp: 1, walks: ['HG3#2#chr'] },
  ])
})

// A contig assembled on the reverse strand walks the same bubble end-first.
const REVERSED = `S\tv1\tAAAA
S\tv2\tCC
S\tv2b\tTT
S\tv3\tGGG
S\ta1\tT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv2b\t+\t0M
L\tv2b\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
W\tref\t0\tchr\t0\t11\t>v1>v2>v2b>v3
W\tFWD\t1\tchr\t0\t11\t>v1>v2>v2b>v3
W\tREV\t1\tchr\t0\t11\t<v3<v2b<v2<v1
W\tALT\t1\tchr\t0\t8\t>v1>a1>v3`

test('a walk crossing a bubble end-first takes the route it takes forwards', () => {
  const reversed = anchorGraph(convertGFAToGraph(parseGFA(REVERSED)), 'ref')
  const [bubble] = bubblesFromGraph(reversed)
  expect(bubble!.pathCount).toBe(2)
  expect(bubble!.routes).toEqual([
    {
      steps: ['v2+', 'v2b+'],
      bp: 4,
      walks: ['ref#0#chr', 'FWD#1#chr', 'REV#1#chr'],
    },
    { steps: ['a1+'], bp: 1, walks: ['ALT#1#chr'] },
  ])
})
