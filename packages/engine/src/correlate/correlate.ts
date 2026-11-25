import type { CanonicalEvent, EventType } from '../types'
import { SEVERITY_RANK } from '../types'
import { ServiceGraph } from '../graph/topology'
import { stableId } from '../util/hash'

export const CORRELATION_ALGORITHM_VERSION = 'faultline-corr/1.0.0'

export type SignalName =
  | 'parentSpan'
  | 'sharedTrace'
  | 'sharedRequest'
  | 'sharedDeployment'
  | 'dependency'
  | 'sameService'
  | 'severityEscalation'
  | 'errorPropagation'
  | 'typeRelation'

/**
 * Evidence weights. Each is the strength a single signal contributes on its
 * own; signals combine by noisy-OR, so adding evidence can only raise a score
 * and the result stays in [0, 1]. These are heuristic weights, NOT calibrated
 * probabilities. See docs/CORRELATION.md for the meaning of each.
 */
export interface CorrelationWeights {
  parentSpan: number
  sharedTrace: number
  sharedRequest: number
  sharedDeployment: number
  dependency: number
  sameService: number
  severityEscalation: number
  errorPropagation: number
  typeRelation: number
}

export interface CorrelationParams {
  weights: CorrelationWeights
  /** Candidate window for ordinary events. */
  windowMs: number
  /** Candidate window for change events (deploy, config_change, scale). */
  changeWindowMs: number
  /** Temporal decay constant for ordinary sources. */
  tauMs: number
  /** Slower decay for change-event sources: their effects arrive late. */
  tauSlowMs: number
  /** Candidates kept per index lookup (bounds work per event). */
  maxCandidatesPerIndex: number
  /** Edges below this score are discarded. */
  minScore: number
  /** Strongest incoming edges kept per destination event. */
  topKIncoming: number
  /** Events below this severity participate only if their type is causal. */
  minSeverity: 'debug' | 'info' | 'warn' | 'error'
}

export const DEFAULT_CORRELATION_PARAMS: CorrelationParams = {
  weights: {
    parentSpan: 0.6,
    sharedTrace: 0.35,
    sharedRequest: 0.35,
    sharedDeployment: 0.3,
    dependency: 0.3,
    sameService: 0.12,
    severityEscalation: 0.1,
    errorPropagation: 0.15,
    typeRelation: 0.25,
  },
  windowMs: 120_000,
  changeWindowMs: 900_000,
  tauMs: 60_000,
  tauSlowMs: 300_000,
  maxCandidatesPerIndex: 12,
  minScore: 0.12,
  topKIncoming: 3,
  minSeverity: 'warn',
}

export interface CorrelationEdge {
  id: string
  source: string
  target: string
  score: number
  signals: SignalName[]
  explanation: string
  deltaMs: number
  algorithmVersion: string
}

export interface CorrelationResult {
  edges: CorrelationEdge[]
  params: CorrelationParams
  algorithmVersion: string
  stats: { participating: number; candidatePairs: number; edges: number }
}

const CHANGE_TYPES = new Set<EventType>(['deploy', 'config_change', 'rollback', 'scale'])

/** Event types that participate in correlation regardless of severity. */
const CAUSAL_TYPES = new Set<EventType>([
  'deploy', 'rollback', 'config_change', 'alert', 'saturation', 'queue_full',
  'circuit_open', 'circuit_close', 'scale', 'recovery', 'timeout', 'retry',
])

/** Documented cause -> effect type pairs (typical failure-mode chains). */
const TYPE_RELATIONS: Partial<Record<EventType, EventType[]>> = {
  deploy: ['error', 'latency', 'timeout', 'saturation', 'alert', 'retry', 'queue_full'],
  config_change: ['error', 'latency', 'timeout', 'saturation', 'alert', 'retry'],
  saturation: ['timeout', 'error', 'queue_full', 'latency', 'retry', 'alert'],
  latency: ['timeout', 'retry', 'saturation', 'alert'],
  timeout: ['retry', 'error', 'circuit_open', 'alert', 'saturation'],
  retry: ['saturation', 'queue_full', 'timeout', 'latency', 'error'],
  queue_full: ['error', 'timeout', 'alert', 'retry'],
  error: ['alert', 'retry', 'circuit_open', 'error'],
  circuit_open: ['error', 'recovery'],
  rollback: ['recovery', 'circuit_close'],
  scale: ['recovery'],
}

