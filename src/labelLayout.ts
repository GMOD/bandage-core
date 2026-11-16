import { EXON_RIM_PX } from './genes/exonOutline'
import { namedGenePins } from './genes/geneNames'
import {
  nodeLabelBudget,
  placeSizeLabels,
  rowLabelBox,
  sizeLabelCandidates,
  unlabelledPlaceholders,
} from './graphLabels'
import { HALO_FACTOR } from './halo'
import { keyColumnBox } from './keyColumn'
import {
  LABEL_CHAR_PX,
  LABEL_PAD,
  LABEL_PX,
  labelWidth,
  occupancy,
  placeLabels,
} from './overlayLabels'
import { otherNodeUnderBox, segmentMeetsBox } from './util/hitDetection'

import type { BubbleHalo } from './bubbles/bubbleHalos'
import type { NamedGenePin } from './genes/geneNames'
import type { GenePin } from './genes/genePins'
import type {
  GraphLabel,
  NodeKinds,
  UnlabelledPlaceholders,
} from './graphLabels'
import type { Box, LabelCandidate, PlacedLabel } from './overlayLabels'
import type { PassLabelItem } from './passLabels'
import type { AlleleDeletion, NodeSegment } from './types'
import type { AxisScale } from './util/geometry'

export { HALO_FACTOR } from './halo'
export { LEGEND_INSET_PX } from './keyColumn'
const GENE_PIN_DROP_PX = 18
// a gene's name drops a row or two rather than vanish under a bubble's
const GENE_STACK = 2
// structural variants inside one array sit side by side at a zoom that shows
// the array, and each name is worth a row of its own
const BUBBLE_STACK = 3
// a chip's baseline this far down is the highest it sits whole in the pane
const TOPMOST_BASELINE = LABEL_PX + LABEL_PAD

export interface LabelLayoutSource {
  paneWidth: number
  canvasHeight: number
  axisScale: AxisScale
  translateX: number
  translateY: number
  contigThickness: number
  // the key's, whose column down the right edge no label enters
  legendSize: { width: number; height: number }
  // the band along the top a reference strip draws in
  referenceStripZonePx?: number
  drawnRowLabels: { label: string; y: number }[]
  bubbleHalos: BubbleHalo[]
  genePins: GenePin[]
  // the lifted walks' names, whose own copies of genes are named
  liftedWalks?: readonly string[]
  poppedFrom?: { label: string }
  nodePositions?: Record<string, NodeSegment[]>
  // false where the drawing is not the canvas's nodes (the tube map), so a
  // length label would sit on a box's tubes rather than beside a node
  labelsNodeSizes: boolean
  // the lengths written on the drawing: labelledNodeLengths
  nodeLengths: Map<string, number>
  // the drawn nodes by id, which says which are placeholders
  nodeById: NodeKinds | undefined
  alleleDeletions: AlleleDeletion[]
  positionsVersion: number
  // the names of lifted walks' passes: passLabelCandidates
  passLabels?: LabelCandidate<PassLabelItem>[]
  // RenderBatch.collapsed's nodes, which carry no label
  folded: ReadonlySet<string> | undefined
}

// where a small variant's tick stands, its foot just above its nodes
export interface BubbleTick {
  item: BubbleHalo
  x: number
  y: number
}

export interface LabelLayout {
  bubbles: PlacedLabel<BubbleHalo>[]
  ticks: BubbleTick[]
  genes: PlacedLabel<NamedGenePin>[]
  passes: PlacedLabel<PassLabelItem>[]
  sizes: GraphLabel[]
  // the placeholders on the pane left without a length, which the key counts
  unlabelled?: UnlabelledPlaceholders
}

// How much of a gene the drawing holds, when that is not all of it, in the
// unit of the gene's length: `35 of 132.8 kb`. On the reference that is the
// drawn backbone's share, on a haplotype's own contig its walk records' share
export function geneCoverageNote(pin: GenePin) {
  const length = pin.gene.end - pin.gene.start
  if (pin.covered >= 0.98) {
    return undefined
  }
  const [per, unit] =
    length >= 999_500
      ? [1_000_000, 'Mb']
      : length >= 1000
        ? [1000, 'kb']
        : [1, 'bp']
  const amount = (bp: number) => +(bp / per).toFixed(per === 1 ? 0 : 1)
  return `${amount(pin.covered * length)} of ${amount(length)} ${unit}`
}

