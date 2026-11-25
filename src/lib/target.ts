declare const __FAULTLINE_TARGET__: 'deepspace' | 'vercel' | undefined

/** Which deployment this bundle was built for. */
export const TARGET: 'deepspace' | 'vercel' = typeof __FAULTLINE_TARGET__ === 'string' ? __FAULTLINE_TARGET__ : 'deepspace'

export const IS_STANDALONE = TARGET === 'vercel'

/** Canonical full-stack deployment (DeepSpace). Verified after deploy. */
export const CANONICAL_URL = 'https://faultline.app.space'

/** Secondary standalone demo (Vercel). */
export const STANDALONE_URL = 'https://faultline.vercel.app'

export const REPO_URL = 'https://github.com/shikharsisodia7/faultline'
