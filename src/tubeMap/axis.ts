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
// narrower than this a box draws as one tick rather than a bracket
const MIN_BRACKET_PX = 3

export function rulerInk(darkMode?: boolean) {
  return darkMode ? '#b0b0b8' : '#55555c'
}

interface Label {
  text: string
  at: number
  width: number
}

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw))
  const m = raw / pow
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow
}

// In order, dropping any that would overlap one already placed
function placeLabels(candidates: readonly Label[]) {
  const placed: Label[] = []
  for (const a of candidates) {
    if (
      placed.every(
        b => Math.abs(a.at - b.at) >= (a.width + b.width) / 2 + LABEL_GAP_PX,
      )
    ) {
      placed.push(a)
    }
  }
  return placed.map(({ text, at }) => ({ text, at }))
}

export interface RulerMarks {
  // each box's span; the gaps between them stay blank, since the lane changes
  // drawn there cover no reference
  spans: { x0: number; x1: number }[]
  ticks: number[]
  labels: { text: string; at: number }[]
}

// On the reference axis the boxes sit on their bp, so one scale runs across
// the ruler and its ticks fall on round positions.
function scaleMarks(
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
  const ticks: number[] = []
  const positions: Label[] = []
  for (
    let bp = Math.ceil(first.bp0 / step) * step;
    bp <= last.bp1;
    bp += step
  ) {
    const sx = Math.round(x(tubeX(boxes, bp))) + 0.5
    if (sx >= 0 && sx <= width) {
      ticks.push(sx)
      const text = bp.toLocaleString('en-US')
      positions.push({ text, at: sx, width: measure(text) })
    }
  }
  return {
    spans: [{ x0: from, x1: to }],
    ticks,
    labels: placeLabels(positions),
  }
}

// On the own axis every box is as wide as the log of its length (tubemap-core's
// compressed widths: 2 bp is 8 px, 100 bp 56, 1 kb 84, 22 kb 121), so no box is
// to scale and no one scale runs across them. The ruler treats every box alike:
// a bracket under it, a tick at each end, its length where that fits inside it,
// and positions at box boundaries. Labels are placed in that order after the
// two ends of what is on screen.
function boxMarks(
  boxes: readonly Box[],
  x: (tx: number) => number,
  width: number,
  measure: (text: string) => number,
): RulerMarks | undefined {
  const shown = boxes
    .map(box => ({ box, s0: x(box.x0), s1: x(box.x1) }))
    .filter(({ s0, s1 }) => s1 >= 0 && s0 <= width)
  const first = shown[0]
  const last = shown.at(-1)
  if (!first || !last) {
    return undefined
  }
  const label = (text: string, at: number) => ({
    text,
    at,
    width: measure(text),
  })
  const position = (bp: number, at: number) =>
    label(bp.toLocaleString('en-US'), at)
  const spans: RulerMarks['spans'] = []
  const ticks: number[] = []
  const lengths: Label[] = []
  const boundaries: Label[] = []
  for (const { box, s0, s1 } of shown) {
    spans.push({ x0: s0, x1: s1 })
    ticks.push(Math.round(s0) + 0.5)
    if (s1 - s0 >= MIN_BRACKET_PX) {
      ticks.push(Math.round(s1) + 0.5)
    }
    const length = label(formatBp(box.bp1 - box.bp0), (s0 + s1) / 2)
    if (length.width <= s1 - s0) {
      lengths.push(length)
    }
    if (box !== first.box) {
      boundaries.push(position(box.bp0, s0))
    }
  }
  const ends = [
    position(first.box.bp0, first.s0),
    position(last.box.bp1, last.s1),
  ]
  return {
    spans,
    ticks,
    labels: placeLabels([...ends, ...lengths, ...boundaries]),
  }
}

export function rulerMarks(
  boxes: readonly Box[],
  x: (tx: number) => number,
  width: number,
  measure: (text: string) => number,
  referenceAxis = false,
) {
  return (referenceAxis ? scaleMarks : boxMarks)(boxes, x, width, measure)
}

// Reference bp along the tubes: round positions on the reference axis, a
// bracket per box on the own axis
export function drawTubeMapRuler(
  ctx: CanvasRenderingContext2D,
  boxes: readonly Box[],
  frame: TubeMapFrame,
  top: number,
  referenceAxis = false,
) {
  const { x, width, darkMode } = frame
  ctx.font = '10px sans-serif'
  const marks = rulerMarks(
    boxes,
    x,
    width,
    text => ctx.measureText(text).width,
    referenceAxis,
  )
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
  for (const { x0, x1 } of marks.spans) {
    ctx.moveTo(Math.max(0, x0), y)
    ctx.lineTo(Math.min(width, x1), y)
  }
  for (const sx of marks.ticks) {
    ctx.moveTo(sx, top)
    ctx.lineTo(sx, top + TICK_PX)
  }
  ctx.stroke()
  for (const { text, at } of marks.labels) {
    ctx.fillText(text, at, top + TICK_PX + 2)
  }
}
