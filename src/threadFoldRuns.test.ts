import { fragmentRuns } from '@gmod/gfa-tabix'

import { drawn, orderedFigure } from '../scripts/fold-runs/drawn'
import { hostedTables } from '../test_data/hosted/hostedTables'
import { END_KINDS, cutEnds } from './gfa/walkRuns'
import { absentHaplotypesText } from './graphKey'
import { loadGraph } from './pipeline'
import { foldThreads } from './threadFold'
import { foldThreadRuns } from './threadFoldRuns'

import type { WalkEndTable } from './gfa/walkRuns'
import type { Graph } from './types'

// Cuts of the hosted HPRC walk file for eight haplotypes: HLA class II at
// chr6:32,484,416-32,514,438 with its abridged pieces left out and read in
// full, and chr2:90,391,794-90,397,920
const FIXTURES = ['hla-ii-default', 'hla-ii-expanded', 'sv-mul-1k-10k']

const withoutEnds = (graph: Graph): Graph => ({
  ...graph,
  paths: graph.paths?.map(path => ({ ...path, ends: undefined })),
})

// what a fold draws and says, or the reason it gives for not folding
function shown(
  fold: ReturnType<typeof foldThreads> | ReturnType<typeof foldThreadRuns>,
) {
  if (!fold.folded) {
    throw new Error(fold.reason)
  }
  return {
    drawn: drawn(fold.graph, fold.events),
    figure: orderedFigure(fold.graph),
    walks: fold.walks,
  }
}

const endText = (table: WalkEndTable, p: number) =>
  [
    table.kinds[p],
    table.pos[p],
    table.reversed[p],
    table.ownBp[p],
    table.missingBp[p],
  ].join(' ')

describe.each(FIXTURES)('the hosted cut %s', fixture => {
  const { refName, tables } = hostedTables(fixture)
  const runs = fragmentRuns(tables, refName, [])
  const graph = loadGraph(tables, fixture)

  test("each walk's ends are those graph-walks reads its runs with", () => {
    const ends = cutEnds(tables, refName)
    const walkAt = new Map(
      tables.walks.names.map((name, p) => [
        `${name} ${tables.walks.starts[p]}`,
        p,
      ]),
    )
    const pairs = runs.walks.names.map((name, p) => {
      const at = walkAt.get(`${name} ${runs.walks.starts[p]}`) ?? -1
      const end = ends[at]
      const side = (row: typeof end, which: 'before' | 'after') =>
        row
          ? [
              END_KINDS.indexOf(row[which].kind),
              row[which].pos,
              row[which].reversed ? 1 : 0,
              row[which].ownBp,
              row[which].missingBp,
            ].join(' ')
          : 'none'
      return [
        `${name} ${side(end, 'before')} | ${side(end, 'after')}`,
        `${name} ${endText(runs.walks.before, p)} | ${endText(runs.walks.after, p)}`,
      ]
    })
    expect(pairs.map(([mine]) => mine)).toEqual(
      pairs.map(([, theirs]) => theirs),
    )
  })

  test.each([236, 1000])(
    'folded from its runs at %d bp, it draws and says what its cut does',
    bp => {
      expect(shown(foldThreadRuns(runs, bp, { name: fixture }))).toEqual(
        shown(foldThreads(graph, bp)),
      )
    },
  )

  test('its runs name the walks that depart across the whole window, so the key says such a walk has no step here rather than no walk', () => {
    const steps = foldThreads(graph, 236)
    const fromRuns = foldThreadRuns(runs, 236, { name: fixture })
    const across =
      fixture === 'sv-mul-1k-10k' ? ['HG01960#1#JBHIHM010000042.1'] : []
    const key = (fold: typeof steps | typeof fromRuns) =>
      fold.folded ? absentHaplotypesText(fold.graph, across, refName) : 'none'
    const without = foldThreadRuns(
      { ...runs, departing: { ...runs.departing, names: [] } },
      236,
      { name: fixture },
    )
    expect(runs.departing.names).toEqual(across)
    expect(shown(fromRuns).drawn.threadFold?.departing).toEqual(across)
    expect(key(fromRuns)).toEqual(key(steps))
    expect([key(fromRuns), key(without)]).toEqual(
      across.length > 0
        ? [
            `1 of 1 haplotype has no step on ${refName} here`,
            '1 of 1 haplotype has no walk here',
          ]
        : [undefined, undefined],
    )
  })

  test('a walk swapped for another breaks that equality', () => {
    const { names } = runs.walks
    const last = names.length - 1
    const swapped = {
      ...runs,
      walks: {
        ...runs.walks,
        names: names.map((name, p) =>
          p === 1 ? names[last]! : p === last ? names[1]! : name,
        ),
      },
    }
    expect(
      shown(foldThreadRuns(swapped, 236, { name: fixture })).drawn,
    ).not.toEqual(shown(foldThreads(graph, 236)).drawn)
  })
})

