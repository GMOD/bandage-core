// graph-walks' PathEvent
export type PathEvent =
  | { kind: 'on'; lo: number; hi: number; reversed: boolean }
  | { kind: 'own'; bp: number }

// @jbrowse/graph-walks' readsBackToFront, which a host of core need not load
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
  const ends = [stretches[0], stretches.at(-1)].flatMap(e =>
    e && e.hi === e.lo ? [e] : [],
  )
  const reversedWalk = against > 0
  return along > 0 && against > 0
    ? progress === 0
      ? against > along
      : progress < 0
    : ends.length > 0 && ends.every(e => e.reversed !== reversedWalk)
      ? !reversedWalk
      : reversedWalk
}

// graph-walks' PathAnchor
export interface PathAnchor {
  hap: number
  order: 0 | 1
  pos: number
  reversed: boolean
  exit?: true
  own?: number
}

// graph-walks' anchorEvents
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
