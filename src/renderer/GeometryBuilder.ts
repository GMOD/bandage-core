import {
  drawnAlongStable,
  isBackbone,
  readsAsReference,
} from '../anchoredNodes'
import { busiestEdge, edgeWidthFactor } from '../edgeWidths'
import { linkKey } from '../gfa/linkKey'
import { NO_FOLD, SMALL_SITE_PX, foldedSites } from '../levelOfDetail'
import {
  nodeWidthPx,
  runWidthPx,
  walkLaneWidthPx,
  widthNorm,
} from '../nodeWidths'
import {
  PATH_LIGHTNESS,
  PATH_SATURATION,
  nameHue,
  pathHueAt,
} from '../pathColors'
import {
  REFERENCE_RAMP_LIGHTNESS,
  REFERENCE_RAMP_SATURATION,
  rampHueAt,
} from '../referenceRampCss'
import { referenceMidpoints } from '../referenceSpan'
import {
  DELETION_DASH_PX,
  baseEdgeCurves,
  skipDashes,
  spanPx,
} from '../util/edgeCurves'
import {
  dashSpans,
  ownStrand,
  pathRibbonOffsets,
  polylinePx,
  slideCurves,
  strandSides,
  translateCurves,
  yToXOf,
} from '../util/geometry'
import { pushTo } from '../util/groups'
import { weakMemo } from '../util/weakMemo'
import { abgrToCssRgba, fadeAbgr, packAbgr } from './colorBits'
import { laneHeadPlacer } from './laneHeads'
import { curvesPx, directedRuns, spreadHeads } from './linkRuns'
import {
  MIN_LANE_STROKE_PX,
  THREAD_PITCH_PX,
  bandScale,
  bandWidthPx,
  liftLanes,
  slotCentres,
  threadHalfWidthPx,
  threadsPasses,
  walkSteps,
} from './walkLanes'

import type { ResolvedColorScheme } from '../colorSchemes'
import type { EdgeWidth } from '../edgeWidths'
import type { DeletionRoutes } from '../layout/deletionRoutes'
import type { Run as FoldRun, Site, SmallSites } from '../levelOfDetail'
import type { NodeWidth } from '../nodeWidths'
import type { Graph, GraphEdge, GraphNode, NodeSegment } from '../types'
import type { AxisScale, BezierCurve } from '../util/geometry'
import type { RouteStep, WalkLift } from '../walkHighlight'
import type {
  Arrowhead,
  EdgeCurveBatch,
  NodeStroke,
  RenderBatch,
  Run,
} from './types'
import type { Normal, VisitFrame } from './walkLanes'

// Colors flow through the geometry builder as ABGR-in-u32 (see colorBits.ts),
// so a brighten or fade is integer arithmetic and a batch of a hundred thousand
// strokes carries its colours in one number each.
export const EDGE_DEFAULT_COLOR = packAbgr(119, 119, 119, 217) // rgb(119,119,119) ~ 0.467, alpha 0.85
const EDGE_PATH_FALLBACK_COLOR = packAbgr(136, 136, 136, 217) // ~0.533, alpha 0.85
// An edge that skips reference sequence: the graph's own statement that some
// haplotype does not carry what the backbone does. Drawn thicker than a plain
// link, and unconditionally rather than under a colour scheme, because a
// deletion has no node to colour — nothing else in the drawing can carry it, so
// there is no scheme it could disagree with. See deletionEdges.ts.
//
// NEAR-BLACK, not red. The reference-position ramp runs hue 0 to 300 at 70%/50%,
// and its hue-0 end is rgb(217,38,38) — the old rgb(214,39,40) was that colour
// to within three points, so at the start of any region the deletion arc and the
// backbone under it were the same red (review: "the 'red' coloring is too close
// to the rainbow"). Nothing else in the drawing is near-black: nodes are ramp
// hues or the off-reference charcoal, plain links are mid grey. Weight and
// darkness carry it instead of a hue, which is what keeps hue meaning reference
// position and only that.
export const EDGE_DELETION_COLOR = packAbgr(24, 24, 28, 240)
const DELETION_THICKNESS_FACTOR = 2.2
// The builder draws a lifted walk's links in its lanes' colours and fades the
// rest, to an alpha that keeps every colour scheme's hues, only dimmer, on any
// background.
export const LIFT_BACKDROP_COLOR = packAbgr(160, 160, 160, 255)
export const FADED_ALPHA = 0.18
// a moved component's stub: paler than its colour, and plainer than a fade
const MOVED_ALPHA = 0.45
// The same fade as css, for what paints outside the batch: the strip, the
// keys, a tube map's tubes
export const LIFT_BACKDROP_CSS = abgrToCssRgba(
  fadeAbgr(LIFT_BACKDROP_COLOR, FADED_ALPHA),
)
// A node drawn under `drawPaths` is split into one lengthwise stripe per path in
// the graph, in the legend's own order, and a path that does not visit the node
// leaves its slot empty. The slot is what makes carriage readable: an absence
// lands in the same place on every node, so "which sample skips this segment"
// is a gap at a fixed height rather than something to be counted.
//
// Only the edges used to carry this, and how many of a graph's paths resolved
// there was a function of how long the edge happened to be DRAWN: a kilobase
// deletion is one long edge and separates all five strokes, while a 1 bp SNP
// bubble is an edge a few px long and shows a speck (review: "only deletion
// really shows paths clearly, the edges between nodes are too small to see the
// paths ... even coloring the length of the nodes using the per-sample colors").
// A node is drawn at its own length, which is the one thing in the drawing that
// does not shrink to a joint.
//
// How many paths is too many to colour at all is not decided here — it is one
// rule over the stripes, the ribbons and the key, so the model resolves it and
// hands down the answer as `drawPaths`. See MAX_PATH_COLORS.
//
// A stripe below this many screen px is not a color, it is aliasing between
// neighbouring stripes. Under it the node keeps its own scheme colour.
// `contigThickness` is itself in screen px, so this bites on the path COUNT
// rather than on the zoom.
const MIN_PATH_STRIPE_PX = 1.2
// Guards the screen-px-to-world division below against a degenerate transform.
const MIN_SCALE_FOR_OFFSET = 1e-6

// An arrowhead's size in SCREEN px, the same at every zoom since the renderer
// expands it after the transform, and about a node wide. It grows from a plain
// link's half-width, not the link's own: a deletion's heavier head hid the
// dashes of a short one.
const ARROW_LENGTH_BASE_PX = 7
const ARROW_LENGTH_PER_EDGE_PX = 3
const ARROW_HALF_WIDTH_BASE_PX = 3
const ARROW_HALF_WIDTH_PER_EDGE_PX = 1.5
// A link shorter on screen than this many heads draws none until a zoom
// lengthens it, so a head never stands in for the link it ends. An abutting
// joint's head lies over the node the link leaves instead, shrinking to fit it
// and dropped below this fraction of its size.
const MIN_LINK_HEADS = 3
const MIN_ARROW_FIT = 0.5
const MIN_ARROW_SCALE = 0.45
// Along a run of links that all point one way, a head at every joint is a
// beat as regular as a skip's dashes, so the run keeps one head per this many
// px of its length on screen, and at least one
export const LINK_HEAD_SPACING_PX = 120

// Steps per cubic when walking a curve back from its end, spaced by the square
// of the step so they bunch where the head sits: the first is 1/144 of the
// cubic, a few px on even a long edge.
const ARROW_CURVE_STEPS = 12
// Below this an edge has no length, only the rounding of sampling one.
const ABUTTING_PX = 1e-6

// Scratch for backFromEnd, reused across edges: this runs once per head per
// rebuild, and objects per sample doubled the cost of a 16k-edge build.
let walkX = new Float64Array(64)
let walkY = new Float64Array(64)
let walkPx = new Float64Array(64)

// A run of curves as points walked back from its end into the walk arrays,
// each with its distance from the end in screen px, as far as `untilPx`.
// Returns the point count.
function backFromEnd(
  curves: BezierCurve[],
  scale: number,
  yToX: number,
  untilPx: number,
) {
  const most = curves.length * ARROW_CURVE_STEPS + 1
  if (walkX.length < most) {
    walkX = new Float64Array(most)
    walkY = new Float64Array(most)
    walkPx = new Float64Array(most)
  }
  const last = curves[curves.length - 1]!
  walkX[0] = last.x1
  walkY[0] = last.y1
  walkPx[0] = 0
  let n = 1
  let px = 0
  for (let ci = curves.length - 1; ci >= 0 && px < untilPx; ci--) {
    const c = curves[ci]!
    for (let k = 1; k <= ARROW_CURVE_STEPS && px < untilPx; k++) {
      const t = 1 - (k / ARROW_CURVE_STEPS) ** 2
      const u = 1 - t
      const a = u * u * u
      const b = 3 * u * u * t
      const d = 3 * u * t * t
      const e = t * t * t
      const x = a * c.x0 + b * c.cx0 + d * c.cx1 + e * c.x1
      const y = a * c.y0 + b * c.cy0 + d * c.cy1 + e * c.y1
      px += Math.hypot(x - walkX[n - 1]!, (y - walkY[n - 1]!) * yToX) * scale
      walkX[n] = x
      walkY[n] = y
      walkPx[n] = px
      n++
    }
  }
  return n
}

function walkPointAt(n: number, px: number) {
  let i = 1
  while (i < n - 1 && walkPx[i]! < px) {
    i++
  }
  const from = walkPx[i - 1]!
  const to = walkPx[i]!
  const f = to > from ? Math.min(1, Math.max(0, (px - from) / (to - from))) : 0
  return {
    x: walkX[i - 1]! + (walkX[i]! - walkX[i - 1]!) * f,
    y: walkY[i - 1]! + (walkY[i]! - walkY[i - 1]!) * f,
  }
}

