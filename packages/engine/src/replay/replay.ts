import type { CanonicalEvent, EventType } from '../types'
import { SEVERITY_RANK } from '../types'
import { compareEvents, mergeEvents } from '../normalize/normalize'

export type Health = 'healthy' | 'degraded' | 'failing' | 'recovering'

/** Accumulated, time-independent facts about one service. */
export interface ServiceAccumulator {
  totalEvents: number
  totalErrors: number
  totalWarnings: number
  /** Most recent error timestamps (bounded ring, ascending). */
  recentErrors: number[]
  lastEventTs: number | null
  lastErrorTs: number | null
  lastWarnTs: number | null
  lastCriticalTs: number | null
  lastRecoveryTs: number | null
  deploymentId: string | null
  lastDeployTs: number | null
  circuitOpen: boolean
}

export interface ServiceState extends ServiceAccumulator {
  health: Health
  /** Errors inside the health window ending at the query time. */
  errorsInWindow: number
}

export interface ReplayState {
  /** Query time (UTC ms). */
  t: number
  /** Number of events applied (events[0..index) have ts <= t). */
  index: number
  services: Record<string, ServiceState>
  activeAlerts: string[]
  firstErrorTs: number | null
}

interface Accumulated {
  index: number
  services: Record<string, ServiceAccumulator>
  activeAlerts: string[]
  firstErrorTs: number | null
}

export interface ReplayOptions {
  /** Store a checkpoint every N events. */
  snapshotInterval: number
  /** Health window for counting recent errors. */
  windowMs: number
  /** Errors within the window that make a service `failing`. */
  failingThreshold: number
  /** After the last error, a service is `recovering` for this long. */
  recoveringMs: number
}

export const DEFAULT_REPLAY_OPTIONS: ReplayOptions = {
  snapshotInterval: 256,
  windowMs: 30_000,
  failingThreshold: 3,
  recoveringMs: 90_000,
}

/** Recent error timestamps kept per service (bounds memory; caps errorsInWindow). */
export const ERROR_RING = 256
const RING = ERROR_RING

/** Always keyframes: changes, alerts, and recoveries. */
const IMPORTANT_TYPES = new Set<EventType>(['deploy', 'rollback', 'config_change', 'alert', 'scale', 'recovery'])
/** Keyframes only on their first occurrence per service within KEYFRAME_COOLDOWN_MS. */
const BURSTY_TYPES = new Set<EventType>(['saturation', 'queue_full', 'circuit_open', 'circuit_close'])
const KEYFRAME_COOLDOWN_MS = 60_000

function emptyAccumulator(): ServiceAccumulator {
  return {
    totalEvents: 0,
    totalErrors: 0,
    totalWarnings: 0,
    recentErrors: [],
    lastEventTs: null,
    lastErrorTs: null,
    lastWarnTs: null,
    lastCriticalTs: null,
    lastRecoveryTs: null,
    deploymentId: null,
    lastDeployTs: null,
    circuitOpen: false,
  }
}

function cloneAccumulated(a: Accumulated): Accumulated {
  const services: Record<string, ServiceAccumulator> = {}
  for (const [k, v] of Object.entries(a.services)) services[k] = { ...v, recentErrors: v.recentErrors.slice() }
  return { index: a.index, services, activeAlerts: a.activeAlerts.slice(), firstErrorTs: a.firstErrorTs }
}

/** The pure reducer: applies exactly one event. Mutates `acc` (callers clone). */
export function applyEvent(acc: Accumulated, e: CanonicalEvent): void {
  const s = (acc.services[e.service] ??= emptyAccumulator())
  s.totalEvents++
  s.lastEventTs = e.ts
  const rank = SEVERITY_RANK[e.severity]
  if (rank >= 3) {
    s.totalErrors++
    s.lastErrorTs = e.ts
    s.recentErrors.push(e.ts)
    if (s.recentErrors.length > RING) s.recentErrors.shift()
    if (acc.firstErrorTs === null) acc.firstErrorTs = e.ts
  } else if (rank === 2) {
    s.totalWarnings++
    s.lastWarnTs = e.ts
  }
  if (rank >= 4) s.lastCriticalTs = e.ts
  switch (e.type) {
    case 'deploy':
    case 'rollback':
      s.lastDeployTs = e.ts
      if (e.deploymentId) s.deploymentId = e.deploymentId
      if (e.type === 'rollback') s.lastRecoveryTs = null
      break
    case 'circuit_open':
      s.circuitOpen = true
      break
    case 'circuit_close':
      s.circuitOpen = false
      break
    case 'recovery':
      s.lastRecoveryTs = e.ts
      s.circuitOpen = false
      s.recentErrors = []
      break
    case 'alert':
      if (!acc.activeAlerts.includes(e.id)) acc.activeAlerts.push(e.id)
      break
    default:
      break
  }
  if (e.type === 'recovery' && /resolved|all clear/i.test(e.message)) acc.activeAlerts = []
  acc.index++
}

