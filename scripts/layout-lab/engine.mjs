// The committed wasm engine, plus JS-side layout post-processing.
import { createRequire } from 'node:module'
import { bandageAutoScale, isBackbone } from './gfa.mjs'

const require = createRequire(import.meta.url)
const enginePath = new URL(
  '../../src/bandage/bandage-layout.js',
  import.meta.url,
).pathname
let engine
export async function loadEngine(path = enginePath) {
  const createModule = (await import(path)).default
  engine = await createModule()
  return engine
}

export function force(
  graph,
  {
    quality = 2,
    minNodeLength = 5,
    linearLayout = false,
    seed = 1,
    nodes,
  } = {},
) {
  const opts = bandageAutoScale(graph, minNodeLength)
  const t0 = performance.now()
  const { nodePositions } = engine.computeLayout(
    { nodes: nodes ?? graph.nodes, edges: graph.edges },
    { quality, linearLayout, seed, ...opts },
  )
  return { positions: nodePositions, ms: performance.now() - t0, opts }
}

// Orient a finished layout so the reference runs left to right: fit the best
// rotation+reflection mapping backbone node midpoints onto their reference
// coordinate order (orthogonal Procrustes against (refX, 0)), then apply it to
// every point. Purely a rigid transform, so the drawing FMMM made is unchanged.
export function orientToReference(graph, positions) {
  const bb = graph.nodes.filter(n => isBackbone(n) && positions[n.id])
  if (bb.length < 2) return positions
  const pts = bb.map(n => {
    const s = positions[n.id]
    const m = s[Math.floor(s.length / 2)]
    return { x: m.x, y: m.y, r: n.stable.start + n.length / 2, w: n.length }
  })
  const W = pts.reduce((s, p) => s + p.w, 0)
  const cx = pts.reduce((s, p) => s + p.x * p.w, 0) / W
  const cy = pts.reduce((s, p) => s + p.y * p.w, 0) / W
  const cr = pts.reduce((s, p) => s + p.r * p.w, 0) / W
  // cross-covariance of (x,y) against (r,0): only first row is non-zero
  let sxr = 0,
    syr = 0
  for (const p of pts) {
    sxr += p.w * (p.x - cx) * (p.r - cr)
    syr += p.w * (p.y - cy) * (p.r - cr)
  }
  // Rotation taking the direction (sxr, syr) onto +x.
  const ang = -Math.atan2(syr, sxr)
  const c = Math.cos(ang),
    s = Math.sin(ang)
  const out = {}
  for (const [id, segs] of Object.entries(positions)) {
    out[id] = segs.map(p => {
      const x = p.x - cx,
        y = p.y - cy
      return { x: c * x - s * y, y: s * x + c * y }
    })
  }
  // Reflect so that the bulk of off-reference mass is below the axis: purely
  // cosmetic, keeps a consistent look between windows.
  let below = 0,
    above = 0
  for (const n of graph.nodes) {
    if (isBackbone(n) || !out[n.id]) continue
    for (const p of out[n.id]) p.y > 0 ? below++ : above++
  }
  if (above > below) {
    for (const segs of Object.values(out)) for (const p of segs) p.y = -p.y
  }
  return out
}

// Bandage's linear layout seeds x by NODE NAME order. Rename nodes so numeric
// names encode reference order (backbone by offset, alleles at their anchor),
// run linearLayout, and map names back — a way to test reference-seeded FMMM
// with the committed engine and no C++ change.
export function forceSeededByReference(graph, opts = {}) {
  const order = referenceOrder(graph)
  const rename = new Map()
  order.forEach((id, i) => rename.set(id, `${i + 1}+`))
  const nodes = graph.nodes.map(n => ({
    ...n,
    id: rename.get(n.id),
    name: `${rename.get(n.id).slice(0, -1)}`,
  }))
  const edges = graph.edges.map(e => ({
    from: rename.get(e.from),
    to: rename.get(e.to),
  }))
  const r = force({ ...graph, nodes, edges }, { ...opts, linearLayout: true })
  const back = new Map([...rename].map(([a, b]) => [b, a]))
  const positions = {}
  for (const [id, segs] of Object.entries(r.positions))
    positions[back.get(id)] = segs
  return { ...r, positions }
}

// Reference order for every node: backbone by stable offset, an off-reference
// node at the offset of the nearest backbone node reachable from it (BFS), with
// nodes at the same anchor kept in BFS order.
export function referenceOrder(graph) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const adj = new Map()
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    if (!adj.has(e.to)) adj.set(e.to, [])
    adj.get(e.from).push(e.to)
    adj.get(e.to).push(e.from)
  }
  const key = new Map()
  const queue = []
  for (const n of graph.nodes) {
    if (isBackbone(n)) {
      key.set(n.id, n.stable.start)
      queue.push(n.id)
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]
    for (const nb of adj.get(id) ?? []) {
      if (!key.has(nb)) {
        key.set(nb, key.get(id) + 0.5)
        queue.push(nb)
      }
    }
  }
  for (const n of graph.nodes) if (!key.has(n.id)) key.set(n.id, Infinity)
  return graph.nodes
    .map(n => n.id)
    .sort(
      (a, b) =>
        key.get(a) - key.get(b) ||
        (byId.get(a).name < byId.get(b).name ? -1 : 1),
    )
}

export function bounds(positions) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const pts of Object.values(positions))
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}
