import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { actions } from '../actions'
import { faultlineSchemas } from '../schemas/faultline-schemas'

/**
 * In-memory stand-in for the RecordRoom's server tools that enforces the one
 * rule the live platform enforced and the code got wrong: a column marked
 * `immutable` in the schema can never change after creation. Found on the
 * live deployment (2026-11-26): ensureWorkspace failed with "Cannot modify
 * immutable field 'workspaceId'", so no signed-in user ever got a workspace.
 */
function fakeTools() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()
  const table = (c: string) => tables.get(c) ?? tables.set(c, new Map()).get(c)!
  const immutable = new Map(faultlineSchemas.map((s) => [s.name, new Set(s.columns.filter((c) => c.immutable).map((c) => c.name))]))
  let n = 0
  const rows = (c: string) => [...table(c).entries()].map(([recordId, data]) => ({ recordId, data }))
  const tools = {
    async create(collection: string, data: Record<string, unknown>, recordId?: string) {
      const id = recordId ?? `rec_${++n}`
      table(collection).set(id, { ...data })
      return { success: true, data: { recordId: id } }
    },
    async update(collection: string, recordId: string, patch: Record<string, unknown>) {
      const row = table(collection).get(recordId)
      if (!row) return { success: false, error: 'Record not found' }
      for (const [k, v] of Object.entries(patch)) {
        if (immutable.get(collection)?.has(k) && row[k] !== v) return { success: false, error: `Cannot modify immutable field '${k}'` }
      }
      Object.assign(row, patch)
      return { success: true, data: { recordId } }
    },
    async remove(collection: string, recordId: string) {
      table(collection).delete(recordId)
      return { success: true, data: { recordId } }
    },
    async get(collection: string, recordId: string) {
      const data = table(collection).get(recordId)
      // Same shape as the SDK's GetActionData: { record: { recordId, data } }.
      return data ? { success: true, data: { record: { recordId, data } } } : { success: false, error: 'Record not found' }
    },
    async query(collection: string, opts: { where?: Record<string, unknown>; limit?: number; offset?: number }) {
      const where = opts.where ?? {}
      const all = rows(collection).filter((r) => Object.entries(where).every(([k, v]) => r.data[k] === v))
      const start = opts.offset ?? 0
      const limit = opts.limit ?? 500
      return { success: true, data: { records: all.slice(start, start + limit), nextOffset: start + limit < all.length ? start + limit : undefined } }
    },
  }
  return { tools: tools as unknown as ActionTools, rows }
}

type Ctx = Parameters<(typeof actions)['ensureWorkspace']>[0]
const ctx = (tools: ActionTools, userId: string, params: Record<string, unknown> = {}) => ({ userId, tools, params, env: {} } as unknown as Ctx)

describe('workspace creation against immutable schema columns', () => {
  it('ensureWorkspace creates a personal workspace once, owned by the caller', async () => {
    const { tools, rows } = fakeTools()
    const first = await actions.ensureWorkspace(ctx(tools, 'user_a'))
    expect(first, JSON.stringify(first)).toMatchObject({ success: true, data: { created: true } })
    const id = (first as { data: { workspaceId: string } }).data.workspaceId
    const ws = rows('workspaces').find((r) => r.recordId === id)!
    expect(ws.data).toMatchObject({ workspaceId: id, ownerId: 'user_a', kind: 'personal' })
    expect(rows('team_members').filter((m) => m.data.teamId === id && m.data.userId === 'user_a' && m.data.role === 'owner')).toHaveLength(1)

    const again = await actions.ensureWorkspace(ctx(tools, 'user_a'))
    expect(again).toMatchObject({ success: true, data: { workspaceId: id, created: false } })
    expect(rows('workspaces')).toHaveLength(1)
  })

  it('createWorkspace never needs to rewrite an immutable column', async () => {
    const { tools, rows } = fakeTools()
    const r = await actions.createWorkspace(ctx(tools, 'user_a', { name: 'Payments team' }))
    expect(r, JSON.stringify(r)).toMatchObject({ success: true })
    const id = (r as { data: { workspaceId: string } }).data.workspaceId
    expect(rows('workspaces').find((w) => w.recordId === id)!.data).toMatchObject({ workspaceId: id, kind: 'team' })
  })

  it('cleans up half-created workspaces left by the earlier bug, only the caller’s own', async () => {
    const { tools, rows } = fakeTools()
    await tools.create('workspaces', { workspaceId: 'pending', name: 'Personal workspace', ownerId: 'user_a', kind: 'personal' }, 'orphan_a')
    await tools.create('workspaces', { workspaceId: 'pending', name: 'Personal workspace', ownerId: 'user_b', kind: 'personal' }, 'orphan_b')
    await actions.ensureWorkspace(ctx(tools, 'user_a'))
    const ids = rows('workspaces').map((w) => w.recordId)
    expect(ids).not.toContain('orphan_a')
    expect(ids).toContain('orphan_b')
  })
})

