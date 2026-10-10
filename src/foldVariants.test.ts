import { readFileSync } from 'node:fs'

import { foldVariants } from './foldVariants'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { writeRgfa } from './gfa/writeRgfa'
import { parseGFA } from './gfa-core/index'

import type { Graph } from './types'

function rgfa(lines: string[]) {
  return convertGFAToGraph(parseGFA(lines.join('\n')))
}

function seg(id: string, sn: string, so: number, len: number, rank: number) {
  return `S\t${id}\t*\tLN:i:${len}\tSN:Z:${sn}\tSO:i:${so}\tSR:i:${rank}`
}

function link(a: string, b: string, sa = '+', sb = '+') {
  return `L\t${a}\t${sa}\t${b}\t${sb}\t0M`
}

const names = (graph: Graph) => graph.nodes.map(n => n.name).sort()

// chr runs r1..r6, 1 kb each. On it:
// - a 50 bp insertion between r1 and r2 (small)
// - a 20 kb insertion between r2 and r3 (big)
// - a 100 bp allele standing in for r4 (1 kb), between r3 and r5 (small)
// - a deletion r1 -> r6 skipping 4 kb
const BASE = [
  seg('r1', 'ref#chr', 0, 1000, 0),
  seg('r2', 'ref#chr', 1000, 1000, 0),
  seg('r3', 'ref#chr', 2000, 1000, 0),
  seg('r4', 'ref#chr', 3000, 1000, 0),
  seg('r5', 'ref#chr', 4000, 1000, 0),
  seg('r6', 'ref#chr', 5000, 1000, 0),
  link('r1', 'r2'),
  link('r2', 'r3'),
  link('r3', 'r4'),
  link('r4', 'r5'),
  link('r5', 'r6'),
  seg('ins50', 'a#chr', 0, 50, 1),
  link('r1', 'ins50'),
  link('ins50', 'r2'),
  seg('ins20k', 'b#chr', 0, 20_000, 1),
  link('r2', 'ins20k'),
  link('ins20k', 'r3'),
  seg('sub', 'a#chr', 500, 100, 1),
  link('r3', 'sub'),
  link('sub', 'r5'),
  link('r1', 'r6'),
]

test('variants under the threshold fold, larger ones stay', () => {
  const folded = foldVariants(rgfa(BASE), 10_000)
  expect(names(folded)).toContain('ins20k')
  expect(names(folded)).not.toContain('ins50')
  expect(names(folded)).not.toContain('sub')
  // the 4 kb deletion folds too
  expect(
    folded.edges.some(e => e.from.startsWith('r1') && e.to.startsWith('r6')),
  ).toBe(false)
})

test('an allele standing in for more reference than the threshold stays', () => {
  const folded = foldVariants(rgfa(BASE), 500)
  // 100 bp of sequence, but it replaces r4's 1 kb
  expect(names(folded)).toContain('sub')
  expect(names(folded)).not.toContain('ins50')
})

test('a deletion as long as the threshold stays', () => {
  const folded = foldVariants(rgfa(BASE), 4000)
  expect(
    folded.edges.some(e => e.from.startsWith('r1') && e.to.startsWith('r6')),
  ).toBe(true)
})

