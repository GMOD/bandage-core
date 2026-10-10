import { panSNContig, panSNSample } from '../pansn'
import { pathOrigin } from '../pathAnchoring'

import type { Graph, GraphPath } from '../types'

// Each haplotype walk on its own bp axis, so what a walk carries through the
// window is its bar length. Reference-anchored rows cannot state that: a
// haplotype's private copies of a repeat consume no reference and collapse to
// a mark, which is why the KIV-2 array reads as a knot in every node layout
// and as a ladder here.
//
// A base-level graph does not revisit reference nodes through a repeat array,
// so a copy count is not a visit count; it is the sequence a walk spends
// between the reference nodes flanking the window, divided by the unit. Runs
// tell nodes on the reference walk's path from nodes off it. Off the path is
// an alternative route through the graph, not sequence the reference lacks: at
// a duplication the graph may route a copy the reference carries through nodes
// of its own, so an off-path run is no copy count.

export interface WalkRun {
  // bp offset from the start of this walk's slice
  start: number
  bp: number
  onReference: boolean
  // lowest reference bp an on-reference run covers; the run covers `bp` of
  // reference contiguously. In a tandem array that is the reference copy the
  // graph threads this copy through, which need not be the one it most
  // resembles.
  referenceStart?: number
  // the walk crosses that reference from its end back to its start
  reversed?: true
  // bases of the walk's contig between two pieces the cut returned: the walk
  // left the window's nodes and came back, and the cut holds nothing of them
  gap?: true
}

// Where a row's bar lies on the walk's own contig: the contig position at the
// bar's left end, and whether positions fall rightward along it
export interface WalkAxis {
  contig: string
  start: number
  reversed: boolean
}

// How a walk that reaches one flank stops: on a reference node, where its
// contig ends (`shortBp` short of the region when it never enters it), or off
// the reference, where it does not rejoin within the cut
export interface WalkStop {
  contigEnds: boolean
  shortBp: number
}

export interface WalkRow {
  name: string
  label: string
  sample: string
  haplotype?: number
  bp: number
  offReferenceBp: number
  // bp of the gap runs, counted in `bp` and not in `offReferenceBp`
  gapBp: number
  // false when the walk does not reach both flanking reference nodes; one
  // that reaches one flank is measured from it, a lower bound
  complete: boolean
  stop?: WalkStop
  runs: WalkRun[]
  // undefined where a piece states no start or overlaps the one before, so
  // bar offsets don't map linearly onto the contig
  axis?: WalkAxis
}

export interface WalkRows {
  // reference bp the rows' bars start at, so a row's x is origin + run.start
  origin: number
  // repeat unit in bp when a repeat annotation supplied one; the bars tile by it
  unit?: number
  reference: WalkRow
  // every other walk, longest first
  rows: WalkRow[]
}

function sampleOf(path: GraphPath) {
  return path.sample ?? panSNSample(path.name)
}

function labelOf(path: GraphPath) {
  return path.haplotype !== undefined && path.sample !== undefined
    ? `${path.sample}#${path.haplotype}`
    : sampleOf(path)
}

// The nodes the rows read, by index: each id's length, and the span of the
// reference walk's first visit, `onReference` 0 for a node it never visits.
// An id no node declares is a step of length 0, as in a GFA.
class NodeTable {
  index = new Map<string, number>()
  lengths: number[] = []
  onReference = new Uint8Array(0)
  referenceStart = new Float64Array(0)
  referenceEnd = new Float64Array(0)

  constructor(graph: Graph) {
    for (const node of graph.nodes) {
      this.lengths[this.indexOf(node.id)] = node.length
    }
  }

  indexOf(id: string) {
    let i = this.index.get(id)
    if (i === undefined) {
      i = this.lengths.length
      this.index.set(id, i)
      this.lengths.push(0)
    }
    return i
  }

  nodesOf(path: GraphPath) {
    const nodes = new Int32Array(path.nodeIds.length)
    path.nodeIds.forEach((id, k) => {
      nodes[k] = this.indexOf(id)
    })
    return nodes
  }

  spanAt(steps: Float64Array, k: number) {
    const node = k >= 0 && k < steps.length ? steps[k]! : -1
    return node >= 0 && this.onReference[node]
      ? { start: this.referenceStart[node]!, end: this.referenceEnd[node]! }
      : undefined
  }
}

interface Piece {
  start: number | undefined
  nodes: Int32Array
}