function grown(box: Box, by: number) {
  return {
    x0: box.x0 - by,
    x1: box.x1 + by,
    y0: box.y0 - by,
    y1: box.y1 + by,
  }
}

// The name of each gene namedGenePins names under its pin, or above it where
// the gene's node runs on under the pin or the spots under it are taken, the
// longest gene first, with how much of the gene the drawing holds where it
// holds less than all. A name
// over another node reads as that node's, and over an exon outline hides it,
// so it moves: down or up a row, or sideways by up to half its width, its
// leader still running to the pin; it may cover the gene's own stretch of
// reference only where no exon is outlined. A gene is a landmark, so where
// every spot by its pin is taken it stacks at the nearest free one rather
// than be dropped.
export function geneLabelCandidates(
  pins: GenePin[],
  screen: (p: { x: number; y: number }) => { x: number; y: number },
  contigThickness: number,
  otherNodeUnder: (box: Box, own: (nodeId: string) => boolean) => boolean,
  liftedWalks: readonly string[] = [],
) {
  const ink = contigThickness / 2
  const rim = ink + EXON_RIM_PX
  const exons = pins.flatMap(pin =>
    pin.exonsByNode.flatMap(({ stretches }) =>
      stretches.flatMap(stretch =>
        stretch
          .slice(1)
          .map((b, i) => ({ a: screen(stretch[i]!), b: screen(b) })),
      ),
    ),
  )
  return byExtent(
    namedGenePins(pins, liftedWalks),
    ({ pin }) => pin.gene.end - pin.gene.start,
  ).map(named => {
    const { pin, name } = named
    const { x, y } = screen(pin.at)
    const note = geneCoverageNote(pin)
    const text = note ? `${name} · ${note}` : name
    return {
      item: named,
      x,
      y: y + contigThickness + GENE_PIN_DROP_PX,
      flipY: y - contigThickness - GENE_PIN_DROP_PX + LABEL_PX,
      text,
      fallback: note ? `${name} …` : undefined,
      stack: GENE_STACK,
      slide: labelWidth(text) / 2,
      nearest: { x, y },
      fits: (box: Box) =>
        !otherNodeUnder(grown(box, ink), id => pin.nodeIds.has(id)) &&
        !exons.some(({ a, b }) => segmentMeetsBox(a, b, grown(box, rim))),
    }
  })
}

// The line from a gene's name to the edge of its pin's node nearer the name,
// `pin` in screen px; it leans where the name slid sideways
export function geneLeader(
  label: { x: number; y: number },
  pin: { x: number; y: number },
  contigThickness: number,
) {
  return label.y > pin.y
    ? {
        x1: label.x,
        y1: label.y - LABEL_PX - 2,
        x2: pin.x,
        y2: pin.y + contigThickness / 2,
      }
    : {
        x1: label.x,
        y1: label.y + LABEL_PAD,
        x2: pin.x,
        y2: pin.y - contigThickness / 2,
      }
}

function byExtent<T>(items: T[], extent: (item: T) => number) {
  return [...items].sort((a, b) => extent(b) - extent(a))
}

