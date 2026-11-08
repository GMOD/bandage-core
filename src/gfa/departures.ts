import type { DepartureTable, GapTable } from './graphTables'

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
}

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
  return bp >= 1_000_000
    ? `${Number((bp / 1_000_000).toPrecision(2))} Mb`
    : bp >= 1000
      ? `${Number((bp / 1000).toPrecision(2))} kb`
      : `${bp} bp`
}

/**
 * A departure's facts in words, making no call on what it is: the reference
 * stretch between its ends and how the ends lie, the haplotype's own bp
 * between them and the part the graph lacks, and whether the place is the
 * writer's choice. `no step on GRCh38 across 54 kb · 120 kb of its own`
 */
export function departureText(d: Departure, reference = 'the reference') {
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
    `${roughBp(d.ownBp)} of its own`,
    ...(d.missingBp > 0 ? [`${roughBp(d.missingBp)} not in the graph`] : []),
    ...(placementChoice(d) ? [PLACEMENT_CHOICE_TEXT] : []),
  ].join(' · ')
}

export const PLACEMENT_CHOICE_TEXT = 'placement choice'

// why a walk-row gap is empty (layout/walkRows.ts WalkRun)
export type GapCause =
  | 'missing'
  | 'elsewhere'
  | 'own'
  | 'mixed'
  | 'unread'
  | 'abridged'
  | 'departure'

// What a gap's cause says of its bp, and the key's words for it
export const GAP_CAUSE_TEXT: Record<GapCause, string> = {
  missing: 'not in the graph',
  elsewhere: 'on nodes filed elsewhere',
  own: 'of its own, not read',
  mixed: 'of its own, part not read and part not in the graph',
  unread: 'not read',
  abridged: 'abridged: steps not loaded',
  // a row of departures alone: the haplotype has no step on the reference
  // across the window, which says nothing of what it carries instead
  departure: 'no step on the reference',
}

// a gap with no cause: graph sequence the cut did not keep
export const OUTSIDE_TEXT = 'outside the extracted subgraph'

export interface GapPart {
  bp: number
  cause?: GapCause
  // for an `elsewhere` or `unread` part, the reference position the walk
  // goes on, or was last seen, near
  near?: number
  missingBp?: number
}

export type GapKind = 'steps' | 'read' | 'abridged' | 'own' | 'unread'

export const GAP_KINDS: GapKind[] = [
  'steps',
  'read',
  'abridged',
  'own',
  'unread',
]

export interface GapSegment {
  kind: GapKind
  bp: number
  missingBp: number
  abridged: boolean
  before: number
  after: number
  nodes: number[]
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
 * read and kept out, outside the extracted subgraph; an abridged run; a
 * record's own sequence it did not read, not in the graph where all of it
 * lies between W lines, else one part stating both amounts in no order; and
 * pieces it did not read, near where the walk was last seen
 */
export function segmentPart(segment: GapSegment): GapPart {
  const { kind, bp, missingBp, before } = segment
  return kind === 'abridged'
    ? { bp, cause: 'abridged' }
    : kind === 'own'
      ? missingBp >= bp
        ? { bp, cause: 'missing' }
        : missingBp > 0
          ? { bp, cause: 'mixed', missingBp }
          : { bp, cause: 'own' }
      : kind === 'unread'
        ? {
            bp,
            cause: 'unread',
            ...(Number.isNaN(before) ? {} : { near: before }),
          }
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
    for (let j = s.stepOffsets[k]!; j < s.stepOffsets[k + 1]!; j++) {
      nodes.push(node(s.steps[j]!))
    }
    out.push({
      kind: GAP_KINDS[s.kinds[k]!]!,
      bp: s.bp[k]!,
      missingBp: s.missingBp[k]!,
      abridged: s.abridged[k] === 1,
      before: s.before[k]!,
      after: s.after[k]!,
      nodes,
    })
  }
  return out
}

/**
 * A gap of a walk's contig between two of its pieces, `from` to `to`, split
 * by what the cut states: the bp each side's fragment was trimmed of, outside
 * the extracted subgraph; then the bp the departures inside the gap say the
 * graph lacks; and the rest, the walk's own sequence the cut did not read
 * where one departure leaves at the gap's start and rejoins at its end, and
 * else on nodes filed near where the first leaves for. With no departure in
 * it, the gap stays whole, with no cause.
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
  const spans =
    inside.length === 1 &&
    first.hapStart === from &&
    first.hapStart + first.ownBp === to
  const rest: GapPart = spans
    ? { bp: between - missing, cause: 'own' }
    : {
        bp: between - missing,
        cause: 'elsewhere',
        near: first.hapStart === from ? first.rejoinPos : first.leavePos,
      }
  const parts: GapPart[] = [
    { bp: left },
    { bp: missing, cause: 'missing' },
    rest,
    { bp: right },
  ]
  return parts.filter(part => part.bp > 0)
}
