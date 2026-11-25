import { test } from 'vitest'
import { DEMO_SCENARIOS, runSimulation, branchScenario, compareRuns, generateIncident } from './index'
test('probe', { timeout: 120000 }, () => {
  for (const d of DEMO_SCENARIOS) {
    const t0 = performance.now()
    const r = runSimulation(d.scenario)
    const ms = performance.now() - t0
    const s = r.summary
    console.log(d.slug, `${ms.toFixed(0)}ms ev=${r.eventsProcessed}`, JSON.stringify({ req: s.requests, ok: s.successRate, p95: s.latency.p95, peak: s.peakErrorRate, peakAt: s.peakAtSec, onset: s.onsetSec, ttr: s.timeToRecoverySec, rec: s.recovered, retries: s.retries, to: s.timeouts, affected: s.affectedServices }))
    const series = r.samples.filter((x) => x.t % 30 === 0).map((x) => `${x.t}:${(x.errorRate*100).toFixed(0)}%/${x.p95 ?? '-'}`).join(' ')
    console.log('  ', series)
    const b = branchScenario(d.scenario, d.suggested.atSec, d.slug === 'retry-storm' ? [{ kind: 'isolate_dependency', from: 'feed-svc', to: 'ranking-svc' }] : [{ kind: 'rollback_deployment', service: d.slug === 'checkout-cascade' ? 'pricing-svc' : 'recommendations-svc' }])
    const rb = runSimulation(b.scenario)
    const c = compareRuns(r, rb, d.suggested.atSec)
    console.log('  branch', c.overall, 'prefix', c.prefixIdentical, c.deltas.map((x) => `${x.metric}:${x.baseline}->${x.branch}`).join(' | '))
    const g = generateIncident(d)
    const types: Record<string, number> = {}
    for (const e of g.dataset.events) types[e.type] = (types[e.type] ?? 0) + 1
    console.log('  events', g.dataset.events.length, JSON.stringify(types))
  }
})
