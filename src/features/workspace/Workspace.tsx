import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { IncidentAnalysis, Intervention, RunResult, Severity, SimScenario } from '@faultline/engine'
import { SEVERITY_RANK } from '@faultline/engine'
import { cn } from '@/lib/utils'
import { duration } from '@/lib/format'
import { KindTag } from '../shell/atoms'
import { PostmortemPanel } from '../postmortem/PostmortemPanel'
import { SimulationPanel } from '../simulate/SimulationPanel'
import type { WorkspaceAdapter } from './adapter'
import { GuidedTour, type TourStep } from './GuidedTour'
import { InspectorPanel } from './InspectorPanel'
import { SidePanel } from './SidePanel'
import { TimelineView } from './TimelineView'
import { TopologyView } from './TopologyView'
import { useReplayController } from './useReplayController'
import { ModeSwitch } from '../guided/GuidedDemo'

export type WorkspaceMode = 'investigate' | 'simulate' | 'postmortem'

export interface WorkspaceProps {
  analysis: IncidentAnalysis
  adapter: WorkspaceAdapter
  /** Simulation model for counterfactuals (synthetic: the generating model; imported: derived). */
  scenario?: SimScenario
  /** Wall-clock time of simulation t = 0. */
  scenarioOrigin?: number
  baseline?: RunResult
  modelAssumptions?: string[]
  suggestedBranchSec?: number
  suggestedInterventions?: Intervention[]
  headerLeft?: ReactNode
  headerRight?: ReactNode
  tour?: boolean
  /** External request to select an event (e.g. a citation clicked elsewhere). */
  requestedEvent?: { id: string; n: number } | null
  /** Fill the parent (inside the app layout) instead of the viewport. */
  embedded?: boolean
  /** Initial playhead (UTC ms) and mode, e.g. when arriving from guided mode. */
  initialT?: number
  initialMode?: WorkspaceMode
  /** Switch to the guided view, carrying the current playhead (UTC ms). */
  onGuided?: (wallT: number) => void
}

type MobilePane = 'graph' | 'timeline' | 'evidence' | 'panels'

