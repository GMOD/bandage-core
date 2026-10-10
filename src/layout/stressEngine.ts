import { isBackbone } from '../anchoredNodes'
import { stressPlacement } from './stressPlacement'

import type { EngineRequest } from '../pipeline'
import type { LayoutResult, NodeSegment } from '../types'

// A stress layout by stochastic gradient descent (Zheng, Pawar & Goodman
// 2019) in plain JS, taking the Bandage engine's request: each node is the
// chain of points FMMM would build, and the result is a polyline per node.
//
// Target distances come from random walks, after odgi's path-guided SGD:
// every point starts a few walks of log-uniform length each iteration, and
// how far a walk got is how far apart its ends should sit, so a repeat's loop
// draws as a ring of its own circumference. Reference points also target
// their signed reference separation along x, which holds the backbone
// straight and in order without pinning it. Stress has no repulsion, so a
// final pass pushes apart points that are close but not joined.
//
// An anchored graph starts from stressPlacement's drawing and enters the
// schedule part way, where the steps are small enough to keep its shape.

// walks per point and iterations by the quality the request names
const QUALITY = [
  { walks: 2, iterations: 15 },
  { walks: 4, iterations: 30 },
  { walks: 8, iterations: 60 },
  { walks: 12, iterations: 90 },
  { walks: 16, iterations: 120 },
]
const UNTANGLE_PASSES = 20
// the untangle radius, in link lengths
const UNTANGLE_LINKS = 3
const UNTANGLE_PUSH = 0.3
const SMOOTH_PASSES = 2
const MAX_HOPS = 200
// A walk on a component with a reference stops at this many links: the
// reference term holds its long range, so the long walks only cost time. On
// cuts of 1.3k-4k nodes this is 2.4-4x faster with the same drawing; without
// a reference, a 20-link cap balls a 3k-node graph up.
const REFERENCE_HOPS = 20
// the step size the schedule ends on, as a share of the smallest pair's
const EPS = 0.1
// the share of the schedule an anchored graph skips
const WARM = 0.5

export type Side = 0 | 1

function flipped(strand: string | undefined, name: string) {
  const own = name.at(-1)
  return (
    (strand === '+' || strand === '-') &&
    (own === '+' || own === '-') &&
    strand !== own
  )
}

