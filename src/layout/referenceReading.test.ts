import { fmmmLayout } from '@jbrowse/graph-fmmm-layout'

import { isBackbone } from '../anchoredNodes'
import { deletionEdges } from '../deletionEdges'
import { figureSvg } from '../figure'
import { figureData } from '../figureData'
import { foldVariants } from '../foldVariants'
import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { gfaTables } from '../gfa/gfaTables'
import { graphFromTables } from '../gfa/graphTables'
import { writeRgfa } from '../gfa/writeRgfa'
import { layoutEngine } from '../layoutEngines'
import { engineSettingsOf, forceLayout, loadGraph } from '../pipeline'
import { coarsenTubeMap } from '../tubeMap/coarsen'
import { ownStrand, strandSides } from '../util/geometry'
import { readAlongReference } from './referenceReading'

import type { LayoutEngineKind } from '../layoutEngines'
import type { EngineRequest } from '../pipeline'
import type { Graph, NodeSegment } from '../types'

interface Case {
  segments: Record<string, number>
  links: string[]
  reference: string
  haplotype: string
}

const stepsOf = (walk: string) =>
  [...walk.matchAll(/[<>]([^<>]+)/g)].map(m => m[1]!)

function gfa(c: Case, tagged: boolean) {
  const starts = new Map<string, number>()
  let at = 0
  for (const step of stepsOf(c.reference)) {
    starts.set(step, starts.get(step) ?? at)
    at += c.segments[step]!
  }
  const bp = (walk: string) =>
    stepsOf(walk).reduce((sum, step) => sum + c.segments[step]!, 0)
  return [
    ...Object.entries(c.segments).map(
      ([name, length]) =>
        `S\t${name}\t*\tLN:i:${length}${tagged && starts.has(name) ? `\tSN:Z:ref#0#chr\tSO:i:${starts.get(name)}\tSR:i:0` : ''}`,
    ),
    ...c.links.map(link => `L\t${link.split(' ').join('\t')}\t0M`),
    `W\tref\t0\tchr\t0\t${bp(c.reference)}\t${c.reference}`,
    `W\thap\t1\tchr\t0\t${bp(c.haplotype)}\t${c.haplotype}`,
  ].join('\n')
}

const ONE_BACKWARDS: Case = {
  segments: { 1: 300, 2: 9000, 3: 300, x: 500 },
  links: ['1 + 2 -', '2 - 3 +', '1 + x +', 'x + 3 +'],
  reference: '>1<2>3',
  haplotype: '>1>x>3',
}

const RUN_BACKWARDS: Case = {
  segments: { 1: 800, 2: 700, 3: 1100, 4: 800, 5: 1000, 6: 900 },
  links: ['1 + 4 -', '4 - 3 -', '3 - 2 -', '2 - 5 +', '5 + 6 +', '4 - 2 -'],
  reference: '>1<4<3<2>5>6',
  haplotype: '>1<4<2>5>6',
}

const ALL_BACKWARDS: Case = {
  segments: { 1: 900, 2: 700, 3: 1100, 4: 800, 5: 1000 },
  links: ['1 + 2 +', '2 + 3 +', '3 + 4 +', '4 + 5 +', '2 + 4 +'],
  reference: '<5<4<3<2<1',
  haplotype: '<5<4<2<1',
}

const CASES = {
  'one segment backwards': ONE_BACKWARDS,
  'a run backwards': RUN_BACKWARDS,
  'every segment backwards': ALL_BACKWARDS,
}
const ANCHORINGS = { tags: true, paths: false }
const ENGINES: LayoutEngineKind[] = ['fmmm', 'stress']

const steppedOn = (c: Case, segment: string) =>
  c.reference.includes(`<${segment}`) ? '-' : '+'

const load = (c: Case, tagged: boolean) =>
  loadGraph(gfa(c, tagged), 'cut', { referencePath: 'ref#0#chr' })

const backboneOf = (graph: Graph) =>
  graph.nodes.filter(isBackbone).sort((a, b) => a.stable.start - b.stable.start)

const strandsOf = (graph: Graph) =>
  Object.fromEntries(graph.nodes.map(n => [n.name, n.stable?.strand]))

const middle = (line: NodeSegment[]) =>
  line.reduce((sum, p) => sum + p.x, 0) / line.length

