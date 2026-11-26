import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpLeft, Trash2 } from 'lucide-react'
import type { CanonicalEvent, CorrelationEdge, IncidentAnalysis, ReplayState } from '@faultline/engine'
import { Button, Textarea } from '@/components/ui'
import { cn } from '@/lib/utils'
import { relTime, shortId, utcDateTime } from '@/lib/format'
import { HealthDot, KindTag, ScoreBar, SectionLabel, SEVERITY_COLOR } from '../shell/atoms'
import type { WorkspaceAdapter } from './adapter'

interface Props {
  analysis: IncidentAnalysis
  event: CanonicalEvent | null
  adapter: WorkspaceAdapter
  state: ReplayState
  onSelectEvent: (id: string) => void
  onSelectService: (id: string) => void
}

const SIGNAL_LABEL: Record<string, string> = {
  parentSpan: 'parent span',
  sharedTrace: 'same trace',
  sharedRequest: 'same request',
  sharedDeployment: 'same deploy',
  dependency: 'dependency',
  sameService: 'same service',
  severityEscalation: 'severity escalates',
  errorPropagation: 'error propagation',
  typeRelation: 'failure chain',
}

export function EventRow({ e, start, onClick, active }: { e: CanonicalEvent; start: number; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('group flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-secondary', active && 'bg-secondary')}>
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[e.severity] }} aria-hidden="true" />
      <span className="w-[70px] shrink-0 font-mono text-[11px] tabular text-muted-foreground">{relTime(e.ts - start).slice(1)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[11.5px] text-foreground">{e.message}</span>
        <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{e.service} · {e.type}</span>
      </span>
    </button>
  )
}

function EdgeRow({ edge, other, start, dir, onClick }: { edge: CorrelationEdge; other: CanonicalEvent; start: number; dir: 'in' | 'out'; onClick: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-b border-border/60 last:border-0">
      <div className="flex items-start gap-2 px-3 py-2">
        {dir === 'in' ? <ArrowUpLeft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <ArrowDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onClick} className="block w-full truncate text-left font-mono text-[11.5px] text-foreground hover:underline">
            {other.service}: {other.message}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <ScoreBar value={edge.score} />
            <span className="font-mono text-[10.5px] tabular text-muted-foreground" title="Heuristic correlation score in [0, 1]. Not a probability.">
              {edge.score.toFixed(2)}
            </span>
            {edge.signals.map((s) => (
              <span key={s} className="rounded-sm bg-secondary px-1 font-mono text-[10px] text-muted-foreground">{SIGNAL_LABEL[s] ?? s}</span>
            ))}
            <span className="font-mono text-[10px] text-faint">{relTime(other.ts - start).slice(1)}</span>
          </div>
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" aria-expanded={open}>
            {open ? 'Hide explanation' : 'Why?'}
          </button>
          {open ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{edge.explanation}</p> : null}
        </div>
      </div>
    </li>
  )
}

