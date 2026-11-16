import { COMPRESSED_KEY } from './bubbleSpreads'
import { SHORT_SKIP_KEY, deletionDrawing, deletionEdges } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { NOT_LOADED_TEXT } from './gfa/departures'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { drawnMarks, graphKey, tooSmallText, unlabelledText } from './graphKey'
import { nodeLabelBudget } from './graphLabels'
import { layoutLabels } from './labelLayout'
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
import { LANE_HEADS_AGAINST_KEY, LANE_HEADS_KEY } from './renderer/laneHeads'
import { axisScaleOf } from './viewport'
import { walkLift } from './walkHighlight'

import type { GraphKeyOptions, GraphKeySection } from './graphKey'
import type { Fold, Site, SmallSites } from './levelOfDetail'
import type { BuildOptions, ReferenceRamp } from './renderer/GeometryBuilder'
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
  bounds?: BuildOptions['viewportBounds']
  smallSites?: SmallSites
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
    ...(s.bounds ? { viewportBounds: s.bounds } : {}),
    ...(s.smallSites ? { smallSites: s.smallSites } : {}),
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

test('a lift leaving out only a node the layout does not place keys no faded node', () => {
  const loose = load(`${GFA}\nS\tx1\tA`, 'GRCh38')
  const lift = lifting(loose, [REF, ALT])
  expect(keys(loose, { lift })).toContain('faded')
  const layout = layoutModeByValue('ordered').run(loose, undefined)!
  const unplaced = {
    ...layout,
    nodePositions: Object.fromEntries(
      Object.entries(layout.nodePositions).filter(([id]) => id !== 'x1+'),
    ),
  }
  expect(keys(loose, { lift, layout: unplaced })).not.toContain('faded')
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

test('a plain link is keyed where one is drawn, in the ink it is stroked in', () => {
  const link = entries(graph).find(e => e.key === 'link')
  const { batch } = drawn(graph)
  const stroked = batch.edgeCurves.find(e => !e.skip && e.walk === undefined)
  expect(link?.swatch).toEqual({
    kind: 'line',
    ink: stroked?.color,
    dashed: false,
  })
  const lone = load('S\tv1\tAAAA\nW\tGRCh38\t0\tchr6\t0\t4\t>v1', 'GRCh38')
  expect(keys(lone)).not.toContain('link')
})

test('each skip row is there only where the drawing holds that mark', () => {
  const skips = (width: number) =>
    keyOf(SKIPPED, { width })
      .filter(section => section.id === 'skips')
      .flatMap(section => section.entries.map(entry => entry.text))
  expect(skips(600)).toEqual(['skips GRCh38 chr6 sequence'])
  expect(skips(120)).toEqual([SHORT_SKIP_KEY])
  expect(texts(graph)).not.toContainEqual(expect.stringMatching(/^skips /))
})

test('under a lift each skip row shows the ink its skips are stroked in', () => {
  for (const width of [600, 120]) {
    const s = { lift: lifting(SKIPPED, [REF]), width }
    const { layout, batch } = drawn(SKIPPED, s)
    const skipRows = graphKey(SKIPPED, layout, {
      lift: s.lift,
      marks: drawnMarks([batch]),
    })
      .filter(section => section.id === 'skips')
      .flatMap(section => section.entries)
    const stroked = new Set(
      batch.edgeCurves
        .filter(e => e.skip && e.walk === undefined)
        .map(e => e.color),
    )
    expect(skipRows).toHaveLength(1)
    expect(stroked.size).toBe(1)
    expect(skipRows[0]!.swatch).toMatchObject({ ink: [...stroked][0] })
  }
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
  expect(marks([curve({ skip: true, span: 200, walk: 0 })])).toMatchObject({
    dashedSkip: false,
    shortSkip: false,
  })
})

test('a skip too short on screen to arc, drawn as its plain link, is a skip too short to dash', () => {
  expect(
    drawnMarks([
      {
        edgeCurves: [
          { curves: [], thickness: 1, color: 0, skip: true, span: 0 },
        ],
        nodeStrokes: [],
      },
    ]),
  ).toMatchObject({ dashedSkip: false, shortSkip: true, plainLink: false })
})

test("a hollow node's thickness is not a thickness the nodes vary by", () => {
  const stroke = (thickness: number, placeholder?: true) => ({
    points: [],
    thickness,
    color: 0,
    ...(placeholder ? { placeholder } : {}),
  })
  const widthsVary = (nodeStrokes: RenderBatch['nodeStrokes']) =>
    drawnMarks([{ edgeCurves: [], nodeStrokes }]).widthsVary
  expect(widthsVary([stroke(3), stroke(5)])).toBe(true)
  expect(widthsVary([stroke(3), stroke(5, true), stroke(3)])).toBe(false)
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

// placeholders on loops drawn 6 px long, ten px apart along one line of a
// 1200 by 320 pane: each length stacks off its loop
function unlabelledOf(lengths: number[]) {
  const ids = lengths.map((_, i) => `p${i}`)
  return layoutLabels({
    paneWidth: 1200,
    canvasHeight: 320,
    axisScale: { scaleX: 1, scaleY: 1 },
    translateX: 0,
    translateY: 0,
    contigThickness: 6,
    legendSize: { width: 0, height: 0 },
    drawnRowLabels: [],
    bubbleHalos: [],
    genePins: [],
    nodePositions: Object.fromEntries(
      ids.map((id, i) => [
        id,
        [
          { x: 100 + i * 10, y: 160 },
          { x: 106 + i * 10, y: 160 },
        ],
      ]),
    ),
    labelsNodeSizes: true,
    nodeLengths: new Map(ids.map((id, i) => [id, lengths[i]!])),
    nodeById: new Map(ids.map(id => [id, { placeholder: true }])),
    alleleDeletions: [],
    positionsVersion: 0,
    folded: undefined,
  }).unlabelled
}

const withPlaceholder = withNodes(graph, name =>
  name === 'a1' ? { placeholder: true } : {},
)
const notShown = (lengths: number[]) =>
  entries(withPlaceholder, {}, { unlabelled: unlabelledOf(lengths) }).find(
    e => e.key === 'not-shown',
  )

test('nodes not shown say how many placeholders went unlabelled and how long each is at most', () => {
  expect(notShown(Array.from({ length: 100 }, () => 1))?.under).toBe(
    '91 unlabelled, each 1 bp',
  )
  expect(
    notShown(Array.from({ length: 100 }, (_, i) => (i + 1) * 20))?.under,
  ).toBe('91 unlabelled, 1.8 kb or less each')
})

test('nodes not shown carry no count where every placeholder is labelled', () => {
  const ones = (n: number) => Array.from({ length: n }, () => 1)
  const budget = nodeLabelBudget(1200, 320)
  const all = notShown(ones(budget))
  expect(all?.text).toBe(NOT_LOADED_TEXT)
  expect(all).not.toHaveProperty('under')
  expect(notShown(ones(budget + 1))?.under).toBe('1 unlabelled, 1 bp')
})

// A host that measures the key before it places labels sizes it once: the
// line for the count is there whether the labels leave any placeholder
// unlabelled or not, and unlabelledText fills it after
test('nodes not shown keep their line for the count, blank, for a host that places labels after it sizes the key', () => {
  const reserved = entries(withPlaceholder, {}, { unlabelled: 'reserved' })
  expect(reserved.find(e => e.key === 'not-shown')?.under).toBe('')
  expect(
    entries(graph, {}, { unlabelled: 'reserved' }).find(
      e => e.key === 'not-shown',
    ),
  ).toBeUndefined()
  expect(unlabelledText(unlabelledOf([5, 5, 5]))).toBe('')
  expect(
    unlabelledText(unlabelledOf(Array.from({ length: 100 }, () => 1))),
  ).toBe('91 unlabelled, each 1 bp')
})

test('the outline is keyed as exons, or as genes where every gene is one exon', () => {
  const pin = (exons: { start: number; end: number }[]) => ({
    gene: { name: 'G', refName: 'chr6', start: 0, end: 9, strand: 1, exons },
    exons: 'M0,0',
    exonsByNode: [{ nodeId: 'v1', d: 'M0,0', stretches: [] }],
    nodeIds: new Set(['v1']),
    at: { x: 0, y: 0 },
    covered: 1,
    onReference: true,
    walks: 1,
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
  const skips = batch.edgeCurves.filter(e => e.skip && e.walk === undefined)
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
    ...[batch.nodeStrokes, batch.edgeCurves].flatMap(marks =>
      marks.flatMap(({ walk, walkPass = -1 }) => {
        const lifted = walk === undefined ? undefined : s.lift?.walks[walk]
        return lifted && walkPass >= 0
          ? [
              lifted.walkPasses?.bundled
                ? `passes-${lifted.name}`
                : `pass-${lifted.name}-${walkPass}`,
            ]
          : []
      }),
    ),
    ...(batch.arrows.some(a => a.walk !== undefined) ? ['lane-heads'] : []),
    ...(!s.lift && batch.edgeCurves.some(e => e.walk === undefined && !e.skip)
      ? ['link']
      : []),
    ...(skips.some(e => dashed(e.span)) ? ['deletion'] : []),
    ...(skips.some(e => !dashed(e.span)) ? ['short-skip'] : []),
    ...(batch.nodeStrokes.some(n => n.placeholder) ? ['not-shown'] : []),
    ...(widths.size > 1 ? ['width-thickest', 'width-thinnest'] : []),
    ...(batch.collapsed?.sites.length ? ['too-small'] : []),
  ])
  const keyed = new Set(
    sections.flatMap(section => section.entries.map(entry => entry.key)),
  )
  return {
    extra: [...keyed].filter(key => !classes.has(key)),
    missing: [...classes].filter(key => !keyed.has(key)),
  }
}

// SKIPPED's reference laid out with v2 a tenth of a layout unit long, so the
// skip over it spans under a pixel and draws as its plain link
function unarced(g: Graph): Scene {
  const layout = layoutModeByValue('ordered').run(g, undefined)!
  const at = (x0: number, x1: number) => [
    { x: x0, y: 0 },
    { x: x1, y: 0 },
  ]
  return {
    layout: {
      ...layout,
      nodePositions: {
        ...layout.nodePositions,
        'v1+': at(0, 100),
        'v2+': at(100, 100.1),
        'v3+': at(100.1, 200),
        'a1+': at(100, 100.1).map(p => ({ ...p, y: 20 })),
      },
    },
  }
}

const byPass = (g: Graph, walks: string[]) =>
  walkLift(
    g,
    walks.map(walk => ({
      walk,
      ...(walk === 'ref#0#chr' ? {} : { color: { field: 'pass' as const } }),
    })),
  )

const MANY = load(
  [
    'S\tv1\tAAAA',
    'S\tv2\tCC',
    'S\tv3\tGGG',
    'L\tv1\t+\tv2\t+\t0M',
    'L\tv2\t+\tv3\t+\t0M',
    'L\tv2\t+\tv1\t+\t0M',
    'W\tref\t0\tchr\t0\t9\t>v1>v2>v3',
    `W\tmany\t1\tchr\t0\t*\t${'>v1>v2'.repeat(9)}>v3`,
  ].join('\n'),
  'ref',
)

// v2 drawn as the reference reads it, which its stable coordinate says, and
// read the other way by inv
const INVERTED = load(
  [
    'S\tv1\tAAAA\tSN:Z:ref#0#chr\tSO:i:0\tSR:i:0',
    'S\tv2\tCC\tSN:Z:ref#0#chr\tSO:i:4\tSR:i:0',
    'S\tv3\tGGG\tSN:Z:ref#0#chr\tSO:i:6\tSR:i:0',
    'L\tv1\t+\tv2\t+\t0M',
    'L\tv2\t+\tv3\t+\t0M',
    'L\tv1\t+\tv2\t-\t0M',
    'L\tv2\t-\tv3\t+\t0M',
    'W\tref\t0\tchr\t0\t9\t>v1>v2>v3',
    'W\tinv\t1\tchr\t0\t9\t>v1<v2>v3',
  ].join('\n'),
  'ref',
)

// a 1 bp SNP and a 1 bp deletion, each under a pixel at a 600 px fit of a
// 2 kb reference, which fold
const SMALL = load(
  [
    `S\tr1\t${'A'.repeat(1000)}`,
    'S\tr2\tC',
    `S\tr3\t${'A'.repeat(500)}`,
    'S\tr4\tG',
    `S\tr5\t${'A'.repeat(500)}`,
    'S\ta1\tT',
    'L\tr1\t+\tr2\t+\t0M',
    'L\tr2\t+\tr3\t+\t0M',
    'L\tr3\t+\tr4\t+\t0M',
    'L\tr4\t+\tr5\t+\t0M',
    'L\tr1\t+\ta1\t+\t0M',
    'L\ta1\t+\tr3\t+\t0M',
    'L\tr3\t+\tr5\t+\t0M',
    'W\tref\t0\tchr\t0\t2002\t>r1>r2>r3>r4>r5',
    'W\tw\t1\tchr\t0\t*\t>r1>a1>r3>r5',
    'W\tw\t2\tchr\t0\t*\t>r1>r2>r3>r5',
  ].join('\n'),
  'ref',
)

const smallSites = (): Scene => {
  const at = (x0: number, x1: number, y = 0) => [
    { x: x0, y },
    { x: x1, y },
  ]
  return {
    layout: {
      nodePositions: {
        'r1+': at(0, 1000),
        'r2+': at(1000, 1001),
        'r3+': at(1001, 1501),
        'r4+': at(1501, 1502),
        'r5+': at(1502, 2002),
        'a1+': at(1000, 1001, 20),
      },
    },
  }
}

const CUTS: [string, Graph, (g: Graph) => Scene][] = [
  ['small sites folded', SMALL, smallSites],
  [
    'small sites folded under two lifted walks',
    SMALL,
    g => ({ ...smallSites(), lift: lifting(g, ['w#1#chr', 'w#2#chr']) }),
  ],
  [
    'small sites drawn as nodes',
    SMALL,
    () => ({ ...smallSites(), smallSites: 'nodes' }),
  ],
  [
    'a skip too short on screen to arc, drawn as nodes',
    SKIPPED,
    g => ({ ...unarced(g), smallSites: 'nodes' }),
  ],
  [
    "a repeat's walk lifted alone and coloured by pass",
    REPEAT,
    g => ({ lift: byPass(g, ['dup#1#chr']) }),
  ],
  [
    "a repeat's walk coloured by pass beside the reference",
    REPEAT,
    g => ({ lift: byPass(g, ['ref#0#chr', 'dup#1#chr']) }),
  ],
  [
    'a walk of more passes than take a colour each',
    MANY,
    g => ({ lift: byPass(g, ['many#1#chr']) }),
  ],
  [
    'a walk reading a node backwards beside the reference',
    INVERTED,
    g => ({ lift: lifting(g, ['ref#0#chr', 'inv#1#chr']) }),
  ],
  [
    'a walk reading a node backwards, coloured by pass',
    INVERTED,
    g => ({ lift: byPass(g, ['ref#0#chr', 'inv#1#chr']) }),
  ],
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
  ['a skip too short on screen to arc', SKIPPED, unarced],
  [
    'a lifted walk beside a dashed skip it does not take',
    SKIPPED,
    g => ({ lift: lifting(g, [REF]) }),
  ],
  [
    'a lift leaving a placeholder out',
    UNLOADED,
    g => ({
      lift: lifting(g, ['R#0#chr']),
      layout: layoutModeByValue('auto').run(g, undefined)!,
    }),
  ],
  [
    'a lift through a placeholder',
    UNLOADED,
    g => ({
      lift: lifting(g, ['A#1#chr']),
      layout: layoutModeByValue('auto').run(g, undefined)!,
    }),
  ],
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

test('the key says how many nodes and skips are too small to draw, in one line with no swatch, last', () => {
  expect(
    [
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [3, 2],
      [1234, 0],
    ].map(([nodes = 0, skips = 0]) => tooSmallText(nodes, skips)),
  ).toEqual([
    '1 node too small to draw',
    '2 nodes too small to draw',
    '1 skip too small to draw',
    '2 skips too small to draw',
    '1 node and 1 skip too small to draw',
    '3 nodes and 2 skips too small to draw',
    '1,234 nodes too small to draw',
  ])
  const { layout, batch } = drawn(SMALL, smallSites())
  expect(batch.collapsed?.sites.map(s => s.nodes)).toEqual([['a1+'], []])
  const sections = graphKey(SMALL, layout, { marks: drawnMarks([batch]) })
  const last = sections.at(-1)
  expect(last).toEqual({
    id: 'too-small',
    entries: [
      { key: 'too-small', text: '1 node and 1 skip too small to draw' },
    ],
  })
  expect(keys(SMALL, { ...smallSites(), smallSites: 'nodes' })).not.toContain(
    'too-small',
  )
  expect(keys(SMALL, { ...smallSites(), width: 60_000 })).not.toContain(
    'too-small',
  )
  const dropped = sections.filter(s => s.id !== 'too-small')
  expect(census(dropped, batch, smallSites()).missing).toEqual(['too-small'])
})

const site = (nodes: string[], edges: number[]): Site => ({
  nodes,
  edges,
  refName: 'chr',
  start: 0,
  end: 0,
  bp: 0,
  x: 0,
  y: 0,
  count: 1,
  total: 1,
})

const foldOf = (sites: Site[]): Fold => ({
  sites,
  nodes: new Set(sites.flatMap(s => s.nodes)),
  edges: new Set(sites.flatMap(s => s.edges)),
  siteOf: new Map(),
  pxPerBp: 1,
  bridges: new Set(),
  within: new Map(),
})

test("the key's counts are the folded nodes and skip links, each once, however many sites or panels hold them", () => {
  const fold = foldOf([
    site(['a1', 'a2'], [1, 2, 3]),
    site(['a3'], [4, 5]),
    site([], [7]),
    site([], [8]),
  ])
  const panel = { edgeCurves: [], nodeStrokes: [], collapsed: fold }
  const marks = drawnMarks([panel, panel])
  expect([marks.foldedNodes.size, marks.foldedSkips.size]).toEqual([3, 2])
  const text = graphKey(SMALL, {}, { marks }).at(-1)?.entries[0]?.text
  expect(text).toBe('3 nodes and 2 skips too small to draw')
  const skipsOnly = drawnMarks([
    { ...panel, collapsed: foldOf([site([], [7])]) },
  ])
  expect(graphKey(SMALL, {}, { marks: skipsOnly }).at(-1)?.entries).toEqual([
    { key: 'too-small', text: '1 skip too small to draw' },
  ])
})

test('a walk coloured by pass keys each pass by its name, a bundle by its count, and heads by the way they point', () => {
  const keyed = (g: Graph, s: Scene) => {
    const { layout, batch } = drawn(g, s)
    const sections = graphKey(g, layout, {
      lift: s.lift,
      marks: drawnMarks([batch]),
    })
    return {
      sections,
      batch,
      texts: sections.flatMap(x => x.entries).map(e => [e.key, e.text]),
    }
  }
  const lone = keyed(REPEAT, { lift: byPass(REPEAT, ['dup#1#chr']) })
  expect(lone.texts).toEqual(
    expect.arrayContaining([
      ['pass-dup#1#chr-0', expect.stringMatching(/^pass 1 · \d+ bp$/)],
      ['pass-dup#1#chr-1', expect.stringMatching(/^pass 2 · \d+ bp$/)],
      ['lane-heads', LANE_HEADS_KEY],
    ]),
  )
  const many = keyed(MANY, { lift: byPass(MANY, ['many#1#chr']) })
  expect(many.texts).toEqual(
    expect.arrayContaining([['passes-many#1#chr', '9 passes']]),
  )
  expect(many.texts.filter(([key]) => key?.startsWith('pass-'))).toEqual([])
  const backwards = keyed(INVERTED, {
    lift: lifting(INVERTED, ['ref#0#chr', 'inv#1#chr']),
  })
  expect(backwards.texts).toEqual(
    expect.arrayContaining([['lane-heads', LANE_HEADS_AGAINST_KEY]]),
  )
  const s = { lift: byPass(REPEAT, ['dup#1#chr']) }
  const dropped = lone.sections.map(section => ({
    ...section,
    entries: section.entries.filter(e => !e.key.startsWith('pass-')),
  }))
  expect(census(dropped, lone.batch, s).missing).toEqual([
    'pass-dup#1#chr-0',
    'pass-dup#1#chr-1',
  ])
})

// The middle copy lacks the unit's first two nodes and the last copy is cut
// short too, so the third pass steps only v3 and v4
const PARTIAL = load(
  [
    'S\tv1\tAAAA',
    'S\tv2\tCC',
    'S\tv3\tGGG',
    'S\tv4\tTT',
    'L\tv1\t+\tv2\t+\t0M',
    'L\tv2\t+\tv3\t+\t0M',
    'L\tv3\t+\tv4\t+\t0M',
    'L\tv4\t+\tv3\t+\t0M',
    'L\tv4\t+\tv1\t+\t0M',
    'L\tv2\t+\tv3\t+\t0M',
    'W\tref\t0\tchr\t0\t11\t>v1>v2>v3>v4',
    'W\tpart\t1\tchr\t0\t*\t>v1>v2>v3>v4>v3>v4>v1>v2>v3>v4',
  ].join('\n'),
  'ref',
)

test('a pass the view leaves undrawn has no key entry', () => {
  const lift = byPass(PARTIAL, ['part#1#chr'])
  const layout = layoutModeByValue('ordered').run(PARTIAL, undefined)!
  const drawnPasses = lift!.walks[0]!.walkPasses!.passes
  expect(drawnPasses).toHaveLength(3)
  const xs = (id: string) => layout.nodePositions[id]!.map(p => p.x)
  const bounds = {
    minX: xs('v1+').reduce((least, x) => Math.min(least, x), Infinity) - 1,
    maxX: xs('v2+').reduce((most, x) => Math.max(most, x), -Infinity) + 1,
    minY: -1e6,
    maxY: 1e6,
  }
  const passKeys = (s: Scene) =>
    keys(PARTIAL, s).filter(key => key.startsWith('pass-'))
  expect(passKeys({ lift, layout })).toEqual([
    'pass-part#1#chr-0',
    'pass-part#1#chr-1',
    'pass-part#1#chr-2',
  ])
  expect(passKeys({ lift, layout, bounds })).toEqual([
    'pass-part#1#chr-0',
    'pass-part#1#chr-1',
  ])
})
