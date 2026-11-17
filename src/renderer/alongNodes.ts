import { SMALL_SITE_PX } from '../levelOfDetail'

// Plain links paint under the nodes, so one whose ends the layout lays
// SMALL_SITE_PX or more apart with node lines along half the line between
// them or more is covered by them unless painted over them, as a skip is.
export const ALONG_NODE_PX = 1
const END_INSET_PX = 0.75
const SAMPLE_STEP_PX = 0.5
const MOST_SAMPLES = 64
const CELL_PX = 8
const MOST_CELLS_ACROSS = 512
const CELL_SPAN = 2 ** 26
const CELL_OFFSET = 2 ** 25

interface Point {
  x: number
  y: number
}

export interface LinkEnds {
  id: number
  a: Point
  b: Point
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const u =
    len2 > 0
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
      : 0
  return Math.hypot(a.x + u * dx - p.x, a.y + u * dy - p.y)
}

const meets = (a: Point, b: Point, bounds: Bounds, margin: number) =>
  Math.max(a.x, b.x) >= bounds.minX - margin &&
  Math.min(a.x, b.x) <= bounds.maxX + margin &&
  Math.max(a.y, b.y) >= bounds.minY - margin &&
  Math.min(a.y, b.y) <= bounds.maxY + margin

// node lines, link ends and the bounds drawn, in screen px. A grid of
// segments is kept at most MOST_CELLS_ACROSS cells across the lines drawn,
// and a long link is sampled at MOST_SAMPLES points, so a drawing zoomed far
// in costs about what it costs at the fit
export function linksAlongNodes(
  lines: Point[][],
  links: LinkEnds[],
  bounds?: Bounds,
) {
  const span = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  }
  for (const line of lines) {
    for (const p of line) {
      span.minX = Math.min(span.minX, p.x)
      span.minY = Math.min(span.minY, p.y)
      span.maxX = Math.max(span.maxX, p.x)
      span.maxY = Math.max(span.maxY, p.y)
    }
  }
  const across = Math.max(span.maxX - span.minX, span.maxY - span.minY, 0)
  const cellPx = Math.max(CELL_PX, across / MOST_CELLS_ACROSS)
  const stepPx = cellPx / 2
  const reachPx = ALONG_NODE_PX + stepPx / 2
  const cellAt = (x: number, y: number) =>
    (Math.floor(x / cellPx) + CELL_OFFSET) * CELL_SPAN +
    Math.floor(y / cellPx) +
    CELL_OFFSET
  const cells = new Map<number, [Point, Point][]>()
  const hold = (cell: number, segment: [Point, Point]) => {
    const held = cells.get(cell)
    if (!held) {
      cells.set(cell, [segment])
    } else if (held.at(-1) !== segment) {
      held.push(segment)
    }
  }
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)]!
      const b = line[i]!
      if (!bounds || meets(a, b, bounds, reachPx)) {
        const segment: [Point, Point] = [a, b]
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stepPx)
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / Math.max(1, steps)
          const y = a.y + ((b.y - a.y) * k) / Math.max(1, steps)
          hold(cellAt(x - reachPx, y - reachPx), segment)
          hold(cellAt(x + reachPx, y - reachPx), segment)
          hold(cellAt(x - reachPx, y + reachPx), segment)
          hold(cellAt(x + reachPx, y + reachPx), segment)
        }
      }
    }
  }
  const onNode = (p: Point) =>
    cells
      .get(cellAt(p.x, p.y))
      ?.some(([a, b]) => distanceToSegment(p, a, b) <= ALONG_NODE_PX) ?? false
  const along = new Set<number>()
  for (const { id, a, b } of links) {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length >= SMALL_SITE_PX && (!bounds || meets(a, b, bounds, 0))) {
      const inner = length - 2 * END_INSET_PX
      const samples = Math.min(
        MOST_SAMPLES,
        Math.floor(inner / SAMPLE_STEP_PX) + 1,
      )
      const spacing =
        samples < MOST_SAMPLES ? SAMPLE_STEP_PX : inner / (MOST_SAMPLES - 1)
      const half = Math.ceil(samples / 2)
      let on = 0
      let off = 0
      for (let k = 0; k < samples && on < half && off <= samples - half; k++) {
        const u = (END_INSET_PX + k * spacing) / length
        if (onNode({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })) {
          on++
        } else {
          off++
        }
      }
      if (on >= half) {
        along.add(id)
      }
    }
  }
  return along
}
