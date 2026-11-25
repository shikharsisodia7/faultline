import type { SourceFormat } from '../types'

/** One record extracted from a source before field mapping. */
export interface RawRecord {
  line: number
  fields: Record<string, unknown>
  /** Original text for text/CSV formats, kept for error reports. */
  raw?: string
  /** Parser-level hints (e.g. OTLP severity scale). */
  hints?: { severityScale?: 'otel' | 'syslog'; type?: string }
}

export interface ParseError {
  line: number
  code:
    | 'malformed_json'
    | 'not_an_object'
    | 'csv_column_mismatch'
    | 'unparseable_line'
    | 'empty_line'
    | 'unsupported_structure'
  message: string
  excerpt: string
}

export interface ParseResult {
  records: RawRecord[]
  errors: ParseError[]
}

const EXCERPT = 160
const excerpt = (s: string) => (s.length > EXCERPT ? `${s.slice(0, EXCERPT)}…` : s)

function splitLines(input: string): string[] {
  return input.replace(/^﻿/, '').split(/\r?\n/)
}

/* --------------------------------------------------------------------- detect */

export function detectFormat(input: string, fileName?: string): SourceFormat {
  const name = fileName?.toLowerCase() ?? ''
  const head = input.replace(/^﻿/, '').trimStart().slice(0, 4096)
  if (/"resource(Logs|Spans)"\s*:|"resource_(logs|spans)"\s*:/.test(head)) return 'otlp'
  if (name.endsWith('.jsonl') || name.endsWith('.ndjson')) return 'jsonl'
  if (name.endsWith('.csv')) return 'csv'
  if (head.startsWith('[')) return 'json'
  if (head.startsWith('{')) {
    // A single JSON document vs. one object per line.
    const lines = head.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length > 1 && lines[0].trim().endsWith('}') && lines[1].trim().startsWith('{')) return 'jsonl'
    return 'json'
  }
  const first = head.split(/\r?\n/)[0] ?? ''
  if (name.endsWith('.json')) return 'json'
  if (first.includes(',') && /(time|timestamp|ts|date)/i.test(first) && !/\s{2,}/.test(first)) return 'csv'
  return 'text'
}

/* ----------------------------------------------------------------------- JSON */

function eventsArrayFromDocument(doc: unknown): unknown[] | null {
  if (Array.isArray(doc)) return doc
  if (doc && typeof doc === 'object') {
    for (const key of ['events', 'logs', 'records', 'items', 'data', 'entries']) {
      const v = (doc as Record<string, unknown>)[key]
      if (Array.isArray(v)) return v
    }
  }
  return null
}

export function parseJson(input: string): ParseResult {
  let doc: unknown
  try {
    doc = JSON.parse(input.replace(/^﻿/, ''))
  } catch (err) {
    return {
      records: [],
      errors: [{ line: 1, code: 'malformed_json', message: `Document is not valid JSON: ${(err as Error).message}`, excerpt: excerpt(input) }],
    }
  }
  const arr = eventsArrayFromDocument(doc)
  if (!arr) {
    return {
      records: [],
      errors: [{ line: 1, code: 'unsupported_structure', message: 'Expected an array of events, or an object with an "events"/"logs"/"records" array.', excerpt: excerpt(input) }],
    }
  }
  const records: RawRecord[] = []
  const errors: ParseError[] = []
  arr.forEach((item, i) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) records.push({ line: i + 1, fields: item as Record<string, unknown> })
    else errors.push({ line: i + 1, code: 'not_an_object', message: `Element ${i + 1} is ${Array.isArray(item) ? 'an array' : typeof item}, expected an object.`, excerpt: excerpt(JSON.stringify(item) ?? '') })
  })
  return { records, errors }
}

export function parseJsonl(input: string): ParseResult {
  const records: RawRecord[] = []
  const errors: ParseError[] = []
  splitLines(input).forEach((text, i) => {
    const line = i + 1
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      const v = JSON.parse(trimmed)
      if (v && typeof v === 'object' && !Array.isArray(v)) records.push({ line, fields: v })
      else errors.push({ line, code: 'not_an_object', message: 'Line is valid JSON but not an object.', excerpt: excerpt(trimmed) })
    } catch (err) {
      errors.push({ line, code: 'malformed_json', message: (err as Error).message, excerpt: excerpt(trimmed) })
    }
  })
  return { records, errors }
}

