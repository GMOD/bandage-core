import { isBackbone } from '../anchoredNodes'
import { deletionEdges } from '../deletionEdges'
import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { gfaTables } from '../gfa/gfaTables'
import { graphFromTables } from '../gfa/graphTables'
import { layoutEngine } from '../layoutEngines'
import { engineSettingsOf, forceLayout, loadGraph } from '../pipeline'
import { ownStrand, strandSides } from '../util/geometry'

import type { LayoutEngineKind } from '../layoutEngines'
import type { Graph, NodeSegment } from '../types'

interface Case {
  segments: Record<string, number>
  links: string[]
  reference: string
  haplotype: string
}

const stepsOf = (walk: string) =>
  [...walk.matchAll(/[<>]([^<>]+)/g)].map(m => m[1]!)

// The case as GFA: `tagged` states each reference segment's place as a walk
// file cut does, SN/SO/SR:0 at the offset the reference walk reaches it
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

// the reference steps the long segment 2 backwards between two short ones
const ONE_BACKWARDS: Case = {
  segments: { 1: 300, 2: 9000, 3: 300, x: 500 },
  links: ['1 + 2 -', '2 - 3 +', '1 + x +', 'x + 3 +'],
  reference: '>1<2>3',
  haplotype: '>1>x>3',
}

// the reference steps 4, 3 and 2 backwards, and the haplotype's link from 4
// to 2 skips 3
const RUN_BACKWARDS: Case = {
  segments: { 1: 800, 2: 700, 3: 1100, 4: 800, 5: 1000, 6: 900 },
  links: ['1 + 4 -', '4 - 3 -', '3 - 2 -', '2 - 5 +', '5 + 6 +', '4 - 2 -'],
  reference: '>1<4<3<2>5>6',
  haplotype: '>1<4<2>5>6',
}

// every link reads its segments forwards and the reference steps them all
// backwards, as pggb's can; the haplotype's link from 4 to 2 skips 3
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
const ANCHORINGS = { tags: true }
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
