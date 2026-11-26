import { fragmentRuns } from '@gmod/gfa-tabix'

import { drawn, orderedFigure } from '../scripts/fold-runs/drawn'
import { hostedTables } from '../test_data/hosted/hostedTables'
import { figureData } from './figureData'
import { departureTable } from './gfa/departures'
import { END_KINDS, cutEnds } from './gfa/walkRuns'
import { absentHaplotypesText } from './graphKey'
import { liftedRowInks } from './layout/rowInks'
import { layoutModeByValue } from './layoutModes'
import { loadGraph } from './pipeline'
import { foldThreads, openBranchSpan } from './threadFold'
import { foldThreadRuns } from './threadFoldRuns'
import { walkLift } from './walkHighlight'
import { walkKey, walkPosition } from './walkKey'

import type { GraphTables } from './gfa/graphTables'
import type { WalkEndTable } from './gfa/walkRuns'
import type { ThreadEvent } from './threadFold'
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

test('a branch that continues past the window states its far breakpoint, past the window edge its refStart or refEnd stops at', () => {
  const graph = loadGraph(hostedTables('hla-ii-default').tables, 'hla')
  const fold = foldThreads(graph, 236)
  const past = fold.folded
    ? fold.events.filter(event => event.text.includes('continues past'))
    : []
  expect(
    past.map(({ refStart, refEnd, beyond = Number.NaN }) =>
      Math.round((Math.max(refEnd, beyond) - Math.min(refStart, beyond)) / 100),
    ),
  ).toEqual([860, 18])
  expect(
    past.every(
      ({ refStart, refEnd, beyond = Number.NaN }) =>
        beyond < refStart || beyond > refEnd,
    ),
  ).toBe(true)
})

