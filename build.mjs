import { execFileSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'

import { build } from 'esbuild'

rmSync('dist', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  chunkNames: 'chunks/[name]-[hash]',
  packages: 'external',
  logLevel: 'info',
})

execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' })
cpSync(
  'src/bandage/bandage-layout.d.ts',
  'dist/types/bandage/bandage-layout.d.ts',
)
