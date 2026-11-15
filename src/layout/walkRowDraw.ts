import { el } from '../el'
import {
  FROM_ELSEWHERE_TEXT,
  GAP_CAUSE_TEXT,
  NOT_LOADED_TEXT,
  OUTSIDE_TEXT,
  PLACEMENT_CHOICE_TEXT,
  departureSpan,
  departureText,
  placementChoice,
  roughBp,
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
import { ROW_HEIGHT_PX } from './rowSpacing'
import { rowsNeedingRoutes } from './walkRowLinks'

import type { El, ElAttrs } from '../el'
import type { GeneModel } from '../genes/genePins'
import type { GapCause } from '../gfa/departures'
import type { WalkAxis, WalkPass, WalkRow, WalkRows, WalkRun } from './walkRows'

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
// rows thinner than this go unlabelled, their names and readouts on hover
export const LABELLED_ROW_PX = 12
// a unit separator over a thinner bar would cut it into dashes
const MIN_TILED_BAR_PX = 6
// a unit separator is dropped when a unit is under this many px
const MIN_TILE_PX = 3

function kb(bp: number) {
  return `${(bp / 1000).toFixed(bp < 10_000 ? 1 : 0)} kb`
}

const sized = (bp: number) => (bp < 1000 ? `${bp} bp` : kb(bp))

function signedLength(delta: number) {
  return `${delta > 0 ? '+' : '−'}${sized(Math.abs(delta))}`
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

// Parts of a row's bp: `drawn` ones first, then what the cut left out, by the
// cause its gaps state: `, of which 19 kb left out of graph, 34 kb near
// chr22:20.3 Mb`, where the departure out of the gap rejoins the reference,
// or for gaps stating none `, of which 19 kb out of view`
function partsText(
  drawn: string[],
  gapBp: number,
  runs: WalkRun[] | undefined,
  refName: string | undefined,
) {
  const stated = [...drawn, ...gapsParts(gapBp, runs, refName)]
  return stated.length > 0 ? `, of which ${stated.join(', ')}` : ''
}

function gapsParts(
  gapBp: number,
  runs: WalkRun[] | undefined,
  refName: string | undefined,
) {
  const gaps = (runs ?? []).filter(r => r.gap)
  return gapBp <= 0
    ? []
    : !gaps.some(g => g.cause)
      ? [`${sized(gapBp)} ${OUTSIDE_TEXT}`]
      : causesParts(gaps, refName)
}

function causesParts(gaps: WalkRun[], refName: string | undefined) {
  const bpOf = (cause: GapCause | undefined) =>
    gaps.filter(g => g.cause === cause).reduce((sum, g) => sum + g.bp, 0)
  const mixedMissing = gaps
    .filter(g => g.cause === 'mixed')
    .reduce((sum, g) => sum + (g.missingBp ?? 0), 0)
  const placesOf = (cause: GapCause) => {
    const places = [
      ...new Set(
        gaps.flatMap(g =>
          g.cause === cause && g.near !== undefined
            ? [near(refName, g.near)]
            : [],
        ),
      ),
    ]
    return places.length === 0
      ? ''
      : `${places[0]}${places.length > 1 ? ` and ${places.length - 1} more place${places.length > 2 ? 's' : ''}` : ''}`
  }
  const lastSeen = placesOf('unread')
  const parts = [
    [bpOf('missing') + mixedMissing, GAP_CAUSE_TEXT.missing],
    [bpOf('elsewhere'), `near ${placesOf('elsewhere')}`],
    [bpOf('own') + bpOf('mixed') - mixedMissing, GAP_CAUSE_TEXT.own],
    [
      bpOf('unread'),
      `${GAP_CAUSE_TEXT.unread}${lastSeen ? ` (last seen near ${lastSeen})` : ''}`,
    ],
    [bpOf(undefined), OUTSIDE_TEXT],
  ] as const
  return parts
    .filter(([bp]) => bp > 0)
    .map(([bp, text]) => `${sized(bp)} ${text}`)
}

const otherContigsText = (counted: WalkRow['otherContigs']) =>
  counted
    ? ` · ${counted.departures} departure${counted.departures > 1 ? 's' : ''} on ${counted.contigs > 1 ? `${counted.contigs} other contigs` : 'another contig'}`
    : ''

// A stepless row's departures in words: the widest stretch's facts, how many
// more, and a placement choice among the others
function steplessText(
  departures: NonNullable<WalkRow['departures']>,
  reference: string | undefined,
) {
  const widest = [...departures].sort((a, b) => {
    const x = departureSpan(a)
    const y = departureSpan(b)
    return y.end - y.start - (x.end - x.start)
  })[0]
  const more = departures.length - 1
  return widest
    ? [
        departureText(widest, reference),
        ...(more > 0 ? [`${more} more departure${more > 1 ? 's' : ''}`] : []),
        ...(!placementChoice(widest) && departures.some(placementChoice)
          ? [PLACEMENT_CHOICE_TEXT]
          : []),
      ].join(' · ')
    : ''
}

type Crossing = Pick<
  WalkPass,
  'bp' | 'onReferenceBp' | 'fromElsewhereBp' | 'gapBp' | 'reversed'
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
    | 'morePasses'
    | 'stop'
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
  const { bp, gapBp, complete, stop } = row
  const others = otherContigsText(row.otherContigs)
  if (!reference) {
    const length = row.windowBp ?? bp
    return `${sized(length)}${units(length, unit)}${others}`
  }
  const outside = row.outsideRow
    ? ` · ${row.outsideRow.count} departure${row.outsideRow.count > 1 ? 's' : ''} outside the row${row.outsideRow.stepsBp > 0 ? `, ${sized(row.outsideRow.stepsBp)} of its own in the graph` : ''}`
    : ''
  const beyond = `${outside}${others}`
  if (row.stepless) {
    return `${steplessText(row.departures ?? [], reference.sample)}${beyond}`
  }
  const name = reference.sample ?? 'the reference'
  const elsewhereText = (stretchBp: number) =>
    `${sized(stretchBp)} ${name} ${FROM_ELSEWHERE_TEXT}`
  const elsewhere = row.fromElsewhereBp ?? 0
  const parts = partsText(
    row.replacedBp === undefined && elsewhere > 0
      ? [elsewhereText(elsewhere)]
      : [],
    gapBp,
    row.runs,
    reference.name,
  )
  const after = `${row.placementChoice ? ` · ${PLACEMENT_CHOICE_TEXT}` : ''}${beyond}`
  const called = call
    ? ` · called ${sized(call.bp)}${call.spanningReads === 0 ? ' · no spanning read' : ''}`
    : ''
  if (complete) {
    const of = reference.windowBp ?? reference.bp
    // A pass across a window edge by what it holds: its own bp off the
    // reference, its bp on the reference, the reference's from elsewhere, and
    // for a pass the row does not draw, or one holding nothing else, its bp
    // in gaps, which the row's parts state for the pass it draws
    const replacing = (pass: Crossing, replacedBp: number, drawn: boolean) => {
      const on = pass.onReferenceBp ?? 0
      const from = pass.fromElsewhereBp ?? 0
      const gaps = pass.gapBp ?? 0
      const own = pass.bp - on - from - gaps
      const alone = own <= 0 && on === 0 && from === 0
      const inPlace =
        own > 0 || from > 0 || gaps > 0
          ? ` in place of ${name}'s ${sized(replacedBp)}`
          : ''
      const held = [
        ...(own > 0 || pass.bp === 0 ? [`its own ${sized(own)}`] : []),
        ...(on > 0 ? [`${sized(on)} on ${name}`] : []),
        ...(from > 0 ? [elsewhereText(from)] : []),
        ...(gaps > 0 && (!drawn || alone)
          ? [`${sized(gaps)} ${GAP_CAUSE_TEXT.unread}`]
          : []),
      ]
      const onAt = held.findIndex(text => text.endsWith(` on ${name}`))
      return `${held
        .map((text, i) =>
          i === onAt && pass.reversed
            ? `${text}, reversed${i < held.length - 1 || inPlace ? ',' : ''}`
            : text,
        )
        .join(' and ')}${inPlace}`
    }
    const lengthOf = (
      pass: Crossing & Pick<WalkPass, 'replacedBp'>,
      length: number,
      drawn: boolean,
    ) => {
      const delta = length - of
      return pass.replacedBp !== undefined
        ? replacing(pass, pass.replacedBp, drawn)
        : `${sized(length)}${units(length, unit)}${delta === 0 ? '' : ` (${signedLength(delta)})`}`
    }
    const length =
      row.windowBp !== undefined && reference.windowBp !== undefined
        ? row.windowBp
        : bp
    const again = (row.morePasses ?? [])
      .map(
        pass =>
          ` · passes again${pass.reversed ? ', reversed' : ''}: ${lengthOf({ ...pass, reversed: false }, pass.windowBp, false)}`,
      )
      .join('')
    const first = {
      ...row,
      gapBp,
      reversed: row.axis?.reversed ?? false,
    }
    return `${lengthOf(first, length, true)}${again}${parts}${after}${called}`
  }
  const region = unit ? 'repeat' : 'window'
  if (stop?.contigEnds && bp === 0) {
    const where = stop.shortBp > 0 ? `${sized(stop.shortBp)} before` : 'at'
    return `contig ends ${where} the ${region}${called}`
  }
  const why = !stop
    ? 'partial walk'
    : stop.contigEnds
      ? `contig ends inside the ${region}`
      : stop.turnsBack
        ? `turns back out of the ${region}`
        : stop.goesOn
          ? `goes on near ${near(reference.name, stop.goesOn.near)}${stop.goesOn.drawn ? '' : ` · ${roughBp(stop.goesOn.departure.ownBp)} of its own`}`
          : 'does not rejoin the reference in view'
  const least = row.windowBp ?? bp
  const stated =
    bp === 0
      ? `${why}${parts}`
      : `≥ ${sized(least)}${units(least, unit)}${parts} · ${why}`
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

// A readout right of its bar's end and of `left`, or inside the bar where it
// would leave the pane and fits right of `left`
function readoutPlacement(
  text: string,
  endX: number,
  width: number,
  left: number,
  measure: (text: string) => number,
) {
  const textPx = measure(text)
  const beside = Math.max(endX + READOUT_GAP_PX, left)
  const inside = endX - READOUT_GAP_PX
  return beside + textPx < width || inside - textPx < left
    ? { x: beside, anchor: 'start' as const, halo: false }
    : { x: inside, anchor: 'end' as const, halo: true }
}

const ELLIPSIS = '…'

// A readout cut to `roomPx` by whole parts of its breakdown from the end,
// closed with an ellipsis; its total and change against the reference stay
function fitReadout(
  text: string,
  roomPx: number,
  measure: (text: string) => number,
) {
  const fits = (candidate: string) => measure(candidate) <= roomPx
  const [first = '', ...rest] = text.split(' · ')
  const tail = rest.map(part => ` · ${part}`).join('')
  const at = first.indexOf(', of which ')
  const head = at < 0 ? first : first.slice(0, at)
  const items = at < 0 ? [] : first.slice(at + ', of which '.length).split(', ')
  const cuts =
    items.length > 0
      ? [tail, ''].flatMap(after =>
          items
            .map((_, k) => items.length - 1 - k)
            .map(k =>
              k > 0
                ? `${head}, of which ${items.slice(0, k).join(', ')}, ${ELLIPSIS}${after}`
                : `${head}, ${ELLIPSIS}${after}`,
            ),
        )
      : rest
          .map((_, k) => rest.length - 1 - k)
          .map(k => `${[first, ...rest.slice(0, k)].join(' · ')} · ${ELLIPSIS}`)
  return fits(text) ? text : (cuts.find(fits) ?? cuts.at(-1) ?? text)
}

// A wrapped readout's two lines, this far apart and centred on the row, keep
// clear of the rows above and below at the walk-rows layout's own pitch
const READOUT_LINE_PX = 10

// A readout too long for `roomPx` as two lines, broken between two of its
// parts, the break that leaves the longer line shortest; none where no break
// fits both lines
function wrapReadout(
  text: string,
  roomPx: number,
  measure: (text: string) => number,
) {
  return [...text.matchAll(/ · |, /g)]
    .map(m => {
      const first = `${text.slice(0, m.index)}${m[0] === ', ' ? ',' : ''}`
      const second = text.slice(m.index + m[0].length)
      const lines: [string, string] = [first, second]
      return { lines, px: Math.max(measure(first), measure(second)) }
    })
    .filter(({ px }) => px <= roomPx)
    .sort((a, b) => a.px - b.px)[0]?.lines
}

const rowNameEnd = (label: string) =>
  3 * READOUT_GAP_PX + label.length * LABEL_CHAR_PX

export const NOT_COMPARED_TEXT = 'not compared'

/**
 * Row `i`'s readout (0 the reference) as a pane of `frame` draws it: `text`
 * in full, `lines` as drawn, `shown` those lines as one string, `cut` whether
 * they leave any of `text` out, and where they sit. Beside the bar means right
 * of its end and of the row's name; inside, only over solid bar past its last
 * gap, its width by `frame.measure` or else readoutTextPx. A readout too long
 * for the room beside the bar wraps onto two lines where rows are at their
 * full pitch and two lines fit, and is cut where not. While `comparing`, a
 * row the comparison leaves out ends `· not compared`, which no cut drops.
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
  const row = i === 0 ? bars.reference : bars.rows[i - 1]!
  const along = (offset: number) =>
    (bars.origin + offset) * frame.scaleX + frame.translateX
  const base = walkRowReadout(
    row,
    i === 0 ? undefined : bars.reference,
    bars.unit,
    row.call,
  )
  const suffix =
    o.comparing && i > 0 && rowsNeedingRoutes([row]) > 0
      ? ` · ${NOT_COMPARED_TEXT}`
      : ''
  const text = `${base}${suffix}`
  const measure = frame.measure ?? readoutTextPx
  const at = readoutPlacement(
    text,
    along(barEnd(row)),
    frame.width,
    Math.max(rowNameEnd(row.label), along(lastGapEnd(row.runs))),
    measure,
  )
  const roomPx = frame.width - at.x
  const wrapped =
    at.anchor === 'start' &&
    measure(text) > roomPx &&
    (frame.rowPx ?? ROW_HEIGHT_PX) >= 2 * READOUT_LINE_PX
      ? wrapReadout(text, roomPx, measure)
      : undefined
  const lines: [string] | [string, string] =
    wrapped ??
    (at.anchor === 'start'
      ? [`${fitReadout(base, roomPx - measure(suffix), measure)}${suffix}`]
      : [text])
  return {
    ...at,
    text,
    lines,
    shown: lines.join('\n'),
    cut: wrapped === undefined && lines[0] !== text,
  }
}

// Where a row's bar ends: past its runs, since a stepless row has no bp
export function barEnd(row: Pick<WalkRow, 'bp' | 'runs'>) {
  return row.runs.reduce(
    (end, run) => Math.max(end, run.start + run.bp),
    row.bp,
  )
}

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

// How a gap draws, and the key's words for it: graph sequence out of view as
// a band, bases the graph lacks as a hairline the walk jumps along, and its
// own sequence the cut did not read as a pale band. The stretch between a
// stepless row's departure's ends is a hairline too.
export function gapStyle(cause: GapCause | undefined) {
  return cause === 'missing'
    ? {
        fill: MISSING_INK,
        px: MISSING_PX,
        label: `${GAP_CAUSE_TEXT.missing}: in the assembly, but the graph builder dropped it`,
      }
    : cause === 'departure'
      ? { fill: MISSING_INK, px: MISSING_PX, label: GAP_CAUSE_TEXT.departure }
      : cause === 'own'
        ? {
            fill: OWN_GAP,
            px: GAP_PX,
            label: `${GAP_CAUSE_TEXT.own}: in the graph off the reference, between two stretches drawn here`,
          }
        : cause === 'mixed'
          ? {
              fill: OWN_GAP,
              px: MISSING_PX,
              label: `${GAP_CAUSE_TEXT.mixed}: some of each`,
            }
          : cause === 'unread'
            ? {
                fill: OUTSIDE_CUT,
                px: MISSING_PX,
                label: `${GAP_CAUSE_TEXT.unread}: in the graph, where the walk went after leaving this view`,
              }
            : cause === 'elsewhere'
              ? {
                  fill: OUTSIDE_CUT,
                  px: GAP_PX,
                  label:
                    'near a position: in the graph, drawn on another stretch of the reference',
                }
              : {
                  fill: OUTSIDE_CUT,
                  px: GAP_PX,
                  label: `${OUTSIDE_TEXT}: in the graph, beyond the part drawn here`,
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

// A contig span as offsets along a row's bar
export function alongRow(axis: WalkAxis, start: number, end: number) {
  return axis.reversed
    ? { start: axis.start - end, end: axis.start - start }
    : { start: start - axis.start, end: end - axis.start }
}

// The contig span a row's bar covers
export function rowSpan(axis: WalkAxis, bp: number) {
  return axis.reversed
    ? { start: axis.start - bp, end: axis.start }
    : { start: axis.start, end: axis.start + bp }
}

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
// row's own contig, cut to the bar
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
    const clip = ({ start, end }: { start: number; end: number }) => ({
      start: Math.max(0, start),
      end: Math.min(row.bp, end),
    })
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
  // the name inside the box where it fits and lands on no other name, shorter
  // genes taking their room first; or, on a row that names genes above it,
  // over the box with a leader down to it
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
// leave no room to box them. With `namesAbove`, the frame's right edge, a
// name that does not fit inside its box is set above it.
export function rowGeneBoxes(
  genes: RowGene[],
  X: (offset: number) => number,
  y: number,
  {
    rowPx = ROW_HEIGHT_PX,
    barPx = BAR_PX,
    namesAbove,
  }: { rowPx?: number; barPx?: number; namesAbove?: number } = {},
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
  const narrowestFirst = [...boxes].sort((a, b) => a.w - b.w)
  const taken: [number, number][] = []
  const named = new Set(
    (barPx >= MIN_LETTERED_BAR_PX ? narrowestFirst : []).filter(
      ({ g, x, w }) => {
        const half = geneNamePx(g.name) / 2
        const at: [number, number] = [x + w / 2 - half, x + w / 2 + half]
        if (
          2 * half > w + 6 ||
          taken.some(([a, b]) => at[0] < b + 2 && at[1] > a - 2)
        ) {
          return false
        }
        taken.push(at)
        return true
      },
    ),
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
  // a hollow bar has a `rim`
  | { kind: 'bar'; fill: string; ramp?: true; rim?: string }
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
  } = {},
): KeyEntry[] {
  const noun = o.annotation ?? 'gene'
  const rows = [bars.reference, ...bars.rows]
  const reference = bars.reference.label
  const elsewhere = rows.some(row => row.runs.some(run => run.fromElsewhere))
  const entries: KeyEntry[] = [
    {
      swatch: o.ramp
        ? { kind: 'bar', fill: o.rampCss ?? RAMP_GRADIENT_CSS, ramp: true }
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
  if (o.markUnloaded && rows.some(row => row.runs.some(run => run.unloaded))) {
    entries.push({
      swatch: { kind: 'bar', fill: NOT_LOADED_FILL_CSS, rim: NOT_LOADED_CSS },
      label: NOT_LOADED_TEXT,
    })
  }
  const labels = new Set<string>()
  for (const row of rows) {
    for (const run of row.runs) {
      if (run.gap) {
        labels.add(gapStyle(run.cause).label)
      }
    }
  }
  for (const cause of [
    undefined,
    'missing',
    'elsewhere',
    'departure',
    'own',
    'mixed',
    'unread',
  ] as const) {
    const { fill, px, label } = gapStyle(cause)
    if (labels.has(label)) {
      entries.push({ swatch: { kind: 'gap', fill, px }, label })
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
  if (rows.some(row => row.placementChoice)) {
    entries.push({
      swatch: { kind: 'gene' },
      label: `${PLACEMENT_CHOICE_TEXT}: the writer chose which pass of a node the reference passes more than once a step takes`,
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
    return [ramp, swatch, text].filter(p => p !== undefined)
  })
  return {
    width: at,
    tree: el(
      'g',
      {
        transform: `translate(${x} ${y})`,
        'font-family': 'Helvetica, Arial, sans-serif',
        'font-size': 11,
      },
      ...parts,
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
  const out: WalkRun[] = []
  for (const run of runs) {
    const last = out.at(-1)
    const hollow = marked && run.unloaded === true
    if (
      last &&
      offPath(last) &&
      offPath(run) &&
      hollow === (marked && last.unloaded === true)
    ) {
      out[out.length - 1] = {
        start: last.start,
        bp: last.bp + run.bp,
        onReference: false,
        referenceStart: undefined,
        ...(hollow ? { unloaded: true as const } : {}),
      }
    } else {
      out.push(run)
    }
  }
  return out
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
      const onReference = on >= off && on >= unloaded
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
        ...(lead.reversed ? { reversed: true as const } : {}),
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
  return el(
    'g',
    { class: 'row-gene', 'data-testid': 'graph-walk-gene' },
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
  )
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
  } = {},
) {
  const marked = o.markUnloaded ?? false
  const X = (bp: number) => bp * frame.scaleX + frame.translateX
  const rowPx = frame.rowPx ?? ROW_HEIGHT_PX
  const barPx = frame.barPx ?? BAR_PX
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
    const drawn = frame.bars === false ? [] : row.runs
    const runs = coalesceRuns(drawn, frame.scaleX, marked).flatMap(run => {
      const paint = runPaint(run, o.ramp, marked)
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
            el(
              'linearGradient',
              { id },
              ...paint.stops.map((color, k) =>
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
    const ticks =
      unit && barPx >= MIN_TILED_BAR_PX
        ? unitTicks(row.bp, unit, frame.scaleX).map(k =>
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
    const { call } = row
    const readout =
      (frame.readouts ?? true)
        ? walkRowReadoutAt(bars, i, frame, { comparing: o.comparing })
        : undefined
    return group(
      {
        'data-testid': i === 0 ? 'graph-walk-reference' : 'graph-walk-row',
      },
      [readout?.cut === true && el('title', {}, readout.text)],
      runs,
      ticks,
      rowGeneBoxes(o.rowGenes?.get(row.name) ?? [], along, y, {
        rowPx,
        barPx,
        namesAbove: i === 0 ? frame.width : undefined,
      }).map(box => geneTree(box, y, barPx)),
      [
        call &&
          el('rect', {
            'data-testid': 'graph-walk-call',
            x: along(call.bp) - 1,
            y: y - barPx / 2 - overhang,
            width: 2,
            height: barPx + 2 * overhang,
            fill: callTickInk(call),
          }),
        readout &&
          el(
            'text',
            {
              x: readout.x,
              y: y + 4 - ((readout.lines.length - 1) * READOUT_LINE_PX) / 2,
              'font-family': 'sans-serif',
              'font-size': 11,
              fill: call?.agrees === false ? DISAGREES : '#333',
              stroke: readout.halo ? 'white' : undefined,
              'stroke-width': readout.halo ? 3 : undefined,
              'paint-order': 'stroke',
              'text-anchor': readout.anchor,
            },
            readout.lines[1] === undefined
              ? readout.lines[0]
              : el('tspan', { x: readout.x }, readout.lines[0]),
            readout.lines[1] !== undefined &&
              el(
                'tspan',
                { x: readout.x, dy: READOUT_LINE_PX },
                readout.lines[1],
              ),
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

// An element of `parts`' elements, which may be too many to pass one by one
function group(attrs: ElAttrs, ...parts: (El | undefined | false)[][]): El {
  const children: El[] = []
  for (const part of parts) {
    for (const child of part) {
      if (child) {
        children.push(child)
      }
    }
  }
  return { tag: 'g', attrs, children }
}

// Where a row's last gap ends, so a readout drawn inside the bar sits over
// solid bar alone
function lastGapEnd(runs: WalkRun[]) {
  return runs.reduce(
    (end, run) => (run.gap ? Math.max(end, run.start + run.bp) : end),
    Number.NEGATIVE_INFINITY,
  )
}
