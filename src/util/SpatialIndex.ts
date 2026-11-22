import { baseEdgeCurves } from './edgeCurves'
import { curveBounds, pathRibbonOffsets } from './geometry'

import type { DeletionRoutes } from '../layout/deletionRoutes'
import type { Graph, NodeSegment } from '../types'
import type { EdgeCurves } from './edgeCurves'
import type { AxisScale } from './geometry'

interface CellEntry {
  nodeId: string
  segmentIdx: number
}

// A uniform grid only performs when its cells are about the size of the things
// in them: too large and every query scans a crowd, too small and every item is
// stamped into hundreds of cells. World units here are whatever the layout uses,
// and the two differ by orders of magnitude — the force layout's are screen-ish
// (nodes ~8 units long), while the reference-anchored layouts put x in bp, so a
// 100 kb window is 100,000 units wide. A fixed 50 was tuned for the first and
// left the second stamping each edge into hundreds of cells: measured 7.2 ms to
// index 800 bp-scale edges, against 2.8 ms for 8,000 screen-scale ones.
//
// So the size is derived from the mean extent of the items being indexed —
// **per axis**, for the reason the query radius below is already per axis: on a
// row layout x is bp and y is screen px, and one size taken from the two summed
// is the x size. Applied to y it swallowed every row into one cell, so the grid
// degenerated to a 1-D index on x and each query handed the distance loop every
// row in the band. On HPRC's rGFA, whose mean segment is ~7 kb against a 20 px
// row pitch, that is all of them.
const FALLBACK_CELL_SIZE = 50

export interface CellSize {
  x: number
  y: number
}

function meanExtentCellSize(extentTotal: number, count: number) {
  return count > 0 ? Math.max(1, extentTotal / count) : FALLBACK_CELL_SIZE
}

// The y size for the layouts whose items have no y extent of their own. Every
// row there is a horizontal line, so the mean per-item extent is exactly zero
// and says nothing about how the rows are spaced. What separates them is the
// ROW PITCH, which is their spread over the number of rows they occupy.
function rowPitchOf(boxes: { minY: number }[]) {
  const distinct = new Set<number>()
  let min = Infinity
  let max = -Infinity
  for (const box of boxes) {
    distinct.add(box.minY)
    min = Math.min(min, box.minY)
    max = Math.max(max, box.minY)
  }
  return distinct.size > 1 ? (max - min) / (distinct.size - 1) : undefined
}

// A row layout with one row has nothing to separate on y, so it takes the x
// size and lands in one cell rather than being stamped across thousands.
function cellSizeFrom(
  boxes: { minY: number }[],
  extentX: number,
  extentY: number,
): CellSize {
  const x = meanExtentCellSize(extentX, boxes.length)
  return {
    x,
    y:
      extentY > 0
        ? meanExtentCellSize(extentY, boxes.length)
        : (rowPitchOf(boxes) ?? x),
  }
}

function resolveCellSize(
  given: number | CellSize | undefined,
  boxes: { minY: number }[],
  extentX: number,
  extentY: number,
): CellSize {
  return given === undefined
    ? cellSizeFrom(boxes, extentX, extentY)
    : typeof given === 'number'
      ? { x: given, y: given }
      : given
}

// A box over more cells than this, such as a link across a whole force
// layout, is kept in a list tested whole on each query; stamped, two such links
// at the MHC took 22 million cells each and ran the page out of heap
const MAX_STAMPED_CELLS = 1024

interface CellRange {
  cx0: number
  cx1: number
  cy0: number
  cy1: number
}

interface Found {
  cx: number
  cy: number
  rank: number
}

function getOrCreateCell(
  cells: Map<number, Map<number, number[]>>,
  cx: number,
  cy: number,
) {
  let row = cells.get(cx)
  if (!row) {
    row = new Map()
    cells.set(cx, row)
  }
  let cell = row.get(cy)
  if (!cell) {
    cell = []
    row.set(cy, cell)
  }
  return cell
}

function* occupiedWithin<V>(
  level: Map<number, V>,
  first: number,
  last: number,
): Generator<[number, V]> {
  if (last - first < level.size) {
    for (let key = first; key <= last; key++) {
      const value = level.get(key)
      if (value !== undefined) {
        yield [key, value]
      }
    }
  } else {
    const within: [number, V][] = []
    for (const entry of level) {
      if (entry[0] >= first && entry[0] <= last) {
        within.push(entry)
      }
    }
    within.sort((a, b) => a[0] - b[0])
    yield* within
  }
}

