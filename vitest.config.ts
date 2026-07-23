import { defineConfig } from 'vitest/config'

export default defineConfig({
  // esbuild.mjs supplies this at build time; tests never fetch the chunk, but
  // importing GraphComputeLayout must not blow up on an undefined global
  define: { __BANDAGE_CHUNK__: JSON.stringify('bandage-layout.js') },
  // The linked jbrowse-components2 source resolves these from its own
  // node_modules, so without deduping, two copies load and MST flows fail with
  // "a mst flow must always have a parent context". In the browser these are a
  // single host global (esbuild externalizes them); here we force one copy.
  resolve: {
    dedupe: [
      'mobx',
      'mobx-react',
      '@jbrowse/mobx-state-tree',
      'react',
      'react-dom',
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: [
      './config/vitest/textEncoder.js',
      './config/vitest/structuredClone.js',
      './config/vitest/console.js',
      './config/vitest/messagechannel.js',
      './config/vitest/resizeObserver.js',
      './config/vitest/deterministicIds.js',
    ],
    testTimeout: 15000,
  },
})
