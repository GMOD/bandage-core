import { firstNodeAtOrAfter, isBackbone } from './anchoredNodes'
import { unclipped } from './layout/trimToWindow'
import { referenceVisitStarts } from './pathAnchoring'
import {
  computeEdgeCurves,
  edgeJoinOf,
  routedEdgeCurves,
  strandSides,
} from './util/geometry'
import { groupBy } from './util/groups'
import { partitionPoint } from './util/partitionPoint'

import type { AnchoredNode } from './anchoredNodes'
import type { Graph, GraphEdge, NodeSegment } from './types'
import type { AxisScale } from './util/geometry'

// A deletion is the one kind of variation this view could not draw, and the
// reason is structural rather than cosmetic: extra sequence is a *node*, so it
// gets a tube, a colour and a hover. Missing sequence is an **edge** — a link
// from one backbone segment to another that is not its neighbour — and every
// edge in the drawing was painted the same grey, so the graph said nothing about
// the events a linear view is worst at.
//
// It needs no new data. Both endpoints of such an edge carry rGFA coordinates on
// the same stable sequence, so the bp the haplotype skips is the gap between
// them, and the whole classification is arithmetic on SN/SO plus the segment
// lengths already parsed. `agent-docs/reference/PANGENOME_GRAPHS.md` in
// jbrowse-components measured what this finds on the hosted HPRC graph: 8
// deletions in the 200 kb MHC class II window against 78 attributed alleles, 1
// in the 70 kb C4 window.
//
// Two things this deliberately does not do:
//
//   - it does not attribute the deletion to a haplotype. A backbone-to-backbone
//     skip has GRCh38 at both ends, so there is no `SN` naming a donor, and the
//     same reference note records why: a deletion only carries a donor when it
//     also carries novel sequence, and then it is not a clean deletion any more.
//   - it does not treat a same-position link as a deletion. Adjacent backbone
//     segments abut (gap 0) and a substitution's flanks can overlap by the
//     aligned bases, so only a positive gap counts.

// A skip has to clear this to be drawn as a deletion. minigraph's SV-resolution
// graph does not record anything smaller than tens of bp, so this is not a
// biological threshold but a guard against calling a rounding artifact a
// deletion — abutting segments are the common case and they must not light up.
const MIN_DELETION_BP = 1

export interface DeletionEdge {
  // index into graph.edges, which is what the renderer keys its curve ranges by
  edgeIndex: number
  // the edge's own endpoints, so anything that needs the arc as it is DRAWN can
  // rebuild it (edgeCurvesOf) instead of approximating it from `bypassed`
  from: string
  to: string
  fromStrand?: '+' | '-'
  toStrand?: '+' | '-'
  refName: string
  start: number
  end: number
  bp: number
  // Backbone node ids whose reference interval lies inside the skipped span:
  // the route a haplotype taking this edge does NOT take. An anchored layout
  // bows the deletion's arc around them; a force layout sizes its route off
  // them (deletionRoutes.ts).
  bypassed: string[]
}

// Where the backbone this deletion bypasses is drawn, as points. `bowAround`
// turns them into how far and which way the arc bows; this only has to say which
// points they are, and is shared so the geometry that draws the arc, the index
// that hit-tests it and the overlay that labels it all bow around the same run.
function bypassedPoints(
  nodePositions: Record<string, { x: number; y: number }[]>,
  bypassed: string[],
) {
  return bypassed.flatMap(id => nodePositions[id] ?? [])
}

// An edge's curve as drawn: along its route where a force layout ran one,
// else bowed round what it bypasses. Undefined where an end has no position.
export function edgeCurvesOf(
  nodePositions: Record<string, NodeSegment[]>,
  edge: GraphEdge,
  axis: AxisScale,
  bypassed: string[] | undefined,
  route: NodeSegment[] | undefined,
  stranded: boolean,
) {
  const from = nodePositions[edge.from]
  const to = nodePositions[edge.to]
  if (!from?.length || !to?.length) {
    return undefined
  }
  return route
    ? routedEdgeCurves(
        from,
        to,
        route,
        stranded ? strandSides(edge) : undefined,
      )
    : computeEdgeCurves(
        from,
        to,
        edgeJoinOf(edge, stranded),
        axis,
        bypassed ? bypassedPoints(nodePositions, bypassed) : [],
      )
}

