import { useMemo } from 'react'
import type { IncidentDataset, Stat } from '@faultline/engine'
import { reliabilityReport, summarizeIncident } from '@faultline/engine'
import { duration } from '@/lib/format'
import { KindTag } from '../shell/atoms'

function StatCard({ label, stat, definition }: { label: string; stat: Stat; definition: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="font-mono text-[10.5px] uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-[20px] tabular text-foreground">{stat.value === null ? '—' : duration(stat.value)}</dd>
      <p className="mt-1 text-[11px] text-muted-foreground">{stat.value === null ? stat.reason : `n = ${stat.n}`}</p>
      <p className="mt-1 text-[11px] text-faint">{definition}</p>
    </div>
  )
}

function Bars({ rows, label }: { rows: Array<{ key: string; value: number; note?: string }>; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <figure>
      <figcaption className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</figcaption>
      {rows.length === 0 ? <p className="text-[12px] text-muted-foreground">No data.</p> : null}
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-2 text-[12px]">
            <span className="truncate font-mono text-[11.5px]" title={r.key}>{r.key}</span>
            <span className="h-2 rounded-sm bg-secondary" aria-hidden="true"><span className="block h-2 rounded-sm bg-[var(--color-fault)]/80" style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="font-mono text-[11.5px] tabular text-muted-foreground">{r.value}{r.note ? ` ${r.note}` : ''}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function AnalyticsView({ datasets }: { datasets: IncidentDataset[] }) {
  const report = useMemo(() => reliabilityReport(datasets.map(summarizeIncident)), [datasets])
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="text-foreground">{report.incidents} incident{report.incidents === 1 ? '' : 's'}</span>
        {report.syntheticIncidents ? <><KindTag kind="synthetic" /> {report.syntheticIncidents} of them synthetic demo data. These numbers describe the demo, not any real system.</> : null}
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Mean time to recovery" stat={report.mttrSec} definition={report.definitions.mttr} />
        <StatCard label="Median time to recovery" stat={report.medianTtrSec} definition={report.definitions.medianTtr} />
        <StatCard label="Mean time to detection" stat={report.mttdSec} definition={report.definitions.mttd} />
      </dl>
      <div className="grid gap-6 md:grid-cols-2">
        <Bars label="Incidents by severity" rows={Object.entries(report.bySeverity).map(([key, value]) => ({ key, value }))} />
        <Bars label="Incidents per week (by start)" rows={report.frequencyPerWeek.map((w) => ({ key: `week of ${w.weekStart}`, value: w.count }))} />
        <Bars label="Most affected services" rows={report.byService.slice(0, 10).map((s) => ({ key: s.service, value: s.incidents }))} />
        <Bars label="Failure categories" rows={report.byCategory.map((c) => ({ key: c.category, value: c.incidents, note: c.recurring ? '(recurring)' : '' }))} />
        <Bars label="Dependencies along which failures were observed" rows={report.topDependencies.map((d) => ({ key: d.dependency, value: d.incidents }))} />
      </div>
      <details className="rounded-md border border-border p-3 text-[12px] text-muted-foreground">
        <summary className="cursor-pointer text-foreground">Metric definitions</summary>
        <dl className="mt-2 space-y-1">{Object.entries(report.definitions).map(([k, v]) => <div key={k}><dt className="inline font-mono text-foreground">{k}: </dt><dd className="inline">{v}</dd></div>)}</dl>
      </details>
    </div>
  )
}
