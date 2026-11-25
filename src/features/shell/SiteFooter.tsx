import { Link } from 'react-router-dom'
import { CANONICAL_URL, IS_STANDALONE, REPO_URL, STANDALONE_URL } from '@/lib/target'
import { Wordmark } from '../brand/Logo'

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center">
        <Wordmark />
        <p className="sm:ml-4">Open source under the MIT license. Synthetic demo data is labeled everywhere it appears.</p>
        <nav className="flex flex-wrap gap-4 sm:ml-auto" aria-label="Footer">
          <Link to="/docs" className="hover:text-foreground">Docs</Link>
          <a href={REPO_URL} className="hover:text-foreground">GitHub</a>
          {IS_STANDALONE ? <a href={CANONICAL_URL} className="hover:text-foreground">Full app (DeepSpace)</a> : <a href={STANDALONE_URL} className="hover:text-foreground">Standalone demo</a>}
        </nav>
      </div>
    </footer>
  )
}
