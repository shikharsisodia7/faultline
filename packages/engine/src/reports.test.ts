import { describe, expect, it } from 'vitest'
import { analyzeIncident } from './analyze'
import { reliabilityReport, type IncidentSummary } from './analytics/analytics'
import { normalizeSource } from './normalize/normalize'
import { generatePostmortem, postmortemToMarkdown } from './postmortem/postmortem'
import { DEMO_SCENARIOS } from './scenarios/definitions'
import { generateIncident, toJsonl } from './scenarios/generate'

const demo = DEMO_SCENARIOS[0]
const { dataset } = generateIncident(demo)
const analysis = analyzeIncident(dataset)

describe('synthetic incidents', () => {
  it('are generated reproducibly', () => {
    expect(generateIncident(demo).dataset).toEqual(dataset)
  })

  it('every demo produces errors, a deploy or change, an alert, and labeled annotations', () => {
    for (const d of DEMO_SCENARIOS) {
      const { dataset: ds } = generateIncident(d)
      expect(ds.meta.synthetic).toBe(true)
      expect(ds.events.some((e) => e.severity === 'error')).toBe(true)
      expect(ds.events.some((e) => e.type === 'alert')).toBe(true)
      expect(ds.events.some((e) => ['deploy', 'latency', 'config_change'].includes(e.type))).toBe(true)
      expect(ds.annotations.every((a) => a.synthetic)).toBe(true)
      expect(ds.events.length).toBeLessThan(8000)
    }
  })

  it('round-trips through the JSONL fixture format and normalizer', () => {
    const r = normalizeSource(toJsonl(dataset.events), { incidentId: 'rt', sourceId: 'rt', sourceName: 'fixture.jsonl' })
    expect(r.errors).toEqual([])
    expect(r.events.length + r.duplicates.length).toBe(dataset.events.length)
    expect(new Set(r.events.map((e) => e.service))).toEqual(new Set(dataset.events.map((e) => e.service)))
  })
})

describe('postmortem', () => {
  it('never presents an unreviewed hypothesis as a confirmed root cause', () => {
    const pm = generatePostmortem({ dataset, hypotheses: analysis.hypotheses })
    expect(pm.rootCauses.every((r) => r.status === 'inferred')).toBe(true)
    expect(pm.uncertainties.join(' ')).toMatch(/No hypothesis has been confirmed/)
    expect(pm.uncertainties.join(' ')).toMatch(/SYNTHETIC/)
  })

  it('shows confirmation only when a human confirmed it, and hides rejected ones', () => {
    const [h1, h2] = analysis.hypotheses
    const pm = generatePostmortem({ dataset, hypotheses: analysis.hypotheses, reviews: { [h1.id]: 'confirmed', ...(h2 ? { [h2.id]: 'rejected' } : {}) } })
    expect(pm.rootCauses[0].status).toBe('confirmed')
    if (h2) expect(pm.rootCauses.some((r) => r.title === h2.title && r.eventId === h2.eventId)).toBe(false)
  })

  it('renders every required section to Markdown', () => {
    const md = postmortemToMarkdown(generatePostmortem({ dataset, hypotheses: analysis.hypotheses, generatedAt: 0 }))
    for (const h of ['Executive summary', 'Duration', 'Impact', 'Timeline', 'Contributing factors', 'Potential root causes', 'Supporting evidence', 'Detection and response', 'Resolution', 'Lessons learned', 'Corrective actions', 'Remaining uncertainties']) {
      expect(md).toContain(`## ${h}`)
    }
    expect(md).toContain('Synthetic incident')
    expect(md).toContain('not a probability')
  })

  it('is deterministic for a fixed generation time', () => {
    const a = generatePostmortem({ dataset, hypotheses: analysis.hypotheses, generatedAt: 0 })
    const b = generatePostmortem({ dataset, hypotheses: analysis.hypotheses, generatedAt: 0 })
    expect(a).toEqual(b)
  })
})

