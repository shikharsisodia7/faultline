/** Formatting helpers. All times render in UTC so investigators share one clock. */

export function relTime(ms: number): string {
  const sign = ms < 0 ? '-' : '+'
  const abs = Math.abs(ms)
  const m = Math.floor(abs / 60_000)
  const s = Math.floor((abs % 60_000) / 1000)
  const msPart = Math.floor(abs % 1000)
  return `T${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msPart).padStart(3, '0')}`
}

export function relTimeShort(ms: number): string {
  const abs = Math.abs(ms)
  const m = Math.floor(abs / 60_000)
  const s = Math.floor((abs % 60_000) / 1000)
  return `${ms < 0 ? '-' : '+'}${m}:${String(s).padStart(2, '0')}`
}

export function utcClock(ts: number, withMs = true): string {
  const iso = new Date(ts).toISOString()
  return withMs ? iso.slice(11, 23) : iso.slice(11, 19)
}

export function utcDateTime(ts: number): string {
  return `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}

export function num(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return x.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function ms(x: number | null | undefined): string {
  if (x === null || x === undefined) return '—'
  if (x >= 10_000) return `${(x / 1000).toFixed(1)} s`
  return `${Math.round(x)} ms`
}

export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—'
  if (sec < 60) return `${Math.round(sec)} s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function shortId(id: string | undefined, n = 8): string {
  if (!id) return ''
  return id.length > n + 2 ? `${id.slice(0, n)}…` : id
}

export function downloadText(filename: string, text: string, type = 'text/plain'): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
