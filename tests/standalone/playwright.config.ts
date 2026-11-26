import { defineConfig } from '@playwright/test'

/**
 * Usability acceptance tests for the standalone demo: the paths a first-time
 * visitor takes, asserted through the accessible UI (roles and visible text).
 *
 * Targets the live site by default; point FAULTLINE_URL at a local
 * `npm run dev:standalone` or a preview to test changes before deploying.
 * When PW_TEST_CONNECT_WS_ENDPOINT is set, Playwright connects to that
 * browser server instead of launching one locally.
 *
 *   npx playwright test -c tests/standalone/playwright.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: (process.env.FAULTLINE_URL ?? 'https://faultline-coral.vercel.app').replace(/\/$/, ''),
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
})
