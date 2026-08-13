// Prints a digest of what the committed engine draws, over a spread of graph
// shapes and every option the view actually sends.
//
// This is the check that a rebuild of `src/bandage/native` changed only what it
// meant to. The artifact is 425kb of minified glue whose bytes move for reasons
// that have nothing to do with the layout — a different emscripten, a different
// build host — so comparing the file is useless and comparing the DRAWING is
// what matters. Every committed force-directed figure is a function of these
// numbers.
//
//   git show HEAD:src/bandage/bandage-layout.js > /tmp/old-engine.mjs
//   node scripts/layout-digest.mjs /tmp/old-engine.mjs > before.txt
//   pnpm build:wasm
//   node scripts/layout-digest.mjs > after.txt
//   diff before.txt after.txt
//
// A FRESH module per case, which costs a second and is the whole point: a case
// that aborts leaves the heap short by everything it had allocated, so a shared
// module turns one failure into a run of unrelated ones further down and the
// baseline stops meaning anything. Ask each case in isolation.
//
// Needs no toolchain and none of the JBrowse deps, same as smoke-wasm.mjs.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const path =
  process.argv[2] ?? require.resolve('../src/bandage/bandage-layout.js')
const createModule = (await import(path)).default

// Deterministic pseudo-randomness, so a shape is the same on every machine and
// every run without the graphs being trivially regular.
function lcg(seed) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

// backbone segment -> two alleles -> backbone segment ..., the shape a
// pangenome window actually has
function bubbleChain(nBubbles, seed) {
  const rand = lcg(seed)
  const nodes = []
  const edges = []
  const add = (id, length) => {
    nodes.push({ id, name: id, length, depth: 1 + Math.floor(rand() * 8) })
    return id
  }
  let prev = add('b0+', 3000)
  for (let i = 0; i < nBubbles; i++) {
    const a = add(`a${i}+`, 1 + Math.floor(rand() * 40))
    const b = add(`c${i}+`, 100 + Math.floor(rand() * 2000))
    const next = add(`b${i + 1}+`, 500 + Math.floor(rand() * 16000))
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

// several disconnected chains, which is what a cut with detached alleles gives
// and what exercises the component packing
function fragmented(total, comps) {
  const nodes = []
  const edges = []
  const per = Math.floor(total / comps)
  for (let c = 0; c < comps; c++) {
    for (let i = 0; i < per; i++) {
      const id = `n${c}_${i}+`
      nodes.push({ id, name: id, length: 500 + i * 37, depth: 1 })
      if (i > 0) {
        edges.push({ from: `n${c}_${i - 1}+`, to: id })
      }
    }
  }
  return { nodes, edges }
}

// a segment linked to itself, plus a node no link mentions
function awkward() {
  return {
    nodes: [
      { id: '1+', name: '1+', length: 400, depth: 3 },
      { id: '2+', name: '2+', length: 90, depth: 1 },
      { id: '3+', name: '3+', length: 7000, depth: 2 },
      { id: 'lonely+', name: 'lonely+', length: 12, depth: 1 },
    ],
    edges: [
      { from: '1+', to: '1+' },
      { from: '1+', to: '2+' },
      { from: '2+', to: '3+' },
    ],
  }
}

function bandageAutoScale(graph, minNodeLength) {
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

// Full precision, not rounded: rounding is exactly what would hide a small
// numeric drift, which is the drift most likely to appear and least likely to
// be noticed.
function digest(positions) {
  const hash = createHash('sha256')
  for (const id of Object.keys(positions).sort()) {
    hash.update(id)
    for (const p of positions[id]) {
      hash.update(`${p.x},${p.y};`)
    }
  }
  return hash.digest('hex').slice(0, 16)
}

const GRAPHS = [
  ['bubbleChain(8)', bubbleChain(8, 7)],
  ['bubbleChain(60)', bubbleChain(60, 11)],
  ['bubbleChain(200)', bubbleChain(200, 13)],
  ['fragmented(300,25)', fragmented(300, 25)],
  ['awkward', awkward()],
]
const SPREADS = [
  ['proportional', 0],
  ['open', 100],
  ['wide', 400],
]

for (const [graphName, graph] of GRAPHS) {
  for (const [spreadName, minNodeLength] of SPREADS) {
    const scale = bandageAutoScale(graph, minNodeLength)
    for (const quality of [0, 2, 4]) {
      for (const linearLayout of [false, true]) {
        const head = [
          graphName.padEnd(19),
          spreadName.padEnd(13),
          `q${quality}`,
          linearLayout ? 'linear' : 'force ',
        ].join(' ')
        // A throw is a result too, and one worth diffing: the engine used to
        // abort outright on any graph whose segment names are not plain
        // integers, which is every minigraph rGFA.
        let nodePositions
        try {
          const engine = await createModule()
          ;({ nodePositions } = engine.computeLayout(graph, {
            quality,
            linearLayout,
            ...scale,
          }))
        } catch (e) {
          console.log(`${head} THREW ${String(e.message ?? e).slice(0, 40)}`)
          continue
        }
        const points = Object.values(nodePositions).flat()
        const finite = points.every(
          p => Number.isFinite(p.x) && Number.isFinite(p.y),
        )
        console.log(
          [
            head,
            `nodes=${Object.keys(nodePositions).length}`.padEnd(11),
            `pts=${points.length}`.padEnd(10),
            finite ? 'finite' : 'NON-FINITE',
            digest(nodePositions),
          ].join(' '),
        )
      }
    }
  }
}
