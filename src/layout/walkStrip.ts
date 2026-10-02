import { ROW_HEIGHT_PX } from './rowSpacing'
import { alongRow, boxesGenes } from './walkRowDraw'
import { el } from '../el'
import { LABEL_CHAR_PX } from '../overlayLabels'
import { pathOrigin } from '../pathAnchoring'

import type { GeneGaps, WalkRowsFrame } from './walkRowDraw'
import type { WalkRow, WalkRows } from './walkRows'
import type { Graph, GraphNode } from '../types'

// Walk rows as a strip under a node layout, linked to it: a node's visits as
// ticks on each bar, and the node under a point on a bar. Rows are small
// multiples of one mapping, x the walk's own bp and colour whether it runs on
// the reference's path, so the strip shows every row and sizes them to fit,
// down to a dense overview, rather than asking which to show.

const PAD_PX = 6
// the most height the strip takes, its rows shrinking to fit
export const WALK_STRIP_CEILING_PX = 260
const LABEL_FONT_PX = 11
const MIN_ROW_PX = 3
// rows thinner than this go unlabelled, their names and readouts on hover
export const LABELLED_ROW_PX = 12
const READOUT_ROOM = 1.3
const MARK_INK = '#111'
const TICK_PX = 3

export interface StripMark {
  row: string
  start: number
  bp: number
}

// Where each row's walk passes `node`, as offsets along its bar: once per
// visit, so a walk through a collapsed repeat gets a tick per pass
export function stripMarks(graph: Graph, rows: WalkRow[], node: GraphNode) {
  const visits = graph.pathVisits?.get(node.name) ?? []
  const marks: StripMark[] = []
  for (const row of rows) {
    const axis = row.axis
    if (!axis) {
      continue
    }
    const path = pathOrigin(row.name).name
    for (const v of visits) {
      if (v.path !== path) {
        continue
      }
      const { start, end } = alongRow(axis, v.start, v.start + node.length)
      if (end > 0 && start < row.bp) {
        marks.push({ row: row.name, start, bp: end - start })
      }
    }
  }
  return marks
}

interface Spans {
  ids: string[]
  starts: number[]
  ends: number[]
}

const spanCache = new WeakMap<Graph, Map<string, Spans | undefined>>()

// A walk's node steps at their contig positions, in contig order; undefined
// where a piece states no start
function spansOf(graph: Graph, name: string) {
  let byName = spanCache.get(graph)
  if (!byName) {
    byName = new Map()
    spanCache.set(graph, byName)
  }
  if (byName.has(name)) {
    return byName.get(name)
  }
  const lengthOf = new Map(graph.nodes.map(n => [n.id, n.length]))
  const pieces = (graph.paths ?? []).filter(p => p.name === name)
  let spans: Spans | undefined
  if (pieces.every(p => p.start !== undefined)) {
    spans = { ids: [], starts: [], ends: [] }
    for (const piece of [...pieces].sort((a, b) => a.start! - b.start!)) {
      let pos = piece.start!
      for (const id of piece.nodeIds) {
        const len = lengthOf.get(id) ?? 0
        spans.ids.push(id)
        spans.starts.push(pos)
        spans.ends.push(pos + len)
        pos += len
      }
    }
  }
  byName.set(name, spans)
  return spans
}

// The node under a point on a row's bar, `offset` bp from its left end: of the
// nodes within half a pixel either side, the longest, so a pointer at 100 bp a
// pixel still lands on something that draws
export function segmentAt(
  graph: Graph,
  row: WalkRow,
  offset: number,
  pxPerBp: number,
) {
  const axis = row.axis
  const spans = axis && spansOf(graph, row.name)
  if (!axis || !spans || offset < 0 || offset > row.bp) {
    return undefined
  }
  const at = axis.reversed ? axis.start - offset : axis.start + offset
  const tol = 0.5 / pxPerBp
  const bar = axis.reversed
    ? { start: axis.start - row.bp, end: axis.start }
    : { start: axis.start, end: axis.start + row.bp }
  const from = Math.max(at - tol, bar.start)
  const to = Math.min(at + tol, bar.end)
  let lo = 0
  let hi = spans.starts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spans.ends[mid]! <= from) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  let best: string | undefined
  let bestLen = -1
  let bestHolds = false
  for (let i = lo; i < spans.starts.length && spans.starts[i]! < to; i++) {
    const len = spans.ends[i]! - spans.starts[i]!
    const holds = spans.starts[i]! <= at && at < spans.ends[i]!
    if (len > bestLen || (len === bestLen && holds && !bestHolds)) {
      bestLen = len
      best = spans.ids[i]
      bestHolds = holds
    }
  }
  return best
}

