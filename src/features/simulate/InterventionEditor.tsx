import { Plus, X } from 'lucide-react'
import type { Intervention, SimModel, SimScenario } from '@faultline/engine'
import { INTERVENTION_KINDS, deploymentsOf, modelAt } from '@faultline/engine'
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui'

type Kind = Intervention['kind']

/** Sensible default for each kind, derived from the model at the branch point. */
export function defaultIntervention(kind: Kind, scenario: SimScenario, atSec: number): Intervention {
  const m: SimModel = modelAt(scenario, atSec)
  const deployed = m.services.find((s) => deploymentsOf(scenario, s.id).length > 0)
  const db = m.services.find((s) => s.kind === 'database') ?? m.services[1] ?? m.services[0]
  const nonEntry = m.services.find((s) => s.id !== m.entry) ?? m.services[0]
  const call = m.calls.find((c) => c.from !== m.entry) ?? m.calls[0]
  switch (kind) {
    case 'rollback_deployment': return { kind, service: deployed?.id ?? m.services[0].id }
    case 'scale_capacity': return { kind, service: nonEntry.id, capacity: nonEntry.capacity * 2 }
    case 'db_pool': return { kind, service: db.id, capacity: db.capacity * 2 }
    case 'circuit_breaker': return { kind, service: call?.from ?? m.entry, enabled: true, failureRateThreshold: 0.5, openMs: 5000 }
    case 'rate_limit': return { kind, rps: Math.max(1, Math.round((m.traffic[m.traffic.length - 1]?.rps ?? 50) * 0.7)) }
    case 'retry_policy': return { kind, service: m.services.find((s) => s.retry.maxAttempts > 1)?.id ?? 'client', maxAttempts: 1, backoffMs: 100 }
    case 'isolate_dependency': return { kind, from: call?.from ?? m.entry, to: call?.to ?? m.services[1].id }
    case 'recover_service': return { kind, service: nonEntry.id }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function ServiceSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label: string }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 font-mono text-[12px]" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o} className="font-mono text-[12px]">{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  )
}

function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <Field label={label}>
      <Input
        type="number"
        inputMode="decimal"
        className="h-8 font-mono text-[12px]"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
        }}
      />
    </Field>
  )
}

export function InterventionEditor({ value, onChange, scenario, atSec }: { value: Intervention[]; onChange: (v: Intervention[]) => void; scenario: SimScenario; atSec: number }) {
  const m = modelAt(scenario, atSec)
  const services = m.services.map((s) => s.id)
  const deployable = services.filter((id) => deploymentsOf(scenario, id).length > 0)
  const set = (i: number, iv: Intervention) => onChange(value.map((x, j) => (j === i ? iv : x)))

  return (
    <div className="space-y-2">
      {value.length === 0 ? <p className="text-[12px] text-muted-foreground">No interventions yet. Without any, the branch simply reproduces the baseline.</p> : null}
      {value.map((iv, i) => (
        <div key={i} className="rounded-md border border-border bg-card p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <Select value={iv.kind} onValueChange={(k) => set(i, defaultIntervention(k as Kind, scenario, atSec))}>
              <SelectTrigger className="h-8 flex-1 text-[12.5px]" aria-label="Intervention type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERVENTION_KINDS.filter((k) => k.kind !== 'rollback_deployment' || deployable.length > 0).map((k) => (
                  <SelectItem key={k.kind} value={k.kind} className="text-[12.5px]">{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button type="button" aria-label="Remove intervention" onClick={() => onChange(value.filter((_, j) => j !== i))} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mb-2 text-[11.5px] text-muted-foreground">{INTERVENTION_KINDS.find((k) => k.kind === iv.kind)?.description}</p>
          <div className="grid grid-cols-2 gap-2">
            {iv.kind === 'rollback_deployment' ? <ServiceSelect label="Service" value={iv.service} options={deployable.length ? deployable : services} onChange={(service) => set(i, { ...iv, service })} /> : null}
            {iv.kind === 'scale_capacity' || iv.kind === 'db_pool' ? (
              <>
                <ServiceSelect label="Service" value={iv.service} options={iv.kind === 'db_pool' ? services.filter((id) => m.services.find((s) => s.id === id)?.kind === 'database') : services} onChange={(service) => set(i, { ...iv, service })} />
                <NumberField label={iv.kind === 'db_pool' ? 'Connections' : 'Workers'} value={iv.capacity} min={1} max={10000} onChange={(capacity) => set(i, { ...iv, capacity })} />
              </>
            ) : null}
            {iv.kind === 'circuit_breaker' ? (
              <>
                <ServiceSelect label="Caller" value={iv.service} options={services} onChange={(service) => set(i, { ...iv, service })} />
                <Field label="Enabled">
                  <span className="flex h-8 items-center"><Switch checked={iv.enabled} onCheckedChange={(enabled: boolean) => set(i, { ...iv, enabled })} aria-label="Breaker enabled" /></span>
                </Field>
                <NumberField label="Open at failure %" value={Math.round((iv.failureRateThreshold ?? 0.5) * 100)} min={5} max={100} onChange={(v) => set(i, { ...iv, failureRateThreshold: v / 100 })} />
                <NumberField label="Open for (ms)" value={iv.openMs ?? 5000} min={100} max={120000} step={100} onChange={(openMs) => set(i, { ...iv, openMs })} />
              </>
            ) : null}
            {iv.kind === 'rate_limit' ? <NumberField label="Requests / s" value={iv.rps ?? 0} min={1} max={2000} onChange={(rps) => set(i, { ...iv, rps })} /> : null}
            {iv.kind === 'retry_policy' ? (
              <>
                <ServiceSelect label="Service" value={iv.service} options={['client', ...services]} onChange={(service) => set(i, { ...iv, service })} />
                <NumberField label="Attempts" value={iv.maxAttempts} min={1} max={10} onChange={(maxAttempts) => set(i, { ...iv, maxAttempts })} />
                <NumberField label="Backoff (ms)" value={iv.backoffMs} min={0} max={30000} step={10} onChange={(backoffMs) => set(i, { ...iv, backoffMs })} />
              </>
            ) : null}
            {iv.kind === 'isolate_dependency' ? (
              <>
                <ServiceSelect label="Caller" value={iv.from} options={Array.from(new Set(m.calls.map((c) => c.from)))} onChange={(from) => set(i, { ...iv, from, to: m.calls.find((c) => c.from === from)?.to ?? iv.to })} />
                <ServiceSelect label="Dependency" value={iv.to} options={m.calls.filter((c) => c.from === iv.from).map((c) => c.to)} onChange={(to) => set(i, { ...iv, to })} />
              </>
            ) : null}
            {iv.kind === 'recover_service' ? <ServiceSelect label="Service" value={iv.service} options={services} onChange={(service) => set(i, { ...iv, service })} /> : null}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, defaultIntervention(deployable.length ? 'rollback_deployment' : 'scale_capacity', scenario, atSec)])}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[12px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      >
        <Plus className="size-3.5" /> Add intervention
      </button>
    </div>
  )
}
