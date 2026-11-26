import { describe, expect, it } from 'vitest'
import { branchScenario, compareRuns, modelAt } from './interventions'
import { service, validateModel, type SimScenario } from './model'
import { runSimulation } from './simulator'
import { LAB_TEMPLATES, deriveScenarioFromIncident } from './templates'
import { EventHeap } from './heap'

const retry = (maxAttempts: number, backoffMs = 0, jitter = 0) => ({ maxAttempts, backoffMs, backoffMultiplier: 2, jitter })

/** Small two-tier system: api -> db. Fast enough for many runs. */
function small(overrides: Partial<SimScenario> = {}): SimScenario {
  return {
    id: 'small',
    name: 'small',
    seed: 7,
    sampleMs: 1000,
    durationSec: 60,
    timeline: [],
    model: {
      entry: 'api',
      networkMs: 1,
      clientTimeoutMs: 2000,
      clientRetry: retry(1),
      rateLimitRps: null,
      traffic: [{ atSec: 0, rps: 40 }],
      services: [
        service('api', 'service', { capacity: 30, queueCapacity: 30, serviceTimeMs: 5, timeoutMs: 400 }),
        service('db', 'database', { capacity: 8, queueCapacity: 20, serviceTimeMs: 10, contention: 0 }),
      ],
      calls: [{ from: 'api', to: 'db' }],
    },
    ...overrides,
  }
}

describe('EventHeap', () => {
  it('breaks timestamp ties by insertion order', () => {
    const h = new EventHeap<{ t: number; seq: number; v: string }>()
    h.push({ t: 5, seq: 2, v: 'c' })
    h.push({ t: 5, seq: 1, v: 'b' })
    h.push({ t: 1, seq: 3, v: 'a' })
    expect([h.pop()!.v, h.pop()!.v, h.pop()!.v]).toEqual(['a', 'b', 'c'])
  })
})

describe('runSimulation', () => {
  it('is reproducible: same scenario and seed give deep-equal results', () => {
    expect(runSimulation(small())).toEqual(runSimulation(small()))
  })

  it('different seeds produce different but plausible runs', () => {
    const a = runSimulation(small())
    const b = runSimulation(small({ seed: 8 }))
    expect(a.summary.requests).not.toBe(b.summary.requests)
    expect(Math.abs(a.summary.requests - b.summary.requests)).toBeLessThan(a.summary.requests * 0.15)
  })

  it('a healthy system succeeds with latency near the sum of service times', () => {
    const r = runSimulation(small())
    expect(r.summary.successRate).toBe(1)
    expect(r.summary.latency.p50!).toBeGreaterThan(10)
    expect(r.summary.latency.p50!).toBeLessThan(40)
    expect(r.summary.onsetSec).toBeNull()
  })

  it('overflows the queue and rejects when demand exceeds capacity', () => {
    const s = small()
    s.model.services[1] = service('db', 'database', { capacity: 2, queueCapacity: 5, serviceTimeMs: 100, contention: 0 })
    const r = runSimulation(s)
    expect(r.summary.services.db.rejectedQueueFull).toBeGreaterThan(0)
    expect(r.summary.services.db.peakQueue).toBe(5)
    expect(r.summary.successRate).toBeLessThan(0.5)
  })

  it('cascades: a slow database exhausts the caller and fails client requests', () => {
    const s = small({ timeline: [{ atSec: 20, label: 'slow db', origin: 'scenario', change: { kind: 'set_service', service: 'db', patch: { serviceTimeMs: 400 } } }] })
    const r = runSimulation(s)
    expect(r.summary.onsetSec).toBeGreaterThanOrEqual(20)
    expect(r.summary.affectedServices).toEqual(expect.arrayContaining(['api', 'db']))
    expect(r.summary.timeouts).toBeGreaterThan(0)
    const before = r.samples.filter((x) => x.t < 20)
    expect(before.every((x) => x.errorRate === 0)).toBe(true)
  })

  it('amplifies load with retries (retry storm)', () => {
    const slow = { atSec: 10, label: 'slow', origin: 'scenario' as const, change: { kind: 'set_service' as const, service: 'db', patch: { serviceTimeMs: 300 } } }
    const noRetry = runSimulation(small({ timeline: [slow] }))
    const s = small({ timeline: [slow] })
    s.model.services[0].retry = retry(4)
    const withRetry = runSimulation(s)
    expect(withRetry.summary.services.db.calls).toBeGreaterThan(noRetry.summary.services.db.calls * 1.3)
    expect(withRetry.summary.retries).toBeGreaterThan(0)
  })

  it('opens a circuit breaker and fails fast', () => {
    const s = small({ timeline: [{ atSec: 10, label: 'down', origin: 'scenario', change: { kind: 'set_service', service: 'db', patch: { available: false } } }] })
    s.model.services[0].circuitBreaker = { enabled: true, failureRateThreshold: 0.5, minRequests: 10, windowMs: 5000, openMs: 3000 }
    const r = runSimulation(s)
    expect(r.summary.circuitOpens).toBeGreaterThan(0)
    const telemetry: string[] = []
    runSimulation(s, { onTelemetry: (t) => telemetry.push(t.kind) })
    expect(telemetry).toContain('circuit_open')
  })

  it('rate limiting sheds load and counts rejections separately', () => {
    const s = small()
    s.model.rateLimitRps = 20
    const r = runSimulation(s)
    expect(r.summary.rateLimited).toBeGreaterThan(0)
    expect(r.summary.succeeded / 60).toBeLessThanOrEqual(21)
  })

  it('handles zero traffic and later traffic segments', () => {
    const s = small()
    s.model.traffic = [{ atSec: 0, rps: 0 }, { atSec: 30, rps: 20 }]
    const r = runSimulation(s)
    expect(r.samples.filter((x) => x.t <= 30).every((x) => x.requests === 0)).toBe(true)
    expect(r.summary.requests).toBeGreaterThan(400)
  })

  it('stops at the event cap and reports truncation', () => {
    const r = runSimulation(small(), { maxEvents: 500 })
    expect(r.truncated).toBe(true)
  })

  it('refuses invalid models with readable reasons', () => {
    const s = small()
    s.model.calls.push({ from: 'db', to: 'api' })
    expect(validateModel(s.model)).toEqual(expect.arrayContaining([expect.stringMatching(/cycle/)]))
    expect(() => runSimulation(s)).toThrow(/cycle/)
    const t = small()
    t.model.entry = 'nope'
    expect(() => runSimulation(t)).toThrow(/Entry service/)
  })
})

