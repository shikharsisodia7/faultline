import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { callAction } from './api'

export interface WorkspaceView {
  id: string
  name: string
  kind: 'personal' | 'team'
  ownerId: string
  role: 'owner' | 'collaborator' | 'viewer'
}

/** The caller's workspaces (RBAC-filtered) and their role in each; ensures a personal workspace exists. */
export function useWorkspaces() {
  const { userId } = useAuth()
  const myId = userId ?? ''
  const ws = useQuery<{ name: string; kind: 'personal' | 'team'; ownerId: string }>('workspaces')
  const members = useQuery<{ teamId: string; userId: string; role: WorkspaceView['role']; status: string; displayName?: string }>('team_members')
  const [ensureError, setEnsureError] = useState<string | null>(null)
  const ensured = useRef(false)

  const list = useMemo<WorkspaceView[]>(() => {
    const roleOf = new Map(members.records.filter((m) => m.data.userId === myId && m.data.status !== 'removed').map((m) => [m.data.teamId, m.data.role]))
    return ws.records
      .filter((w) => roleOf.has(w.recordId))
      .map((w) => ({ id: w.recordId, name: w.data.name, kind: w.data.kind, ownerId: w.data.ownerId, role: roleOf.get(w.recordId)! }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'personal' ? -1 : 1))
  }, [ws.records, members.records, myId])

  useEffect(() => {
    if (!myId || ws.status !== 'ready' || members.status !== 'ready' || ensured.current) return
    if (list.some((w) => w.kind === 'personal' && w.ownerId === myId)) return
    ensured.current = true
    callAction('ensureWorkspace', {}).catch((e: Error) => setEnsureError(e.message))
  }, [myId, ws.status, members.status, list])

  return {
    workspaces: list,
    members: members.records,
    loading: ws.status === 'loading' || members.status === 'loading',
    error: ensureError ?? ws.error ?? members.error ?? null,
    myId,
  }
}
