import { tableNodeIds, tablePath } from '../gfa/graphTables'
import { gapParts } from '../gfa/walkStops'
import { panSNContig, panSNSample } from '../pansn'
import { pathOrigin } from '../pathAnchoring'
import { groupBy } from '../util/groups'

import type {
  WalkAxis,
  WalkRow,
  WalkRows,
  WalkRun,
  WalkStop,
  WalkVisit,
} from './walkRows'
import type { GraphTables } from '../gfa/graphTables'
import type { GapCause, GapPart } from '../gfa/walkStops'
import type { Graph, GraphPath, StopChunk } from '../types'

const RUN_ON_REFERENCE = 1
const RUN_REVERSED = 2
const RUN_GAP = 4
// a gap's cause, by index from bit 3
const GAP_CAUSES = [undefined, 'missing', 'elsewhere', 'unknown'] as const
const CAUSE_SHIFT = 3

const causeFlags = (cause: GapCause | undefined) =>
  GAP_CAUSES.indexOf(cause) << CAUSE_SHIFT

export type WalkRowMeta = Omit<WalkRow, 'runs' | 'visits'>

/**
 * Each row's visits, row i's at `offsets[i]` up to `offsets[i + 1]`: the
 * node as an index into `names`, its bp offset from the bar's start, its bp,
 * and 1 where the reference walk visits it anywhere in the cut
 */
export interface WalkVisitColumns {
  offsets: Uint32Array
  node: Int32Array
  start: Float64Array
  bp: Float64Array
  onReference: Uint8Array
  names: ArrayLike<string>
}

/**
 * `walkRows` with each row's runs as typed arrays, which cross from a worker
 * without an object per run. Row 0 is the reference; row i's runs are
 * `offsets[i]` up to `offsets[i + 1]`.
 */
export interface WalkRowRuns {
  origin: number
  rows: WalkRowMeta[]
  offsets: Uint32Array
  start: Float64Array
  bp: Float64Array
  // NaN for a run off the reference
  referenceStart: Float64Array
  flags: Uint8Array
  // a gap's chunk elsewhere, as an index into `chunks`, -1 for none
  chunk: Int32Array
  chunks: StopChunk[]
  visits?: WalkVisitColumns
}

type PieceHead = Omit<GraphPath, 'nodeIds'>

// Every walk piece's steps as node indices, piece i's at `from[i]` up to
// `to[i]`. An index past `lengths` is a node no segment declares, of 0 bp, as
// in a GFA.
interface Pieces {
  heads: PieceHead[]
  from: Int32Array
  to: Int32Array
  steps: Int32Array
  lengths: Int32Array
  names: ArrayLike<string>
  reference: string | undefined
}

// The reference walk's name, stripped of the range suffix odgi leaves on a P
// record's name: `referencePath`, else the walk a rank 0 segment's tag names,
// else the first walk, where gbz-base and walk-file cuts write it
function referenceOf(
  names: string[],
  referencePath: string | undefined,
  rankZero: Set<string>,
) {
  return referencePath !== undefined && names.includes(referencePath)
    ? referencePath
    : (names.find(n => rankZero.has(n)) ?? names[0])
}

export function referenceWalkName(
  graph: Pick<Graph, 'nodes' | 'paths' | 'referencePath'>,
) {
  return referenceOf(
    (graph.paths ?? []).map(p => pathOrigin(p.name).name),
    graph.referencePath,
    new Set(
      graph.nodes.flatMap(n =>
        n.stable?.rank === 0 ? [n.stable.refName] : [],
      ),
    ),
  )
}

function graphPieces(graph: Graph): Pieces {
  const index = new Map<string, number>()
  const names: string[] = []
  const lengths: number[] = []
  const indexOf = (id: string) => {
    let i = index.get(id)
    if (i === undefined) {
      i = names.length
      index.set(id, i)
      names.push(id)
      lengths.push(0)
    }
    return i
  }
  for (const node of graph.nodes) {
    lengths[indexOf(node.id)] = node.length
  }
  const heads = graph.paths ?? []
  const from = new Int32Array(heads.length)
  const to = new Int32Array(heads.length)
  const steps: number[] = []
  heads.forEach((path, p) => {
    from[p] = steps.length
    for (const id of path.nodeIds) {
      steps.push(indexOf(id))
    }
    to[p] = steps.length
  })
  return {
    heads,
    from,
    to,
    steps: Int32Array.from(steps),
    lengths: Int32Array.from(lengths),
    names,
    reference: referenceWalkName(graph),
  }
}

