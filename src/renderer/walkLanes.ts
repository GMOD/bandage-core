import { slideAt } from '../util/geometry'

import type { LaneSlide } from './types'
import type { NodeSegment } from '../types'
import type { LiftedWalk } from '../walkHighlight'

export const THREAD_PX = 2
export const THREAD_GAP_PX = 1.5
export const SLOT_GAP_PX = 4
export const LANE_SMOOTHING_PX = 12
export const THREAD_REACH_PX = 64
export const THREAD_TAPER_PX = 24
export const MAX_BAND_PX = 48
export const PASSES_KEY = 'a thread per pass through a node'

export const threadsPasses = (walks: readonly { mostPasses: number }[]) =>
  walks.length > 1 && walks.some(w => w.mostPasses > 1)

export interface Normal {
  nx: number
  ny: number
}

export interface Shift {
  dx: number
  dy: number
}

const threadsWidth = (threads: number) =>
  threads * THREAD_PX + Math.max(0, threads - 1) * THREAD_GAP_PX

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0)

function slotLayout(
  spans: readonly number[],
  mostPasses: readonly number[],
  laneWidth: number,
) {
  const widths = spans.map((m, i) =>
    mostPasses[i]! > 1 ? threadsWidth(m) : laneWidth * Math.min(1, m),
  )
  let seen = 0
  const gaps = spans.map(m => {
    const share = Math.min(1, m)
    const gap = SLOT_GAP_PX * share * seen
    seen = Math.max(seen, share)
    return gap
  })
  return { widths, gaps, band: sum(widths) + sum(gaps) }
}

export const THREAD_PITCH_PX = THREAD_PX + THREAD_GAP_PX

// Where each walk's first thread runs, in px from the band's middle; a walk's
// later threads step THREAD_PITCH_PX on from there
export function slotCentres(
  spans: readonly number[],
  mostPasses: readonly number[],
  held: readonly number[] = spans,
) {
  const { widths, gaps, band } = slotLayout(spans, mostPasses, THREAD_PX)
  let at = -band / 2
  return widths.map((width, i) => {
    at += gaps[i]!
    const slack =
      mostPasses[i]! > 1 ? Math.max(0, width - threadsWidth(held[i]!)) : 0
    const centre = at + slack / 2 + THREAD_PX / 2
    at += width
    return centre
  })
}

export const bandWidthPx = (mostPasses: readonly number[]) =>
  slotLayout(mostPasses, mostPasses, THREAD_PX).band

export const bandScale = (mostPasses: readonly number[]) =>
  Math.min(1, MAX_BAND_PX / (bandWidthPx(mostPasses) || 1))

export const passesKey = (walks: readonly { mostPasses: number }[]) =>
  bandScale(walks.map(w => w.mostPasses)) < 1
    ? `${PASSES_KEY}, thinned to fit`
    : PASSES_KEY

export function laneSlideAt(
  start: LaneSlide,
  end: LaneSlide,
  along: number,
): LaneSlide {
  const vector = ({ normal, offsetX }: LaneSlide) => ({
    dx: normal.nx * offsetX,
    dy: normal.ny * offsetX,
  })
  const { dx, dy } = slideAt(vector(start), vector(end), along)
  const offsetX = Math.hypot(dx, dy)
  return offsetX > 0
    ? { normal: { nx: dx / offsetX, ny: dy / offsetX }, offsetX }
    : { normal: { nx: 0, ny: 0 }, offsetX: 0 }
}

interface LinePoint {
  x: number
  y: number
  id: string
  index: number
  middle: boolean
  forward: boolean
}

export interface LaneRuns {
  runs: LinePoint[][]
  owned: boolean[][]
}

const gapOf = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y)

function arcOf(run: readonly { x: number; y: number }[]) {
  const s = new Float64Array(run.length)
  for (let i = 1; i < run.length; i++) {
    s[i] = s[i - 1]! + gapOf(run[i - 1]!, run[i]!)
  }
  return s
}

