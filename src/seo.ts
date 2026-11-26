/**
 * Public-page SEO. Read by <Seo> at runtime and by prerender.ts at build.
 */

/** Injected by prerender.ts. Absent in unit tests, hence the guard. */
declare const __DEEPSPACE_SITE_ORIGIN__: string | undefined

export const seo = {
  title: 'Faultline | Incident replay and counterfactual simulation',
  description:
    'Reconstruct an incident from logs and traces, replay it, see ranked and explained root-cause hypotheses, and simulate how a different intervention could have changed the outcome.',
  origin: typeof __DEEPSPACE_SITE_ORIGIN__ === 'string' ? __DEEPSPACE_SITE_ORIGIN__ : 'http://localhost',
  ogImage: '/og.png',
  noindex: false,
}
