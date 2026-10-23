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

// A walk's route between the jumps that break it: one entry per step, a visit
// to a node, and the step's points in the order the walk reads them
export interface LaneRun {
  walk: number
  ids: string[]
  // the walk's own visits to the node before this one
  visits: number[]
  forward: boolean[]
  // the first visit any walk makes to the node
  owned: boolean[]
  // where each step's points start, and one more where the last ends
  starts: number[]
  xs: Float64Array
  ys: Float64Array
  stepOf: Int32Array
}

// The node point a run's point `p` is: its index along the node's segments
function pointIndex(run: LaneRun, p: number) {
  const i = run.stepOf[p]!
  const k = p - run.starts[i]!
  return run.forward[i] ? k : run.starts[i + 1]! - run.starts[i]! - 1 - k
}

const gapOf = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function arcOf(run: readonly { x: number; y: number }[]) {
  const s = new Float64Array(run.length)
  for (let i = 1; i < run.length; i++) {
    s[i] = s[i - 1]! + gapOf(run[i - 1]!, run[i]!)
  }
  return s
}

// One step of a walk: its visit to a node, the walk's earlier visits to the
// node, and whether it is the first visit any walk makes to the node. None of
// it changes with zoom, so a host can keep it across rebuilds.
export interface WalkStep {
  id: string
  visit: number
  owned: boolean
  segments: NodeSegment[] | undefined
}

// Each walk's steps, piece by piece
export function walkSteps(
  walkRoutes: readonly (readonly (readonly string[])[])[],
  nodePositions: Record<string, NodeSegment[]>,
) {
  const seen = new Set<string>()
  return walkRoutes.map(routes => {
    const visits = new Map<string, number>()
    return routes.map(route =>
      route.map((id): WalkStep => {
        const visit = visits.get(id) ?? 0
        visits.set(id, visit + 1)
        const segments = nodePositions[id]
        const owned = !!segments?.length && !seen.has(id)
        if (owned) {
          seen.add(id)
        }
        return { id, visit, owned, segments }
      }),
    )
  })
}

