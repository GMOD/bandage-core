import { isBackbone } from '../anchoredNodes'

import type { TubeMapFrame } from './draw'
import type { Graph } from '../types'
import type { TubeMapLayout } from '@gmod/tubemap-core'

// The reference's boxes carry bp, so a reference coordinate maps into tube x
// through the box that holds it. On the own axis a box is log-scaled, so bp
// per tube px varies box to box; on the reference axis frame.ts warps the
// result back onto the linear view's bp.

export interface Box {
  bp0: number
  bp1: number
  x0: number
  x1: number
}

// The graph names the reference `GRCh38#0#chr6`, the gene track `chr6`
export function contig(name: string) {
  return name.split('#').at(-1)!
}

export function referenceBoxes(graph: Graph, layout: TubeMapLayout) {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const byContig = new Map<string, Box[]>()
  // sparse: an unreached node has no entry
  layout.nodes.forEach(node => {
    const graphNode = nodeById.get(node.name)
    if (node.order >= 0 && graphNode && isBackbone(graphNode)) {
      const { refName, start } = graphNode.stable
      const name = contig(refName)
      const boxes = byContig.get(name) ?? byContig.set(name, []).get(name)!
      boxes.push({
        bp0: start,
        bp1: start + node.sequenceLength,
        x0: node.x,
        x1: node.x + node.pixelWidth,
      })
    }
  })
  for (const boxes of byContig.values()) {
    boxes.sort((a, b) => a.bp0 - b.bp0)
  }
  return byContig
}

export type ReferenceBoxes = ReturnType<typeof referenceBoxes>

// A bp the cut has no box for (a gap in the backbone) takes the next box's
// left edge. A bp on a boundary between boxes belongs to the box after it, or
// to the one before for the end of a span, so a span stays off the curves
// between.
export function tubeX(boxes: readonly Box[], bp: number, isEnd = false) {
  let lo = 0
  let hi = boxes.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const bp1 = boxes[mid]!.bp1
    if (isEnd ? bp1 < bp : bp1 <= bp) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  const box = boxes[lo]!
  if (bp <= box.bp0) {
    return box.x0
  }
  const span = box.bp1 - box.bp0
  return span > 0
    ? box.x0 + ((Math.min(bp, box.bp1) - box.bp0) / span) * (box.x1 - box.x0)
    : box.x0
}

export function tubeSpan(boxes: readonly Box[], start: number, end: number) {
  const a = tubeX(boxes, start)
  const b = tubeX(boxes, end, true)
  return { x0: Math.min(a, b), x1: Math.max(a, b) }
}

// The contig most of the cut's reference lies on, for the ruler
export function rulerBoxes(byContig: ReferenceBoxes) {
  let best: Box[] | undefined
  for (const boxes of byContig.values()) {
    if (!best || boxes.length > best.length) {
      best = boxes
    }
  }
  return best
}

const TICK_PX = 5
const LABEL_GAP_PX = 10
const TARGET_TICK_PX = 110

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw))
  const m = raw / pow
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow
}

// Reference bp along the tubes. On the own axis the ticks bunch in a long box
// and spread in a short one, which is the log scale made visible; a label
// that would collide with the one before it is dropped, not its tick.
export function drawTubeMapRuler(
  ctx: CanvasRenderingContext2D,
  boxes: readonly Box[],
  frame: TubeMapFrame,
  top: number,
) {
  const first = boxes[0]
  const last = boxes.at(-1)
  if (!first || !last) {
    return
  }
  const { x, width, darkMode } = frame
  const s0 = x(first.x0)
  const s1 = x(last.x1)
  const bpSpan = last.bp1 - first.bp0
  if (s1 <= s0 || bpSpan <= 0) {
    return
  }
  const step = niceStep((bpSpan / (s1 - s0)) * TARGET_TICK_PX)
  const ink = darkMode ? '#b0b0b8' : '#55555c'
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 1
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.beginPath()
  ctx.moveTo(Math.max(0, s0), top + 0.5)
  ctx.lineTo(Math.min(width, s1), top + 0.5)
  let labelRight = -Infinity
  const labels: { text: string; at: number }[] = []
  for (
    let bp = Math.ceil(first.bp0 / step) * step;
    bp <= last.bp1;
    bp += step
  ) {
    const sx = Math.round(x(tubeX(boxes, bp))) + 0.5
    if (sx < 0 || sx > width) {
      continue
    }
    ctx.moveTo(sx, top)
    ctx.lineTo(sx, top + TICK_PX)
    const text = bp.toLocaleString('en-US')
    const half = ctx.measureText(text).width / 2
    if (sx - half >= labelRight + LABEL_GAP_PX) {
      labels.push({ text, at: sx })
      labelRight = sx + half
    }
  }
  ctx.stroke()
  for (const { text, at } of labels) {
    ctx.fillText(text, at, top + TICK_PX + 2)
  }
}
