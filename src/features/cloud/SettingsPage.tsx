import { useMemo, useState } from 'react'
import { signOut, useUser, useUsers } from 'deepspace'
import { Button, ConfirmModal, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from '@/components/ui'
import { callAction } from './api'
import { useWorkspaces } from './useWorkspaces'

export function SettingsPage() {
  const { user } = useUser() as { user?: { name?: string; email?: string } | null }
  const { workspaces, members, myId } = useWorkspaces()
  const { users } = useUsers()
  const { success, error } = useToast()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pick, setPick] = useState<Record<string, { userId: string; role: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [remove, setRemove] = useState<{ ws: string; userId: string; label: string } | null>(null)

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try { await fn(); success(ok) } catch (e) { error('Could not complete that', e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const nameOf = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Settings</h1>

      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="text-[15px] font-semibold">Account</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Signed in as <span className="text-foreground">{user?.name ?? 'you'}</span>{user?.email ? ` (${user.email})` : ''}.</p>
        <Button variant="outline" className="mt-3" onClick={() => signOut()}>Sign out</Button>
      </section>

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-[15px] font-semibold">Workspaces</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Incidents are private to their workspace. Owners share a team workspace with collaborators (can import, annotate, review, simulate) or viewers (read-only). Only owners can confirm a root cause or delete data.</p>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); setCreating(true); try { await callAction('createWorkspace', { name: name.trim() }); setName(''); success('Workspace created') } catch (err) { error('Could not create', err instanceof Error ? err.message : String(err)) } finally { setCreating(false) } }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team workspace name" maxLength={80} aria-label="New workspace name" />
          <Button type="submit" loading={creating} disabled={!name.trim()}>Create</Button>
        </form>
        <ul className="mt-5 space-y-4">
          {workspaces.map((w) => {
            const roster = members.filter((m) => m.data.teamId === w.id && m.data.status !== 'removed')
            const p = pick[w.id] ?? { userId: '', role: 'collaborator' }
            const candidates = users.filter((u) => !roster.some((m) => m.data.userId === u.id))
            return (
              <li key={w.id} className="rounded-md border border-border p-3" data-testid="workspace-card">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{w.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{w.kind} · you are {w.role}</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {roster.map((m) => (
                    <li key={m.recordId} className="flex items-center gap-2 text-[13px]">
                      <span className="flex-1 truncate">{m.data.displayName || nameOf.get(m.data.userId) || 'Member'}{m.data.userId === myId ? ' (you)' : ''}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{m.data.role}</span>
                      {(w.role === 'owner' && m.data.userId !== w.ownerId) || (m.data.userId === myId && m.data.userId !== w.ownerId) ? (
                        <button type="button" className="text-[12px] text-muted-foreground hover:text-[var(--color-fault)]" onClick={() => setRemove({ ws: w.id, userId: m.data.userId, label: m.data.userId === myId ? 'Leave this workspace' : `Remove ${m.data.displayName ?? 'member'}` })}>{m.data.userId === myId ? 'Leave' : 'Remove'}</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {w.role === 'owner' && w.kind === 'team' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Select value={p.userId} onValueChange={(v) => setPick({ ...pick, [w.id]: { ...p, userId: v } })}>
                      <SelectTrigger className="h-9 w-56" aria-label="Person to add"><SelectValue placeholder="Add a person" /></SelectTrigger>
                      <SelectContent>{candidates.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={p.role} onValueChange={(v) => setPick({ ...pick, [w.id]: { ...p, role: v } })}>
                      <SelectTrigger className="h-9 w-40" aria-label="Role"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="collaborator">collaborator</SelectItem><SelectItem value="viewer">viewer</SelectItem><SelectItem value="owner">owner</SelectItem></SelectContent>
                    </Select>
                    <Button variant="outline" loading={busy === `add${w.id}`} disabled={!p.userId} onClick={() => act(`add${w.id}`, () => callAction('setMember', { workspaceId: w.id, userId: p.userId, role: p.role }), 'Member added')}>Add</Button>
                  </div>
                ) : w.kind === 'personal' ? <p className="mt-2 text-[12px] text-muted-foreground">Personal workspaces are never shared. Create a team workspace to collaborate.</p> : null}
              </li>
            )
          })}
        </ul>
      </section>
      <ConfirmModal
        open={Boolean(remove)}
        onClose={() => setRemove(null)}
        title={`${remove?.label}?`}
        description="They immediately lose access to every incident, note, and simulation in this workspace. An owner can add them back later."
        confirmText="Remove access"
        variant="destructive"
        onConfirm={async () => { const r = remove!; setRemove(null); await act('rm', () => callAction('removeMember', { workspaceId: r.ws, userId: r.userId }), 'Access removed') }}
      />
    </div>
  )
}
