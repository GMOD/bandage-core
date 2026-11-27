import { REFERENCE_RANK } from '../anchoredNodes'
import {
  departureAt,
  departureSpan,
  gapParts,
  placementChoice,
  segmentPart,
  stretchSegments,
} from '../gfa/departures'
import { referenceOf, tableNodeIds, tablePath } from '../gfa/graphTables'
import { panSNContig, panSNFields, panSNHaplotype, panSNSample } from '../pansn'
import { pathOrigin, spanStated } from '../pathAnchoring'
import { compareIds } from '../util/canonicalOrder'
import { groupBy, pushTo } from '../util/groups'

import type {
  Departure,
  GapCause,
  GapPart,
  GapSegment,
} from '../gfa/departures'
import type { DepartureTable, GraphTables } from '../gfa/graphTables'
import type { Graph, GraphPath } from '../types'
import type {
  WalkAxis,
  WalkBreak,
  WalkPass,
  WalkRow,
  WalkRows,
  WalkRun,
  WalkStop,
  WalkStops,
  WalkVisit,
} from './walkRows'

const RUN_ON_REFERENCE = 1
const RUN_REVERSED = 2
const RUN_GAP = 4
// a gap's cause, by index from bit 3
const GAP_CAUSES = [
  undefined,
  'missing',
  'away',
  'own',
  'departure',
  'mixed',
  'unread',
] as const
const CAUSE_SHIFT = 3
const RUN_UNLOADED =
  1 << (CAUSE_SHIFT + Math.ceil(Math.log2(GAP_CAUSES.length)))
const RUN_FROM_ELSEWHERE = RUN_UNLOADED << 1

// the share of the reference bar's length a stretch away from the window
// draws
const BREAK_SHARE = 0.015

const causeFlags = (cause: GapCause | undefined) =>
  GAP_CAUSES.indexOf(cause) << CAUSE_SHIFT
const AWAY = RUN_GAP | causeFlags('away')
// a node the reference passes both ways, whose strand a step cannot be read
// against
const BOTH_WAYS = 2

// a stop at the bar's end the walk's last step (`high`) or first reaches
const atEnd = (high: boolean, stop: WalkStop | undefined): WalkStops =>
  stop ? (high ? { right: stop } : { left: stop }) : {}

export type WalkRowMeta = Omit<WalkRow, 'runs' | 'visits'>

/**
 * Each row's visits, row i's at `offsets[i]` up to `offsets[i + 1]`: the
 * node as an index into `names`, its bp offset from the bar's start, its bp,
 * and 1 where the step lies on the reference in the cut
 */
export interface WalkVisitColumns {
  offsets: Uint32Array
  node: Int32Array
  start: Float64Array
  bp: Float64Array
  onReference: Uint8Array
  unloaded: Uint8Array
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
  // a `mixed` gap's bp left out of graph, NaN for any other run
  missing: Float64Array
  // an `away` gap's bp, NaN for any other run
  held: Float64Array
  // 1 where a gap's bp left out of graph are a lower bound
  atLeast: Uint8Array
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
  // 1 where a step reads its node reversed, 0 forward, -1 where the source
  // states no strand
  reversed: Int8Array
  // whether the reference steps a node reversed, where the source states it
  referenceReversed: (node: number) => boolean | undefined
  // where the source states each step lies on the reference, NaN off it
  refStarts: Float64Array | undefined
  lengths: Int32Array
  names: ArrayLike<string>
  reference: string | undefined
  placeholder: (node: number) => boolean
  departures: DepartureTable | undefined
  revisited: number | undefined
  stretches: Stretches
  threadFold: boolean
}

const stretchKey = (name: string, start: number, end: number) =>
  `${pathOrigin(name).name}\t${start}\t${end}`

interface Stretch {
  name: string
  edge: number
  start: number
  end: number
  segments: GapSegment[]
}

// The stretches a walk-file cut states: between two of a walk's pieces by
// where they lie, past its first or last by edge, and its departures outside
// the row as a count and the bp of their attached steps
function stretchIndex(all: Stretch[]) {
  const between = new Map<string, GapSegment[]>()
  const ends = new Map<string, Stretch>()
  const outside = new Map<string, { count: number; stepsBp: number }>()
  for (const x of all) {
    const name = pathOrigin(x.name).name
    if (x.edge === 0) {
      between.set(stretchKey(name, x.start, x.end), x.segments)
    } else if (x.edge === 3) {
      const o = outside.get(name) ?? { count: 0, stepsBp: 0 }
      o.count++
      o.stepsBp += x.segments.reduce(
        (sum, y) => sum + (y.kind === 'steps' ? y.bp : 0),
        0,
      )
      outside.set(name, o)
    } else {
      ends.set(`${name}\t${x.edge}`, x)
    }
  }
  return {
    between: (name: string, start: number, end: number) =>
      between.get(stretchKey(name, start, end)),
    rowEnd: (name: string, edge: 1 | 2) =>
      ends.get(`${pathOrigin(name).name}\t${edge}`),
    outside: (name: string) => outside.get(pathOrigin(name).name),
  }
}

type Stretches = ReturnType<typeof stretchIndex>

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
  const placeholders = new Set<number>()
  const strands = new Map<number, boolean>()
  const segmentNames = new Map<string, string>()
  for (const node of graph.nodes) {
    const i = indexOf(node.id)
    lengths[i] = node.length
    segmentNames.set(node.id, node.name)
    if (node.placeholder) {
      placeholders.add(i)
    }
    if (node.stable?.strand) {
      strands.set(i, node.stable.strand === '-')
    }
  }
  const heads = graph.paths ?? []
  const from = new Int32Array(heads.length)
  const to = new Int32Array(heads.length)
  const steps: number[] = []
  const reversed: number[] = []
  const visits = graph.pathVisits
  const next = visits?.replay()
  heads.forEach((path, p) => {
    from[p] = steps.length
    const walk = visits?.pathIndex(pathOrigin(path.name).name) ?? -1
    for (const id of path.nodeIds) {
      steps.push(indexOf(id))
      const segment = segmentNames.get(id)
      const at =
        visits && next && segment !== undefined
          ? next(visits.slot(segment), walk)
          : -1
      reversed.push(at < 0 || !visits ? -1 : visits.strand(at) === '-' ? 1 : 0)
    }
    to[p] = steps.length
  })
  for (const path of heads) {
    if (path.refStarts && path.refStarts.length !== path.nodeIds.length) {
      throw new Error(
        `walk ${path.name} states ${path.refStarts.length} reference positions for ${path.nodeIds.length} steps`,
      )
    }
  }
  const refStarts = heads.every(path => path.refStarts)
    ? new Float64Array(steps.length)
    : undefined
  heads.forEach((path, p) => {
    if (path.refStarts) {
      refStarts?.set(path.refStarts, from[p])
    }
  })
  return {
    heads,
    from,
    to,
    steps: Int32Array.from(steps),
    reversed: Int8Array.from(reversed),
    referenceReversed: node => strands.get(node),
    refStarts,
    lengths: Int32Array.from(lengths),
    names,
    reference: referenceWalkName(graph),
    placeholder: node => placeholders.has(node),
    departures: graph.departures,
    revisited: graph.revisited,
    threadFold: graph.threadFold !== undefined,
    stretches: stretchIndex(
      (graph.gaps ?? []).map(gap => ({
        ...gap,
        segments: gap.segments.map(segment => ({
          ...segment,
          nodes: segment.nodes.map(indexOf),
        })),
      })),
    ),
  }
}

