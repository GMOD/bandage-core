import { bubbleSegmentIds, classifyBubble } from './classifyBubble'
import { isBackbone } from '../anchoredNodes'
import { svgPath } from '../util/geometry'

import type { MinigraphBubble } from './bubbleLine'
import type { BubbleKind, RepeatSpan } from './classifyBubble'
import type { Graph, NodeSegment } from '../types'

// A bubble drawn over the graph itself: a wide translucent stroke along the
// nodes inside it, in layout coordinates, so the same halo follows the nodes
// through the force layout's loops as through the ordered layout's lenses. The
// two backbone nodes a bubble hangs between are not inside it, and are left
// out so neighbouring halos do not touch.
export interface BubbleHalo {
  bubble: MinigraphBubble
  kind: BubbleKind
  label: string
  // an SVG path in layout units; a drawing transform puts it on screen
  path: string
  // where the name goes, in layout units: over the middle of its nodes, at the
  // height of the highest
  labelAt: NodeSegment
  members: number
  // the ids of those nodes, so a lifted walk can say which bubbles it enters
  nodeIds: string[]
  // the bubble is the whole drawing, as a popped bubble's own row is: its
  // label still names it, but a halo around everything marks nothing
  whole: boolean
  // a small variant, drawn as a tick with no chip: its halo is a blob, and a
  // window of them buries the structural variants' names
  tick: boolean
}

const WHOLE_FRACTION = 0.9

// Holding every node but its own two ends, as a popped bubble's own row does,
// or nearly every node, as a repeat array filling its window does
export function coversGraph(members: number, nodes: number) {
  return members + 2 >= nodes || members >= WHOLE_FRACTION * nodes
}

// the usual line between a small variant and a structural one
const SMALL_VARIANT_BP = 50

export function bubbleHalos(
  graph: Graph,
  bubbles: MinigraphBubble[],
  positions: Record<string, NodeSegment[]>,
  repeats: readonly RepeatSpan[] = [],
): BubbleHalo[] {
  const byName = new Map(graph.nodes.map(n => [n.name, n]))
  const halos: BubbleHalo[] = []
  for (const bubble of bubbles) {
    const parts: string[] = []
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    const nodeIds: string[] = []
    const names = bubbleSegmentIds(bubble)
    for (const [i, name] of names.entries()) {
      const node = byName.get(name)
      const line = node && positions[node.id]
      if (!node || !line?.length) {
        continue
      }
      if (
        bubble.key
          ? i === 0 || i === names.length - 1
          : isBackbone(node) &&
            (node.stable.start < bubble.start ||
              node.stable.start >= bubble.end)
      ) {
        continue
      }
      nodeIds.push(node.id)
      // a one-point line still needs a segment to stroke as a dot
      parts.push(svgPath(line.length === 1 ? [line[0]!, line[0]!] : line))
      for (const p of line) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
      }
    }
    if (nodeIds.length === 0) {
      continue
    }
    const labelAt = { x: (minX + maxX) / 2, y: minY }
    const whole =
      bubble.covering === true ||
      coversGraph(nodeIds.length, graph.nodes.length)
    halos.push({
      bubble,
      ...classifyBubble(bubble, repeats),
      path: parts.join(''),
      labelAt,
      members: nodeIds.length,
      nodeIds,
      whole,
      // The drawing's own bubble keeps its name however small. A partial
      // bubble's lengths are a floor, so it may be no small variant.
      tick:
        !whole &&
        !bubble.partial &&
        bubble.longestAlleleLength < SMALL_VARIANT_BP,
    })
  }
  return halos
}