function xorshift(seed: number) {
  let s = Math.imul(seed, 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

export interface Chains {
  ids: string[]
  // each chain's first point, point count and distance between points
  first: Int32Array
  count: Int32Array
  per: Float64Array
  // links out of each chain's start (0) and end (1), as the chain and side
  // they enter
  links: [number, Side][][][]
  // per point: its chain, index in it, seed and whether it is reference
  chainOf: Int32Array
  indexOf: Int32Array
  seedX: Float64Array
  seedY: Float64Array
  backbone: Uint8Array
  // adjacency in CSR form, with the distance each link asks for
  off: Int32Array
  nb: Int32Array
  wt: Float64Array
  n: number
  link: number
}

function num(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function chains(request: EngineRequest): Chains {
  const { nodes, edges } = request.graph
  const o = request.options
  const perMegabase = num(o.nodeLengthPerMegabase, 1000)
  const minimum = num(o.minimumNodeLength, 1)
  const segment = num(o.nodeSegmentLength, 1)
  const link = num(o.edgeLength, 1)
  const ids = nodes.map(n => n.id)
  const first = new Int32Array(nodes.length)
  const count = new Int32Array(nodes.length)
  const per = new Float64Array(nodes.length)
  let n = 0
  nodes.forEach((node, k) => {
    const drawn = Math.max((perMegabase * node.length) / 1_000_000, minimum)
    const steps = Math.max(1, Math.ceil(drawn / segment))
    first[k] = n
    count[k] = steps + 1
    per[k] = drawn / steps
    n += steps + 1
  })
  const chainOf = new Int32Array(n)
  const indexOf = new Int32Array(n)
  const seedX = new Float64Array(n).fill(NaN)
  const seedY = new Float64Array(n).fill(NaN)
  const backbone = new Uint8Array(n)
  const adjacent: [number, number][][] = Array.from({ length: n }, () => [])
  nodes.forEach((node, k) => {
    const seeded = typeof node.x === 'number' && typeof node.y === 'number'
    const reference = isBackbone(node) ? 1 : 0
    for (let i = 0; i < count[k]!; i++) {
      const v = first[k]! + i
      chainOf[v] = k
      indexOf[v] = i
      backbone[v] = reference
      if (seeded) {
        seedX[v] = node.x! + i * per[k]!
        seedY[v] = node.y!
      }
      if (i > 0) {
        adjacent[v - 1]!.push([v, per[k]!])
        adjacent[v]!.push([v - 1, per[k]!])
      }
    }
  })
  const index = new Map(ids.map((id, k) => [id, k]))
  const links: Chains['links'] = nodes.map(() => [[], []])
  for (const edge of edges) {
    const a = index.get(edge.from)
    const b = index.get(edge.to)
    if (a === undefined || b === undefined) {
      continue
    }
    // a self link on a chain of one step has nowhere to go, as in FMMM
    if (a === b && count[a]! <= 2) {
      continue
    }
    const fromSide: Side = flipped(edge.fromStrand, edge.from) ? 0 : 1
    const toSide: Side = flipped(edge.toStrand, edge.to) ? 1 : 0
    const u = first[a]! + (fromSide ? count[a]! - 1 : 0)
    const v = first[b]! + (toSide ? count[b]! - 1 : 0)
    adjacent[u]!.push([v, link])
    adjacent[v]!.push([u, link])
    links[a]![fromSide]!.push([b, toSide])
    links[b]![toSide]!.push([a, fromSide])
  }
  const off = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) {
    off[i + 1] = off[i]! + adjacent[i]!.length
  }
  const nb = new Int32Array(off[n]!)
  const wt = new Float64Array(off[n]!)
  for (let i = 0; i < n; i++) {
    adjacent[i]!.forEach(([v, w], k) => {
      nb[off[i]! + k] = v
      wt[off[i]! + k] = w
    })
  }
  return {
    ids,
    first,
    count,
    per,
    links,
    chainOf,
    indexOf,
    seedX,
    seedY,
    backbone,
    off,
    nb,
    wt,
    n,
    link,
  }
}

// each point's connected component, and the points of each component
function components(c: Chains) {
  const { n, off, nb } = c
  const comp = new Int32Array(n).fill(-1)
  const members: number[][] = []
  for (let s = 0; s < n; s++) {
    if (comp[s]! >= 0) {
      continue
    }
    const queue = [s]
    comp[s] = members.length
    for (const u of queue) {
      for (let e = off[u]!; e < off[u + 1]!; e++) {
        const v = nb[e]!
        if (comp[v]! < 0) {
          comp[v] = members.length
          queue.push(v)
        }
      }
    }
    members.push(queue)
  }
  return { comp, members }
}

export interface StressOptions {
  quality?: number
  seed?: number
  // gap between components, which stack top to bottom
  componentSeparation?: number
}

export function stressLayout(
  request: EngineRequest,
  opts: StressOptions = {},
): LayoutResult {
  const c = chains(request)
  const { n, off, nb, wt, seedX, seedY, backbone, first, count, per, link } = c
  const o = request.options
  const quality =
    QUALITY[Math.max(0, Math.min(4, num(opts.quality ?? o.quality, 2)))]!
  const gap = num(opts.componentSeparation ?? o.componentSeparation, 15)
  const rand = xorshift(num(opts.seed ?? o.seed, 1))
  const X = new Float64Array(n)
  const Y = new Float64Array(n)
  const nodePositions: Record<string, NodeSegment[]> = {}
  if (n === 0) {
    return { nodePositions }
  }
  const { comp, members } = components(c)

  let dmin = Infinity
  let total = 0
  for (let e = 0; e < nb.length; e++) {
    dmin = Math.min(dmin, wt[e]!)
    total += wt[e]!
  }
  total /= 2
  let anySeed = false
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(seedX[i])) {
      anySeed = true
      break
    }
  }
  const placed = anySeed ? stressPlacement(c) : undefined
  const side = Math.sqrt(n) * 20
  for (let i = 0; i < n; i++) {
    if (placed && !Number.isNaN(placed.X[i])) {
      X[i] = placed.X[i]!
      Y[i] = placed.Y[i]!
    } else if (anySeed && !Number.isNaN(seedX[i])) {
      X[i] = seedX[i]! + rand() - 0.5
      Y[i] = seedY[i]! + rand() - 0.5
    } else {
      X[i] = rand() * side
      Y[i] = rand() * side
    }
  }
  // each component's reference points by seed x, for the reference term
  const refIdx = members.map(points =>
    Int32Array.from(
      points
        .filter(i => backbone[i] && !Number.isNaN(seedX[i]))
        .sort((a, b) => seedX[a]! - seedX[b]!),
    ),
  )
  const refX = refIdx.map(idx => Float64Array.from(idx, i => seedX[i]!))
  let span = 0
  for (const xs of refX) {
    if (xs.length) {
      span = Math.max(span, xs[xs.length - 1]! - xs[0]!)
    }
  }
  const dmax = Math.max(span, total / 4, dmin * 10)
  const etaMax = dmax * dmax
  const etaMin = EPS * dmin * dmin
  const { walks, iterations } = quality
  const lambda = Math.log(etaMax / etaMin) / Math.max(1, iterations - 1)
  const logMin = Math.log(dmin)
  const logMax = Math.log(dmax)

  const move = (i: number, j: number, d: number, eta: number) => {
    let mu = eta / (d * d)
    if (mu > 1) {
      mu = 1
    }
    const dx = X[i]! - X[j]!
    const dy = Y[i]! - Y[j]!
    const mag = Math.sqrt(dx * dx + dy * dy) || 1e-9
    const r = (mu * (mag - d)) / (2 * mag)
    const rx = r * dx
    const ry = r * dy
    X[i] = X[i]! - rx
    Y[i] = Y[i]! - ry
    X[j] = X[j]! + rx
    Y[j] = Y[j]! + ry
  }
  // The end of a walk of up to `length` from point i, with how far it got in
  // `walked`: a walk stops short at a free chain end.
  let walked = 0
  const walk = (i: number, length: number) => {
    let chain = c.chainOf[i]!
    let idx = c.indexOf[i]!
    let dir = rand() < 0.5 ? -1 : 1
    let remaining = length
    const maxHops = refIdx[comp[i]!]!.length >= 2 ? REFERENCE_HOPS : MAX_HOPS
    for (let hops = 0; hops < maxHops; hops++) {
      const points = count[chain]!
      const step = per[chain]!
      const toEnd = (dir > 0 ? points - 1 - idx : idx) * step
      if (remaining <= toEnd) {
        const steps = Math.round(remaining / step)
        walked = length - remaining + steps * step
        return first[chain]! + idx + dir * steps
      }
      remaining -= toEnd
      const out = c.links[chain]![dir > 0 ? 1 : 0]!
      if (out.length === 0) {
        walked = length - remaining
        return first[chain]! + (dir > 0 ? points - 1 : 0)
      }
      const [next, enterSide] = out[Math.floor(rand() * out.length)]!
      remaining -= link
      chain = next
      dir = enterSide === 0 ? 1 : -1
      idx = enterSide === 0 ? 0 : count[next]! - 1
      if (remaining <= 0) {
        walked = length - remaining
        return first[chain]! + idx
      }
    }
    return -1
  }
  // A reference partner at a log-uniform reference distance either way, and
  // the term pulling the pair to its signed separation along x.
  const referenceTerm = (i: number, eta: number) => {
    const idx = refIdx[comp[i]!]!
    if (!backbone[i] || idx.length < 2 || Number.isNaN(seedX[i])) {
      return
    }
    const xs = refX[comp[i]!]!
    const target =
      seedX[i]! +
      Math.exp(logMin + rand() * (logMax - logMin)) * (rand() < 0.5 ? -1 : 1)
    let lo = 0
    let hi = xs.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (xs[mid]! < target) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    const j = idx[Math.min(lo, idx.length - 1)]!
    const d = seedX[j]! - seedX[i]!
    if (j === i || d === 0) {
      return
    }
    let mu = eta / (d * d)
    if (mu > 1) {
      mu = 1
    }
    const r = (mu * (X[j]! - X[i]! - d)) / 2
    X[i] = X[i]! + r
    X[j] = X[j]! - r
  }
  const adjacentTerms = (i: number, eta: number) => {
    for (let e = off[i]!; e < off[i + 1]!; e++) {
      const j = nb[e]!
      if (j > i) {
        move(i, j, wt[e]!, eta)
      }
    }
  }

  const order = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    order[i] = i
  }
  const warm = anySeed ? Math.floor(WARM * iterations) : 0
  for (let t = warm; t < iterations; t++) {
    const eta = etaMax * Math.exp(-lambda * t)
    for (let k = n - 1; k > 0; k--) {
      const r = Math.floor(rand() * (k + 1))
      const tmp = order[k]!
      order[k] = order[r]!
      order[r] = tmp
    }
    for (let q = 0; q < n; q++) {
      const i = order[q]!
      adjacentTerms(i, eta)
      for (let w = 0; w < walks; w++) {
        const length = Math.exp(logMin + rand() * (logMax - logMin))
        const j = walk(i, length)
        if (j >= 0 && j !== i && walked > 0) {
          move(i, j, walked, eta)
        }
      }
      referenceTerm(i, eta)
    }
  }

  // untangle: points closer than the radius and not joined push apart, then
  // a sweep over the links and the reference terms pulls each back towards
  // its length
  const radius = UNTANGLE_LINKS * link
  const key = (x: number, y: number) =>
    (Math.floor(x / radius) * 73856093) ^ (Math.floor(y / radius) * 19349663)
  for (let u = 0; u < UNTANGLE_PASSES; u++) {
    const grid = new Map<number, number[]>()
    for (let i = 0; i < n; i++) {
      const k = key(X[i]!, Y[i]!)
      const list = grid.get(k)
      if (list) {
        list.push(i)
      } else {
        grid.set(k, [i])
      }
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(X[i]! / radius)
      const cy = Math.floor(Y[i]! / radius)
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const list = grid.get((gx * 73856093) ^ (gy * 19349663))
          if (!list) {
            continue
          }
          for (const j of list) {
            if (j <= i) {
              continue
            }
            let joined = false
            for (let e = off[i]!; e < off[i + 1]!; e++) {
              if (nb[e] === j) {
                joined = true
                break
              }
            }
            if (joined) {
              continue
            }
            const dx = X[i]! - X[j]!
            const dy = Y[i]! - Y[j]!
            const mag = Math.sqrt(dx * dx + dy * dy)
            if (mag >= radius) {
              continue
            }
            let rx: number
            let ry: number
            if (mag > 1e-6) {
              const r = (UNTANGLE_PUSH * (radius - mag)) / (2 * mag)
              rx = r * dx
              ry = r * dy
            } else {
              rx = UNTANGLE_PUSH * radius * (rand() - 0.5)
              ry = UNTANGLE_PUSH * radius * (rand() - 0.5)
            }
            X[i] = X[i]! + rx
            Y[i] = Y[i]! + ry
            X[j] = X[j]! - rx
            Y[j] = Y[j]! - ry
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      adjacentTerms(i, Infinity)
      referenceTerm(i, etaMin * 4)
    }
  }

  // each chain's interior points smoothed, so a node reads as one curve, then
  // spaced evenly along it at its drawn length
  for (let k = 0; k < count.length; k++) {
    const a = first[k]!
    const m = count[k]!
    if (m < 3) {
      continue
    }
    for (let s = 0; s < SMOOTH_PASSES; s++) {
      const xs = X.slice(a, a + m)
      const ys = Y.slice(a, a + m)
      for (let i = 1; i + 1 < m; i++) {
        X[a + i] = 0.5 * xs[i]! + 0.25 * (xs[i - 1]! + xs[i + 1]!)
        Y[a + i] = 0.5 * ys[i]! + 0.25 * (ys[i - 1]! + ys[i + 1]!)
      }
    }
    respace(X, Y, a, m, per[k]!)
  }

  packComponents(comp, members, X, Y, anySeed, gap)

  for (let k = 0; k < c.ids.length; k++) {
    const points: NodeSegment[] = []
    for (let i = 0; i < count[k]!; i++) {
      points.push({ x: X[first[k]! + i]!, y: Y[first[k]! + i]! })
    }
    nodePositions[c.ids[k]!] = points
  }
  return { nodePositions }
}

