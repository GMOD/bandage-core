import type { WalkRow, WalkVisit } from './walkRows'

// A ribbon between row `row` and the row below it: bar offsets a0..a1 on the
// upper row walk the same nodes as b0..b1 on the lower, `b0 > b1` where the
// lower row walks them backwards
export interface WalkRowLink {
  row: number
  a0: number
  a1: number
  b0: number
  b1: number
}

// A stretch of row `row`'s bar through block `block`, 0 for the block with
// the most bp over every row
export interface WalkRowBlock {
  row: number
  start: number
  bp: number
  block: number
}

interface Bar {
  visits: WalkVisit[]
  // each node's offsets along the bar, one per visit
  offsets: Map<string, number[]>
  lengths: Map<string, number>
}

// A row cut from one flank, or without visits, has no bar to compare
function barOf(row: WalkRow): Bar | undefined {
  if (!row.complete || !row.visits) {
    return undefined
  }
  const offsets = new Map<string, number[]>()
  const lengths = new Map<string, number>()
  for (const { node, start, bp } of row.visits) {
    const at = offsets.get(node)
    if (at) {
      at.push(start)
    } else {
      offsets.set(node, [start])
      lengths.set(node, bp)
    }
  }
  return { visits: row.visits, offsets, lengths }
}

// How far apart two shared stretches may lie and still join, by default a
// 2000th of the longest bar
export function ribbonJoin(rows: WalkRow[]) {
  return Math.max(...rows.map(r => r.bp)) / 2000
}

function sharedBp(a: Bar, b: Bar) {
  let bp = 0
  for (const [id, visits] of a.offsets) {
    const other = b.offsets.get(id)
    if (other) {
      bp += a.lengths.get(id)! * Math.min(visits.length, other.length)
    }
  }
  return bp
}

/**
 * The first row, then each row after the one it shares the most sequence
 * with, so neighbours share as much as they can. A row with no bar is passed
 * over when comparing.
 */
export function sharedRowOrder(rows: WalkRow[]) {
  const bars = rows.map(barOf)
  const order = [0]
  const rest = bars.map((_, i) => i).slice(1)
  while (rest.length > 0) {
    const last = bars[order.findLast(i => bars[i]) ?? 0]
    let best = 0
    let bestBp = -1
    rest.forEach((i, k) => {
      const bar = bars[i]
      const bp = last && bar ? sharedBp(last, bar) : 0
      if (bp > bestBp) {
        best = k
        bestBp = bp
      }
    })
    order.push(...rest.splice(best, 1))
  }
  return order
}

interface Run {
  a0: number
  a1: number
  b0: number
  b1: number
  // 1 forward, -1 backward, 0 while it holds one node
  dir: number
  step: number
}

// Whether a lower-row visit at `b` carries a run on, and which way
function continues(run: Run, b: number, len: number, join: number) {
  const low = run.dir === 0 ? run.b0 : run.b1
  if (run.dir >= 0 && b >= run.b1 && b - run.b1 <= join) {
    return 1
  }
  if (run.dir <= 0 && b + len <= low && low - b - len <= join) {
    return -1
  }
  return 0
}

// Every stretch two rows share, each a run of nodes both walk in step, joined
// across unshared stretches of `join` bp or less in both
function sharedRuns(upper: Bar, lower: Bar, join: number) {
  const runs: Run[] = []
  let open: Run[] = []
  upper.visits.forEach(({ node, start: a, bp: len }, k) => {
    const visits = lower.offsets.get(node)
    if (!visits || len === 0) {
      return
    }
    open = open.filter(run => a - run.a1 <= join)
    for (const b of visits) {
      let dir = 0
      const run = open.find(
        r => r.step !== k && (dir = continues(r, b, len, join)) !== 0,
      )
      if (!run) {
        const fresh = {
          a0: a,
          a1: a + len,
          b0: b,
          b1: b + len,
          dir: 0,
          step: k,
        }
        runs.push(fresh)
        open.push(fresh)
      } else if (dir > 0) {
        Object.assign(run, { a1: a + len, b1: b + len, dir, step: k })
      } else {
        const high = run.dir === 0 ? run.b1 : run.b0
        Object.assign(run, { a1: a + len, b0: high, b1: b, dir, step: k })
      }
    }
  })
  return runs
}

