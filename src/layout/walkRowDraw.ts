import { ROW_HEIGHT_PX } from './rowSpacing'
import { el } from '../el'
import { LABEL_CHAR_PX } from '../overlayLabels'
import { rampHueCss, rampStops } from '../referenceRampCss'
import { REFERENCE_RAMP_ALT_CSS } from '../renderer/GeometryBuilder'

import type { WalkAxis, WalkRow, WalkRows, WalkRun } from './walkRows'
import type { El } from '../el'
import type { GeneModel } from '../genes/genePins'

// What walk rows draw, shared by the hosts: walkRowsTree is the drawing as an
// element tree, which the plugin renders as React elements, BandageJS as DOM
// nodes and the figure export as markup, so the bars, readouts, genes and key
// agree everywhere.

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
  // whether the walk's length and the called allele agree, where both are
  // measurements
  agrees?: boolean
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
  } = {},
): KeyEntry[] {
  const entries: KeyEntry[] = [
    {
      swatch: {
        kind: 'bar',
        fill: o.ramp ? (o.rampCss ?? ON_REFERENCE) : ON_REFERENCE,
      },
      label: `on ${bars.reference.label}'s path`,
    },
    {
      swatch: {
        kind: 'bar',
        fill: o.ramp ? REFERENCE_RAMP_ALT_CSS : OFF_REFERENCE,
      },
      label: `off ${bars.reference.label}'s path`,
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
        label: `genes not read for the last ${rowsText(o.genes.unread)}`,
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

const CALL_TICK = '#111'
const UNBACKED_TICK = '#9e9e9e'
export const DISAGREES = '#c62828'

// The key at (x, y), one entry after another along a line, and about how
// wide it is
export function walkRowsKeyTree(entries: KeyEntry[], x: number, y: number) {
  let at = 0
  const parts = entries.flatMap(e => {
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
            y: e.swatch.kind === 'gap' ? 7 : 5,
            width: 18,
            height: e.swatch.kind === 'gap' ? GAP_PX : 8,
            rx: 2,
            fill: e.swatch.fill,
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
    return swatch ? [swatch, text] : [text]
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
}

// Runs under a pixel wide merged into one, painted as the bp most of them
// carry: a base-level cut splits a bar at every SNP, which draws as noise and
// costs an element per run. Gaps stay apart.
export function coalesceRuns(runs: WalkRun[], pxPerBp: number) {
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
      for (const r of bucket) {
        if (r.onReference) {
          on += r.bp
        } else {
          off += r.bp
        }
      }
      const onReference = on >= off
      const lead = bucket.find(r => r.onReference === onReference)!
      out.push({
        start: bucket[0]!.start,
        bp: on + off,
        onReference,
        referenceStart: onReference ? lead.referenceStart : undefined,
        ...(lead.reversed ? { reversed: true as const } : {}),
      })
    }
    bucket = []
  }
  let held = 0
  for (const run of runs) {
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

function geneTree(box: GeneBox, y: number) {
  return el(
    'g',
    { class: 'row-gene', 'data-testid': 'graph-walk-gene' },
    el('title', {}, box.name),
    ...box.exons.map(e =>
      el('rect', {
        x: e.x,
        y: y - BAR_PX / 2,
        width: e.w,
        height: BAR_PX,
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
  } = {},
) {
  const X = (bp: number) => bp * frame.scaleX + frame.translateX
  const rowPx = frame.rowPx ?? ROW_HEIGHT_PX
  const barPx = frame.barPx ?? BAR_PX
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
    const runs = coalesceRuns(row.runs, frame.scaleX).flatMap(run => {
      const paint = runPaint(run, o.ramp)
      const h = run.gap ? Math.min(GAP_PX, barPx) : barPx
      const id = `${prefix}-${i}-${run.start}`
      const rect = el('rect', {
        x: along(run.start),
        y: y - h / 2,
        width: Math.max(1, run.bp * frame.scaleX),
        height: h,
        fill: 'stops' in paint ? `url(#${id})` : paint.fill,
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
    const ticks = unit
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
    const text = walkRowReadout(
      row,
      i === 0 ? undefined : reference,
      unit,
      call,
    )
    const at = readoutPlacement(text, along(row.bp), frame.width)
    const readouts = frame.readouts ?? true
    return el(
      'g',
      {
        'data-testid': i === 0 ? 'graph-walk-reference' : 'graph-walk-row',
      },
      ...runs,
      ...ticks,
      ...rowGeneBoxes(o.rowGenes?.get(row.name) ?? [], along, y).map(box =>
        geneTree(box, y),
      ),
      call &&
        el('rect', {
          'data-testid': 'graph-walk-call',
          x: along(call.bp) - 1,
          y: y - barPx / 2 - 3,
          width: 2,
          height: barPx + 6,
          fill: call.spanningReads === 0 ? UNBACKED_TICK : CALL_TICK,
        }),
      readouts &&
        el(
          'text',
          {
            x: at.x,
            y: y + 4,
            'font-family': 'sans-serif',
            'font-size': 11,
            fill: call?.agrees === false ? DISAGREES : '#333',
            stroke: at.halo ? 'white' : undefined,
            'stroke-width': at.halo ? 3 : undefined,
            'paint-order': 'stroke',
            'text-anchor': at.anchor,
          },
          text,
        ),
    )
  }
  return el('g', {}, ...[reference, ...rows].map(rowTree))
}
