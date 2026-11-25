import { inkUnderBox, piecesUnderBox, widestStroke } from './drawnInk'
import { EXON_RIM_PX } from './genes/exonOutline'
import { namedGenePins } from './genes/geneNames'
import {
  loopLabelCandidates,
  nodeLabelBudget,
  placeSizeLabels,
  rowLabelBox,
  sizeLabelCandidates,
  unlabelledPlaceholders,
  walkLoops,
} from './graphLabels'
import { HALO_FACTOR } from './halo'
import { keyColumnBox } from './keyColumn'
import { polylineSlice } from './layout/mergeRuns'
import { referencePxPerBpAt } from './levelOfDetail'
import {
  LABEL_CHAR_PX,
  LABEL_PAD,
  LABEL_PX,
  grown,
  labelWidth,
  occupancy,
  placeLabels,
} from './overlayLabels'
import { otherNodeUnderBox, segmentInBox } from './util/hitDetection'

import type { BubbleHalo } from './bubbles/bubbleHalos'
import type { Frame, InkBatch, Piece } from './drawnInk'
import type { NamedGenePin } from './genes/geneNames'
import type { GenePin } from './genes/genePins'
import type {
  GraphLabel,
  LengthInk,
  NodeKinds,
  UnlabelledPlaceholders,
} from './graphLabels'
import type { Box, LabelCandidate, PlacedLabel } from './overlayLabels'
import type { PassLabelItem } from './passLabels'
import type { AlleleDeletion, Graph, NodeSegment } from './types'
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
  // the shares written after them: labelledNodeShares' texts
  nodeShares?: ReadonlyMap<string, string>
  // the drawn nodes by id, which says which are placeholders
  nodeById: NodeKinds | undefined
  // the graph whose walks' loops write their lengths
  graph: Pick<Graph, 'nodes' | 'paths' | 'edges'> | undefined
  // what the pane paints, which a length keeps off, read only where a length
  // asks; none writes no loop's length, and keeps other lengths off the
  // nodes at the contig thickness
  drawnInk: InkBatch | undefined
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

function amountOf(bp: number) {
  const [per, unit] =
    bp >= 999_500 ? [1_000_000, 'Mb'] : bp >= 999.5 ? [1000, 'kb'] : [1, 'bp']
  return { value: +(bp / per).toFixed(per === 1 ? 0 : 1), unit }
}

// How much of a gene the drawing holds, when that is not all of it, each
// amount in its own unit and a unit they share said once: `35 of 132.8 kb`,
// `8.2 kb of 1.4 Mb`. None where the two read the same. On the reference that
// is the drawn backbone's share, on a haplotype's own contig its walk
// records' share
export function geneCoverageNote(pin: GenePin) {
  const length = pin.gene.end - pin.gene.start
  const held = amountOf(pin.covered * length)
  const whole = amountOf(length)
  return pin.covered >= 0.98 ||
    (held.value === whole.value && held.unit === whole.unit)
    ? undefined
    : held.unit === whole.unit
      ? `${held.value} of ${whole.value} ${whole.unit}`
      : `${held.value} ${held.unit} of ${whole.value} ${whole.unit}`
}

type Screen = (p: { x: number; y: number }) => { x: number; y: number }

// The point of a gene's drawn stretch inside `shown`, a box in pane px,
// nearest `at` in pane px, in layout units
function nearestShownPoint(
  pin: GenePin,
  positions: Record<string, NodeSegment[]>,
  screen: Screen,
  shown: Box,
  at: { x: number; y: number },
) {
  let best: { point: NodeSegment; distance: number } | undefined
  for (const { nodeId, from, to } of pin.body) {
    const line = polylineSlice(positions[nodeId] ?? [], from, to)
    const points = line.length === 1 ? [line[0]!, line[0]!] : line
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      const sa = screen(a)
      const sb = screen(b)
      const inside = segmentInBox(sa, sb, shown)
      if (inside) {
        const dx = sb.x - sa.x
        const dy = sb.y - sa.y
        const length2 = dx * dx + dy * dy
        const toward =
          length2 > 0
            ? ((at.x - sa.x) * dx + (at.y - sa.y) * dy) / length2
            : inside[0]
        const t = Math.min(inside[1], Math.max(inside[0], toward))
        const distance = Math.hypot(sa.x + t * dx - at.x, sa.y + t * dy - at.y)
        if (!best || distance < best.distance) {
          best = {
            point: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) },
            distance,
          }
        }
      }
    }
  }
  return best?.point
}

