import type { ServiceDef } from '../types'

export interface RetryPolicy {
  /** Total attempts including the first (1 = no retries). */
  maxAttempts: number
  backoffMs: number
  backoffMultiplier: number
  /** Fractional jitter in [0, 1]: delay is scaled by (1 ± jitter). */
  jitter: number
}

export interface CircuitBreakerPolicy {
  enabled: boolean
  /** Open when failures / total within the window reach this ratio. */
  failureRateThreshold: number
  /** Minimum calls in the window before the breaker may open. */
  minRequests: number
  windowMs: number
  /** How long the breaker stays open before a half-open probe. */
  openMs: number
}

export interface ServiceModel {
  id: string
  kind: ServiceDef['kind']
  /** Concurrent workers. For databases this is the connection pool size. */
  capacity: number
  /** Waiting requests allowed beyond capacity; arrivals beyond it are rejected. */
  queueCapacity: number
  /** Mean local processing time (lognormal). */
  serviceTimeMs: number
  serviceTimeCv: number
  /** Intrinsic probability that local processing fails (e.g. a bad deploy). */
  errorRate: number
  /** Multiplier on local processing time (e.g. a slow deploy, GC pressure). */
  latencyMultiplier: number
  /** False = the service refuses every call (outage). */
  available: boolean
  /** Timeout this service applies to each downstream call it makes. */
  timeoutMs: number
  /** Policy this service uses when a downstream call fails. */
  retry: RetryPolicy
  /** Caller-side breaker this service keeps per downstream dependency. */
  circuitBreaker: CircuitBreakerPolicy
  /**
   * Latency growth under load (databases): service time is multiplied by
   * 1 + contention * max(0, utilization - 0.7) / 0.3 at the moment work starts.
   */
  contention: number
  /** Optional deployment label shown in timelines. */
  version?: string
}

export interface CallEdge {
  from: string
  to: string
  /** Optional dependencies degrade instead of failing the caller. */
  optional?: boolean
  /** Disabled edges are skipped entirely (dependency isolation). */
  enabled?: boolean
}

export interface TrafficSegment {
  /** Segment start, seconds from simulation start. */
  atSec: number
  rps: number
}

export interface SimModel {
  services: ServiceModel[]
  calls: CallEdge[]
  /** Service that receives client traffic. */
  entry: string
  traffic: TrafficSegment[]
  clientTimeoutMs: number
  clientRetry: RetryPolicy
  /** Token-bucket admission at the entry; null = unlimited. */
  rateLimitRps: number | null
  /** One-way network latency per hop. */
  networkMs: number
}

export type ModelChange =
  | { kind: 'set_service'; service: string; patch: Partial<Omit<ServiceModel, 'id' | 'kind'>> }
  | { kind: 'set_call'; from: string; to: string; patch: Partial<Pick<CallEdge, 'optional' | 'enabled'>> }
  | { kind: 'set_traffic'; rps: number }
  | { kind: 'set_rate_limit'; rps: number | null }
  | { kind: 'set_client_retry'; retry: RetryPolicy }

export interface ScheduledChange {
  atSec: number
  change: ModelChange
  label: string
  origin: 'scenario' | 'intervention'
  /** Deployment changes carry an id so a rollback intervention can invert them. */
  deploymentId?: string
  /**
   * The service being deployed, when it differs from the service whose
   * parameters change (e.g. a pricing deploy that makes pricing-db queries
   * slower). A deployment may consist of several changes sharing one id.
   */
  deployService?: string
  /** How the change appears in generated telemetry. */
  category?: 'deploy' | 'rollback' | 'config_change' | 'scale' | 'outage' | 'recovery' | 'traffic'
}

export interface SimScenario {
  id: string
  name: string
  model: SimModel
  timeline: ScheduledChange[]
  durationSec: number
  seed: number
  /** Metrics sampling interval. */
  sampleMs: number
}

export const NO_RETRY: RetryPolicy = { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1, jitter: 0 }
export const BREAKER_OFF: CircuitBreakerPolicy = { enabled: false, failureRateThreshold: 0.5, minRequests: 20, windowMs: 10_000, openMs: 5_000 }

export function service(id: string, kind: ServiceDef['kind'], overrides: Partial<ServiceModel> = {}): ServiceModel {
  return {
    id,
    kind,
    capacity: kind === 'database' ? 40 : 64,
    queueCapacity: kind === 'database' ? 200 : 256,
    serviceTimeMs: kind === 'database' ? 8 : 12,
    serviceTimeCv: 0.5,
    errorRate: 0,
    latencyMultiplier: 1,
    available: true,
    timeoutMs: 1_000,
    retry: { ...NO_RETRY },
    circuitBreaker: { ...BREAKER_OFF },
    contention: kind === 'database' ? 2 : 0,
    ...overrides,
  }
}

export function cloneModel(m: SimModel): SimModel {
  return JSON.parse(JSON.stringify(m)) as SimModel
}

/** Structural validation; returns human-readable problems (empty = valid). */
export function validateModel(m: SimModel, durationSec?: number): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const s of m.services) {
    if (ids.has(s.id)) problems.push(`Duplicate service id "${s.id}".`)
    ids.add(s.id)
    if (!(s.capacity >= 1)) problems.push(`${s.id}: capacity must be >= 1.`)
    if (!(s.queueCapacity >= 0)) problems.push(`${s.id}: queue capacity must be >= 0.`)
    if (!(s.serviceTimeMs > 0)) problems.push(`${s.id}: service time must be > 0.`)
    if (!(s.errorRate >= 0 && s.errorRate <= 1)) problems.push(`${s.id}: error rate must be within [0, 1].`)
    if (!(s.timeoutMs > 0)) problems.push(`${s.id}: timeout must be > 0.`)
    if (!(s.retry.maxAttempts >= 1 && s.retry.maxAttempts <= 10)) problems.push(`${s.id}: retry attempts must be within [1, 10].`)
  }
  if (!ids.has(m.entry)) problems.push(`Entry service "${m.entry}" does not exist.`)
  for (const c of m.calls) {
    if (!ids.has(c.from) || !ids.has(c.to)) problems.push(`Call ${c.from} -> ${c.to} references an unknown service.`)
    if (c.from === c.to) problems.push(`Call ${c.from} -> ${c.to} is a self-call.`)
  }
  // Synchronous call graphs must be acyclic or a request would recurse forever.
  const adj = new Map<string, string[]>()
  for (const c of m.calls) (adj.get(c.from) ?? adj.set(c.from, []).get(c.from)!).push(c.to)
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return true
    if (state.get(n) === 2) return false
    state.set(n, 1)
    for (const next of adj.get(n) ?? []) if (visit(next)) return true
    state.set(n, 2)
    return false
  }
  for (const id of ids) if (visit(id)) { problems.push('The call graph contains a cycle; synchronous calls must form a DAG.'); break }
  if (m.traffic.length === 0) problems.push('At least one traffic segment is required.')
  for (const t of m.traffic) if (!(t.rps >= 0 && t.rps <= 2_000)) problems.push(`Traffic of ${t.rps} rps is outside [0, 2000].`)
  if (durationSec !== undefined && !(durationSec > 0 && durationSec <= 3_600)) problems.push('Duration must be within (0, 3600] seconds.')
  return problems
}
