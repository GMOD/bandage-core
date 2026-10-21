import { readFileSync } from 'node:fs'

import { deletionEdges } from './deletionEdges'
import { foldVariants } from './foldVariants'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { writeRgfa } from './gfa/writeRgfa'
import { parseGFA } from './gfa-core/index'
import { loadGraph } from './pipeline'

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

// The fold as bandage-fold writes it, and the same graph re-read from that
const written = (graph: Graph, below: number) =>
  writeRgfa(foldVariants(graph, below))
const reread = (text: string) => convertGFAToGraph(parseGFA(text))

function pathGfa(lines: string[]) {
  const graph = loadGraph(lines.join('\n'), 'paths.gfa')
  return { ...graph, paths: undefined }
}

const rgfaOut = (segments: string[], links: string[]) =>
  ['H\tVN:Z:1.0', ...segments, ...links, ''].join('\n')

// a, b and c abut on the reference; the inversion reads b reversed
const INVERSION = [
  seg('a', 'ref#chr', 0, 1000, 0),
  seg('b', 'ref#chr', 1000, 140, 0),
  seg('c', 'ref#chr', 1140, 1000, 0),
  link('a', 'b'),
  link('b', 'c'),
  link('a', 'b', '+', '-'),
  link('b', 'c', '-', '+'),
]

test('a 140 bp inversion folds at 100 kb and stays at 100 bp', () => {
  expect(written(rgfa(INVERSION), 100_000)).toBe(
    rgfaOut([seg('a', 'ref#chr', 0, 2140, 0)], []),
  )
  expect(written(rgfa(INVERSION), 100)).toBe(
    rgfaOut(INVERSION.slice(0, 3), INVERSION.slice(3)),
  )
})

// b1, b2 and b3 read reversed between a and c; the breakpoints each span
// all 170 bp, though a's end lies 70 bp from b3's start
const UNEVEN = [
  seg('a', 'ref#chr', 0, 1000, 0),
  seg('b1', 'ref#chr', 1000, 30, 0),
  seg('b2', 'ref#chr', 1030, 40, 0),
  seg('b3', 'ref#chr', 1070, 100, 0),
  seg('c', 'ref#chr', 1170, 1000, 0),
  link('a', 'b1'),
  link('b1', 'b2'),
  link('b2', 'b3'),
  link('b3', 'c'),
  link('a', 'b3', '+', '-'),
  link('b1', 'c', '-', '+'),
]

test('an uneven inversion keeps both breakpoints at 100 bp and folds both at 1 kb', () => {
  expect(written(rgfa(UNEVEN), 100)).toBe(
    rgfaOut(
      [
        seg('a', 'ref#chr', 0, 1000, 0),
        seg('b1', 'ref#chr', 1000, 170, 0),
        seg('c', 'ref#chr', 1170, 1000, 0),
      ],
      [
        link('a', 'b1'),
        link('b1', 'c'),
        link('a', 'b1', '+', '-'),
        link('b1', 'c', '-', '+'),
      ],
    ),
  )
  expect(written(rgfa(UNEVEN), 1000)).toBe(
    rgfaOut([seg('a', 'ref#chr', 0, 2170, 0)], []),
  )
})

test('an uneven inversion folded at 50 bp and then 1 kb folds as at 1 kb', () => {
  const graph = rgfa(UNEVEN)
  expect(written(foldVariants(graph, 50), 1000)).toBe(written(graph, 1000))
})

test('a 140 bp tandem duplication folds at 1 kb and stays at 100 bp', () => {
  const graph = rgfa([...INVERSION.slice(0, 5), link('b', 'b')])
  expect(written(graph, 1000)).toBe(
    rgfaOut([seg('a', 'ref#chr', 0, 2140, 0)], []),
  )
  expect(written(graph, 100)).toBe(
    rgfaOut(INVERSION.slice(0, 3), [
      link('a', 'b'),
      link('b', 'c'),
      link('b', 'b'),
    ]),
  )
})

