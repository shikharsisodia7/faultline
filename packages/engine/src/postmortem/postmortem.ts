import type { Annotation, CanonicalEvent, IncidentDataset } from '../types'
import { SEVERITY_RANK } from '../types'
import type { Hypothesis } from '../correlate/hypotheses'
import { toIso } from '../util/time'

export const POSTMORTEM_VERSION = 'faultline-postmortem/1.0.0'

/** Human review state of a hypothesis. Only `confirmed` may be called a root cause. */
export type HypothesisReview = 'inferred' | 'supported' | 'rejected' | 'confirmed'

export interface SimulationFinding {
  label: string
  overall: 'better' | 'worse' | 'mixed' | 'same'
  branchAtSec: number
  summary: string
  assumptions: string[]
}

export interface PostmortemInput {
  dataset: IncidentDataset
  hypotheses: Hypothesis[]
  /** Human review per hypothesis id. Missing = inferred. */
  reviews?: Record<string, HypothesisReview>
  simulations?: SimulationFinding[]
  generatedAt?: number
}

export interface TimelineEntry {
  ts: number
  service: string
  kind: string
  text: string
  eventId?: string
  source: 'observed' | 'annotation'
}

export interface Postmortem {
  version: string
  incidentId: string
  title: string
  synthetic: boolean
  generatedAt: string
  executiveSummary: string
  duration: { startedAt: string | null; detectedAt: string | null; resolvedAt: string | null; durationSec: number | null; timeToDetectSec: number | null }
  impact: { affectedServices: string[]; errorEvents: number; criticalEvents: number; firstErrorService: string | null }
  timeline: TimelineEntry[]
  contributingFactors: string[]
  rootCauses: Array<{ title: string; status: HypothesisReview; score: number; eventId: string; evidence: string[] }>
  evidence: Array<{ eventId: string; ts: string; service: string; message: string }>
  detectionAndResponse: string[]
  resolution: string[]
  lessonsLearned: string[]
  correctiveActions: Array<{ action: string; rationale: string }>
  counterfactuals: SimulationFinding[]
  uncertainties: string[]
}

function firstBy(events: readonly CanonicalEvent[], pred: (e: CanonicalEvent) => boolean) {
  return events.find(pred)
}

function sec(ms: number | null | undefined): number | null {
  return ms === null || ms === undefined ? null : Math.round(ms / 1000)
}

/**
 * Deterministic postmortem from structured incident data. No model calls.
 * Hypotheses are reported with their review status; an unreviewed hypothesis
 * is never promoted to "root cause".
 */