// The head belongs to the link, and the node it enters sets where the tip
// stops: on that node's outline, `nodeHalfWidth` from the endpoint, as far as
// the link is long, so an abutting joint keeps its head on the joint. A joint's
// head lies over the node the link leaves, whose drawn length is the room it
// fits to; a run of 1 bp nodes on a walk row otherwise drew a head at every
// joint.
//
// The head lies along the curve it ends, from the curve point a head-length
// back to the tip, so a link that turns in its last few px still points along
// its own stroke.
function arrowheadFor({
  curves,
  edgeHalfWidth,
  nodeHalfWidth,
  scale,
  yToX,
  color,
  fromSegments,
  toSegments,
}: {
  curves: BezierCurve[]
  edgeHalfWidth: number
  nodeHalfWidth: number
  scale: number
  yToX: number
  color: number
  fromSegments: NodeSegment[]
  toSegments: NodeSegment[]
}): Arrowhead | undefined {
  const length = ARROW_LENGTH_BASE_PX + ARROW_LENGTH_PER_EDGE_PX * edgeHalfWidth
  const n = backFromEnd(
    curves,
    scale,
    yToX,
    nodeHalfWidth + MIN_LINK_HEADS * length,
  )
  const lengthPx = walkPx[n - 1]!
  const abutting = lengthPx < ABUTTING_PX
  const inset = Math.min(nodeHalfWidth, lengthPx)
  const fit = abutting
    ? Math.min(1, polylinePx(fromSegments, scale, scale * yToX) / length)
    : 1
  if (abutting ? fit < MIN_ARROW_FIT : lengthPx < MIN_LINK_HEADS * length) {
    return undefined
  }
  const tip = walkPointAt(n, inset)
  const base = walkPointAt(n, inset + length * fit)
  const dx = tip.x - base.x
  const dy = (tip.y - base.y) * yToX
  const last = curves[curves.length - 1]!
  return {
    x: tip.x,
    y: tip.y,
    angle:
      Math.hypot(dx, dy) > 0
        ? Math.atan2(dy, dx)
        : endTangent(last, yToX, intoDirection(last, toSegments)),
    length: length * fit,
    halfWidth:
      (ARROW_HALF_WIDTH_BASE_PX +
        ARROW_HALF_WIDTH_PER_EDGE_PX * edgeHalfWidth) *
      fit,
    color,
  }
}

const FIRST_THREADS = [[0, 0]] as const
const ONE_PASS = [0]
const NO_SHIFT = { dx: 0, dy: 0 }

function nearerStart(
  at: { x: number; y: number },
  segments: NodeSegment[],
  yToX: number,
) {
  const gap = (p: NodeSegment) => Math.hypot(p.x - at.x, (p.y - at.y) * yToX)
  return gap(segments[0]!) < gap(segments.at(-1)!)
}

// Whether a link leaves its from-node's start: as its strands say where the
// layout is stranded, else wherever its curve begins
function leavesStart(
  edge: GraphEdge,
  segments: NodeSegment[],
  first: BezierCurve,
  stranded: boolean | undefined,
  yToX: number,
) {
  return stranded
    ? strandSides(edge).from === 'start'
    : nearerStart({ x: first.x0, y: first.y0 }, segments, yToX)
}

// The way into a node from the end an edge reaches it at: the direction an
// abutting edge, which has no length of its own, points.
function intoDirection(last: BezierCurve, toSegments: NodeSegment[]) {
  if (toSegments.length < 2) {
    return undefined
  }
  const first = toSegments[0]!
  const final = toSegments[toSegments.length - 1]!
  const atStart =
    Math.hypot(last.x1 - first.x, last.y1 - first.y) <=
    Math.hypot(last.x1 - final.x, last.y1 - final.y)
  return atStart
    ? { from: first, to: toSegments[1]! }
    : { from: final, to: toSegments[toSegments.length - 2]! }
}

interface Point {
  x: number
  y: number
}

function normal(a: Point | undefined, b: Point | undefined) {
  if (!a || !b) {
    return undefined
  }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  return len > 0 ? { nx: -dy / len, ny: dx / len } : undefined
}

// Where a lifted walk's lane meets a run of folded sites from a link it
// takes into or out of the run: how far along the run's path, the lane's
// offset from it in x units, signed by the path's normal, and its shift
interface RunMeeting {
  s: number
  offset: number
  dx: number
  dy: number
}

// One pass of a lifted walk through a run of folded sites, from the link it
// takes in to the link it takes out
interface RunPassage {
  path: Point[]
  along: number[]
  into?: RunMeeting
  out?: RunMeeting
}

const passageKey = (lane: number, ei: number, nodeId: string) =>
  `${lane}\t${ei}\t${nodeId}`

const linkIndexes = new WeakMap<Graph, Map<string, number>>()

function linkIndexOf(graph: Graph) {
  let index = linkIndexes.get(graph)
  if (!index) {
    index = new Map()
    graph.edges.forEach((e, i) => {
      index?.set(
        linkKey(
          e.from,
          e.fromStrand ?? ownStrand(e.from),
          e.to,
          e.toStrand ?? ownStrand(e.to),
        ),
        i,
      )
    })
    linkIndexes.set(graph, index)
  }
  return index
}

// The unit normal of a polyline's segment holding the point `s` along it,
// in the units pointNormalsOf takes
function normalAlong(
  path: readonly Point[],
  along: readonly number[],
  s: number,
  yToX: number,
) {
  const i = Math.max(
    1,
    Math.min(
      path.length - 1,
      along.findIndex(at => at >= s),
    ),
  )
  const a = path[i - 1]!
  const b = path[i]!
  return (
    normal({ x: a.x, y: a.y * yToX }, { x: b.x, y: b.y * yToX }) ?? {
      nx: 0,
      ny: 0,
    }
  )
}

// How far along a polyline each of its points lies, in x units
function arcLengths(path: readonly Point[], yToX: number) {
  const along = [0]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    along.push(along[i - 1]! + Math.hypot(b.x - a.x, (b.y - a.y) * yToX))
  }
  return along
}

// The point of a polyline nearest `p`, and how far along it that is
function nearestAlong(
  path: readonly Point[],
  along: readonly number[],
  p: Point,
  yToX: number,
) {
  let best = { s: 0, d: Infinity }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const dx = b.x - a.x
    const dy = (b.y - a.y) * yToX
    const length2 = dx * dx + dy * dy
    const t =
      length2 > 0
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * yToX * dy) / length2),
          )
        : 0
    const d = Math.hypot(a.x + dx * t - p.x, (a.y - p.y) * yToX + dy * t)
    if (d < best.d) {
      best = { s: along[i - 1]! + (along[i]! - along[i - 1]!) * t, d }
    }
  }
  return best.s
}

// The point a distance `s` along a polyline
function pointAlong(
  path: readonly Point[],
  along: readonly number[],
  s: number,
) {
  const i = Math.max(
    1,
    Math.min(
      path.length - 1,
      along.findIndex(at => at >= s),
    ),
  )
  const a = path[i - 1]!
  const b = path[i]!
  const span = along[i]! - along[i - 1]!
  const t = span > 0 ? Math.max(0, Math.min(1, (s - along[i - 1]!) / span)) : 0
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

// A polyline's points from distance `from` along it to distance `to`, each
// with how far along it lies, run backwards where `to` comes first
function stretchAlong(
  path: readonly Point[],
  along: readonly number[],
  from: number,
  to: number,
) {
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  const inner = path.flatMap((point, i) =>
    along[i]! > low && along[i]! < high ? [{ point, s: along[i]! }] : [],
  )
  const stretch = [
    { point: pointAlong(path, along, low), s: low },
    ...inner,
    { point: pointAlong(path, along, high), s: high },
  ]
  return from <= to ? stretch : stretch.toReversed()
}

// Straight cubics through a polyline's points
function polylineCurves(points: readonly Point[]): BezierCurve[] {
  return points.slice(1).map((b, i) => {
    const a = points[i]!
    return {
      x0: a.x,
      y0: a.y,
      cx0: a.x + (b.x - a.x) / 3,
      cy0: a.y + (b.y - a.y) / 3,
      cx1: a.x + ((b.x - a.x) * 2) / 3,
      cy1: a.y + ((b.y - a.y) * 2) / 3,
      x1: b.x,
      y1: b.y,
    }
  })
}

function straightened(
  curves: BezierCurve[],
  from: Point | undefined,
  to: Point | undefined,
) {
  const first = curves[0]
  const last = curves.at(-1)
  const a = from ?? (first && { x: first.x0, y: first.y0 })
  const b = to ?? (last && { x: last.x1, y: last.y1 })
  return a && b
    ? [
        {
          x0: a.x,
          y0: a.y,
          cx0: a.x + (b.x - a.x) / 3,
          cy0: a.y + (b.y - a.y) / 3,
          cx1: a.x + ((b.x - a.x) * 2) / 3,
          cy1: a.y + ((b.y - a.y) * 2) / 3,
          x1: b.x,
          y1: b.y,
        },
      ]
    : curves
}

const MITRE_LIMIT = 0.1
const LONGEST_NORMAL = 1 / Math.sqrt(MITRE_LIMIT)

// Per-point unit normals of a polyline, mitred at the interior joints so a
// stripe slid along them keeps a constant distance from the node's outline
// where it bends. `yToX` puts the axes in comparable units first (see
// computeEdgeCurves), so each normal is perpendicular to the polyline as drawn.
function pointNormalsOf(rawPoints: Point[], yToX = 1) {
  const points =
    yToX === 1 ? rawPoints : rawPoints.map(p => ({ x: p.x, y: p.y * yToX }))
  return points.map((p, i) => {
    const before = normal(points[i - 1], p)
    const after = normal(p, points[i + 1])
    if (before && after) {
      const nx = (before.nx + after.nx) / 2
      const ny = (before.ny + after.ny) / 2
      const dot = before.nx * nx + before.ny * ny
      return dot > MITRE_LIMIT ? { nx: nx / dot, ny: ny / dot } : { nx, ny }
    }
    return before ?? after ?? { nx: 0, ny: 0 }
  })
}

// The polyline shifted `distance` world units along its own normals, which is
// the node equivalent of the constant perpendicular offset the edge path
// strokes already take. `distance` is in x units and the normal is the drawn
// one (pointNormalsOf), so the y component comes back out of x units here.
function offsetPolyline(
  points: { x: number; y: number }[],
  normals: { nx: number; ny: number }[],
  distance: number | readonly number[],
  yToX = 1,
) {
  const out = new Array<{ x: number; y: number }>(points.length)
  for (let i = 0; i < points.length; i++) {
    const d = typeof distance === 'number' ? distance : distance[i]!
    out[i] = {
      x: points[i]!.x + normals[i]!.nx * d,
      y: points[i]!.y + (normals[i]!.ny * d) / yToX,
    }
  }
  return out
}

export interface BuildOptions {
  nodePositions: Record<string, NodeSegment[]>
  graph: Graph
  nodeById: Map<string, GraphNode>
  colorScheme: ResolvedColorScheme
  contigThickness: number
  connectorThickness: number
  // Whether to paint per path — the RESOLVED answer, not the raw view prop.
  // Past MAX_PATH_COLORS a graph's paths are not drawable as colours at all and
  // the model hands over `false`, which is the one place that decides it for
  // the stripes, the ribbons and the key together. Same contract as
  // `colorScheme` above, which arrives with 'auto' already resolved.
  drawPaths: boolean
  // thicker by depth or frequency, or every node at `contigThickness`; see
  // nodeWidths.ts
  nodeWidth?: NodeWidth
  // thicker by the walks taking a link, or every link at
  // `connectorThickness`; see edgeWidths.ts
  edgeWidth?: EdgeWidth
  // walks lifted out: each draws a lane of its own along the nodes it visits,
  // their links draw dark and heavy, and everything else fades to a fraction
  // of its alpha
  highlight?: WalkLift
  // Both scales together, and required. Every screen-metric constant here (dash
  // period, stripe width, arrowhead angle) divides by scaleX, and everything
  // that mixes the axes needs their ratio; taking them as one value is what
  // keeps a caller from supplying an x scale and defaulting y, which draws a
  // wrong picture and reports nothing. See AxisScale.
  axis: AxisScale
  linearLayout?: boolean
  viewportBounds?: { minX: number; minY: number; maxX: number; maxY: number }
  // What the 'reference-position' scheme paints from: each node's midpoint on
  // the reference, and the interval the hue spans. Unused by every other
  // scheme, and passed in rather than derived here for the reason `deletions`
  // below is — it costs a neighbour walk per node, it is a fact about the
  // graph, and this function runs on every pan. `computeReferenceRamp` is what
  // builds one.
  referenceRamp?: ReferenceRamp
  // links that skip reference sequence (deletionEdges()), keyed by their index
  // into graph.edges and carrying the backbone node ids they bypass. Passed in
  // rather than derived here because the model can hold it against the graph,
  // and because the same set names the hover text.
  deletions?: Map<number, string[]>
  // LayoutResult.deletionRoutes
  deletionRoutes?: DeletionRoutes
  // LayoutResult.stranded
  stranded?: boolean
  hiddenEdges?: ReadonlySet<number>
  // Bumped when a drag moves the positions in place, which their identity
  // cannot report. Only the shared curve cache reads it; see baseEdgeCurves.
  version?: number
  // 'hidden' when absent: what is too small to draw at this scale is not drawn
  smallSites?: SmallSites
}

export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return [r + m, g + m, b + m]
}

