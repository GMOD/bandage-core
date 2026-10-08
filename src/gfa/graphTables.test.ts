import { convertGFAToGraph } from './gfaConverter'
import { graphFromTables, graphTablesGFA } from './graphTables'
import { parseGFA } from '../gfa-core/index'
import { loadGraph } from '../pipeline'

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
  }
}

function expectSameGraph(t: GraphTables) {
  const fromText = convertGFAToGraph(parseGFA(graphTablesGFA(t)), 'cut')
  const fromTables = graphFromTables(t, 'cut')
  expect(fromTables).toStrictEqual(fromText)
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