describe('workspace roles enforced by the real action code', () => {
  async function setup() {
    const { tools, rows } = fakeTools()
    // Users exist in the app's user directory (setMember requires it).
    for (const u of ['owner', 'collab', 'outsider']) await tools.create('users', { name: u }, u)
    const ws = (await actions.createWorkspace(ctx(tools, 'owner', { name: 'Payments' }))) as { data: { workspaceId: string } }
    const workspaceId = ws.data.workspaceId
    const inc = (await actions.createIncident(ctx(tools, 'owner', { workspaceId, title: 'Checkout errors' }))) as { success: boolean; data: { incidentId: string } }
    expect(inc.success).toBe(true)
    return { tools, rows, workspaceId, incidentId: inc.data.incidentId }
  }
  const call = (tools: ActionTools, who: string, name: keyof typeof actions, params: Record<string, unknown>) =>
    actions[name](ctx(tools, who, params)) as Promise<{ success: boolean; code?: string; data?: Record<string, unknown> }>

  it('an unrelated user can neither see nor change anything', async () => {
    const { tools, workspaceId, incidentId } = await setup()
    expect((await call(tools, 'outsider', 'myRole', { workspaceId })).data?.role ?? null).toBeNull()
    for (const [name, params] of [
      ['createIncident', { workspaceId, title: 'x' }],
      ['updateIncident', { incidentId, title: 'defaced' }],
      ['addAnnotation', { incidentId, body: 'x' }],
      ['startIngestion', { incidentId, sourceId: 'x' }],
      ['deleteIncident', { incidentId }],
      ['setMember', { workspaceId, userId: 'outsider', role: 'owner' }],
    ] as const) {
      const r = await call(tools, 'outsider', name, params)
      expect(r.success, `${name} should be refused`).toBe(false)
      // Outsiders get not_found for incidents, so they cannot even confirm one exists.
      expect(['forbidden', 'not_found']).toContain(r.code)
    }
  })

  it('a viewer can read but not write; a collaborator can write but not manage members; removal revokes', async () => {
    const { tools, workspaceId, incidentId } = await setup()
    expect((await call(tools, 'owner', 'setMember', { workspaceId, userId: 'collab', role: 'viewer' })).success).toBe(true)
    expect((await call(tools, 'collab', 'myRole', { workspaceId })).data?.role).toBe('viewer')
    expect((await call(tools, 'collab', 'addAnnotation', { incidentId, body: 'x' })).code).toBe('forbidden')

    expect((await call(tools, 'owner', 'setMember', { workspaceId, userId: 'collab', role: 'collaborator' })).success).toBe(true)
    expect((await call(tools, 'collab', 'addAnnotation', { incidentId, body: 'note' })).success).toBe(true)
    expect((await call(tools, 'collab', 'setMember', { workspaceId, userId: 'outsider', role: 'viewer' })).success).toBe(false)

    expect((await call(tools, 'owner', 'removeMember', { workspaceId, userId: 'collab' })).success).toBe(true)
    const after = await call(tools, 'collab', 'addAnnotation', { incidentId, body: 'after removal' })
    expect(after.success).toBe(false)
    expect((await call(tools, 'collab', 'myRole', { workspaceId })).data?.role ?? null).toBeNull()
  })
})
