declare const __FAULTLINE_TARGET__: 'deepspace' | 'vercel' | undefined

/** Which deployment this bundle was built for. */
export const TARGET: 'deepspace' | 'vercel' = typeof __FAULTLINE_TARGET__ === 'string' ? __FAULTLINE_TARGET__ : 'deepspace'

export const IS_STANDALONE = TARGET === 'vercel'

/**
 * Verified URL of the canonical full-stack deployment (DeepSpace), injected at
 * build time with VITE_CANONICAL_URL. Null until a deployment has actually been
 * verified, so the standalone build never links to an address that is not live.
 */
const envCanonical = (import.meta.env?.VITE_CANONICAL_URL as string | undefined)?.replace(/\/$/, '')
export const CANONICAL_URL: string | null = envCanonical || null

/** Link to the full app: same-origin inside the DeepSpace build, the verified URL in the standalone build. */
export function fullAppHref(path = '/'): string | null {
  if (!IS_STANDALONE) return path
  return CANONICAL_URL ? `${CANONICAL_URL}${path}` : null
}

export const REPO_URL = 'https://github.com/shikharsisodia7/faultline'