// The walks `graphFromTables` would build paths of, without building them
function tablePieces(
  tables: GraphTables,
  referencePath: string | undefined,
  visits: boolean | undefined,
): Pieces {
  const { nodes: n, walks: w, gaps } = tables
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
  return {
    heads,
    from: Int32Array.from(kept, p => w.offsets[p]!),
    to: Int32Array.from(kept, p => w.offsets[p + 1]!),
    steps: w.steps,
    reversed: Int8Array.from(w.reversed),
    referenceReversed: node =>
      n.reversed && n.ranks[node] === REFERENCE_RANK
        ? n.reversed[node] === 1
        : undefined,
    refStarts: w.refStarts,
    lengths: n.lengths,
    // a visit names its node as the Graph does, which costs a pass over the
    // steps
    names: visits ? tableNodeIds(tables) : n.names,
    reference,
    placeholder: placeholderOf(n.placeholders),
    departures: tables.departures,
    revisited: tables.revisited,
    stretches: stretchIndex(
      gaps
        ? gaps.names.map((name, g) => ({
            name,
            edge: gaps.edges[g]!,
            start: gaps.starts[g]!,
            end: gaps.ends[g]!,
            segments: stretchSegments(gaps, g, i => i),
          }))
        : [],
    ),
    threadFold: false,
  }
}

function sampleOf(path: PieceHead) {
  return path.sample ?? panSNSample(path.name)
}

const haplotypeOf = (name: string) => panSNHaplotype(name) ?? name

function labelOf(path: PieceHead) {
  return path.haplotype !== undefined && path.sample !== undefined
    ? `${path.sample}#${path.haplotype}`
    : sampleOf(path)
}

// Columns of numbers, a row's entries one after another
class Columns {
  values: number[][]
  offsets = [0]

  constructor(width: number) {
    this.values = Array.from({ length: width }, () => [])
  }

  get length() {
    return this.values[0]!.length
  }

  push(a: number, b: number, c: number, d: number, e = Number.NaN) {
    const v = this.values
    v[0]!.push(a)
    v[1]!.push(b)
    v[2]!.push(c)
    v[3]!.push(d)
    v[4]!.push(e)
    v[5]?.push(Number.NaN)
    v[6]?.push(0)
  }

  endRow() {
    this.offsets.push(this.length)
  }

  rowOffsets(order: number[]) {
    return rowOffsets(this.offsets, order)
  }

  reorder<T extends NumberArray>(
    order: number[],
    c: number,
    make: (n: number) => T,
  ) {
    const from = this.values[c]!
    return reorder(this.offsets, order, make(this.length), (k, at) =>
      from.slice(k, at),
    )
  }
}

// A row per visit, its node, bp offset, bp and two flags, in typed arrays
// reserved ahead of each row, which keep a big cut's visits out of the heap
class VisitColumns {
  values = Array.from({ length: 5 }, () => new Float64Array(1024))
  length = 0
  offsets = [0]

  // room for `n` more visits
  reserve(n: number) {
    const size = this.values[0]!.length
    if (this.length + n > size) {
      const grown = Math.max(this.length + n, size * 2)
      this.values = this.values.map(column => {
        const next = new Float64Array(grown)
        next.set(column.subarray(0, this.length))
        return next
      })
    }
  }

  push(node: number, start: number, bp: number, on: number, unloaded: number) {
    const v = this.values
    const k = this.length++
    v[0]![k] = node
    v[1]![k] = start
    v[2]![k] = bp
    v[3]![k] = on
    v[4]![k] = unloaded
  }

  endRow() {
    this.offsets.push(this.length)
  }

  rowOffsets(order: number[]) {
    return rowOffsets(this.offsets, order)
  }

  reorder<T extends NumberArray>(
    order: number[],
    c: number,
    make: (n: number) => T,
  ) {
    const from = this.values[c]!
    return reorder(this.offsets, order, make(this.length), (k, at) =>
      from.subarray(k, at),
    )
  }
}

// where each row in `order` starts once reordered, from where each starts
function rowOffsets(offsets: number[], order: number[]) {
  const out = new Uint32Array(order.length + 1)
  order.forEach((row, i) => {
    out[i + 1] = out[i]! + offsets[row + 1]! - offsets[row]!
  })
  return out
}

// a column's rows in `order` into `out`, each row's entries as `rowOf` gives
function reorder<T extends NumberArray>(
  offsets: number[],
  order: number[],
  out: T,
  rowOf: (start: number, end: number) => ArrayLike<number>,
) {
  let at = 0
  for (const row of order) {
    const start = offsets[row]!
    const end = offsets[row + 1]!
    out.set(rowOf(start, end), at)
    at += end - start
  }
  return out
}

type NumberArray = Float64Array | Int32Array | Uint8Array

// whether a node is a placeholder, from a table's flags where it has them
const placeholderOf = (flags: Uint8Array | undefined) => (node: number) =>
  flags?.[node] === 1

const float64 = (n: number) => new Float64Array(n)
const uint8 = (n: number) => new Uint8Array(n)

// A row with no step on the window's reference draws no bar: its departures
// alone, and the own bp between their ends
const steplessMeta = (
  head: PieceHead,
  own: Departure[],
  gapBp: number,
  abridgedSteps = 0,
): WalkRowMeta => ({
  name: head.name,
  label: labelOf(head),
  sample: sampleOf(head),
  haplotype: head.haplotype,
  bp: 0,
  offReferenceBp: own.reduce((sum, d) => sum + d.ownBp, 0),
  gapBp,
  complete: true,
  axis: undefined,
  departures: own,
  stepless: true,
  ...(abridgedSteps > 0 ? { abridgedSteps } : {}),
  ...(own.some(placementChoice) ? { placementChoice: true as const } : {}),
})

