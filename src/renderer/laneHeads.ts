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

const cellOf = (v: number) => Math.floor(v / LANE_HEAD_SPACING_PX)

// Heads placed so far, by thread and by lane, in screen px on a grid of cells
// LANE_HEAD_SPACING_PX wide
function spacing() {
  const cells = new Map<string, Spot[]>()
  return {
    clear(key: string, at: Spot, reach: number) {
      const cx = cellOf(at.x)
      const cy = cellOf(at.y)
      const span = Math.ceil(reach / LANE_HEAD_SPACING_PX)
      for (let i = cx - span; i <= cx + span; i++) {
        for (let j = cy - span; j <= cy + span; j++) {
          for (const p of cells.get(`${key}\t${i}\t${j}`) ?? []) {
            if (Math.hypot(p.x - at.x, p.y - at.y) < reach) {
              return false
            }
          }
        }
      }
      return true
    },
    add(key: string, at: Spot) {
      const cell = `${key}\t${cellOf(at.x)}\t${cellOf(at.y)}`
      const held = cells.get(cell)
      if (held) {
        held.push(at)
      } else {
        cells.set(cell, [at])
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
  const byThread = spacing()
  const byLane = spacing()
  return (stroke: LaneHeadStroke) => {
    const { points, halfWidth, color, walk, thread, threads, node, against } =
      stroke
    const turn =
      LANE_HEAD_SPACING_PX * Math.min(Math.max(1, threads), LANE_HEAD_TURNS)
    const screen = points.map(p => ({ x: p.x * scale, y: p.y * scale * yToX }))
    const arc = [0]
    for (let i = 1; i < screen.length; i++) {
      arc.push(
        arc[i - 1]! +
          Math.hypot(
            screen[i]!.x - screen[i - 1]!.x,
            screen[i]!.y - screen[i - 1]!.y,
          ),
      )
    }
    const total = arc.at(-1) ?? 0
    const count =
      screen.length > 1 && total > 0
        ? Math.max(1, Math.floor(total / LANE_HEAD_SPACING_PX))
        : 0
    const width = Math.max(2 * halfWidth, LANE_HEAD_MIN_PX)
    const ink = laneHeadInk(color, 2 * halfWidth >= LANE_HEAD_MIN_PX)
    const heads: Arrowhead[] = []
    let segment = 1
    for (let k = 0; k < count; k++) {
      const along = ((k + 0.5) * total) / count
      while (segment < screen.length - 1 && arc[segment]! < along) {
        segment++
      }
      const a = screen[segment - 1]!
      const b = screen[segment]!
      const run = arc[segment]! - arc[segment - 1]!
      const f = run > 0 ? (along - arc[segment - 1]!) / run : 0
      const at = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
      const threadKey = `${walk}\t${thread}`
      const laneKey = `${walk}`
      if (
        run > 0 &&
        byThread.clear(threadKey, at, turn) &&
        byLane.clear(laneKey, at, LANE_HEAD_SPACING_PX)
      ) {
        byThread.add(threadKey, at)
        byLane.add(laneKey, at)
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
    return heads
  }
}