export function packHsl(h: number, s: number, l: number, a = 1) {
  const [r, g, b] = hslToRgb(h, s, l)
  return packAbgr(
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
    Math.round(a * 255),
  )
}

// Evenly-spaced RGB gradient stops (0-255 per channel).
const DEPTH_GRADIENT = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
] as const

// ranks >= 1, i.e. everything off the reference backbone
const STABLE_RANK_GRADIENT = [
  [237, 137, 44],
  [158, 42, 122],
] as const

const NODE_LENGTH_GRADIENT = [
  [220, 50, 50],
  [50, 120, 220],
] as const

// Sample a piecewise-linear RGB gradient; t is clamped to [0,1].
function sampleGradient(
  stops: readonly (readonly [number, number, number])[],
  t: number,
) {
  const pos = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const f = pos - i
  const a = stops[i]!
  const b = stops[i + 1]!
  return packAbgr(
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    255,
  )
}

// Deterministic color from a string (djb2-style hash → HSL hue), for the
// `random` node scheme. The path ribbons do NOT use this — see pathHueAt.
function hashColor(str: string, alpha: number) {
  return packHsl(nameHue(str), PATH_SATURATION, PATH_LIGHTNESS, alpha)
}

export { REFERENCE_RAMP_MAX_HUE } from '../referenceRampCss'

// Off-reference segments come off the ramp entirely and paint one flat charcoal.
//
// They used to keep the hue of the reference they replace, paler and softer, on
// the argument that the correspondence is the whole scheme. Two rounds of docs
// review say otherwise: a pale hue is still a hue on the ramp, so an alternative
// allele reads as reference sequence at that position rather than as sequence
// the reference does not have — "non-backbone parts of the bandage graph could
// be coloured in a non-spectrum colouring". Nothing is lost by dropping the hue,
// because in both anchored layouts an allele's x already states which reference
// position it attaches to, and in the force layout its position states nothing
// to begin with.
//
// Every node off the backbone takes it, however far it sits from the reference,
// so the colour states one fact a reader can check: the reference path does not
// visit this node.
const REFERENCE_RAMP_ALT_RGB = [60, 65, 72] as const
export const REFERENCE_RAMP_ALT_COLOR = packAbgr(...REFERENCE_RAMP_ALT_RGB, 255)
export const REFERENCE_RAMP_ALT_CSS = `rgb(${REFERENCE_RAMP_ALT_RGB.join(', ')})`
// A stretch whose nodes a cut didn't load is no sequence on the ramp, no exon
// and no allele off the reference, so it is drawn hollow in an untinted grey
// lighter than the off-reference charcoal
const NOT_LOADED_RGB = [128, 128, 128] as const
const NOT_LOADED_FILL_RGB = [244, 244, 244] as const
export const NOT_LOADED_COLOR = packAbgr(...NOT_LOADED_RGB, 255)
export const NOT_LOADED_CSS = `rgb(${NOT_LOADED_RGB.join(', ')})`
export const NOT_LOADED_FILL_COLOR = packAbgr(...NOT_LOADED_FILL_RGB, 255)
export const NOT_LOADED_FILL_CSS = `rgb(${NOT_LOADED_FILL_RGB.join(', ')})`
export const NOT_LOADED_RIM_PX = 1.5

export interface ReferenceRamp {
  start: number
  span: number
  midpoints: Map<string, number>
}

// How far along the ramp a node sits, for a backbone node only: everything
// off the backbone is charcoal, wherever it branches
export function rampFraction(node: GraphNode, ramp: ReferenceRamp) {
  const mid = ramp.midpoints.get(node.id)
  return isBackbone(node) && mid !== undefined
    ? (mid - ramp.start) / ramp.span
    : undefined
}

export interface ColorSchemeRange {
  minDepth: number
  maxDepth: number
  minLength: number
  maxLength: number
  maxRank: number
  nodeCount: number
  referenceRamp?: ReferenceRamp
}

// The domain is stated by the caller — the region the subgraph was cut from —
// rather than measured off the nodes, because a linear view has no way to know
// what the cut reached: segments overrun the region at both edges, so a
// measured domain would shift the hue of every node by an amount the other
// panel cannot compute. With no region (a whole-file import) the drawn extent
// is all there is, and the ramp is then only comparable to itself.
export function computeReferenceRamp(
  graph: Graph,
  domain: { start: number; end: number } | undefined,
): ReferenceRamp {
  const midpoints = referenceMidpoints(graph)
  if (domain && domain.end > domain.start) {
    return {
      start: domain.start,
      span: domain.end - domain.start,
      midpoints,
    }
  }
  let min = Infinity
  let max = -Infinity
  for (const mid of midpoints.values()) {
    min = Math.min(min, mid)
    max = Math.max(max, mid)
  }
  return {
    start: min === Infinity ? 0 : min,
    span: max > min ? max - min : 1,
    midpoints,
  }
}

export function computeColorSchemeRange(
  graph: Graph,
  referenceRamp?: ReferenceRamp,
) {
  let minDepth = Infinity
  let maxDepth = -Infinity
  let minLength = Infinity
  let maxLength = -Infinity
  let maxRank = 0
  for (const n of graph.nodes) {
    if (!n.placeholder) {
      if (n.stable !== undefined && n.stable.rank > maxRank) {
        maxRank = n.stable.rank
      }
      if (n.depth < minDepth) {
        minDepth = n.depth
      }
      if (n.depth > maxDepth) {
        maxDepth = n.depth
      }
      if (n.length < minLength) {
        minLength = n.length
      }
      if (n.length > maxLength) {
        maxLength = n.length
      }
    }
  }
  return {
    minDepth,
    maxDepth,
    minLength,
    maxLength,
    maxRank,
    nodeCount: graph.nodes.length,
    referenceRamp,
  } satisfies ColorSchemeRange
}

export function getNodeColor(
  node: GraphNode,
  nodeIndex: number,
  colorScheme: ResolvedColorScheme,
  range: ColorSchemeRange,
) {
  return node.placeholder
    ? NOT_LOADED_COLOR
    : schemeColor(node, nodeIndex, colorScheme, range)
}

function schemeColor(
  node: GraphNode,
  nodeIndex: number,
  colorScheme: ResolvedColorScheme,
  range: ColorSchemeRange,
) {
  switch (colorScheme) {
    case 'random':
      return hashColor(node.id, 1)

    case 'depth':
      return sampleGradient(
        DEPTH_GRADIENT,
        range.maxDepth > range.minDepth
          ? (node.depth - range.minDepth) / (range.maxDepth - range.minDepth)
          : 0.5,
      )

    case 'node-length':
      return sampleGradient(
        NODE_LENGTH_GRADIENT,
        range.maxLength > range.minLength
          ? (node.length - range.minLength) /
              (range.maxLength - range.minLength)
          : 0.5,
      )

    // rGFA states the backbone rather than leaving it to be inferred: rank 0 is
    // the reference, higher ranks are the sequence that diverges from it. A
    // graph with no SR tags draws every node as unranked.
    case 'stable-rank':
      return node.stable === undefined
        ? packAbgr(160, 160, 160, 255)
        : node.stable.rank === 0
          ? packAbgr(52, 152, 219, 255)
          : sampleGradient(
              STABLE_RANK_GRADIENT,
              range.maxRank > 1
                ? (node.stable.rank - 1) / (range.maxRank - 1)
                : 0,
            )

    // Position on the reference, the one quantity both panels of a
    // graph-over-linear figure can state, so only the backbone takes a hue
    case 'reference-position': {
      const ramp = range.referenceRamp
      if (ramp === undefined) {
        return packAbgr(160, 160, 160, 255)
      }
      const t = rampFraction(node, ramp)
      return t === undefined
        ? REFERENCE_RAMP_ALT_COLOR
        : packHsl(
            rampHueAt(t),
            REFERENCE_RAMP_SATURATION,
            REFERENCE_RAMP_LIGHTNESS,
          )
    }

    case 'grey':
      return packAbgr(160, 160, 160, 255)

    case 'rainbow': {
      const hue = range.nodeCount > 1 ? (nodeIndex / range.nodeCount) * 360 : 0
      return packHsl(hue, 0.75, 0.5)
    }

    default:
      return packAbgr(52, 152, 219, 255)
  }
}

// The SCREEN angle an arrowhead points: a cubic's tangent at t=1, which runs
// from its last control point to its endpoint, so no tessellation is needed.
// The head is expanded from a screen-px size after the transform, so its
// direction has to be the drawn one too, and `yToX` puts the y difference in x
// units first.
//
// A control point on the endpoint states no direction there. The tangent's
// limit as t -> 1 then runs from the FIRST control point, and failing that from
// the start. An edge with no length at all, the abutting joint of an anchored
// layout, has none of those, and `into` (the way into the node it enters) is
// what is left; without it such a head pointed along +x whatever the node did.
export function endTangent(
  c: BezierCurve,
  yToX = 1,
  into?: { from: NodeSegment; to: NodeSegment },
) {
  const candidates: [number, number][] = [
    [c.cx1, c.cy1],
    [c.cx0, c.cy0],
    [c.x0, c.y0],
  ]
  for (const [x, y] of candidates) {
    const dx = c.x1 - x
    const dy = (c.y1 - y) * yToX
    if (Math.hypot(dx, dy) > 0) {
      return Math.atan2(dy, dx)
    }
  }
  return into
    ? Math.atan2((into.to.y - into.from.y) * yToX, into.to.x - into.from.x)
    : 0
}

