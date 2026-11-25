/**
 * Timestamp normalization to UTC epoch milliseconds.
 *
 * Accepted inputs (documented in docs/NORMALIZATION.md):
 *  - ISO 8601 / RFC 3339 with `Z` or a numeric offset (fractional seconds to ns)
 *  - ISO-like `YYYY-MM-DD HH:MM:SS[.fff]` with no zone   -> assumed UTC (flagged)
 *  - Epoch numbers or numeric strings, unit inferred by magnitude:
 *      < 1e11 seconds, < 1e14 milliseconds, < 1e17 microseconds, else nanoseconds
 *  - Apache/NGINX common log format `25/Nov/2026:15:04:05 +0000`
 *  - RFC 2822 `Wed, 25 Nov 2026 15:04:05 GMT`
 *  - Syslog `Nov 25 15:04:05` (no year) only when a reference year is supplied -> flagged
 *
 * Anything else is rejected rather than guessed. A parse never consults the
 * host's local timezone, so results are identical on every machine.
 */

export interface ParsedTime {
  ts: number
  flags: string[]
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

const MIN_TS = Date.UTC(1990, 0, 1)
const MAX_TS = Date.UTC(2200, 0, 1)

function inRange(ts: number): boolean {
  return Number.isFinite(ts) && ts >= MIN_TS && ts <= MAX_TS
}

function fromEpochNumber(n: number): ParsedTime | null {
  if (!Number.isFinite(n) || n <= 0) return null
  let ms: number
  let unit: string
  if (n < 1e11) { ms = n * 1000; unit = 's' }
  else if (n < 1e14) { ms = n; unit = 'ms' }
  else if (n < 1e17) { ms = n / 1000; unit = 'us' }
  else { ms = n / 1e6; unit = 'ns' }
  ms = Math.round(ms * 1000) / 1000
  return inRange(ms) ? { ts: ms, flags: unit === 'ms' ? [] : [`epoch_${unit}`] } : null
}

/** Parses nanosecond epoch strings without losing precision to float rounding. */
function fromBigEpochString(s: string): ParsedTime | null {
  if (!/^\d{1,20}$/.test(s)) return null
  if (s.length >= 17) {
    // nanoseconds: keep millisecond precision with 3 decimal digits of sub-ms
    const ms = Number(s.slice(0, s.length - 6)) + Number(s.slice(s.length - 6, s.length - 3)) / 1000
    return inRange(ms) ? { ts: ms, flags: ['epoch_ns'] } : null
  }
  return fromEpochNumber(Number(s))
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?|UTC|GMT)?$/

function parseIso(s: string): ParsedTime | null {
  const m = ISO_RE.exec(s)
  if (!m) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (d) {
      const ts = Date.UTC(+d[1], +d[2] - 1, +d[3])
      return inRange(ts) ? { ts, flags: ['date_only', 'assumed_utc'] } : null
    }
    return null
  }
  const [, y, mo, da, h, mi, se, frac, zone] = m
  const month = +mo - 1
  const day = +da
  if (month < 0 || month > 11 || day < 1 || day > 31 || +h > 23 || +mi > 59 || (se && +se > 60)) return null
  const fracMs = frac ? Number(`0.${frac}`) * 1000 : 0
  let ts = Date.UTC(+y, month, day, +h, +mi, se ? +se : 0) + fracMs
  const flags: string[] = []
  if (!zone) {
    flags.push('assumed_utc')
  } else if (zone !== 'Z' && zone !== 'z' && zone !== 'UTC' && zone !== 'GMT') {
    const zm = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone)
    if (!zm) return null
    const offset = (+zm[2] * 60 + (zm[3] ? +zm[3] : 0)) * 60_000
    ts += zm[1] === '+' ? -offset : offset
  }
  // Reject impossible calendar dates (e.g. 2026-02-31) that Date.UTC rolls over.
  const check = new Date(Date.UTC(+y, month, day))
  if (check.getUTCDate() !== day) return null
  ts = Math.round(ts * 1000) / 1000
  return inRange(ts) ? { ts, flags } : null
}

const CLF_RE = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*([+-]\d{4})$/

function parseClf(s: string): ParsedTime | null {
  const m = CLF_RE.exec(s)
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  if (month === undefined) return null
  const off = m[8]
  const iso = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? `.${m[7]}` : ''}${off.slice(0, 3)}:${off.slice(3)}`
  return parseIso(iso)
}

const RFC2822_RE =
  /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*(GMT|UTC|Z|[+-]\d{4})$/

function parseRfc2822(s: string): ParsedTime | null {
  const m = RFC2822_RE.exec(s)
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  if (month === undefined) return null
  const zone = m[7] === 'GMT' || m[7] === 'UTC' ? 'Z' : m[7] === 'Z' ? 'Z' : `${m[7].slice(0, 3)}:${m[7].slice(3)}`
  return parseIso(
    `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4]}:${m[5]}:${m[6] ?? '00'}${zone}`,
  )
}

const SYSLOG_RE = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/

function parseSyslog(s: string, referenceYear?: number): ParsedTime | null {
  if (referenceYear === undefined) return null
  const m = SYSLOG_RE.exec(s)
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase()]
  if (month === undefined) return null
  const r = parseIso(
    `${referenceYear}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}T${m[3]}:${m[4]}:${m[5]}${m[6] ? `.${m[6]}` : ''}Z`,
  )
  return r ? { ts: r.ts, flags: ['syslog_year_assumed', 'assumed_utc'] } : null
}

export function parseTimestamp(value: unknown, opts: { referenceYear?: number } = {}): ParsedTime | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return fromEpochNumber(value)
  if (value instanceof Date) return inRange(value.getTime()) ? { ts: value.getTime(), flags: [] } : null
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (s === '') return null
  if (/^\d+(\.\d+)?$/.test(s)) return s.includes('.') ? fromEpochNumber(Number(s)) : fromBigEpochString(s)
  return parseIso(s) ?? parseClf(s) ?? parseRfc2822(s) ?? parseSyslog(s, opts.referenceYear)
}

export function toIso(ts: number): string {
  return new Date(ts).toISOString()
}

/** `HH:MM:SS.mmm` in UTC, for compact timeline labels. */
export function clock(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23)
}
