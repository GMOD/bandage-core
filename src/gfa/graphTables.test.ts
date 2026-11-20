import { parseGFA } from '../gfa-core/index'
import { loadGraph } from '../pipeline'
import { departureTable } from './departures'
import { convertGFAToGraph } from './gfaConverter'
import { gfaTables } from './gfaTables'
import { graphFromTables, graphTablesGFA } from './graphTables'

import type { GraphTables } from './graphTables'

function tables({
  names,
  declared = names.length,
  stable = [],
  links = [],
  walks = [],
}: {
  names: string[]
  declared?: number
  stable?: ([string, number, number] | undefined)[]
  links?: [number, number, number][]
  walks?: { name: string; start: number; steps: [number, boolean][] }[]
}): GraphTables {
  const refNames = [...new Set(stable.flatMap(s => (s ? [s[0]] : [])))]
  const offsets = [0]
  for (const walk of walks) {
    offsets.push(offsets.at(-1)! + walk.steps.length)
  }
  const steps = walks.flatMap(walk => walk.steps)
  return {
    nodes: {
      names,
      lengths: Int32Array.from({ length: declared }, (_, i) => 10 + i),
      refs: Int32Array.from({ length: declared }, (_, i) =>
        stable[i] ? refNames.indexOf(stable[i][0]) : -1,
      ),
      starts: Float64Array.from(
        { length: declared },
        (_, i) => stable[i]?.[1] ?? 0,
      ),
      ranks: Int32Array.from(
        { length: declared },
        (_, i) => stable[i]?.[2] ?? 0,
      ),
      refNames,
    },
    links: {
      from: Int32Array.from(links, l => l[0]),
      to: Int32Array.from(links, l => l[1]),
      strands: Uint8Array.from(links, l => l[2]),
    },
    walks: {
      names: walks.map(w => w.name),
      starts: Float64Array.from(walks, w => w.start),
      ends: Float64Array.from(walks, w => w.start + 100),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(steps, s => s[0]),
      reversed: Uint8Array.from(steps, s => (s[1] ? 1 : 0)),
    },
    departures: departureTable(),
    revisited: 0,
  }
}

// The tables' count is the source's, which the GFA of a cut cannot state; the
// text counts its own walks as the tables written from it do
function expectSameGraph(t: GraphTables) {
  const text = graphTablesGFA(t)
  const fromText = convertGFAToGraph(parseGFA(text), 'cut')
  const fromTables = graphFromTables(t, 'cut')
  expect(fromTables).toStrictEqual({ ...fromText, revisited: t.revisited })
  expect(gfaTables(text)?.revisited ?? fromText.revisited).toBe(
    fromText.revisited,
  )
  expect([...(fromTables.pathVisits?.keys() ?? [])]).toEqual([
    ...(fromText.pathVisits?.keys() ?? []),
  ])
}

test('the tables write the GFA they stand for', () => {
  const t = tables({
    names: ['1', '2', '3'],
    stable: [
      ['chr1', 0, 0],
      ['chr1', 10, 0],
      ['HG002#1#c', 4, 1],
    ],
    links: [
      [0, 1, 0],
      [1, 2, 3],
    ],
    walks: [
      {
        name: 'GRCh38#0#chr1',
        start: 0,
        steps: [
          [0, false],
          [1, false],
        ],
      },
      {
        name: 'HG002#1#c#2',
        start: 5,
        steps: [
          [2, true],
          [1, true],
        ],
      },
    ],
  })
  expect(graphTablesGFA(t).split('\n')).toEqual([
    'H\tVN:Z:1.1',
    'S\t1\t*\tLN:i:10\tSN:Z:chr1\tSO:i:0\tSR:i:0',
    'S\t2\t*\tLN:i:11\tSN:Z:chr1\tSO:i:10\tSR:i:0',
    'S\t3\t*\tLN:i:12\tSN:Z:HG002#1#c\tSO:i:4\tSR:i:1',
    'L\t1\t+\t2\t+\t0M',
    'L\t2\t-\t3\t-\t0M',
    'W\tGRCh38\t0\tchr1\t0\t100\t>1>2',
    'W\tHG002\t1\tc#2\t5\t105\t<3<2',
  ])
})

// pggb names a path `chm13#chr1`, which gfa-to-tabix passes through
test('a two-part walk name keeps its name and writes a P line', () => {
  const twoPart = (start: number) =>
    tables({
      names: ['1', '2', '3'],
      links: [
        [0, 1, 0],
        [1, 2, 0],
      ],
      walks: [
        {
          name: 'grch38#chr1',
          start,
          steps: [
            [0, false],
            [1, true],
          ],
        },
        { name: 'grch38#chr2', start, steps: [[2, false]] },
      ],
    })
  expect(graphTablesGFA(twoPart(0)).split('\n').slice(-2)).toEqual([
    'P\tgrch38#chr1\t1+,2-\t*',
    'P\tgrch38#chr2\t3+\t*',
  ])
  expect(graphTablesGFA(twoPart(5)).split('\n').at(-1)).toBe(
    'P\tgrch38#chr2:5-105\t3+\t*',
  )
  expect(graphFromTables(twoPart(5), 'cut').paths?.map(p => p.name)).toEqual([
    'grch38#chr1:5-105',
    'grch38#chr2:5-105',
  ])
  expectSameGraph(twoPart(0))
  expectSameGraph(twoPart(5))
})

