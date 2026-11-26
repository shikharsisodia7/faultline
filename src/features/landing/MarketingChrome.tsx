import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fullAppHref, IS_STANDALONE, REPO_URL } from '@/lib/target'
import { Wordmark } from '../brand/Logo'

const LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#use-cases', label: 'Use cases' },
  { href: '/docs', label: 'Documentation' },
]

/** Minimal marketing navigation (static pages: no auth providers needed). */
export function MarketingNav() {
  const [open, setOpen] = useState(false)
  const signIn = fullAppHref('/home')
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5">
        <Link to="/" aria-label="Faultline home" className="rounded-md"><Wordmark /></Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-[14.5px] text-muted-foreground transition-colors hover:text-foreground">{l.label}</a>
          ))}
          <a href={REPO_URL} className="text-[14.5px] text-muted-foreground transition-colors hover:text-foreground">GitHub</a>
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {signIn ? <a href={signIn} className="fl-btn-quiet inline-flex h-9 items-center rounded-lg px-3.5 text-[14px]">Sign in</a> : null}
          <Link to="/demo" className="fl-cta inline-flex h-9 items-center rounded-lg px-3.5 text-[14px] font-medium">Try the demo</Link>
        </div>
        <button type="button" className="ml-auto inline-flex size-10 items-center justify-center rounded-lg md:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <nav aria-label="Mobile" className="border-b border-border bg-background px-5 pb-5 md:hidden">
          {[...LINKS, { href: REPO_URL, label: 'GitHub' }].map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block border-b border-border/60 py-3.5 text-[16px] text-foreground">{l.label}</a>
          ))}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {signIn ? <a href={signIn} className="fl-btn-quiet inline-flex h-11 items-center justify-center rounded-xl text-[15px]">Sign in</a> : <span />}
            <Link to="/demo" className="fl-cta inline-flex h-11 items-center justify-center rounded-xl text-[15px] font-medium">Try the demo</Link>
          </div>
        </nav>
      ) : null}
    </header>
  )
}

const COLS = [
  { h: 'Product', items: [{ l: 'Live demo', to: '/demo' }, { l: 'Experiment lab', to: '/lab' }, { l: 'How it works', to: '/#how' }] },
  { h: 'Learn', items: [{ l: 'Documentation', to: '/docs' }, { l: 'Simulation methodology', to: '/docs/simulation' }, { l: 'Architecture', to: '/docs/architecture' }] },
  { h: 'Project', items: [{ l: 'GitHub', to: REPO_URL }, { l: 'About this project', to: '/docs/project' }, { l: 'Security', to: '/docs/security' }, { l: 'Privacy', to: '/docs/privacy' }] },
]

export function MarketingFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t border-border', className)}>
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.2fr_repeat(3,0.6fr)]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-muted-foreground">The flight recorder for software. Open source under the MIT license.</p>
          <p className="mt-3 max-w-xs text-[12.5px] text-faint">Demo incidents are synthetic and labeled wherever they appear.</p>
        </div>
        {COLS.map((c) => (
          <nav key={c.h} aria-label={c.h}>
            <h3 className="text-[13px] text-muted-foreground">{c.h}</h3>
            <ul className="mt-3 space-y-2.5">
              {c.items.map((i) => (
                <li key={i.l}>
                  {i.to.startsWith('http') || i.to.startsWith('/#') ? <a href={i.to} className="text-[14.5px] text-foreground/85 hover:text-foreground">{i.l}</a> : <Link to={i.to} className="text-[14.5px] text-foreground/85 hover:text-foreground">{i.l}</Link>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 border-t border-border px-5 py-5 text-[12.5px] text-muted-foreground">
        <span>Faultline · built on DeepSpace</span>
        {IS_STANDALONE && fullAppHref() ? <a href={fullAppHref()!} className="hover:text-foreground">Full app on DeepSpace</a> : <span>Every failure has a timeline.</span>}
      </div>
    </footer>
  )
}