/**
 * The walk rows of a Graph, or of a cut's tables without the Graph of their
 * steps, as `walkRows` reads them. Tables name their reference by
 * `referencePath`, as loadGraph does.
 *
 * A step lies on the reference where the cut's reference walk holds the pass
 * the source states for it, as a walk file's tables do; one stated at a pass
 * the cut lacks is reference from elsewhere, off it here but not the walk's
 * own. A source that states
 * none, GFA text or a gbz-base extract, has a step on a node the reference
 * passes more than once take the pass nearest the step beside it.
 *
 * A walk that crosses the window once is cut at the nearest reference nodes
 * IT visits on either side of it, so one that skips a flanking node at a SNP
 * is still measured between flanks rather than whole. Any other with a step
 * in the window runs from its first such step to its last, its steps on the
 * reference outside the window between them a gap, a lower bound at an end
 * where it stops inside: there the graph holds no more of its contig on the
 * reference only where that step is on the reference, the walk has no
 * departure leaving or rejoining at it, and the cut trimmed none of its bp
 * past it; else it goes on (`WalkStop`). A walk file's fragment always ends
 * on the reference, so its end alone says nothing. A row reads its contig in
 * the order it is stored, and a run is reversed where its steps run against
 * the reference's strand at their nodes.
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
 *
 * The reference row carries the source's `revisited`, which `o.revisited`
 * overrides, and which says whether a run off the reference reads as the
 * walk's own (gfa/departures.ts ownIsExact).
 */
