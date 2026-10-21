import type { NodeSegment } from '../types'

export const THREAD_PX = 2
export const THREAD_GAP_PX = 1.5
export const SLOT_GAP_PX = 4
export const LANE_SMOOTHING_PX = 12
export const THREAD_REACH_PX = 64
export const THREAD_TAPER_PX = 24

// Walks lifted together draw a thread per pass through a node once one of
// them passes a node twice
export const threadsPasses = (walks: readonly { mostPasses: number }[]) =>
  walks.length > 1 && walks.some(w => w.mostPasses > 1)

export const PASSES_KEY = 'a thread per pass through a node'

export interface LaneThread {
  offset: number
  halfWidth: number
}

export interface Normal {
  nx: number
  ny: number
}

export function laneSlots(mostPasses: readonly number[], laneWidth: number) {
  const threaded = mostPasses.map(most => most > 1)
  const spans = mostPasses.map((most, i) =>
    threaded[i] ? most * THREAD_PX + (most - 1) * THREAD_GAP_PX : laneWidth,
  )
  const gaps = spans.map((_, i): number =>
    i > 0 && (threaded[i - 1] || threaded[i]) ? SLOT_GAP_PX : 0,
  )
  const band =
    spans.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0)
  let at = -band / 2
  return mostPasses.map((most, i): LaneThread[] => {
    at += gaps[i]!
    const from = at
    at += spans[i]!
    return threaded[i]
      ? Array.from({ length: most }, (_, pass) => ({
          offset: from + pass * (THREAD_PX + THREAD_GAP_PX) + THREAD_PX / 2,
          halfWidth: THREAD_PX / 2,
        }))
      : [{ offset: from + laneWidth / 2, halfWidth: laneWidth / 2 }]
  })
}

export function bandWidthPx(mostPasses: readonly number[], laneWidth: number) {
  const threads = laneSlots(mostPasses, laneWidth).flat()
  const first = threads[0]
  const last = threads.at(-1)
  return first && last
    ? last.offset + last.halfWidth - first.offset + first.halfWidth
    : 0
}

interface LinePoint {
  x: number
  y: number
  route: number
  step: number
  index: number
}

const gapOf = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y)

function arcOf(run: readonly { x: number; y: number }[]) {
  const s = [0]
  for (let i = 1; i < run.length; i++) {
    s.push(s[i - 1]! + gapOf(run[i - 1]!, run[i]!))
  }
  return s
}

function smoothedNormals(run: LinePoint[], reach: number) {
  const s = arcOf(run)
  const end = s.at(-1)!
  const pointAt = (at: number, j: number) => {
    const a = run[j]!
    const b = run[Math.min(j + 1, run.length - 1)]!
    const span = s[Math.min(j + 1, run.length - 1)]! - s[j]!
    const f = span > 0 ? (at - s[j]!) / span : 0
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }
  let lo = 0
  let hi = 0
  return run.map((_, i): Normal | undefined => {
    const back = Math.max(0, s[i]! - reach / 2)
    const ahead = Math.min(end, s[i]! + reach / 2)
    while (lo < run.length - 1 && s[lo + 1]! <= back) {
      lo++
    }
    while (hi < run.length - 1 && s[hi + 1]! <= ahead) {
      hi++
    }
    const a = pointAt(back, lo)
    const b = pointAt(ahead, hi)
    const len = gapOf(a, b)
    return len > 0
      ? { nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len }
      : undefined
  })
}

// Each route's drawn points the way it runs, broken where it jumps further
// than `reach`
function laneRuns(
  routes: readonly (readonly string[])[],
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  reach: number,
) {
  const drawn = (p: NodeSegment) => ({ x: p.x, y: p.y * yToX })
  const runs: LinePoint[][] = []
  routes.forEach((route, r) => {
    let run: LinePoint[] = []
    route.forEach((id, step) => {
      const segments = nodePositions[id]
      if (!segments?.length) {
        runs.push(run)
        run = []
        return
      }
      const first = drawn(segments[0]!)
      const last = drawn(segments.at(-1)!)
      const prev = run.at(-1)
      const next = nodePositions[route[step + 1] ?? '']
      const toNext = (p: { x: number; y: number }) =>
        next?.length
          ? Math.min(gapOf(p, drawn(next[0]!)), gapOf(p, drawn(next.at(-1)!)))
          : 0
      const forward = prev
        ? gapOf(prev, first) <= gapOf(prev, last)
        : toNext(last) <= toNext(first)
      if (prev && gapOf(prev, forward ? first : last) > reach) {
        runs.push(run)
        run = []
      }
      const order = segments.map((_, i) =>
        forward ? i : segments.length - 1 - i,
      )
      for (const index of order) {
        run.push({ ...drawn(segments[index]!), route: r, step, index })
      }
    })
    runs.push(run)
  })
  return runs.filter(r => r.length > 0)
}