export function laneRuns(
  routes: readonly (readonly string[])[],
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  jump: number,
): LaneRuns {
  const seen = new Set<string>()
  const owns = routes.map(route =>
    route.map(id => {
      if (seen.has(id)) {
        return false
      }
      seen.add(id)
      return !!nodePositions[id]?.length
    }),
  )
  const gap = (a: { x: number; y: number }, b: NodeSegment) =>
    Math.hypot(b.x - a.x, b.y * yToX - a.y)
  const runs: LinePoint[][] = []
  const owned: boolean[][] = []
  let run: LinePoint[] = []
  let mine: boolean[] = []
  const breakRun = () => {
    if (run.length) {
      runs.push(run)
      owned.push(mine)
    }
    run = []
    mine = []
  }
  routes.forEach((route, r) => {
    if (!owns[r]!.includes(true)) {
      return
    }
    route.forEach((id, step) => {
      const segments = nodePositions[id]
      if (!segments?.length) {
        breakRun()
        return
      }
      const first = segments[0]!
      const last = segments.at(-1)!
      const prev = run.at(-1)
      const next = nodePositions[route[step + 1] ?? '']
      const toNext = (p: NodeSegment) => {
        const at = { x: p.x, y: p.y * yToX }
        return next?.length
          ? Math.min(gap(at, next[0]!), gap(at, next.at(-1)!))
          : 0
      }
      const forward = prev
        ? gap(prev, first) <= gap(prev, last)
        : toNext(last) <= toNext(first)
      if (prev && gap(prev, forward ? first : last) > jump) {
        breakRun()
      }
      const middle = Math.floor(segments.length / 2)
      for (let k = 0; k < segments.length; k++) {
        const index = forward ? k : segments.length - 1 - k
        const p = segments[index]!
        run.push({
          x: p.x,
          y: p.y * yToX,
          id,
          index,
          middle: index === middle,
          forward,
        })
        mine.push(owns[r]![step]!)
      }
    })
    breakRun()
  })
  return { runs, owned }
}

function ownedWindows(
  s: ArrayLike<number>,
  owned: readonly boolean[],
  margin: number,
) {
  const windows: [number, number][] = []
  for (let i = 0; i < owned.length; i++) {
    if (!owned[i]) {
      continue
    }
    let j = i
    while (j + 1 < owned.length && owned[j + 1]) {
      j++
    }
    const last = windows.at(-1)
    const floor = last ? last[1] : 0
    let lo = i
    while (lo > floor && s[i]! - s[lo - 1]! <= margin) {
      lo--
    }
    let hi = j
    while (hi + 1 < s.length && s[hi + 1]! - s[j]! <= margin) {
      hi++
    }
    if (last && lo <= last[1] + 1) {
      last[1] = hi
    } else {
      windows.push([lo, hi])
    }
    i = j
  }
  return windows
}

