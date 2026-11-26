import { useMemo } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { IncidentDataset, SimScenario } from '@faultline/engine'
import type { LabStore } from '../lab/ChaosLab'
import { toEvent, type IncidentRecord } from './useCloudIncident'

/** Chaos-lab scenarios saved as personal DeepSpace records (read: 'own'). */
export function useCloudLabStore(): LabStore {
  const { isSignedIn } = useAuth() as { isSignedIn?: boolean }
  const q = useQuery<{ name: string; scenario: SimScenario }>('simulation_configs', { orderBy: 'updatedAt', orderDir: 'desc' })
  const m = useMutations<{ name: string; scenario: SimScenario }>('simulation_configs')
  return useMemo(() => ({
    notice: isSignedIn ? 'Saved scenarios are private to your account and sync across your devices.' : 'Sign in to save scenarios to your account.',
    canSave: Boolean(isSignedIn) && m.ready,
    scenarios: q.records.map((r) => ({ id: r.recordId, name: r.data.name, scenario: r.data.scenario, updatedAt: Date.parse(r.updatedAt) })),
    save: async (name, scenario, id) => {
      if (id && q.records.some((r) => r.recordId === id)) {
        await m.putConfirmed(id, { name, scenario })
        return id
      }
      return m.createConfirmed({ name, scenario })
    },
    remove: async (id) => { await m.removeConfirmed(id) },
  }), [isSignedIn, q.records, m])
}

/** The caller's incidents as datasets, for comparison and analytics (RBAC-filtered). */
export function useMyIncidentDatasets(): { datasets: IncidentDataset[]; loading: boolean; error: string | null } {
  const inc = useQuery<IncidentRecord>('incidents')
  const ev = useQuery<Parameters<typeof toEvent>[0]['data']>('events')
  const deps = useQuery<{ incidentId: string; from: string; to: string; origin: 'declared' | 'trace' | 'inferred' }>('dependencies')
  const datasets = useMemo<IncidentDataset[]>(() => inc.records.map((r) => ({
    meta: { id: r.recordId, title: r.data.title, severity: r.data.severity, synthetic: Boolean(r.data.synthetic), startedAt: r.data.startedAt || undefined, detectedAt: r.data.detectedAt || undefined, resolvedAt: r.data.resolvedAt || undefined, category: r.data.category },
    events: ev.records.filter((e) => e.data.incidentId === r.recordId).map((e) => toEvent(e as never)).sort((a, b) => a.ts - b.ts),
    services: [],
    dependencies: deps.records.filter((d) => d.data.incidentId === r.recordId).map((d) => ({ from: d.data.from, to: d.data.to, origin: d.data.origin })),
    annotations: [],
  })).filter((d) => d.events.length > 0), [inc.records, ev.records, deps.records])
  return { datasets, loading: [inc, ev, deps].some((q) => q.status === 'loading'), error: [inc, ev, deps].find((q) => q.error)?.error ?? null }
}
