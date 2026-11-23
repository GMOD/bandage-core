import { COMPRESSED_KEY } from './bubbleSpreads'
import { BUBBLE_HALO_COLOR } from './bubbles/bubbleLabel'
import { deletionKey } from './deletionEdges'
import { drawnEdgeWidth } from './edgeWidths'
import { EXON_COLOR } from './genes/exonOutline'
import { NOT_LOADED_TEXT } from './gfa/departures'
import { formatBp, groupDigits } from './graphLabels'
import { foldedUnderBp, nodesNotDrawn } from './levelOfDetail'
import {
  MIN_WALKS_PX,
  UNWALKED_PX,
  countLaneWidthPx,
  depthKey,
  drawnNodeWidth,
  frequencyKey,
  haplotypeOf,
  passesAtContigThickness,
  walksPx,
} from './nodeWidths'
import { panSNHaplotype, panSNMatchesPrefix } from './pansn'
import { pathOrigin } from './pathAnchoring'
import { referenceLabel } from './reference'
import {
  REFERENCE_RAMP_LIGHTNESS,
  REFERENCE_RAMP_SATURATION,
  rampHueAt,
} from './referenceRampCss'
import {
  EDGE_DEFAULT_COLOR,
  EDGE_DELETION_COLOR,
  FADED_ALPHA,
  LIFT_BACKDROP_COLOR,
  NOT_LOADED_COLOR,
  NOT_LOADED_FILL_COLOR,
  NOT_LOADED_RIM_PX,
  REFERENCE_RAMP_ALT_COLOR,
  packHsl,
  rampFraction,
} from './renderer/GeometryBuilder'
import { fadeAbgr, hexAbgr, packAbgr } from './renderer/colorBits'
import { LANE_HEADS_AGAINST_KEY, LANE_HEADS_KEY } from './renderer/laneHeads'
import { passesKey } from './renderer/walkLanes'
import { threadFoldKey, threadLabel } from './threadKey'
import { curvePointAt } from './util/geometry'
import { addTo } from './util/groups'
import { segmentMeetsBox } from './util/hitDetection'
import { encodingStops } from './walkEncoding'
import { fadedKey } from './walkHighlight'
import { rangeText, walkKey } from './walkKey'

import type { EdgeWidth } from './edgeWidths'
import type { GenePin } from './genes/genePins'
import type { UnlabelledPlaceholders } from './graphLabels'
import type { NodeWidth } from './nodeWidths'
import type { Bounds } from './pipeline'
import type { ReferenceRamp } from './renderer/GeometryBuilder'
import type { RenderBatch } from './renderer/types'
import type { Graph, LayoutResult } from './types'
import type { BezierCurve } from './util/geometry'
import type { LiftedWalk, WalkLift } from './walkHighlight'

// The graph's key as data: what each mark the drawing holds means, in the
// order every reader stacks it, each entry only where the drawing holds a
// member of its class. Colours are packed ABGR (renderer/colorBits.ts), which
// a reader turns into its own colour syntax.

export interface KeyStop {
  offset: number
  ink: number
}

export type GraphKeySwatch =
  // a short bar of a scale
  | { kind: 'scale'; stops: KeyStop[] }
  // a walk's one colour, as a short bar
  | { kind: 'swatch'; ink: number }
  // a colour alone, as a square chip
  | { kind: 'chip'; ink: number }
  // a node or link as thick as the drawing makes it, `px` across
  | { kind: 'width'; ink: number; px: number }
  // a node the cut did not load, hollow in its rim
  | { kind: 'hollow'; ink: number; rim: number; rimPx: number }
  // a link's stroke, dashed for a skip
  | { kind: 'line'; ink: number; dashed: boolean }
  | { kind: 'outline'; ink: number }
  | { kind: 'halo'; ink: number }
  // a lane's threads side by side, one per pass through a node
  | { kind: 'threads'; ink: number }
  // heads along a lane
  | { kind: 'heads'; ink: number; haloed: boolean }
  // the reference strip's tab past its edge
  | { kind: 'overhang' }
  // the marks where the drawing runs past the pane's top or bottom
  | { kind: 'overrun' }

// An entry with no swatch is a note on the drawing
export interface GraphKeyEntry {
  key: string
  text: string
  // the walk's name, ahead of the text
  strong?: string
  // the line under it: the stretch a scale runs over
  under?: string
  // more than fits, for a reader with a hover
  hover?: string
  swatch?: GraphKeySwatch
  walk?: LiftedWalk
}

