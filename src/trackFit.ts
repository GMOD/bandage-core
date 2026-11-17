import { FIT_PADDING } from './layout/fitAssumptions'
import { strandSides } from './util/geometry'

import type { ReferenceProfile } from './pipeline'
import type { Graph, LayoutResult, NodeSegment } from './types'

// How a drawing placed by a host's window meets the host's height, named as
// JBrowse names a track's sizing: `fit` scales the whole cut into the height;
// `fixed` draws it at the window's scale, lowered only so the window's own
// reference fits the height (referenceScale), holds that reference whole and
// clips what hangs off it past the top or bottom; `grow` does the same in a
// track grown to hold the cut, up to the host's cap
export const TRACK_FITS = ['fixed', 'grow', 'fit'] as const

export type TrackFit = (typeof TRACK_FITS)[number]

export const DEFAULT_TRACK_FIT: TrackFit = 'fit'

// What a host's menu calls each, the drawing's size first and the track's
// height second, as JBrowse words its track sizing
export const TRACK_FIT_LABELS: Record<TrackFit, string> = {
  fixed: "Graph at the view's zoom + fixed track height",
  grow: "Graph at the view's zoom + autogrow track height",
  fit: 'Fit graph to track height',
}

export function isTrackFit(value: unknown): value is TrackFit {
  return TRACK_FITS.some(fit => fit === value)
}

export function scalesByWindow(fit: TrackFit) {
  return fit !== 'fit'
}

// Every line the drawing strokes, as runs of x0 y0 x1 y1 in layout units: each
// node's line, each link from the end its strands name to the other node's,
// or along the route a layout ran it
export function drawnSegments(
  graph: Pick<Graph, 'edges'>,
  layout: Pick<LayoutResult, 'nodePositions' | 'deletionRoutes'>,
) {
  const out: number[] = []
  const line = (points: readonly NodeSegment[]) => {
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)]!
      const b = points[i]!
      if (i > 0 || points.length === 1) {
        out.push(a.x, a.y, b.x, b.y)
      }
    }
  }
  for (const points of Object.values(layout.nodePositions)) {
    line(points)
  }
  const routes = layout.deletionRoutes ?? {}
  graph.edges.forEach((edge, i) => {
    const route = routes[i]
    const from = layout.nodePositions[edge.from]
    const to = layout.nodePositions[edge.to]
    if (route?.length) {
      line(route)
    } else if (from?.length && to?.length) {
      const sides = strandSides(edge)
      const a = sides.from === 'end' ? from.at(-1)! : from[0]!
      const b = sides.to === 'start' ? to[0]! : to.at(-1)!
      out.push(a.x, a.y, b.x, b.y)
    }
  })
  return Float64Array.from(out)
}

interface YRange {
  minY: number
  maxY: number
}

// How high and low the drawing reaches over x0..x1, each line cut where it
// crosses x0 or x1. A point outside the range counts too, drawn back toward
// the middle by `slack` times how far outside it lies, so the reach moves no
// faster than `slack` as the range slides: a loop about to come on screen
// eases the drawing toward it rather than jumping it.
export function reachOver(
  segments: Float64Array,
  x0: number,
  x1: number,
  slack = 0,
): YRange | undefined {
  let minY = Infinity
  let maxY = -Infinity
  const take = (x: number, y: number) => {
    const outside = Math.max(0, x0 - x, x - x1)
    if (outside === 0 || slack > 0) {
      minY = Math.min(minY, y + slack * outside)
      maxY = Math.max(maxY, y - slack * outside)
    }
  }
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const ax = segments[i]!
    const ay = segments[i + 1]!
    const bx = segments[i + 2]!
    const by = segments[i + 3]!
    take(ax, ay)
    take(bx, by)
    for (const edge of [x0, x1]) {
      if (Math.min(ax, bx) < edge && edge < Math.max(ax, bx)) {
        take(edge, ay + ((by - ay) * (edge - ax)) / (bx - ax))
      }
    }
  }
  return maxY >= minY ? { minY, maxY } : undefined
}

// The reference as drawn, piece by piece, as runs of x0 y0 x1 y1
export function referenceSegments({ pieces }: ReferenceProfile) {
  return Float64Array.from(pieces.flatMap(p => [p.x0, p.y0, p.x1, p.y1]))
}

function clampBetween(value: number, a: number, b: number) {
  return Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b))
}

// How fast the drawing may move up or down for each px a pan carries it across
export const PAN_GLIDE = 1