const gap = (a: NodeSegment, b: NodeSegment) => Math.hypot(a.x - b.x, a.y - b.y)

const skips = (graph: Graph) =>
  deletionEdges(graph).map(d => ({
    bp: d.bp,
    bypassed: d.bypassed.map(id => id.slice(0, -1)),
  }))

async function drawn(graph: Graph, engine: LayoutEngineKind) {
  const { result } = await forceLayout(
    graph,
    engineSettingsOf({ engine }),
    layoutEngine,
    { width: 1000, height: 700 },
  )
  return result.nodePositions
}

test('a tagged segment states the strand the walk its SN names steps it on, read as text or as tables', () => {
  for (const [c, strands] of [
    [ONE_BACKWARDS, { 1: '+', 2: '-', 3: '+', x: undefined }],
    [RUN_BACKWARDS, { 1: '+', 2: '-', 3: '-', 4: '-', 5: '+', 6: '+' }],
    [ALL_BACKWARDS, { 1: '-', 2: '-', 3: '-', 4: '-', 5: '-' }],
  ] as const) {
    const text = gfa(c, true)
    const fromText = convertGFAToGraph(parseGFA(text), 'cut')
    expect(strandsOf(fromText)).toEqual(strands)
    expect(graphFromTables(gfaTables(text)!, 'cut')).toStrictEqual(fromText)
  }
})

test('a segment its walk passes twice states the strand of the pass at its SO', () => {
  const twice = (so: number) =>
    [
      'S\ta\t*\tLN:i:1000\tSN:Z:ref#0#chr\tSO:i:0\tSR:i:0',
      `S\tb\t*\tLN:i:500\tSN:Z:ref#0#chr\tSO:i:${so}\tSR:i:0`,
      'S\tc\t*\tLN:i:1000\tSN:Z:ref#0#chr\tSO:i:1500\tSR:i:0',
      'L\ta\t+\tb\t-\t0M',
      'L\tb\t-\tc\t+\t0M',
      'L\tc\t+\tb\t+\t0M',
      'W\tref\t0\tchr\t0\t3000\t>a<b>c>b',
    ].join('\n')
  for (const [so, strand] of [
    [1000, '-'],
    [2500, '+'],
    [1200, '-'],
  ] as const) {
    const fromText = convertGFAToGraph(parseGFA(twice(so)), 'cut')
    expect(strandsOf(fromText)).toEqual({ a: '+', b: strand, c: '+' })
    expect(graphFromTables(gfaTables(twice(so))!, 'cut')).toStrictEqual(
      fromText,
    )
  }
})

test('a tagged segment states the strand its own walk steps it on where another walk reaches it at the same offset on the other strand', () => {
  const shared = [
    'S\ta\t*\tLN:i:100\tSN:Z:ref#0#chr\tSO:i:0\tSR:i:0',
    'S\tb\t*\tLN:i:50\tSN:Z:ref#0#chr\tSO:i:100\tSR:i:0',
    'S\tx\t*\tLN:i:100',
    'L\ta\t+\tb\t+\t0M',
    'L\tx\t+\tb\t-\t0M',
    'W\thap\t1\tchr\t0\t150\t>x<b',
    'W\tref\t0\tchr\t0\t150\t>a>b',
  ].join('\n')
  const fromText = convertGFAToGraph(parseGFA(shared), 'cut')
  expect(strandsOf(fromText)).toEqual({ a: '+', b: '+', x: undefined })
  expect(graphFromTables(gfaTables(shared)!, 'cut')).toStrictEqual(fromText)
})

test('a tagged segment off the reference states the strand the walk its SN names steps it on', () => {
  const insertion = [
    'S\ta\t*\tLN:i:1000\tSN:Z:ref#0#chr\tSO:i:0\tSR:i:0',
    'S\tb\t*\tLN:i:1000\tSN:Z:ref#0#chr\tSO:i:1000\tSR:i:0',
    'S\ti\t*\tLN:i:400\tSN:Z:hap#1#chr\tSO:i:1000\tSR:i:1',
    'L\ta\t+\tb\t+\t0M',
    'L\ta\t+\ti\t-\t0M',
    'L\ti\t-\tb\t+\t0M',
    'W\tref\t0\tchr\t0\t2000\t>a>b',
    'W\thap\t1\tchr\t0\t2400\t>a<i>b',
  ].join('\n')
  const fromText = convertGFAToGraph(parseGFA(insertion), 'cut')
  expect(strandsOf(fromText)).toEqual({ a: '+', b: '+', i: '-' })
  expect(graphFromTables(gfaTables(insertion)!, 'cut')).toStrictEqual(fromText)
})