// The heaviest set of runs in one order down both bars. Where a repeat's
// copies pair several ways between two rows, this keeps the pairing that
// holds the rows in step, and a copy one row has more of is left unjoined.
function chained(runs: Run[], join: number) {
  const sorted = runs
    .filter(r => r.a1 - r.a0 >= join)
    .sort((x, y) => x.a0 - y.a0)
  const lo = (r: Run) => Math.min(r.b0, r.b1)
  const hi = (r: Run) => Math.max(r.b0, r.b1)
  const best: number[] = []
  const prev: number[] = []
  sorted.forEach((run, i) => {
    best[i] = run.a1 - run.a0
    prev[i] = -1
    for (let j = 0; j < i; j++) {
      const q = sorted[j]!
      const weight = best[j]! + run.a1 - run.a0
      if (
        q.a1 <= run.a0 + join &&
        hi(q) <= lo(run) + join &&
        weight > best[i]
      ) {
        best[i] = weight
        prev[i] = j
      }
    }
  })
  const out: Run[] = []
  let i = best.indexOf(Math.max(...best))
  while (i >= 0) {
    out.unshift(sorted[i]!)
    i = prev[i]!
  }
  return out
}

/** The ribbons between each two neighbouring rows that both have bars */
export function walkRowLinks(
  rows: WalkRow[],
  join = ribbonJoin(rows),
): WalkRowLink[] {
  const bars = rows.map(barOf)
  const links: WalkRowLink[] = []
  for (let i = 0; i + 1 < bars.length; i++) {
    const [upper, lower] = [bars[i], bars[i + 1]]
    if (upper && lower) {
      for (const { a0, a1, b0, b1 } of chained(
        sharedRuns(upper, lower, join),
        join,
      )) {
        links.push({ row: i, a0, a1, b0, b1 })
      }
    }
  }
  return links
}

/**
 * Blocks of nodes off the reference's path that two or more rows walk: the
 * nodes one set of rows walks, joined where a row walks them within `join` bp
 * of each other. Blocks rank by bp over every visit, so a block has one rank
 * in every row, set by neither the rows' order nor the build order that
 * created its nodes. A block under 0.3% of the bp off the path is left out.
 * Returns each row's stretches of each block.
 */
export function walkRowBlocks(
  rows: WalkRow[],
  join = ribbonJoin(rows),
): WalkRowBlock[] {
  const bars = rows.map(barOf)
  const carriers = new Map<string, Set<string>>()
  bars.forEach((bar, i) => {
    for (const { node, onReference } of bar?.visits ?? []) {
      if (!onReference) {
        carriers.set(node, (carriers.get(node) ?? new Set()).add(rows[i]!.name))
      }
    }
  })
  const setKey = new Map<string, string>()
  for (const [id, carried] of carriers) {
    if (carried.size > 1) {
      setKey.set(id, [...carried].sort().join('\n'))
    }
  }
  const parent = new Map([...setKey.keys()].map(id => [id, id]))
  const find = (id: string) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)!)!)
      id = parent.get(id)!
    }
    return id
  }
  for (const bar of bars) {
    const last = new Map<string, { id: string; end: number }>()
    for (const { node: id, start, bp } of bar?.visits ?? []) {
      const key = setKey.get(id)
      if (key === undefined) {
        continue
      }
      const prev = last.get(key)
      if (prev && start - prev.end <= join) {
        parent.set(find(id), find(prev.id))
      }
      last.set(key, { id, end: start + bp })
    }
  }
  const total = new Map<string, number>()
  const least = new Map<string, string>()
  let offBp = 0
  for (const bar of bars) {
    for (const { node: id, onReference, bp } of bar?.visits ?? []) {
      if (onReference) {
        continue
      }
      offBp += bp
      if (setKey.has(id)) {
        const root = find(id)
        total.set(root, (total.get(root) ?? 0) + bp)
        const lowest = least.get(root)
        if (lowest === undefined || id < lowest) {
          least.set(root, id)
        }
      }
    }
  }
  const ranked = [...total.keys()]
    .filter(root => total.get(root)! >= offBp * 0.003)
    .sort(
      (a, b) =>
        total.get(b)! - total.get(a)! ||
        (least.get(a)! < least.get(b)! ? -1 : 1),
    )
  const rank = new Map(ranked.map((root, i) => [root, i]))
  const spans: { row: number; start: number; end: number; block: number }[] = []
  bars.forEach((bar, i) => {
    let last: (typeof spans)[number] | undefined
    for (const { node: id, start, bp } of bar?.visits ?? []) {
      const block = setKey.has(id) ? rank.get(find(id)) : undefined
      if (block === undefined) {
        continue
      }
      const end = start + bp
      if (last?.block === block && start - last.end <= join) {
        last.end = end
      } else {
        last = { row: i, start, end, block }
        spans.push(last)
      }
    }
  })
  return spans.map(({ row, start, end, block }) => ({
    row,
    start,
    bp: end - start,
    block,
  }))
}
