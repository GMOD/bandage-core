import { pathOrigin } from '../pathAnchoring'
import { abgrHex } from '../renderer/colorBits'
import { encodingStops, mixHex } from '../walkEncoding'

import type { LiftedWalk } from '../walkHighlight'
import type { WalkAxis } from './walkRows'

// A walk row in the colours its lifted walk takes in the drawing, so a row
// reads as the thread above it: one flat colour, or a progress ramp's colours
// from where the walk's stretch of its contig starts to where it ends. A
// row's bp then take the colour of the contig position they cover, which past
// a flank the bar spans starts the row partway along the ramp. A row with no
// contig position on that stretch shades by its share of the bar. A walk
// lifted under the reference-position ramp keeps the rows' own colouring, and
// so does every row no lifted walk names.

export interface RowInk {
  walk: string
  // hex colours: one for a flat walk, or a ramp's from start to end
  stops: string[]
  range?: { contig: string; start: number; end: number }
}

// the steps a row's gradient takes along the ramp, few enough to draw and
// fine enough that a straight blend between two reads as the ramp
const STEPS_PER_RAMP = 24

export const inksWalkRows = (walk: LiftedWalk) =>
  walk.encoding.field !== 'reference'

export function liftedRowInks(walks: readonly LiftedWalk[]): RowInk[] {
  return walks.filter(inksWalkRows).map(walk => ({
    walk: walk.name,
    stops: encodingStops(walk.encoding).map(s => abgrHex(s.abgr)),
    range: walk.range,
  }))
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

// The row's colour `offset` bp along its bar
export function rowInkAt(ink: RowInk, row: InkedRow, offset: number) {
  const { from, to } = rampEnds(ink, row)
  const share = row.bp > 0 ? offset / row.bp : 0
  return stopsAt(ink.stops, from + (to - from) * share)
}

// The row's colours as gradient stops along its whole bar, `offset` 0 at its
// start and 1 at its end: one where the walk is one colour, else one at each
// end and wherever the bar crosses a step of the ramp, so a ramp that runs
// out partway along the bar holds its end colour past there
export function rowInkStops(ink: RowInk, row: InkedRow) {
  const { from, to } = rampEnds(ink, row)
  const crossings =
    ink.stops.length === 1 || from === to
      ? []
      : Array.from(
          { length: STEPS_PER_RAMP + 1 },
          (_, k) => (k / STEPS_PER_RAMP - from) / (to - from),
        ).filter(offset => offset > 0 && offset < 1)
  const offsets =
    ink.stops.length === 1 ? [0] : [0, ...crossings.sort((a, b) => a - b), 1]
  return offsets.map(offset => ({
    offset,
    color: stopsAt(ink.stops, from + (to - from) * offset),
  }))
}