// A walk's steps through the cut, its pieces in contig order: a node index,
// and between two pieces of it minus the bp of contig the cut does not hold.
// A piece with no start, or one that overlaps the last, follows it directly.
function stepsOf(pieces: Piece[], table: NodeTable) {
  const out: number[] = []
  let end: number | undefined
  for (const piece of pieces) {
    if (end !== undefined && piece.start !== undefined && piece.start > end) {
      out.push(end - piece.start)
    }
    let bp = 0
    for (const node of piece.nodes) {
      out.push(node)
      bp += table.lengths[node]!
    }
    end = piece.start === undefined ? undefined : piece.start + bp
  }
  return Float64Array.from(out)
}

// Where step `k` lies on the walk's contig, steps and gaps alike; undefined
// where a piece states no start or overlaps the one before
function stepSpan(pieces: Piece[], table: NodeTable, k: number) {
  let end: number | undefined
  let at = 0
  let found: { start: number; end: number } | undefined
  for (const piece of pieces) {
    if (piece.start === undefined || (end !== undefined && piece.start < end)) {
      return undefined
    }
    if (end !== undefined && piece.start > end) {
      if (at++ === k) {
        found = { start: end, end: piece.start }
      }
    }
    let pos = piece.start
    for (const node of piece.nodes) {
      const len = table.lengths[node]!
      if (at++ === k) {
        found = { start: pos, end: pos + len }
      }
      pos += len
    }
    end = pos
  }
  return found
}

// Each walk is cut at the nearest reference nodes IT visits on either side of
// the region, so a walk that skips one flanking node at a SNP is still measured
// between flanks rather than whole. A walk with one flank is measured from it,
// in its direction along the reference.
function sliceBetween(
  steps: Float64Array,
  table: NodeTable,
  region: { start: number; end: number } | undefined,
  flanked = true,
) {
  // A cut that stops at the window carries no flanking reference for anyone,
  // so every walk is whole and the slice is the walk.
  if (!region || !flanked) {
    return { ids: steps, complete: true, from: -1, to: -1 }
  }
  const { onReference, referenceStart, referenceEnd } = table
  let i0 = -1
  let i1 = -1
  let bestEnd = -Infinity
  let bestStart = Infinity
  for (let i = 0; i < steps.length; i++) {
    const node = steps[i]!
    if (node >= 0 && onReference[node]) {
      const end = referenceEnd[node]!
      const start = referenceStart[node]!
      if (end <= region.start && end > bestEnd) {
        bestEnd = end
        i0 = i
      }
      if (start >= region.end && start < bestStart) {
        bestStart = start
        i1 = i
      }
    }
  }
  if (i0 >= 0 && i1 >= 0) {
    const ids = steps.slice(Math.min(i0, i1) + 1, Math.max(i0, i1))
    return {
      ids: i0 < i1 ? ids : ids.reverse(),
      complete: true,
      from: i0,
      to: i1,
    }
  }
  const spanAt = (k: number) => table.spanAt(steps, k)
  const flank = i0 >= 0 ? i0 : i1
  let near = -1
  for (let d = 1; flank >= 0 && near < 0 && d < steps.length; d++) {
    near = [flank - d, flank + d].find(j => spanAt(j) !== undefined) ?? -1
  }
  if (near < 0) {
    return { ids: steps, complete: false, from: -1, to: -1 }
  }
  const forward = near > flank === spanAt(near)!.start > spanAt(flank)!.start
  const after = forward === (flank === i0)
  const ids = after ? steps.slice(flank + 1) : steps.slice(0, flank).reverse()
  const last = ids.length > 0 ? ids.length - 1 : -1
  const end = last < 0 ? spanAt(flank) : spanAt(after ? flank + 1 + last : 0)
  const stop: WalkStop = {
    contigEnds: end !== undefined,
    shortBp: !end
      ? 0
      : Math.max(0, region.start - end.end, end.start - region.end),
  }
  return {
    ids,
    complete: false,
    from: flank,
    to: after ? steps.length : -1,
    stop,
  }
}

// The rows a sample filter keeps, in the order it names them
export function filterSamples<R extends { sample: string; label: string }>(
  rows: R[],
  samples: string[] | undefined,
) {
  return samples
    ? rows
        .filter(r => samples.includes(r.sample))
        .sort(
          (a, b) =>
            samples.indexOf(a.sample) - samples.indexOf(b.sample) ||
            a.label.localeCompare(b.label),
        )
    : rows
}

