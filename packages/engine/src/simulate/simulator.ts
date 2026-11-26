import { cyrb53 } from '../util/hash'
import { Rng } from '../util/rng'
import { EventHeap, type Scheduled } from './heap'
import { assignAllowed, CALL_PATCH_KEYS, SERVICE_PATCH_KEYS } from '../util/safe'
import {
  cloneModel,
  validateModel,
  type CallEdge,
  type ModelChange,
  type RetryPolicy,
  type ScheduledChange,
  type ServiceModel,
  type SimScenario,
} from './model'

export const SIMULATOR_VERSION = 'faultline-des/1.0.0'

/* ------------------------------------------------------------------ outputs */

export interface ServiceSample {
  busy: number
  queue: number
  completed: number
  failed: number
}

export interface Sample {
  /** Seconds from simulation start (end of the interval). */
  t: number
  requests: number
  succeeded: number
  failed: number
  rateLimited: number
  errorRate: number
  p50: number | null
  p95: number | null
  retries: number
  timeouts: number
  services: Record<string, ServiceSample>
}

export interface ServiceSummary {
  calls: number
  failed: number
  rejectedQueueFull: number
  peakBusy: number
  peakQueue: number
  failureRatio: number
  /** Ever exceeded the affected threshold in some interval. */
  affected: boolean
}

export interface RunSummary {
  requests: number
  succeeded: number
  failed: number
  rateLimited: number
  successRate: number
  errorRate: number
  latency: { p50: number | null; p90: number | null; p95: number | null; p99: number | null; mean: number | null }
  latencyHistogram: Array<{ upToMs: number; count: number }>
  peakErrorRate: number
  peakAtSec: number | null
  /** Seconds from failure onset to sustained recovery; null if no onset. */
  timeToRecoverySec: number | null
  recovered: boolean | null
  onsetSec: number | null
  retries: number
  timeouts: number
  circuitOpens: number
  affectedServices: string[]
  services: Record<string, ServiceSummary>
}

export type TelemetryKind =
  | 'call_failed'
  | 'timeout'
  | 'retry'
  | 'queue_full'
  | 'circuit_open'
  | 'circuit_close'
  | 'change'
  | 'rate_limited'
  | 'request_ok'

export interface TelemetryEvent {
  kind: TelemetryKind
  /** Absolute simulation time in ms from start. */
  t: number
  service: string
  caller?: string
  reason?: string
  traceId?: string
  spanId?: string
  parentSpanId?: string
  requestId?: string
  latencyMs?: number
  attempt?: number
  label?: string
  change?: ScheduledChange
}

export interface RunResult {
  scenarioId: string
  seed: number
  durationSec: number
  samples: Sample[]
  summary: RunSummary
  appliedChanges: ScheduledChange[]
  eventsProcessed: number
  truncated: boolean
  simulatorVersion: string
}

export interface RunOptions {
  /** Hard cap on scheduler events (safety valve). */
  maxEvents?: number
  onTelemetry?: (e: TelemetryEvent) => void
  /** Error rate above which an interval counts as failing (TTR, onset). */
  failureThreshold?: number
  /** Consecutive healthy seconds required to call recovery sustained. */
  recoveryWindowSec?: number
}

/* ------------------------------------------------------------------ internals */

const CLIENT = -1

const K = {
  Arrival: 0,
  CallArrive: 1,
  LocalDone: 2,
  Response: 3,
  Timeout: 4,
  Retry: 5,
  ClientTimeout: 6,
  ClientRetry: 7,
  Change: 8,
  Sample: 9,
} as const
type K = (typeof K)[keyof typeof K]

interface Ev extends Scheduled {
  k: K
  a: number
  b: number
  c: number
  ok?: boolean
  reason?: string
}

interface Call {
  id: number
  service: string
  parent: number
  requestId: number
  depIdx: number
  attempt: number
  settled: boolean
  finished: boolean
  started: boolean
  spanId: string
  parentSpanId?: string
  /** Per-call pending dependency index / attempt while waiting on a child. */
  pendingChild: number
}