export function Workspace(props: WorkspaceProps) {
  const { analysis, adapter } = props
  const { dataset, replay, graph } = analysis
  const ctl = useReplayController(replay, props.initialT)
  const [mode, setMode] = useState<WorkspaceMode>(props.initialMode ?? 'investigate')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [severities, setSeverities] = useState<Set<Severity>>(() => new Set(['critical', 'error', 'warn', 'info', 'debug']))
  const [mobilePane, setMobilePane] = useState<MobilePane>('graph')
  const origin = props.scenarioOrigin ?? replay.start
  const [branchAtSec, setBranchAtSec] = useState<number>(props.suggestedBranchSec ?? 60)
  const searchRef = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => new Map(dataset.events.map((e) => [e.id, e])), [dataset.events])
  const selectedEvent = selectedEventId ? byId.get(selectedEventId) ?? null : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dataset.events.filter(
      (e) =>
        severities.has(e.severity) &&
        (!selectedService || e.service === selectedService) &&
        (!q || e.message.toLowerCase().includes(q) || e.service.includes(q) || e.traceId?.toLowerCase().includes(q) || e.requestId?.toLowerCase().includes(q) || e.id === q),
    )
  }, [dataset.events, query, severities, selectedService])
  const filteredIds = useMemo(() => new Set(filtered.map((e) => e.id)), [filtered])

  const serviceOrder = useMemo(() => {
    const layout = graph.layout()
    return Array.from(graph.services.keys()).sort((a, b) => {
      const la = layout.get(a)
      const lb = layout.get(b)
      return (la?.layer ?? 0) - (lb?.layer ?? 0) || (la?.order ?? 0) - (lb?.order ?? 0)
    })
  }, [graph])

  const selectEvent = useCallback(
    (id: string) => {
      const e = byId.get(id)
      if (!e) return
      setSelectedEventId(id)
      ctl.seek(e.ts)
      if (mode !== 'investigate') setMode('investigate')
      setMobilePane('evidence')
      adapter.updatePresence?.({ t: e.ts, eventId: id })
    },
    [byId, ctl, mode, adapter],
  )

  useEffect(() => {
    if (props.requestedEvent) selectEvent(props.requestedEvent.id)
  }, [props.requestedEvent])  

  // Shareable deep link to an event: #event=<id>
  useEffect(() => {
    const m = /event=([\w-]+)/.exec(window.location.hash)
    if (m && byId.has(m[1])) selectEvent(m[1])
    // run once per dataset
  }, [dataset.meta.id])  
  useEffect(() => {
    if (selectedEventId) history.replaceState(null, '', `#event=${selectedEventId}`)
  }, [selectedEventId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="application"]')) return
      if (e.key === ' ' && mode === 'investigate') {
        e.preventDefault()
        ctl.toggle()
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.querySelector('input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctl, mode])

  // Broadcast playhead to collaborators at most twice a second.
  const lastPresence = useRef(0)
  useEffect(() => {
    if (!adapter.updatePresence) return
    const now = Date.now()
    if (now - lastPresence.current > 500) {
      lastPresence.current = now
      adapter.updatePresence({ t: ctl.t, eventId: selectedEventId ?? undefined })
    }
  }, [ctl.t, selectedEventId, adapter])

  const errorCount = useMemo(() => dataset.events.filter((e) => SEVERITY_RANK[e.severity] >= 3).length, [dataset.events])
  const spanSec = (replay.end - replay.start) / 1000
  const branchTs = origin + branchAtSec * 1000
  const simulationFindings = useMemo(
    () => adapter.simulations.map((s) => ({ label: s.label, overall: s.overall, branchAtSec: s.branchAtSec, summary: s.summary, assumptions: s.assumptions })),
    [adapter.simulations],
  )

  const tourSteps: TourStep[] = [
    { title: 'This is a reconstructed incident', body: `${dataset.meta.synthetic ? 'Synthetic data generated by the Faultline simulator, clearly labeled. ' : ''}Every event below came from normalized evidence. Press Replay (or Space) to watch the failure unfold.`, onEnter: () => setMode('investigate') },
    { title: 'Watch it propagate', body: 'The graph shows each service at the playhead. Dashed coral edges are failures flowing from a dependency to its callers. Click a service to see its blast radius.' },
    { title: 'Read the evidence', body: 'Click a marker on the timeline or a hypothesis on the left. The inspector separates observed facts from inferred correlations, and explains each score.' },
    { title: 'Rank the hypotheses', body: 'Hypotheses are ranked by a deterministic, explainable algorithm. They stay "inferred" until a human supports, rejects, or confirms them.' },
    { title: 'Branch the timeline', body: 'Pick a moment and choose "Branch here", then apply an intervention (a rollback, more capacity, a breaker) and run the real simulation.', onEnter: () => setMode('simulate') },
    { title: 'Write it up', body: 'The postmortem is generated from the same structured data. It never promotes an unconfirmed hypothesis to a root cause. Export it as Markdown or JSON.', onEnter: () => setMode('postmortem') },
  ]

  const tabs: Array<{ id: WorkspaceMode; label: string; disabled?: boolean }> = [
    { id: 'investigate', label: 'Investigate' },
    { id: 'simulate', label: 'Simulate', disabled: !props.scenario },
    { id: 'postmortem', label: 'Postmortem' },
  ]

  const timeline = (
    <TimelineView
      engine={replay}
      ctl={ctl}
      serviceOrder={serviceOrder}
      selectedEventId={selectedEventId}
      onSelectEvent={selectEvent}
      bookmarks={adapter.bookmarks}
      onAddBookmark={adapter.addBookmark ? () => adapter.addBookmark!({ ts: ctl.t, label: selectedEvent ? `${selectedEvent.service}: ${selectedEvent.message.slice(0, 48)}` : `Moment at T+${Math.round((ctl.t - replay.start) / 1000)}s` }) : undefined}
      branchAt={props.scenario ? branchTs : null}
      onBranchHere={props.scenario ? () => { setBranchAtSec(Math.max(0, Math.min(props.scenario!.durationSec, Math.round((ctl.t - origin) / 5000) * 5))); setMode('simulate') } : undefined}
      highlightService={selectedService ?? selectedEvent?.service ?? null}
      filteredIds={filteredIds}
    />
  )
  const side = (
    <div ref={searchRef} className="h-full min-h-0">
      <SidePanel
        analysis={analysis}
        state={ctl.state}
        adapter={adapter}
        query={query}
        onQuery={setQuery}
        severities={severities}
        onToggleSeverity={(s) => setSeverities((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n })}
        results={filtered}
        selectedEventId={selectedEventId}
        selectedService={selectedService}
        onSelectEvent={selectEvent}
        onSelectService={setSelectedService}
        onSeek={ctl.seek}
      />
    </div>
  )
  const topology = <TopologyView graph={graph} state={ctl.state} events={dataset.events} selectedService={selectedService} onSelectService={setSelectedService} focusService={selectedEvent?.service ?? null} />
  const inspector = <InspectorPanel analysis={analysis} event={selectedEvent} adapter={adapter} state={ctl.state} onSelectEvent={selectEvent} onSelectService={(id) => setSelectedService(id)} />

  return (
    <div className={cn('flex min-h-0 flex-col bg-background', props.embedded ? 'h-full' : 'h-dvh')}>
      <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        {props.headerLeft}
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">{dataset.meta.title}</h1>
          <span className="font-mono text-[11px] uppercase text-[var(--color-fault)]">{dataset.meta.severity}</span>
          {dataset.meta.synthetic ? <KindTag kind="synthetic" /> : null}
        </div>
        <span className="hidden font-mono text-[11px] text-muted-foreground xl:inline">
          {dataset.events.length.toLocaleString()} events · {errorCount.toLocaleString()} errors · {graph.services.size} services · {duration(spanSec)}
        </span>
        <nav className="flex items-center rounded-md border border-border p-0.5" aria-label="Workspace mode" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={mode === t.id} disabled={t.disabled} onClick={() => setMode(t.id)} className={cn('h-7 rounded px-2.5 text-[12.5px] disabled:opacity-40', mode === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {t.label}
            </button>
          ))}
        </nav>
        {adapter.peers?.length ? (
          <div className="flex items-center -space-x-1.5" aria-label={`${adapter.peers.length} other investigator(s) here`}>
            {adapter.peers.slice(0, 5).map((p) => (
              <span key={p.userId} title={`${p.name}${p.t ? ` at T+${Math.round((p.t - replay.start) / 1000)}s` : ''}`} className="inline-flex size-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-background" style={{ background: p.color }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground 2xl:inline" title={adapter.notice}>{adapter.notice}</span>
          {props.headerRight}
          {props.onGuided ? <ModeSwitch mode="engineering" onGuided={() => props.onGuided!(ctl.t)} /> : null}
        </div>
      </header>

      {mode === 'investigate' ? (
        <>
          {/* Desktop: instrument layout */}
          <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[264px_minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)_minmax(200px,34%)]">
            <aside className="row-span-2 min-h-0 border-r border-border" aria-label="Incident navigator">{side}</aside>
            <section className="min-h-0 border-b border-border" aria-label="Service topology">{topology}</section>
            <aside className="row-span-2 min-h-0 border-l border-border" aria-label="Event inspector">{inspector}</aside>
            <section className="min-h-0" aria-label="Timeline">{timeline}</section>
          </div>
          {/* Tablet / phone: one pane at a time */}
          <div className="flex min-h-0 flex-1 flex-col lg:hidden">
            <div className="flex border-b border-border" role="tablist" aria-label="Panel">
              {(['graph', 'timeline', 'evidence', 'panels'] as MobilePane[]).map((p) => (
                <button key={p} type="button" role="tab" aria-selected={mobilePane === p} onClick={() => setMobilePane(p)} className={cn('h-10 flex-1 text-[12.5px] capitalize', mobilePane === p ? 'border-b-2 border-foreground text-foreground' : 'text-muted-foreground')}>
                  {p === 'panels' ? 'Search & hypotheses' : p}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {mobilePane === 'graph' ? <div className="flex h-full flex-col"><div className="min-h-0 flex-1">{topology}</div><div className="h-[45%] min-h-[180px] border-t border-border">{timeline}</div></div> : null}
              {mobilePane === 'timeline' ? timeline : null}
              {mobilePane === 'evidence' ? inspector : null}
              {mobilePane === 'panels' ? side : null}
            </div>
          </div>
        </>
      ) : null}

      {mode === 'simulate' && props.scenario ? (
        <div className="min-h-0 flex-1">
          <SimulationPanel
            scenario={props.scenario}
            originTs={origin}
            baseline={props.baseline}
            branchAtSec={branchAtSec}
            onBranchAtSec={setBranchAtSec}
            modelAssumptions={props.modelAssumptions ?? []}
            synthetic={dataset.meta.synthetic}
            observed={dataset.events}
            initialInterventions={props.suggestedInterventions}
            savedSimulations={adapter.simulations}
            onSave={adapter.saveSimulation}
          />
        </div>
      ) : null}

      {mode === 'postmortem' ? (
        <div className="min-h-0 flex-1">
          <PostmortemPanel dataset={dataset} hypotheses={analysis.hypotheses} reviews={adapter.reviews} simulations={simulationFindings} onSelectEvent={selectEvent} />
        </div>
      ) : null}

      {props.tour ? <GuidedTour steps={tourSteps} /> : null}
    </div>
  )
}
