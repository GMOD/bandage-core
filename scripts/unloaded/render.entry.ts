// Draws walk-rows figures of windows of a walk file as the plugin's walk-rows
// layout cuts them, one SVG a window, tall enough to letter every row, and
// prints each row's readout beside it as text.
//
//   node_modules/.bin/esbuild scripts/unloaded/render.entry.ts --bundle \
//     --format=esm --platform=node --outfile=/tmp/render.mjs
//   node /tmp/render.mjs <walks.gz> <sequence> <out dir> <label> <start-end>
//     ... [--haplotypes 4 | --named HG002#1,HG005#2] [--loaded] [--width 1600]
//
// Writes `<out dir>/<contig>_<start>-<end>.<all|first4|named2>.<label>.svg`
// and a `.txt` of the rows beside it. `--haplotypes n` keeps the first n the
// file's header lists and `--named` those it names, every haplotype without
// either; `--loaded` reads every abridged piece in full. It uses what
// graph-walks 6.2 and 7 share, so a copy of this directory in a checkout of
// bandage-core 13.3.1 draws the same windows as that release drew them, for a
// before and after.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { figureSvg } from '../../src/figure'
import { walkRowReadout } from '../../src/layout/walkRowDraw'
import { walkRowLayoutOf } from '../../src/layout/walkRowLayout'
import { walkRowRuns, walkRowsOf } from '../../src/layout/walkRowRuns'
import { ROW_HEIGHT_PX } from '../../src/layout/rowSpacing'
import { panSNContig } from '../../src/pansn'
import { loadGraph } from '../../src/pipeline'
import { cutTables, flag, openWalks, parseWindow, windowText } from './cut'

const [file = '', refName = '', outDir = '', label = '', ...rest] =
  process.argv.slice(2)
const kept = Number(flag('haplotypes') ?? 0)
const named = flag('named')?.split(',')
const loaded = process.argv.includes('--loaded')
const width = Number(flag('width') ?? 1600)
const KEY_ROOM_PX = 140

const reader = openWalks(file)
const header = await reader.getHeader()
const haplotypes =
  named ?? (kept > 0 ? header.haplotypes.slice(0, kept) : undefined)
const set = named ? `named${named.length}` : kept > 0 ? `first${kept}` : 'all'
const contig = panSNContig(refName)
mkdirSync(outDir, { recursive: true })

for (const text of rest.filter(arg => /^[\d,]+-[\d,]+$/.test(arg))) {
  const region = parseWindow(text)
  const tables = await cutTables(reader, refName, region, {
    haplotypes,
    loaded,
  })
  const runs = walkRowRuns(tables, region)
  const rows = runs && walkRowsOf(runs)
  const graph = loadGraph(tables, `${contig}:${windowText(region)}`)
  const layout = rows && walkRowLayoutOf(graph, rows, region)
  const name = `${contig}_${windowText(region)}.${set}.${label}`
  if (rows && layout) {
    writeFileSync(
      path.join(outDir, `${name}.svg`),
      figureSvg(graph, layout, {
        width,
        height: (rows.rows.length + 1) * ROW_HEIGHT_PX + KEY_ROOM_PX,
        region: { refName: contig, ...region },
        walkRows: rows,
      }),
    )
    writeFileSync(
      path.join(outDir, `${name}.txt`),
      [rows.reference, ...rows.rows]
        .map(
          (row, i) =>
            `${row.label}\t${walkRowReadout(row, i === 0 ? undefined : rows.reference)}`,
        )
        .join('\n'),
    )
  }
  process.stdout.write(
    `${name}: ${rows ? `${rows.rows.length} rows` : 'no rows'}, ${tables.nodes.lengths.length} nodes\n`,
  )
}