interface ClientRequest {
  id: number
  start: number
  attempt: number
  settled: boolean
  currentCall: number
  traceId: string
}

interface Breaker {
  windowStart: number
  total: number
  failures: number
  openUntil: number
  open: boolean
  probing: boolean
}

interface ServiceRuntime {
  m: ServiceModel
  busy: number
  queue: number[]
  queueHead: number
  deps: CallEdge[]
  // interval counters
  iCompleted: number
  iFailed: number
  // totals
  calls: number
  failed: number
  rejected: number
  peakBusy: number
  peakQueue: number
  affected: boolean
}

function hexId(seed: number, n: number, bytes: number): string {
  let out = ''
  let i = 0
  while (out.length < bytes * 2) out += cyrb53(`${seed}:${n}:${i++}`).toString(16).padStart(14, '0')
  return out.slice(0, bytes * 2)
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return Math.round(sorted[idx] * 10) / 10
}

function backoff(policy: RetryPolicy, attempt: number, rng: Rng): number {
  const base = policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt - 1)
  if (policy.jitter <= 0) return base
  return base * (1 - policy.jitter + 2 * policy.jitter * rng.next())
}

/**
 * Runs a scenario to completion. Pure: the same scenario (including seed)
 * always yields a deep-equal RunResult.
 */