export type GraphKeySectionId =
  | 'ramp'
  | 'walks'
  | 'node-width'
  | 'link-width'
  | 'halo'
  | 'links'
  | 'skips'
  | 'not-shown'
  | 'exon'
  | 'overhang'
  | 'compressed'
  | 'too-small'

export interface GraphKeySection {
  id: GraphKeySectionId
  // the group a reader may head the section with: a thickness's entries are
  // counts that read only under it
  group?:
    | 'Color'
    | 'Walks'
    | 'Thickness'
    | 'Node thickness'
    | 'Link thickness'
    | 'Marks'
  entries: GraphKeyEntry[]
}

// The lane strokes of nodes drawn with an underlay of the walks not lifted:
// such a node is as thick as its underlay, which is what its thickness keys
export function lanesOverUnderlays(
  batch: Pick<RenderBatch, 'nodeStrokes'> &
    Partial<Pick<RenderBatch, 'nodeStrokeRuns'>>,
) {
  const lanes = new Set<number>()
  for (const { start, count } of batch.nodeStrokeRuns?.values() ?? []) {
    const run = batch.nodeStrokes.slice(start, start + count)
    if (run.some(s => s.faded) && run.some(s => s.walk !== undefined)) {
      for (const [k, s] of run.entries()) {
        if (s.walk !== undefined) {
          lanes.add(start + k)
        }
      }
    }
  }
  return lanes
}

// The classes of mark a drawing's batches hold, which the key names: a skip,
// dashed however short; a node hollow for the bp a cut did not load; a node or link in
// no lifted walk's lane, which under a lift is faded; a node in the
// off-reference charcoal, plain or in a lane; a lane's second thread through a
// node; nodes of more than one thickness; each lifted walk's passes, by lane;
// heads along a lane, pointing back along a node or either way; links drawn
// as a ribbon per walk; the nodes and skips folded as too small to draw. A
// lifted walk's lane on a skip is its walk's, keyed by the walk. Where a pane
// shows part of the drawing, `view`, in layout units, a mark counts only where
// a stroke of it meets the view, a folded site only where its place lies in
// it, and `nodes` holds the nodes a stroke of their own draws there, which the
// key's node thicknesses and exons are read off. Whether the nodes vary in
// thickness is the whole drawing's, as the batch states it for nodes a
// viewport culled too, so a view of one thickness still keys what it shows,
// and so is whether its links are ribbons.
export function drawnMarks(
  batches: readonly (Pick<RenderBatch, 'edgeCurves' | 'nodeStrokes'> &
    Partial<
      Pick<
        RenderBatch,
        | 'arrows'
        | 'collapsed'
        | 'nodeStrokeRuns'
        | 'laneOnly'
        | 'nodeThicknessesVary'
        | 'countedLanes'
        | 'pathRibbons'
      >
    >)[],
  view?: Bounds,
) {
  const marks = {
    dashedSkip: false,
    placeholder: false,
    plainNode: false,
    plainLink: false,
    offReference: false,
    threads: false,
    widthsVary: false,
    ribbons: false,
    passes: new Map<number, Set<number>>(),
    headsAgainst: false,
    headsAlong: false,
    headsHaloed: false,
    runsOn: false,
    foldedNodes: new Set<string>(),
    foldedSkips: new Set<number>(),
    foldedUnderBp: 0,
    nodes: undefined as Set<string> | undefined,
    view,
  }
  const inView = (points: readonly { x: number; y: number }[]) =>
    !view || lineMeetsView(points, view)
  const curveInView = ({ curves }: { curves: readonly BezierCurve[] }) =>
    !view || curves.some(curve => curveMeetsView(curve, view))
  let width: number | undefined
  for (const batch of batches) {
    const { nodeStrokeRuns, nodeStrokes, collapsed } = batch
    const shown = nodeStrokes.map(stroke => inView(stroke.points))
    if (nodeStrokeRuns) {
      const notDrawn = nodesNotDrawn(batch)
      const nodes = (marks.nodes ??= new Set())
      for (const [id, { start, count }] of nodeStrokeRuns) {
        let drawn = false
        for (let i = start; i < start + count && !drawn; i++) {
          drawn = shown[i]! && !nodeStrokes[i]!.placeholder
        }
        if (drawn && !notDrawn.has(id)) {
          nodes.add(id)
        }
      }
    }
    const arrows = (batch.arrows ?? []).filter(a => inView([a]))
    const edgeCurves = batch.edgeCurves.filter(curveInView)
    const underLanes = lanesOverUnderlays(batch)
    for (const [i, { placeholder, thickness, walk }] of nodeStrokes.entries()) {
      const counted = batch.countedLanes && walk !== undefined
      if (!placeholder && !underLanes.has(i) && !counted) {
        marks.widthsVary ||= width !== undefined && width !== thickness
        width = thickness
      }
    }
    marks.widthsVary ||= !!batch.nodeThicknessesVary
    marks.ribbons ||= !!batch.pathRibbons
    const sites = (collapsed?.sites ?? []).filter(site => inView([site]))
    marks.foldedUnderBp = Math.max(
      marks.foldedUnderBp,
      foldedUnderBp({ sites, pxPerBp: collapsed?.pxPerBp ?? 0 }),
    )
    for (const { nodes, edges } of sites) {
      for (const id of nodes) {
        marks.foldedNodes.add(id)
      }
      for (const edge of nodes.length === 0 ? edges : []) {
        marks.foldedSkips.add(edge)
      }
    }
    for (const { skip, walk } of edgeCurves) {
      if (walk === undefined) {
        if (skip) {
          marks.dashedSkip = true
        } else {
          marks.plainLink = true
        }
      }
    }
    const shownStrokes = nodeStrokes.filter((_, i) => shown[i])
    for (const { placeholder, walk, pass = 0, color } of shownStrokes) {
      if (placeholder) {
        marks.placeholder = true
      } else {
        marks.plainNode ||= walk === undefined
      }
      if (color === REFERENCE_RAMP_ALT_COLOR) {
        marks.offReference = true
      }
      if (pass > 0) {
        marks.threads = true
      }
    }
    for (const strokes of [edgeCurves, shownStrokes]) {
      for (const { walk, walkPass = -1 } of strokes) {
        if (walk !== undefined && walkPass >= 0) {
          addTo(marks.passes, walk, walkPass)
        }
      }
    }
    for (const { walk, against, halo, runsOn } of arrows) {
      if (walk !== undefined) {
        marks.headsAgainst ||= !!against
        marks.headsAlong ||= !against
        marks.headsHaloed ||= !!halo
      }
      marks.runsOn ||= !!runsOn
    }
  }
  return marks
}

