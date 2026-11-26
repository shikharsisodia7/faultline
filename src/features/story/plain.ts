import type { Comparison, RunResult, Sample } from '@faultline/engine'

const WORDS: Record<string, string> = {
  svc: '', db: 'database', api: 'API', gateway: 'gateway', ai: 'AI', mq: 'queue',
}

/** "pricing-db" → "Pricing database", "edge-gateway" → "Edge gateway". */
export function friendlyName(id: string, labels?: Record<string, { name: string }>): string {
  if (labels?.[id]) return labels[id].name
  const parts = id.split(/[-_]/).map((w) => (w in WORDS ? WORDS[w] : w)).filter(Boolean)
  const s = parts.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function pctText(x: number): string {
  if (x > 0 && x < 0.001) return 'under 0.1%'
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`
}

export function durationText(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return 'did not recover'
  if (sec < 60) return `${Math.round(sec)} seconds`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s ? `${m} min ${s} s` : `${m} min`
}

export function recoveryText(r: RunResult): string {
  if (r.summary.onsetSec === null) return 'No outage'
  return r.summary.recovered ? durationText(r.summary.timeToRecoverySec) : 'Did not recover'
}

/** Cumulative successes/failures up to simulation second `t`. */
export function totalsAt(samples: readonly Sample[], t: number): { ok: number; failed: number; rate: number } {
  let ok = 0
  let failed = 0
  let rate = 0
  for (const s of samples) {
    if (s.t > t) break
    ok += s.succeeded
    failed += s.failed + s.rateLimited
    rate = s.errorRate
  }
  return { ok, failed, rate }
}

/**
 * A plain-language summary of a counterfactual comparison. Every number in the
 * sentence comes from the two runs; the wording follows the measured verdict,
 * including when the decision made things worse.
 */
export function explainOutcome(base: RunResult, branch: RunResult, cmp: Comparison, decision: string, atSec: number): string {
  const b = base.summary
  const r = branch.summary
  const when = `at ${Math.floor(atSec / 60)}:${String(atSec % 60).padStart(2, '0')}`
  const failedBase = b.failed + b.rateLimited
  const failedBranch = r.failed + r.rateLimited
  const diff = failedBase - failedBranch
  const rec = r.onsetSec === null ? 'there was no outage at all' : r.recovered ? `service recovered after ${durationText(r.timeToRecoverySec)}` : 'service never fully recovered in the window'
  const recBase = b.onsetSec === null ? 'there was no outage' : b.recovered ? `it took ${durationText(b.timeToRecoverySec)}` : 'it never fully recovered'
  switch (cmp.overall) {
    case 'better':
      return `In this simulation, choosing to ${decision.toLowerCase()} ${when} avoided about ${Math.abs(diff).toLocaleString()} failed requests (${pctText(b.successRate)} → ${pctText(r.successRate)} succeeded), and ${rec}. Originally ${recBase}.`
    case 'worse':
      return `In this simulation, choosing to ${decision.toLowerCase()} ${when} made things worse: about ${Math.abs(diff).toLocaleString()} more requests failed (${pctText(b.successRate)} → ${pctText(r.successRate)} succeeded), and ${rec}.`
    case 'mixed':
      return `This decision helped in some ways and hurt in others. Successful requests went from ${pctText(b.successRate)} to ${pctText(r.successRate)}, and ${rec}. Look at the timeline to see where the two paths differ.`
    default:
      return `This decision made almost no difference in the model: ${pctText(b.successRate)} versus ${pctText(r.successRate)} of requests succeeded. The bottleneck it targets was not the one limiting the system.`
  }
}
