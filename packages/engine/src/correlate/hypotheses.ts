import type { CanonicalEvent, EventType } from '../types'
import { SEVERITY_RANK } from '../types'
import type { ServiceGraph } from '../graph/topology'
import { stableId } from '../util/hash'
import type { CorrelationEdge } from './correlate'

export const HYPOTHESIS_ALGORITHM_VERSION = 'faultline-rca/1.0.0'

/** Prior plausibility of an event type as an initiating cause (documented). */
const TYPE_PRIOR: Partial<Record<EventType, number>> = {
  deploy: 1,
  config_change: 0.95,
  saturation: 0.7,
  error: 0.5,
  latency: 0.5,
  timeout: 0.4,
  queue_full: 0.3,
  log: 0.3,
  span: 0.3,
  retry: 0.2,
  circuit_open: 0.2,
  alert: 0.1,
}

/** Types that describe a symptom or a fix, never an initiating cause. */
const NEVER_ROOT = new Set<EventType>(['recovery', 'rollback', 'circuit_close', 'scale'])

export interface HypothesisFactors {
  /** Normalized downstream influence through correlation edges. */
  influence: number
  /** 1 - strongest incoming edge: how unexplained the event is by anything earlier. */
  originality: number
  /** Earlier anomalies score higher. */
  precedence: number
  /** Share of other affected services that transitively depend on this service. */
  dependencyPosition: number
  /** Type prior (deploys and config changes are common initiators). */
  typePrior: number
}

export interface RankingWeights {
  influence: number
  originality: number
  precedence: number
  dependencyPosition: number
  typePrior: number
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  influence: 0.35,
  originality: 0.15,
  precedence: 0.15,
  dependencyPosition: 0.2,
  typePrior: 0.15,
}

export interface Hypothesis {
  id: string
  rank: number
  title: string
  service: string
  /** The event that best represents the hypothesized initiating cause. */
  eventId: string
  /** Heuristic confidence score in [0, 1]. NOT a calibrated probability. */
  score: number
  factors: HypothesisFactors
  /** Events supporting the hypothesis (downstream correlated anomalies). */
  supportingEventIds: string[]
  explanation: string[]
  status: 'inferred'
  algorithmVersion: string
}

function isAnomaly(e: CanonicalEvent): boolean {
  return SEVERITY_RANK[e.severity] >= 2 || e.type === 'deploy' || e.type === 'config_change' || e.type === 'saturation'
}

function titleFor(e: CanonicalEvent): string {
  switch (e.type) {
    case 'deploy':
      return `Deployment ${e.deploymentId ? `${e.deploymentId} ` : ''}on ${e.service} preceded the failures`
    case 'config_change':
      return `Configuration change on ${e.service} preceded the failures`
    case 'saturation':
      return `Resource saturation in ${e.service}`
    case 'latency':
      return `Latency regression in ${e.service}`
    case 'timeout':
      return `Timeouts originating in ${e.service}`
    case 'queue_full':
      return `Queue overflow in ${e.service}`
    case 'retry':
      return `Retry amplification from ${e.service}`
    default:
      return `Errors originating in ${e.service}`
  }
}

/**
 * Ranks candidate initiating causes. Deterministic; every factor is reported
 * so the UI can explain the ranking. A hypothesis is always `inferred` —
 * only a human can mark one confirmed.
 */
