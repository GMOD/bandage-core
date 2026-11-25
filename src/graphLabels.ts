import { isBackbone } from './anchoredNodes'
import { polylinePointAt } from './layout/mergeRuns'
import { SMALL_SITE_PX } from './levelOfDetail'
import { grown, insideFrame, labelWidth, occupancy } from './overlayLabels'
import { panSNHaplotype } from './pansn'
import { pathOrigin } from './pathAnchoring'
import { compareIds } from './util/canonicalOrder'
import { polylinePx } from './util/geometry'
import { pushTo } from './util/groups'
import { segmentInBox } from './util/hitDetection'
import { weakMemo } from './util/weakMemo'

import type { InkOwner } from './drawnInk'
import type { Box, TakeBox } from './overlayLabels'
import type {
  AlleleDeletion,
  Graph,
  GraphEdge,
  GraphNode,
  GraphPath,
  NodeSegment,
} from './types'
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
// **What a length guarantees.** Its box covers no exon outline and no ink but
// the strokes of the nodes it names, its own and any whose middle lies on its
// node's, or its loop's, so it hides nothing it does not name; and where it
// stands on its node, the node runs on past the box at both ends
// by RUNS_ON_PX, so it does not hide the node it names either. It stands at
// the first spot along its node, nearest the middle first, where that holds;
// else off the node's middle on a leader, at the nearest spot covering no ink
// at all; else it is not written, and the key counts the placeholders left
// without one. A node stands its length off on a leader only within
// NODE_STACK_ROWS rows of it, and only where its bp at the reference's px a
// bp comes to SMALL_SITE_PX, as a site's bp must to be drawn: a force layout
// draws each node and link at least a few units long, so a node's drawn
// length says little of its bp.
//
// A length is also dropped where its box would overlap a label already
// placed, and lengths go biggest sequence first, so what survives a crowd is
// the allele that matters; this is what fixes labels printing on top of each
// other ("−10 kb3.2 kb" in the amylase figure). A placeholder's length goes
// before every other, outside the budget, and stacks anywhere on the pane,
// since nothing else on the drawing says how much sequence the loop stands
// in for. Loops on one spot share one length, and two lengths of one text
// stand a line apart. A loop of loaded nodes, the nodes a drawn walk steps on
// between two steps on the reference, writes its length after the
// placeholders and before the rest (loopLabelCandidates).
//
// Between them they hold at both ends of the scale a pangenome graph spans: 63
// kb-scale nodes at the amylase locus nearly all carry a length, and a 154-node
// base-level pggb graph of 1-100 bp segments carries almost none — where every
// label would have said "1 bp" and covered the segment it named.
//
// Collision is measured in SCREEN pixels, because that is where the text has its
// size: the same two labels clear each other zoomed in and collide zoomed out,
// so a wide view sheds labels on its own. A node's length is written unless
// a host turns lengths off (LABEL_DEFAULTS.nodeLengths) or, with walks, it
// is the reference's, which read as the variants'; a placeholder's always
// is: nothing else says how much sequence the steps it stands in for hold.

export const LABEL_DEFAULTS = { nodeLengths: true }

