import { syncCanvasSize } from './canvas'
import {
  abgrToCssRgba,
  brightenAbgr,
  normalizedRgbToCssRgba,
} from './colorBits'

import type {
  Arrowhead,
  EdgeCurveBatch,
  NodeStroke,
  RenderBatch,
  Renderer,
  Run,
  TransformUniform,
} from './types'

// Everything is drawn as a handful of paths, one per distinct (colour, weight),
// rather than one path per thing. A drawing is mostly runs of one colour, and
// Canvas2D's cost is per path verb and per fill or stroke, not per pixel: the
// same 15k-node graph took 414 ms a frame as one fill per mesh triangle and 11
// ms as batched strokes (agent-docs/GRAPH_SCALE_AND_LOD.md). Highlighted things
// are drawn last, in their own paths, so they sit on top of what they brighten.
//
// `setErrorHandler` is a no-op that a host's rendering-backend lifecycle can
// call: Canvas2D allocates no GPU resources, so there is no OOM channel to
// forward.
export class Canvas2DRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  private transform: TransformUniform | null = null
  private batch: RenderBatch | null = null
  private nodeHighlights: ReadonlyMap<string, number> = new Map()
  private highlightedEdge: number | null = null
  private highlightFactor = 1

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas 2D context not available')
    }
    this.canvas = canvas
    this.ctx = ctx
  }

  setErrorHandler(_handler: (error: Error) => void) {}

  releaseOffscreenTargets() {}

  // Not a local `width * devicePixelRatio`: syncCanvasSize clamps the backing
  // store at MAX_CANVAS_DIM_PX, reads the ratio through `getDpr()` so this
  // agrees with the transform the model builds, and writes the css size
  // independently of the backing size.
  resize(width: number, height: number) {
    syncCanvasSize(this.canvas, width, height)
  }

  uploadGeometry(batch: RenderBatch) {
    this.batch = batch
    // A rebuild renumbers the strokes, so the old edge no longer addresses the
    // same run; the model re-applies the current hover against the new batch.
    this.highlightedEdge = null
  }

  setNodeHighlights(factors: ReadonlyMap<string, number>) {
    this.nodeHighlights = factors
  }

  setEdgeHighlight(edgeIndex: number | null, factor: number) {
    this.highlightedEdge = edgeIndex
    this.highlightFactor = factor
  }

  updateTransform(transform: TransformUniform) {
    this.transform = transform
  }

  render(clearColor: [number, number, number, number]) {
    const t = this.transform
    if (!t) {
      return
    }
    const ctx = this.ctx
    const { width, height } = ctx.canvas

    // a clear colour short of opaque leaves what is under the canvas showing
    if (clearColor[3] < 1) {
      ctx.clearRect(0, 0, width, height)
    }
    ctx.fillStyle = normalizedRgbToCssRgba(
      [clearColor[0], clearColor[1], clearColor[2]],
      clearColor[3],
    )
    ctx.fillRect(0, 0, width, height)

    const batch = this.batch
    if (!batch) {
      return
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const factor = this.highlightFactor
    const edgeRun = this.edgeRun(batch.edgeCurveRuns)
    for (const { color, items } of groupByPaint(batch.edgeCurves, (e, i) => ({
      color: inRun(edgeRun, i) ? brightenAbgr(e.color, factor) : e.color,
      weight: e.thickness,
      last: inRun(edgeRun, i),
    }))) {
      this.strokeCurves(items, color)
    }
    const lifted = this.liftedStrokes(batch)
    for (const { color, items } of groupByPaint(batch.nodeStrokes, (s, i) => {
      const f = lifted.get(i)
      return {
        color: f === undefined ? s.color : brightenAbgr(s.color, f),
        weight: s.thickness,
        last: f !== undefined,
      }
    })) {
      this.strokeNodes(items, color)
    }
    const arrowRun = this.edgeRun(batch.arrowRuns)
    for (const { color, items } of groupByPaint(batch.arrows, (a, i) => ({
      color: inRun(arrowRun, i) ? brightenAbgr(a.color, factor) : a.color,
      weight: 0,
      last: inRun(arrowRun, i),
    }))) {
      this.fillArrows(items, color)
    }
  }

  // Only what the highlights lift, over a transparent clear, for a hover layer
  // stacked on a canvas that drew the batch without them: a pointer move then
  // repaints one node or edge rather than the whole drawing
  renderHighlights() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    const batch = this.batch
    if (!this.transform || !batch) {
      return
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const factor = this.highlightFactor
    const curves = runItems(batch.edgeCurves, this.edgeRun(batch.edgeCurveRuns))
    for (const { color, items } of groupByPaint(curves, e => ({
      color: brightenAbgr(e.color, factor),
      weight: e.thickness,
      last: false,
    }))) {
      this.strokeCurves(items, color)
    }
    const lifted = [...this.liftedStrokes(batch)]
    for (const { color, items } of groupByPaint(lifted, ([i, f]) => ({
      color: brightenAbgr(batch.nodeStrokes[i]!.color, f),
      weight: batch.nodeStrokes[i]!.thickness,
      last: false,
    }))) {
      this.strokeNodes(
        items.map(([i]) => batch.nodeStrokes[i]!),
        color,
      )
    }
    const arrows = runItems(batch.arrows, this.edgeRun(batch.arrowRuns))
    for (const { color, items } of groupByPaint(arrows, a => ({
      color: brightenAbgr(a.color, factor),
      weight: 0,
      last: false,
    }))) {
      this.fillArrows(items, color)
    }
  }

  private edgeRun(runs: Map<number, Run>) {
    return this.highlightedEdge === null
      ? undefined
      : runs.get(this.highlightedEdge)
  }

  // stroke index -> brighten factor, for the nodes the model lifted
  private liftedStrokes(batch: RenderBatch) {
    const lifted = new Map<number, number>()
    for (const [nodeId, factor] of this.nodeHighlights) {
      const run = batch.nodeStrokeRuns.get(nodeId)
      if (run) {
        for (let i = run.start; i < run.start + run.count; i++) {
          lifted.set(i, factor)
        }
      }
    }
    return lifted
  }

  private strokeCurves(items: EdgeCurveBatch[], color: number) {
    const t = this.transform!
    const ctx = this.ctx
    ctx.strokeStyle = abgrToCssRgba(color)
    // thickness is the half-width in css px, so the stroke is twice it at
    // the device ratio the transform already carries
    ctx.lineWidth = items[0]!.thickness * 2 * t.dpr
    ctx.beginPath()
    for (const e of items) {
      const first = e.curves[0]!
      ctx.moveTo(
        first.x0 * t.scaleX + t.translateX,
        first.y0 * t.scaleY + t.translateY,
      )
      for (const c of e.curves) {
        ctx.bezierCurveTo(
          c.cx0 * t.scaleX + t.translateX,
          c.cy0 * t.scaleY + t.translateY,
          c.cx1 * t.scaleX + t.translateX,
          c.cy1 * t.scaleY + t.translateY,
          c.x1 * t.scaleX + t.translateX,
          c.y1 * t.scaleY + t.translateY,
        )
      }
    }
    ctx.stroke()
  }

  private strokeNodes(items: NodeStroke[], color: number) {
    const t = this.transform!
    const ctx = this.ctx
    ctx.strokeStyle = abgrToCssRgba(color)
    ctx.lineWidth = items[0]!.thickness * 2 * t.dpr
    ctx.beginPath()
    for (const s of items) {
      const p0 = s.points[0]!
      ctx.moveTo(p0.x * t.scaleX + t.translateX, p0.y * t.scaleY + t.translateY)
      for (let i = 1, l = s.points.length; i < l; i++) {
        const p = s.points[i]!
        ctx.lineTo(p.x * t.scaleX + t.translateX, p.y * t.scaleY + t.translateY)
      }
    }
    ctx.stroke()
  }

  private fillArrows(items: Arrowhead[], color: number) {
    const t = this.transform!
    const ctx = this.ctx
    ctx.fillStyle = abgrToCssRgba(color)
    ctx.beginPath()
    for (const a of items) {
      const [tip, left, notch, right] = arrowheadOutline(a, t)
      ctx.moveTo(tip.x, tip.y)
      ctx.lineTo(left.x, left.y)
      ctx.lineTo(notch.x, notch.y)
      ctx.lineTo(right.x, right.y)
      ctx.closePath()
    }
    ctx.fill()
  }

  dispose() {
    this.batch = null
    this.nodeHighlights = new Map()
    this.highlightedEdge = null
  }
}

