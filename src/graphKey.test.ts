import { COMPRESSED_KEY } from './bubbleSpreads'
import { SHORT_SKIP_KEY } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { NOT_LOADED_TEXT } from './gfa/departures'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { drawnSkips, graphKey } from './graphKey'
import { layoutModeByValue } from './layoutModes'
import { anchorGraph } from './pathAnchoring'
import { graphBackbone } from './reference'
import { computeReferenceRamp } from './renderer/GeometryBuilder'
import { walkLift } from './walkHighlight'

import type { GraphKeyOptions } from './graphKey'
import type { Graph } from './types'

const GFA = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\tTTTTTT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
W\tGRCh38\t0\tchr6\t0\t9\t>v1>v2>v3
W\talt\t1\tchr6\t0\t13\t>v1>a1>v3`

const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'GRCh38')
const layout = layoutModeByValue('ordered').run(graph, undefined)!
const NO_SKIPS = { dashed: false, short: false }
const REF = 'GRCh38#0#chr6'
const ALT = 'alt#1#chr6'

const keyOf = (g: Graph, o: Partial<GraphKeyOptions> = {}) =>
  graphKey(g, layout, { skips: NO_SKIPS, ...o })
const entries = (g: Graph, o: Partial<GraphKeyOptions> = {}) =>
  keyOf(g, o).flatMap(section => section.entries)
const texts = (g: Graph, o: Partial<GraphKeyOptions> = {}) =>
  entries(g, o).map(entry => entry.text)
const ids = (g: Graph, o: Partial<GraphKeyOptions> = {}) =>
  keyOf(g, o).map(section => section.id)

const withNodes = (g: Graph, change: (name: string) => object) => ({
  ...g,
  nodes: g.nodes.map(n => ({ ...n, ...change(n.name) })),
})

test("the ramp names the reference and its span, the region's contig after the backbone's sample", () => {
  const referenceRamp = computeReferenceRamp(graph, { start: 0, end: 9 })
  const [ramp] = entries(graph, {
    referenceRamp,
    region: { refName: 'chr6' },
  })
  expect(ramp!.text).toBe(
    `position on ${graphBackbone(graph)!.prefixes[0]} chr6`,
  )
  expect(ramp!.under).toBe('1-9 (9 bp)')
  expect(ramp!.swatch?.kind).toBe('scale')
  expect(
    entries(graph, { referenceRamp, referenceName: 'hg38 chr6' })[0]!.text,
  ).toBe('position on hg38 chr6')
})

test('the off-reference chip is there only where a loaded node is off the reference', () => {
  const referenceRamp = computeReferenceRamp(graph, { start: 0, end: 9 })
  expect(texts(graph, { referenceRamp })).toContainEqual(
    expect.stringMatching(/^off /),
  )
  const hollow = withNodes(graph, id =>
    id === 'a1' ? { placeholder: true } : {},
  )
  expect(texts(hollow, { referenceRamp })).not.toContainEqual(
    expect.stringMatching(/^off /),
  )
})

test('no ramp is keyed while walks are lifted, each lifted walk is', () => {
  const referenceRamp = computeReferenceRamp(graph, { start: 0, end: 9 })
  const lift = walkLift(graph, [{ walk: ALT }])
  const key = entries(graph, { referenceRamp, lift })
  expect(key.map(e => e.key)).not.toContain('ramp')
  expect(key[0]!.strong).toBe(ALT)
})

test('the faded entry names other haplotypes only where every faded node is on a walk left out', () => {
  const faded = (walks: string[]) =>
    entries(graph, {
      lift: walkLift(
        graph,
        walks.map(walk => ({ walk })),
      ),
    }).find(e => e.key === 'faded')?.text
  expect(faded([REF])).toBe('only in other haplotypes')
  expect(faded([REF, ALT])).toBeUndefined()
  const loose = anchorGraph(
    convertGFAToGraph(parseGFA(`${GFA}\nS\tx1\tA\nL\tv3\t+\tx1\t+\t0M`)),
    'GRCh38',
  )
  const looseFaded = (walks: string[]) =>
    entries(loose, {
      lift: walkLift(
        loose,
        walks.map(walk => ({ walk })),
      ),
    }).find(e => e.key === 'faded')?.text
  expect(looseFaded([REF])).toBe(`nodes and links not on ${REF}`)
  expect(looseFaded([REF, ALT])).toBe('nodes and links not on these walks')
})

test('with every walk lifted, only links no walk takes are faded', () => {
  const linked = anchorGraph(
    convertGFAToGraph(parseGFA(`${GFA}\nL\tv2\t+\ta1\t+\t0M`)),
    'GRCh38',
  )
  const key = entries(linked, {
    lift: walkLift(linked, [{ walk: REF }, { walk: ALT }]),
  })
  expect(key.find(e => e.key === 'faded')?.text).toBe(
    'links not on these walks',
  )
})

test('a lift fading only links names other haplotypes where a walk left out takes each', () => {
  const skipping = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          'S\t1\tACGT',
          'S\t2\tGGCCGGCC',
          'S\t3\tTTTT',
          'L\t1\t+\t2\t+\t0M',
          'L\t2\t+\t3\t+\t0M',
          'L\t1\t+\t3\t+\t0M',
          'W\tGRCh38\t0\tchr1\t0\t8\t>1>3',
          'W\tB\t1\tctg\t0\t16\t>1>2>3',
        ].join('\n'),
      ),
    ),
    'GRCh38',
  )
  const faded = (walks: string[]) =>
    entries(skipping, {
      lift: walkLift(
        skipping,
        walks.map(walk => ({ walk })),
      ),
    }).find(e => e.key === 'faded')?.text
  expect(faded(['B#1#ctg'])).toBe('only in other haplotypes')
  expect(faded(['B#1#ctg', 'GRCh38#0#chr1'])).toBeUndefined()
})

test('each skip row is there only where the drawing holds that mark', () => {
  const skips = (dashed: boolean, short: boolean) =>
    keyOf(graph, { skips: { dashed, short } })
      .filter(section => section.id === 'skips')
      .flatMap(section => section.entries.map(entry => entry.text))
  expect(skips(false, false)).not.toContainEqual(
    expect.stringMatching(/^skips /),
  )
  expect(skips(false, false)).not.toContain(SHORT_SKIP_KEY)
  expect(skips(true, false)).toContain('skips GRCh38 chr6 sequence')
  expect(skips(true, false)).not.toContain(SHORT_SKIP_KEY)
  expect(skips(false, true)).toEqual([SHORT_SKIP_KEY])
})

test('drawn skips read dashed and short strokes off the batch, leaving lanes to their walks', () => {
  const curve = (o: object) => ({ curves: [], thickness: 1, color: 0, ...o })
  expect(
    drawnSkips([
      {
        edgeCurves: [curve({ skip: true, span: 200 }), curve({ span: 5 })],
      },
    ]),
  ).toEqual({ dashed: true, short: false })
  expect(
    drawnSkips([{ edgeCurves: [curve({ skip: true, span: 5 })] }]),
  ).toEqual({ dashed: false, short: true })
  expect(
    drawnSkips([
      { edgeCurves: [curve({ skip: true, span: 200, walk: 0 })] },
      { edgeCurves: [curve({ skip: true, span: 0 })] },
    ]),
  ).toEqual({ dashed: false, short: false })
})

test('nodes not shown are keyed only where a hollow one is drawn', () => {
  const hollow = withNodes(graph, id =>
    id === 'a1' ? { placeholder: true } : {},
  )
  expect(texts(graph)).not.toContain(NOT_LOADED_TEXT)
  expect(texts(hollow)).toContain(NOT_LOADED_TEXT)
  expect(
    texts(hollow, { lift: walkLift(hollow, [{ walk: REF }]) }),
  ).not.toContain(NOT_LOADED_TEXT)
  expect(texts(hollow, { drawsNodes: false })).not.toContain(NOT_LOADED_TEXT)
})

test('the outline is keyed as exons, or as genes where every gene is one exon', () => {
  const pin = (exons: { start: number; end: number }[]) => ({
    gene: { name: 'G', refName: 'chr6', start: 0, end: 9, strand: 1, exons },
    exons: 'M0,0',
    exonsByNode: [{ nodeId: 'v1', d: 'M0,0', stretches: [] }],
    nodeIds: new Set(['v1']),
    at: { x: 0, y: 0 },
    covered: 1,
  })
  expect(texts(graph, { genePins: [] })).not.toContain('exon')
  expect(texts(graph, { genePins: [pin([{ start: 1, end: 3 }])] })).toContain(
    'exon',
  )
  expect(
    texts(graph, {
      genePins: [pin([{ start: 0, end: 9 }])],
      genesFrom: 'genes.gff3',
    }),
  ).toContain('gene, from genes.gff3')
})

test("the thickness keys give the scale's two ends, links only where they widen by walks", () => {
  const thick = keyOf(graph).find(s => s.id === 'node-width')!
  expect(thick.group).toBe('Node thickness')
  expect(thick.entries.map(e => e.text)).toEqual(['2 walks', '1 walk'])
  expect(ids(graph, { nodeWidth: 'uniform' })).not.toContain('node-width')
  const even = withNodes(graph, () => ({ depth: 1 }))
  expect(ids(even)).not.toContain('node-width')
  expect(ids(graph)).not.toContain('link-width')
  expect(
    keyOf(graph, { edgeWidth: 'walks' })
      .find(s => s.id === 'link-width')!
      .entries.map(e => e.text),
  ).toEqual(['1 walk'])
})

test('the halo, the strip tab and compress are keyed where they are drawn', () => {
  expect(ids(graph, { halos: [{ whole: true }] })).not.toContain('halo')
  expect(ids(graph, { halos: [{ whole: false }] })).toContain('halo')
  expect(ids(graph)).not.toContain('overhang')
  expect(texts(graph, { stripOverhangs: true })).toContain(
    'graph runs past this edge',
  )
  expect(
    graphKey(graph, { ...layout, compressed: true }, { skips: NO_SKIPS })
      .at(-1)!
      .entries.map(e => e.text),
  ).toEqual([COMPRESSED_KEY])
})

test('a lift through a repeat keys a thread per pass', () => {
  const dup = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          'S\tv1\tAAAA',
          'S\tv2\tCC',
          'S\tv3\tGGG',
          'L\tv1\t+\tv2\t+\t0M',
          'L\tv2\t+\tv3\t+\t0M',
          'L\tv2\t+\tv1\t+\t0M',
          'W\tref\t0\tchr\t0\t9\t>v1>v2>v3',
          'W\tdup\t1\tchr\t0\t15\t>v1>v2>v1>v2>v3',
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const key = entries(dup, {
    lift: walkLift(dup, [{ walk: 'ref#0#chr' }, { walk: 'dup#1#chr' }]),
  })
  expect(key.find(e => e.key === 'walk-passes')?.swatch?.kind).toBe('threads')
})
