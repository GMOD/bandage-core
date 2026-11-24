import { el, elOf } from '../el'
import { nameable } from '../genes/geneNames'
import {
  FROM_ELSEWHERE_TEXT,
  GAP_CAUSE_TEXT,
  NOT_LOADED_TEXT,
  PLACEMENT_CHOICE_TEXT,
  departureOwnText,
  departureSpan,
  departureText,
  offPathText,
  ownAmount,
  ownGapText,
  ownIsExact,
  placementChoice,
  bpText,
} from '../gfa/departures'
import { LABEL_CHAR_PX } from '../overlayLabels'
import { panSNContig } from '../pansn'
import {
  RAMP_GRADIENT_CSS,
  RAMP_GRADIENT_STOPS,
  rampHueCss,
  rampStops,
} from '../referenceRampCss'
import {
  NOT_LOADED_CSS,
  NOT_LOADED_FILL_CSS,
  NOT_LOADED_RIM_PX,
  REFERENCE_RAMP_ALT_CSS,
} from '../renderer/GeometryBuilder'
import { rowInkOf, rowInkStops } from './rowInks'
import { ROW_HEIGHT_PX } from './rowSpacing'
import { rowsNeedingRoutes } from './walkRowLinks'
import { alongRow } from './walkRows'

import type { El, ElAttrs } from '../el'
import type { GeneModel } from '../genes/genePins'
import type { Departure, GapCause } from '../gfa/departures'
import type { RowInk } from './rowInks'
import type {
  WalkAxis,
  WalkPass,
  WalkRow,
  WalkRows,
  WalkRun,
  WalkStop,
} from './walkRows'

// What walk rows draw, shared by the hosts: walkRowsTree is the drawing as an
// element tree, which the plugin renders as React elements, BandageJS as DOM
// nodes and the figure export as markup, so the bars, readouts, genes and key
// agree everywhere.

export const ON_REFERENCE = '#2f8fd6'
export const OFF_REFERENCE = '#8e3fbf'
export const OUTSIDE_CUT = '#bdbdbd'
export const MISSING_INK = '#8a8a8a'
export const OWN_GAP = '#e2e2e2'
export const GENE_INK = '#1c1c22'
export const BAR_PX = 12
export const GAP_PX = 4
export const MISSING_PX = 1
// the strip over a row in its lifted walk's colours where it runs on the
// reference's path, which its colours no longer say
export const ON_PATH_STRIP_INK = '#8c8c8c'
export const ON_PATH_STRIP_PX = 2
const ON_PATH_STRIP_GAP_PX = 1
// rows thinner than this go unlabelled, their names and readouts on hover
export const LABELLED_ROW_PX = 12
// a unit separator over a thinner bar would cut it into dashes
const MIN_TILED_BAR_PX = 6
// a unit separator is dropped when a unit is under this many px
const MIN_TILE_PX = 3

function signedLength(delta: number) {
  return `${delta > 0 ? '+' : '−'}${bpText(Math.abs(delta))}`
}

function units(bp: number, unit: number | undefined) {
  return unit ? ` ≈ ${Math.round(bp / unit)} units` : ''
}

// a repeat genotype's allele length for a walk, as the plugin's repeat
// catalogue pairs one with a row
export interface ReadoutCall {
  bp: number
  spanningReads?: number
  // whether the walk's length and the called allele agree, where both are
  // measurements
  agrees?: boolean
}

const near = (refName: string | undefined, pos: number) =>
  `${refName === undefined ? '' : `${panSNContig(refName)}:`}${pos < 1e6 ? `${Math.round(pos / 1000)} kb` : `${(pos / 1e6).toFixed(1)} Mb`}`

// `away from the window`, or from the repeat a repeat view is cut to
const awayText = (region: string) =>
  GAP_CAUSE_TEXT.away.replace('window', region)

// Where a walk goes past an end of its bar that is not its contig's end; no
// place is given for where it comes from, which no truth cut has confirmed
const endText = (stop: WalkStop, refName: string | undefined, region: string) =>
  stop.turnsBack
    ? `turns back out of the ${region}`
    : stop.start
      ? `comes from ${awayText(region)}`
      : `goes on ${stop.goesOn ? `near ${near(refName, stop.goesOn.near)}` : awayText(region)}`

/**
 * The text drawn beside a row's bar, on one line: the bp the bar shows, `≥`
 * where its contig runs on, with its change against the reference where it
 * crosses the window, and `//` and the bp its breaks stand for.
 * walkRowReadout's text is the rest, on hover.
 */
export function walkRowLine(
  row: Parameters<typeof walkRowReadout>[0],
  reference: Parameters<typeof walkRowReadout>[1],
) {
  const hidden = (row.runs ?? []).reduce(
    (sum, run) => sum + (run.heldBp ?? 0),
    0,
  )
  const stops = [row.stops?.left, row.stops?.right].filter(
    stop => stop !== undefined,
  )
  const exact =
    row.complete ||
    (stops.length === 2 &&
      stops.every(stop => stop.contigEnds && (stop.contigStart ?? 0) === 0))
  const shown =
    hidden > 0 || row.replacedBp !== undefined
      ? row.bp - hidden
      : (row.windowBp ?? row.bp)
  const of = reference ? (reference.windowBp ?? reference.bp) : shown
  const delta =
    row.complete && hidden === 0 && row.replacedBp === undefined
      ? shown - of
      : 0
  const parts = [
    `${exact ? '' : '≥ '}${bpText(shown)}${delta === 0 ? '' : ` (${signedLength(delta)})`}`,
    ...(hidden > 0 ? [`// ${bpText(hidden)}`] : []),
  ]
  return !reference
    ? bpText(row.windowBp ?? row.bp)
    : row.stepless || row.bp === 0
      ? ''
      : parts.join(' · ')
}

// Parts of a row's bp: `drawn` ones first, then what the cut left out, by the
// cause its gaps state, or not drawn where the host passes no runs
function partsText(
  drawn: string[],
  gapBp: number,
  runs: WalkRun[] | undefined,
  ownGap: string,
  region: string,
) {
  const gaps = (runs ?? []).filter(r => r.gap)
  const stated = [
    ...drawn,
    ...(gapBp <= 0
      ? []
      : gaps.length > 0
        ? causesParts(gaps, ownGap, region)
        : [`${bpText(gapBp)} ${GAP_CAUSE_TEXT.unread}`]),
  ]
  return stated.length > 0 ? `, of which ${stated.join(', ')}` : ''
}

function causesParts(gaps: WalkRun[], ownGap: string, region: string) {
  const bpOf = (cause: GapCause | undefined) =>
    gaps.filter(g => g.cause === cause).reduce((sum, g) => sum + heldBp(g), 0)
  const missingOf = (cause: GapCause) =>
    gaps
      .filter(g => g.cause === cause)
      .reduce((sum, g) => sum + (g.missingBp ?? 0), 0)
  const mixedMissing = missingOf('mixed')
  const awayMissing = missingOf('away')
  const missing = bpOf('missing') + mixedMissing + awayMissing
  const lowerBound = gaps.some(g => g.atLeast)
  const unsure = gaps
    .filter(g => g.cause === 'away' && g.atLeast)
    .reduce((sum, g) => sum + heldBp(g) - (g.missingBp ?? 0), 0)
  const parts: [number, string, string?][] = [
    [missing, GAP_CAUSE_TEXT.missing, lowerBound ? 'at least ' : ''],
    [bpOf('away') - awayMissing - unsure, awayText(region)],
    [unsure, GAP_CAUSE_TEXT.mixed],
    [bpOf('own') + bpOf('mixed') - mixedMissing, ownGap],
    [bpOf('unread') + bpOf(undefined), GAP_CAUSE_TEXT.unread],
  ]
  return parts
    .filter(([bp]) => bp > 0)
    .map(([bp, text, prefix = '']) => `${prefix}${bpText(bp)} ${text}`)
}

