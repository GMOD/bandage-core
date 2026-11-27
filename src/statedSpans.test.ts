import { hostedTables } from '../test_data/hosted/hostedTables'
import { bubbleSubgraph } from './bubbles/popBubble'
import { figureData, walkRowInks } from './figureData'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { gfaTables } from './gfa/gfaTables'
import { graphFromTables } from './gfa/graphTables'
import { liftedRowInks, rowInkAt } from './layout/rowInks'
import { trimToWindow } from './layout/trimToWindow'
import { placeRowGenes } from './layout/walkRowDraw'
import { walkRowRuns, walkRowsOf } from './layout/walkRowRuns'
import { walkRows } from './layout/walkRows'
import { segmentAt, stripMarks } from './layout/walkStrip'
import { layoutModeByValue } from './layoutModes'
import { panSNContig } from './pansn'
import { passBars } from './passBar'
import { spanStated } from './pathAnchoring'
import { loadGraph } from './pipeline'
import { foldThreads } from './threadFold'
import { walkLift } from './walkHighlight'
import { walkKey, walkPosition } from './walkKey'

import type { WalkRows } from './layout/walkRows'
import type { Graph } from './types'

// ref walks a and c, 1 kb each, and each haplotype an insertion of its own
// between them, of lengths far enough apart that a fold keeps each a thread
const STARRED = [
  'S\ta\t*\tLN:i:1000',
  'S\tc\t*\tLN:i:1000',
  'S\ti2\t*\tLN:i:100',
  'S\ti3\t*\tLN:i:2000',
  'S\ti4\t*\tLN:i:10000',
  'L\ta\t+\tc\t+\t0M',
  ...['i2', 'i3', 'i4'].flatMap(i => [
    `L\ta\t+\t${i}\t+\t0M`,
    `L\t${i}\t+\tc\t+\t0M`,
  ]),
  'W\tref\t0\tchr\t0\t2000\t>a>c',
  'W\th2\t1\tctg2\t*\t*\t>a>i2>c',
  'W\th3\t1\tctg3\t700\t*\t>a>i3>c',
  'W\th4\t1\tctg4\t*\t3000\t>a>i4>c',
].join('\n')

// the reference and a haplotype state their ranges on their names, and
// `plain` states none, so its positions are along itself
const NAMED = [
  'S\ta\t*\tLN:i:1000',
  'S\tc\t*\tLN:i:1000',
  'S\ti\t*\tLN:i:100',
  'L\ta\t+\tc\t+\t0M',
  'L\tc\t+\ti\t+\t0M',
  'L\ta\t+\ti\t+\t0M',
  'L\ti\t+\tc\t+\t0M',
  'P\tchm13#chr1:500-2500\ta+,c+\t*',
  'P\thg#ctg:100-2200\ta+,c+,i+\t*',
  'P\tplain\ta+,i+,c+\t*',
].join('\n')

const lifted = (graph: Graph, member: string) => {
  const path = graph.paths?.find(
    p => p.name === member || p.members?.includes(member),
  )
  return path
    ? walkLift(graph, [{ walk: path.name, color: { field: 'progress' } }])
        ?.walks[0]
    : undefined
}

const rangeOf = (graph: Graph, member: string) => {
  const walk = lifted(graph, member)
  return walk && walkKey(walk).scale
}

const folded = (graph: Graph) => {
  const fold = foldThreads(graph, 50)
  if (!fold.folded) {
    throw new Error(fold.reason)
  }
  return fold.graph
}

const starred = {
  text: loadGraph(STARRED, 'starred', { referencePath: 'ref#0#chr' }),
  converted: convertGFAToGraph(parseGFA(STARRED), 'starred'),
  tables: graphFromTables(gfaTables(STARRED)!, 'starred'),
}

test.each(Object.entries(starred))(
  'read as %s, a W record states a range only from a stated start: its stated end, or its start and its own steps',
  (_, graph) => {
    expect(rangeOf(graph, 'ref#0#chr')).toBe('chr:1-2,000 (2 kb)')
    expect(rangeOf(graph, 'h2#1#ctg2')).toBeUndefined()
    expect(rangeOf(graph, 'h3#1#ctg3')).toBe('ctg3:701-4,700 (4 kb)')
    expect(rangeOf(graph, 'h4#1#ctg4')).toBeUndefined()
  },
)

