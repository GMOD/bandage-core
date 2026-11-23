import { isBackbone } from '../anchoredNodes'
import { pathOrigin } from '../pathAnchoring'
import { pushTo } from '../util/groups'

import type { Graph } from '../types'
import type { DepartureTable, GapTable, GraphTables } from './graphTables'

// One departure from a walk-file cut's tables, as @jbrowse/graph-walks'
// WalkDeparture states it less its own steps: where a haplotype's consecutive
// steps on the reference are not adjacent there. `leavePos` and `rejoinPos`
// are breakpoints on the reference, each `Reversed` where its step runs
// against the reference there, each `Passes` how many times the reference
// passes the end's node; `hapStart` is where the haplotype's own sequence
// between the ends starts on its contig and `ownBp` how far it runs, of which
// `missingBp` lies between the contig's W lines, which the graph lacks
export interface Departure {
  name: string
  hapStart: number
  ownBp: number
  missingBp: number
  leavePos: number
  leaveReversed: boolean
  leavePasses: number
  rejoinPos: number
  rejoinReversed: boolean
  rejoinPasses: number
  fromSteps: boolean
  // set where the cut does not hold the departure's own steps as one run from
  // its leave step to its rejoin step: how many of them follow the leave step
  breakAt?: number
}

const brokenAt = (breakAt = -1) => (breakAt < 0 ? {} : { breakAt })

export function departureAt(t: DepartureTable, k: number): Departure {
  return {
    name: t.names[k]!,
    hapStart: t.hapStarts[k]!,
    ownBp: t.ownBp[k]!,
    missingBp: t.missingBp[k]!,
    leavePos: t.leavePos[k]!,
    leaveReversed: t.leaveReversed[k] === 1,
    leavePasses: t.leavePasses[k]!,
    rejoinPos: t.rejoinPos[k]!,
    rejoinReversed: t.rejoinReversed[k] === 1,
    rejoinPasses: t.rejoinPasses[k]!,
    fromSteps: t.fromSteps[k] === 1,
    ...brokenAt(t.breakAt?.[k]),
  }
}

/**
 * Departures as a table, none with own steps: for tables a source other than
 * @jbrowse/graph-walks builds, and with no departures, for one that states
 * none, such as a GFA or a gbz-base cut
 */
export function departureTable(departures: Departure[] = []): DepartureTable {
  return {
    names: departures.map(d => d.name),
    hapStarts: Float64Array.from(departures, d => d.hapStart),
    ownBp: Float64Array.from(departures, d => d.ownBp),
    missingBp: Float64Array.from(departures, d => d.missingBp),
    leavePos: Float64Array.from(departures, d => d.leavePos),
    leaveReversed: Uint8Array.from(departures, d => (d.leaveReversed ? 1 : 0)),
    leavePasses: Int32Array.from(departures, d => d.leavePasses),
    rejoinPos: Float64Array.from(departures, d => d.rejoinPos),
    rejoinReversed: Uint8Array.from(departures, d =>
      d.rejoinReversed ? 1 : 0,
    ),
    rejoinPasses: Int32Array.from(departures, d => d.rejoinPasses),
    fromSteps: Uint8Array.from(departures, d => (d.fromSteps ? 1 : 0)),
    offsets: new Int32Array(departures.length + 1),
    steps: new Int32Array(0),
    reversed: new Uint8Array(0),
  }
}

type Ends = Pick<
  Departure,
  'ownBp' | 'leavePos' | 'leaveReversed' | 'rejoinPos' | 'rejoinReversed'
>

/**
 * What a departure does on the reference, from its ends, as graph-walks'
 * `departureKind` derives it with no holes: `switch`, the strands differ;
 * `back`, the walk jumps back over reference it walks again; `adjacent`,
 * sequence of its own between adjacent steps; `forward`, a jump forward over
 * reference it leaves out
 */
export type DepartureKind = 'switch' | 'back' | 'adjacent' | 'forward'

export function departureKind(d: Ends): DepartureKind {
  return d.leaveReversed !== d.rejoinReversed
    ? 'switch'
    : d.leavePos === d.rejoinPos
      ? 'adjacent'
      : (d.leaveReversed ? d.rejoinPos > d.leavePos : d.rejoinPos < d.leavePos)
        ? 'back'
        : 'forward'
}