test('walks named for haplotypes that are not numbers stay apart', () => {
  const named = tables({
    names: ['1', '2'],
    links: [[0, 1, 0]],
    walks: [
      {
        name: 'HG002#mat#chr1',
        start: 0,
        steps: [
          [0, false],
          [1, false],
        ],
      },
      { name: 'HG002#pat#chr1', start: 0, steps: [[0, false]] },
    ],
  })
  expect(graphFromTables(named, 'cut').paths?.map(p => p.name)).toEqual([
    'HG002#mat#chr1',
    'HG002#pat#chr1',
  ])
  expect(graphTablesGFA(named).split('\n').slice(-2)).toEqual([
    'P\tHG002#mat#chr1\t1+,2+\t*',
    'P\tHG002#pat#chr1\t1+\t*',
  ])
  expectSameGraph(named)
})

test('tables build the graph their GFA converts to', () => {
  expectSameGraph(
    tables({
      // 4 is named by a link and a walk and declared by no S line
      names: ['A', 'B', 'C', 'D', '4'],
      declared: 4,
      stable: [['chr1', 0, 0], ['chr1', 10, 0], ['chr1', 21, 0], undefined],
      links: [
        [0, 1, 0],
        [0, 1, 2],
        [1, 2, 0],
        [2, 2, 0],
        [2, 4, 1],
      ],
      walks: [
        {
          name: 'GRCh38#0#chr1',
          start: 0,
          steps: [
            [0, false],
            [1, false],
            [2, false],
            [2, false],
            [4, false],
          ],
        },
        {
          name: 'HG002#1#c',
          start: 3,
          steps: [
            [1, true],
            [0, true],
          ],
        },
        { name: 'HG003#2#c', start: 0, steps: [] },
        {
          name: 'HG005#1#c',
          start: 7,
          steps: [
            [3, true],
            [1, false],
          ],
        },
        // a second fragment of HG002#1, after another haplotype's
        {
          name: 'HG002#1#c',
          start: 40,
          steps: [
            [0, false],
            [1, false],
          ],
        },
      ],
    }),
  )
})

test('tables with no walks build the graph their GFA converts to', () => {
  expectSameGraph(
    tables({ names: ['1', '2'], stable: [['chr1', 0, 0]], links: [[0, 1, 1]] }),
  )
})

// mulberry32
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test.each([1, 2, 3, 4, 5, 6, 7, 8])(
  'random tables %i build the graph their GFA converts to',
  seed => {
    const rand = random(seed)
    const pick = (n: number) => Math.floor(rand() * n)
    const count = 3 + pick(40)
    const declared = count - pick(3)
    const names = Array.from({ length: count }, (_, i) => String(100 + i))
    const walks = Array.from({ length: pick(12) }, () => ({
      name: `S${pick(4)}#${pick(3)}#chr${pick(2)}`,
      start: pick(1000),
      steps: Array.from(
        { length: pick(30) },
        () => [pick(count), rand() < 0.3] as [number, boolean],
      ),
    }))
    const links = Array.from(
      { length: pick(60) },
      () => [pick(count), pick(count), pick(4)] as [number, number, number],
    )
    for (const walk of walks) {
      for (let i = 1; i < walk.steps.length; i++) {
        if (rand() < 0.7) {
          links.push([walk.steps[i - 1]![0], walk.steps[i]![0], pick(4)])
        }
      }
    }
    expectSameGraph(
      tables({
        names,
        declared,
        stable: Array.from({ length: declared }, () =>
          rand() < 0.9
            ? ([`ref${pick(2)}`, pick(10_000), pick(3)] as [
                string,
                number,
                number,
              ])
            : undefined,
        ),
        links,
        walks,
      }),
    )
  },
)

test('tables give an inversion link beside a walked link no walk of it, as the text does', () => {
  const text = `S\ta\tACGT
S\tb\tGG
S\tc\tTTT
L\ta\t+\tb\t+\t0M
L\ta\t+\tb\t-\t0M
L\tb\t+\tc\t+\t0M
L\tb\t-\tc\t+\t0M
W\tref\t0\tchr1\t0\t9\t>a>b>c
W\talt\t1\tchr1\t0\t9\t<c<b<a`
  const fromTables = graphFromTables(gfaTables(text)!)
  expect(fromTables.edges.map(e => e.pathIds)).toEqual([
    ['ref#0#chr1', 'alt#1#chr1'],
    undefined,
    ['ref#0#chr1', 'alt#1#chr1'],
    undefined,
  ])
  expect(fromTables).toStrictEqual(convertGFAToGraph(parseGFA(text)))
})