const contigBeforeText = (contigStart: number) =>
  `${bpText(contigStart)} before it ${GAP_CAUSE_TEXT.mixed}`

const otherContigsText = (counted: WalkRow['otherContigs']) =>
  counted
    ? ` · ${counted.departures} departure${counted.departures > 1 ? 's' : ''} on ${counted.contigs > 1 ? `${counted.contigs} other contigs` : 'another contig'}`
    : ''

// A stepless row's departures in words: the widest stretch's facts, how many
// more, and a placement choice among the others
function steplessText(
  departures: NonNullable<WalkRow['departures']>,
  reference: string | undefined,
  revisited: number | undefined,
) {
  const widest = [...departures].sort((a, b) => {
    const x = departureSpan(a)
    const y = departureSpan(b)
    return y.end - y.start - (x.end - x.start)
  })[0]
  const more = departures.length - 1
  return widest
    ? [
        departureText(widest, reference, revisited),
        ...(more > 0 ? [`${more} more departure${more > 1 ? 's' : ''}`] : []),
        ...(!placementChoice(widest) && departures.some(placementChoice)
          ? [PLACEMENT_CHOICE_TEXT]
          : []),
      ].join(' · ')
    : ''
}

type Crossing = Pick<
  WalkPass,
  'bp' | 'onReferenceBp' | 'fromElsewhereBp' | 'gapBp'
>

// The text at the end of a bar: its length, what it carries against the
// reference row, the reference from elsewhere it carries, and what the cut
// left out, by cause where its gaps state one. A walk reaching one flank
// states a lower bound, none where it has no bp in the window, and why it
// stops, or where on the reference and by how much of its own it goes on by
// a departure, and a stepless row its departures' facts. A row with a
// departure the writer placed says so.
export function walkRowReadout(
  row: Pick<
    WalkRow,
    | 'bp'
    | 'gapBp'
    | 'complete'
    | 'windowBp'
    | 'replacedBp'
    | 'fromElsewhereBp'
    | 'onReferenceBp'
    | 'axis'
    | 'passesOutside'
    | 'passes'
    | 'reversedBp'
    | 'stops'
    | 'departures'
    | 'placementChoice'
    | 'stepless'
    | 'outsideRow'
    | 'otherContigs'
  > & {
    runs?: WalkRun[]
  },
  reference: (Pick<WalkRow, 'bp'> & Partial<WalkRow>) | undefined,
  unit?: number,
  call?: ReadoutCall,
) {
  const { bp, gapBp, complete } = row
  const others = otherContigsText(row.otherContigs)
  if (!reference) {
    const length = row.windowBp ?? bp
    return `${bpText(length)}${units(length, unit)}${others}`
  }
  const { revisited } = reference
  const name = reference.sample ?? 'the reference'
  const outside = row.outsideRow
    ? ` · ${row.outsideRow.count} departure${row.outsideRow.count > 1 ? 's' : ''} outside the row${row.outsideRow.stepsBp > 0 ? `, ${ownAmount(bpText(row.outsideRow.stepsBp), name, revisited)} in the graph` : ''}`
    : ''
  const beyond = `${outside}${others}`
  if (row.stepless) {
    return `${steplessText(row.departures ?? [], reference.sample, revisited)}${beyond}`
  }
  const ownTextAfter = (d: Departure) => {
    const text = departureOwnText(d, name, revisited)
    return text === '' ? '' : ` · ${text}`
  }
  const elsewhereText = (stretchBp: number) =>
    `${bpText(stretchBp)} ${name} ${FROM_ELSEWHERE_TEXT}`
  const elsewhere = row.fromElsewhereBp ?? 0
  const reversedBp = row.reversedBp ?? 0
  const region = unit ? 'repeat' : 'window'
  const parts = partsText(
    [
      ...(reversedBp > 0 ? [`${bpText(reversedBp)} reversed`] : []),
      ...(row.replacedBp === undefined && elsewhere > 0
        ? [elsewhereText(elsewhere)]
        : []),
    ],
    gapBp,
    row.runs,
    ownGapText(name, revisited),
    region,
  )
  const after = `${row.placementChoice ? ` · ${PLACEMENT_CHOICE_TEXT}` : ''}${beyond}`
  // a bar reaching over contig outside the window holds no length over it
  const ofContig = (length: number) => `${bpText(length)} of its contig`
  const called = call
    ? ` · called ${bpText(call.bp)}${call.spanningReads === 0 ? ' · no spanning read' : ''}`
    : ''
  const of = reference.windowBp ?? reference.bp
  // A pass across a window edge by what it holds: its own bp off the
  // reference, its bp on the reference, the reference's from elsewhere, and
  // for a pass holding nothing else, its bp in gaps, which the row's parts
  // state otherwise
  const replacing = (pass: Crossing, replacedBp: number) => {
    const on = pass.onReferenceBp ?? 0
    const from = pass.fromElsewhereBp ?? 0
    const gaps = pass.gapBp ?? 0
    const own = pass.bp - on - from - gaps
    const alone = own <= 0 && on === 0 && from === 0
    const inPlace =
      own > 0 || from > 0 || gaps > 0
        ? ` in place of ${name}'s ${bpText(replacedBp)}`
        : ''
    const held = [
      ...(own > 0 || pass.bp === 0
        ? [
            ownIsExact(revisited)
              ? `its own ${bpText(own)}`
              : `${bpText(own)} ${offPathText(name)}`,
          ]
        : []),
      ...(on > 0 ? [`${bpText(on)} on ${name}`] : []),
      ...(from > 0 ? [elsewhereText(from)] : []),
      ...(gaps > 0 && alone
        ? [`${bpText(gaps)} ${GAP_CAUSE_TEXT.unread}`]
        : []),
    ]
    return `${held.join(' and ')}${inPlace}`
  }
  const lengthOf = (
    pass: Crossing & Pick<WalkPass, 'replacedBp'>,
    length: number,
  ) => {
    const delta = length - of
    return pass.replacedBp !== undefined
      ? replacing(pass, pass.replacedBp)
      : `${bpText(length)}${units(length, unit)}${delta === 0 ? '' : ` (${signedLength(delta)})`}`
  }
  // each pass over the window, where the bar holds several
  const passes = (row.passes ?? [])
    .map(
      (pass, k) =>
        ` · ${k === 0 ? 'first pass' : 'passes again'}: ${lengthOf(pass, pass.windowBp)}`,
    )
    .join('')
  if (complete) {
    const length =
      row.windowBp !== undefined && reference.windowBp !== undefined
        ? row.windowBp
        : bp
    return `${row.passesOutside ? ofContig(bp) : lengthOf({ ...row, gapBp }, length)}${parts}${passes}${after}${called}`
  }
  const stops = [row.stops?.left, row.stops?.right].filter(
    stop => stop !== undefined,
  )
  const sequence = reference.name
    ? `${name} ${panSNContig(reference.name)}`
    : name
  const where = (stop: WalkStop) =>
    stop.shortBp > 0
      ? `${bpText(stop.shortBp)} ${stop.past ? 'past' : 'before'} the ${region}`
      : bp === 0
        ? `at the ${region}`
        : `inside the ${region}`
  const short = stops.find(stop => stop.contigEnds)
  const why = (stop: WalkStop) =>
    stop.contigEnds
      ? stop.contigStart === undefined
        ? bp === 0
          ? `last step on ${sequence} ${where(stop)}`
          : `no more of the contig on ${sequence}`
        : stop.contigStart === 0
          ? `contig starts ${where(stop)}`
          : `${bp === 0 || stop.shortBp > 0 ? `first step on ${sequence} ${where(stop)}, ` : ''}${contigBeforeText(stop.contigStart)}`
      : `${endText(stop, reference.name, region)}${stop.goesOn && !stop.goesOn.drawn && !stop.start ? ownTextAfter(stop.goesOn.departure) : ''}`
  const whys = (short && bp === 0 ? [short] : stops).map(why).join(' · ')
  const least = row.windowBp ?? bp
  const exact =
    stops.length === 2 &&
    stops.every(stop => stop.contigEnds && (stop.contigStart ?? 0) === 0)
  const length = row.passesOutside
    ? ofContig(bp)
    : `${exact ? '' : '≥ '}${bpText(least)}${units(least, unit)}`
  const stated =
    bp === 0
      ? `${whys}${parts}${passes}`
      : `${length}${parts}${passes}${whys ? ` · ${whys}` : ''}`
  return `${stated}${after}${called}`
}

