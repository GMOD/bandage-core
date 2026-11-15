import { isBackbone } from '../anchoredNodes'
import { meanDepth, nodeWidthPx } from '../nodeWidths'
import { ASSUMED_FIT, fitRoom } from './fitAssumptions'

import type { Graph, GraphNode, NodeSegment } from '../types'
import type { FitSize } from './fitAssumptions'

type Positions = Record<string, NodeSegment[]>

interface Extent {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Point {
  x: number
  y: number
}

interface Segment {
  a: Point
  b: Point
}

const SHIPPED_THICKNESS = 6

const GAP_PX = 2

// in clearances; above 1, so the push keeps what lies further out in order
const FADE = 3

const EPSILON = 1e-9

function isReference(node: GraphNode) {
  return isBackbone(node) && !node.placeholder
}

function halfWidthPx(node: GraphNode, norm: number) {
  return nodeWidthPx(node, SHIPPED_THICKNESS, 'depth', norm) / 2
}

function widest(nodes: GraphNode[], norm: number) {
  let px = 0
  for (const node of nodes) {
    px = Math.max(px, halfWidthPx(node, norm))
  }
  return px
}

function fitScale(extent: Extent, fit: FitSize) {
  const room = fitRoom(fit)
  const w = extent.maxX - extent.minX
  const h = extent.maxY - extent.minY
  return Math.min(
    w > 0 ? room.width / w : Infinity,
    h > 0 ? room.height / h : Infinity,
  )
}

function nearestOn(s: Segment, p: Point) {
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const length2 = dx * dx + dy * dy
  const u =
    length2 > 0
      ? Math.max(
          0,
          Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / length2),
        )
      : 0
  const q = { x: s.a.x + u * dx, y: s.a.y + u * dy }
  const length = Math.sqrt(length2)
  const normal =
    length > 0 ? { x: -dy / length, y: dx / length } : { x: 0, y: 1 }
  return { q, normal, d: Math.hypot(p.x - q.x, p.y - q.y) }
}

function cellKey(gx: number, gy: number) {
  return `${gx},${gy}`
}

function referenceIndex(segments: Segment[], cell: number, reach: number) {
  const grid = new Map<string, Segment[]>()
  for (const s of segments) {
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cell)
    const x1 = Math.floor(Math.max(s.a.x, s.b.x) / cell)
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / cell)
    const y1 = Math.floor(Math.max(s.a.y, s.b.y) / cell)
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = cellKey(gx, gy)
        const held = grid.get(k)
        if (held) {
          held.push(s)
        } else {
          grid.set(k, [s])
        }
      }
    }
  }
  const cells = Math.ceil(reach / cell)
  return (p: Point) => {
    let best: ReturnType<typeof nearestOn> | undefined
    const gx0 = Math.floor(p.x / cell)
    const gy0 = Math.floor(p.y / cell)
    for (let gx = gx0 - cells; gx <= gx0 + cells; gx++) {
      for (let gy = gy0 - cells; gy <= gy0 + cells; gy++) {
        for (const s of grid.get(cellKey(gx, gy)) ?? []) {
          const hit = nearestOn(s, p)
          if (hit.d < reach && (!best || hit.d < best.d)) {
            best = hit
          }
        }
      }
    }
    return best
  }
}

function movedOut(
  p: NodeSegment,
  hit: ReturnType<typeof nearestOn>,
  side: number,
  d: number,
  clearance: number,
) {
  const { q, normal } = hit
  const along =
    hit.d > EPSILON
      ? { x: (p.x - q.x) / hit.d, y: (p.y - q.y) / hit.d }
      : { x: normal.x * side, y: normal.y * side }
  const across = (along.x * normal.x + along.y * normal.y) * side
  const out =
    across < 0 && hit.d <= clearance
      ? {
          x: along.x - 2 * across * normal.x * side,
          y: along.y - 2 * across * normal.y * side,
        }
      : along
  return { ...p, x: q.x + out.x * d, y: q.y + out.y * d }
}

// Every node off the reference laid clear of the reference's ink at the fit
// to `fit`: widths are screen px and positions layout units, so the gap is
// sized for the pane the host fits the drawing into, and a larger pane or a
// closer zoom only widens it. A point within the clearance moves out by it, and the push fades to nothing
// over the next FADE clearances. A node lying across the line goes to the side
// most of it is on. A node the push would carry into another stretch of the
// reference's ink, where the drawing folds back on itself, stays put.
export function clearOfReference(
  graph: Graph,
  positions: Positions,
  extent: Extent,
  fit: FitSize = ASSUMED_FIT,
): Positions {
  const drawn = graph.nodes.filter(n => (positions[n.id]?.length ?? 0) > 0)
  const reference = drawn.filter(isReference)
  const off = drawn.filter(n => !isReference(n))
  const norm = meanDepth(graph)
  const scale = fitScale(extent, fit)
  const clearance =
    (widest(reference, norm) + widest(off, norm) + GAP_PX) / scale
  const reach = clearance * (1 + FADE)
  const landing = clearance * (1 - 1e-6)
  const pushed: Positions = { ...positions }
  if (reference.length > 0 && off.length > 0 && clearance > 0) {
    const segments = reference.flatMap(node => {
      const line = positions[node.id]!
      return line.length === 1
        ? [{ a: line[0]!, b: line[0]! }]
        : line.slice(1).map((b, i) => ({ a: line[i]!, b }))
    })
    const nearest = referenceIndex(segments, clearance, reach)
    const push = (d: number) =>
      d <= clearance
        ? clearance
        : clearance * Math.max(0, 1 - (d - clearance) / (FADE * clearance))
    for (const node of off) {
      const line = positions[node.id]!
      const hits = line.map(nearest)
      let lean = 0
      hits.forEach((hit, i) => {
        lean += hit
          ? (line[i]!.x - hit.q.x) * hit.normal.x +
            (line[i]!.y - hit.q.y) * hit.normal.y
          : 0
      })
      const side = lean < 0 ? -1 : 1
      const moved = line.map((p, i) => {
        const hit = hits[i]
        return hit ? movedOut(p, hit, side, hit.d + push(hit.d), clearance) : p
      })
      const clear = (p: Point) => (nearest(p)?.d ?? reach) >= landing
      pushed[node.id] = moved.every(
        (p, i) =>
          clear(p) &&
          (i === 0 ||
            clear({
              x: (p.x + moved[i - 1]!.x) / 2,
              y: (p.y + moved[i - 1]!.y) / 2,
            })),
      )
        ? moved
        : line
    }
  }
  return pushed
}