export function InspectorPanel({ analysis, event, adapter, state, onSelectEvent, onSelectService }: Props) {
  const { dataset, correlation } = analysis
  const start = dataset.events[0]?.ts ?? 0
  const byId = useMemo(() => new Map(dataset.events.map((e) => [e.id, e])), [dataset.events])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const incoming = useMemo(() => (event ? correlation.edges.filter((e) => e.target === event.id).sort((a, b) => b.score - a.score) : []), [correlation.edges, event])
  const outgoing = useMemo(() => (event ? correlation.edges.filter((e) => e.source === event.id).sort((a, b) => b.score - a.score).slice(0, 6) : []), [correlation.edges, event])
  const trace = useMemo(() => (event?.traceId ? dataset.events.filter((e) => e.traceId === event.traceId && e.id !== event.id).slice(0, 12) : []), [dataset.events, event])
  const nearby = useMemo(
    () => (event ? dataset.events.filter((e) => e.service === event.service && e.id !== event.id && Math.abs(e.ts - event.ts) <= 15_000).slice(0, 10) : []),
    [dataset.events, event],
  )
  const notes = useMemo(() => (event ? adapter.annotations.filter((a) => a.eventId === event.id) : []), [adapter.annotations, event])

  if (!event) {
    const services = Object.entries(state.services).sort(([, a], [, b]) => rank(b.health) - rank(a.health))
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-tour="inspector">
        <SectionLabel>Service state at playhead</SectionLabel>
        <ul className="px-1">
          {services.map(([id, s]) => (
            <li key={id}>
              <button type="button" onClick={() => onSelectService(id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary">
                <HealthDot health={s.health} />
                <span className="flex-1 truncate font-mono text-[12px]">{id}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{s.health}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="px-3 pb-4 pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
          Select an event on the timeline, a hypothesis, or a search result to inspect its evidence, correlated causes, and related traces.
        </p>
      </div>
    )
  }

  const fields: Array<[string, string | undefined]> = [
    ['service', event.service],
    ['time', relTime(event.ts - start)],
    ['utc', utcDateTime(event.ts)],
    ['severity', event.severity],
    ['type', event.type],
    ['trace', event.traceId],
    ['span', event.spanId],
    ['parent span', event.parentSpanId],
    ['request', event.requestId],
    ['deployment', event.deploymentId],
    ['host', event.host],
    ['region', event.region],
    ['environment', event.environment],
    ['source', `${event.sourceRef.sourceName}:${event.sourceRef.line}`],
    ['event id', event.id],
  ]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-tour="inspector">
      <div className="border-b border-border px-3 pb-3 pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <KindTag kind="observed" />
          <span className="font-mono text-[11px] uppercase" style={{ color: SEVERITY_COLOR[event.severity] }}>{event.severity}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{event.type}</span>
          {event.flags?.length ? <span className="font-mono text-[10.5px] text-[var(--color-degraded)]" title={event.flags.join(', ')}>flags: {event.flags.join(', ')}</span> : null}
        </div>
        <p className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-foreground">{event.message}</p>
      </div>

      <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 border-b border-border px-3 py-2.5 font-mono text-[11px]">
        {fields.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-all text-foreground">
              {k === 'service' ? <button type="button" className="hover:underline" onClick={() => onSelectService(event.service)}>{v}</button> : v}
            </dd>
          </div>
        ))}
        {Object.entries(event.metadata).filter(([k]) => k !== 'synthetic').map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-muted-foreground" title={k}>{k}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-all text-foreground">{String(v)}</dd>
          </div>
        ))}
      </dl>

      <SectionLabel right={<KindTag kind="inferred" />}>Potential causes</SectionLabel>
      {incoming.length ? (
        <ul>{incoming.map((e) => byId.get(e.source) && <EdgeRow key={e.id} edge={e} other={byId.get(e.source)!} start={start} dir="in" onClick={() => onSelectEvent(e.source)} />)}</ul>
      ) : (
        <p className="px-3 pb-2 text-[12px] text-muted-foreground">No earlier event correlates strongly enough. This may be an initiating event, or the evidence may be incomplete.</p>
      )}

      {outgoing.length ? (
        <>
          <SectionLabel right={<KindTag kind="inferred" />}>Correlated effects</SectionLabel>
          <ul>{outgoing.map((e) => byId.get(e.target) && <EdgeRow key={e.id} edge={e} other={byId.get(e.target)!} start={start} dir="out" onClick={() => onSelectEvent(e.target)} />)}</ul>
        </>
      ) : null}

      {trace.length ? (
        <>
          <SectionLabel>Same trace · {shortId(event.traceId, 10)}</SectionLabel>
          <div>{trace.map((e) => <EventRow key={e.id} e={e} start={start} onClick={() => onSelectEvent(e.id)} />)}</div>
        </>
      ) : null}

      {nearby.length ? (
        <>
          <SectionLabel>Nearby in {event.service} (±15 s)</SectionLabel>
          <div>{nearby.map((e) => <EventRow key={e.id} e={e} start={start} onClick={() => onSelectEvent(e.id)} />)}</div>
        </>
      ) : null}

      <SectionLabel right={<KindTag kind="human" />}>Annotations</SectionLabel>
      <div className="space-y-2 px-3 pb-3">
        {notes.length === 0 ? <p className="text-[12px] text-muted-foreground">No notes on this event yet.</p> : null}
        {notes.map((n) => (
          <div key={n.id} className="rounded-md border border-border bg-card p-2">
            <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
              <span className="text-foreground">{n.author}</span>
              <span>{n.kind}</span>
              {n.synthetic ? <KindTag kind="synthetic">synthetic</KindTag> : null}
              {adapter.removeAnnotation && !n.synthetic ? (
                <button type="button" className="ml-auto hover:text-foreground" aria-label="Delete note" onClick={() => adapter.removeAnnotation!(n.id)}>
                  <Trash2 className="size-3" />
                </button>
              ) : null}
            </div>
            <p className="whitespace-pre-wrap break-words text-[12.5px] text-foreground">{n.body}</p>
          </div>
        ))}
        {adapter.addAnnotation ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const body = draft.trim()
              if (!body) return
              setSaving(true)
              try {
                await adapter.addAnnotation!({ eventId: event.id, ts: event.ts, body: body.slice(0, 2000), kind: 'note' })
                setDraft('')
              } finally {
                setSaving(false)
              }
            }}
            className="space-y-2"
          >
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note for responders…" maxLength={2000} rows={2} aria-label="Annotation text" className="text-[12.5px]" />
            <Button type="submit" size="sm" variant="secondary" loading={saving} disabled={!draft.trim()}>Add note</Button>
          </form>
        ) : (
          <p className="text-[12px] text-muted-foreground">Read-only: you cannot annotate this incident.</p>
        )}
      </div>
    </div>
  )
}

function rank(h: string) {
  return h === 'failing' ? 3 : h === 'degraded' ? 2 : h === 'recovering' ? 1 : 0
}