export function rankHypotheses(
  events: readonly CanonicalEvent[],
  edges: readonly CorrelationEdge[],
  graph: ServiceGraph,
  opts: { limit?: number; weights?: Partial<RankingWeights> } = {},
): Hypothesis[] {
  const weights = { ...DEFAULT_RANKING_WEIGHTS, ...opts.weights }
  const limit = opts.limit ?? 5
  const pos = new Map<string, number>()
  events.forEach((e, i) => pos.set(e.id, i))

  const outgoing = new Map<string, CorrelationEdge[]>()
  const maxIncoming = new Map<string, number>()
  for (const edge of edges) {
    if (!pos.has(edge.source) || !pos.has(edge.target)) continue
    ;(outgoing.get(edge.source) ?? outgoing.set(edge.source, []).get(edge.source)!).push(edge)
    maxIncoming.set(edge.target, Math.max(maxIncoming.get(edge.target) ?? 0, edge.score))
  }

  // Damped downstream influence, computed in one reverse pass over the DAG.
  const DAMPING = 0.5
  const influence = new Map<string, number>()
  for (let i = events.length - 1; i >= 0; i--) {
    const id = events[i].id
    let sum = 0
    for (const edge of outgoing.get(id) ?? []) sum += edge.score * (1 + DAMPING * (influence.get(edge.target) ?? 0))
    influence.set(id, sum)
  }
  let maxInfluence = 0
  for (const v of influence.values()) maxInfluence = Math.max(maxInfluence, v)

  const anomalies = events.filter(isAnomaly)
  const affected = new Set(anomalies.filter((e) => SEVERITY_RANK[e.severity] >= 2).map((e) => e.service))
  const candidates = anomalies.filter((e) => !NEVER_ROOT.has(e.type))
  if (candidates.length === 0) return []

  const scored = candidates.map((e, idx) => {
    const inf = maxInfluence > 0 ? Math.log1p(influence.get(e.id) ?? 0) / Math.log1p(maxInfluence) : 0
    const others = Array.from(affected).filter((s) => s !== e.service)
    const radius = new Set(graph.blastRadius(e.service))
    const depPos = others.length ? others.filter((s) => radius.has(s)).length / others.length : 0
    const factors: HypothesisFactors = {
      influence: round(inf),
      originality: round(1 - (maxIncoming.get(e.id) ?? 0)),
      precedence: round(candidates.length > 1 ? 1 - idx / (candidates.length - 1) : 1),
      dependencyPosition: round(depPos),
      typePrior: TYPE_PRIOR[e.type] ?? 0.3,
    }
    const score =
      weights.influence * factors.influence +
      weights.originality * factors.originality +
      weights.precedence * factors.precedence +
      weights.dependencyPosition * factors.dependencyPosition +
      weights.typePrior * factors.typePrior
    return { e, factors, score: round(score / sumWeights(weights)) }
  })

  // One hypothesis per service: keep its strongest representative event.
  const bestByService = new Map<string, (typeof scored)[number]>()
  for (const s of scored) {
    const cur = bestByService.get(s.e.service)
    if (!cur || s.score > cur.score || (s.score === cur.score && pos.get(s.e.id)! < pos.get(cur.e.id)!)) bestByService.set(s.e.service, s)
  }
  const ranked = Array.from(bestByService.values()).sort(
    (a, b) => b.score - a.score || pos.get(a.e.id)! - pos.get(b.e.id)!,
  )

  return ranked.slice(0, limit).map((s, i) => {
    const support = collectSupport(s.e.id, outgoing, 6)
    const explanation: string[] = []
    if (s.factors.influence > 0.5) explanation.push(`Strong downstream influence: ${support.length} correlated anomalies follow from this event.`)
    else if (s.factors.influence > 0) explanation.push(`Some downstream influence through ${support.length} correlated event(s).`)
    else explanation.push('No correlated downstream events; ranked on position and type only.')
    if (s.factors.originality > 0.8) explanation.push('Nothing earlier explains it well (no strong incoming correlation).')
    if (s.factors.dependencyPosition > 0) explanation.push(`${Math.round(s.factors.dependencyPosition * 100)}% of the other affected services depend on ${s.e.service}.`)
    if (s.factors.precedence > 0.7) explanation.push('It is among the earliest anomalies in the incident.')
    if (s.e.type === 'deploy' || s.e.type === 'config_change') explanation.push('Changes are a common initiator; verify the change contents before concluding.')
    explanation.push('This is an inferred hypothesis from correlation. It is not a confirmed root cause.')
    return {
      id: stableId('hyp', s.e.id, HYPOTHESIS_ALGORITHM_VERSION),
      rank: i + 1,
      title: titleFor(s.e),
      service: s.e.service,
      eventId: s.e.id,
      score: s.score,
      factors: s.factors,
      supportingEventIds: support,
      explanation,
      status: 'inferred' as const,
      algorithmVersion: HYPOTHESIS_ALGORITHM_VERSION,
    }
  })
}

function collectSupport(start: string, outgoing: Map<string, CorrelationEdge[]>, limit: number): string[] {
  const seen = new Set<string>()
  const frontier = [...(outgoing.get(start) ?? [])].sort((a, b) => b.score - a.score)
  while (frontier.length && seen.size < limit) {
    const edge = frontier.shift()!
    if (seen.has(edge.target)) continue
    seen.add(edge.target)
    for (const next of outgoing.get(edge.target) ?? []) frontier.push(next)
    frontier.sort((a, b) => b.score - a.score)
  }
  return Array.from(seen)
}

function sumWeights(w: RankingWeights): number {
  return w.influence + w.originality + w.precedence + w.dependencyPosition + w.typePrior
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
