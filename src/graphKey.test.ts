import { COMPRESSED_KEY } from './bubbleSpreads'
import { SHORT_SKIP_KEY, deletionDrawing, deletionEdges } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { NOT_LOADED_TEXT } from './gfa/departures'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { drawnMarks, graphKey } from './graphKey'
import { layoutModeByValue } from './layoutModes'
import { anchorGraph } from './pathAnchoring'
import { drawingBounds, fitTransform } from './pipeline'
import { graphBackbone } from './reference'
import {
  REFERENCE_RAMP_ALT_COLOR,
  buildGeometry,
  computeReferenceRamp,
} from './renderer/GeometryBuilder'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { axisScaleOf } from './viewport'
import { walkLift } from './walkHighlight'

import type { GraphKeyOptions, GraphKeySection } from './graphKey'
import type { ReferenceRamp } from './renderer/GeometryBuilder'
import type { RenderBatch } from './renderer/types'
import type { Graph, LayoutResult } from './types'
import type { WalkLift } from './walkHighlight'

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

const REF = 'GRCh38#0#chr6'
const ALT = 'alt#1#chr6'

const load = (text: string, reference: string) =>
  anchorGraph(convertGFAToGraph(parseGFA(text)), reference)

const graph = load(GFA, 'GRCh38')

const withNodes = (g: Graph, change: (name: string) => object) => ({
  ...g,
  nodes: g.nodes.map(n => ({ ...n, ...change(n.name) })),
})

interface Scene {
  layout?: LayoutResult
  lift?: WalkLift
  referenceRamp?: ReferenceRamp
  width?: number
}

// The drawing a host would paint at a `width` px fit: the batch the key's
// marks are read off
function drawn(g: Graph, s: Scene = {}) {
  const layout = s.layout ?? layoutModeByValue('ordered').run(g, undefined)!
  const pixelRows = layout.pixelRows ?? false
  const fit = fitTransform(
    drawingBounds(layout, {}),
    s.width ?? 600,
    300,
    pixelRows,
  )!
  const batch = buildGeometry({
    ...layoutGeometryInputs(layout, deletionDrawing(g, deletionEdges(g), true)),
    graph: g,
    nodeById: new Map(g.nodes.map(n => [n.id, n])),
    colorScheme: s.referenceRamp ? 'reference-position' : 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'depth',
    highlight: s.lift,
    axis: axisScaleOf(fit.scale, pixelRows),
    referenceRamp: s.referenceRamp,
  })
  return { layout, batch }
}

function keyOf(g: Graph, s: Scene = {}, o: Partial<GraphKeyOptions> = {}) {
  const { layout, batch } = drawn(g, s)
  return graphKey(g, layout, {
    lift: s.lift,
    referenceRamp: s.referenceRamp,
    marks: drawnMarks([batch]),
    ...o,
  })
}
const entries = (g: Graph, s?: Scene, o?: Partial<GraphKeyOptions>) =>
  keyOf(g, s, o).flatMap(section => section.entries)
const texts = (g: Graph, s?: Scene, o?: Partial<GraphKeyOptions>) =>
  entries(g, s, o).map(entry => entry.text)
const keys = (g: Graph, s?: Scene, o?: Partial<GraphKeyOptions>) =>
  entries(g, s, o).map(entry => entry.key)
const lifting = (g: Graph, walks: string[]) =>
  walkLift(
    g,
    walks.map(walk => ({ walk })),
  )

test("the ramp names the reference and its span, the region's contig after the backbone's sample", () => {
  const referenceRamp = computeReferenceRamp(graph, { start: 0, end: 9 })
  const [ramp] = entries(
    graph,
    { referenceRamp },
    { region: { refName: 'chr6' } },
  )
  expect(ramp!.text).toBe(
    `position on ${graphBackbone(graph)!.prefixes[0]} chr6`,
  )
  expect(ramp!.under).toBe('1-9 (9 bp)')
  expect(ramp!.swatch?.kind).toBe('scale')
  expect(
    entries(graph, { referenceRamp }, { referenceName: 'hg38 chr6' })[0]!.text,
  ).toBe('position on hg38 chr6')
})

