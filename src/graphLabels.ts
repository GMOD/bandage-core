import { polylinePointAt } from './layout/mergeRuns'
import { labelWidth, occupancy } from './overlayLabels'
import { polylinePx } from './util/geometry'
import { weakMemo } from './util/weakMemo'

import type { Box, TakeBox } from './overlayLabels'
import type { AlleleDeletion, GraphNode, NodeSegment } from './types'
import type { AxisScale } from './util/geometry'

// What to write on the drawing, and where. Bandage labels a node with its name,
// its length or its depth; a segment id means nothing to a reader of a pangenome
// ("s462766"), so the label here is a node's length. A link says nothing in
// words: what a walk skips is drawn, not written, so no label names an event
// against the reference or a net size.
//
// **Two rules decide which labels there are, and both are about the drawing
// rather than about a threshold on the graph.**
//
// A label has to fit the node it names, within a factor of two: past that it is
// a label with a node attached rather than a node with a label. The rule used to
// be a flat minimum drawn length (46 screen px) regardless of how long the text
// was, which reads as arbitrary from the outside — review asked why some nodes
// state a length and others do not, and nothing in the picture could answer it.
// Measured against the text, the answer is in the picture: the node is shorter
// than the words.
//
// And a label is dropped when its box would overlap one already placed. Labels
// go biggest-sequence-first, so what survives a crowd is the allele that
// matters; this is also what fixes labels printing on top of each other ("−10
// kb3.2 kb" in the amylase figure). A placeholder's length is the exception:
// it goes before every other, outside the budget, and where its loop's middle
// is taken it tries further along the loop, then stacks beside the nearest
// spot with a leader to it, as a gene's name stacks off its pin, since nothing
// else on the drawing says how much sequence the loop stands in for.
//
// Between them they hold at both ends of the scale a pangenome graph spans: 63
// kb-scale nodes at the amylase locus nearly all carry a length, and a 154-node
// base-level pggb graph of 1-100 bp segments carries almost none — where every
// label would have said "1 bp" and covered the segment it named.
//
// Collision is measured in SCREEN pixels, because that is where the text has its
// size: the same two labels clear each other zoomed in and collide zoomed out,
// so a wide view sheds labels on its own. A node's length is written only
// where a host turns lengths on (LABEL_DEFAULTS.nodeLengths), but a
// placeholder's always is: nothing else says how much sequence the steps it
// stands in for hold.

export const LABEL_DEFAULTS = { nodeLengths: false }

export function labelledNodeLengths(
  nodes: readonly GraphNode[],
  nodeLengths = LABEL_DEFAULTS.nodeLengths,
) {
  const lengths = new Map<string, number>()
  for (const node of nodes) {
    if (nodeLengths || node.placeholder) {
      lengths.set(node.id, node.length)
    }
  }
  return lengths
}

// One node label per this much pane, and never fewer than a handful: at a
// 1400 by 600 pane that is about twenty.
const PX_PER_NODE_LABEL = 40_000
const MIN_NODE_LABELS = 8

// The label's own box, for collision. Mirrors GraphCanvas's nodeLabelStyle:
// 10px text in 3px of horizontal padding, on a 13px line. Character width is an
// average rather than a measurement — placement runs on every pan and zoom, and
// a canvas text metric per candidate costs more than the occasional
// half-character of slack is worth.
const LABEL_CHAR_PX = 5.7
const LABEL_PAD_PX = 6
const LABEL_HEIGHT_PX = 13
// Breathing room, so two labels that merely touch still read as two.
const LABEL_GAP_PX = 3
// How much wider than its node a label may be before it is the label that is
// being drawn rather than the node.
const MAX_LABEL_OVERHANG = 2

// Half the box a piece of label text occupies, wanted before there is anywhere
// to put the box: the node pass rejects on size before it has a position.
function labelHalfWidth(text: string) {
  return (text.length * LABEL_CHAR_PX + LABEL_PAD_PX + LABEL_GAP_PX) / 2
}

// Constant whatever the label says, so a candidate's vertical cull costs
// nothing and can be taken before its text exists.
const LABEL_HALF_HEIGHT = (LABEL_HEIGHT_PX + LABEL_GAP_PX) / 2

// The narrowest box `formatBp` can ask for, `1 bp`. A node drawn shorter than
// this cannot carry ANY label, so the check happens before the length is
// formatted: on a 7,499-node cut nearly every node fails it, and building a
// string and a box per node only to discard both was most of this pass
// (measured 37 ms per frame, and this pass runs on every pan).
const MIN_LABEL_HALF_WIDTH = labelHalfWidth('1 bp')

// translate(-50%, -50%) in the style, so the anchor is the box's centre.
function boxAt(halfW: number, x: number, y: number): Box {
  return {
    x0: x - halfW,
    x1: x + halfW,
    y0: y - LABEL_HALF_HEIGHT,
    y1: y + LABEL_HALF_HEIGHT,
  }
}

