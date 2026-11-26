import { useEffect, useMemo, useRef } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { Sample } from '@faultline/engine'
import { STOREFRONT, STOREFRONT_CHOICES, STOREFRONT_LABELS } from '@faultline/engine'
import { cn } from '@/lib/utils'
import { FaultlineTimeline } from '../story/FaultlineTimeline'
import { pctText, totalsAt } from '../story/plain'
import { SystemDiagram, type PartStatus } from '../story/SystemDiagram'
import { usePlayhead, useWhatIf } from '../story/useWhatIf'

const DECISION_AT = 70
const PARTS = ['website', 'checkout', 'database'].map((id) => ({ id, name: STOREFRONT_LABELS[id].name }))
const CALLS = STOREFRONT.model.calls

function statusAt(s: Sample | undefined): Record<string, PartStatus> {
  if (!s) return { website: 'ok', checkout: 'ok', database: 'ok' }
  const c = s.services.checkout
  const d = s.services.database
  const cFail = c.completed + c.failed > 0 ? c.failed / (c.completed + c.failed) : 0
  return {
    website: s.errorRate >= 0.2 ? 'failing' : s.errorRate >= 0.01 ? 'strained' : 'ok',
    checkout: cFail >= 0.2 ? 'failing' : cFail >= 0.01 || c.queue > 10 ? 'strained' : 'ok',
    database: d.queue >= 40 ? 'failing' : d.queue > 4 ? 'strained' : 'ok',
  }
}

/** Plain caption for the moment, computed from that second's simulated sample. */
function captionAt(s: Sample | undefined, t: number): string {
  if (!s) return 'Preparing the replay…'
  const q = s.services.database.queue
  if (t < 60) return `A normal afternoon. About ${s.requests} shoppers a second, and every order goes through.`
  if (s.errorRate < 0.01 && q <= 4) return t < 170 ? 'A flash sale starts and traffic more than doubles. So far, the store keeps up.' : 'The sale winds down. The backlog has cleared and orders go through again.'
  if (s.errorRate < 0.01) return `The database is falling behind: ${q} orders are waiting in line.`
  return `The database can’t keep up: ${q} orders are waiting. Checkout gives up, tries again, and makes it worse. ${pctText(s.errorRate)} of orders are failing right now.`
}

export function HeroRecorder() {
  const wf = useWhatIf(STOREFRONT)
  const ph = usePlayhead(STOREFRONT.durationSec, { speed: 22 })
  const started = useRef(false)
  useEffect(() => {
    if (wf.baseline && !started.current) {
      started.current = true
      ph.play()
    }
  }, [wf.baseline, ph])

  const r = wf.result
  const onBranch = Boolean(r && ph.t >= r.atSec)
  const samples = (onBranch ? r!.branch.samples : wf.baseline?.samples) ?? []
  const sample = samples[Math.max(0, Math.min(samples.length - 1, Math.floor(ph.t) - 1))]
  const totals = useMemo(() => totalsAt(samples, ph.t), [samples, ph.t])
  const status = statusAt(sample)
  const details: Record<string, string> = sample
    ? {
        website: `${sample.requests} shoppers / s`,
        checkout: sample.services.checkout.failed ? `${sample.services.checkout.failed} failed this second` : 'Taking orders',
        database: sample.services.database.queue ? `${sample.services.database.queue} orders waiting` : 'Keeping up',
      }
    : {}

  return (
    <div className="fl-frame">
      <div className="fl-frame-inner bg-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 sm:px-5">
          <span className="text-[13.5px] font-medium text-foreground">{STOREFRONT.name}</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">Synthetic example, simulated live in your browser</span>
          {onBranch ? <span className="rounded-full bg-[var(--color-sim-muted)] px-2 py-0.5 text-[11.5px] text-[var(--color-sim)]">Showing: {r!.label}</span> : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-4 pb-5 pt-5 sm:px-6">
          <div className="mx-auto w-full max-w-[760px]"><SystemDiagram parts={PARTS.map((p) => ({ ...p, detail: details[p.id] }))} calls={CALLS} status={status} /></div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <p className="min-h-[3em] text-[15px] leading-relaxed text-foreground" aria-live="polite">{captionAt(sample, ph.t)}</p>
            <dl className="flex gap-5 text-right">
              <div><dt className="text-[11.5px] text-muted-foreground">Orders placed</dt><dd className="text-[19px] font-medium tabular text-foreground">{totals.ok.toLocaleString()}</dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Failed orders</dt><dd className={cn('text-[19px] font-medium tabular', totals.failed ? 'text-[var(--color-fault)]' : 'text-foreground')}>{totals.failed.toLocaleString()}</dd></div>
            </dl>
          </div>
          {wf.baseline ? (
            <FaultlineTimeline compact durationSec={STOREFRONT.durationSec} baseline={wf.baseline.samples} branch={r?.branch.samples} decisionSec={r ? r.atSec : null} t={ph.t} onSeek={ph.seek} markers={[{ atSec: 60, label: 'Sale starts', kind: 'change' }, { atSec: 170, label: 'Sale ends', kind: 'response' }]} />
          ) : (
            <div className="h-[110px] animate-pulse rounded-lg bg-secondary" />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={ph.playing ? ph.pause : ph.play} disabled={!wf.baseline} className="fl-btn-quiet inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13.5px] disabled:opacity-50">
              {ph.playing ? <Pause className="size-4" /> : <Play className="size-4" />} {ph.playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" onClick={ph.replay} disabled={!wf.baseline} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13.5px] text-muted-foreground hover:text-foreground disabled:opacity-50">
              <RotateCcw className="size-4" /> Replay
            </button>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <span className="text-[13px] text-muted-foreground">What if, at 1:10, you had…</span>
            {STOREFRONT_CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={!wf.baseline || wf.running}
                onClick={async () => {
                  await wf.explore(DECISION_AT, c.build(c.amount?.initial ?? 0), c.label)
                  ph.seek(DECISION_AT - 10)
                  ph.play()
                }}
                className={cn('h-8 rounded-full border px-3 text-[13px] transition-colors disabled:opacity-50', r?.label === c.label ? 'border-[var(--color-sim)] bg-[var(--color-sim-muted)] text-[var(--color-sim)]' : 'border-border bg-white text-foreground hover:border-foreground/30')}
              >
                {c.label.charAt(0).toLowerCase() + c.label.slice(1)}
              </button>
            ))}
          </div>
          {r ? (
            <p className="text-[13.5px] text-muted-foreground">
              Simulated: {pctText(r.branch.summary.successRate)} of orders succeed with this decision, versus {pctText(r.baseline.summary.successRate)} originally.
              {r.comparison.overall === 'same' ? ' It barely changes the outcome, because it does not touch the real bottleneck.' : r.comparison.overall === 'worse' ? ' It made things worse.' : ''}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