/**
 * Whether a departure's place is the writer's choice, as graph-walks'
 * `placementChoice` says: an end lies on a node the reference passes more
 * than once, so another pass would put it elsewhere or make it none
 */
export function placementChoice(
  d: Pick<Departure, 'leavePasses' | 'rejoinPasses'>,
) {
  return d.leavePasses > 1 || d.rejoinPasses > 1
}

// The reference between a departure's breakpoints
export function departureSpan(d: Pick<Departure, 'leavePos' | 'rejoinPos'>) {
  return {
    start: Math.min(d.leavePos, d.rejoinPos),
    end: Math.max(d.leavePos, d.rejoinPos),
  }
}

// Two significant figures, as JBrowse's synteny lane header states a stretch
export function roughBp(bp: number) {
  const kb = Number((bp / 1000).toPrecision(2))
  return bp < 1000
    ? `${bp} bp`
    : kb < 1000
      ? `${kb} kb`
      : `${Number((Math.max(bp, 1_000_000) / 1_000_000).toPrecision(2))} Mb`
}

/**
 * A departure's facts in words, making no call on what it is: the reference
 * stretch between its ends and how the ends lie, the haplotype's own bp
 * between them and the part the graph lacks, and whether the place is the
 * writer's choice. `no step on GRCh38 across 54 kb · 120 kb of its own, 3 kb
 * left out of graph`
 */
export function departureText(
  d: Departure,
  reference = 'the reference',
  revisited?: number,
) {
  const { start, end } = departureSpan(d)
  const apart = roughBp(end - start)
  const kind = departureKind(d)
  const ends =
    kind === 'forward'
      ? `no step on ${reference} across ${apart}`
      : kind === 'back'
        ? `rejoins ${reference} ${apart} back`
        : kind === 'switch'
          ? `rejoins ${reference} on the other strand, ${apart} away`
          : `between adjacent steps on ${reference}`
  return [
    ends,
    departureOwnText(d, reference, revisited),
    ...(placementChoice(d) ? [PLACEMENT_CHOICE_TEXT] : []),
  ].join(' · ')
}

export const PLACEMENT_CHOICE_TEXT = 'placement choice'

// why a walk-row gap is empty (layout/walkRows.ts WalkRun)
export type GapCause =
  | 'missing'
  | 'away'
  | 'own'
  | 'mixed'
  | 'unread'
  | 'departure'

// What a gap's cause says of its bp, and the key's words for it
export const GAP_CAUSE_TEXT: Record<GapCause, string> = {
  missing: 'left out of graph',
  away: 'away from the window',
  own: 'own sequence not drawn',
  mixed: 'not drawn or left out of graph',
  unread: 'not drawn',
  // a row of departures alone: the haplotype has no step on the reference
  // across the window, which says nothing of what it carries instead
  departure: 'no step on the reference',
}

// Where a walk file's header counts no node the reference passes more than
// once (`revisited` 0), a walk's bp off the reference are sequence the
// reference lacks, its own. Where it counts some they may be a copy of a
// repeat the reference holds elsewhere, and are only off the reference's
// path, and so are they where the source states no count (NaN, or none).
export const ownIsExact = (revisited: number | undefined) => revisited === 0

export const offPathText = (reference = 'the reference') =>
  `off ${reference}'s path`

// `120 kb of its own`, or `120 kb off GRCh38's path`
export const ownAmount = (
  amount: string,
  reference: string | undefined,
  revisited: number | undefined,
) =>
  ownIsExact(revisited)
    ? `${amount} of its own`
    : `${amount} ${offPathText(reference)}`

// A departure's own bp and the part of them the graph lacks: `5.6 Mb left out
// of graph`, `350 kb of its own, 180 kb of it left out of graph`
export const departureOwnText = (
  d: Pick<Departure, 'ownBp' | 'missingBp'>,
  reference: string | undefined,
  revisited: number | undefined,
) =>
  d.missingBp > 0 && d.missingBp >= d.ownBp
    ? `${roughBp(d.ownBp)} ${GAP_CAUSE_TEXT.missing}`
    : `${ownAmount(roughBp(d.ownBp), reference, revisited)}${d.missingBp > 0 ? `, ${roughBp(d.missingBp)} of it ${GAP_CAUSE_TEXT.missing}` : ''}`

