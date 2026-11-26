# Event normalization

Source: `packages/engine/src/normalize/`. Entry point: `normalizeSource(input, options)`.

Every source file, whatever its format, becomes a list of **canonical events** plus an **import report**. Nothing is silently discarded: a record that cannot be normalized appears in the report with its line number, an error code, and an excerpt.

## Supported formats

| Format | Detection | Notes |
| --- | --- | --- |
| JSON | starts with `[`, or `.json` | An array of objects, or an object with an `events`, `logs`, `records`, `items`, `data`, or `entries` array. |
| JSONL / NDJSON | `.jsonl` / `.ndjson`, or one object per line | Each line parsed independently; a bad line never poisons the rest. |
| CSV / TSV | `.csv`, or a header row containing a time column | RFC 4180: quoted fields, escaped quotes (`""`), embedded newlines. Tab-delimited when the header has more tabs than commas. |
| Plain text | anything else | The documented rules below. |
| OpenTelemetry (OTLP JSON) | `resourceLogs` / `resourceSpans` keys | Log records and spans, camelCase or snake_case keys, nanosecond strings, `status.code` as number or enum string. |

### Plain-text rules (first match wins)

1. `<ISO time> [LEVEL] service: message key=value ...`
2. `<ISO time> LEVEL service - message ...`
3. NGINX/Apache common or combined log format; status `>= 500` is an error, `>= 400` a warning; a trailing request time becomes `durationMs`.
4. Syslog `Mon DD HH:MM:SS host service[pid]: message` (requires a reference year; flagged `syslog_year_assumed`).

Trailing `key=value` or `key="quoted value"` pairs become metadata. Indented lines, `Caused by:` lines, Python `Traceback` headers, and Java-style `pkg.Name(Exception|Error):` lines attach to the previous record's `stack`.

## The canonical event

```ts
interface CanonicalEvent {
  id: string            // stable, content-derived
  incidentId: string
  ts: number            // UTC epoch milliseconds
  durationMs?: number
  source: string; service: string; environment: string
  severity: 'debug' | 'info' | 'warn' | 'error' | 'critical'
  type: EventType       // deploy, error, timeout, retry, saturation, ...
  message: string
  traceId?, spanId?, parentSpanId?, requestId?, deploymentId?, host?, region?
  metadata: Record<string, string | number | boolean | null>
  sourceRef: { sourceId, sourceName, line, format }   // provenance
  flags?: string[]      // e.g. assumed_utc, service_defaulted, redacted
}
```

Field mapping uses an alias table (`FIELD_ALIASES` in `fields.ts`), case-insensitive with dotted paths into nested objects. A caller-supplied `mapping` overrides the aliases per field (used for CSVs with unusual headers).

## Timestamps

All timestamps become UTC epoch milliseconds. The host timezone is never consulted.

- RFC 3339 with `Z` or an offset: exact.
- No zone (`2026-10-14 17:04:10`): treated as UTC and flagged `assumed_utc`.
- Epoch numbers: unit inferred by magnitude (`< 1e11` seconds, `< 1e14` ms, `< 1e17` µs, otherwise ns). Nanosecond strings are split to avoid float precision loss.
- Common log format, RFC 2822, and syslog (with reference year).
- Impossible dates (`2026-02-31`) and anything outside 1990–2200 are rejected, not guessed.

## Severity and type

Severity accepts words (`WARNING`, `Fatal`), syslog levels 1–7, and OTel `SeverityNumber` 1–24 (OTLP sources are parsed on the OTel scale). When no level is present, a conservative keyword rule infers one and the event is flagged `severity_inferred`.

The event type comes from an explicit field when it names a known type, otherwise from ordered keyword rules (rollback before deploy, circuit breakers, pool saturation, timeouts, retries, alerts, recovery, latency, errors). The rules are in `fields.ts` and covered by tests.

## Identity, duplicates, ordering

- **Stable ids.** `id = hash(incidentId, fingerprint)` where the fingerprint is time, service, severity, type, message, trace, span, and request. Re-importing the same evidence produces the same ids, which makes ingestion idempotent.
- **Duplicates.** Two records with the same fingerprint are duplicates even if they came from different lines. The first is kept; every duplicate is listed with the id it duplicates.
- **Ordering.** Deterministic total order: time, then source id, then source line, then id (`compareEvents`). Unsorted input is fine.
- **Late arrival.** `mergeEvents(existing, incoming)` unions by id and re-sorts; the original array is never mutated.

## Safety

- **Limits** (defaults): 10 MiB per source, 20,000 records, 2,000-character messages, 40 metadata keys. Overflow is reported, never silent.
- **Redaction** runs before anything is persisted: JWTs, bearer/basic tokens, AWS access keys, GitHub tokens, `sk_live_`-style keys, `password=`/`token=`/`api_key=` values, emails, Luhn-valid card numbers, and PEM private keys. Metadata keys named like secrets (`password`, `authorization`, `cookie`, ...) are replaced wholesale. The unredacted original exists only in the uploader's private file storage.
- **Cancellation** is checked every 500 records via an `AbortSignal`-compatible object.
- Content is data, never markup: the UI renders messages as text, so `<script>` in a log line stays inert.

## Error codes

`malformed_json`, `not_an_object`, `csv_column_mismatch`, `unparseable_line`, `unsupported_structure`, `missing_timestamp`, `invalid_timestamp`, `missing_message`, `too_many_records`, `source_too_large`.
