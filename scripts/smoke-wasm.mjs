// Loads the committed Bandage engine and lays out a small bubble graph.
//
// The artifact is 425kb of minified glue with the wasm inlined as base64, so
// any tool that "helpfully" reformats it (eslint --fix, prettier) corrupts it
// in a way nothing else notices until the layout is requested at runtime. This
// runs it for real, needs no toolchain, and needs none of the JBrowse deps.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const path = require.resolve('../src/bandage/bandage-layout.js')

const createModule = (await import(path)).default
const engine = await createModule()

// two paths around a shared middle, so a broken layout shows up as collapsed
// or NaN coordinates rather than merely as a thrown error
const segments = ['1', '2', '3', '4', '5', '6']
const nodes = segments.flatMap(n =>
  ['+', '-'].map(strand => ({
    id: n + strand,
    name: n + strand,
    length: 100,
    depth: 1,
  })),
)
const edges = [
  ['1', '2'],
  ['2', '3'],
  ['3', '4'],
  ['2', '5'],
  ['5', '4'],
  ['4', '6'],
].map(([from, to]) => ({ from: `${from}+`, to: `${to}+`, overlap: 0 }))

const { nodePositions } = engine.computeLayout(
  { nodes, edges },
  { quality: 1, linearLayout: false },
)

const laidOut = Object.keys(nodePositions)
if (laidOut.length !== nodes.length) {
  throw new Error(
    `expected ${nodes.length} nodes laid out, got ${laidOut.length}`,
  )
}

const points = laidOut.flatMap(id => nodePositions[id])
if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
  throw new Error('layout produced non-finite coordinates')
}

// a collapsed layout (every node stacked at one point) means the force step
// silently did nothing
const xs = points.map(p => p.x)
const ys = points.map(p => p.y)
const spread =
  Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys))
if (spread < 1) {
  throw new Error(`layout collapsed to a point (spread ${spread})`)
}

console.log(
  `ok: ${laidOut.length} nodes, ${points.length} points, spread ${spread.toFixed(1)}`,
)