test('a node on a walk that states no start is on it and has no position on its contig', () => {
  const graph = starred.text
  const walk = lifted(graph, 'h2#1#ctg2')!
  const node = graph.nodes.find(n => n.name === 'c')!
  const other = graph.nodes.find(n => n.name === 'i3')!
  expect(walkPosition(walk, node.id, node.length)).toEqual({
    onWalk: true,
    at: undefined,
  })
  expect(walkPosition(walk, other.id, other.length)).toEqual({
    onWalk: false,
    at: undefined,
  })
  const own = lifted(graph, 'h3#1#ctg3')!
  expect(walkPosition(own, node.id, node.length).at).toBe('ctg3:3,701-4,700')
})

test('folded, a W record keeps the range its start and own steps state, and one with no stated start has none', () => {
  const graph = folded(starred.text)
  expect(rangeOf(graph, 'ref#0#chr')).toBe('chr:1-2,000 (2 kb)')
  expect(rangeOf(graph, 'h2#1#ctg2')).toBeUndefined()
  expect(rangeOf(graph, 'h3#1#ctg3')).toBe('ctg3:701-4,700 (4 kb)')
  expect(rangeOf(graph, 'h4#1#ctg4')).toBeUndefined()
  const walk = lifted(graph, 'h3#1#ctg3')!
  const node = graph.nodes.find(n => walk.nodeIds.has(n.id))!
  expect(walkPosition(walk, node.id, node.length)).toEqual({
    onWalk: true,
    at: undefined,
  })
})

test("a P record's range is the one its name states where its steps span it, as gfa-to-tabix reads it, and a name with none, or one its steps do not span, is the path's own coordinates", () => {
  const graph = loadGraph(NAMED, 'named', { referencePath: 'chm13#chr1' })
  expect(rangeOf(graph, 'chm13#chr1:500-2500')).toBe('chr1:501-2,500 (2 kb)')
  expect(rangeOf(graph, 'hg#ctg:100-2200')).toBe('ctg:101-2,200 (2.1 kb)')
  expect(rangeOf(graph, 'plain')).toBe('plain:1-2,100 (2.1 kb)')
  const short = loadGraph(
    NAMED.replace('chm13#chr1:500-2500', 'chm13#chr1:500-1500'),
    'short',
    { referencePath: 'chm13#chr1' },
  )
  expect(rangeOf(short, 'chm13#chr1:500-1500')).toBe(
    'chr1:500-1500:1-2,000 (2 kb)',
  )
})

test('folded, each P thread of one record keeps the range its name states, the reference included', () => {
  const graph = folded(
    loadGraph(NAMED, 'named', { referencePath: 'chm13#chr1' }),
  )
  expect(rangeOf(graph, 'chm13#chr1:500-2500')).toBe('chr1:501-2,500 (2 kb)')
  expect(rangeOf(graph, 'hg#ctg:100-2200')).toBe('ctg:101-2,200 (2.1 kb)')
  expect(rangeOf(graph, 'plain')).toBe('plain:1-2,100 (2.1 kb)')
  expect(lifted(graph, 'chm13#chr1:500-2500')?.reference).toBe(true)
})

// hap goes round a and b twice, 1 kb each, by a 10 bp s a fold merges away,
// so a fold keeps both passes and draws the walk 10 bp short
const REPEAT = [
  'S\ta\t*\tLN:i:1000',
  'S\tb\t*\tLN:i:1000',
  'S\tc\t*\tLN:i:1000',
  'S\ts\t*\tLN:i:10',
  'L\ta\t+\tb\t+\t0M',
  'L\tb\t+\tc\t+\t0M',
  'L\tb\t+\ta\t+\t0M',
  'L\tb\t+\ts\t+\t0M',
  'L\ts\t+\ta\t+\t0M',
  'W\tref\t0\tchr\t0\t3000\t>a>b>c',
  'W\thap\t1\tctg\t0\t5010\t>a>b>s>a>b>c',
].join('\n')

const byPass = (graph: Graph) => {
  const path = graph.paths!.find(
    p => p.members?.includes('hap#1#ctg') ?? p.name === 'hap#1#ctg',
  )!
  return [{ walk: path.name, color: { field: 'pass' as const } }]
}

