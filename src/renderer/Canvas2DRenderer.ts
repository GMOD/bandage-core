import { getDpr, syncCanvasSize } from './canvas'
import {
  FADED_ALPHA,
  abgrToCssRgba,
  brightenAbgr,
  normalizedRgbToCssRgba,
} from './colorBits'
import { LANE_HEAD_HALO_PX } from './laneHeads'

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
// Canvas2D's cost is per path verb and per fill or stroke, not per pixel: a
// 15k-node graph mostly off the pane took 414 ms a frame as one fill per mesh
// triangle and far less as batched strokes. With the whole graph in view it
// still misses vsync, so jbrowse-plugin-graphgenomeviewer's ADR-047 moves
// drawing on screen to a WebGL2 backend and keeps this renderer for SVG and as
// the fallback (that repo's agent-docs/reference/GPU_RENDERING.md). Highlighted
// things are drawn last, in their own paths, so they sit on top of what they
// brighten.
// A link that skips reference sequence is drawn over the nodes it skips, since
// the dashes are the only mark a deletion has, and so is a link turning strand
// against the reference, whose ends lie under the nodes it joins wherever the
// layout puts them together, and a link the nodes would hide, its ends laid
// apart along them (linksAlongNodes); every other plain link lies under them.
// What is off the lifted walks is painted that same way into one layer of its
// own, under everything else, and laid down once at FADED_ALPHA.
// On a raster canvas a weight is drawn to the nearest WEIGHT_STEP_PX, so nodes
// widened by depth share a few dozen paths rather than one each: Chrome's GPU
// canvas drew 50,000 nodes of distinct depths in 1,060 ms a frame as 46,000
// strokes and in 590 ms as 68. A raster path is also stroked in pieces of
// SUBPATHS_PER_STROKE, since Chrome stroked a 50,000-node graph's two paths in
// 274 ms a frame and their 105 pieces in 201, and a subpath too short to see is
// drawn once per DOT_CELL_PX however many land there. A vector context keeps
// every weight as given and every subpath in one path.
export class Canvas2DRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  private transform: TransformUniform | null = null
  private batch: RenderBatch | null = null
  private nodeHighlights: ReadonlyMap<string, number> = new Map()
  private highlightedEdge: number | null = null
  private highlightFactor = 1
  private fit = 1
  private painted: PaintedGroups | null = null
  private readonly raster: boolean
  private readonly weightOf: (thickness: number) => number

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas 2D context not available')
    }
    this.canvas = canvas
    this.ctx = ctx
    this.raster = !isVector(ctx)
    this.weightOf = this.raster ? steppedWeight : exactWeight
  }

  setErrorHandler(_handler: (error: Error) => void) {}

  releaseOffscreenTargets() {
    releaseScratch()
  }

  // A host builds its transform at `getDpr()`. Where syncCanvasSize had to
  // shrink the ratio to stay under MAX_CANVAS_DIM_PX, `fit` shrinks the
  // transform to match, so the picture still fills the css box.
  resize(width: number, height: number) {
    this.fit = syncCanvasSize(this.canvas, width, height) / getDpr()
  }

  uploadGeometry(batch: RenderBatch) {
    this.batch = batch
    // A rebuild renumbers the strokes, so the old edge no longer addresses the
    // same run; the model re-applies the current hover against the new batch.
    this.highlightedEdge = null
    this.painted = null
  }

  setNodeHighlights(factors: ReadonlyMap<string, number>) {
    this.nodeHighlights = factors
    this.painted = null
  }

  setEdgeHighlight(edgeIndex: number | null, factor: number) {
    this.highlightedEdge = edgeIndex
    this.highlightFactor = factor
    this.painted = null
  }

  updateTransform(transform: TransformUniform) {
    this.transform = transform
  }

  private fitted() {
    const t = this.transform
    const k = this.fit
    return !t || k === 1
      ? t
      : {
          ...t,
          scaleX: t.scaleX * k,
          scaleY: t.scaleY * k,
          translateX: t.translateX * k,
          translateY: t.translateY * k,
          dpr: t.dpr * k,
        }
  }

  render(clearColor: [number, number, number, number]) {
    const t = this.fitted()
    if (!t) {
      return
    }
    const ctx = this.ctx
    const { width, height } = ctx.canvas

    // a clear colour short of opaque leaves what is under the canvas showing
    if (clearColor[3] < 1) {
      ctx.clearRect(0, 0, width, height)
    }
    if (clearColor[3] > 0) {
      ctx.fillStyle = normalizedRgbToCssRgba(
        [clearColor[0], clearColor[1], clearColor[2]],
        clearColor[3],
      )
      ctx.fillRect(0, 0, width, height)
    }

    const batch = this.batch
    if (!batch) {
      return
    }
    const groups = this.paintedGroups(batch)
    this.inFadedLayer(fadedOf(groups), layer => {
      this.paintGroups(layer, [], t)
    })
    this.paintGroups(plainOf(groups), groups.halos, t)
  }

  private paintGroups(
    { links, nodes, skips, liftedNodes, arrows }: PaintedLayer,
    halos: Arrowhead[],
    t: TransformUniform,
  ) {
    const ctx = this.ctx
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const group of links) {
      this.strokeCurves(group, t)
    }
    for (const group of nodes) {
      this.strokeNodes(group, t)
    }
    for (const group of skips) {
      this.strokeCurves(group, t)
    }
    for (const group of liftedNodes) {
      this.strokeNodes(group, t)
    }
    this.haloArrows(halos, t)
    for (const { color, items } of arrows) {
      this.fillArrows(items, color, t)
    }
  }

  // Paints `layer` opaque and lays it down at FADED_ALPHA in one step: through
  // the context's own opacity group where it has one (svgCanvas), otherwise
  // through a scratch canvas the size of this one
  private inFadedLayer<T extends PaintedLayer>(
    layer: T,
    paint: (layer: T) => void,
  ) {
    const ctx = this.ctx
    const alpha = this.batch?.fadedAlpha ?? FADED_ALPHA
    if (isEmptyLayer(layer)) {
      return
    }
    if (hasOpacityGroups(ctx)) {
      ctx.beginOpacityGroup(alpha)
      paint(layer)
      ctx.endOpacityGroup()
    } else {
      const scratch = scratchContext(ctx.canvas.width, ctx.canvas.height)
      this.ctx = scratch
      try {
        paint(layer)
      } finally {
        this.ctx = ctx
      }
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.drawImage(scratch.canvas, 0, 0)
      ctx.restore()
    }
  }

  // Grouping depends on the batch and the highlights, not on the transform, so
  // a pan or zoom redraws from the groups it already has
  private paintedGroups(batch: RenderBatch) {
    if (this.painted) {
      return this.painted
    }
    const factor = this.highlightFactor
    const edgeRun = this.edgeRun(batch.edgeCurveRuns)
    const arrowRun = this.edgeRun(batch.arrowRuns)
    const lifted = this.liftedStrokes(batch)
    const weightOf = this.weightOf
    const edgePaint = (e: EdgeCurveBatch, i: number) => ({
      color: inRun(edgeRun, i) ? brightenAbgr(e.color, factor) : e.color,
      weight: weightOf(e.thickness),
      last: inRun(edgeRun, i),
      skip: e.skip === true || e.turn === true || e.along === true,
      faded: e.faded === true,
    })
    const skipOrder = overNodesLongestFirst(batch.edgeCurves)
    const nodes = widestFirst(
      groupByPaint(batch.nodeStrokes, (s, i) => {
        const f = lifted.get(i)
        return {
          color: f === undefined ? s.color : brightenAbgr(s.color, f),
          weight: weightOf(s.thickness),
          last: f !== undefined,
          placeholder: s.placeholder === true,
          faded: s.faded === true,
        }
      }),
    )
    return (this.painted = {
      links: groupByPaint(batch.edgeCurves, edgePaint).filter(g => !g.skip),
      nodes: nodes.filter(g => !g.last),
      skips: paintRuns(
        skipOrder.map(i => batch.edgeCurves[i]!),
        (e, k) => edgePaint(e, skipOrder[k]!),
      ),
      liftedNodes: nodes.filter(g => g.last),
      halos: batch.arrows.filter(a => a.halo),
      arrows: groupByPaint(batch.arrows, (a, i) => ({
        color: inRun(arrowRun, i) ? brightenAbgr(a.color, factor) : a.color,
        weight: 0,
        last: inRun(arrowRun, i),
        faded: a.faded === true,
      })),
    })
  }

  // Only what the highlights lift, over a transparent clear, for a hover layer
  // stacked on a canvas that drew the batch without them: a pointer move then
  // repaints one node or edge rather than the whole drawing
  renderHighlights() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    const batch = this.batch
    const t = this.fitted()
    if (!t || !batch) {
      return
    }
    const factor = this.highlightFactor
    const weightOf = this.weightOf
    const curves = runItems(batch.edgeCurves, this.edgeRun(batch.edgeCurveRuns))
    const lifted = [...this.liftedStrokes(batch)]
    const arrows = runItems(batch.arrows, this.edgeRun(batch.arrowRuns))
    const groups: PaintedLayer = {
      links: groupByPaint(curves, e => ({
        color: brightenAbgr(e.color, factor),
        weight: weightOf(e.thickness),
        last: false,
        faded: e.faded === true,
      })),
      nodes: [],
      skips: [],
      liftedNodes: widestFirst(
        groupByPaint(lifted, ([i, f]) => {
          const s = batch.nodeStrokes[i]!
          return {
            color: brightenAbgr(s.color, f),
            weight: weightOf(s.thickness),
            last: false,
            placeholder: s.placeholder === true,
            faded: s.faded === true,
          }
        }),
      ).map(g => ({
        ...g,
        items: g.items.map(([i]) => batch.nodeStrokes[i]!),
      })),
      arrows: groupByPaint(arrows, a => ({
        color: brightenAbgr(a.color, factor),
        weight: 0,
        last: false,
        faded: a.faded === true,
      })),
    }
    this.inFadedLayer(fadedOf(groups), layer => {
      this.paintGroups(layer, [], t)
    })
    this.paintGroups(plainOf(groups), [], t)
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

  private strokeCurves(
    { items, color, weight }: Group<EdgeCurveBatch>,
    t: TransformUniform,
  ) {
    const ctx = this.ctx
    ctx.strokeStyle = abgrToCssRgba(color)
    // weight is the half-width in css px, so the stroke is twice it at the
    // device ratio the transform already carries
    ctx.lineWidth = weight * 2 * t.dpr
    const path = this.subpaths(t)
    for (const e of items) {
      const box = path.box()
      for (const c of e.curves) {
        box.add(c.x0, c.y0)
        box.add(c.cx0, c.cy0)
        box.add(c.cx1, c.cy1)
        box.add(c.x1, c.y1)
      }
      if (path.draws(box)) {
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
    }
    path.end()
  }

  private strokeNodes(
    { items, color, weight }: Group<NodeStroke>,
    t: TransformUniform,
  ) {
    const ctx = this.ctx
    ctx.strokeStyle = abgrToCssRgba(color)
    ctx.lineWidth = weight * 2 * t.dpr
    const path = this.subpaths(t)
    for (const s of items) {
      const box = path.box()
      for (const p of s.points) {
        box.add(p.x, p.y)
      }
      if (path.draws(box)) {
        const p0 = s.points[0]!
        ctx.moveTo(
          p0.x * t.scaleX + t.translateX,
          p0.y * t.scaleY + t.translateY,
        )
        for (let i = 1, l = s.points.length; i < l; i++) {
          const p = s.points[i]!
          ctx.lineTo(
            p.x * t.scaleX + t.translateX,
            p.y * t.scaleY + t.translateY,
          )
        }
      }
    }
    path.end()
  }

  // One paint group's path as it is laid down: a raster one stroked every
  // SUBPATHS_PER_STROKE subpaths, and a dot drawn once per cell it lands in
  private subpaths(t: TransformUniform) {
    const ctx = this.ctx
    const raster = this.raster
    const dotCells = new Set<number>()
    const screenBox = new ScreenBox(t)
    let count = 0
    ctx.beginPath()
    return {
      box() {
        screenBox.empty()
        return screenBox
      },
      draws(box: ScreenBox) {
        const cell = raster ? box.dotCell() : undefined
        const fresh = cell === undefined || !dotCells.has(cell)
        if (fresh) {
          if (cell !== undefined) {
            dotCells.add(cell)
          }
          if (raster && count === SUBPATHS_PER_STROKE) {
            ctx.stroke()
            ctx.beginPath()
            count = 0
          }
          count++
        }
        return fresh
      },
      end() {
        ctx.stroke()
      },
    }
  }

  private traceArrows(items: Arrowhead[], t: TransformUniform) {
    const ctx = this.ctx
    ctx.beginPath()
    for (const a of items) {
      const [tip, left, notch, right] = arrowheadOutline(a, t)
      ctx.moveTo(tip.x, tip.y)
      ctx.lineTo(left.x, left.y)
      ctx.lineTo(notch.x, notch.y)
      ctx.lineTo(right.x, right.y)
      ctx.closePath()
    }
  }

  private haloArrows(items: Arrowhead[], t: TransformUniform) {
    if (items.length > 0) {
      this.ctx.strokeStyle = 'rgba(255,255,255,1)'
      this.ctx.lineWidth = 2 * LANE_HEAD_HALO_PX * t.dpr
      this.traceArrows(items, t)
      this.ctx.stroke()
    }
  }

  private fillArrows(items: Arrowhead[], color: number, t: TransformUniform) {
    this.ctx.fillStyle = abgrToCssRgba(color)
    this.traceArrows(items, t)
    this.ctx.fill()
  }

  dispose() {
    this.batch = null
    this.nodeHighlights = new Map()
    this.highlightedEdge = null
    this.painted = null
    releaseScratch()
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
  const notchBack = length * (1 - (a.runsOn ? 0 : ARROW_NOTCH))
  return [
    { x: tipX, y: tipY },
    { x: backX - uy * halfWidth, y: backY + ux * halfWidth },
    { x: tipX - ux * notchBack, y: tipY - uy * notchBack },
    { x: backX + uy * halfWidth, y: backY - ux * halfWidth },
  ] as const
}

// A raster weight's step, as a half-width in css px: a stroke draws within
// 1/8 px of its width at a device ratio of 1 and 1/4 px at 2. A weight under
// the step is drawn as given, so a hairline never thickens to it.
export const WEIGHT_STEP_PX = 1 / 8

// How many subpaths a raster stroke() takes
export const SUBPATHS_PER_STROKE = 1024

// A subpath inside DOT_PX either way on screen draws as little more than its
// round cap. Where another such subpath of its paint group already lies within
// the same DOT_CELL_PX cell, the two draw within a fraction of a pixel of each
// other, so it is left out.
export const DOT_PX = 1 / 4
export const DOT_CELL_PX = 1 / 8

class ScreenBox {
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity
  constructor(private readonly t: TransformUniform) {}

  empty() {
    this.minX = Infinity
    this.minY = Infinity
    this.maxX = -Infinity
    this.maxY = -Infinity
  }

  add(x: number, y: number) {
    const sx = x * this.t.scaleX + this.t.translateX
    const sy = y * this.t.scaleY + this.t.translateY
    this.minX = Math.min(this.minX, sx)
    this.maxX = Math.max(this.maxX, sx)
    this.minY = Math.min(this.minY, sy)
    this.maxY = Math.max(this.maxY, sy)
  }

  dotCell() {
    return this.maxX - this.minX < DOT_PX && this.maxY - this.minY < DOT_PX
      ? Math.round((this.minX + this.maxX) / 2 / DOT_CELL_PX) * 2 ** 26 +
          Math.round((this.minY + this.maxY) / 2 / DOT_CELL_PX)
      : undefined
  }
}

function steppedWeight(thickness: number) {
  return thickness < WEIGHT_STEP_PX
    ? thickness
    : Math.round(thickness / WEIGHT_STEP_PX) * WEIGHT_STEP_PX
}

function exactWeight(thickness: number) {
  return thickness
}

function isVector(ctx: object) {
  return 'vector' in ctx && ctx.vector === true
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
  // drawn under every other node, so what is loaded lies over what is not
  placeholder?: boolean
  // a link drawn over the nodes rather than under them
  skip?: boolean
  // painted in the faded layer
  faded?: boolean
}

interface PaintedLayer {
  links: Group<EdgeCurveBatch>[]
  nodes: Group<NodeStroke>[]
  skips: Group<EdgeCurveBatch>[]
  liftedNodes: Group<NodeStroke>[]
  arrows: Group<Arrowhead>[]
}

interface PaintedGroups extends PaintedLayer {
  halos: Arrowhead[]
}

interface Group<T> {
  color: number
  weight: number
  last: boolean
  placeholder: boolean
  skip: boolean
  faded: boolean
  items: T[]
}

function layerOf(groups: PaintedLayer, faded: boolean): PaintedLayer {
  const keep = <T>(g: Group<T>[]) => g.filter(x => x.faded === faded)
  return {
    links: keep(groups.links),
    nodes: keep(groups.nodes),
    skips: keep(groups.skips),
    liftedNodes: keep(groups.liftedNodes),
    arrows: keep(groups.arrows),
  }
}

const fadedOf = (groups: PaintedLayer) => layerOf(groups, true)
const plainOf = (groups: PaintedLayer) => layerOf(groups, false)

function isEmptyLayer({
  links,
  nodes,
  skips,
  liftedNodes,
  arrows,
}: PaintedLayer) {
  return (
    links.length +
      nodes.length +
      skips.length +
      liftedNodes.length +
      arrows.length ===
    0
  )
}

// A context that composites what is drawn between the two calls as one layer
// at an opacity, as SVG's <g opacity> does
interface OpacityGroups {
  beginOpacityGroup(opacity: number): void
  endOpacityGroup(): void
}

function hasOpacityGroups(ctx: object): ctx is OpacityGroups {
  return 'beginOpacityGroup' in ctx && 'endOpacityGroup' in ctx
}

// One scratch canvas for every renderer: a frame paints synchronously, so
// renderers never use it at the same time
let scratch: CanvasRenderingContext2D | undefined

function scratchContext(width: number, height: number) {
  const ctx =
    scratch ?? document.createElement('canvas').getContext('2d') ?? undefined
  if (!ctx) {
    throw new Error('Canvas 2D context not available')
  }
  scratch = ctx
  if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
    ctx.canvas.width = width
    ctx.canvas.height = height
  } else {
    ctx.clearRect(0, 0, width, height)
  }
  return ctx
}

