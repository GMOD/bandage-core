import { ROUTE_ID } from './deletionRoutes'

import type { Chains, Side } from './stressEngine'

// Where the stress engine starts an anchored graph. The backbone lies straight
// along x at drawn length (its seeds). Every other node belongs to a piece: a
// connected set of unplaced nodes, anchored where its links meet chains already
// placed. A piece whose anchors sit on one placed curve is drawn in that
// curve's frame (arc length along it, depth out of it): two anchors give a
// spine along a circular arc of the piece's drawn length, a lens when it fits
// its gap and a teardrop when longer, pushed out (legs, then a dropped chord,
// then a tilt) until it clears what is drawn; a spine shorter than its gap is
// a straight bar under it; one anchor gives a straight tip. Anchors on
// different curves use the chord between them. What a spine leaves unplaced
// becomes pieces anchored on it, so nesting recurses. Deletion routes arch
// above the backbone. Components with no backbone stay NaN for the engine's
// random start.

const MIN_DEPTH = 12
const LANE_GAP = 15
const CLEAR = LANE_GAP * 0.7
const TIP_ANGLE = (25 * Math.PI) / 180
const ROUTE_BOW = 0.25
const ROUTE_CAP = 150
// a teardrop beside another leans away from it rather than dropping
const TEARDROP_TILTS = [0, -0.35, 0.35, -0.7, 0.7]
const SIDES: Side[] = [0, 1]

interface Point {
  x: number
  y: number
}

// a point in a frame's flat space: u along the frame, v out of it
interface UV {
  u: number
  v: number
}

interface Flat {
  at: (t: number) => UV
  apex: number
  length: number
}

interface Mapped {
  pts: Point[]
  refs: Point[]
}

interface Anchor {
  u: number
  uSide: Side
  v: number
  vSide: Side
  point: Point
  curve: Curve
  t: number
}

interface SpineStep {
  k: number
  enter: Side
}

interface Occupant extends Point {
  curve: Curve
}

function other(side: Side): Side {
  return side ? 0 : 1
}

function unit(a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const m = Math.hypot(dx, dy) || 1
  return { x: dx / m, y: dy / m }
}

function lerp(a: Point, b: Point, f: number): Point {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

function centroidOf(pts: Point[]): Point {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  return { x: x / pts.length, y: y / pts.length }
}

function arcLengths(pts: Point[]) {
  const arc = new Float64Array(pts.length)
  for (let i = 1; i < pts.length; i++) {
    arc[i] =
      arc[i - 1]! +
      Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
  }
  return arc
}

function polylineLength(pts: Point[]) {
  return arcLengths(pts)[pts.length - 1] ?? 0
}

// arc angle theta in (0, 2pi) with L/c = theta / (2 sin(theta/2))
function arcAngle(ratio: number) {
  let lo = 1e-6
  let hi = 2 * Math.PI - 1e-6
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (mid / (2 * Math.sin(mid / 2)) < ratio) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return (lo + hi) / 2
}

// arc length of the circular arc with chord c and sagitta s
function archLength(c: number, s: number) {
  if (c < 1e-9) {
    return Math.PI * s
  }
  const R = ((c * c) / 4 + s * s) / (2 * s)
  const theta = 2 * Math.asin(Math.min(1, c / (2 * R)))
  return R * (s > R ? 2 * Math.PI - theta : theta)
}

// from (0, drop) to (c, drop) in `length`: legs of h along v joined by a
// circular arc
function arcFlat(c: number, length: number, h: number, drop: number): Flat {
  const arc = length - 2 * h
  const theta = c < 1e-9 ? 2 * Math.PI : arcAngle(arc / c)
  const R = arc / theta
  const cos = Math.cos(theta / 2)
  const cu = c / 2
  const cv = drop + h - R * cos
  return {
    at: t => {
      if (t <= h) {
        return { u: 0, v: drop + t }
      }
      if (t >= length - h) {
        return { u: c, v: drop + length - t }
      }
      const a = (t - h) / R - theta / 2
      return { u: cu + R * Math.sin(a), v: cv + R * Math.cos(a) }
    },
    apex: drop + h + R * (1 - cos),
    length,
  }
}

// the flat curve rotated about its chord's midpoint
function tilted(flat: Flat, c: number, angle: number): Flat {
  if (!angle) {
    return flat
  }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    ...flat,
    at: t => {
      const { u, v } = flat.at(t)
      const du = u - c / 2
      return { u: c / 2 + du * cos - v * sin, v: du * sin + v * cos }
    },
  }
}