// The backbone by stable sequence, each sorted by start, so the run a deletion
// bypasses is a slice rather than a scan. Filtering the whole backbone per
// candidate edge is O(edges x backbone), which at the node budget this view
// accepts (20,000) is hundreds of millions of comparisons for a pass that runs
// once per graph.
function backboneBySequence(graph: Graph) {
  const bySequence = groupBy(
    graph.nodes.filter(isBackbone),
    node => node.stable.refName,
  )
  for (const list of bySequence.values()) {
    list.sort((a, b) => a.stable.start - b.stable.start)
  }
  return bySequence
}

// Backbone nodes lying wholly inside [start, end) on `refName`. Sorted by
// start, so the candidates are one contiguous run and the walk stops at the
// first node starting past the end; only the upper bound still needs testing
// per node, since a long node can start inside and finish outside.
function bypassedNodes(
  nodes: AnchoredNode[] | undefined,
  start: number,
  end: number,
) {
  const bypassed: string[] = []
  if (nodes) {
    for (let i = firstNodeAtOrAfter(nodes, start); i < nodes.length; i++) {
      const node = nodes[i]!
      if (node.stable.start >= end) {
        break
      }
      if (node.stable.start + node.length <= end) {
        bypassed.push(node.id)
      }
    }
  }
  return bypassed
}

// A link leaves the END of `from` as it reads it and arrives at the START of
// `to`. Read the way the reference reads a node, its end is its right side, so
// a link leaves `from` on the right when the two readings agree and arrives at
// `to` on the left when they do.
//
// A deletion joins the right side of the left node to the left side of the
// right one, from whichever strand the file states it: `L 1 + 3 +`, or the
// same link as `L 3 - 1 -`. `L 3 + 1 +` joins the right side of the RIGHT node
// to the left side of the left one, sequence read again, a duplication. A link
// with one reading against the reference lands on a node's far side, an
// inversion. Neither skips anything. Coordinates alone could not tell them
// from a deletion: each was drawn as one, and hidden with them by default.
//
// A link stating no strands is judged by its coordinates, as all once were.
function skipsBetween(
  edge: GraphEdge,
  from: AnchoredNode,
  to: AnchoredNode,
  forwards: boolean,
) {
  const { fromStrand, toStrand } = edge
  if (fromStrand === undefined || toStrand === undefined) {
    return true
  }
  const leavesRight = fromStrand === (from.stable.strand ?? '+')
  const arrivesLeft = toStrand === (to.stable.strand ?? '+')
  return forwards ? leavesRight && arrivesLeft : !leavesRight && !arrivesLeft
}

// The span a link skips, measured at the reference visits nearest each other
// whose sides it joins as a deletion would: a link a collapsed repeat's second
// copy walks joins its nodes there, and abuts, though their first visits lie a
// copy apart. Undefined where no pair of visits has it skip forwards.
function skippedSpan(
  edge: GraphEdge,
  from: AnchoredNode,
  to: AnchoredNode,
  startsOf: (node: AnchoredNode) => number[],
) {
  let best: { start: number; end: number } | undefined
  for (const a of startsOf(from)) {
    for (const b of startsOf(to)) {
      const forwards = a <= b
      const span = forwards
        ? { start: a + from.length, end: b }
        : { start: b + to.length, end: a }
      if (
        skipsBetween(edge, from, to, forwards) &&
        (!best ||
          Math.abs(span.end - span.start) < Math.abs(best.end - best.start))
      ) {
        best = span
      }
    }
  }
  return best
}

// A skip this close to a collapsed repeat's copy length, as a share of it,
// steps between copies; the copies of one repeat differ by small indels
const COPY_SWITCH_SHARE = 0.01

// Where the reference walks a node again on each sequence: every visit but the
// last, sorted, with the bp to the node's next visit, the length of the copy
// of a collapsed repeat that visit starts
function repeatCopies(
  backbone: Map<string, AnchoredNode[]>,
  startsOf: (node: AnchoredNode) => number[],
) {
  const bySequence = new Map<string, { at: number; copy: number }[]>()
  for (const [refName, nodes] of backbone) {
    const copies = nodes.flatMap(node => {
      const starts = startsOf(node)
      return starts.slice(1).map((next, i) => ({
        at: starts[i]!,
        copy: next - starts[i]!,
      }))
    })
    if (copies.length) {
      bySequence.set(
        refName,
        copies.sort((a, b) => a.at - b.at),
      )
    }
  }
  return bySequence
}