const READOUT_GAP_PX = 6

// 11 px sans-serif advances in 2048ths of an em, from DejaVu Sans, which
// renders a figure's text where no Helvetica or Arial is installed and is the
// widest of the three, so a readout measured by them is never wider than
// drawn
const GLYPH_UNITS = new Map(
  (
    [
      [569, 'ijl'],
      [604, 'IJ'],
      [651, ' .,·'],
      [690, ':'],
      [721, 'f'],
      [739, '-'],
      [799, '()'],
      [803, 't'],
      [842, 'r'],
      [1067, 's'],
      [1075, 'z'],
      [1126, 'c'],
      [1141, 'L'],
      [1178, 'F'],
      [1186, 'k'],
      [1212, 'vxy'],
      [1235, 'P'],
      [1251, 'TY'],
      [1253, 'o'],
      [1255, 'a'],
      [1260, 'e'],
      [1294, 'E'],
      [1298, 'hnu'],
      [1300, 'bdgpqS'],
      [1303, '0123456789'],
      [1343, 'K'],
      [1401, 'AV'],
      [1403, 'XZ'],
      [1405, 'B'],
      [1423, 'R'],
      [1430, 'C'],
      [1499, 'U'],
      [1532, 'N'],
      [1540, 'H'],
      [1577, 'D'],
      [1587, 'G'],
      [1612, 'OQ'],
      [1675, 'w'],
      [1716, '+−≥#'],
      [1767, 'M'],
      [1995, 'm'],
      [2025, 'W'],
      [2048, '…'],
    ] as const
  ).flatMap(([advance, glyphs]) =>
    Array.from(glyphs, glyph => [glyph, advance] as const),
  ),
)
const READOUT_FONT_PX = 11

// A readout's drawn width in px at its font, a little over, for a host with
// no canvas to measure it
export function readoutTextPx(text: string) {
  let em = 0
  for (const c of text) {
    em += GLYPH_UNITS.get(c) ?? 2048
  }
  return (em * READOUT_FONT_PX * 1.02) / 2048
}

const ELLIPSIS = '…'

// A readout cut to `roomPx` by whole parts from its end, closed with an
// ellipsis; nothing where not even an ellipsis fits
function fitReadout(
  text: string,
  roomPx: number,
  measure: (text: string) => number,
) {
  const parts = text.split(' · ')
  const cuts = parts
    .map((_, k) => parts.length - 1 - k)
    .filter(k => k > 0)
    .map(k => `${parts.slice(0, k).join(' · ')} · ${ELLIPSIS}`)
  return (
    [text, ...cuts, ELLIPSIS].find(candidate => measure(candidate) <= roomPx) ??
    ''
  )
}

export const readoutRoomPx = (
  text: string,
  measure: (text: string) => number = readoutTextPx,
) => READOUT_GAP_PX + measure(text)

// Row `i`'s readout (0 the reference): the line drawn, its full text, and
// the `· not compared` that ends both while `comparing` leaves the row out
export function walkRowReadoutParts(
  bars: WalkRowsWithCalls,
  i: number,
  comparing = false,
) {
  const row = i === 0 ? bars.reference : bars.rows[i - 1]!
  const reference = i === 0 ? undefined : bars.reference
  const base = walkRowLine(row, reference)
  const full = walkRowReadout(row, reference, bars.unit, row.call)
  const suffix =
    comparing && i > 0 && rowsNeedingRoutes([row]) > 0
      ? ` · ${NOT_COMPARED_TEXT}`
      : ''
  return { row, base, full, suffix }
}

const rowNameEnd = (label: string) =>
  3 * READOUT_GAP_PX + label.length * LABEL_CHAR_PX

export const NOT_COMPARED_TEXT = 'not compared'

/**
 * Row `i`'s readout (0 the reference) as a pane of `frame` draws it: `text`,
 * its line, `full`, the text its hover gives, `shown`, the line as drawn,
 * `cut` whether that leaves any of `text` out, and `x`, where it starts:
 * right of the bar's end and of the row's name, never over a bar. The line
 * ends inside `frame.width`, measured by `frame.measure` or else
 * readoutTextPx, cut by whole parts where it would not. While `comparing`, a
 * row the comparison leaves out ends `· not compared`, which only a readout
 * cut to nothing drops.
 */
export function walkRowReadoutAt(
  bars: WalkRowsWithCalls,
  i: number,
  frame: Pick<
    WalkRowsFrame,
    'scaleX' | 'translateX' | 'width' | 'measure' | 'rowPx'
  >,
  o: { comparing?: boolean } = {},
) {
  const { row, base, full, suffix } = walkRowReadoutParts(bars, i, o.comparing)
  const text = `${base}${suffix}`
  const measure = frame.measure ?? readoutTextPx
  const endX = (bars.origin + barEnd(row)) * frame.scaleX + frame.translateX
  const x = Math.max(endX + READOUT_GAP_PX, rowNameEnd(row.label))
  const kept = fitReadout(base, frame.width - x - measure(suffix), measure)
  const shown = kept === '' ? '' : `${kept}${suffix}`
  return { x, text, full: `${full}${suffix}`, shown, cut: shown !== text }
}

// A row's bp walked, those away from the window left out
export const walkedBp = (row: {
  bp: number
  runs?: readonly Pick<WalkRun, 'heldBp'>[]
}) => (row.runs ?? []).reduce((bp, run) => bp - (run.heldBp ?? 0), row.bp)

// Where a row's bar draws the base `walked` bp of its walk past the bar's
// start, counting no bp away from the window, and past the bar's end where
// the walk is shorter
export function walkedAlong(runs: readonly WalkRun[], walked: number) {
  let left = walked
  let at = runs[0]?.start ?? 0
  for (const run of runs) {
    if (left > 0) {
      const step = run.heldBp === undefined ? Math.min(left, run.bp) : 0
      at = run.start + (run.heldBp === undefined ? step : run.bp)
      left -= step
    }
  }
  return at + left
}

// Where a row's bar ends: past its runs, since a stepless row has no bp
export function barEnd(row: Pick<WalkRow, 'bp' | 'runs'>) {
  return row.runs.length > 0
    ? row.runs.reduce((end, run) => Math.max(end, run.start + run.bp), 0)
    : row.bp
}

// a gap's bp, those left out of its drawing at a break included
const heldBp = (run: WalkRun) => run.heldBp ?? run.bp

// Bar offsets one unit apart, so copies are countable, none where a unit is
// under a few px
export function unitTicks(bp: number, unit: number, pxPerBp: number) {
  if (unit * pxPerBp < MIN_TILE_PX) {
    return []
  }
  const ticks: number[] = []
  for (let k = unit; k < bp; k += unit) {
    ticks.push(k)
  }
  return ticks
}

