// Times the committed Bandage engine on real pangenome GFA files, rather than
// on bench-layout.mjs's synthetic bubble chain. What that one cannot answer is
// where the wall is for a graph a user would actually open: a real graph has
// long non-branching runs, junctions of degree 3 and up, and a bp range
// spanning four orders of magnitude, and all three change what FMMM costs.
//
// Each case runs in its own child process with a wall clock, because the engine
// is synchronous WASM: a case that runs long cannot be interrupted from here,
// and one that aborts poisons the module for every later call in that worker
// (see src/bandage/README.md). One process per case makes both survivable, and
// makes "did not finish in N s" and "out of memory" reportable results rather
// than a dead run.
//
// Needs no toolchain and none of the JBrowse deps — same as bench-layout.mjs.
//
//   node scripts/bench-gfa-layout.mjs <file.gfa[.gz]> [more.gfa ...]
//
// Options:
//   --sizes 100,500,2000     segment counts to cut to, or `all`
//   --qualities 0,2,4        layoutQuality values (default 2)
//   --spread auto|open|wide  mirrors BUBBLE_SPREADS (default auto)
//   --timeout 120            per-case seconds (default 120)
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import process from 'node:process'

const require = createRequire(import.meta.url)

// mirrors src/GraphGenomeView/layout/drawnScale.ts bandageAutoScale
const MEAN_NODE_LENGTH = 40
const MIN_TOTAL_GRAPH_LENGTH = 500
const BANDAGE_MINIMUM_NODE_LENGTH = 5

function bandageAutoScale(nodes, minNodeLength = BANDAGE_MINIMUM_NODE_LENGTH) {
  const total = nodes.reduce((s, n) => s + n.length, 0)
  const megabases = total / 1_000_000
  const target = Math.max(
    nodes.length * MEAN_NODE_LENGTH,
    MIN_TOTAL_GRAPH_LENGTH,
  )
  return {
    nodeLengthPerMegabase: megabases > 0 ? target / megabases : 10_000,
    minimumNodeLength: Math.max(BANDAGE_MINIMUM_NODE_LENGTH, minNodeLength),
    edgeLength: 5,
    nodeSegmentLength: 20,
  }
}

// mirrors BUBBLE_SPREADS' minNodeFactor, in the same FMMM units
const SPREADS = {
  auto: 0,
  open: 2.5 * MEAN_NODE_LENGTH,
  wide: 10 * MEAN_NODE_LENGTH,
}

// What FMMM is actually handed. The engine subdivides every drawn node into
// `nodeSegmentLength`-unit pieces (settings.h, getDrawnNodeLength), so the OGDF
// node count is not the segment count, and it is the number the cost tracks.
function ogdfNodeCount(nodes, opts) {
  let n = 0
  for (const node of nodes) {
    const drawn = Math.max(
      (opts.nodeLengthPerMegabase * node.length) / 1e6,
      opts.minimumNodeLength,
    )
    n += Math.max(1, Math.ceil(drawn / opts.nodeSegmentLength)) + 1
  }
  return n
}

// GFA does not order its records, and these files disagree: the MC chrM graph
// and the HLA one put every S before every L, while the pggb chrM and chr22
// graphs interleave each segment with its own links. So a link cannot be
// resolved as it is read — `L 1 + 2 +` legally precedes `S 2`. Links are
// buffered as bare id pairs and filtered once, at the end, against the segments
// the cut actually kept. Sequences are never retained, which is what keeps this
// affordable: they are almost all of the bytes and none of the layout.
async function readGfa(path, limit = Infinity) {
  const raw = createReadStream(path)
  const stream = path.endsWith('.gz') ? raw.pipe(createGunzip()) : raw
  const nodes = []
  const kept = new Set()
  const pairs = []
  let sawAllSegments = false

  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    const kind = line.charCodeAt(0)
    if (line.charCodeAt(1) !== 9) continue
    if (kind === 83 /* S */) {
      if (nodes.length >= limit) {
        sawAllSegments = true
        continue
      }
      const f = line.split('\t')
      const id = f[1]
      let length = f[2] === '*' ? 0 : f[2].length
      if (!length) {
        for (let i = 3; i < f.length; i++) {
          if (f[i].startsWith('LN:i:')) {
            length = Number(f[i].slice(5))
            break
          }
        }
      }
      kept.add(id)
      nodes.push({ id: `${id}+`, name: id, length: length || 1, depth: 1 })
    } else if (kind === 76 /* L */) {
      const f = line.split('\t')
      pairs.push(f[1], f[3])
    }
  }

  const edges = []
  for (let i = 0; i < pairs.length; i += 2) {
    if (kept.has(pairs[i]) && kept.has(pairs[i + 1])) {
      edges.push({ from: `${pairs[i]}+`, to: `${pairs[i + 1]}+` })
    }
  }
  return { nodes, edges, cut: sawAllSegments }
}