// The box a row label occupies, from the metrics RowLabels renders with: 11px
// text, 4px of horizontal padding and a 16px line centred on its row
export function rowLabelBox(text: string, screenY: number): Box {
  return {
    x0: 6,
    x1: 6 + labelWidth(text) + LABEL_GAP_PX,
    y0: screenY - 8 - LABEL_GAP_PX / 2,
    y1: screenY + 8 + LABEL_GAP_PX / 2,
  }
}

export interface GraphLabel {
  key: string
  text: string
  // screen pixels, already through the transform the canvas draws with: the
  // collision test needs them anyway, and returning layout units would have the
  // caller redo the arithmetic that decided which labels there are
  x: number
  y: number
  // the point on its loop a placeholder's length stacked off the loop names,
  // which a leader joins it to
  leader?: { x: number; y: number }
}

// Locale-independent, unlike toLocaleString: a figure regenerated on a machine
// with a different locale would otherwise differ from the committed one.
export function groupDigits(n: number) {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ',')
}

// bp in the unit that reads. Deliberately coarse: a label is a glance, and
// "12,345 bp" costs twice the width of "12 kb" to say the same thing at the
// scale a pangenome allele lives at.
export function formatBp(bp: number) {
  const [value, unit] =
    bp >= 999_500 ? [bp / 1_000_000, 'Mb'] : bp >= 1000 ? [bp / 1000, 'kb'] : []
  if (value === undefined) {
    return `${bp} bp`
  }
  return `${+value.toFixed(value >= 100 ? 0 : 1)} ${unit}`
}

// The label pass reruns on every pan, because the labels are placed in screen
// space, while the order nodes are considered in depends only on the layout:
// the cache keys weakly on the positions.

// Node label candidates in the order they are considered, placeholders first
// and the biggest allele first among each, which depends on the sequence
// lengths alone.
const nodeOrderCache = weakMemo<
  Record<string, NodeSegment[]>,
  { id: string; segments: NodeSegment[]; kept: boolean }[]
>()

function labelOrder(
  nodePositions: Record<string, NodeSegment[]>,
  nodeLengths: Map<string, number>,
  nodeById: NodeKinds | undefined,
) {
  return nodeOrderCache(nodePositions, [nodeLengths, nodeById], () =>
    Object.entries(nodePositions)
      .filter(([id, segments]) => segments.length > 0 && nodeLengths.has(id))
      .map(([id, segments]) => ({
        id,
        segments,
        kept: nodeById?.get(id)?.placeholder === true,
      }))
      .sort((a, b) =>
        a.kept === b.kept
          ? nodeLengths.get(b.id)! - nodeLengths.get(a.id)!
          : a.kept
            ? -1
            : 1,
      ),
  )
}

// Where along its loop a placeholder's length may stand, nearest the middle
// first
const KEPT_LABEL_SPOTS = [0.5, 0.375, 0.625, 0.25, 0.75, 0.125, 0.875]

export type NodeKinds = ReadonlyMap<string, Pick<GraphNode, 'placeholder'>>

interface SizeLabelArgs {
  nodePositions: Record<string, NodeSegment[]>
  // bp per node id
  nodeLengths: Map<string, number>
  // which nodes are placeholders, whose lengths are kept
  nodeById?: NodeKinds
  // Alleles the layout drew over the reference they replace: their nodes
  // keep their lengths off the drawing, since a length written across a bar
  // drawn wider than it reads as the bar's size. See AlleleDeletion.
  alleleDeletions?: AlleleDeletion[]
  // Screen px per layout unit, both axes. They are equal on an isotropic layout
  // and differ on a row layout, whose y is already px (scaleY === 1). One value
  // so a caller cannot pass one and default the other — see AxisScale.
  axis: AxisScale
  translateX: number
  translateY: number
  width: number
  height: number
}

export interface SizeLabelCandidate {
  id: string
  label: GraphLabel
  box: Box
  // a placeholder's length, placed before the rest and outside the budget,
  // at the first of its spots free
  kept: boolean
  // further spots along a placeholder's loop, tried in order where the
  // first is taken
  further: { label: GraphLabel; box: Box }[]
  // a placeholder's spots stacked off its loop, tried where every spot along
  // it is taken; built only then
  stacked?: () => { label: GraphLabel; box: Box }[]
}

// A label's spots stacked off `spots`, nearest a spot first and the spot
// nearer the loop's middle where two are as near: a row at a time up and
// down, slid sideways up to half the label, to the pane's edges `height`
// tall, each with a leader to its spot
function stackedSpots(
  label: GraphLabel,
  halfW: number,
  spots: { x: number; y: number }[],
  height: number,
) {
  const row = 2 * LABEL_HALF_HEIGHT
  const rows = Math.ceil(height / row)
  const slides = [0]
  for (let d = STACK_SLIDE_PX; d <= halfW; d += STACK_SLIDE_PX) {
    slides.push(-d, d)
  }
  return spots
    .flatMap((spot, order) =>
      Array.from({ length: rows }, (_, k) => k + 1).flatMap(k =>
        [1, -1].flatMap(direction =>
          slides.map(dx => ({
            spot,
            order,
            x: spot.x + dx,
            y: spot.y + direction * k * row,
            distance: Math.hypot(dx, k * row),
          })),
        ),
      ),
    )
    .sort((a, b) => a.distance - b.distance || a.order - b.order)
    .map(({ spot, x, y }) => ({
      label: { ...label, x, y, leader: spot },
      box: boxAt(halfW, x, y),
    }))
}