// Where a gene's name is pinned on a pane that shows `shown`, a box in pane
// px: at its pin where the pane shows that, else at the point of the gene's
// drawn stretch the pane shows nearest it; nowhere where the pane shows none
// of the gene, as where the cut runs past the view or under the key
function shownPin(
  pin: GenePin,
  positions: Record<string, NodeSegment[]>,
  screen: Screen,
  shown: Box,
) {
  const at = screen(pin.at)
  return at.x >= shown.x0 &&
    at.x <= shown.x1 &&
    at.y >= shown.y0 &&
    at.y <= shown.y1
    ? pin.at
    : nearestShownPoint(pin, positions, screen, shown, at)
}

// Exon outlines crowd a zoomed-out reference line, so they are held in cells
// fine enough that a name a row off the line meets none of them
const EXON_CELL_PX = 8

// Each exon outline's stretches as pieces on screen, reaching `reach` past
// their centreline
function exonPieces(
  pins: GenePin[],
  screen: Screen,
  reach: (nodeId: string) => number,
  shows: (nodeId: string) => boolean = () => true,
): Piece[] {
  return pins.flatMap(pin =>
    pin.exonsByNode
      .filter(({ nodeId }) => shows(nodeId))
      .flatMap(({ nodeId, stretches }) => {
        const halfWidth = reach(nodeId)
        return stretches.flatMap(stretch => {
          const points = stretch.map(screen)
          return points.slice(1).map((b, k) => ({
            a: points[k]!,
            b,
            halfWidth,
            exon: nodeId,
          }))
        })
      }),
  )
}

