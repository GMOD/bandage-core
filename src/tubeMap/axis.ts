import { isBackbone } from '../anchoredNodes'
import { formatBp } from '../graphLabels'

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

// keyed by the graph's refName, `GRCh38#0#chr6`
export function referenceBoxes(graph: Graph, layout: TubeMapLayout) {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const byRefName = new Map<string, Box[]>()
  // sparse: an unreached node has no entry
  layout.nodes.forEach(node => {
    const graphNode = nodeById.get(node.name)
    if (node.order >= 0 && graphNode && isBackbone(graphNode)) {
      const { refName, start } = graphNode.stable
      const boxes =
        byRefName.get(refName) ?? byRefName.set(refName, []).get(refName)!
      boxes.push({
        bp0: start,
        bp1: start + node.sequenceLength,
        x0: node.x,
        x1: node.x + node.pixelWidth,
      })
    }
  })
  for (const boxes of byRefName.values()) {
    boxes.sort((a, b) => a.bp0 - b.bp0)
  }
  return byRefName
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

// The refName most of the cut's reference lies on, for the ruler
export function rulerBoxes(byRefName: ReferenceBoxes) {
  let best: Box[] | undefined
  for (const boxes of byRefName.values()) {
    if (!best || boxes.length > best.length) {
      best = boxes
    }
  }
  return best
}

const TICK_PX = 5
const LABEL_GAP_PX = 10
const TARGET_TICK_PX = 110
export const ZIGZAG_PX = 4
export const ZIGZAG_AMPLITUDE_PX = 2.5

export function rulerInk(darkMode?: boolean) {
  return darkMode ? '#b0b0b8' : '#55555c'
}

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw))
  const m = raw / pow
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow
}

interface Label {
  text: string
  at: number
  width: number
}

export interface RulerMarks {
  from: number
  to: number
  ticks: number[]
  // screen spans of the boxes too narrow for the ticks their bp would get
  squeezed: { x0: number; x1: number }[]
  labels: { text: string; at: number }[]
}

// Screen x of the ruler's marks. The tick step suits the cut's bp per px as a
// whole, so a box that crams a step into under half the usual spacing, as a
// long node's log width does on the own axis, would bunch its ticks. The ruler
// gives such a box none, squeezes its stretch, and labels it with its length.
// Positions take the label row first, then lengths; the ruler drops a label
// that would overlap one already placed, but keeps its tick.
export function rulerMarks(
  boxes: readonly Box[],
  x: (tx: number) => number,
  width: number,
  measure: (text: string) => number,
): RulerMarks | undefined {
  const first = boxes[0]
  const last = boxes.at(-1)
  if (!first || !last) {
    return undefined
  }
  const from = x(first.x0)
  const to = x(last.x1)
  const bpSpan = last.bp1 - first.bp0
  if (to <= from || bpSpan <= 0) {
    return undefined
  }
  const step = niceStep((bpSpan / (to - from)) * TARGET_TICK_PX)
  const squeezedBoxes = boxes.filter(box => {
    const bp = box.bp1 - box.bp0
    return (
      bp >= step && ((x(box.x1) - x(box.x0)) * step) / bp < TARGET_TICK_PX / 2
    )
  })
  const squeezed: RulerMarks['squeezed'] = []
  const lengths: Label[] = []
  for (const box of squeezedBoxes) {
    const x0 = x(box.x0)
    const x1 = x(box.x1)
    if (x1 >= 0 && x0 <= width) {
      squeezed.push({ x0, x1 })
      const text = formatBp(box.bp1 - box.bp0)
      lengths.push({ text, at: (x0 + x1) / 2, width: measure(text) })
    }
  }
  const ticks: number[] = []
  const positions: Label[] = []
  let k = 0
  for (
    let bp = Math.ceil(first.bp0 / step) * step;
    bp <= last.bp1;
    bp += step
  ) {
    while (k < squeezedBoxes.length && squeezedBoxes[k]!.bp1 <= bp) {
      k++
    }
    if (k < squeezedBoxes.length && squeezedBoxes[k]!.bp0 < bp) {
      continue
    }
    const sx = Math.round(x(tubeX(boxes, bp))) + 0.5
    if (sx >= 0 && sx <= width) {
      ticks.push(sx)
      const text = bp.toLocaleString('en-US')
      positions.push({ text, at: sx, width: measure(text) })
    }
  }
  const placed: Label[] = []
  const clear = (a: Label) =>
    placed.every(
      b => Math.abs(a.at - b.at) >= (a.width + b.width) / 2 + LABEL_GAP_PX,
    )
  for (const label of [...positions, ...lengths]) {
    if (clear(label)) {
      placed.push(label)
    }
  }
  return {
    from,
    to,
    ticks,
    squeezed,
    labels: placed.map(({ text, at }) => ({ text, at })),
  }
}

function zigzag(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
) {
  const teeth = Math.max(1, Math.round((x1 - x0) / ZIGZAG_PX))
  const dx = (x1 - x0) / teeth
  for (let i = 0; i < teeth; i++) {
    ctx.lineTo(x0 + (i + 0.5) * dx, y + (i % 2 ? 1 : -1) * ZIGZAG_AMPLITUDE_PX)
  }
  ctx.lineTo(x1, y)
}

// Reference bp along the tubes, a zigzag where a box squeezes its bp
export function drawTubeMapRuler(
  ctx: CanvasRenderingContext2D,
  boxes: readonly Box[],
  frame: TubeMapFrame,
  top: number,
) {
  const { x, width, darkMode } = frame
  ctx.font = '10px sans-serif'
  const marks = rulerMarks(boxes, x, width, text => ctx.measureText(text).width)
  if (!marks) {
    return
  }
  const ink = rulerInk(darkMode)
  const y = top + 0.5
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.beginPath()
  ctx.moveTo(Math.max(0, marks.from), y)
  for (const { x0, x1 } of marks.squeezed) {
    ctx.lineTo(x0, y)
    zigzag(ctx, x0, x1, y)
  }
  ctx.lineTo(Math.min(width, marks.to), y)
  for (const sx of marks.ticks) {
    ctx.moveTo(sx, top)
    ctx.lineTo(sx, top + TICK_PX)
  }
  ctx.stroke()
  for (const { text, at } of marks.labels) {
    ctx.fillText(text, at, top + TICK_PX + 2)
  }
}
