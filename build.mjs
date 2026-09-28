import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { build } from 'esbuild'

rmSync('dist', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts', 'src/cli/figure.ts'],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  outbase: 'src',
  chunkNames: 'chunks/[name]-[hash]',
  packages: 'external',
  logLevel: 'info',
})
writeFileSync(
  'dist/cli/figure.js',
  `#!/usr/bin/env node\n${readFileSync('dist/cli/figure.js', 'utf8')}`,
)

execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' })
cpSync(
  'src/bandage/bandage-layout.d.ts',
  'dist/types/bandage/bandage-layout.d.ts',
)

// The source imports extensionless, as a bundler resolves them, and tsc copies
// that into the declarations. A consumer on node16/nodenext resolution cannot
// follow `./pipeline`, so each relative specifier gets the `.js` (or
// `/index.js`) naming the declaration file beside it.
function withExtension(file, spec) {
  if (spec.endsWith('.js')) {
    return spec
  }
  const base = path.resolve(path.dirname(file), spec)
  if (existsSync(`${base}.d.ts`)) {
    return `${spec}.js`
  }
  if (existsSync(path.join(base, 'index.d.ts'))) {
    return `${spec}/index.js`
  }
  throw new Error(`${file}: cannot resolve ${spec}`)
}

for (const entry of readdirSync('dist/types', {
  recursive: true,
  withFileTypes: true,
})) {
  if (entry.isFile() && entry.name.endsWith('.d.ts')) {
    const file = path.join(entry.parentPath, entry.name)
    const text = readFileSync(file, 'utf8')
    const fixed = text.replaceAll(
      /(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.\.?(?:\/[^'"]*)?)\2/g,
      (_, lead, quote, spec) =>
        `${lead}${quote}${withExtension(file, spec)}${quote}`,
    )
    if (fixed !== text) {
      writeFileSync(file, fixed)
    }
  }
}
