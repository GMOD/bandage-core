import { EdgeSpatialIndex, SpatialIndex } from './SpatialIndex'
import {
  curvePointAt,
  distanceToSegment,
  pathRibbonOffsets,
  yToXOf,
} from './geometry'
import { weakMemo } from './weakMemo'

import type { DeletionRoutes } from '../layout/deletionRoutes'
import type { Box } from '../overlayLabels'
import type { RenderBatch } from '../renderer/types'
import type { Graph, NodeSegment } from '../types'
import type { AxisScale, BezierCurve } from './geometry'

export { distanceToSegment } from './geometry'

const CURVE_SAMPLES = 20

// `yToX` puts the curve's y in the units `py` is already in
export function distanceToCubicBezier(
  px: number,
  py: number,
  c: BezierCurve,
  yToX = 1,
) {
  // To the chords between samples, not to the samples: on a long curve they
  // are tens of px apart, and a cursor on the curve between two of them
  // measured as far off it as half that gap.
  let minDist = Infinity
  let last = curvePointAt(c, 0)
  for (let i = 1; i <= CURVE_SAMPLES; i++) {
    const next = curvePointAt(c, i / CURVE_SAMPLES)
    minDist = Math.min(
      minDist,
      distanceToSegment(px, py, last.x, last.y * yToX, next.x, next.y * yToX),
    )
    last = next
  }
  return minDist
}

function distanceToEdgeCurves(
  px: number,
  py: number,
  curves: BezierCurve[],
  yToX: number,
) {
  let minDist = Infinity
  for (const c of curves) {
    const d = distanceToCubicBezier(px, py, c, yToX)
    if (d < minDist) {
      minDist = d
    }
  }
  return minDist
}

// Each graph view keeps its indexes, keyed weakly on its positions, so two
// views cannot evict each other's. `version` changes when a node drag mutates
// the positions in place, and the axis compares by value because the model
// rebuilds it on every zoom.
const nodeCache = weakMemo<Record<string, NodeSegment[]>, SpatialIndex>()

function getSpatialIndex(
  nodePositions: Record<string, NodeSegment[]>,
  version: number,
) {
  return nodeCache(
    nodePositions,
    [version],
    () => new SpatialIndex(nodePositions),
  )
}

const LABEL_CELL_PX = 16

const labelCache = weakMemo<Record<string, NodeSegment[]>, SpatialIndex>()

// The nodes in cells no smaller than a label on screen, so a label's box
// covers a few of them at any zoom
function getLabelIndex(
  nodePositions: Record<string, NodeSegment[]>,
  version: number,
  scaleX: number,
  scaleY: number,
) {
  return labelCache(
    nodePositions,
    [version, scaleX, scaleY],
    () =>
      new SpatialIndex(nodePositions, undefined, {
        x: LABEL_CELL_PX / Math.abs(scaleX),
        y: LABEL_CELL_PX / Math.abs(scaleY),
      }),
  )
}

const edgeCache = weakMemo<Record<string, NodeSegment[]>, EdgeSpatialIndex>()

function getEdgeSpatialIndex(
  nodePositions: Record<string, NodeSegment[]>,
  graph: Graph,
  drawPaths: boolean,
  axis: AxisScale,
  version: number,
  deletions: Map<number, string[]> | undefined,
  routes: DeletionRoutes | undefined,
  stranded: boolean | undefined,
) {
  return edgeCache(
    nodePositions,
    [
      graph,
      drawPaths,
      axis.scaleX,
      axis.scaleY,
      !!axis.pixelRows,
      version,
      deletions,
      routes,
      stranded,
    ],
    () =>
      new EdgeSpatialIndex(
        nodePositions,
        graph,
        drawPaths,
        axis,
        deletions,
        version,
        routes,
        stranded,
      ),
  )
}

// Every distance below is measured with y converted into x units by `yToX` (the
// model's scaleY / scaleX), because on a row layout the two axes are bp and
// screen px and a raw hypot over them is not a distance at all — 5 bp of x and
// 5 px of y are nothing alike. The thresholds stay screen px over the x scale,
// which is what they always were; on an isotropic layout yToX is 1 and this is
// the arithmetic it has always done.
//
// `ink` is how far from its centreline each node is drawn, in screen px, and
// the most any node is. A node drawn thick by its depth is 18 px across at the
// defaults, and a fixed tolerance missed the pointer on its outer ink, where
// the link beside it took the hover instead. MIN_NODE_REACH_PX keeps a thin
// node catchable.
const MIN_NODE_REACH_PX = 5

export interface NodeInk {
  halfWidthPx: (nodeId: string) => number
  maxHalfWidthPx: number
}

export function findHoveredNode(
  nodePositions: Record<string, NodeSegment[]>,
  graphX: number,
  graphY: number,
  axis: AxisScale,
  version: number,
  ink: NodeInk | undefined,
  // RenderBatch.collapsed: the folded nodes, which draw nothing
  collapsed: RenderBatch['collapsed'],
) {
  const yToX = yToXOf(axis)
  const index = getSpatialIndex(nodePositions, version)
  const reach = (px: number) => Math.max(MIN_NODE_REACH_PX, px) / axis.scaleX
  // the query has to cover the thickest node there could be
  const queryReach = reach(ink?.maxHalfWidthPx ?? 0)
  const candidates = index.query(graphX, graphY, queryReach, queryReach / yToX)

  // The nearest candidate, not the first one inside its reach. The reach is in
  // world units, so when zoomed out it covers several nodes at once and "first"
  // meant whichever the grid happened to visit first — the cursor could sit on
  // one node and highlight its neighbour.
  let hovered: string | null = null
  let best = Infinity
  for (const { nodeId, segmentIdx } of candidates) {
    const segments = nodePositions[nodeId]!
    const dist = collapsed?.nodes.has(nodeId)
      ? Infinity
      : distanceToSegment(
          graphX,
          graphY * yToX,
          segments[segmentIdx]!.x,
          segments[segmentIdx]!.y * yToX,
          segments[segmentIdx + 1]!.x,
          segments[segmentIdx + 1]!.y * yToX,
        )
    if (dist < best && dist < reach(ink?.halfWidthPx(nodeId) ?? 0)) {
      best = dist
      hovered = nodeId
    }
  }
  return hovered
}

