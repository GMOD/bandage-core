import { figureSvg } from './figure'
import { figureData } from './figureData'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { THREAD_INK } from './graphKey'
import { layoutLabels } from './labelLayout'
import { layoutModeByValue } from './layoutModes'
import { LABEL_PAD, LABEL_PX, labelWidth } from './overlayLabels'
import { passBars } from './passBar'
import { anchorGraph } from './pathAnchoring'
import { abgrHex } from './renderer/colorBits'
import {
  LANE_HEADS_KEY,
  LANE_HEAD_HALO_PX,
  laneHeadInk,
} from './renderer/laneHeads'
import { walkLift } from './walkHighlight'

import type { GenePin } from './genes/genePins'
import type { LabelLayoutSource } from './labelLayout'
import type { LabelCandidate } from './overlayLabels'
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

test('each pass is named once on the graph, once along the bar and once in the key', () => {
  const { graph, layout, tables } = data('>f1>a>b>c>d>a>b>c>d>a>b>c>d>f2')
  expect(passLabelTexts(tables).toSorted()).toEqual([
    'pass 1',
    'pass 2',
    'pass 3',
  ])
  expect(tables.passes.text).toEqual(['pass 1', 'pass 2', 'pass 3'])
  expect(tables.passes.start).toEqual([10, 26, 42])
  const svg = figureSvg(graph, layout, { width: 600, walks: byPass })
  expect(svg).toContain('along its length')
  for (const name of ['pass 1', 'pass 2', 'pass 3']) {
    expect(svg.split(`>${name}</text>`)).toHaveLength(4)
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
    alleleDeletions: [],
    positionsVersion: 0,
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
