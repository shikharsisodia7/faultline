import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useQuery } from 'deepspace'
import { DEMO_SCENARIOS } from '@faultline/engine'
import { Button, EmptyState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from '@/components/ui'
import { duration, utcDateTime } from '@/lib/format'
import { KindTag } from '../shell/atoms'
import { callAction } from './api'
import type { IncidentRecord } from './useCloudIncident'
import { useWorkspaces } from './useWorkspaces'

const KEY = 'faultline:workspace'

export function IncidentsPage() {
  const { workspaces, loading, error } = useWorkspaces()
  const [wsId, setWsId] = useState<string>(() => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } })
  const incidents = useQuery<IncidentRecord>('incidents', { orderBy: 'createdAt', orderDir: 'desc' })
  const [copying, setCopying] = useState<string | null>(null)
  const navigate = useNavigate()
  const { error: toastError } = useToast()

  useEffect(() => {
    if (workspaces.length && !workspaces.some((w) => w.id === wsId)) setWsId(workspaces[0].id)
  }, [workspaces, wsId])
  useEffect(() => { try { if (wsId) localStorage.setItem(KEY, wsId) } catch { /* ignore */ } }, [wsId])

  const current = workspaces.find((w) => w.id === wsId)
  const list = useMemo(() => incidents.records.filter((r) => r.data.workspaceId === wsId), [incidents.records, wsId])
  const canEdit = current?.role === 'owner' || current?.role === 'collaborator'

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">Workspace</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">Incidents</h1>
        </div>
        {workspaces.length ? (
          <Select value={wsId} onValueChange={setWsId}>
            <SelectTrigger className="h-9 w-64 text-[13px]" aria-label="Workspace"><SelectValue /></SelectTrigger>
            <SelectContent>{workspaces.map((w) => <SelectItem key={w.id} value={w.id} className="text-[13px]">{w.name} · {w.role}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
        {canEdit ? <Link to={`/incidents/new?workspace=${wsId}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"><Plus className="size-4" /> New incident</Link> : null}
      </div>
      {error ? <p role="alert" className="mt-4 text-[13px] text-[var(--color-fault)]">{error}</p> : null}
      {loading || incidents.status === 'loading' ? <p role="status" className="mt-8 font-mono text-[12px] text-muted-foreground">Loading workspace…</p> : null}

      {!loading && incidents.status === 'ready' && list.length === 0 ? (
        <EmptyState
          className="mt-6 rounded-lg border border-border"
          title="No incidents in this workspace yet"
          description="Upload logs or traces from a real incident, or copy a synthetic demo incident to explore every feature with your own notes and simulations."
          action={canEdit ? { label: 'Upload evidence', onClick: () => navigate(`/incidents/new?workspace=${wsId}`) } : undefined}
        />
      ) : null}

      {list.length ? (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border" data-testid="incident-list">
          {list.map((r) => (
            <li key={r.recordId}>
              <Link to={`/incidents/${r.recordId}`} className="grid gap-1 bg-card px-4 py-3 hover:bg-secondary sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] uppercase text-[var(--color-fault)]">{r.data.severity}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{r.data.status}</span>
                    {r.data.synthetic ? <KindTag kind="synthetic" /> : null}
                  </div>
                  <p className="truncate text-[14.5px] font-medium text-foreground" data-testid="incident-title">{r.data.title}</p>
                </div>
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  {r.data.eventCount ?? 0} events · {r.data.serviceCount ?? 0} services
                  {r.data.startedAt && r.data.resolvedAt ? ` · ${duration((r.data.resolvedAt - r.data.startedAt) / 1000)}` : ''}
                  {r.data.startedAt ? ` · ${utcDateTime(r.data.startedAt)}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <section className="mt-10">
          <h2 className="text-[15px] font-semibold">Copy a demo incident into this workspace</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Runs the same background ingestion pipeline as an upload. The copy is labeled synthetic and is private to this workspace.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEMO_SCENARIOS.map((d) => (
              <Button key={d.slug} variant="outline" loading={copying === d.slug} onClick={async () => {
                setCopying(d.slug)
                try {
                  const r = await callAction<{ incidentId: string }>('copyDemo', { workspaceId: wsId, slug: d.slug })
                  navigate(`/incidents/${r.incidentId}`)
                } catch (e) {
                  toastError('Could not copy', e instanceof Error ? e.message : String(e))
                } finally {
                  setCopying(null)
                }
              }}>{d.title}</Button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
