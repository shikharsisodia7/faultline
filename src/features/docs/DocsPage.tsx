import { Link, NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { REPO_URL } from '@/lib/target'
import { SiteHeader } from '../shell/SiteHeader'
import { SiteFooter } from '../shell/SiteFooter'
import { Markdown } from './Markdown'
import architecture from '../../../docs/ARCHITECTURE.md?raw'
import normalization from '../../../docs/NORMALIZATION.md?raw'
import correlation from '../../../docs/CORRELATION.md?raw'
import replay from '../../../docs/REPLAY.md?raw'
import simulation from '../../../docs/SIMULATION.md?raw'
import dataModel from '../../../docs/DATA-MODEL.md?raw'
import deployment from '../../../docs/DEPLOYMENT.md?raw'
import testing from '../../../docs/TESTING.md?raw'
import tradeoffs from '../../../docs/TRADEOFFS.md?raw'
import privacy from '../../../docs/PRIVACY.md?raw'
import security from '../../../SECURITY.md?raw'
import project from '../../../docs/PROJECT.md?raw'

export const DOCS = [
  { slug: 'architecture', title: 'Architecture', file: 'ARCHITECTURE.md', source: architecture },
  { slug: 'normalization', title: 'Event normalization', file: 'NORMALIZATION.md', source: normalization },
  { slug: 'correlation', title: 'Correlation & ranking', file: 'CORRELATION.md', source: correlation },
  { slug: 'replay', title: 'Replay', file: 'REPLAY.md', source: replay },
  { slug: 'simulation', title: 'Simulation methodology', file: 'SIMULATION.md', source: simulation },
  { slug: 'data-model', title: 'Data model & permissions', file: 'DATA-MODEL.md', source: dataModel },
  { slug: 'deployment', title: 'Deployment', file: 'DEPLOYMENT.md', source: deployment },
  { slug: 'testing', title: 'Testing', file: 'TESTING.md', source: testing },
  { slug: 'tradeoffs', title: 'Tradeoffs & limitations', file: 'TRADEOFFS.md', source: tradeoffs },
  { slug: 'privacy', title: 'Privacy', file: 'PRIVACY.md', source: privacy },
  { slug: 'security', title: 'Security', file: '../SECURITY.md', source: security },
  { slug: 'project', title: 'About this project', file: 'PROJECT.md', source: project },
] as const

const byFile = new Map<string, string>(DOCS.map((d) => [d.file, d.slug]))

/** Maps repository links (`docs/X.md`, `X.md#anchor`) to in-app routes or GitHub. */
function resolve(href: string): string | null {
  const m = /^(?:\.\.\/|\.\/)?(?:docs\/)?([A-Z-]+\.md)(#.*)?$/.exec(href)
  if (!m) return null
  const slug = byFile.get(m[1])
  return slug ? `/docs/${slug}${m[2] ?? ''}` : `${REPO_URL}/blob/main/docs/${m[1]}`
}

export function DocsPage({ slug }: { slug?: string }) {
  const doc = DOCS.find((d) => d.slug === slug) ?? DOCS[0]
  const unknown = Boolean(slug) && !DOCS.some((d) => d.slug === slug)
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 px-4 py-8 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Documentation" className="md:sticky md:top-20 md:self-start">
          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">Documentation</p>
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {DOCS.map((d) => (
              <li key={d.slug} className="shrink-0">
                <NavLink to={`/docs/${d.slug}`} className={({ isActive }) => cn('block rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground', (isActive || (!slug && d.slug === 'architecture')) && 'bg-secondary text-foreground')}>
                  {d.title}
                </NavLink>
              </li>
            ))}
          </ul>
          <a href={`${REPO_URL}/blob/main/${doc.file.startsWith('../') ? doc.file.slice(3) : `docs/${doc.file}`}`} className="mt-4 hidden text-[12px] text-muted-foreground hover:text-foreground md:block" target="_blank" rel="noreferrer">View source on GitHub</a>
        </nav>
        <article className="min-w-0 max-w-3xl text-[14px]">
          {unknown ? <p className="mb-4 rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground">No page called “{slug}”. Showing the architecture overview. <Link to="/docs" className="underline">Docs home</Link></p> : null}
          <Markdown source={doc.source} resolve={resolve} />
        </article>
      </main>
      <SiteFooter />
    </div>
  )
}
