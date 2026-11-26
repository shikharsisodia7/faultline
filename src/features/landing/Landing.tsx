import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { DemoDirectory } from '../demo/DemoDirectory'
import { KindTag } from '../shell/atoms'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { IS_STANDALONE, CANONICAL_URL } from '@/lib/target'

const STAGES = [
  {
    n: '01',
    title: 'Normalize',
    body: 'JSON, NDJSON, CSV, plain-text logs, and OpenTelemetry exports become one canonical event model. Timestamps go to UTC, duplicates are reported, secrets are redacted, and malformed records are kept in an error report with line numbers instead of disappearing.',
    detail: 'stable content ids · idempotent re-import',
    href: '/docs/normalization',
  },
  {
    n: '02',
    title: 'Correlate',
    body: 'An indexed, deterministic engine links events through shared traces, parent spans, requests, deployments, and the dependency graph. Every edge carries its evidence signals and a plain-language explanation.',
    detail: 'noisy-OR evidence × temporal decay · no LLM',
    href: '/docs/correlation',
  },
  {
    n: '03',
    title: 'Replay',
    body: 'Scrub to any instant and see each service the way it was. State is derived from immutable evidence by a pure reducer with checkpoints, so seeking backward always restores the same picture.',
    detail: 'binary-searched index · snapshot-equivalent',
    href: '/docs/replay',
  },
  {
    n: '04',
    title: 'Simulate',
    body: 'Branch from any moment, roll back the deploy, resize the pool, or turn on a breaker, then run a seeded discrete-event model of the system. Results come with their assumptions, and worse outcomes are shown as plainly as better ones.',
    detail: 'queues · timeouts · retries · breakers · rate limits',
    href: '/docs/simulation',
  },
]

export function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-border">
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.55]" preserveAspectRatio="none" viewBox="0 0 1200 520">
            <g stroke="var(--color-grid)" strokeWidth="1">
              {Array.from({ length: 12 }, (_, i) => <path key={`v${i}`} d={`M${i * 100} 0V520`} />)}
              {Array.from({ length: 6 }, (_, i) => <path key={`h${i}`} d={`M0 ${i * 100}H1200`} />)}
            </g>
            <path d="M0 450h420l18-20 16 44 18-96 22 118 16-70 14 24h176" fill="none" stroke="var(--color-faint)" strokeWidth="1.5" />
            <path d="M760 480h30l14-18 16 52 20-88 18 72 14-30 14 12h314" fill="none" stroke="var(--color-faint)" strokeWidth="1.5" opacity=".7" />
            <path d="M770 480h430" fill="none" stroke="var(--color-sim)" strokeWidth="1.5" strokeDasharray="6 6" opacity=".55" />
            <path d="M815 20 690 500" stroke="var(--color-fault)" strokeWidth="2" opacity=".85" />
          </svg>
          <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:pt-24">
            <p className="mb-5 font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">Incident intelligence for distributed systems</p>
            <h1 className="max-w-3xl text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-[56px]">
              Every failure has a timeline.
            </h1>
            <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-muted-foreground">
              Faultline reconstructs an incident from its evidence, lets you travel back through it, and asks a better question than “what happened”:
              <span className="text-foreground"> what would have happened if you had acted differently?</span>
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/demo/checkout-cascade" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">
                Open a live incident <ArrowRight className="size-4" />
              </Link>
              <Link to="/lab" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[14px] text-foreground hover:bg-secondary">
                Break something in the lab
              </Link>
              <span className="font-mono text-[12px] text-muted-foreground">No account, no API key.</span>
            </div>
            {IS_STANDALONE ? (
              <p className="mt-6 max-w-2xl rounded-md border border-border bg-card px-3 py-2 text-[12.5px] text-muted-foreground">
                This is the standalone demo build: the same engines and interface with browser-local storage. Accounts, uploads, background ingestion and real-time collaboration live in the{' '}
                <a href={CANONICAL_URL} className="text-foreground underline underline-offset-2">full application on DeepSpace</a>.
              </p>
            ) : null}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="how">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <h2 id="how" className="text-[22px] font-semibold tracking-[-0.02em] text-foreground">From raw logs to a different future</h2>
            <p className="max-w-md text-[13px] text-muted-foreground">Four engines, all deterministic, all tested, all running in your browser for the demo.</p>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
            {STAGES.map((s) => (
              <li key={s.n} className="bg-background p-5">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[12px] text-[var(--color-fault)]">{s.n}</span>
                  <h3 className="text-[16px] font-semibold text-foreground">{s.title}</h3>
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{s.body}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11.5px] text-faint">{s.detail}</span>
                  <Link to={s.href} className="font-mono text-[12px] text-foreground hover:underline">How it works →</Link>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-border bg-card/40" aria-labelledby="demos">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <h2 id="demos" className="text-[22px] font-semibold tracking-[-0.02em] text-foreground">Three incidents to take apart</h2>
              <p className="max-w-md text-[13px] text-muted-foreground">Each was produced by running the simulator, so its logs, traces, alerts and counterfactual baseline agree by construction.</p>
            </div>
            <DemoDirectory />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="honest">
          <h2 id="honest" className="text-[22px] font-semibold tracking-[-0.02em] text-foreground">Honest about what it knows</h2>
          <p className="mt-2 max-w-2xl text-[13.5px] text-muted-foreground">Correlation is not causation, and a simulation is not a prediction. Every claim in the interface is labeled with where it came from.</p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { k: 'observed' as const, d: 'An event that exists in the evidence, traceable to a file and line.' },
              { k: 'inferred' as const, d: 'A correlation or hypothesis computed from evidence, with its score explained.' },
              { k: 'human' as const, d: 'A note, review, or confirmation made by a responder.' },
              { k: 'simulated' as const, d: 'An outcome from the model, shown with its parameters and assumptions.' },
            ].map((x) => (
              <div key={x.k} className="rounded-md border border-border p-4">
                <dt><KindTag kind={x.k} /></dt>
                <dd className="mt-2 text-[13px] text-muted-foreground">{x.d}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
