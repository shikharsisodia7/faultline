import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { DEMO_SCENARIOS } from '@faultline/engine'

/** The synthetic example incidents, plain-language first. Static content (prerender-safe). */
export function DemoDirectory() {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {DEMO_SCENARIOS.map((d) => (
        <li key={d.slug}>
          <Link
            to={`/demo/${d.slug}`}
            className="group flex h-full flex-col rounded-2xl border border-border bg-white p-6 transition-shadow hover:shadow-[0_8px_30px_-12px_rgba(31,29,26,0.2)]"
          >
            <span className="text-[12.5px] text-muted-foreground">Synthetic example · {d.title}</span>
            <h2 className="mt-3 text-[20px] font-normal leading-snug text-foreground">{d.plain.headline}</h2>
            <p className="mt-3 flex-1 text-[14.5px] leading-relaxed text-muted-foreground">{d.tagline}</p>
            <span className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--color-primary)]">
              Explore what happened <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