// The first run through a node sets all its points
function claimed<T>(
  runs: LinePoint[][],
  routes: readonly (readonly string[])[],
  nodePositions: Record<string, NodeSegment[]>,
  valueAt: (run: number, point: number) => T,
) {
  const field = new Map<string, (T | undefined)[]>()
  runs.forEach((points, r) => {
    const mine = new Set<number>()
    points.forEach((p, i) => {
      const id = routes[p.route]![p.step]!
      if (!mine.has(p.step) && field.has(id)) {
        return
      }
      mine.add(p.step)
      const own =
        field.get(id) ?? new Array<T | undefined>(nodePositions[id]!.length)
      own[p.index] = valueAt(r, i)
      field.set(id, own)
    })
  })
  return field
}

// A run that mostly crosses nodes an earlier run claimed the other way round
// turns its normals over, so a walk running against the first keeps the
// lanes in order
function alignNormals(
  runs: LinePoint[][],
  routes: readonly (readonly string[])[],
  nodePositions: Record<string, NodeSegment[]>,
  normals: (Normal | undefined)[][],
) {
  const field = new Map<string, (Normal | undefined)[]>()
  runs.forEach((points, r) => {
    const own = normals[r]!
    const agree = points.map((p, i) => {
      const id = routes[p.route]![p.step]!
      const theirs = field.get(id)?.[p.index]
      const mine = own[i]
      return theirs && mine ? theirs.nx * mine.nx + theirs.ny * mine.ny : 0
    })
    const sign = agree.reduce((a, b) => a + b, 0) < 0 ? -1 : 1
    const mine = new Set<number>()
    points.forEach((p, i) => {
      const n = own[i]
      if (n && sign < 0) {
        own[i] = { nx: -n.nx, ny: -n.ny }
      }
      const id = routes[p.route]![p.step]!
      if (!mine.has(p.step) && field.has(id)) {
        return
      }
      mine.add(p.step)
      const list =
        field.get(id) ??
        new Array<Normal | undefined>(nodePositions[id]!.length)
      list[p.index] = own[i]
      field.set(id, list)
    })
  })
}

// A curl the line runs round in under `length` before coming back within
// `close` of itself takes its chord
function cutCurls(run: LinePoint[], close: number, length: number) {
  const s = arcOf(run)
  const out = run.map(p => ({ ...p }))
  let i = 0
  while (i < run.length) {
    let to = -1
    for (let j = i + 1; j < run.length && s[j]! - s[i]! <= length; j++) {
      if (s[j]! - s[i]! > Math.PI * close && gapOf(run[i]!, run[j]!) <= close) {
        to = j
      }
    }
    if (to < 0) {
      i++
      continue
    }
    const a = run[i]!
    const b = run[to]!
    for (let k = i + 1; k < to; k++) {
      const f = (s[k]! - s[i]!) / (s[to]! - s[i]!)
      out[k] = {
        ...run[k]!,
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
      }
    }
    i = to
  }
  return out
}

// The line's points averaged over up to `half` either side, as far as the
// line runs both ways, so a cut curl's chord meets the line in a curve and
// the line's ends stay put
function rounded(run: LinePoint[], half: number) {
  const s = arcOf(run)
  const end = s.at(-1)!
  const sums = [{ w: 0, x: 0, y: 0 }]
  run.forEach((p, i) => {
    const w = (s[Math.min(i + 1, run.length - 1)]! - s[Math.max(i - 1, 0)]!) / 2
    const last = sums[i]!
    sums.push({ w: last.w + w, x: last.x + w * p.x, y: last.y + w * p.y })
  })
  const firstAtOrAfter = (at: number) => {
    let lo = 0
    let hi = s.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (s[mid]! < at) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return lo
  }
  return run.map((p, i) => {
    const reach = Math.min(half, s[i]!, end - s[i]!)
    const lo = firstAtOrAfter(s[i]! - reach)
    const hi = firstAtOrAfter(s[i]! + reach + 1e-9 * (1 + end))
    const w = sums[hi]!.w - sums[lo]!.w
    return w > 0
      ? {
          ...p,
          x: (sums[hi]!.x - sums[lo]!.x) / w,
          y: (sums[hi]!.y - sums[lo]!.y) / w,
        }
      : p
  })
}

export interface Shift {
  dx: number
  dy: number
}