function lineFlat(
  u0: number,
  v0: number,
  du: number,
  dv: number,
  length: number,
): Flat {
  return {
    at: t => ({ u: u0 + du * t, v: v0 + dv * t }),
    apex: v0 + Math.max(0, dv) * length,
    length,
  }
}

// A placed curve: dense samples with cumulative arc length and outward normals.
class Curve {
  readonly arc: Float64Array
  readonly total: number

  constructor(
    readonly pts: Point[],
    readonly normals: Point[],
    readonly straight = false,
  ) {
    this.arc = arcLengths(pts)
    this.total = this.arc[pts.length - 1] ?? 0
  }

  private segment(t: number) {
    const { arc } = this
    let lo = 1
    let hi = arc.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arc[mid]! < t) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return lo
  }

  private fraction(i: number, t: number) {
    const span = this.arc[i]! - this.arc[i - 1]!
    return span > 0 ? (t - this.arc[i - 1]!) / span : 0
  }

  pointAt(t: number): Point {
    const { pts } = this
    const last = pts.length - 1
    if (last === 0) {
      return { ...pts[0]! }
    }
    if (t <= 0) {
      const d = unit(pts[0]!, pts[1]!)
      return { x: pts[0]!.x + d.x * t, y: pts[0]!.y + d.y * t }
    }
    if (t >= this.total) {
      const d = unit(pts[last - 1]!, pts[last]!)
      const r = t - this.total
      return { x: pts[last]!.x + d.x * r, y: pts[last]!.y + d.y * r }
    }
    const i = this.segment(t)
    return lerp(pts[i - 1]!, pts[i]!, this.fraction(i, t))
  }

  normalAt(t: number): Point {
    const { normals } = this
    if (normals.length === 1 || t <= 0) {
      return normals[0]!
    }
    if (t >= this.total) {
      return normals[normals.length - 1]!
    }
    const i = this.segment(t)
    const { x, y } = lerp(normals[i - 1]!, normals[i]!, this.fraction(i, t))
    const m = Math.hypot(x, y) || 1
    return { x: x / m, y: y / m }
  }
}

// A polyline's outward normals: the perpendicular pointing away from its
// centroid where the shape is fat enough to say, else the frame's own outward.
function outwardNormals(pts: Point[], outRef: Point[]): Point[] {
  const centroid = centroidOf(pts)
  return pts.map((p, i) => {
    const t = unit(
      pts[Math.max(0, i - 1)]!,
      pts[Math.min(pts.length - 1, i + 1)]!,
    )
    const n = { x: -t.y, y: t.x }
    const rx = p.x - centroid.x
    const ry = p.y - centroid.y
    const rm = Math.hypot(rx, ry)
    const dot = n.x * rx + n.y * ry
    const ref = outRef[i]!
    const sign =
      rm > 1e-9 && Math.abs(dot) > 0.3 * rm
        ? Math.sign(dot)
        : Math.sign(n.x * ref.x + n.y * ref.y) || 1
    return { x: n.x * sign, y: n.y * sign }
  })
}

// the flat curve carried into the frame from arc length tA, outward by sign
function mapFlat(frame: Curve, tA: number, sign: number, flat: Flat): Mapped {
  const ds = Math.min(5, Math.max(flat.length / 24, 0.5))
  const pts: Point[] = []
  const refs: Point[] = []
  for (let t = 0; t <= flat.length + 1e-9; t += ds) {
    const { u, v } = flat.at(Math.min(t, flat.length))
    const q = frame.pointAt(tA + u)
    const nr = frame.normalAt(tA + u)
    const ox = nr.x * sign
    const oy = nr.y * sign
    pts.push({ x: q.x + ox * v, y: q.y + oy * v })
    refs.push({ x: ox, y: oy })
  }
  return { pts, refs }
}

