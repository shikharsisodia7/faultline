import { useMemo, useState } from 'react'
import { Pin, Play, Plus, Save, Trash2, X } from 'lucide-react'
import type { RunResult, ScheduledChange, ServiceModel, SimScenario } from '@faultline/engine'
import { LAB_TEMPLATES, service, validateModel } from '@faultline/engine'
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { duration, ms, num, pct } from '@/lib/format'
import { runScenario } from '../engine/client'
import { KindTag, SectionLabel } from '../shell/atoms'
import { SeriesChart, type Series } from '../simulate/SeriesChart'
import { LAB_EVENTS, LAB_GUIDES, eventChanges } from './catalog'

export interface SavedLabScenario {
  id: string
  name: string
  scenario: SimScenario
  updatedAt: number
}

export interface LabStore {
  notice: string
  canSave: boolean
  scenarios: SavedLabScenario[]
  save?: (name: string, scenario: SimScenario, id?: string) => Promise<string>
  remove?: (id: string) => Promise<void>
}

type FaultKind = 'latency' | 'outage' | 'db_saturation' | 'deploy_failure'

const FAULTS: Array<{ kind: FaultKind; label: string }> = [
  { kind: 'latency', label: 'Inject latency' },
  { kind: 'outage', label: 'Service outage' },
  { kind: 'db_saturation', label: 'Database saturation' },
  { kind: 'deploy_failure', label: 'Failed deployment' },
]

const PALETTE = ['var(--color-sim)', 'var(--color-degraded)', 'var(--color-healthy)', '#c79bf2']

interface Pinned {
  name: string
  run: RunResult
  color: string
}

function NumCell({ value, onChange, min = 0, max = 100000, step = 1, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string }) {
  return (
    <input
      type="number"
      aria-label={label}
      className="h-7 w-full min-w-0 rounded border border-input bg-transparent px-1.5 text-right font-mono text-[11.5px] tabular outline-none focus:border-ring"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
      }}
    />
  )
}

export { useLocalLabStore } from './useLocalLabStore'

