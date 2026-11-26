/**
 * Ingestion pipeline, executed by AppJobRoom (src/jobs.ts).
 *
 * Stages: queued → reading → validating → normalizing → deduplicating →
 * correlating → persisting → completed | failed | canceled. Each stage is
 * written to the `ingestion_jobs` record (team-readable, so collaborators see
 * live progress) and broadcast via ctx.progress.
 *
 * Idempotency: events are upserted under their content-derived id, and
 * derived data (edges, hypotheses, topology) is fully recomputed, so a retry
 * after a partial failure converges to the same state without duplicates.
 */
import type { Job, JobContext } from 'deepspace/worker'
import { appFiles } from 'deepspace/worker'
import type { CanonicalEvent, Dependency, IncidentDataset, ServiceDef, Severity, EventType } from '@faultline/engine'
import { analyzeIncident, demoScenario, generateIncident, ImportTooLargeError, mergeEvents, normalizeSource, toJsonl } from '@faultline/engine'
import type { Env } from '../../worker'
import { createActionTools } from './action-routes'
import { isOwnPrivateKey } from './keys'
import { createRecord, deleteAll, DomainError, getRecord, queryAll, requireRole, updateRecord, type IncidentRow, type Rec } from './domain'

export const MAX_EVENTS_PER_INCIDENT = 5_000
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const WRITE_CHUNK = 20

export interface IngestPayload {
  jobRecordId: string
  workspaceId: string
  incidentId: string
  sourceId?: string
  demoSlug?: string
}

interface EventRow {
  workspaceId: string
  incidentId: string
  ts: number
  durationMs?: number
  source?: string
  service: string
  environment?: string
  severity: string
  type: string
  message: string
  traceId?: string
  spanId?: string
  parentSpanId?: string
  requestId?: string
  deploymentId?: string
  host?: string
  region?: string
  metadata?: CanonicalEvent['metadata']
  sourceRef?: CanonicalEvent['sourceRef']
  flags?: string[]
}

export function rowToEvent(r: Rec<EventRow>): CanonicalEvent {
  const d = r.data
  return {
    id: r.recordId,
    incidentId: d.incidentId,
    ts: d.ts,
    durationMs: d.durationMs ?? undefined,
    source: d.source ?? '',
    service: d.service,
    environment: d.environment ?? 'production',
    severity: d.severity as Severity,
    type: d.type as EventType,
    message: d.message,
    traceId: d.traceId || undefined,
    spanId: d.spanId || undefined,
    parentSpanId: d.parentSpanId || undefined,
    requestId: d.requestId || undefined,
    deploymentId: d.deploymentId || undefined,
    host: d.host || undefined,
    region: d.region || undefined,
    metadata: d.metadata ?? {},
    sourceRef: d.sourceRef ?? { sourceId: '', sourceName: '', line: 0, format: 'json' },
    flags: d.flags?.length ? d.flags : undefined,
  }
}

function eventToRow(workspaceId: string, e: CanonicalEvent): Record<string, unknown> {
  return {
    workspaceId,
    incidentId: e.incidentId,
    sourceId: e.sourceRef.sourceId,
    ts: e.ts,
    durationMs: e.durationMs,
    source: e.source,
    service: e.service,
    environment: e.environment,
    severity: e.severity,
    type: e.type,
    message: e.message,
    traceId: e.traceId ?? '',
    spanId: e.spanId ?? '',
    parentSpanId: e.parentSpanId ?? '',
    requestId: e.requestId ?? '',
    deploymentId: e.deploymentId ?? '',
    host: e.host ?? '',
    region: e.region ?? '',
    metadata: e.metadata,
    sourceRef: e.sourceRef,
    flags: e.flags ?? [],
  }
}

class Canceled extends Error {}