test('the off-reference chip is there only where a node is drawn in the charcoal', () => {
  const referenceRamp = computeReferenceRamp(graph, { start: 0, end: 9 })
  expect(keys(graph, { referenceRamp })).toContain('off')
  const hollow = withNodes(graph, name =>
    name === 'a1' ? { placeholder: true } : {},
  )
  expect(keys(hollow, { referenceRamp })).not.toContain('off')
})

test('no ramp is keyed while walks are lifted, each lifted walk is', () => {
  const referenceRamp = computeReferenceRamp(graph, { start: 0, end: 9 })
  const key = entries(graph, { referenceRamp, lift: lifting(graph, [ALT]) })
  expect(key.map(e => e.key)).not.toContain('ramp')
  expect(key[0]!.strong).toBe(ALT)
})

test('the faded entry names other haplotypes only where a faded node is drawn and every one is on a walk left out', () => {
  const faded = (g: Graph, walks: string[]) =>
    entries(g, { lift: lifting(g, walks) }).find(e => e.key === 'faded')?.text
  expect(faded(graph, [REF])).toBe('only in other haplotypes')
  expect(faded(graph, [REF, ALT])).toBeUndefined()
  const loose = load(`${GFA}\nS\tx1\tA\nL\tv3\t+\tx1\t+\t0M`, 'GRCh38')
  expect(faded(loose, [REF])).toBe(`nodes and links not on ${REF}`)
  expect(faded(loose, [REF, ALT])).toBe('nodes and links not on these walks')
})

test('a lift fading links and no node keys the links alone, never other haplotypes', () => {
  const linked = load(`${GFA}\nL\tv2\t+\ta1\t+\t0M`, 'GRCh38')
  const key = entries(linked, { lift: lifting(linked, [REF, ALT]) })
  expect(key.map(e => e.key)).not.toContain('faded')
  expect(key.find(e => e.key === 'faded-links')?.text).toBe(
    'links not on these walks',
  )
  const skipping = load(
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
    'GRCh38',
  )
  expect(
    texts(skipping, { lift: lifting(skipping, ['B#1#ctg']) }),
  ).not.toContain('only in other haplotypes')
})

const SKIPPED = load(
  `${GFA}\nL\tv1\t+\tv3\t+\t0M\nW\tdel\t1\tchr6\t0\t7\t>v1>v3`,
  'GRCh38',
)

test('each skip row is there only where the drawing holds that mark', () => {
  const skips = (width: number) =>
    keyOf(SKIPPED, { width })
      .filter(section => section.id === 'skips')
      .flatMap(section => section.entries.map(entry => entry.text))
  expect(skips(600)).toEqual(['skips GRCh38 chr6 sequence'])
  expect(skips(120)).toEqual([SHORT_SKIP_KEY])
  expect(texts(graph)).not.toContainEqual(expect.stringMatching(/^skips /))
})

test('drawn marks read dashed and short skips off the batch, leaving lanes to their walks', () => {
  const curve = (o: object) => ({ curves: [], thickness: 1, color: 0, ...o })
  const marks = (edgeCurves: RenderBatch['edgeCurves']) =>
    drawnMarks([{ edgeCurves, nodeStrokes: [] }])
  expect(marks([curve({ skip: true, span: 200 })])).toMatchObject({
    dashedSkip: true,
    shortSkip: false,
  })
  expect(marks([curve({ skip: true, span: 5 })])).toMatchObject({
    dashedSkip: false,
    shortSkip: true,
  })
  expect(
    marks([
      curve({ skip: true, span: 200, walk: 0 }),
      curve({ skip: true, span: 0 }),
    ]),
  ).toMatchObject({ dashedSkip: false, shortSkip: false })
})

