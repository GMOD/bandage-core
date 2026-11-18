import { figureSvg } from './figure'
import { figureData, walkRowInks } from './figureData'
import { figureScene } from './figureScene'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { THREAD_INK } from './graphKey'
import { layoutLabels } from './labelLayout'
import { liftedRowInks, rowInkAt, rowInkOf } from './layout/rowInks'
import { walkRows } from './layout/walkRows'
import { layoutModeByValue } from './layoutModes'
import { LABEL_PAD, LABEL_PX, labelWidth } from './overlayLabels'
import { passBarTree, passBars } from './passBar'
import { passLabelCandidates } from './passLabels'
import { anchorGraph } from './pathAnchoring'
import { fitTransform } from './pipeline'
import { abgrHex, hexAbgr } from './renderer/colorBits'
import {
  LANE_HEADS_KEY,
  LANE_HEAD_HALO_PX,
  laneHeadInk,
} from './renderer/laneHeads'
import { axisScaleOf } from './viewport'
import { walkLift } from './walkHighlight'

import type { El } from './el'
import type { GenePin } from './genes/genePins'
import type { LabelLayoutSource } from './labelLayout'
import type { LabelCandidate } from './overlayLabels'
import type { PassBar } from './passBar'
import type { PassLabelItem } from './passLabels'
import type { WalkLayer } from './walkEncoding'

const SEGMENTS = [
  'S\tf1\tAAAAAAAAAA',
  'S\ta\tCCCC',
  'S\tb\tGGGG',
  'S\tc\tTTTT',
  'S\td\tAAAA',
  `S\tp\t${'A'.repeat(400)}`,
  'S\tf2\tGGGGGGGGGG',
  'L\tf1\t+\ta\t+\t0M',
  'L\ta\t+\tb\t+\t0M',
  'L\tb\t+\tc\t+\t0M',
  'L\tc\t+\td\t+\t0M',
  'L\td\t+\ta\t+\t0M',
  'L\td\t+\tf2\t+\t0M',
  'L\tb\t+\tp\t+\t0M',
  'L\tp\t+\tc\t+\t0M',
  'L\td\t+\tc\t+\t0M',
  'W\tref\t0\tchr\t0\t26\t>f1>a>b>c>d>f2',
]

const HAP = 'hap#1#ctg'

function graphOf(walk: string) {
  return anchorGraph(
    convertGFAToGraph(
      parseGFA([...SEGMENTS, `W\thap\t1\tctg\t0\t*\t${walk}`].join('\n')),
    ),
    'ref',
  )
}

const byPass: WalkLayer[] = [
  { walk: 'ref#0#chr' },
  { walk: HAP, color: { field: 'pass' } },
]

function data(walk: string, walks = byPass) {
  const graph = graphOf(walk)
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  return {
    graph,
    layout,
    tables: figureData(graph, layout, { width: 600, height: 300, walks }),
  }
}

const passLabelTexts = (tables: ReturnType<typeof figureData>) =>
  tables.labels.text.filter((_, i) => tables.labels.kind[i] === 'pass')

test('a walk with no passes draws no bar and names no pass', () => {
  const { graph, layout, tables } = data('>f1>a>b>c>d>f2')
  expect(passLabelTexts(tables)).toEqual([])
  expect(tables.passes.walk).toEqual([])
  expect(tables.passRuns.walk).toEqual([])
  expect(passBars(walkLift(graph, byPass))).toEqual([])
  const svg = figureSvg(graph, layout, { width: 600, walks: byPass })
  expect(svg).not.toContain('along its length')
  expect(svg).not.toContain('pass 1')
})

test('each pass is named once on the graph by its name alone, and once along the bar and once in the key with the bp it steps again', () => {
  const { graph, layout, tables } = data('>f1>a>b>c>d>a>b>c>d>a>b>c>d>f2')
  expect(passLabelTexts(tables).toSorted()).toEqual([
    'pass 1',
    'pass 2',
    'pass 3',
  ])
  expect(tables.passes.text).toEqual([
    'pass 1 · 16 bp',
    'pass 2 · 16 bp',
    'pass 3 · 16 bp',
  ])
  expect(tables.passes.start).toEqual([10, 26, 42])
  const svg = figureSvg(graph, layout, { width: 600, walks: byPass })
  expect(svg).toContain('along its length')
  for (const name of ['pass 1', 'pass 2', 'pass 3']) {
    expect(svg.split(`>${name}</text>`)).toHaveLength(2)
    expect(svg.split(`>${name} · 16 bp</text>`)).toHaveLength(3)
  }
})