export async function runIngestion(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  const p = job.payload as IngestPayload
  const actor = job.enqueuedBy
  if (!actor) throw new Error('Job has no verified enqueuer.')
  const tools = createActionTools(env, actor, '')
  // The payload is caller-supplied: re-check authorization inside the job.
  await requireRole(tools, p.workspaceId, actor, 'collaborator')
  const incident = await getRecord<IncidentRow>(tools, 'incidents', p.incidentId)
  if (!incident || incident.data.workspaceId !== p.workspaceId) throw new DomainError('Incident not found in this workspace.', 'not_found')

  const startedAt = Date.now()
  const stage = async (s: string, progress: number, message: string, extra: Record<string, unknown> = {}) => {
    ctx.progress(progress, `${s}: ${message}`)
    await updateRecord(tools, 'ingestion_jobs', p.jobRecordId, { stage: s, progress, message, ...extra })
  }
  const checkCancel = async () => {
    const rec = await getRecord<{ cancelRequested?: number }>(tools, 'ingestion_jobs', p.jobRecordId)
    if (ctx.signal.aborted || rec?.data.cancelRequested) throw new Canceled()
  }

  try {
    await stage('reading', 0.05, 'reading source', { startedAt, attempt: job.attempts, jobId: job.id, error: '' })
    let text: string
    let sourceName: string
    let declaredServices: ServiceDef[] = []
    let declaredDeps: Dependency[] = []
    let demoAnnotations: IncidentDataset['annotations'] = []
    let meta: Partial<IncidentDataset['meta']> = {}
    if (p.demoSlug) {
      const demo = demoScenario(p.demoSlug)
      if (!demo) throw new DomainError(`Unknown demo incident ${p.demoSlug}.`, 'invalid')
      const { dataset } = generateIncident(demo)
      text = toJsonl(dataset.events)
      sourceName = `${demo.slug}.synthetic.jsonl`
      declaredServices = dataset.services
      declaredDeps = dataset.dependencies
      demoAnnotations = dataset.annotations
      meta = dataset.meta
    } else {
      if (!p.sourceId) throw new DomainError('sourceId is required.', 'invalid')
      const source = await getRecord<{ workspaceId: string; incidentId: string; fileKey: string; uploadedBy: string; name: string; sizeBytes: number }>(tools, 'sources', p.sourceId)
      if (!source || source.data.incidentId !== p.incidentId) throw new DomainError('Source not found for this incident.', 'not_found')
      if (source.data.sizeBytes > MAX_SOURCE_BYTES) throw new DomainError('Source exceeds the 10 MiB limit.', 'limit')
      // Defense in depth: the stored key must still sit in the uploader's own
      // folder, even though registerSource validated it on the way in.
      if (!isOwnPrivateKey(source.data.fileKey, env.DEEPSPACE_APP_ID, source.data.uploadedBy)) throw new DomainError('The stored file reference is outside the private upload area of the person who uploaded it.', 'forbidden')
      await updateRecord(tools, 'sources', p.sourceId, { status: 'processing' })
      // Read with the uploader's own private scope: a job can only read files
      // the uploader could read themselves.
      const res = await appFiles(env, { scope: 'self', userId: source.data.uploadedBy }).download(source.data.fileKey)
      text = await res.text()
      if (text.length > MAX_SOURCE_BYTES) throw new DomainError('Source exceeds the 10 MiB limit.', 'limit')
      sourceName = source.data.name
    }
    await checkCancel()

    await stage('validating', 0.15, `${(text.length / 1024).toFixed(0)} KiB read`)
    await stage('normalizing', 0.2, 'parsing and normalizing records')
    const sourceId = p.sourceId ?? `demo:${p.demoSlug}`
    const result = normalizeSource(text, {
      incidentId: p.incidentId,
      sourceId,
      sourceName,
      limits: { maxRecords: MAX_EVENTS_PER_INCIDENT },
      signal: ctx.signal,
    })
    if (p.demoSlug) for (const e of result.events) e.metadata.synthetic = true
    await checkCancel()

    await stage('deduplicating', 0.35, `${result.events.length} normalized, ${result.duplicates.length} duplicate(s), ${result.errors.length} rejected`)
    const existing = (await queryAll<EventRow>(tools, 'events', { incidentId: p.incidentId }, MAX_EVENTS_PER_INCIDENT + 1)).map(rowToEvent)
    const merged = mergeEvents(existing, result.events)
    if (merged.events.length > MAX_EVENTS_PER_INCIDENT) {
      throw new DomainError(`This import would bring the incident to ${merged.events.length} events; the limit is ${MAX_EVENTS_PER_INCIDENT}.`, 'limit')
    }
    const existingIds = new Set(existing.map((e) => e.id))
    const toWrite = result.events.filter((e) => !existingIds.has(e.id))
    await checkCancel()

    await stage('correlating', 0.45, `correlating ${merged.events.length} events`)
    const oldDeps = await queryAll<{ from: string; to: string; origin: Dependency['origin'] }>(tools, 'dependencies', { incidentId: p.incidentId })
    const deps = [...declaredDeps, ...oldDeps.filter((d) => d.data.origin === 'declared').map((d) => ({ from: d.data.from, to: d.data.to, origin: 'declared' as const }))]
    const analysis = analyzeIncident({
      meta: { id: p.incidentId, title: incident.data.title, severity: (incident.data.severity as 'sev3') ?? 'sev3', synthetic: Boolean(incident.data.synthetic) },
      events: merged.events,
      services: declaredServices,
      dependencies: deps,
      annotations: [],
    })
    await checkCancel()

    await stage('persisting', 0.55, `writing ${toWrite.length} new event(s)`)
    for (let i = 0; i < toWrite.length; i += WRITE_CHUNK) {
      await Promise.all(toWrite.slice(i, i + WRITE_CHUNK).map((e) => createRecord(tools, 'events', eventToRow(p.workspaceId, e), e.id)))
      if (i % (WRITE_CHUNK * 10) === 0) {
        await checkCancel()
        const frac = toWrite.length ? i / toWrite.length : 1
        await stage('persisting', 0.55 + 0.3 * frac, `wrote ${i} of ${toWrite.length} events`)
      }
    }
    // Derived data is recomputed wholesale (retry-safe).
    await deleteAll(tools, 'correlation_edges', { incidentId: p.incidentId })
    await deleteAll(tools, 'hypotheses', { incidentId: p.incidentId })
    await deleteAll(tools, 'services', { incidentId: p.incidentId })
    await deleteAll(tools, 'dependencies', { incidentId: p.incidentId })
    for (let i = 0; i < analysis.correlation.edges.length; i += WRITE_CHUNK) {
      await Promise.all(analysis.correlation.edges.slice(i, i + WRITE_CHUNK).map((edge) => createRecord(tools, 'correlation_edges', {
        workspaceId: p.workspaceId, incidentId: p.incidentId, source: edge.source, target: edge.target, score: edge.score,
        signals: edge.signals, explanation: edge.explanation, deltaMs: edge.deltaMs, algorithmVersion: edge.algorithmVersion,
      }, edge.id)))
    }
    for (const h of analysis.hypotheses) {
      await createRecord(tools, 'hypotheses', {
        workspaceId: p.workspaceId, incidentId: p.incidentId, rank: h.rank, title: h.title, service: h.service, eventId: h.eventId,
        score: h.score, factors: h.factors, supportingEventIds: h.supportingEventIds, explanation: h.explanation, algorithmVersion: h.algorithmVersion,
      }, h.id)
    }
    for (const s of analysis.dataset.services) await createRecord(tools, 'services', { workspaceId: p.workspaceId, incidentId: p.incidentId, serviceId: s.id, kind: s.kind })
    for (const d of analysis.dataset.dependencies) await createRecord(tools, 'dependencies', { workspaceId: p.workspaceId, incidentId: p.incidentId, from: d.from, to: d.to, origin: d.origin })
    // Event ids are derived from the incident id, so anchor each synthetic
    // annotation to the nearest non-info event of THIS incident by time.
    for (const a of demoAnnotations) {
      let nearest: CanonicalEvent | undefined
      for (const e of analysis.dataset.events) if (e.severity !== 'info' && (!nearest || Math.abs(e.ts - (a.ts ?? 0)) < Math.abs(nearest.ts - (a.ts ?? 0)))) nearest = e
      await createRecord(tools, 'annotations', { workspaceId: p.workspaceId, incidentId: p.incidentId, eventId: nearest?.id ?? '', ts: a.ts ?? 0, body: a.body, kind: a.kind, authorName: `${a.author} [synthetic]` }, `${a.id}-${p.incidentId}`)
    }

    const evs = analysis.dataset.events
    const firstError = evs.find((e) => e.severity === 'error' || e.severity === 'critical')
    const alert = evs.find((e) => e.type === 'alert')
    const recovery = [...evs].reverse().find((e) => e.type === 'recovery')
    const sources = await queryAll(tools, 'sources', { incidentId: p.incidentId })
    await updateRecord(tools, 'incidents', p.incidentId, {
      eventCount: evs.length,
      serviceCount: analysis.dataset.services.length,
      sourceCount: Math.max(sources.length, p.demoSlug ? 1 : 0),
      startedAt: meta.startedAt ?? firstError?.ts ?? evs[0]?.ts ?? 0,
      detectedAt: meta.detectedAt ?? alert?.ts ?? 0,
      resolvedAt: meta.resolvedAt ?? recovery?.ts ?? 0,
      status: incident.data.status === 'open' ? 'investigating' : incident.data.status,
      analysis: {
        correlationVersion: analysis.correlation.algorithmVersion,
        params: analysis.correlation.params,
        stats: analysis.correlation.stats,
        timings: analysis.timings,
        updatedAt: Date.now(),
      },
    })
    const stats = { ...result.stats, added: toWrite.length, totalEvents: evs.length, edges: analysis.correlation.edges.length, hypotheses: analysis.hypotheses.length }
    if (p.sourceId) await updateRecord(tools, 'sources', p.sourceId, { status: 'processed', stats, errors: result.errors.slice(0, 100), format: result.stats.format })
    await stage('completed', 1, `${toWrite.length} event(s) added, ${analysis.correlation.edges.length} correlations, ${analysis.hypotheses.length} hypotheses`, { stats, finishedAt: Date.now() })
    await tools.create('audit_events', { workspaceId: p.workspaceId, incidentId: p.incidentId, actorId: actor, action: 'ingestion.completed', target: sourceId, detail: { added: toWrite.length, rejected: result.errors.length } })
    return { added: toWrite.length, rejected: result.errors.length, duplicates: result.duplicates.length }
  } catch (err) {
    if (err instanceof Canceled || (err instanceof Error && err.name === 'AbortError')) {
      await updateRecord(tools, 'ingestion_jobs', p.jobRecordId, { stage: 'canceled', message: 'Canceled by a user. Events already written are kept; re-run to finish.', finishedAt: Date.now() })
      if (p.sourceId) await updateRecord(tools, 'sources', p.sourceId, { status: 'canceled' })
      return { canceled: true }
    }
    const message = err instanceof DomainError || err instanceof ImportTooLargeError ? err.message : `Ingestion failed: ${err instanceof Error ? err.message : String(err)}`
    await updateRecord(tools, 'ingestion_jobs', p.jobRecordId, { stage: 'failed', error: message, finishedAt: Date.now() }).catch(() => undefined)
    if (p.sourceId) await updateRecord(tools, 'sources', p.sourceId, { status: 'failed' }).catch(() => undefined)
    // Permanent problems should not be retried by the JobRoom.
    if (err instanceof DomainError || err instanceof ImportTooLargeError) return { failed: true, error: message }
    throw err
  }
}
