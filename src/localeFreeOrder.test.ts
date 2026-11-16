import { superbubblesFromGraph } from './bubbles/superbubbles'
import { parseGFA } from './gfa-core/index'
import { departureTable } from './gfa/departures'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { sampleRowLayout } from './layout/sampleRowLayout'
import { walkRowRuns, walkRowsOf } from './layout/walkRowRuns'
import { filterSamples } from './layout/walkRows'
import { anchorGraph } from './pathAnchoring'
import { walkLabelsOf } from './pathColors'
import { bundleRoutes } from './tubeMap/bundle'

import type { GraphTables } from './gfa/graphTables'
import type { Graph, GraphNode } from './types'

// A browser in a Czech locale sorts CHM13 after every HG name, and R's V8 has
// no Intl at all, so a tie broken by the host's collation draws differently
// from one reader to the next. Each sort here runs with no Intl and with
// localeCompare refusing to answer.
function withoutLocale<T>(run: () => T) {
  vi.stubGlobal('Intl', undefined)
  const asked = vi
    .spyOn(String.prototype, 'localeCompare')
    .mockImplementation(() => {
      throw new Error('a tie was broken by the host locale')
    })
  try {
    return run()
  } finally {
    asked.mockRestore()
    vi.unstubAllGlobals()
  }
}

// GRCh38 runs 0..2 over chr1:0-3000, and every other walk takes the same
// three nodes whole, so the rows tie on completeness and on bp
function tiedWalks(names: string[]): GraphTables {
  const walks = ['GRCh38#0#chr1', ...names]
  return {
    nodes: {
      names: ['0', '1', '2'],
      lengths: Int32Array.of(1000, 1000, 1000),
      refs: Int32Array.of(0, 0, 0),
      starts: Float64Array.of(0, 1000, 2000),
      ranks: Int32Array.of(0, 0, 0),
      refNames: ['chr1'],
    },
    links: {
      from: new Int32Array(0),
      to: new Int32Array(0),
      strands: new Uint8Array(0),
    },
    walks: {
      names: walks,
      starts: Float64Array.from(walks, () => 0),
      ends: Float64Array.from(walks, () => 3000),
      offsets: Int32Array.from({ length: walks.length + 1 }, (_, i) => i * 3),
      steps: Int32Array.from(walks.flatMap(() => [0, 1, 2])),
      reversed: new Uint8Array(walks.length * 3),
    },
    departures: departureTable(),
    revisited: 0,
  }
}

const rowNames = (names: string[]) =>
  walkRowsOf(walkRowRuns(tiedWalks(names), { start: 0, end: 3000 })!).rows.map(
    r => r.name,
  )

test('walk rows that tie on completeness and bp come out in one order whatever the host locale', () => {
  expect(
    withoutLocale(() =>
      rowNames(['NA18508#2#c', 'HG00733#2#c', 'CHM13#0#chr1', 'HG00140#1#c']),
    ),
  ).toEqual(['CHM13#0#chr1', 'HG00140#1#c', 'HG00733#2#c', 'NA18508#2#c'])
})

// Before, HG00423 came first: the host compared the digits as text
test('HG005 comes before HG00423 among tied rows, its digits read as a number', () => {
  expect(rowNames(['HG00423#1#c', 'HG005#1#c'])).toEqual([
    'HG005#1#c',
    'HG00423#1#c',
  ])
})

test('a sample filter orders the haplotypes of one sample it names without the host locale', () => {
  const row = (haplotype: number) => ({
    name: `HG00733#${haplotype}#c`,
    sample: 'HG00733',
    haplotype,
    label: `HG00733#${haplotype}`,
  })
  expect(
    withoutLocale(() => filterSamples([row(2), row(1)], ['HG00733'])).map(
      r => r.name,
    ),
  ).toEqual(['HG00733#1#c', 'HG00733#2#c'])
})

