import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, GitBranch, Save } from 'lucide-react'
import type { CanonicalEvent, Intervention, RunResult, SimScenario } from '@faultline/engine'
import { SIMULATOR_VERSION, describeIntervention, modelAt } from '@faultline/engine'
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { duration, ms, num, pct } from '@/lib/format'
import { KindTag, SectionLabel } from '../shell/atoms'
import type { BranchResponse } from '../engine/protocol'
import { runBranch, runScenario } from '../engine/client'
import type { SavedSimulation } from '../workspace/adapter'
import { InterventionEditor, defaultIntervention } from './InterventionEditor'
import { SeriesChart } from './SeriesChart'
import { FaultlineTimeline } from '../story/FaultlineTimeline'
import { usePlayhead } from '../story/useWhatIf'

export interface SimulationPanelProps {
  scenario: SimScenario
  /** Wall-clock time (UTC ms) of simulation t = 0. */
  originTs: number
  baseline?: RunResult
  branchAtSec: number
  onBranchAtSec: (sec: number) => void
  /** Assumptions about the model itself (e.g. derived from an imported incident). */
  modelAssumptions: string[]
  synthetic: boolean
  /** Observed events, for an "observed error events" overlay. */
  observed?: readonly CanonicalEvent[]
  initialInterventions?: Intervention[]
  savedSimulations?: SavedSimulation[]
  onSave?: (s: Omit<SavedSimulation, 'id' | 'createdAt'>) => Promise<void>
}

const VERDICT_STYLE = {
  better: 'border-[var(--color-healthy)]/40 bg-[var(--color-healthy-muted)] text-[var(--color-healthy)]',
  worse: 'border-[var(--color-fault)]/40 bg-[var(--color-fault-muted)] text-[var(--color-fault)]',
  mixed: 'border-[var(--color-degraded)]/40 bg-[var(--color-degraded-muted)] text-[var(--color-degraded)]',
  same: 'border-border bg-secondary text-muted-foreground',
}