export function ChaosLab({ store }: { store: LabStore }) {
  const [templateSlug, setTemplateSlug] = useState(LAB_TEMPLATES[0].slug)
  const [scenario, setScenario] = useState<SimScenario>(() => LAB_TEMPLATES[0].build())
  const [savedId, setSavedId] = useState<string | undefined>()
  const [name, setName] = useState(LAB_TEMPLATES[0].name)
  const [run, setRun] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pinned, setPinned] = useState<Pinned[]>([])
  const [queueSvc, setQueueSvc] = useState(scenario.model.services[1]?.id ?? scenario.model.services[0].id)
  const [newSvc, setNewSvc] = useState({ id: '', kind: 'service' as ServiceModel['kind'] })
  const [link, setLink] = useState({ from: '', to: '' })
  const [saving, setSaving] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const { success, error: toastError } = useToast()

  const problems = useMemo(() => validateModel(scenario.model, scenario.durationSec), [scenario])
  const ids = scenario.model.services.map((s) => s.id)
  const update = (fn: (s: SimScenario) => SimScenario) => {
    setScenario((prev) => fn(JSON.parse(JSON.stringify(prev)) as SimScenario))
    setRun(null)
  }
  const setSvc = (id: string, patch: Partial<ServiceModel>) => update((s) => ({ ...s, model: { ...s.model, services: s.model.services.map((x) => (x.id === id ? { ...x, ...patch } : x)) } }))

  const loadTemplate = (slug: string) => {
    const t = LAB_TEMPLATES.find((x) => x.slug === slug)!
    const sc = t.build()
    setTemplateSlug(slug)
    setScenario(sc)
    setName(t.name)
    setSavedId(undefined)
    setRun(null)
    setPinned([])
    setQueueSvc(sc.model.services[1]?.id ?? sc.model.services[0].id)
  }

  const addFault = (kind: FaultKind) => {
    const target = scenario.model.services.find((s) => (kind === 'db_saturation' ? s.kind === 'database' : s.id !== scenario.model.entry)) ?? scenario.model.services[0]
    const at = Math.round(scenario.durationSec / 3)
    const changes: ScheduledChange[] = []
    if (kind === 'latency') changes.push({ atSec: at, label: `Inject 5x latency in ${target.id}`, origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: target.id, patch: { latencyMultiplier: 5 } } })
    if (kind === 'outage') {
      changes.push({ atSec: at, label: `${target.id} outage`, origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: target.id, patch: { available: false } } })
      changes.push({ atSec: at + 60, label: `${target.id} restored`, origin: 'scenario', category: 'recovery', change: { kind: 'set_service', service: target.id, patch: { available: true } } })
    }
    if (kind === 'db_saturation') changes.push({ atSec: at, label: `${target.id} queries 6x slower`, origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: target.id, patch: { serviceTimeMs: Math.round(target.serviceTimeMs * 6) } } })
    if (kind === 'deploy_failure') changes.push({ atSec: at, label: `Deploy ${target.id} vNext (15% errors)`, origin: 'scenario', category: 'deploy', deploymentId: `${target.id}@vNext-${at}`, change: { kind: 'set_service', service: target.id, patch: { errorRate: 0.15 } } })
    update((s) => ({ ...s, timeline: [...s.timeline, ...changes] }))
  }

  const execute = async () => {
    setRunning(true)
    setError(null)
    try {
      setRun(await runScenario(scenario))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const chartSeries = (pick: (s: RunResult['samples'][number]) => number | null): Series[] => [
    ...pinned.map((p, i) => ({ id: `p${i}`, label: p.name, color: p.color, dashed: true, points: p.run.samples.map((s) => ({ x: s.t, y: pick(s) })) })),
    ...(run ? [{ id: 'cur', label: 'current', color: 'var(--color-foreground)', points: run.samples.map((s) => ({ x: s.t, y: pick(s) })) }] : []),
  ]

  return (
    <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(0,560px)_1fr] lg:overflow-hidden">
      <aside className="border-b border-border lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-[14px] font-medium text-foreground">{advanced ? 'Advanced settings' : 'Choose a system'}</span>
          <button type="button" onClick={() => setAdvanced((a) => !a)} aria-pressed={advanced} className="text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{advanced ? 'Back to simple view' : 'Advanced settings'}</button>
        </div>
        {advanced ? (
          <>
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Template</span>
              <Select value={templateSlug} onValueChange={loadTemplate}>
                <SelectTrigger className="h-8 text-[12.5px]" aria-label="Template"><SelectValue /></SelectTrigger>
                <SelectContent>{LAB_TEMPLATES.map((t) => <SelectItem key={t.slug} value={t.slug} className="text-[12.5px]">{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="flex w-28 flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Duration (s)</span>
              <NumCell label="Duration in seconds" value={scenario.durationSec} min={30} max={1800} step={30} onChange={(v) => update((s) => ({ ...s, durationSec: v }))} />
            </label>
            <label className="flex w-24 flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Seed</span>
              <NumCell label="Random seed" value={scenario.seed} min={0} max={2 ** 31} onChange={(v) => update((s) => ({ ...s, seed: Math.round(v) }))} />
            </label>
          </div>
          <p className="text-[12px] text-muted-foreground">{LAB_TEMPLATES.find((t) => t.slug === templateSlug)?.description} All faults are injected into this virtual model only.</p>
        </div>

        <SectionLabel>Traffic</SectionLabel>
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 pb-2">
          <label className="text-[11px] text-muted-foreground">Entry rps<NumCell label="Entry requests per second" value={scenario.model.traffic[0].rps} min={0} max={2000} onChange={(v) => update((s) => ({ ...s, model: { ...s.model, traffic: [{ atSec: 0, rps: v }, ...s.model.traffic.slice(1)] } }))} /></label>
          <label className="text-[11px] text-muted-foreground">Client timeout ms<NumCell label="Client timeout" value={scenario.model.clientTimeoutMs} min={50} max={60000} step={50} onChange={(v) => update((s) => ({ ...s, model: { ...s.model, clientTimeoutMs: v } }))} /></label>
          <label className="text-[11px] text-muted-foreground">Client attempts<NumCell label="Client attempts" value={scenario.model.clientRetry.maxAttempts} min={1} max={10} onChange={(v) => update((s) => ({ ...s, model: { ...s.model, clientRetry: { ...s.model.clientRetry, maxAttempts: v } } }))} /></label>
        </div>

        <SectionLabel>Services</SectionLabel>
        <div className="overflow-x-auto px-3">
          <table className="w-full min-w-[520px] text-[11px]">
            <thead className="font-mono text-[10px] uppercase text-muted-foreground">
              <tr><th className="pb-1 text-left font-normal">service</th><th className="font-normal">workers</th><th className="font-normal">queue</th><th className="font-normal">svc ms</th><th className="font-normal">timeout</th><th className="font-normal">retries</th><th className="font-normal">err %</th><th className="font-normal">breaker</th><th /></tr>
            </thead>
            <tbody>
              {scenario.model.services.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="py-1 pr-2 font-mono"><span className="block truncate">{s.id}</span><span className="text-[10px] text-muted-foreground">{s.kind}{s.id === scenario.model.entry ? ' · entry' : ''}</span></td>
                  <td className="px-0.5"><NumCell label={`${s.id} workers`} value={s.capacity} min={1} max={10000} onChange={(v) => setSvc(s.id, { capacity: v })} /></td>
                  <td className="px-0.5"><NumCell label={`${s.id} queue`} value={s.queueCapacity} min={0} max={100000} onChange={(v) => setSvc(s.id, { queueCapacity: v })} /></td>
                  <td className="px-0.5"><NumCell label={`${s.id} service time`} value={s.serviceTimeMs} min={0.1} max={60000} step={0.5} onChange={(v) => setSvc(s.id, { serviceTimeMs: v })} /></td>
                  <td className="px-0.5"><NumCell label={`${s.id} timeout`} value={s.timeoutMs} min={10} max={120000} step={50} onChange={(v) => setSvc(s.id, { timeoutMs: v })} /></td>
                  <td className="px-0.5"><NumCell label={`${s.id} attempts`} value={s.retry.maxAttempts} min={1} max={10} onChange={(v) => setSvc(s.id, { retry: { ...s.retry, maxAttempts: v } })} /></td>
                  <td className="px-0.5"><NumCell label={`${s.id} error rate percent`} value={Math.round(s.errorRate * 1000) / 10} min={0} max={100} step={0.5} onChange={(v) => setSvc(s.id, { errorRate: v / 100 })} /></td>
                  <td className="px-1 text-center"><Switch checked={s.circuitBreaker.enabled} onCheckedChange={(enabled: boolean) => setSvc(s.id, { circuitBreaker: { ...s.circuitBreaker, enabled } })} aria-label={`${s.id} circuit breaker`} /></td>
                  <td>
                    {s.id !== scenario.model.entry ? (
                      <button type="button" aria-label={`Remove ${s.id}`} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground" onClick={() => update((sc) => ({ ...sc, model: { ...sc.model, services: sc.model.services.filter((x) => x.id !== s.id), calls: sc.model.calls.filter((c) => c.from !== s.id && c.to !== s.id) }, timeline: sc.timeline.filter((c) => !('service' in c.change) || c.change.service !== s.id) }))}>
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const id = newSvc.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'); if (!id || ids.includes(id)) return; update((s) => ({ ...s, model: { ...s.model, services: [...s.model.services, service(id, newSvc.kind)] } })); setNewSvc({ id: '', kind: newSvc.kind }) }}>
            <Input value={newSvc.id} onChange={(e) => setNewSvc({ ...newSvc, id: e.target.value })} placeholder="new-service" aria-label="New service name" className="h-8 w-40 font-mono text-[12px]" maxLength={40} />
            <Select value={newSvc.kind} onValueChange={(k) => setNewSvc({ ...newSvc, kind: k as ServiceModel['kind'] })}>
              <SelectTrigger className="h-8 w-32 text-[12px]" aria-label="New service kind"><SelectValue /></SelectTrigger>
              <SelectContent>{(['service', 'database', 'cache', 'queue', 'external'] as const).map((k) => <SelectItem key={k} value={k} className="text-[12px]">{k}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="submit" size="sm" variant="outline" className="h-8"><Plus className="size-3.5" /> Add service</Button>
          </form>
        </div>

        <SectionLabel>Dependencies</SectionLabel>
        <ul className="space-y-1 px-3">
          {scenario.model.calls.map((c) => (
            <li key={`${c.from}->${c.to}`} className="flex items-center gap-2 font-mono text-[11.5px]">
              <span className="truncate">{c.from}</span><span className="text-muted-foreground">→</span><span className="truncate">{c.to}</span>
              <label className="ml-auto flex items-center gap-1 text-[10.5px] text-muted-foreground">optional <Switch checked={Boolean(c.optional)} onCheckedChange={(optional: boolean) => update((s) => ({ ...s, model: { ...s.model, calls: s.model.calls.map((x) => (x === s.model.calls.find((y) => y.from === c.from && y.to === c.to) ? { ...x, optional } : x)) } }))} aria-label={`${c.from} to ${c.to} optional`} /></label>
              <button type="button" aria-label={`Remove dependency ${c.from} to ${c.to}`} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground" onClick={() => update((s) => ({ ...s, model: { ...s.model, calls: s.model.calls.filter((x) => !(x.from === c.from && x.to === c.to)) } }))}><X className="size-3" /></button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
          {(['from', 'to'] as const).map((k) => (
            <Select key={k} value={link[k]} onValueChange={(v) => setLink({ ...link, [k]: v })}>
              <SelectTrigger className="h-8 w-36 font-mono text-[11.5px]" aria-label={k === 'from' ? 'Caller' : 'Dependency'}><SelectValue placeholder={k === 'from' ? 'caller' : 'dependency'} /></SelectTrigger>
              <SelectContent>{ids.map((id) => <SelectItem key={id} value={id} className="font-mono text-[11.5px]">{id}</SelectItem>)}</SelectContent>
            </Select>
          ))}
          <Button size="sm" variant="outline" className="h-8" disabled={!link.from || !link.to || link.from === link.to || scenario.model.calls.some((c) => c.from === link.from && c.to === link.to)} onClick={() => { update((s) => ({ ...s, model: { ...s.model, calls: [...s.model.calls, { from: link.from, to: link.to }] } })); setLink({ from: '', to: '' }) }}>Connect</Button>
        </div>

        <SectionLabel>Injected faults</SectionLabel>
        <ul className="space-y-1.5 px-3">
          {scenario.timeline.length === 0 ? <li className="text-[12px] text-muted-foreground">No faults. The run shows the healthy baseline.</li> : null}
          {scenario.timeline.map((c, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <span className="w-16 shrink-0"><NumCell label={`Fault ${i + 1} time`} value={c.atSec} min={0} max={scenario.durationSec} step={5} onChange={(v) => update((s) => ({ ...s, timeline: s.timeline.map((x, j) => (j === i ? { ...x, atSec: v } : x)) }))} /></span>
              <span className="min-w-0 flex-1 truncate text-[12px]">{c.label}</span>
              <button type="button" aria-label={`Remove fault ${c.label}`} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground" onClick={() => update((s) => ({ ...s, timeline: s.timeline.filter((_, j) => j !== i) }))}><Trash2 className="size-3" /></button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5 px-3 pb-4 pt-2">
          {FAULTS.map((f) => (
            <button key={f.kind} type="button" onClick={() => addFault(f.kind)} disabled={f.kind === 'db_saturation' && !scenario.model.services.some((s) => s.kind === 'database')} className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-[11.5px] text-muted-foreground hover:border-[var(--color-fault)]/50 hover:text-[var(--color-fault)] disabled:opacity-40">
              <Plus className="size-3" /> {f.label}
            </button>
          ))}
        </div>
          </>
        ) : (
          <SimpleLab
            templateSlug={templateSlug}
            onTemplate={loadTemplate}
            scenario={scenario}
            onEvent={(changes) => update((sc) => ({ ...sc, timeline: [...sc.timeline, ...changes] }))}
            onClearEvents={() => update((sc) => ({ ...sc, timeline: [] }))}
          />
        )}
      </aside>

      <section className="lg:min-h-0 lg:overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Button onClick={execute} loading={running} disabled={problems.length > 0}><Play className="size-4" /> Run simulation</Button>
          <Button variant="outline" disabled={!run || pinned.length >= 4} onClick={() => run && setPinned((p) => [...p, { name: `Strategy ${String.fromCharCode(65 + p.length)}`, run, color: PALETTE[p.length % PALETTE.length] }])}>
            <Pin className="size-4" /> Pin as strategy
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Scenario name" className="h-9 w-48 text-[12.5px]" maxLength={80} />
            <Button
              variant="outline"
              disabled={!store.canSave || !store.save || !name.trim() || problems.length > 0}
              loading={saving}
              title={store.canSave ? 'Save this scenario' : store.notice}
              onClick={async () => {
                setSaving(true)
                try {
                  setSavedId(await store.save!(name.trim(), scenario, savedId))
                  success('Scenario saved', name.trim())
                } catch (e) {
                  toastError('Could not save', e instanceof Error ? e.message : String(e))
                } finally {
                  setSaving(false)
                }
              }}
            >
              <Save className="size-4" /> Save
            </Button>
          </div>
          <p className="w-full text-[11.5px] text-muted-foreground">{store.notice}</p>
        </div>

        {problems.length ? (
          <ul role="alert" className="m-3 list-disc space-y-0.5 rounded-md border border-[var(--color-fault)]/40 bg-[var(--color-fault-muted)] py-2 pl-7 pr-3 text-[12px] text-foreground">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        ) : null}
        {error ? <p role="alert" className="m-3 text-[12px] text-[var(--color-fault)]">{error}</p> : null}

        {!run && pinned.length === 0 ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 p-8 text-center">
            <KindTag kind="simulated" />
            <p className="max-w-md text-[13px] text-foreground">Shape the system on the left, inject a fault, and run it.</p>
            <p className="max-w-md text-[12px] text-muted-foreground">Pin a run as a strategy, change one thing (more workers, a breaker, fewer retries), run again, and compare them side by side.</p>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {run ? (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Success rate', pct(run.summary.successRate)],
                  ['p95 latency', ms(run.summary.latency.p95)],
                  ['Failed requests', num(run.summary.failed + run.summary.rateLimited)],
                  ['Time to recovery', run.summary.onsetSec === null ? 'no failure' : run.summary.recovered ? duration(run.summary.timeToRecoverySec) : 'not recovered'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md border border-border p-3">
                    <dt className="font-mono text-[10.5px] uppercase text-muted-foreground">{k}</dt>
                    <dd className="mt-1 font-mono text-[18px] tabular text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
              <SeriesChart title="Client error rate" yFormat={(v) => pct(v, 0)} yMax={1} series={chartSeries((s) => s.errorRate)} />
              <SeriesChart title="Client p95 latency" yFormat={(v) => ms(v)} series={chartSeries((s) => s.p95)} />
              <div className="min-w-0 xl:col-span-2">
                <div className="mb-1 flex justify-end">
                  <Select value={ids.includes(queueSvc) ? queueSvc : ids[0]} onValueChange={setQueueSvc}>
                    <SelectTrigger className="h-7 w-48 font-mono text-[11.5px]" aria-label="Service for queue depth"><SelectValue /></SelectTrigger>
                    <SelectContent>{ids.map((id) => <SelectItem key={id} value={id} className="font-mono text-[11.5px]">{id}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <SeriesChart title={`Queue depth · ${queueSvc}`} yFormat={(v) => num(v)} series={chartSeries((s) => s.services[queueSvc]?.queue ?? null)} />
              </div>
            </div>
            {pinned.length ? (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-[12px]">
                  <thead className="bg-secondary/50 font-mono text-[10.5px] uppercase text-muted-foreground"><tr><th className="px-3 py-2 text-left font-normal">Strategy</th><th className="px-3 text-right font-normal">Success</th><th className="px-3 text-right font-normal">p95</th><th className="px-3 text-right font-normal">Failed</th><th className="px-3 text-right font-normal">Recovery</th><th className="px-3 text-right font-normal">Retries</th><th /></tr></thead>
                  <tbody>
                    {[...pinned, ...(run ? [{ name: 'current', run, color: 'var(--color-foreground)' }] : [])].map((p, i) => (
                      <tr key={`${p.name}-${i}`} className="border-t border-border/60">
                        <td className="px-3 py-1.5"><span className="mr-2 inline-block size-2 rounded-full" style={{ background: p.color }} />{p.name}</td>
                        <td className="px-3 text-right font-mono tabular">{pct(p.run.summary.successRate)}</td>
                        <td className="px-3 text-right font-mono tabular">{ms(p.run.summary.latency.p95)}</td>
                        <td className="px-3 text-right font-mono tabular">{num(p.run.summary.failed + p.run.summary.rateLimited)}</td>
                        <td className="px-3 text-right font-mono tabular">{p.run.summary.onsetSec === null ? '—' : p.run.summary.recovered ? duration(p.run.summary.timeToRecoverySec) : 'no'}</td>
                        <td className="px-3 text-right font-mono tabular">{num(p.run.summary.retries)}</td>
                        <td className="px-2 text-right">{p.name !== 'current' ? <button type="button" aria-label={`Unpin ${p.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => setPinned((x) => x.filter((_, j) => j !== i))}><X className="size-3" /></button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="text-[11.5px] text-muted-foreground">Seeded discrete-event simulation. Requests arrive as a Poisson process; service times are lognormal; timeouts do not cancel downstream work. Results are model estimates, not predictions about any real system.</p>
          </div>
        )}

        {store.scenarios.length ? (
          <div className="border-t border-border p-4">
            <h2 className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Saved scenarios</h2>
            <ul className="space-y-1">
              {store.scenarios.map((s) => (
                <li key={s.id} className={cn('flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12.5px]', s.id === savedId && 'border-foreground/40')}>
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => { setScenario(s.scenario); setName(s.name); setSavedId(s.id); setRun(null) }}>{s.name}</button>
                  <span className="font-mono text-[10.5px] text-muted-foreground">{new Date(s.updatedAt).toISOString().slice(0, 10)}</span>
                  {store.remove ? <button type="button" aria-label={`Delete scenario ${s.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => store.remove!(s.id)}><Trash2 className="size-3.5" /></button> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}


function SimpleLab({ templateSlug, onTemplate, scenario, onEvent, onClearEvents }: { templateSlug: string; onTemplate: (slug: string) => void; scenario: SimScenario; onEvent: (c: ScheduledChange[]) => void; onClearEvents: () => void }) {
  const guide = LAB_GUIDES.find((g) => g.slug === templateSlug)
  return (
    <div className="space-y-6 p-4">
      {(['system', 'drill'] as const).map((group) => (
        <div key={group}>
          <h2 className="text-[12.5px] text-muted-foreground">{group === 'system' ? 'Systems you know' : 'Failure drills'}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {LAB_GUIDES.filter((g) => g.group === group).map((g) => (
              <button key={g.slug} type="button" aria-pressed={g.slug === templateSlug} onClick={() => onTemplate(g.slug)} className={cn('rounded-xl border px-3 py-2.5 text-left text-[14px] transition-colors', g.slug === templateSlug ? 'border-foreground/60 bg-white text-foreground' : 'border-border text-foreground/80 hover:border-foreground/30')}>
                {g.title}
              </button>
            ))}
          </div>
        </div>
      ))}
      {guide ? (
        <dl className="space-y-3 rounded-2xl border border-border bg-white p-4 text-[14px] leading-relaxed">
          <div><dt className="text-[12.5px] text-muted-foreground">What it does</dt><dd className="text-foreground">{guide.what}</dd></div>
          <div><dt className="text-[12.5px] text-muted-foreground">How its parts work together</dt><dd className="text-foreground">{guide.parts}</dd></div>
          <div><dt className="text-[12.5px] text-muted-foreground">What might make it fail</dt><dd className="text-foreground">{guide.risks}</dd></div>
          <div><dt className="text-[12.5px] text-muted-foreground">Decisions worth trying</dt><dd className="text-foreground">{guide.decisions}</dd></div>
        </dl>
      ) : null}
      <div>
        <h2 className="text-[12.5px] text-muted-foreground">Make something happen</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {LAB_EVENTS.map((e) => {
            const changes = eventChanges(e.id, scenario)
            return (
              <button key={e.id} type="button" disabled={!changes} title={changes ? undefined : 'This system has no part this applies to'} onClick={() => changes && onEvent(changes)} className="rounded-full border border-dashed border-border px-3 py-1.5 text-[13px] text-foreground hover:border-[var(--color-fault)] hover:text-[var(--color-fault)] disabled:opacity-40">
                {e.label}
              </button>
            )
          })}
        </div>
        {scenario.timeline.length ? (
          <ul className="mt-3 space-y-1 text-[13.5px] text-foreground">
            {scenario.timeline.map((c, i) => <li key={i}><span className="font-mono text-[12px] text-muted-foreground">{Math.floor(c.atSec / 60)}:{String(c.atSec % 60).padStart(2, '0')}</span> {c.label}</li>)}
            <li><button type="button" onClick={onClearEvents} className="text-[12.5px] text-muted-foreground underline">Clear events</button></li>
          </ul>
        ) : <p className="mt-2 text-[13px] text-muted-foreground">Nothing scheduled: running now shows a normal day.</p>}
      </div>
      <p className="text-[12.5px] text-muted-foreground">Everything here happens inside a simulation. Nothing touches real systems. Fine-tune capacities, timeouts, and retries under Advanced settings.</p>
    </div>
  )
}
