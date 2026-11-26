/**
 * Navigation Config
 *
 * Add one entry per nav item. Routes are handled by generouted
 * (file-based routing in src/pages/), this just controls what
 * appears in the navigation bar.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/incidents', label: 'Incidents' },
  { path: '/demo', label: 'Demo' },
  { path: '/lab', label: 'Chaos lab' },
  { path: '/compare', label: 'Compare' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/docs', label: 'Docs' },
  { path: '/settings', label: 'Settings' },
  // The /api-status debug page still exists — add
  // `{ path: '/api-status', label: 'API Status', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]
