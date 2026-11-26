import type { GraphTables } from './graphTables'

/**
 * What a walk does past one end of its fragment of a window, as
 * @jbrowse/graph-walks' runs say it: `beyond`, it is next on the reference
 * past the drawn stretch on that side, the same way round; `elsewhere`, it
 * is next on the reference reversed, or back on the other side; `edge`, no
 * departure, and the end lies on the drawn stretch's edge, so nothing is
 * known of what the walk does next; `ends`, no departure and the end lies
 * inside the drawn stretch: the walk has no step on the reference sequence
 * past it. graph-fold's END_KINDS are the same four in the same order.
 */
export const END_KINDS = ['beyond', 'elsewhere', 'edge', 'ends'] as const

export type EndKind = (typeof END_KINDS)[number]

/**
 * One end of each fragment, by END_KINDS index in `kinds`: for a departure,
 * its breakpoint off the fragment, whether that step runs against the
 * reference, the walk's own bp between and the part of them the file lacks;
 * for `ends`, the own bp read past the stretch; NaN where not stated
 */
export interface WalkEndTable {
  kinds: Uint8Array
  pos: Float64Array
  reversed: Uint8Array
  ownBp: Float64Array
  missingBp: Float64Array
}

/**
 * A window's walks as runs, graph-walks' WalkRuns (typecheck/graphWalks.ts
 * holds the two equal): a fragment per walk of the cut, the reference's
 * first, each its stretches of consecutive reference steps at `offsets[p]`
 * up to `offsets[p + 1]`, the own bp before each stretch past the first,
 * the own bp before the first and after the last, and what lies past each
 * end
 */
export interface WalkRunsTables {
  refName: string
  drawn: { refName: string; start: number; end: number }
  revisited: number
  holes: { start: number; end: number }[]
  reference: { names: string[]; starts: Float64Array; lengths: Int32Array }
  walks: {
    names: string[]
    starts: Float64Array
    ends: Float64Array
    trimmedBefore: Float64Array
    trimmedAfter: Float64Array
    offsets: Int32Array
    leadBp: Float64Array
    leadLoaded: Uint8Array
    tailBp: Float64Array
    tailLoaded: Uint8Array
    before: WalkEndTable
    after: WalkEndTable
  }
  stretches: {
    starts: Float64Array
    bp: Float64Array
    against: Uint8Array
    offBefore: Float64Array
    loaded: Uint8Array
  }
}

export interface PathEnd {
  kind: EndKind
  pos: number
  reversed: boolean
  ownBp: number
  missingBp: number
}

/** What lies past a cut walk's two ends, against the reference `refName` */
export interface PathEnds {
  refName: string
  before: PathEnd
  after: PathEnd
}

const edgeKey = (name: string, pos: number, reversed: boolean, hap: number) =>
  `${name}\t${pos}\t${reversed ? '-' : '+'}\t${hap}`

const breakpoint = (lo: number, hi: number, against: boolean, leave: boolean) =>
  against === leave ? lo : hi

/**
 * Each walk's ends in a cut's tables against the reference walk `refName`,
 * as graph-walks' fragmentRuns reads them, which a test holds them equal to:
 * from the departure table's departure rejoining a walk's first step on the
 * reference, or leaving its last, told apart by the reference's drawn
 * stretch. Undefined for a walk with no step on the reference, and for every
 * walk of tables that do not say where a step lies on it.
 */