test('the backbone between kept structure merges into one segment', () => {
  const folded = foldVariants(rgfa(BASE), 10_000)
  // r1-r2 stays split from r3-r6 only where ins20k hangs
  const backbone = folded.nodes
    .filter(n => n.stable?.rank === 0)
    .map(n => [n.name, n.stable!.start, n.length])
  expect(backbone).toEqual([
    ['r1', 0, 2000],
    ['r3', 2000, 4000],
  ])
  expect(folded.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual([
    'ins20k+>r3+',
    'r1+>ins20k+',
    'r1+>r3+',
  ])
})

// A 30 kb allele on x#chr hung off the backbone through a 200 bp piece of
// another assembly's sequence, with small pieces tangled around it: one on
// its interior joining two other small pieces, which reach back to it.
const TANGLE = [
  seg('r1', 'ref#chr', 0, 1000, 0),
  seg('r2', 'ref#chr', 1000, 1000, 0),
  link('r1', 'r2'),
  seg('bridge', 'y#chr', 0, 200, 2),
  link('r1', 'bridge'),
  seg('big1', 'x#chr', 0, 15_000, 1),
  seg('big2', 'x#chr', 15_000, 15_000, 1),
  link('bridge', 'big1'),
  link('big1', 'big2'),
  link('big2', 'r2'),
  seg('t1', 'z#chr', 0, 300, 3),
  seg('t2', 'w#chr', 0, 400, 3),
  link('big1', 't1'),
  link('t1', 't2'),
  link('t2', 'big2', '+', '-'),
  link('t2', 'r2'),
]

test('a big allele keeps the small piece that hangs it on the backbone, and the tangle around it goes', () => {
  const folded = foldVariants(rgfa(TANGLE), 10_000)
  expect(names(folded)).toEqual(['big1', 'bridge', 'r1', 'r2'])
  const big = folded.nodes.find(n => n.name === 'big1')!
  // big1 and big2 are one allele, and nothing kept branches between them
  expect(big.length).toBe(30_000)
})

test('folding twice is folding once at the larger threshold', () => {
  const graph = convertGFAToGraph(
    parseGFA(readFileSync('test_data/ecoli_rgfa_slice.gfa', 'utf8')),
  )
  for (const [a, b] of [
    [50, 500],
    [100, 2000],
    [500, 500],
  ] as const) {
    expect(writeRgfa(foldVariants(foldVariants(graph, a), b))).toBe(
      writeRgfa(foldVariants(graph, b)),
    )
  }
  expect(foldVariants(graph, 2000).nodes.length).toBeLessThan(
    graph.nodes.length,
  )
})

test('the result does not depend on the order the file lists things in', () => {
  const graph = rgfa(TANGLE)
  const reversed = {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
  }
  expect(names(foldVariants(reversed, 10_000))).toEqual(
    names(foldVariants(graph, 10_000)),
  )
})

test('a graph with walks, or with no backbone, is left as it is', () => {
  const walked = rgfa([...BASE, 'P\thap\tr1+,ins50+,r2+\t*'])
  expect(foldVariants(walked, 10_000)).toBe(walked)
  const unanchored = rgfa([
    'S\ta\t*\tLN:i:5',
    'S\tb\t*\tLN:i:5',
    link('a', 'b'),
  ])
  expect(foldVariants(unanchored, 10_000)).toBe(unanchored)
})

// A path GFA's reference reads some segments reversed, and an index keeps no
// strand: n1, n2 and n3 abut on the reference, joined by `- -` links, with a
// 20 kb insertion between n1 and n2
test('a reference read reversed still merges, its links on the right ends', () => {
  const folded = foldVariants(
    rgfa([
      seg('n1', 'ref#chr', 0, 1000, 0),
      seg('n2', 'ref#chr', 1000, 1000, 0),
      seg('n3', 'ref#chr', 2000, 1000, 0),
      link('n1', 'n2', '-', '-'),
      link('n2', 'n3', '-', '-'),
      seg('ins', 'b#chr', 0, 20_000, 1),
      link('n1', 'ins', '-', '+'),
      link('ins', 'n2', '+', '-'),
    ]),
    10_000,
  )
  expect(folded.nodes.map(n => [n.name, n.stable?.start, n.length])).toEqual([
    ['n1', 0, 1000],
    ['n2', 1000, 2000],
    ['ins', 0, 20_000],
  ])
  // n1's forward start lies at its reference end, and meets the merged
  // segment's start
  const name = (id: string) => id.slice(0, -1)
  expect(
    folded.edges
      .map(e => `${name(e.from)}${e.fromStrand} ${name(e.to)}${e.toStrand}`)
      .sort(),
  ).toEqual(['ins+ n2+', 'n1- ins+', 'n1- n2+'])
})
