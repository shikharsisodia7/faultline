import { describe, expect, it } from 'vitest'
import { canJoinPresence } from './realtime-routes'

/**
 * Found on the live app (2026-11-26): an anonymous WebSocket with no token
 * joined `incident:<id>` presence and received viewers' user ids, names and
 * playheads. Incident ids are a timestamp plus six random characters, so they
 * are guessable within a time window. Presence must follow workspace
 * membership exactly like the records do.
 */
type Rows = { incidents: Record<string, { workspaceId: string }>; members: Array<{ teamId: string; userId: string; status: string }> }

function fakeEnv(rows: Rows, opts: { fail?: boolean } = {}) {
  const stub = {
    async fetch(req: Request) {
      if (opts.fail) throw new Error('room unavailable')
      const { tool, params } = (await req.json()) as { tool: string; params: { collection: string; recordId?: string; where?: Record<string, string> } }
      if (tool === 'records.get' && params.collection === 'incidents') {
        const data = rows.incidents[params.recordId!]
        return Response.json(data ? { success: true, data: { record: { recordId: params.recordId, data } } } : { success: false, error: 'Record not found' })
      }
      if (tool === 'records.query' && params.collection === 'team_members') {
        const w = params.where ?? {}
        const records = rows.members.filter((m) => m.teamId === w.teamId && m.userId === w.userId).map((data, i) => ({ recordId: `m${i}`, data }))
        return Response.json({ success: true, data: { records } })
      }
      return Response.json({ success: false, error: 'unexpected tool' })
    },
  }
  return {
    DEEPSPACE_APP_ID: 'app_test',
    OWNER_USER_ID: 'owner_of_app',
    RECORD_ROOMS: { idFromName: (n: string) => n, get: () => stub },
  } as never
}

const rows: Rows = {
  incidents: { inc_1: { workspaceId: 'ws_a' } },
  members: [
    { teamId: 'ws_a', userId: 'alice', status: 'active' },
    { teamId: 'ws_a', userId: 'bob', status: 'removed' },
  ],
}

describe('presence room access', () => {
  it('admits an active member of the incident’s workspace', async () => {
    expect(await canJoinPresence(fakeEnv(rows), 'incident:inc_1', 'alice')).toBe(true)
  })

  it('refuses anonymous callers, outsiders and removed members', async () => {
    expect(await canJoinPresence(fakeEnv(rows), 'incident:inc_1', null)).toBe(false)
    expect(await canJoinPresence(fakeEnv(rows), 'incident:inc_1', 'mallory')).toBe(false)
    expect(await canJoinPresence(fakeEnv(rows), 'incident:inc_1', 'bob')).toBe(false)
  })

  it('refuses unknown incidents, other scope kinds, and malformed scopes', async () => {
    expect(await canJoinPresence(fakeEnv(rows), 'incident:missing', 'alice')).toBe(false)
    expect(await canJoinPresence(fakeEnv(rows), 'workspace:ws_a', 'alice')).toBe(false)
    expect(await canJoinPresence(fakeEnv(rows), 'incident:', 'alice')).toBe(false)
    expect(await canJoinPresence(fakeEnv(rows), 'global', 'alice')).toBe(false)
  })

  it('fails closed when the record lookup errors', async () => {
    expect(await canJoinPresence(fakeEnv(rows, { fail: true }), 'incident:inc_1', 'alice')).toBe(false)
  })
})