// The second pass reads 400 bp of its own between b and c
test('the bar colours only the stretches a pass steps again, however far the pass runs', () => {
  const { graph, tables } = data('>f1>a>b>c>d>a>b>p>c>d>a>b>c>d>f2')
  const bar = passBars(walkLift(graph, byPass))[0]!
  const { passes, passRuns } = tables
  expect(passes.start.map((s, i) => [s, passes.end[i]])).toEqual([
    [10, 26],
    [26, 442],
    [442, 458],
  ])
  expect(passRuns.start.map((s, i) => [s, passRuns.end[i]])).toEqual([
    [10, 26],
    [26, 34],
    [434, 442],
    [442, 458],
  ])
  expect(bar.runs.some(r => r.start < 434 && r.end > 34)).toBe(false)
  expect(passRuns.color[1]).toBe(passes.color[1])
})

test("a host's walk rows take each pass's colour from the figure's pass runs, as the core's rows do", () => {
  const { graph, tables } = data('>f1>a>b>c>d>a>b>p>c>d>a>b>c>d>f2')
  const { keys, passRuns } = tables
  const bars = walkRows(graph)!
  const all = [bars.reference, ...bars.rows]
  const hap = all.findIndex(r => r.name.startsWith(HAP))
  const offsets = [5, 20, 30, 200, 450]
  const inks = walkRowInks(
    keys,
    {
      name: all.map(r => r.name),
      bp: all.map(r => r.bp),
      contig: all.map(r => r.axis?.contig ?? null),
      contigStart: all.map(r => r.axis?.start ?? null),
      backward: all.map(r => !!r.axis?.reversed),
    },
    { row: offsets.map(() => hap), offset: offsets },
    { ...passRuns, key: passRuns.walk.map(w => keys.walk.indexOf(w)) },
  )
  const own = keys.stops[inks.key[hap]!]
  expect(inks.color).toEqual([
    own,
    passRuns.color[0],
    passRuns.color[1],
    own,
    passRuns.color[3],
  ])
  const ink = rowInkOf(
    all[hap]!,
    liftedRowInks(walkLift(graph, byPass)!.walks),
  )!
  expect(offsets.map(o => rowInkAt(ink, all[hap]!, o))).toEqual(inks.color)
})

test("a strip that draws the walk's row carries its passes, so the figure draws no pass bar for it", () => {
  const { graph, layout, tables } = data('>f1>a>b>c>d>a>b>p>c>d>a>b>c>d>f2')
  const rows = walkRows(graph)!
  const svg = figureSvg(graph, layout, {
    width: 600,
    walks: byPass,
    walkStrip: { rows },
  })
  expect(svg).not.toContain('along its length')
  const hap = svg
    .split('<g data-testid="graph-walk-')
    .find(
      g => g.includes(`id="strip-`) && g.includes(tables.passRuns.color[0]!),
    )
  expect(hap).toBeDefined()
  for (const color of new Set(tables.passRuns.color)) {
    expect(hap).toContain(`stop-color="${color}"`)
  }
  const elsewhere = figureSvg(graph, layout, {
    width: 600,
    walks: byPass,
    walkStrip: {
      rows: { ...rows, rows: rows.rows.filter(r => !r.name.startsWith(HAP)) },
    },
  })
  expect(elsewhere).toContain('along its length')
})

test('the reference walk lifted by pass gets no pass bar while the strip draws its row', () => {
  const graph = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          ...SEGMENTS.slice(0, -1),
          'W\tref\t0\tchr\t0\t42\t>f1>a>b>c>d>a>b>c>d>f2',
          'W\thap\t1\tctg\t0\t*\t>f1>a>b>c>d>f2',
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  const walks: WalkLayer[] = [{ walk: 'ref#0#chr', color: { field: 'pass' } }]
  const rows = walkRows(graph)!
  expect(figureSvg(graph, layout, { width: 600, walks })).toContain(
    'along its length',
  )
  expect(
    figureSvg(graph, layout, { width: 600, walks, walkStrip: { rows } }),
  ).not.toContain('along its length')
})

