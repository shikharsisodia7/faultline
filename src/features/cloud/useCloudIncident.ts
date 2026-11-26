import { useMemo } from 'react'
import { useAuth, usePresenceRoom, useQuery, getUserColor } from 'deepspace'
import type {
  Annotation, CanonicalEvent, CorrelationEdge, CorrelationResult, Dependency, EventType, Hypothesis, HypothesisReview,
  IncidentAnalysis, IncidentDataset, ServiceDef, Severity,
} from '@faultline/engine'
import { DEFAULT_CORRELATION_PARAMS, ReplayEngine, ServiceGraph, compareEvents } from '@faultline/engine'
import type { Bookmark, PresencePeer, ReviewTally, SavedSimulation, WorkspaceAdapter } from '../workspace/adapter'
import { callAction } from './api'

type Env<T> = { recordId: string; data: T; createdBy: string; createdAt: string }

export interface IncidentRecord {
  workspaceId: string
  title: string
  summary?: string
  severity: 'sev1' | 'sev2' | 'sev3' | 'sev4'
  status: 'open' | 'investigating' | 'resolved'
  synthetic?: number
  category?: string
  environment?: string
  startedAt?: number
  detectedAt?: number
  resolvedAt?: number
  eventCount?: number
  serviceCount?: number
  sourceCount?: number
  demoSlug?: string
  analysis?: { stale?: boolean; correlationVersion?: string; updatedAt?: number; stats?: CorrelationResult['stats'] } | null
  createdByName?: string
}

interface EventRow { incidentId: string; sourceId?: string; ts: number; durationMs?: number; source?: string; service: string; environment?: string; severity: string; type: string; message: string; traceId?: string; spanId?: string; parentSpanId?: string; requestId?: string; deploymentId?: string; host?: string; region?: string; metadata?: CanonicalEvent['metadata']; sourceRef?: CanonicalEvent['sourceRef']; flags?: string[] }

export function toEvent(r: Env<EventRow>): CanonicalEvent {
  const d = r.data
  return {
    id: r.recordId, incidentId: d.incidentId, ts: d.ts, durationMs: d.durationMs ?? undefined, source: d.source ?? '', service: d.service,
    environment: d.environment ?? 'production', severity: d.severity as Severity, type: d.type as EventType, message: d.message,
    traceId: d.traceId || undefined, spanId: d.spanId || undefined, parentSpanId: d.parentSpanId || undefined, requestId: d.requestId || undefined,
    deploymentId: d.deploymentId || undefined, host: d.host || undefined, region: d.region || undefined, metadata: d.metadata ?? {},
    sourceRef: d.sourceRef ?? { sourceId: d.sourceId ?? '', sourceName: d.source ?? '', line: 0, format: 'json' }, flags: d.flags?.length ? d.flags : undefined,
  }
}

export interface CloudIncident {
  status: 'loading' | 'ready' | 'error' | 'missing'
  error?: string
  incident?: Env<IncidentRecord>
  analysis?: IncidentAnalysis
  adapter?: WorkspaceAdapter
  jobs: Array<Env<{ stage: string; progress: number; message?: string; error?: string; sourceId?: string; stats?: Record<string, unknown>; attempt?: number; cancelRequested?: number }>>
  sources: Array<Env<{ name: string; format?: string; status: string; sizeBytes: number; stats?: Record<string, unknown>; errors?: Array<{ line: number; code: string; message: string }>; uploadedBy: string }>>
  role: 'owner' | 'collaborator' | 'viewer' | null
}