// How far the back of the head is cut in toward the tip, as a fraction of its
// length. The notch leaves the edge showing through the back of the head, so
// the head reads as the end of the edge rather than a triangle laid over it.
const ARROW_NOTCH = 0.25

// Tip, left barb, notch and right barb in backing-store px.
export function arrowheadOutline(a: Arrowhead, t: TransformUniform) {
  const ux = Math.cos(a.angle)
  const uy = Math.sin(a.angle)
  const tipX = a.x * t.scaleX + t.translateX
  const tipY = a.y * t.scaleY + t.translateY
  const length = a.length * t.dpr
  const halfWidth = a.halfWidth * t.dpr
  const backX = tipX - ux * length
  const backY = tipY - uy * length
  const notchBack = length * (1 - ARROW_NOTCH)
  return [
    { x: tipX, y: tipY },
    { x: backX - uy * halfWidth, y: backY + ux * halfWidth },
    { x: tipX - ux * notchBack, y: tipY - uy * notchBack },
    { x: backX + uy * halfWidth, y: backY - ux * halfWidth },
  ] as const
}

function runItems<T>(items: T[], run: Run | undefined) {
  return run ? items.slice(run.start, run.start + run.count) : []
}

function inRun(run: Run | undefined, i: number) {
  return run !== undefined && i >= run.start && i < run.start + run.count
}

interface Paint {
  color: number
  weight: number
  // drawn after everything else, so a highlight lands on top of its neighbours
  last: boolean
}

// Items bucketed by what they are painted with, in first-seen order, with the
// `last` ones after the rest.
function groupByPaint<T>(
  items: T[],
  paintOf: (item: T, index: number) => Paint,
) {
  const groups = new Map<string, { color: number; items: T[] }>()
  const deferred = new Map<string, { color: number; items: T[] }>()
  for (let i = 0, l = items.length; i < l; i++) {
    const item = items[i]!
    const { color, weight, last } = paintOf(item, i)
    const into = last ? deferred : groups
    const key = `${color}:${weight}`
    const group = into.get(key)
    if (group) {
      group.items.push(item)
    } else {
      into.set(key, { color, items: [item] })
    }
  }
  return [...groups.values(), ...deferred.values()]
}
