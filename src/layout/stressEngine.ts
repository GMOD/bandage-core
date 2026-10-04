import { isBackbone } from '../anchoredNodes'

import type { EngineRequest } from '../pipeline'
import type { LayoutResult, NodeSegment } from '../types'

// A stress layout by stochastic gradient descent (Zheng, Pawar & Goodman
// 2019), in plain JS, as an alternative to the Bandage engine. It takes the
// same request: each node becomes the chain of points FMMM would build, and
// the result is the same shape, a polyline per node.
//
// Target distances come from random walks rather than all-pairs shortest
// paths, after odgi's path-guided SGD: each iteration starts a few walks of
// log-uniform length from every point, and the walk's length is the distance
// its two ends should sit at. A walk round a repeat's loop measures the loop,
// so the loop draws as a ring of that circumference. Points on the reference
// backbone also take their reference separation as a target, which holds the
// reference straight without pinning it. Stress alone has no repulsion, so a
// final pass pushes apart points that are close but not joined.

export const LAYOUT_ENGINES = [
  {
    value: 'fmmm',
    label: 'Bandage (FMMM)',
    description:
      "Bandage's force-directed layout: OGDF's fast multipole multilevel method, compiled to wasm.",
  },
  {
    value: 'stress',
    label: 'Stress (experimental)',
    description:
      'Stress layout by stochastic gradient descent in plain JS: distances along the graph become distances on the page, so the reference reads straight and a repeat loop reads as a ring.',
  },
] as const

export type LayoutEngineKind = (typeof LAYOUT_ENGINES)[number]['value']

export const LAYOUT_ENGINE_VALUES = LAYOUT_ENGINES.map(e => e.value)

// walks per point and iterations by the quality the request names
const QUALITY = [
  { walks: 2, iterations: 15 },
  { walks: 4, iterations: 30 },
  { walks: 8, iterations: 60 },
  { walks: 12, iterations: 90 },
  { walks: 16, iterations: 120 },
]
const UNTANGLE_PASSES = 20
const UNTANGLE_RADIUS = 15
const UNTANGLE_PUSH = 0.3
const SMOOTH_PASSES = 2
const MAX_HOPS = 200
// the step size the schedule ends on, as a share of the smallest weight's
const EPS = 0.1

type Side = 0 | 1

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

interface Chains {
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
}

function num(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function chains(request: EngineRequest): Chains {
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
  }
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
  const { n, off, nb, wt, seedX, seedY, backbone, first, count, per } = c
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
  const side = Math.sqrt(n) * 20
  for (let i = 0; i < n; i++) {
    if (anySeed && !Number.isNaN(seedX[i])) {
      X[i] = seedX[i]! + rand() - 0.5
      Y[i] = seedY[i]! + rand() - 0.5
    } else {
      X[i] = rand() * side
      Y[i] = rand() * side
    }
  }
  // the reference points by seed x, for reference-distance targets
  const refIdx: number[] = []
  for (let i = 0; i < n; i++) {
    if (backbone[i] && !Number.isNaN(seedX[i])) {
      refIdx.push(i)
    }
  }
  refIdx.sort((a, b) => seedX[a]! - seedX[b]!)
  const refX = Float64Array.from(refIdx, i => seedX[i]!)
  const span = refIdx.length ? refX[refX.length - 1]! - refX[0]! : 0
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
  // the end of a walk of length `length` from point i, or -1
  const walk = (i: number, length: number) => {
    let chain = c.chainOf[i]!
    let idx = c.indexOf[i]!
    let dir = rand() < 0.5 ? -1 : 1
    let remaining = length
    for (let hops = 0; hops < MAX_HOPS; hops++) {
      const points = count[chain]!
      const step = per[chain]!
      const toEnd = (dir > 0 ? points - 1 - idx : idx) * step
      if (remaining <= toEnd) {
        return first[chain]! + idx + dir * Math.round(remaining / step)
      }
      remaining -= toEnd
      const out = c.links[chain]![dir > 0 ? 1 : 0]!
      if (out.length === 0) {
        return first[chain]! + (dir > 0 ? points - 1 : 0)
      }
      const [next, enterSide] = out[Math.floor(rand() * out.length)]!
      remaining -= num(o.edgeLength, 1)
      chain = next
      // entering at the start reads the chain forwards, at the end backwards
      dir = enterSide === 0 ? 1 : -1
      idx = enterSide === 0 ? 0 : count[next]! - 1
      if (remaining <= 0) {
        return first[chain]! + idx
      }
    }
    return -1
  }
  const refPartner = (i: number) => {
    const length =
      Math.exp(logMin + rand() * (logMax - logMin)) * (rand() < 0.5 ? -1 : 1)
    const target = seedX[i]! + length
    let lo = 0
    let hi = refX.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (refX[mid]! < target) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return refIdx[Math.min(lo, refIdx.length - 1)]!
  }
  const referenceTerm = (i: number, eta: number) => {
    if (!backbone[i] || refIdx.length < 2 || Number.isNaN(seedX[i])) {
      return
    }
    const j = refPartner(i)
    const d = Math.abs(seedX[i]! - seedX[j]!)
    if (j !== i && d > 0) {
      move(i, j, d, eta)
    }
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
  for (let t = 0; t < iterations; t++) {
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
        if (j >= 0 && j !== i) {
          move(i, j, length, eta)
        }
      }
      referenceTerm(i, eta)
    }
  }

  // untangle: points closer than the radius and not joined push apart, while
  // each link is put back at its length and the reference terms hold at the
  // final step size
  const cell = UNTANGLE_RADIUS
  const key = (x: number, y: number) =>
    (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663)
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
      const cx = Math.floor(X[i]! / cell)
      const cy = Math.floor(Y[i]! / cell)
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
            if (mag >= UNTANGLE_RADIUS) {
              continue
            }
            let rx: number
            let ry: number
            if (mag > 1e-6) {
              const r = (UNTANGLE_PUSH * (UNTANGLE_RADIUS - mag)) / (2 * mag)
              rx = r * dx
              ry = r * dy
            } else {
              rx = UNTANGLE_PUSH * UNTANGLE_RADIUS * (rand() - 0.5)
              ry = UNTANGLE_PUSH * UNTANGLE_RADIUS * (rand() - 0.5)
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
  // scaled about its centre back to its drawn length, which smoothing shortens
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
    let length = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < m; i++) {
      cx += X[a + i]!
      cy += Y[a + i]!
      if (i > 0) {
        length += Math.hypot(
          X[a + i]! - X[a + i - 1]!,
          Y[a + i]! - Y[a + i - 1]!,
        )
      }
    }
    cx /= m
    cy /= m
    const scale = length > 0 ? (per[k]! * (m - 1)) / length : 1
    for (let i = 0; i < m; i++) {
      X[a + i] = cx + (X[a + i]! - cx) * scale
      Y[a + i] = cy + (Y[a + i]! - cy) * scale
    }
  }

  packComponents(c, X, Y, anySeed, gap)

  for (let k = 0; k < c.ids.length; k++) {
    const points: NodeSegment[] = []
    for (let i = 0; i < count[k]!; i++) {
      points.push({ x: X[first[k]! + i]!, y: Y[first[k]! + i]! })
    }
    nodePositions[c.ids[k]!] = points
  }
  return { nodePositions }
}