/* ------------------------------------------------------------------------ CSV */

/** RFC 4180 tokenizer: quoted fields, escaped quotes, embedded newlines. */
export function tokenizeCsv(input: string, delimiter = ','): Array<{ line: number; cells: string[] }> {
  const rows: Array<{ line: number; cells: string[] }> = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let rowStart = 1
  const s = input.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++ }
        else inQuotes = false
      } else {
        if (ch === '\n') line++
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell === '') { inQuotes = true; continue }
    if (ch === delimiter) { cells.push(cell); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') {
      cells.push(cell)
      rows.push({ line: rowStart, cells })
      cells = []
      cell = ''
      line++
      rowStart = line
      continue
    }
    cell += ch
  }
  if (cell !== '' || cells.length) {
    cells.push(cell)
    rows.push({ line: rowStart, cells })
  }
  return rows
}

export function parseCsv(input: string): ParseResult {
  const firstLine = input.replace(/^﻿/, '').split(/\r?\n/)[0] ?? ''
  const delimiter = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ','
  const rows = tokenizeCsv(input, delimiter).filter((r) => r.cells.some((c) => c.trim() !== ''))
  if (rows.length === 0) return { records: [], errors: [] }
  const header = rows[0].cells.map((h) => h.trim())
  const records: RawRecord[] = []
  const errors: ParseError[] = []
  for (const row of rows.slice(1)) {
    if (row.cells.length !== header.length) {
      errors.push({
        line: row.line,
        code: 'csv_column_mismatch',
        message: `Expected ${header.length} columns (${header.join(', ')}), found ${row.cells.length}.`,
        excerpt: excerpt(row.cells.join(delimiter)),
      })
      continue
    }
    const fields: Record<string, unknown> = {}
    header.forEach((h, i) => {
      const v = row.cells[i]
      if (v !== '') fields[h] = v
    })
    records.push({ line: row.line, fields, raw: row.cells.join(delimiter) })
  }
  return { records, errors }
}

/* ----------------------------------------------------------------------- text */

/**
 * Plain-text log rules, tried in order. Each documented in docs/NORMALIZATION.md.
 *   1. `<ISO-ts> [LEVEL] service: message key=value ...`
 *   2. `<ISO-ts> LEVEL service message ...`
 *   3. Common log format (NGINX/Apache access logs)
 *   4. Syslog `Mon DD HH:MM:SS host service[pid]: message`
 * Trailing `key=value` / `key="quoted value"` pairs become metadata.
 */
const TEXT_RULES: Array<{ name: string; re: RegExp; map: (m: RegExpExecArray) => Record<string, unknown> }> = [
  {
    name: 'bracket_level',
    re: /^(\S+(?:[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)\s+\[(\w+)\]\s+([\w.@/-]+):\s+(.*)$/,
    map: (m) => ({ timestamp: m[1], level: m[2], service: m[3], message: m[4] }),
  },
  {
    name: 'plain_level',
    re: /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|CRIT)\s+([\w.@/-]+)\s+[-:]?\s*(.*)$/i,
    map: (m) => ({ timestamp: m[1], level: m[2], service: m[3], message: m[4] }),
  },
  {
    name: 'common_log',
    re: /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d{3}) (\d+|-)(?: "[^"]*" "[^"]*")?(?: (\d+(?:\.\d+)?))?/,
    map: (m) => {
      const status = Number(m[5])
      return {
        timestamp: m[2],
        host: m[1],
        service: 'http-access',
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        message: `${m[3]} ${m[4]} -> ${m[5]}`,
        http_method: m[3],
        http_path: m[4],
        http_status: status,
        ...(m[7] ? { duration_ms: Math.round(Number(m[7]) * 1000) } : {}),
      }
    },
  },
  {
    name: 'syslog',
    re: /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([\w.-]+)(?:\[\d+\])?:\s+(.*)$/,
    map: (m) => ({ timestamp: m[1], host: m[2], service: m[3], message: m[4] }),
  },
]

const KV_RE = /(\w[\w.-]*)=("(?:[^"\\]|\\.)*"|\S+)/g