// The middle copy lacks b, so at this zoom b's second visit runs on the
// band's third thread
test("each thread's rows say its slot, its visit and its walk's pass, and a slot is not a visit", () => {
  const graph = graphOf('>f1>a>b>c>d>a>c>d>a>b>c>d>f2')
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  const { nodes, keys } = figureData(graph, layout, {
    width: 120,
    height: 300,
    walks: byPass,
  })
  const lane = keys.name.indexOf(HAP)
  const lift = walkLift(graph, byPass)!
  const visitPass = lift.walks.find(w => w.name === HAP)!.walkPasses!.visitPass
  const threads = nodes.node.flatMap((node, i) => {
    const visit = nodes.visit[i] ?? null
    return nodes.walk[i] === lane && visit !== null
      ? [{ node, visit, slot: nodes.pass[i], walkPass: nodes.walkPass[i] }]
      : []
  })
  expect(
    threads.filter(t => t.walkPass !== visitPass.get(t.node)![t.visit]),
  ).toEqual([])
  const slotIsNotVisit = threads.some(t => t.slot !== t.visit)
  expect(slotIsNotVisit).toBe(true)
  const plain = nodes.node.findIndex(
    (node, i) => node === 'f1+' && nodes.walk[i] === lane,
  )
  expect([nodes.visit[plain], nodes.walkPass[plain]]).toEqual([0, -1])
})

function pin(at: { x: number; y: number }): GenePin {
  return {
    gene: {
      name: 'AMY1A',
      refName: 'chr1',
      start: 0,
      end: 1200,
      strand: 1,
      exons: [],
    },
    exons: '',
    exonsByNode: [],
    nodeIds: new Set(['bb']),
    at,
    covered: 1,
    anchored: 1,
    body: [],
    onReference: true,
    walks: 1,
  }
}

function source(overrides: Partial<LabelLayoutSource>): LabelLayoutSource {
  return {
    paneWidth: 800,
    canvasHeight: 400,
    axisScale: { scaleX: 1, scaleY: 1 },
    translateX: 0,
    translateY: 0,
    contigThickness: 6,
    legendSize: { width: 0, height: 0 },
    drawnRowLabels: [],
    bubbleHalos: [],
    genePins: [],
    labelsNodeSizes: false,
    nodeLengths: new Map(),
    nodeById: undefined,
    graph: undefined,
    drawnInk: undefined,
    alleleDeletions: [],
    positionsVersion: 0,
    folded: undefined,
    ...overrides,
  }
}

const passAt = (
  text: string,
  at: { x: number; y: number },
): LabelCandidate<PassLabelItem> => ({
  item: { walk: HAP, pass: 0, ink: 0, at },
  x: at.x,
  y: at.y - 8,
  flipY: at.y + 8 + LABEL_PX,
  text,
  stack: 2,
  slide: labelWidth(text),
  nearest: at,
})

const boxOf = (l: { x: number; y: number; text: string }) => ({
  x0: l.x - labelWidth(l.text) / 2,
  x1: l.x + labelWidth(l.text) / 2,
  y0: l.y - LABEL_PX - LABEL_PAD,
  y1: l.y + LABEL_PAD,
})

test("a pass's name never lands on a gene's name or another pass's", () => {
  const at = { x: 300, y: 120 }
  const geneAlone = layoutLabels(source({ genePins: [pin(at)] })).genes[0]!
  const crowd = layoutLabels(
    source({
      genePins: [pin(at)],
      passLabels: [
        passAt('pass 1', { x: geneAlone.x, y: geneAlone.y + 8 }),
        passAt('pass 2', { x: geneAlone.x, y: geneAlone.y + 8 }),
        passAt('pass 3', { x: geneAlone.x, y: geneAlone.y + 8 }),
      ],
    }),
  )
  expect(crowd.genes.map(g => [g.x, g.y])).toEqual([[geneAlone.x, geneAlone.y]])
  expect(crowd.passes.map(p => p.text)).toEqual(['pass 1', 'pass 2', 'pass 3'])
  const boxes = [...crowd.genes, ...crowd.passes].map(boxOf)
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      expect(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0).toBe(
        false,
      )
    }
  }
})

const pointsOf = (d: string) =>
  [...d.matchAll(/[ML](-?[\d.]+)[ ,](-?[\d.]+)/g)].map(m => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }))