function smoothedNormals(
  run: readonly { x: number; y: number }[],
  reach: number,
) {
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

function cutCurls<P extends { x: number; y: number }>(
  run: readonly P[],
  close: number,
  length: number,
) {
  const s = arcOf(run)
  const out = run.slice()
  const picks: number[] = []
  s.forEach((at, k) => {
    const last = picks.at(-1)
    if (last === undefined || at - s[last]! >= close / 4) {
      picks.push(k)
    }
  })
  if (picks.at(-1) !== run.length - 1) {
    picks.push(run.length - 1)
  }
  let a = 0
  while (a < picks.length) {
    const i = picks[a]!
    let to = -1
    for (
      let b = a + 1;
      b < picks.length && s[picks[b]!]! - s[i]! <= length;
      b++
    ) {
      const j = picks[b]!
      if (s[j]! - s[i]! > Math.PI * close && gapOf(run[i]!, run[j]!) <= close) {
        to = b
      }
    }
    if (to < 0) {
      a++
      continue
    }
    const j = picks[to]!
    const p = run[i]!
    const q = run[j]!
    for (let k = i + 1; k < j; k++) {
      const f = (s[k]! - s[i]!) / (s[j]! - s[i]!)
      out[k] = {
        ...run[k]!,
        x: p.x + (q.x - p.x) * f,
        y: p.y + (q.y - p.y) * f,
      }
    }
    a = to
  }
  return out
}

function rounded(run: readonly { x: number; y: number }[], half: number) {
  const n = run.length
  const s = arcOf(run)
  const end = s[n - 1]!
  const sumW = new Float64Array(n + 1)
  const sumX = new Float64Array(n + 1)
  const sumY = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const p = run[i]!
    const w = (s[Math.min(i + 1, n - 1)]! - s[Math.max(i - 1, 0)]!) / 2
    sumW[i + 1] = sumW[i]! + w
    sumX[i + 1] = sumX[i]! + w * p.x
    sumY[i + 1] = sumY[i]! + w * p.y
  }
  const out = new Array<{ x: number; y: number }>(n)
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    const p = run[i]!
    const reach = Math.min(half, s[i]!, end - s[i]!)
    const from = s[i]! - reach
    const to = s[i]! + reach + 1e-9 * (1 + end)
    while (lo < n && s[lo]! < from) {
      lo++
    }
    while (hi < n && s[hi]! < to) {
      hi++
    }
    const w = sumW[hi]! - sumW[lo]!
    out[i] =
      w > 0
        ? { x: (sumX[hi]! - sumX[lo]!) / w, y: (sumY[hi]! - sumY[lo]!) / w }
        : { x: p.x, y: p.y }
  }
  return out
}

function fieldSetter<T>(
  field: Map<string, (T | undefined)[]>,
  nodePositions: Record<string, NodeSegment[]>,
) {
  return ({ id, index }: LinePoint, value: T) => {
    let own = field.get(id)
    if (!own) {
      own = new Array<T | undefined>(nodePositions[id]!.length)
      field.set(id, own)
    }
    own[index] = value
  }
}

export function laneLines(
  lanes: LaneRuns,
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  reach: number,
  band: number,
  smooth = true,
) {
  const turn = Math.max(reach, 2 * band)
  const curl = Math.PI * band
  const margin = smooth ? curl + band / 2 + turn / 2 : turn / 2
  const normals = new Map<string, (Normal | undefined)[]>()
  const shifts = new Map<string, (Shift | undefined)[]>()
  const setNormal = fieldSetter(normals, nodePositions)
  const setShift = fieldSetter(shifts, nodePositions)
  lanes.runs.forEach((run, r) => {
    const owned = lanes.owned[r]!
    const pieces = ownedWindows(arcOf(run), owned, margin).map(([lo, hi]) => {
      const points = run.slice(lo, hi + 1)
      const line: readonly { x: number; y: number }[] = smooth
        ? rounded(cutCurls(points, band / 2, curl), band / 2)
        : points
      return { lo, points, line, normals: smoothedNormals(line, turn) }
    })
    let agree = 0
    let along = 0
    for (const piece of pieces) {
      piece.points.forEach((p, i) => {
        const theirs = normals.get(p.id)?.[p.index]
        const mine = piece.normals[i]
        if (theirs && mine) {
          agree += theirs.nx * mine.nx + theirs.ny * mine.ny
        }
        along += p.forward ? 1 : -1
      })
    }
    const sign = (agree === 0 ? along : agree) < 0 ? -1 : 1
    for (const { lo, points, line, normals: own } of pieces) {
      points.forEach((p, i) => {
        if (!owned[lo + i]) {
          return
        }
        const n = own[i]
        if (n) {
          setNormal(p, sign > 0 ? n : { nx: -n.nx, ny: -n.ny })
        }
        if (smooth) {
          setShift(p, {
            dx: line[i]!.x - p.x,
            dy: (line[i]!.y - p.y) / yToX,
          })
        }
      })
    }
  })
  return { normals, shifts }
}

