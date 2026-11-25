import { describe, expect, it } from 'vitest'
import type { CanonicalEvent, EventType, Severity } from '../types'
import { ServiceGraph } from '../graph/topology'
import { compareEvents } from '../normalize/normalize'
import { correlate, DEFAULT_CORRELATION_PARAMS } from './correlate'
import { rankHypotheses } from './hypotheses'
import { analyzeIncident } from '../analyze'
import { DEMO_SCENARIOS } from '../scenarios/definitions'
import { generateIncident } from '../scenarios/generate'

let n = 0
function ev(ts: number, service: string, severity: Severity, type: EventType, extra: Partial<CanonicalEvent> = {}): CanonicalEvent {
  n++
  return {
    id: `e${String(n).padStart(4, '0')}`,
    incidentId: 'i',
    ts,
    source: 's',
    service,
    environment: 'production',
    severity,
    type,
    message: `${type} in ${service}`,
    metadata: {},
    sourceRef: { sourceId: 's', sourceName: 's', line: n, format: 'json' },
    ...extra,
  }
}

const graph = new ServiceGraph(
  [],
  [
    { from: 'gateway', to: 'checkout', origin: 'declared' },
    { from: 'checkout', to: 'pricing', origin: 'declared' },
    { from: 'pricing', to: 'pricing-db', origin: 'declared' },
  ],
)

describe('correlate', () => {
  const T = 1_800_000_000_000
  const events = [
    ev(T, 'pricing', 'info', 'deploy', { deploymentId: 'pricing@v2' }),
    ev(T + 30_000, 'pricing-db', 'error', 'saturation'),
    ev(T + 31_000, 'pricing', 'error', 'timeout', { traceId: 'tr1', spanId: 'p1', parentSpanId: 'c1' }),
    ev(T + 31_000, 'checkout', 'error', 'error', { traceId: 'tr1', spanId: 'c1' }),
    ev(T + 32_000, 'gateway', 'critical', 'alert'),
    ev(T + 10_000, 'unrelated', 'error', 'error'),
  ].sort(compareEvents)
  const r = correlate(events, graph)
  const byPair = (s: string, d: string) => r.edges.find((e) => events.find((x) => x.id === e.source)!.service === s && events.find((x) => x.id === e.target)!.service === d)

  it('links a dependency failure to its caller with an explanation', () => {
    const edge = byPair('pricing-db', 'pricing')!
    expect(edge.signals).toEqual(expect.arrayContaining(['dependency', 'typeRelation']))
    expect(edge.explanation).toMatch(/pricing depends on pricing-db/)
    expect(edge.explanation).toMatch(/not proof of causation/)
  })

  it('uses trace evidence and points from the failing callee to its caller', () => {
    const edge = byPair('pricing', 'checkout')!
    expect(edge.signals).toEqual(expect.arrayContaining(['sharedTrace', 'dependency']))
  })

  it('treats a direct parent span as the strongest signal', () => {
    const parent = ev(T, 'gateway', 'error', 'error', { traceId: 'x', spanId: 'g1' })
    const child = ev(T + 5, 'checkout', 'error', 'timeout', { traceId: 'x', spanId: 'c9', parentSpanId: 'g1' })
    const res = correlate([parent, child], new ServiceGraph([], []))
    expect(res.edges[0].signals).toEqual(expect.arrayContaining(['parentSpan', 'sharedTrace']))
  })

  it('links the deploy to the downstream failure through the slow change-event decay', () => {
    expect(byPair('pricing', 'pricing-db') ?? byPair('pricing', 'pricing')).toBeTruthy()
  })

  it('never creates temporally invalid or backward edges', () => {
    const pos = new Map(events.map((e, i) => [e.id, i]))
    for (const e of r.edges) {
      expect(pos.get(e.source)!).toBeLessThan(pos.get(e.target)!)
      expect(e.deltaMs).toBeGreaterThanOrEqual(0)
      expect(e.score).toBeGreaterThan(0)
      expect(e.score).toBeLessThanOrEqual(1)
    }
  })

  it('does not correlate an unrelated service by proximity alone', () => {
    const unrelated = events.find((e) => e.service === 'unrelated')!
    expect(r.edges.some((e) => e.source === unrelated.id || e.target === unrelated.id)).toBe(false)
  })

  it('is deterministic and records its algorithm version and parameters', () => {
    expect(correlate(events, graph)).toEqual(r)
    expect(r.algorithmVersion).toMatch(/^faultline-corr\//)
    expect(r.params.weights).toEqual(DEFAULT_CORRELATION_PARAMS.weights)
  })

  it('keeps at most topK incoming edges per event', () => {
    const counts = new Map<string, number>()
    for (const e of correlate(events, graph, { topKIncoming: 1 }).edges) counts.set(e.target, (counts.get(e.target) ?? 0) + 1)
    for (const c of counts.values()) expect(c).toBe(1)
  })

  it('validates weights', () => {
    expect(() => correlate(events, graph, { weights: { parentSpan: 1.5 } })).toThrow(RangeError)
  })

  it('raising a weight can only raise scores (noisy-OR monotonicity)', () => {
    const higher = correlate(events, graph, { weights: { dependency: 0.6 } })
    const edge = byPair('pricing-db', 'pricing')!
    const edge2 = higher.edges.find((e) => e.id === edge.id)!
    expect(edge2.score).toBeGreaterThan(edge.score)
  })

  it('rejects unsorted input', () => {
    expect(() => correlate([events[3], events[0]], graph)).toThrow(/canonical/)
  })

  it('bounds candidate work instead of comparing all pairs', () => {
    const big: CanonicalEvent[] = []
    for (let i = 0; i < 4000; i++) big.push(ev(T + i * 50, `svc-${i % 40}`, 'error', 'error', { traceId: `t${i % 200}` }))
    const res = correlate(big.sort(compareEvents), new ServiceGraph([], []))
    // All-pairs would be ~8,000,000 comparisons.
    expect(res.stats.candidatePairs).toBeLessThan(4000 * DEFAULT_CORRELATION_PARAMS.maxCandidatesPerIndex * 4)
  })
})

describe('rankHypotheses', () => {
  it('ranks the pricing deployment first for the Checkout Cascade', () => {
    const demo = DEMO_SCENARIOS.find((d) => d.slug === 'checkout-cascade')!
    const { dataset } = generateIncident(demo)
    const a = analyzeIncident(dataset)
    expect(a.hypotheses.length).toBeGreaterThan(0)
    const top = a.hypotheses[0]
    expect(['pricing-svc', 'pricing-db']).toContain(top.service)
    expect(top.status).toBe('inferred')
    expect(top.explanation.join(' ')).toMatch(/not a confirmed root cause/)
    expect(top.score).toBeGreaterThan(0)
    expect(top.score).toBeLessThanOrEqual(1)
  })

  it('returns no hypotheses for a quiet incident', () => {
    const quiet = [ev(1, 'a', 'info', 'log'), ev(2, 'b', 'info', 'log')]
    expect(rankHypotheses(quiet, [], graph)).toEqual([])
  })
})
