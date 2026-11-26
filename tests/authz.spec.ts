/**
 * Multi-account authorization: owner, collaborator, unrelated user.
 *
 * Calls server actions directly with each account's own bearer token (not by
 * clicking UI that might simply be hidden), then checks what each account's
 * browser actually renders. Needs 3 usable test accounts:
 *
 *   npx deepspace test accounts list --usable
 *   npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin
 *   npx deepspace test run tests/authz.spec.ts
 *
 * Records it creates are prefixed `__test-<time>__` and the incident is
 * deleted at the end.
 */
import { test, expect, loadAllTestAccounts, type MultiplayerUser } from 'deepspace/testing'

const usable = loadAllTestAccounts().length
test.skip(usable < 3, `Needs 3 usable test accounts, found ${usable}. See the header of tests/authz.spec.ts.`)
test.describe.configure({ mode: 'serial' })

interface ActionResult { status: number; success?: boolean; data?: Record<string, unknown>; error?: string; code?: string }

/** Calls a server action as this user, with this user's own token, from their own browser. */
async function act(u: MultiplayerUser, name: string, params: Record<string, unknown>): Promise<ActionResult> {
  return u.page.evaluate(async ({ name, params }) => {
    const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } }).then((r) => r.json())
    const r = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
      body: JSON.stringify(params),
    })
    const body = await r.json().catch(() => ({}))
    return { status: r.status, ...body }
  }, { name, params })
}

/** The verified user id, read from the user's own token. */
async function userIdOf(u: MultiplayerUser): Promise<string> {
  return u.page.evaluate(async () => {
    const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } }).then((r) => r.json())
    const payload = JSON.parse(atob(t.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.sub as string
  })
}

const refused = (r: ActionResult) => {
  expect(r.success, `expected refusal, got ${JSON.stringify(r)}`).not.toBe(true)
  expect(['forbidden', 'not_found', 'unauthenticated']).toContain(r.code)
}

test('owner, collaborator and outsider each get exactly the access granted', async ({ users }) => {
  test.setTimeout(180_000)
  const [owner, collab, outsider] = await users(3)
  await Promise.all([owner, collab, outsider].map((u) => u.page.goto('/home')))
  for (const u of [owner, collab, outsider]) await expect(u.page.getByTestId('app-root')).toBeVisible()
  const [collabId, outsiderId] = await Promise.all([userIdOf(collab), userIdOf(outsider)])

  const title = `__test-${Date.now()}__ authz incident`
  const ws = await act(owner, 'createWorkspace', { name: `__test-${Date.now()}__ authz` })
  expect(ws.success, JSON.stringify(ws)).toBe(true)
  const workspaceId = ws.data!.workspaceId as string
  const inc = await act(owner, 'createIncident', { workspaceId, title, severity: 'sev3' })
  expect(inc.success, JSON.stringify(inc)).toBe(true)
  const incidentId = inc.data!.incidentId as string

  try {
    // --- Unrelated user: no role, no reads, no writes, no jobs ---
    expect((await act(outsider, 'myRole', { workspaceId })).data?.role ?? null).toBeNull()
    refused(await act(outsider, 'createIncident', { workspaceId, title: 'intrusion' }))
    refused(await act(outsider, 'updateIncident', { incidentId, title: 'defaced' }))
    refused(await act(outsider, 'addAnnotation', { incidentId, body: 'intrusion' }))
    refused(await act(outsider, 'startIngestion', { incidentId, sourceId: 'anything' }))
    refused(await act(outsider, 'deleteIncident', { incidentId }))
    refused(await act(outsider, 'setMember', { workspaceId, userId: outsiderId, role: 'owner' }))

    // --- Viewer: can read, cannot write ---
    expect((await act(owner, 'setMember', { workspaceId, userId: collabId, role: 'viewer' })).success).toBe(true)
    expect((await act(collab, 'myRole', { workspaceId })).data?.role).toBe('viewer')
    refused(await act(collab, 'addAnnotation', { incidentId, body: 'viewer write' }))
    refused(await act(collab, 'updateIncident', { incidentId, title: 'viewer edit' }))

    // --- Collaborator: can contribute, cannot manage membership ---
    expect((await act(owner, 'setMember', { workspaceId, userId: collabId, role: 'collaborator' })).success).toBe(true)
    const note = await act(collab, 'addAnnotation', { incidentId, body: `${title} note` })
    expect(note.success, JSON.stringify(note)).toBe(true)
    refused(await act(collab, 'setMember', { workspaceId, userId: outsiderId, role: 'viewer' }))

    // --- Storage ownership: nobody can register a key outside their own folder ---
    const app = 'app_01M8D1XKCZTT0XPX2XRMPPZR22'
    for (const fileKey of [
      `apps/${app}/users/${collabId}/evidence.jsonl`, // another user's file
      `apps/${app}/users/attacker/apps/${app}/users/${collabId}/x.jsonl`, // nested prefix injection
      `apps/other_app/users/${collabId}/x.jsonl`, // another app
      `apps/faultline/users/${collabId}/x.jsonl`, // app name instead of id
      `apps/${app}/users/${collabId}/..%2f..%2fsecret`, // encoded traversal
    ]) {
      refused(await act(owner, 'registerSource', { incidentId, fileKey, name: 'x.jsonl', sizeBytes: 10 }))
    }

    // --- What each browser actually renders (realtime subscriptions) ---
    await collab.page.goto(`/incidents/${incidentId}`)
    await expect(collab.page.getByText(title).first()).toBeVisible({ timeout: 20_000 })
    await outsider.page.goto(`/incidents/${incidentId}`)
    await outsider.page.waitForTimeout(8_000)
    await expect(outsider.page.getByText(title)).toHaveCount(0)

    // --- Revocation removes access ---
    expect((await act(owner, 'removeMember', { workspaceId, userId: collabId })).success).toBe(true)
    refused(await act(collab, 'addAnnotation', { incidentId, body: 'after removal' }))
    await collab.page.goto(`/incidents/${incidentId}`)
    await collab.page.waitForTimeout(8_000)
    await expect(collab.page.getByText(title)).toHaveCount(0)
  } finally {
    await act(owner, 'deleteIncident', { incidentId }).catch(() => undefined)
  }
})

test('the public demo cannot be changed by anyone through the API', async ({ users }) => {
  const [someone] = await users(1)
  await someone.page.goto('/home')
  // Demo incidents are static synthetic data in the bundle, not records; the
  // only server path near them makes a private copy in the caller's workspace.
  refused(await act(someone, 'updateIncident', { incidentId: 'checkout-cascade', title: 'defaced' }))
  refused(await act(someone, 'deleteIncident', { incidentId: 'checkout-cascade' }))
})
