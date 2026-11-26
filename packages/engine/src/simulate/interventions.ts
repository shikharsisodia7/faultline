import { cloneModel, type ScheduledChange, type ServiceModel, type SimModel, type SimScenario } from './model'
import { assignAllowed, CALL_PATCH_KEYS, SERVICE_PATCH_KEYS } from '../util/safe'
import type { RunResult, RunSummary } from './simulator'

export type Intervention =
  | { kind: 'rollback_deployment'; service: string }
  | { kind: 'scale_capacity'; service: string; capacity: number }
  | { kind: 'db_pool'; service: string; capacity: number }
  | { kind: 'circuit_breaker'; service: string; enabled: boolean; failureRateThreshold?: number; openMs?: number }
  | { kind: 'rate_limit'; rps: number | null }
  | { kind: 'retry_policy'; service: string; maxAttempts: number; backoffMs: number; jitter?: number }
  | { kind: 'isolate_dependency'; from: string; to: string }
  | { kind: 'recover_service'; service: string }

export const INTERVENTION_KINDS: Array<{ kind: Intervention['kind']; label: string; description: string }> = [
  { kind: 'rollback_deployment', label: 'Roll back deployment', description: "Restore the service's parameters from before its deployment. If the deploy had not happened yet, it never happens." },
  { kind: 'scale_capacity', label: 'Scale capacity', description: 'Set the number of concurrent workers for a service.' },
  { kind: 'db_pool', label: 'Resize connection pool', description: 'Set the connection pool size of a database.' },
  { kind: 'circuit_breaker', label: 'Circuit breaker', description: 'Enable or disable the caller-side breakers a service keeps for its dependencies.' },
  { kind: 'rate_limit', label: 'Rate limit entry', description: 'Admit at most N requests per second at the entry; excess is rejected immediately.' },
  { kind: 'retry_policy', label: 'Change retry policy', description: 'Set attempts and backoff for a service, or for clients (service "client").' },
  { kind: 'isolate_dependency', label: 'Isolate dependency', description: 'Stop calling a dependency; the caller skips it (degraded but fast).' },
  { kind: 'recover_service', label: 'Recover service', description: 'Return a failed service to its baseline parameters and availability.' },
]

/** Model state at `atSec` after applying scenario changes that occur strictly before it. */
export function modelAt(scenario: SimScenario, atSec: number, inclusive = false): SimModel {
  const model = cloneModel(scenario.model)
  const changes = scenario.timeline
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => (inclusive ? c.atSec <= atSec : c.atSec < atSec))
    .sort((a, b) => a.c.atSec - b.c.atSec || a.i - b.i)
  for (const { c } of changes) {
    const ch = c.change
    if (ch.kind === 'set_service') {
      const s = model.services.find((x) => x.id === ch.service)
      if (s) assignAllowed(s, ch.patch, SERVICE_PATCH_KEYS)
    } else if (ch.kind === 'set_call') {
      const e = model.calls.find((x) => x.from === ch.from && x.to === ch.to)
      if (e) assignAllowed(e, ch.patch, CALL_PATCH_KEYS)
    } else if (ch.kind === 'set_rate_limit') model.rateLimitRps = ch.rps
    else if (ch.kind === 'set_client_retry') model.clientRetry = { ...ch.retry }
  }
  return model
}

/** Deployment changes attributed to `service` (directly or via deployService). */
export function deploymentsOf(scenario: SimScenario, service: string): ScheduledChange[] {
  return scenario.timeline.filter(
    (c) => c.deploymentId && c.change.kind === 'set_service' && (c.deployService ?? c.change.service) === service,
  )
}

export function describeIntervention(iv: Intervention): string {
  switch (iv.kind) {
    case 'rollback_deployment': return `Roll back the deployment on ${iv.service}`
    case 'scale_capacity': return `Scale ${iv.service} to ${iv.capacity} workers`
    case 'db_pool': return `Resize the ${iv.service} connection pool to ${iv.capacity}`
    case 'circuit_breaker': return `${iv.enabled ? 'Enable' : 'Disable'} circuit breakers in ${iv.service}${iv.enabled && iv.failureRateThreshold ? ` (open at ${Math.round(iv.failureRateThreshold * 100)}% failures)` : ''}`
    case 'rate_limit': return iv.rps === null ? 'Remove the entry rate limit' : `Rate limit the entry to ${iv.rps} rps`
    case 'retry_policy': return `Set ${iv.service === 'client' ? 'client' : iv.service} retries to ${iv.maxAttempts} attempt(s), ${iv.backoffMs} ms backoff`
    case 'isolate_dependency': return `Isolate ${iv.to} from ${iv.from}`
    case 'recover_service': return `Recover ${iv.service}`
  }
}