// How a gap draws, and the key's words for it: contig away from the window
// as a band, bases the graph lacks as a hairline the walk jumps along, and its
// own sequence the cut did not read as a pale band. The stretch between a
// stepless row's departure's ends is a hairline too.
export function gapStyle(
  cause: GapCause | undefined,
  ownGap: string = GAP_CAUSE_TEXT.own,
  region = 'window',
) {
  return cause === 'missing'
    ? {
        fill: MISSING_INK,
        px: MISSING_PX,
        label: GAP_CAUSE_TEXT.missing,
      }
    : cause === 'departure'
      ? { fill: MISSING_INK, px: MISSING_PX, label: GAP_CAUSE_TEXT.departure }
      : cause === 'own'
        ? {
            fill: OWN_GAP,
            px: GAP_PX,
            label: ownGap,
          }
        : cause === 'mixed'
          ? {
              fill: OWN_GAP,
              px: MISSING_PX,
              label: GAP_CAUSE_TEXT.mixed,
            }
          : cause === 'away'
            ? {
                fill: OUTSIDE_CUT,
                px: GAP_PX,
                label: awayText(region),
              }
            : cause === 'unread'
              ? {
                  fill: OUTSIDE_CUT,
                  px: MISSING_PX,
                  label: GAP_CAUSE_TEXT.unread,
                }
              : {
                  fill: OUTSIDE_CUT,
                  px: GAP_PX,
                  label: GAP_CAUSE_TEXT.unread,
                }
}

// A run's paint: a flat colour, or under the reference-position ramp the hues
// a gradient along a shared run takes, since it covers its reference
// contiguously. Where `marked`, as under a node layout that draws a
// placeholder hollow, a run not loaded is hollow too: a fill with a rim.
export function runPaint(
  run: WalkRun,
  ramp: { start: number; end: number } | undefined,
  marked = false,
): { fill: string; rim?: string } | { stops: string[] } {
  const hollow = marked && run.unloaded === true
  const stops =
    !run.gap && !hollow && ramp && run.referenceStart !== undefined
      ? rampStops({ ...run, start: run.referenceStart }, ramp)
      : undefined
  return run.gap
    ? { fill: gapStyle(run.cause).fill }
    : hollow
      ? { fill: NOT_LOADED_FILL_CSS, rim: NOT_LOADED_CSS }
      : !ramp
        ? { fill: run.onReference ? ON_REFERENCE : OFF_REFERENCE }
        : !stops
          ? { fill: REFERENCE_RAMP_ALT_CSS }
          : stops.length === 1
            ? { fill: rampHueCss(stops[0]!) }
            : { stops: stops.map(rampHueCss) }
}

// The contig span a row's bar covers
export const rowSpan = (axis: WalkAxis, bp: number) => ({
  start: axis.start,
  end: axis.start + bp,
})

export interface RowGene {
  name: string
  start: number
  end: number
  exons: { start: number; end: number }[]
}

// The backbone's genes on a row's own contig, which a multi-contig backbone
// holds others beside
export function genesOnRow(row: WalkRow, genes: GeneModel[]) {
  const contig = row.axis?.contig
  return genes.filter(
    g => g.refName === contig || g.refName.endsWith(`#${contig}`),
  )
}

// Each row's genes as offsets along its bar, from genes the host read for that
// row's own contig, cut to the bar and out of its breaks, which hold too many
// bp to show what lies in them
export function placeRowGenes(
  rows: WalkRow[],
  byRow: Map<string, GeneModel[]>,
) {
  const placed = new Map<string, RowGene[]>()
  for (const row of rows) {
    const genes = byRow.get(row.name)
    if (!row.axis || !genes) {
      continue
    }
    const axis = row.axis
    const to = barEnd(row)
    const breaks = row.runs.filter(shortened)
    const clip = (span: { start: number; end: number }) =>
      breaks.reduce(
        (at, b) => ({
          start:
            at.start >= b.start && at.start < b.start + b.bp
              ? b.start + b.bp
              : at.start,
          end: at.end > b.start && at.end <= b.start + b.bp ? b.start : at.end,
        }),
        { start: Math.max(0, span.start), end: Math.min(to, span.end) },
      )
    placed.set(
      row.name,
      genes
        .map(g => ({
          name: g.name,
          ...clip(alongRow(axis, g.start, g.end)),
          exons: g.exons
            .map(e => clip(alongRow(axis, e.start, e.end)))
            .filter(e => e.end > e.start),
        }))
        .filter(g => g.end > g.start)
        .sort((a, b) => a.start - b.start),
    )
  }
  return placed
}

const GENE_FONT_PX = 9
const MIN_LETTERED_BAR_PX = 8

const genePad = (rowPx: number, barPx: number) =>
  Math.min(2, (rowPx - barPx) / 2 - 1)

// Whether rows at this pitch leave room to box a gene round its bar. Closer
// rows draw none, since a gene's shade on a bar that thin reads as its colour.
export function boxesGenes(rowPx: number, barPx: number) {
  return genePad(rowPx, barPx) >= 1
}

export interface GeneBox {
  name: string
  x: number
  y: number
  w: number
  h: number
  exons: { x: number; w: number }[]
  // the name centred on the box where it lands on no other name, names that
  // fit their boxes first; or, on a row that names genes above it, over the
  // box with a leader down to it where it cannot stand inside
  label?: {
    x: number
    y: number
    size: number
    leader?: { x1: number; y1: number; x2: number; y2: number }
  }
}

// From a name set above a row down to its box's top
const GENE_LEADER_PX = 6
// below a name's baseline, and above it, at GENE_FONT_PX
const GENE_DESCENT_PX = 2
const GENE_ASCENT_PX = 7
const GENE_NAME_GAP_PX = 6
// how far a name may run past its box, or past the bar's ends, half the gap
// before a row's readout
const NAME_OVERRUN_PX = READOUT_GAP_PX / 2
// DejaVu Sans Bold's capitals over its Book face's, which readoutTextPx
// measures: A 1585/1401, M 1995/1767
const BOLD_WIDENING = 1.13

// A gene name's width at GENE_FONT_PX bold, a little over
function geneNamePx(name: string) {
  return (readoutTextPx(name) * GENE_FONT_PX * BOLD_WIDENING) / READOUT_FONT_PX
}

// Where a name too long for its box goes above it: centred over its box, or
// as near that as the names placed before it leave room for, within its own
// width, on the line over the box or the one above that; none where neither
// has room in the frame
function nameAbove(
  name: string,
  centre: number,
  top: number,
  lines: [number, number][][],
  maxX: number,
) {
  const w = geneNamePx(name)
  const wanted = centre - w / 2
  for (const [line, taken] of lines.entries()) {
    const baseline =
      top -
      GENE_LEADER_PX -
      GENE_DESCENT_PX -
      line * (GENE_ASCENT_PX + GENE_DESCENT_PX + GENE_NAME_GAP_PX)
    const free = (x0: number) =>
      x0 >= 0 &&
      x0 + w <= maxX &&
      taken.every(
        ([a, b]) =>
          x0 + w + GENE_NAME_GAP_PX <= a || x0 >= b + GENE_NAME_GAP_PX,
      )
    const x0 =
      baseline - GENE_ASCENT_PX < 0
        ? undefined
        : [
            wanted,
            ...taken.flatMap(([a, b]) => [
              a - GENE_NAME_GAP_PX - w,
              b + GENE_NAME_GAP_PX,
            ]),
          ]
            .filter(x => Math.abs(x - wanted) <= w && free(x))
            .sort((p, q) => Math.abs(p - wanted) - Math.abs(q - wanted))[0]
    if (x0 !== undefined) {
      taken.push([x0, x0 + w])
      return labelAbove(x0 + w / 2, baseline, centre, top)
    }
  }
  return undefined
}

function labelAbove(x: number, baseline: number, centre: number, top: number) {
  return {
    x,
    y: baseline,
    size: GENE_FONT_PX,
    leader: { x1: x, y1: baseline + GENE_DESCENT_PX, x2: centre, y2: top },
  }
}

