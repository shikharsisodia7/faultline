/**
 * Server actions: the ONLY write path for workspace data.
 *
 * Each action validates its input, checks the caller's workspace role
 * (default-deny, src/server/domain.ts), performs the write with RBAC off, and
 * records an audit event. Clients have `create: false` on every
 * workspace-scoped collection, so there is no other way in.
 */
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import { enqueueJob, appFiles } from 'deepspace/worker'
import type { Intervention } from '@faultline/engine'
import { DEMO_SCENARIOS, INTERVENTION_KINDS } from '@faultline/engine'
import type { Env } from '../../worker'
import { WORKSPACE_ROLES, type WorkspaceRole } from '../schemas/faultline-schemas'
import {
  audit, createRecord, deleteAll, DomainError, fail, getRecord, INCIDENT_CHILDREN, loadIncident, oneOf, queryAll,
  requireRole, str, updateRecord, workspaceRole, type Rec,
} from '../server/domain'
import { MAX_SOURCE_BYTES } from '../server/ingest'
import { askInvestigator, importGithubCommits, searchRemediation } from '../server/integrations'

type Handler = ActionHandler<Env>

async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const u = await getRecord<{ name?: string; displayName?: string }>(tools, 'users', userId)
  return (u?.data.name || u?.data.displayName || 'A teammate').slice(0, 80)
}

async function newWorkspace(tools: ActionTools, userId: string, name: string, kind: 'personal' | 'team'): Promise<string> {
  const id = await createRecord(tools, 'workspaces', { workspaceId: 'pending', name, ownerId: userId, kind })
  await updateRecord(tools, 'workspaces', id, { workspaceId: id })
  await createRecord(tools, 'team_members', { teamId: id, userId, role: 'owner', status: 'active', displayName: await displayName(tools, userId), invitedBy: userId })
  await audit(tools, id, userId, 'workspace.created', id, { name, kind })
  return id
}

async function startJob(env: Env, tools: ActionTools, userId: string, type: 'ingest-source' | 'import-demo', payload: { workspaceId: string; incidentId: string; sourceId?: string; demoSlug?: string }, attempt = 1): Promise<string> {
  const jobRecordId = await createRecord(tools, 'ingestion_jobs', {
    workspaceId: payload.workspaceId, incidentId: payload.incidentId, sourceId: payload.sourceId ?? '', stage: 'queued', progress: 0,
    message: 'queued', requestedBy: userId, attempt, cancelRequested: 0,
  })
  const jobId = await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, type, { ...payload, jobRecordId }, { enqueuedBy: userId })
  await updateRecord(tools, 'ingestion_jobs', jobRecordId, { jobId })
  return jobRecordId
}

