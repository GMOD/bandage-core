import { readFileSync } from 'fs'

import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { anchorGraph } from '../pathAnchoring'
import { bubblesFromGraph } from './bubblesFromGraph'
import { graphBubbles } from './superbubbles'

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

// A circular contig o1..o5 whose last node links back to its first, an allele
// `a` for o3, and HAP2 written from o3 round the origin to o2
const RING = `S\to1\t*\tLN:i:100
S\to2\t*\tLN:i:100
S\to3\t*\tLN:i:100
S\to4\t*\tLN:i:100
S\to5\t*\tLN:i:100
S\ta\t*\tLN:i:30
L\to1\t+\to2\t+\t0M
L\to2\t+\to3\t+\t0M
L\to3\t+\to4\t+\t0M
L\to4\t+\to5\t+\t0M
L\to2\t+\ta\t+\t0M
L\ta\t+\to4\t+\t0M
L\to5\t+\to1\t+\t0M
W\tREF\t0\tchr1\t0\t500\t>o1>o2>o3>o4>o5
W\tHAP1\t1\tchr1\t0\t430\t>o1>o2>a>o4>o5
W\tHAP2\t1\tchr1\t0\t500\t>o3>o4>o5>o1>o2`

test('a walk round a circular contig takes no route the other way round a bubble', () => {
  const ring = anchorGraph(convertGFAToGraph(parseGFA(RING)), 'REF')
  const [allele, whole] = graphBubbles(ring)
  expect(allele!.key).toBe('o2>o4')
  expect(allele!.routes!.map(r => [r.steps, r.walks])).toEqual([
    [['o3+'], ['REF#0#chr1']],
    [['a+'], ['HAP1#1#chr1']],
  ])
  expect(allele!.partial).toBe(true)
  expect(whole!.covering).toBe(true)
  expect(whole!.shortestAlleleLength).toBe(230)
  expect(whole!.routes!.flatMap(r => r.walks)).not.toContain('HAP2#1#chr1')
})

// drawnedge.R.gfa: H runs 8, an insertion, a second copy of 3..8, then 9
test('a copy a walk carries out of a bubble and back is the route it takes', () => {
  const g = anchorGraph(
    convertGFAToGraph(
      parseGFA(readFileSync('test_data/walks8/drawnedge.R.gfa', 'utf8')),
    ),
    undefined,
  )
  const [dup] = bubblesFromGraph(g)
  expect(dup!.routes!.find(r => r.walks.includes('H#1#h'))!.steps).toEqual(
    [
      '100',
      '101',
      '102',
      '103',
      '104',
      '105',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ].map(id => `${id}+`),
  )
})