/**
 * Creates a counterfactual branch: identical to `scenario` before `atSec`,
 * with the interventions applied at `atSec`. The original scenario object is
 * never mutated (the recorded timeline stays immutable).
 */
export function branchScenario(scenario: SimScenario, atSec: number, interventions: Intervention[], branchId?: string): {
  scenario: SimScenario
  assumptions: string[]
} {
  if (!(atSec >= 0 && atSec <= scenario.durationSec)) throw new RangeError(`Branch point ${atSec}s is outside the scenario (0..${scenario.durationSec}s).`)
  const before = modelAt(scenario, atSec)
  const svc = (id: string): ServiceModel => {
    const s = before.services.find((x) => x.id === id)
    if (!s) throw new Error(`Unknown service "${id}" in intervention.`)
    return s
  }
  let timeline = scenario.timeline.slice()
  const added: ScheduledChange[] = []
  const assumptions: string[] = []
  const at = (change: ScheduledChange['change'], label: string) => added.push({ atSec, change, label, origin: 'intervention' })

  for (const iv of interventions) {
    switch (iv.kind) {
      case 'rollback_deployment': {
        const deploys = deploymentsOf(scenario, iv.service)
        if (deploys.length === 0) throw new Error(`No deployment on ${iv.service} to roll back.`)
        const past = deploys.filter((d) => d.atSec < atSec)
        const future = deploys.filter((d) => d.atSec >= atSec)
        // Future deploys of this service never happen in the branch.
        timeline = timeline.filter((c) => !future.includes(c))
        if (past.length) {
          const lastId = past[past.length - 1].deploymentId
          const lastAt = Math.min(...past.filter((d) => d.deploymentId === lastId).map((d) => d.atSec))
          const pre = modelAt(scenario, lastAt)
          for (const part of past.filter((d) => d.deploymentId === lastId)) {
            if (part.change.kind !== 'set_service') continue
            const target = part.change.service
            const preSvc = pre.services.find((s) => s.id === target)!
            const patch: Record<string, unknown> = {}
            for (const key of Object.keys(part.change.patch)) patch[key] = (preSvc as unknown as Record<string, unknown>)[key]
            at({ kind: 'set_service', service: target, patch }, `Rollback ${lastId} on ${iv.service}`)
            assumptions.push(`Rollback of ${lastId} restores ${Object.keys(patch).join(', ')} on ${target} to pre-deployment values instantly (no rollout time modeled).`)
          }
        } else {
          assumptions.push(`The ${iv.service} deployment had not happened at ${atSec}s, so the branch never deploys it.`)
        }
        break
      }
      case 'scale_capacity':
        if (!(iv.capacity >= 1 && iv.capacity <= 10_000)) throw new RangeError('Capacity must be within [1, 10000].')
        at({ kind: 'set_service', service: iv.service, patch: { capacity: Math.round(iv.capacity) } }, describeIntervention(iv))
        assumptions.push(`New ${iv.service} capacity is available immediately (no warm-up). Was ${svc(iv.service).capacity}.`)
        break
      case 'db_pool':
        if (!(iv.capacity >= 1 && iv.capacity <= 10_000)) throw new RangeError('Pool size must be within [1, 10000].')
        at({ kind: 'set_service', service: iv.service, patch: { capacity: Math.round(iv.capacity) } }, describeIntervention(iv))
        assumptions.push(`${iv.service} can actually serve ${iv.capacity} concurrent connections (was ${svc(iv.service).capacity}); its queries still slow down as it gets busier.`)
        break
      case 'circuit_breaker': {
        const cur = svc(iv.service).circuitBreaker
        at({
          kind: 'set_service',
          service: iv.service,
          patch: { circuitBreaker: { ...cur, enabled: iv.enabled, failureRateThreshold: iv.failureRateThreshold ?? cur.failureRateThreshold, openMs: iv.openMs ?? cur.openMs } },
        }, describeIntervention(iv))
        assumptions.push(`Breakers in ${iv.service} fail fast while open; requests that needed the dependency fail unless it is optional.`)
        break
      }
      case 'rate_limit':
        at({ kind: 'set_rate_limit', rps: iv.rps }, describeIntervention(iv))
        assumptions.push('Rate-limited requests are rejected immediately and counted as failures (shed load), not silently dropped.')
        break
      case 'retry_policy': {
        const retry = { maxAttempts: iv.maxAttempts, backoffMs: iv.backoffMs, backoffMultiplier: 2, jitter: iv.jitter ?? 0.2 }
        if (iv.service === 'client') at({ kind: 'set_client_retry', retry }, describeIntervention(iv))
        else at({ kind: 'set_service', service: iv.service, patch: { retry } }, describeIntervention(iv))
        assumptions.push('Retry backoff is exponential (x2) with the stated jitter.')
        break
      }
      case 'isolate_dependency':
        if (!before.calls.some((c) => c.from === iv.from && c.to === iv.to)) throw new Error(`${iv.from} does not call ${iv.to}.`)
        at({ kind: 'set_call', from: iv.from, to: iv.to, patch: { enabled: false } }, describeIntervention(iv))
        assumptions.push(`${iv.from} serves requests without ${iv.to} (e.g. cached or default data); the reduced response quality is not scored.`)
        break
      case 'recover_service': {
        const base = scenario.model.services.find((s) => s.id === iv.service)
        if (!base) throw new Error(`Unknown service "${iv.service}".`)
        at({
          kind: 'set_service',
          service: iv.service,
          patch: { available: true, errorRate: base.errorRate, latencyMultiplier: base.latencyMultiplier, capacity: Math.max(base.capacity, svc(iv.service).capacity) },
        }, describeIntervention(iv))
        assumptions.push(`${iv.service} returns to baseline behavior instantly.`)
        break
      }
    }
  }
  return {
    scenario: {
      ...scenario,
      id: branchId ?? `${scenario.id}~branch@${atSec}`,
      timeline: [...timeline, ...added],
    },
    assumptions,
  }
}

