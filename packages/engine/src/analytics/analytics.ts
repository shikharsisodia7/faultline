/**
 * Reliability analytics over incident summaries. Every metric reports its
 * denominator (`n`) and returns null with a reason when data is insufficient,
 * instead of rendering a misleading number.
 */

export interface IncidentSummary {
  id: string
  title: string
  severity: 'sev1' | 'sev2' | 'sev3' | 'sev4'
  synthetic: boolean
  startedAt: number | null
  detectedAt: number | null
  resolvedAt: number | null
  category: string | null
  services: string[]
  /** Services that reported errors. */
  affectedServices: string[]
  /** Dependency edges along which failures were observed (caller->callee). */
  failedDependencies: string[]
}

export interface Stat {
  value: number | null
  n: number
  reason?: string
}

export interface ReliabilityReport {
  incidents: number
  syntheticIncidents: number
  frequencyPerWeek: Array<{ weekStart: string; count: number }>
  mttrSec: Stat
  medianTtrSec: Stat
  mttdSec: Stat
  bySeverity: Record<string, number>
  byService: Array<{ service: string; incidents: number }>
  byCategory: Array<{ category: string; incidents: number; recurring: boolean }>
  topDependencies: Array<{ dependency: string; incidents: number }>
  definitions: Record<string, string>
}

export const ANALYTICS_DEFINITIONS: Record<string, string> = {
  mttr: 'Mean of (resolvedAt - startedAt) over incidents that have both timestamps.',
  medianTtr: 'Median of (resolvedAt - startedAt) over incidents that have both timestamps.',
  mttd: 'Mean of (detectedAt - startedAt) over incidents that have both timestamps.',
  frequency: 'Incidents per ISO week (Monday 00:00 UTC), by startedAt. Incidents without a start time are excluded.',
  recurring: 'A category is recurring when it appears in two or more incidents.',
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function stat(values: number[], fn: (xs: number[]) => number, min = 1, label = 'incidents with both timestamps'): Stat {
  if (values.length < min) return { value: null, n: values.length, reason: `Needs at least ${min} ${label}; have ${values.length}.` }
  return { value: Math.round(fn(values)), n: values.length }
}

function weekStart(ts: number): string {
  const d = new Date(ts)
  const day = (d.getUTCDay() + 6) % 7
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)
  return new Date(monday).toISOString().slice(0, 10)
}

export function reliabilityReport(incidents: readonly IncidentSummary[]): ReliabilityReport {
  const ttr: number[] = []
  const ttd: number[] = []
  const freq = new Map<string, number>()
  const bySeverity: Record<string, number> = { sev1: 0, sev2: 0, sev3: 0, sev4: 0 }
  const byService = new Map<string, number>()
  const byCategory = new Map<string, number>()
  const byDep = new Map<string, number>()
  for (const i of incidents) {
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1
    if (i.startedAt !== null && i.resolvedAt !== null && i.resolvedAt >= i.startedAt) ttr.push((i.resolvedAt - i.startedAt) / 1000)
    if (i.startedAt !== null && i.detectedAt !== null && i.detectedAt >= i.startedAt) ttd.push((i.detectedAt - i.startedAt) / 1000)
    if (i.startedAt !== null) {
      const w = weekStart(i.startedAt)
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
    for (const s of new Set(i.affectedServices)) byService.set(s, (byService.get(s) ?? 0) + 1)
    if (i.category) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1)
    for (const d of new Set(i.failedDependencies)) byDep.set(d, (byDep.get(d) ?? 0) + 1)
  }
  const sortDesc = <T extends { incidents: number }>(xs: T[], key: (x: T) => string) =>
    xs.sort((a, b) => b.incidents - a.incidents || (key(a) < key(b) ? -1 : 1))
  return {
    incidents: incidents.length,
    syntheticIncidents: incidents.filter((i) => i.synthetic).length,
    frequencyPerWeek: Array.from(freq.entries()).sort(([a], [b]) => (a < b ? -1 : 1)).map(([weekStart, count]) => ({ weekStart, count })),
    mttrSec: stat(ttr, mean),
    medianTtrSec: stat(ttr, median),
    mttdSec: stat(ttd, mean),
    bySeverity,
    byService: sortDesc(Array.from(byService, ([service, incidents]) => ({ service, incidents })), (x) => x.service),
    byCategory: sortDesc(Array.from(byCategory, ([category, incidents]) => ({ category, incidents, recurring: incidents >= 2 })), (x) => x.category),
    topDependencies: sortDesc(Array.from(byDep, ([dependency, incidents]) => ({ dependency, incidents })), (x) => x.dependency).slice(0, 10),
    definitions: ANALYTICS_DEFINITIONS,
  }
}

/** Builds the analytics summary for one incident dataset. */
export function summarizeIncident(dataset: import('../types').IncidentDataset): IncidentSummary {
  const errorServices = new Set(dataset.events.filter((e) => e.severity === 'error' || e.severity === 'critical').map((e) => e.service))
  const firstError = dataset.events.find((e) => e.severity === 'error' || e.severity === 'critical')
  const alert = dataset.events.find((e) => e.type === 'alert')
  const recovery = [...dataset.events].reverse().find((e) => e.type === 'recovery')
  return {
    id: dataset.meta.id,
    title: dataset.meta.title,
    severity: dataset.meta.severity,
    synthetic: dataset.meta.synthetic,
    startedAt: dataset.meta.startedAt ?? firstError?.ts ?? null,
    detectedAt: dataset.meta.detectedAt ?? alert?.ts ?? null,
    resolvedAt: dataset.meta.resolvedAt ?? recovery?.ts ?? null,
    category: dataset.meta.category ?? null,
    services: Array.from(new Set(dataset.events.map((e) => e.service))).sort(),
    affectedServices: Array.from(errorServices).sort(),
    failedDependencies: dataset.dependencies.filter((d) => errorServices.has(d.from) && errorServices.has(d.to)).map((d) => `${d.from}->${d.to}`).sort(),
  }
}
