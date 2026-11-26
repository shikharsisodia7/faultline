/**
 * Captures real screenshots of a running Faultline build at the QA viewports.
 *
 * Browsers run inside a Linux container through a Playwright relay
 * (PW_TEST_CONNECT_WS_ENDPOINT); this script never launches a local browser.
 *
 *   PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:45999/ \
 *     node scripts/screenshots.mjs https://faultline-coral.vercel.app docs/screenshots
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const base = (process.argv[2] ?? 'https://faultline-coral.vercel.app').replace(/\/$/, '')
const out = process.argv[3] ?? 'docs/screenshots'
const endpoint = process.env.PW_TEST_CONNECT_WS_ENDPOINT
if (!endpoint) {
  console.error('Set PW_TEST_CONNECT_WS_ENDPOINT to a Playwright server; this script does not launch a local browser.')
  process.exit(1)
}

const VIEWPORTS = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
]
const PAGES = [
  { name: 'landing', path: '/', wait: 2500 },
  { name: 'guided-what-happened', path: '/demo/checkout-cascade', wait: 7000 },
  { name: 'engineering', path: '/demo/checkout-cascade?mode=engineering&tab=investigate&t=200', wait: 7000 },
  { name: 'lab', path: '/lab', wait: 2000 },
  { name: 'docs', path: '/docs/simulation', wait: 1500 },
]

mkdirSync(out, { recursive: true })
const browser = await chromium.connect(endpoint, { timeout: 60_000 })
const only = process.env.ONLY?.split(',')
for (const vp of VIEWPORTS) {
  if (only && !only.includes(vp.name)) continue
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.width < 800 ? 2 : 1, reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const p of PAGES) {
    await page.goto(base + p.path, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.waitForTimeout(p.wait)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const file = join(out, `${p.name}-${vp.name}.png`)
    await page.screenshot({ path: file, fullPage: false })
    console.log(`${file}${overflow > 1 ? `  (horizontal overflow ${overflow}px)` : ''}`)
  }
  if (errors.length) console.log("  page errors at %s:", vp.name, errors.slice(0, 3))
  await ctx.close()
}
await browser.close()
