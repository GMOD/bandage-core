import { COMPRESSED_KEY } from './bubbleSpreads'
import { deletionDrawing, deletionEdges } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { NOT_LOADED_TEXT, departureTable } from './gfa/departures'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { gfaTables } from './gfa/gfaTables'
import {
  absentHaplotypesText,
  drawnMarks,
  graphKey,
  lanesOverUnderlays,
  tooSmallText,
  unlabelledText,
} from './graphKey'
import { nodeLabelBudget } from './graphLabels'
import { keyColumnBox } from './keyColumn'
import { layoutLabels } from './labelLayout'
import { polylinePointAt } from './layout/mergeRuns'
import { layoutModeByValue } from './layoutModes'
import { drawnNodeWidth, withFrequencies } from './nodeWidths'
import { anchorGraph } from './pathAnchoring'
import { drawingBounds, fitTransform, loadGraph } from './pipeline'
import { graphBackbone } from './reference'
import {
  EDGE_DEFAULT_COLOR,
  REFERENCE_RAMP_ALT_COLOR,
  buildGeometry,
  computeReferenceRamp,
} from './renderer/GeometryBuilder'
import { FADED_ALPHA, fadeAbgr } from './renderer/colorBits'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { LANE_HEADS_AGAINST_KEY, LANE_HEADS_KEY } from './renderer/laneHeads'
import { axisScaleOf, keyedView } from './viewport'
import { walkLift } from './walkHighlight'

import type { EdgeWidth } from './edgeWidths'
import type { GraphKeyOptions, GraphKeySection } from './graphKey'
import type { Fold, Site, SmallSites } from './levelOfDetail'
import type { NodeWidth } from './nodeWidths'
import type { Bounds } from './pipeline'
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
  drawPaths?: boolean
  edgeWidth?: EdgeWidth
  nodeWidth?: NodeWidth
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
    drawPaths: s.drawPaths ?? false,
    nodeWidth: s.nodeWidth ?? 'depth',
    ...(s.edgeWidth ? { edgeWidth: s.edgeWidth } : {}),
    highlight: s.lift,
    axis: axisScaleOf(fit.scale, pixelRows),
    referenceRamp: s.referenceRamp,
    ...(s.bounds ? { viewportBounds: s.bounds } : {}),
    ...(s.smallSites ? { smallSites: s.smallSites } : {}),
  })
  return { layout, batch, fit, pixelRows }
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
  expect(faded(graph, [REF])).toBe('other haplotypes')
  expect(faded(graph, [REF, ALT])).toBeUndefined()
  const loose = load(`${GFA}\nS\tx1\tA\nL\tv3\t+\tx1\t+\t0M`, 'GRCh38')
  expect(faded(loose, [REF])).toBe('other haplotypes, or no walk')
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

test('a lift fading links and no node keys the links alone, and other haplotypes once they share its nodes', () => {
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
  // GRCh38 shares 1 and 3 with B, so they draw grey under B's lane
  expect(texts(skipping, { lift: lifting(skipping, ['B#1#ctg']) })).toContain(
    'other haplotypes',
  )
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
  // a skip too short on screen for full dashes is dashed shorter, under the
  // one entry, where it was a plain stroke keyed "short skip"
  expect(skips(600)).toEqual(['skips GRCh38 chr6 sequence'])
  expect(skips(120)).toEqual(['skips GRCh38 chr6 sequence'])
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
        .map(e => (e.faded ? fadeAbgr(e.color, FADED_ALPHA) : e.color)),
    )
    expect(skipRows).toHaveLength(1)
    expect(stroked.size).toBe(1)
    expect(skipRows[0]!.swatch).toMatchObject({ ink: [...stroked][0] })
  }
})

