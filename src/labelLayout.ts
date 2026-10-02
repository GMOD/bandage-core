import {
  nodeLabelBudget,
  placeSizeLabels,
  rowLabelBox,
  sizeLabelCandidates,
} from './graphLabels'
import {
  LABEL_CHAR_PX,
  LABEL_PAD,
  LABEL_PX,
  occupancy,
  placeLabels,
} from './overlayLabels'

import type { BubbleHalo, RouteLabel } from './bubbles/bubbleHalos'
import type { DeletionEdge } from './deletionEdges'
import type { GenePin } from './genes/genePins'
import type { GraphLabel } from './graphLabels'
import type { DeletionRoutes } from './layout/deletionRoutes'
import type { Box, PlacedLabel } from './overlayLabels'
import type { AlleleDeletion, NodeSegment } from './types'
import type { AxisScale } from './util/geometry'

export const HALO_FACTOR = 3.4
export const LEGEND_INSET_PX = 6
// routes whose own stretches are drawn on top of each other stack their chips
const ROUTE_STACK = 8
const GENE_PIN_DROP_PX = 18
// a gene's name drops a row or two rather than vanish under a bubble's
const GENE_STACK = 2
// a chip's baseline this far down is the highest it sits whole in the pane
const TOPMOST_BASELINE = LABEL_PX + LABEL_PAD

export interface LabelLayoutSource {
  paneWidth: number
  canvasHeight: number
  axisScale: AxisScale
  translateX: number
  translateY: number
  contigThickness: number
  legendSize: { width: number; height: number }
  // the band along the top a reference strip draws in
  referenceStripZonePx?: number
  drawnRowLabels: { label: string; y: number }[]
  bubbleHalos: BubbleHalo[]
  genePins: GenePin[]
  poppedFrom?: { label: string }
  nodePositions?: Record<string, NodeSegment[]>
  // false where the drawing is not the canvas's nodes (the tube map), so a
  // length label would sit on a box's tubes rather than beside a node
  labelsNodeSizes: boolean
  nodeLengths: Map<string, number>
  showDeletionEdges: boolean
  deletions: DeletionEdge[]
  deletionRoutes?: DeletionRoutes
  alleleDeletions: AlleleDeletion[]
  positionsVersion: number
}

export interface LabelLayout {
  bubbles: PlacedLabel<BubbleHalo>[]
  genes: PlacedLabel<GenePin>[]
  routes: PlacedLabel<{ halo: BubbleHalo; route: RouteLabel }>[]
  sizes: GraphLabel[]
}

// How much of a gene the cut's backbone carries, when that is not all of it,
// in the unit of the gene's length: `35 of 132.8 kb`
export function geneCoverageNote(pin: GenePin) {
  const length = pin.gene.end - pin.gene.start
  if (pin.covered >= 0.98) {
    return undefined
  }
  const [per, unit] =
    length >= 1_000_000
      ? [1_000_000, 'Mb']
      : length >= 1000
        ? [1000, 'kb']
        : [1, 'bp']
  const amount = (bp: number) => +(bp / per).toFixed(per === 1 ? 0 : 1)
  return `${amount(pin.covered * length)} of ${amount(length)} ${unit}`
}

// Each gene's name under its pin, the longest gene first, with how much of
// it the cut carries where that is not all of it
export function geneLabelCandidates(
  pins: GenePin[],
  screen: (p: { x: number; y: number }) => { x: number; y: number },
  contigThickness: number,
) {
  return byExtent(pins, pin => pin.gene.end - pin.gene.start).map(pin => {
    const { x, y } = screen(pin.at)
    const note = geneCoverageNote(pin)
    return {
      item: pin,
      x,
      y: y + contigThickness + GENE_PIN_DROP_PX,
      text: note ? `${pin.gene.name} · ${note}` : pin.gene.name,
      fallback: note ? `${pin.gene.name} …` : undefined,
      stack: GENE_STACK,
    }
  })
}

function byExtent<T>(items: T[], extent: (item: T) => number) {
  return [...items].sort((a, b) => extent(b) - extent(a))
}

// The order is what survives a crowd: the bubble's name, then the gene's, then
// what a deletion skips, then who takes each route, and a node's length last.
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
  if (m.legendSize.width > 0) {
    reserved.push({
      x0: width - LEGEND_INSET_PX - m.legendSize.width,
      x1: width,
      y0: 0,
      y1: stripPx + LEGEND_INSET_PX + m.legendSize.height,
    })
  }
  if (m.poppedFrom) {
    reserved.push({
      x0: 0,
      x1: 60 + m.poppedFrom.label.length * LABEL_CHAR_PX * 1.2,
      y0: 0,
      y1: 44,
    })
  }
  const take = occupancy(frame, reserved)

  // On a row layout a bubble's name goes in the band above the top row, which
  // is the reference it varies, and stays at the pane's top edge once that row
  // scrolls out. Above its own nodes, a lower row's allele would put it on the
  // reference line.
  const onRows = m.drawnRowLabels.length > 0
  const rowsTop = onRows
    ? Math.min(...m.drawnRowLabels.map(r => r.y))
    : Infinity
  const halo = m.contigThickness * HALO_FACTOR
  const byBubble = byExtent(m.bubbleHalos, h => h.members)
  const bubbles = placeLabels(
    byBubble.map(h => {
      const { x, y } = screen({
        x: h.labelAt.x,
        y: Math.min(h.labelAt.y, rowsTop),
      })
      const baseline = y - halo / 2 - 6
      return {
        item: h,
        x,
        y: onRows ? Math.max(baseline, TOPMOST_BASELINE) : baseline,
        text: h.label,
      }
    }),
    frame,
    take,
  )

  const genes = placeLabels(
    geneLabelCandidates(m.genePins, screen, m.contigThickness),
    frame,
    take,
  )
  const sizeCandidates =
    m.nodePositions && m.labelsNodeSizes
      ? sizeLabelCandidates({
          nodePositions: m.nodePositions,
          nodeLengths: m.nodeLengths,
          deletions: m.showDeletionEdges ? m.deletions : [],
          deletionRoutes: m.deletionRoutes,
          alleleDeletions: m.alleleDeletions,
          axis: m.axisScale,
          translateX,
          translateY,
          width,
          height,
          version: m.positionsVersion,
        })
      : { deletions: [], nodes: [] }
  const deletionLabels = placeSizeLabels(sizeCandidates.deletions, take)
  const routes = placeLabels(
    byBubble.flatMap(h =>
      h.routes.map(route => {
        const { x, y } = screen(route.at)
        return {
          item: { halo: h, route },
          x,
          y: y + 4,
          text: route.text,
          stack: ROUTE_STACK,
        }
      }),
    ),
    frame,
    take,
  )
  const nodeLabels = placeSizeLabels(
    sizeCandidates.nodes,
    take,
    nodeLabelBudget(width, height),
  )
  return {
    bubbles,
    genes,
    routes,
    sizes: [...deletionLabels, ...nodeLabels],
  }
}