function extractKeyValues(message: string): { message: string; kv: Record<string, string> } {
  const kv: Record<string, string> = {}
  // Only treat a trailing run of key=value tokens as structured fields.
  const match = /((?:\s+\w[\w.-]*=(?:"(?:[^"\\]|\\.)*"|\S+))+)\s*$/.exec(` ${message}`)
  if (!match) return { message, kv }
  const tail = match[1]
  let m: RegExpExecArray | null
  KV_RE.lastIndex = 0
  while ((m = KV_RE.exec(tail))) kv[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\"/g, '"') : m[2]
  const stripped = ` ${message}`.slice(0, match.index).trim()
  return { message: stripped || message, kv }
}

export function parseText(input: string): ParseResult {
  const records: RawRecord[] = []
  const errors: ParseError[] = []
  const lines = splitLines(input)
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    const line = i + 1
    if (!text.trim()) continue
    // Stack-trace continuation lines attach to the previous record.
    if (/^\s+(at |\.\.\.|Caused by:)|^\s{4,}\S/.test(text) && records.length > 0) {
      const prev = records[records.length - 1]
      const stack = typeof prev.fields.stack === 'string' ? `${prev.fields.stack}\n` : ''
      prev.fields.stack = `${stack}${text.trim()}`
      continue
    }
    let matched = false
    for (const rule of TEXT_RULES) {
      const m = rule.re.exec(text)
      if (!m) continue
      const fields = rule.map(m)
      if (typeof fields.message === 'string') {
        const { message, kv } = extractKeyValues(fields.message)
        Object.assign(fields, kv, { message })
      }
      fields.__rule = rule.name
      records.push({ line, fields, raw: text })
      matched = true
      break
    }
    if (!matched) errors.push({ line, code: 'unparseable_line', message: 'Line matched no documented text-log rule (see docs/NORMALIZATION.md).', excerpt: excerpt(text) })
  }
  return { records, errors }
}

/* ----------------------------------------------------------------------- OTLP */

type OtlpAny = Record<string, unknown>

function pick(o: OtlpAny | undefined, camel: string, snake: string): unknown {
  if (!o) return undefined
  return o[camel] ?? o[snake]
}

/** Flattens an OTLP AnyValue (`{stringValue: ...}` etc.) to a primitive. */
export function otlpValue(v: unknown): string | number | boolean | null {
  if (!v || typeof v !== 'object') return (v as string | number | boolean | null) ?? null
  const o = v as OtlpAny
  const s = pick(o, 'stringValue', 'string_value')
  if (s !== undefined) return String(s)
  const b = pick(o, 'boolValue', 'bool_value')
  if (b !== undefined) return Boolean(b)
  const n = pick(o, 'intValue', 'int_value')
  if (n !== undefined) return Number(n)
  const d = pick(o, 'doubleValue', 'double_value')
  if (d !== undefined) return Number(d)
  const arr = pick(o, 'arrayValue', 'array_value') as OtlpAny | undefined
  if (arr) return JSON.stringify(((arr.values as unknown[]) ?? []).map(otlpValue))
  const kv = pick(o, 'kvlistValue', 'kvlist_value') as OtlpAny | undefined
  if (kv) return JSON.stringify(attributesToObject(kv.values as unknown[]))
  const bytes = pick(o, 'bytesValue', 'bytes_value')
  if (bytes !== undefined) return String(bytes)
  return null
}

function attributesToObject(attrs: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  if (!Array.isArray(attrs)) return out
  for (const a of attrs) {
    if (a && typeof a === 'object' && typeof (a as OtlpAny).key === 'string') out[(a as OtlpAny).key as string] = otlpValue((a as OtlpAny).value)
  }
  return out
}

const STATUS_ERROR = new Set([2, '2', 'STATUS_CODE_ERROR', 'ERROR'])

export function parseOtlp(input: string): ParseResult {
  let doc: OtlpAny
  try {
    doc = JSON.parse(input.replace(/^﻿/, ''))
  } catch (err) {
    return { records: [], errors: [{ line: 1, code: 'malformed_json', message: `OTLP export is not valid JSON: ${(err as Error).message}`, excerpt: excerpt(input) }] }
  }
  const records: RawRecord[] = []
  const errors: ParseError[] = []
  let index = 0

  const resourceLogs = (pick(doc, 'resourceLogs', 'resource_logs') as OtlpAny[] | undefined) ?? []
  for (const rl of resourceLogs) {
    const resAttrs = attributesToObject((rl.resource as OtlpAny | undefined)?.attributes)
    const scopes = (pick(rl, 'scopeLogs', 'scope_logs') as OtlpAny[] | undefined) ?? []
    for (const sl of scopes) {
      for (const lr of ((pick(sl, 'logRecords', 'log_records') as OtlpAny[] | undefined) ?? [])) {
        index++
        const attrs = attributesToObject(lr.attributes)
        records.push({
          line: index,
          hints: { severityScale: 'otel' },
          fields: {
            ...attrs,
            timestamp: pick(lr, 'timeUnixNano', 'time_unix_nano') || pick(lr, 'observedTimeUnixNano', 'observed_time_unix_nano'),
            severity: pick(lr, 'severityNumber', 'severity_number') ?? pick(lr, 'severityText', 'severity_text'),
            message: otlpValue(lr.body) ?? pick(lr, 'eventName', 'event_name') ?? '',
            trace_id: pick(lr, 'traceId', 'trace_id') || undefined,
            span_id: pick(lr, 'spanId', 'span_id') || undefined,
            service: resAttrs['service.name'] ?? attrs['service.name'],
            environment: resAttrs['deployment.environment'] ?? resAttrs['deployment.environment.name'],
            host: resAttrs['host.name'],
            region: resAttrs['cloud.region'],
            deployment_id: resAttrs['service.version'],
          },
        })
      }
    }
  }

  const resourceSpans = (pick(doc, 'resourceSpans', 'resource_spans') as OtlpAny[] | undefined) ?? []
  for (const rs of resourceSpans) {
    const resAttrs = attributesToObject((rs.resource as OtlpAny | undefined)?.attributes)
    const scopes = (pick(rs, 'scopeSpans', 'scope_spans') as OtlpAny[] | undefined) ?? []
    for (const ss of scopes) {
      for (const span of ((ss.spans as OtlpAny[] | undefined) ?? [])) {
        index++
        const attrs = attributesToObject(span.attributes)
        const start = pick(span, 'startTimeUnixNano', 'start_time_unix_nano')
        const end = pick(span, 'endTimeUnixNano', 'end_time_unix_nano')
        const status = (span.status as OtlpAny | undefined) ?? {}
        const isError = STATUS_ERROR.has(status.code as string | number)
        let durationMs: number | undefined
        if (typeof start === 'string' && typeof end === 'string' && /^\d+$/.test(start) && /^\d+$/.test(end)) {
          durationMs = Number((BigInt(end) - BigInt(start)) / 1000n) / 1000
        } else if (typeof start === 'number' && typeof end === 'number') {
          durationMs = (end - start) / 1e6
        }
        const name = String(span.name ?? 'span')
        records.push({
          line: index,
          hints: { type: 'span' },
          fields: {
            ...attrs,
            timestamp: start,
            duration_ms: durationMs,
            severity: isError ? 'error' : 'info',
            message: isError && status.message ? `${name}: ${status.message}` : name,
            trace_id: pick(span, 'traceId', 'trace_id') || undefined,
            span_id: pick(span, 'spanId', 'span_id') || undefined,
            parent_span_id: pick(span, 'parentSpanId', 'parent_span_id') || undefined,
            service: resAttrs['service.name'],
            environment: resAttrs['deployment.environment'] ?? resAttrs['deployment.environment.name'],
            host: resAttrs['host.name'],
            region: resAttrs['cloud.region'],
            deployment_id: resAttrs['service.version'],
            'span.status': isError ? 'error' : 'ok',
          },
        })
      }
    }
  }

  if (resourceLogs.length === 0 && resourceSpans.length === 0) {
    errors.push({ line: 1, code: 'unsupported_structure', message: 'No resourceLogs or resourceSpans found in OTLP export.', excerpt: excerpt(input) })
  }
  return { records, errors }
}

export function parseByFormat(format: SourceFormat, input: string): ParseResult {
  switch (format) {
    case 'json': return parseJson(input)
    case 'jsonl': return parseJsonl(input)
    case 'csv': return parseCsv(input)
    case 'text': return parseText(input)
    case 'otlp': return parseOtlp(input)
    default:
      return { records: [], errors: [{ line: 1, code: 'unsupported_structure', message: `Format ${format} has no parser.`, excerpt: '' }] }
  }
}