test('a tagged segment whose SN names no walk of the file states no strand', () => {
  const rgfa = [
    'S\ta\t*\tLN:i:1000\tSN:Z:chr\tSO:i:0\tSR:i:0',
    'S\tb\t*\tLN:i:1000\tSN:Z:chr\tSO:i:1000\tSR:i:0',
    'L\ta\t+\tb\t+\t0M',
    'W\thap\t1\tctg\t0\t2000\t<b<a',
  ].join('\n')
  const fromText = convertGFAToGraph(parseGFA(rgfa), 'cut')
  expect(strandsOf(fromText)).toEqual({ a: undefined, b: undefined })
  expect(graphFromTables(gfaTables(rgfa)!, 'cut')).toStrictEqual(fromText)
})

describe.each(Object.entries(CASES))('%s', (_case, c) => {
  test('tags and paths state the same reading of every reference segment', () => {
    const tagged = load(c, true)
    const walked = load(c, false)
    const reading = (graph: Graph) =>
      backboneOf(graph).map(n => [n.name, n.stable.start, n.stable.strand])
    expect(tagged.anchoredBy).toBe('tags')
    expect(walked.anchoredBy).toBe('paths')
    expect(reading(tagged)).toEqual(reading(walked))
  })

  test('tags find the links that skip reference that paths find', () => {
    expect(skips(load(c, true))).toEqual(skips(load(c, false)))
  })

  describe.each(Object.entries(ANCHORINGS))('anchored by %s', (_by, tagged) => {
    test.each(ENGINES)(
      '%s draws the reference left to right, each segment the way the reference steps it',
      async engine => {
        const graph = load(c, tagged)
        const positions = await drawn(graph, engine)
        const backbone = backboneOf(graph)
        const middles = backbone.map(n => middle(positions[n.id]!))
        for (let i = 1; i < middles.length; i++) {
          expect(middles[i]!).toBeGreaterThan(middles[i - 1]!)
        }
        for (const node of backbone) {
          const line = positions[node.id]!
          const alongItsId = ownStrand(node.id) === steppedOn(c, node.name)
          expect(line.at(-1)!.x > line[0]!.x).toBe(alongItsId)
        }
      },
    )

    test.each(ENGINES)(
      '%s joins each link to the ends its strands name',
      async engine => {
        const graph = load(c, tagged)
        const positions = await drawn(graph, engine)
        const skipping = new Set(deletionEdges(graph).map(d => d.edgeIndex))
        const joins = graph.edges
          .filter((_edge, ei) => !skipping.has(ei))
          .map(edge => {
            const sides = strandSides(edge)
            const from = positions[edge.from]!
            const to = positions[edge.to]!
            const [leaves, leavesNot] =
              sides.from === 'end'
                ? [from.at(-1)!, from[0]!]
                : [from[0]!, from.at(-1)!]
            const [enters, entersNot] =
              sides.to === 'start' ? [to[0]!, to.at(-1)!] : [to.at(-1)!, to[0]!]
            return {
              named: gap(leaves, enters),
              otherEndOfFrom: gap(leavesNot, enters),
              otherEndOfTo: gap(leaves, entersNot),
            }
          })
        expect(joins.length).toBeGreaterThan(0)
        for (const join of joins) {
          expect(join.named).toBeLessThan(join.otherEndOfFrom)
          expect(join.named).toBeLessThan(join.otherEndOfTo)
        }
      },
    )
  })
})

test('the link that skips reference a run steps backwards is found under tags', () => {
  expect(skips(load(RUN_BACKWARDS, true))).toEqual([
    { bp: 1100, bypassed: ['3'] },
  ])
  expect(skips(load(ALL_BACKWARDS, true))).toEqual([
    { bp: 1100, bypassed: ['3'] },
  ])
})