export type DrawnMarks = ReturnType<typeof drawnMarks>

const CURVE_SAMPLES = Array.from({ length: 9 }, (_, i) => i / 8)

// Whether a curve meets the view: at once where its control points lie all
// outside it on one side or all inside it, else by points along it
function curveMeetsView(c: BezierCurve, view: Bounds) {
  const xs = [c.x0, c.cx0, c.cx1, c.x1]
  const ys = [c.y0, c.cy0, c.cy1, c.y1]
  return xs.every(x => x < view.minX) ||
    xs.every(x => x > view.maxX) ||
    ys.every(y => y < view.minY) ||
    ys.every(y => y > view.maxY)
    ? false
    : (xs.every(x => x >= view.minX && x <= view.maxX) &&
        ys.every(y => y >= view.minY && y <= view.maxY)) ||
        lineMeetsView(
          CURVE_SAMPLES.map(t => curvePointAt(c, t)),
          view,
        )
}

// Whether a line, or a lone point, meets the view: at once where its bounds
// lie outside the view or inside it, else by its segments
function lineMeetsView(
  points: readonly { x: number; y: number }[],
  view: Bounds,
) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const box = { x0: view.minX, x1: view.maxX, y0: view.minY, y1: view.maxY }
  return maxX < view.minX ||
    minX > view.maxX ||
    maxY < view.minY ||
    minY > view.maxY
    ? false
    : (minX >= view.minX &&
        maxX <= view.maxX &&
        minY >= view.minY &&
        maxY <= view.maxY) ||
        points.some((b, i) => i > 0 && segmentMeetsBox(points[i - 1]!, b, box))
}

