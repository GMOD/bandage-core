// What coarsenTubeMap does to a cut: columns, width, the reference axis's lost
// px, time, and whether every walk's length survives. Cuts come from
// cut-gbz.mjs.
//
//   node_modules/.bin/esbuild scripts/layout-lab/coarsen-tubemap.entry.ts \
//     --bundle --format=esm --platform=node --outfile=/tmp/coarsen-tubemap.mjs
//   node /tmp/coarsen-tubemap.mjs micb.gfa:31492000-31514000 --sigma 50,200
import fs from 'node:fs'
import path from 'node:path'

import {
  tubeMapLayout,
  tubeMapReferenceLayout,
} from '../../packages/core/src/layout/tubeMapLayout'
import { loadGraph } from '../../packages/core/src/pipeline'
import { coarsenTubeMap } from '../../packages/core/src/tubeMap/coarsen'
import { referenceKnots } from '../../packages/core/src/tubeMap/warp'

import type { Graph } from '../../packages/core/src/types'

const PANE_PX = 1388
const FIT_PADDING = 40
const MIN_FIT_TUBE_PX = 5

const args = process.argv.slice(2)
const sigmaArg = args.indexOf('--sigma')
const sigmas = sigmaArg >= 0 ? args[sigmaArg + 1]!.split(',').map(Number) : [50]
const cuts = args.filter((a, i) => !a.startsWith('--') && i !== sigmaArg + 1)

function time<T>(f: () => T) {
  const t0 = performance.now()
  const result = f()
  return { result, ms: Math.round(performance.now() - t0) }
}

function ownAxis(graph: Graph) {
  const { result, ms } = time(() => tubeMapLayout(graph))
  const layout = result!.tubeMap!.layout
  const columns = new Set<number>()
  layout.nodes.forEach(n => {
    if (n.order >= 0) {
      columns.add(n.order)
    }
  })
  const width = layout.bounds.maxX - layout.bounds.minX
  const tube = layout.tracks[0]!.width
  const fitTubePx = (tube * (PANE_PX - FIT_PADDING * 2)) / width
  return {
    columns: columns.size,
    widthTubePx: Math.round(width),
    fitTubePx: +fitTubePx.toFixed(2),
    fitsWhole: fitTubePx >= MIN_FIT_TUBE_PX,
    layoutMs: ms,
  }
}

// The share of the pane the warp takes from the columns for the curves
function referenceLoss(graph: Graph, start: number, end: number) {
  const columns = tubeMapReferenceLayout(graph)?.tubeMap?.columns ?? []
  const bpToScreen = (bp: number) => ((bp - start) / (end - start)) * PANE_PX
  const knots = referenceKnots(columns, bpToScreen)
  const real = columns.filter(c => c.bp1 > c.bp0)
  let lost = 0
  real.forEach((c, i) => {
    const drawn = knots[2 * i + 1]!.sx - knots[2 * i]!.sx
    lost += bpToScreen(c.bp1) - bpToScreen(c.bp0) - drawn
  })
  return +((100 * lost) / PANE_PX).toFixed(1)
}

function walkBp(graph: Graph) {
  const lengthOf = new Map(graph.nodes.map(n => [n.id, n.length]))
  return new Map(
    (graph.paths ?? []).map(p => [
      p.name,
      p.nodeIds.reduce((sum, id) => sum + (lengthOf.get(id) ?? 0), 0),
    ]),
  )
}

for (const arg of cuts) {
  const [file, window] = arg.split(':')
  const [start, end] = window!.split('-').map(Number) as [number, number]
  const graph = loadGraph(
    fs.readFileSync(file!, 'utf8'),
    path.basename(file!),
    {
      referencePath: 'GRCh38',
    },
  )
  console.log(
    `\n${path.basename(file!)} ${start}-${end}: ${graph.nodes.length} nodes, ${graph.paths?.length} walks`,
  )
  console.log(
    '  raw',
    JSON.stringify({
      ...ownAxis(graph),
      refLossPct: referenceLoss(graph, start, end),
    }),
  )
  const before = walkBp(graph)
  for (const sigma of sigmas) {
    const { result: coarse, ms } = time(() => coarsenTubeMap(graph, sigma))
    if (!coarse) {
      console.log(`  σ=${sigma}: nothing to coarsen`)
      continue
    }
    const after = walkBp(coarse.graph)
    const broken: string[] = []
    for (const [name, bp] of before) {
      const delta = (coarse.deviations.get(name) ?? []).reduce(
        (sum, d) => sum + d.bp - (d.end - d.start),
        0,
      )
      if ((after.get(name) ?? 0) + delta !== bp) {
        broken.push(`${name}: ${bp} != ${after.get(name)} + ${delta}`)
      }
    }
    const causes: Record<string, number> = {}
    for (const cause of coarse.cuts.values()) {
      causes[cause] = (causes[cause] ?? 0) + 1
    }
    const devs = [...coarse.deviations.values()].map(d => d.length)
    const routes = coarse.graph.nodes.filter(n => n.stable?.rank !== 0).length
    console.log(
      `  σ=${sigma}`,
      JSON.stringify({
        coarsenMs: ms,
        nodes: coarse.graph.nodes.length,
        routes,
        ...ownAxis(coarse.graph),
        refLossPct: referenceLoss(coarse.graph, start, end),
        cuts: causes,
        deviationsPerWalk: `${Math.min(...devs)}-${Math.max(...devs)}`,
      }),
    )
    for (const line of broken) {
      console.log('    length not conserved:', line)
    }
  }
}
