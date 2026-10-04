import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    include: ['src/**/*.test.ts'],
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
