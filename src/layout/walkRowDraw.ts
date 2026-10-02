import { ROW_HEIGHT_PX } from './rowSpacing'
import { LABEL_CHAR_PX } from '../overlayLabels'
import { rampHueCss, rampStops } from '../referenceRampCss'
import { REFERENCE_RAMP_ALT_CSS } from '../renderer/GeometryBuilder'

import type { WalkAxis, WalkRow, WalkRows, WalkRun } from './walkRows'
import type { GeneModel } from '../genes/genePins'

// What walk rows draw, shared by the hosts: the plugin's React overlay, the
// BandageJS page and the figure export each render these numbers and words
// their own way, so the bars, readouts, genes and key agree everywhere.

export const ON_REFERENCE = '#2f8fd6'
export const OFF_REFERENCE = '#8e3fbf'
export const OUTSIDE_CUT = '#bdbdbd'
export const GENE_INK = '#1c1c22'
export const BAR_PX = 12
export const GAP_PX = 4
// a unit separator is dropped when a unit is under this many px
const MIN_TILE_PX = 3

export function kb(bp: number) {
  return `${(bp / 1000).toFixed(bp < 10_000 ? 1 : 0)} kb`
}

function units(bp: number, unit: number | undefined) {
  return unit ? ` ≈ ${Math.round(bp / unit)} units` : ''
}

// a repeat genotype's allele length for a walk, as the plugin's repeat
// catalogue pairs one with a row
export interface ReadoutCall {
  bp: number
  spanningReads?: number
}

// The text at the end of a bar: its length, what it carries against the
// reference row, and what the cut left out
export function walkRowReadout(
  row: Pick<WalkRow, 'bp' | 'gapBp' | 'complete'>,
  reference: Pick<WalkRow, 'bp'> | undefined,
  unit?: number,
  call?: ReadoutCall,
) {
  const { bp, gapBp, complete } = row
  if (!reference) {
    return `${kb(bp)}${units(bp, unit)}`
  }
  const delta = bp - reference.bp
  const against =
    delta === 0 ? '' : ` (${delta > 0 ? '+' : '−'}${kb(Math.abs(delta))})`
  const outside = gapBp > 0 ? ` · ${kb(gapBp)} outside the cut` : ''
  const called = call
    ? ` · called ${kb(call.bp)}${call.spanningReads === 0 ? ' · no spanning read' : ''}`
    : ''
  return `${kb(bp)}${units(bp, unit)}${against}${outside}${complete ? '' : ' · partial walk'}${called}`
}

// A readout right of its bar's end, or inside it where it would leave the pane
export function readoutPlacement(text: string, endX: number, width: number) {
  const x = endX + 6
  const fits = x + text.length * LABEL_CHAR_PX < width
  return fits
    ? { x, anchor: 'start' as const, halo: false }
    : { x: endX - 6, anchor: 'end' as const, halo: true }
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

// A run's paint: a flat colour, or under the reference-position ramp the hues
// a gradient along a shared run takes, since it covers its reference
// contiguously
export function runPaint(
  run: WalkRun,
  ramp: { start: number; end: number } | undefined,
): { fill: string } | { stops: string[] } {
  if (run.gap) {
    return { fill: OUTSIDE_CUT }
  }
  if (!ramp) {
    return { fill: run.onReference ? ON_REFERENCE : OFF_REFERENCE }
  }
  if (run.referenceStart === undefined) {
    return { fill: REFERENCE_RAMP_ALT_CSS }
  }
  const stops = rampStops({ ...run, start: run.referenceStart }, ramp)
  return stops.length === 1
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

// Each row's genes as offsets along its bar, from genes the host read for that
// row's own contig, those overlapping the bar
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
    placed.set(
      row.name,
      genes
        .map(g => ({
          name: g.name,
          ...alongRow(axis, g.start, g.end),
          exons: g.exons.map(e => alongRow(axis, e.start, e.end)),
        }))
        .filter(g => g.end > 0 && g.start < row.bp)
        .sort((a, b) => a.start - b.start),
    )
  }
  return placed
}

const GENE_FONT_PX = 9
const GENE_CHAR_PX = 5.2

export interface GeneBox {
  name: string
  x: number
  y: number
  w: number
  h: number
  exons: { x: number; w: number }[]
  // the name inside the box where it fits and lands on no other name, shorter
  // genes taking their room first
  label?: { x: number; y: number; size: number }
}

// A row's genes as boxes in screen px around its bar at `y`
export function rowGeneBoxes(
  genes: RowGene[],
  X: (offset: number) => number,
  y: number,
): GeneBox[] {
  const boxes = genes.map(g => {
    const x = X(g.start)
    return {
      g,
      x,
      w: Math.max(2, X(g.end) - x),
    }
  })
  const taken: [number, number][] = []
  const named = new Set(
    [...boxes]
      .sort((a, b) => a.w - b.w)
      .filter(({ g, x, w }) => {
        const half = (g.name.length * GENE_CHAR_PX) / 2
        const at: [number, number] = [x + w / 2 - half, x + w / 2 + half]
        if (
          2 * half > w + 6 ||
          taken.some(([a, b]) => at[0] < b + 2 && at[1] > a - 2)
        ) {
          return false
        }
        taken.push(at)
        return true
      }),
  )
  return boxes.map(box => ({
    name: box.g.name,
    x: box.x,
    y: y - BAR_PX / 2 - 2,
    w: box.w,
    h: BAR_PX + 4,
    exons: box.g.exons.map(e => ({
      x: X(e.start),
      w: Math.max(1, X(e.end) - X(e.start)),
    })),
    label: named.has(box)
      ? { x: box.x + box.w / 2, y: y + 3, size: GENE_FONT_PX }
      : undefined,
  }))
}

