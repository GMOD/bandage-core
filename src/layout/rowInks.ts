import { pathOrigin } from '../pathAnchoring'
import { abgrHex } from '../renderer/colorBits'
import { encodingStops, mixHex } from '../walkEncoding'
import { passInk } from '../walkPasses'
import { alongRow, contigAlong, drawnAlong } from './walkRows'

import type { LiftedWalk } from '../walkHighlight'
import type { WalkAxis } from './walkRows'

// A walk row in the colours its lifted walk takes in the drawing, so a row
// reads as the thread above it: one flat colour, or a progress ramp's colours
// from where the walk's stretch of its contig starts to where it ends. A
// row's bp then take the colour of the contig position they cover, which past
// a flank the bar spans starts the row partway along the ramp. A row with no
// contig position on that stretch shades by its share of the bar. A walk
// lifted under the reference-position ramp keeps the rows' own colouring, and
// so does every row no lifted walk names. A walk lifted by pass paints its
// row in each pass's colour on the nodes it steps again, as its threads are.

export interface RowInk {
  walk: string
  // hex colours: one for a flat walk, or a ramp's from start to end
  stops: string[]
  range?: { contig: string; start: number; end: number }
  // the stretches on nodes the walk steps again, in bp of contig past
  // range.start, in walk order
  passes?: { start: number; end: number; color: string }[]
}

// the steps a row's gradient takes along the ramp, few enough to draw and
// fine enough that a straight blend between two reads as the ramp
const STEPS_PER_RAMP = 24

export const inksWalkRows = (walk: LiftedWalk) =>
  walk.encoding.field !== 'reference'

export function liftedRowInks(walks: readonly LiftedWalk[]): RowInk[] {
  return walks.filter(inksWalkRows).map(walk => {
    const drawn = walk.walkPasses
    return {
      walk: walk.name,
      stops: encodingStops(walk.encoding).map(s => abgrHex(s.abgr)),
      range: walk.range,
      ...(drawn?.runs.length
        ? {
            passes: drawn.runs.map(run => ({
              start: run.start,
              end: run.end,
              color: abgrHex(passInk(drawn, run.pass)),
            })),
          }
        : {}),
    }
  })
}

// Whether a walk is a row's: by the row's own name, or by the name without
// the range a cut adds to it
export const walkNamesRow = (walk: string, row: { name: string }) =>
  walk === row.name || pathOrigin(walk).name === pathOrigin(row.name).name

// The ink a lifted walk gives a row, its own name's before another range's
export function rowInkOf(row: { name: string }, inks: readonly RowInk[]) {
  return (
    inks.find(ink => ink.walk === row.name) ??
    inks.find(ink => walkNamesRow(ink.walk, row))
  )
}

interface InkedRow {
  bp: number
  axis?: WalkAxis
}

// How far along the ramp a row's bar starts and ends
function rampEnds(ink: RowInk, row: InkedRow) {
  const { range } = ink
  const axis = row.axis
  const span = range ? range.end - range.start : 0
  return axis && range && axis.contig === range.contig && span > 0
    ? {
        from: (axis.start - range.start) / span,
        to:
          ((axis.reversed ? axis.start - row.bp : axis.start + row.bp) -
            range.start) /
          span,
      }
    : axis?.reversed
      ? { from: 1, to: 0 }
      : { from: 0, to: 1 }
}

function stopsAt(stops: readonly string[], t: number) {
  const at = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(Math.floor(at), stops.length - 2)
  return stops.length === 1
    ? stops[0]!
    : mixHex(stops[i]!, stops[i + 1]!, at - i)
}

// The row's axis from its bar's own start, and the bar's drawn length
function barAxis(row: InkedRow) {
  const axis = row.axis && { ...row.axis, offset: 0 }
  return { axis, length: axis ? drawnAlong(axis, row.bp) : row.bp }
}

// The walk's pass runs as offsets along the row's bar, placed by the contig
// position the bar starts at, and none on a bar with no position on the
// walk's contig to place them by
function placedPasses(ink: RowInk, row: InkedRow) {
  const { range } = ink
  const { axis } = barAxis(row)
  return axis && range && axis.contig === range.contig
    ? (ink.passes ?? []).map(pass => ({
        ...alongRow(axis, range.start + pass.start, range.start + pass.end),
        color: pass.color,
      }))
    : []
}