// r3 links back to r1's start, 3 kb behind its end. A 600 bp insertion keeps
// r3 apart at 500 bp, while r1 and r2 merge into a segment r3 abuts.
const BACK_LINK = [
  seg('r1', 'ref#chr', 0, 1000, 0),
  seg('r2', 'ref#chr', 1000, 1000, 0),
  seg('r3', 'ref#chr', 2000, 1000, 0),
  link('r1', 'r2'),
  link('r2', 'r3'),
  link('r3', 'r1'),
  seg('ins', 'a#chr', 0, 600, 1),
  link('r2', 'ins'),
  link('ins', 'r3'),
]

test('a link back to a segment that abuts after a merge does not continue it', () => {
  const graph = rgfa(BACK_LINK)
  const once = foldVariants(graph, 500)
  expect(writeRgfa(once)).toBe(
    rgfaOut(
      [
        seg('r1', 'ref#chr', 0, 2000, 0),
        seg('r3', 'ref#chr', 2000, 1000, 0),
        seg('ins', 'a#chr', 0, 600, 1),
      ],
      [
        link('r1', 'r3'),
        link('r3', 'r1'),
        link('r1', 'ins'),
        link('ins', 'r3'),
      ],
    ),
  )
  const direct = rgfaOut([seg('r1', 'ref#chr', 0, 3000, 0)], [link('r1', 'r1')])
  expect(written(graph, 1000)).toBe(direct)
  expect(written(once, 1000)).toBe(direct)
})

// x leaves r1's end and comes back onto r3's end, 2 kb along the reference,
// carrying 100 bp of its own. r2 and r3 merge at 50 bp, which moves r3's start
// but not the end x lands on.
const FAR_SIDE = [
  seg('r1', 'ref#chr', 0, 1000, 0),
  seg('r2', 'ref#chr', 1000, 1000, 0),
  seg('r3', 'ref#chr', 2000, 1000, 0),
  link('r1', 'r2'),
  link('r2', 'r3'),
  seg('x', 'a#chr', 0, 100, 1),
  link('r1', 'x'),
  link('x', 'r3', '+', '-'),
]

test('an allele on a neighbour’s far side keeps its size when the backbone beside it merges', () => {
  const graph = rgfa(FAR_SIDE)
  const kept = rgfaOut(
    [
      seg('r1', 'ref#chr', 0, 1000, 0),
      seg('r2', 'ref#chr', 1000, 2000, 0),
      seg('x', 'a#chr', 0, 100, 1),
    ],
    [link('r1', 'r2'), link('r1', 'x'), link('x', 'r2', '+', '-')],
  )
  expect(written(graph, 1500)).toBe(kept)
  expect(written(foldVariants(graph, 50), 1500)).toBe(kept)
  expect(written(graph, 2500)).toBe(
    rgfaOut([seg('r1', 'ref#chr', 0, 3000, 0)], []),
  )
})

// The reference path reads b reversed; another path detours through a 5 kb x
const REVERSED_ON_REFERENCE = [
  'S\ta\t*\tLN:i:1000',
  'S\tb\t*\tLN:i:100',
  'S\tc\t*\tLN:i:1000',
  'S\tx\t*\tLN:i:5000',
  link('a', 'b', '+', '-'),
  link('b', 'c', '-', '+'),
  link('a', 'x'),
  link('x', 'c'),
  'P\tref\ta+,b-,c+\t*',
  'P\talt\ta+,x+,c+\t*',
]

test('a segment the reference path reads reversed stays on the reference', () => {
  const graph = pathGfa(REVERSED_ON_REFERENCE)
  const folded = rgfaOut(
    [
      `${seg('a', 'ref', 0, 1000, 0)}\tSM:Z:alt,ref`,
      `${seg('b', 'ref', 1000, 100, 0)}\tSM:Z:ref`,
      `${seg('c', 'ref', 1100, 1000, 0)}\tSM:Z:alt,ref`,
      `${seg('x', 'alt', 1000, 5000, 1)}\tSM:Z:alt`,
    ],
    [link('a', 'b'), link('b', 'c'), link('a', 'x'), link('x', 'c')],
  )
  expect(written(graph, 1000)).toBe(folded)
  expect(written(reread(folded), 1000)).toBe(folded)
  expect(written(reread(written(graph, 50)), 1000)).toBe(folded)
})