// A collapsed repeat's copies share its nodes but for where they differ, and a
// walk that leaves one copy's own node for the next copy's at the same place
// links two nodes a copy apart. That link skips nothing: the copy count is
// which way a walk goes round the repeat's loop.
function switchesCopy(
  copies: { at: number; copy: number }[] | undefined,
  start: number,
  bp: number,
) {
  if (!copies) {
    return false
  }
  const i = partitionPoint(copies.length, k => copies[k]!.at < start)
  const near = [copies[i - 1], copies[i]]
    .filter(c => c !== undefined)
    .sort((a, b) => Math.abs(a.at - start) - Math.abs(b.at - start))[0]
  return (
    near !== undefined &&
    Math.abs(near.at - start) <= near.copy &&
    Math.abs(bp - near.copy) <= near.copy * COPY_SWITCH_SHARE
  )
}

// Every edge that skips reference sequence, in graph.edges order. A segment
// cut back to a window is measured in full: its cut end is no gap.
export function deletionEdges(cut: Graph): DeletionEdge[] {
  const graph = unclipped(cut)
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const backbone = backboneBySequence(graph)
  const startsOf = referenceVisitStarts(graph)
  const copies = repeatCopies(backbone, startsOf)
  const found: DeletionEdge[] = []
  for (let edgeIndex = 0; edgeIndex < graph.edges.length; edgeIndex++) {
    const edge = graph.edges[edgeIndex]!
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (
      !edge.foldBridge &&
      from !== undefined &&
      to !== undefined &&
      isBackbone(from) &&
      isBackbone(to) &&
      from.stable.refName === to.stable.refName
    ) {
      // Which endpoint is upstream comes from the coordinates, since a file
      // may state a link from either strand. Whether it SKIPS what lies
      // between comes from its sides: a deletion leaves the right side of the
      // left node and arrives at the left side of the right one.
      const span = skippedSpan(edge, from, to, startsOf)
      const refName = from.stable.refName
      const bp = span ? span.end - span.start : 0
      if (
        span &&
        bp >= MIN_DELETION_BP &&
        !switchesCopy(copies.get(refName), span.start, bp)
      ) {
        const { start, end } = span
        found.push({
          edgeIndex,
          from: edge.from,
          to: edge.to,
          ...(edge.fromStrand ? { fromStrand: edge.fromStrand } : {}),
          ...(edge.toStrand ? { toStrand: edge.toStrand } : {}),
          refName,
          start,
          end,
          bp,
          bypassed: bypassedNodes(backbone.get(refName), start, end),
        })
      }
    }
  }
  return found
}

// The deletions a layout without them can leave out: every one whose ends the
// rest of the graph still joins. A cut window can keep a deletion's ends but
// lose a link in the reference between them, and dropping that deletion would
// split the graph.
export function closableDeletions(graph: Graph, deletions: DeletionEdge[]) {
  const parent = new Map<string, string>()
  const root = (id: string) => {
    let r = id
    while (parent.has(r)) {
      r = parent.get(r)!
    }
    if (r !== id) {
      parent.set(id, r)
    }
    return r
  }
  const join = (a: string, b: string) => {
    const [ra, rb] = [root(a), root(b)]
    if (ra !== rb) {
      parent.set(ra, rb)
    }
    return ra !== rb
  }
  const candidates = new Set(deletions.map(d => d.edgeIndex))
  graph.edges.forEach((e, ei) => {
    if (!candidates.has(ei)) {
      join(e.from, e.to)
    }
  })
  return new Set(
    deletions.filter(d => !join(d.from, d.to)).map(d => d.edgeIndex),
  )
}

export interface DeletionDrawing {
  // the deletions drawn, which their labels name
  shown: DeletionEdge[]
  // the backbone each deletion bypasses by edge index, as the geometry and the
  // hit index take it
  bypassed: Map<number, string[]>
  hidden: ReadonlySet<number>
}

const drawings = new WeakMap<DeletionEdge[], Map<boolean, DeletionDrawing>>()

// How a drawing shows a graph's deletions, the same object for the same
// arguments so caches keyed on it hold. With deletion edges off it still draws
// those a layout without them keeps, so what the layout joined stays joined.
export function deletionDrawing(
  graph: Graph,
  deletions: DeletionEdge[],
  show = true,
) {
  let byShow = drawings.get(deletions)
  if (!byShow) {
    byShow = new Map()
    drawings.set(deletions, byShow)
  }
  let drawing = byShow.get(show)
  if (!drawing) {
    const hidden = show
      ? new Set<number>()
      : closableDeletions(graph, deletions)
    drawing = {
      shown: deletions.filter(d => !hidden.has(d.edgeIndex)),
      bypassed: new Map(deletions.map(d => [d.edgeIndex, d.bypassed])),
      hidden,
    }
    byShow.set(show, drawing)
  }
  return drawing
}
