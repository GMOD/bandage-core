// Collapse a base-level cut to what varies: merge every unbranching run of
// nodes whose carriage (the set of walks through them) is the same into one
// node, so a 15,808-node GBZ cut becomes a few hundred nodes each carrying a
// haplotype count. Then draw it ordered with node thickness by carriage.
//
//   node collapse.mjs <gfa> <refPathPrefix> <out.svg> [region start-end]
import { readGfa } from './gfa.mjs'
import { orderedLayout } from './ordered.mjs'
import { renderSvg } from './render.mjs'

const [file, ref, out, regionArg] = process.argv.slice(2)
const g = readGfa(file, { referencePath: ref })

// carriage per node: samples (sample#hap) visiting it
const carriage = new Map()
for (const p of g.paths) {
  const sample = p.name.split('#').slice(0, 2).join('#')
  for (const id of new Set(p.nodeIds)) {
    if (!carriage.has(id)) carriage.set(id, new Set())
    carriage.get(id).add(sample)
  }
}
const carriageKey = id => [...(carriage.get(id) ?? [])].sort().join('|')

// degree along L lines
const out_ = new Map(),
  in_ = new Map()
for (const e of g.edges) {
  ;(out_.get(e.from) ?? out_.set(e.from, []).get(e.from)).push(e.to)
  ;(in_.get(e.to) ?? in_.set(e.to, []).get(e.to)).push(e.from)
}
const byId = new Map(g.nodes.map(n => [n.id, n]))
// a run continues from a to b when a->b is the only way out of a and into b and
// both carry the same haplotypes
const canMerge = (a, b) =>
  (out_.get(a) ?? []).length === 1 &&
  (in_.get(b) ?? []).length === 1 &&
  carriageKey(a) === carriageKey(b)
const runOf = new Map()
const runs = []
for (const n of g.nodes) {
  if (runOf.has(n.id)) continue
  const pred = in_.get(n.id) ?? []
  if (pred.length === 1 && canMerge(pred[0], n.id)) continue // not a run start
  const run = [n.id]
  let cur = n.id
  while (true) {
    const nxt = (out_.get(cur) ?? [])[0]
    if (
      nxt === undefined ||
      runOf.has(nxt) ||
      nxt === run[0] ||
      !canMerge(cur, nxt)
    )
      break
    run.push(nxt)
    cur = nxt
  }
  for (const id of run) runOf.set(id, runs.length)
  runs.push(run)
}
for (const n of g.nodes)
  if (!runOf.has(n.id)) {
    runOf.set(n.id, runs.length)
    runs.push([n.id])
  }

const nodes = runs.map((run, i) => {
  const first = byId.get(run[0])
  const length = run.reduce((s, id) => s + byId.get(id).length, 0)
  const bb = run.map(id => byId.get(id)).filter(n => n.stable?.rank === 0)
  const stable = bb.length
    ? {
        refName: bb[0].stable.refName,
        start: Math.min(...bb.map(n => n.stable.start)),
        rank: 0,
      }
    : first.stable
      ? { ...first.stable }
      : undefined
  return {
    id: `r${i}+`,
    name: `r${i}`,
    length,
    depth: (carriage.get(run[0]) ?? new Set()).size,
    stable,
    run,
  }
})
const edgeSet = new Set()
const edges = []
for (const e of g.edges) {
  const a = `r${runOf.get(e.from)}+`,
    b = `r${runOf.get(e.to)}+`
  if (a === b) continue
  const k = `${a}>${b}`
  if (!edgeSet.has(k)) {
    edgeSet.add(k)
    edges.push({ from: a, to: b })
  }
}
const collapsed = { nodes, edges, paths: [] }
const nHap = g.paths.length
console.log(
  `${g.nodes.length} nodes -> ${nodes.length} runs, ${edges.length} edges, ${nHap} walks`,
)
const hist = new Map()
for (const n of nodes) hist.set(n.depth, (hist.get(n.depth) ?? 0) + 1)
console.log(
  'runs by carriage:',
  [...hist]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`)
    .join(' '),
)

let region
if (regionArg) {
  const [s, e] = regionArg.split('-').map(Number)
  region = { start: s, end: e }
}
const t0 = performance.now()
const r = orderedLayout(collapsed, {
  laneGap: 34,
  gutter: 14,
  nodeWidth: n => 8 + 7 * Math.log2(1 + n.length),
})
console.log(`ordered ${(performance.now() - t0).toFixed(0)} ms`)
renderSvg(collapsed, r.positions, out, {
  width: 4800,
  height: 600,
  thickness: 6,
  region,
  nodeColor: undefined,
  thicknessOf: n => 3 + (26 * n.depth) / nHap,
  title: '',
})