// ---- child mode: run exactly one case, print JSON ----
if (process.argv[2] === '--one') {
  const [, , , file, limitArg, qualityArg, spreadArg] = process.argv
  const limit = limitArg === 'all' ? Infinity : Number(limitArg)

  const t0 = performance.now()
  const { nodes, edges, cut } = await readGfa(file, limit)
  const parseMs = performance.now() - t0

  const opts = bandageAutoScale(nodes, SPREADS[spreadArg])
  const ogdf = ogdfNodeCount(nodes, opts)

  const enginePath = require.resolve('../src/bandage/bandage-layout.js')
  const engine = await (await import(enginePath)).default()

  const t1 = performance.now()
  const result = engine.computeLayout(
    { nodes, edges },
    { quality: Number(qualityArg), linearLayout: false, ...opts },
  )
  const layoutMs = performance.now() - t1

  const positions = result?.nodePositions ?? {}
  let placed = 0
  for (const key of Object.keys(positions)) {
    placed += positions[key].length
  }

  console.log(
    JSON.stringify({
      segs: nodes.length,
      links: edges.length,
      ogdf,
      parseMs,
      layoutMs,
      laidOut: Object.keys(positions).length,
      placed,
      rssMb: process.memoryUsage().rss / 1e6,
      cut,
    }),
  )
  process.exit(0)
}

// ---- parent mode ----
const files = []
const flags = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) flags[a.slice(2)] = process.argv[++i]
  else files.push(a)
}
if (!files.length) {
  console.error('usage: node scripts/bench-gfa-layout.mjs <file.gfa[.gz]> [...]')
  process.exit(1)
}

const sizes = (flags.sizes ?? '100,250,500,1000,2000,5000,10000,25000').split(',')
const qualities = (flags.qualities ?? '2').split(',').map(Number)
const spread = flags.spread ?? 'auto'
const timeoutMs = Number(flags.timeout ?? 120) * 1000

console.log(`spread=${spread}  timeout=${timeoutMs / 1000}s`)
console.log('\nfile\tsegs\tlinks\tOGDF\tq\tparse ms\tlayout ms\tRSS MB')

for (const file of files) {
  const label = file.split('/').pop()
  for (const size of sizes) {
    let exhausted = false
    for (const quality of qualities) {
      const r = spawnSync(
        process.execPath,
        [process.argv[1], '--one', file, size, String(quality), spread],
        { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1 << 24 },
      )
      if (r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT') {
        console.log(`${label}\t${size}\t-\t-\t${quality}\t-\t>${timeoutMs / 1000}s TIMEOUT`)
        continue
      }
      let out
      try {
        out = JSON.parse(r.stdout.trim().split('\n').pop())
      } catch {
        const why = (r.stderr || '').trim().split('\n').slice(-2).join(' | ')
        console.log(`${label}\t${size}\t-\t-\t${quality}\t-\tFAILED: ${why.slice(0, 200)}`)
        continue
      }
      console.log(
        [
          label,
          out.segs,
          out.links,
          out.ogdf,
          quality,
          out.parseMs.toFixed(0),
          out.layoutMs.toFixed(0),
          out.rssMb.toFixed(0),
        ].join('\t'),
      )
      if (!out.cut) exhausted = true
    }
    // the file has fewer segments than this cut asked for; larger cuts repeat it
    if (exhausted) break
  }
}
