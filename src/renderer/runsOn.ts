import { departureTails } from '../gfa/departures'
import { weakMemo } from '../util/weakMemo'

import type { Graph, NodeSegment } from '../types'
import type { Arrowhead } from './types'

// The tab at a free end, the reference strip's tab past its edge laid along
// the node: how far it reaches past the node's round cap, and half how wide
export const RUNS_ON_LENGTH_PX = 8
export const RUNS_ON_HALF_WIDTH_PX = 6

const tailsOf = weakMemo<Graph, Set<string>>()

// A tab past each end of a departure's tail that no drawn link meets: the
// haplotype's own steps there run on to a place on the reference the drawing
// does not hold, so the node does not end where it stops. `linked` holds each
// drawn link's ends, `${node}\t${atStart}`; `drawn` whether the drawing
// strokes a node; `halfWidthPx` how far its stroke reaches off its line.
export function runsOnTabs({
  graph,
  nodePositions,
  linked,
  drawn,
  halfWidthPx,
  scale,
  yToX,
  color,
}: {
  graph: Graph
  nodePositions: Record<string, NodeSegment[]>
  linked: ReadonlySet<string>
  drawn: (id: string) => boolean
  halfWidthPx: (id: string) => number
  scale: number
  yToX: number
  color: number
}) {
  const tabs: Arrowhead[] = []
  for (const id of tailsOf(graph, [], () => departureTails(graph))) {
    const segments = nodePositions[id]
    if (segments && segments.length >= 2 && drawn(id)) {
      for (const atStart of [true, false]) {
        if (!linked.has(`${id}\t${atStart}`)) {
          const tab = tabAt(segments, atStart, halfWidthPx(id), scale, yToX)
          if (tab) {
            tabs.push({ ...tab, color, node: id, runsOn: true })
          }
        }
      }
    }
  }
  return tabs
}

function tabAt(
  segments: NodeSegment[],
  atStart: boolean,
  halfWidthPx: number,
  scale: number,
  yToX: number,
) {
  const end = atStart ? segments[0]! : segments.at(-1)!
  const inward = (atStart ? segments : segments.toReversed()).find(
    p => p.x !== end.x || p.y !== end.y,
  )
  const dx = inward ? (end.x - inward.x) * scale : 0
  const dy = inward ? (end.y - inward.y) * scale * yToX : 0
  const px = Math.hypot(dx, dy)
  const reach = halfWidthPx + RUNS_ON_LENGTH_PX
  return px > 0
    ? {
        x: end.x + ((dx / px) * reach) / scale,
        y: end.y + ((dy / px) * reach) / (scale * yToX),
        angle: Math.atan2(dy, dx),
        length: RUNS_ON_LENGTH_PX,
        halfWidth: RUNS_ON_HALF_WIDTH_PX,
      }
    : undefined
}