describe('counterfactual branches', () => {
  const slow = small({
    durationSec: 90,
    timeline: [{ atSec: 20, label: 'Deploy db v2', origin: 'scenario', category: 'deploy', deploymentId: 'db@v2', change: { kind: 'set_service', service: 'db', patch: { serviceTimeMs: 400 } } }],
  })

  it('leaves the original scenario untouched and keeps the prefix identical', () => {
    const snapshot = JSON.stringify(slow)
    const { scenario: b } = branchScenario(slow, 40, [{ kind: 'rollback_deployment', service: 'db' }])
    expect(JSON.stringify(slow)).toBe(snapshot)
    const base = runSimulation(slow)
    const branch = runSimulation(b)
    const cmp = compareRuns(base, branch, 40)
    expect(cmp.prefixIdentical).toBe(true)
    expect(cmp.overall).toBe('better')
    expect(branch.summary.successRate).toBeGreaterThan(base.summary.successRate)
  })

  it('a rollback before the deploy removes the deploy entirely', () => {
    const { scenario: b, assumptions } = branchScenario(slow, 10, [{ kind: 'rollback_deployment', service: 'db' }])
    expect(b.timeline.some((c) => c.deploymentId === 'db@v2')).toBe(false)
    expect(assumptions.join(' ')).toMatch(/never deploys/)
    expect(runSimulation(b).summary.successRate).toBe(1)
  })

  it('capacity changes take effect', () => {
    const { scenario: b } = branchScenario(slow, 30, [{ kind: 'db_pool', service: 'db', capacity: 64 }])
    expect(modelAt(b, 31, true).services.find((s) => s.id === 'db')!.capacity).toBe(64)
    expect(runSimulation(b).summary.successRate).toBeGreaterThan(runSimulation(slow).summary.successRate)
  })

  it('reports an intervention that makes things worse honestly', () => {
    // From a healthy baseline, shrinking the pool to one connection must hurt.
    // 40 rps x 30 ms needs ~1.2 connections on average: fine with 8, not with 1.
    const healthy = small()
    healthy.model.services[1].serviceTimeMs = 30
    const { scenario: b } = branchScenario(healthy, 30, [{ kind: 'db_pool', service: 'db', capacity: 1 }])
    const cmp = compareRuns(runSimulation(healthy), runSimulation(b), 30)
    expect(cmp.overall).toBe('worse')
    expect(cmp.deltas.find((d) => d.metric === 'Success rate')!.verdict).toBe('worse')
  })

  it('computes retry side effects from the model rather than assuming them', () => {
    // With a 400 ms timeout against ~400 ms queries, extra attempts both add
    // load AND rescue requests; the engine reports both effects as they occur.
    const { scenario: b } = branchScenario(slow, 30, [{ kind: 'retry_policy', service: 'api', maxAttempts: 5, backoffMs: 0 }])
    const cmp = compareRuns(runSimulation(slow), runSimulation(b), 30)
    expect(cmp.deltas.find((d) => d.metric === 'Retries')!.verdict).toBe('worse')
    expect(cmp.prefixIdentical).toBe(true)
  })

  it('isolating a dependency removes its failures from the caller', () => {
    const { scenario: b } = branchScenario(slow, 30, [{ kind: 'isolate_dependency', from: 'api', to: 'db' }])
    const r = runSimulation(b)
    expect(r.samples.filter((x) => x.t > 40).every((x) => x.errorRate === 0)).toBe(true)
  })

  it('a timeout change applies at the branch point and states its assumption', () => {
    const { scenario: b, assumptions } = branchScenario(slow, 30, [{ kind: 'set_timeout', service: 'api', timeoutMs: 1500 }])
    expect(modelAt(b, 29, true).services.find((s) => s.id === 'api')!.timeoutMs).toBe(400)
    expect(modelAt(b, 31, true).services.find((s) => s.id === 'api')!.timeoutMs).toBe(1500)
    expect(assumptions.join(' ')).toMatch(/was 400 ms/)
    expect(compareRuns(runSimulation(slow), runSimulation(b), 30).prefixIdentical).toBe(true)
  })

  it('a timeout shorter than the dependency fails calls it used to complete', () => {
    // db answers in ~10 ms; a 2 ms budget cannot be met, so the branch must
    // turn a healthy system into a failing one rather than "help".
    const healthy = small()
    const { scenario: b } = branchScenario(healthy, 30, [{ kind: 'set_timeout', service: 'api', timeoutMs: 2 }])
    const cmp = compareRuns(runSimulation(healthy), runSimulation(b), 30)
    expect(cmp.overall).toBe('worse')
    expect(runSimulation(b).samples.filter((x) => x.t > 33).every((x) => x.errorRate > 0.9)).toBe(true)
  })

  it('rejects timeouts outside the supported range', () => {
    expect(() => branchScenario(slow, 30, [{ kind: 'set_timeout', service: 'api', timeoutMs: 0 }])).toThrow(RangeError)
    expect(() => branchScenario(slow, 30, [{ kind: 'set_timeout', service: 'ghost', timeoutMs: 100 }])).toThrow(/Unknown service/)
  })

  it('rejects interventions that reference unknown parts of the model', () => {
    expect(() => branchScenario(slow, 30, [{ kind: 'scale_capacity', service: 'ghost', capacity: 4 }])).toThrow(/Unknown service/)
    expect(() => branchScenario(slow, 999, [])).toThrow(RangeError)
    expect(() => branchScenario(slow, 30, [{ kind: 'isolate_dependency', from: 'db', to: 'api' }])).toThrow(/does not call/)
  })
})

