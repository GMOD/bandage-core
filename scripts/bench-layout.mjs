// Times the committed Bandage engine over graph sizes and the option sets the
// view actually sends, so the cost of `layoutQuality` and `bubbleSpread` is a
// measurement rather than a guess. The table it prints is recorded in
// agent-docs/GRAPH_SCALE_AND_LOD.md; rerun it after touching drawnScale.ts,
// bubbleSpreads.ts or the engine itself.
//
// Needs no toolchain and none of the JBrowse deps — same as smoke-wasm.mjs.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const path = require.resolve('../src/bandage/bandage-layout.js')
const createModule = (await import(path)).default
const engine = await createModule()

// bubble chain: backbone segment -> two alleles -> backbone segment ...
function bubbleChain(nBubbles) {
  const nodes = []
  const edges = []
  const add = (id, length) => {
    nodes.push({ id, name: id, length, depth: 1 })
    return id
  }
  let prev = add('b0+', 3000)
  for (let i = 0; i < nBubbles; i++) {
    const a = add(`a${i}+`, 20)
    const b = add(`c${i}+`, 300)
    const next = add(`b${i + 1}+`, 3000)
    edges.push(
      { from: prev, to: a },
      { from: prev, to: b },
      { from: a, to: next },
      { from: b, to: next },
    )
    prev = next
  }
  return { nodes, edges }
}

// mirrors src/GraphGenomeView/layout/drawnScale.ts bandageAutoScale
function bandageAutoScale(graph, minNodeLength = 5) {
  const total = graph.nodes.reduce((s, n) => s + n.length, 0)
  const mb = total / 1e6
  const target = Math.max(graph.nodes.length * 40, 500)
  return {
    nodeLengthPerMegabase: mb > 0 ? target / mb : 10000,
    minimumNodeLength: Math.max(5, minNodeLength),
    edgeLength: 5,
    nodeSegmentLength: 20,
  }
}

const SPREADS = [
  ['auto (proportional)', 0],
  ['open', 2.5 * 40],
  ['wide', 10 * 40],
]

function ogdfNodeCount(graph, opts) {
  let n = 0
  for (const node of graph.nodes) {
    const drawn = Math.max(
      (opts.nodeLengthPerMegabase * node.length) / 1e6,
      opts.minimumNodeLength,
    )
    n += Math.max(1, Math.ceil(drawn / opts.nodeSegmentLength)) + 1
  }
  return n
}

console.log(
  'nodes\tspread\t\t\tOGDF nodes\tq=0\tq=1\tq=2\tq=3\tq=4  (ms)',
)
for (const nB of [10, 40, 120, 400]) {
  const graph = bubbleChain(nB)
  for (const [label, minNodeLength] of SPREADS) {
    const opts = bandageAutoScale(graph, minNodeLength)
    const row = []
    for (const quality of [0, 1, 2, 3, 4]) {
      const t0 = performance.now()
      engine.computeLayout(graph, { quality, linearLayout: false, ...opts })
      row.push((performance.now() - t0).toFixed(0))
    }
    console.log(
      `${graph.nodes.length}\t${label.padEnd(20)}\t${ogdfNodeCount(graph, opts)}\t\t${row.join('\t')}`,
    )
  }
}