// the words for an `own` gap
export const ownGapText = (
  reference: string | undefined,
  revisited: number | undefined,
) =>
  ownIsExact(revisited)
    ? GAP_CAUSE_TEXT.own
    : `${offPathText(reference)} and not drawn`

// a gap with no cause: graph sequence the cut did not keep
export const OUTSIDE_TEXT = 'out of view'

export const NOT_LOADED_TEXT = 'nodes not shown'

// steps the source states on the reference at passes the cut does not hold,
// after an amount and the reference's name: `0.9 kb GRCh38 from elsewhere`
export const FROM_ELSEWHERE_TEXT = 'from elsewhere'

export interface GapPart {
  bp: number
  cause?: GapCause
  // for an `away` part, where a departure record states the walk rejoins
  back?: number
  missingBp?: number
  atLeast?: true
}

export type GapKind = 'steps' | 'read' | 'own' | 'unread'

export const GAP_KINDS: GapKind[] = ['steps', 'read', 'own', 'unread']

export interface GapSegment {
  kind: GapKind
  bp: number
  missingBp: number
  before: number
  after: number
  nodes: number[]
  // whether each step reads its node reversed
  reversed: boolean[]
}

export interface GraphGap {
  name: string
  edge: number
  start: number
  end: number
  segments: (Omit<GapSegment, 'nodes'> & { nodes: string[] })[]
}

/**
 * The gap part a segment the cut did not keep steps of draws as: what it
 * read and kept out, out of view; a record's own sequence it did not read,
 * left out of graph where all of it lies between W lines,
 * else one part stating both amounts in no order; and pieces it did not
 * read, not drawn
 */
export function segmentPart(segment: GapSegment): GapPart {
  const { kind, bp, missingBp } = segment
  return kind === 'own'
    ? missingBp >= bp
      ? { bp, cause: 'missing' }
      : missingBp > 0
        ? { bp, cause: 'mixed', missingBp }
        : { bp, cause: 'own' }
    : kind === 'unread'
      ? { bp, cause: 'unread' }
      : { bp }
}

/** Stretch `g` of a gap table's segments, each step through `node` */
export function stretchSegments<T>(
  t: GapTable,
  g: number,
  node: (index: number) => T,
) {
  const s = t.segments
  const out = []
  for (let k = t.segmentOffsets[g]!; k < t.segmentOffsets[g + 1]!; k++) {
    const nodes = []
    const reversed = []
    for (let j = s.stepOffsets[k]!; j < s.stepOffsets[k + 1]!; j++) {
      nodes.push(node(s.steps[j]!))
      reversed.push(s.reversed[j] === 1)
    }
    out.push({
      kind: GAP_KINDS[s.kinds[k]!]!,
      bp: s.bp[k]!,
      missingBp: s.missingBp[k]!,
      before: s.before[k]!,
      after: s.after[k]!,
      nodes,
      reversed,
    })
  }
  return out
}

/**
 * A gap of a walk's contig between two of its pieces, `from` to `to`, split
 * by what the cut states: the bp each side's fragment was trimmed of, out of
 * view; then the bp the departures inside the gap say the graph lacks, a
 * lower bound unless they run end to end across it; and the rest, the walk's
 * own sequence where one departure spans the gap, else away from the window,
 * back where a departure ending the gap rejoins. With no departure in it,
 * the gap stays whole, with no cause.
 */
export function gapParts(
  from: number,
  to: number,
  trimmed: { after?: number; before?: number },
  departures: Departure[],
): GapPart[] {
  const bp = to - from
  const inside = departures
    .filter(d => d.hapStart >= from && d.hapStart + d.ownBp <= to)
    .sort((a, b) => a.hapStart - b.hapStart)
  const first = inside[0]
  return first ? splitGap(from, to, trimmed, inside, first) : [{ bp }]
}

