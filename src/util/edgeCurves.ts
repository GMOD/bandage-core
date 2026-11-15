import { edgeCurvesOf } from '../deletionEdges'
import { yToXOf } from './geometry'
import { weakMemo } from './weakMemo'

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
      return curves
    },
  )
}