// Whether any part of a node's polyline falls inside the viewport. Testing the
// *segments* rather than their endpoints is what makes a node wider than the
// window visible: in the reference-anchored layouts x is in bp, so a backbone
// segment routinely spans the whole viewport with both ends outside it, and
// point containment culled exactly the segment the view exists to show.
//
// Segment bounding boxes, not exact line-rect intersection: culling only has to
// avoid dropping something visible, and a diagonal kept by its bbox costs one
// polyline.
function isPolylineInBounds(
  segments: NodeSegment[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
) {
  let hit = false
  for (let i = 0; i < segments.length - 1 && !hit; i++) {
    const a = segments[i]!
    const b = segments[i + 1]!
    hit =
      Math.max(a.x, b.x) >= bounds.minX &&
      Math.min(a.x, b.x) <= bounds.maxX &&
      Math.max(a.y, b.y) >= bounds.minY &&
      Math.min(a.y, b.y) <= bounds.maxY
  }
  return hit
}

function isBezierInBounds(
  curves: BezierCurve[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  growX = 0,
  growY = 0,
) {
  for (const c of curves) {
    const cMinX = Math.min(c.x0, c.cx0, c.cx1, c.x1)
    const cMaxX = Math.max(c.x0, c.cx0, c.cx1, c.x1)
    const cMinY = Math.min(c.y0, c.cy0, c.cy1, c.y1)
    const cMaxY = Math.max(c.y0, c.cy0, c.cy1, c.y1)
    if (
      cMaxX >= bounds.minX - growX &&
      cMinX <= bounds.maxX + growX &&
      cMaxY >= bounds.minY - growY &&
      cMinY <= bounds.maxY + growY
    ) {
      return true
    }
  }
  return false
}

// Per-graph derivations, cached on the graph: this function runs on every
// debounced pan and zoom, and a walk over every path's every step is a fact
// about the graph rather than about the frame.

// By position in the path list, matching pathLegend's swatches exactly, so the
// key beside the drawing names the strokes in it.
//
// One array plus a name lookup, rather than an array and a Map of the same
// colours: two paths that share a name then draw the same colour on their
// edges and on their nodes, instead of the Map keeping the last one written
// while the array kept the first. `gfaConverter` no longer produces such a
// pair, and this is what makes the drawing merely wrong rather than
// inconsistent if anything ever does again.
const paletteCache = new WeakMap<
  Graph,
  { pathColorByIndex: number[]; pathIndexByName: Map<string, number> }
>()

function pathPaletteOf(graph: Graph) {
  let palette = paletteCache.get(graph)
  if (!palette) {
    const pathColorByIndex: number[] = []
    const pathIndexByName = new Map<string, number>()
    const paths = graph.paths ?? []
    for (let i = 0; i < paths.length; i++) {
      pathColorByIndex.push(
        packHsl(
          pathHueAt(i, paths.length),
          PATH_SATURATION,
          PATH_LIGHTNESS,
          0.85,
        ),
      )
      if (!pathIndexByName.has(paths[i]!.name)) {
        pathIndexByName.set(paths[i]!.name, i)
      }
    }
    palette = { pathColorByIndex, pathIndexByName }
    paletteCache.set(graph, palette)
  }
  return palette
}

// nodeId -> the indices of the paths that visit it, i.e. which stripe slots
// this node fills. Built from the paths themselves rather than read off the
// node, because `GraphNode.samples` collapses a sample's haplotypes together
// and the legend does not.
const slotsCache = new WeakMap<Graph, Map<string, number[]>>()
const NO_SLOTS: ReadonlyMap<string, number[]> = new Map()

function pathSlotsOf(graph: Graph): ReadonlyMap<string, number[]> {
  let slots = slotsCache.get(graph)
  if (!slots) {
    slots = new Map()
    for (const [pathIdx, path] of (graph.paths ?? []).entries()) {
      for (const nodeId of new Set(path.nodeIds)) {
        pushTo(slots, nodeId, pathIdx)
      }
    }
    slotsCache.set(graph, slots)
  }
  return slots
}

const lanesCache = weakMemo<WalkLift, ReturnType<typeof liftLanes>>()
const stepsCache = weakMemo<WalkLift, ReturnType<typeof walkSteps>>()
// placed over the whole walk, so a pan never moves a head
const walkWideCache = weakMemo<
  WalkLift,
  { heads: Arrowhead[]; strokes: Map<string, NodeStroke[]> }
>()

const headInBounds = (
  head: Arrowhead,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  scale: number,
  yToX: number,
) => {
  const dx = head.length / scale
  const dy = dx / yToX
  return (
    head.x >= bounds.minX - dx &&
    head.x <= bounds.maxX + dx &&
    head.y >= bounds.minY - dy &&
    head.y <= bounds.maxY + dy
  )
}

const linksCache = new WeakMap<Graph, Map<string, Set<string>>>()

function linksOf(graph: Graph): ReadonlyMap<string, ReadonlySet<string>> {
  let links = linksCache.get(graph)
  if (!links) {
    links = new Map()
    for (const { from, to } of graph.edges) {
      let out = links.get(from)
      if (!out) {
        out = new Set()
        links.set(from, out)
      }
      out.add(to)
    }
    linksCache.set(graph, links)
  }
  return links
}

export function buildGeometry(options: BuildOptions): RenderBatch {
  const {
    nodePositions,
    graph,
    nodeById,
    colorScheme,
    contigThickness,
    connectorThickness,
    drawPaths,
    nodeWidth = 'uniform',
    edgeWidth = 'uniform',
    highlight,
    axis,
    linearLayout,
    viewportBounds,
    referenceRamp,
    deletions,
    deletionRoutes,
    stranded,
    hiddenEdges,
    version = 0,
    smallSites = 'hidden',
  } = options
  const widthScale = widthNorm(graph, nodeWidth)
  const busiest = edgeWidth === 'walks' ? busiestEdge(graph) : 0
  const scale = axis.scaleX
  const worldPerScreenPx = 1 / Math.max(scale, MIN_SCALE_FOR_OFFSET)
  const yToX = yToXOf(axis)
  // The offset-zero curve of every edge, from the one place that derives it —
  // shared with the hit index, which draws its boxes from the same objects.
  const sharedCurves = baseEdgeCurves(
    nodePositions,
    graph,
    axis,
    deletions,
    version,
    deletionRoutes,
    stranded,
  )
  const collapse =
    smallSites === 'hidden'
      ? foldedSites(
          graph,
          nodePositions,
          axis,
          sharedCurves,
          deletions,
          hiddenEdges,
          { contigThickness, nodeWidth },
        )
      : NO_FOLD
  const siteAt = new Map<number, Site>()
  for (const site of collapse.sites) {
    for (const edge of site.edges) {
      siteAt.set(edge, site)
    }
  }
  const crossed = new Set<Site>()
  if (highlight?.walks.length) {
    graph.edges.forEach(({ from, to }, ei) => {
      const site =
        siteAt.get(ei) ?? collapse.within.get(from) ?? collapse.within.get(to)
      if (site && highlight.walks.some(walk => walk.edgeIndexes.has(ei))) {
        crossed.add(site)
      }
    })
  }
  const crossedAt = (nodeId: string) => {
    const site = collapse.within.get(nodeId)
    return !!site && crossed.has(site)
  }
  const laneOnly = { nodes: new Set<string>(), edges: new Set<number>() }
  // where a lane runs: a folded node, which draws nothing, at its site on
  // the reference, so a lane through it is not drawn toward where it was
  const lanePositions = () => {
    const at = { ...nodePositions }
    for (const [id, site] of collapse.siteOf) {
      at[id] = [
        { x: site.x, y: site.y },
        { x: site.x, y: site.y },
      ]
    }
    return at
  }
  const laneSiteOf = (nodeId: string) =>
    collapse.siteOf.get(nodeId) ??
    (crossedAt(nodeId) ? collapse.within.get(nodeId) : undefined)

  const nodeStrokes: NodeStroke[] = []
  const nodeStrokeRuns = new Map<string, Run>()
  const arrows: Arrowhead[] = []
  const arrowRuns = new Map<number, Run>()
  const edgeCurves: EdgeCurveBatch[] = []
  const edgeCurveRuns = new Map<number, Run>()

  const colorRange = computeColorSchemeRange(graph, referenceRamp)

  const nodeIndexMap = new Map<string, number>()
  if (colorScheme === 'rainbow') {
    for (let i = 0; i < graph.nodes.length; i++) {
      nodeIndexMap.set(graph.nodes[i]!.id, i)
    }
  }
  const nodeInk = (node: GraphNode) => {
    const own = getNodeColor(
      node,
      nodeIndexMap.get(node.id) ?? 0,
      colorScheme,
      colorRange,
    )
    return node.moved ? fadeAbgr(own, MOVED_ALPHA) : own
  }
  const widthOf = (node: GraphNode) =>
    nodeWidthPx(node, contigThickness, nodeWidth, widthScale)
  const runWidth = (run: FoldRun, alone: GraphNode) =>
    runWidthPx(run, widthOf(alone), id => {
      const end = nodeById.get(id)
      return end ? widthOf(end) : undefined
    })
  const laidAlongReference = (node: GraphNode) =>
    !stranded || !isBackbone(node) || drawnAlongStable(node)
  // where a drawn reference node at a run's end meets it: the end of a node
  // ending where the run starts, the start of one starting where it ends,
  // each read the way the reference reads it
  const meetsRun = (ids: readonly string[], atEnd: boolean) =>
    ids.flatMap(id => {
      const node = nodeById.get(id)
      const line = nodePositions[id]
      const point =
        node && line?.length
          ? atEnd === laidAlongReference(node)
            ? line.at(-1)
            : line[0]
          : undefined
      return point ? [point] : []
    })[0]
  const nodesOfRun = new Map<FoldRun, string[]>()
  for (const [id, run] of collapse.through) {
    pushTo(nodesOfRun, run, id)
  }
  const screenPx = (p: Point, q: Point) =>
    Math.hypot((p.x - q.x) * axis.scaleX, (p.y - q.y) * axis.scaleY)
  const nearestOn = (a: Point, b: Point, p: Point) => {
    const dx = (b.x - a.x) * axis.scaleX
    const dy = (b.y - a.y) * axis.scaleY
    const length2 = dx * dx + dy * dy
    const along =
      length2 > 0
        ? ((p.x - a.x) * axis.scaleX * dx + (p.y - a.y) * axis.scaleY * dy) /
          length2
        : 0
    const t = Math.max(0, Math.min(1, along))
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  // the straight line between where the drawn reference nodes at a run's
  // ends meet it, where every node of the run is laid within SMALL_SITE_PX
  // of it: each point of the run then goes to its nearest point on that line
  const chordBetween = (run: FoldRun) => {
    const a = meetsRun(run.from, true)
    const b = meetsRun(run.to, false)
    return a &&
      b &&
      (nodesOfRun.get(run) ?? []).every(id =>
        (nodePositions[id] ?? []).every(
          p => screenPx(p, nearestOn(a, b, p)) <= SMALL_SITE_PX,
        ),
      )
      ? (p: Point) => nearestOn(a, b, p)
      : undefined
  }
  const chords = new Map<FoldRun, ((p: Point) => Point) | undefined>()
  const chordOf = (run: FoldRun) => {
    const chord = chords.has(run) ? chords.get(run) : chordBetween(run)
    chords.set(run, chord)
    return chord
  }
  const pointsAlongRun = (run: FoldRun, points: NodeSegment[]) => {
    const chord = chordOf(run)
    return chord ? points.map(chord) : points
  }
  // a link's curve with each end at a node drawn on a run's straight line
  // moved there, with the control point beside it
  const shiftAt = (id: string, x: number, y: number) => {
    const run = collapse.through.get(id)
    const at = run && chordOf(run)?.({ x, y })
    return at ? { dx: at.x - x, dy: at.y - y } : undefined
  }
  const meetingDrawnNodes = (
    curves: BezierCurve[],
    from: string,
    to: string,
  ) => {
    const first = curves[0]
    const last = curves.at(-1)
    const start = first && shiftAt(from, first.x0, first.y0)
    const end = last && shiftAt(to, last.x1, last.y1)
    return start || end
      ? curves.map((c, i) => ({
          ...c,
          ...(i === 0 && start
            ? {
                x0: c.x0 + start.dx,
                y0: c.y0 + start.dy,
                cx0: c.cx0 + start.dx,
                cy0: c.cy0 + start.dy,
              }
            : {}),
          ...(i === curves.length - 1 && end
            ? {
                x1: c.x1 + end.dx,
                y1: c.y1 + end.dy,
                cx1: c.cx1 + end.dx,
                cy1: c.cy1 + end.dy,
              }
            : {}),
        }))
      : curves
  }
  // the way the reference is drawn through a run, from where the drawn
  // node before it meets it to where the one after does: the straight line
  // where the run is drawn on it, else its nodes as they are laid, in the
  // order the reference steps them
  const runPaths = new Map<FoldRun, { path: Point[]; along: number[] }>()
  const runPathOf = (run: FoldRun) => {
    const known = runPaths.get(run)
    const a = meetsRun(run.from, true)
    const b = meetsRun(run.to, false)
    const path =
      known?.path ??
      (chordOf(run) && a && b
        ? [a, b]
        : [
            ...(a ? [a] : []),
            ...(nodesOfRun.get(run) ?? [])
              .flatMap(id => {
                const node = nodeById.get(id)
                return node && isBackbone(node) ? [node] : []
              })
              .toSorted((x, y) => x.stable.start - y.stable.start)
              .flatMap(node => {
                const line = nodePositions[node.id] ?? []
                return laidAlongReference(node) ? line : line.toReversed()
              }),
            ...(b ? [b] : []),
          ])
    const traced = known ?? { path, along: arcLengths(path, yToX) }
    runPaths.set(run, traced)
    return traced.path.length >= 2 ? traced : undefined
  }
  const curvesAlongRun = (run: FoldRun, curves: BezierCurve[]) => {
    const chord = chordOf(run)
    const first = curves[0]
    const last = curves.at(-1)
    return chord && first && last
      ? straightened(
          curves,
          chord({ x: first.x0, y: first.y0 }),
          chord({ x: last.x1, y: last.y1 }),
        )
      : curves
  }

  const pathCount = graph.paths?.length ?? 0
  const { pathColorByIndex, pathIndexByName } = pathPaletteOf(graph)
  const pathColorByName = (name: string) =>
    pathColorByIndex[pathIndexByName.get(name) ?? -1] ??
    EDGE_PATH_FALLBACK_COLOR
  const nodePathSlots =
    drawPaths && pathCount > 1 ? pathSlotsOf(graph) : NO_SLOTS

  const liftedWalks = highlight?.walks ?? []
  const threaded = threadsPasses(liftedWalks)
  const lanePasses = liftedWalks.map(w => w.mostPasses)
  const thinned = threaded ? bandScale(lanePasses) : 1
  const fields =
    highlight && (liftedWalks.length > 1 || threaded)
      ? lanesCache(
          highlight,
          [nodePositions, version, axis.scaleX, axis.scaleY, collapse],
          () =>
            liftLanes(
              liftedWalks,
              nodePositions,
              yToX,
              worldPerScreenPx,
              stepsCache(highlight, [nodePositions, version, collapse], () =>
                walkSteps(
                  liftedWalks.map(w => w.route),
                  lanePositions(),
                ),
              ),
            ),
        )
      : undefined
  const lines = fields?.lines
  const threads = fields?.threads
  const spanField = fields?.spans
  const plainCentres = threaded ? slotCentres(lanePasses, lanePasses) : []
  const centresByNode = new Map<string, number[]>()
  const centresOf = (nodeId: string) => {
    let centres = centresByNode.get(nodeId)
    if (!centres) {
      const spans = spanField?.get(nodeId)
      centres = spans
        ? slotCentres(spans.slot, lanePasses, spans.held)
        : plainCentres
      centresByNode.set(nodeId, centres)
    }
    return centres
  }
  const laneOffset = (
    nodeId: string,
    laneWidth: number,
    lane: number,
    pass: number,
  ) =>
    threaded
      ? (centresOf(nodeId)[lane]! + pass * THREAD_PITCH_PX) * thinned
      : (lane - (liftedWalks.length - 1) / 2) * laneWidth
  // a thread's offset at one point of a node, eased along its walk
  const threadOffsetAt = (
    frame: VisitFrame | undefined,
    at: number,
    fallback: number,
  ) => {
    const eased = frame?.offsets?.[at] ?? frame?.offset
    return eased === undefined ? fallback : eased * thinned
  }
  const laneHalfWidth = (laneWidth: number, lane: number) =>
    Math.max(
      MIN_LANE_STROKE_PX / 2,
      threaded
        ? threadHalfWidthPx(thinned, !!liftedWalks[lane]?.walkPasses?.bundled)
        : laneWidth / 2,
    )
  const passMark = (lane: number, nodeId: string, thread: number) => {
    const visit = visitOf(lane, nodeId, thread)
    const pass = liftedWalks[lane]?.walkPasses?.visitPass.get(nodeId)?.[visit]
    return {
      ...(threaded ? { visit } : {}),
      ...(pass === undefined ? {} : { walkPass: pass }),
    }
  }
  const headsOn = (
    place: ReturnType<typeof laneHeadPlacer>,
    stroke: NodeStroke,
    lane: number,
    thread: number,
    nodeId: string,
  ) => {
    const walk = liftedWalks[lane]
    const turns = walk?.backwards.get(nodeId) ?? []
    const drawn = threaded ? [turns[visitOf(lane, nodeId, thread)]] : turns
    const against = drawn.every(turned => turned === true)
    const along = drawn.every(turned => turned !== true)
    return against || (along && walk?.encoding.field === 'pass')
      ? place({
          points: stroke.points,
          halfWidth: stroke.thickness,
          color: stroke.color,
          walk: lane,
          thread,
          threads: threads?.[lane]?.nodeThreads.get(nodeId)?.length ?? 1,
          node: nodeId,
          against,
        })
      : []
  }
  const plainNormals = new Map<string, Normal[]>()
  const visitNormals = new WeakMap<VisitFrame['normals'], Normal[]>()
  const visitOf = (lane: number, nodeId: string, thread: number) =>
    threads?.[lane]?.threadPasses.get(nodeId)?.[thread] ?? 0
  const plainNormalsOf = (nodeId: string, segments: NodeSegment[]) => {
    let normals = plainNormals.get(nodeId)
    if (!normals) {
      normals = pointNormalsOf(segments, yToX)
      plainNormals.set(nodeId, normals)
    }
    return normals
  }
  const laneNormalsOf = (
    nodeId: string,
    segments: NodeSegment[],
    frame: VisitFrame | undefined,
  ) => {
    if (!frame) {
      return plainNormalsOf(nodeId, segments)
    }
    let normals = visitNormals.get(frame.normals)
    if (!normals) {
      normals = plainNormalsOf(nodeId, segments).map(
        (n, i) => frame.normals[i] ?? n,
      )
      visitNormals.set(frame.normals, normals)
    }
    return normals
  }
  const laneWidths = new Map<string, number>()
  const laneWidthOf = (id: string) => {
    let width = laneWidths.get(id)
    if (width === undefined) {
      const node = nodeById.get(id)
      width = walkLaneWidthPx(
        node
          ? nodeWidthPx(node, contigThickness, nodeWidth, widthScale)
          : contigThickness,
        liftedWalks.length,
      )
      laneWidths.set(id, width)
    }
    return width
  }
  // where a lane's thread leaves or enters a node, from the node's frames
  // by walk and visit; a node drawn without lanes, as a stretch not loaded
  // or a single point is, holds it on its own line
  const laneEndOf = (
    id: string,
    frames: VisitFrame[][] | undefined,
    segments: NodeSegment[],
    atStart: boolean,
    lane: number,
    thread: number,
  ) => {
    const at = atStart ? 0 : segments.length - 1
    const frame = frames?.[lane]?.[visitOf(lane, id, thread)]
    const eased = frame?.offsets?.[at] ?? frame?.offset
    const laned = segments.length >= 2 && !nodeById.get(id)?.placeholder
    return {
      normal: frame?.normals[at] ??
        plainNormalsOf(id, segments)[at] ?? { nx: 0, ny: 0 },
      shift: laned ? (frame?.shifts[at] ?? NO_SHIFT) : NO_SHIFT,
      offset: !laned
        ? 0
        : eased === undefined
          ? laneOffset(id, laneWidthOf(id), lane, thread)
          : eased * thinned,
    }
  }
  const lanesMayShow = (curves: BezierCurve[], fromId: string) => {
    if (!viewportBounds) {
      return true
    }
    const offset = threaded
      ? bandWidthPx(lanePasses) * thinned
      : ((liftedWalks.length - 1) / 2) * laneWidthOf(fromId)
    const reach = LONGEST_NORMAL * offset * worldPerScreenPx
    return isBezierInBounds(
      curves,
      viewportBounds,
      reach + (fields?.furthestShift.dx ?? 0),
      reach / yToX + (fields?.furthestShift.dy ?? 0),
    )
  }
  const threadPairs = (
    lane: number,
    from: string,
    to: string,
  ): readonly (readonly [number, number])[] => {
    const own = threads?.[lane]?.linkThreads
    if (!own?.size) {
      return FIRST_THREADS
    }
    const ahead = own.get(from)?.get(to)
    const back = linksOf(graph).get(to)?.has(from)
      ? undefined
      : own.get(to)?.get(from)
    if (!back) {
      return ahead ?? FIRST_THREADS
    }
    const turned = back.map(([a, b]): [number, number] => [b, a])
    return ahead ? [...ahead, ...turned] : turned
  }
  const threadColor = (lane: number, nodeId: string, thread: number) =>
    liftedWalks[lane]?.passColors.get(nodeId)?.[
      threads?.[lane]?.threadPasses.get(nodeId)?.[thread] ?? 0
    ]
  // which end of each node a link leaves and enters as it is laid
  const linkSides = (ei: number) => {
    const edge = graph.edges[ei]
    const curves = sharedCurves.get(ei)
    const fromSegments = edge && nodePositions[edge.from]
    const toSegments = edge && nodePositions[edge.to]
    const last = curves?.at(-1)
    return edge && curves?.[0] && last && fromSegments && toSegments
      ? {
          edge,
          curves,
          fromSegments,
          toSegments,
          fromAtStart: leavesStart(
            edge,
            fromSegments,
            curves[0],
            stranded,
            yToX,
          ),
          toAtStart: nearerStart({ x: last.x1, y: last.y1 }, toSegments, yToX),
        }
      : undefined
  }
  // A lifted walk crossing a run of folded sites draws its lane along the
  // run as the run is drawn, from where it leaves the drawn node before the
  // run to where it enters the one after, at its slot: the links it takes in
  // and out each draw half, meeting halfway along, and the links between
  // nodes of the run draw nothing. Each is found here once, by the walk's
  // steps: by lane, link and the node of the run at that link
  const laneRunOf = (nodeId: string) => {
    const site = collapse.siteOf.get(nodeId)
    return site
      ? collapse.runOf.get(site)
      : crossedAt(nodeId)
        ? collapse.through.get(nodeId)
        : undefined
  }
  const singleLane = liftedWalks.length === 1 && !threaded
  // where a lane ending at a node, as `end` gives it, meets a run's path at
  // the point of it nearest `at`
  const meetingAt = (
    path: Point[],
    along: number[],
    at: Point,
    end: { normal: Normal; offset: number; shift: { dx: number; dy: number } },
  ): RunMeeting => {
    const s = nearestAlong(path, along, at, yToX)
    const n = normalAlong(path, along, s, yToX)
    const facing = end.normal.nx * n.nx + end.normal.ny * n.ny < 0 ? -1 : 1
    const shift = threaded ? end.shift : NO_SHIFT
    return {
      s,
      offset: singleLane ? 0 : facing * end.offset * worldPerScreenPx,
      dx: singleLane ? 0 : shift.dx,
      dy: singleLane ? 0 : shift.dy,
    }
  }
  // the link the walk takes from `a` to `b`, where the run holds `inside`:
  // a folded link, or one into a folded node, meets the run where the node
  // outside it attaches
  const meetingRun = (
    lane: number,
    a: RouteStep,
    b: RouteStep,
    inside: RouteStep,
    passage: RunPassage,
  ) => {
    const ei = linkIndexOf(graph).get(linkKey(a.id, a.strand, b.id, b.strand))
    const sides = ei === undefined ? undefined : linkSides(ei)
    const insideAtEnd = sides?.edge.to === inside.id
    const first = sides?.curves[0]
    const last = sides?.curves.at(-1)
    const outsideEnd =
      first && last
        ? insideAtEnd
          ? { x: first.x0, y: first.y0 }
          : { x: last.x1, y: last.y1 }
        : undefined
    const insideEnd =
      first && last
        ? insideAtEnd
          ? { x: last.x1, y: last.y1 }
          : { x: first.x0, y: first.y0 }
        : undefined
    const at =
      ei !== undefined &&
      (collapse.nodes.has(inside.id) || collapse.edges.has(ei))
        ? outsideEnd
        : insideEnd
    const [pass, toPass] =
      (sides && threadPairs(lane, sides.edge.from, sides.edge.to)[0]) ??
      FIRST_THREADS[0]
    const end =
      sides &&
      (insideAtEnd
        ? laneEndOf(
            sides.edge.from,
            lines?.frames.get(sides.edge.from),
            sides.fromSegments,
            sides.fromAtStart,
            lane,
            pass,
          )
        : laneEndOf(
            sides.edge.to,
            lines?.frames.get(sides.edge.to),
            sides.toSegments,
            sides.toAtStart,
            lane,
            toPass,
          ))
    return ei !== undefined && at && end
      ? { ei, meeting: meetingAt(passage.path, passage.along, at, end) }
      : undefined
  }
  const passageAt = new Map<
    string,
    { passage: RunPassage; side: 'into' | 'out' }
  >()
  liftedWalks.forEach((walk, lane) => {
    for (const steps of collapse.sites.length > 0 ? walk.routeSteps : []) {
      let i = 0
      while (i < steps.length) {
        const run = laneRunOf(steps[i]!.id)
        const traced = run && runPathOf(run)
        let j = i
        if (traced) {
          while (j + 1 < steps.length && laneRunOf(steps[j + 1]!.id) === run) {
            j++
          }
          const passage: RunPassage = { ...traced }
          const before = steps[i - 1]
          const after = steps[j + 1]
          const into =
            before && meetingRun(lane, before, steps[i]!, steps[i]!, passage)
          const out =
            after && meetingRun(lane, steps[j]!, after, steps[j]!, passage)
          passage.into = into?.meeting
          passage.out = out?.meeting
          if (into) {
            passageAt.set(passageKey(lane, into.ei, steps[i]!.id), {
              passage,
              side: 'into',
            })
          }
          if (out) {
            passageAt.set(passageKey(lane, out.ei, steps[j]!.id), {
              passage,
              side: 'out',
            })
          }
        }
        i = j + 1
      }
    }
  })
  const passageLinks = new Set(
    [...passageAt.keys()].map(key => Number(key.split('\t')[1])),
  )
  // the lane's points along a passage from `from` to `to` along its path,
  // at its slot there: the offset and shift each meeting gives, eased
  // between them along the path
  const passageLane = (passage: RunPassage, from: number, to: number) => {
    const { path, along, into, out } = passage
    const at = (s: number) => {
      const t =
        into && out && out.s !== into.s ? (s - into.s) / (out.s - into.s) : 0
      const a = into ?? out
      const b = out ?? into
      return a && b
        ? {
            offset: a.offset + (b.offset - a.offset) * t,
            dx: a.dx + (b.dx - a.dx) * t,
            dy: a.dy + (b.dy - a.dy) * t,
          }
        : { offset: 0, dx: 0, dy: 0 }
    }
    const stretch = stretchAlong(path, along, from, to)
    const ordered = from <= to ? stretch : stretch.toReversed()
    const normals = pointNormalsOf(
      ordered.map(p => p.point),
      yToX,
    )
    const placed = ordered.map(({ point, s }, k) => {
      const n = normals[k]!
      const slot = at(s)
      return {
        x: point.x + n.nx * slot.offset + slot.dx,
        y: point.y + (n.ny * slot.offset) / yToX + slot.dy,
      }
    })
    return from <= to ? placed : placed.toReversed()
  }
  const passageMiddle = ({ into, out }: RunPassage) =>
    into && out ? (into.s + out.s) / 2 : ((into ?? out)?.s ?? 0)
  const visitPoints = new WeakMap<VisitFrame['shifts'], NodeSegment[]>()
  const lanePointsOf = (
    segments: NodeSegment[],
    frame: VisitFrame | undefined,
  ) => {
    if (!frame || !threaded) {
      return segments
    }
    let points = visitPoints.get(frame.shifts)
    if (!points) {
      const { shifts } = frame
      points = segments.map((p, i) => {
        const { dx, dy } = shifts[i] ?? NO_SHIFT
        return { ...p, x: p.x + dx, y: p.y + dy }
      })
      visitPoints.set(frame.shifts, points)
    }
    return points
  }

  const offsetLane = (
    nodeId: string,
    segments: NodeSegment[],
    laneWidth: number,
    lane: number,
    thread: number,
  ) => {
    const frame =
      lines?.frames.get(nodeId)?.[lane]?.[visitOf(lane, nodeId, thread)]
    const normals = laneNormalsOf(nodeId, segments, frame)
    const offsets = frame?.offsets?.map(o => o * thinned * worldPerScreenPx)
    const offsetX = offsets
      ? (offsets[Math.floor(offsets.length / 2)] ?? 0)
      : threadOffsetAt(frame, 0, laneOffset(nodeId, laneWidth, lane, thread)) *
        worldPerScreenPx
    return {
      points: offsetPolyline(
        lanePointsOf(segments, frame),
        normals,
        offsets ?? offsetX,
        yToX,
      ),
      normals,
      offsetX,
      ...(offsets && { offsets }),
    }
  }
  const nodeLaneStroke = (
    nodeId: string,
    segments: NodeSegment[],
    laneWidth: number,
    lane: number,
    thread: number,
    color: number,
  ): NodeStroke => ({
    ...(liftedWalks.length === 1 && !threaded
      ? { points: segments }
      : offsetLane(nodeId, segments, laneWidth, lane, thread)),
    thickness: laneHalfWidth(laneWidth, lane),
    color: threadColor(lane, nodeId, thread) ?? color,
    walk: lane,
    pass: thread,
    ...passMark(lane, nodeId, thread),
  })
  const laneStrokesOf = (
    nodeId: string,
    segments: NodeSegment[],
    width: number,
  ) => {
    const laneWidth = walkLaneWidthPx(width, liftedWalks.length)
    const strokes: { stroke: NodeStroke; lane: number; thread: number }[] = []
    liftedWalks.forEach((walk, lane) => {
      const color = walk.colors.get(nodeId)
      if (color !== undefined) {
        for (const thread of threads?.[lane]?.nodeThreads.get(nodeId) ??
          ONE_PASS) {
          strokes.push({
            lane,
            thread,
            stroke: nodeLaneStroke(
              nodeId,
              segments,
              laneWidth,
              lane,
              thread,
              color,
            ),
          })
        }
      }
    })
    return strokes
  }
  const headsMayShow = (nodeId: string) =>
    liftedWalks.some(
      walk =>
        walk.encoding.field === 'pass' ||
        !!walk.backwards.get(nodeId)?.includes(true),
    )
  const lanedAt = (node: GraphNode, nodeId: string, segments: NodeSegment[]) =>
    segments.length >= 2 &&
    !node.placeholder &&
    !!highlight?.nodeIds.has(nodeId) &&
    !nodePathSlots.get(nodeId)?.length
  const walkWide = highlight?.walks.length
    ? walkWideCache(
        highlight,
        [
          nodePositions,
          version,
          axis.scaleX,
          axis.scaleY,
          graph,
          nodeById,
          contigThickness,
          nodeWidth,
          drawPaths,
          collapse,
        ],
        () => {
          const place = laneHeadPlacer(scale, yToX)
          const heads: Arrowhead[] = []
          const strokes = new Map<string, NodeStroke[]>()
          for (const [nodeId, segments] of Object.entries(nodePositions)) {
            const node = nodeById.get(nodeId)
            if (
              node &&
              !collapse.nodes.has(nodeId) &&
              !crossedAt(nodeId) &&
              headsMayShow(nodeId) &&
              lanedAt(node, nodeId, segments)
            ) {
              const laned = laneStrokesOf(
                nodeId,
                segments,
                nodeWidthPx(node, contigThickness, nodeWidth, widthScale),
              )
              strokes.set(
                nodeId,
                laned.map(({ stroke }) => stroke),
              )
              for (const { stroke, lane, thread } of laned) {
                for (const head of headsOn(
                  place,
                  stroke,
                  lane,
                  thread,
                  nodeId,
                )) {
                  heads.push(head)
                }
              }
            }
          }
          return { heads, strokes }
        },
      )
    : undefined

  // An arrowhead at every joint of a few hundred short nodes is a serration
  // along the whole drawing, so heads wait for a zoom where a node is longer
  // than its head.
  const showArrows = scale > (linearLayout ? 1 : MIN_ARROW_SCALE)

  // a link between two reference nodes that reads one of them as the
  // reference does and the other against it: a strand turn, whose only mark
  // is the link
  const turnsAgainstReference = ({
    from,
    to,
    fromStrand,
    toStrand,
  }: GraphEdge) => {
    const a = nodeById.get(from)
    const b = nodeById.get(to)
    return (
      !!a &&
      !!b &&
      isBackbone(a) &&
      isBackbone(b) &&
      !a.placeholder &&
      !b.placeholder &&
      readsAsReference(a, fromStrand) !== readsAsReference(b, toStrand)
    )
  }

  const headsDropped = new Set<number>()
  if (showArrows) {
    const drawnLinks: number[] = []
    for (let ei = 0; ei < graph.edges.length; ei++) {
      const { from, to } = graph.edges[ei]!
      if (
        nodePositions[from]?.length &&
        nodePositions[to]?.length &&
        sharedCurves.has(ei) &&
        !hiddenEdges?.has(ei) &&
        !collapse.edges.has(ei)
      ) {
        drawnLinks.push(ei)
      }
    }
    const runs = directedRuns(
      graph.edges,
      drawnLinks,
      ei =>
        !sharedCurves.arcs.has(ei) &&
        !deletions?.has(ei) &&
        !turnsAgainstReference(graph.edges[ei]!),
    )
    for (const run of runs) {
      const along: number[] = []
      const drawable: boolean[] = []
      let total = 0
      run.forEach((ei, i) => {
        const edge = graph.edges[ei]!
        const toNode = nodeById.get(edge.to)
        const curves = meetingDrawnNodes(
          sharedCurves.get(ei)!,
          edge.from,
          edge.to,
        )
        const numPaths = edge.pathIds?.length ?? 0
        total += curvesPx(curves, axis.scaleX, axis.scaleY)
        along.push(total)
        drawable.push(
          !collapse.bridges.has(ei) &&
            arrowheadFor({
              curves,
              edgeHalfWidth:
                (connectorThickness / 2) *
                (drawPaths && numPaths > 0
                  ? 1
                  : edgeWidthFactor(numPaths, busiest, edgeWidth)),
              nodeHalfWidth:
                (toNode
                  ? nodeWidthPx(toNode, contigThickness, nodeWidth, widthScale)
                  : contigThickness) / 2,
              scale,
              yToX,
              color: EDGE_DEFAULT_COLOR,
              fromSegments: nodePositions[edge.from]!,
              toSegments: nodePositions[edge.to]!,
            }) !== undefined,
        )
        if (i < run.length - 1) {
          total += polylinePx(
            nodePositions[edge.to]!,
            axis.scaleX,
            axis.scaleY,
          )
        }
      })
      const kept = spreadHeads(along, drawable, total, LINK_HEAD_SPACING_PX)
      run.forEach((ei, i) => {
        if (!kept.has(i)) {
          headsDropped.add(ei)
        }
      })
    }
  }

  for (let ei = 0; ei < graph.edges.length; ei++) {
    const edge = graph.edges[ei]!
    const fromSegments = nodePositions[edge.from]
    const toSegments = nodePositions[edge.to]
    const baseCurves = sharedCurves.get(ei)
    if (
      !fromSegments?.length ||
      !toSegments?.length ||
      !baseCurves ||
      hiddenEdges?.has(ei)
    ) {
      continue
    }

    const numPaths = edge.pathIds?.length ?? 0
    const isDeletion = sharedCurves.arcs.has(ei)
    // Dashed where the span a skip jumps on screen holds three dashes, one
    // plain headless stroke where shorter. Its length along the curve would
    // count the legs a short skip rises and falls on, whose dashes are dots
    // under a head: a dart
    const arcPx = isDeletion ? spanPx(baseCurves, axis) : 0
    const dashed = skipDashes(arcPx)
    const onWalk = highlight?.edgeIndexes.has(ei) ?? false
    // a ribbon per walk already shows how many take the link, so only the
    // link drawn alone widens by its walks
    const ribbonThickness =
      (connectorThickness / 2) * (dashed ? DELETION_THICKNESS_FACTOR : 1)
    const walkFactor = edgeWidthFactor(numPaths, busiest, edgeWidth)
    // a deletion by walks keeps a plain link's width at least, so its dashes
    // stay legible when few walks take it
    const edgeThickness =
      (connectorThickness / 2) *
      (!dashed
        ? walkFactor
        : edgeWidth === 'walks' && busiest > 0
          ? Math.max(1, walkFactor)
          : DELETION_THICKNESS_FACTOR)
    // One stroke per path crossing the edge, fanned off it: the shared curve
    // slid sideways, which is also what the hit index tests against. Rebuilding
    // the curve at each offset was 40% of a striped build and differed from a
    // translation only in a deletion's bow, by the offset's few px.
    const ribbons = drawPaths && numPaths > 0

    // An arrowhead states which way a LINK is read, which is a property of the
    // edge and not of each path crossing it. Drawn per ribbon it says one thing
    // once per haplotype: five stacked heads at a joint, in five colours, for a
    // single fact about a single link. That is the "coloured confetti at each
    // joint" that made `drawPaths` unusable on a force layout, and it reached
    // the anchored layouts too the moment their abutting edges started drawing
    // again. Measured on `ecoli_pggb_subgraph.gfa`: 72 arrowheads plain, 155
    // with ribbons, over 72 links.
    //
    // So one head per edge, in the edge's own colour rather than a ribbon's,
    // since choosing a ribbon's would privilege one haplotype for a fact that
    // belongs to none of them. `undefined` means this call draws no head.
    const plainEdgeColor = deletions?.has(ei)
      ? EDGE_DELETION_COLOR
      : EDGE_DEFAULT_COLOR
    const edgeColor =
      !highlight || onWalk
        ? plainEdgeColor
        : fadeAbgr(plainEdgeColor, FADED_ALPHA)
    const toNode = nodeById.get(edge.to)
    const intoHalfWidth =
      (toNode
        ? nodeWidthPx(toNode, contigThickness, nodeWidth, widthScale)
        : contigThickness) / 2
    const inView = (curves: BezierCurve[]) =>
      !viewportBounds || isBezierInBounds(curves, viewportBounds)
    // A deletion is drawn dashed, and that is the only thing in the drawing
    // that is. Weight and darkness were carrying it alone, and they could not:
    // an off-reference node is charcoal rgb(60,65,72) and the arc is near-black
    // rgb(24,24,28), which is ~25 points a channel apart, so in a figure the
    // two dark strokes read as the same ink and the arc is the rarer of them
    // (measured on `pangenome/hprc_lpa_kiv2`: 7,411 px of charcoal node against
    // ~5,000 px of arc). Hue cannot separate them either, since hue means
    // reference position and charcoal means off the reference. A broken line is
    // available, unused, and says what it draws: sequence that is not there.
    // A lifted walk's lane stays solid: its thread on the bypass and its
    // absence from the bypassed nodes already say it.
    const skipMark = deletions?.has(ei) ? { skip: true, span: arcPx } : {}
    const turnMark = turnsAgainstReference(edge) ? { turn: true } : {}
    const dashesOf = (curves: BezierCurve[]) =>
      dashSpans(curves, DELETION_DASH_PX / scale, yToX, viewportBounds)
    const stroke = (
      curves: BezierCurve[],
      thickness: number,
      color: number,
    ) => {
      if (!dashed) {
        edgeCurves.push({ curves, thickness, color, ...skipMark, ...turnMark })
        return
      }
      for (const dash of dashesOf(curves)) {
        edgeCurves.push({
          curves: dash.curves,
          thickness,
          color,
          ...skipMark,
          ...turnMark,
        })
      }
    }
    const laneStroke = (
      curves: BezierCurve[],
      thickness: number,
      color: number,
      walk: number,
      pass: number,
      mark: { visit?: number; walkPass?: number },
      startNormal: Normal,
      offsetX: number,
      endNormal: Normal,
      endOffsetX: number,
    ) => {
      edgeCurves.push({
        curves,
        thickness,
        color,
        walk,
        pass,
        ...mark,
        normal: startNormal,
        offsetX,
        endNormal,
        endOffsetX,
        ...skipMark,
        ...turnMark,
      })
    }
    const arrowOn = (curves: BezierCurve[]) => {
      const head =
        showArrows && (dashed || !isDeletion) && !headsDropped.has(ei)
          ? arrowheadFor({
              curves,
              edgeHalfWidth:
                isDeletion || ribbons ? connectorThickness / 2 : edgeThickness,
              nodeHalfWidth: intoHalfWidth,
              scale,
              yToX,
              color: edgeColor,
              fromSegments,
              toSegments,
            })
          : undefined
      if (head) {
        arrows.push(head)
      }
    }

    const edgeCurveStart = edgeCurves.length
    const arrowStart = arrows.length

    // A lifted walk's link carries on its lane from the node it leaves, so a
    // lane runs unbroken through the joints rather than beside a grey link
    const laneWalks =
      highlight?.walks.length && onWalk && !ribbons
        ? highlight.walks
        : undefined
    const collapsed = collapse.edges.has(ei)
    const fromSite = laneSiteOf(edge.from)
    const toSite = laneSiteOf(edge.to)
    const across = collapsed || !!fromSite || !!toSite
    const bridge = collapse.bridges.get(ei)
    if (laneWalks && fromSite && toSite && !collapsed) {
      laneOnly.edges.add(ei)
    }
    if (
      (laneWalks && !lanesMayShow(baseCurves, edge.from)) ||
      (collapsed && !laneWalks) ||
      (laneWalks && fromSite && toSite && !passageLinks.has(ei))
    ) {
      continue
    }
    if (laneWalks) {
      const fromAtStart = leavesStart(
        edge,
        fromSegments,
        baseCurves[0]!,
        stranded,
        yToX,
      )
      const last = baseCurves.at(-1)!
      const toAtStart = nearerStart(
        { x: last.x1, y: last.y1 },
        toSegments,
        yToX,
      )
      const single = laneWalks.length === 1 && !threaded
      const fromFrames = lines?.frames.get(edge.from)
      const toFrames = lines?.frames.get(edge.to)
      const laneCurves = across
        ? straightened(baseCurves, fromSite, toSite)
        : baseCurves
      for (let lane = 0; lane < laneWalks.length; lane++) {
        const walk = laneWalks[lane]!
        if (!walk.edgeIndexes.has(ei)) {
          continue
        }
        for (const [pass, toPass] of threadPairs(lane, edge.from, edge.to)) {
          const from = laneEndOf(
            edge.from,
            fromFrames,
            fromSegments,
            fromAtStart,
            lane,
            pass,
          )
          const to = laneEndOf(
            edge.to,
            toFrames,
            toSegments,
            toAtStart,
            lane,
            toPass,
          )
          const start = fromSite ? to : from
          const end = toSite ? from : to
          const offsetX = single ? 0 : start.offset * worldPerScreenPx
          const endOffsetX = single ? 0 : end.offset * worldPerScreenPx
          const fromShift = threaded ? start.shift : NO_SHIFT
          const toShift = threaded ? end.shift : NO_SHIFT
          const fromRun = passageAt.get(passageKey(lane, ei, edge.from))
          const toRun = passageAt.get(passageKey(lane, ei, edge.to))
          const slid = (
            p: Point,
            shift: { dx: number; dy: number },
            sideways: Normal,
            by: number,
          ) =>
            single
              ? p
              : {
                  x: p.x + shift.dx + sideways.nx * by,
                  y: p.y + shift.dy + (sideways.ny * by) / yToX,
                }
          const first = baseCurves[0]!
          const fromPoint = slid(
            { x: first.x0, y: first.y0 },
            threaded ? from.shift : NO_SHIFT,
            from.normal,
            single ? 0 : from.offset * worldPerScreenPx,
          )
          const toPoint = slid(
            { x: last.x1, y: last.y1 },
            threaded ? to.shift : NO_SHIFT,
            to.normal,
            single ? 0 : to.offset * worldPerScreenPx,
          )
          // a folded link between two drawn nodes, a skip, runs along the
          // run its site is in, as any lane crossing that run does
          const skipped =
            !fromRun && !toRun && collapsed ? siteAt.get(ei) : undefined
          const skipRun = skipped && collapse.runOf.get(skipped)
          const skipPath = skipRun && runPathOf(skipRun)
          const skipPassage = skipPath && {
            ...skipPath,
            into: meetingAt(
              skipPath.path,
              skipPath.along,
              { x: first.x0, y: first.y0 },
              from,
            ),
            out: meetingAt(
              skipPath.path,
              skipPath.along,
              { x: last.x1, y: last.y1 },
              to,
            ),
          }
          const curves =
            fromRun || toRun
              ? polylineCurves([
                  ...(fromRun
                    ? passageLane(
                        fromRun.passage,
                        passageMiddle(fromRun.passage),
                        fromRun.passage[fromRun.side]?.s ?? 0,
                      )
                    : [fromPoint]),
                  ...(toRun
                    ? passageLane(
                        toRun.passage,
                        toRun.passage[toRun.side]?.s ?? 0,
                        passageMiddle(toRun.passage),
                      )
                    : [toPoint]),
                ])
              : skipPassage
                ? polylineCurves([
                    fromPoint,
                    ...passageLane(
                      skipPassage,
                      skipPassage.into.s,
                      skipPassage.out.s,
                    ),
                    toPoint,
                  ])
                : single
                  ? laneCurves
                  : slideCurves(
                      laneCurves,
                      fromShift.dx + start.normal.nx * offsetX,
                      fromShift.dy + (start.normal.ny * offsetX) / yToX,
                      toShift.dx + end.normal.nx * endOffsetX,
                      toShift.dy + (end.normal.ny * endOffsetX) / yToX,
                    )
          if (inView(curves)) {
            laneStroke(
              curves,
              laneHalfWidth(laneWidthOf(fromSite ? edge.to : edge.from), lane),
              threadColor(lane, edge.from, pass) ??
                threadColor(lane, edge.to, toPass) ??
                plainEdgeColor,
              lane,
              pass,
              passMark(lane, edge.from, pass),
              start.normal,
              offsetX,
              end.normal,
              endOffsetX,
            )
          }
        }
      }
      if (edgeCurves.length > edgeCurveStart && !across) {
        arrowOn(baseCurves)
      }
    } else if (!ribbons) {
      const fromNode = nodeById.get(edge.from)
      if (inView(baseCurves) && bridge && fromNode) {
        stroke(
          curvesAlongRun(bridge.run, baseCurves),
          runWidth(bridge.run, fromNode) / 2,
          highlight && !onWalk
            ? fadeAbgr(LIFT_BACKDROP_COLOR, FADED_ALPHA)
            : nodeInk(fromNode),
        )
      } else if (inView(baseCurves)) {
        const drawn = meetingDrawnNodes(baseCurves, edge.from, edge.to)
        stroke(drawn, edgeThickness, edgeColor)
        arrowOn(drawn)
      }
    } else {
      const offsets = pathRibbonOffsets(
        fromSegments,
        toSegments,
        numPaths,
        axis,
      )
      // The middle ribbon carries the head, which at an odd path count is the
      // one drawn at offset 0, i.e. on the edge's own line. At an even count it
      // is half a spacing off, which beats a sixth `computeEdgeCurves` call to
      // rebuild a curve the fan is already centred on.
      const arrowRibbon = Math.floor((numPaths - 1) / 2)
      const drawn = meetingDrawnNodes(baseCurves, edge.from, edge.to)
      for (let pathIdx = 0; pathIdx < numPaths; pathIdx++) {
        const { x, y } = offsets[pathIdx]!
        const curves = x === 0 && y === 0 ? drawn : translateCurves(drawn, x, y)
        if (!inView(curves)) {
          continue
        }
        const ribbonColor = pathColorByName(edge.pathIds![pathIdx]!)
        stroke(
          curves,
          ribbonThickness,
          highlight &&
            (highlight.walks.length
              ? !highlight.names.has(edge.pathIds![pathIdx]!)
              : !onWalk)
            ? fadeAbgr(ribbonColor, FADED_ALPHA)
            : ribbonColor,
        )
        if (pathIdx === arrowRibbon) {
          arrowOn(curves)
        }
      }
    }

    const edgeCurveCount = edgeCurves.length - edgeCurveStart
    if (edgeCurveCount > 0) {
      edgeCurveRuns.set(ei, { start: edgeCurveStart, count: edgeCurveCount })
    }
    const arrowCount = arrows.length - arrowStart
    if (arrowCount > 0) {
      arrowRuns.set(ei, { start: arrowStart, count: arrowCount })
    }
  }

  for (const [nodeId, laidOut] of Object.entries(nodePositions)) {
    const node = nodeById.get(nodeId)
    if (node && crossedAt(nodeId)) {
      laneOnly.nodes.add(nodeId)
    }
    if (!node || collapse.nodes.has(nodeId) || crossedAt(nodeId)) {
      continue
    }

    if (viewportBounds && !isPolylineInBounds(laidOut, viewportBounds)) {
      continue
    }

    const faded = highlight !== undefined && !highlight.nodeIds.has(nodeId)
    // Under lifted walks the lanes carry every colour, so the rest fades in
    // grey rather than in a scheme no lane is drawn in
    const color = faded
      ? fadeAbgr(LIFT_BACKDROP_COLOR, FADED_ALPHA)
      : nodeInk(node)
    const run = collapse.through.get(nodeId)
    const width = run
      ? runWidth(run, node)
      : nodeWidthPx(node, contigThickness, nodeWidth, widthScale)
    const nodeThickness = width / 2
    const segments = run ? pointsAlongRun(run, laidOut) : laidOut

    const start = nodeStrokes.length
    // The node's drawn width is the same either way: the stripes divide it
    // rather than inflate it, so turning paths on does not re-weight the
    // drawing against the edges and the layout underneath it.
    //
    // A thickness is SCREEN px and a point is world units. So the slot width is
    // screen px and the sideways shift that places a stripe has to be taken
    // back into world units, or the stripes fan apart as you zoom in and
    // collapse into one as you zoom out.
    const slots = nodePathSlots.get(nodeId)
    const slotWidth = width / pathCount
    const drawable = segments.length >= 2
    // Each lifted walk keeps one lane across the whole drawing, so a lane
    // missing from a node is a walk that does not visit it
    const lanes =
      highlight?.walks.length && !faded && !slots?.length
        ? highlight.walks
        : undefined
    if (drawable && node.placeholder && !faded) {
      nodeStrokes.push({
        points: segments,
        thickness: nodeThickness,
        color,
        placeholder: true,
      })
      if (nodeThickness > NOT_LOADED_RIM_PX) {
        nodeStrokes.push({
          points: segments,
          thickness: nodeThickness - NOT_LOADED_RIM_PX,
          color: NOT_LOADED_FILL_COLOR,
          placeholder: true,
        })
      }
    } else if (drawable && lanes) {
      for (const laned of walkWide?.strokes.get(nodeId) ??
        laneStrokesOf(nodeId, segments, width).map(({ stroke }) => stroke)) {
        nodeStrokes.push(laned)
      }
    } else if (drawable && slots?.length && slotWidth >= MIN_PATH_STRIPE_PX) {
      const normals = pointNormalsOf(segments, yToX)
      for (const slot of slots) {
        const offset =
          (slot - (pathCount - 1) / 2) * slotWidth * worldPerScreenPx
        const stripe = pathColorByIndex[slot] ?? EDGE_PATH_FALLBACK_COLOR
        nodeStrokes.push({
          points: offsetPolyline(segments, normals, offset, yToX),
          thickness: slotWidth / 2,
          // a node off the lifted walk fades whichever way it is painted
          color: faded ? fadeAbgr(stripe, FADED_ALPHA) : stripe,
        })
      }
    } else if (drawable) {
      nodeStrokes.push({ points: segments, thickness: nodeThickness, color })
    }
    const count = nodeStrokes.length - start
    if (count > 0) {
      nodeStrokeRuns.set(nodeId, { start, count })
    }
  }

  for (const head of walkWide?.heads ?? []) {
    if (!viewportBounds || headInBounds(head, viewportBounds, scale, yToX)) {
      arrows.push(head)
    }
  }


  return {
    nodeStrokes,
    nodeStrokeRuns,
    arrows,
    arrowRuns,
    edgeCurves,
    edgeCurveRuns,
    collapsed: collapse,
    laneOnly,
  }
}
