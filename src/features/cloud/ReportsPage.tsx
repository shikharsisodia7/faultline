import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { useAuth, useQuery } from 'deepspace'
import { DEMO_SCENARIOS } from '@faultline/engine'
import { KindTag } from '../shell/atoms'
import type { IncidentRecord } from './useCloudIncident'

/** Readable incident reports: one per incident, generated from its evidence. */
export function ReportsPage() {
  const { isSignedIn } = useAuth()
  const incidents = useQuery<IncidentRecord>('incidents', { orderBy: 'updatedAt', orderDir: 'desc' })
  const mine = isSignedIn ? incidents.records.filter((r) => (r.data.eventCount ?? 0) > 0) : []
  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <title>Reports · Faultline</title>
      <p className="fl-eyebrow">Reports</p>
      <h1 className="mt-3 text-[34px] font-normal leading-tight text-foreground">Incident reports</h1>
      <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-muted-foreground">
        Each report is written from the incident’s evidence: what happened, the impact, possible causes with their status, and what to change. Unconfirmed causes are never presented as the root cause. Export as Markdown or JSON, or print to PDF.
      </p>

      <section className="mt-10" aria-labelledby="yours">
        <h2 id="yours" className="text-[15px] font-medium text-foreground">Your incidents</h2>
        {!isSignedIn ? (
          <p className="mt-3 text-[14.5px] text-muted-foreground">Sign in to see reports for incidents in your workspaces.</p>
        ) : incidents.status === 'loading' ? (
          <p role="status" className="mt-3 text-[14px] text-muted-foreground">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="mt-3 text-[14.5px] text-muted-foreground">No incidents with evidence yet. <Link to="/incidents/new" className="underline">Import one</Link> to get a report.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
            {mine.map((r) => (
              <li key={r.recordId}>
                <Link to={`/incidents/${r.recordId}?view=report`} className="flex items-center gap-3 px-5 py-4 hover:bg-background">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[15.5px] text-foreground">{r.data.title}</span>
                  {r.data.synthetic ? <KindTag kind="synthetic" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="ex">
        <h2 id="ex" className="text-[15px] font-medium text-foreground">Example reports</h2>
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {DEMO_SCENARIOS.map((d) => (
            <li key={d.slug}>
              <Link to={`/demo/${d.slug}?mode=engineering&tab=postmortem`} className="flex items-center gap-3 px-5 py-4 hover:bg-white">
                <FileText className="size-4 text-muted-foreground" />
                <span className="flex-1 text-[15.5px] text-foreground">{d.title}</span>
                <span className="text-[12.5px] text-muted-foreground">synthetic</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