export function walkRows(
  graph: Graph,
  region?: { start: number; end: number },
  unit?: number,
): WalkRows | undefined {
  const paths = graph.paths ?? []
  // `referencePath` is the anchor name, which pathOrigin has already stripped
  // of the range suffix odgi leaves on a P record's name. A cut over several
  // fragments of the reference holds one record per fragment.
  const isReference = (p: GraphPath) =>
    pathOrigin(p.name).name === graph.referencePath
  const referencePieces = paths.some(isReference)
    ? paths.filter(isReference).sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    : paths.slice(0, 1)
  const first = referencePieces[0]
  const others = paths.filter(p => !referencePieces.includes(p))
  if (!first || others.length === 0) {
    return undefined
  }
  // a cut hands a walk back as one record per piece inside its nodes
  const walks = new Map<string, GraphPath[]>()
  for (const path of others) {
    const pieces = walks.get(path.name)
    if (pieces) {
      pieces.push(path)
    } else {
      walks.set(path.name, [path])
    }
  }
  const table = new NodeTable(graph)
  const referenceStart = first.start ?? 0

  const cut = region && region.end > region.start ? region : undefined
  const referenceNodes = referencePieces.map(piece => table.nodesOf(piece))
  const nodeCount = table.lengths.length
  table.onReference = new Uint8Array(nodeCount)
  table.referenceStart = new Float64Array(nodeCount)
  table.referenceEnd = new Float64Array(nodeCount)
  let reachesBefore = false
  let reachesAfter = false
  for (const [p, piece] of referencePieces.entries()) {
    let pos = piece.start ?? 0
    for (const node of referenceNodes[p]!) {
      const len = table.lengths[node]!
      if (!table.onReference[node]) {
        table.onReference[node] = 1
        table.referenceStart[node] = pos
        table.referenceEnd[node] = pos + len
        reachesBefore ||= cut !== undefined && pos + len <= cut.start
        reachesAfter ||= cut !== undefined && pos >= cut.end
      }
      pos += len
    }
  }

  // Whether the reference reaches past the region on both sides, i.e. whether
  // a flanking node exists for any walk to be cut at.
  const flanked = cut === undefined || (reachesBefore && reachesAfter)
  const rowOf = (paths: GraphPath[], nodes?: Int32Array[]): WalkRow => {
    const path = paths[0]!
    const pieces = paths
      .map((piece, p) => ({
        start: piece.start,
        nodes: nodes?.[p] ?? table.nodesOf(piece),
      }))
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    const { ids, complete, from, to, stop } = sliceBetween(
      stepsOf(pieces, table),
      table,
      cut,
      flanked,
    )
    const contig = path.contig ?? panSNContig(pathOrigin(path.name).name)
    const axisSpan = stepSpan(pieces, table, from < 0 ? 0 : from)
    const axis: WalkAxis | undefined = !axisSpan
      ? undefined
      : from < 0
        ? { contig, start: axisSpan.start, reversed: false }
        : from < to
          ? { contig, start: axisSpan.end, reversed: false }
          : { contig, start: axisSpan.start, reversed: true }
    const { lengths, onReference, referenceStart, referenceEnd } = table
    const runs: WalkRun[] = []
    let last: WalkRun | undefined
    let bp = 0
    let offReferenceBp = 0
    let gapBp = 0
    // which way the last run steps through the reference, 0 while it holds
    // one node
    let step = 0
    for (const node of ids) {
      if (node < 0) {
        last = { start: bp, bp: -node, onReference: false, gap: true }
        runs.push(last)
        bp -= node
        gapBp -= node
        step = 0
        continue
      }
      const len = lengths[node]!
      const on = onReference[node] === 1
      const at = last?.referenceStart
      const forward =
        on &&
        at !== undefined &&
        step >= 0 &&
        at + last!.bp === referenceStart[node]
      const backward =
        on && at !== undefined && step <= 0 && referenceEnd[node] === at
      if (!on && last && !last.onReference && !last.gap) {
        last.bp += len
      } else if (forward || backward) {
        last!.bp += len
        if (!forward) {
          last!.referenceStart = referenceStart[node]
          last!.reversed = true
        }
        step = forward ? 1 : -1
      } else {
        last = {
          start: bp,
          bp: len,
          onReference: on,
          referenceStart: on ? referenceStart[node] : undefined,
        }
        runs.push(last)
        step = 0
      }
      bp += len
      if (!on) {
        offReferenceBp += len
      }
    }
    return {
      name: path.name,
      label: labelOf(path),
      sample: sampleOf(path),
      haplotype: path.haplotype,
      bp,
      offReferenceBp,
      gapBp,
      complete,
      stop,
      runs,
      axis,
    }
  }

  const origin = cut ? cut.start : referenceStart
  return {
    origin,
    unit,
    reference: rowOf(referencePieces, referenceNodes),
    rows: [...walks.values()]
      .map(paths => rowOf(paths))
      .sort(
        (a, b) =>
          Number(b.complete) - Number(a.complete) ||
          b.bp - a.bp ||
          a.label.localeCompare(b.label),
      ),
  }
}