test("an open branch's node spans the reference out to its far breakpoint, and any other node has no such span", () => {
  const event = (fields: Partial<ThreadEvent>): ThreadEvent => ({
    text: '',
    kind: 'other',
    refStart: 100,
    refEnd: 500,
    haplotypes: 1,
    paths: [],
    nodeIds: [],
    from: undefined,
    to: undefined,
    anchored: true,
    ...fields,
  })
  const events = [
    event({ nodeIds: ['right'], refStart: 400, refEnd: 500, beyond: 900 }),
    event({ nodeIds: ['left'], refStart: 100, refEnd: 150, beyond: 20 }),
    event({ nodeIds: ['inside'], refStart: 200, refEnd: 300 }),
  ]
  expect(openBranchSpan(events, 'right')).toEqual({ start: 400, end: 900 })
  expect(openBranchSpan(events, 'left')).toEqual({ start: 20, end: 150 })
  expect(openBranchSpan(events, 'inside')).toBeUndefined()
  expect(openBranchSpan(events, 'none')).toBeUndefined()
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

// ref#0#chr walks a, c and d, 1 kb each. h1 adds a 5 bp insertion b, under the
// fold, and a 200 bp insertion e, over it, so its thread is its own and drawn
// 5 bp short. h2 and h3 add the same 300 bp insertion f and are one thread.
const NODES = [
  ['a', 1000, 0],
  ['b', 5, Number.NaN],
  ['c', 1000, 1000],
  ['d', 1000, 2000],
  ['e', 200, Number.NaN],
  ['f', 300, Number.NaN],
] as const
const WALKS = [
  ['ref#0#chr', 0, 3000, ['a', 'c', 'd']],
  ['h1#1#ctg1', 100, 3305, ['a', 'b', 'c', 'e', 'd']],
  ['h2#1#ctg2', 0, 3300, ['a', 'c', 'f', 'd']],
  ['h3#1#ctg3', 50, 3350, ['a', 'c', 'f', 'd']],
] as const

const LINKS = [
  ['a', 'b'],
  ['b', 'c'],
  ['a', 'c'],
  ['c', 'd'],
  ['c', 'e'],
  ['e', 'd'],
  ['c', 'f'],
  ['f', 'd'],
] as const

function indelTables(): GraphTables {
  const index = new Map<string, number>(NODES.map(([name], i) => [name, i]))
  const steps = WALKS.flatMap(([, , , route]) =>
    route.map(name => index.get(name)!),
  )
  const offsets = [0]
  for (const [, , , route] of WALKS) {
    offsets.push(offsets.at(-1)! + route.length)
  }
  const onReference = (i: number) => !Number.isNaN(NODES[i]![2])
  return {
    nodes: {
      names: NODES.map(([name]) => name),
      lengths: Int32Array.from(NODES, ([, bp]) => bp),
      refs: Int32Array.from(NODES, (_, i) => (onReference(i) ? 0 : -1)),
      starts: Float64Array.from(NODES, ([, , at], i) =>
        onReference(i) ? at : 0,
      ),
      ranks: Int32Array.from(NODES, (_, i) => (onReference(i) ? 0 : 1)),
      refNames: ['ref#0#chr'],
    },
    links: {
      from: Int32Array.from(LINKS, ([from]) => index.get(from)!),
      to: Int32Array.from(LINKS, ([, to]) => index.get(to)!),
      strands: new Uint8Array(LINKS.length),
    },
    walks: {
      names: WALKS.map(([name]) => name),
      starts: Float64Array.from(WALKS, ([, start]) => start),
      ends: Float64Array.from(WALKS, ([, , end]) => end),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(steps),
      reversed: new Uint8Array(steps.length),
      refStarts: Float64Array.from(steps, i => NODES[i]![2]),
    },
    departures: departureTable(),
    revisited: 0,
  }
}

const indelFolds = () => {
  const tables = indelTables()
  return [
    ['runs', foldThreadRuns(fragmentRuns(tables, 'ref#0#chr', []), 50)],
    ['a cut', foldThreads(loadGraph(tables, 'toy'), 50)],
  ] as const
}

const liftedThread = (graph: Graph, member: string) => {
  const path = graph.paths?.find(p => p.members?.includes(member))
  return (
    path &&
    walkLift(graph, [{ walk: path.name, color: { field: 'progress' } }])
      ?.walks[0]
  )
}

test.each(indelFolds())(
  "folded from %s over an indel under the fold, a thread of one record writes its record's start and end",
  (_, fold) => {
    const graph = fold.folded ? fold.graph : undefined
    expect(graph && liftedThread(graph, 'h1#1#ctg1')?.extent).toMatchObject({
      start: 100,
      end: 3300,
    })
    expect(graph && walkKey(liftedThread(graph, 'h1#1#ctg1')!)).toMatchObject({
      scale: 'ctg1:101-3,305 (3.2 kb)',
      gaps: '',
    })
    expect(graph && walkKey(liftedThread(graph, 'ref#0#chr')!).scale).toBe(
      'chr:1-3,000 (3 kb)',
    )
  },
)

test.each(indelFolds())(
  'folded from %s, a thread of two records writes no range, since no one span is true of both',
  (_, fold) => {
    const graph = fold.folded ? fold.graph : undefined
    const thread = graph && liftedThread(graph, 'h2#1#ctg2')
    expect(thread?.members).toEqual(['h2#1#ctg2', 'h3#1#ctg3'])
    expect(thread?.range).toBeUndefined()
    expect(thread && walkKey(thread)).toMatchObject({
      scale: undefined,
      hover: undefined,
    })
  },
)

test.each(indelFolds())(
  'folded from %s, a node on a thread has no position on its contig, and one off it is not on it',
  (_, fold) => {
    const graph = fold.folded ? fold.graph : undefined
    const thread = graph && liftedThread(graph, 'h1#1#ctg1')
    const on = graph?.nodes.find(node => thread?.nodeIds.has(node.id))
    const off = graph?.nodes.find(node => !thread?.nodeIds.has(node.id))
    expect(on && thread && walkPosition(thread, on.id, on.length)).toEqual({
      onWalk: true,
      at: undefined,
    })
    expect(off && thread && walkPosition(thread, off.id, off.length)).toEqual({
      onWalk: false,
      at: undefined,
    })
  },
)

test.each(indelFolds())(
  "folded from %s, the figure data's key columns are the range the key writes, and its row inks read the same",
  (_, fold) => {
    const graph = fold.folded ? fold.graph : undefined
    const thread = graph?.paths?.find(p => p.members?.includes('h1#1#ctg1'))
    const layout = graph && layoutModeByValue('ordered').run(graph, undefined)
    const { keys } =
      graph && layout && thread
        ? figureData(graph, layout, {
            walks: [{ walk: thread.name, color: { field: 'progress' } }],
          })
        : { keys: undefined }
    const k = keys?.name.indexOf(thread?.name ?? '') ?? -1
    expect([keys?.contig[k], keys?.start[k], keys?.end[k]]).toEqual([
      'ctg1',
      100,
      3305,
    ])
    const walk = graph && liftedThread(graph, 'h1#1#ctg1')
    expect(walk && liftedRowInks([walk])[0]?.range).toEqual({
      contig: 'ctg1',
      start: 100,
      end: 3305,
    })
  },
)
