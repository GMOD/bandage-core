import { curveBounds } from './util/geometry'
import { segmentMeetsBox } from './util/hitDetection'
import { flattenedPx } from './util/strokeCover'
import { weakMemo } from './util/weakMemo'

import type { Box } from './overlayLabels'
import type { EdgeCurveBatch, RenderBatch, Run } from './renderer/types'
import type { AxisScale } from './util/geometry'

// The strokes a drawing paints, as a label placed over them must know them:
// every node's and every link's, at the width each is drawn

export type InkBatch = Pick<
  RenderBatch,
  'nodeStrokes' | 'nodeStrokeRuns' | 'edgeCurves' | 'edgeCurveRuns'
>

export interface InkOwner {
  node?: string
  edge?: number
  // the node an exon outline is drawn round
  exon?: string
}

interface Point {
  x: number
  y: number
}

export interface Piece extends InkOwner {
  a: Point
  b: Point
  halfWidth: number
}

export interface Frame {
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
  width: number
  height: number
}

const CELL_PX = 32
const FLATNESS_PX = 0.5

function ownersOf<K>(runs: ReadonlyMap<K, Run>, count: number) {
  const owners = new Array<K | undefined>(count)
  for (const [owner, { start, count: n }] of runs) {
    for (let i = start; i < start + n; i++) {
      owners[i] = owner
    }
  }
  return owners
}

const grown = (box: Box, by: number) => ({
  x0: box.x0 - by,
  x1: box.x1 + by,
  y0: box.y0 - by,
  y1: box.y1 + by,
})

const meets = (a: Point, b: Point, box: Box) =>
  Math.max(a.x, b.x) >= box.x0 &&
  Math.min(a.x, b.x) <= box.x1 &&
  Math.max(a.y, b.y) >= box.y0 &&
  Math.min(a.y, b.y) <= box.y1

// Each stroke's pieces on screen that come within its half-width of the pane
function piecesOf(batch: InkBatch, f: Frame) {
  const pane = { x0: 0, x1: f.width, y0: 0, y1: f.height }
  const screen = (p: Point) => ({
    x: p.x * f.scaleX + f.translateX,
    y: p.y * f.scaleY + f.translateY,
  })
  const pieces: Piece[] = []
  const nodeOf = ownersOf(batch.nodeStrokeRuns, batch.nodeStrokes.length)
  batch.nodeStrokes.forEach((stroke, i) => {
    const near = grown(pane, stroke.thickness)
    const points = stroke.points.map(screen)
    const node = nodeOf[i]
    points.forEach((b, k) => {
      const a = points[k - 1] ?? (points.length === 1 ? b : undefined)
      if (a && meets(a, b, near)) {
        pieces.push({ a, b, halfWidth: stroke.thickness, node })
      }
    })
  })
  const edgeOf = ownersOf(batch.edgeCurveRuns, batch.edgeCurves.length)
  batch.edgeCurves.forEach((stroke, i) => {
    const near = grown(pane, stroke.thickness)
    const edge = edgeOf[i]
    for (const c of stroke.curves) {
      const { minX, minY, maxX, maxY } = curveBounds([c])
      if (
        meets(screen({ x: minX, y: minY }), screen({ x: maxX, y: maxY }), near)
      ) {
        const line = flattenedPx(c, f.scaleX, f.scaleY, FLATNESS_PX).map(p => ({
          x: p.x + f.translateX,
          y: p.y + f.translateY,
        }))
        line.forEach((b, k) => {
          const a = line[k - 1]
          if (a && meets(a, b, near)) {
            pieces.push({ a, b, halfWidth: stroke.thickness, edge })
          }
        })
      }
    }
  })
  return pieces
}

interface Bounded {
  piece: Piece
  x0: number
  x1: number
  y0: number
  y1: number
}

// Whether any piece, other than those `own` claims, meets a box in screen px,
// each piece as wide as its half-width; the pieces are held in cells of
// `cellPx` clamped to `within`, those past it in its edge cells, and each is
// refused on its bounds before the exact test
export function piecesUnderBox(
  pieces: readonly Piece[],
  within: Box,
  cellPx = CELL_PX,
) {
  const reach = pieces.reduce((most, p) => Math.max(most, p.halfWidth), 0)
  const first = { x: within.x0 - reach, y: within.y0 - reach }
  const columns = Math.floor((within.x1 + reach - first.x) / cellPx) + 1
  const rows = Math.floor((within.y1 + reach - first.y) / cellPx) + 1
  const cellX = (px: number) =>
    Math.min(columns - 1, Math.max(0, Math.floor((px - first.x) / cellPx)))
  const cellY = (px: number) =>
    Math.min(rows - 1, Math.max(0, Math.floor((px - first.y) / cellPx)))
  const cells: (Bounded[] | undefined)[] = []
  for (const piece of pieces) {
    const { a, b, halfWidth: h } = piece
    const bounded = {
      piece,
      x0: Math.min(a.x, b.x) - h,
      x1: Math.max(a.x, b.x) + h,
      y0: Math.min(a.y, b.y) - h,
      y1: Math.max(a.y, b.y) + h,
    }
    const cx1 = cellX(bounded.x1)
    const cy1 = cellY(bounded.y1)
    for (let cx = cellX(bounded.x0); cx <= cx1; cx++) {
      for (let cy = cellY(bounded.y0); cy <= cy1; cy++) {
        ;(cells[cx * rows + cy] ??= []).push(bounded)
      }
    }
  }
  return (box: Box, own: (piece: InkOwner) => boolean) => {
    const cx1 = cellX(box.x1)
    const cy1 = cellY(box.y1)
    let found = false
    for (let cx = cellX(box.x0); cx <= cx1 && !found; cx++) {
      for (let cy = cellY(box.y0); cy <= cy1 && !found; cy++) {
        found =
          cells[cx * rows + cy]?.some(
            ({ piece, x0, x1, y0, y1 }) =>
              box.x1 >= x0 &&
              box.x0 <= x1 &&
              box.y1 >= y0 &&
              box.y0 <= y1 &&
              !own(piece) &&
              segmentMeetsBox(piece.a, piece.b, grown(box, piece.halfWidth)),
          ) ?? false
      }
    }
    return found
  }
}

