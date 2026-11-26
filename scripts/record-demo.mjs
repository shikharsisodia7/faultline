/**
 * Records a real walk through the guided demo (video), for docs/demo.gif.
 * Runs through the Playwright relay; convert with ffmpeg afterwards:
 *
 *   PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:45999/ node scripts/record-demo.mjs out/demo.webm
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? 'out/demo.webm'
const site = process.argv[3] ?? 'https://faultline-coral.vercel.app'
const endpoint = process.env.PW_TEST_CONNECT_WS_ENDPOINT
if (!endpoint) {
  console.error('Set PW_TEST_CONNECT_WS_ENDPOINT; this script does not launch a local browser.')
  process.exit(1)
}
mkdirSync(dirname(out), { recursive: true })

const size = { width: 1280, height: 800 }
const browser = await chromium.connect(endpoint, { timeout: 60_000 })
const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: '/tmp/fl-video', size } })
const page = await ctx.newPage()
const pause = (ms) => page.waitForTimeout(ms)
const click = async (name) => {
  const b = page.getByRole('button', { name, exact: false }).first()
  await b.scrollIntoViewIfNeeded()
  await pause(400)
  await b.click()
}

await page.goto(`${site}/demo/checkout-cascade`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Replay failure' }).waitFor({ timeout: 30_000 })
await pause(1500)
await click('Replay failure')
await pause(7000)
await click('Why did it happen?')
await pause(4500)
await page.mouse.wheel(0, 380)
await pause(2500)
await click('What if?')
await pause(2500)
await click('Explore this outcome')
await page.getByText('Simulating…').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {})
await pause(7000)
await page.mouse.wheel(0, 420)
await pause(3500)

const video = page.video()
await ctx.close()
await video.saveAs(out)
await browser.close()
console.log(`wrote ${out}`)
