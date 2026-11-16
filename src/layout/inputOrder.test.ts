import { readFileSync } from 'node:fs'

import { spreadFor } from '../bubbleSpreads'
import { LAYOUT_ENGINE_VALUES, layoutEngine } from '../layoutEngines'
import { engineRequest, forceLayout, loadGraph } from '../pipeline'
import { layoutScaling } from './drawnScale'

import type { BubbleSpread } from '../bubbleSpreads'
import type { LayoutEngineKind } from '../layoutEngines'
import type { EngineRequest, EngineSettings } from '../pipeline'

// chr runs r1..r4. x is an insertion between r1 and r2, v an allele read
// reversed in place of r3, d dangles off r4, p and q are a piece no backbone
// reaches, s only a walk names, and r1 to r3 is a deletion
const ANCHORED = [
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
  'W\tc\t0\tchr\t0\t50\t<s',
].join('\n')

const RGFA = readFileSync('test_data/ecoli_rgfa_slice.gfa', 'utf8')

const graphs = {
  anchored: ANCHORED,
  rgfa: RGFA,
  unanchored: RGFA.replaceAll(/\tS[NOR]:[Zi]:[^\t\n]*/g, ''),
}

const fromBothEnds = (lines: string[]) =>
  lines.map((_, i) =>
    i % 2 ? lines[lines.length - 1 - (i >> 1)]! : lines[i >> 1]!,
  )

const orders = {
  reversed: (lines: string[]) => lines.toReversed(),
  shuffled: fromBothEnds,
}

function reordered(
  text: string,
  record: 'S' | 'L',
  order: (lines: string[]) => string[],
) {
  const lines = text.split('\n')
  const of = (l: string) => l.startsWith(`${record}\t`)
  return [...order(lines.filter(of)), ...lines.filter(l => !of(l))].join('\n')
}

async function laidOut(
  text: string,
  engine: LayoutEngineKind,
  bubbleSpread: BubbleSpread,
) {
  const graph = loadGraph(text, 'cut')
  const requests: EngineRequest[] = []
  const { result } = await forceLayout(
    graph,
    { quality: 1, linearLayout: false, bubbleSpread, engine },
    request => {
      requests.push(request)
      return layoutEngine(request)
    },
  )
  const linkOf = (edgeIndex: string) => {
    const { from, to, fromStrand, toStrand } = graph.edges[+edgeIndex]!
    return `${from}${fromStrand ?? ''}>${to}${toStrand ?? ''}`
  }
  return {
    request: requests[0],
    result: {
      ...result,
      deletionRoutes: new Map(
        Object.entries(result.deletionRoutes ?? {}).map(([i, route]) => [
          linkOf(i),
          route,
        ]),
      ),
    },
  }
}

const spreads: BubbleSpread[] = ['auto', 'compress']

const cases = Object.entries(graphs).flatMap(([graph, text]) =>
  LAYOUT_ENGINE_VALUES.flatMap(engine =>
    spreads.map(spread => ({ graph, text, engine, spread })),
  ),
)

async function eachOrder(
  record: 'S' | 'L',
  { text, engine, spread }: (typeof cases)[number],
) {
  const given = await laidOut(text, engine, spread)
  return Promise.all(
    Object.values(orders).map(async order => ({
      given,
      other: await laidOut(reordered(text, record, order), engine, spread),
    })),
  )
}

describe.each(['S', 'L'] as const)('the order of the %s lines', record => {
  test.each(cases)(
    'changes no request to the engine: $graph, $engine, $spread',
    async c => {
      for (const { given, other } of await eachOrder(record, c)) {
        expect(other.request).toEqual(given.request)
      }
    },
  )

  test.each(cases)('changes no layout: $graph, $engine, $spread', async c => {
    for (const { given, other } of await eachOrder(record, c)) {
      expect(other.result).toEqual(given.result)
    }
  })
})

// r2 and r3 joined end to start, end to end and start to start
const TWIST = [
  'S\tr1\t*\tLN:i:1000\tSN:Z:ref#chr\tSO:i:0\tSR:i:0',
  'S\tr2\t*\tLN:i:1500\tSN:Z:ref#chr\tSO:i:1000\tSR:i:0',
  'S\tr3\t*\tLN:i:1200\tSN:Z:ref#chr\tSO:i:2500\tSR:i:0',
  'S\tr4\t*\tLN:i:1000\tSN:Z:ref#chr\tSO:i:3700\tSR:i:0',
  'L\tr1\t+\tr2\t+\t0M',
  'L\tr2\t+\tr3\t+\t0M',
  'L\tr3\t+\tr4\t+\t0M',
  'L\tr2\t+\tr3\t-\t0M',
  'L\tr2\t-\tr3\t+\t0M',
].join('\n')

test('two links between one pair of nodes that differ only in which ends they join go to the engine in one order', async () => {
  const given = await laidOut(TWIST, 'fmmm', 'auto')
  const other = await laidOut(
    reordered(TWIST, 'L', orders.reversed),
    'fmmm',
    'auto',
  )
  expect(other.request).toEqual(given.request)
})

// rank 0 on two stable sequences, each from offset 0: two backbone nodes tie
// on their start
const TWO_REFS = [
  'S\tr1\t*\tLN:i:1000\tSN:Z:chrA\tSO:i:0\tSR:i:0',
  'S\tr2\t*\tLN:i:1000\tSN:Z:chrA\tSO:i:1000\tSR:i:0',
  'S\tq1\t*\tLN:i:1500\tSN:Z:chrB\tSO:i:0\tSR:i:0',
  'S\tq2\t*\tLN:i:700\tSN:Z:chrB\tSO:i:1500\tSR:i:0',
  'S\tx\t*\tLN:i:300\tSN:Z:alt\tSO:i:0\tSR:i:1',
  'L\tr1\t+\tr2\t+\t0M',
  'L\tq1\t+\tq2\t+\t0M',
  'L\tr1\t+\tx\t+\t0M',
  'L\tx\t+\tr2\t+\t0M',
  'L\tr2\t+\tq1\t+\t0M',
].join('\n')

test('backbone nodes that tie on their start are seeded the same whatever order the S lines came in', async () => {
  const given = await laidOut(TWO_REFS, 'fmmm', 'auto')
  const other = await laidOut(
    reordered(TWO_REFS, 'S', orders.reversed),
    'fmmm',
    'auto',
  )
  expect(other.request).toEqual(given.request)
})

test('engineRequest, asked directly, hands the engine one request whatever order the graph lists its nodes', () => {
  const settings: EngineSettings = {
    quality: 1,
    linearLayout: false,
    bubbleSpread: 'auto',
  }
  const requestFor = (text: string) => {
    const graph = loadGraph(text, 'cut')
    return engineRequest(
      graph,
      layoutScaling(graph, spreadFor('auto')),
      settings,
    )
  }
  expect(requestFor(reordered(TWO_REFS, 'S', orders.reversed))).toEqual(
    requestFor(TWO_REFS),
  )
})