// A row's genes as boxes in screen px around its bar at `y`, at the rows'
// pitch, named where the bar is tall enough to letter; none where the rows
// leave no room to box them. A name that fits its box is centred on it where
// it meets no other name, narrowest gene first. Then, on a row that does not
// name genes above it, a name wider than its box is centred on it where it
// meets no other name, crosses no other gene's box and stays about within the
// bar's `ends`, the least overflowing first, so a copy too short for its name
// is still named on a haplotype's row. With `namesAbove`, the frame's right
// edge, a name that does not fit its box is set above the row.
export function rowGeneBoxes(
  genes: RowGene[],
  X: (offset: number) => number,
  y: number,
  {
    rowPx = ROW_HEIGHT_PX,
    barPx = BAR_PX,
    namesAbove,
    ends,
  }: {
    rowPx?: number
    barPx?: number
    namesAbove?: number
    ends?: { x0: number; x1: number }
  } = {},
): GeneBox[] {
  if (!boxesGenes(rowPx, barPx)) {
    return []
  }
  const pad = genePad(rowPx, barPx)
  const top = y - barPx / 2 - pad
  const boxes = genes.map(g => {
    const x = X(g.start)
    return {
      g,
      x,
      w: Math.max(2, X(g.end) - x),
    }
  })
  const lettered = new Set(nameable(genes, g => g.name))
  const narrowestFirst = boxes
    .filter(box => lettered.has(box.g))
    .sort((a, b) => a.w - b.w)
  const overflow = (box: (typeof boxes)[number]) =>
    geneNamePx(box.g.name) - box.w - 2 * NAME_OVERRUN_PX
  const fitting = narrowestFirst.filter(box => overflow(box) <= 0)
  const overflowing = narrowestFirst
    .filter(box => overflow(box) > 0)
    .sort((a, b) => overflow(a) - overflow(b))
  const taken: [number, number][] = []
  const named = new Set(
    (barPx >= MIN_LETTERED_BAR_PX
      ? [...fitting, ...(namesAbove === undefined ? overflowing : [])]
      : []
    ).filter(box => {
      const { g, x, w } = box
      const half = geneNamePx(g.name) / 2
      const at: [number, number] = [x + w / 2 - half, x + w / 2 + half]
      const crosses = (other: { x: number; w: number }) =>
        at[0] < other.x + other.w &&
        at[1] > other.x &&
        (at[0] < other.x || at[1] > other.x + other.w)
      const fits = overflow(box) <= 0
      const onBar =
        ends === undefined ||
        (at[0] >= ends.x0 - NAME_OVERRUN_PX &&
          at[1] <= ends.x1 + NAME_OVERRUN_PX)
      const clearOfBoxes = !boxes.some(other => other !== box && crosses(other))
      if (
        !(fits || (onBar && clearOfBoxes)) ||
        taken.some(([a, b]) => at[0] < b + 2 && at[1] > a - 2)
      ) {
        return false
      }
      taken.push(at)
      return true
    }),
  )
  // the widest genes' names first, as a graph names its longest genes first
  const lines: [number, number][][] = [[], []]
  const above = new Map<(typeof boxes)[number], GeneBox['label']>()
  if (namesAbove !== undefined) {
    for (const box of [...narrowestFirst].reverse()) {
      const label = named.has(box)
        ? undefined
        : nameAbove(box.g.name, box.x + box.w / 2, top, lines, namesAbove)
      if (label) {
        above.set(box, label)
      }
    }
  }
  return boxes.map(box => ({
    name: box.g.name,
    x: box.x,
    y: top,
    w: box.w,
    h: barPx + 2 * pad,
    exons: box.g.exons.map(e => ({
      x: X(e.start),
      w: Math.max(1, X(e.end) - X(e.start)),
    })),
    label: named.has(box)
      ? { x: box.x + box.w / 2, y: y + 3, size: GENE_FONT_PX }
      : above.get(box),
  }))
}

export type KeySwatch =
  // `ramp` bars paint the reference-position ramp, which `fill` holds as CSS;
  // a hollow bar has a `rim`, and one walked against the reference chevrons
  | { kind: 'bar'; fill: string; ramp?: true; rim?: string; chevrons?: true }
  | { kind: 'gap'; fill: string; px: number }
  | { kind: 'gene' }

export interface KeyEntry {
  swatch: KeySwatch
  label: string
  // a line under the entries, saying what the key leaves out
  note?: true
}

// The rows a host could read no genes for
export interface GeneGaps {
  // rows too close to box genes in, which leaves the rest moot
  crowded?: boolean
  untracked: number
  // rows whose walk states no contig coordinates to read genes over
  unplaced?: number
  unread: number
}

const rowsText = (n: number) => `${n} row${n === 1 ? '' : 's'}`

// What the bar colours mean: whether a run is on the reference walk's path.
// Off the path is an alternative route, no statement about the sequence: at a
// duplication the graph may route a copy the reference carries through nodes
// of its own.
export function walkRowsKey(
  bars: WalkRows,
  o: {
    ramp?: { start: number; end: number }
    rampCss?: string
    genes?: GeneGaps
    // what a row's boxes are, singular: 'gene' unless the host names another
    annotation?: string
    // set while ribbons, shared blocks or the shared order are on: the most
    // walks a host fetches node-level detail for at a time, which it is
    // fetching for left-out rows up to that many
    comparing?: { fetchLimit: number }
    // runs not loaded are drawn hollow, as under a node layout
    markUnloaded?: boolean
    // the lifted walks' colours, which the rows they name take
    inks?: readonly RowInk[]
    // set where the rows sit under a ruler of the reference's bp
    ruler?: boolean
  } = {},
): KeyEntry[] {
  const noun = o.annotation ?? 'gene'
  const rows = [bars.reference, ...bars.rows]
  const reference = bars.reference.label
  const elsewhere = rows.some(row => row.runs.some(run => run.fromElsewhere))
  const ownGap = ownGapText(reference, bars.reference.revisited)
  const inks = o.inks ?? []
  const inked = rows.filter(row => rowInkOf(row, inks))
  const entries: KeyEntry[] =
    inked.length < rows.length
      ? [
          {
            swatch: o.ramp
              ? {
                  kind: 'bar',
                  fill: o.rampCss ?? RAMP_GRADIENT_CSS,
                  ramp: true,
                }
              : { kind: 'bar', fill: ON_REFERENCE },
            label: `on ${bars.reference.label}'s path`,
          },
          {
            swatch: {
              kind: 'bar',
              fill: o.ramp ? REFERENCE_RAMP_ALT_CSS : OFF_REFERENCE,
            },
            label: `off ${reference}'s path${elsewhere ? `, or ${reference} ${FROM_ELSEWHERE_TEXT}` : ''}`,
          },
        ]
      : []
  if (
    inked.some(
      row =>
        row !== bars.reference &&
        row.runs.some(run => run.onReference && !run.gap),
    )
  ) {
    entries.push({
      swatch: { kind: 'bar', fill: ON_PATH_STRIP_INK },
      label: onPathStripText(reference),
    })
  }
  if (bars.rows.some(row => row.runs.some(reversedOnPath))) {
    entries.push({
      swatch: { kind: 'bar', fill: CHEVRON_SWATCH_FILL, chevrons: true },
      label: reversedText(reference),
    })
  }
  if (o.markUnloaded && rows.some(row => row.runs.some(run => run.unloaded))) {
    entries.push({
      swatch: { kind: 'bar', fill: NOT_LOADED_FILL_CSS, rim: NOT_LOADED_CSS },
      label: NOT_LOADED_TEXT,
    })
  }
  const region = bars.unit ? 'repeat' : 'window'
  const labels = new Set<string>()
  for (const row of rows) {
    for (const run of row.runs) {
      if (run.gap) {
        labels.add(gapStyle(run.cause, ownGap, region).label)
      }
    }
  }
  for (const cause of [
    undefined,
    'missing',
    'away',
    'departure',
    'own',
    'mixed',
    'unread',
  ] as const) {
    const { fill, px, label } = gapStyle(cause, ownGap, region)
    if (labels.has(label)) {
      entries.push({ swatch: { kind: 'gap', fill, px }, label })
      labels.delete(label)
    }
  }
  const leftOut = o.comparing ? rowsNeedingRoutes(bars.rows) : 0
  if (o.comparing && leftOut > 0) {
    entries.push({
      swatch: { kind: 'gene' },
      label:
        leftOut <= o.comparing.fetchLimit
          ? `Fetching node-level detail for ${rowsText(leftOut)}`
          : `Leaves out ${rowsText(leftOut)}: node-level detail is fetched for at most ${o.comparing.fetchLimit} at a time`,
      note: true,
    })
  }
  if (o.ruler) {
    entries.push({
      swatch: { kind: 'gene' },
      label: OWN_SCALE_TEXT,
      note: true,
    })
  }
  if (o.genes?.crowded) {
    entries.push({
      swatch: { kind: 'gene' },
      label: `${noun}s left out: too many rows to box them in`,
      note: true,
    })
  } else if (o.genes) {
    entries.push({
      swatch: { kind: 'gene' },
      label: noun,
    })
    if (o.genes.untracked) {
      entries.push({
        swatch: { kind: 'gene' },
        label: `no ${noun} track for ${rowsText(o.genes.untracked)}`,
        note: true,
      })
    }
    if (o.genes.unplaced) {
      entries.push({
        swatch: { kind: 'gene' },
        label: `no contig coordinates for ${rowsText(o.genes.unplaced)}`,
        note: true,
      })
    }
    if (o.genes.unread) {
      entries.push({
        swatch: { kind: 'gene' },
        label: `${noun}s not read for the last ${rowsText(o.genes.unread)}`,
        note: true,
      })
    }
  }
  return entries
}