test("the key's heads swatch draws a head of the size, ink and halo the threads' heads are drawn with", () => {
  const { graph, layout, tables } = data('>f1>a>b>c>d>a>b>c>d>a>b>c>d>f2')
  const { arrows } = tables
  const drawn = arrows.walk.flatMap((walk, i) =>
    walk === null
      ? []
      : [
          {
            length: arrows.length[i]!,
            halfWidth: arrows.halfWidth[i]!,
            color: arrows.color[i]!,
          },
        ],
  )
  expect(drawn.length).toBeGreaterThan(0)
  const svg = figureSvg(graph, layout, { width: 600, walks: byPass })
  const entry = svg
    .split('<g ')
    .find(g => g.includes(`>${LANE_HEADS_KEY}</text>`))!
  const halo =
    /<path d="([^"]+)" fill="none" stroke="#ffffff" stroke-width="([\d.]+)"/.exec(
      entry,
    )
  expect(halo).not.toBeNull()
  expect(Number(halo![2])).toBe(2 * LANE_HEAD_HALO_PX)
  const head = /<path d="([^"]+)" fill="(#[0-9a-f]{6})"\/>/.exec(entry)!
  expect(head[2]).toBe(abgrHex(laneHeadInk(THREAD_INK, false)))
  const [tip, left, notch, right] = pointsOf(head[1]!)
  const { length, halfWidth } = drawn[0]!
  expect(tip!.x - left!.x).toBeCloseTo(length, 0)
  expect(right!.y - left!.y).toBeCloseTo(-2 * halfWidth, 0)
  expect(tip!.x - notch!.x).toBeCloseTo(length * 0.75, 0)
  expect(halo![1]).toBe(head[1])
})

test("figureData's arrows table marks the heads the canvas strokes a white halo under, and only those", () => {
  const walk = '>f1>a>b>c>d>a>b>c>d>a>b>c>d>f2'
  const { graph, layout, tables } = data(walk)
  const { arrows } = tables
  expect(arrows.halo).toHaveLength(arrows.x.length)
  const scene = figureScene(graph, layout, { walks: byPass })
  const pixelRows = layout.pixelRows ?? false
  const fit = fitTransform(scene.bounds, 600, 300, pixelRows)!
  const batch = scene.geometry(scene.lift, axisScaleOf(fit.scale, pixelRows))
  const haloed = batch.arrows
    .filter(a => a.halo)
    .map(a => `${a.x.toFixed(3)} ${a.y.toFixed(3)}`)
  expect(haloed.length).toBeGreaterThan(0)
  expect(
    arrows.x.flatMap((x, i) =>
      arrows.halo[i] ? [`${x.toFixed(3)} ${arrows.y[i]!.toFixed(3)}`] : [],
    ),
  ).toEqual(haloed)
  const plain = data(walk, [{ walk: 'ref#0#chr' }, { walk: HAP }]).tables
  expect(plain.arrows.halo.some(Boolean)).toBe(false)
})

const BAR: PassBar = {
  walk: HAP,
  bp: 1000,
  ownInk: hexAbgr('#888888'),
  bundled: false,
  runs: [
    { pass: 0, start: 0, end: 100, ink: hexAbgr('#d55e00') },
    { pass: 1, start: 100, end: 120, ink: hexAbgr('#0072b2') },
    { pass: 1, start: 900, end: 1000, ink: hexAbgr('#0072b2') },
  ],
  passes: [
    {
      pass: 0,
      start: 0,
      end: 100,
      repeatBp: 100,
      againBp: 0,
      reversedBp: 0,
      reversed: false,
      text: 'pass 1',
      ink: hexAbgr('#d55e00'),
    },
    {
      pass: 1,
      start: 100,
      end: 1000,
      repeatBp: 120,
      againBp: 120,
      reversedBp: 0,
      reversed: false,
      text: 'pass 2',
      ink: hexAbgr('#0072b2'),
    },
  ],
}

function elements(tree: El | string): El[] {
  return typeof tree === 'string'
    ? []
    : [tree, ...tree.children.flatMap(elements)]
}

const spanOf = (d: string) => {
  const xs = [...d.matchAll(/[MH](-?[\d.]+)/g)].map(m => Number(m[1]))
  return [
    xs.reduce((least, x) => Math.min(least, x), Infinity),
    xs.reduce((most, x) => Math.max(most, x), -Infinity),
  ]
}

