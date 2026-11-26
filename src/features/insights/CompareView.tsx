import { useMemo, useState } from 'react'
import type { IncidentDataset } from '@faultline/engine'
import { summarizeIncident } from '@faultline/engine'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import { duration, num } from '@/lib/format'
import { KindTag } from '../shell/atoms'
import { SeriesChart } from '../simulate/SeriesChart'

const COLORS = ['var(--color-foreground)', 'var(--color-sim)']

/** Error-event counts per 10 s, aligned so both incidents start at their first error. */
function alignedSeries(d: IncidentDataset) {
  const s = summarizeIncident(d)
  const t0 = s.startedAt ?? d.events[0]?.ts ?? 0
  const bins = new Map<number, number>()
  let maxX = 0
  for (const e of d.events) {
    if (e.severity !== 'error' && e.severity !== 'critical') continue
    const x = Math.floor((e.ts - t0) / 10_000) * 10
    if (x < -60) continue
    bins.set(x, (bins.get(x) ?? 0) + 1)
    maxX = Math.max(maxX, x)
  }
  const pts: Array<{ x: number; y: number }> = []
  for (let x = -60; x <= maxX + 30; x += 10) pts.push({ x, y: bins.get(x) ?? 0 })
  return pts
}

export function CompareView({ datasets }: { datasets: IncidentDataset[] }) {
  const [a, setA] = useState(datasets[0]?.meta.id ?? '')
  const [b, setB] = useState(datasets[1]?.meta.id ?? datasets[0]?.meta.id ?? '')
  const da = datasets.find((d) => d.meta.id === a)
  const db = datasets.find((d) => d.meta.id === b)
  const rows = useMemo(() => {
    const pair = [da, db].map((d) => (d ? { d, s: summarizeIncident(d) } : null))
    const metric = (label: string, f: (x: NonNullable<(typeof pair)[number]>) => string) => ({ label, values: pair.map((x) => (x ? f(x) : '—')) })
    return [
      metric('Severity', (x) => x.d.meta.severity),
      metric('Category', (x) => x.s.category ?? 'uncategorized'),
      metric('Duration', (x) => duration(x.s.startedAt !== null && x.s.resolvedAt !== null ? (x.s.resolvedAt - x.s.startedAt) / 1000 : null)),
      metric('Time to detect', (x) => duration(x.s.startedAt !== null && x.s.detectedAt !== null ? (x.s.detectedAt - x.s.startedAt) / 1000 : null)),
      metric('Events', (x) => num(x.d.events.length)),
      metric('Error events', (x) => num(x.d.events.filter((e) => e.severity === 'error' || e.severity === 'critical').length)),
      metric('Affected services', (x) => `${x.s.affectedServices.length} of ${x.s.services.length}`),
      metric('Failed dependencies', (x) => x.s.failedDependencies.join(', ') || 'none'),
      metric('Deployments in window', (x) => num(x.d.events.filter((e) => e.type === 'deploy').length)),
      metric('Retry events', (x) => num(x.d.events.filter((e) => e.type === 'retry').length)),
    ]
  }, [da, db])

  if (datasets.length < 2) {
    return <p className="text-[13px] text-muted-foreground">Comparison needs at least two incidents.</p>
  }
  const shared = da && db ? summarizeIncident(da).affectedServices.filter((s) => summarizeIncident(db).affectedServices.includes(s)) : []

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {[{ v: a, set: setA, i: 0 }, { v: b, set: setB, i: 1 }].map(({ v, set, i }) => (
          <label key={i} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase text-muted-foreground"><span className="size-2 rounded-full" style={{ background: COLORS[i] }} />Incident {i === 0 ? 'A' : 'B'}</span>
            <Select value={v} onValueChange={set}>
              <SelectTrigger className="h-9 text-[13px]" aria-label={`Incident ${i === 0 ? 'A' : 'B'}`}><SelectValue /></SelectTrigger>
              <SelectContent>{datasets.map((d) => <SelectItem key={d.meta.id} value={d.meta.id} className="text-[13px]">{d.meta.title}{d.meta.synthetic ? ' (synthetic)' : ''}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        ))}
      </div>
      {da && db ? (
        <>
          <SeriesChart
            title="Error events per 10 s, aligned at each incident's first error"
            xFormat={(v) => `${v < 0 ? '-' : ''}${Math.floor(Math.abs(v) / 60)}:${String(Math.abs(Math.round(v)) % 60).padStart(2, '0')}`}
            yFormat={(v) => num(v)}
            height={170}
            series={[
              { id: 'a', label: da.meta.title, color: COLORS[0], points: alignedSeries(da) },
              { id: 'b', label: db.meta.title, color: COLORS[1], dashed: true, points: alignedSeries(db) },
            ]}
          />
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[12.5px]">
              <thead className="bg-secondary/50 font-mono text-[10.5px] uppercase text-muted-foreground">
                <tr><th className="px-3 py-2 text-left font-normal">Metric</th><th className="px-3 text-left font-normal">{da.meta.title}</th><th className="px-3 text-left font-normal">{db.meta.title}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-border/60">
                    <td className="px-3 py-1.5 text-muted-foreground">{r.label}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{r.values[0]}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px] text-[var(--color-sim)]">{r.values[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            Shared affected services: {shared.length ? shared.join(', ') : 'none'}.
            {da.meta.synthetic || db.meta.synthetic ? <> <KindTag kind="synthetic" className="ml-1 align-middle" /> At least one incident is synthetic demo data.</> : null}
          </p>
        </>
      ) : null}
    </div>
  )
}