export interface GraphKeyOptions {
  // the window the graph was cut for, which names the reference
  region?: { refName: string }
  // what the key calls the reference, referenceLabel's where absent
  referenceName?: string
  // the ramp the drawing paints nodes by reference position with
  referenceRamp?: ReferenceRamp
  lift?: WalkLift
  // a lift per facet panel, whose titles key their walks
  panels?: readonly WalkLift[]
  walkLabel?: (name: string) => string
  nodeWidth?: NodeWidth
  contigThickness?: number
  edgeWidth?: EdgeWidth
  connectorThickness?: number
  // whether the layout draws nodes, as a tube map and walk rows' bars do not
  drawsNodes?: boolean
  // the marks the drawing holds: drawnMarks of its batches
  marks: DrawnMarks
  genePins?: readonly GenePin[]
  // where the genes came from, named after their outline's entry
  genesFrom?: string
  halos?: readonly { whole: boolean }[]
  // the reference strip has a tab past an edge
  stripOverhangs?: boolean
  // the drawing runs past the pane's top or bottom, marked on that edge
  // (trackFit's edgeOverruns)
  runsPastEdge?: boolean
  // the haplotypes the cut was asked for, `sample#haplotype` or a sample:
  // those it holds no step of are counted in a note under the walks
  haplotypes?: readonly string[]
  // the placeholders the labels left without a length: layoutLabels'
  // `unlabelled`. A host that sizes its pane by the key before it places the
  // labels passes 'reserved': the line under is kept, blank, whenever
  // placeholders are drawn, for unlabelledText to fill once they are placed,
  // so no label can change the key's height
  unlabelled?: UnlabelledPlaceholders | 'reserved'
}

// faded strokes paint as one layer, so the key's ink is exactly theirs
export const FADED_KEY_INK = fadeAbgr(LIFT_BACKDROP_COLOR, FADED_ALPHA)
// what a tab past a node's free end says (renderer/runsOn.ts)
export const RUNS_ON_KEY = 'graph runs on past what is drawn'
export const EXON_INK = hexAbgr(EXON_COLOR)
const HALO_INK = hexAbgr(BUBBLE_HALO_COLOR)
export const THREAD_INK = packAbgr(68, 68, 68, 255)

// The reference-position ramp as a key's stops, one per 50 degrees of hue
export const RAMP_KEY_STOPS: KeyStop[] = Array.from({ length: 7 }, (_, i) => ({
  offset: i / 6,
  ink: packHsl(
    rampHueAt(i / 6),
    REFERENCE_RAMP_SATURATION,
    REFERENCE_RAMP_LIGHTNESS,
  ),
}))

const entry = (
  key: string,
  text: string,
  swatch?: GraphKeySwatch,
): GraphKeyEntry => (swatch ? { key, text, swatch } : { key, text })

const counted = (n: number, one: string, many: string) =>
  `${groupDigits(n)} ${n === 1 ? one : many}`

export function unlabelledText(unlabelled?: UnlabelledPlaceholders) {
  const n = unlabelled && groupDigits(unlabelled.count)
  return !unlabelled
    ? ''
    : unlabelled.count === 1
      ? `${n} unlabelled, ${formatBp(unlabelled.largest)}`
      : unlabelled.smallest === unlabelled.largest
        ? `${n} unlabelled, each ${formatBp(unlabelled.largest)}`
        : `${n} unlabelled, ${formatBp(unlabelled.largest)} or less each`
}

export function tooSmallText(nodes: number, skips: number, underBp = 0) {
  const parts = [
    ...(nodes > 0 ? [counted(nodes, 'node', 'nodes')] : []),
    ...(skips > 0 ? [counted(skips, 'skip', 'skips')] : []),
  ]
  return underBp > 0
    ? `${parts.join(' and ')} under ${counted(underBp, 'bp', 'bp')} not drawn`
    : `${parts.join(' and ')} too small to draw`
}