// Each walk's steps as runs, broken where the walk jumps further than `jump`
export function laneRuns(
  steps: readonly (readonly (readonly WalkStep[])[])[],
  yToX: number,
  jump: number,
) {
  const runs: LaneRun[] = []
  steps.forEach((pieces, walk) => {
    let total = 0
    for (const piece of pieces) {
      for (const { segments } of piece) {
        total += segments?.length ?? 0
      }
    }
    const xs = new Float64Array(total)
    const ys = new Float64Array(total)
    let at = 0
    let from = 0
    let run: Omit<LaneRun, 'xs' | 'ys' | 'stepOf'> = fresh()
    function fresh() {
      return {
        walk,
        ids: [] as string[],
        visits: [] as number[],
        forward: [] as boolean[],
        owned: [] as boolean[],
        starts: [0],
      }
    }
    const breakRun = () => {
      if (run.ids.length) {
        const stepOf = new Int32Array(at - from)
        for (let i = 0; i < run.ids.length; i++) {
          stepOf.fill(i, run.starts[i], run.starts[i + 1])
        }
        runs.push({
          ...run,
          xs: xs.subarray(from, at),
          ys: ys.subarray(from, at),
          stepOf,
        })
      }
      run = fresh()
      from = at
    }
    const gap = (x: number, y: number, p: NodeSegment) => {
      const dx = p.x - x
      const dy = p.y * yToX - y
      return Math.sqrt(dx * dx + dy * dy)
    }
    for (const piece of pieces) {
      piece.forEach(({ id, visit, owned, segments }, k) => {
        if (!segments?.length) {
          breakRun()
          return
        }
        const first = segments[0]!
        const last = segments.at(-1)!
        let forward: boolean
        if (at > from) {
          const x = xs[at - 1]!
          const y = ys[at - 1]!
          const toFirst = gap(x, y, first)
          const toLast = gap(x, y, last)
          forward = toFirst <= toLast
          if (Math.min(toFirst, toLast) > jump) {
            breakRun()
          }
        } else {
          const next = piece[k + 1]?.segments
          const toNext = (p: NodeSegment) =>
            next?.length
              ? Math.min(
                  gap(p.x, p.y * yToX, next[0]!),
                  gap(p.x, p.y * yToX, next.at(-1)!),
                )
              : 0
          forward = toNext(last) <= toNext(first)
        }
        run.ids.push(id)
        run.visits.push(visit)
        run.forward.push(forward)
        run.owned.push(owned)
        for (let j = 0; j < segments.length; j++) {
          const p = segments[forward ? j : segments.length - 1 - j]!
          xs[at] = p.x
          ys[at] = p.y * yToX
          at++
        }
        run.starts.push(at - from)
      })
      breakRun()
    }
  })
  return runs
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

// Which points of a line turn tighter than `radius`, by the circle through
// each point and the points `radius` either side of it along the line
function tightPoints(
  line: readonly { x: number; y: number }[],
  radius: number,
) {
  const n = line.length
  const s = arcOf(line)
  const end = s[n - 1]!
  const tight = new Uint8Array(n)
  const along = (j: number, at: number) => {
    const a = line[j]!
    const b = line[j + 1]
    if (!b) {
      return a
    }
    const span = s[j + 1]! - s[j]!
    const f = span > 0 ? (at - s[j]!) / span : 0
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    if (s[i]! < radius || end - s[i]! < radius) {
      continue
    }
    while (lo + 1 < n && s[lo + 1]! <= s[i]! - radius) {
      lo++
    }
    while (hi + 1 < n && s[hi + 1]! <= s[i]! + radius) {
      hi++
    }
    const p = line[i]!
    const a = along(lo, s[i]! - radius)
    const b = along(hi, s[i]! + radius)
    const twice = Math.abs(
      (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x),
    )
    tight[i] =
      twice > 0 &&
      (gapOf(a, b) * gapOf(a, p) * gapOf(p, b)) / (2 * twice) < radius
        ? 1
        : 0
  }
  return { tight, s }
}

// The line smoothed again wherever it turns tighter than `radius`, the
// furthest a thread runs from it, so the band's inner thread rounds a hairpin
// rather than folding back on itself at the tip. Only the stretches round
// tight points change, so later passes smooth those alone.
function loosened(line: readonly { x: number; y: number }[], radius: number) {
  const out = line.slice()
  const { tight, s } = tightPoints(out, radius)
  let windows = ownedWindows(
    s,
    Array.from(tight, t => t > 0),
    3 * radius,
  )
  for (let pass = 0; pass < 8 && windows.length; pass++) {
    windows = windows.filter(([lo, hi]) => {
      const part = out.slice(lo, hi + 1)
      const local = tightPoints(part, radius)
      if (!local.tight.includes(1)) {
        return false
      }
      const weight = windowMean(local.s, local.tight, radius)
      const smoother = rounded(part, radius)
      for (let k = 0; k < part.length; k++) {
        const w = Math.min(1, 3 * weight[k]!)
        if (w > 0) {
          const p = part[k]!
          const q = smoother[k]!
          out[lo + k] = { x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w }
        }
      }
      return true
    })
  }
  return out
}

export interface VisitFrame {
  normals: (Normal | undefined)[]
  shifts: (Shift | undefined)[]
  // px from the band's middle that the visit's thread runs: `offset` along
  // the whole node, or `offsets` at each point where it changes along it
  offset?: number
  offsets?: number[]
}

// Which way each point's normal faces, so a walk's lanes keep the side the
// node's first visit set. A point takes the sign its neighbours within `half`
// agree on with the normals already set, in arc order; a stretch none of them
// has seen takes the sign before it, and a run that meets no set normal at
// all keeps the side its nodes read forward on.
function runSigns(
  s: ArrayLike<number>,
  own: readonly (Normal | undefined)[],
  canonical: (k: number) => Normal | undefined,
  forward: (k: number) => boolean,
  settle: (k: number, sign: 1 | -1) => void,
  half: number,
) {
  const n = own.length
  const agreement = new Float64Array(n)
  let hi = 0
  let lo = 0
  let sum = 0
  let decided: 0 | 1 | -1 = 0
  let pending = 0
  for (let i = 0; i < n; i++) {
    while (hi < n && s[hi]! - s[i]! <= half) {
      const theirs = canonical(hi)
      const mine = own[hi]
      agreement[hi] =
        theirs && mine ? theirs.nx * mine.nx + theirs.ny * mine.ny : 0
      sum += agreement[hi]!
      hi++
    }
    while (s[i]! - s[lo]! > half) {
      sum -= agreement[lo++]!
    }
    if (Math.abs(sum) > 1e-9) {
      decided = sum < 0 ? -1 : 1
    }
    if (!decided) {
      continue
    }
    for (; pending <= i; pending++) {
      settle(pending, decided)
    }
  }
  if (pending < n) {
    let along = 0
    for (let k = 0; k < n; k++) {
      along += forward(k) ? 1 : -1
    }
    for (; pending < n; pending++) {
      settle(pending, along < 0 ? -1 : 1)
    }
  }
}

// Each walk's visit to a node gets the walk's own frame there: the normal of
// its smoothed route and, when `smooth`, the shift onto that route, so a lane
// follows its own walk through a junction rather than whichever walk reached
// the node first. A visit whose route runs the first visit's way for `context`
// either side would smooth to the same frame, so it shares that one, and only
// the stretches where routes part are smoothed again. `frames` holds each
// node's frames by walk, then by the walk's visit.
export function laneLines(
  runs: readonly LaneRun[],
  yToX: number,
  reach: number,
  band: number,
  smooth = true,
) {
  const turn = Math.max(reach, 2 * band)
  const curl = Math.PI * band
  const context = smooth ? curl + 3 * band + turn / 2 : turn / 2
  const frames = new Map<string, VisitFrame[][]>()
  const firsts = new Map<
    string,
    { run: number; step: number; frame: VisitFrame }
  >()
  const arcs: Float64Array[] = []
  const stepFrames: VisitFrame[][] = []
  const newFrame = (length: number): VisitFrame => ({
    normals: new Array<Normal | undefined>(length),
    shifts: smooth ? new Array<Shift | undefined>(length) : [],
  })
  const place = (id: string, walk: number, visit: number, f: VisitFrame) => {
    let byWalk = frames.get(id)
    if (!byWalk) {
      byWalk = []
      frames.set(id, byWalk)
    }
    ;(byWalk[walk] ??= [])[visit] = f
  }
  runs.forEach((run, r) => {
    const { walk, ids, visits, owned, starts, xs, ys, stepOf } = run
    const steps = ids.length
    const n = xs.length
    const own = new Array<VisitFrame>(steps)
    for (let i = 0; i < steps; i++) {
      if (owned[i]) {
        own[i] = newFrame(starts[i + 1]! - starts[i]!)
        firsts.set(ids[i]!, { run: r, step: i, frame: own[i]! })
        place(ids[i]!, walk, visits[i]!, own[i]!)
      }
    }
    const raw = new Float64Array(n)
    for (let p = 1; p < n; p++) {
      const dx = xs[p]! - xs[p - 1]!
      const dy = ys[p]! - ys[p - 1]!
      raw[p] = raw[p - 1]! + Math.sqrt(dx * dx + dy * dy)
    }
    const end = raw[n - 1]!
    const firstRun = new Int32Array(steps).fill(-1)
    const firstStep = new Int32Array(steps)
    const firstFrame = new Array<VisitFrame | undefined>(steps)
    for (let i = 0; i < steps; i++) {
      const first = owned[i] ? undefined : firsts.get(ids[i]!)
      if (first) {
        firstRun[i] = first.run
        firstStep[i] = first.step
        firstFrame[i] = first.frame
      }
    }
    const plus = new Int32Array(steps)
    const minus = new Int32Array(steps)
    for (let i = 0; i + 1 < steps; i++) {
      const same = firstRun[i]! >= 0 && firstRun[i + 1] === firstRun[i]
      const d = same ? firstStep[i + 1]! - firstStep[i]! : 0
      plus[i + 1] = plus[i]! + (d === 1 ? 1 : 0)
      minus[i + 1] = minus[i]! + (d === -1 ? 1 : 0)
    }
    // a step shares when every step whose points or links fall within
    // `context` of its own points runs the first visit's way; without threads,
    // flat lanes tile a node, so every visit shares the first visit's frame
    const shared = new Array<boolean>(steps)
    let reachFrom = 0
    let reachTo = 0
    for (let i = 0; i < steps; i++) {
      if (!smooth) {
        shared[i] = !owned[i]
        continue
      }
      const from = raw[starts[i]!]! - context
      const to = raw[starts[i + 1]! - 1]! + context
      while (raw[reachFrom]! < from) {
        reachFrom++
      }
      while (reachTo + 1 < n && raw[reachTo + 1]! <= to) {
        reachTo++
      }
      const lo = stepOf[Math.max(0, reachFrom - 1)]!
      const hi = stepOf[Math.min(n - 1, reachTo + 1)]!
      const span = hi - lo
      const forward = plus[hi]! - plus[lo]!
      const backward = minus[hi]! - minus[lo]!
      shared[i] =
        !owned[i] &&
        from >= 0 &&
        to <= end &&
        span > 0 &&
        (forward === span || backward === span)
    }
    for (let i = 0; i < steps; i++) {
      if (owned[i]) {
        continue
      }
      const first = firstFrame[i]!
      // without threads a frame carries no offsets of its own to keep apart
      own[i] =
        !smooth && shared[i]
          ? first
          : shared[i]
            ? { normals: first.normals, shifts: first.shifts }
            : newFrame(first.normals.length)
      place(ids[i]!, walk, visits[i]!, own[i]!)
    }
    stepFrames.push(own)
    const apart = new Array<boolean>(n)
    for (let p = 0; p < n; p++) {
      apart[p] = !shared[stepOf[p]!]
    }
    for (const [from, to] of ownedWindows(raw, apart, context)) {
      const points: { x: number; y: number }[] = []
      for (let p = from; p <= to; p++) {
        points.push({ x: xs[p]!, y: ys[p]! })
      }
      const line: readonly { x: number; y: number }[] = smooth
        ? loosened(
            rounded(cutCurls(points, band / 2, curl), band / 2),
            band / 2,
          )
        : points
      const normals = smoothedNormals(line, turn)
      runSigns(
        arcOf(line),
        normals,
        k => {
          const i = stepOf[from + k]!
          return (owned[i] ? own[i] : firstFrame[i])?.normals[
            pointIndex(run, from + k)
          ]
        },
        k => run.forward[stepOf[from + k]!]!,
        (k, sign) => {
          const p = from + k
          const i = stepOf[p]!
          if (shared[i]) {
            return
          }
          const index = pointIndex(run, p)
          const m = normals[k]
          own[i]!.normals[index] =
            m && (sign > 0 ? m : { nx: -m.nx, ny: -m.ny })
          if (smooth) {
            own[i]!.shifts[index] = {
              dx: line[k]!.x - points[k]!.x,
              dy: (line[k]!.y - points[k]!.y) / yToX,
            }
          }
        },
        turn,
      )
    }
    if (!smooth) {
      arcs.push(raw)
      return
    }
    const s = new Float64Array(n)
    let px = 0
    let py = 0
    for (let p = 0; p < n; p++) {
      const shift = own[stepOf[p]!]!.shifts[pointIndex(run, p)]
      const x = xs[p]! + (shift?.dx ?? 0)
      const y = ys[p]! + (shift?.dy ?? 0) * yToX
      s[p] = p ? s[p - 1]! + Math.sqrt((x - px) ** 2 + (y - py) ** 2) : 0
      px = x
      py = y
    }
    arcs.push(s)
  })
  return { frames, arcs, stepFrames }
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
  s: ArrayLike<number>,
  v: ArrayLike<number>,
  half: number,
  counted: (value: number) => boolean = () => true,
) {
  const n = v.length
  const sumW = new Float64Array(n + 1)
  const sumWV = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const w = !counted(v[i]!)
      ? 0
      : n > 1
        ? (s[Math.min(i + 1, n - 1)]! - s[Math.max(i - 1, 0)]!) / 2
        : 1
    sumW[i + 1] = sumW[i]! + w
    sumWV[i + 1] = sumWV[i]! + w * v[i]!
  }
  const out = new Float64Array(n)
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    while (s[i]! - s[lo]! > half) {
      lo++
    }
    while (hi < n && s[hi]! - s[i]! <= half) {
      hi++
    }
    const w = sumW[hi]! - sumW[lo]!
    out[i] = w > 0 ? (sumWV[hi]! - sumWV[lo]!) / w : v[i]!
  }
  return out
}

