import { curveBounds } from './util/geometry'
import { segmentMeetsBox } from './util/hitDetection'
import { flattenedPx } from './util/strokeCover'
import { weakMemo } from './util/weakMemo'

import type { Box } from './overlayLabels'
import type { RenderBatch, Run } from './renderer/types'

// The strokes a drawing paints, as a label placed over them must know them:
// every node's and every link's, at the width each is drawn

export type InkBatch = Pick<
  RenderBatch,
  'nodeStrokes' | 'nodeStrokeRuns' | 'edgeCurves' | 'edgeCurveRuns'
>

export interface InkOwner {
  node?: string
  edge?: number
}

interface Point {
  x: number
  y: number
}

interface Piece extends InkOwner {
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

const cellKey = (cx: number, cy: number) => `${cx} ${cy}`

const cellOf = (px: number, least: number, most: number) =>
  Math.floor(Math.min(most, Math.max(least, px)) / CELL_PX)

// Each piece in the cells it may cover on the pane
function gridOf(pieces: readonly Piece[], f: Frame) {
  const cells = new Map<string, Piece[]>()
  for (const piece of pieces) {
    const { a, b, halfWidth: h } = piece
    const cx0 = cellOf(Math.min(a.x, b.x) - h, -h, f.width + h)
    const cx1 = cellOf(Math.max(a.x, b.x) + h, -h, f.width + h)
    const cy0 = cellOf(Math.min(a.y, b.y) - h, -h, f.height + h)
    const cy1 = cellOf(Math.max(a.y, b.y) + h, -h, f.height + h)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = cellKey(cx, cy)
        const cell = cells.get(key)
        if (cell) {
          cell.push(piece)
        } else {
          cells.set(key, [piece])
        }
      }
    }
  }
  return cells
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

const gridCache = weakMemo<Piece[], Map<string, Piece[]>>()

// Whether any stroke the batch paints, other than those `own` claims, meets a
// box in screen px, each stroke as wide as it is drawn
export function inkUnderBox(batch: InkBatch, f: Frame) {
  const pieces = piecesAt(batch, f)
  const cells = gridCache(pieces, [], () => gridOf(pieces, f))
  return (box: Box, own: (piece: InkOwner) => boolean) => {
    const cx1 = Math.floor(box.x1 / CELL_PX)
    const cy1 = Math.floor(box.y1 / CELL_PX)
    let found = false
    for (let cx = Math.floor(box.x0 / CELL_PX); cx <= cx1 && !found; cx++) {
      for (let cy = Math.floor(box.y0 / CELL_PX); cy <= cy1 && !found; cy++) {
        found =
          cells
            .get(cellKey(cx, cy))
            ?.some(
              piece =>
                !own(piece) &&
                segmentMeetsBox(piece.a, piece.b, grown(box, piece.halfWidth)),
            ) ?? false
      }
    }
    return found
  }
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
