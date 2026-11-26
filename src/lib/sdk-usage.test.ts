import { describe, expect, it } from 'vitest'

/**
 * Guards against a production bug found on 2026-11-26: six call sites cast the
 * result of the SDK's `useAuth()` (`as { user?: ... }`). In deepspace 0.44.2
 * `useAuth()` returns `{ isLoaded, isSignedIn, userId, sessionId }` and has no
 * `user`, so the casts hid a type error and `user.id` was always undefined:
 * signed-in users never got a personal workspace and could not import evidence.
 * Use the SDK's own types (`useAuth().userId`, `useAuthUser().user`) instead.
 */
const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true })

describe('DeepSpace SDK usage', () => {
  it('scans the app sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  it('never type-casts auth hook results (the compiler must check them)', () => {
    const offenders = Object.entries(sources).filter(([, text]) => /\buseAuth(User)?\(\)\s+as\b/.test(text)).map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
