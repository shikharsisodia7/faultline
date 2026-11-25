import { useMemo, useState } from 'react'
import { Check, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import type { CanonicalEvent, Hypothesis, HypothesisReview, IncidentAnalysis, ReplayState, Severity } from '@faultline/engine'
import { SearchInput } from '@/components/ui'
import { cn } from '@/lib/utils'
import { relTime } from '@/lib/format'
import { HealthDot, KindTag, ScoreBar, SectionLabel } from '../shell/atoms'
import type { WorkspaceAdapter } from './adapter'
import { EventRow } from './InspectorPanel'

export const SEVERITIES: Severity[] = ['critical', 'error', 'warn', 'info', 'debug']

interface Props {
  analysis: IncidentAnalysis
  state: ReplayState
  adapter: WorkspaceAdapter
  query: string
  onQuery: (q: string) => void
  severities: Set<Severity>
  onToggleSeverity: (s: Severity) => void
  results: CanonicalEvent[]
  selectedEventId: string | null
  selectedService: string | null
  onSelectEvent: (id: string) => void
  onSelectService: (id: string | null) => void
  onSeek: (t: number) => void
}

const REVIEW_LABEL: Record<HypothesisReview, string> = {
  inferred: 'inferred',
  supported: 'supported',
  rejected: 'rejected',
  confirmed: 'confirmed',
}

function HypothesisCard({ h, review, adapter, active, onSelect }: { h: Hypothesis; review: HypothesisReview; adapter: WorkspaceAdapter; active: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false)
  const tally = adapter.tallies?.[h.id]
  const set = (r: HypothesisReview) => adapter.setReview?.(h.id, review === r ? 'inferred' : r)
  return (
    <li className={cn('rounded-md border border-border bg-card', active && 'border-foreground/40', review === 'rejected' && 'opacity-60')}>
      <button type="button" onClick={onSelect} className="block w-full px-2.5 pt-2 text-left">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] text-muted-foreground">#{h.rank}</span>
          <span className={cn('font-mono text-[10.5px] uppercase', review === 'confirmed' ? 'text-[var(--color-healthy)]' : review === 'rejected' ? 'text-muted-foreground line-through' : 'text-[var(--color-inferred)]')}>
            {REVIEW_LABEL[review]}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <ScoreBar value={h.score} />
            <span className="font-mono text-[10.5px] tabular text-muted-foreground" title="Heuristic ranking score. Not a probability.">{h.score.toFixed(2)}</span>
          </span>
        </div>
        <p className="mt-1 text-[12.5px] leading-snug text-foreground">{h.title}</p>
      </button>
      <div className="flex items-center gap-1 px-2 pb-2 pt-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-[11px] text-muted-foreground hover:text-foreground" aria-expanded={open}>
          {open ? 'Hide reasoning' : 'Why ranked here?'}
        </button>
        {adapter.setReview ? (
          <span className="ml-auto flex items-center gap-0.5" role="group" aria-label="Review hypothesis">
            <ReviewBtn label="Support" active={review === 'supported'} onClick={() => set('supported')} count={tally?.support}><ThumbsUp /></ReviewBtn>
            <ReviewBtn label="Reject" active={review === 'rejected'} onClick={() => set('rejected')} count={tally?.reject}><ThumbsDown /></ReviewBtn>
            <ReviewBtn label="Confirm as root cause" active={review === 'confirmed'} onClick={() => set('confirmed')} count={tally?.confirm}><Check /></ReviewBtn>
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="border-t border-border px-2.5 py-2">
          <ul className="space-y-1 text-[11.5px] leading-snug text-muted-foreground">
            {h.explanation.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
            {Object.entries(h.factors).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular text-foreground">{v.toFixed(2)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </li>
  )
}

function ReviewBtn({ label, active, onClick, children, count }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick} className={cn('inline-flex h-6 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground [&_svg]:size-3', active && 'bg-secondary text-foreground')}>
      {children}
      {count ? <span className="font-mono text-[10px]">{count}</span> : null}
    </button>
  )
}

export function SidePanel(p: Props) {
  const { analysis, state, adapter } = p
  const start = analysis.dataset.events[0]?.ts ?? 0
  const sources = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of analysis.dataset.events) m.set(e.sourceRef.sourceName, (m.get(e.sourceRef.sourceName) ?? 0) + 1)
    return Array.from(m.entries())
  }, [analysis.dataset.events])
  const services = useMemo(() => Object.keys(state.services).sort(), [state.services])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        <SearchInput value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="Search messages, services, trace ids" aria-label="Search events" className="h-8 text-[12.5px]" />
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Severity filter">
          {SEVERITIES.map((s) => (
            <button key={s} type="button" aria-pressed={p.severities.has(s)} onClick={() => p.onToggleSeverity(s)} className={cn('h-6 rounded-sm border px-1.5 font-mono text-[10.5px]', p.severities.has(s) ? 'border-foreground/30 bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.query.trim() ? (
          <>
            <SectionLabel>{p.results.length} match{p.results.length === 1 ? '' : 'es'}</SectionLabel>
            {p.results.length === 0 ? <p className="px-3 text-[12px] text-muted-foreground">Nothing matches “{p.query}”. Try a service name, a trace id, or a word from a log line.</p> : null}
            <div>{p.results.slice(0, 80).map((e) => <EventRow key={e.id} e={e} start={start} active={e.id === p.selectedEventId} onClick={() => p.onSelectEvent(e.id)} />)}</div>
            {p.results.length > 80 ? <p className="px-3 py-1 text-[11px] text-muted-foreground">Showing the first 80; refine the search to narrow it.</p> : null}
          </>
        ) : null}

        <SectionLabel right={<KindTag kind="inferred" />}>Hypotheses</SectionLabel>
        <ul className="space-y-1.5 px-2" data-tour="hypotheses">
          {analysis.hypotheses.length === 0 ? <li className="px-1 text-[12px] text-muted-foreground">No anomalies to rank.</li> : null}
          {analysis.hypotheses.map((h) => (
            <HypothesisCard key={h.id} h={h} review={adapter.reviews[h.id] ?? 'inferred'} adapter={adapter} active={p.selectedEventId === h.eventId} onSelect={() => p.onSelectEvent(h.eventId)} />
          ))}
        </ul>

        <SectionLabel>Services</SectionLabel>
        <ul className="px-1">
          {services.map((id) => (
            <li key={id}>
              <button type="button" aria-pressed={p.selectedService === id} onClick={() => p.onSelectService(p.selectedService === id ? null : id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-secondary', p.selectedService === id && 'bg-secondary')}>
                <HealthDot health={state.services[id].health} />
                <span className="flex-1 truncate font-mono text-[12px]">{id}</span>
                <span className="font-mono text-[10.5px] tabular text-muted-foreground">{state.services[id].totalErrors || ''}</span>
              </button>
            </li>
          ))}
        </ul>

        <SectionLabel>Bookmarks</SectionLabel>
        <ul className="px-1">
          {adapter.bookmarks.length === 0 ? <li className="px-2 text-[12px] text-muted-foreground">Bookmark a moment from the timeline to come back to it.</li> : null}
          {adapter.bookmarks.map((b) => (
            <li key={b.id} className="group flex items-center gap-1">
              <button type="button" onClick={() => p.onSeek(b.ts)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-secondary">
                <span className="font-mono text-[11px] tabular text-[var(--color-degraded)]">{relTime(b.ts - start).slice(1, 10)}</span>
                <span className="truncate text-[12px]">{b.label}</span>
              </button>
              {adapter.removeBookmark ? (
                <button type="button" aria-label={`Remove bookmark ${b.label}`} onClick={() => adapter.removeBookmark!(b.id)} className="mr-1 hidden size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground group-hover:inline-flex">
                  <X className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>

        <SectionLabel>Sources</SectionLabel>
        <ul className="px-3 pb-4">
          {sources.map(([name, n]) => (
            <li key={name} className="flex justify-between gap-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              <span className="truncate">{name}</span>
              <span className="tabular">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