// Each node's normals, point by point, left of the first walk through it as
// that walk runs, its line smoothed over `reach` x units. With a `band` of
// lanes that wide, the line also cuts across curls too tight to hold it and
// turns no sharper than its inner lanes can follow, and `shifts` says how far
// each point moves for that
export function laneLines(
  routes: readonly (readonly string[])[],
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  reach: number,
  band?: number,
) {
  const runs = laneRuns(routes, nodePositions, yToX, reach)
  const lines = runs.map(run =>
    band ? rounded(cutCurls(run, band / 2, 2 * Math.PI * band), band / 2) : run,
  )
  const turn = Math.max(reach, 2 * (band ?? 0))
  const normals = lines.map(line => smoothedNormals(line, turn))
  if (band) {
    alignNormals(runs, routes, nodePositions, normals)
  }
  return {
    normals: claimed(runs, routes, nodePositions, (r, i) => normals[r]![i]),
    shifts: claimed(runs, routes, nodePositions, (r, i): Shift => {
      const from = runs[r]![i]!
      const to = lines[r]![i]!
      return { dx: to.x - from.x, dy: (to.y - from.y) / yToX }
    }),
  }
}

export const laneNormals = (
  routes: readonly (readonly string[])[],
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  reach: number,
) => laneLines(routes, nodePositions, yToX, reach).normals

// Each value's max (or, `sign` -1, min) over the values within `half` of it
// along `s`, by a monotonic deque
function windowed(
  s: readonly number[],
  v: readonly number[],
  half: number,
  sign: 1 | -1,
) {
  const out = new Array<number>(v.length)
  const deque: number[] = []
  let head = 0
  let next = 0
  for (let i = 0; i < v.length; i++) {
    while (next < v.length && s[next]! - s[i]! <= half) {
      while (
        deque.length > head &&
        sign * v[deque.at(-1)!]! <= sign * v[next]!
      ) {
        deque.pop()
      }
      deque.push(next++)
    }
    while (s[i]! - s[deque[head]!]! > half) {
      head++
    }
    out[i] = v[deque[head]!]!
  }
  return out
}

// Each value's mean over the line within `half` of it along `s`
function windowMean(s: readonly number[], v: readonly number[], half: number) {
  const n = v.length
  const weight = s.map((_, i) =>
    n > 1 ? (s[Math.min(i + 1, n - 1)]! - s[Math.max(i - 1, 0)]!) / 2 : 1,
  )
  const sumW = [0]
  const sumWV = [0]
  for (let i = 0; i < n; i++) {
    sumW.push(sumW[i]! + weight[i]!)
    sumWV.push(sumWV[i]! + weight[i]! * v[i]!)
  }
  let lo = 0
  let hi = 0
  return v.map((value, i) => {
    while (s[i]! - s[lo]! > half) {
      lo++
    }
    while (hi < n && s[hi]! - s[i]! <= half) {
      hi++
    }
    const w = sumW[hi]! - sumW[lo]!
    return w > 0 ? (sumWV[hi]! - sumWV[lo]!) / w : value
  })
}

export interface WalkThreads {
  // the most passes the walk makes within reach of each node
  span: Map<string, number>
  // the threads its passes draw on through each node, and from one node to
  // the next keyed `from>to`, the threads at `from` and at `to`
  nodeThreads: Map<string, number[]>
  linkThreads: Map<string, [number, number][]>
}

