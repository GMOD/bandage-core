import { isBackbone } from '../anchoredNodes'

import type { Deviation } from './coarsen'
import type { TubeMapFrame } from './draw'
import type { Graph } from '../types'
import type { LayoutNode, TubeMapLayout } from '@gmod/tubemap-core'

// A folded variant on the tube of the walk that carries it, in tube
// coordinates. Placed by bp through the box that holds it, since tubemap-core
// may merge the coarsened nodes again and a box can stand for several.
export interface DeviationMark {
  x0: number
  x1: number
  y: number
  height: number
}

interface Box {
  bp0: number
  bp1: number
  index: number
  node: LayoutNode
}

function boxesOf(graph: Graph, layout: TubeMapLayout) {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const boxes: Box[] = []
  layout.nodes.forEach((node, index) => {
    const g = nodeById.get(node.name)
    if (node.order >= 0 && g && isBackbone(g)) {
      const bp0 = g.stable.start
      boxes.push({ bp0, bp1: bp0 + node.sequenceLength, index, node })
    }
  })
  return boxes.sort((a, b) => a.bp0 - b.bp0)
}

// The box holding `bp` that this walk passes through; an insertion on a
// boundary between two boxes sits on whichever the walk visits
function boxAt(
  boxes: readonly Box[],
  bp: number,
  visited: Map<number, number>,
) {
  let lo = 0
  let hi = boxes.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (boxes[mid]!.bp0 <= bp) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return [boxes[lo], boxes[lo - 1]].find(
    box => box && visited.has(box.index) && box.bp0 <= bp && bp <= box.bp1,
  )
}

export function deviationMarks(
  graph: Graph,
  layout: TubeMapLayout,
  deviations: Map<string, Deviation[]>,
) {
  const boxes = boxesOf(graph, layout)
  const marks: DeviationMark[] = []
  for (const track of layout.tracks) {
    const devs = track.name ? deviations.get(track.name) : undefined
    if (devs?.length) {
      // a walk that loops through a box twice marks its first pass
      const visited = new Map<number, number>()
      for (const segment of track.path) {
        if (
          segment.node !== null &&
          segment.y !== undefined &&
          !visited.has(segment.node)
        ) {
          visited.set(segment.node, segment.y)
        }
      }
      for (const d of devs) {
        const box = boxAt(boxes, d.start, visited)
        if (box) {
          const { node, bp0, bp1 } = box
          const at = (bp: number) =>
            node.x + ((Math.min(bp, bp1) - bp0) / (bp1 - bp0)) * node.pixelWidth
          marks.push({
            x0: at(d.start),
            x1: at(d.end),
            y: visited.get(box.index)!,
            height: track.width,
          })
        }
      }
    }
  }
  return marks
}

// Dark on light and light on dark, since the tubes themselves carry every hue
export function deviationInk(darkMode?: boolean) {
  return darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)'
}

// A tick at least a px wide across the tube
export function drawDeviationMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly DeviationMark[],
  { x, y, width, darkMode }: TubeMapFrame,
) {
  if (marks.length === 0) {
    return
  }
  ctx.fillStyle = deviationInk(darkMode)
  ctx.beginPath()
  for (const m of marks) {
    const left = x(m.x0)
    const right = Math.max(x(m.x1), left + 1)
    if (right >= 0 && left <= width) {
      const top = y(m.y)
      ctx.rect(left, top, right - left, y(m.y + m.height) - top)
    }
  }
  ctx.fill()
}
