/**
 * Public-page SEO. Read by <Seo> at runtime and by prerender.ts at build.
 */

/** Injected by prerender.ts. Absent in unit tests, hence the guard. */
declare const __DEEPSPACE_SITE_ORIGIN__: string | undefined

export const seo = {
  title: 'Faultline: the flight recorder for software',
  description:
    'Faultline is a flight recorder for software: replay a failure from its logs and explore what could have happened differently. Try the demo without an account.',
  origin: typeof __DEEPSPACE_SITE_ORIGIN__ === 'string' ? __DEEPSPACE_SITE_ORIGIN__ : 'http://localhost',
  ogImage: '/og.png',
  noindex: false,
}