// A pass draws on the thread of the copy it belongs to: at a node every
// nearby copy runs through, its count of visits so far, and round a bubble
// some copies skip, the copy of the nearest such node. So a copy's thread runs
// unbroken over whichever side of a bubble it takes
export function walkThreads(
  route: readonly (readonly string[])[],
  passes: ReadonlyMap<string, number>,
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  reach: number,
): WalkThreads {
  const span = new Map<string, number>()
  const visits = new Map<string, number>()
  const wanted = new Map<string, { visit: number; thread: number }[]>()
  const steps: { id: string; visit: number }[][] = []
  for (const piece of route) {
    const points: { x: number; y: number }[] = []
    for (const id of piece) {
      const segments = nodePositions[id]
      const mid = segments?.[Math.floor(segments.length / 2)]
      points.push(
        mid ? { x: mid.x, y: mid.y * yToX } : (points.at(-1) ?? { x: 0, y: 0 }),
      )
    }
    const s = arcOf(points)
    const p = piece.map(id => passes.get(id) ?? 1)
    const most = windowed(s, p, reach / 2, 1)
    const copy = piece.map(id => {
      const visit = (visits.get(id) ?? 0) + 1
      visits.set(id, visit)
      return visit
    })
    const full = p.map((v, i) => v === most[i])
    const before: number[] = []
    let last = -1
    for (let i = 0; i < piece.length; i++) {
      last = full[i] ? i : last
      before.push(last)
    }
    const after = new Array<number>(piece.length)
    last = -1
    for (let i = piece.length - 1; i >= 0; i--) {
      last = full[i] ? i : last
      after[i] = last
    }
    const own: { id: string; visit: number }[] = []
    piece.forEach((id, i) => {
      const b = before[i]!
      const a = after[i]!
      const nearest =
        b < 0 ? a : a < 0 ? b : s[i]! - s[b]! <= s[a]! - s[i]! ? b : a
      const thread = Math.min(copy[nearest]!, most[i]!) - 1
      span.set(id, Math.max(span.get(id) ?? 0, most[i]!))
      const list = wanted.get(id) ?? []
      list.push({ visit: copy[i]!, thread })
      wanted.set(id, list)
      own.push({ id, visit: copy[i]! })
    })
    steps.push(own)
  }
  const threadOf = new Map<string, number[]>()
  const nodeThreads = new Map<string, number[]>()
  for (const [id, list] of wanted) {
    const width = span.get(id)!
    const taken = new Set<number>()
    const free = (want: number) => {
      for (let d = 0; d < width; d++) {
        for (const c of [want - d, want + d]) {
          if (c >= 0 && c < width && !taken.has(c)) {
            return c
          }
        }
      }
      return want
    }
    const byVisit: number[] = []
    for (const { visit, thread } of list) {
      const t = free(thread)
      taken.add(t)
      byVisit[visit] = t
    }
    threadOf.set(id, byVisit)
    nodeThreads.set(
      id,
      [...taken].sort((a, b) => a - b),
    )
  }
  const linkThreads = new Map<string, [number, number][]>()
  const link = (from: string, to: string, pair: [number, number]) => {
    const key = `${from}>${to}`
    const list = linkThreads.get(key) ?? []
    if (!list.some(([a, b]) => a === pair[0] && b === pair[1])) {
      list.push(pair)
    }
    linkThreads.set(key, list)
  }
  for (const own of steps) {
    own.forEach((cur, i) => {
      const prev = own[i - 1]
      if (prev) {
        const a = threadOf.get(prev.id)![prev.visit]!
        const b = threadOf.get(cur.id)![cur.visit]!
        link(prev.id, cur.id, [a, b])
      }
    })
  }
  return { span, nodeThreads, linkThreads }
}

// How many threads each walk's slot holds at each node: the most any node
// within `reach` along the line through it asks, 0 for a walk on none of
// them, eased over `taper`. A walk away round a bubble keeps its slot, and a
// walk gone for longer gives it up
export function bandSpans(
  routes: readonly (readonly string[])[],
  spans: readonly ReadonlyMap<string, number>[],
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  { jump, reach, taper }: { jump: number; reach: number; taper: number },
) {
  const runs = laneRuns(routes, nodePositions, yToX, jump)
  const eased = runs.map(run => {
    const s = arcOf(run)
    const perWalk = spans.map(own => {
      const raw = run.map(p => own.get(routes[p.route]![p.step]!) ?? 0)
      return windowMean(s, windowed(s, raw, reach / 2, 1), taper / 2)
    })
    return run.map((_, i) => perWalk.map(v => v[i]!))
  })
  const field = claimed(runs, routes, nodePositions, (r, i) => eased[r]![i]!)
  const out = new Map<string, number[]>()
  for (const [id, points] of field) {
    const known = points.filter((p): p is number[] => !!p)
    const mid = known[Math.floor(known.length / 2)]
    if (mid) {
      out.set(id, mid)
    }
  }
  return out
}

// Where each walk's threads sit in a band of `spans` threads per walk,
// fractional where a slot eases wider. A walk that passes each node once
// keeps a lane of `laneWidth`
export function spanSlots(
  spans: readonly number[],
  mostPasses: readonly number[],
  laneWidth: number,
) {
  const widths = spans.map((m, i) =>
    mostPasses[i]! > 1
      ? m * THREAD_PX + Math.max(0, m - 1) * THREAD_GAP_PX
      : laneWidth * Math.min(1, m),
  )
  let seen = 0
  const gaps = spans.map(m => {
    const q = Math.min(1, m)
    const gap = SLOT_GAP_PX * q * seen
    seen = Math.max(seen, q)
    return gap
  })
  const band =
    widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0)
  let at = -band / 2
  return widths.map((width, i) => {
    at += gaps[i]!
    const from = at
    at += width
    return (thread: number): LaneThread =>
      mostPasses[i]! > 1
        ? {
            offset: from + thread * (THREAD_PX + THREAD_GAP_PX) + THREAD_PX / 2,
            halfWidth: THREAD_PX / 2,
          }
        : { offset: from + laneWidth / 2, halfWidth: laneWidth / 2 }
  })
}
