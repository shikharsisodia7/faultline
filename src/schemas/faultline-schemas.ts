/**
 * Faultline collections.
 *
 * Access model (see docs/DATA-MODEL.md):
 *  - Every workspace-scoped row carries `workspaceId` as its `teamField`, and
 *    members read it with `'team'`: the RecordRoom admits a reader only when an
 *    ACTIVE `team_members` row links them to that workspace. Each collection is
 *    checked on its own, so a private incident never "protects" its events by
 *    inheritance; every child row enforces the boundary itself.
 *  - Clients cannot create, update, or delete any workspace-scoped row
 *    (`create: false`). All writes go through server actions that first verify
 *    the caller's workspace role. This closes the injection hole where a client
 *    writes a row stamped with someone else's workspaceId.
 *  - App admins get the same `'team'` read as members: the app operator does
 *    not see private workspaces through the client.
 *  - Lab scenarios are personal (`'own'`) and need no workspace.
 */
import type { CollectionSchema, ColumnDefinition, RolePermissions } from 'deepspace/schema'

const NONE: RolePermissions = { read: false, create: false, update: false, delete: false }
const TEAM_READ: RolePermissions = { read: 'team', create: false, update: false, delete: false }

/** Server-written, team-readable collection. */
function teamCollection(name: string, columns: ColumnDefinition[], extra: Partial<CollectionSchema> = {}): CollectionSchema {
  return {
    name,
    columns: [
      { name: 'workspaceId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
      ...columns,
    ],
    teamField: 'workspaceId',
    permissions: { '*': NONE, viewer: NONE, member: TEAM_READ, admin: TEAM_READ },
    ...extra,
  }
}

const text = (name: string, extra: Partial<ColumnDefinition> = {}): ColumnDefinition => ({ name, storage: 'text', interpretation: 'plain', ...extra })
const num = (name: string, extra: Partial<ColumnDefinition> = {}): ColumnDefinition => ({ name, storage: 'number', interpretation: 'plain', ...extra })
const json = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: { kind: 'json' } })
const select = (name: string, options: string[], extra: Partial<ColumnDefinition> = {}): ColumnDefinition => ({ name, storage: 'text', interpretation: { kind: 'select', options }, ...extra })

export const WORKSPACE_ROLES = ['owner', 'collaborator', 'viewer'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

/** A workspace row's own id is mirrored into `workspaceId` so it can gate itself. */
export const workspacesSchema = teamCollection('workspaces', [
  text('name', { required: true }),
  text('description'),
  text('ownerId', { required: true, immutable: true }),
  select('kind', ['personal', 'team'], { default: 'team' }),
])

/** Membership. The RecordRoom resolves `'team'` access from this collection. */
export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    text('teamId', { required: true, immutable: true }),
    text('userId', { required: true, immutable: true }),
    select('role', [...WORKSPACE_ROLES], { required: true }),
    select('status', ['active', 'removed'], { default: 'active' }),
    text('displayName'),
    text('invitedBy'),
  ],
  teamField: 'teamId',
  uniqueOn: ['teamId', 'userId'],
  permissions: { '*': NONE, viewer: NONE, member: TEAM_READ, admin: TEAM_READ },
}

export const incidentsSchema = teamCollection('incidents', [
  text('title', { required: true }),
  text('summary'),
  select('severity', ['sev1', 'sev2', 'sev3', 'sev4'], { default: 'sev3' }),
  select('status', ['open', 'investigating', 'resolved'], { default: 'open' }),
  num('synthetic', { default: 0 }),
  text('category'),
  text('environment'),
  num('startedAt'),
  num('detectedAt'),
  num('resolvedAt'),
  num('eventCount', { default: 0 }),
  num('serviceCount', { default: 0 }),
  num('sourceCount', { default: 0 }),
  text('demoSlug'),
  json('analysis'),
  text('createdByName'),
])

export const servicesSchema = teamCollection('services', [
  text('incidentId', { required: true }),
  text('serviceId', { required: true }),
  select('kind', ['edge', 'service', 'database', 'queue', 'cache', 'external'], { default: 'service' }),
])

export const dependenciesSchema = teamCollection('dependencies', [
  text('incidentId', { required: true }),
  text('from', { required: true }),
  text('to', { required: true }),
  select('origin', ['declared', 'trace', 'inferred'], { default: 'inferred' }),
])

export const sourcesSchema = teamCollection('sources', [
  text('incidentId', { required: true }),
  text('name', { required: true }),
  text('format'),
  text('fileKey'),
  text('uploadedBy', { required: true, immutable: true }),
  num('sizeBytes', { default: 0 }),
  select('status', ['uploaded', 'processing', 'processed', 'failed', 'canceled'], { default: 'uploaded' }),
  json('stats'),
  json('errors'),
])