const piecesCache = weakMemo<InkBatch['nodeStrokes'], Piece[]>()

// The batch's pieces on the pane of a frame, held for that frame
function piecesAt(batch: InkBatch, f: Frame) {
  return piecesCache(
    batch.nodeStrokes,
    [
      batch.edgeCurves,
      f.scaleX,
      f.scaleY,
      f.translateX,
      f.translateY,
      f.width,
      f.height,
    ],
    () => piecesOf(batch, f),
  )
}

const gridCache = weakMemo<Piece[], ReturnType<typeof piecesUnderBox>>()

// Whether any stroke the batch paints, other than those `own` claims, meets a
// box in screen px, each stroke as wide as it is drawn
export function inkUnderBox(batch: InkBatch, f: Frame) {
  const pieces = piecesAt(batch, f)
  return gridCache(pieces, [], () =>
    piecesUnderBox(pieces, { x0: 0, x1: f.width, y0: 0, y1: f.height }),
  )
}

const PIECE_PRECISION = 100

const pieceKey = ({ a, b, halfWidth, node, edge }: Piece) =>
  `${[a.x, a.y, b.x, b.y].map(v => Math.round(v * PIECE_PRECISION)).join(' ')} ${halfWidth} ${node ?? ''} ${edge ?? ''}`

// Whether two batches paint the same ink on the pane of a frame, each stroke
// where it is drawn to a hundredth of a px, as wide, and of the same node or
// link, so what was placed clear of the one's ink is clear of the other's
export function sameInkOnPane(a: InkBatch, b: InkBatch, f: Frame) {
  const keysOf = (batch: InkBatch) => piecesAt(batch, f).map(pieceKey).sort()
  const ka = a === b ? [] : keysOf(a)
  const kb = a === b ? [] : keysOf(b)
  return ka.length === kb.length && ka.every((key, i) => key === kb[i])
}

// The widest any of these nodes is drawn, as a half-width in px
export function widestStroke(batch: InkBatch, nodes: Iterable<string>) {
  let widest = 0
  for (const id of nodes) {
    const run = batch.nodeStrokeRuns.get(id)
    if (run) {
      for (let i = run.start; i < run.start + run.count; i++) {
        widest = Math.max(widest, batch.nodeStrokes[i]?.thickness ?? 0)
      }
    }
  }
  return widest
}

// The point halfway along a run of strokes as they lie on screen, in layout
// units, gaps between dashes counted as part of the way
function halfwayAlong(strokes: readonly EdgeCurveBatch[], axis: AxisScale) {
  const line = strokes.flatMap(s =>
    s.curves.flatMap(c =>
      flattenedPx(c, axis.scaleX, axis.scaleY, FLATNESS_PX),
    ),
  )
  const steps = line.map((b, k) => {
    const a = line[k - 1] ?? b
    return Math.hypot(b.x - a.x, b.y - a.y)
  })
  let left = steps.reduce((sum, step) => sum + step, 0) / 2
  let k = 0
  while (k < steps.length - 1 && left > (steps[k] ?? 0)) {
    left -= steps[k] ?? 0
    k++
  }
  const b = line[k]
  const a = line[k - 1] ?? b
  const step = steps[k] ?? 0
  const along = step > 0 ? left / step : 0
  return a && b
    ? {
        x: (a.x + (b.x - a.x) * along) / axis.scaleX,
        y: (a.y + (b.y - a.y) * along) / axis.scaleY,
      }
    : undefined
}

// Where each drawn skip's middle lies, by link index, in layout units as
// nodePositions are: halfway along its arch as drawn on the pane, or, where
// only lifted walks' lanes draw it, the mean of their lanes' halfway points,
// the middle of the band
export function skipMidpoints(batch: InkBatch, axis: AxisScale) {
  const midpoints = new Map<number, Point>()
  for (const [edge, { start, count }] of batch.edgeCurveRuns) {
    const lanes = new Map<string, EdgeCurveBatch[]>()
    for (const stroke of batch.edgeCurves.slice(start, start + count)) {
      if (stroke.skip) {
        const key =
          stroke.walk === undefined ? '' : `${stroke.walk} ${stroke.pass}`
        const lane = lanes.get(key) ?? []
        lane.push(stroke)
        lanes.set(key, lane)
      }
    }
    const plain = lanes.get('')
    const points = (plain ? [plain] : [...lanes.values()])
      .map(strokes => halfwayAlong(strokes, axis))
      .filter(p => p !== undefined)
    if (points.length > 0) {
      midpoints.set(edge, {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
      })
    }
  }
  return midpoints
}
