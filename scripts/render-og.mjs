/**
 * Renders public/og.svg to public/og.png (1200x630) with the site's own Geist
 * fonts, through the Playwright relay (never a local browser).
 *
 *   PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:45999/ node scripts/render-og.mjs [siteUrl]
 */
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const site = process.argv[2] ?? 'https://faultline-coral.vercel.app'
const endpoint = process.env.PW_TEST_CONNECT_WS_ENDPOINT
if (!endpoint) {
  console.error('Set PW_TEST_CONNECT_WS_ENDPOINT; this script does not launch a local browser.')
  process.exit(1)
}

// The app registers the fonts as 'Geist Variable' / 'Geist Mono Variable'.
const svg = readFileSync('public/og.svg', 'utf8')
  .replaceAll("'Geist Mono',", "'Geist Mono Variable',")
  .replaceAll('font-family="Geist,', `font-family="'Geist Variable',`)

const browser = await chromium.connect(endpoint, { timeout: 60_000 })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.goto(site, { waitUntil: 'networkidle' })
await page.evaluate((markup) => {
  document.body.className = ''
  document.body.style.margin = '0'
  document.body.innerHTML = markup
  // Use every glyph so the font files actually load before the screenshot.
}, svg)
await page.evaluate(async () => {
  await Promise.all([
    document.fonts.load("600 64px 'Geist Variable'"),
    document.fonts.load("400 16px 'Geist Mono Variable'"),
  ])
  await document.fonts.ready
})
const families = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family))
console.log('loaded fonts:', [...new Set(families)].join(', ') || 'none')
await page.screenshot({ path: 'public/og.png', clip: { x: 0, y: 0, width: 1200, height: 630 } })
await browser.close()
console.log('wrote public/og.png')
