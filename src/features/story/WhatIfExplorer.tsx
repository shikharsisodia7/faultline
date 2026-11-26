import { useEffect, useMemo, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { Choice, RunResult, SimScenario } from '@faultline/engine'
import type { BranchResponse } from '../engine/protocol'
import { cn } from '@/lib/utils'
import { FaultlineTimeline, type TimelineMarker } from './FaultlineTimeline'
import { explainOutcome, pctText, recoveryText } from './plain'
import { usePlayhead, useWhatIf } from './useWhatIf'

interface Props {
  scenario: SimScenario
  choices: Choice[]
  markers?: TimelineMarker[]
  defaultDecisionSec: number
  baseline?: RunResult
  /** Called when a result is ready (e.g. to advance a guided flow). */
  onResult?: (outcome: Outcome) => void
  /** Hide the inline comparison (a guided flow shows it on its own step). */
  hideComparison?: boolean
  /** Extra actions rendered under the comparison. */
  actions?: React.ReactNode
  compactHeader?: boolean
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * "What would you have done differently?" Pick a decision and when to make it;
 * the real simulator runs the original and the alternative, and the Faultline
 * Timeline shows where they diverge.
 */
export interface Outcome extends BranchResponse {
  atSec: number
  label: string
  explanation: string
}

export function WhatIfExplorer({ scenario, choices, markers, defaultDecisionSec, baseline: initial, onResult, actions, compactHeader, hideComparison }: Props) {
  const wf = useWhatIf(scenario, initial)
  const ph = usePlayhead(scenario.durationSec, { speed: Math.max(20, scenario.durationSec / 12) })
  const [choiceId, setChoiceId] = useState(choices[0]?.id ?? '')
  const choice = choices.find((c) => c.id === choiceId) ?? choices[0]
  const [amount, setAmount] = useState<number>(choice?.amount?.initial ?? 0)
  const [decision, setDecision] = useState(defaultDecisionSec)
  useEffect(() => setAmount(choice?.amount?.initial ?? 0), [choice])

  const r = wf.result
  // A changed decision invalidates the shown result until it is re-run.
  const stale = Boolean(r && (r.atSec !== decision || r.label !== labelFor(choice, amount)))

  useEffect(() => {
    if (!r || !wf.baseline) return
    onResult?.({ ...r, explanation: explainOutcome(r.baseline, r.branch, r.comparison, r.label, r.atSec) })
    ph.seek(Math.max(0, r.atSec - 15))
    ph.play()
     
  }, [r])

  const explanation = useMemo(() => (r ? explainOutcome(r.baseline, r.branch, r.comparison, r.label, r.atSec) : ''), [r])
  if (!choice) return null

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_1fr]">
      <div>
        {!compactHeader ? <p className="fl-eyebrow mb-3">Try a different decision</p> : null}
        <fieldset>
          <legend className="sr-only">Decision</legend>
          <div className="space-y-2">
            {choices.map((c) => (
              <label key={c.id} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors', c.id === choiceId ? 'border-foreground/60 bg-white shadow-[0_1px_2px_rgba(31,29,26,0.06)]' : 'border-border bg-transparent hover:border-foreground/25')}>
                <input type="radio" name={`choice-${scenario.id}`} value={c.id} checked={c.id === choiceId} onChange={() => setChoiceId(c.id)} className="mt-1 accent-[var(--color-primary)]" />
                <span>
                  <span className="block text-[15px] font-medium text-foreground">{c.label}</span>
                  <span className="mt-0.5 block text-[13.5px] leading-snug text-muted-foreground">{c.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {choice.amount ? (
          <label className="mt-5 block">
            <span className="flex items-baseline justify-between text-[13.5px]">
              <span className="text-muted-foreground">{choice.amount.label}</span>
              <span className="font-medium tabular text-foreground">{amount} {choice.amount.unit}</span>
            </span>
            <input type="range" min={choice.amount.min} max={choice.amount.max} step={choice.amount.step} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-primary)]" aria-label={`${choice.amount.label} (${choice.amount.unit})`} />
          </label>
        ) : null}
        <label className="mt-5 block">
          <span className="flex items-baseline justify-between text-[13.5px]">
            <span className="text-muted-foreground">Make the decision at</span>
            <span className="font-medium tabular text-foreground">{fmt(decision)}</span>
          </span>
          <input type="range" min={5} max={scenario.durationSec - 10} step={5} value={decision} onChange={(e) => setDecision(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-sim)]" aria-label="When the decision is made" />
        </label>
        <button
          type="button"
          disabled={!wf.baseline || wf.running}
          onClick={() => wf.explore(decision, choice.build(amount), labelFor(choice, amount))}
          className="fl-cta mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-medium disabled:opacity-60"
        >
          {wf.running ? <span className="size-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" aria-hidden="true" /> : null}
          {wf.running ? 'Simulating…' : 'Explore this outcome'}
        </button>
        {!wf.baseline && !wf.error ? <p className="mt-2 text-[12.5px] text-muted-foreground" role="status">Preparing the original timeline…</p> : null}
        {wf.error ? <p role="alert" className="mt-2 text-[13px] text-[var(--color-fault)]">{wf.error}</p> : null}
      </div>

      <div className="min-w-0">
        {wf.baseline ? (
          <>
            <FaultlineTimeline
              durationSec={scenario.durationSec}
              baseline={wf.baseline.samples}
              branch={r && !stale ? r.branch.samples : null}
              decisionSec={decision}
              onDecision={setDecision}
              t={ph.t}
              onSeek={ph.seek}
              markers={markers}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={ph.playing ? ph.pause : ph.play} className="fl-btn-quiet inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13.5px]">
                {ph.playing ? <Pause className="size-4" /> : <Play className="size-4" />} {ph.playing ? 'Pause' : r ? 'Replay both timelines' : 'Replay'}
              </button>
              <button type="button" onClick={ph.replay} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13.5px] text-muted-foreground hover:text-foreground">
                <RotateCcw className="size-4" /> From the start
              </button>
              <span className="ml-auto text-[12.5px] text-muted-foreground">Drag the dark dot to change when the decision happens.</span>
            </div>
          </>
        ) : (
          <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-border text-[13px] text-muted-foreground">Running the original timeline through the simulator…</div>
        )}

        {r && !stale && !hideComparison ? (
          <div className="mt-6 fl-rise">
            <OutcomeComparison outcome={{ ...r, explanation }} actions={actions} />
          </div>
        ) : r && stale ? (
          <p className="mt-4 text-[13.5px] text-muted-foreground">You changed the decision. Choose “Explore this outcome” to simulate it.</p>
        ) : null}
      </div>
    </div>
  )
}

function labelFor(choice: Choice | undefined, amount: number): string {
  if (!choice) return ''
  return choice.amount ? `${choice.label} (${amount} ${choice.amount.unit})` : choice.label
}

/** Original vs. alternative, in plain metrics and one honest sentence. */
export function OutcomeComparison({ outcome: r, actions }: { outcome: Outcome; actions?: React.ReactNode }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <Metric label="Successful requests" before={pctText(r.baseline.summary.successRate)} after={pctText(r.branch.summary.successRate)} />
        <Metric label="Failed requests" before={(r.baseline.summary.failed + r.baseline.summary.rateLimited).toLocaleString()} after={(r.branch.summary.failed + r.branch.summary.rateLimited).toLocaleString()} />
        <Metric label="Time until recovery" before={recoveryText(r.baseline)} after={recoveryText(r.branch)} />
        <Metric label="Systems affected" before={String(r.baseline.summary.affectedServices.length)} after={String(r.branch.summary.affectedServices.length)} />
      </dl>
      <p className="mt-4 text-[15px] leading-relaxed text-foreground">{r.explanation}</p>
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Simulated, not recorded: both paths come from the same seeded model of this system and are identical until the decision point.{r.comparison.prefixIdentical ? ' (Verified for this run.)' : ''} {r.assumptions[0] ?? ''}
      </p>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

function Metric({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 flex flex-col gap-0.5">
        <span className="text-[13px] text-muted-foreground"><span className="mr-1.5 inline-block h-0.5 w-3 bg-foreground align-middle" />Original {before}</span>
        <span className="text-[17px] font-medium tabular text-[var(--color-sim)]"><span className="mr-1.5 inline-block h-0.5 w-3 bg-[var(--color-sim)] align-middle" />{after}</span>
      </dd>
    </div>
  )
}
