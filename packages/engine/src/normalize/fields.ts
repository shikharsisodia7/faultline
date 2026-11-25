import type { EventType, Severity } from '../types'

/**
 * Field alias table. The first alias present (case-insensitive, dotted paths
 * resolve into nested objects) wins. A user-supplied mapping overrides this
 * table per canonical field. Documented in docs/NORMALIZATION.md.
 */
export const FIELD_ALIASES = {
  timestamp: ['timestamp', '@timestamp', 'time', 'ts', 'datetime', 'date', 'eventtime', 'event_time', 'timeunixnano', 'time_unix_nano', 'logged_at', 'created_at'],
  service: ['service', 'service.name', 'service_name', 'servicename', 'svc', 'app', 'application', 'component', 'resource.service.name', 'logger'],
  severity: ['severity', 'level', 'lvl', 'loglevel', 'log.level', 'log_level', 'severity_text', 'severitytext', 'status_level', 'priority'],
  message: ['message', 'msg', 'log', 'text', 'body', 'description', 'event', 'summary', 'error.message'],
  type: ['type', 'event_type', 'eventtype', 'kind', 'category', 'event.type'],
  traceId: ['trace_id', 'traceid', 'trace.id', 'trace', 'x-trace-id', 'otel.trace_id'],
  spanId: ['span_id', 'spanid', 'span.id', 'span'],
  parentSpanId: ['parent_span_id', 'parentspanid', 'parent_id', 'parent.id', 'parentid'],
  requestId: ['request_id', 'requestid', 'req_id', 'reqid', 'x-request-id', 'http.request_id', 'correlation_id'],
  deploymentId: ['deployment_id', 'deploymentid', 'deploy_id', 'deploy', 'release', 'version', 'build', 'git_sha', 'commit'],
  host: ['host', 'hostname', 'host.name', 'node', 'instance', 'pod', 'container'],
  region: ['region', 'zone', 'availability_zone', 'cloud.region', 'dc', 'datacenter'],
  environment: ['environment', 'env', 'deployment.environment', 'stage'],
  durationMs: ['duration_ms', 'durationms', 'latency_ms', 'latencyms', 'elapsed_ms', 'response_time_ms', 'duration'],
} as const

export type CanonicalField = keyof typeof FIELD_ALIASES

export type FieldMapping = Partial<Record<CanonicalField, string>>

/** Case-insensitive, dotted-path lookup. Returns the value and the key that matched. */
export function lookup(record: Record<string, unknown>, path: string): { value: unknown; key: string } | undefined {
  const lowerIndex = new Map<string, string>()
  for (const k of Object.keys(record)) lowerIndex.set(k.toLowerCase(), k)
  const direct = lowerIndex.get(path.toLowerCase())
  if (direct !== undefined && record[direct] !== undefined && record[direct] !== null && record[direct] !== '') {
    return { value: record[direct], key: direct }
  }
  if (!path.includes('.')) return undefined
  const [head, ...rest] = path.split('.')
  const headKey = lowerIndex.get(head.toLowerCase())
  if (headKey === undefined) return undefined
  const child = record[headKey]
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    const found = lookup(child as Record<string, unknown>, rest.join('.'))
    return found ? { value: found.value, key: `${headKey}.${found.key}` } : undefined
  }
  return undefined
}

export function resolveField(
  record: Record<string, unknown>,
  field: CanonicalField,
  mapping: FieldMapping | undefined,
): { value: unknown; key: string } | undefined {
  const mapped = mapping?.[field]
  if (mapped) return lookup(record, mapped)
  for (const alias of FIELD_ALIASES[field]) {
    const found = lookup(record, alias)
    if (found) return found
  }
  return undefined
}

/* ------------------------------------------------------------------ severity */

const SEVERITY_WORDS: Array<[RegExp, Severity]> = [
  [/^(fatal|crit(ical)?|emerg(ency)?|alert|panic|sev ?1|p1)$/i, 'critical'],
  [/^(err(or)?|fail(ure|ed)?|sev ?2|p2|severe)$/i, 'error'],
  [/^(warn(ing)?|sev ?3|p3)$/i, 'warn'],
  [/^(info(rmation(al)?)?|notice|ok|sev ?4|p4)$/i, 'info'],
  [/^(debug|trace|verbose|fine(st|r)?|sev ?5|p5)$/i, 'debug'],
]

/**
 * Maps textual levels, syslog numbers (0-7), and OpenTelemetry SeverityNumber
 * (1-24) to the canonical scale. Returns undefined when unrecognized so the
 * caller can infer from the message instead of guessing.
 */
