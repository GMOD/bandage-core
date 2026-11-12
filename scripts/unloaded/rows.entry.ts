// Prints the walk rows of each window of a walk file, cut with nothing loaded
// and with every abridged piece loaded: each row's bp, readout and runs.
//
//   node_modules/.bin/esbuild scripts/unloaded/rows.entry.ts --bundle \
//     --format=esm --platform=node --outfile=/tmp/rows.mjs
//   node /tmp/rows.mjs <walks.gz> <sequence> <start-end> ... [--only HG002]
//     [--gaps]
import { walkRowReadout } from '../../src/layout/walkRowDraw'
import { walkRowRuns, walkRowsOf } from '../../src/layout/walkRowRuns'
import { cutTables, flag, openWalks, parseWindow } from './cut'

import type { WalkRun } from '../../src/layout/walkRows'

const [path = '', refName = '', ...rest] = process.argv.slice(2)
const only = flag('only')
const gaps = process.argv.includes('--gaps')
const reader = openWalks(path)

const runText = (run: WalkRun) =>
  run.gap
    ? `[gap ${run.bp} ${run.cause ?? 'outside'}]`
    : run.onReference
      ? `R${run.reversed ? '<' : ''}${run.bp}@${run.referenceStart}`
      : `${run.unloaded ? '?' : 'o'}${run.bp}`

for (const text of rest.filter(arg => /^[\d,]+-[\d,]+$/.test(arg))) {
  const region = parseWindow(text)
  for (const loaded of [false, true]) {
    const tables = await cutTables(reader, refName, region, { loaded, gaps })
    const runs = walkRowRuns(tables, region)
    const rows = runs && walkRowsOf(runs)
    process.stdout.write(
      `## ${text} ${loaded ? 'loaded' : 'unloaded'}: ${tables.nodes.lengths.length} nodes, ${(tables.nodes.placeholders ?? []).reduce((sum, flagged) => sum + flagged, 0)} placeholders, ${rows?.rows.length ?? 0} rows, reference ${rows?.reference.bp ?? 0} bp\n`,
    )
    for (const row of rows?.rows ?? []) {
      if (!only || row.name.startsWith(only)) {
        process.stdout.write(
          `  ${row.name} bp ${row.bp} off ${row.offReferenceBp} unloaded ${row.unloadedBp ?? 0} gap ${row.gapBp} complete ${row.complete} stepless ${row.stepless ?? false} abridgedSteps ${row.abridgedSteps ?? '-'}\n    "${walkRowReadout(row, rows?.reference)}"\n    ${row.runs.map(runText).join(' ')}\n`,
        )
      }
    }
  }
}