// 1000 bp over 1000 px past a 12 px side
test('the bar colours each run and brackets each pass along its runs, joined by a dotted hairline and named over its longest run', () => {
  const tree = elements(passBarTree(BAR, HAP, 1024))
  const stretches = tree
    .filter(e => e.tag === 'rect' && e.attrs.fill !== '#888888')
    .map(e => [e.attrs.x, e.attrs.width])
  expect(stretches).toEqual([
    [12, 100],
    [112, 20],
    [912, 100],
  ])
  const strokes = (ink: string) =>
    tree.filter(e => e.tag === 'path' && e.attrs.stroke === ink)
  const solid = (ink: string) =>
    strokes(ink)
      .filter(e => e.attrs['stroke-dasharray'] === undefined)
      .map(e => spanOf(String(e.attrs.d)))
  const dotted = (ink: string) =>
    strokes(ink)
      .filter(e => e.attrs['stroke-dasharray'] !== undefined)
      .map(e => spanOf(String(e.attrs.d)))
  expect(solid('#d55e00')).toEqual([[12, 112]])
  expect(dotted('#d55e00')).toEqual([])
  expect(solid('#0072b2')).toEqual([
    [112, 132],
    [912, 1012],
  ])
  expect(dotted('#0072b2')).toEqual([[132, 912]])
  const name = tree.find(e => e.tag === 'text' && e.children[0] === 'pass 2')
  expect(name?.attrs.x).toBe(962)
})

test("figureData's passes say how much of each pass is sequence the walk steps again", () => {
  const { tables } = data('>f1>a>b>c>d>a>b>p>c>d>a>b>c>d>f2')
  expect(tables.passes.repeatBp).toEqual([16, 16, 16])
  expect(tables.passes.end[1]! - tables.passes.start[1]!).toBe(416)
})

test("figureData's passes say how much of each pass reads again what the walk read before, and how much of that on the other strand, with no word for it in the name", () => {
  const { tables } = data('>f1>a>b>c>d<d<c<b<a>f2')
  expect(tables.passes.text).toEqual(['pass 1 · 16 bp', 'pass 2 · 16 bp'])
  expect(tables.passes.againBp).toEqual([0, 16])
  expect(tables.passes.reversedBp).toEqual([0, 16])
  expect(tables.passes.reversed).toEqual([false, true])
})

test("each pass's name stands beside a point of its own pass's thread, in its own pass's ink", () => {
  const graph = graphOf('>f1>a>b>c>d>a>b>c>d>a>b>c>d>f2')
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  const scene = figureScene(graph, layout, { walks: byPass })
  const fit = fitTransform(scene.bounds, 600, 300, false)!
  const axis = { scaleX: fit.scale, scaleY: fit.scale }
  const batch = scene.geometry(scene.lift, axis)
  const t = { ...axis, translateX: fit.translateX, translateY: fit.translateY }
  const candidates = passLabelCandidates(batch, scene.lift, t, {
    width: 600,
    height: 300,
  })
  const lane = scene.lift!.walks.findIndex(w => w.name === HAP)
  const drawn = scene.lift!.walks[lane]!.walkPasses!
  expect(candidates.map(c => c.item.pass)).toEqual([0, 1, 2])
  for (const { item } of candidates) {
    expect(item.ink).toBe(drawn.passes[item.pass]?.ink)
    const under = batch.nodeStrokes.filter(s => {
      const middle = s.points[s.points.length >> 1]
      return (
        s.walk === lane &&
        middle !== undefined &&
        Math.hypot(
          middle.x * t.scaleX + t.translateX - item.at.x,
          middle.y * t.scaleY + t.translateY - item.at.y,
        ) < 1e-6
      )
    })
    expect(under.map(s => s.walkPass)).toEqual([item.pass])
  }
})

test('a faceted figure names no pass and draws no bar, in figureSvg as in figureData', () => {
  const walk = '>f1>a>b>c>d>a>b>c>d>a>b>c>d>f2'
  const graph = graphOf(walk)
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  const faceted = { width: 600, walks: byPass, facet: 'walk' as const }
  const svg = figureSvg(graph, layout, faceted)
  expect(svg).not.toContain('along its length')
  expect(svg).not.toMatch(/>pass \d/)
  const tables = figureData(graph, layout, { ...faceted, height: 300 })
  expect(tables.nodes.walkPass.some(p => p !== null && p >= 0)).toBe(true)
  expect(passLabelTexts(tables)).toEqual([])
  expect(tables.passes.walk).toEqual([])
  expect(tables.passRuns.walk).toEqual([])
})
