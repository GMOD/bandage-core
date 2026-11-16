import { abgrBlue, abgrGreen, abgrRed, packAbgr } from './colorBits'

import type { Arrowhead } from './types'

// Heads along a lifted walk's lane, pointing the way the walk runs: where it
// reads a node against the way the node is drawn, and along every thread of a
// lane coloured by pass. A head is about as wide as its lane, never under
// LANE_HEAD_MIN_PX, and at least LANE_HEAD_SPACING_PX from any head of its
// lane; the threads side by side take turns, each keeping that spacing times
// their count, up to LANE_HEAD_TURNS, from its own heads.
export const LANE_HEADS_KEY = 'the way the walk runs'
export const BACKWARDS_KEY = 'walk runs backwards along the node'

export const LANE_HEAD_MIN_PX = 6
export const LANE_HEAD_SPACING_PX = 40
export const LANE_HEAD_TURNS = 6
const LANE_HEAD_LENGTH = 1.4
const DARK_LANE = 0.5
const ON_DARK = packAbgr(255, 255, 255, 255)
const SHADE = 0.45

const luminance = (ink: number) =>
  (0.2126 * abgrRed(ink) + 0.7152 * abgrGreen(ink) + 0.0722 * abgrBlue(ink)) /
  255

const shaded = (ink: number) =>
  packAbgr(
    Math.round(abgrRed(ink) * SHADE),
    Math.round(abgrGreen(ink) * SHADE),
    Math.round(abgrBlue(ink) * SHADE),
    255,
  )

// The ink of a head on a lane of `ink`: one that fits inside the lane stands
// out of it, white on a dark lane and a shade of it on a pale one; one wider
// than its lane is a shade of it
export function laneHeadInk(ink: number, inside: boolean) {
  return inside && luminance(ink) < DARK_LANE ? ON_DARK : shaded(ink)
}

interface Spot {
  x: number
  y: number
}

const NO_SPOTS: readonly Spot[] = []

// Points on a grid of square cells `size` px wide, to find any nearer a point
// than a reach of at most `size` by the cells around it
function grid(size: number) {
  const columns = new Map<number, Map<number, Spot[]>>()
  return {
    clear(at: Spot, reach: number) {
      const cx = Math.floor(at.x / size)
      const cy = Math.floor(at.y / size)
      let clear = true
      for (let i = cx - 1; i <= cx + 1 && clear; i++) {
        const column = columns.get(i)
        for (let j = cy - 1; j <= cy + 1 && clear; j++) {
          clear = (column?.get(j) ?? NO_SPOTS).every(
            p => Math.hypot(p.x - at.x, p.y - at.y) >= reach,
          )
        }
      }
      return clear
    },
    add(at: Spot) {
      const cx = Math.floor(at.x / size)
      const cy = Math.floor(at.y / size)
      let column = columns.get(cx)
      if (!column) {
        column = new Map()
        columns.set(cx, column)
      }
      const held = column.get(cy)
      if (held) {
        held.push(at)
      } else {
        column.set(cy, [at])
      }
    },
  }
}

export interface LaneHeadStroke {
  // the stroke's points in layout units, in the order the node is drawn
  points: readonly Spot[]
  halfWidth: number
  color: number
  walk: number
  thread: number
  // the lane's threads at the node
  threads: number
  node: string
  // the walk reads the node against the order of its points
  against: boolean
}

// `scale` and `yToX` take layout units to screen px, as the geometry builder
// states them
export function laneHeadPlacer(scale: number, yToX: number) {
  const lanes = new Map<number, ReturnType<typeof grid>>()
  const threadGrids = new Map<number, Map<number, ReturnType<typeof grid>>>()
  const laneGrid = (walk: number) => {
    let held = lanes.get(walk)
    if (!held) {
      held = grid(LANE_HEAD_SPACING_PX)
      lanes.set(walk, held)
    }
    return held
  }
  const threadGrid = (walk: number, thread: number) => {
    let byThread = threadGrids.get(walk)
    if (!byThread) {
      byThread = new Map()
      threadGrids.set(walk, byThread)
    }
    let held = byThread.get(thread)
    if (!held) {
      held = grid(LANE_HEAD_SPACING_PX * LANE_HEAD_TURNS)
      byThread.set(thread, held)
    }
    return held
  }
  return (stroke: LaneHeadStroke) => {
    const { points, halfWidth, color, walk, thread, threads, node, against } =
      stroke
    const turn =
      LANE_HEAD_SPACING_PX * Math.min(Math.max(1, threads), LANE_HEAD_TURNS)
    const legs: { a: Spot; b: Spot; from: number; to: number; run: number }[] =
      []
    let total = 0
    let previous: Spot | undefined
    for (const p of points) {
      const b = { x: p.x * scale, y: p.y * scale * yToX }
      if (previous) {
        const run = Math.hypot(b.x - previous.x, b.y - previous.y)
        legs.push({ a: previous, b, from: total, to: total + run, run })
        total += run
      }
      previous = b
    }
    const count =
      total > 0 ? Math.max(1, Math.floor(total / LANE_HEAD_SPACING_PX)) : 0
    const width = Math.max(2 * halfWidth, LANE_HEAD_MIN_PX)
    const ink = laneHeadInk(color, 2 * halfWidth >= LANE_HEAD_MIN_PX)
    const ownThread = threadGrid(walk, thread)
    const ownLane = laneGrid(walk)
    const heads: Arrowhead[] = []
    let index = 0
    for (let k = 0; k < count; k++) {
      const along = ((k + 0.5) * total) / count
      while (index < legs.length - 1 && (legs[index]?.to ?? along) < along) {
        index++
      }
      const leg = legs[index]
      if (leg && leg.run > 0) {
        const { a, b, run } = leg
        const f = (along - leg.from) / run
        const at = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
        if (
          ownThread.clear(at, turn) &&
          ownLane.clear(at, LANE_HEAD_SPACING_PX)
        ) {
          ownThread.add(at)
          ownLane.add(at)
          const sign = against ? -1 : 1
          const ux = (sign * (b.x - a.x)) / run
          const uy = (sign * (b.y - a.y)) / run
          const length = width * LANE_HEAD_LENGTH
          heads.push({
            x: (at.x + (ux * length) / 2) / scale,
            y: (at.y + (uy * length) / 2) / (scale * yToX),
            angle: Math.atan2(uy, ux),
            length,
            halfWidth: width / 2,
            color: ink,
            walk,
            pass: thread,
            node,
            against,
          })
        }
      }
    }
    return heads
  }
}
