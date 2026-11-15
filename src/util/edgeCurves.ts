import { deletionEdges, edgeCurvesOf } from '../deletionEdges'
import { APEX_FRACTION, curvePointAt, yToXOf } from './geometry'
import { groupBy } from './groups'
import { partitionPoint } from './partitionPoint'
import { weakMemo } from './weakMemo'

import type { DeletionEdge } from '../deletionEdges'
import type { DeletionRoutes } from '../layout/deletionRoutes'
import type { Graph, NodeSegment } from '../types'
import type { AxisScale, BezierCurve } from './geometry'

// Every edge's curve as drawn, at offset zero, derived once per layout and
// zoom. The geometry builder, the edge hit index and the arc labels all read
// it, so they agree on where each curve is; deriving it twice was most of the
// hit index's 14 ms build on a 12k-edge cut. A path ribbon rebuilds the curve
// at its offset. `version` changes when a node drag mutates the positions in
// place.
export class EdgeCurves extends Map<number, BezierCurve[]> {
  readonly arcs = new Set<number>()
}

const MIN_ARC_SPAN_PX = 1

// How much higher each skip nesting another rises than the highest it nests:
// a dashed skip's width at the default connector, 4.4 px, rounded up
export const SKIP_LEVEL_PX = 5
const REACH_SAMPLES = 8
// the side, as farthestPx signs it along the reference, the stress engine
// arches a deletion's route to: over the backbone
const ROUTES_ARCH_ABOVE = -1

export function spanPx(curves: BezierCurve[], axis: AxisScale) {
  const first = curves[0]!
  const last = curves.at(-1)!
  return (
    Math.hypot(last.x1 - first.x0, (last.y1 - first.y0) * yToXOf(axis)) *
    axis.scaleX
  )
}

const cache = weakMemo<Record<string, NodeSegment[]>, EdgeCurves>()

export function baseEdgeCurves(
  nodePositions: Record<string, NodeSegment[]>,
  graph: Graph,
  axis: AxisScale,
  // bypassed backbone ids per deletion edge, i.e. `deletionEdges()` keyed by
  // edge index. An edge named here bows around the run it skips.
  deletions: Map<number, string[]> | undefined,
  version: number,
  // where a force layout ran each deletion; such an edge follows its route
  routes?: DeletionRoutes,
  // LayoutResult.stranded: links join the ends their strands name
  stranded = false,
): EdgeCurves {
  return cache(
    nodePositions,
    [graph, axis.scaleX, axis.scaleY, deletions, routes, stranded, version],
    () => {
      const curves = new EdgeCurves()
      for (let ei = 0; ei < graph.edges.length; ei++) {
        const edge = graph.edges[ei]!
        const bypassed = deletions?.get(ei)
        const arc = bypassed
          ? edgeCurvesOf(
              nodePositions,
              edge,
              axis,
              bypassed,
              routes?.[ei],
              stranded,
            )
          : undefined
        const drawsArc =
          arc !== undefined && spanPx(arc, axis) >= MIN_ARC_SPAN_PX
        const edgeCurves = drawsArc
          ? arc
          : edgeCurvesOf(
              nodePositions,
              edge,
              axis,
              undefined,
              undefined,
              stranded,
            )
        // An edge whose endpoints the layout did not place has no curve, and
        // every consumer skips it.
        if (edgeCurves) {
          curves.set(ei, edgeCurves)
          if (drawsArc) {
            curves.arcs.add(ei)
          }
        }
      }
      if (deletions) {
        const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
        const { levels, alone } = sitesCache(deletions, [graph], () =>
          skipSites(
            deletionEdges(graph).filter(d => deletions.has(d.edgeIndex)),
          ),
        )
        const levelOf = (ei: number) => levels.get(ei) ?? 1
        const chords = new Map(
          Array.from(curves.arcs, ei => [ei, chordKey(curves.get(ei)!, axis)]),
        )
        const onChord = new Map<string, number>()
        for (const chord of chords.values()) {
          onChord.set(chord, (onChord.get(chord) ?? 0) + 1)
        }
        const highestOnChord = new Map<string, number>()
        for (const ei of Array.from(curves.arcs).sort(
          (a, b) => levelOf(a) - levelOf(b) || a - b,
        )) {
          const edge = graph.edges[ei]!
          const arc = curves.get(ei)!
          const chord = chords.get(ei)!
          const level = Math.max(
            levelOf(ei),
            (highestOnChord.get(chord) ?? 0) + 1,
          )
          highestOnChord.set(chord, level)
          const height = level * SKIP_LEVEL_PX
          const farthest = farthestPx(arc, axis)
          const shared = !alone.has(ei) || onChord.get(chord)! > 1
          if (shared && Math.abs(farthest) < height) {
            const from = nodeById.get(edge.from)?.stable?.start ?? 0
            const to = nodeById.get(edge.to)?.stable?.start ?? 0
            const side = routes?.[ei]
              ? from <= to
                ? ROUTES_ARCH_ABOVE
                : -ROUTES_ARCH_ABOVE
              : Math.sign(farthest) || 1
            curves.set(ei, archOf(arc, axis, height * side))
          }
        }
      }
      return curves
    },
  )
}

