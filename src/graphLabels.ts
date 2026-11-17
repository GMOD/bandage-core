import { isBackbone } from './anchoredNodes'
import { polylinePointAt } from './layout/mergeRuns'
import { labelWidth, occupancy } from './overlayLabels'
import { compareIds } from './util/canonicalOrder'
import { polylinePx } from './util/geometry'
import { pushTo } from './util/groups'
import { weakMemo } from './util/weakMemo'

import type { Box, TakeBox } from './overlayLabels'
import type { AlleleDeletion, Graph, GraphNode, NodeSegment } from './types'
import type { AxisScale } from './util/geometry'

interface Point {
  x: number
  y: number
}

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
// is taken it tries further along the loop, then stacks off the loop's middle
// with a leader to it, as a gene's name stacks off its pin, as it does where
// the loop is too short to hold it, since nothing else on the drawing says how
// much sequence the loop stands in for. Loops on one spot share one length,
// and two lengths of one text stand a line apart. Stacked lengths are rationed
// as other lengths are, longest first, and the key counts the placeholders
// left without one. A loop of loaded nodes, the nodes a drawn walk steps on
// between two steps on the reference, writes its length along itself where
// it is drawn long enough to hold it, after the placeholders and before the
// rest: a force layout draws each node and link at least a few units long,
// so a loop's drawn length beside the reference's says little of its bp.
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
  // the node whose length it writes
  node: string
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
// and the biggest allele first among each, two of one length by node id in
// numeric order, which depends on the sequence lengths and ids alone.
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
          ? nodeLengths.get(b.id)! - nodeLengths.get(a.id)! ||
            compareIds(a.id, b.id)
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
  // a placeholder's length, placed before the rest and outside the budget,
  // at the first of its spots free
  kept: boolean
  // the point its length names: the middle of the node on the pane, or the
  // first of its spots the pane shows
  middle: Point
  // spots along the node whose box lies whole on the pane, tried in order;
  // none on a placeholder drawn too short to hold its length
  along: { label: GraphLabel; box: Box }[]
  // a placeholder's spots stacked off its loop's middle whose box lies whole
  // on the pane, tried where every spot along it is taken; built only then
  stacked?: () => { label: GraphLabel; box: Box }[]
}

