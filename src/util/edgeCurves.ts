import { weakMemo } from './weakMemo'
import { edgeCurvesOf } from '../deletionEdges'

import type { DeletionRoutes } from '../layout/deletionRoutes'
import type { Graph, NodeSegment } from '../types'
import type { AxisScale, BezierCurve } from './geometry'

// Every edge's curve as drawn, at offset zero, derived once per layout and
// zoom. The geometry builder, the edge hit index and the arc labels all read
// it, so they agree on where each curve is; deriving it twice was most of the
// hit index's 14 ms build on a 12k-edge cut. A path ribbon rebuilds the curve
// at its offset. `version` changes when a node drag mutates the positions in
// place.
export type EdgeCurves = Map<number, BezierCurve[]>

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
      const curves: EdgeCurves = new Map()
      for (let ei = 0; ei < graph.edges.length; ei++) {
        const bypassed = deletions?.get(ei)
        const edgeCurves = edgeCurvesOf(
          nodePositions,
          graph.edges[ei]!,
          axis,
          bypassed,
          bypassed && routes?.[ei],
          stranded,
        )
        // An edge whose endpoints the layout did not place has no curve, and
        // every consumer skips it.
        if (edgeCurves) {
          curves.set(ei, edgeCurves)
        }
      }
      return curves
    },
  )
}
