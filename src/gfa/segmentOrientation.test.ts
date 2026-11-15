import { loadFmmm } from '@jbrowse/graph-fmmm-layout'
import { stressLayout } from '@jbrowse/graph-stress-layout'

import { parseGFA } from '../gfa-core/index'
import { layoutModeByValue } from '../layoutModes'
import { forceLayout, loadGraph } from '../pipeline'
import { buildGeometry } from '../renderer/GeometryBuilder'
import { convertGFAToGraph } from './gfaConverter'
import { gfaTables } from './gfaTables'
import { graphFromTables } from './graphTables'

import type { EngineRequest } from '../pipeline'

// chr runs r1..r4. x is an insertion between r1 and r2 that the file first
// names from r2's side, spelled backwards; v is an allele read reversed in
// place of r3, which all its links say; d dangles off r4 past the window, and
// p and q are a piece no backbone reaches. s only a walk names. r1 to r3
// skips r2, a deletion, spelled from r3.
const LINES = [
  'S\tr1\t*\tLN:i:3000\tSN:Z:ref#chr\tSO:i:0\tSR:i:0',
  'S\tr2\t*\tLN:i:2000\tSN:Z:ref#chr\tSO:i:3000\tSR:i:0',
  'S\tr3\t*\tLN:i:2000\tSN:Z:ref#chr\tSO:i:5000\tSR:i:0',
  'S\tr4\t*\tLN:i:3000\tSN:Z:ref#chr\tSO:i:7000\tSR:i:0',
  'S\tx\t*\tLN:i:800\tSN:Z:a#chr\tSO:i:0\tSR:i:1',
  'S\tv\t*\tLN:i:1500\tSN:Z:a#chr\tSO:i:800\tSR:i:1',
  'S\td\t*\tLN:i:400\tSN:Z:b#chr\tSO:i:0\tSR:i:2',
  'S\tp\t*\tLN:i:500\tSN:Z:c#chr\tSO:i:0\tSR:i:3',
  'S\tq\t*\tLN:i:500\tSN:Z:c#chr\tSO:i:500\tSR:i:3',
  'S\ts\t*\tLN:i:50\tSN:Z:c#chr\tSO:i:1000\tSR:i:3',
  'L\tr2\t-\tx\t-\t0M',
  'L\tx\t-\tr1\t-\t0M',
  'L\tr1\t+\tr2\t+\t0M',
  'L\tr2\t+\tr3\t+\t0M',
  'L\tr3\t+\tr4\t+\t0M',
  'L\tr2\t+\tv\t-\t0M',
  'L\tr4\t-\tv\t+\t0M',
  'L\tr4\t+\td\t-\t0M',
  'L\tq\t-\tp\t-\t0M',
  'L\tr3\t-\tr1\t-\t0M',
]

const flip = { '+': '-', '-': '+' } as const

function respell(line: string) {
  const [, a, sa, b, sb, cigar] = line.split('\t') as [
    string,
    string,
    '+' | '-',
    string,
    '+' | '-',
    string,
  ]
  return ['L', b, flip[sb], a, flip[sa], cigar].join('\t')
}

// every other link respelled, and the L lines in a different order
const respelled = (lines: string[]) =>
  lines.map((l, i) => (l.startsWith('L') && i % 2 ? respell(l) : l))
const shuffled = (lines: string[]) => [
  ...lines.filter(l => l.startsWith('S')),
  ...lines.filter(l => l.startsWith('L')).reverse(),
]

const variants = [
  LINES,
  shuffled(LINES),
  respelled(LINES),
  respelled(shuffled(LINES)),
  LINES.map(l => (l.startsWith('L') ? respell(l) : l)),
]
const text = (lines: string[]) =>
  `${lines.join('\n')}\nW\tc\t0\tchr\t0\t50\t<s\n`

// each link as the segments it joins and the strands it reads them on
const linkSet = (graph: ReturnType<typeof convertGFAToGraph>) =>
  graph.edges
    .map(
      e =>
        `${e.from.slice(0, -1)}${e.fromStrand}>${e.to.slice(0, -1)}${e.toStrand}`,
    )
    .sort()

test('each segment is drawn as the walk along the reference reads it', () => {
  const graph = convertGFAToGraph(parseGFA(text(LINES)))
  expect(graph.nodes.map(n => n.id)).toEqual([
    'r1+',
    'r2+',
    'r3+',
    'r4+',
    'x+',
    'v-',
    'd-',
    'p+',
    'q+',
    's-',
  ])
  // each link stated as it reads the ends it joins
  expect(linkSet(graph)).toEqual([
    'p+>q+',
    'r1+>r2+',
    'r1+>r3+',
    'r1+>x+',
    'r2+>r3+',
    'r2+>v-',
    'r3+>r4+',
    'r4+>d-',
    'v->r4+',
    'x+>r2+',
  ])
})

