// Reference-pinned layered layout: a tube-map-style ordering that needs no
// paths. Backbone nodes take increasing layers in reference order, every other
// node the longest-path layer between the anchors it hangs off, node widths
// compressed (log bp), y by a barycenter sweep with the backbone pinned at 0.
import { isBackbone } from './gfa.mjs'
import { referenceOrder } from './engine.mjs'

export function orderedLayout(
  graph,
  {
    nodeWidth = n => 10 + 8 * Math.log2(1 + n.length),
    gutter = 12,
    laneGap = 14,
    pinBackbone = true,
  } = {},
) {
  const t0 = performance.now()
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const order = referenceOrder(graph)
  const key = new Map(order.map((id, i) => [id, i]))
  // direct every edge from lower reference key to higher: acyclic by construction
  const preds = new Map(graph.nodes.map(n => [n.id, []]))
  const succs = new Map(graph.nodes.map(n => [n.id, []]))
  for (const e of graph.edges) {
    if (e.from === e.to) continue
    const [a, b] =
      key.get(e.from) < key.get(e.to) ? [e.from, e.to] : [e.to, e.from]
    preds.get(b).push(a)
    succs.get(a).push(b)
  }
  // backbone chain as virtual edges so the reference stays monotone even where
  // adjacent segments are not linked inside the cut
  const bb = order.filter(id => isBackbone(byId.get(id)))
  for (let i = 1; i < bb.length; i++) {
    preds.get(bb[i]).push(bb[i - 1])
    succs.get(bb[i - 1]).push(bb[i])
  }
  // longest-path layering in key order (a topological order of this DAG)
  const layer = new Map()
  for (const id of order) {
    let l = 0
    for (const p of preds.get(id)) l = Math.max(l, (layer.get(p) ?? -1) + 1)
    layer.set(id, l)
  }
  // pull each non-backbone node as far right as its successors allow, so a
  // short allele sits centred in its bubble rather than hugging the left anchor
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    if (isBackbone(byId.get(id))) continue
    const s = succs.get(id)
    if (s.length === 0) continue
    let minSucc = Infinity
    for (const t of s) minSucc = Math.min(minSucc, layer.get(t))
    const preferred = minSucc - 1
    const lo = layer.get(id)
    // centre between the layer its preds force and the one its succs allow
    layer.set(id, Math.floor((lo + Math.max(lo, preferred)) / 2))
  }
  const layers = []
  for (const id of order) {
    const l = layer.get(id)
    ;(layers[l] ??= []).push(id)
  }
  // x from layer widths
  const xs = []
  let x = 0
  const layerW = layers.map(ids =>
    Math.max(...ids.map(id => nodeWidth(byId.get(id)))),
  )
  for (let l = 0; l < layers.length; l++) {
    xs[l] = x
    x += layerW[l] + gutter
  }
  // y: barycenter of placed preds, backbone pinned at 0, stack around it
  const y = new Map()
  for (let l = 0; l < layers.length; l++) {
    const ids = layers[l]
    const ideal = ids.map(id => {
      const n = byId.get(id)
      if (pinBackbone && isBackbone(n)) return { id, ideal: 0, pinned: true }
      const ps = preds.get(id).filter(p => y.has(p))
      const v = ps.length ? ps.reduce((s, p) => s + y.get(p), 0) / ps.length : 0
      // a node straight off the backbone wants to leave it, not sit on it
      return { id, ideal: v === 0 ? laneGap : v, pinned: false }
    })
    const pinned = ideal.filter(e => e.pinned)
    const free = ideal.filter(e => !e.pinned).sort((a, b) => a.ideal - b.ideal)
    for (const e of pinned) y.set(e.id, 0)
    // greedy: place each free node at the nearest free slot to its ideal, slots
    // at multiples of laneGap, slot 0 taken when a backbone node is here
    const taken = new Set(pinned.length ? [0] : [])
    for (const e of free) {
      let slot = Math.round(e.ideal / laneGap)
      if (slot === 0) slot = e.ideal >= 0 ? 1 : -1
      for (let d = 0; ; d++) {
        const cands = d === 0 ? [slot] : [slot + d, slot - d]
        const c = cands.find(s => !taken.has(s) && (s !== 0 || !pinned.length))
        if (c !== undefined) {
          slot = c
          break
        }
      }
      taken.add(slot)
      y.set(e.id, slot * laneGap)
    }
  }
  const positions = {}
  for (const n of graph.nodes) {
    const l = layer.get(n.id)
    const w = nodeWidth(n)
    const cx = xs[l] + layerW[l] / 2
    positions[n.id] = [
      { x: cx - w / 2, y: y.get(n.id) },
      { x: cx + w / 2, y: y.get(n.id) },
    ]
  }
  return { positions, ms: performance.now() - t0 }
}
