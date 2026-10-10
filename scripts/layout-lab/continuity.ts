// How far each engine's force layout moves between zoom steps, as the graph
// track re-cuts it: every window folded at 10 px and clipped, then laid out
// fresh. Per step it prints the turn of the best similarity fit of the nodes
// two steps share, R where the fit mirrors, and the movement left after the
// fit as a share of the drawing's extent.
//
// Cuts are GFAs written by the plugin's scripts/cut-hprc.ts, w<width>.gfa for
// windows centred on one position. RENDER=<dir> also draws each zoom-in step.
//
//   node_modules/.bin/esbuild scripts/layout-lab/continuity.ts --bundle \
//     --format=esm --platform=node --outfile=continuity.mjs
//   node continuity.mjs <cutsDir> <centre> <paneWidthPx> <w1,w2,...>
import { readFileSync } from 'node:fs'

import { foldVariants } from '../../src/foldVariants'
import { clipToWindow } from '../../src/layout/trimToWindow'
import { layoutEngine } from '../../src/layoutEngines'
import { engineSettingsOf, forceLayout, loadGraph } from '../../src/pipeline'
// @ts-expect-error untyped lab module
import { montage, renderSvg } from './render.mjs'

import type { NodeSegment } from '../../src/types'

type Positions = Record<string, NodeSegment[]>

const [dir, centreArg, paneArg, widthsArg] = process.argv.slice(2)
const centre = Number(centreArg)
const pane = Number(paneArg)
const widths = widthsArg!.split(',').map(Number)
const renderDir = process.env.RENDER
const ramp = {
  start: centre - Math.max(...widths) / 2,
  end: centre + Math.max(...widths) / 2,
}

function cut(width: number) {
  const region = { start: centre - width / 2, end: centre + width / 2 }
  const graph = loadGraph(readFileSync(`${dir}/w${width}.gfa`, 'utf8'), 'cut')
  const fold = (10 * width) / pane
  const folded = foldVariants(graph, fold)
  return folded === graph ? graph : clipToWindow(folded, region, fold)
}

function arcLength(line: NodeSegment[]) {
  let total = 0
  for (let i = 1; i < line.length; i++) {
    total += Math.hypot(
      line[i]!.x - line[i - 1]!.x,
      line[i]!.y - line[i - 1]!.y,
    )
  }
  return total
}

// The weighted 2-D Procrustes fit of `next` onto `prior` over shared nodes,
// rotation or rotation with a mirror, whichever fits better.
function drift(next: Positions, prior: Positions) {
  const pairs = Object.entries(next).flatMap(([id, line]) => {
    const before = prior[id]
    return line.length && before?.length
      ? [
          {
            a: line[Math.floor(line.length / 2)]!,
            b: before[Math.floor(before.length / 2)]!,
            w: Math.max(arcLength(before), 1),
          },
        ]
      : []
  })
  if (pairs.length < 3) {
    return undefined
  }
  const weight = pairs.reduce((sum, p) => sum + p.w, 0)
  const mean = (f: (p: (typeof pairs)[0]) => number) =>
    pairs.reduce((sum, p) => sum + f(p) * p.w, 0) / weight
  const ca = { x: mean(p => p.a.x), y: mean(p => p.a.y) }
  const cb = { x: mean(p => p.b.x), y: mean(p => p.b.y) }
  const fits = [1, -1].map(flip => {
    let dot = 0
    let cross = 0
    let norm = 0
    for (const { a, b, w } of pairs) {
      const ax = a.x - ca.x
      const ay = flip * (a.y - ca.y)
      const bx = b.x - cb.x
      const by = b.y - cb.y
      dot += w * (ax * bx + ay * by)
      cross += w * (ax * by - ay * bx)
      norm += w * (ax * ax + ay * ay)
    }
    return { flip, dot, cross, norm, fit: Math.hypot(dot, cross) }
  })
  const best = fits[1]!.fit > fits[0]!.fit ? fits[1]! : fits[0]!
  const angle = Math.atan2(best.cross, best.dot)
  const k = best.fit / best.norm
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  let sq = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { a, b, w } of pairs) {
    const x = a.x - ca.x
    const y = best.flip * (a.y - ca.y)
    sq +=
      w *
      ((cb.x + k * (c * x - s * y) - b.x) ** 2 +
        (cb.y + k * (s * x + c * y) - b.y) ** 2)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x)
    maxY = Math.max(maxY, b.y)
  }
  const extent = Math.hypot(maxX - minX, maxY - minY) || 1
  return {
    degrees: (angle * 180) / Math.PI,
    reflected: best.flip === -1,
    residual: Math.sqrt(sq / weight) / extent,
  }
}

const graphs = new Map(widths.map(w => [w, cut(w)]))
for (const order of ['in', 'out']) {
  const steps = order === 'in' ? widths : [...widths].reverse()
  console.log(`\nzoom ${order}: ${steps.map(w => `${w / 1000}k`).join(' > ')}`)
  for (const engine of ['fmmm', 'stress'] as const) {
    let prior: Positions | undefined
    const cells: string[] = []
    const pngs: string[] = []
    let ms = 0
    for (const width of steps) {
      const graph = graphs.get(width)!
      const { result, duration } = await forceLayout(
        graph,
        engineSettingsOf({ engine }),
        layoutEngine,
      )
      ms += duration
      if (prior) {
        const d = drift(result.nodePositions, prior)
        cells.push(
          d
            ? `${d.degrees.toFixed(0).padStart(4)}°${d.reflected ? 'R' : ' '} ${(d.residual * 100).toFixed(1).padStart(5)}%`
            : '    n/a     ',
        )
      }
      prior = result.nodePositions
      if (renderDir && order === 'in') {
        const out = `${renderDir}/${engine}-${width}.svg`
        renderSvg(graph, result.nodePositions, out, {
          width: 700,
          height: 260,
          thickness: 4,
          region: ramp,
          title: `${engine} ${width / 1000} kb`,
        })
        pngs.push(out.replace(/\.svg$/, '.png'))
      }
    }
    if (pngs.length) {
      montage(pngs, `${renderDir}/${engine}.png`, 2)
    }
    console.log(
      `${engine.padEnd(7)} ${cells.join(' | ')}   (${Math.round(ms)} ms)`,
    )
  }
}