function releaseScratch() {
  if (scratch) {
    scratch.canvas.width = 0
    scratch.canvas.height = 0
    scratch = undefined
  }
}

// Items bucketed by what they are painted with, in first-seen order, with the
// `last` ones after the rest.
function groupByPaint<T>(
  items: T[],
  paintOf: (item: T, index: number) => Paint,
): Group<T>[] {
  const groups = new Map<string, Group<T>>()
  const deferred = new Map<string, Group<T>>()
  for (let i = 0, l = items.length; i < l; i++) {
    const item = items[i]!
    const {
      color,
      weight,
      last,
      placeholder = false,
      skip = false,
      faded = false,
    } = paintOf(item, i)
    const into = last ? deferred : groups
    const key = `${color}:${weight}:${placeholder}:${skip}:${faded}`
    const group = into.get(key)
    if (group) {
      group.items.push(item)
    } else {
      into.set(key, {
        color,
        weight,
        last,
        placeholder,
        skip,
        faded,
        items: [item],
      })
    }
  }
  return [...groups.values(), ...deferred.values()]
}

// Items in their own order, a group per run of one paint, with the `last`
// ones after the rest
function paintRuns<T>(
  items: T[],
  paintOf: (item: T, index: number) => Paint,
): Group<T>[] {
  const runs: Group<T>[] = []
  const deferred: Group<T>[] = []
  for (let i = 0, l = items.length; i < l; i++) {
    const item = items[i]!
    const {
      color,
      weight,
      last,
      placeholder = false,
      skip = false,
      faded = false,
    } = paintOf(item, i)
    const into = last ? deferred : runs
    const run = into.at(-1)
    if (
      run?.color === color &&
      run.weight === weight &&
      run.placeholder === placeholder &&
      run.skip === skip &&
      run.faded === faded
    ) {
      run.items.push(item)
    } else {
      into.push({
        color,
        weight,
        last,
        placeholder,
        skip,
        faded,
        items: [item],
      })
    }
  }
  return [...runs, ...deferred]
}

function overNodesLongestFirst(edgeCurves: EdgeCurveBatch[]) {
  return edgeCurves
    .flatMap((e, i) => (e.skip || e.turn || e.along ? [i] : []))
    .toSorted((a, b) => (edgeCurves[b]!.span ?? 0) - (edgeCurves[a]!.span ?? 0))
}

function widestFirst<T>(groups: Group<T>[]) {
  return groups.toSorted(
    (a, b) =>
      Number(a.last) - Number(b.last) ||
      Number(b.placeholder) - Number(a.placeholder) ||
      b.weight - a.weight,
  )
}