test.each([
  ['unfolded', true, 5010],
  ['folded', false, 5000],
])(
  "%s, a walk's passes colour its row only where its nodes are drawn at its own lengths, in core and from the figure data alike, and its pass bar runs the bp drawn",
  (_, own, drawnBp) => {
    const unfolded = loadGraph(REPEAT, 'repeat', {
      referencePath: 'ref#0#chr',
    })
    const graph = own ? unfolded : folded(unfolded)
    const layers = byPass(graph)
    const lift = walkLift(graph, layers)!
    const walk = lift.walks.find(w => w.name === layers[0]!.walk)!
    expect(walk.walkPasses?.passes.length).toBe(2)
    expect(walk.range).toEqual({ contig: 'ctg', start: 0, end: 5010 })
    expect(liftedRowInks([walk])[0]?.passes !== undefined).toBe(own)
    expect(passBars(lift).map(bar => [bar.bp, bar.ownLengths])).toEqual([
      [drawnBp, own],
    ])
    const layout = layoutModeByValue('ordered').run(graph, undefined)!
    const tables = figureData(graph, layout, { walks: layers })
    const { keys, passRuns } = tables
    expect(keys.ownLengths).toEqual([own])
    expect(tables.passBars).toEqual({
      walk: ['hap'],
      bp: [drawnBp],
      ownLengths: [own],
    })
    const inksOf = (columns: Parameters<typeof walkRowInks>[0]) =>
      walkRowInks(
        columns,
        { name: [walk.name], bp: [5010], contig: ['ctg'], contigStart: [0] },
        { row: [0, 0, 0], offset: [500, 2500, 4500] },
        { ...passRuns, key: passRuns.walk.map(w => keys.walk.indexOf(w)) },
      ).color
    expect(
      inksOf(keys).some(
        color => color !== null && passRuns.color.includes(color),
      ),
    ).toBe(own)
    const { name, stops, field, contig, start, end } = keys
    expect(inksOf({ name, stops, field, contig, start, end })).toEqual(
      own ? inksOf(keys) : inksOf({ ...keys, ownLengths: [true] }),
    )
  },
)

// a and b and c and d are 1 kb of chr; h takes a 300 bp i in place of b
const POPPED = [
  'S\ta\t*\tLN:i:1000\tSN:Z:chr\tSO:i:0\tSR:i:0',
  'S\tb\t*\tLN:i:1000\tSN:Z:chr\tSO:i:1000\tSR:i:0',
  'S\tc\t*\tLN:i:1000\tSN:Z:chr\tSO:i:2000\tSR:i:0',
  'S\td\t*\tLN:i:1000\tSN:Z:chr\tSO:i:3000\tSR:i:0',
  'S\ti\t*\tLN:i:300\tSN:Z:h#1#ctg\tSO:i:1700\tSR:i:1',
  'L\ta\t+\tb\t+\t0M',
  'L\tb\t+\tc\t+\t0M',
  'L\tc\t+\td\t+\t0M',
  'L\ta\t+\ti\t+\t0M',
  'L\ti\t+\tc\t+\t0M',
  'W\tref\t0\tchr\t0\t4000\t>a>b>c>d',
  'W\th\t1\tctg\t700\t4000\t>a>i>c>d',
].join('\n')

const positionOf = (graph: Graph, member: string, name: string) => {
  const node = graph.nodes.find(n => n.name === name)!
  return walkPosition(lifted(graph, member)!, node.id, node.length).at
}

test("a popped bubble's walks range over the steps it keeps, from their first's start to their last's end", () => {
  const graph = loadGraph(POPPED, 'popped', { referencePath: 'ref#0#chr' })
  const popped = bubbleSubgraph(graph, ['b', 'i', 'c'])
  expect(rangeOf(popped, 'h#1#ctg')).toBe('ctg:1,701-3,000 (1.3 kb)')
  expect(rangeOf(popped, 'ref#0#chr')).toBe('chr:1,001-3,000 (2 kb)')
  expect(positionOf(popped, 'h#1#ctg', 'c')).toBe('ctg:2,001-3,000')
})

