import type { GraphEdge } from '../types'
import type { BezierCurve } from '../util/geometry'

type Side = 'start' | 'end'

// About a run of cubics' length on screen: the mean of each one's chord and
// control polygon
export function curvesPx(
  curves: readonly BezierCurve[],
  scaleX: number,
  scaleY: number,
) {
  const leg = (x0: number, y0: number, x1: number, y1: number) =>
    Math.hypot((x1 - x0) * scaleX, (y1 - y0) * scaleY)
  let total = 0
  for (const c of curves) {
    total +=
      (leg(c.x0, c.y0, c.x1, c.y1) +
        leg(c.x0, c.y0, c.cx0, c.cy0) +
        leg(c.cx0, c.cy0, c.cx1, c.cy1) +
        leg(c.cx1, c.cy1, c.x1, c.y1)) /
      2
  }
  return total
}

const entersAt = (e: GraphEdge): Side => (e.toStrand === '-' ? 'end' : 'start')
const leavesAt = (e: GraphEdge): Side =>
  e.fromStrand === '-' ? 'start' : 'end'
const otherSide = (s: Side): Side => (s === 'start' ? 'end' : 'start')

// The links that read one way along a chain of nodes, in order: each node
// between two of them has those two links and no other, one at each end, the
// first entering where the second leaves, so every head along the run points
// the same way. `drawn` names the links the drawing strokes, which alone count
// toward a node's links; `chains` the ones a run may hold. A run of one link is
// left out.
export function directedRuns(
  edges: readonly GraphEdge[],
  drawn: readonly number[],
  chains: (edge: number) => boolean,
) {
  const atSide = new Map<string, number[]>()
  const add = (node: string, side: Side, ei: number) => {
    const key = `${node}\t${side}`
    const list = atSide.get(key)
    if (list) {
      list.push(ei)
    } else {
      atSide.set(key, [ei])
    }
  }
  for (const ei of drawn) {
    const e = edges[ei]!
    add(e.from, leavesAt(e), ei)
    add(e.to, entersAt(e), ei)
  }
  const next = new Map<number, number>()
  const follows = new Set<number>()
  for (const ei of drawn) {
    const e = edges[ei]!
    const side = entersAt(e)
    const here = atSide.get(`${e.to}\t${side}`)
    const there = atSide.get(`${e.to}\t${otherSide(side)}`)
    const f = there?.length === 1 ? there[0]! : -1
    const fe = edges[f]
    if (
      chains(ei) &&
      here?.length === 1 &&
      fe &&
      f !== ei &&
      chains(f) &&
      fe.from === e.to &&
      leavesAt(fe) === otherSide(side)
    ) {
      next.set(ei, f)
      follows.add(f)
    }
  }
  const runs: number[][] = []
  const taken = new Set<number>()
  const runFrom = (first: number) => {
    const run: number[] = []
    for (
      let ei: number | undefined = first;
      ei !== undefined && !taken.has(ei);
      ei = next.get(ei)
    ) {
      taken.add(ei)
      run.push(ei)
    }
    if (run.length > 1) {
      runs.push(run)
    }
  }
  for (const ei of drawn) {
    if (next.has(ei) && !follows.has(ei)) {
      runFrom(ei)
    }
  }
  for (const ei of drawn) {
    if (next.has(ei) && !taken.has(ei)) {
      runFrom(ei)
    }
  }
  return runs
}

// Which of a run's heads are drawn: one per `spacing` px of the run's length
// on screen and at least one, each at the head nearest an even share of that
// length. `along` is each head's distance along the run, increasing, and
// `drawable` whether a head fits there at all.
export function spreadHeads(
  along: readonly number[],
  drawable: readonly boolean[],
  total: number,
  spacing: number,
) {
  const candidates = along.flatMap((_, i) => (drawable[i] ? [i] : []))
  const kept = new Set<number>()
  if (candidates.length > 0) {
    const count = Math.max(1, Math.floor(total / spacing))
    let at = 0
    for (let k = 0; k < count; k++) {
      const target = ((k + 0.5) * total) / count
      while (
        at + 1 < candidates.length &&
        Math.abs(along[candidates[at + 1]!]! - target) <
          Math.abs(along[candidates[at]!]! - target)
      ) {
        at++
      }
      kept.add(candidates[at]!)
    }
  }
  return kept
}