test('sample rows that carry the same bp come out in one order whatever the host locale', () => {
  const samples = ['NA18508', 'HG00423', 'CHM13', 'HG005']
  const graph = convertGFAToGraph(
    parseGFA(
      [
        'H\tVN:Z:1.0',
        'S\ts1\t*\tLN:i:1000\tSN:Z:GRCh38#0#chr6\tSO:i:0\tSR:i:0',
        'S\ts2\t*\tLN:i:1000\tSN:Z:GRCh38#0#chr6\tSO:i:1000\tSR:i:0',
        ...samples.flatMap((sample, i) => [
          `S\ta${i}\t*\tLN:i:50\tSN:Z:${sample}#1#chr6\tSO:i:0\tSR:i:1`,
          `L\ts1\t+\ta${i}\t+\t0M`,
          `L\ta${i}\t+\ts2\t+\t0M`,
        ]),
      ].join('\n'),
    ),
    'rows',
  )
  expect(
    withoutLocale(() => sampleRowLayout(graph))!
      .rowLabels!.slice(1)
      .map(r => r.label),
  ).toEqual(['CHM13', 'HG005', 'HG00423', 'NA18508'])
})

test("one route's groups sit side by side in one order whatever the host locale", () => {
  const graph = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          'S\t1\tACGT',
          'S\t2\tGG',
          'S\t3\tTTTT',
          'L\t1\t+\t2\t+\t0M',
          'L\t2\t+\t3\t+\t0M',
          'L\t1\t+\t3\t+\t0M',
          'P\tref\t1+,3+\t*',
          'P\tA#1#c\t1+,2+,3+\t*',
          'P\tA#2#c\t1+,2+,3+\t*',
          'P\tC#1#c\t1+,2+,3+\t*',
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const group = (walk: string) => (walk.startsWith('C') ? 'beta' : 'Gamma')
  expect(
    withoutLocale(() => bundleRoutes(graph, group)).paths!.map(p => p.name),
  ).toEqual(['ref', 'A#1#c', 'C#1#c'])
})

test('a walk label repeated across records takes its ordinals without the host locale', () => {
  expect([
    ...withoutLocale(() =>
      walkLabelsOf([
        { name: 'b', label: 'HG005' },
        { name: 'c', label: 'CHM13' },
        { name: 'a', label: 'HG005' },
      ]),
    ),
  ]).toEqual([
    ['c', 'CHM13'],
    ['b', 'HG005'],
    ['a', 'HG005 (2)'],
  ])
})

const alt = (name: string): GraphNode => ({
  id: `${name}+`,
  name,
  length: 2,
  depth: 1,
  stable: { refName: 'alt', start: 0, rank: 1 },
})

// beta, Gamma and xy off the reference, each pair holding two alleles, inside
// a frame x..y with a way round them by z
const mixedCase: Graph = {
  name: 'g',
  nodes: ['x', 'beta', 'a1', 'a2', 'Gamma', 'b1', 'b2', 'xy', 'z', 'y'].map(
    alt,
  ),
  edges: [
    ['x', 'beta'],
    ['beta', 'a1'],
    ['beta', 'a2'],
    ['a1', 'Gamma'],
    ['a2', 'Gamma'],
    ['Gamma', 'b1'],
    ['Gamma', 'b2'],
    ['b1', 'xy'],
    ['b2', 'xy'],
    ['xy', 'y'],
    ['x', 'z'],
    ['z', 'y'],
  ].map(([from, to]) => ({
    from: `${from}+`,
    to: `${to}+`,
    fromStrand: '+' as const,
    toStrand: '+' as const,
  })),
  anchoredBy: 'tags',
}

const span = {
  refName: 'chr',
  start: 10,
  end: 15,
  segmentCount: 0,
  pathCount: 0,
  inversion: false,
  shortestAlleleLength: 0,
  longestAlleleLength: 0,
  segments: '',
  shortestAllele: undefined,
  longestAllele: undefined,
}

// The host's collator put beta>Gamma first, as it ignores letter case; by
// character code G comes before b
test('two superbubbles that tie are read and ordered without Intl', () => {
  expect(
    withoutLocale(() => superbubblesFromGraph(mixedCase, span)).map(b => b.key),
  ).toEqual(['Gamma>xy', 'beta>Gamma'])
})
