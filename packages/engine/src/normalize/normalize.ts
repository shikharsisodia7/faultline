import type { CanonicalEvent, SourceFormat, SourceRef } from '../types'
import { SEVERITY_RANK } from '../types'
import { stableId } from '../util/hash'
import { parseTimestamp } from '../util/time'
import {
  type FieldMapping,
  inferSeverityFromMessage,
  normalizeEventType,
  normalizeSeverity,
  resolveField,
} from './fields'
import { detectFormat, parseByFormat, type ParseError, type RawRecord } from './parsers'
import { DEFAULT_REDACTION_RULES, redactMetadata, redactText, type RedactionRule } from './redact'

/** Structural subset of AbortSignal so the engine needs no DOM types. */
export interface CancelSignal {
  readonly aborted: boolean
}

export interface NormalizeLimits {
  /** Maximum source size in bytes (UTF-16 length used as the bound). */
  maxBytes: number
  /** Maximum records accepted from one source. */
  maxRecords: number
  /** Messages longer than this are truncated (flagged). */
  maxMessageLength: number
  /** Metadata keys beyond this per event are dropped (flagged). */
  maxMetadataKeys: number
}

export const DEFAULT_LIMITS: NormalizeLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxRecords: 20_000,
  maxMessageLength: 2_000,
  maxMetadataKeys: 40,
}

export interface NormalizeOptions {
  incidentId: string
  sourceId: string
  sourceName: string
  format?: SourceFormat | 'auto'
  mapping?: FieldMapping
  limits?: Partial<NormalizeLimits>
  redact?: boolean
  redactionRules?: RedactionRule[]
  /** Used for `service` when a record names none. */
  defaultService?: string
  defaultEnvironment?: string
  /** Year assumed for year-less syslog timestamps. */
  referenceYear?: number
  /** Checked between records; aborting throws an `AbortError`. */
  signal?: CancelSignal
  /** Progress callback in [0, 1]. */
  onProgress?: (fraction: number, stage: string) => void
}

export type ImportErrorCode =
  | ParseError['code']
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'missing_message'
  | 'too_many_records'
  | 'source_too_large'

export interface ImportError {
  line: number
  code: ImportErrorCode
  message: string
  excerpt: string
}

export interface DuplicateRecord {
  line: number
  /** Id of the event that was kept. */
  duplicateOf: string
}

export interface NormalizeStats {
  format: SourceFormat
  totalRecords: number
  accepted: number
  rejected: number
  duplicates: number
  redactions: number
  warnings: Record<string, number>
  timeRange: { start: number; end: number } | null
  services: string[]
}

export interface NormalizeResult {
  events: CanonicalEvent[]
  errors: ImportError[]
  duplicates: DuplicateRecord[]
  stats: NormalizeStats
}

export class ImportTooLargeError extends Error {
  readonly code = 'source_too_large'
}

function abortIfNeeded(signal?: CancelSignal) {
  if (signal?.aborted) {
    const err = new Error('Import cancelled')
    err.name = 'AbortError'
    throw err
  }
}

const RESERVED = new Set([
  'timestamp', '@timestamp', 'time', 'ts', 'message', 'msg', 'level', 'severity', '__rule',
])

function toPrimitive(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = typeof v === 'string' ? v : String(v)
  const t = s.trim()
  return t === '' ? undefined : t
}