// A label's spots stacked off `spot`, nearest first: a row at a time up and
// down, slid sideways up to half the label, to the pane's edges `height`
// tall, each with a leader to the spot
function stackedSpots(
  label: Pick<GraphLabel, 'key' | 'node' | 'text'>,
  halfW: number,
  spot: Point,
  height: number,
) {
  const row = 2 * LABEL_HALF_HEIGHT
  const rows = Math.ceil(height / row)
  const slides = [0]
  for (let d = STACK_SLIDE_PX; d <= halfW; d += STACK_SLIDE_PX) {
    slides.push(-d, d)
  }
  return Array.from({ length: rows }, (_, k) => k + 1)
    .flatMap(k =>
      [1, -1].flatMap(direction =>
        slides.map(dx => ({
          x: spot.x + dx,
          y: spot.y + direction * k * row,
          distance: Math.hypot(dx, k * row),
        })),
      ),
    )
    .sort((a, b) => a.distance - b.distance)
    .map(({ x, y }) => ({
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
  width,
  height,
}: SizeLabelArgs) {
  const { scaleX, scaleY } = axis
  const barred = new Set(alleleDeletions?.flatMap(run => run.nodeIds))
  const candidates: SizeLabelCandidate[] = []
  const onPane = ({ x, y }: { x: number; y: number }) =>
    x >= 0 &&
    x <= width &&
    y + LABEL_HALF_HEIGHT > 0 &&
    y - LABEL_HALF_HEIGHT < height
  const wholeOnPane = (box: Box) =>
    box.x0 >= 0 && box.x1 <= width && box.y0 >= 0 && box.y1 <= height
  // Placeholders first, then the biggest allele: in a crowd, the label that
  // survives should be the one carrying the most sequence, not whichever node
  // the layout happened to emit first. The order is `labelOrder`'s, cached
  // across frames; the rejects below are what a frame actually decides,
  // cheapest first — a node barred by an allele deletion, then one with no
  // spot on the pane (the box's height is a constant, so this needs no text),
  // then a node other than a placeholder too short to hold the shortest label
  // there is.
  for (const { id, segments, kept } of labelOrder(
    nodePositions,
    nodeLengths,
    nodeById,
  )) {
    const at = (fraction: number) => {
      const { x, y } = polylinePointAt(segments, fraction)
      return { x: x * scaleX + translateX, y: y * scaleY + translateY }
    }
    const spots = barred.has(id)
      ? []
      : (kept ? KEPT_LABEL_SPOTS : [0.5]).map(at).filter(onPane)
    const drawn = spots.length > 0 ? polylinePx(segments, scaleX, scaleY) : 0
    // The same comparison the real fit test makes, against the narrowest box
    // any label can have — so nothing that would have passed is rejected here.
    if (
      kept
        ? spots.length > 0
        : drawn >= (MIN_LABEL_HALF_WIDTH * 2) / MAX_LABEL_OVERHANG
    ) {
      const label = {
        key: `node:${id}`,
        node: id,
        text: formatBp(nodeLengths.get(id)!),
      }
      const halfW = labelHalfWidth(label.text)
      const holds = drawn >= (halfW * 2) / MAX_LABEL_OVERHANG
      const along = holds
        ? spots
            .map(({ x, y }) => ({
              label: { ...label, x, y },
              box: boxAt(halfW, x, y),
            }))
            .filter(({ box }) => wholeOnPane(box))
        : []
      const [middle] = spots
      if ((kept || along.length > 0) && middle) {
        candidates.push({
          id,
          kept,
          middle,
          along,
          stacked: kept
            ? () =>
                stackedSpots(label, halfW, middle, height).filter(({ box }) =>
                  wholeOnPane(box),
                )
            : undefined,
        })
      }
    }
  }

  return candidates
}

export interface WalkLoop {
  nodes: string[]
  bp: number
  // the shortest of the walks' loops drawn over it
  least: number
}

interface Stretch {
  nodes: string[]
  bp: number
}

const loopsCache = weakMemo<GraphNode[], WalkLoop[]>()

// The nodes each drawn walk steps on between two steps on the reference,
// where every one is loaded, each run of nodes once however many walks take
// it. Runs between the same two reference nodes that share half the bp of
// the shorter are one loop as drawn, the longest's nodes with the least of
// their lengths. The longest first.
export function walkLoops(graph: Pick<Graph, 'nodes' | 'paths'>) {
  return loopsCache(graph.nodes, [graph.paths], () => {
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    const seen = new Set<string>()
    const bySite = new Map<string, Stretch[]>()
    for (const path of graph.paths ?? []) {
      let nodes: string[] = []
      let bp = 0
      let loaded = true
      let from: string | undefined
      for (const id of path.nodeIds) {
        const node = byId.get(id)
        if (node && isBackbone(node)) {
          const key = nodes.join(' ')
          if (
            from !== undefined &&
            loaded &&
            nodes.length > 0 &&
            !seen.has(key)
          ) {
            seen.add(key)
            pushTo(bySite, `${from}>${id}`, { nodes, bp })
          }
          from = id
          nodes = []
          bp = 0
          loaded = true
        } else {
          nodes.push(id)
          bp += node?.length ?? 0
          loaded &&= !!node && !node.placeholder
        }
      }
    }
    const loops: WalkLoop[] = []
    for (const stretches of bySite.values()) {
      const groups: { lead: Stretch; held: Set<string>; least: number }[] = []
      for (const stretch of stretches.toSorted((a, b) => b.bp - a.bp)) {
        const own = new Set(stretch.nodes)
        const shared = (held: Set<string>) => {
          let bp = 0
          for (const id of own) {
            bp += held.has(id) ? (byId.get(id)?.length ?? 0) : 0
          }
          return bp
        }
        const group = groups.find(g => 2 * shared(g.held) >= stretch.bp)
        if (group) {
          group.least = Math.min(group.least, stretch.bp)
        } else {
          groups.push({ lead: stretch, held: own, least: stretch.bp })
        }
      }
      for (const { lead, least } of groups) {
        loops.push({ nodes: lead.nodes, bp: lead.bp, least })
      }
    }
    return loops.sort(
      (a, b) =>
        b.bp - a.bp ||
        compareIds(a.nodes[0] ?? '', b.nodes[0] ?? '') ||
        b.nodes.length - a.nodes.length,
    )
  })
}

// Two lengths as one span, their unit said once where they share it
export function formatBpSpan(least: number, most: number) {
  const low = formatBp(least)
  const high = formatBp(most)
  const [lowValue, lowUnit] = low.split(' ')
  return low === high
    ? high
    : lowUnit === high.split(' ')[1]
      ? `${lowValue}\u2013${high}`
      : `${low}\u2013${high}`
}

const distance = (a: NodeSegment, b: NodeSegment) =>
  Math.hypot(a.x - b.x, a.y - b.y)

// how near a point comes to either end of a line
const gapToEnds = (p: NodeSegment, line: readonly NodeSegment[]) =>
  Math.min(distance(p, line[0] ?? p), distance(p, line.at(-1) ?? p))

// A loop's nodes as one line, each read from its end nearer the line so far,
// the first from its end farther from the second, and where along the line
// each node ends; none where a node has no position
function loopLine(
  nodes: readonly string[],
  positions: Record<string, NodeSegment[]>,
) {
  const lines = nodes.map(id => positions[id] ?? [])
  const line: NodeSegment[] = []
  const ends: number[] = []
  let walked = 0
  lines.forEach((own, k) => {
    const first = own[0]
    const last = own.at(-1)
    const next = lines[k + 1] ?? []
    const before = line.at(-1)
    const reversed =
      first && last
        ? before
          ? distance(before, last) < distance(before, first)
          : next.length > 0 && gapToEnds(first, next) < gapToEnds(last, next)
        : false
    for (let i = 0; i < own.length; i++) {
      const point = own[reversed ? own.length - 1 - i : i]!
      const prior = line.at(-1)
      walked += prior ? distance(prior, point) : 0
      line.push(point)
    }
    ends.push(walked)
  })
  return lines.every(own => own.length > 0) ? { line, ends } : undefined
}

const loopLinesCache = weakMemo<
  Record<string, NodeSegment[]>,
  { loop: WalkLoop; line: NodeSegment[]; ends: number[] }[]
>()

// Each loop's length, at the first of its spots along it free, where it is
// drawn long enough to hold it and some node of it is drawn
export function loopLabelCandidates({
  loops,
  nodePositions,
  folded,
  axis,
  translateX,
  translateY,
  width,
  height,
}: Pick<
  SizeLabelArgs,
  'nodePositions' | 'axis' | 'translateX' | 'translateY' | 'width' | 'height'
> & {
  loops: readonly WalkLoop[]
  folded: ReadonlySet<string> | undefined
}) {
  const { scaleX, scaleY } = axis
  const drawnLines = loopLinesCache(nodePositions, [loops], () =>
    loops.flatMap(loop => {
      const drawn = loopLine(loop.nodes, nodePositions)
      return drawn ? [{ loop, ...drawn }] : []
    }),
  )
  const onPane = ({ x, y }: Point) =>
    x >= 0 &&
    x <= width &&
    y + LABEL_HALF_HEIGHT > 0 &&
    y - LABEL_HALF_HEIGHT < height
  const wholeOnPane = (box: Box) =>
    box.x0 >= 0 && box.x1 <= width && box.y0 >= 0 && box.y1 <= height
  const seen = new Map<string, number>()
  const candidates: SizeLabelCandidate[] = []
  for (const { loop, line, ends } of drawnLines) {
    const text = formatBpSpan(loop.least, loop.bp)
    const halfW = labelHalfWidth(text)
    if (
      polylinePx(line, scaleX, scaleY) >= (halfW * 2) / MAX_LABEL_OVERHANG &&
      !loop.nodes.every(id => folded?.has(id))
    ) {
      const total = ends.at(-1) ?? 0
      const middleNode =
        loop.nodes[ends.findIndex(end => end >= total / 2)] ?? loop.nodes[0]!
      const pair = `${loop.nodes[0]}>${loop.nodes.at(-1)}`
      const copy = seen.get(pair) ?? 0
      seen.set(pair, copy + 1)
      const label = {
        key: `loop:${pair}${copy ? `#${copy}` : ''}`,
        node: middleNode,
        text,
      }
      const spots = KEPT_LABEL_SPOTS.map(fraction => {
        const { x, y } = polylinePointAt(line, fraction)
        return { x: x * scaleX + translateX, y: y * scaleY + translateY }
      }).filter(onPane)
      const along = spots
        .map(({ x, y }) => ({
          label: { ...label, x, y },
          box: boxAt(halfW, x, y),
        }))
        .filter(({ box }) => wholeOnPane(box))
      const [middle] = spots
      if (along.length > 0 && middle) {
        candidates.push({ id: label.key, kept: false, middle, along })
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

// A length placed, and the point it names, its node's middle
export interface PlacedLength {
  label: GraphLabel
  middle: Point
}

interface SizePlacing {
  budget?: number
  placed?: readonly PlacedLength[]
  leaders?: number
  clear?: (box: Box, id: string) => boolean
}

// Two points nearer than a label is tall read as one spot
const ONE_SPOT_PX = 2 * LABEL_HALF_HEIGHT

const gapBetween = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(0, a.x0 - b.x1, b.x0 - a.x1),
    Math.max(0, a.y0 - b.y1, b.y0 - a.y1),
  )

// Each candidate at its first free spot while the budget lasts, a
// placeholder's whatever the budget, as the `placed` lengths already spent it.
// Where no spot along a placeholder's loop is free, its length stacks off the
// loop while fewer than `leaders` stacked lengths stand, clear of every other
// node's ink where `clear` finds a spot that is; else at the nearest free spot.
// Nodes whose middles lie on one spot, or on a spot a length already names,
// take one length between them, the longest's, as the candidates come longest
// first, and no length stands within a line of another of its text, as nearer
// they read as one length written twice. The key counts the rest.
export function placeSizeLabels(
  candidates: SizeLabelCandidate[],
  take: TakeBox,
  {
    budget = Infinity,
    placed = [],
    leaders = Infinity,
    clear = () => true,
  }: SizePlacing = {},
) {
  const lengths: PlacedLength[] = []
  const standing = placed.slice()
  const named = ({ x, y }: Point) =>
    standing.some(
      ({ middle }) => Math.hypot(middle.x - x, middle.y - y) < ONE_SPOT_PX,
    )
  const apart = ({ label, box }: { label: GraphLabel; box: Box }) =>
    standing.every(
      other =>
        other.label.text !== label.text ||
        gapBetween(
          box,
          boxAt(labelHalfWidth(label.text), other.label.x, other.label.y),
        ) >= LABEL_HEIGHT_PX,
    )
  let stacked = 0
  for (const candidate of candidates) {
    if (
      (candidate.kept || standing.length < budget) &&
      !named(candidate.middle)
    ) {
      const along = candidate.along.find(s => apart(s) && take(s.box))
      const spots =
        along || stacked >= leaders
          ? undefined
          : candidate.stacked?.().filter(apart)
      const spot =
        along ??
        spots?.find(s => clear(s.box, candidate.id) && take(s.box)) ??
        spots?.find(s => take(s.box))
      if (spot) {
        const length = { label: spot.label, middle: candidate.middle }
        lengths.push(length)
        standing.push(length)
        stacked += spot.label.leader ? 1 : 0
      }
    }
  }
  return lengths
}

export function unlabelledPlaceholders(
  candidates: SizeLabelCandidate[],
  labels: GraphLabel[],
  nodeLengths: Map<string, number>,
) {
  const labelled = new Set(labels.map(l => l.node))
  let count = 0
  let smallest = Infinity
  let largest = 0
  for (const { id, kept } of candidates) {
    if (kept && !labelled.has(id)) {
      const bp = nodeLengths.get(id)!
      count++
      smallest = Math.min(smallest, bp)
      largest = Math.max(largest, bp)
    }
  }
  return count > 0 ? { count, smallest, largest } : undefined
}

export type UnlabelledPlaceholders = NonNullable<
  ReturnType<typeof unlabelledPlaceholders>
>

// Node labels, each placed where `take` finds room. By default `take` finds it
// on the pane outside the `reserved` boxes.
export function graphLabels({
  reserved,
  take,
  ...args
}: SizeLabelArgs & { reserved?: Box[]; take?: TakeBox }): GraphLabel[] {
  take ??= occupancy(args, reserved)
  const budget = nodeLabelBudget(args.width, args.height)
  return placeSizeLabels(sizeLabelCandidates(args), take, {
    budget,
    leaders: budget,
  }).map(({ label }) => label)
}
