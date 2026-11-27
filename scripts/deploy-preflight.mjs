/**
 * Deployment preflight: refuses to upload secret-bearing files.
 *
 * Added after the DeepSpace CLI's generated `.dev.vars` (long-lived
 * APP_OWNER_JWT and APP_IDENTITY_TOKEN) was found inside two Vercel
 * deployment sources (2026-11-26). Run against the exact directory that will
 * be uploaded:
 *
 *   node scripts/deploy-preflight.mjs <dir>
 *
 * Exits 1 and lists offending paths (never their contents) when anything
 * matches. Findings report the rule and the path only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** File names that must never be uploaded, whatever they contain. */
const FORBIDDEN_NAMES = [
  { rule: 'deepspace-dev-vars', test: (n) => n === '.dev.vars' || n.startsWith('.dev.vars.') },
  { rule: 'dotenv', test: (n) => (n === '.env' || n.startsWith('.env.')) && n !== '.env.example' },
  { rule: 'local-override', test: (n) => n.endsWith('.local') },
  { rule: 'test-account-store', test: (n) => n === 'test-accounts.json' },
  { rule: 'private-key-file', test: (n) => /\.(pem|key|p12|pfx)$/i.test(n) || /^id_(rsa|ecdsa|ed25519)(\.pub)?$/.test(n) },
  { rule: 'cloud-credentials', test: (n) => n === 'credentials.json' || n === '.npmrc' || n === '.netrc' },
]

/** Directories that hold tool state or credential caches. */
const FORBIDDEN_DIRS = new Set(['.deepspace', '.wrangler', '.vercel-local', '.remember', '.claude', 'playwright-states'])

/** Credential-shaped content. Matches are reported by rule only. */
const FORBIDDEN_CONTENT = [
  { rule: 'deepspace-app-credential', re: /^[ \t]*(?:APP_OWNER_JWT|APP_IDENTITY_TOKEN)[ \t]*=[ \t]*\S{16}/m },
  { rule: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { rule: 'signed-jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/ },
]

const SKIP_DIRS = new Set(['node_modules', '.git'])
const MAX_TEXT_BYTES = 2 * 1024 * 1024

/**
 * Pure check over a list of files. `read(path)` returns text or null for
 * binary or oversized files. Returns findings as { path, rule }.
 */
export function findProhibited(paths, read = () => null) {
  const findings = []
  for (const path of paths) {
    const parts = path.split(/[\\/]/)
    const name = parts[parts.length - 1]
    const dir = parts.slice(0, -1).find((p) => FORBIDDEN_DIRS.has(p))
    if (dir) {
      findings.push({ path, rule: `tool-state-dir:${dir}` })
      continue
    }
    const byName = FORBIDDEN_NAMES.find((r) => r.test(name))
    if (byName) {
      findings.push({ path, rule: byName.rule })
      continue
    }
    const text = read(path)
    if (text == null) continue
    const byContent = FORBIDDEN_CONTENT.find((r) => r.re.test(text))
    if (byContent) findings.push({ path, rule: byContent.rule })
  }
  return findings
}

/** Lists every file under `root` (relative, forward slashes), skipping node_modules and .git. */
export function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else out.push(relative(root, full).split(sep).join('/'))
    }
  }
  walk(root)
  return out
}

function readText(root) {
  return (path) => {
    const full = join(root, path)
    if (statSync(full).size > MAX_TEXT_BYTES) return null
    const buf = readFileSync(full)
    if (buf.includes(0)) return null // binary
    return buf.toString('utf8')
  }
}

export function preflight(root) {
  return findProhibited(listFiles(root), readText(root))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] ?? '.'
  const findings = preflight(root)
  if (findings.length) {
    console.error(`Deployment preflight FAILED: ${findings.length} prohibited file(s) in ${root}`)
    for (const f of findings) console.error(`  ${f.rule}: ${f.path}`)
    process.exit(1)
  }
  console.log(`Deployment preflight passed: no secret-bearing files in ${root}`)
}
