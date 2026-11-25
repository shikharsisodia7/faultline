import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { DEMO_SCENARIOS } from '@faultline/engine'
import { KindTag } from '../shell/atoms'

/** The list of synthetic demo incidents. Pure static content (prerender-safe). */
export function DemoDirectory() {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {DEMO_SCENARIOS.map((d) => (
        <li key={d.slug}>
          <Link to={`/demo/${d.slug}`} className="group grid gap-3 bg-card px-4 py-4 transition-colors hover:bg-secondary sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] uppercase text-[var(--color-fault)]">{d.severity}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{d.category}</span>
                <KindTag kind="synthetic" />
              </div>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{d.title}</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{d.tagline}</p>
              <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground/90">{d.summary}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] text-foreground">
              Open incident <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
