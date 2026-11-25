import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTimestamp } from '../util/time'
import { ImportTooLargeError, mergeEvents, normalizeSource } from './normalize'
import { detectFormat, tokenizeCsv } from './parsers'
import { redactText } from './redact'
import { normalizeSeverity } from './fields'

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'fixtures', name), 'utf8')
const opts = (sourceName: string) => ({ incidentId: 'inc-1', sourceId: 'src-1', sourceName })

describe('parseTimestamp', () => {
  it('parses RFC 3339 with Z and offsets to the same UTC instant', () => {
    expect(parseTimestamp('2026-10-14T17:04:10Z')!.ts).toBe(Date.UTC(2026, 9, 14, 17, 4, 10))
    expect(parseTimestamp('2026-10-14T19:04:10+02:00')!.ts).toBe(Date.UTC(2026, 9, 14, 17, 4, 10))
    expect(parseTimestamp('2026-10-14T12:04:10-0500')!.ts).toBe(Date.UTC(2026, 9, 14, 17, 4, 10))
  })
  it('keeps sub-millisecond precision from nanosecond fractions', () => {
    expect(parseTimestamp('2026-10-14T17:04:10.123456789Z')!.ts).toBeCloseTo(Date.UTC(2026, 9, 14, 17, 4, 10) + 123.457, 3)
  })
  it('flags zone-less timestamps as assumed UTC instead of using the host zone', () => {
    const r = parseTimestamp('2026-10-14 17:04:10')!
    expect(r.ts).toBe(Date.UTC(2026, 9, 14, 17, 4, 10))
    expect(r.flags).toContain('assumed_utc')
  })
  it('infers epoch units by magnitude', () => {
    const ms = Date.UTC(2026, 9, 14, 17, 4, 10)
    expect(parseTimestamp(ms / 1000)!.ts).toBe(ms)
    expect(parseTimestamp(ms)!.ts).toBe(ms)
    expect(parseTimestamp(ms * 1000)!.ts).toBe(ms)
    expect(parseTimestamp(`${ms}000000`)!.ts).toBe(ms)
    expect(parseTimestamp(`${ms}000000`)!.flags).toContain('epoch_ns')
  })
  it('parses common log format, RFC 2822, and syslog with a reference year', () => {
    expect(parseTimestamp('14/Oct/2026:17:04:10 +0000')!.ts).toBe(Date.UTC(2026, 9, 14, 17, 4, 10))
    expect(parseTimestamp('Wed, 14 Oct 2026 17:04:10 GMT')!.ts).toBe(Date.UTC(2026, 9, 14, 17, 4, 10))
    expect(parseTimestamp('Oct 14 17:04:10')).toBeNull()
    expect(parseTimestamp('Oct 14 17:04:10', { referenceYear: 2026 })!.flags).toContain('syslog_year_assumed')
  })
  it('rejects impossible and garbage values rather than guessing', () => {
    for (const v of ['2026-02-31T00:00:00Z', '2026-13-01T00:00:00Z', 'yesterday', '', '12', -5, null, undefined, {}]) {
      expect(parseTimestamp(v as never)).toBeNull()
    }
  })
})

describe('normalizeSeverity', () => {
  it('maps words, syslog levels, and OTel severity numbers', () => {
    expect(normalizeSeverity('WARNING')).toBe('warn')
    expect(normalizeSeverity('Fatal')).toBe('critical')
    expect(normalizeSeverity(3)).toBe('error')
    expect(normalizeSeverity(17, 'otel')).toBe('error')
    expect(normalizeSeverity(9, 'otel')).toBe('info')
    expect(normalizeSeverity('nonsense')).toBeUndefined()
  })
})

describe('detectFormat', () => {
  it('detects each supported format', () => {
    expect(detectFormat(fixture('mixed.jsonl'), 'mixed.jsonl')).toBe('jsonl')
    expect(detectFormat(fixture('events.csv'))).toBe('csv')
    expect(detectFormat(fixture('app.log'))).toBe('text')
    expect(detectFormat(fixture('otlp-traces.json'))).toBe('otlp')
    expect(detectFormat('[{"a":1}]')).toBe('json')
  })
})