// The vertical place of a drawing drawn at the window's scale. Each cut has
// one anchor: its reference centred between the pads, moved the least that
// keeps the whole cut inside them where it fits, or fills them with it where
// it does not. From there the drawing moves the least that fills the pads
// with what the pane's width shows where that is taller than them, or holds
// it all where it fits, counting what lies past the sides by PAN_GLIDE, so a
// pan moves it up or down no faster than across. Last, it holds the window's
// own reference, the reference whose bp lie in the window (`referenceReach`),
// inside them, however steep it runs and whatever else lies under the pane's
// width; at referenceScale it always fits.
export function windowTranslateY({
  segments,
  reference,
  held,
  scale,
  translateX,
  bounds,
  paneWidth,
  paneHeight,
  pads: { padTop = FIT_PADDING, padBottom = FIT_PADDING } = {},
}: {
  segments: Float64Array
  reference: Float64Array
  held: YRange | undefined
  scale: number
  translateX: number
  bounds: { minY: number; h: number }
  paneWidth: number
  paneHeight: number
  pads?: { padTop?: number; padBottom?: number }
}) {
  const usable = paneHeight - padTop - padBottom
  const inside = (place: number, reach: YRange | undefined) =>
    reach
      ? clampBetween(
          place,
          padTop - reach.minY * scale,
          padTop + usable - reach.maxY * scale,
        )
      : place
  const line = reachOver(reference, -Infinity, Infinity)
  const anchor = inside(
    padTop +
      usable / 2 -
      scale * (line ? (line.minY + line.maxY) / 2 : bounds.minY + bounds.h / 2),
    { minY: bounds.minY, maxY: bounds.minY + bounds.h },
  )
  const x0 = -translateX / scale
  const x1 = (paneWidth - translateX) / scale
  return inside(inside(anchor, reachOver(segments, x0, x1, PAN_GLIDE)), held)
}

// The track height that holds the whole cut drawn at `scale` between the pads
export function grownHeight(
  bounds: { h: number },
  scale: number,
  { padTop = FIT_PADDING, padBottom = FIT_PADDING } = {},
) {
  return Math.ceil(padTop + padBottom + bounds.h * scale)
}

export interface EdgeRun {
  x0: number
  x1: number
}

// Runs closer than this along an edge are marked as one
export const EDGE_RUN_GAP_PX = 16

function mergedRuns(runs: EdgeRun[]) {
  runs.sort((a, b) => a.x0 - b.x0)
  const out: EdgeRun[] = []
  for (const run of runs) {
    const last = out.at(-1)
    if (last && run.x0 - last.x1 <= EDGE_RUN_GAP_PX) {
      last.x1 = Math.max(last.x1, run.x1)
    } else {
      out.push({ ...run })
    }
  }
  return out
}

// Where the drawing crosses the pane's top and bottom edges on its way past
// them, in screen px inside the width, crossings closer than EDGE_RUN_GAP_PX
// taken as one run. The top edge sits under whatever the host lays over the
// pane's top.
export function edgeOverruns(
  segments: Float64Array,
  transform: { scale: number; translateX: number; translateY: number },
  paneWidth: number,
  edges: { top: number; bottom: number },
) {
  const { scale, translateX, translateY } = transform
  const top: EdgeRun[] = []
  const bottom: EdgeRun[] = []
  const crossing = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    edge: number,
    runs: EdgeRun[],
  ) => {
    if ((ay - edge) * (by - edge) < 0) {
      const x = ax + ((bx - ax) * (edge - ay)) / (by - ay)
      if (x >= 0 && x <= paneWidth) {
        runs.push({ x0: x, x1: x })
      }
    }
  }
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const ax = segments[i]! * scale + translateX
    const ay = segments[i + 1]! * scale + translateY
    const bx = segments[i + 2]! * scale + translateX
    const by = segments[i + 3]! * scale + translateY
    crossing(ax, ay, bx, by, edges.top, top)
    crossing(ax, ay, bx, by, edges.bottom, bottom)
  }
  return { top: mergedRuns(top), bottom: mergedRuns(bottom) }
}

export type EdgeOverruns = ReturnType<typeof edgeOverruns>

export const EDGE_MARK_PX = 8

// A triangle at the middle of each run of crossings, its tip on the edge and
// pointing off it, as long as the strip's tabs past its sides, haloed in paper so it reads
// over the strokes it sits on
export function drawEdgeMarks(
  ctx: CanvasRenderingContext2D,
  { top, bottom }: EdgeOverruns,
  edges: { top: number; bottom: number },
  { ink, paper }: { ink: string; paper: string },
) {
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = paper
  ctx.fillStyle = ink
  for (const [runs, edgeY, inward] of [
    [top, edges.top, 1],
    [bottom, edges.bottom, -1],
  ] as const) {
    for (const { x0, x1 } of runs) {
      const x = (x0 + x1) / 2
      const baseY = edgeY + inward * (EDGE_MARK_PX + 1)
      ctx.beginPath()
      ctx.moveTo(x, edgeY + inward)
      ctx.lineTo(x - EDGE_MARK_PX * 0.75, baseY)
      ctx.lineTo(x + EDGE_MARK_PX * 0.75, baseY)
      ctx.closePath()
      ctx.stroke()
      ctx.fill()
    }
  }
}