// The walks `graphFromTables` would build paths of, without building them
function tablePieces(
  tables: GraphTables,
  referencePath: string | undefined,
  visits: boolean | undefined,
): Pieces {
  const { nodes: n, walks: w } = tables
  const kept: number[] = []
  for (let p = 0; p < w.names.length; p++) {
    if (w.offsets[p + 1]! > w.offsets[p]!) {
      kept.push(p)
    }
  }
  const heads = kept.map(p => tablePath(w, p))
  const rankZero = new Set<string>()
  for (let i = 0; i < n.lengths.length; i++) {
    if (n.refs[i]! >= 0 && n.ranks[i] === 0) {
      rankZero.add(n.refNames[n.refs[i]!]!)
    }
  }
  return {
    heads,
    from: Int32Array.from(kept, p => w.offsets[p]!),
    to: Int32Array.from(kept, p => w.offsets[p + 1]!),
    steps: w.steps,
    lengths: n.lengths,
    // a visit names its node as the Graph does, which costs a pass over the
    // steps
    names: visits ? tableNodeIds(tables) : n.names,
    reference: referenceOf(
      heads.map(h => pathOrigin(h.name).name),
      referencePath,
      rankZero,
    ),
  }
}

function sampleOf(path: PieceHead) {
  return path.sample ?? panSNSample(path.name)
}

function labelOf(path: PieceHead) {
  return path.haplotype !== undefined && path.sample !== undefined
    ? `${path.sample}#${path.haplotype}`
    : sampleOf(path)
}

class Columns {
  values: number[][]
  offsets = [0]

  constructor(width: number) {
    this.values = Array.from({ length: width }, () => [])
  }

  get length() {
    return this.values[0]!.length
  }

  push(a: number, b: number, c: number, d: number, e?: number) {
    const v = this.values
    v[0]!.push(a)
    v[1]!.push(b)
    v[2]!.push(c)
    v[3]!.push(d)
    if (e !== undefined) {
      v[4]!.push(e)
    }
  }

  endRow() {
    this.offsets.push(this.length)
  }

  // the rows in `order`, column i in the array `make[i]` makes
  reorder(order: number[], make: ((n: number) => NumberArray)[]) {
    const offsets = new Uint32Array(order.length + 1)
    order.forEach((row, i) => {
      offsets[i + 1] = offsets[i]! + this.offsets[row + 1]! - this.offsets[row]!
    })
    const columns = make.map((m, c) => {
      const from = this.values[c]!
      const out = m(this.length)
      let at = 0
      for (const row of order) {
        for (let k = this.offsets[row]!; k < this.offsets[row + 1]!; k++) {
          out[at++] = from[k]!
        }
      }
      return out
    })
    return { offsets, columns }
  }
}

type NumberArray = Float64Array | Int32Array | Uint8Array

const float64 = (n: number) => new Float64Array(n)

/**
 * The walk rows of a Graph, or of a cut's tables without the Graph of their
 * steps, as `walkRows` reads them. Tables name their reference by
 * `referencePath`, as loadGraph does.
 *
 * Each walk is cut at the nearest reference nodes IT visits on either side of
 * the region, so a walk that skips one flanking node at a SNP is still
 * measured between flanks rather than whole. A walk with one flank, whose
 * contig ends inside the window, is the steps past that flank read in the
 * reference's direction, a lower bound.
 */
