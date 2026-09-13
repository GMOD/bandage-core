// Drive lab/native/driver (natively built OGDF) from JS.
import { execFileSync } from 'node:child_process'
import { bandageAutoScale, drawnLength, isBackbone } from './gfa.mjs'
import { referenceOrder } from './engine.mjs'

const DRIVER = new URL('./native/driver', import.meta.url).pathname

export function runNative(graph, mode, opts = {}, { seeds, drawn } = {}) {
  const scale = bandageAutoScale(graph, opts.minNodeLength ?? 5)
  const lines = []
  for (const n of graph.nodes) {
    const d = drawn ? drawn(n) : drawnLength(scale, n.length)
    const s = seeds?.get(n.id)
    lines.push(s ? `N ${n.id} ${d} ${s.x} ${s.y}` : `N ${n.id} ${d}`)
  }
  for (const e of graph.edges) lines.push(`E ${e.from} ${e.to}`)
  const args = Object.entries(opts)
    .filter(([k]) => k !== 'minNodeLength')
    .map(([k, v]) => `${k}=${v}`)
  const t0 = performance.now()
  const out = execFileSync(DRIVER, [mode, ...args], {
    input: lines.join('\n'),
    maxBuffer: 1 << 28,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString()
  const positions = {}
  for (const line of out.split('\n')) {
    if (!line) continue
    const [id, ...pts] = line.split(' ')
    positions[id] = pts.map(p => {
      const [x, y] = p.split(',').map(Number)
      return { x, y }
    })
  }
  return { positions, ms: performance.now() - t0, scale }
}

// Seeds for a reference-anchored graph: backbone laid end to end along x at
// drawn length, each off-reference node at the midpoint of the backbone node it
// was reached from (BFS), with a y offset by BFS depth, below the line by
// default (`side`: below | above | alt). Two alleles off one anchor at one depth
// get the same seed; FMMM separates them.
//
// FMMM only honours these at its coarsest multilevel graph (OGDF applies
// create_initial_placement there and re-derives finer levels from the coarse
// solar system with jitter), so on any graph over minGraphSize (50 OGDF nodes)
// what survives is the coarse shape of the backbone, not the allele offsets.
// That is why the seeded drawings wave, and why `singleLevel` would honour
// every seed exactly (untested here).
export function referenceSeeds(
  graph,
  scale,
  { laneGap = 30, side = 'below' } = {},
) {
  const seeds = new Map()
  const bb = graph.nodes
    .filter(isBackbone)
    .sort((a, b) => a.stable.start - b.stable.start)
  let x = 0
  const drawnOf = n => drawnLength(scale, n.length)
  for (const n of bb) {
    seeds.set(n.id, { x, y: 0 })
    x += drawnOf(n) + scale.edgeLength
  }
  const adj = new Map()
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    if (!adj.has(e.to)) adj.set(e.to, [])
    adj.get(e.from).push(e.to)
    adj.get(e.to).push(e.from)
  }
  const depth = new Map(bb.map(n => [n.id, 0]))
  const queue = bb.map(n => n.id)
  let k = 0
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]
    for (const nb of adj.get(id) ?? []) {
      if (!depth.has(nb)) {
        depth.set(nb, depth.get(id) + 1)
        const at = seeds.get(id)
        const sgn =
          side === 'below' ? 1 : side === 'above' ? -1 : k++ % 2 ? 1 : -1
        seeds.set(nb, {
          x: at.x + drawnOf(graph.nodes.find(n => n.id === id)) / 2,
          y: sgn * laneGap * depth.get(nb),
        })
        queue.push(nb)
      }
    }
  }
  // nodes no backbone reaches: spread along x in file order rather than piled
  // on one point
  let k2 = 0
  for (const n of graph.nodes)
    if (!seeds.has(n.id))
      seeds.set(n.id, { x: (k2++ * x) / graph.nodes.length, y: laneGap * 3 })
  return seeds
}

// Bandage-linear-style seeds from a total order, for a graph with no
// reference at all: everything on one line in that order.
export function orderSeeds(graph, scale) {
  const order = referenceOrder(graph)
  const seeds = new Map()
  let x = 0
  for (const id of order) {
    const n = graph.nodes.find(m => m.id === id)
    seeds.set(id, { x, y: 0 })
    x += drawnLength(scale, n.length) + scale.edgeLength
  }
  return seeds
}