/** Live, RBAC-filtered view of one incident, shaped for the shared Workspace UI. */
export function useCloudIncident(incidentId: string): CloudIncident {
  const { user } = useAuth() as { user?: { id?: string; name?: string } | null }
  const myId = user?.id ?? ''
  const where = { incidentId }
  // RBAC already limits this to incidents in the caller's workspaces.
  const inc = useQuery<IncidentRecord>('incidents')
  const events = useQuery<EventRow>('events', { where })
  const edges = useQuery<Omit<CorrelationEdge, 'id'> & { incidentId: string }>('correlation_edges', { where })
  const hyps = useQuery<Omit<Hypothesis, 'id' | 'status'> & { incidentId: string }>('hypotheses', { where })
  const reviews = useQuery<{ hypothesisId: string; userId: string; review: HypothesisReview }>('hypothesis_reviews', { where })
  const services = useQuery<{ serviceId: string; kind: ServiceDef['kind'] }>('services', { where })
  const deps = useQuery<{ from: string; to: string; origin: Dependency['origin'] }>('dependencies', { where })
  const anns = useQuery<{ eventId?: string; ts?: number; body: string; kind: Annotation['kind']; authorName?: string }>('annotations', { where })
  const bms = useQuery<{ ts: number; label: string; authorName?: string }>('bookmarks', { where })
  const sims = useQuery<{ label: string; branchAtSec: number; interventions: SavedSimulation['interventions']; overall: SavedSimulation['overall']; summary: string; assumptions: string[]; authorName?: string }>('simulation_runs', { where })
  const jobs = useQuery<CloudIncident['jobs'][number]['data']>('ingestion_jobs', { where, orderBy: 'createdAt', orderDir: 'desc' })
  const sources = useQuery<CloudIncident['sources'][number]['data']>('sources', { where })
  const members = useQuery<{ teamId: string; userId: string; role: 'owner' | 'collaborator' | 'viewer'; status: string }>('team_members', { where: { userId: myId } as never })
  const presence = usePresenceRoom(`incident:${incidentId}`)

  const incident = inc.records.find((r) => r.recordId === incidentId) as Env<IncidentRecord> | undefined
  const role = useMemo(() => {
    const m = members.records.find((r) => incident && r.data.teamId === incident.data.workspaceId && r.data.status !== 'removed')
    return m?.data.role ?? null
  }, [members.records, incident])
  const canEdit = role === 'owner' || role === 'collaborator'

  const analysis = useMemo<IncidentAnalysis | undefined>(() => {
    if (!incident) return undefined
    const evs = events.records.map((r) => toEvent(r as Env<EventRow>)).sort(compareEvents)
    const svcDefs: ServiceDef[] = services.records.map((r) => ({ id: r.data.serviceId, name: r.data.serviceId, kind: r.data.kind }))
    const depDefs: Dependency[] = deps.records.map((r) => ({ from: r.data.from, to: r.data.to, origin: r.data.origin }))
    const known = new Set(svcDefs.map((s) => s.id))
    for (const e of evs) if (!known.has(e.service)) { known.add(e.service); svcDefs.push({ id: e.service, name: e.service, kind: 'service' }) }
    const dataset: IncidentDataset = {
      meta: {
        id: incident.recordId, title: incident.data.title, summary: incident.data.summary, severity: incident.data.severity, synthetic: Boolean(incident.data.synthetic),
        startedAt: incident.data.startedAt || undefined, detectedAt: incident.data.detectedAt || undefined, resolvedAt: incident.data.resolvedAt || undefined,
        category: incident.data.category, environment: incident.data.environment,
      },
      events: evs,
      services: svcDefs,
      dependencies: depDefs,
      annotations: [],
    }
    const corrEdges: CorrelationEdge[] = edges.records.map((r) => ({ id: r.recordId, source: r.data.source, target: r.data.target, score: r.data.score, signals: r.data.signals, explanation: r.data.explanation, deltaMs: r.data.deltaMs, algorithmVersion: r.data.algorithmVersion }))
    const hypotheses: Hypothesis[] = hyps.records.map((r) => ({ id: r.recordId, rank: r.data.rank, title: r.data.title, service: r.data.service, eventId: r.data.eventId, score: r.data.score, factors: r.data.factors, supportingEventIds: r.data.supportingEventIds ?? [], explanation: r.data.explanation ?? [], status: 'inferred' as const, algorithmVersion: r.data.algorithmVersion })).sort((a, b) => a.rank - b.rank)
    return {
      dataset,
      graph: new ServiceGraph(svcDefs, depDefs),
      correlation: { edges: corrEdges, params: DEFAULT_CORRELATION_PARAMS, algorithmVersion: incident.data.analysis?.correlationVersion ?? 'faultline-corr/1.0.0', stats: incident.data.analysis?.stats ?? { participating: 0, candidatePairs: 0, edges: corrEdges.length } },
      hypotheses,
      replay: new ReplayEngine(evs, svcDefs.map((s) => s.id)),
      timings: { correlateMs: 0, rankMs: 0, replayMs: 0 },
    }
  }, [incident, events.records, edges.records, hyps.records, services.records, deps.records])

  const adapter = useMemo<WorkspaceAdapter | undefined>(() => {
    if (!incident) return undefined
    const tallies: Record<string, ReviewTally> = {}
    const effective: Record<string, HypothesisReview> = {}
    for (const r of reviews.records) {
      const t = (tallies[r.data.hypothesisId] ??= { support: 0, reject: 0, confirm: 0 })
      if (r.data.review === 'supported') t.support++
      if (r.data.review === 'rejected') t.reject++
      if (r.data.review === 'confirmed') t.confirm++
      if (r.data.userId === myId) t.mine = r.data.review
    }
    for (const [hid, t] of Object.entries(tallies)) {
      // A confirmation (owners only, server-enforced) wins; otherwise the majority view; ties stay inferred.
      effective[hid] = t.confirm > 0 ? 'confirmed' : t.reject > t.support ? 'rejected' : t.support > t.reject ? 'supported' : 'inferred'
    }
    const peers: PresencePeer[] = presence.peers.map((p) => ({ userId: p.userId, name: p.userName || 'Investigator', color: getUserColor(p.userId), t: (p.state as { t?: number }).t, eventId: (p.state as { eventId?: string }).eventId }))
    const base = { incidentId: incident.recordId }
    return {
      mode: 'cloud',
      notice: canEdit ? 'Live: changes sync to your workspace.' : 'Read-only: you are a viewer of this workspace.',
      canEdit,
      annotations: anns.records.map((r) => ({ id: r.recordId, eventId: r.data.eventId || undefined, ts: r.data.ts || undefined, author: r.data.authorName ?? 'A teammate', body: r.data.body, kind: r.data.kind, synthetic: (r.data.authorName ?? '').includes('[synthetic]') })),
      addAnnotation: canEdit ? async (a) => { await callAction('addAnnotation', { ...base, ...a }) } : undefined,
      removeAnnotation: canEdit ? async (id) => { await callAction('removeAnnotation', { annotationId: id }) } : undefined,
      reviews: effective,
      tallies,
      setReview: canEdit ? async (hypothesisId, review) => { await callAction('reviewHypothesis', { hypothesisId, review }) } : undefined,
      bookmarks: bms.records.map((r) => ({ id: r.recordId, ts: r.data.ts, label: r.data.label, author: r.data.authorName })).sort((a: Bookmark, b: Bookmark) => a.ts - b.ts),
      addBookmark: canEdit ? async (b) => { await callAction('addBookmark', { ...base, ...b }) } : undefined,
      removeBookmark: canEdit ? async (id) => { await callAction('removeBookmark', { bookmarkId: id }) } : undefined,
      simulations: sims.records.map((r) => ({ id: r.recordId, label: r.data.label, branchAtSec: r.data.branchAtSec, interventions: r.data.interventions ?? [], overall: r.data.overall, summary: r.data.summary, assumptions: r.data.assumptions ?? [], createdAt: Date.parse(r.createdAt), author: r.data.authorName })),
      saveSimulation: canEdit ? async (s) => { await callAction('saveSimulation', { ...base, ...s }) } : undefined,
      peers,
      updatePresence: (state) => presence.updateState(state),
    }
  }, [incident, reviews.records, anns.records, bms.records, sims.records, presence, canEdit, myId])

  const anyError = [inc, events, edges, hyps].find((q) => q.status === 'error')
  const loading = [inc, events, edges, hyps, services, deps].some((q) => q.status === 'loading')
  return {
    status: anyError ? 'error' : loading ? 'loading' : incident ? 'ready' : 'missing',
    error: anyError?.error,
    incident,
    analysis,
    adapter,
    jobs: jobs.records as CloudIncident['jobs'],
    sources: sources.records as CloudIncident['sources'],
    role,
  }
}