export function generatePostmortem(input: PostmortemInput): Postmortem {
  const { dataset, hypotheses } = input
  const ev = dataset.events
  const reviews = input.reviews ?? {}
  const meta = dataset.meta
  const firstError = firstBy(ev, (e) => SEVERITY_RANK[e.severity] >= 3)
  const firstAlert = firstBy(ev, (e) => e.type === 'alert')
  const started = meta.startedAt ?? firstError?.ts ?? (ev[0]?.ts ?? null)
  const detected = meta.detectedAt ?? firstAlert?.ts ?? null
  const lastRecovery = [...ev].reverse().find((e) => e.type === 'recovery')
  const resolved = meta.resolvedAt ?? lastRecovery?.ts ?? null
  const errors = ev.filter((e) => SEVERITY_RANK[e.severity] >= 3)
  const affected = Array.from(new Set(errors.map((e) => e.service))).sort()
  const byId = new Map(ev.map((e) => [e.id, e]))

  const keyTypes = new Set(['deploy', 'rollback', 'config_change', 'alert', 'saturation', 'circuit_open', 'circuit_close', 'recovery', 'scale'])
  const timeline: TimelineEntry[] = []
  const firstErrorPerService = new Set<string>()
  for (const e of ev) {
    let include = keyTypes.has(e.type)
    if (!include && SEVERITY_RANK[e.severity] >= 3 && !firstErrorPerService.has(e.service)) {
      include = true
      firstErrorPerService.add(e.service)
    }
    if (include) timeline.push({ ts: e.ts, service: e.service, kind: e.type, text: e.message, eventId: e.id, source: 'observed' })
  }
  for (const a of dataset.annotations as Annotation[]) {
    if (a.ts) timeline.push({ ts: a.ts, service: '', kind: a.kind, text: `${a.author}: ${a.body}`, eventId: a.eventId, source: 'annotation' })
  }
  timeline.sort((a, b) => a.ts - b.ts)

  const visible = hypotheses.filter((h) => reviews[h.id] !== 'rejected')
  const rootCauses = visible.map((h) => ({
    title: h.title,
    status: reviews[h.id] ?? 'inferred',
    score: h.score,
    eventId: h.eventId,
    evidence: [h.eventId, ...h.supportingEventIds].slice(0, 6),
  }))
  const confirmed = rootCauses.filter((r) => r.status === 'confirmed')
  const lead = confirmed[0] ?? rootCauses[0]

  const types = new Set(ev.map((e) => e.type))
  const factors: string[] = []
  if (types.has('deploy')) factors.push('A deployment occurred shortly before or during the failure window.')
  if (types.has('saturation')) factors.push('A connection pool or concurrency limit was exhausted.')
  if (types.has('retry')) factors.push(`Retries were observed (${ev.filter((e) => e.type === 'retry').length} retry events), which can amplify load on a struggling dependency.`)
  if (types.has('timeout')) factors.push('Calls timed out, holding caller resources while waiting.')
  if (types.has('queue_full')) factors.push('Queues overflowed and requests were rejected.')
  if (types.has('circuit_open')) factors.push('Circuit breakers opened, failing fast to protect callers.')
  if (affected.length > 1) factors.push(`Failures spread across ${affected.length} services: ${affected.join(', ')}.`)

  const actions: Array<{ action: string; rationale: string }> = []
  if (types.has('deploy')) actions.push({ action: 'Gate rollouts on query-latency and error-rate canary checks with automatic rollback.', rationale: 'A change preceded the failure; a canary gate would have stopped it at partial rollout.' })
  if (types.has('saturation')) actions.push({ action: 'Bound connection-pool wait time and alert on pool utilization above 80%.', rationale: 'Pool exhaustion turned slow queries into queued and timed-out requests.' })
  if (types.has('retry')) actions.push({ action: 'Adopt retry budgets with exponential backoff and jitter; avoid retrying at multiple layers.', rationale: 'Layered retries multiply load exactly when a dependency is weakest.' })
  if (types.has('timeout') && !types.has('circuit_open')) actions.push({ action: 'Add circuit breakers around slow dependencies.', rationale: 'Callers kept waiting on a dependency that was not going to answer in time.' })
  if (detected && started && detected - started > 120_000) actions.push({ action: 'Add a faster-burning error-rate alert alongside the slow-burn alert.', rationale: `Detection took ${Math.round((detected - started) / 1000)} s after the first error.` })
  if (actions.length === 0) actions.push({ action: 'Review alert coverage for the affected services.', rationale: 'No specific failure pattern was recognized in the evidence.' })

  const lessons: string[] = []
  if (types.has('retry') && types.has('saturation')) lessons.push('Retries and a saturated dependency formed a feedback loop; load stayed high after the original trigger.')
  if (types.has('deploy')) lessons.push('Correlating the change log with the first errors was the fastest path to a hypothesis.')
  if (input.simulations?.length) lessons.push('Counterfactual simulation was used to compare interventions; results are model estimates under stated assumptions.')
  if (lessons.length === 0) lessons.push('Capture richer telemetry (trace ids, deployment ids) to make future correlation more decisive.')

  const uncertainties: string[] = []
  if (meta.synthetic) uncertainties.push('This incident is SYNTHETIC demo data generated by the Faultline simulator.')
  if (confirmed.length === 0) uncertainties.push('No hypothesis has been confirmed by a human reviewer. Root causes below are inferred from correlation only.')
  const missingTrace = ev.filter((e) => !e.traceId).length / Math.max(1, ev.length)
  if (missingTrace > 0.5) uncertainties.push(`${Math.round(missingTrace * 100)}% of events have no trace id, which weakens correlation.`)
  const assumedUtc = ev.filter((e) => e.flags?.includes('assumed_utc')).length
  if (assumedUtc) uncertainties.push(`${assumedUtc} event timestamps had no timezone and were assumed to be UTC.`)
  if (!detected) uncertainties.push('No alert event was found, so time to detection is unknown.')
  if (!resolved) uncertainties.push('No recovery event was found, so the resolution time is unknown.')

  const durationSec = started !== null && resolved !== null ? sec(resolved - started) : null
  const ttd = started !== null && detected !== null ? sec(detected - started) : null
  const summary = [
    `${meta.synthetic ? '[Synthetic] ' : ''}${meta.title}.`,
    affected.length ? `${affected.length} service(s) reported errors (${affected.join(', ')}).` : 'No error-level events were recorded.',
    durationSec !== null ? `Impact lasted about ${Math.round(durationSec / 60)} minute(s).` : 'Impact duration is unknown.',
    lead ? `Leading hypothesis (${lead.status}): ${lead.title}.` : 'No hypothesis was produced.',
  ].join(' ')

  const resolution: string[] = []
  for (const e of ev) if (e.type === 'rollback' || (e.type === 'config_change' && SEVERITY_RANK[e.severity] <= 1) || e.type === 'scale') resolution.push(`${toIso(e.ts)} ${e.service}: ${e.message}`)
  if (lastRecovery) resolution.push(`${toIso(lastRecovery.ts)} ${lastRecovery.service}: ${lastRecovery.message}`)

  const detection: string[] = []
  if (firstError) detection.push(`First error at ${toIso(firstError.ts)} in ${firstError.service}: ${firstError.message}`)
  if (firstAlert) detection.push(`First alert at ${toIso(firstAlert.ts)}: ${firstAlert.message}`)
  if (ttd !== null) detection.push(`Time to detect: ${ttd} s.`)
  for (const a of dataset.annotations) detection.push(`${a.author}${a.synthetic ? '' : ''}: ${a.body}`)

  return {
    version: POSTMORTEM_VERSION,
    incidentId: meta.id,
    title: meta.title,
    synthetic: meta.synthetic,
    generatedAt: toIso(input.generatedAt ?? 0),
    executiveSummary: summary,
    duration: {
      startedAt: started !== null ? toIso(started) : null,
      detectedAt: detected !== null ? toIso(detected) : null,
      resolvedAt: resolved !== null ? toIso(resolved) : null,
      durationSec,
      timeToDetectSec: ttd,
    },
    impact: {
      affectedServices: affected,
      errorEvents: errors.length,
      criticalEvents: ev.filter((e) => e.severity === 'critical').length,
      firstErrorService: firstError?.service ?? null,
    },
    timeline,
    contributingFactors: factors,
    rootCauses,
    evidence: (lead?.evidence ?? []).map((id) => byId.get(id)).filter((e): e is CanonicalEvent => Boolean(e)).map((e) => ({ eventId: e.id, ts: toIso(e.ts), service: e.service, message: e.message })),
    detectionAndResponse: detection,
    resolution,
    lessonsLearned: lessons,
    correctiveActions: actions,
    counterfactuals: input.simulations ?? [],
    uncertainties,
  }
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function postmortemToMarkdown(pm: Postmortem): string {
  const out: string[] = []
  out.push(`# Postmortem: ${pm.title}`)
  if (pm.synthetic) out.push('', '> **Synthetic incident.** Generated by the Faultline simulator for demonstration.')
  out.push('', `_Generated by Faultline (${pm.version}) at ${pm.generatedAt}. Incident \`${pm.incidentId}\`._`)
  out.push('', '## Executive summary', '', pm.executiveSummary)
  out.push('', '## Duration', '')
  out.push(`| Started | Detected | Resolved | Duration | Time to detect |`, `| --- | --- | --- | --- | --- |`)
  out.push(`| ${pm.duration.startedAt ?? 'unknown'} | ${pm.duration.detectedAt ?? 'unknown'} | ${pm.duration.resolvedAt ?? 'unknown'} | ${pm.duration.durationSec !== null ? `${pm.duration.durationSec} s` : 'unknown'} | ${pm.duration.timeToDetectSec !== null ? `${pm.duration.timeToDetectSec} s` : 'unknown'} |`)
  out.push('', '## Impact', '')
  out.push(`- Affected services: ${pm.impact.affectedServices.join(', ') || 'none recorded'}`)
  out.push(`- Error events: ${pm.impact.errorEvents} (critical: ${pm.impact.criticalEvents})`)
  if (pm.impact.firstErrorService) out.push(`- First service to report errors: ${pm.impact.firstErrorService}`)
  out.push('', '## Timeline (UTC)', '', '| Time | Service | Kind | Detail | Source |', '| --- | --- | --- | --- | --- |')
  for (const t of pm.timeline) out.push(`| ${toIso(t.ts).slice(11, 23)} | ${esc(t.service)} | ${t.kind} | ${esc(t.text)} | ${t.source}${t.eventId ? ` \`${t.eventId}\`` : ''} |`)
  out.push('', '## Contributing factors', '', ...pm.contributingFactors.map((f) => `- ${f}`))
  out.push('', '## Potential root causes', '')
  if (pm.rootCauses.length === 0) out.push('_None identified._')
  for (const r of pm.rootCauses) out.push(`- **${r.title}** — status: \`${r.status}\`, heuristic score ${r.score.toFixed(2)} (not a probability). Evidence: ${r.evidence.map((id) => `\`${id}\``).join(', ')}`)
  out.push('', '## Supporting evidence', '')
  for (const e of pm.evidence) out.push(`- \`${e.eventId}\` ${e.ts} **${e.service}**: ${esc(e.message)}`)
  out.push('', '## Detection and response', '', ...pm.detectionAndResponse.map((d) => `- ${d}`))
  out.push('', '## Resolution', '', ...(pm.resolution.length ? pm.resolution.map((r) => `- ${r}`) : ['_No resolution events recorded._']))
  if (pm.counterfactuals.length) {
    out.push('', '## Counterfactual simulations', '', '_Model estimates under the listed assumptions, not predictions of what would have happened._', '')
    for (const c of pm.counterfactuals) {
      out.push(`- **${c.label}** (branch at T+${c.branchAtSec}s): ${c.overall}. ${c.summary}`)
      for (const a of c.assumptions) out.push(`  - Assumption: ${a}`)
    }
  }
  out.push('', '## Lessons learned', '', ...pm.lessonsLearned.map((l) => `- ${l}`))
  out.push('', '## Corrective actions', '', ...pm.correctiveActions.map((a) => `- [ ] ${a.action} _(${a.rationale})_`))
  out.push('', '## Remaining uncertainties', '', ...pm.uncertainties.map((u) => `- ${u}`))
  return `${out.join('\n')}\n`
}