export type KeySwatch =
  | { kind: 'bar'; fill: string }
  | { kind: 'gap'; fill: string }
  | { kind: 'gene' }

export interface KeyEntry {
  swatch: KeySwatch
  label: string
  // a line under the entries, saying what the key leaves out
  note?: true
}

// The rows a host could read no genes for
export interface GeneGaps {
  untracked: number
  unread: number
}

const rowsText = (n: number) => `${n} row${n === 1 ? '' : 's'}`

// What the bar colours mean. A run's colour says how the graph aligned the
// walk: at a tandem array it may thread a copy the reference carries through
// nodes of its own, so off-reference is no statement about the sequence.
export function walkRowsKey(
  bars: WalkRows,
  o: {
    ramp?: { start: number; end: number }
    rampCss?: string
    genes?: GeneGaps
  } = {},
): KeyEntry[] {
  const entries: KeyEntry[] = [
    {
      swatch: {
        kind: 'bar',
        fill: o.ramp ? (o.rampCss ?? ON_REFERENCE) : ON_REFERENCE,
      },
      label: `aligned to ${bars.reference.label} in the graph`,
    },
    {
      swatch: {
        kind: 'bar',
        fill: o.ramp ? REFERENCE_RAMP_ALT_CSS : OFF_REFERENCE,
      },
      label: 'not aligned to it in the graph',
    },
  ]
  if ([bars.reference, ...bars.rows].some(row => row.gapBp > 0)) {
    entries.push({
      swatch: { kind: 'gap', fill: OUTSIDE_CUT },
      label: 'walked outside the cut',
    })
  }
  if (o.genes) {
    entries.push({
      swatch: { kind: 'gene' },
      label: "genes, each row's own annotation",
    })
    if (o.genes.untracked) {
      entries.push({
        swatch: { kind: 'gene' },
        label: `no gene track for ${rowsText(o.genes.untracked)}`,
        note: true,
      })
    }
    if (o.genes.unread) {
      entries.push({
        swatch: { kind: 'gene' },
        label: `genes not read for the last ${rowsText(o.genes.unread)}`,
        note: true,
      })
    }
  }
  return entries
}

function esc(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export interface WalkRowsFrame {
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
  width: number
  height: number
}

// Walk rows as SVG markup over a pane: each row's runs, unit separators,
// readout and genes. `idPrefix` keeps gradient ids apart where several panes
// share a document.
export function walkRowsSvg(
  bars: WalkRows,
  frame: WalkRowsFrame,
  o: {
    ramp?: { start: number; end: number }
    rowGenes?: Map<string, RowGene[]>
    calls?: Map<string, ReadoutCall>
    idPrefix?: string
  } = {},
) {
  const X = (bp: number) => bp * frame.scaleX + frame.translateX
  const Y = (row: number) =>
    row * ROW_HEIGHT_PX * frame.scaleY + frame.translateY
  const { origin, unit, reference, rows } = bars
  const along = (offset: number) => X(origin + offset)
  const prefix = o.idPrefix ?? 'walkrow'
  const out: string[] = []
  ;[reference, ...rows].forEach((row, i) => {
    const y = Y(i)
    if (y < -BAR_PX || y > frame.height + BAR_PX) {
      return
    }
    for (const run of row.runs) {
      const paint = runPaint(run, o.ramp)
      const h = run.gap ? GAP_PX : BAR_PX
      let fill: string
      if ('stops' in paint) {
        const id = `${prefix}-${i}-${run.start}`
        out.push(
          `<linearGradient id="${id}">${paint.stops
            .map(
              (c, k) =>
                `<stop offset="${k / (paint.stops.length - 1)}" stop-color="${c}"/>`,
            )
            .join('')}</linearGradient>`,
        )
        fill = `url(#${id})`
      } else {
        fill = paint.fill
      }
      out.push(
        `<rect x="${along(run.start)}" y="${y - h / 2}" width="${Math.max(1, run.bp * frame.scaleX)}" height="${h}" fill="${fill}"/>`,
      )
    }
    if (unit) {
      for (const k of unitTicks(row.bp, unit, frame.scaleX)) {
        out.push(
          `<line x1="${along(k)}" x2="${along(k)}" y1="${y - BAR_PX / 2}" y2="${y + BAR_PX / 2}" stroke="white" stroke-width="1"/>`,
        )
      }
    }
    for (const box of rowGeneBoxes(o.rowGenes?.get(row.name) ?? [], along, y)) {
      out.push(
        `<g class="row-gene"><title>${esc(box.name)}</title>${box.exons
          .map(
            e =>
              `<rect x="${e.x}" y="${y - BAR_PX / 2}" width="${e.w}" height="${BAR_PX}" fill="${GENE_INK}" opacity="0.35"/>`,
          )
          .join(
            '',
          )}<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="${GENE_INK}" stroke-width="1.5"/>${
          box.label
            ? `<text x="${box.label.x}" y="${box.label.y}" font-family="sans-serif" font-size="${box.label.size}" font-weight="600" text-anchor="middle" fill="${GENE_INK}" stroke="white" stroke-width="2.5" paint-order="stroke">${esc(box.name)}</text>`
            : ''
        }</g>`,
      )
    }
    const text = walkRowReadout(
      row,
      i === 0 ? undefined : reference,
      unit,
      o.calls?.get(row.name),
    )
    const at = readoutPlacement(text, along(row.bp), frame.width)
    out.push(
      `<text x="${at.x}" y="${y + 4}" font-family="sans-serif" font-size="11" fill="#333"${
        at.halo ? ' stroke="white" stroke-width="3" paint-order="stroke"' : ''
      } text-anchor="${at.anchor}">${esc(text)}</text>`,
    )
  })
  return out.join('')
}
