import { pushTo } from '../util/groups'
import { contrastRatio, mixAbgr, packAbgr } from './colorBits'

import type { Arrowhead } from './types'

export const LANE_HEADS_KEY = 'the way the walk runs'
export const LANE_HEADS_AGAINST_KEY = 'walk runs backwards along the node'

export const LANE_HEAD_MIN_PX = 6
export const LANE_HEAD_SPACING_PX = 40
export const LANE_HEAD_TURNS = 6
export const LANE_HEAD_LENGTH = 1.4
export const LANE_HEAD_HALO_PX = 1.5
export const HEAD_CONTRAST = 3

const BLACK = packAbgr(0, 0, 0, 255)
const WHITE = packAbgr(255, 255, 255, 255)
const MIX_STEPS = 32
const inks = new Map<number, number>()

// Inside its lane a head is black or white, whichever contrasts more; wider,
// it is the lane's colour darkened the least that keeps HEAD_CONTRAST with white
export function laneHeadInk(ink: number, inside: boolean) {
  const key = ink * 2 + (inside ? 1 : 0)
  let head = inks.get(key)
  if (head === undefined) {
    head = inside
      ? contrastRatio(BLACK, ink) > contrastRatio(WHITE, ink)
        ? BLACK
        : WHITE
      : (Array.from({ length: MIX_STEPS + 1 }, (_, i) =>
          mixAbgr(ink, BLACK, i / MIX_STEPS),
        ).find(mixed => contrastRatio(mixed, WHITE) >= HEAD_CONTRAST) ?? BLACK)
    inks.set(key, head)
  }
  return head
}

interface Spot {
  x: number
  y: number
}

const NO_SPOTS: readonly Spot[] = []

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
      pushTo(column, cy, at)
    },
  }
}

export interface LaneHeadStroke {
  // layout units
  points: readonly Spot[]
  halfWidth: number
  color: number
  walk: number
  thread: number
  threads: number
  node: string
  against: boolean
  // a stroke a spacing long whose heads all fall by other strokes' keeps
  // its middle one
  keepOne?: boolean
}

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
    const inside = 2 * halfWidth >= LANE_HEAD_MIN_PX
    const ink = laneHeadInk(color, inside)
    const ownThread = threadGrid(walk, thread)
    const ownLane = laneGrid(walk)
    const heads: Arrowhead[] = []
    const legFrom = (start: number, along: number) => {
      let index = start
      while (index < legs.length - 1 && (legs[index]?.to ?? along) < along) {
        index++
      }
      return index
    }
    const place = (index: number, along: number, cleared: boolean) => {
      const leg = legs[index]
      if (leg && leg.run > 0) {
        const { a, b, run } = leg
        const f = (along - leg.from) / run
        const at = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
        if (
          cleared ||
          (ownThread.clear(at, turn) && ownLane.clear(at, LANE_HEAD_SPACING_PX))
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
            ...(inside ? {} : { halo: true }),
          })
        }
      }
    }
    let index = 0
    for (let k = 0; k < count; k++) {
      const along = ((k + 0.5) * total) / count
      index = legFrom(index, along)
      place(index, along, false)
    }
    if (stroke.keepOne && heads.length === 0 && total >= LANE_HEAD_SPACING_PX) {
      place(legFrom(0, total / 2), total / 2, true)
    }
    return heads
  }
}