/** Time-dependent health derivation. Pure function of (accumulator, t). */
export function deriveHealth(s: ServiceAccumulator, t: number, o: ReplayOptions): { health: Health; errorsInWindow: number } {
  let errorsInWindow = 0
  for (let i = s.recentErrors.length - 1; i >= 0; i--) {
    if (s.recentErrors[i] > t - o.windowMs) errorsInWindow++
    else break
  }
  if (s.lastRecoveryTs !== null && (s.lastErrorTs === null || s.lastRecoveryTs >= s.lastErrorTs)) {
    return { health: t - s.lastRecoveryTs < o.windowMs ? 'recovering' : 'healthy', errorsInWindow }
  }
  if (errorsInWindow >= o.failingThreshold || (s.lastCriticalTs !== null && t - s.lastCriticalTs < o.windowMs)) {
    return { health: 'failing', errorsInWindow }
  }
  if (errorsInWindow > 0 || s.circuitOpen || (s.lastWarnTs !== null && t - s.lastWarnTs < o.windowMs)) {
    return { health: 'degraded', errorsInWindow }
  }
  if (s.lastErrorTs !== null && t - s.lastErrorTs < o.recoveringMs) return { health: 'recovering', errorsInWindow }
  return { health: 'healthy', errorsInWindow }
}

export interface Keyframe {
  index: number
  ts: number
  eventId: string
  service: string
  reason: string
}

/**
 * Deterministic incident replay over an immutable, canonically ordered event
 * set. Seeking is O(log n) to locate the position plus at most
 * `snapshotInterval` reducer steps from the nearest checkpoint.
 */
export class ReplayEngine {
  readonly events: readonly CanonicalEvent[]
  readonly serviceIds: readonly string[]
  readonly options: ReplayOptions
  readonly start: number
  readonly end: number
  readonly keyframes: readonly Keyframe[]
  private readonly timestamps: Float64Array
  private readonly snapshots: Accumulated[] = []