test('drawn marks read a skip stroked dashed as dashed and one stroked plain as short, leaving lanes to their walks', () => {
  const curve = (o: object) => ({ curves: [], thickness: 1, color: 0, ...o })
  const marks = (edgeCurves: RenderBatch['edgeCurves']) =>
    drawnMarks([{ edgeCurves, nodeStrokes: [] }])
  for (const span of [200, 5]) {
    expect(marks([curve({ skip: true, span, dashed: true })])).toMatchObject({
      dashedSkip: true,
      shortSkip: false,
      plainLink: false,
    })
  }
  for (const span of [5, 0]) {
    expect(marks([curve({ skip: true, span })])).toMatchObject({
      dashedSkip: false,
      shortSkip: true,
      plainLink: false,
    })
  }
  expect(
    marks([curve({ skip: true, span: 200, dashed: true, walk: 0 })]),
  ).toMatchObject({ dashedSkip: false, shortSkip: false })
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
  const deep = (placeholder: boolean) =>
    drawn(
      withNodes(graph, name =>
        name === 'a1' ? { placeholder, depth: 5 } : { depth: 2 },
      ),
    ).batch.nodeThicknessesVary
  expect(deep(true)).toBe(false)
  expect(deep(false)).toBe(true)
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

// placeholders on loops drawn 6 px long, 20 px apart in two rows of a 1200 by
// 320 pane: each length stacks off its loop
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
          { x: 100 + (i % 50) * 20, y: 110 + Math.floor(i / 50) * 100 },
          { x: 106 + (i % 50) * 20, y: 110 + Math.floor(i / 50) * 100 },
        ],
      ]),
    ),
    labelsNodeSizes: true,
    nodeLengths: new Map(ids.map((id, i) => [id, lengths[i]!])),
    nodeById: new Map(ids.map(id => [id, { placeholder: true }])),
    graph: undefined,
    drawnInk: undefined,
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
  const v1 = graph.nodes.find(n => n.name === 'v1')!.id
  const pin = (exons: { start: number; end: number }[]) => ({
    gene: { name: 'G', refName: 'chr6', start: 0, end: 9, strand: 1, exons },
    exons: 'M0,0',
    exonsByNode: [{ nodeId: v1, d: 'M0,0', stretches: [] }],
    nodeIds: new Set([v1]),
    at: { x: 0, y: 0 },
    covered: 1,
    anchored: 1,
    body: [],
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

// the box round a node's middle, in layout units
function middleOf(layout: LayoutResult, id: string) {
  const line = layout.nodePositions[id]!
  const { x, y } = polylinePointAt(line, 0.5)
  return { minX: x - 0.01, minY: y - 0.01, maxX: x + 0.01, maxY: y + 0.01 }
}

// rand-chr8-3, rand-chr17-3, rand-chr3-3 and Y-rand-2 in the linear view cut
// past their windows, and the key listed an exon whose only outlines lay on
// the cut beyond the pane
test('an exon is keyed only where its outline meets the view the pane shows', () => {
  const { layout, batch } = drawn(graph)
  const id = graph.nodes.find(n => n.name === 'v1')!.id
  const line = layout.nodePositions[id]!
  const pin = {
    gene: {
      name: 'G',
      refName: 'chr6',
      start: 0,
      end: 9,
      strand: 1,
      exons: [{ start: 1, end: 3 }],
    },
    exons: 'M0,0',
    exonsByNode: [{ nodeId: id, d: 'M0,0', stretches: [line] }],
    nodeIds: new Set([id]),
    at: line[0]!,
    covered: 1,
    anchored: 1,
    body: [],
    onReference: true,
    walks: 1,
  }
  const keyed = (view?: Bounds) =>
    graphKey(graph, layout, {
      marks: drawnMarks([batch], view),
      genePins: [pin],
    })
      .flatMap(section => section.entries)
      .map(entry => entry.text)
  const other = graph.nodes.find(n => n.name === 'v3')!.id
  expect(keyed()).toContain('exon')
  expect(keyed(middleOf(layout, id))).toContain('exon')
  expect(keyed(middleOf(layout, other))).not.toContain('exon')
})

test("the view a key keys is the pane under the reference strip, the key's column included", () => {
  expect(
    keyedView(
      { translateX: -100, translateY: 20 },
      { scaleX: 2, scaleY: 2 },
      {
        paneWidth: 1000,
        canvasHeight: 300,
        referenceStripZonePx: 40,
      },
    ),
  ).toEqual({ minX: 50, maxX: 550, minY: 10, maxY: 140 })
})

// L6-amy's pane, panned, drew a skip's dashes and a thick reference node in
// the strip under the key, and the key listed neither
test('a mark drawn under the key is keyed', () => {
  const { layout, batch, fit, pixelRows } = drawn(SKIPPED)
  const skip = batch.edgeCurves.find(e => e.skip && e.walk === undefined)!
  const xs = skip.curves.flatMap(c => [c.x0, c.cx0, c.cx1, c.x1])
  const left = xs.reduce((a, b) => Math.min(a, b))
  const right = xs.reduce((a, b) => Math.max(a, b))
  const frame = {
    paneWidth: 1200,
    canvasHeight: 300,
    legendSize: { width: 488, height: 100 },
  }
  const column = keyColumnBox(frame)
  const translateX = column.x0 + 10 - left * fit.scale
  expect(right * fit.scale + translateX).toBeLessThan(column.x1)
  const view = keyedView(
    { translateX, translateY: fit.translateY },
    axisScaleOf(fit.scale, pixelRows),
    frame,
  )
  const skips = graphKey(SKIPPED, layout, { marks: drawnMarks([batch], view) })
    .filter(section => section.id === 'skips')
    .flatMap(section => section.entries.map(entry => entry.text))
  expect(skips).toEqual(['skips GRCh38 chr6 sequence'])
})

// Y-rand-10's pane showed the reference's nodes, walked by GRCh38 alone,
// drawn as one walk is; the six haplotypes' walks stepped only four nodes
// at the cut's left end, off the pane, and the key said "7 walks | 1 walk"
test('the node thicknesses keyed are the thickest and thinnest the view shows', () => {
  const { layout, batch } = drawn(graph)
  const idOf = (name: string) => graph.nodes.find(n => n.name === name)!.id
  const thicknesses = (view?: Bounds) =>
    graphKey(graph, layout, { marks: drawnMarks([batch], view) })
      .find(section => section.id === 'node-width')
      ?.entries.map(entry => entry.text)
  expect(thicknesses()).toEqual(['depth 2', 'depth 1'])
  expect(thicknesses(middleOf(layout, idOf('a1')))).toEqual(['depth 1'])
  expect(thicknesses(middleOf(layout, idOf('v1')))).toEqual(['depth 2'])
})

// A2-del571 zoomed to x43 drew one thick node across the pane, from a batch
// built for the view and the panes round it, and the key had no thickness
test("the nodes vary in thickness by the whole drawing, not by a viewport's cull", () => {
  const idOf = (name: string) => graph.nodes.find(n => n.name === name)!.id
  const { layout } = drawn(graph)
  const view = middleOf(layout, idOf('v1'))
  const { batch } = drawn(graph, { bounds: view })
  expect([...batch.nodeStrokeRuns.keys()]).toEqual([idOf('v1')])
  expect(
    graphKey(graph, layout, { marks: drawnMarks([batch], view) })
      .find(section => section.id === 'node-width')
      ?.entries.map(entry => entry.text),
  ).toEqual(['depth 2'])
})

test("the thickness keys give the scale's two ends, links only where they widen by walks", () => {
  const thick = keyOf(graph).find(s => s.id === 'node-width')!
  expect(thick.group).toBe('Node thickness')
  expect(thick.entries.map(e => e.text)).toEqual(['depth 2', 'depth 1'])
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

// Eight walks through v2 and one through a1, as at a 1-walk allele
const NINE = [
  GFA.replace('W\talt\t1\tchr6\t0\t13\t>v1>a1>v3', ''),
  ...Array.from({ length: 7 }, (_, i) => `W\th${i}\t1\tchr6\t0\t9\t>v1>v2>v3`),
  'W\talt\t1\tchr6\t0\t13\t>v1>a1>v3',
].join('\n')

const thicknessKey = (
  g: Graph,
  o: Partial<GraphKeyOptions> = {},
  contigThickness = 6,
) =>
  keyOf(
    g,
    {},
    { nodeWidth: 'walks', edgeWidth: 'walks', contigThickness, ...o },
  ).find(s => s.id === 'node-width')

const scaleOf = (section?: GraphKeySection) =>
  section?.entries.map(e => [
    e.text,
    e.swatch?.kind === 'width' ? Math.round(e.swatch.px * 100) / 100 : NaN,
  ])

test('nodes and links by walks key one thickness: the most passes at contigThickness, half and one', () => {
  const nine = load(NINE, 'GRCh38')
  const thick = thicknessKey(nine)
  expect(thick?.group).toBe('Thickness')
  expect(scaleOf(thick)).toEqual([
    ['9 walks', 6],
    ['5 walks', 3.33],
    ['1 walk', 1],
  ])
  expect(
    keyOf(nine, {}, { nodeWidth: 'walks', edgeWidth: 'walks' }).map(s => s.id),
  ).not.toContain('link-width')
  expect(thicknessKey(nine, { edgeWidth: 'uniform' })?.group).toBe(
    'Node thickness',
  )
})

test('the thinnest walks swatch says how many walks its 1 px floor holds', () => {
  expect(scaleOf(thicknessKey(load(NINE, 'GRCh38'), {}, 3))).toEqual([
    ['9 walks', 3],
    ['5 walks', 1.67],
    ['1 to 3 walks', 1],
  ])
})

// one walk of four passing x twice drew x at 3 px under "4 walks / 2 walks /
// 1 walk", so x read as two walks
test('a walk stepping a node twice keys passes, not walks', () => {
  const twice = loadGraph(
    [
      'S\tr1\tAAAA',
      'S\tr2\tAAAA',
      'S\tx\tAAAA',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr1\t+\tx\t+\t0M',
      'L\tx\t+\tx\t+\t0M',
      'L\tx\t+\tr2\t+\t0M',
      'W\tGRCh38\t0\tchr1\t0\t8\t>r1>r2',
      'W\ta\t1\tc\t0\t8\t>r1>r2',
      'W\tb\t1\tc\t0\t8\t>r1>r2',
      'W\tdup\t1\tc\t0\t16\t>r1>x>x>r2',
    ].join('\n'),
    'twice',
  )
  expect(scaleOf(thicknessKey(twice))).toEqual([
    ['4 walk passes', 6],
    ['2 walk passes', 3],
    ['1 walk pass', 1.5],
  ])
})

test('walks with nodes not loaded draw no thickness, and the key says whose stretches are missing', () => {
  const held = withNodes(load(NINE, 'GRCh38'), name =>
    name === 'a1' ? { placeholder: true } : {},
  )
  expect(thicknessKey(held)?.entries).toEqual([
    {
      key: 'width-not-drawn',
      text: 'thickness not drawn: 1 haplotype has stretches not loaded',
    },
  ])
})

// frequency is depth over the haplotypes, so a node every haplotype passes
// drew narrower beside a placeholder and keyed "50% of haplotypes"
test('by frequency with nodes not loaded and no AF tag draws no thickness, as depth does', () => {
  const held = withNodes(load(NINE, 'GRCh38'), name =>
    name === 'a1' ? { placeholder: true } : {},
  )
  expect(drawnNodeWidth(held, 'frequency')).toBe('uniform')
  expect(
    keyOf(held, {}, { nodeWidth: 'frequency' }).find(s => s.id === 'node-width')
      ?.entries,
  ).toEqual([
    {
      key: 'width-not-drawn',
      text: 'thickness not drawn: 1 haplotype has stretches not loaded',
    },
  ])
  const tagged = withFrequencies(held, { v2: 0.875 })
  expect(drawnNodeWidth(tagged, 'frequency')).toBe('frequency')
})

// review 3: by depth with links by walks, both drawn uniform beside a
// placeholder, the note sat under "Node thickness"
test('the note that thickness is not drawn heads "Thickness" when neither nodes nor links draw it, and sits with the links when the nodes keep an AF scale', () => {
  const held = withNodes(load(NINE, 'GRCh38'), name =>
    name === 'a1' ? { placeholder: true } : {},
  )
  const placed = (g: Graph, nodeWidth: 'depth' | 'frequency') =>
    keyOf(
      g,
      { nodeWidth, edgeWidth: 'walks' },
      { nodeWidth, edgeWidth: 'walks' },
    )
      .filter(s => s.entries.length > 0)
      .flatMap(s =>
        s.entries.map(e => [s.group ?? s.id, e.key === 'width-not-drawn']),
      )
      .filter(([, note]) => note)
      .map(([group]) => group)
  expect(placed(held, 'depth')).toEqual(['Thickness'])
  expect(placed(withFrequencies(held, { v2: 0.875 }), 'frequency')).toEqual([
    'Link thickness',
  ])
})

// A segment no walk steps counted as one walk, its depth floored at 1, so
// thickness by walks drew it as one walk's pass
test('a node no walk steps has no pass, draws as a hairline by walks and keys as 0 walks', () => {
  const stray = load(`${GFA}\nS\tu1\tAAA\nL\tv3\t+\tu1\t+\t0M`, 'GRCh38')
  const u1 = stray.nodes.find(n => n.name === 'u1')!
  expect(u1.depth).toBe(0)
  const rebuilt = buildGeometry({
    ...layoutGeometryInputs(
      layoutModeByValue('ordered').run(stray, undefined)!,
      deletionDrawing(stray, deletionEdges(stray), true),
    ),
    graph: stray,
    nodeById: new Map(stray.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'walks',
    edgeWidth: 'walks',
    axis: axisScaleOf(1, false),
  })
  const run = rebuilt.nodeStrokeRuns.get(u1.id)!
  expect(2 * rebuilt.nodeStrokes[run.start]!.thickness).toBe(0.5)
  expect(scaleOf(thicknessKey(stray))?.map(([text]) => text)).toEqual([
    '2 walks',
    '1 walk',
    '0 walks',
  ])
})

// A cut can list a link no walk drawn takes, such as another haplotype's skip
// from v1 to v3, which draws at the floor of the walk thickness scale
test('a link no drawn walk takes keys its own row under link thickness, below the thinnest walked one', () => {
  const skipped = load(`${GFA}\nL\tv1\t+\tv3\t+\t0M`, 'GRCh38')
  const rows = keyOf(skipped, {}, { edgeWidth: 'walks' }).find(
    s => s.id === 'link-width',
  )!.entries
  const px = rows.map(e => (e.swatch?.kind === 'width' ? e.swatch.px : NaN))
  expect(rows.map(e => e.text)).toEqual(['1 walk', '0 walks'])
  expect(px[1]).toBeLessThan(px[0]!)
})

// The walk takes a+ to b+ and b+ to c+, and the inversion links between the
// same nodes took its walks as their own: drawn as thick as the links beside
// them, with no "0 walks" row to key them
const INVERSIONS = `S\ta\tACGT
S\tb\tGG
S\tc\tTTT
L\ta\t+\tb\t+\t0M
L\ta\t+\tb\t-\t0M
L\tb\t+\tc\t+\t0M
L\tb\t-\tc\t+\t0M
W\tref\t0\tchr1\t0\t9\t>a>b>c`

test('an inversion link no walk takes keys the "0 walks" row beside the link the walk takes', () => {
  const inversions = load(INVERSIONS, 'ref')
  expect(
    keyOf(inversions, {}, { edgeWidth: 'walks' })
      .find(s => s.id === 'link-width')!
      .entries.map(e => e.text),
  ).toEqual(['1 walk', '0 walks'])
})

test('an inversion link no walk takes draws at the floor, under the link the walk takes', () => {
  const inversions = load(INVERSIONS, 'ref')
  const { batch } = drawn(inversions, { edgeWidth: 'walks' })
  const thickness = (edge: number) =>
    batch.edgeCurves[batch.edgeCurveRuns.get(edge)!.start]!.thickness
  expect([0, 1, 2, 3].map(thickness)).toEqual([3, 0.25, 3, 0.25])
})

test("an inversion link no walk takes draws as a plain link, not in the walk's ribbon colour", () => {
  const inversions = load(INVERSIONS, 'ref')
  const { batch } = drawn(inversions, { drawPaths: true })
  const colors = [0, 1, 2, 3].map(
    e => batch.edgeCurves[batch.edgeCurveRuns.get(e)!.start]!.color,
  )
  expect(colors[0]).not.toBe(EDGE_DEFAULT_COLOR)
  expect(colors).toEqual([
    colors[0],
    EDGE_DEFAULT_COLOR,
    colors[0],
    EDGE_DEFAULT_COLOR,
  ])
})

// Path colours on with links by walks drew every walked link as ribbons of
// one width, under a key of the widths the links would have had
test('link thickness is not keyed where a ribbon per walk draws the links', () => {
  const shared = load(`${GFA}\nW\tb\t1\tchr6\t0\t9\t>v1>v2>v3`, 'GRCh38')
  const linkWidths = (drawPaths: boolean) =>
    keyOf(shared, { drawPaths, edgeWidth: 'walks' }, { edgeWidth: 'walks' })
      .find(s => s.id === 'link-width')
      ?.entries.map(e => e.text)
  expect(linkWidths(false)).toEqual(['2 walks', '1 walk'])
  expect(linkWidths(true)).toBeUndefined()
})

// A walk cut in two pieces that both step v1 passes it twice, and the key
// counted its records as walks: "3 walks" of two
test('a node more records than walks step is keyed by its walk passes', () => {
  const pieces = load(
    GFA.replace(
      'W\talt\t1\tchr6\t0\t13\t>v1>a1>v3',
      'W\talt\t1\tchr6\t0\t4\t>v1\nW\talt\t1\tchr6\t100\t113\t>v1>a1>v3',
    ),
    'GRCh38',
  )
  expect(pieces.paths).toHaveLength(3)
  expect(thicknessKey(pieces)?.entries.map(e => e.text)).toEqual([
    '3 walk passes',
    '2 walk passes',
    '1 walk pass',
  ])
})

// Three segments tagged DP:f:37.5, 12.2 and 40 under one P line keyed
// "40 walk passes"
test('depths are keyed as depths, stated or counted from walks', () => {
  const segments = (tag: (depth: number) => string) => [
    `S\ta\tAAAA${tag(37.5)}`,
    `S\tb\tCC${tag(12.2)}`,
    `S\tc\tGGG${tag(40)}`,
    'L\ta\t+\tb\t+\t0M',
    'L\tb\t+\tc\t+\t0M',
    'L\ta\t+\tc\t+\t0M',
  ]
  const stated = [
    ...segments(depth => `\tDP:f:${depth}`),
    'P\tGRCh38#0#chr6\ta+,b+,c+\t*',
  ].join('\n')
  const walked = [
    ...segments(() => ''),
    'W\tGRCh38\t0\tchr6\t0\t9\t>a>b>c',
    'W\talt\t1\tchr6\t0\t7\t>a>c',
  ].join('\n')
  const thicknesses = (g: Graph) =>
    keyOf(g)
      .find(s => s.id === 'node-width')
      ?.entries.map(e => e.text)
  expect(gfaTables(stated)).toBeUndefined()
  expect(thicknesses(loadGraph(stated, 'stated'))).toEqual([
    'depth 40',
    'depth 12',
  ])
  expect(gfaTables(walked)).toBeDefined()
  expect(loadGraph(walked, 'walked').depthStated).toBeUndefined()
  expect(thicknesses(loadGraph(walked, 'walked'))).toEqual([
    'depth 2',
    'depth 1',
  ])
  expect(thicknesses(load(walked, 'GRCh38'))).toEqual(['depth 2', 'depth 1'])
})

// R100k-02: none of the eight haplotypes asked for has a step in the window,
// five leaving GRCh38 across it, and the drawing was the plain reference that
// all eight matching GRCh38 would draw
test('the haplotypes asked for that the cut holds no step of are counted under the walks, by whether they leave the reference here', () => {
  const departure = (name: string) => ({
    name,
    hapStart: 0,
    ownBp: 1000,
    missingBp: 0,
    leavePos: 0,
    leaveReversed: false,
    leavePasses: 1,
    rejoinPos: 20_000,
    rejoinReversed: false,
    rejoinPasses: 1,
    fromSteps: false,
  })
  const away: Graph = {
    ...graph,
    departures: departureTable([
      departure('far#1#chr6'),
      departure('wide#2#chr6'),
    ]),
  }
  const note = (asked: string[]) =>
    entries(away, {}, { haplotypes: asked }).find(e => e.key === 'absent')
  expect(note(['alt#1'])).toBeUndefined()
  expect(note(['alt', 'far#1', 'wide#2', 'none#1'])).toMatchObject({
    text: 'of 4 haplotypes or samples, 2 have no step on GRCh38 chr6 here and 1 has no walk here',
  })
  expect(note(['far', 'none'])?.text).toBe(
    'of 2 samples, 1 has no step on GRCh38 chr6 here and 1 has no walk here',
  )
  expect(note(['alt#1', 'far#1'])?.text).toBe(
    '1 of 2 haplotypes has no step on GRCh38 chr6 here',
  )
  expect(note(['none#1', 'none#2'])?.text).toBe(
    '2 of 2 haplotypes have no walk here',
  )
  expect(note(['far#1'])?.swatch).toBeUndefined()
  expect(
    keyOf(away, {}, { haplotypes: ['far#1'] }).find(s =>
      s.entries.some(e => e.key === 'absent'),
    )?.group,
  ).toBe('Walks')
  expect(absentHaplotypesText(away, ['far#2'], 'GRCh38 chr1')).toBe(
    '1 of 1 haplotype has no walk here',
  )
})

test('the key groups digits the same whatever the host locale', () => {
  const asked = vi
    .spyOn(Number.prototype, 'toLocaleString')
    .mockImplementation(() => {
      throw new Error('digits were grouped by the host locale')
    })
  try {
    expect(tooSmallText(1234, 0, 56_789)).toBe(
      '1,234 nodes under 56,789 bp not drawn',
    )
    expect(unlabelledText({ count: 1200, smallest: 5, largest: 5 })).toBe(
      '1,200 unlabelled, each 5 bp',
    )
    expect(
      keyOf({ ...graph, paths: [] })
        .find(s => s.id === 'node-width')
        ?.entries.map(e => e.text),
    ).toEqual(['depth 2', 'depth 1'])
  } finally {
    asked.mockRestore()
  }
})

test('the halo, the strip tab, the edge marks and compress are keyed where they are drawn', () => {
  expect(keys(graph, {}, { halos: [{ whole: true }] })).not.toContain('halo')
  expect(keys(graph, {}, { halos: [{ whole: false }] })).toContain('halo')
  expect(keys(graph)).not.toContain('overhang')
  expect(keys(graph)).not.toContain('runs-past')
  expect(texts(graph, {}, { stripOverhangs: true })).toContain(
    "graph's reference continues past the pane edge",
  )
  const pastEdge = keyOf(graph, {}, { runsPastEdge: true })
  const runsPast = pastEdge
    .find(s => s.id === 'not-shown')!
    .entries.find(e => e.key === 'runs-past')!
  expect(runsPast.text).toBe('drawing continues above or below the pane')
  expect(runsPast.swatch).toEqual({ kind: 'overrun' })
  expect(pastEdge.map(s => s.id)).not.toContain('overhang')
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

// The thicknesses a node's thickness key reads: a node with an underlay of
// the walks not lifted is as thick as the underlay
function thicknessesKeyed(batch: RenderBatch) {
  const lanes = lanesOverUnderlays(batch)
  return new Set(
    batch.nodeStrokes.flatMap((n, i) =>
      n.placeholder || lanes.has(i) ? [] : [n.thickness],
    ),
  )
}

// The census: each key entry of a drawn mark's class against the marks of
// that class in the batch, which it classes by the strokes' own fields
// A cut with placeholders draws no thickness by walks or depth, and says why,
// wherever its placeholders lie
function census(
  sections: GraphKeySection[],
  batch: RenderBatch,
  s: Scene,
  g?: Graph,
) {
  const plain = batch.nodeStrokes.filter(
    n => n.walk === undefined && !n.placeholder,
  )
  const widths = thicknessesKeyed(batch)
  const lanes = new Set(batch.nodeStrokes.flatMap(n => n.walk ?? []))
  const skips = batch.edgeCurves.filter(e => e.skip && e.walk === undefined)
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
    ...(skips.some(e => e.dashed) ? ['deletion'] : []),
    ...(skips.some(e => !e.dashed) ? ['short-skip'] : []),
    ...(batch.nodeStrokes.some(n => n.placeholder) ? ['not-shown'] : []),
    ...(widths.size > 1 ? ['width-thickest', 'width-thinnest'] : []),
    ...(g?.paths?.length && g.nodes.some(n => n.placeholder)
      ? ['width-not-drawn']
      : []),
    ...(batch.collapsed?.sites.length || batch.collapsed?.tooShort.size
      ? ['too-small']
      : []),
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
        'a1+': at(1000, 1001, 2),
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
    expect(census(sections, batch, s, g)).toEqual({ extra: [], missing: [] })
  },
)

test.each(CUTS)(
  'the batch of %s states whether its node strokes vary in thickness as drawn whole, whatever a viewport culls',
  (_, g, scene) => {
    const s = scene(g)
    const { layout, batch } = drawn(g, s)
    const thicknesses = thicknessesKeyed(batch)
    expect(batch.nodeThicknessesVary).toBe(thicknesses.size > 1)
    const [id] = Object.keys(layout.nodePositions)
    const { batch: culled } = drawn(g, {
      ...s,
      layout,
      bounds: middleOf(layout, id!),
    })
    expect(culled.nodeStrokes.length).toBeLessThan(batch.nodeStrokes.length)
    expect(culled.nodeThicknessesVary).toBe(thicknesses.size > 1)
  },
)

test('the census fails on a planted extra entry and on a planted missing one', () => {
  const s = { width: 120 }
  const { layout, batch } = drawn(SKIPPED, s)
  const sections = graphKey(SKIPPED, layout, { marks: drawnMarks([batch]) })
  const planted: GraphKeySection[] = [
    ...sections,
    {
      id: 'not-shown',
      entries: [{ key: 'not-shown', text: NOT_LOADED_TEXT }],
    },
  ]
  expect(census(planted, batch, s).extra).toEqual(['not-shown'])
  const dropped = sections.filter(section => section.id !== 'skips')
  expect(census(dropped, batch, s).missing).toEqual(['deletion'])
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
  expect(tooSmallText(38, 4, 19)).toBe(
    '38 nodes and 4 skips under 19 bp not drawn',
  )
  expect(tooSmallText(1, 0, 1)).toBe('1 node under 1 bp not drawn')
  expect(tooSmallText(0, 2, 1250)).toBe('2 skips under 1,250 bp not drawn')
  expect(tooSmallText(3, 0, 19, 2)).toBe(
    '3 nodes under 19 bp not drawn; 2 skips too short on screen to draw',
  )
  expect(tooSmallText(0, 0, 0, 1)).toBe('1 skip too short on screen to draw')
  const { layout, batch } = drawn(SMALL, smallSites())
  expect(batch.collapsed?.sites.map(s => s.nodes)).toEqual([['a1+'], []])
  for (const { bp } of batch.collapsed?.sites ?? []) {
    expect(bp).toBeLessThan(3)
  }
  const sections = graphKey(SMALL, layout, { marks: drawnMarks([batch]) })
  const last = sections.at(-1)
  const under = Math.ceil(3 / batch.collapsed!.pxPerBp)
  for (const { bp } of batch.collapsed?.sites ?? []) {
    expect(bp).toBeLessThan(under)
  }
  expect(last).toEqual({
    id: 'too-small',
    entries: [
      {
        key: 'too-small',
        text: `1 node and 1 skip under ${under} bp not drawn`,
      },
    ],
  })
  // drawn as nodes or wide, no site folds; a skip its span on screen holds
  // no arch for is still counted apart
  for (const scene of [
    { ...smallSites(), smallSites: 'nodes' as const },
    { ...smallSites(), width: 60_000 },
  ]) {
    expect(texts(SMALL, scene)).not.toContainEqual(
      expect.stringMatching(/bp not drawn|too small to draw/),
    )
  }
  const dropped = sections.filter(s => s.id !== 'too-small')
  expect(census(dropped, batch, smallSites()).missing).toEqual(['too-small'])
})

const site = (nodes: string[], edges: number[], bp = 2): Site => ({
  nodes,
  edges,
  refName: 'chr',
  start: 0,
  end: 0,
  bp,
  x: 0,
  y: 0,
  count: 1,
  total: 1,
})

const foldOf = (sites: Site[], pxPerBp = 1): Fold => ({
  sites,
  nodes: new Set(sites.flatMap(s => s.nodes)),
  edges: new Set(sites.flatMap(s => s.edges)),
  siteOf: new Map(),
  pxPerBp,
  within: new Map(),
  through: new Map(),
  bridges: new Map(),
  runOf: new Map(),
  tooShort: new Map(),
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
  expect(text).toBe('3 nodes and 2 skips under 3 bp not drawn')
  const skipsOnly = drawnMarks([
    { ...panel, collapsed: foldOf([site([], [7])]) },
  ])
  expect(graphKey(SMALL, {}, { marks: skipsOnly }).at(-1)?.entries).toEqual([
    { key: 'too-small', text: '1 skip under 3 bp not drawn' },
  ])
  // the N is the fold's threshold, SMALL_SITE_PX at the reference's px a bp
  const at18 = drawnMarks([
    {
      ...panel,
      collapsed: foldOf([site(['a1'], [1], 18), site([], [7])], 3 / 19),
    },
    { ...panel, collapsed: foldOf([site(['a3'], [4], 6)], 3 / 19) },
  ])
  expect(at18.foldedUnderBp).toBe(19)
  expect(graphKey(SMALL, {}, { marks: at18 }).at(-1)?.entries[0]?.text).toBe(
    '2 nodes and 1 skip under 19 bp not drawn',
  )
})

// L6-amy zoomed in said "233 nodes under 4 bp not drawn" with none of them
// on the pane
test("the not-drawn line counts the sites folded where the view lies, under the fold's threshold", () => {
  const at = (x: number, nodes: string[], edges: number[], bp: number) => ({
    ...site(nodes, edges, bp),
    x,
  })
  const panel = {
    edgeCurves: [],
    nodeStrokes: [],
    collapsed: foldOf(
      [
        at(0, ['a1'], [1], 2),
        at(0, [], [7], 5),
        at(100, ['a2', 'a3'], [2, 3], 30),
        at(100, [], [8], 40),
      ],
      3 / 41,
    ),
  }
  const line = (view?: Bounds) =>
    graphKey(SMALL, {}, { marks: drawnMarks([panel], view) }).find(
      section => section.id === 'too-small',
    )?.entries[0]?.text
  expect(line()).toBe('3 nodes and 2 skips under 41 bp not drawn')
  expect(line({ minX: -1, maxX: 1, minY: -1, maxY: 1 })).toBe(
    '1 node and 1 skip under 41 bp not drawn',
  )
  expect(line({ minX: 99, maxX: 101, minY: -1, maxY: 1 })).toBe(
    '2 nodes and 1 skip under 41 bp not drawn',
  )
  expect(line({ minX: 40, maxX: 60, minY: -1, maxY: 1 })).toBeUndefined()
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