test.each(Object.entries(ANCHORINGS))(
  "the tube map's fold reads a walk along a reference stepped backwards as no inversion, anchored by %s",
  (_by, tagged) => {
    const coarse = coarsenTubeMap(load(ALL_BACKWARDS, tagged), 50)!
    expect([...coarse.cuts.values()]).not.toContain('inversion')
    expect(
      [...coarse.graph.pathVisits!].map(([segment, visits]) => [
        segment,
        ...visits.map(v => `${v.path}${v.strand}`),
      ]),
    ).toEqual([
      ['0-1800', 'ref#0#chr+', 'hap#1#chr+'],
      ['1800-2900', 'ref#0#chr+'],
      ['2900-4500', 'ref#0#chr+', 'hap#1#chr+'],
    ])
  },
)

test('a tagged graph with walks, its walks set aside, folds as the same graph anchored by its paths does', () => {
  const tagged = [
    'S\t1\t*\tLN:i:8000\tSN:Z:ref#0#chr\tSO:i:0\tSR:i:0',
    'S\t4\t*\tLN:i:8000\tSN:Z:ref#0#chr\tSO:i:8000\tSR:i:0',
    'S\t3\t*\tLN:i:11000\tSN:Z:ref#0#chr\tSO:i:16000\tSR:i:0',
    'S\t2\t*\tLN:i:7000\tSN:Z:ref#0#chr\tSO:i:27000\tSR:i:0',
    'S\t5\t*\tLN:i:10000\tSN:Z:ref#0#chr\tSO:i:34000\tSR:i:0',
    'S\t6\t*\tLN:i:9000\tSN:Z:ref#0#chr\tSO:i:44000\tSR:i:0',
    'S\ts\t*\tLN:i:40\tSN:Z:hap1#1#chr\tSO:i:16000\tSR:i:1',
    'L\t1\t+\t4\t-\t0M',
    'L\t4\t-\t3\t-\t0M',
    'L\t3\t-\t2\t-\t0M',
    'L\t2\t-\t5\t+\t0M',
    'L\t5\t+\t6\t+\t0M',
    'L\t4\t-\t2\t-\t0M',
    'L\t4\t-\ts\t+\t0M',
    'L\ts\t+\t3\t-\t0M',
    'W\tref\t0\tchr\t0\t53000\t>1<4<3<2>5>6',
    'W\thap0\t1\tchr\t0\t42000\t>1<4<2>5>6',
    'W\thap1\t1\tchr\t0\t53040\t>1<4>s<3<2>5>6',
  ].join('\n')
  const folded = (text: string) =>
    writeRgfa(
      foldVariants(
        {
          ...loadGraph(text, 'cut', { referencePath: 'ref#0#chr' }),
          paths: undefined,
        },
        5000,
      ),
    )
  expect(folded(tagged).split('\n')).toEqual([
    'H\tVN:Z:1.0',
    'S\t1\t*\tLN:i:16000\tSN:Z:ref#0#chr\tSO:i:0\tSR:i:0',
    'S\t3\t*\tLN:i:11000\tSN:Z:ref#0#chr\tSO:i:16000\tSR:i:0',
    'S\t2\t*\tLN:i:26000\tSN:Z:ref#0#chr\tSO:i:27000\tSR:i:0',
    'L\t1\t+\t3\t+\t0M',
    'L\t3\t+\t2\t+\t0M',
    'L\t1\t+\t2\t+\t0M',
    '',
  ])
  expect(
    folded(tagged.replaceAll(/\tS[NOR]:[Zi]:[^\t\n]*/g, '')).replaceAll(
      /\tSM:Z:[^\t\n]*/g,
      '',
    ),
  ).toBe(folded(tagged))
})

const FIRST_EXON = [
  {
    name: 'G',
    refName: 'ref#0#chr',
    start: 0,
    end: 100,
    strand: 1,
    exons: [{ start: 0, end: 100 }],
  },
]

async function backwardsByPaths() {
  const graph = load(ALL_BACKWARDS, false)
  const { result } = await forceLayout(
    graph,
    engineSettingsOf({ engine: 'stress' }),
    layoutEngine,
    { width: 1000, height: 700 },
  )
  return { graph, layout: result }
}