export function normalizeSeverity(value: unknown, scale: 'auto' | 'syslog' | 'otel' = 'auto'): Severity | undefined {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    const n = Number(value)
    if (scale === 'syslog' || (scale === 'auto' && n <= 7 && n >= 0 && scale !== 'otel')) {
      if (scale === 'auto' && n === 0) return undefined
      if (n <= 2) return 'critical'
      if (n === 3) return 'error'
      if (n === 4) return 'warn'
      if (n <= 6) return 'info'
      return 'debug'
    }
    if (n >= 1 && n <= 24) {
      if (n <= 8) return 'debug'
      if (n <= 12) return 'info'
      if (n <= 16) return 'warn'
      if (n <= 20) return 'error'
      return 'critical'
    }
    return undefined
  }
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  for (const [re, sev] of SEVERITY_WORDS) if (re.test(s)) return sev
  return undefined
}

/** Fallback when no explicit level exists: conservative keyword inference. */
export function inferSeverityFromMessage(message: string): Severity {
  if (/\b(panic|fatal|outage|crash(ed)?|down)\b/i.test(message)) return 'critical'
  if (/\b(error|exception|fail(ed|ure)?|refused|unavailable|5\d\d\b|timed? ?out)\b/i.test(message)) return 'error'
  if (/\b(warn(ing)?|slow|degraded|retry(ing)?|high latency|saturat)/i.test(message)) return 'warn'
  return 'info'
}

/* ------------------------------------------------------------------ type */

const TYPE_EXPLICIT: Record<string, EventType> = {
  deploy: 'deploy', deployment: 'deploy', release: 'deploy',
  rollback: 'rollback', revert: 'rollback',
  config: 'config_change', config_change: 'config_change', configuration: 'config_change',
  alert: 'alert', alarm: 'alert', page: 'alert', incident: 'alert',
  error: 'error', exception: 'error',
  latency: 'latency', slow: 'latency',
  timeout: 'timeout',
  retry: 'retry',
  saturation: 'saturation', pool_exhausted: 'saturation', resource_exhausted: 'saturation',
  queue_full: 'queue_full', backpressure: 'queue_full',
  circuit_open: 'circuit_open', breaker_open: 'circuit_open',
  circuit_close: 'circuit_close', breaker_closed: 'circuit_close',
  scale: 'scale', autoscale: 'scale',
  recovery: 'recovery', resolved: 'recovery', recovered: 'recovery',
  span: 'span', log: 'log',
}

/** Ordered keyword rules; first match wins. */
const TYPE_RULES: Array<[RegExp, EventType]> = [
  [/\broll(ed|ing)?[ -]?back\b|\brevert(ed|ing)?\b/i, 'rollback'],
  [/\bdeploy(ed|ing|ment)?\b|\brelease[d]? v?\d|\brollout\b/i, 'deploy'],
  [/\bconfig(uration)? (change|update)|\bfeature flag\b/i, 'config_change'],
  [/\bcircuit( breaker)? (is )?open(ed)?\b|\bbreaker open\b/i, 'circuit_open'],
  [/\bcircuit( breaker)? (is )?(closed|close|half-open)\b|\bbreaker clos/i, 'circuit_close'],
  [/\b(pool|connections?) (exhausted|saturat\w*)|\bsaturat\w*|too many connections|no available connection/i, 'saturation'],
  [/\bqueue (is )?full\b|\bbackpressure\b|\brejected.*queue|\bshed(ding)? load/i, 'queue_full'],
  [/\btimed? ?out\b|\bdeadline exceeded\b/i, 'timeout'],
  [/\bretry(ing)?\b|\battempt \d+\/\d+/i, 'retry'],
  [/\b(alert|alarm|paging|slo burn|firing)\b/i, 'alert'],
  [/\b(recovered|recovery|resolved|back to normal|healthy again)\b/i, 'recovery'],
  [/\b(scal(ed|ing) (up|out|down|in)|autoscal)/i, 'scale'],
  [/\b(high latency|p9\d|slow (request|query)|latency (spike|elevated))/i, 'latency'],
  [/\b(error|exception|failed|failure|5\d\d)\b/i, 'error'],
]

export function normalizeEventType(explicit: unknown, message: string, severity: Severity): EventType {
  if (typeof explicit === 'string') {
    const key = explicit.trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (TYPE_EXPLICIT[key]) return TYPE_EXPLICIT[key]
  }
  for (const [re, t] of TYPE_RULES) if (re.test(message)) return t
  if (severity === 'error' || severity === 'critical') return 'error'
  return 'log'
}
