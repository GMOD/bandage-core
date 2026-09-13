// node one.mjs <gfa> <outprefix> [--ref R] [--window s-e] [--label L] [--width W] [--cols N] --v <spec> [--v <spec> ...]
// spec: force[:k=v,...] | seeded[:k=v,...] | sugiyama[:k=v,...] | anchored
//   force keys: quality, minNodeLength, orient=1
//   seeded keys: quality, minNodeLength, rotate, side=below|above|alt, laneGap, orient=1, force=new|fr, seg, edge, iters, fine
//   sugiyama keys: ranking, coord, crossmin, layerdist, nodedist, runs, widths=log|bandage
import { readGfa, cutWindow, bandageAutoScale, drawnLength } from './gfa.mjs'
import { loadEngine, force, orientToReference, bounds } from './engine.mjs'
import { runNative, referenceSeeds } from './native.mjs'
import { renderSvg, montage } from './render.mjs'
// Built by: node_modules/.bin/esbuild scripts/layout-lab/plugin-layouts.entry.ts \
//   --bundle --format=esm --platform=node --outfile=scripts/layout-lab/plugin-layouts.mjs
import { anchoredLayout } from './plugin-layouts.mjs'
import { orderedLayout } from './ordered.mjs'

const args = process.argv.slice(2)
const [file, prefix] = args
const opt = k => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const specs = []
args.forEach((a, i) => {
  if (a === '--v') specs.push(args[i + 1])
})
let graph = readGfa(file, { referencePath: opt('--ref') })
let region
if (opt('--window')) {
  const [s, e] = opt('--window').split('-').map(Number)
  graph = cutWindow(graph, s, e)
  region = { start: s, end: e }
}
const label = opt('--label') ?? file.split('/').pop()
if (opt('--region')) {
  const [s, e] = opt('--region').split('-').map(Number)
  region = { start: s, end: e }
}
const notitle = args.includes('--notitle')
const width = Number(opt('--width') ?? 1000)
console.log(
  `${label}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.paths.length} paths`,
)
await loadEngine()

function parse(spec) {
  const [kind, rest] = spec.split(':')
  const kv = {}
  for (const p of (rest ?? '').split(',').filter(Boolean)) {
    const [k, v] = p.split('=')
    kv[k] = isNaN(+v) ? v : +v
  }
  return { kind, kv }
}

function runSpec(spec) {
  const { kind, kv } = parse(spec)
  const orient = kv.orient === 1
  delete kv.orient
  let r
  if (kind === 'anchored') {
    const t0 = performance.now()
    const a = anchoredLayout(graph, region)
    const b = bounds(a.nodePositions)
    const yScale = b.w / 6 / Math.max(b.h, 1)
    const positions = {}
    for (const [id, segs] of Object.entries(a.nodePositions))
      positions[id] = segs.map(p => ({ x: p.x, y: p.y * yScale }))
    r = { positions, ms: performance.now() - t0 }
  } else if (kind === 'force') {
    r = force(graph, { quality: 2, ...kv })
  } else if (kind === 'seeded') {
    const { side, laneGap, minNodeLength = 5, ...native } = kv
    const scale = bandageAutoScale(graph, minNodeLength)
    r = runNative(
      graph,
      'fmmm',
      { quality: 2, keep: 1, rotate: 0, minNodeLength, ...native },
      { seeds: referenceSeeds(graph, scale, { side, laneGap }) },
    )
  } else if (kind === 'ordered') {
    r = orderedLayout(graph, kv)
  } else if (kind === 'sugiyama') {
    const { widths = 'log', ...native } = kv
    const scale = bandageAutoScale(graph)
    const drawn =
      widths === 'log'
        ? n => 10 + 8 * Math.log2(1 + n.length)
        : n => drawnLength(scale, n.length)
    r = runNative(
      graph,
      'sugiyama',
      { layerdist: 20, nodedist: 12, ...native },
      { drawn },
    )
  }
  if (orient) r.positions = orientToReference(graph, r.positions)
  return r
}

const pngs = []
for (const spec of specs) {
  let r
  try {
    r = runSpec(spec)
  } catch (e) {
    console.log(`  ${spec}: FAILED ${e.message.split('\n')[0]}`)
    continue
  }
  const b = bounds(r.positions)
  const out = `${prefix}-${notitle ? spec.replace(/[^a-z0-9]+/gi, '_') : pngs.length}.svg`
  renderSvg(graph, r.positions, out, {
    region,
    title: notitle ? '' : `${label} — ${spec} — ${r.ms.toFixed(0)} ms`,
    width,
    height: Math.round(width * 0.6),
    thickness: Number(opt('--thick') ?? 6),
    paths: args.includes('--paths') ? graph.paths : null,
  })
  pngs.push(out.replace('.svg', '.png'))
  console.log(
    `  ${spec}: ${r.ms.toFixed(0)} ms, bbox ${b.w.toFixed(0)}x${b.h.toFixed(0)}`,
  )
}
if (pngs.length > 1) {
  montage(pngs, `${prefix}-montage.png`, Number(opt('--cols') ?? 1))
  console.log(`wrote ${prefix}-montage.png`)
}
