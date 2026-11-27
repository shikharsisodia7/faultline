/**
 * Vercel "Ignored Build Step" (vercel.json `ignoreCommand`).
 * Exit 0 = skip this build, exit 1 = build.
 *
 * Skips commits that cannot change the standalone demo: autosave checkpoints,
 * and commits that only touch files the Vercel build never reads. Anything
 * uncertain builds, so intentional changes always deploy.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Paths the standalone (Vercel) build reads. Changes elsewhere cannot affect it. */
const BUILD_INPUTS = [
  /^src\//, /^packages\//, /^public\//, /^docs\/[^/]+\.md$/, /^SECURITY\.md$/,
  /^package(-lock)?\.json$/, /^vite\.vercel\.config\.ts$/, /^tsconfig\.json$/, /^postcss\.config\.js$/,
  /^vercel\.json$/, /^\.vercelignore$/, /^scripts\/vercel-ignore-build\.mjs$/,
]

/** Returns true when the build should be skipped. `files` = null means unknown (so build). */
export function shouldSkipBuild(message, files) {
  if (/^WIP checkpoint\b/.test(message ?? '')) return true
  if (!files || files.length === 0) return false
  return files.every((f) => !BUILD_INPUTS.some((re) => re.test(f)))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const message = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? ''
  let files = null
  try {
    const prev = process.env.VERCEL_GIT_PREVIOUS_SHA || 'HEAD^'
    // Runs only on Vercel's Linux build image. Call git by absolute path so
    // nothing is resolved through PATH; if it is missing, the catch builds.
    files = execFileSync('/usr/bin/git', ['diff', '--name-only', prev, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    files = null // shallow clone or first deploy: build to be safe
  }
  const skip = shouldSkipBuild(message, files)
  console.log(skip ? 'Skipping build: no change to the standalone demo.' : 'Building.')
  process.exit(skip ? 0 : 1)
}
