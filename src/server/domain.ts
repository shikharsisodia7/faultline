/**
 * Server-side domain helpers shared by actions and jobs.
 *
 * Everything here runs with RBAC OFF (X-App-Action), so it is the
 * authorization boundary: every entry point must call `requireRole` before
 * touching workspace data. See docs/DATA-MODEL.md.
 */
import type { ActionResult, ActionTools } from 'deepspace/worker'
import type { WorkspaceRole } from '../schemas/faultline-schemas'

export type Rec<T> = { recordId: string; data: T; createdBy?: string; createdAt?: string; updatedAt?: string }

export class DomainError extends Error {
  constructor(message: string, readonly code: 'forbidden' | 'not_found' | 'invalid' | 'limit' | 'conflict' | 'disabled' | 'upstream') {
    super(message)
  }
}

export function fail(err: unknown): ActionResult<never> {
  if (err instanceof DomainError) return { success: false, error: err.message, code: err.code } as ActionResult<never>
  console.error('[faultline] unexpected action error', err instanceof Error ? err.message : String(err))
  return { success: false, error: 'Something went wrong on the server. The error was logged.' }
}

function unwrap<T>(r: ActionResult<T>, what: string): T {
  if (!r.success) throw new DomainError(`${what}: ${r.error}`, 'upstream')
  return r.data
}

export async function getRecord<T>(tools: ActionTools, collection: string, id: string): Promise<Rec<T> | null> {
  const r = await tools.get(collection, id)
  if (!r.success) return null
  return (r.data as { record: Rec<T> }).record
}

/** Pages through every matching record (offset paging, bounded by `max`). */
export async function queryAll<T>(tools: ActionTools, collection: string, where: Record<string, string | number>, max = 20_000): Promise<Rec<T>[]> {
  const out: Rec<T>[] = []
  let offset = 0
  for (;;) {
    const r = unwrap(await tools.query(collection, { where, limit: 500, offset } as never), `query ${collection}`) as { records: Rec<T>[]; nextOffset?: number }
    out.push(...r.records)
    if (r.nextOffset === undefined || out.length >= max) break
    offset = r.nextOffset
  }
  return out
}

export async function createRecord(tools: ActionTools, collection: string, data: Record<string, unknown>, recordId?: string): Promise<string> {
  return (unwrap(await tools.create(collection, data, recordId), `create ${collection}`) as { recordId: string }).recordId
}

export async function updateRecord(tools: ActionTools, collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
  unwrap(await tools.update(collection, id, patch), `update ${collection}`)
}

/** Deletes every row matching `where` in bounded pages. */
export async function deleteAll(tools: ActionTools, collection: string, where: Record<string, string>): Promise<number> {
  let total = 0
  for (let guard = 0; guard < 400; guard++) {
    const r = unwrap(await tools.deleteWhere(collection, where, 500), `delete ${collection}`) as { deleted: number }
    total += r.deleted
    if (r.deleted < 500) break
  }
  return total
}

interface Member { teamId: string; userId: string; role: WorkspaceRole; status: string }

/** The caller's active role in a workspace, or null. */
export async function workspaceRole(tools: ActionTools, workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  if (!workspaceId || !userId) return null
  const r = await tools.query('team_members', { where: { teamId: workspaceId, userId }, limit: 1 } as never)
  if (!r.success) return null
  const rec = (r.data as unknown as { records: Rec<Member>[] }).records[0]
  return rec && rec.data.status !== 'removed' ? rec.data.role : null
}

const RANK: Record<WorkspaceRole, number> = { viewer: 1, collaborator: 2, owner: 3 }

/** Throws unless the caller holds at least `min` in the workspace. Default-deny. */
export async function requireRole(tools: ActionTools, workspaceId: string, userId: string, min: WorkspaceRole): Promise<WorkspaceRole> {
  const role = await workspaceRole(tools, workspaceId, userId)
  if (!role || RANK[role] < RANK[min]) throw new DomainError(min === 'viewer' ? 'You do not have access to this workspace.' : `This needs the ${min} role in the workspace.`, 'forbidden')
  return role
}

export interface IncidentRow {
  workspaceId: string
  title: string
  summary?: string
  severity: string
  status: string
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
  analysis?: unknown
  createdByName?: string
}

/** Loads an incident and checks the caller's role in its workspace. */
export async function loadIncident(tools: ActionTools, incidentId: unknown, userId: string, min: WorkspaceRole): Promise<Rec<IncidentRow>> {
  if (typeof incidentId !== 'string' || !incidentId) throw new DomainError('incidentId is required.', 'invalid')
  const inc = await getRecord<IncidentRow>(tools, 'incidents', incidentId)
  // Same answer for "missing" and "not yours": never confirm existence.
  if (!inc) throw new DomainError('Incident not found.', 'not_found')
  const role = await workspaceRole(tools, inc.data.workspaceId, userId)
  if (!role || RANK[role] < RANK[min]) {
    if (!role) throw new DomainError('Incident not found.', 'not_found')
    throw new DomainError(`This needs the ${min} role in the workspace.`, 'forbidden')
  }
  return inc
}

export async function audit(tools: ActionTools, workspaceId: string, actorId: string, action: string, target: string, detail: Record<string, unknown> = {}, incidentId?: string): Promise<void> {
  await tools.create('audit_events', { workspaceId, actorId, action, target, detail, incidentId: incidentId ?? '' })
}

/** Counts this actor's audit rows for `action` since `sinceMs` (rate limiting). */
export async function recentActions(tools: ActionTools, workspaceId: string, actorId: string, action: string, sinceMs: number): Promise<number> {
  const rows = await queryAll<{ createdAt?: string }>(tools, 'audit_events', { workspaceId, actorId, action }, 2000)
  return rows.filter((r) => Date.parse(r.createdAt ?? '') >= sinceMs).length
}

export const INCIDENT_CHILDREN = [
  'events', 'correlation_edges', 'hypotheses', 'hypothesis_reviews', 'annotations', 'bookmarks',
  'services', 'dependencies', 'sources', 'ingestion_jobs', 'timeline_branches', 'simulation_runs', 'postmortems',
] as const

export function str(v: unknown, field: string, max = 200, required = true): string {
  if (typeof v !== 'string' || (required && !v.trim())) {
    if (!required && (v === undefined || v === null || v === '')) return ''
    throw new DomainError(`${field} is required.`, 'invalid')
  }
  const s = v.trim()
  if (s.length > max) throw new DomainError(`${field} must be at most ${max} characters.`, 'invalid')
  return s
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if (v === undefined && fallback !== undefined) return fallback
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
  throw new DomainError(`${field} must be one of ${allowed.join(', ')}.`, 'invalid')
}