export interface WalkThreads {
  span: ReadonlyMap<string, number>
  nodeThreads: Map<string, readonly number[]>
  // which of the walk's visits to a node each of its threads carries
  threadPasses: Map<string, readonly number[]>
  // where a node the walk visits once runs its thread, in thread pitches,
  // where that falls between threads
  threadAt: Map<string, readonly number[]>
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
      threadAt: new Map(),
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
  const stepGlides: number[][] = []
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
    const glides = new Array<number>(n).fill(NaN)
    for (let i = 0; i < n; i++) {
      const b = before[i]!
      const a = after[i]!
      const nearest =
        b < 0 ? a : a < 0 ? b : s[i]! - s[b]! <= s[a]! - s[i]! ? b : a
      const want = (k: number) => Math.min(copy[k]!, most[i]!) - 1
      wants[i] = want(nearest)
      // a node the walk passes once has no other thread of its own to dodge,
      // so it slides from the thread behind it to the one ahead
      if (p[i] === 1 && b >= 0 && a >= 0 && want(a) !== want(b)) {
        const f = (s[i]! - s[b]!) / (s[a]! - s[b]! || 1)
        glides[i] = want(b) + (want(a) - want(b)) * f
      }
      widths[nodes[i]!] = Math.max(widths[nodes[i]!]!, most[i]!)
    }
    steps.push(nodes)
    stepVisits.push(copy)
    stepWants.push(wants)
    stepGlides.push(glides)
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
  const glideOf: (number[] | undefined)[] = []
  steps.forEach((nodes, piece) => {
    nodes.forEach((k, i) => {
      if (widths[k]! > 1) {
        const glide = stepGlides[piece]![i]!
        const t = free(
          k,
          Number.isNaN(glide) ? stepWants[piece]![i]! : Math.round(glide),
        )
        taken[k]!.add(t)
        ;(threadOf[k] ??= [])[stepVisits[piece]![i]!] = t
        if (!Number.isNaN(glide)) {
          ;(glideOf[k] ??= [])[t] = glide
        }
      }
    })
  })
  const span = new Map<string, number>()
  const nodeThreads = new Map<string, readonly number[]>()
  const threadPasses = new Map<string, readonly number[]>()
  const threadAt = new Map<string, readonly number[]>()
  ids.forEach((id, k) => {
    if (glideOf[k]) {
      threadAt.set(id, glideOf[k])
    }
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
  return { span, nodeThreads, threadPasses, threadAt, linkThreads }
}

export function bandSpans(
  runs: readonly LaneRun[],
  arcs: readonly ArrayLike<number>[],
  spans: readonly ReadonlyMap<string, number>[],
  { reach, taper }: { reach: number; taper: number },
) {
  const out = new Map<string, { slot: number[]; held: number[] }>()
  runs.forEach((run, r) => {
    const s = arcs[r]!
    const along = run.ids.map((_, i) => {
      const length = run.starts[i + 1]! - run.starts[i]!
      const middle = Math.floor(length / 2)
      return s[
        run.starts[i]! + (run.forward[i] ? middle : length - 1 - middle)
      ]!
    })
    for (const [lo, hi] of ownedWindows(
      along,
      run.owned,
      reach / 2 + taper / 2,
    )) {
      const at = along.slice(lo, hi + 1)
      const ids = run.ids.slice(lo, hi + 1)
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
        if (run.owned[lo + i]) {
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

// How far each walk's visit runs its thread from the band's middle at each
// of its points, eased along the walk's own route so a thread slides over
// smoothly where the band gains or loses a walk or the thread changes place,
// rather than stepping sideways at whichever node boundary the change falls on
function easeOffsets(
  runs: readonly LaneRun[],
  stepFrames: readonly (readonly VisitFrame[])[],
  arcs: readonly ArrayLike<number>[],
  spans: ReadonlyMap<string, { slot: number[]; held: number[] }>,
  passes: readonly number[],
  threads: readonly WalkThreads[],
  half: number,
) {
  const plain = slotCentres(passes, passes)
  const byNode = new Map<string, number[]>()
  const centresAt = (id: string) => {
    let centres = byNode.get(id)
    if (!centres) {
      const own = spans.get(id)
      centres = own ? slotCentres(own.slot, passes, own.held) : plain
      byNode.set(id, centres)
    }
    return centres
  }
  runs.forEach((run, r) => {
    const { walk, ids, visits, starts } = run
    const { threadPasses, threadAt } = threads[walk]!
    const raw = new Float64Array(run.xs.length)
    ids.forEach((id, i) => {
      const thread = Math.max(0, threadPasses.get(id)?.indexOf(visits[i]!) ?? 0)
      const place = threadAt.get(id)?.[thread] ?? thread
      raw.fill(
        centresAt(id)[walk]! + place * THREAD_PITCH_PX,
        starts[i],
        starts[i + 1],
      )
    })
    const eased = windowMean(arcs[r]!, raw, half)
    stepFrames[r]!.forEach((frame, i) => {
      const from = starts[i]!
      const to = starts[i + 1]!
      let constant = true
      for (let p = from + 1; constant && p < to; p++) {
        constant = Math.abs(eased[p]! - eased[from]!) < 1e-9
      }
      if (constant) {
        frame.offset = eased[from]
        return
      }
      const offsets = new Array<number>(to - from)
      for (let p = from; p < to; p++) {
        offsets[pointIndex(run, p)] = eased[p]!
      }
      frame.offsets = offsets
    })
  })
}

export function liftLanes(
  walks: readonly LiftedWalk[],
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  worldPerScreenPx: number,
  steps = walkSteps(
    walks.map(w => w.route),
    nodePositions,
  ),
) {
  const threaded = threadsPasses(walks)
  const passes = walks.map(w => w.mostPasses)
  const reach = THREAD_REACH_PX * worldPerScreenPx
  const runs = laneRuns(steps, yToX, LANE_SMOOTHING_PX * worldPerScreenPx)
  const band =
    bandWidthPx(passes) * (threaded ? bandScale(passes) : 1) * worldPerScreenPx
  const lines = laneLines(
    runs,
    yToX,
    LANE_SMOOTHING_PX * worldPerScreenPx,
    band,
    threaded,
  )
  const threads = threaded
    ? walks.map(w => walkThreads(w.route, w.passes, nodePositions, yToX, reach))
    : undefined
  const spans = threads
    ? bandSpans(
        runs,
        lines.arcs,
        threads.map(t => t.span),
        { reach, taper: THREAD_TAPER_PX * worldPerScreenPx },
      )
    : undefined
  if (spans && threads) {
    easeOffsets(
      runs,
      lines.stepFrames,
      lines.arcs,
      spans,
      passes,
      threads,
      (THREAD_TAPER_PX / 2) * worldPerScreenPx,
    )
  }
  const furthestShift = { dx: 0, dy: 0 }
  const seenShifts = new Set<VisitFrame['shifts']>()
  for (const byWalk of lines.frames.values()) {
    for (const { shifts } of byWalk.flat()) {
      if (seenShifts.has(shifts)) {
        continue
      }
      seenShifts.add(shifts)
      for (const shift of shifts) {
        furthestShift.dx = Math.max(furthestShift.dx, Math.abs(shift?.dx ?? 0))
        furthestShift.dy = Math.max(furthestShift.dy, Math.abs(shift?.dy ?? 0))
      }
    }
  }
  return { lines, threads, spans, furthestShift }
}