// Whether the row's bar shows every one of the walk's passes, so a pass bar
// beside it would say nothing more
export function rowShowsPasses(ink: RowInk, row: InkedRow) {
  const placed = placedPasses(ink, row)
  return (
    placed.length > 0 &&
    placed.every(pass => pass.start >= 0 && pass.end <= barAxis(row).length)
  )
}

// The pass stretches along the bar, in bar order, with stretches of one
// colour nearer than `joinBp` joined so the hairline between two neighbouring
// nodes shows no bar under them
function passStretches(ink: RowInk, row: InkedRow, joinBp: number) {
  const stretches = placedPasses(ink, row)
    .map(pass => ({
      from: Math.max(0, pass.start),
      to: Math.min(barAxis(row).length, pass.end),
      color: pass.color,
    }))
    .filter(s => s.to > s.from)
    .sort((a, b) => a.from - b.from)
  const joined: typeof stretches = []
  for (const stretch of stretches) {
    const last = joined.at(-1)
    if (last?.color === stretch.color && stretch.from - last.to < joinBp) {
      last.to = Math.max(last.to, stretch.to)
    } else {
      joined.push({ ...stretch })
    }
  }
  return joined
}

// The row's colour at an offset along its bar, for colouring many offsets of
// one row
export function rowInkAlong(ink: RowInk, row: InkedRow, joinBp = row.bp / 600) {
  const stretches = passStretches(ink, row, joinBp)
  const { from, to } = rampEnds(ink, row)
  const start = row.axis?.offset ?? 0
  const { axis } = barAxis(row)
  return (at: number) => {
    const offset = at - start
    const along = axis ? contigAlong(axis, offset) : offset
    return (
      stretches.find(s => offset >= s.from && offset < s.to)?.color ??
      stopsAt(ink.stops, from + (to - from) * (row.bp > 0 ? along / row.bp : 0))
    )
  }
}

// The row's colour `offset` bp along its bar
export const rowInkAt = (ink: RowInk, row: InkedRow, offset: number) =>
  rowInkAlong(ink, row)(offset)

// The row's colours as gradient stops along its whole bar, `offset` 0 at its
// start and 1 at its end: one where the walk is one colour, else one at each
// end and wherever the bar crosses a step of the ramp, so a ramp that runs
// out partway along the bar holds its end colour past there
export function rowInkStops(ink: RowInk, row: InkedRow, joinBp = row.bp / 600) {
  const stretches = passStretches(ink, row, joinBp)
  return stretches.length
    ? passStops(ink.stops[0]!, stretches, barAxis(row).length)
    : rampStops(ink, row)
}

// Hard stops round each pass stretch over the walk's own colour, two stops at
// one offset making the edge sharp
function passStops(
  own: string,
  stretches: { from: number; to: number; color: string }[],
  bp: number,
) {
  return [
    { offset: 0, color: own },
    ...stretches.flatMap(({ from, to, color }) => [
      { offset: from / bp, color: own },
      { offset: from / bp, color },
      { offset: to / bp, color },
      { offset: to / bp, color: own },
    ]),
    { offset: 1, color: own },
  ]
}

function rampStops(ink: RowInk, row: InkedRow) {
  const { from, to } = rampEnds(ink, row)
  const crossings =
    ink.stops.length === 1 || from === to
      ? []
      : Array.from(
          { length: STEPS_PER_RAMP + 1 },
          (_, k) => (k / STEPS_PER_RAMP - from) / (to - from),
        ).filter(offset => offset > 0 && offset < 1)
  const { axis, length } = barAxis(row)
  const edges = (axis?.breaks ?? []).flatMap(b => [
    b.at / row.bp,
    (b.at + b.bp) / row.bp,
  ])
  const offsets =
    ink.stops.length === 1
      ? [0]
      : [0, ...[...crossings, ...edges].sort((a, b) => a - b), 1]
  return offsets.map(offset => ({
    offset:
      axis && length > 0 ? drawnAlong(axis, offset * row.bp) / length : offset,
    color: stopsAt(ink.stops, from + (to - from) * offset),
  }))
}
