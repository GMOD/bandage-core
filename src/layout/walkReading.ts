// What a walk does along its contig: follows the reference over [lo, hi),
// along or against it, or runs `bp` of its own. @jbrowse/graph-walks'
// PathEvent.
export type PathEvent =
  | { kind: 'on'; lo: number; hi: number; reversed: boolean }
  | { kind: 'own'; bp: number }

/**
 * Whether a walk reads the reference back to front, @jbrowse/graph-walks'
 * readsBackToFront, which a host of core need not load: one that walks it
 * only along it, or only against it, reads that way; one that does both is
 * forward where it leaves the reference further along than it entered, and
 * the bp walked each way decide only where it leaves where it entered.
 */
export function readsBackToFront(events: readonly PathEvent[]) {
  const stretches = events.filter(e => e.kind === 'on')
  const first = stretches[0]
  const last = stretches.at(-1)
  const bp = (reversed: boolean) =>
    stretches
      .filter(e => e.reversed === reversed)
      .reduce((sum, e) => sum + (e.hi - e.lo || 1), 0)
  const along = bp(false)
  const against = bp(true)
  const progress =
    first && last
      ? (last.reversed ? last.lo : last.hi) -
        (first.reversed ? first.hi : first.lo)
      : 0
  return along === 0 || against === 0 || progress === 0
    ? against > along
    : progress < 0
}

// A point on a walk's contig `hap` where it is on the reference at `pos`
// until (a piece's last step, `exit`, or a departure's leave, `order` 0) or
// from (a piece's first step or a departure's rejoin, 1). `own` is the bp of
// its own that follow a leave.
export interface PathAnchor {
  hap: number
  order: 0 | 1
  pos: number
  reversed: boolean
  exit?: boolean
  own?: number
}

/**
 * A walk's events from its pieces' ends and its departures' ends, in contig
 * order, as graph-walks' walkDepartures reads a chain: between a rejoin and
 * the next leave it follows the reference.
 */
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
