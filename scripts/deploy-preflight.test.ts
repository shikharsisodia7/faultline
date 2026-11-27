import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findProhibited, preflight } from './deploy-preflight.mjs'

// Every credential below is fake: built at runtime so no real-looking secret
// is committed, and so secret scanners do not flag this test file itself.
const fakeJwt = ['eyJhbGciOiJFUzI1NiJ9', 'eyJzdWIiOiJmYWtlLXVzZXIiLCJleHAiOjF9', 'ZmFrZXNpZ25hdHVyZWZha2VzaWduYXR1cmU'].join('.')
const fakeVars = `AUTH_WORKER_URL=https://example.invalid\nAPP_OWNER_JWT=${fakeJwt}\nAPP_IDENTITY_TOKEN=${'f'.repeat(64)}\n`
const fakeKey = ['-----BEGIN', 'PRIVATE KEY-----\nMIIfake\n-----END', 'PRIVATE KEY-----'].join(' ')

describe('deployment preflight', () => {
  it('flags secret-bearing file names regardless of content', () => {
    const paths = ['.dev.vars', '.dev.vars.staging', '.env', '.env.production', '.env.local', 'app.local', 'deploy.pem', 'id_ed25519', 'test-accounts.json', '.npmrc']
    expect(findProhibited(paths).map((f) => f.path)).toEqual(paths)
  })

  it('keeps safe examples and ordinary sources', () => {
    expect(findProhibited(['.env.example', 'README.md', 'src/main.tsx', 'docs/SECURITY.md', 'public/og.png'])).toEqual([])
  })

  it('flags tool-state directories', () => {
    expect(findProhibited(['.deepspace/session.json', 'a/.wrangler/state.db']).map((f) => f.rule)).toEqual(['tool-state-dir:.deepspace', 'tool-state-dir:.wrangler'])
  })

  it('flags credential-shaped content in innocently named files', () => {
    const files: Record<string, string> = { 'config/vars.txt': fakeVars, 'notes/key.txt': fakeKey, 'src/token.ts': `export const t = '${fakeJwt}'`, 'src/ok.ts': 'export const x = 1' }
    const found = findProhibited(Object.keys(files), (p) => files[p])
    expect(found).toEqual([
      { path: 'config/vars.txt', rule: 'deepspace-app-credential' },
      { path: 'notes/key.txt', rule: 'private-key-block' },
      { path: 'src/token.ts', rule: 'signed-jwt' },
    ])
  })

  describe('on a real directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fl-preflight-'))
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    it('fails on a planted fake .dev.vars and passes once it is removed', () => {
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'main.ts'), 'console.log(1)\n')
      writeFileSync(join(dir, '.env.example'), 'VITE_CANONICAL_URL=\n')
      writeFileSync(join(dir, '.dev.vars'), fakeVars)
      expect(preflight(dir)).toEqual([{ path: '.dev.vars', rule: 'deepspace-dev-vars' }])
      rmSync(join(dir, '.dev.vars'))
      expect(preflight(dir)).toEqual([])
    })
  })
})
