import { SMALL_SITE_PX } from '../levelOfDetail'

// Plain links paint under the nodes, so one whose ends the layout lays
// SMALL_SITE_PX or more apart with node lines along half the line between
// them or more is covered by them unless painted over them, as a skip is.
export const ALONG_NODE_PX = 1
const END_INSET_PX = 0.75
const SAMPLE_STEP_PX = 0.5
const CELL_PX = 8

interface Point {
  x: number
  y: number
}

export interface LinkEnds {
  edge: number
  a: Point
  b: Point
}

const cellOf = (v: number) => Math.floor(v / CELL_PX)

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

// node lines and link ends in screen px
export function linksAlongNodes(lines: Iterable<Point[]>, links: LinkEnds[]) {
  const cells = new Map<string, [Point, Point][]>()
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)]!
      const b = line[i]!
      for (
        let cx = cellOf(Math.min(a.x, b.x) - ALONG_NODE_PX);
        cx <= cellOf(Math.max(a.x, b.x) + ALONG_NODE_PX);
        cx++
      ) {
        for (
          let cy = cellOf(Math.min(a.y, b.y) - ALONG_NODE_PX);
          cy <= cellOf(Math.max(a.y, b.y) + ALONG_NODE_PX);
          cy++
        ) {
          const key = `${cx},${cy}`
          const held = cells.get(key)
          if (held) {
            held.push([a, b])
          } else {
            cells.set(key, [[a, b]])
          }
        }
      }
    }
  }
  const onNode = (p: Point) =>
    (cells.get(`${cellOf(p.x)},${cellOf(p.y)}`) ?? []).some(
      ([a, b]) => distanceToSegment(p, a, b) <= ALONG_NODE_PX,
    )
  const along = new Set<number>()
  for (const { edge, a, b } of links) {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length >= SMALL_SITE_PX) {
      const samples =
        Math.floor((length - 2 * END_INSET_PX) / SAMPLE_STEP_PX) + 1
      let on = 0
      for (let k = 0; k < samples; k++) {
        const u = (END_INSET_PX + k * SAMPLE_STEP_PX) / length
        on += onNode({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
          ? 1
          : 0
      }
      if (2 * on >= samples) {
        along.add(edge)
      }
    }
  }
  return along
}
