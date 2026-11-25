import { defineConfig } from 'vitest/config'

// The engine is a standalone package: no DeepSpace, no DOM, no app config.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Full demo scenarios simulate ~50k requests (about 2 s each).
    testTimeout: 60_000,
  },
})