export function cutEnds(
  { nodes, walks, departures }: GraphTables,
  refName: string,
) {
  const refStarts =
    walks.refStarts ?? new Float64Array(walks.steps.length).fill(Number.NaN)
  const lengthOf = (s: number) => nodes.lengths[walks.steps[s]!]!
  const againstAt = (s: number) =>
    (walks.reversed[s]! ^ (nodes.reversed?.[walks.steps[s]!] ?? 0)) === 1
  const onReference = (s: number) => !Number.isNaN(refStarts[s]!)
  const rejoining = new Map<string, number>()
  const leaving = new Map<string, number>()
  departures.names.forEach((name, k) => {
    const hap = departures.hapStarts[k]!
    leaving.set(
      edgeKey(
        name,
        departures.leavePos[k]!,
        departures.leaveReversed[k] === 1,
        hap,
      ),
      k,
    )
    rejoining.set(
      edgeKey(
        name,
        departures.rejoinPos[k]!,
        departures.rejoinReversed[k] === 1,
        hap + departures.ownBp[k]!,
      ),
      k,
    )
  })
  let drawnStart = Infinity
  let drawnEnd = -Infinity
  walks.names.forEach((name, p) => {
    const to = name === refName ? walks.offsets[p + 1]! : 0
    for (let s = walks.offsets[p]!; s < to; s++) {
      if (onReference(s)) {
        drawnStart = Math.min(drawnStart, refStarts[s]!)
        drawnEnd = Math.max(drawnEnd, refStarts[s]! + lengthOf(s))
      }
    }
  })
  const pastDrawn = (pos: number, highSide: boolean) =>
    highSide ? pos >= drawnEnd : pos <= drawnStart
  const end = (
    k: number | undefined,
    leave: boolean,
    at: number,
    against: boolean,
    readBp: number,
  ): PathEnd => {
    const pos =
      k === undefined
        ? Number.NaN
        : departures[leave ? 'rejoinPos' : 'leavePos'][k]!
    const reversed =
      k !== undefined &&
      departures[leave ? 'rejoinReversed' : 'leaveReversed'][k] === 1
    const highSide = against !== leave
    const kind: EndKind =
      k === undefined
        ? pastDrawn(at, highSide)
          ? 'edge'
          : 'ends'
        : reversed === against && pastDrawn(pos, highSide)
          ? 'beyond'
          : 'elsewhere'
    return {
      kind,
      pos,
      reversed,
      ownBp:
        k !== undefined
          ? departures.ownBp[k]!
          : kind === 'ends'
            ? readBp
            : Number.NaN,
      missingBp: k === undefined ? 0 : departures.missingBp[k]!,
    }
  }
  // walk p's ends, its first step on the reference `firstOn` and its last
  // `lastOn`
  const endsOf = (p: number, firstOn: number, lastOn: number): PathEnds => {
    const name = walks.names[p]!
    let leadBp = 0
    for (let s = walks.offsets[p]!; s < firstOn; s++) {
      leadBp += lengthOf(s)
    }
    let tailBp = 0
    for (let s = lastOn + 1; s < walks.offsets[p + 1]!; s++) {
      tailBp += lengthOf(s)
    }
    const headAgainst = againstAt(firstOn)
    const tailAgainst = againstAt(lastOn)
    const firstBreak = breakpoint(
      refStarts[firstOn]!,
      refStarts[firstOn]! + lengthOf(firstOn),
      headAgainst,
      false,
    )
    const lastBreak = breakpoint(
      refStarts[lastOn]!,
      refStarts[lastOn]! + lengthOf(lastOn),
      tailAgainst,
      true,
    )
    return {
      refName,
      before: end(
        rejoining.get(
          edgeKey(name, firstBreak, headAgainst, walks.starts[p]! + leadBp),
        ),
        false,
        firstBreak,
        headAgainst,
        (walks.trimmedBefore?.[p] ?? 0) + leadBp,
      ),
      after: end(
        leaving.get(
          edgeKey(name, lastBreak, tailAgainst, walks.ends[p]! - tailBp),
        ),
        true,
        lastBreak,
        tailAgainst,
        (walks.trimmedAfter?.[p] ?? 0) + tailBp,
      ),
    }
  }
  return walks.names.map((_, p) => {
    const to = walks.offsets[p + 1]!
    let firstOn = walks.offsets[p]!
    while (firstOn < to && !onReference(firstOn)) {
      firstOn++
    }
    let lastOn = to - 1
    while (lastOn > firstOn && !onReference(lastOn)) {
      lastOn--
    }
    return firstOn < to ? endsOf(p, firstOn, lastOn) : undefined
  })
}
