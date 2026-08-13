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

const options = { quality: 1, linearLayout: false }
const { nodePositions } = engine.computeLayout({ nodes, edges }, options)

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

// The layout has to be a function of the graph alone. FMMM seeds its initial
// placement from a PRNG, and while that seed came from the clock every regen of
// a force-directed figure moved ~2% of the pixels, which is enough jitter to
// hide a real change under a raised diffThreshold. A fresh module instance is
// part of the check because the seed is set per layout call, not per module.
function digest(positions) {
  return JSON.stringify(
    Object.keys(positions)
      .sort()
      .map(id => [id, positions[id].map(p => [p.x, p.y])]),
  )
}

const first = digest(nodePositions)
const again = digest(engine.computeLayout({ nodes, edges }, options).nodePositions)
if (first !== again) {
  throw new Error('layout is not deterministic across two runs')
}

const fresh = await createModule()
if (digest(fresh.computeLayout({ nodes, edges }, options).nodePositions) !== first) {
  throw new Error('layout is not deterministic across module instances')
}

// and the seed is genuinely the thing driving it, rather than the graph being
// too small for the placement to matter
const reseeded = digest(
  fresh.computeLayout({ nodes, edges }, { ...options, seed: 7 }).nodePositions,
)
if (reseeded === first) {
  throw new Error('a different seed produced an identical layout')
}

// The linear layout, on segment names that are NOT plain integers.
//
// Both halves of that sentence are the test. `determineLinearNodePositions` is
// the only code that reads a segment's name, it is only reached under
// `linearLayout`, and it asks whether the name is a number so it can sort
// numerically. The graph above answers yes — `1`, `2`, `3` — which is why this
// suite ran green for months over an engine that aborted outright on `s1`.
//
// Every minigraph rGFA names its segments that way, so this was the whole
// format the plugin is built around: "Linear layout" in the settings menu
// error-banned the view, each aborted call leaked the graph it had built, and
// about twenty of them exhausted the worker's heap and left every subsequent
// layout failing with "memory access out of bounds" until the tab was reloaded.
//
// A fresh module, because the failure it guards is one that poisons a shared
// one — and it asserts a real drawing rather than merely "did not throw", since
// the abort was one bad name away from being a silent empty result.
const linearEngine = await createModule()
const named = ['s1', 's2', 's3', 's4'].map(id => ({
  id: `${id}+`,
  name: `${id}+`,
  length: 3000,
  depth: 1,
}))
const namedEdges = [
  ['s1', 's2'],
  ['s2', 's3'],
  ['s1', 's4'],
  ['s4', 's3'],
].map(([from, to]) => ({ from: `${from}+`, to: `${to}+`, overlap: 0 }))
const linear = linearEngine.computeLayout(
  { nodes: named, edges: namedEdges },
  { quality: 1, linearLayout: true },
)
const linearIds = Object.keys(linear.nodePositions)
if (linearIds.length !== named.length) {
  throw new Error(
    `linear layout placed ${linearIds.length} of ${named.length} named nodes`,
  )
}
const linearPoints = linearIds.flatMap(id => linear.nodePositions[id])
if (
  linearPoints.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
  new Set(linearPoints.map(p => `${p.x},${p.y}`)).size === 1
) {
  throw new Error('linear layout of named segments is degenerate')
}

console.log(
  `ok: ${laidOut.length} nodes, ${points.length} points, spread ${spread.toFixed(1)}, deterministic; linear layout of named segments ok`,
)