/** Normalized evidence. recordId = the event's stable content id (idempotent upserts). */
export const eventsSchema = teamCollection('events', [
  text('incidentId', { required: true }),
  text('sourceId'),
  num('ts', { required: true }),
  num('durationMs'),
  text('source'),
  text('service', { required: true }),
  text('environment'),
  text('severity', { required: true }),
  text('type', { required: true }),
  text('message', { required: true }),
  text('traceId'),
  text('spanId'),
  text('parentSpanId'),
  text('requestId'),
  text('deploymentId'),
  text('host'),
  text('region'),
  json('metadata'),
  json('sourceRef'),
  json('flags'),
])

export const correlationEdgesSchema = teamCollection('correlation_edges', [
  text('incidentId', { required: true }),
  text('source', { required: true }),
  text('target', { required: true }),
  num('score', { required: true }),
  json('signals'),
  text('explanation'),
  num('deltaMs'),
  text('algorithmVersion'),
])

export const hypothesesSchema = teamCollection('hypotheses', [
  text('incidentId', { required: true }),
  num('rank'),
  text('title'),
  text('service'),
  text('eventId'),
  num('score'),
  json('factors'),
  json('supportingEventIds'),
  json('explanation'),
  text('algorithmVersion'),
])

export const hypothesisReviewsSchema = teamCollection(
  'hypothesis_reviews',
  [
    text('incidentId', { required: true }),
    text('hypothesisId', { required: true }),
    text('userId', { required: true }),
    text('userName'),
    select('review', ['inferred', 'supported', 'rejected', 'confirmed'], { required: true }),
  ],
  { uniqueOn: ['hypothesisId', 'userId'] },
)

export const annotationsSchema = teamCollection('annotations', [
  text('incidentId', { required: true }),
  text('eventId'),
  num('ts'),
  text('body', { required: true }),
  select('kind', ['note', 'hypothesis', 'action'], { default: 'note' }),
  text('authorName'),
])

export const bookmarksSchema = teamCollection('bookmarks', [
  text('incidentId', { required: true }),
  num('ts', { required: true }),
  text('label', { required: true }),
  text('authorName'),
])

export const ingestionJobsSchema = teamCollection('ingestion_jobs', [
  text('incidentId', { required: true }),
  text('sourceId'),
  text('jobId'),
  select('stage', ['queued', 'reading', 'validating', 'normalizing', 'deduplicating', 'correlating', 'persisting', 'completed', 'failed', 'canceled'], { default: 'queued' }),
  num('progress', { default: 0 }),
  text('message'),
  text('error'),
  json('stats'),
  num('cancelRequested', { default: 0 }),
  num('attempt', { default: 1 }),
  text('requestedBy'),
  num('startedAt'),
  num('finishedAt'),
])

/** A named branch point plus its interventions (typed JSON, validated server-side). */
export const timelineBranchesSchema = teamCollection('timeline_branches', [
  text('incidentId', { required: true }),
  text('label', { required: true }),
  num('branchAtSec', { required: true }),
  json('interventions'),
  text('authorName'),
])

export const simulationRunsSchema = teamCollection('simulation_runs', [
  text('incidentId', { required: true }),
  text('branchId'),
  text('label'),
  num('branchAtSec'),
  json('interventions'),
  select('overall', ['better', 'worse', 'mixed', 'same']),
  text('summary'),
  json('assumptions'),
  text('simulatorVersion'),
  text('authorName'),
])

export const postmortemsSchema = teamCollection('postmortems', [
  text('incidentId', { required: true }),
  select('status', ['draft', 'published'], { default: 'draft' }),
  text('markdown'),
  json('document'),
  text('authorName'),
])

export const auditEventsSchema = teamCollection('audit_events', [
  text('incidentId'),
  text('actorId', { required: true }),
  text('action', { required: true }),
  text('target'),
  json('detail'),
])

/** Personal chaos-lab scenarios. Owned by the creator; no workspace needed. */
export const simulationConfigsSchema: CollectionSchema = {
  name: 'simulation_configs',
  columns: [text('name', { required: true }), json('scenario')],
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: { read: 'own', create: true, update: 'own', delete: 'own', writableFields: ['name', 'scenario'] },
    admin: { read: 'own', create: true, update: 'own', delete: 'own', writableFields: ['name', 'scenario'] },
  },
}

export const faultlineSchemas: CollectionSchema[] = [
  workspacesSchema,
  teamMembersSchema,
  incidentsSchema,
  servicesSchema,
  dependenciesSchema,
  sourcesSchema,
  eventsSchema,
  correlationEdgesSchema,
  hypothesesSchema,
  hypothesisReviewsSchema,
  annotationsSchema,
  bookmarksSchema,
  ingestionJobsSchema,
  timelineBranchesSchema,
  simulationRunsSchema,
  postmortemsSchema,
  auditEventsSchema,
  simulationConfigsSchema,
]