test('nodes not shown are keyed only where a hollow one is drawn', () => {
  const hollow = withNodes(graph, name =>
    name === 'a1' ? { placeholder: true } : {},
  )
  expect(texts(graph)).not.toContain(NOT_LOADED_TEXT)
  expect(texts(hollow)).toContain(NOT_LOADED_TEXT)
  expect(texts(hollow, { lift: lifting(hollow, [REF]) })).not.toContain(
    NOT_LOADED_TEXT,
  )
  expect(texts(hollow, {}, { drawsNodes: false })).not.toContain(
    NOT_LOADED_TEXT,
  )
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
  expect(texts(graph, {}, { genePins: [] })).not.toContain('exon')
  expect(
    texts(graph, {}, { genePins: [pin([{ start: 1, end: 3 }])] }),
  ).toContain('exon')
  expect(
    texts(
      graph,
      {},
      { genePins: [pin([{ start: 0, end: 9 }])], genesFrom: 'genes.gff3' },
    ),
  ).toContain('gene, from genes.gff3')
})

test("the thickness keys give the scale's two ends, links only where they widen by walks", () => {
  const thick = keyOf(graph).find(s => s.id === 'node-width')!
  expect(thick.group).toBe('Node thickness')
  expect(thick.entries.map(e => e.text)).toEqual(['2 walks', '1 walk'])
  const ids = (g: Graph, o?: Partial<GraphKeyOptions>) =>
    keyOf(g, {}, o).map(section => section.id)
  expect(ids(graph, { nodeWidth: 'uniform' })).not.toContain('node-width')
  expect(ids(withNodes(graph, () => ({ depth: 1 })))).not.toContain(
    'node-width',
  )
  expect(ids(graph)).not.toContain('link-width')
  expect(
    keyOf(graph, {}, { edgeWidth: 'walks' })
      .find(s => s.id === 'link-width')!
      .entries.map(e => e.text),
  ).toEqual(['1 walk'])
})

test('the halo, the strip tab and compress are keyed where they are drawn', () => {
  expect(keys(graph, {}, { halos: [{ whole: true }] })).not.toContain('halo')
  expect(keys(graph, {}, { halos: [{ whole: false }] })).toContain('halo')
  expect(keys(graph)).not.toContain('overhang')
  expect(texts(graph, {}, { stripOverhangs: true })).toContain(
    'graph runs past this edge',
  )
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  expect(
    keyOf(graph, { layout: { ...layout, compressed: true } })
      .at(-1)!
      .entries.map(e => e.text),
  ).toEqual([COMPRESSED_KEY])
})

const REPEAT = load(
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
  'ref',
)

test('a lift through a repeat keys a thread per pass', () => {
  const key = entries(REPEAT, {
    lift: lifting(REPEAT, ['ref#0#chr', 'dup#1#chr']),
  })
  expect(key.find(e => e.key === 'walk-passes')?.swatch?.kind).toBe('threads')
})

// R walks three reference nodes; A leaves it for a 75 kb loop the cut did not
// load, a placeholder, and comes back
const UNLOADED = load(
  [
    'S\tr1\t*\tLN:i:20000',
    'S\tr2\t*\tLN:i:30000',
    'S\tr3\t*\tLN:i:25000',
    'S\tp1\t*\tLN:i:75000\tnl:i:1',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr1\t+\tp1\t+\t0M',
    'L\tp1\t+\tr3\t+\t0M',
    'W\tR\t0\tchr\t0\t75000\t>r1>r2>r3',
    'W\tA\t1\tchr\t0\t120000\t>r1>p1>r3',
  ].join('\n'),
  'R',
)

// Three dashes at the 11 px period, as GeometryBuilder dashes a skip
const DASHED_SPAN_PX = 33