export const actions: Record<string, Handler> = {
  /** Returns the caller's personal workspace, creating it on first use. */
  ensureWorkspace: async ({ userId, tools }) => {
    try {
      const memberships = await queryAll<{ teamId: string; role: WorkspaceRole; status: string }>(tools, 'team_members', { userId }, 200)
      const active = memberships.filter((m) => m.data.status !== 'removed')
      for (const m of active) {
        const ws = await getRecord<{ kind: string; ownerId: string }>(tools, 'workspaces', m.data.teamId)
        if (ws?.data.kind === 'personal' && ws.data.ownerId === userId) return { success: true, data: { workspaceId: ws.recordId, created: false } }
      }
      const id = await newWorkspace(tools, userId, 'Personal workspace', 'personal')
      return { success: true, data: { workspaceId: id, created: true } }
    } catch (e) {
      return fail(e)
    }
  },

  createWorkspace: async ({ userId, tools, params }) => {
    try {
      const owned = (await queryAll<{ role: string }>(tools, 'team_members', { userId }, 200)).filter((m) => m.data.role === 'owner')
      if (owned.length >= 10) throw new DomainError('You can own at most 10 workspaces.', 'limit')
      return { success: true, data: { workspaceId: await newWorkspace(tools, userId, str(params.name, 'Workspace name', 80), 'team') } }
    } catch (e) {
      return fail(e)
    }
  },

  /** Owner adds or re-activates a member by user id (picked from the user directory). */
  setMember: async ({ userId, tools, params }) => {
    try {
      const workspaceId = str(params.workspaceId, 'workspaceId')
      await requireRole(tools, workspaceId, userId, 'owner')
      const memberId = str(params.userId, 'userId')
      const role = oneOf(params.role, WORKSPACE_ROLES, 'role')
      const ws = await getRecord<{ ownerId: string; kind: string }>(tools, 'workspaces', workspaceId)
      if (ws?.data.kind === 'personal') throw new DomainError('Personal workspaces cannot be shared. Create a team workspace.', 'invalid')
      if (memberId === ws?.data.ownerId && role !== 'owner') throw new DomainError('The workspace creator always stays an owner.', 'invalid')
      const user = await getRecord(tools, 'users', memberId)
      if (!user) throw new DomainError('No such user.', 'not_found')
      const existing = (await queryAll<{ role: string }>(tools, 'team_members', { teamId: workspaceId, userId: memberId }, 1))[0]
      if (existing) await updateRecord(tools, 'team_members', existing.recordId, { role, status: 'active' })
      else await createRecord(tools, 'team_members', { teamId: workspaceId, userId: memberId, role, status: 'active', displayName: await displayName(tools, memberId), invitedBy: userId })
      await audit(tools, workspaceId, userId, 'member.set', memberId, { role })
      return { success: true, data: { ok: true } }
    } catch (e) {
      return fail(e)
    }
  },

  removeMember: async ({ userId, tools, params }) => {
    try {
      const workspaceId = str(params.workspaceId, 'workspaceId')
      const memberId = str(params.userId, 'userId')
      // Members may leave; only owners may remove others.
      await requireRole(tools, workspaceId, userId, memberId === userId ? 'viewer' : 'owner')
      const ws = await getRecord<{ ownerId: string }>(tools, 'workspaces', workspaceId)
      if (ws?.data.ownerId === memberId) throw new DomainError('The workspace creator cannot be removed.', 'invalid')
      const row = (await queryAll(tools, 'team_members', { teamId: workspaceId, userId: memberId }, 1))[0]
      if (!row) throw new DomainError('Not a member.', 'not_found')
      await updateRecord(tools, 'team_members', row.recordId, { status: 'removed' })
      await audit(tools, workspaceId, userId, 'member.removed', memberId)
      return { success: true, data: { ok: true } }
    } catch (e) {
      return fail(e)
    }
  },

  createIncident: async ({ userId, tools, params }) => {
    try {
      const workspaceId = str(params.workspaceId, 'workspaceId')
      await requireRole(tools, workspaceId, userId, 'collaborator')
      const existing = await queryAll(tools, 'incidents', { workspaceId }, 501)
      if (existing.length >= 500) throw new DomainError('A workspace can hold at most 500 incidents.', 'limit')
      const id = await createRecord(tools, 'incidents', {
        workspaceId,
        title: str(params.title, 'Title', 140),
        summary: str(params.summary, 'Summary', 2000, false),
        severity: oneOf(params.severity, ['sev1', 'sev2', 'sev3', 'sev4'] as const, 'severity', 'sev3'),
        status: 'open',
        synthetic: 0,
        environment: str(params.environment, 'Environment', 40, false) || 'production',
        category: str(params.category, 'Category', 60, false),
        createdByName: await displayName(tools, userId),
      })
      await audit(tools, workspaceId, userId, 'incident.created', id, {}, id)
      return { success: true, data: { incidentId: id } }
    } catch (e) {
      return fail(e)
    }
  },

  updateIncident: async ({ userId, tools, params }) => {
    try {
      const inc = await loadIncident(tools, params.incidentId, userId, 'collaborator')
      const patch: Record<string, unknown> = {}
      if (params.title !== undefined) patch.title = str(params.title, 'Title', 140)
      if (params.summary !== undefined) patch.summary = str(params.summary, 'Summary', 2000, false)
      if (params.severity !== undefined) patch.severity = oneOf(params.severity, ['sev1', 'sev2', 'sev3', 'sev4'] as const, 'severity')
      if (params.status !== undefined) patch.status = oneOf(params.status, ['open', 'investigating', 'resolved'] as const, 'status')
      await updateRecord(tools, 'incidents', inc.recordId, patch)
      await audit(tools, inc.data.workspaceId, userId, 'incident.updated', inc.recordId, patch, inc.recordId)
      return { success: true, data: { ok: true } }
    } catch (e) {
      return fail(e)
    }
  },

  /** Deletes an incident, every child row, and its raw uploaded files. Owner only. */
  deleteIncident: async ({ userId, tools, params, env }) => {
    try {
      const inc = await loadIncident(tools, params.incidentId, userId, 'owner')
      const sources = await queryAll<{ fileKey: string; uploadedBy: string }>(tools, 'sources', { incidentId: inc.recordId })
      let filesDeleted = 0
      for (const s of sources) {
        if (!s.data.fileKey) continue
        try {
          const r = await appFiles(env, { scope: 'self', userId: s.data.uploadedBy }).delete(s.data.fileKey)
          if (r.existed) filesDeleted++
        } catch (err) {
          console.warn('[faultline] could not delete source file', s.recordId, err instanceof Error ? err.message : String(err))
        }
      }
      const counts: Record<string, number> = {}
      for (const c of INCIDENT_CHILDREN) counts[c] = await deleteAll(tools, c, { incidentId: inc.recordId })
      await tools.remove('incidents', inc.recordId)
      await audit(tools, inc.data.workspaceId, userId, 'incident.deleted', inc.recordId, { title: inc.data.title, counts, filesDeleted })
      return { success: true, data: { counts, filesDeleted } }
    } catch (e) {
      return fail(e)
    }
  },

  /** Registers an uploaded file (already stored in the caller's private R2 scope). */
  registerSource: async ({ userId, tools, params }) => {
    try {
      const inc = await loadIncident(tools, params.incidentId, userId, 'collaborator')
      const fileKey = str(params.fileKey, 'fileKey', 600)
      // Private uploads live under .../users/<uploader>/...; refuse anything else.
      if (!fileKey.includes(`/users/${userId}/`)) throw new DomainError('That file is not in your private upload area.', 'forbidden')
      const sizeBytes = Number(params.sizeBytes)
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new DomainError('sizeBytes is required.', 'invalid')
      if (sizeBytes > MAX_SOURCE_BYTES) throw new DomainError('Sources are limited to 10 MiB.', 'limit')
      const sourceId = await createRecord(tools, 'sources', {
        workspaceId: inc.data.workspaceId, incidentId: inc.recordId, name: str(params.name, 'name', 200), fileKey, uploadedBy: userId, sizeBytes, status: 'uploaded',
        format: str(params.format, 'format', 20, false),
      })
      await audit(tools, inc.data.workspaceId, userId, 'source.registered', sourceId, { name: params.name, sizeBytes }, inc.recordId)
      return { success: true, data: { sourceId } }
    } catch (e) {
      return fail(e)
    }
  },

  startIngestion: async ({ userId, tools, params, env }) => {
    try {
      const inc = await loadIncident(tools, params.incidentId, userId, 'collaborator')
      const sourceId = str(params.sourceId, 'sourceId')
      const src = await getRecord<{ incidentId: string }>(tools, 'sources', sourceId)
      if (!src || src.data.incidentId !== inc.recordId) throw new DomainError('Source not found for this incident.', 'not_found')
      const running = (await queryAll<{ stage: string; sourceId: string }>(tools, 'ingestion_jobs', { incidentId: inc.recordId })).filter((j) => !['completed', 'failed', 'canceled'].includes(j.data.stage))
      if (running.length >= 3) throw new DomainError('Three imports are already running for this incident. Wait for one to finish.', 'limit')
      const jobRecordId = await startJob(env, tools, userId, 'ingest-source', { workspaceId: inc.data.workspaceId, incidentId: inc.recordId, sourceId })
      await audit(tools, inc.data.workspaceId, userId, 'ingestion.started', sourceId, { jobRecordId }, inc.recordId)
      return { success: true, data: { jobRecordId } }
    } catch (e) {
      return fail(e)
    }
  },

  cancelIngestion: async ({ userId, tools, params }) => {
    try {
      const job = await getRecord<{ incidentId: string; stage: string }>(tools, 'ingestion_jobs', str(params.jobRecordId, 'jobRecordId'))
      if (!job) throw new DomainError('Job not found.', 'not_found')
      const inc = await loadIncident(tools, job.data.incidentId, userId, 'collaborator')
      if (['completed', 'failed', 'canceled'].includes(job.data.stage)) throw new DomainError('That import already finished.', 'conflict')
      await updateRecord(tools, 'ingestion_jobs', job.recordId, { cancelRequested: 1, message: 'cancel requested' })
      await audit(tools, inc.data.workspaceId, userId, 'ingestion.cancel', job.recordId, {}, inc.recordId)
      return { success: true, data: { ok: true } }
    } catch (e) {
      return fail(e)
    }
  },

  retryIngestion: async ({ userId, tools, params, env }) => {
    try {
      const job = await getRecord<{ incidentId: string; sourceId: string; stage: string; attempt?: number }>(tools, 'ingestion_jobs', str(params.jobRecordId, 'jobRecordId'))
      if (!job) throw new DomainError('Job not found.', 'not_found')
      const inc = await loadIncident(tools, job.data.incidentId, userId, 'collaborator')
      if (!['failed', 'canceled'].includes(job.data.stage)) throw new DomainError('Only failed or canceled imports can be retried.', 'conflict')
      const isDemo = !job.data.sourceId && inc.data.demoSlug
      const jobRecordId = await startJob(env, tools, userId, isDemo ? 'import-demo' : 'ingest-source', { workspaceId: inc.data.workspaceId, incidentId: inc.recordId, sourceId: job.data.sourceId || undefined, demoSlug: isDemo ? inc.data.demoSlug : undefined }, (job.data.attempt ?? 1) + 1)
      await audit(tools, inc.data.workspaceId, userId, 'ingestion.retry', job.recordId, { jobRecordId }, inc.recordId)
      return { success: true, data: { jobRecordId } }
    } catch (e) {
      return fail(e)
    }
  },

  /** Creates an incident in the caller's workspace from a synthetic demo (via the ingestion job). */
  copyDemo: async ({ userId, tools, params, env }) => {
    try {
      const workspaceId = str(params.workspaceId, 'workspaceId')
      await requireRole(tools, workspaceId, userId, 'collaborator')
      const demo = DEMO_SCENARIOS.find((d) => d.slug === params.slug)
      if (!demo) throw new DomainError('Unknown demo incident.', 'invalid')
      const incidentId = await createRecord(tools, 'incidents', {
        workspaceId, title: `${demo.title} (copy)`, summary: demo.summary, severity: demo.severity, status: 'open', synthetic: 1,
        category: demo.category, environment: 'production', demoSlug: demo.slug, createdByName: await displayName(tools, userId),
      })
      const jobRecordId = await startJob(env, tools, userId, 'import-demo', { workspaceId, incidentId, demoSlug: demo.slug })
      await audit(tools, workspaceId, userId, 'incident.copied_demo', incidentId, { slug: demo.slug }, incidentId)
      return { success: true, data: { incidentId, jobRecordId } }
    } catch (e) {
      return fail(e)
    }
  },

  addAnnotation: async ({ userId, tools, params }) => {
    try {
      const inc = await loadIncident(tools, params.incidentId, userId, 'collaborator')
      const id = await createRecord(tools, 'annotations', {
        workspaceId: inc.data.workspaceId, incidentId: inc.recordId, eventId: str(params.eventId, 'eventId', 80, false), ts: Number(params.ts) || 0,
        body: str(params.body, 'Note', 2000), kind: oneOf(params.kind, ['note', 'hypothesis', 'action'] as const, 'kind', 'note'), authorName: await displayName(tools, userId),
      })
      await audit(tools, inc.data.workspaceId, userId, 'annotation.added', id, {}, inc.recordId)
      return { success: true, data: { annotationId: id } }
    } catch (e) {
      return fail(e)
    }
  },

  removeAnnotation: async ({ userId, tools, params }) => {
    try {
      const ann = await getRecord<{ incidentId: string }>(tools, 'annotations', str(params.annotationId, 'annotationId'))
      if (!ann) throw new DomainError('Note not found.', 'not_found')
      const inc = await loadIncident(tools, ann.data.incidentId, userId, 'collaborator')
      // Authors delete their own notes; owners may delete any.
      if (ann.createdBy !== userId) await requireRole(tools, inc.data.workspaceId, userId, 'owner')
      await tools.remove('annotations', ann.recordId)
      await audit(tools, inc.data.workspaceId, userId, 'annotation.removed', ann.recordId, {}, inc.recordId)
      return { success: true, data: { ok: true } }
    } catch (e) {
      return fail(e)
    }
  },

  addBookmark: async ({ userId, tools, params }) => {
    try {
      const inc = await loadIncident(tools, params.incidentId, userId, 'collaborator')
      const ts = Number(params.ts)
      if (!Number.isFinite(ts)) throw new DomainError('ts is required.', 'invalid')
      const id = await createRecord(tools, 'bookmarks', { workspaceId: inc.data.workspaceId, incidentId: inc.recordId, ts, label: str(params.label, 'Label', 140), authorName: await displayName(tools, userId) })
      return { success: true, data: { bookmarkId: id } }
    } catch (e) {
      return fail(e)
    }
  },

  removeBookmark: async ({ userId, tools, params }) => {
    try {
      const bm = await getRecord<{ incidentId: string }>(tools, 'bookmarks', str(params.bookmarkId, 'bookmarkId'))
      if (!bm) throw new DomainError('Bookmark not found.', 'not_found')
      await loadIncident(tools, bm.data.incidentId, userId, 'collaborator')
      await tools.remove('bookmarks', bm.recordId)
      return { success: true, data: { ok: true } }
    } catch (e) {
      return fail(e)
    }
  },

  /** One review per user per hypothesis (uniqueOn enforced by the RecordRoom). */
  reviewHypothesis: async ({ userId, tools, params }) => {
    try {
      const hyp = await getRecord<{ incidentId: string }>(tools, 'hypotheses', str(params.hypothesisId, 'hypothesisId'))
      if (!hyp) throw new DomainError('Hypothesis not found.', 'not_found')
      const inc = await loadIncident(tools, hyp.data.incidentId, userId, 'collaborator')
      const review = oneOf(params.review, ['inferred', 'supported', 'rejected', 'confirmed'] as const, 'review')
      // Only owners may confirm a root cause.
      if (review === 'confirmed') await requireRole(tools, inc.data.workspaceId, userId, 'owner')
      const existing = (await queryAll(tools, 'hypothesis_reviews', { hypothesisId: hyp.recordId, userId }, 1))[0]
      if (existing) await updateRecord(tools, 'hypothesis_reviews', existing.recordId, { review })
      else await createRecord(tools, 'hypothesis_reviews', { workspaceId: inc.data.workspaceId, incidentId: inc.recordId, hypothesisId: hyp.recordId, userId, userName: await displayName(tools, userId), review })
      await audit(tools, inc.data.workspaceId, userId, 'hypothesis.reviewed', hyp.recordId, { review }, inc.recordId)
      return { success: true, data: { ok: true } }
    } catch (e) {
      return fail(e)
    }
  },

  saveSimulation: async ({ userId, tools, params }) => {
    try {
      const inc = await loadIncident(tools, params.incidentId, userId, 'collaborator')
      const interventions = validateInterventions(params.interventions)
      const branchAtSec = Number(params.branchAtSec)
      if (!Number.isFinite(branchAtSec) || branchAtSec < 0 || branchAtSec > 3600) throw new DomainError('branchAtSec is out of range.', 'invalid')
      const authorName = await displayName(tools, userId)
      const label = str(params.label, 'Label', 300)
      const branchId = await createRecord(tools, 'timeline_branches', { workspaceId: inc.data.workspaceId, incidentId: inc.recordId, label, branchAtSec, interventions, authorName })
      const runId = await createRecord(tools, 'simulation_runs', {
        workspaceId: inc.data.workspaceId, incidentId: inc.recordId, branchId, label, branchAtSec, interventions,
        overall: oneOf(params.overall, ['better', 'worse', 'mixed', 'same'] as const, 'overall'),
        summary: str(params.summary, 'Summary', 1000, false),
        assumptions: Array.isArray(params.assumptions) ? params.assumptions.slice(0, 30).map((a) => String(a).slice(0, 500)) : [],
        simulatorVersion: 'faultline-des/1.0.0', authorName,
      })
      await audit(tools, inc.data.workspaceId, userId, 'simulation.saved', runId, { label }, inc.recordId)
      return { success: true, data: { runId, branchId } }
    } catch (e) {
      return fail(e)
    }
  },

  savePostmortem: async ({ userId, tools, params }) => {
    try {
      const inc = await loadIncident(tools, params.incidentId, userId, 'collaborator')
      const markdown = str(params.markdown, 'markdown', 200_000)
      const id = await createRecord(tools, 'postmortems', { workspaceId: inc.data.workspaceId, incidentId: inc.recordId, status: oneOf(params.status, ['draft', 'published'] as const, 'status', 'draft'), markdown, document: params.document ?? null, authorName: await displayName(tools, userId) })
      await audit(tools, inc.data.workspaceId, userId, 'postmortem.saved', id, {}, inc.recordId)
      return { success: true, data: { postmortemId: id } }
    } catch (e) {
      return fail(e)
    }
  },

  deleteSource: async ({ userId, tools, params, env }) => {
    try {
      const src = await getRecord<{ incidentId: string; fileKey: string; uploadedBy: string }>(tools, 'sources', str(params.sourceId, 'sourceId'))
      if (!src) throw new DomainError('Source not found.', 'not_found')
      const inc = await loadIncident(tools, src.data.incidentId, userId, 'owner')
      if (src.data.fileKey) await appFiles(env, { scope: 'self', userId: src.data.uploadedBy }).delete(src.data.fileKey).catch(() => undefined)
      const removed = await deleteAll(tools, 'events', { incidentId: inc.recordId, sourceId: src.recordId })
      // Correlations may reference the removed evidence: drop derived data and
      // mark the analysis stale until the next import recomputes it.
      await deleteAll(tools, 'correlation_edges', { incidentId: inc.recordId })
      await deleteAll(tools, 'hypotheses', { incidentId: inc.recordId })
      await tools.remove('sources', src.recordId)
      const remaining = await queryAll(tools, 'events', { incidentId: inc.recordId }, 6000)
      await updateRecord(tools, 'incidents', inc.recordId, { eventCount: remaining.length, analysis: { stale: true, updatedAt: Date.now() } })
      await audit(tools, inc.data.workspaceId, userId, 'source.deleted', src.recordId, { eventsRemoved: removed }, inc.recordId)
      return { success: true, data: { eventsRemoved: removed } }
    } catch (e) {
      return fail(e)
    }
  },

  myRole: async ({ userId, tools, params }) => {
    try {
      const role = await workspaceRole(tools, str(params.workspaceId, 'workspaceId'), userId)
      return { success: true, data: { role } }
    } catch (e) {
      return fail(e)
    }
  },

  importGithubCommits: async (ctx) => importGithubCommits(ctx),
  searchRemediation: async (ctx) => searchRemediation(ctx),
  askInvestigator: async (ctx) => askInvestigator(ctx),
}

function validateInterventions(raw: unknown): Intervention[] {
  if (!Array.isArray(raw) || raw.length > 10) throw new DomainError('interventions must be a list of at most 10.', 'invalid')
  const kinds = new Set(INTERVENTION_KINDS.map((k) => k.kind))
  return raw.map((x) => {
    if (!x || typeof x !== 'object' || !kinds.has((x as { kind: string }).kind as Intervention['kind'])) throw new DomainError('Unknown intervention.', 'invalid')
    const json = JSON.stringify(x)
    if (json.length > 500) throw new DomainError('Intervention is too large.', 'invalid')
    return JSON.parse(json) as Intervention
  })
}

export type { Rec }