// Points a to a+m-1 moved to equal spacing along their polyline. Smoothing
// shortens a curve, so the ends first extend along their tangents by half
// the loss each, and the points then take their full spacing.
function respace(
  X: Float64Array,
  Y: Float64Array,
  a: number,
  m: number,
  per: number,
) {
  const arc = new Float64Array(m)
  for (let i = 1; i < m; i++) {
    arc[i] =
      arc[i - 1]! +
      Math.hypot(X[a + i]! - X[a + i - 1]!, Y[a + i]! - Y[a + i - 1]!)
  }
  if (!arc[m - 1]) {
    return
  }
  const loss = per * (m - 1) - arc[m - 1]!
  if (loss > 0) {
    extend(X, Y, a, a + 1, loss / 2)
    extend(X, Y, a + m - 1, a + m - 2, loss / 2)
    for (let i = 1; i < m; i++) {
      arc[i] =
        arc[i - 1]! +
        Math.hypot(X[a + i]! - X[a + i - 1]!, Y[a + i]! - Y[a + i - 1]!)
    }
  }
  const total = arc[m - 1]!
  const xs = X.slice(a, a + m)
  const ys = Y.slice(a, a + m)
  let seg = 1
  for (let i = 1; i + 1 < m; i++) {
    const s = (total * i) / (m - 1)
    while (seg < m - 1 && arc[seg]! < s) {
      seg++
    }
    const span = arc[seg]! - arc[seg - 1]!
    const t = span > 0 ? (s - arc[seg - 1]!) / span : 0
    X[a + i] = xs[seg - 1]! + (xs[seg]! - xs[seg - 1]!) * t
    Y[a + i] = ys[seg - 1]! + (ys[seg]! - ys[seg - 1]!) * t
  }
}

