/**
 * Manual Vercel production deploy from tracked source only.
 *
 * Normal production deploys come from Vercel's GitHub integration, which
 * builds from the repository (never local files). Use this only when a manual
 * deploy is needed. It exports HEAD with `git archive` into a temporary folder
 * OUTSIDE the repository (so local secrets such as .dev.vars are physically
 * absent, and the Vercel CLI cannot pick up a parent .vercel link), runs the
 * secret preflight on that folder, and prints the deploy command for it.
 *
 *   npm run deploy:vercel
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preflight } from './deploy-preflight.mjs'

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()

if (sh('git', ['status', '--porcelain'])) {
  console.error('Refusing to deploy: the working tree has uncommitted changes. Commit first; only HEAD is deployed.')
  process.exit(1)
}
const sha = sh('git', ['rev-parse', '--short', 'HEAD'])
const dir = mkdtempSync(join(tmpdir(), `faultline-vercel-${sha}-`))
try {
  const tar = join(dir, '..', `faultline-${sha}.tar`)
  sh('git', ['archive', '--format=tar', '-o', tar, 'HEAD'])
  sh('tar', ['-xf', tar, '-C', dir])
  rmSync(tar, { force: true })
  mkdirSync(join(dir, '.vercel'))
  copyFileSync('.vercel/project.json', join(dir, '.vercel', 'project.json'))

  const findings = preflight(dir).filter((f) => f.path !== '.vercel/project.json')
  if (findings.length) {
    console.error('Deployment preflight FAILED; nothing was uploaded:')
    for (const f of findings) console.error(`  ${f.rule}: ${f.path}`)
    process.exit(1)
  }
  // The upload is left to the person deploying: this script never launches
  // the Vercel CLI (no PATH lookup or shell for it from here).
  console.log(`Preflight passed for ${sha}: ${dir} contains tracked source only.`)
  console.log(`Deploy it with:\n  vercel deploy --prod --yes --cwd "${dir}"\nthen delete that folder.`)
} catch (err) {
  rmSync(dir, { recursive: true, force: true })
  throw err
}