export function runSimulation(scenario: SimScenario, options: RunOptions = {}): RunResult {
  const problems = validateModel(scenario.model, scenario.durationSec)
  if (problems.length) throw new Error(`Invalid simulation model: ${problems.join(' ')}`)

  const maxEvents = options.maxEvents ?? 4_000_000
  const failureThreshold = options.failureThreshold ?? 0.05
  const recoveryWindowSec = options.recoveryWindowSec ?? 30
  const tele = options.onTelemetry
  const model = cloneModel(scenario.model)
  const rng = new Rng(scenario.seed)
  const endMs = scenario.durationSec * 1000
  const net = model.networkMs

  const heap = new EventHeap<Ev>()
  let seq = 0
  const schedule = (t: number, k: K, a = 0, b = 0, c = 0, ok?: boolean, reason?: string) =>
    heap.push({ t, seq: seq++, k, a, b, c, ok, reason })

  const services = new Map<string, ServiceRuntime>()
  const rebuildDeps = () => {
    for (const rt of services.values()) rt.deps = model.calls.filter((c) => c.from === rt.m.id && c.enabled !== false)
  }
  for (const m of model.services) {
    services.set(m.id, {
      m, busy: 0, queue: [], queueHead: 0, deps: [],
      iCompleted: 0, iFailed: 0, calls: 0, failed: 0, rejected: 0, peakBusy: 0, peakQueue: 0, affected: false,
    })
  }
  rebuildDeps()

  const calls = new Map<number, Call>()
  const requests = new Map<number, ClientRequest>()
  const breakers = new Map<string, Breaker>()
  let nextCallId = 1
  let nextRequestId = 1

  // interval + total counters
  let iReq = 0, iOk = 0, iFail = 0, iLimited = 0, iRetries = 0, iTimeouts = 0
  let iLatencies: number[] = []
  const allLatencies: number[] = []
  let totReq = 0, totOk = 0, totFail = 0, totLimited = 0, totRetries = 0, totTimeouts = 0, circuitOpens = 0
  const samples: Sample[] = []
  const applied: ScheduledChange[] = []

  // token bucket at the entry
  let tokens = model.rateLimitRps ?? 0
  let tokensAt = 0
  let trafficOverride: number | null = null

  const currentRps = (tMs: number): number => {
    if (trafficOverride !== null) return trafficOverride
    let rps = 0
    for (const seg of model.traffic) if (seg.atSec * 1000 <= tMs) rps = seg.rps
    return rps
  }

  const nextSegmentStart = (tMs: number): number | null => {
    let best: number | null = null
    for (const seg of model.traffic) {
      const s = seg.atSec * 1000
      if (s > tMs && (best === null || s < best)) best = s
    }
    return best
  }

  const scheduleArrival = (now: number) => {
    const rps = currentRps(now)
    if (rps > 0) {
      schedule(now + rng.exponential(1000 / rps), K.Arrival)
    } else {
      const next = nextSegmentStart(now)
      if (next !== null) schedule(next, K.Arrival, 1)
    }
  }

  /* ---------------------------------------------------------------- breaker */

  const breakerFor = (from: string, to: string): Breaker => {
    const key = `${from}>${to}`
    let b = breakers.get(key)
    if (!b) {
      b = { windowStart: 0, total: 0, failures: 0, openUntil: 0, open: false, probing: false }
      breakers.set(key, b)
    }
    return b
  }

  const recordBreaker = (now: number, from: string, to: string, ok: boolean) => {
    const policy = services.get(from)!.m.circuitBreaker
    if (!policy.enabled) return
    const b = breakerFor(from, to)
    if (b.open) {
      if (b.probing) {
        b.probing = false
        if (ok) {
          b.open = false
          b.total = 0
          b.failures = 0
          b.windowStart = now
          tele?.({ kind: 'circuit_close', t: now, service: from, caller: from, reason: `breaker to ${to} closed after a successful probe` })
        } else {
          b.openUntil = now + policy.openMs
        }
      }
      return
    }
    if (now - b.windowStart > policy.windowMs) {
      b.windowStart = now
      b.total = 0
      b.failures = 0
    }
    b.total++
    if (!ok) b.failures++
    if (b.total >= policy.minRequests && b.failures / b.total >= policy.failureRateThreshold) {
      b.open = true
      b.openUntil = now + policy.openMs
      circuitOpens++
      tele?.({ kind: 'circuit_open', t: now, service: from, caller: from, reason: `breaker to ${to} opened at ${Math.round((b.failures / b.total) * 100)}% failures` })
    }
  }

  /* ---------------------------------------------------------------- service */

  const traceOf = (call: Call) => requests.get(call.requestId)?.traceId

  const startCall = (now: number, call: Call) => {
    const rt = services.get(call.service)!
    rt.busy++
    if (rt.busy > rt.peakBusy) rt.peakBusy = rt.busy
    call.started = true
    const m = rt.m
    const utilization = rt.busy / m.capacity
    const contention = 1 + m.contention * Math.max(0, utilization - 0.7) / 0.3
    const mean = m.serviceTimeMs * m.latencyMultiplier * contention
    schedule(now + rng.lognormal(mean, m.serviceTimeCv), K.LocalDone, call.id)
  }

  const arrive = (now: number, call: Call) => {
    const rt = services.get(call.service)!
    rt.calls++
    if (!rt.m.available) {
      finishUnstarted(now, call, 'unavailable')
      return
    }
    if (rt.busy < rt.m.capacity) {
      startCall(now, call)
    } else if (rt.queue.length - rt.queueHead < rt.m.queueCapacity) {
      rt.queue.push(call.id)
      const depth = rt.queue.length - rt.queueHead
      if (depth > rt.peakQueue) rt.peakQueue = depth
    } else {
      rt.rejected++
      tele?.({ kind: 'queue_full', t: now, service: call.service, reason: 'queue full, request rejected', traceId: traceOf(call), spanId: call.spanId, parentSpanId: call.parentSpanId, requestId: String(call.requestId) })
      finishUnstarted(now, call, 'queue_full')
    }
  }

  /** A call that never got a worker (rejected / unavailable). */
  const finishUnstarted = (now: number, call: Call, reason: string) => {
    const rt = services.get(call.service)!
    rt.failed++
    rt.iFailed++
    call.finished = true
    deliver(now + 1, call, false, reason)
  }

  const nextDep = (now: number, call: Call, idx: number) => {
    const rt = services.get(call.service)!
    if (idx >= rt.deps.length) {
      finish(now, call, true, 'ok')
      return
    }
    callDep(now, call, idx, 1)
  }

  const callDep = (now: number, parent: Call, idx: number, attempt: number) => {
    const rt = services.get(parent.service)!
    const edge = rt.deps[idx]
    if (!edge) {
      finish(now, parent, true, 'ok')
      return
    }
    if (rt.m.circuitBreaker.enabled) {
      const b = breakerFor(parent.service, edge.to)
      if (b.open) {
        if (now < b.openUntil || b.probing) {
          depResult(now, parent, idx, attempt, false, 'circuit_open')
          return
        }
        b.probing = true
      }
    }
    const child: Call = {
      id: nextCallId++,
      service: edge.to,
      parent: parent.id,
      requestId: parent.requestId,
      depIdx: idx,
      attempt,
      settled: false,
      finished: false,
      started: false,
      spanId: hexId(scenario.seed, nextCallId, 8),
      parentSpanId: parent.spanId,
      pendingChild: 0,
    }
    calls.set(child.id, child)
    parent.pendingChild = child.id
    schedule(now + net, K.CallArrive, child.id)
    schedule(now + rt.m.timeoutMs, K.Timeout, child.id)
  }

  const depResult = (now: number, parent: Call, idx: number, attempt: number, ok: boolean, reason: string) => {
    if (parent.finished) return
    if (ok) {
      nextDep(now, parent, idx + 1)
      return
    }
    const rt = services.get(parent.service)!
    const edge = rt.deps[idx]
    const policy = rt.m.retry
    if (attempt < policy.maxAttempts && reason !== 'circuit_open') {
      iRetries++
      totRetries++
      tele?.({ kind: 'retry', t: now, service: parent.service, caller: parent.service, reason: `retrying ${edge?.to} after ${reason}`, attempt: attempt + 1, traceId: traceOf(parent), spanId: parent.spanId, requestId: String(parent.requestId) })
      schedule(now + backoff(policy, attempt, rng), K.Retry, parent.id, idx, attempt + 1)
      return
    }
    if (edge?.optional) {
      nextDep(now, parent, idx + 1)
      return
    }
    finish(now, parent, false, `dependency ${edge?.to ?? '?'} failed: ${reason}`)
  }

  const finish = (now: number, call: Call, ok: boolean, reason: string) => {
    if (call.finished) return
    const rt = services.get(call.service)!
    call.finished = true
    if (call.started) {
      rt.busy--
      // Admit the next queued call (FIFO).
      while (rt.queueHead < rt.queue.length && rt.busy < rt.m.capacity) {
        const nextId = rt.queue[rt.queueHead++]
        const next = calls.get(nextId)
        if (next && !next.finished) startCall(now, next)
      }
      if (rt.queueHead > 1024 && rt.queueHead * 2 > rt.queue.length) {
        rt.queue = rt.queue.slice(rt.queueHead)
        rt.queueHead = 0
      }
    }
    if (ok) rt.iCompleted++
    else {
      rt.failed++
      rt.iFailed++
      tele?.({ kind: 'call_failed', t: now, service: call.service, caller: call.parent === CLIENT ? 'client' : calls.get(call.parent)?.service, reason, traceId: traceOf(call), spanId: call.spanId, parentSpanId: call.parentSpanId, requestId: String(call.requestId) })
    }
    deliver(now + net, call, ok, reason)
  }

  const deliver = (t: number, call: Call, ok: boolean, reason: string) => {
    schedule(t, K.Response, call.id, 0, 0, ok, reason)
  }

  /* ---------------------------------------------------------------- client */

  const clientSend = (now: number, req: ClientRequest) => {
    if (model.rateLimitRps !== null) {
      const cap = model.rateLimitRps
      tokens = Math.min(cap, tokens + ((now - tokensAt) / 1000) * cap)
      tokensAt = now
      if (tokens < 1) {
        req.settled = true
        iLimited++
        totLimited++
        tele?.({ kind: 'rate_limited', t: now, service: model.entry, reason: 'rejected by entry rate limit', traceId: req.traceId, requestId: String(req.id) })
        requests.delete(req.id)
        return
      }
      tokens -= 1
    }
    const call: Call = {
      id: nextCallId++,
      service: model.entry,
      parent: CLIENT,
      requestId: req.id,
      depIdx: 0,
      attempt: req.attempt,
      settled: false,
      finished: false,
      started: false,
      spanId: hexId(scenario.seed, nextCallId, 8),
      pendingChild: 0,
    }
    calls.set(call.id, call)
    req.currentCall = call.id
    schedule(now + net, K.CallArrive, call.id)
    schedule(now + model.clientTimeoutMs, K.ClientTimeout, call.id)
  }

  const clientResult = (now: number, req: ClientRequest, ok: boolean, reason: string) => {
    if (req.settled) return
    if (ok) {
      req.settled = true
      const latency = now - req.start
      iOk++
      totOk++
      iLatencies.push(latency)
      allLatencies.push(latency)
      requests.delete(req.id)
      return
    }
    const policy = model.clientRetry
    if (req.attempt < policy.maxAttempts) {
      iRetries++
      totRetries++
      req.attempt++
      tele?.({ kind: 'retry', t: now, service: model.entry, caller: 'client', reason: `client retry after ${reason}`, attempt: req.attempt, traceId: req.traceId, requestId: String(req.id) })
      schedule(now + backoff(policy, req.attempt - 1, rng), K.ClientRetry, req.id)
      return
    }
    req.settled = true
    iFail++
    totFail++
    requests.delete(req.id)
  }

  /* ---------------------------------------------------------------- changes */

  const applyChange = (now: number, sc: ScheduledChange) => {
    const ch: ModelChange = sc.change
    switch (ch.kind) {
      case 'set_service': {
        const rt = services.get(ch.service)
        if (!rt) break
        assignAllowed(rt.m, ch.patch, SERVICE_PATCH_KEYS)
        // Added capacity admits queued calls immediately.
        while (rt.queueHead < rt.queue.length && rt.busy < rt.m.capacity) {
          const next = calls.get(rt.queue[rt.queueHead++])
          if (next && !next.finished) startCall(now, next)
        }
        break
      }
      case 'set_call': {
        const edge = model.calls.find((c) => c.from === ch.from && c.to === ch.to)
        if (edge) assignAllowed(edge, ch.patch, CALL_PATCH_KEYS)
        rebuildDeps()
        break
      }
      case 'set_traffic':
        trafficOverride = ch.rps
        break
      case 'set_rate_limit':
        model.rateLimitRps = ch.rps
        tokens = ch.rps ?? 0
        tokensAt = now
        break
      case 'set_client_retry':
        model.clientRetry = { ...ch.retry }
        break
    }
    applied.push(sc)
    tele?.({ kind: 'change', t: now, service: 'service' in ch ? ch.service : 'from' in ch ? ch.from : model.entry, label: sc.label, change: sc })
  }

  /* ---------------------------------------------------------------- sampling */

  const sample = (now: number) => {
    const svc: Record<string, ServiceSample> = {}
    for (const [id, rt] of services) {
      svc[id] = { busy: rt.busy, queue: rt.queue.length - rt.queueHead, completed: rt.iCompleted, failed: rt.iFailed }
      const total = rt.iCompleted + rt.iFailed
      if (total >= 5 && rt.iFailed / total > 0.2) rt.affected = true
      rt.iCompleted = 0
      rt.iFailed = 0
    }
    const done = iOk + iFail + iLimited
    iLatencies.sort((a, b) => a - b)
    samples.push({
      t: Math.round(now / 1000),
      requests: iReq,
      succeeded: iOk,
      failed: iFail,
      rateLimited: iLimited,
      errorRate: done > 0 ? Math.round(((iFail + iLimited) / done) * 10_000) / 10_000 : 0,
      p50: quantile(iLatencies, 0.5),
      p95: quantile(iLatencies, 0.95),
      retries: iRetries,
      timeouts: iTimeouts,
      services: svc,
    })
    iReq = iOk = iFail = iLimited = iRetries = iTimeouts = 0
    iLatencies = []
  }

  /* ---------------------------------------------------------------- run */

  const timeline = scenario.timeline
    .map((c, i) => ({ c, i }))
    .sort((x, y) => x.c.atSec - y.c.atSec || x.i - y.i)
  timeline.forEach(({ c }, i) => schedule(c.atSec * 1000, K.Change, i))
  const ordered = timeline.map((x) => x.c)
  for (let t = scenario.sampleMs; t <= endMs; t += scenario.sampleMs) schedule(t, K.Sample)
  scheduleArrival(0)

  let processed = 0
  let truncated = false
  while (heap.size > 0) {
    const ev = heap.pop()!
    if (ev.t > endMs) break
    if (++processed > maxEvents) {
      truncated = true
      break
    }
    const now = ev.t
    switch (ev.k) {
      case K.Arrival: {
        if (ev.a === 1 && currentRps(now) <= 0) {
          scheduleArrival(now)
          break
        }
        const id = nextRequestId++
        const req: ClientRequest = { id, start: now, attempt: 1, settled: false, currentCall: 0, traceId: hexId(scenario.seed ^ 0x5bd1e995, id, 16) }
        requests.set(id, req)
        iReq++
        totReq++
        clientSend(now, req)
        scheduleArrival(now)
        break
      }
      case K.CallArrive: {
        const call = calls.get(ev.a)
        if (call) arrive(now, call)
        break
      }
      case K.LocalDone: {
        const call = calls.get(ev.a)
        if (!call || call.finished) break
        const rt = services.get(call.service)!
        if (!rt.m.available) finish(now, call, false, 'service became unavailable')
        else if (rt.m.errorRate > 0 && rng.bernoulli(rt.m.errorRate)) finish(now, call, false, 'internal error')
        else nextDep(now, call, 0)
        break
      }
      case K.Response: {
        const call = calls.get(ev.a)
        if (!call) break
        calls.delete(call.id)
        if (call.settled) break // caller already timed out: zombie work ends here
        call.settled = true
        if (call.parent === CLIENT) {
          const req = requests.get(call.requestId)
          if (req && req.currentCall === call.id) clientResult(now, req, ev.ok === true, ev.reason ?? '')
          break
        }
        const parent = calls.get(call.parent)
        if (!parent || parent.finished || parent.pendingChild !== call.id) break
        recordBreaker(now, parent.service, call.service, ev.ok === true)
        depResult(now, parent, call.depIdx, call.attempt, ev.ok === true, ev.reason ?? '')
        break
      }
      case K.Timeout: {
        const call = calls.get(ev.a)
        if (!call || call.settled) break
        call.settled = true
        if (call.finished) calls.delete(call.id)
        const parent = calls.get(call.parent)
        if (!parent || parent.finished || parent.pendingChild !== call.id) break
        iTimeouts++
        totTimeouts++
        tele?.({ kind: 'timeout', t: now, service: parent.service, caller: parent.service, reason: `call to ${call.service} timed out after ${services.get(parent.service)!.m.timeoutMs} ms`, traceId: traceOf(parent), spanId: call.spanId, parentSpanId: parent.spanId, requestId: String(parent.requestId) })
        recordBreaker(now, parent.service, call.service, false)
        depResult(now, parent, call.depIdx, call.attempt, false, 'timeout')
        break
      }
      case K.Retry: {
        const parent = calls.get(ev.a)
        if (parent && !parent.finished) callDep(now, parent, ev.b, ev.c)
        break
      }
      case K.ClientTimeout: {
        const call = calls.get(ev.a)
        if (!call || call.settled) break
        call.settled = true
        if (call.finished) calls.delete(call.id)
        const req = requests.get(call.requestId)
        if (!req || req.currentCall !== call.id) break
        iTimeouts++
        totTimeouts++
        tele?.({ kind: 'timeout', t: now, service: model.entry, caller: 'client', reason: `client timed out after ${model.clientTimeoutMs} ms`, traceId: req.traceId, requestId: String(req.id) })
        clientResult(now, req, false, 'client_timeout')
        break
      }
      case K.ClientRetry: {
        const req = requests.get(ev.a)
        if (req && !req.settled) clientSend(now, req)
        break
      }
      case K.Change:
        applyChange(now, ordered[ev.a])
        break
      case K.Sample:
        sample(now)
        break
    }
  }

  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    durationSec: scenario.durationSec,
    samples,
    summary: summarize(samples, allLatencies, services, {
      totReq, totOk, totFail, totLimited, totRetries, totTimeouts, circuitOpens,
    }, failureThreshold, recoveryWindowSec),
    appliedChanges: applied,
    eventsProcessed: processed,
    truncated,
    simulatorVersion: SIMULATOR_VERSION,
  }
}