// The haplotypes asked for that the graph holds no step of, counted by
// whether the cut states a departure of theirs over the window, which says
// they leave the reference across it, or none, so no walk of theirs is near:
// `of 8 haplotypes, 5 have no step on GRCh38 chr1 here and 3 have no walk
// here`. Undefined where every one has a step.
export function absentHaplotypesText(
  graph: Graph,
  asked: readonly string[],
  reference: string,
) {
  const absent = asked.filter(
    prefix => !graph.paths?.some(path => panSNMatchesPrefix(path.name, prefix)),
  )
  const departing = absent.filter(prefix =>
    graph.departures?.names.some(name => panSNMatchesPrefix(name, prefix)),
  ).length
  const walkless = absent.length - departing
  const have = (n: number) => (n === 1 ? 'has' : 'have')
  const noStep = `no step on ${reference} here`
  const noWalk = 'no walk here'
  const of = `of ${counted(asked.length, 'haplotype', 'haplotypes')}`
  return absent.length === 0
    ? undefined
    : departing > 0 && walkless > 0
      ? `${of}, ${departing} ${have(departing)} ${noStep} and ${walkless} ${have(walkless)} ${noWalk}`
      : `${absent.length} ${of} ${have(absent.length)} ${departing > 0 ? noStep : noWalk}`
}

// The walks scale's swatches: the haplotypes the drawing is of, each walk
// once, half of them, and one walk, all at the px a pass draws; the thickest
// drawn node's passes first where a repeat takes it past every walk once.
// Under MIN_WALKS_PX a width is drawn at it, so the thinnest swatch says how
// many walks that floor holds and a swatch the floor swallows is left out.
// The haplotypes are those with a walk in the graph and those asked for that
// have none, so a window none of them steps in keys the scale they would
// draw on.
export function walkScaleEntries(
  graph: Graph,
  o: Pick<GraphKeyOptions, 'haplotypes' | 'marks'>,
  contigThickness: number,
) {
  const perPass = contigThickness / passesAtContigThickness(graph)
  const haplotypes = new Set(graph.paths?.map(haplotypeOf))
  const asked = (o.haplotypes ?? []).filter(
    prefix => !graph.paths?.some(path => panSNMatchesPrefix(path.name, prefix)),
  )
  const all = Math.max(1, haplotypes.size + asked.length)
  let most = 0
  for (const node of graph.nodes) {
    if (!node.placeholder && (!o.marks.nodes || o.marks.nodes.has(node.id))) {
      most = Math.max(most, node.depth)
    }
  }
  const floorHolds = Math.max(1, Math.floor(MIN_WALKS_PX / perPass + 1e-9))
  const counts = [
    ...(most > all ? [most] : []),
    all,
    Math.round(all / 2),
    1,
  ].filter((n, i, ns) => ns.indexOf(n) === i && (n === 1 || n > floorHolds))
  return counts.map(n => ({
    key: n === 1 ? 'width-1' : n === most && most > all ? 'width-passes' : `width-${n}`,
    text:
      n === 1
        ? floorHolds > 1
          ? `1 to ${floorHolds} walks`
          : '1 walk'
        : n === most && most > all
          ? counted(n, 'walk pass', 'walk passes')
          : counted(n, 'walk', 'walks'),
    px: walksPx(n, perPass),
  }))
}

// Why the nodes are drawn uniform under `walks`: the haplotypes whose walks
// hold nodes the cut did not load, whose passes no thickness could count
export function notLoadedThicknessText(graph: Graph) {
  const placeholders = new Set(
    graph.nodes.filter(node => node.placeholder).map(node => node.id),
  )
  const haplotypes = new Set(
    (graph.paths ?? [])
      .filter(path => path.nodeIds.some(id => placeholders.has(id)))
      .map(haplotypeOf),
  )
  return `thickness not drawn: ${counted(haplotypes.size, 'haplotype has', 'haplotypes have')} stretches not loaded`
}

const roundDepth = (depth: number) =>
  depth >= 10 ? Math.round(depth) : Math.round(depth * 10) / 10

const keyStops = (walk: LiftedWalk) =>
  encodingStops(walk.encoding).map(({ offset, abgr }) => ({
    offset,
    ink: abgr,
  }))

// A pick's name in a thread's entry: the host's label for it, or where the
// host has none, as for a walk the fold merged into a thread, its haplotype
const pickLabel = (labelOf: (name: string) => string) => (name: string) => {
  const label = labelOf(name)
  return label === name ? (panSNHaplotype(name) ?? name) : label
}