// the flat curve whose image in a curved frame has the asked length
function fitted(
  frame: Curve,
  tA: number,
  sign: number,
  make: (length: number) => Flat,
  length: number,
): Mapped {
  let flatLength = length
  let mapped = mapFlat(frame, tA, sign, make(flatLength))
  if (frame.straight) {
    return mapped
  }
  for (let i = 0; i < 2; i++) {
    const got = polylineLength(mapped.pts)
    if (!(got > 0)) {
      break
    }
    flatLength *= length / got
    mapped = mapFlat(frame, tA, sign, make(flatLength))
  }
  return mapped
}

function depths(from: number, n: number) {
  return Array.from({ length: n }, (_, i) => from + (i * LANE_GAP) / 2)
}

function spanOf(anchors: Anchor[]) {
  if (anchors.length === 0) {
    return Infinity
  }
  let lo = Infinity
  let hi = -Infinity
  for (const a of anchors) {
    lo = Math.min(lo, a.point.x)
    hi = Math.max(hi, a.point.x)
  }
  return hi - lo
}

function cellKey(gx: number, gy: number) {
  return (gx * 73856093) ^ (gy * 19349663)
}

class Placer {
  private readonly points: (Point[] | undefined)[]
  // each placed point's arc length along its curve
  private readonly params: (number[] | undefined)[]
  private readonly curves: (Curve | undefined)[]
  private readonly links: [number, Side][][][]
  private readonly route: boolean[]
  private readonly grid = new Map<number, Occupant[]>()
  readonly backbone: Curve
  private readonly backboneCentroid: Point

  constructor(private readonly c: Chains) {
    const { ids, first, count, per, seedX, seedY, backbone } = c
    const N = ids.length
    this.points = Array.from({ length: N }, () => undefined)
    this.params = Array.from({ length: N }, () => undefined)
    this.curves = Array.from({ length: N }, () => undefined)
    this.links = c.links.map((sides, k) =>
      sides.map(out => out.filter(([v]) => v !== k)),
    )
    this.route = ids.map(id => id.startsWith(ROUTE_ID))
    let min = Infinity
    let max = -Infinity
    for (let k = 0; k < N; k++) {
      const start = first[k]!
      if (!backbone[start] || Number.isNaN(seedX[start])) {
        continue
      }
      min = Math.min(min, seedX[start]!)
      max = Math.max(max, seedX[start]! + per[k]! * (count[k]! - 1))
    }
    this.backbone = new Curve(
      [
        { x: min, y: 0 },
        { x: max, y: 0 },
      ],
      [
        { x: 0, y: 1 },
        { x: 0, y: 1 },
      ],
      true,
    )
    this.backboneCentroid = { x: (min + max) / 2, y: 0 }
    for (let k = 0; k < N; k++) {
      const start = first[k]!
      if (!backbone[start] || Number.isNaN(seedX[start])) {
        continue
      }
      const pts: Point[] = []
      const ts: number[] = []
      for (let i = 0; i < count[k]!; i++) {
        const x = seedX[start]! + i * per[k]!
        pts.push({ x, y: seedY[start]! })
        ts.push(x - min)
      }
      this.points[k] = pts
      this.params[k] = ts
      this.curves[k] = this.backbone
      this.occupy(pts, this.backbone)
    }
  }

  static hasBackbone(c: Chains) {
    for (let k = 0; k < c.ids.length; k++) {
      const start = c.first[k]!
      if (c.backbone[start] && !Number.isNaN(c.seedX[start])) {
        return true
      }
    }
    return false
  }

  run() {
    const free: number[] = []
    for (let k = 0; k < this.points.length; k++) {
      if (!this.points[k]) {
        free.push(k)
      }
    }
    const pieces = this.componentsOf(free)
      .map(members => ({ members, anchors: this.anchorsOf(members) }))
      .filter(p => p.anchors.length)
      .map(p => ({
        members: p.members,
        span: spanOf(p.anchors),
        drawn: p.members.reduce((s, k) => s + this.drawn(k), 0),
      }))
      .sort((a, b) => a.span - b.span || a.drawn - b.drawn)
    for (const p of pieces) {
      this.placePiece(p.members, this.backboneCentroid)
    }
  }