export function labelledNodeLengths(
  graph: Pick<Graph, 'nodes' | 'paths'> | undefined,
  nodeLengths = LABEL_DEFAULTS.nodeLengths,
) {
  const lengths = new Map<string, number>()
  const walked = !!graph?.paths?.length
  for (const node of graph?.nodes ?? []) {
    if ((nodeLengths && !(walked && isBackbone(node))) || node.placeholder) {
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
// How far a node runs on past its length's box at each end, so the node shows
// rather than the label
const RUNS_ON_PX = LABEL_HEIGHT_PX
// How many rows off its node a node's length may stand on a leader
const NODE_STACK_ROWS = 3
// How much wider than its loop a loop's length may be before it is the label
// that is being drawn rather than the loop
const MAX_LOOP_OVERHANG = 2

// Half the box a piece of label text occupies, wanted before there is anywhere
// to put the box: the node pass rejects on size before it has a position.
function labelHalfWidth(text: string) {
  return (text.length * LABEL_CHAR_PX + LABEL_PAD_PX + LABEL_GAP_PX) / 2
}

// Constant whatever the label says, so a candidate's vertical cull costs
// nothing and can be taken before its text exists.
const LABEL_HALF_HEIGHT = (LABEL_HEIGHT_PX + LABEL_GAP_PX) / 2

// The shortest a node can be drawn and still run on past a length's box at
// both ends: the box is at least as tall as a line across the node. A node
// drawn shorter writes its length on a leader or not at all, so the check
// happens before the length is formatted: on a 7,499-node cut nearly every
// node fails it, and building a string and a box per node only to discard
// both was most of this pass (measured 37 ms per frame, and this pass runs on
// every pan).
const MIN_ALONG_PX = 2 * LABEL_HALF_HEIGHT + 2 * RUNS_ON_PX

const onPane = (
  { x, y }: Point,
  { width, height }: { width: number; height: number },
) =>
  x >= 0 &&
  x <= width &&
  y + LABEL_HALF_HEIGHT > 0 &&
  y - LABEL_HALF_HEIGHT < height

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

// A share as its label gives it: a whole percent, and never the 0% or 100% a
// node some haplotypes walk and some leave out is not at
export function formatShare(haplotypes: number, of: number) {
  const percent = Math.round((100 * haplotypes) / of)
  return percent < 1 ? '<1%' : percent > 99 ? '>99%' : `${percent}%`
}

const haplotypesOf = (path: GraphPath) =>
  (path.members ?? [path.name]).map(
    name => panSNHaplotype(pathOrigin(name).name) ?? name,
  )

export const NO_SHARES: {
  texts: ReadonlyMap<string, string>
  links: ReadonlyMap<number, string>
  of: number
} = {
  texts: new Map(),
  links: new Map(),
  of: 0,
}

// The share of the graph's haplotypes that walk each node some of them leave
// out, written beside its length where a host asks (FigureSettings
// nodeShares), the share that take each link some of them leave out, by link
// index, written on a skip's arc, and how many haplotypes each is a share
// `of`: those with a step in the graph, each once whatever its walks, its
// passes or the thread a fold put it on. None is stated where a walk has steps
// the cut did not load or a node stands for nodes not shown, since a
// haplotype may then walk a node or take a link no loaded step of its says it
// does.
export function labelledNodeShares(
  graph: Pick<Graph, 'nodes' | 'paths' | 'edges'> | undefined,
  nodeShares = false,
) {
  const paths = graph?.paths ?? []
  const stated =
    nodeShares &&
    !paths.some(path => path.abridgedSteps) &&
    !graph?.nodes.some(node => node.placeholder)
  const all = new Set<string>()
  const through = new Map<string, Set<string>>()
  const byName = new Map<string, string[]>()
  for (const path of stated ? paths : []) {
    const haplotypes = path.nodeIds.length > 0 ? haplotypesOf(path) : []
    byName.set(path.name, haplotypes)
    for (const haplotype of haplotypes) {
      all.add(haplotype)
    }
    for (const id of new Set(path.nodeIds)) {
      const walkers = through.get(id) ?? new Set<string>()
      for (const haplotype of haplotypes) {
        walkers.add(haplotype)
      }
      through.set(id, walkers)
    }
  }
  const share = (walkers: ReadonlySet<string>) =>
    walkers.size > 0 && walkers.size < all.size
      ? formatShare(walkers.size, all.size)
      : undefined
  const texts = new Map<string, string>()
  for (const [id, walkers] of through) {
    const text = share(walkers)
    if (text) {
      texts.set(id, text)
    }
  }
  const links = new Map<number, string>()
  for (const [i, edge] of (stated ? (graph?.edges ?? []) : []).entries()) {
    const text = share(
      new Set(edge.pathIds?.flatMap(name => byName.get(name) ?? [])),
    )
    if (text) {
      links.set(i, text)
    }
  }
  return texts.size + links.size > 0
    ? { texts, links, of: all.size }
    : NO_SHARES
}

// What the key says a share is of
export const sharesKey = (of: number) =>
  `%: the share of the ${groupDigits(of)} haplotypes drawn that walk a node, loop or skip`

// The lengths the size labels are placed from where shares are written: a
// node with a share and no length of its own, as the reference's are on a
// graph with walks, joins them, and its label is its share alone. So the
// stretch of the reference a deletion skips says how many still walk it. A
// run of the reference's nodes with one share is labelled once, on its
// longest: CFH's deletion skips six, and "70%" six times said no more.
export function sharedNodeLengths(
  nodeLengths: Map<string, number>,
  nodeShares: ReadonlyMap<string, string> | undefined,
  nodes: readonly GraphNode[] | undefined,
) {
  const shareOnly = new Set<string>()
  const lengths = new Map(nodeLengths)
  const add = (node: GraphNode) => {
    lengths.set(node.id, node.length)
    shareOnly.add(node.id)
  }
  const lengthless = (node: GraphNode) =>
    nodeShares?.has(node.id) && !lengths.has(node.id)
  const along = nodeShares?.size
    ? (nodes ?? [])
        .filter(isBackbone)
        .toSorted((a, b) => a.stable.start - b.stable.start)
    : []
  let run: GraphNode[] = []
  const close = () => {
    const longest = run.reduce<GraphNode | undefined>(
      (best, node) => (best && best.length >= node.length ? best : node),
      undefined,
    )
    if (longest) {
      add(longest)
    }
    run = []
  }
  for (const node of along) {
    if (
      run.length > 0 &&
      !(
        lengthless(node) &&
        nodeShares?.get(node.id) === nodeShares?.get(run[0]!.id)
      )
    ) {
      close()
    }
    if (lengthless(node)) {
      run.push(node)
    }
  }
  close()
  for (const node of nodeShares?.size ? (nodes ?? []) : []) {
    if (!isBackbone(node) && lengthless(node)) {
      add(node)
    }
  }
  return { lengths, shareOnly }
}

// Where along its node or loop a length may stand, each sixteenth, nearest
// the middle first
const LENGTH_SPOTS = Array.from({ length: 15 }, (_, k) => (k + 1) / 16).sort(
  (a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5) || a - b,
)

export type NodeKinds = ReadonlyMap<
  string,
  Pick<GraphNode, 'placeholder' | 'lengthSpan'>
>

interface SizeLabelArgs {
  nodePositions: Record<string, NodeSegment[]>
  // bp per node id
  nodeLengths: Map<string, number>
  // which nodes are placeholders, whose lengths are kept
  nodeById?: NodeKinds
  // the share written after a node's length: labelledNodeShares' texts
  nodeShares?: ReadonlyMap<string, string>
  // nodes whose label is their share alone: sharedNodeLengths'
  shareOnly?: ReadonlySet<string>
  // Alleles the layout drew over the reference they replace: their nodes
  // keep their lengths off the drawing, since a length written across a bar
  // drawn wider than it reads as the bar's size. See AlleleDeletion.
  alleleDeletions?: AlleleDeletion[]
  // the reference's px a bp, which a node's bp must come to SMALL_SITE_PX at
  // to stand its length off on a leader; none stands off without one
  pxPerBp?: number
  // Screen px per layout unit, both axes. They are equal on an isotropic layout
  // and differ on a row layout, whose y is already px (scaleY === 1). One value
  // so a caller cannot pass one and default the other — see AxisScale.
  axis: AxisScale
  translateX: number
  translateY: number
  width: number
  height: number
}

interface LengthSpot {
  label: GraphLabel
  box: Box
}

export interface SizeLabelCandidate {
  id: string
  // a placeholder's length, placed before the rest and outside the budget,
  // at the first of its spots free
  kept: boolean
  // the point its length names: the middle of the node on the pane, or the
  // first of its spots the pane shows
  middle: Point
  // spots along the node whose box lies whole on the pane with the node
  // running on past it at both ends, tried in order
  along: LengthSpot[]
  // the ink a length along the node may cover: the strokes of the nodes it
  // names, its own and those whose middles lie on its node's
  own: (piece: InkOwner) => boolean
  // spots stacked off the node's middle whose box lies whole on the pane,
  // tried where every spot along it is taken; built only then
  stacked?: () => LengthSpot[]
}

// A label's spots stacked off `spot`, nearest first: a row at a time up and
// down, `rows` of them, slid sideways up to half the label, each with a
// leader to the spot
function stackedSpots(
  label: Pick<GraphLabel, 'key' | 'node' | 'text'>,
  halfW: number,
  spot: Point,
  rows: number,
) {
  const slides = [0]
  for (let d = STACK_SLIDE_PX; d <= halfW; d += STACK_SLIDE_PX) {
    slides.push(-d, d)
  }
  return Array.from({ length: rows }, (_, k) => k + 1)
    .flatMap(k =>
      [1, -1].flatMap(direction =>
        slides.map(dx => ({
          x: spot.x + dx,
          y: spot.y + direction * k * STACK_ROW_PX,
          distance: Math.hypot(dx, k * STACK_ROW_PX),
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
// Two points nearer than a label is tall read as one spot
const ONE_SPOT_PX = 2 * LABEL_HALF_HEIGHT
const oneSpot = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y) < ONE_SPOT_PX
const STACK_ROW_PX = 2 * LABEL_HALF_HEIGHT

// the rows from a spot to the pane's edges, `height` tall
const rowsOnPane = (height: number) => Math.ceil(height / STACK_ROW_PX)

// The line from a stacked length's box to the point on its node it names,
// from the box's edge nearer the node
export function sizeLeader({ x, y, leader }: GraphLabel) {
  return leader ? leaderLine({ x, y }, leader) : undefined
}

function leaderLine({ x, y }: Point, to: Point) {
  return {
    x1: x,
    y1: to.y > y ? y + LABEL_HEIGHT_PX / 2 : y - LABEL_HEIGHT_PX / 2,
    x2: to.x,
    y2: to.y,
  }
}

// The box a stacked length's leader runs through up to half a row from the
// point it names, as near as the box of a length stacked a row off stands:
// no other label may cover it, and no ink cross it but that of the nodes the
// length names and their exon outlines
function leaderPath(label: Point, to: Point) {
  const { x1, y1 } = leaderLine(label, to)
  const reach = Math.hypot(x1 - to.x, y1 - to.y)
  const short = reach > 0 ? Math.min(1, LABEL_HALF_HEIGHT / reach) : 1
  const x2 = to.x + (x1 - to.x) * short
  const y2 = to.y + (y1 - to.y) * short
  return {
    x0: Math.min(x1, x2) - 1,
    x1: Math.max(x1, x2) + 1,
    y0: Math.min(y1, y2),
    y1: Math.max(y1, y2),
  }
}

// Whether a line runs under a box in one stretch and on past it at both
// ends by RUNS_ON_PX, so a label in the box leaves the line showing
function runsOnPast(line: readonly Point[], box: Box) {
  let walked = 0
  let first = Infinity
  let last = -Infinity
  let stretches = 0
  let inside = false
  line.forEach((b, k) => {
    const a = line[k - 1]
    const within = a ? segmentInBox(a, b, box) : undefined
    const length = a ? Math.hypot(b.x - a.x, b.y - a.y) : 0
    if (within) {
      first = Math.min(first, walked + within[0] * length)
      last = walked + within[1] * length
    }
    stretches += within && !inside ? 1 : 0
    inside = !!within
    walked += length
  })
  return stretches === 1 && first >= RUNS_ON_PX && walked - last >= RUNS_ON_PX
}

export function sizeLabelCandidates({
  nodePositions,
  nodeLengths,
  nodeShares,
  shareOnly,
  nodeById,
  alleleDeletions,
  pxPerBp = 0,
  axis,
  translateX,
  translateY,
  width,
  height,
}: SizeLabelArgs) {
  const { scaleX, scaleY } = axis
  const barred = new Set(alleleDeletions?.flatMap(run => run.nodeIds))
  const candidates: SizeLabelCandidate[] = []
  const screen = ({ x, y }: Point) => ({
    x: x * scaleX + translateX,
    y: y * scaleY + translateY,
  })
  const pane = { width, height }
  const middleOf = (id: string) =>
    screen(polylinePointAt(nodePositions[id] ?? [], 0.5))
  // Placeholders first, then the biggest allele: in a crowd, the label that
  // survives should be the one carrying the most sequence, not whichever node
  // the layout happened to emit first. The order is `labelOrder`'s, cached
  // across frames; the rejects below are what a frame actually decides,
  // cheapest first — a node barred by an allele deletion, then one with no
  // spot on the pane (the box's height is a constant, so this needs no text),
  // then a node drawn too short to carry a length along it and too small in
  // bp to stand one off.
  for (const { id, segments, kept } of labelOrder(
    nodePositions,
    nodeLengths,
    nodeById,
  )) {
    const spots = barred.has(id)
      ? []
      : LENGTH_SPOTS.map(fraction =>
          screen(polylinePointAt(segments, fraction)),
        ).filter(p => onPane(p, pane))
    const bp = nodeLengths.get(id)!
    const drawn = spots.length > 0 ? polylinePx(segments, scaleX, scaleY) : 0
    const standsOff = kept || bp * pxPerBp >= SMALL_SITE_PX
    const [middle] = spots
    if (middle && (drawn >= MIN_ALONG_PX || standsOff)) {
      const span = nodeById?.get(id)?.lengthSpan
      const length = span ? formatBpSpan(span.least, span.most) : formatBp(bp)
      const share = nodeShares?.get(id)
      const label = {
        key: `node:${id}`,
        node: id,
        text: share
          ? shareOnly?.has(id)
            ? share
            : `${length} · ${share}`
          : length,
      }
      const halfW = labelHalfWidth(label.text)
      const line = drawn >= MIN_ALONG_PX ? segments.map(screen) : []
      const along = spots
        .map(({ x, y }) => ({
          label: { ...label, x, y },
          box: boxAt(halfW, x, y),
        }))
        .filter(({ box }) => insideFrame(box, pane) && runsOnPast(line, box))
      if (along.length > 0 || standsOff) {
        candidates.push({
          id,
          kept,
          middle,
          along,
          own: ({ node }) =>
            node === id ||
            (node !== undefined &&
              (nodePositions[node]?.length ?? 0) > 0 &&
              oneSpot(middleOf(node), middleOf(id))),
          stacked: standsOff
            ? () =>
                stackedSpots(
                  label,
                  halfW,
                  middle,
                  kept ? rowsOnPane(height) : NODE_STACK_ROWS,
                ).filter(({ box }) => insideFrame(box, pane))
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
  // the shortest of the walks' loops drawn over it, and the longest, where a
  // node drawn for alleles of near lengths stands for longer ones
  least: number
  most: number
  // the nodes of every walk's loop drawn over it, its own included
  drawn: Set<string>
}

const loopsCache = weakMemo<GraphNode[], WalkLoop[]>()

// The nodes each drawn walk steps on between two steps on the reference,
// where every one is loaded, each run of nodes once however many walks take
// it. A run sharing half the bp of a longer one is that loop as drawn, which
// writes the least of their lengths with its own. The longest first.
export function walkLoops(graph: Pick<Graph, 'nodes' | 'paths'>) {
  return loopsCache(graph.nodes, [graph.paths], () => {
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    const seen = new Set<string>()
    const runs: { nodes: string[]; bp: number; least: number; most: number }[] =
      []
    for (const path of graph.paths ?? []) {
      let nodes: string[] = []
      let bp = 0
      let least = 0
      let most = 0
      let loaded = true
      let met = false
      for (const id of path.nodeIds) {
        const node = byId.get(id)
        if (node && isBackbone(node)) {
          const key = nodes.join(' ')
          if (met && loaded && nodes.length > 0 && !seen.has(key)) {
            seen.add(key)
            runs.push({ nodes, bp, least, most })
          }
          met = true
          nodes = []
          bp = 0
          least = 0
          most = 0
          loaded = true
        } else {
          const length = node?.length ?? 0
          nodes.push(id)
          bp += length
          least += node?.lengthSpan?.least ?? length
          most += node?.lengthSpan?.most ?? length
          loaded &&= !!node && !node.placeholder
        }
      }
    }
    runs.sort(
      (a, b) =>
        b.bp - a.bp ||
        compareIds(a.nodes[0] ?? '', b.nodes[0] ?? '') ||
        b.nodes.length - a.nodes.length,
    )
    const loops: WalkLoop[] = []
    const loopsHolding = new Map<string, number[]>()
    for (const run of runs) {
      const shared = new Map<number, number>()
      for (const id of new Set(run.nodes)) {
        for (const at of loopsHolding.get(id) ?? []) {
          shared.set(at, (shared.get(at) ?? 0) + (byId.get(id)?.length ?? 0))
        }
      }
      let joined: number | undefined
      for (const [at, bp] of shared) {
        joined ??= 2 * bp >= loops[at]!.bp ? at : undefined
      }
      const loop = joined === undefined ? undefined : loops[joined]
      if (loop) {
        loop.least = Math.min(loop.least, run.least)
        loop.most = Math.max(loop.most, run.most)
        for (const id of run.nodes) {
          loop.drawn.add(id)
        }
      } else {
        for (const id of new Set(run.nodes)) {
          pushTo(loopsHolding, id, loops.length)
        }
        loops.push({ ...run, drawn: new Set(run.nodes) })
      }
    }
    return loops
  })
}

// Two lengths as one span, their unit said once where they share it
const BP_PER_UNIT: Record<string, number> = { bp: 1, kb: 1000, Mb: 1_000_000 }

// The fewest decimals, at most down to 1 bp, at which two lengths in one unit
// are written apart by within half of how far apart they are
function spanDecimals(least: number, most: number, per: number) {
  const spread = most - least
  const finest = Math.round(Math.log10(per))
  const shownAt = (d: number) =>
    ((Math.round((most / per) * 10 ** d) -
      Math.round((least / per) * 10 ** d)) /
      10 ** d) *
    per
  return (
    Array.from({ length: finest + 1 }, (_, d) => d).find(
      d => Math.abs(shownAt(d) - spread) <= spread / 2,
    ) ?? finest
  )
}

export function formatBpSpan(least: number, most: number) {
  const low = formatBp(least)
  const high = formatBp(most)
  const [lowValue = '', lowUnit = ''] = low.split(' ')
  const [highValue = '', highUnit = ''] = high.split(' ')
  const per = BP_PER_UNIT[highUnit] ?? 1
  const spread = most - least
  const shown = (Number(highValue) - Number(lowValue)) * per
  const decimals = spanDecimals(least, most, per)
  return low === high
    ? high
    : lowUnit !== highUnit
      ? `${low}\u2013${high}`
      : Math.abs(shown - spread) <= spread / 2
        ? `${lowValue}\u2013${high}`
        : `${(least / per).toFixed(decimals)}\u2013${(most / per).toFixed(decimals)} ${highUnit}`
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

// What a length must know of the drawing: whether a box covers ink other
// than what `own` claims, exon outlines among it, and how wide a set of nodes
// is drawn
export interface LengthInk {
  under: (box: Box, own: (piece: InkOwner) => boolean) => boolean
  widest: (nodes: readonly string[]) => number
}

const noInk = () => false

// Whether a line runs under a box once: one unbroken stretch of it meets the
// box, no longer inside it than a straight line across it, so it does not
// turn back under it
function runsUnderOnce(line: readonly Point[], box: Box) {
  let stretches = 0
  let inside = false
  let length = 0
  line.forEach((b, k) => {
    const a = line[k - 1]
    const within = a ? segmentInBox(a, b, box) : undefined
    stretches += within && !inside ? 1 : 0
    inside = !!within
    length +=
      within && a
        ? (within[1] - within[0]) * Math.hypot(b.x - a.x, b.y - a.y)
        : 0
  })
  return (
    stretches === 1 && length <= Math.hypot(box.x1 - box.x0, box.y1 - box.y0)
  )
}

// Each loop's length, where the loop is drawn long enough to hold it, some
// node of it is drawn and its bp at the reference's px a bp comes to
// SMALL_SITE_PX, as a site's bp must to be drawn. It stands at the first of
// its spots along the loop whose box covers no ink but the loop's own, its
// stroke running under the box once and on past it at both ends; where none
// does, off the loop's middle with a leader to it, at the nearest spot whose
// box covers no ink at all (placeSizeLabels). The loop's own ink is that of
// the walks' loops it writes the length of and of their links
export function loopLabelCandidates({
  loops,
  edges,
  nodePositions,
  nodeShares,
  folded,
  pxPerBp,
  ink,
  axis,
  translateX,
  translateY,
  width,
  height,
}: Pick<
  SizeLabelArgs,
  | 'nodePositions'
  | 'nodeShares'
  | 'axis'
  | 'translateX'
  | 'translateY'
  | 'width'
  | 'height'
> & {
  loops: readonly WalkLoop[]
  edges: readonly Pick<GraphEdge, 'from' | 'to'>[]
  folded: ReadonlySet<string> | undefined
  pxPerBp: number
  ink: LengthInk
}) {
  const { scaleX, scaleY } = axis
  const drawnLines = loopLinesCache(nodePositions, [loops], () =>
    loops.flatMap(loop => {
      const drawn = loopLine(loop.nodes, nodePositions)
      return drawn ? [{ loop, ...drawn }] : []
    }),
  )
  const screen = ({ x, y }: Point) => ({
    x: x * scaleX + translateX,
    y: y * scaleY + translateY,
  })
  const pane = { width, height }
  const seen = new Map<string, number>()
  const candidates: SizeLabelCandidate[] = []
  for (const { loop, line, ends } of drawnLines) {
    // a loop's share is its nodes' where they all have one share, as the
    // nodes of one insertion do; a loop through nodes of several has none
    const shares = new Set(loop.nodes.map(id => nodeShares?.get(id)))
    const [share] = shares.size === 1 ? shares : []
    const length = formatBpSpan(loop.least, loop.most)
    const text = share ? `${length} · ${share}` : length
    const halfW = labelHalfWidth(text)
    if (
      loop.bp * pxPerBp >= SMALL_SITE_PX &&
      polylinePx(line, scaleX, scaleY) >= (halfW * 2) / MAX_LOOP_OVERHANG &&
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
      const { drawn } = loop
      const own = ({ node, edge }: InkOwner) =>
        node !== undefined
          ? drawn.has(node)
          : edge !== undefined &&
            (drawn.has(edges[edge]?.from ?? '') ||
              drawn.has(edges[edge]?.to ?? ''))
      const onScreen = line.map(screen)
      const ownHalf = ink.widest(loop.nodes)
      const spots = LENGTH_SPOTS.map(fraction =>
        screen(polylinePointAt(line, fraction)),
      ).filter(p => onPane(p, pane))
      const along = spots
        .map(({ x, y }) => ({
          label: { ...label, x, y },
          box: boxAt(halfW, x, y),
        }))
        .filter(
          ({ box }) =>
            insideFrame(box, pane) &&
            runsOnPast(onScreen, box) &&
            runsUnderOnce(onScreen, grown(box, ownHalf)),
        )
      const [middle] = spots
      if (middle) {
        candidates.push({
          id: label.key,
          kept: false,
          middle,
          along,
          own,
          stacked: () =>
            stackedSpots(label, halfW, middle, rowsOnPane(height)).filter(
              ({ box }) => insideFrame(box, pane),
            ),
        })
      }
    }
  }
  return candidates
}

// A skip drawn as a plain link, too short to arch, has no midpoint and so no
// share
export function skipLabelCandidates({
  linkShares,
  midpoints,
  edges,
  axis,
  translateX,
  translateY,
  width,
  height,
}: Pick<
  SizeLabelArgs,
  'axis' | 'translateX' | 'translateY' | 'width' | 'height'
> & {
  linkShares: ReadonlyMap<number, string>
  midpoints: ReadonlyMap<number, Point>
  edges: readonly Pick<GraphEdge, 'from'>[]
}) {
  const pane = { width, height }
  const candidates: SizeLabelCandidate[] = []
  for (const [edge, text] of linkShares) {
    const at = midpoints.get(edge)
    const from = edges[edge]?.from
    const middle = at && {
      x: at.x * axis.scaleX + translateX,
      y: at.y * axis.scaleY + translateY,
    }
    if (middle && from !== undefined && onPane(middle, pane)) {
      const halfW = labelHalfWidth(text)
      const label = { key: `skip:${edge}`, node: from, text }
      candidates.push({
        id: label.key,
        kept: false,
        middle,
        along: [
          {
            label: { ...label, ...middle },
            box: boxAt(halfW, middle.x, middle.y),
          },
        ].filter(({ box }) => insideFrame(box, pane)),
        own: piece => piece.edge === edge,
        stacked: () =>
          stackedSpots(label, halfW, middle, rowsOnPane(height)).filter(
            ({ box }) => insideFrame(box, pane),
          ),
      })
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
  under?: LengthInk['under']
}

const gapBetween = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(0, a.x0 - b.x1, b.x0 - a.x1),
    Math.max(0, a.y0 - b.y1, b.y0 - a.y1),
  )

// Each candidate at its first free spot while the budget lasts, a
// placeholder's whatever the budget, as the `placed` lengths already spent it.
// A spot is free where no label stands on its box or on its leader's path,
// its box covers no ink `under` finds but, along the node, the strokes of the
// nodes it names, and its leader crosses no ink but theirs and their exon
// outlines. Where no spot along a node is free, its length stacks off
// the node while fewer than `leaders` stacked lengths stand, where it has
// stacked spots, and is not written where none is free. Nodes whose middles
// lie on one spot, or on a spot a length already names, take one length
// between them, the longest's, as the candidates come longest first, and no
// length stands within a line of another of its text, as nearer they read as
// one length written twice. The key counts the rest.
export function placeSizeLabels(
  candidates: SizeLabelCandidate[],
  take: TakeBox,
  {
    budget = Infinity,
    placed = [],
    leaders = Infinity,
    under = noInk,
  }: SizePlacing = {},
) {
  const lengths: PlacedLength[] = []
  const standing = placed.slice()
  const named = (spot: Point) =>
    standing.some(({ middle }) => oneSpot(middle, spot))
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
      const atFoot = (piece: InkOwner) =>
        candidate.own(piece) ||
        (piece.exon !== undefined && candidate.own({ node: piece.exon }))
      const spot =
        candidate.along.find(
          s => apart(s) && !under(s.box, candidate.own) && take(s.box),
        ) ??
        (stacked < leaders
          ? candidate.stacked?.().find(s => {
              const path = leaderPath(s.label, candidate.middle)
              return (
                apart(s) &&
                !under(s.box, noInk) &&
                !under(path, atFoot) &&
                take(s.box, path)
              )
            })
          : undefined)
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