// alt reads a 300 bp y and a 300 bp x reversed, in place of 2 kb of reference
const REVERSED_OFF_REFERENCE = [
  'S\ta\t*\tLN:i:1000',
  'S\tb\t*\tLN:i:2000',
  'S\tc\t*\tLN:i:1000',
  'S\tx\t*\tLN:i:300',
  'S\ty\t*\tLN:i:300',
  link('a', 'b'),
  link('b', 'c'),
  link('a', 'y', '+', '-'),
  link('y', 'x', '-', '-'),
  link('x', 'c', '-', '+'),
  'P\tref\ta+,b+,c+\t*',
  'P\talt\ta+,y-,x-,c+\t*',
]

test('an allele its path reads reversed stays whole', () => {
  const graph = pathGfa(REVERSED_OFF_REFERENCE)
  const folded = rgfaOut(
    [
      `${seg('a', 'ref', 0, 1000, 0)}\tSM:Z:alt,ref`,
      `${seg('b', 'ref', 1000, 2000, 0)}\tSM:Z:ref`,
      `${seg('c', 'ref', 3000, 1000, 0)}\tSM:Z:alt,ref`,
      `${seg('y', 'alt', 1000, 600, 1)}\tSM:Z:alt`,
    ],
    [link('a', 'b'), link('b', 'c'), link('a', 'y'), link('y', 'c')],
  )
  expect(written(graph, 1000)).toBe(folded)
  expect(written(reread(folded), 1000)).toBe(folded)
  expect(written(reread(written(graph, 50)), 1000)).toBe(folded)
})

test('an allele run that starts with a 0 bp segment keeps its orientation', () => {
  const folded = foldVariants(
    rgfa([
      seg('A', 'ref', 0, 100, 0),
      seg('B', 'ref', 100, 100, 0),
      seg('x', 'alt', 500, 0, 1),
      seg('y', 'alt', 500, 1000, 1),
      link('A', 'B'),
      link('A', 'x'),
      link('x', 'y'),
      link('y', 'B'),
    ]),
    50,
  )
  expect(folded.edges).toContainEqual({
    from: 'A+',
    to: 'x+',
    fromStrand: '+',
    toStrand: '+',
  })
})

test('a short skip whose reference a cut left out stays, so the cut does not split', () => {
  const cut = rgfa([
    seg('r1', 'ref#chr', 0, 1000, 0),
    seg('r3', 'ref#chr', 1063, 1000, 0),
    link('r1', 'r3'),
  ])
  const folded = foldVariants(cut, 432, { cut: true })
  expect(folded.edges.map(e => [e.from, e.to, e.foldBridge])).toEqual([
    ['r1+', 'r3+', true],
  ])
  expect(deletionEdges(folded)).toEqual([])
})

test('of the small skips that could rejoin a cut, the shortest stays', () => {
  const cut = rgfa([
    seg('r1', 'ref#chr', 0, 1000, 0),
    seg('r2', 'ref#chr', 1000, 40, 0),
    seg('r4', 'ref#chr', 1100, 1000, 0),
    seg('a', 'alt#chr', 0, 5000, 1),
    link('r1', 'r2'),
    link('r1', 'a'),
    link('r1', 'r4'),
    link('r2', 'r4'),
  ])
  const folded = foldVariants(cut, 432, { cut: true })
  expect(
    folded.edges.filter(e => e.foldBridge).map(e => [e.from, e.to]),
  ).toEqual([['r2+', 'r4+']])
})

test('a short skip folds where the reference it skips is in the cut', () => {
  const graph = rgfa([
    seg('r1', 'ref#chr', 0, 1000, 0),
    seg('r2', 'ref#chr', 1000, 63, 0),
    seg('r3', 'ref#chr', 1063, 1000, 0),
    link('r1', 'r2'),
    link('r2', 'r3'),
    link('r1', 'r3'),
  ])
  const folded = foldVariants(graph, 432)
  expect(folded.nodes).toHaveLength(1)
  expect(folded.edges).toEqual([])
})

test('without `cut` a short skip folds even where it is the only link', () => {
  const graph = rgfa([
    seg('r1', 'ref#chr', 0, 1000, 0),
    seg('r3', 'ref#chr', 1063, 1000, 0),
    link('r1', 'r3'),
  ])
  expect(foldVariants(graph, 432).edges).toEqual([])
})