  write(X: Float64Array, Y: Float64Array) {
    const { first } = this.c
    this.points.forEach((pts, k) => {
      pts?.forEach((p, i) => {
        X[first[k]! + i] = p.x
        Y[first[k]! + i] = p.y
      })
    })
  }

  private drawn(k: number) {
    return this.c.per[k]! * (this.c.count[k]! - 1)
  }

  private endIndex(k: number, side: Side) {
    return side ? this.c.count[k]! - 1 : 0
  }

  private occupy(pts: Point[], curve: Curve) {
    for (const p of pts) {
      const key = cellKey(Math.floor(p.x / CLEAR), Math.floor(p.y / CLEAR))
      const list = this.grid.get(key)
      const occupant = { x: p.x, y: p.y, curve }
      if (list) {
        list.push(occupant)
      } else {
        this.grid.set(key, [occupant])
      }
    }
  }

  // placed points within CLEAR of the candidate, off the exempt curve and away
  // from the anchors, up to `limit`
  private violations(
    pts: Point[],
    exempt: Curve | undefined,
    anchorPts: Point[],
    limit: number,
  ) {
    let n = 0
    for (const p of pts) {
      if (
        anchorPts.some(a => Math.hypot(p.x - a.x, p.y - a.y) < 2 * LANE_GAP)
      ) {
        continue
      }
      const cx = Math.floor(p.x / CLEAR)
      const cy = Math.floor(p.y / CLEAR)
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const q of this.grid.get(cellKey(gx, gy)) ?? []) {
            if (
              q.curve !== exempt &&
              Math.hypot(p.x - q.x, p.y - q.y) < CLEAR
            ) {
              n++
              if (n >= limit) {
                return n
              }
            }
          }
        }
      }
    }
    return n
  }

  // the first candidate that clears what is drawn, else the least crowded
  private choose(
    candidates: (() => Mapped)[],
    exempt: Curve | undefined,
    anchorPts: Point[],
  ) {
    let best: Mapped | undefined
    let bestV = Infinity
    for (const candidate of candidates) {
      const m = candidate()
      const v = this.violations(m.pts, exempt, anchorPts, bestV)
      if (v === 0) {
        return m
      }
      if (v < bestV) {
        bestV = v
        best = m
      }
    }
    return best!
  }

  private anchorsOf(members: number[]): Anchor[] {
    const set = new Set(members)
    const out: Anchor[] = []
    for (const u of members) {
      for (const uSide of SIDES) {
        for (const [v, vSide] of this.links[u]![uSide]!) {
          const pts = this.points[v]
          if (set.has(v) || !pts) {
            continue
          }
          const i = this.endIndex(v, vSide)
          out.push({
            u,
            uSide,
            v,
            vSide,
            point: pts[i]!,
            curve: this.curves[v]!,
            t: this.params[v]![i]!,
          })
        }
      }
    }
    return out
  }

  private componentsOf(members: number[]) {
    const set = new Set(members)
    const seen = new Set<number>()
    const comps: number[][] = []
    for (const s of members) {
      if (seen.has(s)) {
        continue
      }
      const queue = [s]
      seen.add(s)
      for (const u of queue) {
        for (const side of SIDES) {
          for (const [v] of this.links[u]![side]!) {
            if (set.has(v) && !seen.has(v)) {
              seen.add(v)
              queue.push(v)
            }
          }
        }
      }
      comps.push(queue)
    }
    return comps
  }

  // side-consistent BFS over (node, entered side) within the piece; without a
  // target, the path to the farthest state
  private spinePath(
    members: number[],
    from: number,
    fromSide: Side,
    to?: number,
    toExitSide?: Side,
  ): SpineStep[] | undefined {
    const set = new Set(members)
    const key = (k: number, s: Side) => k * 2 + s
    const reached = (k: number, s: Side) => k === to && other(s) === toExitSide
    const prev = new Map<number, number>([[key(from, fromSide), -1]])
    const queue: [number, Side][] = [[from, fromSide]]
    let far: [number, Side] = [from, fromSide]
    for (const [k, s] of queue) {
      far = [k, s]
      if (to !== undefined && reached(k, s)) {
        break
      }
      for (const [v, t] of this.links[k]![other(s)]!) {
        if (!set.has(v) || prev.has(key(v, t))) {
          continue
        }
        prev.set(key(v, t), key(k, s))
        queue.push([v, t])
      }
    }
    if (to !== undefined && !reached(far[0], far[1])) {
      return undefined
    }
    const path: SpineStep[] = []
    for (let cur = key(far[0], far[1]); cur !== -1; cur = prev.get(cur)!) {
      path.push({ k: cur >> 1, enter: (cur & 1) as Side })
    }
    return path.reverse()
  }

  private loosePath(members: number[], from: number, to: number) {
    const set = new Set(members)
    const prev = new Map<number, number>([[from, -1]])
    const side = new Map<number, Side>([[from, 0]])
    const queue = [from]
    for (const k of queue) {
      if (k === to) {
        break
      }
      for (const s of SIDES) {
        for (const [v, t] of this.links[k]![s]!) {
          if (!set.has(v) || prev.has(v)) {
            continue
          }
          prev.set(v, k)
          side.set(v, t)
          queue.push(v)
        }
      }
    }
    const path: SpineStep[] = []
    for (let cur = to; cur !== -1; cur = prev.get(cur)!) {
      path.push({ k: cur, enter: side.get(cur)! })
    }
    return path.reverse()
  }

  private spineLength(spine: SpineStep[]) {
    const { link } = this.c
    return spine.reduce((s, { k }) => s + this.drawn(k) + link, link)
  }

  // the spine's chains along the curve from arc length t0, at their own
  // spacing unless one is given
  private layAlong(
    spine: SpineStep[],
    curve: Curve,
    t0: number,
    spacing?: number,
  ) {
    const { count, per, link } = this.c
    let t = t0
    const all: Point[] = []
    for (const { k, enter } of spine) {
      const step = spacing ?? per[k]!
      const pts: Point[] = []
      const ts: number[] = []
      for (let i = 0; i < count[k]!; i++) {
        pts.push(curve.pointAt(t + i * step))
        ts.push(t + i * step)
      }
      if (enter === 1) {
        pts.reverse()
        ts.reverse()
      }
      this.points[k] = pts
      this.params[k] = ts
      this.curves[k] = curve
      all.push(...pts)
      t += step * (count[k]! - 1) + link
    }
    return all
  }

  private arcCandidates(
    frame: Curve,
    tA: number,
    sign: number,
    c: number,
    L: number,
  ) {
    const hMax = (L - c) / 2 - 1e-6
    const tilts = L > 2 * c ? TEARDROP_TILTS : [0]
    const candidates: (() => Mapped)[] = []
    for (const drop of depths(0, 8)) {
      for (const tilt of tilts) {
        for (let i = 0; i <= 16; i++) {
          const h = (hMax * i) / 16
          if (i < 16 && arcFlat(c, L, h, drop).apex < MIN_DEPTH) {
            continue
          }
          candidates.push(() =>
            fitted(
              frame,
              tA,
              sign,
              length =>
                tilted(
                  arcFlat(
                    c,
                    length,
                    Math.min(h, (length - c) / 2 - 1e-6),
                    drop,
                  ),
                  c,
                  tilt,
                ),
              L,
            ),
          )
        }
      }
    }
    return candidates
  }

  private placePiece(members: number[], parent: Point) {
    const { count, link } = this.c
    const anchors = this.anchorsOf(members)
    if (anchors.length === 0) {
      return
    }
    const route = members.every(k => this.route[k])
    const shared = anchors.every(a => a.curve === anchors[0]!.curve)
      ? anchors[0]!.curve
      : undefined
    let frame: Curve
    let tA: number
    let tB: number
    let sign: number
    if (shared) {
      anchors.sort((a, b) => a.t - b.t)
      frame = shared
      tA = anchors[0]!.t
      tB = anchors[anchors.length - 1]!.t
      sign = frame === this.backbone && route ? -1 : 1
    } else {
      anchors.sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y)
      const a = anchors[0]!.point
      const b = anchors[anchors.length - 1]!.point
      const chord = Math.hypot(b.x - a.x, b.y - a.y)
      const u = chord > 1e-9 ? unit(a, b) : { x: 1, y: 0 }
      const n = { x: -u.y, y: u.x }
      const mid = lerp(a, b, 0.5)
      sign = anchors.some(x => x.curve === this.backbone)
        ? (route ? -1 : 1) * (Math.sign(n.y) || 1)
        : (mid.x - parent.x) * n.x + (mid.y - parent.y) * n.y >= 0
          ? 1
          : -1
      frame = new Curve([a, b], [n, n], true)
      tA = 0
      tB = chord
    }
    const A = anchors[0]!
    const B = anchors[anchors.length - 1]!
    const c = tB - tA
    const single =
      anchors.length === 1 || (A.u === B.u && A.uSide === B.uSide && c < 1e-9)
    const anchorPts = [A.point, B.point]
    const pick = (candidates: (() => Mapped)[]) =>
      this.choose(candidates, shared, anchorPts)
    let spine: SpineStep[]
    let mapped: Mapped
    let start = link
    let spacing: number | undefined
    if (single) {
      spine = this.spinePath(members, A.u, A.uSide)!
      const L = this.spineLength(spine)
      const next = A.vSide
        ? Math.max(0, count[A.v]! - 2)
        : Math.min(1, count[A.v]! - 1)
      const dirU = A.t >= this.params[A.v]![next]! ? 1 : -1
      const du = dirU * Math.cos(TIP_ANGLE)
      const dv = Math.sin(TIP_ANGLE)
      mapped = pick(
        depths(0, 12).map(
          drop => () =>
            fitted(
              frame,
              tA,
              sign,
              length => lineFlat(0, drop, du, dv, length),
              L,
            ),
        ),
      )
    } else {
      spine =
        this.spinePath(members, A.u, A.uSide, B.u, B.uSide) ??
        this.loosePath(members, A.u, B.u)
      const L = this.spineLength(spine)
      if (route) {
        const d0 = Math.max(MIN_DEPTH, Math.min(ROUTE_BOW * c, ROUTE_CAP))
        mapped = pick(
          depths(d0, 12).map(
            d => () =>
              mapFlat(frame, tA, sign, arcFlat(c, archLength(c, d), 0, 0)),
          ),
        )
        const total = polylineLength(mapped.pts)
        spacing = Math.max(1e-3, (total - 2 * link) / (count[spine[0]!.k]! - 1))
      } else if (L > c + 1e-6) {
        mapped = pick(this.arcCandidates(frame, tA, sign, c, L))
      } else {
        const bar = L - 2 * link
        mapped = pick(
          depths(MIN_DEPTH, 12).map(
            d => () =>
              fitted(
                frame,
                tA,
                sign,
                length => lineFlat(c / 2 - length / 2, d, 1, 0, length),
                bar,
              ),
          ),
        )
        start = 0
      }
    }
    const curve = new Curve(mapped.pts, outwardNormals(mapped.pts, mapped.refs))
    const placed = this.layAlong(spine, curve, start, spacing)
    this.occupy(placed, curve)
    const centroid = centroidOf(placed)
    const rest = members.filter(k => !this.points[k])
    const subs = this.componentsOf(rest)
      .map(m => ({ members: m, span: spanOf(this.anchorsOf(m)) }))
      .sort((a, b) => a.span - b.span)
    for (const sub of subs) {
      this.placePiece(sub.members, centroid)
    }
  }
}

// Initial positions per point, NaN where the placement reached nothing.
export function stressPlacement(c: Chains) {
  const X = new Float64Array(c.n).fill(NaN)
  const Y = new Float64Array(c.n).fill(NaN)
  if (Placer.hasBackbone(c)) {
    const placer = new Placer(c)
    placer.run()
    placer.write(X, Y)
  }
  return { X, Y }
}
