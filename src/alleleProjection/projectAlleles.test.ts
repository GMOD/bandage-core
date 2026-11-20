import { readFileSync } from 'fs'

import { isOffReference } from '../anchoredNodes'
import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { projectAlleles } from './projectAlleles'

// The real four-strain minigraph slice, not invented coordinates: K12 is the
// rank-0 backbone, Sakai/CFT073/NCTC86 contribute ranks 1-3.
function ecoliGraph() {
  const gfa = readFileSync(
    require.resolve('../../test_data/ecoli_rgfa_slice.gfa'),
    'utf8',
  )
  return convertGFAToGraph(parseGFA(gfa), 'ecoli')
}

test('rGFA carries no walks, so the projection cannot depend on them', () => {
  const graph = ecoliGraph()
  expect(graph.paths ?? []).toHaveLength(0)
  expect(projectAlleles(graph).length).toBeGreaterThan(0)
})

test('anchors alleles on the reference and places each node within its run', () => {
  const alleles = projectAlleles(ecoliGraph())
  for (const allele of alleles) {
    expect(allele.refSpan).toBeGreaterThanOrEqual(0)
    expect(allele.nodeIds.length).toBeGreaterThan(0)
    expect(allele.nodeOffsets).toHaveLength(allele.nodeIds.length)
    expect(Math.min(...allele.nodeOffsets)).toBe(0)
    expect(allele.pathLength).toBeGreaterThanOrEqual(
      Math.max(...allele.nodeOffsets),
    )
  }
  for (let i = 1; i < alleles.length; i++) {
    expect(alleles[i]!.start).toBeGreaterThanOrEqual(alleles[i - 1]!.start)
  }
})

// The naive per-segment version produced refSpan -22067 here by taking whichever
// anchor it saw last; a negative span must never be emitted, and a run with one
// anchor at the window's edge is left out rather than given one.
test('declines to state a span rather than emitting a backwards one', () => {
  const graph = ecoliGraph()
  const alleles = projectAlleles(graph)
  expect(alleles.every(a => a.refSpan >= 0)).toBe(true)
  const placed = new Set(alleles.flatMap(a => a.nodeIds))
  const unanchored = graph.nodes.filter(
    n => isOffReference(n) && !placed.has(n.id),
  )
  expect(unanchored.length).toBeGreaterThan(0)
})

test('chains multi-segment bubble paths into one allele', () => {
  const alleles = projectAlleles(ecoliGraph())
  const multi = alleles.filter(a => a.nodeIds.length > 1)
  expect(multi.length).toBeGreaterThan(0)
  for (const a of multi) {
    expect(new Set(a.nodeIds).size).toBe(a.nodeIds.length)
    expect(a.pathLength).toBeGreaterThan(0)
  }
})

test('an empty graph projects to nothing rather than throwing', () => {
  expect(projectAlleles({ name: 'empty', nodes: [], edges: [] })).toEqual([])
})

// An rGFA ring s1..s6 on chr1 whose s6 links back to s1, a SNP n for s3, and
// w, 20 bp leaving s6 and rejoining s2, in place of s1 across the origin
const RING = [
  ...[
    ['s1', 100, 0],
    ['s2', 100, 100],
    ['s3', 1, 200],
    ['s4', 100, 201],
    ['s5', 100, 301],
    ['s6', 100, 401],
  ].map(
    ([name, len, at]) =>
      `S\t${name}\t*\tLN:i:${len}\tSN:Z:chr1\tSO:i:${at}\tSR:i:0`,
  ),
  'S\tn\t*\tLN:i:1\tSN:Z:hap1\tSO:i:0\tSR:i:1',
  'S\tw\t*\tLN:i:20\tSN:Z:hap2\tSO:i:0\tSR:i:1',
  ...[
    's1 s2',
    's2 s3',
    's3 s4',
    's4 s5',
    's5 s6',
    's6 s1',
    's2 n',
    'n s4',
    's6 w',
    'w s2',
  ].map(pair => {
    const [a, b] = pair.split(' ')
    return `L\t${a}\t+\t${b}\t+\t0M`
  }),
].join('\n')

test('an allele round the origin of a circular contig replaces nothing between its anchors', () => {
  const alleles = projectAlleles(convertGFAToGraph(parseGFA(RING)))
  expect(alleles.map(a => [a.nodeIds, a.start, a.refSpan])).toEqual([
    [['n+'], 200, 1],
  ])
})