test('an allele its neighbours read both ways is drawn forward', () => {
  const both = [...LINES, 'L\tr2\t+\tv\t+\t0M', 'L\tv\t+\tr4\t+\t0M']
  const graph = convertGFAToGraph(parseGFA(text(both)))
  expect(graph.nodes.find(n => n.name === 'v')!.id).toBe('v+')
})

test('the order and spelling of the L lines change no node and no link', () => {
  const [first, ...rest] = variants.map(lines =>
    convertGFAToGraph(parseGFA(text(lines))),
  )
  for (const graph of rest) {
    expect(graph.nodes.map(n => n.id)).toEqual(first!.nodes.map(n => n.id))
    expect(linkSet(graph)).toEqual(linkSet(first!))
  }
})

test('the tables orient and spell as the text does', () => {
  for (const lines of variants) {
    const tables = gfaTables(text(lines))!
    expect(graphFromTables(tables, 'cut')).toStrictEqual(
      convertGFAToGraph(parseGFA(text(lines)), 'cut'),
    )
  }
})

const stress = (request: EngineRequest) =>
  Promise.resolve({ result: stressLayout(request), duration: 0 })
const fmmm = async (request: EngineRequest) => {
  const bandage = await loadFmmm()
  return {
    result: bandage.computeLayout(request.graph, request.options),
    duration: 0,
  }
}
const settings = {
  quality: 1,
  linearLayout: false,
  bubbleSpread: 'auto' as const,
}

test('the order and spelling of the L lines change no layout', async () => {
  const graphs = variants.map(lines => loadGraph(text(lines), 'cut'))
  const layouts = await Promise.all(
    graphs.map(async graph => ({
      anchored: layoutModeByValue('auto').run(graph, undefined)!.nodePositions,
      stress: (
        await forceLayout(graph, { ...settings, engine: 'stress' }, stress)
      ).result.nodePositions,
      fmmm: (await forceLayout(graph, settings, fmmm)).result.nodePositions,
    })),
  )
  const [first, ...rest] = layouts
  for (const layout of rest) {
    expect(layout).toEqual(first)
  }
})

// pggb's reference can read a window's segments backwards: GRCh38 steps c, b
// then a, each reversed, where the L lines read a, b, c forward; x is an
// allele in b's place
const BACKWARDS = [
  'S\ta\t*\tLN:i:1000\tSN:Z:GRCh38#0#chrY\tSO:i:2000\tSR:i:0',
  'S\tb\t*\tLN:i:1000\tSN:Z:GRCh38#0#chrY\tSO:i:1000\tSR:i:0',
  'S\tc\t*\tLN:i:1000\tSN:Z:GRCh38#0#chrY\tSO:i:0\tSR:i:0',
  'S\tx\t*\tLN:i:800',
  'L\ta\t+\tb\t+\t0M',
  'L\tb\t+\tc\t+\t0M',
  'L\ta\t+\tx\t+\t0M',
  'L\tx\t+\tc\t+\t0M',
  'W\tGRCh38\t0\tchrY\t0\t3000\t<c<b<a',
  'W\tHG1\t1\tctg\t0\t2800\t<c<x<a',
].join('\n')

test('a backbone segment the reference steps backwards is drawn backwards', () => {
  const graph = convertGFAToGraph(parseGFA(BACKWARDS))
  expect(graph.nodes.map(n => n.id)).toEqual(['a-', 'b-', 'c-', 'x-'])
  expect(linkSet(graph)).toEqual(['b->a-', 'c->b-', 'c->x-', 'x->a-'])
  expect(graphFromTables(gfaTables(BACKWARDS)!, 'cut')).toStrictEqual(
    convertGFAToGraph(parseGFA(BACKWARDS), 'cut'),
  )
})

test("its links' arrowheads point the way the reference reads", () => {
  const graph = convertGFAToGraph(parseGFA(BACKWARDS))
  const along = (start: number) => [
    { x: start / 10, y: 0 },
    { x: start / 10 + 80, y: 0 },
  ]
  const nodePositions = Object.fromEntries(
    graph.nodes.map(n => [n.id, along(n.stable?.start ?? 1000)]),
  )
  const { arrows } = buildGeometry({
    nodePositions: {
      ...nodePositions,
      [graph.nodes.find(n => n.name === 'x')!.id]: [
        { x: 100, y: 50 },
        { x: 180, y: 50 },
      ],
    },
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    axis: { scaleX: 4, scaleY: 4 },
    stranded: true,
  })
  expect(arrows).toHaveLength(4)
  for (const head of arrows) {
    expect(Math.cos(head.angle)).toBeGreaterThan(0)
  }
})
