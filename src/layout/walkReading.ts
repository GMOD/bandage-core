// What a contig does along the reference, in contig order: follows it over
// [lo, hi), along or against it, or runs `bp` of its own
export type PathEvent =
  | { kind: 'on'; lo: number; hi: number; reversed: boolean }
  | { kind: 'own'; bp: number }

/**
 * Whether a contig reads the reference back to front, from the bp it walks
 * along the reference and against it. One that walks both ways is forward
 * where it leaves the reference further along than it entered, so an
 * inversion filling most of the window does not turn round a contig whose
 * flanks run forward; the bp decide where it leaves where it entered. One
 * that walks one way only reads that way, unless departures at both its ends
 * stand on the reference the other way, as a window inside an inversion sees
 * it. A departure's end walks no bp and decides nothing else, but for a
 * contig of departures alone, which reads the way most of their ends stand.
 */
export function readsBackToFront(events: readonly PathEvent[]) {
  const stretches = events.filter(e => e.kind === 'on')
  const walked = stretches.filter(e => e.hi > e.lo)
  const bp = (reversed: boolean) =>
    walked
      .filter(e => e.reversed === reversed)
      .reduce((sum, e) => sum + e.hi - e.lo, 0)
  const along = bp(false)
  const against = bp(true)
  const first = walked[0]
  const last = walked.at(-1)
  const progress =
    first && last
      ? (last.reversed ? last.lo : last.hi) -
        (first.reversed ? first.hi : first.lo)
      : 0
  const reversedWalk = against > 0
  const bracketed =
    stretches.length > 2 &&
    [stretches[0]!, stretches.at(-1)!].every(
      e => e.hi === e.lo && e.reversed !== reversedWalk,
    )
  const reversedEnds = stretches.filter(e => e.reversed).length
  return walked.length === 0
    ? reversedEnds > stretches.length - reversedEnds
    : along > 0 && against > 0
      ? progress === 0
        ? against > along
        : progress < 0
      : bracketed
        ? !reversedWalk
        : reversedWalk
}

// A point on a contig: where it is on the reference until (a piece's last
// step or a departure's leave, `order` 0) or from (a piece's first step or a
// departure's rejoin, 1), with the bp of its own that follow a leave
export interface PathAnchor {
  hap: number
  order: 0 | 1
  pos: number
  reversed: boolean
  exit?: true
  own?: number
}

// A contig's events from its anchors in contig order: between a rejoin and
// the next leave it follows the reference
export function anchorEvents(anchors: readonly PathAnchor[]) {
  const sorted = anchors.toSorted((a, b) => a.hap - b.hap || a.order - b.order)
  const events: PathEvent[] = []
  let open: { pos: number; reversed: boolean } | undefined
  let end: number | undefined
  const close = () => {
    if (open) {
      const to = end ?? open.pos
      events.push({
        kind: 'on',
        lo: Math.min(open.pos, to),
        hi: Math.max(open.pos, to),
        reversed: open.reversed,
      })
    }
    open = undefined
    end = undefined
  }
  for (const a of sorted) {
    if (open && open.reversed !== a.reversed) {
      close()
    }
    if (a.order === 1) {
      open ??= { pos: a.pos, reversed: a.reversed }
    } else if (a.exit) {
      if (open) {
        end = a.pos
      }
    } else {
      open ??= { pos: a.pos, reversed: a.reversed }
      end = a.pos
      close()
      events.push({ kind: 'own', bp: a.own ?? 0 })
    }
  }
  close()
  return events
}
