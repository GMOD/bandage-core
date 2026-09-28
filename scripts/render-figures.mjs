#!/usr/bin/env node
//
// Renders every spec in figures/ to img/figure_<name>.svg with the core's
// bandage-figure, the way anyone can remake a figure from its spec. Build the
// core first (`node packages/core/build.mjs` in packages/core).
//
//   node scripts/render-figures.mjs              # every spec
//   node scripts/render-figures.mjs mapt_sample  # one
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const cli = 'packages/core/dist/cli/figure.js'
const names = process.argv.slice(2)
const specs = readdirSync('figures')
  .filter(f => f.endsWith('.json'))
  .map(f => path.basename(f, '.json'))
  .filter(name => names.length === 0 || names.includes(name))

for (const name of specs) {
  const out = `img/figure_${name}.svg`
  execFileSync('node', [cli, `figures/${name}.json`, '-o', out], {
    stdio: 'inherit',
  })
  console.log(`wrote ${out}`)
}
