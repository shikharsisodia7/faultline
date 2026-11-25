import type { Annotation, CanonicalEvent, Dependency, EventType, IncidentDataset, ServiceDef, Severity } from '../types'
import { compareEvents } from '../normalize/normalize'
import { stableId } from '../util/hash'
import { runSimulation, type RunResult, type TelemetryEvent } from '../simulate/simulator'
import type { DemoScenario } from './definitions'

export interface GenerateOptions {
  /** Max events kept per (service, kind) per second. */
  perSecondCap: number
  /** Error-rate threshold for generated SLO alerts. */
  alertThreshold: number
}

const DEFAULTS: GenerateOptions = { perSecondCap: 2, alertThreshold: 0.05 }

const REGION = 'us-east-1'

function hostFor(serviceId: string, key: string | number): string {
  const n = parseInt(stableId('h', serviceId, key).slice(2, 6), 36) % 4
  return `${serviceId}-${['7f9c', '2b1d', 'a40e', '5c63'][n]}`
}

/**
 * Turns a simulated run into an incident dataset. Sampling caps keep the event
 * volume realistic for a log export; nothing is invented that the simulation
 * did not do.
 */
export function generateIncident(demo: DemoScenario, opts: Partial<GenerateOptions> = {}): { dataset: IncidentDataset; run: RunResult } {
  const o = { ...DEFAULTS, ...opts }
  const incidentId = `demo-${demo.slug}`
  const telemetry: TelemetryEvent[] = []
  const run = runSimulation(demo.scenario, { onTelemetry: (t) => telemetry.push(t) })
  const base = demo.baseTime
  const events: CanonicalEvent[] = []
  const buckets = new Map<string, number>()
  const deployments = new Map<string, string>()
  for (const s of demo.scenario.model.services) if (s.version) deployments.set(s.id, `${s.id}@${s.version}`)
  let line = 0

  const push = (t: number, service: string, severity: Severity, type: EventType, message: string, extra: Partial<CanonicalEvent> = {}, meta: CanonicalEvent['metadata'] = {}) => {
    line++
    const ts = Math.round(base + t)
    const deploymentId = extra.deploymentId ?? deployments.get(service)
    const e: CanonicalEvent = {
      id: '',
      incidentId,
      ts,
      source: `${demo.slug}.synthetic.jsonl`,
      service,
      environment: 'production',
      severity,
      type,
      message,
      host: hostFor(service, extra.requestId ?? line),
      region: REGION,
      ...extra,
      deploymentId,
      metadata: { synthetic: true, ...meta },
      sourceRef: { sourceId: `synthetic:${demo.slug}`, sourceName: `${demo.slug}.synthetic.jsonl`, line, format: 'synthetic' },
    }
    e.id = stableId('evt', incidentId, ts, service, type, message, e.traceId, e.spanId, line)
    events.push(e)
  }

  const allow = (t: number, service: string, kind: string): boolean => {
    const key = `${Math.floor(t / 1000)}|${service}|${kind}`
    const n = buckets.get(key) ?? 0
    if (n >= o.perSecondCap) return false
    buckets.set(key, n + 1)
    return true
  }

  // Baseline traffic heartbeat so healthy services are visible on the timeline.
  for (const s of run.samples) {
    if (s.t % 30 === 0) {
      push(s.t * 1000, demo.scenario.model.entry, 'info', 'log', `${s.requests} req/s, ${s.succeeded} ok, p95 ${s.p95 ?? '-'} ms`, {}, { rps: s.requests, p95_ms: s.p95 ?? null })
    }
  }

  for (const t of telemetry) {
    switch (t.kind) {
      case 'change': {
        const ch = t.change!
        const cat = ch.category ?? 'config_change'
        const svc = ch.deployService ?? t.service
        if (cat === 'deploy' && ch.deploymentId) deployments.set(svc, ch.deploymentId)
        if (cat === 'rollback') {
          const ver = /to (v[\d.]+)/.exec(ch.label)?.[1]
          if (ver) deployments.set(svc, `${svc}@${ver}`)
        }
        // A multi-part deploy emits one event per deploy, not per part.
        if (events.some((e) => e.ts === Math.round(base + t.t) && e.message === ch.label)) break
        const type: EventType = cat === 'deploy' ? 'deploy' : cat === 'rollback' ? 'rollback' : cat === 'scale' ? 'scale' : cat === 'outage' ? 'latency' : cat === 'recovery' ? 'recovery' : 'config_change'
        const severity: Severity = cat === 'outage' ? 'warn' : 'info'
        push(t.t, svc, severity, type, ch.label, { deploymentId: deployments.get(svc) }, { change: cat })
        break
      }
      case 'call_failed': {
        if (!allow(t.t, t.service, 'fail')) break
        const reason = t.reason ?? 'failed'
        const isEdge = t.caller === 'client'
        const status = /queue_full|unavailable/.test(reason) ? 503 : /timeout/.test(reason) ? 504 : 500
        const msg = isEdge ? `HTTP ${status} returned to client: ${reason}` : `request failed: ${reason}`
        push(t.t, t.service, isEdge ? 'error' : 'error', 'error', msg, { traceId: t.traceId, spanId: t.spanId, parentSpanId: t.parentSpanId, requestId: t.requestId && `req-${t.requestId}` }, { http_status: isEdge ? status : null })
        break
      }
      case 'timeout':
        if (!allow(t.t, t.service, 'timeout')) break
        push(t.t, t.service, 'error', 'timeout', t.reason ?? 'timeout', { traceId: t.traceId, spanId: t.spanId, parentSpanId: t.parentSpanId, requestId: t.requestId && `req-${t.requestId}` })
        break
      case 'retry':
        if (!allow(t.t, t.service, 'retry')) break
        push(t.t, t.service, 'warn', 'retry', `${t.reason} (attempt ${t.attempt})`, { traceId: t.traceId, spanId: t.spanId, requestId: t.requestId && `req-${t.requestId}` }, { attempt: t.attempt ?? null })
        break
      case 'queue_full':
        if (!allow(t.t, t.service, 'queue')) break
        push(t.t, t.service, 'error', 'queue_full', `${t.service} queue full; request rejected`, { traceId: t.traceId, spanId: t.spanId, parentSpanId: t.parentSpanId, requestId: t.requestId && `req-${t.requestId}` })
        break
      case 'circuit_open':
        push(t.t, t.service, 'warn', 'circuit_open', t.reason ?? 'circuit opened')
        break
      case 'circuit_close':
        push(t.t, t.service, 'info', 'circuit_close', t.reason ?? 'circuit closed')
        break
      case 'rate_limited':
        if (!allow(t.t, t.service, 'limited')) break
        push(t.t, t.service, 'warn', 'queue_full', 'request shed by gateway rate limit (429)', { traceId: t.traceId, requestId: t.requestId && `req-${t.requestId}` }, { http_status: 429 })
        break
      default:
        break
    }
  }

  // Metric-derived events: pool saturation, SLO alerts, recovery.
  const dbs = demo.scenario.model.services.filter((s) => s.kind === 'database' || s.kind === 'external')
  const saturated = new Set<string>()
  let alerting = false
  let quiet = 0
  const rule = demo.alert ?? { threshold: o.alertThreshold, windowSec: 10 }
  const win: Array<{ bad: number; done: number }> = []
  let winBad = 0
  let winDone = 0
  for (const s of run.samples) {
    const bad = s.failed + s.rateLimited
    const done = s.succeeded + bad
    win.push({ bad, done })
    winBad += bad
    winDone += done
    if (win.length > rule.windowSec) {
      const old = win.shift()!
      winBad -= old.bad
      winDone -= old.done
    }
    const rolling = winDone > 0 ? winBad / winDone : 0
    for (const db of dbs) {
      const st = s.services[db.id]
      const capacity = demo.scenario.model.services.find((x) => x.id === db.id)!.capacity
      const full = st.busy >= capacity && st.queue > capacity * 0.5
      if (full && !saturated.has(db.id)) {
        saturated.add(db.id)
        push(s.t * 1000, db.id, 'error', 'saturation', `${db.kind === 'database' ? 'connection pool exhausted' : 'upstream concurrency exhausted'}: ${st.busy}/${capacity} in use, ${st.queue} waiting`, {}, { in_use: st.busy, waiting: st.queue })
      } else if (!full && saturated.has(db.id) && st.queue === 0) {
        saturated.delete(db.id)
        push(s.t * 1000, db.id, 'info', 'recovery', `${db.id} pool back under capacity (${st.busy}/${capacity})`)
      }
    }
    if (!alerting && win.length >= Math.min(rule.windowSec, 10) && rolling > rule.threshold) {
      alerting = true
      quiet = 0
      push(s.t * 1000, demo.scenario.model.entry, 'critical', 'alert', `ALERT firing: ${demo.scenario.model.entry} ${rule.windowSec}s error rate ${(rolling * 100).toFixed(1)}% > ${(rule.threshold * 100).toFixed(1)}% SLO`, {}, { error_rate: Math.round(rolling * 10_000) / 10_000, window_s: rule.windowSec })
    } else if (alerting) {
      quiet = s.errorRate <= rule.threshold / 4 ? quiet + 1 : 0
      if (quiet >= 30) {
        alerting = false
        push(s.t * 1000, demo.scenario.model.entry, 'info', 'recovery', `ALERT resolved: ${demo.scenario.model.entry} error rate back to ${(s.errorRate * 100).toFixed(2)}% for 30s`, {}, { error_rate: s.errorRate })
      }
    }
  }

  events.sort(compareEvents)

  const services: ServiceDef[] = demo.scenario.model.services.map((s) => ({ id: s.id, name: s.id, kind: s.kind }))
  const dependencies: Dependency[] = demo.scenario.model.calls.map((c) => ({ from: c.from, to: c.to, origin: 'declared' }))
  const annotations: Annotation[] = demo.annotations.map((a, i) => {
    const ts = base + a.atSec * 1000
    let nearest: CanonicalEvent | undefined
    for (const e of events) if (Math.abs(e.ts - ts) < Math.abs((nearest?.ts ?? Infinity) - ts) && e.severity !== 'info') nearest = e
    return { id: stableId('ann', incidentId, i), eventId: nearest?.id, ts, author: a.author, body: a.body, kind: a.kind, synthetic: true }
  })

  const firstErr = events.find((e) => e.severity === 'error' || e.severity === 'critical')
  const alert = events.find((e) => e.type === 'alert')
  const resolved = [...events].reverse().find((e) => e.type === 'recovery' && /ALERT resolved/.test(e.message))
  return {
    run,
    dataset: {
      meta: {
        id: incidentId,
        title: demo.title,
        summary: demo.summary,
        severity: demo.severity,
        synthetic: true,
        startedAt: firstErr?.ts,
        detectedAt: alert?.ts,
        resolvedAt: resolved?.ts,
        category: demo.category,
        environment: 'production',
      },
      events,
      services,
      dependencies,
      annotations,
    },
  }
}

/** Serializes events as a portable JSONL fixture (re-importable via normalizeSource). */
export function toJsonl(events: readonly CanonicalEvent[]): string {
  return events
    .map((e) =>
      JSON.stringify({
        timestamp: new Date(e.ts).toISOString(),
        service: e.service,
        level: e.severity,
        type: e.type,
        message: e.message,
        trace_id: e.traceId,
        span_id: e.spanId,
        parent_span_id: e.parentSpanId,
        request_id: e.requestId,
        deployment_id: e.deploymentId,
        host: e.host,
        region: e.region,
        environment: e.environment,
        ...Object.fromEntries(Object.entries(e.metadata).filter(([k]) => k !== 'synthetic')),
      }),
    )
    .join('\n')
}