// Components stacked top to bottom, left aligned, `gap` apart. A component
// with no seeds is turned so its long axis runs along x; a seeded one keeps
// the frame its seeds stated.
function packComponents(
  c: Chains,
  X: Float64Array,
  Y: Float64Array,
  anySeed: boolean,
  gap: number,
) {
  const { n, off, nb } = c
  const comp = new Int32Array(n).fill(-1)
  let components = 0
  for (let s = 0; s < n; s++) {
    if (comp[s]! >= 0) {
      continue
    }
    const queue = [s]
    comp[s] = components
    // for-of over an array that grows as it goes visits what is pushed
    for (const u of queue) {
      for (let e = off[u]!; e < off[u + 1]!; e++) {
        const v = nb[e]!
        if (comp[v]! < 0) {
          comp[v] = components
          queue.push(v)
        }
      }
    }
    components++
  }
  if (!anySeed) {
    for (let k = 0; k < components; k++) {
      rotateToPrincipalAxis(X, Y, comp, k)
    }
  }
  if (components < 2) {
    return
  }
  const minX = new Float64Array(components).fill(Infinity)
  const minY = new Float64Array(components).fill(Infinity)
  const maxY = new Float64Array(components).fill(-Infinity)
  for (let i = 0; i < n; i++) {
    const k = comp[i]!
    minX[k] = Math.min(minX[k]!, X[i]!)
    minY[k] = Math.min(minY[k]!, Y[i]!)
    maxY[k] = Math.max(maxY[k]!, Y[i]!)
  }
  const shift = new Float64Array(components)
  let y = 0
  for (let k = 0; k < components; k++) {
    shift[k] = y - minY[k]!
    y += maxY[k]! - minY[k]! + gap
  }
  for (let i = 0; i < n; i++) {
    const k = comp[i]!
    X[i] = X[i]! - minX[k]!
    Y[i] = Y[i]! + shift[k]!
  }
}

function rotateToPrincipalAxis(
  X: Float64Array,
  Y: Float64Array,
  comp: Int32Array,
  k: number,
) {
  let m = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < X.length; i++) {
    if (comp[i] === k) {
      cx += X[i]!
      cy += Y[i]!
      m++
    }
  }
  if (m < 3) {
    return
  }
  cx /= m
  cy /= m
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < X.length; i++) {
    if (comp[i] === k) {
      const dx = X[i]! - cx
      const dy = Y[i]! - cy
      sxx += dx * dx
      syy += dy * dy
      sxy += dx * dy
    }
  }
  const angle = -0.5 * Math.atan2(2 * sxy, sxx - syy)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (let i = 0; i < X.length; i++) {
    if (comp[i] === k) {
      const dx = X[i]! - cx
      const dy = Y[i]! - cy
      X[i] = cx + cos * dx - sin * dy
      Y[i] = cy + sin * dx + cos * dy
    }
  }
}
