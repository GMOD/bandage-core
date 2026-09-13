// Bubble decomposition from the graph alone, off the layered order: a backbone
// node whose layer holds nothing else and that no edge jumps over is a bubble
// boundary; what lies between two consecutive boundaries is a bubble. Shortest
// and longest route and the route count come from a DP over the layered DAG.
// Needs a reference path, not an index, so it works on a GBZ cut and on the
// inside of a popped superbubble alike.
//
//   node graphBubbles.mjs <gfa> <refPathPrefix|-> <out.svg> [window start-end] [title]
import { readGfa, cutWindow, isBackbone } from './gfa.mjs'
import { orderedLayout } from './ordered.mjs'
import { renderVariantMap, classify } from './bubbles.mjs'

const SATURATE = 2147483647

export function decompose(graph) {
  const { layers, layerOf } = orderedLayout(graph)
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const spanned = new Uint8Array(layers.length)
  const directed = []
  for (const e of graph.edges) {
    const a = layerOf.get(e.from),
      b = layerOf.get(e.to)
    if (a === undefined || b === undefined || a === b) continue
    const [lo, hi] = a < b ? [a, b] : [b, a]
    for (let l = lo + 1; l < hi; l++) spanned[l] = 1
    directed.push(a < b ? [e.from, e.to] : [e.to, e.from])
  }
  // boundaries as nodes: the unspanned lone backbone layers, plus the window's
  // first and last backbone nodes whatever their layers hold, since an array
  // whose copies reach the last backbone node leaves no unspanned layer after it
  const bb = graph.nodes
    .filter(isBackbone)
    .sort((a, b) => a.stable.start - b.stable.start)
  const boundaryIds = new Map()
  layers.forEach((ids, l) => {
    if (ids.length === 1 && isBackbone(byId.get(ids[0])) && !spanned[l])
      boundaryIds.set(ids[0], l)
  })
  for (const n of [bb[0], bb.at(-1)])
    if (n) boundaryIds.set(n.id, layerOf.get(n.id))
  const boundaries = [...boundaryIds.entries()].sort(
    (a, b) =>
      a[1] - b[1] || byId.get(a[0]).stable.start - byId.get(b[0]).stable.start,
  )
  const succ = new Map()
  for (const [a, b] of directed) (succ.get(a) ?? succ.set(a, []).get(a)).push(b)
  const bubbles = []
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const [startId, l0] = boundaries[i],
      [endId, l1] = boundaries[i + 1]
    const start = byId.get(startId),
      end = byId.get(endId)
    const interior = []
    for (let l = l0; l <= l1; l++)
      for (const id of layers[l])
        if (id !== startId && id !== endId) interior.push(id)
    if (interior.length === 0) continue
    // DP in layer order from start to end: shortest, longest, count of routes
    const best = new Map([[start.id, { min: 0, max: 0, n: 1 }]])
    const order = [start.id, ...interior, end.id]
    for (const id of order) {
      const cur = best.get(id)
      if (!cur) continue
      for (const t of succ.get(id) ?? []) {
        const tl = layerOf.get(t)
        if (tl > l1 || (tl <= l0 && t !== end.id)) continue
        const add = t === end.id ? 0 : byId.get(t).length
        const prev = best.get(t)
        const next = {
          min: cur.min + add,
          max: cur.max + add,
          n: Math.min(SATURATE, cur.n + (prev?.n ?? 0)),
        }
        if (prev) {
          next.min = Math.min(prev.min, next.min)
          next.max = Math.max(prev.max, next.max)
        }
        best.set(t, next)
      }
    }
    let at = best.get(end.id) ?? { min: 0, max: 0, n: 0 }
    // With walks, the routes are the walks: exact, and immune to a repeat
    // array whose copies the layer order cannot direct.
    const walked = walkRoutes(graph, start.id, end.id)
    if (walked) at = walked
    const refStart = start.stable.start + start.length
    const refEnd = end.stable.start
    // the reference route exists in the cut only if every backbone pair inside
    // is linked; a flank the hop reached from an allele is not
    const inside = interior.filter(id => isBackbone(byId.get(id)))
    const chain = [start.id, ...inside, end.id]
    const linked = new Set(
      graph.edges.flatMap(e => [`${e.from}>${e.to}`, `${e.to}>${e.from}`]),
    )
    const partial = chain.some(
      (id, k) => k > 0 && !linked.has(`${chain[k - 1]}>${id}`),
    )
    const inversion = interior.some(id => byId.get(id).stable?.strand === '-')
    bubbles.push({
      start: refStart,
      end: refEnd,
      refSpan: refEnd - refStart,
      segments: interior.length + 2,
      paths: at.n,
      inversion,
      partial,
      shortest: partial && !walked ? refEnd - refStart : at.min,
      longest: partial && !walked ? refEnd - refStart : at.max,
      ids: [start.name, ...interior.map(id => byId.get(id).name), end.name],
    })
  }
  return { bubbles, boundaries: boundaries.length, layers: layers.length }
}

// Route statistics from the walks: for every walk that passes both boundary
// nodes, the bp between them and the step sequence, so routes are counted as
// distinct sequences and lengths are the true haplotype lengths.
function walkRoutes(graph, startId, endId) {
  if (!graph.paths?.length) return undefined
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const seen = new Set()
  let min = Infinity,
    max = -Infinity
  for (const p of graph.paths) {
    const i0 = p.nodeIds.indexOf(startId),
      i1 = p.nodeIds.indexOf(endId)
    if (i0 < 0 || i1 < 0) continue
    const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0]
    const steps = p.nodeIds.slice(a + 1, b)
    const bp = steps.reduce((s, id) => s + (byId.get(id)?.length ?? 0), 0)
    seen.add(steps.join(','))
    min = Math.min(min, bp)
    max = Math.max(max, bp)
  }
  return seen.size ? { min, max, n: seen.size } : undefined
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, ref, out, win, title] = process.argv.slice(2)
  let g = readGfa(file, { referencePath: ref === '-' ? undefined : ref })
  let region
  if (win) {
    const [s, e] = win.split('-').map(Number)
    g = cutWindow(g, s, e)
    region = { start: s, end: e }
  }
  const t0 = performance.now()
  const { bubbles, boundaries, layers } = decompose(g)
  console.log(
    `${g.nodes.length} nodes, ${layers} layers, ${boundaries} boundaries, ${bubbles.length} bubbles in ${(performance.now() - t0).toFixed(0)} ms`,
  )
  for (const b of bubbles)
    console.log(
      `${b.start}-${b.end}\t${b.segments} segs\t${b.paths} routes\t${b.shortest}-${b.longest} bp\t${classify(b).label}${b.partial ? '\t(reaches outside the cut)' : ''}`,
    )
  if (!region) {
    const bb = g.nodes.filter(isBackbone)
    region = {
      start: Math.min(...bb.map(n => n.stable.start)),
      end: Math.max(...bb.map(n => n.stable.start + n.length)),
    }
  }
  renderVariantMap(bubbles, region, out, { title: title ?? '' })
}