// The name of each gene namedGenePins names under its pin, or above it where
// the gene's node runs on under the pin or the spots under it are taken, the
// longest gene first, with how much of the gene the drawing holds where it
// holds less than all. A name
// over another node reads as that node's, and over an exon outline hides it,
// so it moves: down or up a row, or sideways by up to half its width, its
// leader still running to the pin; it may cover the gene's own stretch of
// reference only where no exon is outlined. A gene is a landmark, so where
// nodes, exons or the key refuse every spot by its pin it stacks at the
// nearest free one rather than be dropped; where other names took them it
// does so only while the pane's ration of names standing apart lasts, which
// thins a dense track and names every gene of a sparse one. A gene whose pin the pane does not show is pinned where
// shownPin finds it, and one the pane shows nothing of is not named.
export function geneLabelCandidates(
  pins: GenePin[],
  screen: Screen,
  contigThickness: number,
  otherNodeUnder: (box: Box, own: (nodeId: string) => boolean) => boolean,
  shown: { box: Box; positions: Record<string, NodeSegment[]> },
  liftedWalks: readonly string[] = [],
) {
  const ink = contigThickness / 2
  const rim = ink + EXON_RIM_PX
  const exonUnder = piecesUnderBox(
    exonPieces(pins, screen, () => rim),
    shown.box,
    EXON_CELL_PX,
  )
  return byExtent(
    namedGenePins(pins, liftedWalks).flatMap(named => {
      const at = shownPin(named.pin, shown.positions, screen, shown.box)
      return !at
        ? []
        : at === named.pin.at
          ? [named]
          : [{ ...named, pin: { ...named.pin, at } }]
    }),
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
        !exonUnder(box, () => false),
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

function once<T>(make: () => T) {
  let made: { value: T } | undefined
  return () => (made ??= { value: make() }).value
}

// The ink a length reads: the strokes the batch paints, else the nodes at
// half the contig thickness, and the exon outlines round them, each reaching
// EXON_RIM_PX past its node's ink; the index built the first time a length
// asks
function lengthInk(
  batch: () => InkBatch | undefined,
  frame: Frame,
  screen: Screen,
  m: Pick<LabelLayoutSource, 'genePins' | 'folded' | 'contigThickness'>,
  otherNodeUnder: (box: Box, own: (nodeId: string) => boolean) => boolean,
): LengthInk {
  const ink = m.contigThickness / 2
  const strokes = once(() => {
    const drawn = batch()
    return drawn ? inkUnderBox(drawn, frame) : undefined
  })
  const widest = (nodes: readonly string[]) => {
    const drawn = batch()
    return drawn ? widestStroke(drawn, nodes) : ink
  }
  const exonUnder = once(() =>
    piecesUnderBox(
      exonPieces(
        m.genePins,
        screen,
        nodeId => widest([nodeId]) + EXON_RIM_PX,
        nodeId => !m.folded?.has(nodeId),
      ),
      { x0: 0, x1: frame.width, y0: 0, y1: frame.height },
      EXON_CELL_PX,
    ),
  )
  return {
    under: (box, own) => {
      const under = strokes()
      return (
        (under
          ? under(box, own)
          : otherNodeUnder(grown(box, ink), node => own({ node }))) ||
        exonUnder()(box, own)
      )
    },
    widest,
  }
}

function byExtent<T>(items: T[], extent: (item: T) => number) {
  return [...items].sort((a, b) => extent(b) - extent(a))
}

// The order is what survives a crowd: a placeholder's length, which has no
// place but beside its loop and no other words saying how much sequence the
// loop stands in for; a loaded loop's; the bubble's name; the gene's, which slides and stacks
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
  const keyColumn = keyColumnBox(m)
  reserved.push(keyColumn)
  if (m.poppedFrom) {
    reserved.push({
      x0: 0,
      x1: 60 + m.poppedFrom.label.length * LABEL_CHAR_PX * 1.2,
      y0: 0,
      y1: 44,
    })
  }
  const take = occupancy(frame, reserved)
  const pxPerBp =
    m.nodePositions && m.graph
      ? referencePxPerBpAt(
          m.graph.nodes,
          m.nodePositions,
          m.axisScale,
          m.positionsVersion,
        )
      : 0
  const sizeCandidates =
    m.nodePositions && m.labelsNodeSizes
      ? sizeLabelCandidates({
          nodePositions: m.nodePositions,
          nodeLengths: m.nodeLengths,
          nodeShares: m.nodeShares,
          nodeById: m.nodeById,
          alleleDeletions: m.alleleDeletions,
          pxPerBp,
          axis: m.axisScale,
          translateX,
          translateY,
          width,
          height,
        }).filter(c => !m.folded?.has(c.id))
      : []
  const anyNodeUnder = otherNodeUnderBox(
    m.nodePositions ?? {},
    { scaleX, scaleY, translateX, translateY },
    m.positionsVersion,
  )
  const otherNodeUnder = (box: Box, own: (nodeId: string) => boolean) =>
    anyNodeUnder(box, under => own(under) || !!m.folded?.has(under))
  const budget = nodeLabelBudget(width, height)
  const batch = once(() => m.drawnInk)
  const lengths = lengthInk(
    batch,
    { ...frame, translateX, translateY, scaleX, scaleY },
    screen,
    m,
    otherNodeUnder,
  )
  const placeholderSizes = placeSizeLabels(
    sizeCandidates.filter(c => c.kept),
    take,
    { leaders: budget, under: lengths.under },
  )
  const loops =
    m.nodePositions && m.labelsNodeSizes && m.graph ? walkLoops(m.graph) : []
  const loopSizes =
    m.nodePositions && m.graph && loops.length > 0 && batch()
      ? placeSizeLabels(
          loopLabelCandidates({
            loops,
            edges: m.graph.edges,
            nodePositions: m.nodePositions,
            nodeShares: m.nodeShares,
            folded: m.folded,
            pxPerBp,
            ink: lengths,
            axis: m.axisScale,
            translateX,
            translateY,
            width,
            height,
          }),
          take,
          { placed: placeholderSizes, leaders: budget, under: lengths.under },
        )
      : []
  const lengthsPlaced = [...placeholderSizes, ...loopSizes]

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
      {
        box: { x0: 0, x1: keyColumn.x0, y0: stripPx, y1: height },
        positions: m.nodePositions ?? {},
      },
      m.liftedWalks,
    ),
    frame,
    take,
    reserved,
    budget,
  )
  const passes = placeLabels(m.passLabels ?? [], frame, take, reserved)
  const sizes = [
    ...lengthsPlaced,
    ...placeSizeLabels(
      sizeCandidates.filter(c => !c.kept),
      take,
      { budget, placed: lengthsPlaced, leaders: budget, under: lengths.under },
    ),
  ].map(({ label }) => label)
  return {
    bubbles,
    ticks,
    genes,
    passes,
    sizes,
    unlabelled: unlabelledPlaceholders(sizeCandidates, sizes, m.nodeLengths),
  }
}