function summarize(
  samples: Sample[],
  latencies: number[],
  services: Map<string, ServiceRuntime>,
  t: { totReq: number; totOk: number; totFail: number; totLimited: number; totRetries: number; totTimeouts: number; circuitOpens: number },
  threshold: number,
  recoveryWindowSec: number,
): RunSummary {
  const sorted = latencies.slice().sort((a, b) => a - b)
  const done = t.totOk + t.totFail + t.totLimited
  let peak = 0
  let peakAt: number | null = null
  for (const s of samples) {
    if (s.errorRate > peak) {
      peak = s.errorRate
      peakAt = s.t
    }
  }
  // Onset: first sample above threshold. Recovery: first point after the peak
  // from which `recoveryWindowSec` consecutive samples stay at/below threshold.
  let onset: number | null = null
  for (const s of samples) if (s.errorRate > threshold) { onset = s.t; break }
  let recoveredAt: number | null = null
  let recovered: boolean | null = null
  if (onset !== null) {
    recovered = false
    const peakIdx = samples.findIndex((s) => s.t === peakAt)
    const sampleSec = samples.length > 1 ? samples[1].t - samples[0].t || 1 : 1
    const need = Math.max(1, Math.round(recoveryWindowSec / sampleSec))
    let run = 0
    for (let i = Math.max(0, peakIdx); i < samples.length; i++) {
      if (samples[i].errorRate <= threshold) {
        run++
        if (run >= need) {
          recoveredAt = samples[i - need + 1].t
          recovered = true
          break
        }
      } else run = 0
    }
  }
  const bounds = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, Infinity]
  const hist = bounds.map((b) => ({ upToMs: b, count: 0 }))
  for (const l of sorted) hist[bounds.findIndex((b) => l <= b)].count++

  const svc: Record<string, ServiceSummary> = {}
  const affected: string[] = []
  for (const [id, rt] of services) {
    svc[id] = {
      calls: rt.calls,
      failed: rt.failed,
      rejectedQueueFull: rt.rejected,
      peakBusy: rt.peakBusy,
      peakQueue: rt.peakQueue,
      failureRatio: rt.calls ? Math.round((rt.failed / rt.calls) * 10_000) / 10_000 : 0,
      affected: rt.affected,
    }
    if (rt.affected) affected.push(id)
  }
  const mean = sorted.length ? Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10 : null
  return {
    requests: t.totReq,
    succeeded: t.totOk,
    failed: t.totFail,
    rateLimited: t.totLimited,
    successRate: done ? Math.round((t.totOk / done) * 10_000) / 10_000 : 0,
    errorRate: done ? Math.round(((t.totFail + t.totLimited) / done) * 10_000) / 10_000 : 0,
    latency: { p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99), mean },
    latencyHistogram: hist.map((h) => ({ upToMs: Number.isFinite(h.upToMs) ? h.upToMs : -1, count: h.count })),
    peakErrorRate: peak,
    peakAtSec: peakAt,
    timeToRecoverySec: onset !== null && recoveredAt !== null ? recoveredAt - onset : null,
    recovered,
    onsetSec: onset,
    retries: t.totRetries,
    timeouts: t.totTimeouts,
    circuitOpens: t.circuitOpens,
    affectedServices: affected.sort(),
    services: svc,
  }
}