// an away stretch drawn shorter than the bp it holds
const shortened = (run: WalkRun) =>
  run.heldBp !== undefined && run.heldBp > run.bp

// A break across a gap shortened in its drawing at x, a white slant edged
// in the gap's ink, as wide as the bar is tall
function breakTree(x: number, y: number, barPx: number) {
  const h = barPx / 2 + 1
  const lean = Math.max(2, barPx / 3)
  const w = Math.max(3, barPx / 3)
  const edge = (dx: number) =>
    el('line', {
      x1: x + dx - lean,
      y1: y + h,
      x2: x + dx + lean,
      y2: y - h,
      stroke: GENE_INK,
      'stroke-width': 1,
    })
  return elOf('g', { 'data-testid': 'graph-walk-break' }, [
    el('polygon', {
      points: `${x - w / 2 - lean},${y + h} ${x + w / 2 - lean},${y + h} ${x + w / 2 + lean},${y - h} ${x - w / 2 + lean},${y - h}`,
      fill: 'white',
    }),
    edge(-w / 2),
    edge(w / 2),
  ])
}

export const OWN_SCALE_TEXT =
  "each row is that haplotype's own sequence, not on the ruler's scale"

// A scale bar of a round length about `px` wide at `scaleX` px a bp, its
// left end at (x, y): a line with end ticks and its length above it
export function scaleBarTree(scaleX: number, x: number, y: number, px = 100) {
  const want = px / scaleX
  const step = 10 ** Math.floor(Math.log10(want))
  const bp = [5, 2, 1].map(k => k * step).find(b => b <= want) ?? step
  const w = bp * scaleX
  const ink = '#333'
  return elOf('g', { 'data-testid': 'graph-walk-scale-bar' }, [
    el('line', { x1: x, x2: x + w, y1: y, y2: y, stroke: ink }),
    el('line', { x1: x, x2: x, y1: y - 3, y2: y + 3, stroke: ink }),
    el('line', { x1: x + w, x2: x + w, y1: y - 3, y2: y + 3, stroke: ink }),
    el(
      'text',
      {
        x: x + w / 2,
        y: y - 5,
        'text-anchor': 'middle',
        'font-family': 'sans-serif',
        'font-size': 10,
        fill: ink,
      },
      bpText(bp),
    ),
  ])
}

export const reversedText = (reference: string) =>
  `walked against ${reference}'s direction`

/**
 * The stretches of a row walked against the reference: its reversed runs on
 * the reference's path, each joined to the next it touches, so any other ink
 * between two of them ends a stretch. Runs coalesced as drawn join across
 * sites under a pixel.
 */
export function reversedStretches(runs: readonly WalkRun[]) {
  const stretches: { start: number; end: number }[] = []
  for (const run of runs.filter(reversedOnPath)) {
    const last = stretches.at(-1)
    if (last && last.end === run.start) {
      last.end = run.start + run.bp
    } else {
      stretches.push({ start: run.start, end: run.start + run.bp })
    }
  }
  return stretches
}

const reversedOnPath = (run: WalkRun) =>
  run.reversed === true && run.onReference && !run.gap

export const CHEVRON_INK = 'white'
export const CHEVRON_HALO = 'rgba(0, 0, 0, 0.45)'
const CHEVRON_SWATCH_FILL = '#9e9e9e'

/**
 * Chevrons pointing left along a bar from x0 to x1 centred on y, one every
 * few bar heights, each as polyline points; none where the bar is too short
 * or thin to hold one
 */
export function chevronPoints(
  x0: number,
  x1: number,
  y: number,
  barPx: number,
) {
  const half = barPx * 0.3
  const depth = Math.max(2, barPx * 0.3)
  const pitch = chevronPitch(barPx)
  const room = x1 - x0 - depth
  const count = barPx < MIN_CHEVRON_BAR_PX ? 0 : Math.floor(room / pitch) + 1
  const first = x0 + (room - (count - 1) * pitch) / 2
  return room < 0
    ? []
    : Array.from({ length: count }, (_, k) => {
        const x = first + k * pitch
        return `${x + depth},${y - half} ${x},${y} ${x + depth},${y + half}`
      })
}

const MIN_CHEVRON_BAR_PX = 4

// the px from one chevron to the next on a bar barPx high
export const chevronPitch = (barPx: number) => Math.max(8, barPx * 1.6)

const chevronTrees = (points: string[], barPx: number) =>
  points.flatMap(p => [
    el('polyline', {
      points: p,
      fill: 'none',
      stroke: CHEVRON_HALO,
      'stroke-width': Math.max(1.5, barPx / 5),
      'stroke-linejoin': 'round',
    }),
    el('polyline', {
      points: p,
      fill: 'none',
      stroke: CHEVRON_INK,
      'stroke-width': Math.max(0.8, barPx / 10),
      'stroke-linejoin': 'round',
    }),
  ])

export const onPathStripText = (reference: string) =>
  `grey above: on ${reference}'s path`

// walk rows whose rows may carry the allele a repeat genotype called
export type WalkRowsWithCalls = Omit<WalkRows, 'reference' | 'rows'> & {
  reference: WalkRow & { call?: ReadoutCall }
  rows: (WalkRow & { call?: ReadoutCall })[]
}

export const CALL_TICK = '#111'
export const UNBACKED_TICK = '#9e9e9e'
export const DISAGREES = '#c62828'

// A call's tick: red where it and its walk disagree, which a row too thin for
// its readout still shows, and grey where no read spanned the allele
export function callTickInk(call: ReadoutCall) {
  return call.agrees === false
    ? DISAGREES
    : call.spanningReads === 0
      ? UNBACKED_TICK
      : CALL_TICK
}