// Liang-Barsky: the stretch of the segment a-b inside the box, as the
// fractions along it where it enters and leaves, or undefined where none is
export function segmentInBox(a: NodeSegment, b: NodeSegment, box: Box) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  for (const [p, q] of [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ] as const) {
    if (p === 0) {
      t0 = q < 0 ? Infinity : t0
    } else if (p < 0) {
      t0 = Math.max(t0, q / p)
    } else {
      t1 = Math.min(t1, q / p)
    }
  }
  return t0 <= t1 ? ([t0, t1] as const) : undefined
}

// Whether any of the segment a-b lies inside the box
export function segmentMeetsBox(a: NodeSegment, b: NodeSegment, box: Box) {
  return segmentInBox(a, b, box) !== undefined
}

// Whether the centreline of a node other than the label's `own` crosses a box
// in screen px, for a label that must not cover a node it does not name
export function otherNodeUnderBox(
  nodePositions: Record<string, NodeSegment[]>,
  t: { scaleX: number; scaleY: number; translateX: number; translateY: number },
  version = 0,
) {
  const screen = (p: NodeSegment) => ({
    x: p.x * t.scaleX + t.translateX,
    y: p.y * t.scaleY + t.translateY,
  })
  let index: SpatialIndex | undefined
  return (box: Box, own: (nodeId: string) => boolean) => {
    index ??= getLabelIndex(nodePositions, version, t.scaleX, t.scaleY)
    return index.some(
      ((box.x0 + box.x1) / 2 - t.translateX) / t.scaleX,
      ((box.y0 + box.y1) / 2 - t.translateY) / t.scaleY,
      Math.abs((box.x1 - box.x0) / 2 / t.scaleX),
      Math.abs((box.y1 - box.y0) / 2 / t.scaleY),
      ({ nodeId, segmentIdx }) => {
        const line = nodePositions[nodeId]
        const from = line?.[segmentIdx]
        const to = line?.[segmentIdx + 1]
        return (
          from !== undefined &&
          to !== undefined &&
          !own(nodeId) &&
          segmentMeetsBox(screen(from), screen(to), box)
        )
      },
    )
  }
}

const ON_EDGE = { x: 0, y: 0 }

export function findHoveredEdge(
  nodePositions: Record<string, NodeSegment[]>,
  graph: Graph,
  graphX: number,
  graphY: number,
  axis: AxisScale,
  drawPaths: boolean,
  version: number,
  deletions: Map<number, string[]> | undefined,
  hiddenEdges: ReadonlySet<number> | undefined,
  deletionRoutes: DeletionRoutes | undefined,
  // LayoutResult.stranded, as the drawing was given it, so the curve tested
  // joins the node ends the drawn link does
  stranded: boolean | undefined,
  // RenderBatch.collapsed: the folded links, which draw nothing
  collapsed: RenderBatch['collapsed'],
) {
  const yToX = yToXOf(axis)
  const edgeThreshold = 10 / axis.scaleX
  const edgeIndex = getEdgeSpatialIndex(
    nodePositions,
    graph,
    drawPaths,
    axis,
    version,
    deletions,
    deletionRoutes,
    stranded,
  )
  const candidates = edgeIndex.query(
    graphX,
    graphY,
    edgeThreshold,
    edgeThreshold / yToX,
  )

  // Nearest, not first — same reason as findHoveredNode.
  let hovered: number | null = null
  let best = edgeThreshold
  for (const edgeIdx of candidates) {
    const edge = graph.edges[edgeIdx]!
    const fromSegments = nodePositions[edge.from]
    const toSegments = nodePositions[edge.to]
    const baseCurves = edgeIndex.getCurves(edgeIdx)
    if (
      fromSegments?.length &&
      toSegments?.length &&
      baseCurves &&
      !hiddenEdges?.has(edgeIdx) &&
      !collapsed?.edges.has(edgeIdx)
    ) {
      const numPaths = edge.pathIds?.length ?? 0
      // The same offsets GeometryBuilder drew the ribbons at, from the one
      // function that decides them, so a ribbon is hoverable where it is drawn.
      // A ribbon is the curve moved by its offset, so the pointer moved back by
      // it is as far from the curve as the pointer is from the ribbon.
      const offsets =
        drawPaths && numPaths > 0
          ? pathRibbonOffsets(
              fromSegments,
              toSegments,
              numPaths,
              axis,
              baseCurves,
            )
          : [ON_EDGE]
      for (const offset of offsets) {
        const dist = distanceToEdgeCurves(
          graphX - offset.x,
          (graphY - offset.y) * yToX,
          baseCurves,
          yToX,
        )
        if (dist < best) {
          best = dist
          hovered = edgeIdx
        }
      }
    }
  }
  return hovered
}
