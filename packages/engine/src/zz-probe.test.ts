import { test } from 'vitest'
import { STOREFRONT, STOREFRONT_CHOICES, runSimulation, branchScenario, compareRuns } from './index'
test('probe', { timeout: 60000 }, () => {
  const t0 = performance.now(); const r = runSimulation(STOREFRONT); const s = r.summary
  console.log(`${(performance.now()-t0).toFixed(0)}ms`, JSON.stringify({ ok: s.successRate, failed: s.failed, peak: s.peakErrorRate, onset: s.onsetSec, ttr: s.timeToRecoverySec, rec: s.recovered, affected: s.affectedServices }))
  console.log(r.samples.filter(x => x.t % 15 === 0).map(x => `${x.t}:${(x.errorRate*100).toFixed(0)}%q${x.services.database.queue}`).join(' '))
  for (const c of STOREFRONT_CHOICES) for (const at of [70, 100]) {
    const b = runSimulation(branchScenario(STOREFRONT, at, c.build(c.amount?.initial ?? 0)).scenario)
    const cmp = compareRuns(r, b, at)
    console.log(c.id, at, cmp.overall, JSON.stringify({ ok: b.summary.successRate, failed: b.summary.failed + b.summary.rateLimited, ttr: b.summary.timeToRecoverySec, rec: b.summary.recovered }))
  }
})