const sitesCache = weakMemo<
  Map<number, string[]>,
  ReturnType<typeof skipSites>
>()

// A skip's level is one above the highest of the skips inside its span, so a
// skip nested in a longer one draws inside it; of two over one span, the later
// edge nests the earlier, and of two whose feet land on the same pixels, the
// later rises above the earlier. Taken by end, each skip finds the skips
// inside it among those taken before it that start no earlier, in a
// prefix-max tree over its sequence's starts, latest first. A skip alone, its
// span overlapping no other's and its feet on pixels of their own, keeps the
// path it has.
function skipSites(spans: DeletionEdge[]) {
  const levels = new Map<number, number>()
  const overlapping = new Set<number>()
  for (const group of groupBy(spans, s => s.refName).values()) {
    const starts = Array.from(new Set(group.map(s => s.start))).sort(
      (a, b) => b - a,
    )
    const highest = new Array<number>(starts.length + 1).fill(0)
    for (const span of group.toSorted(
      (a, b) => a.end - b.end || b.start - a.start || a.edgeIndex - b.edgeIndex,
    )) {
      const at = partitionPoint(starts.length, k => starts[k]! > span.start) + 1
      let inside = 0
      for (let i = at; i > 0; i -= i & -i) {
        inside = Math.max(inside, highest[i]!)
      }
      levels.set(span.edgeIndex, inside + 1)
      for (let i = at; i <= starts.length; i += i & -i) {
        highest[i] = Math.max(highest[i]!, inside + 1)
      }
    }
    let farthest: DeletionEdge | undefined
    for (const span of group.toSorted((a, b) => a.start - b.start)) {
      if (farthest && span.start < farthest.end) {
        overlapping.add(span.edgeIndex)
        overlapping.add(farthest.edgeIndex)
      }
      farthest = farthest && farthest.end >= span.end ? farthest : span
    }
  }
  return {
    levels,
    alone: new Set(
      spans.flatMap(s => (overlapping.has(s.edgeIndex) ? [] : [s.edgeIndex])),
    ),
  }
}

// Where an arc's feet land on screen, to the pixel and either way round: a
// collapsed repeat draws skips of spans far apart on the reference between
// the same two points
function chordKey(curves: BezierCurve[], axis: AxisScale) {
  const first = curves[0]!
  const last = curves.at(-1)!
  const ends = [
    `${Math.round(first.x0 * axis.scaleX)},${Math.round(first.y0 * axis.scaleY)}`,
    `${Math.round(last.x1 * axis.scaleX)},${Math.round(last.y1 * axis.scaleY)}`,
  ].sort()
  return ends.join(' ')
}

function screenChord(curves: BezierCurve[], axis: AxisScale) {
  const first = curves[0]!
  const last = curves.at(-1)!
  const ax = first.x0 * axis.scaleX
  const ay = first.y0 * axis.scaleY
  const length = Math.hypot(
    last.x1 * axis.scaleX - ax,
    last.y1 * axis.scaleY - ay,
  )
  return {
    ax,
    ay,
    ux: (last.x1 * axis.scaleX - ax) / length,
    uy: (last.y1 * axis.scaleY - ay) / length,
  }
}

// The arc's farthest stray from its chord on screen, positive toward
// (-uy, ux) of the chord run from the link's start
function farthestPx(curves: BezierCurve[], axis: AxisScale) {
  const { ax, ay, ux, uy } = screenChord(curves, axis)
  let farthest = 0
  for (const c of curves) {
    for (let k = 1; k < REACH_SAMPLES; k++) {
      const p = curvePointAt(c, k / REACH_SAMPLES)
      const off = (p.y * axis.scaleY - ay) * ux - (p.x * axis.scaleX - ax) * uy
      farthest = Math.abs(off) > Math.abs(farthest) ? off : farthest
    }
  }
  return farthest
}

// One cubic from the arc's feet whose apex strays `rise` screen px from its
// chord, signed as farthestPx signs it. Its control points spread apart along
// the chord as far as they stand off it, as computeEdgeCurves opens a bow, so
// over a chord shorter than its rise it is a loop rather than a hairpin, and
// loops over one chord part along their legs.
function archOf(
  curves: BezierCurve[],
  axis: AxisScale,
  rise: number,
): BezierCurve[] {
  const first = curves[0]!
  const last = curves.at(-1)!
  const { ux, uy } = screenChord(curves, axis)
  const bow = rise / APEX_FRACTION
  const dx = (-uy * bow) / axis.scaleX
  const dy = (ux * bow) / axis.scaleY
  const sx = (ux * Math.abs(bow)) / axis.scaleX
  const sy = (uy * Math.abs(bow)) / axis.scaleY
  return [
    {
      x0: first.x0,
      y0: first.y0,
      cx0: first.x0 + dx - sx,
      cy0: first.y0 + dy - sy,
      cx1: last.x1 + dx + sx,
      cy1: last.y1 + dy + sy,
      x1: last.x1,
      y1: last.y1,
    },
  ]
}
