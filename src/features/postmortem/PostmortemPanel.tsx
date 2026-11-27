import { useMemo } from 'react'
import { Download, FileJson, Printer } from 'lucide-react'
import type { Hypothesis, HypothesisReview, IncidentDataset } from '@faultline/engine'
import { generatePostmortem, postmortemToMarkdown, type SimulationFinding } from '@faultline/engine'
import { Button } from '@/components/ui'
import { downloadText, duration, relTime } from '@/lib/format'
import { KindTag } from '../shell/atoms'

interface Props {
  dataset: IncidentDataset
  hypotheses: Hypothesis[]
  reviews: Record<string, HypothesisReview>
  simulations: SimulationFinding[]
  onSelectEvent?: (id: string) => void
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function PostmortemPanel({ dataset, hypotheses, reviews, simulations, onSelectEvent }: Props) {
  // Generation time is fixed at render so exports are reproducible within a view.
  const generatedAt = useMemo(() => Date.now(), [])
  const pm = useMemo(() => generatePostmortem({ dataset, hypotheses, reviews, simulations, generatedAt }), [dataset, hypotheses, reviews, simulations, generatedAt])
  const start = dataset.events[0]?.ts ?? 0
  const base = `incident-report-${slug(dataset.meta.title)}`

  return (
    <div className="h-full min-h-0 overflow-y-auto" data-tour="postmortem">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <span className="text-[12px] text-muted-foreground">Generated deterministically from the incident data. No AI involved.</span>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" className="h-8" onClick={() => downloadText(`${base}.md`, postmortemToMarkdown(pm), 'text/markdown')}>
            <Download className="size-3.5" /> Markdown
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => downloadText(`${base}.json`, JSON.stringify(pm, null, 2), 'application/json')}>
            <FileJson className="size-3.5" /> JSON
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => window.print()}>
            <Printer className="size-3.5" /> Print / PDF
          </Button>
        </div>
      </div>
      <article className="print-doc mx-auto max-w-3xl px-5 py-6 text-[13.5px] leading-relaxed">
        <header className="mb-6">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pm.synthetic ? <KindTag kind="synthetic" /> : null}
            <span className="font-mono text-[11px] text-muted-foreground">{pm.version}</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">Incident report: {pm.title}</h1>
          <p className="mt-2 text-muted-foreground">{pm.executiveSummary}</p>
        </header>

        <Section title="Duration and impact">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[12px] sm:grid-cols-3">
            <Stat k="Started" v={pm.duration.startedAt?.replace('T', ' ').slice(0, 19) ?? 'unknown'} />
            <Stat k="Detected" v={pm.duration.detectedAt?.replace('T', ' ').slice(0, 19) ?? 'unknown'} />
            <Stat k="Resolved" v={pm.duration.resolvedAt?.replace('T', ' ').slice(0, 19) ?? 'unknown'} />
            <Stat k="Duration" v={duration(pm.duration.durationSec)} />
            <Stat k="Time to detect" v={duration(pm.duration.timeToDetectSec)} />
            <Stat k="Error events" v={`${pm.impact.errorEvents} (${pm.impact.criticalEvents} critical)`} />
          </dl>
          <p className="mt-2 text-muted-foreground">Affected services: {pm.impact.affectedServices.join(', ') || 'none recorded'}.</p>
        </Section>

        <Section title="Timeline (UTC)">
          <ol className="space-y-1">
            {pm.timeline.map((t, i) => (
              <li key={i} className="grid grid-cols-[92px_1fr] gap-2">
                <span className="font-mono text-[11.5px] tabular text-muted-foreground">{relTime(t.ts - start).slice(1, 10)}</span>
                <span>
                  {t.service ? <span className="font-mono text-[12px] text-foreground">{t.service} </span> : null}
                  <span className="font-mono text-[10.5px] uppercase text-muted-foreground">{t.kind}{t.source === 'annotation' ? ' · human' : ''} </span>
                  {t.eventId && onSelectEvent ? (
                    <button type="button" className="text-left text-foreground hover:underline" onClick={() => onSelectEvent(t.eventId!)}>{t.text}</button>
                  ) : (
                    <span className="text-foreground">{t.text}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Contributing factors"><Bullets items={pm.contributingFactors} /></Section>

        <Section title="Potential root causes">
          {pm.rootCauses.length === 0 ? <p className="text-muted-foreground">None identified.</p> : null}
          <ul className="space-y-2">
            {pm.rootCauses.map((r) => (
              <li key={r.eventId} className="rounded-md border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground">{r.title}</span>
                  <span className={r.status === 'confirmed' ? 'font-mono text-[11px] uppercase text-[var(--color-healthy)]' : 'font-mono text-[11px] uppercase text-[var(--color-inferred)]'}>{r.status}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">score {r.score.toFixed(2)} (heuristic, not a probability)</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  evidence:{' '}
                  {r.evidence.map((id, i) => (
                    <span key={id}>
                      {i ? ', ' : ''}
                      {onSelectEvent ? <button type="button" className="hover:text-foreground hover:underline" onClick={() => onSelectEvent(id)}>{id.slice(0, 14)}</button> : id.slice(0, 14)}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Supporting evidence">
          <ul className="space-y-1 font-mono text-[11.5px]">
            {pm.evidence.map((e) => (
              <li key={e.eventId}><span className="text-muted-foreground">{e.ts.slice(11, 23)}</span> <span className="text-foreground">{e.service}</span> {e.message}</li>
            ))}
          </ul>
        </Section>

        <Section title="Detection and response"><Bullets items={pm.detectionAndResponse} /></Section>
        <Section title="Resolution"><Bullets items={pm.resolution.length ? pm.resolution : ['No resolution events recorded.']} /></Section>
        {pm.counterfactuals.length ? (
          <Section title="Counterfactual simulations">
            <p className="mb-2 text-[12px] text-muted-foreground">Model estimates under the listed assumptions, not predictions of what would have happened.</p>
            <ul className="space-y-2">
              {pm.counterfactuals.map((c, i) => (
                <li key={i} className="rounded-md border border-[var(--color-sim)]/30 p-2.5">
                  <div className="flex flex-wrap gap-2"><KindTag kind="simulated" /><span className="text-foreground">{c.label}</span><span className="font-mono text-[11px] text-muted-foreground">@ T+{c.branchAtSec}s · {c.overall}</span></div>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">{c.summary}</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        <Section title="Lessons learned"><Bullets items={pm.lessonsLearned} /></Section>
        <Section title="Corrective actions">
          <ul className="space-y-1.5">
            {pm.correctiveActions.map((a, i) => (
              <li key={i}><span className="text-foreground">{a.action}</span> <span className="text-muted-foreground">— {a.rationale}</span></li>
            ))}
          </ul>
        </Section>
        <Section title="Remaining uncertainties"><Bullets items={pm.uncertainties} /></Section>
      </article>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 border-b border-border pb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase text-muted-foreground">{k}</dt>
      <dd className="text-foreground">{v}</dd>
    </div>
  )
}

function Bullets({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-1 pl-5 text-foreground marker:text-muted-foreground">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
}
