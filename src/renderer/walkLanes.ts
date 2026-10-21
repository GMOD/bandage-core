import type { NodeSegment } from '../types'

export const THREAD_PX = 2
export const THREAD_GAP_PX = 1.5
export const SLOT_GAP_PX = 4
export const LANE_SMOOTHING_PX = 12

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

interface LinePoint {
  x: number
  y: number
  step: number
  index: number
}

const gapOf = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y)

function smoothedNormals(run: LinePoint[], reach: number) {
  const s = [0]
  for (let i = 1; i < run.length; i++) {
    s.push(s[i - 1]! + gapOf(run[i - 1]!, run[i]!))
  }
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

// Each node's normals, point by point, left of the first walk through it as
// that walk runs, its line smoothed over `reach` x units
export function laneNormals(
  routes: readonly (readonly string[])[],
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  reach: number,
) {
  const field = new Map<string, (Normal | undefined)[]>()
  const drawn = (p: NodeSegment) => ({ x: p.x, y: p.y * yToX })
  for (const route of routes) {
    const runs: LinePoint[][] = []
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
        run.push({ ...drawn(segments[index]!), step, index })
      }
    })
    runs.push(run)
    for (const points of runs.filter(r => r.length > 0)) {
      const normals = smoothedNormals(points, reach)
      const claimed = new Set<number>()
      points.forEach((p, i) => {
        const id = route[p.step]!
        if (!claimed.has(p.step) && field.has(id)) {
          return
        }
        claimed.add(p.step)
        const own =
          field.get(id) ??
          new Array<Normal | undefined>(nodePositions[id]!.length)
        own[p.index] = normals[i]
        field.set(id, own)
      })
    }
  }
  return field
}

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

// How many passes a walk draws through each node: its passes, with a dip
// shorter than `reach` along the walk filled, where its copies part round a
// bubble and each side takes one of them
export function drawnPasses(
  route: readonly (readonly string[])[],
  passes: ReadonlyMap<string, number>,
  nodePositions: Record<string, NodeSegment[]>,
  yToX: number,
  reach: number,
) {
  const out = new Map<string, number>()
  for (const piece of route) {
    const s: number[] = []
    const v: number[] = []
    let prev: { x: number; y: number } | undefined
    let at = 0
    for (const id of piece) {
      const segments = nodePositions[id]
      const mid = segments?.[Math.floor(segments.length / 2)]
      const here = mid ? { x: mid.x, y: mid.y * yToX } : prev
      at += prev && here ? gapOf(prev, here) : 0
      prev = here
      s.push(at)
      v.push(passes.get(id) ?? 1)
    }
    const closed = windowed(s, windowed(s, v, reach / 2, 1), reach / 2, -1)
    piece.forEach((id, i) => {
      out.set(id, Math.max(out.get(id) ?? 0, closed[i]!))
    })
  }
  return out
}