// The census: each key entry of a drawn mark's class against the marks of
// that class in the batch, which it classes by the strokes' own fields
function census(sections: GraphKeySection[], batch: RenderBatch, s: Scene) {
  const plain = batch.nodeStrokes.filter(
    n => n.walk === undefined && !n.placeholder,
  )
  const widths = new Set(
    batch.nodeStrokes.filter(n => !n.placeholder).map(n => n.thickness),
  )
  const lanes = new Set(batch.nodeStrokes.flatMap(n => n.walk ?? []))
  const skips = batch.edgeCurves.filter(
    e => e.skip && e.walk === undefined && (e.span ?? 0) > 0,
  )
  const dashed = (span = 0) => span >= DASHED_SPAN_PX
  const charcoal = batch.nodeStrokes.some(
    n => n.color === REFERENCE_RAMP_ALT_COLOR,
  )
  const classes = new Set([
    ...(s.referenceRamp && !s.lift && plain.length > 0 ? ['ramp'] : []),
    ...(charcoal ? [s.lift ? 'lift-off' : 'off'] : []),
    ...[...lanes].map(k => `walk-${s.lift?.walks[k]?.name}`),
    ...(s.lift && plain.length > 0 ? ['faded'] : []),
    ...(s.lift &&
    plain.length === 0 &&
    batch.edgeCurves.some(e => e.walk === undefined && !e.skip)
      ? ['faded-links']
      : []),
    ...(batch.nodeStrokes.some(n => (n.pass ?? 0) > 0) ? ['walk-passes'] : []),
    ...(skips.some(e => dashed(e.span)) ? ['deletion'] : []),
    ...(skips.some(e => !dashed(e.span)) ? ['short-skip'] : []),
    ...(batch.nodeStrokes.some(n => n.placeholder) ? ['not-shown'] : []),
    ...(widths.size > 1 ? ['width-thickest', 'width-thinnest'] : []),
  ])
  const keyed = new Set(
    sections.flatMap(section => section.entries.map(entry => entry.key)),
  )
  return {
    extra: [...keyed].filter(key => !classes.has(key)),
    missing: [...classes].filter(key => !keyed.has(key)),
  }
}

const CUTS: [string, Graph, (g: Graph) => Scene][] = [
  [
    'a repeat whose passes its walks state, both lifted',
    REPEAT,
    g => ({ lift: lifting(g, ['ref#0#chr', 'dup#1#chr']) }),
  ],
  ['a repeat whose passes its walks state, unlifted', REPEAT, () => ({})],
  [
    'a cut with a placeholder',
    UNLOADED,
    g => ({
      referenceRamp: computeReferenceRamp(g, { start: 0, end: 75_000 }),
      layout: layoutModeByValue('auto').run(g, undefined)!,
    }),
  ],
  ['a lifted walk', graph, g => ({ lift: lifting(g, [ALT]) })],
  [
    'a walk lifted by reference position',
    graph,
    g => {
      const referenceRamp = computeReferenceRamp(g, { start: 0, end: 9 })
      return {
        referenceRamp,
        lift: walkLift(
          g,
          [{ walk: ALT, color: { field: 'reference' } }],
          referenceRamp,
        ),
      }
    },
  ],
  [
    'every haplotype lifted',
    load(`${GFA}\nL\tv2\t+\ta1\t+\t0M`, 'GRCh38'),
    g => ({ lift: lifting(g, [REF, ALT]) }),
  ],
  ['short solid skips only', SKIPPED, () => ({ width: 120 })],
  [
    'a dashed skip under the ramp',
    SKIPPED,
    g => ({ referenceRamp: computeReferenceRamp(g, { start: 0, end: 9 }) }),
  ],
]

test.each(CUTS)(
  'every key entry of %s has a drawn mark of its class, and every drawn class an entry',
  (_, g, scene) => {
    const s = scene(g)
    const { layout, batch } = drawn(g, s)
    const sections = graphKey(g, layout, {
      lift: s.lift,
      referenceRamp: s.referenceRamp,
      marks: drawnMarks([batch]),
    })
    expect(census(sections, batch, s)).toEqual({ extra: [], missing: [] })
  },
)

test('the census fails on a planted extra entry and on a planted missing one', () => {
  const s = { width: 120 }
  const { layout, batch } = drawn(SKIPPED, s)
  const sections = graphKey(SKIPPED, layout, { marks: drawnMarks([batch]) })
  const planted: GraphKeySection[] = [
    ...sections,
    {
      id: 'skips',
      entries: [{ key: 'deletion', text: 'skips GRCh38 chr6 sequence' }],
    },
  ]
  expect(census(planted, batch, s).extra).toEqual(['deletion'])
  const dropped = sections.filter(section => section.id !== 'skips')
  expect(census(dropped, batch, s).missing).toEqual(['short-skip'])
})