function windowed(
  s: ArrayLike<number>,
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

function windowMean(
  s: readonly number[],
  v: readonly number[],
  half: number,
  counted: (value: number) => boolean = () => true,
) {
  const n = v.length
  const weight = s.map((_, i) =>
    !counted(v[i]!)
      ? 0
      : n > 1
        ? (s[Math.min(i + 1, n - 1)]! - s[Math.max(i - 1, 0)]!) / 2
        : 1,
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
  span: ReadonlyMap<string, number>
  nodeThreads: Map<string, readonly number[]>
  // which of the walk's visits to a node each of its threads carries
  threadPasses: Map<string, readonly number[]>
  linkThreads: Map<string, Map<string, [number, number][]>>
}

const ONE_THREAD: readonly number[] = [0]

function repeats(passes: ReadonlyMap<string, number>) {
  for (const p of passes.values()) {
    if (p > 1) {
      return true
    }
  }
  return false
}

export function walkThreads(
  route: readonly (readonly string[])[],
  passes: ReadonlyMap<string, number>,
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  reach: number,
): WalkThreads {
  if (!repeats(passes)) {
    return {
      span: passes,
      nodeThreads: new Map(),
      threadPasses: new Map(),
      linkThreads: new Map(),
    }
  }
  const index = new Map<string, number>()
  const ids: string[] = []
  const widths: number[] = []
  const visits: number[] = []
  const steps: number[][] = []
  const stepVisits: number[][] = []
  const stepWants: number[][] = []
  for (const piece of route) {
    const points: { x: number; y: number }[] = []
    const nodes: number[] = []
    for (const id of piece) {
      let k = index.get(id)
      if (k === undefined) {
        k = ids.length
        index.set(id, k)
        ids.push(id)
        widths.push(0)
        visits.push(0)
      }
      nodes.push(k)
      const segments = nodePositions[id]
      const mid = segments?.[Math.floor(segments.length / 2)]
      points.push(
        mid ? { x: mid.x, y: mid.y * yToX } : (points.at(-1) ?? { x: 0, y: 0 }),
      )
    }
    const s = arcOf(points)
    const p = piece.map(id => passes.get(id) ?? 1)
    const most = windowed(s, p, reach / 2, 1)
    const copy = nodes.map(k => ++visits[k]!)
    const n = piece.length
    const before = new Int32Array(n)
    let last = -1
    for (let i = 0; i < n; i++) {
      last = p[i] === most[i] ? i : last
      before[i] = last
    }
    const after = new Int32Array(n)
    last = -1
    for (let i = n - 1; i >= 0; i--) {
      last = p[i] === most[i] ? i : last
      after[i] = last
    }
    const wants = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      const b = before[i]!
      const a = after[i]!
      const nearest =
        b < 0 ? a : a < 0 ? b : s[i]! - s[b]! <= s[a]! - s[i]! ? b : a
      wants[i] = Math.min(copy[nearest]!, most[i]!) - 1
      widths[nodes[i]!] = Math.max(widths[nodes[i]!]!, most[i]!)
    }
    steps.push(nodes)
    stepVisits.push(copy)
    stepWants.push(wants)
  }
  const taken: (Set<number> | undefined)[] = []
  const threadOf: (number[] | undefined)[] = []
  const free = (k: number, want: number) => {
    const width = widths[k]!
    const own = (taken[k] ??= new Set())
    for (let d = 0; d < width; d++) {
      for (const c of [want - d, want + d]) {
        if (c >= 0 && c < width && !own.has(c)) {
          return c
        }
      }
    }
    return want
  }
  steps.forEach((nodes, piece) => {
    nodes.forEach((k, i) => {
      if (widths[k]! > 1) {
        const t = free(k, stepWants[piece]![i]!)
        taken[k]!.add(t)
        ;(threadOf[k] ??= [])[stepVisits[piece]![i]!] = t
      }
    })
  })
  const span = new Map<string, number>()
  const nodeThreads = new Map<string, readonly number[]>()
  const threadPasses = new Map<string, readonly number[]>()
  ids.forEach((id, k) => {
    span.set(id, widths[k]!)
    nodeThreads.set(
      id,
      taken[k] ? [...taken[k]].sort((a, b) => a - b) : ONE_THREAD,
    )
    const passOf: number[] = []
    threadOf[k]?.forEach((thread, visit) => {
      passOf[thread] = visit - 1
    })
    threadPasses.set(id, passOf)
  })
  const linkThreads = new Map<string, Map<string, [number, number][]>>()
  steps.forEach((nodes, piece) => {
    const visit = stepVisits[piece]!
    for (let i = 1; i < nodes.length; i++) {
      const from = nodes[i - 1]!
      const to = nodes[i]!
      const pair: [number, number] = [
        threadOf[from]?.[visit[i - 1]!] ?? 0,
        threadOf[to]?.[visit[i]!] ?? 0,
      ]
      let ahead = linkThreads.get(ids[from]!)
      if (!ahead) {
        ahead = new Map()
        linkThreads.set(ids[from]!, ahead)
      }
      const list = ahead.get(ids[to]!)
      if (!list) {
        ahead.set(ids[to]!, [pair])
      } else if (!list.some(([a, b]) => a === pair[0] && b === pair[1])) {
        list.push(pair)
      }
    }
  })
  return { span, nodeThreads, threadPasses, linkThreads }
}

export function bandSpans(
  lanes: LaneRuns,
  spans: readonly ReadonlyMap<string, number>[],
  { reach, taper }: { reach: number; taper: number },
) {
  const out = new Map<string, { slot: number[]; held: number[] }>()
  lanes.runs.forEach((run, r) => {
    const s = arcOf(run)
    const mids = run.flatMap((p, i) => (p.middle ? [i] : []))
    const along = mids.map(i => s[i]!)
    const owned = mids.map(i => lanes.owned[r]![i]!)
    for (const [lo, hi] of ownedWindows(along, owned, reach / 2 + taper / 2)) {
      const at = along.slice(lo, hi + 1)
      const ids = mids.slice(lo, hi + 1).map(i => run[i]!.id)
      const eased = spans.map(own => {
        const raw = ids.map(id => own.get(id) ?? 0)
        return raw.every(v => v === raw[0])
          ? { slot: raw, held: raw }
          : {
              slot: windowMean(at, windowed(at, raw, reach / 2, 1), taper / 2),
              held: windowMean(at, raw, taper / 2, v => v > 0),
            }
      })
      ids.forEach((id, i) => {
        if (owned[lo + i]) {
          out.set(id, {
            slot: eased.map(e => e.slot[i]!),
            held: eased.map(e => e.held[i]!),
          })
        }
      })
    }
  })
  return out
}

export function liftLanes(
  walks: readonly LiftedWalk[],
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  worldPerScreenPx: number,
) {
  const threaded = threadsPasses(walks)
  const passes = walks.map(w => w.mostPasses)
  const reach = THREAD_REACH_PX * worldPerScreenPx
  const runs = laneRuns(
    walks.flatMap(w => w.route),
    nodePositions,
    yToX,
    LANE_SMOOTHING_PX * worldPerScreenPx,
  )
  const lines = laneLines(
    runs,
    nodePositions,
    yToX,
    LANE_SMOOTHING_PX * worldPerScreenPx,
    bandWidthPx(passes) * (threaded ? bandScale(passes) : 1) * worldPerScreenPx,
    threaded,
  )
  const threads = threaded
    ? walks.map(w => walkThreads(w.route, w.passes, nodePositions, yToX, reach))
    : undefined
  const spans = threads
    ? bandSpans(
        runs,
        threads.map(t => t.span),
        { reach, taper: THREAD_TAPER_PX * worldPerScreenPx },
      )
    : undefined
  const furthestShift = { dx: 0, dy: 0 }
  for (const own of lines.shifts.values()) {
    for (const shift of own) {
      furthestShift.dx = Math.max(furthestShift.dx, Math.abs(shift?.dx ?? 0))
      furthestShift.dy = Math.max(furthestShift.dy, Math.abs(shift?.dy ?? 0))
    }
  }
  return { lines, threads, spans, furthestShift }
}