export function typesRelate(cause: EventType, effect: EventType): boolean {
  return TYPE_RELATIONS[cause]?.includes(effect) ?? false
}

const SIGNAL_TEXT: Record<SignalName, (s: CanonicalEvent, d: CanonicalEvent) => string> = {
  parentSpan: () => 'the source span is the direct parent of the target span',
  sharedTrace: (s) => `both belong to trace ${short(s.traceId)}`,
  sharedRequest: (s) => `both carry request ${short(s.requestId)}`,
  sharedDeployment: (s) => `both reference deployment ${s.deploymentId}`,
  dependency: (s, d) => `${d.service} depends on ${s.service}, so a failure there propagates to its caller`,
  sameService: (s) => `same service (${s.service})`,
  severityEscalation: (s, d) => `severity escalates ${s.severity} -> ${d.severity}`,
  errorPropagation: () => 'an error is followed by an error along a call path',
  typeRelation: (s, d) => `${s.type} -> ${d.type} is a documented failure chain`,
}

function short(id?: string): string {
  if (!id) return ''
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

function formatDelta(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}

/** Index of the first element with ts >= t (lower bound) in a time-sorted array of event indices. */
function lowerBound(order: number[], events: readonly CanonicalEvent[], t: number): number {
  let lo = 0
  let hi = order.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (events[order[mid]].ts < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Index of the first element whose position (global order) is >= pos. */
function positionBound(order: number[], pos: number): number {
  let lo = 0
  let hi = order.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (order[mid] < pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Builds directed, scored candidate relationships between events.
 *
 * `events` MUST already be in canonical order (see compareEvents). An edge
 * always points from an earlier position to a later one, so the correlation
 * graph is a DAG and can never contain temporally invalid edges.
 */
export function correlate(
  events: readonly CanonicalEvent[],
  graph: ServiceGraph,
  overrides: Partial<Omit<CorrelationParams, 'weights'>> & { weights?: Partial<CorrelationWeights> } = {},
): CorrelationResult {
  const params: CorrelationParams = {
    ...DEFAULT_CORRELATION_PARAMS,
    ...overrides,
    weights: { ...DEFAULT_CORRELATION_PARAMS.weights, ...overrides.weights },
  }
  for (const [k, w] of Object.entries(params.weights)) {
    if (!(w >= 0 && w < 1)) throw new RangeError(`weight ${k} must be in [0, 1), got ${w}`)
  }
  const minRank = SEVERITY_RANK[params.minSeverity]
  const participates = (e: CanonicalEvent) => SEVERITY_RANK[e.severity] >= minRank || CAUSAL_TYPES.has(e.type)

  // ---- indexes (each holds global positions in ascending order)
  const byTrace = new Map<string, number[]>()
  const byRequest = new Map<string, number[]>()
  const byDeployment = new Map<string, number[]>()
  const byService = new Map<string, number[]>()
  const bySpan = new Map<string, number>()
  const changes: number[] = []
  const push = (m: Map<string, number[]>, k: string | undefined, i: number) => {
    if (!k) return
    const arr = m.get(k)
    if (arr) arr.push(i)
    else m.set(k, [i])
  }
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (i > 0 && events[i - 1].ts > e.ts) throw new Error('correlate() requires events in canonical (time) order')
    if (e.spanId) bySpan.set(`${e.traceId ?? ''}:${e.spanId}`, i)
    if (!participates(e)) continue
    push(byTrace, e.traceId, i)
    push(byRequest, e.requestId, i)
    push(byDeployment, e.deploymentId, i)
    push(byService, e.service, i)
    if (CHANGE_TYPES.has(e.type)) changes.push(i)
  }

  const edges: CorrelationEdge[] = []
  let candidatePairs = 0
  let participating = 0
  const K = params.maxCandidatesPerIndex

  for (let i = 0; i < events.length; i++) {
    const d = events[i]
    if (!participates(d)) continue
    participating++
    const candidates = new Set<number>()

    const takeBefore = (order: number[] | undefined, windowMs: number) => {
      if (!order) return
      const end = positionBound(order, i) // strictly earlier positions
      const startByTime = lowerBound(order, events, d.ts - windowMs)
      for (let j = end - 1, taken = 0; j >= startByTime && taken < K; j--, taken++) candidates.add(order[j])
    }

    // Parent span (may be a non-participating span: still the strongest evidence).
    if (d.parentSpanId) {
      const p = bySpan.get(`${d.traceId ?? ''}:${d.parentSpanId}`)
      if (p !== undefined && p < i) candidates.add(p)
    }
    takeBefore(d.traceId ? byTrace.get(d.traceId) : undefined, params.windowMs)
    takeBefore(d.requestId ? byRequest.get(d.requestId) : undefined, params.windowMs)
    takeBefore(d.deploymentId ? byDeployment.get(d.deploymentId) : undefined, params.changeWindowMs)
    takeBefore(byService.get(d.service), params.windowMs)
    for (const callee of graph.dependenciesOf(d.service)) takeBefore(byService.get(callee), params.windowMs)
    // Change events on this service or its dependencies, over the long window.
    {
      const end = positionBound(changes, i)
      const start = lowerBound(changes, events, d.ts - params.changeWindowMs)
      for (let j = start; j < end; j++) {
        const c = events[changes[j]]
        if (c.service === d.service || graph.dependsOn(d.service, c.service) || (c.deploymentId && c.deploymentId === d.deploymentId)) {
          candidates.add(changes[j])
        }
      }
    }

    const incoming: CorrelationEdge[] = []
    for (const si of candidates) {
      if (si >= i) continue
      candidatePairs++
      const s = events[si]
      const delta = d.ts - s.ts
      if (delta < 0) continue
      const signals: SignalName[] = []
      const sameTrace = Boolean(s.traceId && s.traceId === d.traceId)
      if (sameTrace && d.parentSpanId && s.spanId === d.parentSpanId) signals.push('parentSpan')
      if (sameTrace) signals.push('sharedTrace')
      if (s.requestId && s.requestId === d.requestId) signals.push('sharedRequest')
      if (s.deploymentId && s.deploymentId === d.deploymentId) signals.push('sharedDeployment')
      const dep = graph.dependsOn(d.service, s.service)
      if (dep) signals.push('dependency')
      if (s.service === d.service) signals.push('sameService')
      const rs = SEVERITY_RANK[s.severity]
      const rd = SEVERITY_RANK[d.severity]
      if (rs >= 2 && rd > rs) signals.push('severityEscalation')
      if (rs >= 3 && rd >= 3 && (dep || sameTrace)) signals.push('errorPropagation')
      if (typesRelate(s.type, d.type)) signals.push('typeRelation')

      // Proximity alone (same service, nothing else) is not evidence of causation.
      if (signals.length === 0 || (signals.length === 1 && signals[0] === 'sameService')) continue

      let notExplained = 1
      for (const sig of signals) notExplained *= 1 - params.weights[sig]
      const evidence = 1 - notExplained
      const tau = CHANGE_TYPES.has(s.type) ? params.tauSlowMs : params.tauMs
      const decay = Math.exp(-delta / tau)
      const score = Math.round(evidence * decay * 10_000) / 10_000
      if (score < params.minScore) continue

      const explanation =
        `${signals.map((sig) => SIGNAL_TEXT[sig](s, d)).join('; ')}. ` +
        `Source precedes target by ${formatDelta(delta)} (decay ${decay.toFixed(2)}). ` +
        'Correlation, not proof of causation.'
      incoming.push({
        id: stableId('edge', s.id, d.id),
        source: s.id,
        target: d.id,
        score,
        signals,
        explanation,
        deltaMs: delta,
        algorithmVersion: CORRELATION_ALGORITHM_VERSION,
      })
    }
    incoming.sort((a, b) => b.score - a.score || (a.source < b.source ? -1 : 1))
    edges.push(...incoming.slice(0, params.topKIncoming))
  }

  return {
    edges,
    params,
    algorithmVersion: CORRELATION_ALGORITHM_VERSION,
    stats: { participating, candidatePairs, edges: edges.length },
  }
}