// The key at (x, y), one entry after another along a line, and about how
// wide it is
export function walkRowsKeyTree(
  entries: KeyEntry[],
  x: number,
  y: number,
  idPrefix = 'walk-key',
) {
  let at = 0
  const parts = entries.flatMap((e, i) => {
    const rampId = `${idPrefix}-ramp-${i}`
    const ramp =
      !e.note && e.swatch.kind === 'bar' && e.swatch.ramp
        ? el(
            'linearGradient',
            { id: rampId },
            ...RAMP_GRADIENT_STOPS.map(s =>
              el('stop', { offset: s.offset, 'stop-color': s.color }),
            ),
          )
        : undefined
    const swatch = e.note
      ? undefined
      : e.swatch.kind === 'gene'
        ? el('rect', {
            x: at,
            y: 5,
            width: 18,
            height: 8,
            fill: 'none',
            stroke: GENE_INK,
            'stroke-width': 1.5,
          })
        : el('rect', {
            x: at,
            y: e.swatch.kind === 'gap' ? 9 - e.swatch.px / 2 : 5,
            width: 18,
            height: e.swatch.kind === 'gap' ? e.swatch.px : 8,
            rx: 2,
            fill: ramp ? `url(#${rampId})` : e.swatch.fill,
            ...(e.swatch.kind === 'bar' && e.swatch.rim
              ? { stroke: e.swatch.rim, 'stroke-width': NOT_LOADED_RIM_PX }
              : {}),
          })
    const chevrons =
      !e.note && e.swatch.kind === 'bar' && e.swatch.chevrons
        ? chevronTrees(chevronPoints(at, at + 18, 9, 8), 8)
        : []
    const text = el(
      'text',
      {
        x: e.note ? at : at + 23,
        y: 13,
        'font-style': e.note ? 'italic' : undefined,
        fill: e.note ? '#666' : undefined,
      },
      e.label,
    )
    at += (e.note ? 0 : 23) + e.label.length * LABEL_CHAR_PX + 16
    return [ramp, swatch, ...chevrons, text].filter(p => p !== undefined)
  })
  return {
    width: at,
    tree: elOf(
      'g',
      {
        transform: `translate(${x} ${y})`,
        'font-family': 'Helvetica, Arial, sans-serif',
        'font-size': 11,
      },
      parts,
    ),
  }
}

export interface RowPitch {
  rowPx: number
  barPx: number
  labelled: boolean
  readouts: boolean
}

// The pitch at which `count` rows fill `room` px, from the walk-rows layout's
// own down to `minRowPx`. Under a pixel every row still draws, the bars
// touching, as a dense overview of the cohort.
export function rowPitch(count: number, room: number, minRowPx = 0): RowPitch {
  const fit = room / Math.max(1, count)
  const rowPx = Math.max(
    minRowPx,
    Math.min(ROW_HEIGHT_PX, fit >= 1 ? Math.floor(fit) : fit),
  )
  return {
    rowPx,
    barPx: rowPx <= 3 ? rowPx : Math.max(3, Math.round(rowPx * 0.6)),
    labelled: rowPx >= LABELLED_ROW_PX,
    readouts: rowPx >= LABELLED_ROW_PX,
  }
}

export interface WalkRowsFrame {
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
  width: number
  height: number
  // the rows' pitch and bar height in px, ROW_HEIGHT_PX and BAR_PX unless a
  // dense strip shrinks them
  rowPx?: number
  barPx?: number
  // false where rows are too thin to letter, which leaves readouts to hover
  readouts?: boolean
  // false where a canvas paints the bars under the tree, which then draws the
  // rest of each row, its readout naming its gaps' causes
  bars?: boolean
  // a readout's width in px at 11 px sans-serif, readoutTextPx unless a host
  // measures it on its canvas
  measure?: (text: string) => number
}

const offPath = (run: WalkRun) => !run.gap && !run.onReference

// Adjacent runs off the path as one where they draw alike: loaded or not,
// unless `marked` draws those not loaded apart
function joinOffPath(runs: WalkRun[], marked: boolean) {
  const hollow = (run: WalkRun) => marked && run.unloaded === true
  return joined(
    runs,
    (last, run) =>
      offPath(last) && offPath(run) && hollow(last) === hollow(run),
    (last, run) => ({
      start: last.start,
      bp: last.bp + run.bp,
      onReference: false,
      referenceStart: undefined,
      ...(hollow(run) ? { unloaded: true as const } : {}),
    }),
  )
}

// Runs under a pixel wide merged into one, painted as the bp most of them
// carry, and where `marked` those not loaded counted apart: a base-level cut
// splits a bar at every SNP, which draws as noise and costs an element per
// run. Gaps stay apart.
export function coalesceRuns(runs: WalkRun[], pxPerBp: number, marked = false) {
  const minBp = 1 / pxPerBp
  const out: WalkRun[] = []
  let bucket: WalkRun[] = []
  const flush = () => {
    if (bucket.length === 0) {
      return
    }
    if (bucket.length === 1) {
      out.push(bucket[0]!)
    } else {
      let on = 0
      let off = 0
      let unloaded = 0
      for (const r of bucket) {
        if (r.onReference) {
          on += r.bp
        } else if (marked && r.unloaded) {
          unloaded += r.bp
        } else {
          off += r.bp
        }
      }
      const onReference =
        on >= off && on >= unloaded && bucket.some(r => r.onReference)
      const hollow = !onReference && unloaded > off
      const lead = bucket.find(r =>
        onReference
          ? r.onReference
          : !r.onReference && (marked && r.unloaded === true) === hollow,
      )!
      out.push({
        start: bucket[0]!.start,
        bp: on + off + unloaded,
        onReference,
        referenceStart: onReference ? lead.referenceStart : undefined,
        ...(onReference && bucket.every(r => !r.onReference || r.reversed)
          ? { reversed: true as const }
          : {}),
        ...(hollow ? { unloaded: true as const } : {}),
      })
    }
    bucket = []
  }
  let held = 0
  for (const run of joinOffPath(runs, marked)) {
    if (run.gap || run.bp >= minBp) {
      flush()
      held = 0
      out.push(run)
      continue
    }
    bucket.push(run)
    held += run.bp
    if (held >= minBp) {
      flush()
      held = 0
    }
  }
  flush()
  return out
}

function geneTree(box: GeneBox, y: number, barPx: number) {
  return elOf('g', { class: 'row-gene', 'data-testid': 'graph-walk-gene' }, [
    el('title', {}, box.name),
    ...box.exons.map(e =>
      el('rect', {
        x: e.x,
        y: y - barPx / 2,
        width: e.w,
        height: barPx,
        fill: GENE_INK,
        opacity: 0.35,
      }),
    ),
    el('rect', {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      fill: 'none',
      stroke: GENE_INK,
      'stroke-width': 1.5,
    }),
    box.label?.leader &&
      el('line', {
        ...box.label.leader,
        stroke: GENE_INK,
        'stroke-width': 0.8,
        'stroke-opacity': 0.6,
      }),
    box.label &&
      el(
        'text',
        {
          x: box.label.x,
          y: box.label.y,
          'font-family': 'sans-serif',
          'font-size': box.label.size,
          'font-weight': 600,
          'text-anchor': 'middle',
          fill: GENE_INK,
          stroke: 'white',
          'stroke-width': 2.5,
          'paint-order': 'stroke',
        },
        box.name,
      ),
  ])
}

