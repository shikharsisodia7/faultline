import { Link } from 'react-router-dom'
import { ArrowRight, FlaskConical, Upload } from 'lucide-react'
import { useAuthUser, useQuery } from 'deepspace'
import { DEMO_SCENARIOS } from '@faultline/engine'
import { KindTag } from '../shell/atoms'
import type { IncidentRecord } from './useCloudIncident'

/** Where a visitor starts: continue, import, learn from examples, or experiment. */
export function AppHome() {
  const { isSignedIn, user } = useAuthUser()
  const incidents = useQuery<IncidentRecord>('incidents', { orderBy: 'updatedAt', orderDir: 'desc', limit: 5 })
  const recent = isSignedIn ? incidents.records : []
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <title>Home · Faultline</title>
      <p className="fl-eyebrow">Home</p>
      <h1 className="mt-3 text-[34px] font-normal leading-tight text-foreground">{isSignedIn && user?.firstName ? `Welcome back, ${user.firstName}.` : 'Where would you like to start?'}</h1>

      {recent.length ? (
        <section className="mt-10" aria-labelledby="continue">
          <h2 id="continue" className="text-[15px] font-medium text-foreground">Continue an investigation</h2>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
            {recent.map((r) => (
              <li key={r.recordId}>
                <Link to={`/incidents/${r.recordId}`} className="flex items-center gap-3 px-5 py-4 hover:bg-background">
                  <span className="min-w-0 flex-1 truncate text-[15.5px] text-foreground">{r.data.title}</span>
                  {r.data.synthetic ? <KindTag kind="synthetic" /> : null}
                  <span className="text-[13px] text-muted-foreground">{r.data.eventCount ?? 0} events</span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10 grid gap-4 md:grid-cols-2" aria-label="Start something new">
        <Link to="/incidents/new" className="group rounded-2xl border border-border bg-white p-6 transition-shadow hover:shadow-[0_8px_30px_-12px_rgba(31,29,26,0.2)]">
          <Upload className="size-5 text-[var(--color-primary)]" />
          <h2 className="mt-4 text-[19px] font-medium text-foreground">Analyze your own incident</h2>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">Bring the logs or traces you have. Faultline builds a timeline and suggests where the trouble started.</p>
        </Link>
        <Link to="/lab" className="group rounded-2xl border border-border bg-white p-6 transition-shadow hover:shadow-[0_8px_30px_-12px_rgba(31,29,26,0.2)]">
          <FlaskConical className="size-5 text-[var(--color-sim)]" />
          <h2 className="mt-4 text-[19px] font-medium text-foreground">Open the experiment lab</h2>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">Pick a system you recognize, break it on purpose, and see which decisions help.</p>
        </Link>
      </section>

      <section className="mt-12" aria-labelledby="examples">
        <h2 id="examples" className="text-[15px] font-medium text-foreground">Explore example incidents</h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {DEMO_SCENARIOS.map((d) => (
            <li key={d.slug}>
              <Link to={`/demo/${d.slug}`} className="block h-full rounded-2xl border border-border bg-card p-5 hover:bg-white">
                <span className="text-[12.5px] text-muted-foreground">Synthetic example</span>
                <span className="mt-2 block text-[16px] font-medium text-foreground">{d.plain.headline}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
