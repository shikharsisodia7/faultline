import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards against a production bug found on 2026-11-26: six call sites cast the
 * result of the SDK's `useAuth()` (`as { user?: ... }`). In deepspace 0.44.2
 * `useAuth()` returns `{ isLoaded, isSignedIn, userId, sessionId }` and has no
 * `user`, so the casts hid a type error and `user.id` was always undefined:
 * signed-in users never got a personal workspace and could not import evidence.
 * Use the SDK's own types (`useAuth().userId`, `useAuthUser().user`) instead.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [p] : []
  })
}

describe('DeepSpace SDK usage', () => {
  it('never type-casts auth hook results (the compiler must check them)', () => {
    const offenders = sources(join(process.cwd(), 'src')).filter((f) => /\buseAuth(User)?\(\)\s+as\b/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