test('loadGraph takes tables as it takes their GFA', () => {
  const t = tables({
    names: ['1', '2'],
    stable: [
      ['chr1', 0, 0],
      ['chr1', 10, 0],
    ],
    links: [[0, 1, 0]],
    walks: [
      {
        name: 'GRCh38#0#chr1',
        start: 0,
        steps: [
          [0, false],
          [1, false],
        ],
      },
    ],
  })
  expect(loadGraph(t, 'cut')).toStrictEqual(loadGraph(graphTablesGFA(t), 'cut'))
})

// The shape of graph-walks' strand.R cut over its first node: the reference
// walks >1<2<3>4 and the cut holds its step on 1 alone, while A walks
// >1>3>2>1 and so brings in 3 and 2, which the tables place on the reference
function broughtIn(reversed?: number[]) {
  const t = tables({
    names: ['1', '2', '3'],
    stable: [
      ['R#0#chr', 0, 0],
      ['R#0#chr', 10, 0],
      ['R#0#chr', 21, 0],
    ],
    links: [
      [0, 2, 0],
      [2, 1, 0],
      [1, 0, 0],
    ],
    walks: [
      { name: 'R#0#chr', start: 0, steps: [[0, false]] },
      {
        name: 'A#1#a',
        start: 0,
        steps: [
          [0, false],
          [2, false],
          [1, false],
          [0, false],
        ],
      },
    ],
  })
  return reversed
    ? { ...t, nodes: { ...t.nodes, reversed: Uint8Array.from(reversed) } }
    : t
}

const strandsOf = (t: GraphTables) =>
  graphFromTables(t, 'cut').nodes.map(
    node => `${node.name}${node.stable?.strand ?? '?'}`,
  )

test('a node on the reference that no reference walk of the tables steps takes its strand from nodes.reversed', () => {
  expect(strandsOf(broughtIn([0, 1, 1]))).toEqual(['1+', '2-', '3-'])
})

test('tables with no nodes.reversed state a strand only where a reference walk steps the node', () => {
  expect(strandsOf(broughtIn())).toEqual(['1+', '2?', '3?'])
})

test('nodes.reversed and the reference walk state the same strand wherever both speak', () => {
  const stepped = tables({
    names: ['1', '2', '3'],
    stable: [
      ['R#0#chr', 0, 0],
      ['R#0#chr', 10, 0],
      ['R#0#chr', 21, 0],
    ],
    links: [
      [0, 1, 2],
      [1, 2, 3],
    ],
    walks: [
      {
        name: 'R#0#chr',
        start: 0,
        steps: [
          [0, false],
          [1, true],
          [2, true],
        ],
      },
    ],
  })
  const withColumn = {
    ...stepped,
    nodes: { ...stepped.nodes, reversed: Uint8Array.from([0, 1, 1]) },
  }
  expect(strandsOf(stepped)).toEqual(['1+', '2-', '3-'])
  expect(graphFromTables(withColumn, 'cut')).toStrictEqual(
    graphFromTables(stepped, 'cut'),
  )
})

test('a node placed off the reference takes its strand from its walk, whatever nodes.reversed holds for it', () => {
  const off = tables({
    names: ['1', '2'],
    stable: [
      ['R#0#chr', 0, 0],
      ['A#1#a', 10, 1],
    ],
    links: [[0, 1, 2]],
    walks: [
      { name: 'R#0#chr', start: 0, steps: [[0, false]] },
      {
        name: 'A#1#a',
        start: 0,
        steps: [
          [0, false],
          [1, true],
        ],
      },
    ],
  })
  const withColumn = {
    ...off,
    nodes: { ...off.nodes, reversed: Uint8Array.from([0, 0]) },
  }
  expect(strandsOf(off)).toEqual(['1+', '2-'])
  expect(strandsOf(withColumn)).toEqual(['1+', '2-'])
})

test('a node the reference walk of the tables steps at another pass than the one it is placed at takes the strand of the pass it is placed at', () => {
  const t = tables({
    names: ['1', '2'],
    stable: [
      ['R#0#chr', 0, 0],
      ['R#0#chr', 10, 0],
    ],
    walks: [{ name: 'R#0#chr', start: 100, steps: [[1, false]] }],
  })
  const placed = {
    ...t,
    nodes: { ...t.nodes, reversed: Uint8Array.from([0, 1]) },
  }
  expect(strandsOf(t)).toEqual(['1?', '2+'])
  expect(strandsOf(placed)).toEqual(['1+', '2-'])
})