export function walkRowRuns(
  source: Graph | GraphTables,
  region?: { start: number; end: number },
  o: { visits?: boolean; referencePath?: string } = {},
): WalkRowRuns | undefined {
  const {
    heads,
    from,
    to,
    steps: all,
    lengths,
    names,
    reference,
  } = 'walks' in source
    ? tablePieces(source, o.referencePath, o.visits)
    : graphPieces(source)
  const declared = lengths.length
  const lengthOf = (node: number) => (node < declared ? lengths[node]! : 0)
  const nameOf = (p: number) => pathOrigin(heads[p]!.name).name
  const startOf = (p: number) => heads[p]!.start
  const byStart = (a: number, b: number) =>
    (startOf(a) ?? 0) - (startOf(b) ?? 0)
  // a cut over several fragments of the reference holds one record per
  // fragment
  const pieceIds = heads.map((_, p) => p)
  const referencePieces = pieceIds
    .filter(p => nameOf(p) === reference)
    .sort(byStart)
  const first = referencePieces[0]
  const others = pieceIds.filter(p => nameOf(p) !== reference)
  if (first === undefined || others.length === 0) {
    return undefined
  }
  // a cut hands a walk back as one record per piece inside its nodes
  const walks = groupBy(others, nameOf)

  // each node's span on the reference's first visit, NaN where it never visits
  const spanStart = new Float64Array(names.length).fill(Number.NaN)
  const spanEnd = new Float64Array(names.length)
  // every visit's start for a node the reference walks more than once, as a
  // collapsed repeat makes it
  const revisits = new Map<number, number[]>()
  let reachesBefore = false
  let reachesAfter = false
  const cut = region && region.end > region.start ? region : undefined
  for (const piece of referencePieces) {
    let pos = startOf(piece) ?? 0
    for (let s = from[piece]!, stop = to[piece]!; s < stop; s++) {
      const node = all[s]!
      const len = lengthOf(node)
      if (!Number.isNaN(spanStart[node]!)) {
        const starts = revisits.get(node)
        if (starts) {
          starts.push(pos)
        } else {
          revisits.set(node, [spanStart[node]!, pos])
        }
      } else {
        spanStart[node] = pos
        spanEnd[node] = pos + len
        if (cut) {
          reachesBefore ||= pos + len <= cut.start
          reachesAfter ||= pos >= cut.end
        }
      }
      pos += len
    }
  }
  // A cut that stops at the window carries no flanking reference for anyone,
  // so every walk is whole and the slice is the walk.
  const flanked = cut === undefined || (reachesBefore && reachesAfter)

  const runs = new Columns(5)
  const chunks: StopChunk[] = []
  const chunkIndex = new Map<string, number>()
  const chunkOf = (chunk: StopChunk | undefined) => {
    if (!chunk) {
      return -1
    }
    const key = `${chunk.refName}:${chunk.start}`
    let i = chunkIndex.get(key)
    if (i === undefined) {
      i = chunks.length
      chunkIndex.set(key, i)
      chunks.push(chunk)
    }
    return i
  }
  const visits = o.visits ? new Columns(4) : undefined
  // the walk's steps, each gap between its pieces a step of -bp; reused
  // across rows
  let steps = new Int32Array(0)
  let stepStart = new Float64Array(0)

  const rowOf = (pieces: number[]): WalkRowMeta => {
    const head = heads[pieces[0]!]!
    const ordered = [...pieces].sort(byStart)
    let count = ordered.length - 1
    for (const piece of ordered) {
      count += to[piece]! - from[piece]!
    }
    if (count > steps.length) {
      steps = new Int32Array(count * 2)
      stepStart = new Float64Array(count * 2)
    }
    let length = 0
    // a piece with no start, or one overlapping the last, leaves bar offsets
    // no linear map onto the contig
    let unplaced = false
    let end: number | undefined
    let previous: number | undefined
    const partsAt = new Map<number, GapPart[]>()
    for (const piece of ordered) {
      const start = startOf(piece)
      if (start === undefined || (end !== undefined && start < end)) {
        unplaced = true
      }
      if (end !== undefined && start !== undefined && start > end) {
        partsAt.set(
          length,
          gapParts(
            start - end,
            previous === undefined ? undefined : heads[previous]!.after,
            heads[piece]!.before,
          ),
        )
        steps[length] = -(start - end)
        stepStart[length++] = end
      }
      let pos = start ?? 0
      for (let s = from[piece]!, stop = to[piece]!; s < stop; s++) {
        const node = all[s]!
        steps[length] = node
        stepStart[length++] = pos
        pos += lengthOf(node)
      }
      end = start === undefined ? undefined : pos
      previous = piece
    }
    const onReference = (i: number) =>
      i >= 0 &&
      i < length &&
      steps[i]! >= 0 &&
      !Number.isNaN(spanStart[steps[i]!]!)
    const stepEnd = (i: number) => {
      const id = steps[i]!
      return stepStart[i]! + (id < 0 ? -id : lengthOf(id))
    }
    // Which side of a lone flank is inside the window follows the walk's
    // direction along the reference there, from the nearest other step on it.
    const partialSide = (i0: number, i1: number) => {
      const flank = i0 >= 0 ? i0 : i1
      let near = -1
      for (let d = 1; near < 0 && d < length; d++) {
        near = [flank - d, flank + d].find(onReference) ?? -1
      }
      if (near < 0) {
        return undefined
      }
      const forward =
        near > flank === spanStart[steps[near]!]! > spanStart[steps[flank]!]!
      const after = forward === (flank === i0)
      const last = after ? length - 1 : 0
      const contigEnds = onReference(last)
      const stop: WalkStop = {
        contigEnds,
        shortBp: contigEnds
          ? Math.max(
              0,
              cut!.start - spanEnd[steps[last]!]!,
              spanStart[steps[last]!]! - cut!.end,
            )
          : 0,
      }
      return {
        stop,
        lo: after ? flank + 1 : 0,
        hi: after ? length : flank,
        backward: !forward,
        axisStart: forward
          ? after
            ? stepEnd(flank)
            : stepStart[0]!
          : after
            ? stepEnd(length - 1)
            : stepStart[flank]!,
      }
    }

    let lo = 0
    let hi = length
    let backward = false
    let complete = true
    let flankFrom = -1
    let flankTo = -1
    let axisStart: number | undefined
    let stop: WalkStop | undefined
    if (cut && flanked) {
      let i0 = -1
      let i1 = -1
      let bestEnd = -Infinity
      let bestStart = Infinity
      for (let i = 0; i < length; i++) {
        const id = steps[i]!
        if (id >= 0 && !Number.isNaN(spanStart[id]!)) {
          if (spanEnd[id]! <= cut.start && spanEnd[id]! > bestEnd) {
            bestEnd = spanEnd[id]!
            i0 = i
          }
          if (spanStart[id]! >= cut.end && spanStart[id]! < bestStart) {
            bestStart = spanStart[id]!
            i1 = i
          }
        }
      }
      if (i0 < 0 || i1 < 0) {
        complete = false
        const inside = i0 >= 0 || i1 >= 0 ? partialSide(i0, i1) : undefined
        if (inside) {
          ;({ lo, hi, backward, axisStart, stop } = inside)
        }
      } else {
        lo = Math.min(i0, i1) + 1
        hi = Math.max(i0, i1)
        backward = i0 > i1
        flankFrom = i0
        flankTo = i1
      }
    }
    const contig = head.contig ?? panSNContig(pathOrigin(head.name).name)
    const axis: WalkAxis | undefined =
      unplaced || length === 0
        ? undefined
        : axisStart !== undefined
          ? { contig, start: axisStart, reversed: backward }
          : flankFrom < 0
            ? { contig, start: stepStart[0]!, reversed: false }
            : flankFrom < flankTo
              ? { contig, start: stepEnd(flankFrom), reversed: false }
              : { contig, start: stepStart[flankFrom]!, reversed: true }

    let bp = 0
    let offReferenceBp = 0
    let gapBp = 0
    // which way the last run steps through the reference, 0 while it holds
    // one node
    let step = 0
    let last = -1
    let lastFlags = 0
    let lastRef = Number.NaN
    // where the walk last left the reference, kept across the runs off it
    let cursor = Number.NaN
    // A node the reference walks more than once takes the visit nearest where
    // the walk left the reference, so a copy of a collapsed repeat follows the
    // reference copy it continues; the first visit where nothing precedes it
    const placeOf = (id: number) => {
      const starts = revisits.get(id)
      if (!starts || Number.isNaN(cursor)) {
        return spanStart[id]!
      }
      const len = lengthOf(id)
      let best = starts[0]!
      let bestGap = Infinity
      for (const start of starts) {
        const gap = Math.min(
          Math.abs(start - cursor),
          Math.abs(start + len - cursor),
        )
        if (gap < bestGap) {
          best = start
          bestGap = gap
        }
      }
      return best
    }
    const [, runBp, runRef, runFlags] = runs.values as [
      number[],
      number[],
      number[],
      number[],
      number[],
    ]
    for (let k = lo; k < hi; k++) {
      const index = backward ? hi - 1 - (k - lo) : k
      const id = steps[index]!
      if (id < 0) {
        const parts = partsAt.get(index)!
        // a row read backwards meets a gap's parts last first
        for (const part of backward ? [...parts].reverse() : parts) {
          runs.push(
            bp,
            part.bp,
            Number.NaN,
            RUN_GAP | causeFlags(part.cause),
            chunkOf(part.chunk),
          )
          bp += part.bp
        }
        last = runs.length - 1
        lastFlags = RUN_GAP
        lastRef = Number.NaN
        gapBp += -id
        step = 0
        continue
      }
      const len = lengthOf(id)
      const at = placeOf(id)
      const on = !Number.isNaN(at)
      visits?.push(id, bp, len, on ? 1 : 0)
      const placed = last >= 0 && !Number.isNaN(lastRef)
      const forward =
        on && placed && step >= 0 && lastRef + (runBp[last] ?? 0) === at
      const back = on && placed && step <= 0 && at + len === lastRef
      if (!on && last >= 0 && !(lastFlags & (RUN_ON_REFERENCE | RUN_GAP))) {
        runBp[last]! += len
      } else if (forward || back) {
        runBp[last]! += len
        if (!forward) {
          lastRef = at
          runRef[last] = at
          lastFlags |= RUN_REVERSED
          runFlags[last] = lastFlags
        }
        step = forward ? 1 : -1
      } else {
        lastFlags = on ? RUN_ON_REFERENCE : 0
        lastRef = on ? at : Number.NaN
        runs.push(bp, len, lastRef, lastFlags, -1)
        last = runs.length - 1
        step = 0
      }
      bp += len
      if (on) {
        cursor = step < 0 ? at : at + len
      } else {
        offReferenceBp += len
      }
    }
    runs.endRow()
    visits?.endRow()
    return {
      name: head.name,
      label: labelOf(head),
      sample: sampleOf(head),
      haplotype: head.haplotype,
      bp,
      offReferenceBp,
      gapBp,
      complete,
      stop,
      axis,
    }
  }

  const referenceRow = rowOf(referencePieces)
  const rows = [...walks.values()].map((pieces, i) => ({
    meta: rowOf(pieces),
    row: i + 1,
  }))
  rows.sort(
    (a, b) =>
      Number(b.meta.complete) - Number(a.meta.complete) ||
      b.meta.bp - a.meta.bp ||
      a.meta.label.localeCompare(b.meta.label),
  )
  const order = [0, ...rows.map(r => r.row)]
  const { offsets, columns } = runs.reorder(order, [
    float64,
    float64,
    float64,
    n => new Uint8Array(n),
    n => new Int32Array(n),
  ])
  const [start, bp, referenceStart, flags, chunk] = columns as [
    Float64Array,
    Float64Array,
    Float64Array,
    Uint8Array,
    Int32Array,
  ]
  return {
    origin: cut ? cut.start : (startOf(first) ?? 0),
    rows: [referenceRow, ...rows.map(r => r.meta)],
    offsets,
    start,
    bp,
    referenceStart,
    flags,
    chunk,
    chunks,
    visits: visits && visitColumns(visits, order, names),
  }
}

