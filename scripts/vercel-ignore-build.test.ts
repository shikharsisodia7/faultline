import { describe, expect, it } from 'vitest'
import { shouldSkipBuild } from './vercel-ignore-build.mjs'

describe('Vercel ignored build step', () => {
  it('skips autosave checkpoints whatever they touch', () => {
    expect(shouldSkipBuild('WIP checkpoint (auto-saved every 10 minutes)', ['src/main.tsx'])).toBe(true)
  })

  it('skips commits that only touch files the demo build never reads', () => {
    expect(shouldSkipBuild('test: add authz spec', ['tests/authz.spec.ts', '.github/workflows/ci.yml', 'README.md', 'worker.ts', 'wrangler.toml'])).toBe(true)
  })

  it('builds when any build input changes, including in-app docs', () => {
    expect(shouldSkipBuild('fix: copy', ['README.md', 'src/features/landing/Landing.tsx'])).toBe(false)
    expect(shouldSkipBuild('docs: audit', ['docs/FINAL-RELEASE-AUDIT.md'])).toBe(false)
    expect(shouldSkipBuild('chore: deps', ['package-lock.json'])).toBe(false)
  })

  it('builds when the changed files are unknown', () => {
    expect(shouldSkipBuild('feat: x', null)).toBe(false)
    expect(shouldSkipBuild('feat: x', [])).toBe(false)
  })
})