test("a window's trim ranges each walk over the steps it keeps", () => {
  const graph = loadGraph(POPPED, 'popped', { referencePath: 'ref#0#chr' })
  const trimmed = trimToWindow(graph, { start: 1200, end: 2800 })
  expect(rangeOf(trimmed, 'h#1#ctg')).toBe('ctg:2,001-3,000 (1 kb)')
  expect(rangeOf(trimmed, 'ref#0#chr')).toBe('chr:1,001-3,000 (2 kb)')
  expect(positionOf(trimmed, 'h#1#ctg', 'c')).toBe('ctg:2,001-3,000')
})

test("a window's trim and a popped bubble give a walk whose stated span its own steps do not fill no range or position over the steps they keep", () => {
  const graph = loadGraph(
    [...POPPED.split('\n'), 'W\th2\t1\tctg2\t700\t1500\t>a>i>c>d'].join('\n'),
    'overrun',
    { referencePath: 'ref#0#chr' },
  )
  expect(rangeOf(graph, 'h2#1#ctg2')).toBe('ctg2:701-1,500 (800 bp)')
  for (const kept of [
    trimToWindow(graph, { start: 1200, end: 2800 }),
    bubbleSubgraph(graph, ['b', 'i', 'c']),
  ]) {
    expect(rangeOf(kept, 'h2#1#ctg2')).toBeUndefined()
    expect(positionOf(kept, 'h2#1#ctg2', 'c')).toBeUndefined()
    expect(rangeOf(kept, 'h#1#ctg')).toBeDefined()
  }
})

test('a walk whose stated end its own steps do not reach or pass gives its stated range and no position', () => {
  const graph = loadGraph(
    [...STARRED.split('\n'), 'W\th5\t1\tctg5\t0\t500\t>a>i2>c'].join('\n'),
    'short',
    { referencePath: 'ref#0#chr' },
  )
  expect(rangeOf(graph, 'h5#1#ctg5')).toBe('ctg5:1-500 (500 bp)')
  expect(positionOf(graph, 'h5#1#ctg5', 'c')).toBeUndefined()
  expect(positionOf(graph, 'h5#1#ctg5', 'a')).toBeUndefined()
})

test('a folded thread of several P records with no one span is named without a range', () => {
  const graph = folded(
    loadGraph(
      [
        ...NAMED.split('\n').filter(line => !line.startsWith('P')),
        'P\tchm13#chr1:500-2500\ta+,c+\t*',
        'P\ts1#ctg:100-2100\ta+,c+\t*',
        'P\ts2#ctg:300-2300\ta+,c+\t*',
        'P\ts3#ctg:300-2400\ta+,i+,c+\t*',
      ].join('\n'),
      'shared',
      { referencePath: 'chm13#chr1' },
    ),
  )
  const shared = graph.paths!.find(p => p.members?.includes('s1#ctg:100-2100'))
  expect(shared?.members).toEqual(['s1#ctg:100-2100', 's2#ctg:300-2300'])
  expect(shared?.name).toBe('s1#ctg')
  expect(rangeOf(graph, 's1#ctg:100-2100')).toBeUndefined()
})

const SHORT = [...STARRED.split('\n'), 'W\th5\t1\tctg5\t0\t500\t>a>i2>c'].join(
  '\n',
)

const rowsOf = (bars: WalkRows | undefined) =>
  bars ? [bars.reference, ...bars.rows] : []

const shortRows = {
  text: walkRows(loadGraph(SHORT, 'short', { referencePath: 'ref#0#chr' })),
  converted: walkRows(convertGFAToGraph(parseGFA(SHORT), 'short')),
  tables: walkRowsOf(
    walkRowRuns(gfaTables(SHORT)!, undefined, { referencePath: 'ref#0#chr' })!,
  ),
}

test.each(Object.entries(shortRows))(
  "read as %s, a walk row's bar has a contig axis only where its record states a span its own steps fill, and genes land only on such a row",
  (_, bars) => {
    const rows = rowsOf(bars)
    expect(Object.fromEntries(rows.map(row => [row.name, row.axis]))).toEqual({
      'ref#0#chr': { contig: 'chr', start: 0 },
      'h2#1#ctg2': undefined,
      'h3#1#ctg3': { contig: 'ctg3', start: 700 },
      'h4#1#ctg4': undefined,
      'h5#1#ctg5': undefined,
    })
    const gene = (refName: string) => ({
      name: `on ${refName}`,
      refName,
      start: 0,
      end: 20_000,
      strand: 1,
      exons: [],
    })
    const placed = placeRowGenes(
      rows,
      new Map(rows.map(row => [row.name, [gene(panSNContig(row.name))]])),
    )
    expect([...placed.keys()]).toEqual(['ref#0#chr', 'h3#1#ctg3'])
  },
)

