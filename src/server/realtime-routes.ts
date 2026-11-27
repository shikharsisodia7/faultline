/**
 * WebSocket routing for app-owned Durable Objects.
 *
 * Caller identity in query parameters and headers is never trusted. Routes
 * scrub it and forward verified JWT identity in internal-only headers; the
 * documents-aware Yjs route additionally resolves an application role from
 * the documents collection.
 */

import type { Context, Hono } from 'hono'
import { authenticatedRoomRequest, resolveAppRole, verifyJwt } from 'deepspace/worker'
import type { JwtVerifierConfig, VerifyResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker.js'

function jwtConfig(env: Env): JwtVerifierConfig {
  return { publicKey: env.AUTH_JWT_PUBLIC_KEY, issuer: env.AUTH_JWT_ISSUER }
}

function wsRoute(
  doNamespace: (env: Env) => DurableObjectNamespace,
  extraIdentity?: (auth: VerifyResult, env: Env) => { role?: string } | Promise<{ role?: string }>,
) {
  return async (c: Context<AppContext>) => {
    const id = c.req.param('roomId') ?? c.req.param('docId') ?? c.req.param('scopeId')
    if (!id) return new Response('Not found', { status: 404 })
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token')

    let auth: VerifyResult | null = null
    if (token) {
      auth = (await verifyJwt(jwtConfig(c.env), token)).result
      if (!auth) return new Response('Unauthorized', { status: 401 })
    }
    const roomRequest = authenticatedRoomRequest(
      c.req.raw,
      auth,
      auth ? await extraIdentity?.(auth, c.env) : undefined,
    )

    const namespace = doNamespace(c.env)
    const stub = namespace.get(namespace.idFromName(id))
    return stub.fetch(roomRequest)
  }
}

type DocsYjsRole = 'admin' | 'member' | 'viewer'

interface DocumentRecordForAccess {
  ownerId?: string
  collaborators?: string
  editors?: string
}

type DocumentAccessLookup =
  | { kind: 'found'; doc: DocumentRecordForAccess }
  | { kind: 'not-docs-room' }
  | { kind: 'error' }

function parseAccessList(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

async function getDocumentForAccess(env: Env, docId: string): Promise<DocumentAccessLookup> {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  try {
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': env.OWNER_USER_ID,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({
          tool: 'records.get',
          params: { collection: 'documents', recordId: docId },
        }),
      }),
    )
    const json = (await res.json()) as {
      success?: boolean
      error?: string
      data?: { record?: { data?: DocumentRecordForAccess } }
    }
    if (json.success && json.data?.record?.data) {
      return { kind: 'found', doc: json.data.record.data }
    }
    if (json.error?.startsWith('Schema not registered for collection: documents')) {
      return { kind: 'not-docs-room' }
    }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

async function resolveDocsYjsRole(
  env: Env,
  docId: string,
  userId: string,
): Promise<DocsYjsRole | null> {
  const lookup = await getDocumentForAccess(env, docId)
  // Faultline does not install the documents feature and never opens a Yjs
  // room, so there is no record to grant a role from. Fail closed instead of
  // treating every signed-in caller as a writer (the scaffold default), and
  // never decide access from upstream error text alone.
  if (lookup.kind === 'not-docs-room') return null
  if (lookup.kind === 'error') return null
  const { doc } = lookup
  if (doc.ownerId === userId || userId === env.OWNER_USER_ID) return 'admin'

  const editors = parseAccessList(doc.editors)
  if (editors.includes(userId)) return 'member'

  const collaborators = parseAccessList(doc.collaborators)
  if (collaborators.includes(userId)) return 'viewer'

  return null
}

/** Runs one RecordRoom tool as the app (the same internal path the Yjs guard uses). */
async function appTool(env: Env, tool: string, params: Record<string, unknown>): Promise<{ success?: boolean; data?: unknown } | null> {
  try {
    const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': env.OWNER_USER_ID, 'X-App-Action': 'true' },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return (await res.json()) as { success?: boolean; data?: unknown }
  } catch {
    return null
  }
}

/**
 * Presence follows workspace membership, exactly like the records. Faultline
 * only opens `incident:<id>` presence rooms; a caller may join one only when
 * signed in and an active member of that incident's workspace. Anything
 * else, including lookup errors, is refused.
 */
export async function canJoinPresence(env: Env, scopeId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const match = /^incident:([A-Za-z0-9_-]{1,80})$/.exec(scopeId)
  if (!match) return false
  const inc = await appTool(env, 'records.get', { collection: 'incidents', recordId: match[1] })
  const workspaceId = inc?.success ? (inc.data as { record?: { data?: { workspaceId?: string } } })?.record?.data?.workspaceId : undefined
  if (!workspaceId) return false
  const m = await appTool(env, 'records.query', { collection: 'team_members', where: { teamId: workspaceId, userId }, limit: 1 })
  const row = m?.success ? (m.data as { records?: Array<{ data?: { status?: string } }> })?.records?.[0]?.data : undefined
  return Boolean(row) && row!.status !== 'removed'
}

export function registerRealtimeRoutes(app: Hono<AppContext>): void {
  app.get(
    '/ws/:roomId',
    wsRoute((env) => env.RECORD_ROOMS),
  )

  app.get('/ws/yjs/:docId', async (c) => {
    const docId = c.req.param('docId')
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token')
    const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null
    if (!auth) return new Response('Unauthorized', { status: 401 })

    const role = await resolveDocsYjsRole(c.env, docId, auth.userId)
    if (!role) return new Response('Forbidden', { status: 403 })

    const roomRequest = authenticatedRoomRequest(c.req.raw, auth, { role })

    const stub = c.env.YJS_ROOMS.get(c.env.YJS_ROOMS.idFromName(docId))
    return stub.fetch(roomRequest)
  })

  app.get(
    '/ws/canvas/:docId',
    wsRoute(
      (env) => env.CANVAS_ROOMS,
      async (auth, env) => ({ role: await resolveAppRole(env, auth.userId) }),
    ),
  )

  // Presence carries viewers' names and playheads, so it is gated like the
  // records: a verified token and active membership in the incident's
  // workspace (found open to anonymous sockets on the live app, 2026-11-26).
  app.get('/ws/presence/:scopeId', async (c) => {
    const scopeId = c.req.param('scopeId')
    const token = new URL(c.req.url).searchParams.get('token')
    const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null
    if (!auth) return new Response('Unauthorized', { status: 401 })
    if (!(await canJoinPresence(c.env, scopeId, auth.userId))) return new Response('Forbidden', { status: 403 })
    const stub = c.env.PRESENCE_ROOMS.get(c.env.PRESENCE_ROOMS.idFromName(scopeId))
    return stub.fetch(authenticatedRoomRequest(c.req.raw, auth))
  })

  app.get(
    '/ws/cron/:roomId',
    wsRoute(
      (env) => env.CRON_ROOMS,
      // Authenticated users get their current app role. Anonymous connections
      // have no role and CronRoom enforces them as read-only viewers.
      async (auth, env) => ({ role: await resolveAppRole(env, auth.userId) }),
    ),
  )

  app.get(
    '/ws/jobs/:roomId',
    wsRoute((env) => env.JOB_ROOMS),
  )
}
