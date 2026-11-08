import {
  departureAt,
  departureSpan,
  gapParts,
  placementChoice,
} from '../gfa/departures'
import { tableNodeIds, tablePath } from '../gfa/graphTables'
import { panSNContig, panSNFields, panSNHaplotype, panSNSample } from '../pansn'
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
import type { Departure, GapCause, GapPart } from '../gfa/departures'
import type { DepartureTable, GraphTables } from '../gfa/graphTables'
import type { Graph, GraphPath } from '../types'

const RUN_ON_REFERENCE = 1
const RUN_REVERSED = 2
const RUN_GAP = 4
// a gap's cause, by index from bit 3
const GAP_CAUSES = [
  undefined,
  'missing',
  'elsewhere',
  'own',
  'abridged',
  'departure',
] as const
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
  // an `elsewhere` gap's reference position, NaN for none
  near: Float64Array
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
  // a node's rank 0 position on the reference, NaN off it
  stableStart: (node: number) => number
  departures: DepartureTable | undefined
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

// whether a stable tag's sequence name is the reference walk, by its name or
// its contig's
const namesReference = (reference: string | undefined) => {
  const contig = reference && panSNContig(reference)
  return (name: string | undefined) =>
    name !== undefined && (name === reference || name === contig)
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
  const reference = referenceWalkName(graph)
  const onReferenceContig = namesReference(reference)
  const stable = new Map<number, number>()
  for (const node of graph.nodes) {
    const i = indexOf(node.id)
    lengths[i] = node.length
    if (node.stable?.rank === 0 && onReferenceContig(node.stable.refName)) {
      stable.set(i, node.stable.start)
    }
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
    reference,
    stableStart: node => stable.get(node) ?? Number.NaN,
    departures: graph.departures,
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
  const reference = referenceOf(
    heads.map(h => pathOrigin(h.name).name),
    referencePath,
    rankZero,
  )
  const onReferenceContig = namesReference(reference)
  return {
    heads,
    from: Int32Array.from(kept, p => w.offsets[p]!),
    to: Int32Array.from(kept, p => w.offsets[p + 1]!),
    steps: w.steps,
    lengths: n.lengths,
    // a visit names its node as the Graph does, which costs a pass over the
    // steps
    names: visits ? tableNodeIds(tables) : n.names,
    reference,
    stableStart: node =>
      node < n.lengths.length &&
      n.ranks[node] === 0 &&
      onReferenceContig(n.refNames[n.refs[node]!])
        ? n.starts[node]!
        : Number.NaN,
    departures: tables.departures,
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
 * measured between flanks rather than whole. A walk with one flank is the
 * steps past that flank read in the reference's direction, a lower bound.
 * Its contig ends at its last step there only where that step is on the
 * reference, the walk has no departure leaving or rejoining at it, and the
 * cut trimmed none of its bp past it; else it goes on (`WalkStop`). A walk
 * file's fragment always ends on the reference, so its end alone says
 * nothing.
 *
 * The window's side of a lone flank is the way the walk runs along the
 * reference there, read from its nearest other step on it. Where the flank is
 * the walk's only step, it is read from a departure at that step, whose strand
 * there is the walk's; else from the bp the cut trimmed off one side alone,
 * the side the walk came from; and with both sides trimmed or neither, both
 * say the same. Nothing past the flank is in the window, so the row has no bp.
 *
 * A cut with no flanking reference stands the reference's outermost nodes in
 * the cut in for the flanks, counted inside the window. A walk on both is
 * whole; on one, it stops inside as a walk with one flank does, measured from
 * that node; on neither, it is partial. The source decides whether a walk
 * is read so: a walk file's tables state each walk's trimmed bp, 0 included,
 * so there a side with none and no departure is where the contig ends. A
 * source that states no trimmed bp, GFA text or a gbz-base extract, clips its
 * paths at the subgraph's edge, so where they end says nothing and each walk
 * is the slice whole.
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
    stableStart,
    departures,
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
  const departuresOf = departuresByWalk(departures, reference)
  if (first === undefined || (others.length === 0 && departuresOf.size === 0)) {
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
  // the last reference node before the window ends at flankEnd, and the first
  // after it starts at flankStart
  let flankEnd = -Infinity
  let flankStart = Infinity
  // where the reference's nodes in the cut start and end
  let referenceLo = Infinity
  let referenceHi = -Infinity
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
        referenceLo = Math.min(referenceLo, pos)
        referenceHi = Math.max(referenceHi, pos + len)
        if (cut) {
          if (pos + len <= cut.start) {
            flankEnd = Math.max(flankEnd, pos + len)
          }
          if (pos >= cut.end) {
            flankStart = Math.min(flankStart, pos)
          }
        }
      }
      pos += len
    }
  }
  // a cut that stops at the window carries no flanking reference for anyone
  const flanked =
    cut === undefined || (flankEnd > -Infinity && flankStart < Infinity)

  const runs = new Columns(5)
  const visits = o.visits ? new Columns(4) : undefined
  // the walk's steps, each gap between its pieces a step of -bp; reused
  // across rows
  let steps = new Int32Array(0)
  let stepStart = new Float64Array(0)

  // Each of a stepless row's departures as a hairline under the stretch of
  // the reference row's bar between its ends; the bp of those runs
  const departureRuns = (
    own: Departure[],
    bar: { start: number; end: number } | undefined,
  ) => {
    const spans = own.map(departureSpan).sort((a, b) => a.start - b.start)
    const base = bar?.start ?? spans[0]?.start ?? 0
    const merged: { start: number; end: number }[] = []
    for (const span of spans) {
      const start = bar ? Math.max(span.start, bar.start) : span.start
      const end = bar ? Math.min(span.end, bar.end) : span.end
      const last = merged.at(-1)
      if (end > start) {
        if (last && start <= last.end) {
          last.end = Math.max(last.end, end)
        } else {
          merged.push({ start, end })
        }
      }
    }
    let gapBp = 0
    for (const { start, end } of merged) {
      runs.push(
        start - base,
        end - start,
        Number.NaN,
        RUN_GAP | causeFlags('departure'),
        Number.NaN,
      )
      gapBp += end - start
    }
    return gapBp
  }

  // A row with no step on the window's reference draws no bar: its departures
  // alone, and the own bp between their ends
  const steplessMeta = (
    head: PieceHead,
    own: Departure[],
    gapBp: number,
  ): WalkRowMeta => ({
    name: head.name,
    label: labelOf(head),
    sample: sampleOf(head),
    haplotype: head.haplotype,
    bp: 0,
    offReferenceBp: own.reduce((sum, d) => sum + d.ownBp, 0),
    gapBp,
    complete: true,
    stop: undefined,
    axis: undefined,
    departures: own,
    stepless: true,
    ...(own.some(placementChoice) ? { placementChoice: true as const } : {}),
  })

  // `bar` is the reference row's, which the walks' rows are read against
  const rowOf = (
    pieces: number[],
    bar?: { start: number; end: number },
  ): WalkRowMeta => {
    const head = heads[pieces[0]!]!
    const own = departuresOf.get(nameOf(pieces[0]!)) ?? []
    // where each placed piece runs on the contig
    const extents: [number, number][] = []
    const ordered = [...pieces].sort(byStart)
    let count = ordered.length - 1
    let abridgedSteps = 0
    for (const piece of ordered) {
      count += to[piece]! - from[piece]! + (heads[piece]!.abridged ? 1 : 0)
      abridgedSteps += heads[piece]!.abridged?.steps ?? 0
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
    // An abridged row's bp covers all its pieces, so its bar runs past the
    // loaded pieces between them, and the jumps between those pieces cover
    // the bp it already drew
    let owed = 0
    for (const piece of ordered) {
      const start = startOf(piece)
      const jump = start === undefined || end === undefined ? 0 : start - end
      if (start === undefined || jump < 0) {
        unplaced = true
      }
      if (jump < 0 && heads[previous!]!.abridged) {
        owed -= jump
      }
      const covered = Math.min(owed, Math.max(jump, 0))
      owed -= covered
      const gap = jump - covered
      if (gap > 0) {
        partsAt.set(
          length,
          gapParts(
            start! - gap,
            start!,
            {
              after: heads[previous!]!.trimmedAfter,
              before: heads[piece]!.trimmedBefore,
            },
            own,
          ),
        )
        steps[length] = -gap
        stepStart[length++] = end!
      }
      let pos = start ?? 0
      const abridged = heads[piece]!.abridged
      for (let s = from[piece]!, stop = to[piece]!; s < stop; s++) {
        const node = all[s]!
        const bp = abridged
          ? abridged.bp - (pos - (start ?? 0)) - lengthOf(node)
          : 0
        if (bp > 0 && s === stop - 1 && s > from[piece]!) {
          partsAt.set(length, [{ bp, cause: 'abridged' }])
          steps[length] = -bp
          stepStart[length++] = pos
          pos += bp
        }
        steps[length] = node
        stepStart[length++] = pos
        pos += lengthOf(node)
      }
      end = start === undefined ? undefined : pos
      if (start !== undefined) {
        extents.push([start, pos])
      }
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
    // The walk's contig past its last step (`after`) or before its first: the
    // departure leaving or rejoining at that step, and the bp the cut trimmed
    // off that side
    const endOf = (after: boolean) => {
      const last = after ? length - 1 : 0
      const edge = after ? stepEnd(last) : stepStart[last]!
      return {
        last,
        departure: own.find(d =>
          after ? d.hapStart === edge : d.hapStart + d.ownBp === edge,
        ),
        trimmed: after
          ? heads[ordered.at(-1)!]!.trimmedAfter
          : heads[ordered[0]!]!.trimmedBefore,
      }
    }
    // Whether the walk runs rightward along the reference at a lone flank,
    // the window on its right or not, as walkRowRuns' comment reads it;
    // undefined where nothing says
    const flankForward = (flank: number, rightward: boolean) => {
      let near = -1
      for (let d = 1; near < 0 && d < length; d++) {
        near = [flank - d, flank + d].find(onReference) ?? -1
      }
      const tail = endOf(true)
      const lead = endOf(false)
      return near >= 0
        ? near > flank === spanStart[steps[near]!]! > spanStart[steps[flank]!]!
        : length > 1
          ? undefined
          : tail.departure
            ? !tail.departure.leaveReversed
            : lead.departure
              ? !lead.departure.rejoinReversed
              : (!tail.trimmed || !!lead.trimmed) === rightward
    }
    // The steps on the window's side of a lone flank, the flank among them
    // where it is `inside` the window, and how the walk stops past them
    const partialSide = (i0: number, i1: number, inside: boolean) => {
      const flank = i0 >= 0 ? i0 : i1
      const rightward = flank === i0
      const forward = flankForward(flank, rightward)
      const after = forward === rightward
      const { last, departure, trimmed } = endOf(after)
      const contigEnds = onReference(last) && !departure && !trimmed
      const stop: WalkStop = {
        contigEnds,
        shortBp: contigEnds
          ? Math.max(
              0,
              cut!.start - spanEnd[steps[last]!]!,
              spanStart[steps[last]!]! - cut!.end,
            )
          : 0,
        ...(departure
          ? {
              goesOn: {
                departure,
                near: after ? departure.rejoinPos : departure.leavePos,
              },
            }
          : {}),
      }
      const skip = inside ? 0 : 1
      const from = after === inside ? stepStart[flank]! : stepEnd(flank)
      return forward === undefined
        ? undefined
        : {
            stop,
            lo: after ? flank + skip : 0,
            hi: after ? length : flank + 1 - skip,
            backward: !forward,
            axisStart: forward
              ? after
                ? from
                : stepStart[0]!
              : after
                ? stepEnd(length - 1)
                : from,
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
    // An abridged block that ends on a flank past the reference's own holds
    // walk bp beyond the window, so it gives up the reference's bp between the
    // two flanks, an estimate
    const trimAbridged = (inner: number, bp: number) => {
      const parts = partsAt.get(inner)
      const gap = parts?.[0]
      if (bp <= 0 || gap?.cause !== 'abridged') {
        return 0
      }
      const trimmed = Math.min(bp, gap.bp)
      partsAt.set(
        inner,
        gap.bp > trimmed ? [{ ...gap, bp: gap.bp - trimmed }] : [],
      )
      steps[inner]! += trimmed
      return trimmed
    }
    const abridgedAt = (i: number) => partsAt.get(i)?.[0]?.cause === 'abridged'
    // The cut's reference walk places step i, or for an abridged block's
    // handle past that walk, the handle's rank 0 position does
    const placeStart = (i: number) => {
      const id = steps[i]!
      if (id < 0 || partsAt.has(i)) {
        return Number.NaN
      }
      return Number.isNaN(spanStart[id]!) &&
        (abridgedAt(i - 1) || abridgedAt(i + 1))
        ? stableStart(id)
        : spanStart[id]!
    }
    const stopsInside = (i0: number, i1: number, inside: boolean) => {
      complete = false
      const side = i0 >= 0 || i1 >= 0 ? partialSide(i0, i1, inside) : undefined
      if (side) {
        ;({ lo, hi, backward, axisStart, stop } = side)
      }
    }
    let leftTrim = 0
    let rightTrim = 0
    if (cut && flanked) {
      let i0 = -1
      let i1 = -1
      let bestEnd = -Infinity
      let bestStart = Infinity
      for (let i = 0; i < length; i++) {
        const start = placeStart(i)
        if (!Number.isNaN(start)) {
          const end = start + lengthOf(steps[i]!)
          if (end <= cut.start && end > bestEnd) {
            bestEnd = end
            i0 = i
          }
          if (start >= cut.end && start < bestStart) {
            bestStart = start
            i1 = i
          }
        }
      }
      if (i0 < 0 || i1 < 0) {
        stopsInside(i0, i1, false)
      } else {
        lo = Math.min(i0, i1) + 1
        hi = Math.max(i0, i1)
        backward = i0 > i1
        flankFrom = i0
        flankTo = i1
        const inward = backward ? -1 : 1
        leftTrim = trimAbridged(i0 + inward, flankEnd - bestEnd)
        rightTrim = trimAbridged(i1 - inward, bestStart - flankStart)
      }
    } else if (
      cut &&
      ordered.some(
        p =>
          heads[p]!.trimmedBefore !== undefined ||
          heads[p]!.trimmedAfter !== undefined,
      )
    ) {
      let i0 = -1
      let i1 = -1
      for (let i = 0; i < length; i++) {
        const start = placeStart(i)
        if (i0 < 0 && start === referenceLo) {
          i0 = i
        }
        if (i1 < 0 && start + lengthOf(steps[i]!) === referenceHi) {
          i1 = i
        }
      }
      if (i0 < 0 || i1 < 0) {
        stopsInside(i0, i1, true)
      }
    }
    // A walk with no step between its flanks, or past its lone one, whose
    // departure crosses the window has no step on the window's reference
    // whatever the cut holds of it outside, and is read as a walk with no
    // step in the cut is
    const stepless =
      bar !== undefined &&
      lo >= hi &&
      own.some(d => {
        const span = departureSpan(d)
        return span.start < bar.end && span.end > bar.start
      })
    const contig = head.contig ?? panSNContig(pathOrigin(head.name).name)
    const axis: WalkAxis | undefined =
      unplaced || length === 0
        ? undefined
        : axisStart !== undefined
          ? { contig, start: axisStart, reversed: backward }
          : flankFrom < 0
            ? { contig, start: stepStart[0]!, reversed: false }
            : flankFrom < flankTo
              ? {
                  contig,
                  start: stepEnd(flankFrom) + leftTrim,
                  reversed: false,
                }
              : {
                  contig,
                  start: stepStart[flankFrom]! - leftTrim,
                  reversed: true,
                }

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
      const parts = partsAt.get(index)
      if (parts) {
        // a row read backwards meets a gap's parts last first
        for (const part of backward ? [...parts].reverse() : parts) {
          runs.push(
            bp,
            part.bp,
            Number.NaN,
            RUN_GAP | causeFlags(part.cause),
            part.near ?? Number.NaN,
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
        runs.push(bp, len, lastRef, lastFlags, Number.NaN)
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
    const departureGapBp = stepless ? departureRuns(own, bar) : 0
    runs.endRow()
    visits?.endRow()
    // a departure between two steps of one piece is drawn by its runs
    const undrawn = own.filter(
      d =>
        !extents.some(([a, b]) => d.hapStart > a && d.hapStart + d.ownBp < b),
    )
    return stepless
      ? steplessMeta(head, own, departureGapBp)
      : {
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
          ...(abridgedSteps > 0 ? { abridgedSteps } : {}),
          ...(leftTrim + rightTrim > 0 ? { estimated: true } : {}),
          ...(undrawn.length > 0 ? { departures: undrawn } : {}),
          ...(own.some(placementChoice)
            ? { placementChoice: true as const }
            : {}),
        }
  }

  // a haplotype with no step in the cut is a row of its departures alone
  const steplessRowOf = (
    name: string,
    own: Departure[],
    bar: { start: number; end: number } | undefined,
  ) => {
    const gapBp = departureRuns(own, bar)
    runs.endRow()
    visits?.endRow()
    return steplessMeta({ name, ...panSNFields(name) }, own, gapBp)
  }

  const referenceRow = rowOf(referencePieces)
  const { axis } = referenceRow
  const bar = axis
    ? {
        start: axis.start,
        end: axis.start + referenceRow.bp + referenceRow.gapBp,
      }
    : cut
  const rows = [...walks.values()].map((pieces, i) => ({
    meta: rowOf(pieces, bar),
    row: i + 1,
  }))
  const drawn = new Set(walks.keys())
  for (const [name, own] of departuresOf) {
    if (!drawn.has(name)) {
      rows.push({
        meta: steplessRowOf(name, own, bar),
        row: rows.length + 1,
      })
    }
  }
  // two haplotypes of one sample named by P lines widen every label, as a
  // legend's do
  const metas = [referenceRow, ...rows.map(r => r.meta)]
  if (new Set(metas.map(m => m.label)).size < metas.length) {
    for (const meta of metas) {
      meta.label = panSNHaplotype(meta.name) ?? meta.label
    }
  }
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
    float64,
  ])
  const [start, bp, referenceStart, flags, near] = columns as [
    Float64Array,
    Float64Array,
    Float64Array,
    Uint8Array,
    Float64Array,
  ]
  return {
    origin: cut ? cut.start : (startOf(first) ?? 0),
    rows: [referenceRow, ...rows.map(r => r.meta)],
    offsets,
    start,
    bp,
    referenceStart,
    flags,
    near,
    visits: visits && visitColumns(visits, order, names),
  }
}

// Each walk's departures over the cut by its name, in contig order, the
// reference's left out
function departuresByWalk(
  table: DepartureTable | undefined,
  reference: string | undefined,
) {
  const byWalk = new Map<string, Departure[]>()
  if (table) {
    for (let k = 0; k < table.names.length; k++) {
      const d = departureAt(table, k)
      const name = pathOrigin(d.name).name
      if (name !== reference) {
        const list = byWalk.get(name)
        if (list) {
          list.push(d)
        } else {
          byWalk.set(name, [d])
        }
      }
    }
  }
  for (const list of byWalk.values()) {
    list.sort((a, b) => a.hapStart - b.hapStart)
  }
  return byWalk
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
    const cause = GAP_CAUSES[(f >> CAUSE_SHIFT) & 7]
    if (cause) {
      run.cause = cause
    }
    const near = t.near[k]!
    if (!Number.isNaN(near)) {
      run.near = near
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