  constructor(events: readonly CanonicalEvent[], serviceIds: readonly string[] = [], options: Partial<ReplayOptions> = {}) {
    this.options = { ...DEFAULT_REPLAY_OPTIONS, ...options }
    // Defensive: replay must never depend on input order.
    const sorted = events.slice().sort(compareEvents)
    this.events = sorted
    this.timestamps = Float64Array.from(sorted.map((e) => e.ts))
    this.serviceIds = Array.from(new Set([...serviceIds, ...sorted.map((e) => e.service)])).sort()
    this.start = sorted.length ? sorted[0].ts : 0
    this.end = sorted.length ? sorted[sorted.length - 1].ts : 0

    const acc: Accumulated = { index: 0, services: {}, activeAlerts: [], firstErrorTs: null }
    const keyframes: Keyframe[] = []
    const firstErrorSeen = new Set<string>()
    const lastBurst = new Map<string, number>()
    this.snapshots.push(cloneAccumulated(acc))
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i]
      let reason: string | null = null
      if (IMPORTANT_TYPES.has(e.type)) reason = e.type.replace('_', ' ')
      else if (BURSTY_TYPES.has(e.type)) {
        const key = `${e.service}|${e.type}`
        const prev = lastBurst.get(key)
        if (prev === undefined || e.ts - prev > KEYFRAME_COOLDOWN_MS) reason = e.type.replace('_', ' ')
        lastBurst.set(key, e.ts)
      } else if (SEVERITY_RANK[e.severity] >= 3 && !firstErrorSeen.has(e.service)) reason = `first error in ${e.service}`
      if (SEVERITY_RANK[e.severity] >= 3) firstErrorSeen.add(e.service)
      if (reason) keyframes.push({ index: i, ts: e.ts, eventId: e.id, service: e.service, reason })
      applyEvent(acc, e)
      if ((i + 1) % this.options.snapshotInterval === 0) this.snapshots.push(cloneAccumulated(acc))
    }
    this.keyframes = keyframes
  }

  get length(): number {
    return this.events.length
  }

  /** Number of events with ts <= t (upper bound). */
  indexAt(t: number): number {
    let lo = 0
    let hi = this.timestamps.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.timestamps[mid] <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Accumulated state after applying the first `index` events. */
  private accumulatedAt(index: number): Accumulated {
    const i = Math.max(0, Math.min(index, this.events.length))
    const snapIdx = Math.floor(i / this.options.snapshotInterval)
    const acc = cloneAccumulated(this.snapshots[Math.min(snapIdx, this.snapshots.length - 1)])
    for (let k = acc.index; k < i; k++) applyEvent(acc, this.events[k])
    return acc
  }

  stateAt(t: number): ReplayState {
    return this.materialize(this.accumulatedAt(this.indexAt(t)), t)
  }

  /** State immediately after event `index - 1` was applied, evaluated at its timestamp. */
  stateAtIndex(index: number): ReplayState {
    const i = Math.max(0, Math.min(index, this.events.length))
    const t = i === 0 ? this.start : this.events[i - 1].ts
    return this.materialize(this.accumulatedAt(i), t)
  }

  /** Reference implementation without checkpoints (used to prove snapshot equivalence). */
  stateAtFullReplay(t: number): ReplayState {
    const acc: Accumulated = { index: 0, services: {}, activeAlerts: [], firstErrorTs: null }
    const n = this.indexAt(t)
    for (let k = 0; k < n; k++) applyEvent(acc, this.events[k])
    return this.materialize(acc, t)
  }

  private materialize(acc: Accumulated, t: number): ReplayState {
    const services: Record<string, ServiceState> = {}
    for (const id of this.serviceIds) {
      const a = acc.services[id] ?? emptyAccumulator()
      services[id] = { ...a, recentErrors: a.recentErrors.slice(), ...deriveHealth(a, t, this.options) }
    }
    return { t, index: acc.index, services, activeAlerts: acc.activeAlerts.slice(), firstErrorTs: acc.firstErrorTs }
  }

  nextKeyframe(t: number): Keyframe | undefined {
    return this.keyframes.find((k) => k.ts > t)
  }

  prevKeyframe(t: number): Keyframe | undefined {
    for (let i = this.keyframes.length - 1; i >= 0; i--) if (this.keyframes[i].ts < t) return this.keyframes[i]
    return undefined
  }

  /** Timestamp of the event after/before the current position, for single-stepping. */
  stepForward(t: number): number {
    const i = this.indexAt(t)
    return i < this.events.length ? this.events[i].ts : this.end
  }

  stepBackward(t: number): number {
    const i = this.indexAt(t)
    // events[i-1] is at or before t; step to the distinct timestamp before it.
    for (let k = i - 1; k >= 0; k--) if (this.events[k].ts < t) return this.events[k].ts
    return this.start
  }

  /** Per-service event density for swimlanes: counts per bucket by severity class. */
  buckets(bucketMs: number): { start: number; bucketMs: number; series: Record<string, Array<{ errors: number; warnings: number; total: number }>> } {
    const n = Math.max(1, Math.ceil((this.end - this.start + 1) / bucketMs))
    const series: Record<string, Array<{ errors: number; warnings: number; total: number }>> = {}
    for (const id of this.serviceIds) series[id] = Array.from({ length: n }, () => ({ errors: 0, warnings: 0, total: 0 }))
    for (const e of this.events) {
      const b = Math.min(n - 1, Math.floor((e.ts - this.start) / bucketMs))
      const cell = series[e.service][b]
      cell.total++
      const r = SEVERITY_RANK[e.severity]
      if (r >= 3) cell.errors++
      else if (r === 2) cell.warnings++
    }
    return { start: this.start, bucketMs, series }
  }

  /** Returns a NEW engine including late-arriving events (this one is unchanged). */
  withEvents(incoming: readonly CanonicalEvent[]): ReplayEngine {
    return new ReplayEngine(mergeEvents(this.events, incoming).events, this.serviceIds, this.options)
  }
}