function splitGap(
  from: number,
  to: number,
  trimmed: { after?: number; before?: number },
  inside: Departure[],
  first: Departure,
) {
  const bp = to - from
  const left = Math.min(trimmed.after ?? 0, bp)
  const right = Math.min(trimmed.before ?? 0, bp - left)
  const between = bp - left - right
  const missing = Math.min(
    inside.reduce((sum, d) => sum + d.missingBp, 0),
    between,
  )
  const lastEnd = (d: Departure) => d.hapStart + d.ownBp
  const spans =
    inside.length === 1 && first.hapStart === from && lastEnd(first) === to
  const read =
    first.hapStart <= from + left &&
    lastEnd(inside.at(-1)!) >= to - right &&
    inside.every(
      (d, k) =>
        k === 0 ||
        d.hapStart - lastEnd(inside[k - 1]!) ===
          Math.abs(d.leavePos - inside[k - 1]!.rejoinPos),
    )
  const ending = inside.find(d => lastEnd(d) === to - right)
  const rest: GapPart = spans
    ? { bp: between - missing, cause: 'own' }
    : {
        bp: between - missing,
        cause: 'away',
        ...(ending ? { back: ending.rejoinPos } : {}),
      }
  const parts: GapPart[] = [
    { bp: left },
    { bp: missing, cause: 'missing', ...(read ? {} : { atLeast: true }) },
    rest,
    { bp: right },
  ]
  return parts.filter(part => part.bp > 0)
}

/**
 * The steps a walk takes through its departures' own steps that none of its
 * fragments counts, for node depth and the walks on links: each departure's
 * own steps as one run, or two where `breakAt` breaks them, with the
 * fragment step it leaves from before the first and the one it rejoins at
 * after the last where a fragment holds those beside an own step it lacks.
 * A step a fragment of the walk holds at the same place on its contig, or
 * that an earlier departure of the walk gave, is `held`: it counts once, so a
 * departure repeating its fragment's steps adds nothing. A departure of a walk
 * with no fragment is of a haplotype not shown and gives no run. `walk` is a
 * fragment of the walk, which names it; each step's `starts` is where it
 * starts on the walk's contig and `reversed` how the walk reads it.
 */
