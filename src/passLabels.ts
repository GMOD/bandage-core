import { LABEL_PAD, LABEL_PX, labelWidth } from './overlayLabels'

import type { LabelCandidate } from './overlayLabels'
import type { RenderBatch } from './renderer/types'
import type { WalkLift } from './walkHighlight'

export interface PassLabelItem {
  walk: string
  // the pass, -1 for a bundle's count
  pass: number
  ink: number
  // screen px
  at: { x: number; y: number }
}

interface Screen {
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
}

const ABOVE_PX = 8

const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[values.length >> 1] ?? 0

// each name beside the stroke of its pass furthest from the names placed
// before it, the first furthest from the drawing's middle
export function passLabelCandidates(
  batch: Pick<RenderBatch, 'nodeStrokes'>,
  lift: WalkLift | undefined,
  t: Screen,
  pane: { width: number; height: number },
) {
  const spots = batch.nodeStrokes.flatMap(stroke => {
    const middle = stroke.points[stroke.points.length >> 1]
    const at = middle && {
      x: middle.x * t.scaleX + t.translateX,
      y: middle.y * t.scaleY + t.translateY,
    }
    return at &&
      stroke.walk !== undefined &&
      (stroke.walkPass ?? -1) >= 0 &&
      at.x >= 0 &&
      at.x <= pane.width &&
      at.y >= 0 &&
      at.y <= pane.height
      ? [{ walk: stroke.walk, pass: stroke.walkPass ?? -1, at }]
      : []
  })
  const centre = {
    x: median(spots.map(s => s.at.x)),
    y: median(spots.map(s => s.at.y)),
  }
  const taken: { x: number; y: number }[] = []
  const furthest = (from: typeof spots) => {
    let best: (typeof spots)[number] | undefined
    let reach = -1
    for (const spot of from) {
      const d =
        taken.length === 0
          ? gap(spot.at, centre)
          : taken.reduce(
              (least, p) => Math.min(least, gap(spot.at, p)),
              Infinity,
            )
      if (d > reach) {
        reach = d
        best = spot
      }
    }
    return best
  }
  const candidates: LabelCandidate<PassLabelItem>[] = []
  for (const [lane, walk] of (lift?.walks ?? []).entries()) {
    const drawn = walk.walkPasses
    const own = spots.filter(s => s.walk === lane)
    const named = !drawn
      ? []
      : drawn.bundled
        ? drawn.passes.slice(0, 1).map(({ label, ink }) => ({
            pass: -1,
            text: label,
            ink,
            from: own,
          }))
        : drawn.passes.map(({ label, ink }, pass) => ({
            pass,
            text: label,
            ink,
            from: own.filter(s => s.pass === pass),
          }))
    for (const { pass, text, ink, from } of named) {
      const spot = furthest(from)
      if (spot) {
        taken.push(spot.at)
        const { x, y } = spot.at
        candidates.push({
          item: {
            walk: walk.name,
            pass,
            ink,
            at: spot.at,
          },
          x,
          y: y - ABOVE_PX,
          flipY: y + ABOVE_PX + LABEL_PX,
          text,
          stack: 2,
          slide: labelWidth(text),
          nearest: spot.at,
        })
      }
    }
  }
  return candidates
}

export function passLeader(
  label: { x: number; y: number },
  at: { x: number; y: number },
) {
  return {
    x1: label.x,
    y1: label.y > at.y ? label.y - LABEL_PX - LABEL_PAD : label.y + LABEL_PAD,
    x2: at.x,
    y2: at.y,
  }
}