describe('reliability analytics', () => {
  const base = { synthetic: false, category: 'bad-deploy', services: [], affectedServices: ['api'], failedDependencies: ['api->db'] }
  const H = 3_600_000
  const incidents: IncidentSummary[] = [
    { ...base, id: 'a', title: 'a', severity: 'sev1', startedAt: Date.UTC(2026, 9, 5), detectedAt: Date.UTC(2026, 9, 5) + 60_000, resolvedAt: Date.UTC(2026, 9, 5) + H },
    { ...base, id: 'b', title: 'b', severity: 'sev2', startedAt: Date.UTC(2026, 9, 7), detectedAt: null, resolvedAt: Date.UTC(2026, 9, 7) + 3 * H },
    { ...base, id: 'c', title: 'c', severity: 'sev2', startedAt: Date.UTC(2026, 9, 14), detectedAt: Date.UTC(2026, 9, 14) + 180_000, resolvedAt: null, category: 'capacity' },
  ]
  const r = reliabilityReport(incidents)

  it('computes MTTR and median with explicit denominators', () => {
    expect(r.mttrSec).toEqual({ value: 7200, n: 2 })
    expect(r.medianTtrSec).toEqual({ value: 7200, n: 2 })
    expect(r.mttdSec).toEqual({ value: 120, n: 2 })
  })

  it('groups frequency by ISO week and flags recurring categories', () => {
    expect(r.frequencyPerWeek).toEqual([{ weekStart: '2026-10-05', count: 2 }, { weekStart: '2026-10-12', count: 1 }])
    expect(r.byCategory.find((c) => c.category === 'bad-deploy')!.recurring).toBe(true)
    expect(r.byCategory.find((c) => c.category === 'capacity')!.recurring).toBe(false)
    expect(r.topDependencies[0]).toEqual({ dependency: 'api->db', incidents: 3 })
  })

  it('returns null with a reason when data is insufficient', () => {
    const empty = reliabilityReport([])
    expect(empty.mttrSec.value).toBeNull()
    expect(empty.mttrSec.reason).toMatch(/at least 1/)
  })
})

describe('summarizeIncident', () => {
  it('derives timestamps, affected services, and failed dependencies', async () => {
    const { summarizeIncident } = await import('./analytics/analytics')
    const s = summarizeIncident(dataset)
    expect(s.synthetic).toBe(true)
    expect(s.startedAt).not.toBeNull()
    expect(s.detectedAt! >= s.startedAt!).toBe(true)
    expect(s.affectedServices).toEqual(expect.arrayContaining(['pricing-db', 'pricing-svc', 'checkout-svc']))
    expect(s.failedDependencies).toContain('pricing-svc->pricing-db')
    expect(s.affectedServices).not.toContain('inventory-db')
  })
})


describe('guided-demo metadata matches what the simulation did', () => {
  for (const d of DEMO_SCENARIOS) {
    it(`${d.slug}: story beats line up with the run`, () => {
      const { run } = generateIncident(d)
      const onset = run.summary.onsetSec!
      expect(onset).not.toBeNull()
      const changeTimes = d.scenario.timeline.map((c) => c.atSec)
      let last = -1
      for (const beat of d.plain.story) {
        expect(beat.atSec).toBeGreaterThanOrEqual(last)
        last = beat.atSec
        if (beat.kind === 'change' || beat.kind === 'response') expect(changeTimes, beat.text).toContain(beat.atSec)
        if (beat.kind === 'impact') expect(beat.atSec, beat.text).toBeGreaterThanOrEqual(onset)
        if (beat.kind === 'recovery') expect(run.summary.recovered).toBe(true)
      }
      for (const id of Object.keys(d.plain.parts)) expect(d.scenario.model.services.map((s) => s.id)).toContain(id)
    })

    it(`${d.slug}: every choice compiles to valid interventions`, async () => {
      const { branchScenario } = await import('./simulate/interventions')
      for (const c of d.choices) expect(() => branchScenario(d.scenario, d.suggested.atSec, c.build(c.amount?.initial ?? 0))).not.toThrow()
    })
  }
})

describe('storefront hero scenario', () => {
  it('is healthy before the sale, fails during it, and is deterministic', async () => {
    const { STOREFRONT } = await import('./scenarios/storefront')
    const { runSimulation } = await import('./simulate/simulator')
    const r = runSimulation(STOREFRONT)
    expect(r.samples.filter((s) => s.t < 60).every((s) => s.errorRate === 0)).toBe(true)
    expect(r.summary.onsetSec!).toBeGreaterThanOrEqual(60)
    expect(r.summary.peakErrorRate).toBeGreaterThan(0.2)
    expect(runSimulation(STOREFRONT)).toEqual(r)
  })

  it('reports each choice from the model, including ones that barely help', async () => {
    const { STOREFRONT, STOREFRONT_CHOICES } = await import('./scenarios/storefront')
    const { runSimulation } = await import('./simulate/simulator')
    const { branchScenario, compareRuns } = await import('./simulate/interventions')
    const base = runSimulation(STOREFRONT)
    const cap = STOREFRONT_CHOICES.find((c) => c.id === 'capacity')!
    const better = runSimulation(branchScenario(STOREFRONT, 70, cap.build(24)).scenario)
    expect(compareRuns(base, better, 70).overall).toBe('better')
    expect(better.summary.successRate).toBeGreaterThan(base.summary.successRate + 0.15)
  })
})