/** Deterministic total order: time, then service, then source line, then id. */
export function compareEvents(a: CanonicalEvent, b: CanonicalEvent): number {
  if (a.ts !== b.ts) return a.ts - b.ts
  if (a.sourceRef.sourceId !== b.sourceRef.sourceId) return a.sourceRef.sourceId < b.sourceRef.sourceId ? -1 : 1
  if (a.sourceRef.line !== b.sourceRef.line) return a.sourceRef.line - b.sourceRef.line
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Fingerprint for duplicate detection. Two records are duplicates when the
 * same thing was observed at the same instant by the same service — the
 * source line is deliberately excluded so a log shipped twice is caught.
 */
function fingerprint(e: Omit<CanonicalEvent, 'id'>): string {
  return [e.ts, e.service, e.severity, e.type, e.message, e.traceId ?? '', e.spanId ?? '', e.requestId ?? ''].join('\u001f')
}

export function normalizeSource(input: string, options: NormalizeOptions): NormalizeResult {
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  const redact = options.redact !== false
  const rules = options.redactionRules ?? DEFAULT_REDACTION_RULES
  const errors: ImportError[] = []
  const warnings: Record<string, number> = {}
  const warn = (flag: string) => { warnings[flag] = (warnings[flag] ?? 0) + 1 }

  if (input.length > limits.maxBytes) {
    throw new ImportTooLargeError(
      `Source is ${(input.length / 1024 / 1024).toFixed(1)} MiB; the limit is ${(limits.maxBytes / 1024 / 1024).toFixed(1)} MiB.`,
    )
  }

  options.onProgress?.(0.05, 'reading')
  const format = !options.format || options.format === 'auto' ? detectFormat(input, options.sourceName) : options.format
  const parsed = parseByFormat(format, input)
  for (const e of parsed.errors) errors.push({ ...e })
  abortIfNeeded(options.signal)

  let records: RawRecord[] = parsed.records
  if (records.length > limits.maxRecords) {
    errors.push({
      line: records[limits.maxRecords].line,
      code: 'too_many_records',
      message: `Source has ${records.length} records; only the first ${limits.maxRecords} were imported. Split the file or raise the limit.`,
      excerpt: '',
    })
    records = records.slice(0, limits.maxRecords)
  }

  options.onProgress?.(0.2, 'validating')
  const kept = new Map<string, CanonicalEvent>()
  const duplicates: DuplicateRecord[] = []
  let redactions = 0
  const total = records.length

  for (let i = 0; i < records.length; i++) {
    if (i % 500 === 0) {
      abortIfNeeded(options.signal)
      options.onProgress?.(0.2 + 0.6 * (i / Math.max(1, total)), 'normalizing')
    }
    const rec = records[i]
    const f = rec.fields
    const flags: string[] = []
    const ex = rec.raw ?? JSON.stringify(f).slice(0, 160)

    // --- timestamp (required)
    const tsField = resolveField(f, 'timestamp', options.mapping)
    if (!tsField) {
      errors.push({ line: rec.line, code: 'missing_timestamp', message: 'No timestamp field found (looked for timestamp, @timestamp, time, ts, ...).', excerpt: ex })
      continue
    }
    const parsedTs = parseTimestamp(tsField.value, { referenceYear: options.referenceYear })
    if (!parsedTs) {
      errors.push({ line: rec.line, code: 'invalid_timestamp', message: `Could not parse timestamp ${JSON.stringify(tsField.value)} from field "${tsField.key}".`, excerpt: ex })
      continue
    }
    flags.push(...parsedTs.flags)

    // --- message (required: message, or at least a type)
    const msgField = resolveField(f, 'message', options.mapping)
    const typeField = resolveField(f, 'type', options.mapping)
    let message = asString(msgField?.value) ?? (typeField ? String(typeField.value) : undefined)
    if (!message) {
      errors.push({ line: rec.line, code: 'missing_message', message: 'Record has neither a message nor an event type.', excerpt: ex })
      continue
    }
    if (message.length > limits.maxMessageLength) {
      message = `${message.slice(0, limits.maxMessageLength)}…`
      flags.push('message_truncated')
    }

    // --- severity
    const sevField = resolveField(f, 'severity', options.mapping)
    let severity = sevField ? normalizeSeverity(sevField.value, rec.hints?.severityScale ?? 'auto') : undefined
    if (!severity) {
      severity = inferSeverityFromMessage(message)
      flags.push(sevField ? 'severity_unrecognized' : 'severity_inferred')
    }

    // --- service
    let service = asString(resolveField(f, 'service', options.mapping)?.value)
    if (!service) {
      service = options.defaultService ?? 'unknown'
      flags.push('service_defaulted')
    }
    service = service.toLowerCase().replace(/\s+/g, '-').slice(0, 80)

    const type = normalizeEventType(rec.hints?.type ?? typeField?.value, message, severity)

    // --- optional identifiers
    const get = (field: Parameters<typeof resolveField>[1]) => asString(resolveField(f, field, options.mapping)?.value)
    const durationRaw = resolveField(f, 'durationMs', options.mapping)?.value
    const durationMs = durationRaw !== undefined && Number.isFinite(Number(durationRaw)) ? Number(durationRaw) : undefined

    // --- metadata: everything not consumed by a canonical field
    const consumed = new Set<string>(
      [tsField.key, msgField?.key, sevField?.key, typeField?.key].filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase()),
    )
    for (const field of ['service', 'traceId', 'spanId', 'parentSpanId', 'requestId', 'deploymentId', 'host', 'region', 'environment', 'durationMs'] as const) {
      const r = resolveField(f, field, options.mapping)
      if (r) consumed.add(r.key.toLowerCase())
    }
    let metadata: Record<string, string | number | boolean | null> = {}
    let metaCount = 0
    for (const [k, v] of Object.entries(f)) {
      if (consumed.has(k.toLowerCase()) || RESERVED.has(k)) continue
      if (v === undefined) continue
      if (metaCount >= limits.maxMetadataKeys) {
        flags.push('metadata_truncated')
        break
      }
      metadata[k] = toPrimitive(v)
      metaCount++
    }

    if (redact) {
      const rm = redactText(message, rules)
      message = rm.text
      const md = redactMetadata(metadata, rules)
      metadata = md.metadata
      const hits = rm.hits.length + md.hits.length
      if (hits > 0) {
        flags.push('redacted')
        redactions += hits
      }
    }

    const sourceRef: SourceRef = { sourceId: options.sourceId, sourceName: options.sourceName, line: rec.line, format }
    const base: Omit<CanonicalEvent, 'id'> = {
      incidentId: options.incidentId,
      ts: parsedTs.ts,
      durationMs,
      source: options.sourceName,
      service,
      environment: (get('environment') ?? options.defaultEnvironment ?? 'production').toLowerCase(),
      severity,
      type,
      message,
      traceId: get('traceId'),
      spanId: get('spanId'),
      parentSpanId: get('parentSpanId'),
      requestId: get('requestId'),
      deploymentId: get('deploymentId'),
      host: get('host'),
      region: get('region'),
      metadata,
      sourceRef,
      flags: flags.length ? Array.from(new Set(flags)) : undefined,
    }
    for (const flag of base.flags ?? []) warn(flag)

    const fp = fingerprint(base)
    const id = stableId('evt', options.incidentId, fp)
    const existing = kept.get(id)
    if (existing) {
      duplicates.push({ line: rec.line, duplicateOf: existing.id })
      continue
    }
    kept.set(id, { id, ...base })
  }

  options.onProgress?.(0.85, 'deduplicating')
  const events = Array.from(kept.values()).sort(compareEvents)
  options.onProgress?.(1, 'normalized')

  const services = Array.from(new Set(events.map((e) => e.service))).sort()
  return {
    events,
    errors: errors.sort((a, b) => a.line - b.line),
    duplicates,
    stats: {
      format,
      totalRecords: parsed.records.length + parsed.errors.length,
      accepted: events.length,
      rejected: errors.filter((e) => e.code !== 'too_many_records').length,
      duplicates: duplicates.length,
      redactions,
      warnings,
      timeRange: events.length ? { start: events[0].ts, end: events[events.length - 1].ts } : null,
      services,
    },
  }
}

/**
 * Merge newly arrived events (late or out-of-order sources) into an existing
 * immutable, sorted set. Ids are content-derived, so re-importing the same
 * evidence is a no-op; the result is always re-sorted deterministically.
 */
export function mergeEvents(existing: readonly CanonicalEvent[], incoming: readonly CanonicalEvent[]): {
  events: CanonicalEvent[]
  added: number
  duplicates: number
} {
  const byId = new Map<string, CanonicalEvent>()
  for (const e of existing) byId.set(e.id, e)
  let added = 0
  let duplicates = 0
  for (const e of incoming) {
    if (byId.has(e.id)) duplicates++
    else {
      byId.set(e.id, e)
      added++
    }
  }
  return { events: Array.from(byId.values()).sort(compareEvents), added, duplicates }
}

export function maxSeverity(events: readonly CanonicalEvent[]) {
  let best = 0
  for (const e of events) best = Math.max(best, SEVERITY_RANK[e.severity])
  return best
}