export function walkRowRuns(
  source: Graph | GraphTables,
  region?: { start: number; end: number },
  o: { visits?: boolean; referencePath?: string; revisited?: number } = {},
): WalkRowRuns | undefined {
  const {
    heads,
    from,
    to,
    steps: all,
    reversed: allReversed,
    referenceReversed,
    refStarts: stated,
    lengths,
    names,
    reference,
    placeholder,
    departures,
    revisited,
    stretches,
    threadFold,
  } = 'walks' in source
    ? tablePieces(source, o.referencePath, o.visits)
    : graphPieces(source)
  const declared = lengths.length
  const lengthOf = (node: number) => (node < declared ? lengths[node]! : 0)
  const drawnBp = (segments: GapSegment[]) =>
    segments.reduce(
      (sum, x) =>
        sum +
        (x.kind === 'steps'
          ? x.nodes.reduce((bp, node) => bp + lengthOf(node), 0)
          : x.bp),
      0,
    )
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
  const departureSteps = unloadedStepsByWalk(departures, reference)
  if (first === undefined || (others.length === 0 && departuresOf.size === 0)) {
    return undefined
  }
  // a cut hands a walk back as one record per piece inside its nodes
  const walks = groupBy(others, nameOf)

  // where each node starts on the reference's first visit, NaN where it never
  // visits
  const spanStart = new Float64Array(names.length).fill(Number.NaN)
  // every visit's start for a node the reference walks more than once, as a
  // collapsed repeat makes it
  const revisits = new Map<number, number[]>()
  // 1 where the reference steps a node reversed: as the source states it, or
  // else as its walk steps it first
  const nodeReversed = new Uint8Array(names.length)
  const firstPassReversed = new Int8Array(names.length)
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
        if (
          allReversed[s]! >= 0 &&
          allReversed[s] !== firstPassReversed[node]
        ) {
          nodeReversed[node] = BOTH_WAYS
        }
        const starts = revisits.get(node)
        if (starts) {
          starts.push(pos)
        } else {
          revisits.set(node, [spanStart[node]!, pos])
        }
      } else {
        spanStart[node] = pos
        firstPassReversed[node] = allReversed[s]!
        nodeReversed[node] =
          (referenceReversed(node) ?? allReversed[s] === 1) ? 1 : 0
      }
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
      pos += len
    }
  }
  // a cut that stops at the window carries no flanking reference for anyone
  const flanked =
    cut === undefined || (flankEnd > -Infinity && flankStart < Infinity)
  // A node the reference walks more than once takes the visit nearest
  // `cursor`, where the walk left the reference, so a copy of a collapsed
  // repeat follows the reference copy it continues; the first visit where
  // nothing precedes it
  const placeNear = (
    id: number,
    cursor: number,
    abutting?: 'start' | 'end',
  ) => {
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
      const abuts =
        abutting !== undefined &&
        (abutting === 'start' ? start : start + len) === cursor
      if (gap < bestGap || (gap === bestGap && abuts)) {
        best = start
        bestGap = gap
      }
    }
    return best
  }
  const referenceHolds = (id: number, start: number) =>
    spanStart[id] === start || revisits.get(id)?.includes(start) === true

  const runs = new Columns(7)
  const visits = o.visits ? new VisitColumns() : undefined
  // the walk's steps, each gap between its pieces a step of -bp; reused
  // across rows
  let steps = new Int32Array(0)
  let stepStart = new Float64Array(0)
  let stepStated = new Float64Array(0)
  let stepReversed = new Int8Array(0)
  let stepPlace = new Float64Array(0)

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
      )
      gapBp += end - start
    }
    return gapBp
  }

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
    let abridgedSteps = departureSteps.get(nameOf(pieces[0]!)) ?? 0
    for (const piece of ordered) {
      count += to[piece]! - from[piece]!
      abridgedSteps += heads[piece]!.abridgedSteps ?? 0
    }
    if (count > steps.length) {
      steps = new Int32Array(count * 2)
      stepStart = new Float64Array(count * 2)
      stepStated = new Float64Array(count * 2)
      stepReversed = new Int8Array(count * 2)
    }
    let length = 0
    // a piece with no start, or one overlapping the last, leaves bar offsets
    // no linear map onto the contig
    let unplaced = false
    let end: number | undefined
    let previous: number | undefined
    const partsAt = new Map<number, GapPart[]>()
    const emit = (segments: GapSegment[], fromBp: number) => {
      const need = segments.reduce((n, x) => n + x.nodes.length + 1, count)
      if (length + need > steps.length) {
        const grownSteps = new Int32Array((length + need) * 2)
        const grownStarts = new Float64Array((length + need) * 2)
        const grownStated = new Float64Array((length + need) * 2)
        const grownReversed = new Int8Array((length + need) * 2)
        grownSteps.set(steps.subarray(0, length))
        grownStarts.set(stepStart.subarray(0, length))
        grownStated.set(stepStated.subarray(0, length))
        grownReversed.set(stepReversed.subarray(0, length))
        steps = grownSteps
        stepStart = grownStarts
        stepStated = grownStated
        stepReversed = grownReversed
      }
      let at = fromBp
      let parts: GapPart[] = []
      let partsBp = 0
      const flush = () => {
        if (partsBp > 0) {
          partsAt.set(length, parts)
          steps[length] = -partsBp
          stepStated[length] = Number.NaN
          stepStart[length++] = at - partsBp
        }
        parts = []
        partsBp = 0
      }
      for (const x of segments) {
        if (x.kind === 'steps') {
          flush()
          x.nodes.forEach((node, k) => {
            steps[length] = node
            stepStated[length] = Number.NaN
            stepReversed[length] = x.reversed[k] ? 1 : 0
            stepStart[length++] = at
            at += lengthOf(node)
          })
        } else if (x.bp > 0) {
          const part = segmentPart(x)
          parts.push(
            part.cause === 'missing' || part.cause === 'mixed'
              ? segments.some(y => y.kind === 'unread')
                ? { ...part, atLeast: true }
                : part
              : part,
          )
          partsBp += x.bp
          at += x.bp
        }
      }
      flush()
    }
    const walkName = nameOf(ordered[0]!)
    const lead = stretches.rowEnd(walkName, 1)
    const leads =
      lead !== undefined &&
      lead.end === startOf(ordered[0]!) &&
      drawnBp(lead.segments) === lead.end - lead.start
    if (leads) {
      emit(lead.segments, lead.start)
      end = lead.end
    }
    const fragLo = length
    // each piece's first step and the one past its last
    const pieceSpans: [number, number][] = []
    for (const piece of ordered) {
      const start = startOf(piece)
      const gap = start === undefined || end === undefined ? 0 : start - end
      if (start === undefined || gap < 0) {
        unplaced = true
      }
      const segments =
        gap >= 0 &&
        previous !== undefined &&
        start !== undefined &&
        end !== undefined
          ? stretches.between(nameOf(previous), end, start)
          : undefined
      if (segments && drawnBp(segments) === gap) {
        emit(segments, end!)
      } else if (gap > 0) {
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
        stepStated[length] = Number.NaN
        stepStart[length++] = end!
      }
      let pos = start ?? 0
      const pieceLo = length
      for (let s = from[piece]!, stop = to[piece]!; s < stop; s++) {
        const node = all[s]!
        steps[length] = node
        stepStated[length] = stated ? stated[s]! : Number.NaN
        stepReversed[length] = allReversed[s]!
        stepStart[length++] = pos
        pos += lengthOf(node)
      }
      pieceSpans.push([pieceLo, length])
      if (!threadFold && !spanStated(heads[piece]!, pos - (start ?? 0))) {
        unplaced = true
      }
      end = start === undefined ? undefined : pos
      if (start !== undefined) {
        extents.push([start, pos])
      }
      previous = piece
    }
    const fragHi = length - 1
    const tail = stretches.rowEnd(walkName, 2)
    const tails =
      tail !== undefined &&
      tail.start === end &&
      drawnBp(tail.segments) === tail.end - tail.start
    if (tails) {
      emit(tail.segments, tail.start)
    }
    const onReference = (i: number) =>
      i >= 0 && i < length && !Number.isNaN(stepPlace[i]!)
    const stepEnd = (i: number) => {
      const id = steps[i]!
      return stepStart[i]! + (id < 0 ? -id : lengthOf(id))
    }
    // The walk's contig past its last step (`after`) or before its first: the
    // departure leaving or rejoining at that step, and the bp the cut trimmed
    // off that side
    const endOf = (after: boolean) => {
      const last = after ? fragHi : fragLo
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
    // How the walk stops past its first step, or its last (`after`): by a
    // departure, past bp the cut trimmed, or where the graph holds no more of
    // its contig on the reference, which only a source stating trimmed bp
    // says; nothing where none of these is known
    const stopAt = (after: boolean): WalkStop | undefined => {
      const { last, departure, trimmed } = endOf(after)
      const contigEnds = onReference(last) && !departure && trimmed === 0
      const place = stepPlace[last]!
      const placing: Pick<WalkStop, 'start' | 'contigStart' | 'past'> = {
        ...(after ? {} : { start: true }),
        ...(contigEnds && !after ? { contigStart: stepStart[last]! } : {}),
        ...(contigEnds && cut && place >= cut.end ? { past: true } : {}),
      }
      const goesOn: WalkStop['goesOn'] = departure && {
        departure,
        near: after ? departure.rejoinPos : departure.leavePos,
        ...((after ? tails : leads) ? { drawn: true } : {}),
      }
      return contigEnds || departure || trimmed !== undefined
        ? {
            contigEnds,
            shortBp:
              contigEnds && cut
                ? Math.max(
                    0,
                    cut.start - place - lengthOf(steps[last]!),
                    place - cut.end,
                    after ? 0 : cut.start - place,
                  )
                : 0,
            ...placing,
            ...(goesOn ? { goesOn } : {}),
          }
        : undefined
    }
    // Whether the walk runs rightward along the reference at a lone flank,
    // the window on its right or not, as walkRowRuns' comment reads it;
    // undefined where nothing says
    const flankForward = (flank: number, rightward: boolean) => {
      let near = -1
      for (let d = 1; near < 0 && d < length; d++) {
        near = [flank - d, flank + d].find(onReference) ?? -1
      }
      const tailEnd = endOf(true)
      const leadEnd = endOf(false)
      return near >= 0
        ? near > flank === stepPlace[near]! > stepPlace[flank]!
        : fragHi > fragLo
          ? undefined
          : tailEnd.departure
            ? !tailEnd.departure.leaveReversed
            : leadEnd.departure
              ? !leadEnd.departure.rejoinReversed
              : (!tailEnd.trimmed || !!leadEnd.trimmed) === rightward
    }
    // The steps on the window's side of a lone flank, the flank among them
    // where it is `inside` the window, and how the walk stops past them
    const partialSide = (i0: number, i1: number, inside: boolean) => {
      const flank = i0 >= 0 ? i0 : i1
      const rightward = flank === i0
      const forward = flankForward(flank, rightward)
      const after = forward === rightward
      const skip = inside ? 0 : 1
      return forward === undefined
        ? undefined
        : {
            stops: atEnd(after, stopAt(after)),
            lo: after ? flank + skip : 0,
            hi: after ? length : flank + 1 - skip,
          }
    }

    let lo = fragLo
    let hi = fragHi + 1
    let complete = true
    let flankFrom = -1
    let flankTo = -1
    let stops: WalkStops = {}
    if (stepPlace.length < length) {
      stepPlace = new Float64Array(steps.length)
    }
    // a gap's parts sit on a step of -bp
    const placeable = (i: number) => steps[i]! >= 0 && !placeholder(steps[i]!)
    const passedOnce = (i: number) =>
      placeable(i) &&
      !Number.isNaN(spanStart[steps[i]!]!) &&
      !revisits.has(steps[i]!)
    const placeOutward = (origin: number, toward: 1 | -1) => {
      let cursor = Number.NaN
      let abutting: 'start' | 'end' | undefined
      let neighbour = Number.NaN
      for (let i = origin; i >= 0 && i < length; i += toward) {
        const id = steps[i]!
        const place = placeable(i)
          ? placeNear(id, cursor, abutting)
          : Number.NaN
        stepPlace[i] = place
        if (!Number.isNaN(place)) {
          const placeEnd = place + lengthOf(id)
          const turned =
            toward > 0 ? placeEnd === neighbour : place === neighbour
          const leftward = toward > 0 === turned
          cursor = leftward ? place : placeEnd
          abutting = leftward ? 'end' : 'start'
          neighbour = toward > 0 ? place : placeEnd
        }
      }
    }
    if (walkName === reference) {
      for (let i = 0; i < length; i++) {
        stepPlace[i] = placeable(i) ? stepStart[i]! : Number.NaN
      }
    } else if (stated) {
      for (let i = 0; i < length; i++) {
        const at = stepStated[i]!
        stepPlace[i] =
          !Number.isNaN(at) && placeable(i) && referenceHolds(steps[i]!, at)
            ? at
            : Number.NaN
      }
    } else {
      let firstPassedOnce = 0
      while (firstPassedOnce < length && !passedOnce(firstPassedOnce)) {
        firstPassedOnce++
      }
      const anchor = firstPassedOnce < length ? firstPassedOnce : 0
      placeOutward(anchor, 1)
      placeOutward(anchor, -1)
    }
    const placeStart = (i: number) => stepPlace[i]!
    const abutsBelow = (i: number, j: number) =>
      j >= 0 &&
      j < length &&
      !Number.isNaN(placeStart(j)) &&
      placeStart(i) + lengthOf(steps[i]!) === placeStart(j)
    const fromElsewhere = (i: number) =>
      placeable(i) &&
      Number.isNaN(stepPlace[i]!) &&
      Number.isFinite(stepStated[i]!)
    const stopsInside = (i0: number, i1: number, inside: boolean) => {
      complete = false
      const side = i0 >= 0 || i1 >= 0 ? partialSide(i0, i1, inside) : undefined
      if (side) {
        ;({ lo, hi, stops } = side)
      } else if (i0 < 0 && i1 < 0) {
        stops = { ...atEnd(false, stopAt(false)), ...atEnd(true, stopAt(true)) }
      }
    }
    // The walk's steps on the reference outside the window, in walk order,
    // and its passes over the window: each a step left of it and one right of
    // it next to each other on the contig, the left one first where the pass
    // runs along the reference and last where it runs reversed
    const outside: { i: number; left: boolean }[] = []
    const passes: { i0: number; i1: number }[] = []
    let loneFlank = -1
    let loneLeft = false
    // set where the row's bar runs from the walk's first step in the window to
    // its last over steps on the reference outside it, which it draws as gaps
    // near where they lie
    let reach: ReturnType<typeof outermost> | undefined
    // the first step from `a` on, short of `b`, on the reference or a gap
    const offFrom = (a: number, b: number) => {
      let i = a
      while (i < b && Number.isNaN(placeStart(i)) && steps[i]! >= 0) {
        i++
      }
      return i
    }
    // The bar's steps outside the window, and those off the reference between
    // two such with no gap between, which the walk takes while away, but for
    // a pass's own sequence between its flanks
    const awaySteps = () => {
      const away = new Uint8Array(hi - lo)
      const passEnd = new Map(
        passes.map(p => [Math.min(p.i0, p.i1), Math.max(p.i0, p.i1)]),
      )
      let lastOutside = -1
      for (const { i } of outside) {
        if (i >= lo && i < hi) {
          away[i - lo] = 1
          if (
            lastOutside >= 0 &&
            passEnd.get(lastOutside) !== i &&
            offFrom(lastOutside + 1, i) === i
          ) {
            away.fill(1, lastOutside + 1 - lo, i - lo)
          }
          lastOutside = i
        }
      }
      return away
    }
    // The bar from the walk's first step in the window to its last, each end
    // widened over steps off the reference: an end meeting a step outside the
    // window leaves by it, else the walk stops there
    const outermost = (
      inside: { lo: number; hi: number },
      over: { i0: number; i1: number }[],
    ) => {
      lo = over.reduce(
        (at, p) => Math.min(at, Math.min(p.i0, p.i1) + 1),
        inside.lo,
      )
      hi = over.reduce((at, p) => Math.max(at, Math.max(p.i0, p.i1)), inside.hi)
      while (lo > 0 && Number.isNaN(placeStart(lo - 1))) {
        lo--
      }
      while (hi < length && Number.isNaN(placeStart(hi))) {
        hi++
      }
      const leftOf = (i: number) =>
        placeStart(i) + lengthOf(steps[i]!) <= cut!.start
      const enters = lo > 0 ? leftOf(lo - 1) : undefined
      const leaves = hi < length ? leftOf(hi) : undefined
      complete =
        enters !== undefined && leaves !== undefined && enters !== leaves
      stops = {
        ...(enters === undefined ? atEnd(false, stopAt(false)) : {}),
        ...(leaves === undefined ? atEnd(true, stopAt(true)) : {}),
        ...(enters !== undefined && enters === leaves
          ? atEnd(true, { contigEnds: false, shortBp: 0, turnsBack: true })
          : {}),
      }
      const crossing = [lo - 1, hi].filter(i => i >= 0 && i < length)
      return {
        away: outside.some(step => step.i >= lo && step.i < hi),
        complete,
        // which way a measure reads the bar from where it comes into the
        // window
        reversed: enters === undefined ? leaves === true : !enters,
        leftEnd: crossing
          .filter(leftOf)
          .reduce(
            (at, i) => Math.max(at, placeStart(i) + lengthOf(steps[i]!)),
            -Infinity,
          ),
        rightStart: crossing
          .filter(i => !leftOf(i))
          .reduce((at, i) => Math.min(at, placeStart(i)), Infinity),
      }
    }
    if (cut && flanked) {
      let i0 = -1
      let i1 = -1
      let bestEnd = -Infinity
      let bestStart = Infinity
      let insideLo = length
      let insideHi = 0
      for (let i = 0; i < length; i++) {
        const start = placeStart(i)
        if (!Number.isNaN(start)) {
          const stepEndBp = start + lengthOf(steps[i]!)
          if (stepEndBp <= cut.start) {
            outside.push({ i, left: true })
          } else if (start >= cut.end) {
            outside.push({ i, left: false })
          } else {
            insideLo = insideLo < length ? insideLo : i
            insideHi = i + 1
          }
          if (stepEndBp <= cut.start && stepEndBp > bestEnd) {
            bestEnd = stepEndBp
            i0 = i
          }
          if (start >= cut.end && start < bestStart) {
            bestStart = start
            i1 = i
          }
        }
      }
      // A pass reads the way the walk runs at its flanks: one from the right
      // to the left is the walk reading the reference backwards, not a walk
      // that went right, out of the window, and jumped back past it
      const runsOn = (p: number, q: number) => {
        const before = p > 0 ? placeStart(p - 1) : Number.NaN
        const after = q + 1 < length ? placeStart(q + 1) : Number.NaN
        const rightward = placeStart(q) > placeStart(p)
        return (
          (Number.isNaN(before) || before < placeStart(p) === rightward) &&
          (Number.isNaN(after) || after > placeStart(q) === rightward)
        )
      }
      for (let k = 1; k < outside.length; k++) {
        const a = outside[k - 1]!
        const b = outside[k]!
        if (a.left !== b.left && runsOn(a.i, b.i)) {
          passes.push(a.left ? { i0: a.i, i1: b.i } : { i0: b.i, i1: a.i })
        }
      }
      const pass = passes[0]
      const onePass =
        pass !== undefined &&
        passes.length === 1 &&
        (insideLo >= insideHi ||
          (insideLo > Math.min(pass.i0, pass.i1) &&
            insideHi <= Math.max(pass.i0, pass.i1)))
      if (onePass) {
        lo = Math.min(pass.i0, pass.i1) + 1
        hi = Math.max(pass.i0, pass.i1)
        flankFrom = pass.i0
        flankTo = pass.i1
      } else if (insideLo < insideHi || passes.length > 0) {
        reach = outermost({ lo: insideLo, hi: insideHi }, passes)
      } else {
        stopsInside(i0, i1, false)
        const sided = stops.left !== undefined || stops.right !== undefined
        const flank = sided ? (i0 >= 0 ? i0 : i1) : -1
        loneFlank = flank
        loneLeft = i0 >= 0
        const after = outside.find(step => step.i > flank)?.i
        const before = outside.findLast(step => step.i < flank)?.i
        const turnsBack: WalkStop = {
          contigEnds: false,
          shortBp: 0,
          turnsBack: true,
        }
        if (flank >= 0 && lo > flank && after !== undefined && after < hi) {
          hi = after
          stops = atEnd(true, turnsBack)
        } else if (
          flank >= 0 &&
          hi <= flank + 1 &&
          before !== undefined &&
          before >= lo
        ) {
          lo = before + 1
          stops = atEnd(false, turnsBack)
        }
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
    if (lead && leads && lo < fragLo) {
      extents.push([lead.start, lead.end])
    }
    if (tail && tails && hi > fragHi + 1) {
      extents.push([tail.start, tail.end])
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
    const contigAt = (i: number) =>
      i < length ? stepStart[i]! : stepEnd(length - 1)
    const axis: WalkAxis | undefined =
      unplaced || length === 0 ? undefined : { contig, start: contigAt(lo) }

    // A pass's steps from `lo` to `hi`, read from its flank on the left,
    // measured over the window: on the reference, a step's bp less what lies
    // between the pass's own flanks (`end`, `start`) and the window, and off
    // it, a run's bp unless it leaves the reference there, so every pass is
    // measured over the reference's interval. A step elsewhere, as a
    // rearranged walk takes, counts whole. A run off the reference that
    // replaces bp on both sides of a window edge has no share of the window
    // to count, so the pass `crosses` it.
    const measurePass = (
      firstStep: number,
      pastStep: number,
      reversed: boolean,
      leftEnd: number,
      rightStart: number,
    ) => {
      const window = cut ?? { start: -Infinity, end: Infinity }
      const between = (a: number, b: number) =>
        Math.max(0, Math.min(b, window.start) - Math.max(a, leftEnd)) +
        Math.max(0, Math.min(b, rightStart) - Math.max(a, window.end))
      const outsideWindow = (at: number) =>
        Number.isFinite(at) &&
        ((at >= leftEnd && at < window.start) ||
          (at >= window.end && at <= rightStart))
      const across = (a: number, b: number) => {
        const l = Math.min(a, b)
        const r = Math.max(a, b)
        return (
          (l < window.start && r > window.start) ||
          (l < window.end && r > window.end)
        )
      }
      let measured = 0
      let total = 0
      let elsewhereBp = 0
      let onBp = 0
      let unreadBp = 0
      let crosses = false
      let away = false
      let left = Number.NaN
      let lastPlace = Number.NaN
      for (let k = firstStep; k < pastStep; k++) {
        const index = reversed ? pastStep - 1 - (k - firstStep) : k
        const id = steps[index]!
        const at = Number.isNaN(left) ? leftEnd : left
        const len = id < 0 ? -id : lengthOf(id)
        const place = stepPlace[index]!
        total += len
        if (Number.isNaN(place)) {
          measured += outsideWindow(at) ? 0 : len
          elsewhereBp += fromElsewhere(index) ? len : 0
          unreadBp += id < 0 ? len : 0
          away = true
        } else {
          crosses ||= away && across(at, place)
          away = false
          measured += len - between(place, place + len)
          onBp += len
          left = place + len === lastPlace ? place : place + len
          lastPlace = place
        }
      }
      crosses ||=
        away && across(Number.isNaN(left) ? leftEnd : left, rightStart)
      return {
        bp: total,
        windowBp: measured,
        crosses,
        fromElsewhereBp: elsewhereBp,
        onReferenceBp: onBp,
        gapBp: unreadBp,
      }
    }

    const firstRun = runs.length
    let bp = 0
    let offReferenceBp = 0
    let unloadedBp = 0
    let fromElsewhereBp = 0
    let gapBp = 0
    // which way the last run steps through the reference, 0 while it holds
    // one node
    let step = 0
    let runStart = 0
    let runLength = 0
    let lastRef = Number.NaN
    let lastFlags = -1
    let runMissing = Number.NaN
    let runAtLeast = 0
    let lastAway = false
    let lastBoth = false
    const breakWidth =
      bar && !stepless && walkName !== reference
        ? BREAK_SHARE * (bar.end - bar.start)
        : Infinity
    const shortBy = () =>
      lastFlags === AWAY ? Math.max(0, runLength - breakWidth) : 0
    let shortened = 0
    const close = () => {
      if (lastFlags >= 0) {
        runs.push(runStart, runLength, lastRef, lastFlags, runMissing)
        runs.values[6]![runs.length - 1] = runAtLeast
      }
      shortened += shortBy()
      runMissing = Number.NaN
      runAtLeast = 0
    }
    const away = reach?.away ? awaySteps() : undefined
    // a walk file's tables state each piece's trimmed bp, 0 included
    const fromWalkFile = ordered.some(
      p =>
        heads[p]!.trimmedBefore !== undefined ||
        heads[p]!.trimmedAfter !== undefined,
    )
    visits?.reserve(hi - lo)
    for (let k = lo; k < hi; k++) {
      const index = k
      const id = steps[index]!
      const parts = id < 0 ? partsAt.get(index) : undefined
      const len = lengthOf(id)
      const unloaded = placeholder(id)
      const at = stepPlace[index]!
      const on = !Number.isNaN(at)
      if (parts) {
        // a walk file's contig the cut did not keep is away from the window,
        // and with no window, not drawn; GFA text states nothing of it
        const notKept = (part: GapPart) =>
          fromWalkFile &&
          walkName !== reference &&
          (part.cause === 'away' || part.cause === undefined)
        const trip =
          cut !== undefined &&
          parts.some(notKept) &&
          !parts.some(part => part.cause === 'own' || part.cause === 'mixed')
        for (const part of parts) {
          const missing =
            part.cause === 'missing' ? part.bp : (part.missingBp ?? 0)
          const awayPart = trip || (notKept(part) && cut !== undefined)
          const unsure =
            awayPart &&
            (part.atLeast === true ||
              (part.cause === undefined && parts.length === 1))
          if (awayPart && lastAway) {
            runLength += part.bp
            runMissing =
              missing > 0
                ? (Number.isNaN(runMissing) ? 0 : runMissing) + missing
                : runMissing
            runAtLeast = runAtLeast || (unsure ? 1 : 0)
          } else {
            close()
            runStart = bp
            runLength = part.bp
            lastRef = Number.NaN
            lastFlags = awayPart
              ? AWAY
              : RUN_GAP | causeFlags(notKept(part) ? 'unread' : part.cause)
            runMissing =
              trip && missing > 0
                ? missing
                : trip
                  ? Number.NaN
                  : (part.missingBp ?? Number.NaN)
            runAtLeast = part.atLeast || unsure ? 1 : 0
          }
          lastAway = awayPart
          bp += part.bp
        }
        gapBp += -id
        step = 0
      } else if (away?.[index - lo] === 1) {
        if (lastAway) {
          runLength += len
        } else {
          close()
          runStart = bp
          runLength = len
          lastRef = Number.NaN
          lastFlags = AWAY
          lastAway = true
        }
        step = 0
        bp += len
        gapBp += len
      } else {
        lastAway = false
        visits?.push(
          id,
          bp - shortened - shortBy(),
          len,
          on ? 1 : 0,
          unloaded ? 1 : 0,
        )
        const placed = !Number.isNaN(lastRef)
        // a node the reference passes both ways has no strand to read a step
        // against
        const nodeStrand = nodeReversed[id]!
        const both = on && nodeStrand === BOTH_WAYS
        const known = on && !both && stepReversed[index]! >= 0
        // whether the step runs against the reference's strand at its node;
        // where the source states no strand, whether the walk steps down the
        // reference at it
        const turned =
          on &&
          !both &&
          (known
            ? stepReversed[index] !== nodeStrand
            : abutsBelow(index, index - 1) ||
              (!abutsBelow(index - 1, index) && abutsBelow(index + 1, index)))
        const joins = placed && !both && !lastBoth
        const forward =
          on &&
          joins &&
          step >= 0 &&
          !(known && turned) &&
          lastRef + runLength === at
        const back =
          on &&
          joins &&
          step <= 0 &&
          !(known && !turned) &&
          at + len === lastRef
        const elsewhere = !on && fromElsewhere(index)
        const flags = on
          ? RUN_ON_REFERENCE
          : unloaded
            ? RUN_UNLOADED
            : elsewhere
              ? RUN_FROM_ELSEWHERE
              : 0
        if (!on && lastFlags === flags) {
          runLength += len
        } else if (forward || back) {
          runLength += len
          lastRef = back ? at : lastRef
          lastFlags |= back ? RUN_REVERSED : 0
          step = forward ? 1 : -1
        } else {
          close()
          runStart = bp
          runLength = len
          lastFlags = flags | (known && turned ? RUN_REVERSED : 0)
          lastRef = on ? at : Number.NaN
          step = known ? (turned ? -1 : 1) : 0
        }
        lastBoth = both
        bp += len
        offReferenceBp += unloaded || on ? 0 : len
        unloadedBp += unloaded ? len : 0
        fromElsewhereBp += !unloaded && !on && elsewhere ? len : 0
      }
    }
    close()
    const runBp = runs.values[1]!
    const runRef = runs.values[2]!
    const runFlags = runs.values[3]!
    const placedEnd = (i: number) => placeStart(i) + lengthOf(steps[i]!)
    const passOf = (p: { i0: number; i1: number }) =>
      measurePass(
        Math.min(p.i0, p.i1) + 1,
        Math.max(p.i0, p.i1),
        p.i0 > p.i1,
        placedEnd(p.i0),
        placeStart(p.i1),
      )
    // a pass whose own sequence crosses a window edge has no length over the
    // window, only the reference's bp between its flanks that it replaces
    const passMeta = (p: { i0: number; i1: number }): WalkPass => {
      const m = passOf(p)
      return {
        bp: m.bp,
        windowBp: m.windowBp,
        ...(m.crosses
          ? {
              replacedBp: placeStart(p.i1) - placedEnd(p.i0),
              onReferenceBp: m.onReferenceBp,
              gapBp: m.gapBp,
            }
          : {}),
        ...(m.fromElsewhereBp > 0
          ? { fromElsewhereBp: m.fromElsewhereBp }
          : {}),
      }
    }
    const measured:
      | Pick<WalkPass, 'windowBp' | 'replacedBp' | 'onReferenceBp'>
      | undefined =
      flankFrom >= 0
        ? passMeta({ i0: flankFrom, i1: flankTo })
        : reach
          ? reach.complete || reach.away
            ? undefined
            : measurePass(
                lo,
                hi,
                reach.reversed,
                reach.leftEnd,
                reach.rightStart,
              )
          : loneFlank >= 0
            ? measurePass(
                lo,
                hi,
                loneLeft === loneFlank >= hi,
                loneLeft ? placedEnd(loneFlank) : -Infinity,
                loneLeft ? Infinity : placeStart(loneFlank),
              )
            : undefined
    // Each stretch away from the window draws at most a fixed share of the
    // reference's bar wide; one shortened so is a break, the axis taking its
    // bp
    const breaks: WalkBreak[] = []
    let awayRuns = 0
    const runStarts = runs.values[0]!
    const runHeld = runs.values[5]!
    if (Number.isFinite(breakWidth)) {
      let along = 0
      let drawnAt = 0
      for (let k = firstRun; k < runs.length; k++) {
        runStarts[k] = drawnAt
        const held = runBp[k]!
        if (runFlags[k] === AWAY) {
          runHeld[k] = held
          runBp[k] = Math.min(held, breakWidth)
          awayRuns++
        }
        if (held > runBp[k]!) {
          breaks.push({ at: along, bp: held, drawn: runBp[k]! })
        }
        along += held
        drawnAt += runBp[k]!
      }
    }
    // The bp the row walks against the reference, over the window alone where
    // its readout states its bp over the window
    const overWindow =
      cut && measured && measured.replacedBp === undefined && awayRuns === 0
        ? cut
        : { start: -Infinity, end: Infinity }
    let reversedBp = 0
    for (let k = firstRun; k < runs.length; k++) {
      reversedBp +=
        (runFlags[k]! & (RUN_GAP | RUN_ON_REFERENCE | RUN_REVERSED)) ===
        (RUN_ON_REFERENCE | RUN_REVERSED)
          ? Math.max(
              0,
              Math.min(runRef[k]! + runBp[k]!, overWindow.end) -
                Math.max(runRef[k]!, overWindow.start),
            )
          : 0
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
      ? steplessMeta(head, own, departureGapBp, abridgedSteps)
      : {
          name: head.name,
          label: labelOf(head),
          sample: sampleOf(head),
          haplotype: head.haplotype,
          bp,
          offReferenceBp,
          gapBp,
          complete,
          ...(measured?.replacedBp !== undefined
            ? {
                replacedBp: measured.replacedBp,
                onReferenceBp: measured.onReferenceBp ?? 0,
              }
            : measured
              ? { windowBp: measured.windowBp }
              : {}),
          ...(reversedBp > 0 ? { reversedBp } : {}),
          ...(awayRuns > 0 ? { passesOutside: true } : {}),
          ...(passes.length > 1 ? { passes: passes.map(passMeta) } : {}),
          ...(stops.left || stops.right ? { stops } : {}),
          axis: axis && {
            ...axis,
            ...(breaks.length > 0 ? { breaks } : {}),
          },
          ...(abridgedSteps > 0 ? { abridgedSteps } : {}),
          ...(unloadedBp > 0 ? { unloadedBp } : {}),
          ...(fromElsewhereBp > 0 ? { fromElsewhereBp } : {}),
          ...(undrawn.length > 0 ? { departures: undrawn } : {}),
          ...outsideOf(walkName),
          ...(own.some(placementChoice)
            ? { placementChoice: true as const }
            : {}),
        }
  }

  const outsideOf = (name: string) => {
    const outsideRow = stretches.outside(name)
    return outsideRow ? { outsideRow } : {}
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
    return steplessMeta(
      { name, ...panSNFields(name) },
      own,
      gapBp,
      departureSteps.get(name),
    )
  }

  const revisitCount = o.revisited ?? revisited
  const referenceRow = {
    ...rowOf(referencePieces),
    ...(revisitCount === undefined ? {} : { revisited: revisitCount }),
  }
  const { axis } = referenceRow
  const bar = axis
    ? { start: axis.start, end: axis.start + referenceRow.bp }
    : cut
  const rows = [...walks.values()].map((pieces, i) => ({
    meta: rowOf(pieces, bar),
    row: i + 1,
  }))
  // a haplotype with a walk in the cut is drawn by it; its other contigs'
  // departures over the window are counted on its first row, not drawn
  const drawnHaplotypes = new Set(
    [nameOf(first), ...walks.keys()].map(haplotypeOf),
  )
  const otherContigs = new Map<
    string,
    { contigs: number; departures: number }
  >()
  for (const [name, own] of departuresOf) {
    const haplotype = haplotypeOf(name)
    if (!drawnHaplotypes.has(haplotype)) {
      rows.push({
        meta: steplessRowOf(name, own, bar),
        row: rows.length + 1,
      })
    } else if (!walks.has(name)) {
      const counted = otherContigs.get(haplotype)
      otherContigs.set(haplotype, {
        contigs: (counted?.contigs ?? 0) + 1,
        departures: (counted?.departures ?? 0) + own.length,
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
      compareIds(a.meta.label, b.meta.label),
  )
  for (const meta of [referenceRow, ...rows.map(r => r.meta)]) {
    const haplotype = haplotypeOf(meta.name)
    const counted = otherContigs.get(haplotype)
    if (counted) {
      meta.otherContigs = counted
      otherContigs.delete(haplotype)
    }
  }
  const order = [0, ...rows.map(r => r.row)]
  const offsets = runs.rowOffsets(order)
  const start = runs.reorder(order, 0, float64)
  const bp = runs.reorder(order, 1, float64)
  const referenceStart = runs.reorder(order, 2, float64)
  const flags = runs.reorder(order, 3, uint8)
  const missing = runs.reorder(order, 4, float64)
  const held = runs.reorder(order, 5, float64)
  const atLeast = runs.reorder(order, 6, uint8)
  return {
    origin: cut ? cut.start : (startOf(first) ?? 0),
    rows: [referenceRow, ...rows.map(r => r.meta)],
    offsets,
    start,
    bp,
    referenceStart,
    flags,
    missing,
    held,
    atLeast,
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
  const origins = new Map<string, string>()
  if (table) {
    for (let k = 0; k < table.names.length; k++) {
      const d = departureAt(table, k)
      const name = origins.get(d.name) ?? pathOrigin(d.name).name
      origins.set(d.name, name)
      if (name !== reference) {
        pushTo(byWalk, name, d)
      }
    }
  }
  for (const list of byWalk.values()) {
    list.sort((a, b) => a.hapStart - b.hapStart)
  }
  return byWalk
}

function unloadedStepsByWalk(
  table: DepartureTable | undefined,
  reference: string | undefined,
) {
  const byWalk = new Map<string, number>()
  const counts = table?.abridgedSteps
  if (table && counts) {
    for (let k = 0; k < table.names.length; k++) {
      const steps = counts[k]!
      if (steps > 0) {
        const name = pathOrigin(table.names[k]!).name
        if (name !== reference) {
          byWalk.set(name, (byWalk.get(name) ?? 0) + steps)
        }
      }
    }
  }
  return byWalk
}

function visitColumns(
  visits: VisitColumns,
  order: number[],
  names: ArrayLike<string>,
): WalkVisitColumns {
  return {
    offsets: visits.rowOffsets(order),
    node: visits.reorder(order, 0, n => new Int32Array(n)),
    start: visits.reorder(order, 1, float64),
    bp: visits.reorder(order, 2, float64),
    onReference: visits.reorder(order, 3, uint8),
    unloaded: visits.reorder(order, 4, uint8),
    names,
  }
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
    const missing = t.missing[k]!
    if (!Number.isNaN(missing)) {
      run.missingBp = missing
    }
    if (t.atLeast[k] === 1) {
      run.atLeast = true
    }
    if (!Number.isNaN(t.held[k]!)) {
      run.heldBp = t.held[k]
    }
  } else {
    run.referenceStart = Number.isNaN(t.referenceStart[k]!)
      ? undefined
      : t.referenceStart[k]
  }
  if (f & RUN_REVERSED) {
    run.reversed = true
  }
  if (f & RUN_UNLOADED) {
    run.unloaded = true
  }
  if (f & RUN_FROM_ELSEWHERE) {
    run.fromElsewhere = true
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
      ...(v.unloaded[k] === 1 ? { unloaded: true as const } : {}),
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