describe('lab templates and derived models', () => {
  it('every template is a valid model', () => {
    for (const t of LAB_TEMPLATES) {
      const s = t.build()
      expect(validateModel(s.model, s.durationSec), t.slug).toEqual([])
    }
  })

  it('derives a runnable model from an imported incident and discloses assumptions', () => {
    const T = 1_800_000_000_000
    const mk = (i: number, service: string, severity: 'info' | 'error', type: 'log' | 'deploy' = 'log') => ({ id: `d${i}`, incidentId: 'x', ts: T + i * 1000, source: 's', service, environment: 'p', severity, type, message: type, metadata: {}, sourceRef: { sourceId: 's', sourceName: 's', line: i, format: 'json' as const } })
    const events = [mk(0, 'web', 'info'), mk(1, 'api', 'info'), mk(2, 'api', 'info', 'deploy'), mk(3, 'api', 'error'), mk(4, 'api', 'error'), mk(5, 'web', 'error')]
    const { scenario, assumptions } = deriveScenarioFromIncident({
      meta: { id: 'x', title: 'Imported', severity: 'sev2', synthetic: false },
      events,
      services: [],
      dependencies: [{ from: 'web', to: 'api', origin: 'declared' }, { from: 'api', to: 'web', origin: 'inferred' }],
      annotations: [],
    })
    expect(validateModel(scenario.model, scenario.durationSec)).toEqual([])
    expect(scenario.timeline).toHaveLength(1)
    expect(assumptions.join(' ')).toMatch(/hypothetical/)
    expect(assumptions.join(' ')).toMatch(/dropped/)
    expect(runSimulation(scenario).summary.requests).toBeGreaterThan(0)
  })
})
