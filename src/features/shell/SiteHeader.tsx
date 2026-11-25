import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Wordmark } from '../brand/Logo'
import { cn } from '@/lib/utils'
import { CANONICAL_URL, IS_STANDALONE, REPO_URL } from '@/lib/target'

export interface NavEntry {
  to: string
  label: string
}

export const PUBLIC_NAV: NavEntry[] = [
  { to: '/demo', label: 'Demo' },
  { to: '/lab', label: 'Chaos lab' },
  { to: '/compare', label: 'Compare' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/docs', label: 'Docs' },
]

/** Header for public pages (no DeepSpace providers required). */
export function SiteHeader({ extra, nav = PUBLIC_NAV, compact = false }: { extra?: React.ReactNode; nav?: NavEntry[]; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <header className={cn('sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur', compact ? 'h-11' : 'h-14')}>
      <div className={cn('mx-auto flex h-full items-center gap-6 px-4', compact ? 'max-w-none' : 'max-w-6xl')}>
        <Link to="/" className="shrink-0 rounded-sm" aria-label="Faultline home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn('rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground', isActive && 'bg-secondary text-foreground')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {extra}
          {IS_STANDALONE ? (
            <a href={CANONICAL_URL} className="rounded-md border border-border px-2.5 py-1.5 text-[13px] text-foreground hover:bg-secondary">
              Full app on DeepSpace
            </a>
          ) : null}
          <a href={REPO_URL} className="rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <button
          type="button"
          className="ml-auto inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <nav aria-label="Mobile" className="border-b border-border bg-background px-4 pb-3 md:hidden">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)} className="block rounded-md px-2 py-2.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
              {n.label}
            </NavLink>
          ))}
          {extra ? <div className="mt-2 flex flex-wrap gap-2">{extra}</div> : null}
          {IS_STANDALONE ? (
            <a href={CANONICAL_URL} className="mt-2 block rounded-md border border-border px-2 py-2.5 text-sm">Full app on DeepSpace</a>
          ) : null}
        </nav>
      ) : null}
    </header>
  )
}
