import { defineConfig } from 'vitest/config'

// The engine is a standalone package: no DeepSpace, no DOM, no app config.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