// The order is what survives a crowd: a placeholder's length, which has no
// place but beside its loop and no other words saying how much sequence the
// loop stands in for; the bubble's name; the gene's, which slides and stacks
// clear; a lifted walk's pass's; and any other node's length last.
export function layoutLabels(m: LabelLayoutSource): LabelLayout {
  const { paneWidth: width, canvasHeight: height, translateX, translateY } = m
  const { scaleX, scaleY } = m.axisScale
  const frame = { width, height }
  const screen = (p: { x: number; y: number }) => ({
    x: p.x * scaleX + translateX,
    y: p.y * scaleY + translateY,
  })
  const reserved: Box[] = m.drawnRowLabels.map(({ label, y }) =>
    rowLabelBox(label, y * scaleY + translateY),
  )
  const stripPx = m.referenceStripZonePx ?? 0
  if (stripPx > 0) {
    reserved.push({ x0: 0, x1: width, y0: 0, y1: stripPx })
  }
  reserved.push(keyColumnBox(m))
  if (m.poppedFrom) {
    reserved.push({
      x0: 0,
      x1: 60 + m.poppedFrom.label.length * LABEL_CHAR_PX * 1.2,
      y0: 0,
      y1: 44,
    })
  }
  const take = occupancy(frame, reserved)
  const sizeCandidates =
    m.nodePositions && m.labelsNodeSizes
      ? sizeLabelCandidates({
          nodePositions: m.nodePositions,
          nodeLengths: m.nodeLengths,
          nodeById: m.nodeById,
          alleleDeletions: m.alleleDeletions,
          axis: m.axisScale,
          translateX,
          translateY,
          width,
          height,
        }).filter(c => !m.folded?.has(c.id))
      : []
  const ink = m.contigThickness / 2
  const otherNodeUnder = otherNodeUnderBox(
    m.nodePositions ?? {},
    { scaleX, scaleY, translateX, translateY },
    m.positionsVersion,
  )
  const budget = nodeLabelBudget(width, height)
  const placeholderSizes = placeSizeLabels(
    sizeCandidates.filter(c => c.kept),
    take,
    {
      leaders: budget,
      clear: (box, id) =>
        !otherNodeUnder(grown(box, ink), under => under === id),
    },
  )

  // On a row layout a bubble's name goes in the band above the top row, which
  // is the reference it varies, and stays at the pane's top edge once that row
  // scrolls out. Above its own nodes, a lower row's allele would put it on the
  // reference line.
  const onRows = m.drawnRowLabels.length > 0
  const rowsTop = onRows
    ? m.drawnRowLabels.reduce((least, r) => Math.min(least, r.y), Infinity)
    : Infinity
  const halo = m.contigThickness * HALO_FACTOR
  const above = (h: BubbleHalo, gap: number) => {
    const { x, y } = screen({
      x: h.labelAt.x,
      y: Math.min(h.labelAt.y, rowsTop),
    })
    const baseline = y - halo / 2 - gap
    return { x, y: onRows ? Math.max(baseline, TOPMOST_BASELINE) : baseline }
  }
  // the drawing's own name last: it says where the reader is, the others
  // what to open next
  const byBubble = byExtent(
    m.bubbleHalos.filter(h => !h.tick),
    h => (h.whole ? -1 : h.members),
  )
  const bubbles = placeLabels(
    byBubble.map(h => ({
      item: h,
      ...above(h, 6),
      text: h.label,
      // `0 bp–11 kb superbubble` where `…, 1198 segments, 5 routes` does not fit
      fallback: h.label.includes(',') ? h.label.split(',')[0] : undefined,
      stack: BUBBLE_STACK,
    })),
    frame,
    take,
    reserved,
  )
  const ticks = m.bubbleHalos
    .filter(h => h.tick)
    .map(h => ({ item: h, ...above(h, 2) }))
    .filter(t => t.x >= 0 && t.x <= width && t.y >= 0 && t.y <= height)

  const genes = placeLabels(
    geneLabelCandidates(
      m.genePins,
      screen,
      m.contigThickness,
      otherNodeUnder,
      m.liftedWalks,
    ),
    frame,
    take,
    reserved,
  )
  const passes = placeLabels(m.passLabels ?? [], frame, take, reserved)
  const sizes = [
    ...placeholderSizes,
    ...placeSizeLabels(
      sizeCandidates.filter(c => !c.kept),
      take,
      { budget, placed: placeholderSizes.length },
    ),
  ]
  return {
    bubbles,
    ticks,
    genes,
    passes,
    sizes,
    unlabelled: unlabelledPlaceholders(
      sizeCandidates,
      placeholderSizes,
      m.nodeLengths,
    ),
  }
}
