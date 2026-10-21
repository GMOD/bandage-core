import { isBackbone } from '../anchoredNodes'
import { ownStrand } from '../util/geometry'

import type { Graph, NodeSegment } from '../types'

type Positions = Record<string, NodeSegment[]>

// Turn a finished force layout so the reference runs left to right: the
// rotation that best maps the backbone's drawn points onto their reference
// coordinate (a one-dimensional orthogonal Procrustes fit, each segment
// weighted by its length), then a reflection so the off-reference mass sits
// below the axis. A rigid transform, so the drawing FMMM made is unchanged;
// only its frame moves.
//
// Every point of a segment's line counts, at its share of the segment's span.
// One midpoint per segment left a long segment no say in the angle, which the
// stubs past a window's edges then set: a window folded to one 60 kb segment
// drew it on a slant.
//
// About the length-weighted centroid, and translated back, so a drawing that is
// already oriented comes back where it was rather than recentred on the origin.
export function orientToReference(graph: Graph, positions: Positions) {
  const backbone = graph.nodes
    .filter(isBackbone)
    .filter(node => (positions[node.id]?.length ?? 0) > 0)
  const points = backbone.flatMap(node => {
    const segments = positions[node.id]!
    const last = segments.length - 1
    const forwards = ownStrand(node.id) === (node.stable.strand ?? '+')
    return segments.map((p, i) => {
      const along = last === 0 ? 0.5 : i / last
      return {
        x: p.x,
        y: p.y,
        r: node.stable.start + node.length * (forwards ? along : 1 - along),
        w: node.length / segments.length,
      }
    })
  })
  const weight = points.reduce((sum, p) => sum + p.w, 0)
  if (weight === 0) {
    return positions
  }
  const cx = points.reduce((sum, p) => sum + p.x * p.w, 0) / weight
  const cy = points.reduce((sum, p) => sum + p.y * p.w, 0) / weight
  const cr = points.reduce((sum, p) => sum + p.r * p.w, 0) / weight
  // cross-covariance of (x, y) against (r, 0); only the first row is non-zero
  let sxr = 0
  let syr = 0
  for (const p of points) {
    sxr += p.w * (p.x - cx) * (p.r - cr)
    syr += p.w * (p.y - cy) * (p.r - cr)
  }
  if (sxr === 0 && syr === 0) {
    return positions
  }
  // the rotation taking the direction (sxr, syr) onto +x
  const angle = -Math.atan2(syr, sxr)
  const c = Math.cos(angle)
  const s = Math.sin(angle)

  const out: Positions = {}
  for (const [id, segments] of Object.entries(positions)) {
    out[id] = segments.map(p => {
      const x = p.x - cx
      const y = p.y - cy
      return { x: cx + c * x - s * y, y: cy + s * x + c * y }
    })
  }

  let below = 0
  let above = 0
  for (const node of graph.nodes) {
    if (isBackbone(node)) {
      continue
    }
    for (const p of out[node.id] ?? []) {
      if (p.y > cy) {
        below++
      } else {
        above++
      }
    }
  }
  if (above > below) {
    for (const segments of Object.values(out)) {
      for (const p of segments) {
        p.y = 2 * cy - p.y
      }
    }
  }
  return out
}