// Walk rows over a pane: each row's runs, unit separators, its genes, the
// allele a repeat genotype called and its readout. `idPrefix` keeps gradient
// ids apart where several panes share a document.
export function walkRowsTree(
  bars: WalkRowsWithCalls,
  frame: WalkRowsFrame,
  o: {
    ramp?: { start: number; end: number }
    rowGenes?: Map<string, RowGene[]>
    idPrefix?: string
    // draw runs not loaded hollow, as a node layout above draws placeholders
    markUnloaded?: boolean
    // set while ribbons, shared blocks or the shared order are on
    comparing?: boolean
    // the lifted walks' colours, which the rows they name take, each but the
    // reference's under a strip where it runs on the reference's path
    inks?: readonly RowInk[]
  } = {},
) {
  const marked = o.markUnloaded ?? false
  const X = (bp: number) => bp * frame.scaleX + frame.translateX
  const rowPx = frame.rowPx ?? ROW_HEIGHT_PX
  const barPx = frame.barPx ?? BAR_PX
  const stripRoom =
    (rowPx - barPx) / 2 >= ON_PATH_STRIP_GAP_PX + ON_PATH_STRIP_PX
  const overhang = Math.min(3, Math.max(0, (rowPx - barPx) / 2))
  const Y = (row: number) => row * rowPx * frame.scaleY + frame.translateY
  const { origin, unit, reference, rows } = bars
  const along = (offset: number) => X(origin + offset)
  const prefix = o.idPrefix ?? 'walkrow'
  const rowTree = (
    row: WalkRow & { call?: ReadoutCall },
    i: number,
  ): El | undefined => {
    const y = Y(i)
    if (y < -barPx || y > frame.height + barPx) {
      return undefined
    }
    const asDrawn = coalesceRuns(row.runs, frame.scaleX, marked)
    const coalesced = frame.bars === false ? [] : asDrawn
    const ink = o.inks && rowInkOf(row, o.inks)
    const inkStops = ink && rowInkStops(ink, row, 1 / frame.scaleX)
    const inkId = `${prefix}-${i}-ink`
    const inkGradient =
      inkStops &&
      inkStops.length > 1 &&
      elOf(
        'linearGradient',
        {
          id: inkId,
          gradientUnits: 'userSpaceOnUse',
          x1: along(0),
          x2: along(barEnd(row)),
          y1: 0,
          y2: 0,
        },
        inkStops.map(s =>
          el('stop', { offset: s.offset, 'stop-color': s.color }),
        ),
      )
    const inkFill =
      inkStops && (inkStops.length > 1 ? `url(#${inkId})` : inkStops[0]!.color)
    const inked = (run: WalkRun) => !run.gap && !(marked && run.unloaded)
    const pieces = inkFill ? joined(coalesced, touching(inked)) : coalesced
    const runs = pieces.flatMap(run => {
      const paint =
        inkFill && inked(run)
          ? { fill: inkFill }
          : runPaint(run, o.ramp, marked)
      const h = run.gap ? Math.min(gapStyle(run.cause).px, barPx) : barPx
      const id = `${prefix}-${i}-${run.start}`
      const w = Math.max(1, run.bp * frame.scaleX)
      const rim = 'rim' in paint ? paint.rim : undefined
      const hollow = rim !== undefined && w > 2 * NOT_LOADED_RIM_PX
      const inset = hollow ? NOT_LOADED_RIM_PX / 2 : 0
      const rect = el('rect', {
        x: along(run.start) + inset,
        y: y - h / 2 + inset,
        width: w - 2 * inset,
        height: h - 2 * inset,
        fill:
          'stops' in paint
            ? `url(#${id})`
            : hollow
              ? paint.fill
              : (rim ?? paint.fill),
        ...(hollow ? { stroke: rim, 'stroke-width': NOT_LOADED_RIM_PX } : {}),
      })
      return 'stops' in paint
        ? [
            elOf(
              'linearGradient',
              { id },
              paint.stops.map((color, k) =>
                el('stop', {
                  offset: k / (paint.stops.length - 1),
                  'stop-color': color,
                }),
              ),
            ),
            rect,
          ]
        : [rect]
    })
    const strip =
      ink && i > 0 && stripRoom
        ? joined(coalesced, touching(onPath))
            .filter(onPath)
            .map(span =>
              el('rect', {
                'data-testid': 'graph-walk-on-path',
                x: along(span.start),
                y: y - barPx / 2 - ON_PATH_STRIP_GAP_PX - ON_PATH_STRIP_PX,
                width: Math.max(1, span.bp * frame.scaleX),
                height: ON_PATH_STRIP_PX,
                fill: ON_PATH_STRIP_INK,
              }),
            )
        : []
    const ticks =
      unit && barPx >= MIN_TILED_BAR_PX
        ? unitTicks(walkedBp(row), unit, frame.scaleX)
            .map(tick => walkedAlong(row.runs, tick))
            .map(k =>
              el('line', {
                x1: along(k),
                x2: along(k),
                y1: y - barPx / 2,
                y2: y + barPx / 2,
                stroke: 'white',
                'stroke-width': 1,
              }),
            )
        : []
    const chevrons = chevronTrees(
      reversedStretches(asDrawn).flatMap(stretch =>
        chevronPoints(along(stretch.start), along(stretch.end), y, barPx),
      ),
      barPx,
    )
    const breaks = row.runs
      .filter(shortened)
      .map(run => breakTree(along(run.start + run.bp / 2), y, barPx))
    const { call } = row
    const readout =
      (frame.readouts ?? true)
        ? walkRowReadoutAt(bars, i, frame, { comparing: o.comparing })
        : undefined
    return group(
      {
        'data-testid': i === 0 ? 'graph-walk-reference' : 'graph-walk-row',
      },
      [
        readout !== undefined &&
          readout.full !== readout.shown &&
          el('title', {}, readout.full),
      ],
      [inkGradient],
      runs,
      strip,
      ticks,
      chevrons,
      breaks,
      rowGeneBoxes(o.rowGenes?.get(row.name) ?? [], along, y, {
        rowPx,
        barPx,
        namesAbove: i === 0 ? frame.width : undefined,
        ends: { x0: along(0), x1: along(barEnd(row)) },
      }).map(box => geneTree(box, y, barPx)),
      [
        call &&
          el('rect', {
            'data-testid': 'graph-walk-call',
            x: along(walkedAlong(row.runs, call.bp)) - 1,
            y: y - barPx / 2 - overhang,
            width: 2,
            height: barPx + 2 * overhang,
            fill: callTickInk(call),
          }),
        readout !== undefined &&
          readout.shown !== '' &&
          el(
            'text',
            {
              x: readout.x,
              y: y + 4,
              'font-family': 'sans-serif',
              'font-size': 11,
              fill: call?.agrees === false ? DISAGREES : '#333',
            },
            readout.shown,
          ),
      ],
    )
  }
  return group(
    {},
    [rowTree(reference, 0)],
    rows.map((row, k) => rowTree(row, k + 1)),
  )
}

const onPath = (run: WalkRun) => run.onReference && !run.gap

// Two touching runs that `joins` both holds, which a bar of one paint draws
// with no seam between them
const touching =
  (joins: (run: WalkRun) => boolean) => (last: WalkRun, run: WalkRun) =>
    joins(last) && joins(run) && last.start + last.bp === run.start

// Runs with each one `alike` the run before it made one with it
function joined(
  runs: readonly WalkRun[],
  alike: (last: WalkRun, run: WalkRun) => boolean,
  merged: (last: WalkRun, run: WalkRun) => WalkRun = (last, run) => ({
    ...last,
    bp: last.bp + run.bp,
  }),
) {
  const out: WalkRun[] = []
  for (const run of runs) {
    const last = out.at(-1)
    if (last && alike(last, run)) {
      out[out.length - 1] = merged(last, run)
    } else {
      out.push(run)
    }
  }
  return out
}

// An element of `parts`' elements, which may be too many to pass one by one
function group(attrs: ElAttrs, ...parts: (El | undefined | false)[][]) {
  return elOf('g', attrs, parts.flat())
}