export function ownStepRuns({
  nodes: n,
  walks: w,
  departures: d,
}: Pick<GraphTables, 'nodes' | 'walks' | 'departures'>) {
  const runs: {
    walk: number
    steps: number[]
    held: boolean[]
    starts: number[]
    reversed: boolean[]
  }[] = []
  const lengthOf = (node: number) =>
    node < n.lengths.length ? n.lengths[node]! : 0
  const stepStarts = new Float64Array(d.steps.length > 0 ? w.steps.length : 0)
  const fragments = new Map<string, number[]>()
  if (d.steps.length > 0) {
    for (let p = 0; p < w.names.length; p++) {
      let pos = w.starts[p]!
      for (let s = w.offsets[p]!; s < w.offsets[p + 1]!; s++) {
        stepStarts[s] = pos
        pos += lengthOf(w.steps[s]!)
      }
      if (w.offsets[p + 1]! > w.offsets[p]!) {
        pushTo(fragments, pathOrigin(w.names[p]!).name, p)
      }
    }
  }
  // the first of fragment p's steps starting past `at`, or at it if `from`
  const stepAt = (p: number, at: number, from: boolean) => {
    let lo = w.offsets[p]!
    let hi = w.offsets[p + 1]!
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (from ? stepStarts[mid]! >= at : stepStarts[mid]! > at) {
        hi = mid
      } else {
        lo = mid + 1
      }
    }
    return lo
  }
  const holds = (walk: number[], at: number, node: number) =>
    walk.some(p => {
      let s = stepAt(p, at, true)
      while (s < w.offsets[p + 1]! && stepStarts[s] === at) {
        if (w.steps[s] === node) {
          return true
        }
        s++
      }
      return false
    })
  const endingAt = (walk: number[], at: number) => {
    for (const p of walk) {
      let s = stepAt(p, at, false) - 1
      while (
        s >= w.offsets[p]! &&
        stepStarts[s] === at &&
        lengthOf(w.steps[s]!) > 0
      ) {
        s--
      }
      if (s >= w.offsets[p]! && stepStarts[s]! + lengthOf(w.steps[s]!) === at) {
        return s
      }
    }
    return -1
  }
  const startingAt = (walk: number[], at: number) => {
    for (const p of walk) {
      const s = stepAt(p, at, true)
      if (s < w.offsets[p + 1]! && stepStarts[s] === at) {
        return s
      }
    }
    return -1
  }
  const given = new Set<string>()
  for (let k = 0; k < d.names.length; k++) {
    const name = pathOrigin(d.names[k]!).name
    const walk = fragments.get(name)
    const first = d.offsets[k]!
    const last = d.offsets[k + 1]!
    if (walk && last > first) {
      const breakAt = d.breakAt?.[k] ?? -1
      const split = breakAt < 0 ? last : first + breakAt
      const places = new Float64Array(last - first)
      let ahead = d.hapStarts[k]!
      for (let j = first; j < split; j++) {
        places[j - first] = ahead
        ahead += lengthOf(d.steps[j]!)
      }
      let behind = d.hapStarts[k]! + d.ownBp[k]!
      for (let j = last - 1; j >= split; j--) {
        behind -= lengthOf(d.steps[j]!)
        places[j - first] = behind
      }
      const parts: [number, number][] =
        breakAt < 0
          ? [[first, last]]
          : [
              [first, split],
              [split, last],
            ]
      parts.forEach(([from, to], part) => {
        if (to > from) {
          const steps: number[] = []
          const held: boolean[] = []
          const starts: number[] = []
          const reversed: boolean[] = []
          for (let j = from; j < to; j++) {
            const node = d.steps[j]!
            const at = places[j - first]!
            const key = `${name}\t${at}\t${node}`
            steps.push(node)
            held.push(holds(walk, at, node) || given.has(key))
            starts.push(at)
            reversed.push(d.reversed[j] === 1)
            given.add(key)
          }
          const leave =
            part === 0 && !held[0] ? endingAt(walk, d.hapStarts[k]!) : -1
          const rejoin =
            part === parts.length - 1 && !held.at(-1)
              ? startingAt(walk, d.hapStarts[k]! + d.ownBp[k]!)
              : -1
          if (leave >= 0) {
            steps.unshift(w.steps[leave]!)
            held.unshift(true)
            starts.unshift(stepStarts[leave]!)
            reversed.unshift(w.reversed[leave] === 1)
          }
          if (rejoin >= 0) {
            steps.push(w.steps[rejoin]!)
            held.push(true)
            starts.push(stepStarts[rejoin]!)
            reversed.push(w.reversed[rejoin] === 1)
          }
          runs.push({ walk: walk[0]!, steps, held, starts, reversed })
        }
      })
    }
  }
  return runs
}

// The own steps no walk carries of each departure that leaves or rejoins the
// reference past the cut's ends: a haplotype's sequence on its way to a place
// the cut does not hold. They are drawn at their length like any node, and
// the fit leaves them to run off the pane, as the reference runs on past the
// cut.
export function departureTails(graph: Graph) {
  const tails = new Set<string>()
  const d = graph.departures
  const backbone = graph.nodes.filter(isBackbone)
  if (d && backbone.length > 0) {
    let start = Infinity
    let end = -Infinity
    for (const node of backbone) {
      start = Math.min(start, node.stable.start)
      end = Math.max(end, node.stable.start + node.length)
    }
    const off = (pos: number) => pos < start || pos > end
    for (let k = 0; k < d.names.length; k++) {
      if (off(d.leavePos[k]!) || off(d.rejoinPos[k]!)) {
        for (let j = d.offsets[k]!; j < d.offsets[k + 1]!; j++) {
          const id = graph.nodes[d.steps[j]!]?.id
          if (id !== undefined) {
            tails.add(id)
          }
        }
      }
    }
    if (tails.size > 0) {
      for (const path of graph.paths ?? []) {
        for (const id of path.nodeIds) {
          tails.delete(id)
        }
      }
    }
  }
  return tails
}