function overlaps(a: CellRange, b: CellRange) {
  return a.cx0 <= b.cx1 && b.cx0 <= a.cx1 && a.cy0 <= b.cy1 && b.cy0 <= a.cy1
}

function byCellThenRank(a: Found, b: Found) {
  return a.cx - b.cx || a.cy - b.cy || a.rank - b.rank
}

// A query returns each entry once, in the order a walk of the cells it covers
// first meets it, column by column and in order of adding within a cell. A
// wide box sorts in where that walk would have met it had it been stamped.
class BoxGrid<T> {
  private cells = new Map<number, Map<number, number[]>>()
  private wide: { rank: number; range: CellRange }[] = []
  private entries: T[] = []
  stamps = 0

  constructor(private cellSize: CellSize) {}

  private rangeOf(minX: number, minY: number, maxX: number, maxY: number) {
    return {
      cx0: Math.floor(minX / this.cellSize.x),
      cx1: Math.floor(maxX / this.cellSize.x),
      cy0: Math.floor(minY / this.cellSize.y),
      cy1: Math.floor(maxY / this.cellSize.y),
    }
  }

  add(minX: number, minY: number, maxX: number, maxY: number, entry: T) {
    const rank = this.entries.push(entry) - 1
    const range = this.rangeOf(minX, minY, maxX, maxY)
    const { cx0, cx1, cy0, cy1 } = range
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_STAMPED_CELLS) {
      this.wide.push({ rank, range })
    } else {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          getOrCreateCell(this.cells, cx, cy).push(rank)
          this.stamps++
        }
      }
    }
  }

  private *cellsWithin(q: CellRange) {
    for (const [cx, column] of occupiedWithin(this.cells, q.cx0, q.cx1)) {
      for (const [cy, cell] of occupiedWithin(column, q.cy0, q.cy1)) {
        yield { cx, cy, cell }
      }
    }
  }

  // The radius is per axis because the two axes need not be in the same units:
  // a row layout's x is bp and its y is screen px, so the same 5 px of slack is
  // hundreds of bp one way and 5 the other. Passing the x radius on both axes
  // would sweep every row in the band into the candidate set.
  query(x: number, y: number, radiusX: number, radiusY: number) {
    const q = this.rangeOf(x - radiusX, y - radiusY, x + radiusX, y + radiusY)
    const found: Found[] = []
    const seen = new Set<number>()
    for (const { cx, cy, cell } of this.cellsWithin(q)) {
      for (const rank of cell) {
        if (!seen.has(rank)) {
          seen.add(rank)
          found.push({ cx, cy, rank })
        }
      }
    }
    const wide = this.wide
      .filter(w => overlaps(w.range, q))
      .map(({ rank, range }) => ({
        cx: Math.max(range.cx0, q.cx0),
        cy: Math.max(range.cy0, q.cy0),
        rank,
      }))
    const ordered =
      wide.length > 0 ? [...found, ...wide].sort(byCellThenRank) : found
    return ordered.map(f => this.entries[f.rank]!)
  }

  some(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    test: (entry: T) => boolean,
  ) {
    const q = this.rangeOf(x - radiusX, y - radiusY, x + radiusX, y + radiusY)
    const passes = (rank: number) => test(this.entries[rank]!)
    let found = false
    for (const { cell } of this.cellsWithin(q)) {
      found = cell.some(passes)
      if (found) {
        break
      }
    }
    return found || this.wide.some(w => overlaps(w.range, q) && passes(w.rank))
  }
}

export class SpatialIndex {
  private grid: BoxGrid<CellEntry>