// A lifted walk's entry: a short bar of its colour or of the scale its lane
// shades by, its name and what its pieces leave out, and the stretch the scale
// runs over
export function walkKeyEntry(
  walk: LiftedWalk,
  label: string,
  reference: { name?: string; start: number; end: number } | undefined,
  labelOf: (name: string) => string = name => name,
): GraphKeyEntry {
  const key = walkKey(walk, reference)
  const stops = keyStops(walk)
  const thread = walk.count !== undefined
  return {
    key: `walk-${walk.name}`,
    strong: thread
      ? threadLabel(
          walk,
          walk.members?.[0] === undefined ? label : labelOf(walk.members[0]),
          walk.picked?.map(pickLabel(labelOf)),
        )
      : label,
    text: key.gaps,
    under: key.scale,
    hover: thread && walk.count !== 1 ? walk.variation : key.hover,
    swatch:
      stops.length > 1
        ? { kind: 'scale', stops }
        : thread
          ? {
              kind: 'width',
              ink: stops[0]!.ink,
              px: countLaneWidthPx(walk.count ?? 1),
            }
          : { kind: 'swatch', ink: stops[0]!.ink },
    walk,
  }
}

export function graphKey(
  graph: Graph,
  layout: Pick<LayoutResult, 'tubeMap' | 'compressed'>,
  o: GraphKeyOptions,
) {
  const reference =
    o.referenceName ?? referenceLabel(graph, o.region) ?? 'the reference'
  const label = o.walkLabel ?? ((name: string) => name)
  const drawsNodes = o.drawsNodes ?? !layout.tubeMap
  const lifts = o.panels ?? (o.lift ? [o.lift] : [])
  const lifted = lifts.length > 0
  const ramp = o.referenceRamp
  const thickness = o.contigThickness ?? 6
  const connector = o.connectorThickness ?? 2

  const offReference = (key: string) =>
    entry(key, `off ${reference}`, {
      kind: 'chip',
      ink: REFERENCE_RAMP_ALT_COLOR,
    })
  const rampEntries: GraphKeyEntry[] =
    ramp && !lifted
      ? [
          {
            key: 'ramp',
            text: `position on ${reference}`,
            under: rangeText(undefined, ramp.start, ramp.start + ramp.span),
            swatch: { kind: 'scale', stops: RAMP_KEY_STOPS },
          },
          ...((
            layout.tubeMap
              ? graph.nodes.some(
                  n => !n.placeholder && rampFraction(n, ramp) === undefined,
                )
              : drawsNodes && o.marks.offReference
          )
            ? [offReference('off')]
            : []),
        ]
      : []

  const walksLabel = (lift: WalkLift) =>
    lift.walks.length === 1 ? label(lift.walks[0]!.name) : 'these walks'
  const fadedTexts = new Set(
    lifts.flatMap(
      lift =>
        fadedKey(
          graph,
          lift,
          o.panels ? "the panel's walk" : walksLabel(lift),
        ) ?? [],
    ),
  )
  // a faded node keyed by what it is, else the faded links alone
  const fadedNode = lifted && o.marks.plainNode && fadedTexts.size > 0
  const faded = fadedNode
    ? [
        entry(
          'faded',
          fadedTexts.size > 1 ? "not on the panel's walk" : [...fadedTexts][0]!,
          { kind: 'chip', ink: FADED_KEY_INK },
        ),
      ]
    : lifted && o.marks.plainLink
      ? [
          entry(
            'faded-links',
            `links not on ${o.panels ? "the panel's walk" : walksLabel(lifts[0]!)}`,
            { kind: 'line', ink: FADED_KEY_INK, dashed: false },
          ),
        ]
      : []
  const domain = o.lift?.referenceDomain
  const walkReference = domain && { ...domain, name: reference }
  const passEntries = (walk: LiftedWalk, lane: number) => {
    const drawn = walk.walkPasses
    const shown = o.marks.passes.get(lane)
    return !drawn || !shown?.size
      ? []
      : drawn.bundled
        ? drawn.passes
            .slice(0, 1)
            .map(({ title, ink }) =>
              entry(`passes-${walk.name}`, title, { kind: 'swatch', ink }),
            )
        : drawn.passes.flatMap(({ title, ink }, pass) =>
            shown.has(pass)
              ? [
                  entry(`pass-${walk.name}-${pass}`, title, {
                    kind: 'swatch',
                    ink,
                  }),
                ]
              : [],
          )
  }
  const absent =
    o.haplotypes && absentHaplotypesText(graph, o.haplotypes, reference)
  const walkEntries: GraphKeyEntry[] = [
    ...(o.panels
      ? []
      : (o.lift?.walks ?? []).flatMap((w, lane) => [
          walkKeyEntry(w, label(w.name), walkReference, label),
          ...passEntries(w, lane),
        ])),
    ...(lifted && graph.threadFold
      ? [entry('thread-fold', threadFoldKey(graph.threadFold))]
      : []),
    ...(lifted && o.marks.offReference ? [offReference('lift-off')] : []),
    ...faded,
    ...(!o.panels && o.lift && o.marks.threads
      ? [
          entry('walk-passes', passesKey(o.lift.walks), {
            kind: 'threads',
            ink: THREAD_INK,
          }),
        ]
      : []),
    ...(lifted && (o.marks.headsAlong || o.marks.headsAgainst)
      ? [
          entry(
            'lane-heads',
            o.marks.headsAlong ? LANE_HEADS_KEY : LANE_HEADS_AGAINST_KEY,
            { kind: 'heads', ink: THREAD_INK, haloed: o.marks.headsHaloed },
          ),
        ]
      : []),
    ...(absent ? [entry('absent', absent)] : []),
  ]

  const widthEntry = (key: string, text: string, px: number, ink: number) =>
    entry(key, text, { kind: 'width', ink, px })
  const nodeWidth = drawnNodeWidth(graph, o.nodeWidth ?? 'depth')
  const edgeWidth = drawnEdgeWidth(graph, o.edgeWidth ?? 'uniform')
  const walkCount =
    graph.threadFold?.walks ??
    new Set(graph.paths?.map(path => pathOrigin(path.name).name)).size
  const depths = depthKey(graph, thickness, o.marks.nodes)
  // a walk looping through a repeat passes its nodes more than once, and
  // each pass counts
  const passes = (depths[0]?.depth ?? 0) > walkCount
  const walksScale = walkScaleEntries(graph, o, thickness)
  const linksByWalks = edgeWidth === 'walks' && !o.marks.ribbons
  const unwalked = graph.edges.some(edge => !edge.pathIds?.length)
  const unwalkedEntry = widthEntry(
    'link-width-0',
    counted(0, 'walk', 'walks'),
    UNWALKED_PX,
    EDGE_DEFAULT_COLOR,
  )
  const nodeWidthEntries: GraphKeyEntry[] = !drawsNodes
    ? []
    : nodeWidth === 'walks'
      ? [
          ...walksScale.map(({ key, text, px }) =>
            widthEntry(key, text, px, REFERENCE_RAMP_ALT_COLOR),
          ),
          ...((linksByWalks && unwalked) ||
          graph.nodes.some(
            n =>
              n.depth === 0 &&
              !n.placeholder &&
              (!o.marks.nodes || o.marks.nodes.has(n.id)),
          )
            ? [unwalkedEntry]
            : []),
        ]
      : o.nodeWidth === 'walks' && nodeWidth === 'uniform'
        ? [entry('width-not-drawn', notLoadedThicknessText(graph))]
        : !o.marks.widthsVary
          ? []
          : nodeWidth === 'frequency'
            ? frequencyKey(thickness).map(({ label: share, widthPx }) =>
                widthEntry(
                  `width-${share}`,
                  graph.nodes.some(n => n.frequency !== undefined)
                    ? `AF ${share}`
                    : `${share} of haplotypes`,
                  widthPx,
                  REFERENCE_RAMP_ALT_COLOR,
                ),
              )
            : nodeWidth === 'depth'
              ? depths.map(({ depth, widthPx }, i) =>
                  widthEntry(
                    i === 0 ? 'width-thickest' : 'width-thinnest',
                    walkCount > 0 && !graph.depthStated
                      ? passes
                        ? counted(Math.round(depth), 'walk pass', 'walk passes')
                        : counted(Math.round(depth), 'walk', 'walks')
                      : `depth ${groupDigits(roundDepth(depth))}`,
                    widthPx,
                    REFERENCE_RAMP_ALT_COLOR,
                  ),
                )
              : []
  const linksWithNodes = drawsNodes && nodeWidth === 'walks' && linksByWalks
  const linkWidthEntries: GraphKeyEntry[] =
    drawsNodes && linksByWalks && !linksWithNodes
      ? [
          ...walksScale.map(({ key, text, px }) =>
            widthEntry(`link-${key}`, text, px, EDGE_DEFAULT_COLOR),
          ),
          ...(unwalked ? [unwalkedEntry] : []),
        ]
      : []

  const skipInk = lifted
    ? fadeAbgr(EDGE_DELETION_COLOR, FADED_ALPHA)
    : EDGE_DELETION_COLOR
  const notShownEntries: GraphKeyEntry[] = [
    ...(drawsNodes && o.marks.placeholder
      ? [
          {
            ...entry('not-shown', NOT_LOADED_TEXT, {
              kind: 'hollow',
              ink: NOT_LOADED_FILL_COLOR,
              rim: NOT_LOADED_COLOR,
              rimPx: NOT_LOADED_RIM_PX,
            }),
            ...(o.unlabelled === 'reserved'
              ? { under: '' }
              : o.unlabelled
                ? { under: unlabelledText(o.unlabelled) }
                : {}),
          },
        ]
      : []),
    ...(drawsNodes && o.marks.runsOn
      ? [entry('runs-on', RUNS_ON_KEY, { kind: 'overhang' })]
      : []),
    ...(o.runsPastEdge
      ? [
          entry('runs-past', 'drawing continues above or below the pane', {
            kind: 'overrun',
          }),
        ]
      : []),
  ]
  const skipEntries: GraphKeyEntry[] = [
    ...(o.marks.dashedSkip
      ? [
          entry('deletion', deletionKey(reference), {
            kind: 'line',
            ink: skipInk,
            dashed: true,
          }),
        ]
      : []),
  ]

  const { nodes: shown, view } = o.marks
  const marked = (o.genePins ?? []).filter(pin =>
    pin.exonsByNode.some(
      ({ nodeId, stretches }) =>
        (!shown || shown.has(nodeId)) &&
        (!view || stretches.some(stretch => lineMeetsView(stretch, view))),
    ),
  )
  const wholeGenes = marked.every(({ gene: g }) =>
    g.exons.every(e => e.start <= g.start && e.end >= g.end),
  )
  const outlined = wholeGenes ? 'gene' : 'exon'

  const sections: GraphKeySection[] = [
    { id: 'ramp', group: 'Color', entries: rampEntries },
    { id: 'walks', group: 'Walks', entries: walkEntries },
    {
      id: 'node-width',
      group: linksWithNodes ? 'Thickness' : 'Node thickness',
      entries: nodeWidthEntries,
    },
    { id: 'link-width', group: 'Link thickness', entries: linkWidthEntries },
    {
      id: 'halo',
      group: 'Marks',
      entries: (o.halos ?? []).some(h => !h.whole)
        ? [
            {
              key: 'halo',
              text: 'bubble',
              swatch: { kind: 'halo', ink: HALO_INK },
            },
          ]
        : [],
    },
    {
      id: 'links',
      group: 'Marks',
      entries:
        !lifted && o.marks.plainLink
          ? [
              entry('link', 'link', {
                kind: 'line',
                ink: EDGE_DEFAULT_COLOR,
                dashed: false,
              }),
            ]
          : [],
    },
    { id: 'skips', group: 'Marks', entries: skipEntries },
    { id: 'not-shown', group: 'Marks', entries: notShownEntries },
    {
      id: 'exon',
      group: 'Marks',
      entries:
        marked.length > 0
          ? [
              {
                key: 'exon',
                text: o.genesFrom
                  ? `${outlined}, from ${o.genesFrom}`
                  : outlined,
                swatch: { kind: 'outline', ink: EXON_INK },
              },
            ]
          : [],
    },
    {
      id: 'overhang',
      entries: o.stripOverhangs
        ? [
            {
              key: 'overhang',
              text: "graph's reference continues past the pane edge",
              swatch: { kind: 'overhang' },
            },
          ]
        : [],
    },
    {
      id: 'compressed',
      entries: layout.compressed
        ? [{ key: 'compressed', text: COMPRESSED_KEY }]
        : [],
    },
    {
      id: 'too-small',
      entries:
        o.marks.foldedNodes.size + o.marks.foldedSkips.size > 0
          ? [
              {
                key: 'too-small',
                text: tooSmallText(
                  o.marks.foldedNodes.size,
                  o.marks.foldedSkips.size,
                  o.marks.foldedUnderBp,
                ),
              },
            ]
          : [],
    },
  ]
  return sections.filter(section => section.entries.length > 0)
}

export type GraphKey = ReturnType<typeof graphKey>
