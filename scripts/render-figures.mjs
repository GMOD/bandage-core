#!/usr/bin/env node
//
// Renders every spec in figures/ to img/figure_<name>.svg with the core's
// bandage-figure, the way anyone can remake a figure from its spec. Build the
// core first (`pnpm build` in the repo root): a build of another version than
// package.json's is refused, since its figures would be that version's
// drawing under that version's stamp.
//
//   node scripts/render-figures.mjs              # every spec
//   node scripts/render-figures.mjs kiv2_walks   # one
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const cli = './dist/cli/figure.js'
const builtVersion = 'dist/version.js'
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const built = existsSync(builtVersion)
  ? (await import(pathToFileURL(path.resolve(builtVersion)).href)).version
  : undefined
const names = process.argv.slice(2)
const all = readdirSync('figures')
  .filter(f => f.endsWith('.json'))
  .map(f => path.basename(f, '.json'))
const unknown = names.filter(name => !all.includes(name))

if (built !== version) {
  console.error(
    built === undefined
      ? 'dist/ holds no build: run `pnpm build` first'
      : `dist/ is a build of ${built} and package.json is ${version}: run \`pnpm build\` first`,
  )
  process.exitCode = 1
} else if (unknown.length > 0) {
  console.error(
    `figures/ holds no spec named ${unknown.join(', ')}: it has ${all.join(', ')}`,
  )
  process.exitCode = 1
} else {
  for (const name of all.filter(n => names.length === 0 || names.includes(n))) {
    const out = `img/figure_${name}.svg`
    execFileSync('node', [cli, `figures/${name}.json`, '-o', out], {
      stdio: 'inherit',
    })
    console.log(`wrote ${out}`)
  }
}