test("a row with no contig axis still marks where its walk passes a node, and finds the node under a point, along the walk's own steps", () => {
  const graph = loadGraph(SHORT, 'short', { referencePath: 'ref#0#chr' })
  const bars = walkRows(graph)!
  const node = (name: string) => graph.nodes.find(n => n.name === name)!
  const marks = stripMarks(graph, rowsOf(bars), node('c'))
  for (const name of ['h2#1#ctg2', 'h4#1#ctg4', 'h5#1#ctg5']) {
    const row = bars.rows.find(r => r.name === name)!
    expect(row.axis).toBeUndefined()
    expect(row.along).toEqual({ start: 0 })
    expect(marks.filter(m => m.row === name).map(m => m.start)).toEqual([
      name === 'h4#1#ctg4' ? 11_000 : 1100,
    ])
    expect(segmentAt(graph, row, 600, 1)).toBe(node('a').id)
  }
})

test('a row with no contig axis colours its bar past a break by the bp the break holds', () => {
  const ink = { walk: 'w', stops: ['#000000', '#ffffff'] }
  const along = { start: 0, breaks: [{ at: 5, bp: 10, drawn: 2 }] }
  expect(rowInkAt(ink, { bp: 40, along }, 15)).toBe(
    rowInkAt(ink, { bp: 40 }, 23),
  )
  expect(rowInkAt(ink, { bp: 40, along }, 15)).not.toBe(
    rowInkAt(ink, { bp: 40 }, 15),
  )
})

test.each(['hla-ii-default', 'hla-ii-expanded', 'sv-mul-1k-10k'])(
  "every walk of the hosted walk file's %s cut states spans its own steps fill, so each walked row has a contig axis",
  name => {
    const { tables } = hostedTables(name)
    const graph = loadGraph(tables, name)
    expect(
      (graph.paths ?? []).filter(
        path => !lifted(graph, path.name)?.spansStated,
      ),
    ).toEqual([])
    const walked = (bars: WalkRows | undefined) =>
      rowsOf(bars).filter(row => row.bp > 0)
    for (const bars of [walkRowsOf(walkRowRuns(tables)!), walkRows(graph)]) {
      expect(walked(bars).length).toBeGreaterThan(1)
      expect(walked(bars).filter(row => !row.axis)).toEqual([])
    }
  },
)

test("folded to threads, a row has a contig axis only where its thread states a span the fold's lengths of its steps fill, and keeps its place along its own steps", () => {
  const bars = walkRows(folded(starred.text))!
  expect(
    Object.fromEntries(rowsOf(bars).map(row => [row.name, row.axis])),
  ).toEqual({
    'ref#0#chr': { contig: 'chr', start: 0 },
    'h2#1#ctg2': undefined,
    'h3#1#ctg3': { contig: 'ctg3', start: 700 },
    'h4#1#ctg4': undefined,
  })
  expect(rowsOf(bars).filter(row => !row.along)).toEqual([])
  const { tables } = hostedTables('hla-ii-default')
  const fold = foldThreads(loadGraph(tables, 'hla'), 236)
  const graph = fold.folded ? fold.graph : undefined
  const lengthOf = new Map(graph?.nodes.map(n => [n.id, n.length]))
  const fills = new Set(
    (graph?.paths ?? []).flatMap(path =>
      spanStated(
        path,
        path.nodeIds.reduce((bp, id) => bp + (lengthOf.get(id) ?? 0), 0),
      )
        ? [path.name]
        : [],
    ),
  )
  const hosted = rowsOf(graph && walkRows(graph))
  expect(fills.size).toBeGreaterThan(0)
  expect(fills.size).toBeLessThan(hosted.length)
  expect(
    hosted.filter(row => fills.has(row.name) !== (row.axis !== undefined)),
  ).toEqual([])
  expect(hosted.filter(row => row.bp > 0 && !row.along)).toEqual([])
})
