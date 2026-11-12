// Which way each segment is drawn, which is what its node id's `+` or `-`
// says. A stranded layout trusts it: the stress engine lays a backbone
// segment start to end along the reference, and a link joins the ends its
// strands name read against the id's. So the orientation has to be the one a
// reader walking along the reference reads the segment in, and nothing about
// how the file happens to be written: not the order of its L lines, and not
// which of a link's two spellings it uses (`L a + b -` is `L b + a -`).
//
// - A backbone segment reads forward: its stable coordinate is on the
//   reference's own strand.
// - Orientation spreads out through links, a round at a time from the segments
//   oriented so far. A link from an oriented segment says which way the walk
//   along the reference reads the other end, and a segment takes the reading
//   most of its links to the last round's segments say. Rounds rather than a
//   queue, so no segment's reading depends on which link was met first.
// - Where those links split evenly, as an allele some haplotypes carry
//   inverted can, it reads as stored, forward.
// - A part of the graph no backbone reaches starts the same way from its
//   lowest-named segment, forward; a segment no link names reads as most walks
//   of it do, forward on a tie.
//
// One orientation per segment, so a segment is one node however many ways
// links and walks read it.
//
// A link is then stated in the spelling that reads its ends as they are
// oriented, so its arrowhead points along the reference whichever spelling the
// file used. A link that reads one end against its orientation, as an
// inversion's do, reads the same either way, and is stated from its
// lower-named end.

export interface SegmentLinks {
  from: ArrayLike<number>
  to: ArrayLike<number>
  // 1 when the link leaves `from` reversed, 2 when it enters `to` reversed
  strands: ArrayLike<number>
}

export const FORWARD = 1
export const REVERSED = 2

// `names` index every segment the links and walks name; `backbone[i]` is 1 for
// a rank-0 segment; `walkReversals[i]` is how many more walk steps read
// segment i reversed than forward
export function orientSegments(
  names: readonly string[],
  backbone: ArrayLike<number>,
  links: SegmentLinks,
  walkReversals: ArrayLike<number>,
) {
  const count = names.length
  const orient = new Uint8Array(count)
  const linkCount = links.from.length
  const degree = new Int32Array(count + 1)
  for (let k = 0; k < linkCount; k++) {
    degree[links.from[k]! + 1]!++
    degree[links.to[k]! + 1]!++
  }
  for (let i = 0; i < count; i++) {
    degree[i + 1]! += degree[i]!
  }
  const at = degree.slice(0, count)
  const incident = new Int32Array(degree[count]!)
  for (let k = 0; k < linkCount; k++) {
    incident[at[links.from[k]!]!++] = k
    incident[at[links.to[k]!]!++] = k
  }

  // The reading of segment `i` a link says, from the oriented segment at its
  // other end: the walk along the reference reads `i` as the link does where
  // it reads that end as oriented, and flipped where it reads it flipped
  const vote = (i: number, k: number) => {
    const fromEnd = links.from[k] === i
    const other = fromEnd ? links.to[k]! : links.from[k]!
    const strands = links.strands[k]!
    const mine = fromEnd ? strands & 1 : strands & 2
    const theirs = fromEnd ? strands & 2 : strands & 1
    const agrees = (theirs !== 0) === (orient[other] === REVERSED)
    return other === i || orient[other] === 0
      ? 0
      : (mine !== 0) === agrees
        ? -1
        : 1
  }

  const spread = (from: number[]) => {
    let reached = from
    while (reached.length > 0) {
      const next = new Set<number>()
      for (const i of reached) {
        for (let e = degree[i]!; e < degree[i + 1]!; e++) {
          const k = incident[e]!
          const other = links.from[k] === i ? links.to[k]! : links.from[k]!
          if (orient[other] === 0) {
            next.add(other)
          }
        }
      }
      const decided = [...next].map(i => {
        let sum = 0
        for (let e = degree[i]!; e < degree[i + 1]!; e++) {
          sum += vote(i, incident[e]!)
        }
        return [i, sum < 0 ? REVERSED : FORWARD] as const
      })
      for (const [i, o] of decided) {
        orient[i] = o
      }
      reached = [...next]
    }
  }

  const seeds: number[] = []
  for (let i = 0; i < count; i++) {
    if (backbone[i]) {
      orient[i] = FORWARD
      seeds.push(i)
    }
  }
  spread(seeds)

  const byName = Array.from({ length: count }, (_, i) => i).sort((a, b) =>
    names[a]! < names[b]! ? -1 : names[a]! > names[b]! ? 1 : 0,
  )
  for (const i of byName) {
    if (orient[i] === 0 && degree[i + 1]! > degree[i]!) {
      orient[i] = FORWARD
      spread([i])
    }
  }
  for (let i = 0; i < count; i++) {
    if (orient[i] === 0) {
      orient[i] = walkReversals[i]! > 0 ? REVERSED : FORWARD
    }
  }
  return orient
}

// `L b ~sb a ~sa` leaves b reversed where the link entered it forward, and
// enters a reversed where the link left it forward
export const respelledStrands = (strands: number) =>
  (strands & 2 ? 0 : 1) | (strands & 1 ? 0 : 2)

// Whether link `k` is better stated in its other spelling, `L b ~sb a ~sa`
export function respelled(
  names: readonly string[],
  orient: Uint8Array,
  links: SegmentLinks,
  k: number,
) {
  const from = links.from[k]!
  const to = links.to[k]!
  const strands = links.strands[k]!
  const agrees =
    Number(((strands & 1) !== 0) === (orient[from] === REVERSED)) +
    Number(((strands & 2) !== 0) === (orient[to] === REVERSED))
  return agrees === 1 ? names[to]! < names[from]! : agrees === 0
}
