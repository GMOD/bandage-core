import type { NodeSegment } from '../types'

// A force engine places a long node as a chain of a few points, which joined
// straight read as a polygon: a 7-point loop on the HPRC chr3 cohort figure
// turned 114° at one corner. A segment gets a point along a curve through the
// placed ones per STEP_TURN of the sharper bend at its ends; the spline packs
// its bend near the placed points, so a 90° corner still leaves ~17° there.
const STEP_TURN = Math.PI / 24

function turnAt(line: NodeSegment[], i: number) {
  const a = line[i - 1]
  const b = line[i]!
  const c = line[i + 1]
  if (!a || !c) {
    return 0
  }
  const t = Math.abs(
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x),
  )
  return t > Math.PI ? 2 * Math.PI - t : t
}

// The point `u` of the way from p1 to p2 on the centripetal Catmull-Rom
// spline through p0..p3, which neither cusps nor loops on uneven spacing
function centripetal(
  p0: NodeSegment,
  p1: NodeSegment,
  p2: NodeSegment,
  p3: NodeSegment,
  u: number,
): NodeSegment {
  const knot = (a: NodeSegment, b: NodeSegment) =>
    Math.max(Math.hypot(b.x - a.x, b.y - a.y) ** 0.5, 1e-9)
  const t1 = knot(p0, p1)
  const t2 = t1 + knot(p1, p2)
  const t3 = t2 + knot(p2, p3)
  const t = t1 + u * (t2 - t1)
  const lerp = (
    a: NodeSegment,
    b: NodeSegment,
    ta: number,
    tb: number,
  ): NodeSegment => {
    const f = (t - ta) / (tb - ta)
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }
  const a1 = lerp(p0, p1, 0, t1)
  const a2 = lerp(p1, p2, t1, t2)
  const a3 = lerp(p2, p3, t2, t3)
  return lerp(lerp(a1, a2, 0, t2), lerp(a2, a3, t1, t3), t1, t2)
}

const reflect = (p: NodeSegment, about: NodeSegment) => ({
  x: 2 * about.x - p.x,
  y: 2 * about.y - p.y,
})

// `line` through the same points, each bending segment subdivided along the
// spline, so a node reads as one curve. Straight stretches keep their points.
export function smoothChain(line: NodeSegment[]): NodeSegment[] {
  if (line.length < 3) {
    return line
  }
  const out = [line[0]!]
  for (let i = 0; i + 1 < line.length; i++) {
    const p1 = line[i]!
    const p2 = line[i + 1]!
    const steps = Math.ceil(
      Math.max(turnAt(line, i), turnAt(line, i + 1)) / STEP_TURN,
    )
    const p0 = line[i - 1] ?? reflect(p2, p1)
    const p3 = line[i + 2] ?? reflect(p1, p2)
    for (let s = 1; s < steps; s++) {
      out.push(centripetal(p0, p1, p2, p3, s / steps))
    }
    out.push(p2)
  }
  return out
}
