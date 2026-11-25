/**
 * Canonical data model shared by every Faultline engine module.
 *
 * Everything here is plain JSON-serializable data so it can cross the
 * worker / browser / Durable Object boundary unchanged.
 */

export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'critical'

export const SEVERITY_RANK: Record<Severity, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
}

/**
 * Event types the engines reason about. Unknown inputs normalize to `log`.
 * The list is intentionally small: each type participates in a documented
 * correlation or replay rule (see docs/CORRELATION.md, docs/REPLAY.md).
 */
export type EventType =
  | 'log'
  | 'deploy'
  | 'rollback'
  | 'config_change'
  | 'alert'
  | 'error'
  | 'latency'
  | 'timeout'
  | 'retry'
  | 'saturation'
  | 'queue_full'
  | 'circuit_open'
  | 'circuit_close'
  | 'scale'
  | 'recovery'
  | 'span'

export const EVENT_TYPES: readonly EventType[] = [
  'log',
  'deploy',
  'rollback',
  'config_change',
  'alert',
  'error',
  'latency',
  'timeout',
  'retry',
  'saturation',
  'queue_full',
  'circuit_open',
  'circuit_close',
  'scale',
  'recovery',
  'span',
]

/** Where a normalized event came from. Never dropped; it is the provenance chain. */
export interface SourceRef {
  sourceId: string
  sourceName: string
  /** 1-based line (or record index for structured formats). */
  line: number
  /** Format the record was parsed from. */
  format: SourceFormat
}

export type SourceFormat = 'json' | 'jsonl' | 'csv' | 'text' | 'otlp' | 'synthetic' | 'github'

export interface CanonicalEvent {
  /** Stable content-derived identifier (same input -> same id). */
  id: string
  incidentId: string
  /** UTC epoch milliseconds. */
  ts: number
  /** Optional duration (spans), milliseconds. */
  durationMs?: number
  source: string
  service: string
  environment: string
  severity: Severity
  type: EventType
  message: string
  traceId?: string
  spanId?: string
  parentSpanId?: string
  requestId?: string
  deploymentId?: string
  host?: string
  region?: string
  metadata: Record<string, string | number | boolean | null>
  sourceRef: SourceRef
  /** Warnings attached during normalization (e.g. 'assumed_utc', 'service_defaulted'). */
  flags?: string[]
}

export interface ServiceDef {
  id: string
  name: string
  kind: 'edge' | 'service' | 'database' | 'queue' | 'cache' | 'external'
  /** Optional team / tier labels shown in the UI. */
  tier?: string
}

/** Directed dependency: `from` calls / depends on `to`. */
export interface Dependency {
  from: string
  to: string
  /** How the edge was learned. */
  origin: 'declared' | 'trace' | 'inferred'
}

export interface Annotation {
  id: string
  eventId?: string
  ts?: number
  author: string
  body: string
  kind: 'note' | 'hypothesis' | 'action'
  /** Synthetic demo annotations are labeled so they are never mistaken for real responders. */
  synthetic?: boolean
}

export interface IncidentMeta {
  id: string
  title: string
  summary?: string
  severity: 'sev1' | 'sev2' | 'sev3' | 'sev4'
  /** True for generated demo data. Always rendered with a label. */
  synthetic: boolean
  startedAt?: number
  detectedAt?: number
  resolvedAt?: number
  category?: string
  environment?: string
}

/** Everything the investigation UI needs, independent of where it was loaded from. */
export interface IncidentDataset {
  meta: IncidentMeta
  events: CanonicalEvent[]
  services: ServiceDef[]
  dependencies: Dependency[]
  annotations: Annotation[]
}