test("a cut's fold given its walks' ends no longer says a walk starts or ends inside the window where it carries on past it", () => {
  const graph = loadGraph(hostedTables('hla-ii-default').tables, 'hla')
  const texts = (g: Graph) => {
    const fold = foldThreads(g, 236)
    return fold.folded ? fold.events.map(event => event.text) : []
  }
  const inside = (all: string[]) =>
    all.filter(text => text.includes('inside the window'))
  const past = (all: string[]) =>
    all.filter(text => text.includes('continues past the window'))
  const before = texts(withoutEnds(graph))
  const after = texts(graph)
  expect([inside(before), past(before)]).toEqual([
    [
      'walk ends inside the window 45.1 kb, 2 of 9',
      'walk ends inside the window 252 bp, 2 of 9',
    ],
    [],
  ])
  expect([inside(after), past(after)]).toEqual([
    [],
    [
      'deletion 86 kb, 2 of 9, continues past the window',
      'deletion 1.8 kb, 2 of 9, continues past the window',
    ],
  ])
})

test('runs whose haplotypes are in more pieces than 1.5 a haplotype are refused, so a host cuts the window', () => {
  const { refName, tables } = hostedTables('sv-mul-1k-10k')
  const runs = fragmentRuns(tables, refName, [])
  const pieces = (perHaplotype: number) => ({
    ...runs,
    walks: {
      ...runs.walks,
      names: runs.walks.names.map((name, p) =>
        p === 0 ? name : `HG${Math.ceil(p / perHaplotype)}#1#piece${p}`,
      ),
    },
  })
  expect(runs.walks.names).toHaveLength(9)
  expect(foldThreadRuns(pieces(4), 236)).toEqual({
    folded: false,
    reason:
      'the 3 haplotypes here are in 9 pieces, more than 1.5 a haplotype, so the window is cut rather than folded from runs',
  })
  expect(foldThreadRuns(pieces(1), 236).folded).toBe(true)
})

test('a graph read from GFA text states no ends, so its fold is as before', () => {
  const graph = loadGraph(
    [
      'S\ta\t*\tLN:i:1000',
      'S\tb\t*\tLN:i:2000',
      'S\tc\t*\tLN:i:1000',
      'L\ta\t+\tb\t+\t0M',
      'L\tb\t+\tc\t+\t0M',
      'L\ta\t+\tc\t+\t0M',
      'W\tref\t0\tchr\t0\t4000\t>a>b>c',
      'W\th1\t1\tchr\t0\t2000\t>a>c',
    ].join('\n'),
    'toy',
    { referencePath: 'ref#0#chr' },
  )
  expect(graph.paths?.map(path => path.ends)).toEqual([undefined, undefined])
})

test('runs of a file that does not state its reference passes no node twice are refused', () => {
  const { refName, tables } = hostedTables('hla-ii-default')
  const runs = fragmentRuns(tables, refName, [])
  expect(foldThreadRuns({ ...runs, revisited: 2 }, 236)).toEqual({
    folded: false,
    reason:
      'the reference passes 2 nodes of the graph more than once, so a run off it may be a copy of reference sequence and not a variant',
  })
  expect(foldThreadRuns({ ...runs, revisited: Number.NaN }, 236)).toEqual({
    folded: false,
    reason:
      'the walk file does not say how many nodes its reference passes more than once, so a run off it may be a copy of reference sequence and not a variant',
  })
  expect(foldThreadRuns(runs, 0)).toEqual({
    folded: false,
    reason: 'nothing to fold',
  })
})