export interface StripFrame extends WalkRowsFrame {
  rowPx: number
  barPx: number
  readouts: boolean
  // whether rows are tall enough to carry their labels, and to box genes
  labelled: boolean
  boxesGenes: boolean
}

// The strip's frame: every row, the reference's first, at the pitch that fits
// `maxHeight`, from the walk-rows layout's own down to MIN_ROW_PX, and x fitted
// so the longest bar and its readout fill the width past the label column,
// which by default fits the longest label
export function walkStripFrame(
  bars: WalkRows,
  o: { width: number; maxHeight?: number; labelPx?: number },
): StripFrame {
  const maxHeight = o.maxHeight ?? WALK_STRIP_CEILING_PX
  const labelPx =
    o.labelPx ??
    Math.max(...[bars.reference, ...bars.rows].map(r => r.label.length)) *
      LABEL_CHAR_PX +
      16
  const count = bars.rows.length + 1
  const rowPx = Math.max(
    MIN_ROW_PX,
    Math.min(ROW_HEIGHT_PX, Math.floor((maxHeight - 2 * PAD_PX) / count)),
  )
  const labelled = rowPx >= LABELLED_ROW_PX
  const readouts = rowPx >= 14
  const barPx = Math.max(2, Math.round(rowPx * 0.6))
  const longest = Math.max(bars.reference.bp, ...bars.rows.map(r => r.bp), 1)
  const left = labelled ? labelPx : PAD_PX
  const usable = Math.max(1, o.width - left - PAD_PX)
  const scaleX = usable / (longest * (readouts ? READOUT_ROOM : 1))
  return {
    scaleX,
    scaleY: 1,
    translateX: left - bars.origin * scaleX,
    translateY: PAD_PX + rowPx / 2,
    width: o.width,
    height: count * rowPx + 2 * PAD_PX,
    rowPx,
    barPx,
    readouts,
    labelled,
    boxesGenes: boxesGenes(rowPx, barPx),
  }
}

// The row under a pane point of the strip, as its index among the reference
// row and the rows below it, and its bar offset, where the point is on its bar
export function stripRowAt(
  bars: WalkRows,
  frame: StripFrame,
  x: number,
  y: number,
) {
  const i = Math.round((y - frame.translateY) / frame.rowPx)
  const row = [bars.reference, ...bars.rows][i]
  const offset = (x - frame.translateX) / frame.scaleX - bars.origin
  return row && i >= 0 && offset >= 0 && offset <= row.bp
    ? { index: i, row, offset }
    : undefined
}

// A node's visits as ticks above and below each bar, leaving its colour seen
export function walkMarksTree(
  bars: WalkRows,
  frame: StripFrame,
  marks: StripMark[],
) {
  const index = new Map(
    [bars.reference, ...bars.rows].map((row, i) => [row.name, i]),
  )
  const X = (offset: number) =>
    (bars.origin + offset) * frame.scaleX + frame.translateX
  return el(
    'g',
    { 'data-testid': 'graph-walk-marks' },
    ...marks.flatMap(m => {
      const i = index.get(m.row)
      if (i === undefined) {
        return []
      }
      const y = i * frame.rowPx + frame.translateY
      const x = X(m.start)
      const w = Math.max(2, m.bp * frame.scaleX)
      const tick = (top: number) =>
        el('rect', { x, y: top, width: w, height: TICK_PX, fill: MARK_INK })
      return [
        tick(y - frame.barPx / 2 - TICK_PX - 1),
        tick(y + frame.barPx / 2 + 1),
      ]
    }),
  )
}

// Each row's name in the label column, where rows are tall enough to carry
// one; `bold` names the walks lifted into the drawing
export function walkStripLabelsTree(
  bars: WalkRows,
  frame: StripFrame,
  bold: ReadonlySet<string> = new Set(),
) {
  return el(
    'g',
    { 'font-family': 'sans-serif', 'font-size': LABEL_FONT_PX, fill: '#333' },
    ...(frame.labelled ? [bars.reference, ...bars.rows] : []).map((row, i) =>
      el(
        'text',
        {
          x: 6,
          y: i * frame.rowPx + frame.translateY + 4,
          'font-weight': bold.has(row.name) ? 600 : undefined,
        },
        row.label,
      ),
    ),
  )
}

// What the key says of the strip's genes: rows too close to box them leave
// them out
export function stripGeneGaps(frame: StripFrame, gaps: GeneGaps | undefined) {
  return gaps && !frame.boxesGenes ? { ...gaps, crowded: true } : gaps
}