  constructor(
    nodePositions: Record<string, NodeSegment[]>,
    // one number sets both axes, which is what a test that only cares about
    // bucketing wants
    cellSize?: number | CellSize,
    smallestCell: CellSize = { x: 0, y: 0 },
  ) {
    // Segment boxes are collected first so the cell size can come from their
    // mean extent; the grid itself needs the size up front.
    const boxes: {
      entry: CellEntry
      minX: number
      minY: number
      maxX: number
      maxY: number
    }[] = []
    let extentX = 0
    let extentY = 0
    for (const [nodeId, segments] of Object.entries(nodePositions)) {
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i]!
        const next = segments[i + 1]!
        const minX = Math.min(seg.x, next.x)
        const minY = Math.min(seg.y, next.y)
        const maxX = Math.max(seg.x, next.x)
        const maxY = Math.max(seg.y, next.y)
        extentX += maxX - minX
        extentY += maxY - minY
        boxes.push({ entry: { nodeId, segmentIdx: i }, minX, minY, maxX, maxY })
      }
    }

    const fitted = resolveCellSize(cellSize, boxes, extentX, extentY)
    this.grid = new BoxGrid({
      x: Math.max(fitted.x, smallestCell.x),
      y: Math.max(fitted.y, smallestCell.y),
    })
    for (const b of boxes) {
      this.grid.add(b.minX, b.minY, b.maxX, b.maxY, b.entry)
    }
  }

  get stamps() {
    return this.grid.stamps
  }

  query(x: number, y: number, radiusX: number, radiusY = radiusX) {
    return this.grid.query(x, y, radiusX, radiusY)
  }

  some(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    test: (entry: CellEntry) => boolean,
  ) {
    return this.grid.some(x, y, radiusX, radiusY, test)
  }
}

export class EdgeSpatialIndex {
  private grid: BoxGrid<number>
  // Base curves (offset 0) by edge index — the shared derivation, which the
  // geometry builder draws the same edges from. findHoveredEdge reuses them on
  // every mousemove; path-offset variants translate them (pure translation).
  private edgeCurves: EdgeCurves

  constructor(
    nodePositions: Record<string, NodeSegment[]>,
    graph: Graph,
    drawPaths: boolean,
    // The transform the curves indexed here were drawn under, so hit detection
    // tests the shape on screen. See AxisScale.
    axis: AxisScale,
    // Bypassed backbone ids per deletion edge, as GeometryBuilder is given, so
    // a deletion is hit-tested on the arc drawn rather than on the straight
    // chord between its endpoints.
    deletions?: Map<number, string[]>,
    // Bumped when a drag moves the positions in place; see baseEdgeCurves.
    version = 0,
    routes?: DeletionRoutes,
    stranded = false,
  ) {
    this.edgeCurves = baseEdgeCurves(
      nodePositions,
      graph,
      axis,
      deletions,
      version,
      routes,
      stranded,
    )
    const boxes: {
      ei: number
      minX: number
      minY: number
      maxX: number
      maxY: number
    }[] = []
    let extentX = 0
    let extentY = 0
    for (let ei = 0; ei < graph.edges.length; ei++) {
      const edge = graph.edges[ei]!
      const fromSegments = nodePositions[edge.from]
      const toSegments = nodePositions[edge.to]
      const curves = this.edgeCurves.get(ei)
      if (fromSegments?.length && toSegments?.length && curves) {
        // The control polygon's box, which contains the curve — the same
        // measure the geometry builder culls by, from the one function that
        // takes it.
        let { minX, minY, maxX, maxY } = curveBounds(curves)

        // Ribbons sit off the edge itself, so the box has to hold them too. Per
        // axis and off the offsets actually used, rather than one number on
        // both: the fan is perpendicular to the edge, so an edge running along
        // x spends all of it on y and none on x, and on a row layout the two
        // axes are not even in the same units.
        const numPaths = edge.pathIds?.length ?? 0
        if (drawPaths && numPaths > 0) {
          let padX = 0
          let padY = 0
          for (const o of pathRibbonOffsets(
            fromSegments,
            toSegments,
            numPaths,
            axis,
            curves,
          )) {
            padX = Math.max(padX, Math.abs(o.x))
            padY = Math.max(padY, Math.abs(o.y))
          }
          minX -= padX
          minY -= padY
          maxX += padX
          maxY += padY
        }

        extentX += maxX - minX
        extentY += maxY - minY
        boxes.push({ ei, minX, minY, maxX, maxY })
      }
    }

    this.grid = new BoxGrid(cellSizeFrom(boxes, extentX, extentY))
    for (const b of boxes) {
      this.grid.add(b.minX, b.minY, b.maxX, b.maxY, b.ei)
    }
  }

  get stamps() {
    return this.grid.stamps
  }

  getCurves(ei: number) {
    return this.edgeCurves.get(ei)
  }

  query(x: number, y: number, radiusX: number, radiusY = radiusX) {
    return this.grid.query(x, y, radiusX, radiusY)
  }
}