describe('normalizeSource: JSONL with malformed records', () => {
  const r = normalizeSource(fixture('mixed.jsonl'), opts('mixed.jsonl'))

  it('isolates every malformed record with its line number instead of dropping it silently', () => {
    const codes = r.errors.map((e) => [e.line, e.code])
    expect(codes).toEqual([
      [4, 'malformed_json'],
      [5, 'invalid_timestamp'],
      [6, 'missing_timestamp'],
      [9, 'not_an_object'],
    ])
    expect(r.stats.rejected).toBe(4)
  })

  it('detects the duplicate line and reports which event it duplicates', () => {
    expect(r.duplicates).toHaveLength(1)
    expect(r.duplicates[0].line).toBe(7)
    expect(r.events.some((e) => e.id === r.duplicates[0].duplicateOf)).toBe(true)
  })

  it('sorts unsorted input deterministically by time', () => {
    const ts = r.events.map((e) => e.ts)
    expect(ts).toEqual(ts.slice().sort((a, b) => a - b))
    // 17:04:11+02:00 is 15:04:11Z, the earliest instant in the file.
    expect(r.events[0].message).toMatch(/^retrying checkout/)
    expect(r.events[1].type).toBe('deploy')
  })

  it('normalizes offsets to UTC and flags assumptions', () => {
    const gw = r.events.find((e) => e.message.startsWith('retrying checkout'))!
    expect(gw.ts).toBe(Date.UTC(2026, 9, 14, 15, 4, 11))
    const missing = r.events.find((e) => e.message.startsWith('service missing'))!
    expect(missing.service).toBe('unknown')
    expect(missing.flags).toEqual(expect.arrayContaining(['service_defaulted', 'assumed_utc']))
    expect(missing.severity).toBe('warn')
  })

  it('redacts secrets and emails before anything is persisted', () => {
    const gw = r.events.find((e) => e.message.startsWith('retrying checkout'))!
    expect(gw.message).not.toContain('hunter2')
    expect(gw.message).not.toContain('jane@example.com')
    expect(gw.flags).toContain('redacted')
    expect(r.stats.redactions).toBeGreaterThanOrEqual(2)
  })

  it('maps canonical fields and keeps provenance', () => {
    const e = r.events.find((x) => x.traceId)!
    expect(e).toMatchObject({ service: 'checkout-svc', traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', requestId: 'req-91', type: 'timeout' })
    expect(e.sourceRef).toMatchObject({ sourceId: 'src-1', sourceName: 'mixed.jsonl', line: 1, format: 'jsonl' })
  })

  it('is idempotent: re-importing the same evidence yields identical ids', () => {
    const again = normalizeSource(fixture('mixed.jsonl'), opts('mixed.jsonl'))
    expect(again.events.map((e) => e.id)).toEqual(r.events.map((e) => e.id))
    const merged = mergeEvents(r.events, again.events)
    expect(merged.added).toBe(0)
    expect(merged.duplicates).toBe(r.events.length)
  })
})

describe('normalizeSource: CSV', () => {
  const r = normalizeSource(fixture('events.csv'), opts('events.csv'))
  it('handles quoted delimiters, escaped quotes, and embedded newlines', () => {
    expect(r.events.map((e) => e.message)).toContain('Deploy pricing-svc v2.14.0, rolling 30%')
    expect(r.events.map((e) => e.message)).toContain('pricing call failed: "timeout"')
    expect(r.events.map((e) => e.message)).toContain('multi\nline message')
  })
  it('reports column-count mismatches with the line number', () => {
    expect(r.errors).toEqual([expect.objectContaining({ line: 5, code: 'csv_column_mismatch' })])
  })
  it('resolves aliased headers (svc, msg, trace)', () => {
    const e = r.events.find((x) => x.service === 'pricing-db')!
    expect(e.traceId).toBe('abc123')
    expect(e.type).toBe('saturation')
  })
  it('honors an explicit mapping over aliases', () => {
    const mapped = normalizeSource('when,who,what\n2026-10-14T17:04:10Z,api,boom failed\n', { ...opts('x.csv'), format: 'csv', mapping: { timestamp: 'when', service: 'who', message: 'what' } })
    expect(mapped.events[0]).toMatchObject({ service: 'api', message: 'boom failed', severity: 'error' })
  })
  it('tokenizes RFC 4180 edge cases', () => {
    expect(tokenizeCsv('a,"b,c","d""e"\n1,,3').map((r) => r.cells)).toEqual([['a', 'b,c', 'd"e'], ['1', '', '3']])
  })
})

describe('normalizeSource: plain text', () => {
  const r = normalizeSource(fixture('app.log'), { ...opts('app.log'), referenceYear: 2026 })
  it('applies each documented text rule', () => {
    expect(r.events.map((e) => e.service).sort()).toEqual(['checkout-svc', 'edge-gateway', 'http-access', 'pricing-db', 'pricing-svc'])
    const access = r.events.find((e) => e.service === 'http-access')!
    expect(access).toMatchObject({ severity: 'error', durationMs: 1502 })
  })
  it('extracts trailing key=value metadata and attaches stack traces', () => {
    const co = r.events.find((e) => e.service === 'checkout-svc')!
    expect(co.traceId).toBe('4bf92f35')
    expect(co.requestId).toBe('req-91')
    expect(String(co.metadata.stack)).toContain('java.lang.RuntimeException: timeout')
    expect(String(co.metadata.stack)).toContain('Checkout.java:88')
    const db = r.events.find((e) => e.service === 'pricing-db')!
    expect(db.metadata).toMatchObject({ in_use: '14', waiting: '40' })
  })
  it('reports lines that match no rule', () => {
    expect(r.errors).toEqual([expect.objectContaining({ code: 'unparseable_line', line: 9 })])
  })
})

describe('normalizeSource: OTLP JSON', () => {
  const r = normalizeSource(fixture('otlp-traces.json'), opts('otlp.json'))
  it('flattens spans and log records with resource attributes', () => {
    expect(r.stats.format).toBe('otlp')
    expect(r.events).toHaveLength(3)
    const child = r.events.find((e) => e.service === 'pricing-svc')!
    expect(child).toMatchObject({ type: 'span', severity: 'error', parentSpanId: '00f067aa0ba902b7' })
    expect(child.durationMs).toBe(1500)
    const log = r.events.find((e) => e.service === 'pricing-db')!
    expect(log.severity).toBe('error')
    expect(log.metadata['pool.in_use']).toBe(14)
    expect(r.events.find((e) => e.service === 'checkout-svc')!.deploymentId).toBe('v5.2.0')
  })
})

describe('limits, invalid input, cancellation', () => {
  it('rejects an oversized source before parsing', () => {
    expect(() => normalizeSource('x'.repeat(2048), { ...opts('big.log'), limits: { maxBytes: 1024 } })).toThrow(ImportTooLargeError)
  })
  it('caps record count and reports the overflow', () => {
    const lines = Array.from({ length: 30 }, (_, i) => JSON.stringify({ ts: 1792083850000 + i, service: 'a', message: `m${i}` })).join('\n')
    const r = normalizeSource(lines, { ...opts('x.jsonl'), limits: { maxRecords: 10 } })
    expect(r.events).toHaveLength(10)
    expect(r.errors.some((e) => e.code === 'too_many_records')).toBe(true)
  })
  it('returns a structural error for a non-array JSON document', () => {
    const r = normalizeSource('{"hello":"world"}', { ...opts('x.json'), format: 'json' })
    expect(r.events).toHaveLength(0)
    expect(r.errors[0].code).toBe('unsupported_structure')
  })
  it('handles empty input', () => {
    const r = normalizeSource('', opts('empty.jsonl'))
    expect(r.events).toEqual([])
    expect(r.stats.timeRange).toBeNull()
  })
  it('aborts when the signal fires', () => {
    expect(() => normalizeSource(fixture('mixed.jsonl'), { ...opts('m.jsonl'), signal: { aborted: true } })).toThrow(/cancelled/)
  })
  it('treats script-like content as inert text', () => {
    const r = normalizeSource(JSON.stringify([{ ts: '2026-10-14T17:04:10Z', service: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script>' }]), opts('x.json'))
    expect(r.events[0].message).toBe('<script>alert(1)</script>')
    expect(r.events[0].service).toBe('<img-src=x-onerror=alert(1)>')
  })
  it('normalizes 20,000 records quickly and deterministically', () => {
    const lines: string[] = []
    for (let i = 0; i < 20_000; i++) lines.push(JSON.stringify({ ts: 1792083850000 + ((i * 7919) % 20_000) * 10, service: `svc-${i % 12}`, level: i % 17 === 0 ? 'error' : 'info', message: `request ${i} handled`, trace_id: `t${i % 500}` }))
    const t0 = performance.now()
    const r = normalizeSource(lines.join('\n'), opts('large.jsonl'))
    const elapsed = performance.now() - t0
    expect(r.events).toHaveLength(20_000)
    expect(elapsed).toBeLessThan(5_000)
  })
})

describe('redaction', () => {
  it('redacts tokens, keys, cards (Luhn only), and private keys', () => {
    // Fake credentials are assembled at runtime so scanners do not mistake the test for a leak.
    const awsKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')
    const stripeKey = ['sk', 'live', 'abcdefghijklmnop1234'].join('_')
    const s = `auth Bearer abcdefghijklmnopqrstuvwxyz012345 key ${awsKey} card 4111 1111 1111 1111 not-card 1234 5678 9012 3456 api_key=${stripeKey}`
    const r = redactText(s).text
    expect(r).not.toContain('abcdefghijklmnopqrstuvwxyz012345')
    expect(r).not.toContain(awsKey)
    expect(r).not.toContain('4111 1111 1111 1111')
    expect(r).toContain('1234 5678 9012 3456')
    expect(r).not.toContain(stripeKey)
  })
})