function visitColumns(
  visits: Columns,
  order: number[],
  names: ArrayLike<string>,
): WalkVisitColumns {
  const { offsets, columns } = visits.reorder(order, [
    n => new Int32Array(n),
    float64,
    float64,
    n => new Uint8Array(n),
  ])
  const [node, start, bp, onReference] = columns as [
    Int32Array,
    Float64Array,
    Float64Array,
    Uint8Array,
  ]
  return { offsets, node, start, bp, onReference, names }
}

export function runAt(t: WalkRowRuns, k: number): WalkRun {
  const f = t.flags[k]!
  const run: WalkRun = {
    start: t.start[k]!,
    bp: t.bp[k]!,
    onReference: (f & RUN_ON_REFERENCE) !== 0,
  }
  if (f & RUN_GAP) {
    run.gap = true
    const cause = GAP_CAUSES[(f >> CAUSE_SHIFT) & 3]
    if (cause) {
      run.cause = cause
    }
    const chunk = t.chunks[t.chunk[k]!]
    if (chunk) {
      run.chunk = chunk
    }
  } else {
    run.referenceStart = Number.isNaN(t.referenceStart[k]!)
      ? undefined
      : t.referenceStart[k]
  }
  if (f & RUN_REVERSED) {
    run.reversed = true
  }
  return run
}

function visitsOf(v: WalkVisitColumns, row: number) {
  const out: WalkVisit[] = []
  for (let k = v.offsets[row]!; k < v.offsets[row + 1]!; k++) {
    out.push({
      node: v.names[v.node[k]!]!,
      start: v.start[k]!,
      bp: v.bp[k]!,
      onReference: v.onReference[k] === 1,
    })
  }
  return out
}

/** The rows as `WalkRows`, an object per run, and per visit where it has them */
export function walkRowsOf(t: WalkRowRuns, unit?: number): WalkRows {
  const rows = t.rows.map((meta, i): WalkRow => {
    const runs: WalkRun[] = []
    for (let k = t.offsets[i]!; k < t.offsets[i + 1]!; k++) {
      runs.push(runAt(t, k))
    }
    return {
      ...meta,
      runs,
      visits: t.visits && visitsOf(t.visits, i),
    }
  })
  return { origin: t.origin, unit, reference: rows[0]!, rows: rows.slice(1) }
}