export interface MetricDelta {
  metric: string
  baseline: number | null
  branch: number | null
  /** branch - baseline */
  delta: number | null
  /** Whether lower is better for this metric. */
  lowerIsBetter: boolean
  verdict: 'better' | 'worse' | 'same' | 'n/a'
}

export interface Comparison {
  deltas: MetricDelta[]
  overall: 'better' | 'worse' | 'mixed' | 'same'
  /** True when every sample before the branch point is identical in both runs. */
  prefixIdentical: boolean
}

function delta(metric: string, a: number | null, b: number | null, lowerIsBetter: boolean, tolerance: number): MetricDelta {
  if (a === null || b === null) return { metric, baseline: a, branch: b, delta: null, lowerIsBetter, verdict: 'n/a' }
  const d = Math.round((b - a) * 10_000) / 10_000
  const verdict = Math.abs(d) <= tolerance ? 'same' : (d < 0) === lowerIsBetter ? 'better' : 'worse'
  return { metric, baseline: a, branch: b, delta: d, lowerIsBetter, verdict }
}

export function compareRuns(baseline: RunResult, branch: RunResult, branchAtSec: number): Comparison {
  const a: RunSummary = baseline.summary
  const b: RunSummary = branch.summary
  const ttr = (s: RunSummary) => (s.onsetSec === null ? 0 : s.recovered ? s.timeToRecoverySec : null)
  const deltas: MetricDelta[] = [
    delta('Success rate', a.successRate, b.successRate, false, 0.001),
    delta('Failed requests', a.failed + a.rateLimited, b.failed + b.rateLimited, true, 0),
    delta('p95 latency (ms)', a.latency.p95, b.latency.p95, true, 1),
    delta('p99 latency (ms)', a.latency.p99, b.latency.p99, true, 1),
    delta('Peak error rate', a.peakErrorRate, b.peakErrorRate, true, 0.001),
    delta('Time to recovery (s)', ttr(a), ttr(b), true, 0),
    delta('Retries', a.retries, b.retries, true, 0),
    delta('Affected services', a.affectedServices.length, b.affectedServices.length, true, 0),
  ]
  const core = deltas.filter((d) => ['Success rate', 'Failed requests', 'p95 latency (ms)', 'Peak error rate'].includes(d.metric))
  const better = core.filter((d) => d.verdict === 'better').length
  const worse = core.filter((d) => d.verdict === 'worse').length
  const overall = better && !worse ? 'better' : worse && !better ? 'worse' : better || worse ? 'mixed' : 'same'
  // Strictly before: a change at the branch instant may already alter the
  // sample taken at that same instant (e.g. new capacity admits queued work).
  const pre = (r: RunResult) => r.samples.filter((s) => s.t < branchAtSec)
  const pa = pre(baseline)
  const pb = pre(branch)
  const prefixIdentical = pa.length === pb.length && JSON.stringify(pa) === JSON.stringify(pb)
  return { deltas, overall, prefixIdentical }
}