// moves point `end` away from `next` by `by`
function extend(
  X: Float64Array,
  Y: Float64Array,
  end: number,
  next: number,
  by: number,
) {
  const dx = X[end]! - X[next]!
  const dy = Y[end]! - Y[next]!
  const mag = Math.hypot(dx, dy)
  if (mag > 0) {
    X[end] = X[end]! + (dx / mag) * by
    Y[end] = Y[end]! + (dy / mag) * by
  }
}

// Components stacked top to bottom, left aligned, `gap` apart. A component
// with no seeds is turned so its long axis runs along x; a seeded one keeps
// the frame its seeds stated.
function packComponents(
  comp: Int32Array,
  members: number[][],
  X: Float64Array,
  Y: Float64Array,
  anySeed: boolean,
  gap: number,
) {
  if (!anySeed) {
    for (const points of members) {
      rotateToPrincipalAxis(X, Y, points)
    }
  }
  if (members.length < 2) {
    return
  }
  const minX = new Float64Array(members.length).fill(Infinity)
  const minY = new Float64Array(members.length).fill(Infinity)
  const maxY = new Float64Array(members.length).fill(-Infinity)
  for (let i = 0; i < X.length; i++) {
    const k = comp[i]!
    minX[k] = Math.min(minX[k]!, X[i]!)
    minY[k] = Math.min(minY[k]!, Y[i]!)
    maxY[k] = Math.max(maxY[k]!, Y[i]!)
  }
  const shift = new Float64Array(members.length)
  let y = 0
  for (let k = 0; k < members.length; k++) {
    shift[k] = y - minY[k]!
    y += maxY[k]! - minY[k]! + gap
  }
  for (let i = 0; i < X.length; i++) {
    const k = comp[i]!
    X[i] = X[i]! - minX[k]!
    Y[i] = Y[i]! + shift[k]!
  }
}

function rotateToPrincipalAxis(
  X: Float64Array,
  Y: Float64Array,
  points: number[],
) {
  if (points.length < 3) {
    return
  }
  let cx = 0
  let cy = 0
  for (const i of points) {
    cx += X[i]!
    cy += Y[i]!
  }
  cx /= points.length
  cy /= points.length
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const i of points) {
    const dx = X[i]! - cx
    const dy = Y[i]! - cy
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  const angle = -0.5 * Math.atan2(2 * sxy, sxx - syy)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (const i of points) {
    const dx = X[i]! - cx
    const dy = Y[i]! - cy
    X[i] = cx + cos * dx - sin * dy
    Y[i] = cy + sin * dx + cos * dy
  }
}