export function SimulationPanel(p: SimulationPanelProps) {
  const { scenario } = p
  const [baseline, setBaseline] = useState<RunResult | undefined>(p.baseline)
  const [interventions, setInterventions] = useState<Intervention[]>(() => p.initialInterventions ?? [defaultIntervention('rollback_deployment', scenario, p.branchAtSec)].filter((iv) => iv.kind !== 'rollback_deployment' || scenario.timeline.some((c) => c.deploymentId)))
  const [result, setResult] = useState<BranchResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queueService, setQueueService] = useState<string>(() => scenario.model.services.find((s) => s.kind === 'database')?.id ?? scenario.model.services[0].id)
  const [saving, setSaving] = useState(false)
  const { success, error: toastError } = useToast()
  const ph = usePlayhead(scenario.durationSec, { speed: Math.max(20, scenario.durationSec / 20) })

  useEffect(() => {
    if (p.baseline) setBaseline(p.baseline)
    else runScenario(scenario).then(setBaseline).catch((e: Error) => setError(e.message))
  }, [scenario, p.baseline])

  // A stale result must never be shown against a different branch point.
  useEffect(() => setResult(null), [p.branchAtSec, scenario])

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setResult(await runBranch(scenario, p.branchAtSec, interventions, baseline))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const observedSeries = useMemo(() => {
    if (!p.observed?.length) return null
    const bins = new Map<number, number>()
    for (const e of p.observed) {
      if (e.severity !== 'error' && e.severity !== 'critical') continue
      const s = Math.floor((e.ts - p.originTs) / 5000) * 5
      bins.set(s, (bins.get(s) ?? 0) + 1)
    }
    const pts: Array<{ x: number; y: number }> = []
    for (let s = 0; s <= scenario.durationSec; s += 5) pts.push({ x: s, y: bins.get(s) ?? 0 })
    return pts
  }, [p.observed, p.originTs, scenario.durationSec])

  const model = modelAt(scenario, p.branchAtSec)
  const b = result?.baseline ?? baseline
  const r = result?.branch

  const summary = r && b ? `Success ${pct(b.summary.successRate)} → ${pct(r.summary.successRate)}; p95 ${ms(b.summary.latency.p95)} → ${ms(r.summary.latency.p95)}; failed requests ${num(b.summary.failed + b.summary.rateLimited)} → ${num(r.summary.failed + r.summary.rateLimited)}.` : ''

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_1fr] lg:overflow-hidden" data-tour="simulate">
      <aside className="min-h-0 border-b border-border lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <SectionLabel right={<KindTag kind="simulated" />}>Counterfactual branch</SectionLabel>
        <div className="space-y-3 px-3 pb-4">
          <div>
            <label htmlFor="branch-at" className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Branch at T+{p.branchAtSec}s</label>
            <input id="branch-at" type="range" min={0} max={scenario.durationSec} step={5} value={p.branchAtSec} onChange={(e) => p.onBranchAtSec(Number(e.target.value))} className="mt-1 w-full accent-[var(--color-sim)]" />
            <p className="text-[11.5px] text-muted-foreground">The recorded timeline is never changed. Before this point the branch is identical to the model baseline; at it, the interventions apply.</p>
          </div>
          <InterventionEditor value={interventions} onChange={setInterventions} scenario={scenario} atSec={p.branchAtSec} />
          <Button onClick={run} loading={running} disabled={!baseline} className="w-full">
            <GitBranch className="size-4" /> Run simulation
          </Button>
          {!baseline && !error ? <p className="text-[11.5px] text-muted-foreground">Running the model baseline…</p> : null}
          {error ? <p role="alert" className="text-[12px] text-[var(--color-fault)]">{error}</p> : null}
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-2.5 py-2 text-[12px] text-muted-foreground">Model parameters at T+{p.branchAtSec}s</summary>
            <div className="overflow-x-auto px-2 pb-2">
              <table className="w-full font-mono text-[10.5px]">
                <thead className="text-muted-foreground"><tr><th className="py-1 pr-2 text-left font-normal">service</th><th className="pr-2 text-right font-normal">cap</th><th className="pr-2 text-right font-normal">queue</th><th className="pr-2 text-right font-normal">svc ms</th><th className="pr-2 text-right font-normal">timeout</th><th className="pr-2 text-right font-normal">retry</th><th className="text-right font-normal">err</th></tr></thead>
                <tbody>
                  {model.services.map((s) => (
                    <tr key={s.id} className="border-t border-border/60">
                      <td className="py-1 pr-2">{s.id}</td>
                      <td className="pr-2 text-right tabular">{s.capacity}</td>
                      <td className="pr-2 text-right tabular">{s.queueCapacity}</td>
                      <td className="pr-2 text-right tabular">{Math.round(s.serviceTimeMs * s.latencyMultiplier)}</td>
                      <td className="pr-2 text-right tabular">{s.timeoutMs}</td>
                      <td className="pr-2 text-right tabular">{s.retry.maxAttempts}</td>
                      <td className="text-right tabular">{pct(s.errorRate, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">Traffic {model.traffic.map((t) => `${t.rps} rps from T+${t.atSec}s`).join(', ')}. Client timeout {model.clientTimeoutMs} ms, {model.clientRetry.maxAttempts} attempt(s). Seed {scenario.seed}. {SIMULATOR_VERSION}.</p>
            </div>
          </details>
        </div>
      </aside>

      <section className="min-h-0 lg:overflow-y-auto">
        {!r || !b ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <GitBranch className="size-6 text-[var(--color-sim)]" />
            <p className="max-w-md text-[13px] text-foreground">Choose a branch point and interventions, then run the simulation.</p>
            <p className="max-w-md text-[12px] text-muted-foreground">
              The baseline and the branch both run through the same seeded discrete-event model. Results are model estimates under the assumptions listed with them, not predictions.
            </p>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <div className={cn('flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5', VERDICT_STYLE[result!.comparison.overall])}>
              <span className="font-mono text-[11px] uppercase tracking-wide">Model estimate · {result!.comparison.overall}</span>
              <span className="text-[12.5px] text-foreground">{summary}</span>
              {p.onSave ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7"
                  loading={saving}
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await p.onSave!({
                        label: interventions.map(describeIntervention).join(' + ') || 'No intervention',
                        branchAtSec: p.branchAtSec,
                        interventions,
                        overall: result!.comparison.overall,
                        summary,
                        assumptions: [...p.modelAssumptions, ...result!.assumptions],
                      })
                      success('Simulation saved', 'It appears in the saved list and the postmortem.')
                    } catch (e) {
                      toastError('Could not save', e instanceof Error ? e.message : String(e))
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  <Save className="size-3.5" /> Save
                </Button>
              ) : null}
            </div>
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              {result!.comparison.prefixIdentical ? <Check className="size-3.5 text-[var(--color-healthy)]" /> : <AlertTriangle className="size-3.5 text-[var(--color-degraded)]" />}
              {result!.comparison.prefixIdentical ? `Verified: both runs are identical before T+${p.branchAtSec}s.` : 'Warning: the runs differ before the branch point.'}
            </p>

            <div className="rounded-xl border border-border bg-card p-4">
              <FaultlineTimeline durationSec={scenario.durationSec} baseline={b.samples} branch={r.samples} decisionSec={p.branchAtSec} t={ph.t} onSeek={ph.seek} />
              <button type="button" onClick={ph.playing ? ph.pause : ph.replay} className="mt-2 text-[12.5px] text-muted-foreground hover:text-foreground">{ph.playing ? 'Pause' : 'Replay both timelines'}</button>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <SeriesChart
                title="Client error rate"
                description="Share of client requests failing per second, model baseline versus branch."
                yFormat={(v) => pct(v, 0)}
                yMax={1}
                marker={{ x: p.branchAtSec, label: 'branch', color: 'var(--color-sim)' }}
                series={[
                  { id: 'base', label: 'model baseline', color: 'var(--color-foreground)', points: b.samples.map((s) => ({ x: s.t, y: s.errorRate })) },
                  { id: 'branch', label: 'branch', color: 'var(--color-sim)', dashed: true, points: r.samples.map((s) => ({ x: s.t, y: s.errorRate })) },
                ]}
              />
              <SeriesChart
                title="Client p95 latency"
                description="95th percentile latency of successful requests per second."
                yFormat={(v) => ms(v)}
                marker={{ x: p.branchAtSec, label: 'branch', color: 'var(--color-sim)' }}
                series={[
                  { id: 'base', label: 'model baseline', color: 'var(--color-foreground)', points: b.samples.map((s) => ({ x: s.t, y: s.p95 })) },
                  { id: 'branch', label: 'branch', color: 'var(--color-sim)', dashed: true, points: r.samples.map((s) => ({ x: s.t, y: s.p95 })) },
                ]}
              />
              <div className="min-w-0">
                <div className="mb-1 flex justify-end">
                  <Select value={queueService} onValueChange={setQueueService}>
                    <SelectTrigger className="h-7 w-48 font-mono text-[11.5px]" aria-label="Service for queue depth"><SelectValue /></SelectTrigger>
                    <SelectContent>{scenario.model.services.map((s) => <SelectItem key={s.id} value={s.id} className="font-mono text-[11.5px]">{s.id}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <SeriesChart
                  title={`Queue depth · ${queueService}`}
                  description="Requests waiting for a worker or connection."
                  yFormat={(v) => num(v)}
                  marker={{ x: p.branchAtSec, label: 'branch', color: 'var(--color-sim)' }}
                  series={[
                    { id: 'base', label: 'model baseline', color: 'var(--color-foreground)', points: b.samples.map((s) => ({ x: s.t, y: s.services[queueService]?.queue ?? null })) },
                    { id: 'branch', label: 'branch', color: 'var(--color-sim)', dashed: true, points: r.samples.map((s) => ({ x: s.t, y: s.services[queueService]?.queue ?? null })) },
                  ]}
                />
              </div>
              {observedSeries ? (
                <SeriesChart
                  title="Observed error events (recorded logs, per 5 s)"
                  description="Count of error-level events in the recorded evidence. Different unit from the model curves."
                  yFormat={(v) => num(v)}
                  series={[{ id: 'obs', label: p.synthetic ? 'observed (synthetic logs)' : 'observed', color: 'var(--color-fault)', points: observedSeries }]}
                />
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-[12px]">
                <thead className="bg-secondary/50 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2 text-left font-normal">Metric</th><th className="px-3 py-2 text-right font-normal">Baseline</th><th className="px-3 py-2 text-right font-normal">Branch</th><th className="px-3 py-2 text-right font-normal">Δ</th><th className="px-3 py-2 text-right font-normal">Verdict</th></tr>
                </thead>
                <tbody>
                  {result!.comparison.deltas.map((d) => {
                    const fmt = (v: number | null) => (v === null ? '—' : d.metric === 'Success rate' || d.metric === 'Peak error rate' ? pct(v) : d.metric.includes('latency') ? ms(v) : d.metric.includes('recovery') ? duration(v) : num(v))
                    return (
                      <tr key={d.metric} className="border-t border-border/60">
                        <td className="px-3 py-1.5">{d.metric}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular">{fmt(d.baseline)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular text-[var(--color-sim)]">{fmt(d.branch)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular text-muted-foreground">{d.delta === null ? '—' : `${d.delta > 0 ? '+' : ''}${d.metric === 'Success rate' || d.metric === 'Peak error rate' ? pct(d.delta) : num(d.delta, 1)}`}</td>
                        <td className={cn('px-3 py-1.5 text-right font-mono text-[11px]', d.verdict === 'better' && 'text-[var(--color-healthy)]', d.verdict === 'worse' && 'text-[var(--color-fault)]', (d.verdict === 'same' || d.verdict === 'n/a') && 'text-muted-foreground')}>{d.verdict}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Assumptions</h4>
                <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted-foreground">
                  {p.synthetic ? <li>Synthetic incident: the recorded evidence was generated by this same model, so baseline and observations agree by construction.</li> : null}
                  {p.modelAssumptions.map((a, i) => <li key={`m${i}`}>{a}</li>)}
                  {result!.assumptions.map((a, i) => <li key={`i${i}`}>{a}</li>)}
                  <li>Requests follow a Poisson arrival process; service times are lognormal; timeouts do not cancel work already sent to a dependency.</li>
                </ul>
              </div>
              <div>
                <h4 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Run details</h4>
                <dl className="grid grid-cols-[140px_1fr] gap-y-0.5 font-mono text-[11px]">
                  <dt className="text-muted-foreground">requests (base/branch)</dt><dd className="tabular">{num(b.summary.requests)} / {num(r.summary.requests)}</dd>
                  <dt className="text-muted-foreground">rate limited</dt><dd className="tabular">{num(b.summary.rateLimited)} / {num(r.summary.rateLimited)}</dd>
                  <dt className="text-muted-foreground">timeouts</dt><dd className="tabular">{num(b.summary.timeouts)} / {num(r.summary.timeouts)}</dd>
                  <dt className="text-muted-foreground">breaker opens</dt><dd className="tabular">{num(b.summary.circuitOpens)} / {num(r.summary.circuitOpens)}</dd>
                  <dt className="text-muted-foreground">affected (branch)</dt><dd>{r.summary.affectedServices.join(', ') || 'none'}</dd>
                  <dt className="text-muted-foreground">scheduler events</dt><dd className="tabular">{num(r.eventsProcessed)}{r.truncated ? ' (truncated)' : ''}</dd>
                </dl>
              </div>
            </div>
          </div>
        )}
        {p.savedSimulations?.length ? (
          <div className="border-t border-border p-4">
            <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Saved simulations</h4>
            <ul className="space-y-1.5">
              {p.savedSimulations.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px]">
                  <span className={cn('font-mono text-[10.5px] uppercase', s.overall === 'better' ? 'text-[var(--color-healthy)]' : s.overall === 'worse' ? 'text-[var(--color-fault)]' : 'text-[var(--color-degraded)]')}>{s.overall}</span>
                  <span className="text-foreground">{s.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">@ T+{s.branchAtSec}s</span>
                  {s.author ? <span className="ml-auto text-[11px] text-muted-foreground">{s.author}</span> : null}
                  <button type="button" className="text-[11px] text-[var(--color-sim)] hover:underline" onClick={() => { p.onBranchAtSec(s.branchAtSec); setInterventions(s.interventions) }}>Load</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}