test("figureData places an exon at the end of its node the reference reads it from, on a path-anchored node drawn against the reference's reading", async () => {
  const { graph, layout } = await backwardsByPaths()
  const d = figureData(graph, layout, { genes: FIRST_EXON })
  const line = d.nodes.x.filter((_x, i) => d.nodes.node[i] === '5+')
  expect(new Set(d.exons.node)).toEqual(new Set(['5+']))
  for (const x of d.exons.x) {
    expect(Math.abs(x - line.at(-1)!)).toBeLessThan(Math.abs(x - line[0]!))
  }
})

test("figureSvg outlines an exon at the end of its node the reference reads it from, on a path-anchored node drawn against the reference's reading", async () => {
  const { graph, layout } = await backwardsByPaths()
  const svg = figureSvg(graph, layout, { width: 600, genes: FIRST_EXON })
  const xsOf = (within: string) =>
    [...within.matchAll(/<path d="([^"]+)"/g)].flatMap(path =>
      [...path[1]!.matchAll(/[ML](-?[\d.]+)[ ,]/g)].map(point => +point[1]!),
    )
  const exon = xsOf(
    svg.slice(svg.indexOf('<mask id="exons0"'), svg.indexOf('</mask>')),
  )
  const ink = xsOf(svg)
  const left = Math.min(...ink)
  expect(exon.length).toBeGreaterThan(0)
  expect(Math.max(...exon)).toBeLessThan(left + (Math.max(...ink) - left) / 10)
})

test('FMMM is handed a request as it is given and its lines come back as it laid them', async () => {
  const requests: EngineRequest[] = []
  await forceLayout(
    load(ALL_BACKWARDS, false),
    engineSettingsOf({ engine: 'fmmm' }),
    request => {
      requests.push(request)
      return layoutEngine(request)
    },
    { width: 1000, height: 700 },
  )
  const [request] = requests
  expect(readAlongReference(request!).request).not.toEqual(request)
  expect((await layoutEngine(request!)).result).toEqual(
    await fmmmLayout(request!),
  )
})

test('a backbone node whose id names no strand is handed to the stress engine as it is', () => {
  const request = {
    graph: {
      nodes: [
        {
          id: 'n',
          name: 'n',
          length: 100,
          depth: 1,
          stable: { refName: 'chr', start: 0, rank: 0, strand: '-' as const },
        },
      ],
      edges: [],
    },
    options: {},
  }
  expect(readAlongReference(request).request).toBe(request)
})

test('the stress engine is handed a backbone node the reference steps against its id as the reference reads it, and its line turned back', () => {
  const stable = { refName: 'chr', start: 0, rank: 0 }
  const node = { name: 'n', length: 100, depth: 1 }
  const request = {
    graph: {
      nodes: [
        { ...node, id: 'a+', stable: { ...stable, strand: '-' as const } },
        { ...node, id: 'b+', stable: { ...stable, strand: '+' as const } },
        { ...node, id: 'c-', stable: { ...stable, strand: '-' as const } },
        { ...node, id: 'd-', stable },
        {
          ...node,
          id: 'x+',
          stable: { ...stable, rank: 1, strand: '-' as const },
        },
      ],
      edges: [
        { from: 'a+', to: 'b+' },
        { from: 'b+', to: 'c-' },
        { from: 'c-', to: 'd-', fromStrand: '-' as const },
      ],
    },
    options: {},
  }
  const read = readAlongReference(request)
  expect(read.request.graph.nodes.map(n => n.id)).toEqual([
    'a-',
    'b+',
    'c-',
    'd+',
    'x+',
  ])
  expect(read.request.graph.edges).toEqual([
    { from: 'a-', to: 'b+', fromStrand: '+', toStrand: '+' },
    { from: 'b+', to: 'c-' },
    { from: 'c-', to: 'd+', fromStrand: '-', toStrand: '-' },
  ])
  const line = [
    { x: 0, y: 0 },
    { x: 5, y: 1 },
  ]
  expect(read.turnedBack({ 'a-': line, 'b+': line, 'd+': line })).toEqual({
    'a+': line.toReversed(),
    'b+': line,
    'd-': line.toReversed(),
  })
  const along = { ...request, graph: { ...request.graph, nodes: [] } }
  expect(readAlongReference(along).request).toBe(along)
})
