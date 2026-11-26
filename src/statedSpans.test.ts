import { figureData, walkRowInks } from './figureData'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { gfaTables } from './gfa/gfaTables'
import { graphFromTables } from './gfa/graphTables'
import { liftedRowInks } from './layout/rowInks'
import { layoutModeByValue } from './layoutModes'
import { loadGraph } from './pipeline'
import { foldThreads } from './threadFold'
import { walkLift } from './walkHighlight'
import { walkKey, walkPosition } from './walkKey'

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

test("a P record's range is the one its name states, and a name with none is the path's own coordinates", () => {
  const graph = loadGraph(NAMED, 'named', { referencePath: 'chm13#chr1' })
  expect(rangeOf(graph, 'chm13#chr1:500-2500')).toBe('chr1:501-2,500 (2 kb)')
  expect(rangeOf(graph, 'hg#ctg:100-2200')).toBe('ctg:101-2,200 (2.1 kb)')
  expect(rangeOf(graph, 'plain')).toBe('plain:1-2,100 (2.1 kb)')
  const short = loadGraph(
    NAMED.replace('chm13#chr1:500-2500', 'chm13#chr1:500-1500'),
    'short',
    { referencePath: 'chm13#chr1' },
  )
  expect(rangeOf(short, 'chm13#chr1:500-1500')).toBe('chr1:501-1,500 (1 kb)')
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

// hap goes round a and b twice, 1 kb each, so a fold keeps both passes
const REPEAT = [
  'S\ta\t*\tLN:i:1000',
  'S\tb\t*\tLN:i:1000',
  'S\tc\t*\tLN:i:1000',
  'L\ta\t+\tb\t+\t0M',
  'L\tb\t+\tc\t+\t0M',
  'L\tb\t+\ta\t+\t0M',
  'W\tref\t0\tchr\t0\t3000\t>a>b>c',
  'W\thap\t1\tctg\t0\t5000\t>a>b>a>b>c',
].join('\n')

const byPass = (graph: Graph) => {
  const path = graph.paths!.find(p => p.members?.includes('hap#1#ctg') ?? p.name === 'hap#1#ctg')!
  return [{ walk: path.name, color: { field: 'pass' as const } }]
}

test.each([
  ['unfolded', true],
  ['folded', false],
])(
  "%s, a walk's passes colour its row only where its nodes are drawn at its own lengths, in core and from the figure data alike",
  (_, own) => {
    const unfolded = loadGraph(REPEAT, 'repeat', { referencePath: 'ref#0#chr' })
    const graph = own ? unfolded : folded(unfolded)
    const layers = byPass(graph)
    const walk = walkLift(graph, layers)!.walks.find(w => w.name === layers[0]!.walk)!
    expect(walk.walkPasses?.passes.length).toBe(2)
    expect(liftedRowInks([walk])[0]?.passes !== undefined).toBe(own)
    const layout = layoutModeByValue('ordered').run(graph, undefined)!
    const { keys, passRuns } = figureData(graph, layout, { walks: layers })
    expect(keys.ownLengths).toEqual([own])
    const inks = walkRowInks(
      keys,
      { name: [walk.name], bp: [5000], contig: ['ctg'], contigStart: [0] },
      { row: [0, 0, 0], offset: [500, 2500, 4500] },
      { ...passRuns, key: passRuns.walk.map(w => keys.walk.indexOf(w)) },
    )
    expect(inks.color.some(color => passRuns.color.includes(color))).toBe(own)
  },
)