const STACK_SLIDE_PX = 8

// The line from a stacked placeholder length's box to the point on its loop
// it names, from the box's edge nearer the loop
export function sizeLeader({ x, y, leader }: GraphLabel) {
  return leader
    ? {
        x1: x,
        y1: leader.y > y ? y + LABEL_HEIGHT_PX / 2 : y - LABEL_HEIGHT_PX / 2,
        x2: leader.x,
        y2: leader.y,
      }
    : undefined
}

export function sizeLabelCandidates({
  nodePositions,
  nodeLengths,
  nodeById,
  alleleDeletions,
  axis,
  translateX,
  translateY,
  height,
}: SizeLabelArgs) {
  const { scaleX, scaleY } = axis
  const barred = new Set(alleleDeletions?.flatMap(run => run.nodeIds))
  const candidates: SizeLabelCandidate[] = []
  const onPane = (screenY: number) =>
    screenY + LABEL_HALF_HEIGHT > 0 && screenY - LABEL_HALF_HEIGHT < height
  // Placeholders first, then the biggest allele: in a crowd, the label that
  // survives should be the one carrying the most sequence, not whichever node
  // the layout happened to emit first. The order is `labelOrder`'s, cached
  // across frames; the rejects below are what a frame actually decides,
  // cheapest first — a node barred by an allele deletion, then one with no
  // spot on the pane (the box's height is a constant, so this needs no text),
  // then one too short to hold the shortest label there is.
  for (const { id, segments, kept } of labelOrder(
    nodePositions,
    nodeLengths,
    nodeById,
  )) {
    const spots = barred.has(id)
      ? []
      : (kept ? KEPT_LABEL_SPOTS : [0.5])
          .map(fraction => {
            const { x, y } = polylinePointAt(segments, fraction)
            return { x: x * scaleX + translateX, y: y * scaleY + translateY }
          })
          .filter(spot => onPane(spot.y))
    const drawn = spots.length > 0 ? polylinePx(segments, scaleX, scaleY) : 0
    // The same comparison the real fit test makes, against the narrowest box
    // any label can have — so nothing that would have passed is rejected here.
    if (drawn >= (MIN_LABEL_HALF_WIDTH * 2) / MAX_LABEL_OVERHANG) {
      const text = formatBp(nodeLengths.get(id)!)
      const halfW = labelHalfWidth(text)
      const [first, ...further] =
        drawn >= (halfW * 2) / MAX_LABEL_OVERHANG
          ? spots.map(({ x, y }) => ({
              label: { key: `node:${id}`, text, x, y },
              box: boxAt(halfW, x, y),
            }))
          : []
      if (first) {
        candidates.push({
          ...first,
          id,
          kept,
          further,
          stacked: kept
            ? () => stackedSpots(first.label, halfW, spots, height)
            : undefined,
        })
      }
    }
  }

  return candidates
}

// Node labels are rationed to the pane's area: a base-level cut of hundreds of
// short nodes fits a length on most of them at a moderate zoom, and a drawing
// where every node states its length is a table with a graph under it. Biggest
// first, so the ration goes to the alleles that carry sequence; zooming in
// gives more area to fewer nodes and the labels come back.
export function nodeLabelBudget(width: number, height: number) {
  return Math.max(
    MIN_NODE_LABELS,
    Math.floor((width * height) / PX_PER_NODE_LABEL),
  )
}

// Each candidate at its first free spot while the budget lasts, a
// placeholder's whatever the budget, as `placed` labels already spent it.
// Where no spot along a placeholder's loop is free, its length stacks off the
// loop, clear of every other node's ink where `clear` finds a spot that is,
// since a length over another node reads as that node's; else at the nearest
// free spot.
export function placeSizeLabels(
  candidates: SizeLabelCandidate[],
  take: TakeBox,
  budget = Infinity,
  placed = 0,
  clear: (box: Box, id: string) => boolean = () => true,
) {
  const labels: GraphLabel[] = []
  for (const candidate of candidates) {
    if (candidate.kept || placed + labels.length < budget) {
      const along = [candidate, ...candidate.further].find(s => take(s.box))
      const stacked = along ? undefined : candidate.stacked?.()
      const spot =
        along ??
        stacked?.find(s => clear(s.box, candidate.id) && take(s.box)) ??
        stacked?.find(s => take(s.box))
      if (spot) {
        labels.push(spot.label)
      }
    }
  }
  return labels
}

// Node labels, each placed where `take` finds room. By default `take` finds it
// on the pane outside the `reserved` boxes.
export function graphLabels({
  reserved,
  take,
  ...args
}: SizeLabelArgs & { reserved?: Box[]; take?: TakeBox }): GraphLabel[] {
  take ??= occupancy(args, reserved)
  return placeSizeLabels(
    sizeLabelCandidates(args),
    take,
    nodeLabelBudget(args.width, args.height),
  )
}
