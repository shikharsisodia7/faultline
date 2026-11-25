import { describe, expect, it } from 'vitest'
import type { CanonicalEvent, EventType, Severity } from '../types'
import { Rng } from '../util/rng'
import { ReplayEngine } from './replay'

const T = 1_800_000_000_000
let n = 0
function ev(ts: number, service: string, severity: Severity, type: EventType = 'log', message = `${type}`): CanonicalEvent {
  n++
  return { id: `r${String(n).padStart(5, '0')}`, incidentId: 'i', ts, source: 's', service, environment: 'p', severity, type, message, metadata: {}, sourceRef: { sourceId: 's', sourceName: 's', line: n, format: 'json' } }
}

function incident(): CanonicalEvent[] {
  return [
    ev(T, 'api', 'info'),
    ev(T + 1_000, 'api', 'info', 'deploy'),
    ev(T + 5_000, 'db', 'error', 'saturation'),
    ev(T + 5_500, 'db', 'error'),
    ev(T + 6_000, 'db', 'error'),
    ev(T + 6_500, 'api', 'warn', 'retry'),
    ev(T + 7_000, 'api', 'critical', 'alert'),
    ev(T + 60_000, 'db', 'info', 'recovery', 'db recovered'),
  ]
}

describe('ReplayEngine', () => {
  it('derives health from events at a point in time', () => {
    const r = new ReplayEngine(incident())
    expect(r.stateAt(T + 2_000).services.db.health).toBe('healthy')
    expect(r.stateAt(T + 6_100).services.db.health).toBe('failing')
    expect(r.stateAt(T + 6_100).services.api.health).toBe('healthy')
    expect(r.stateAt(T + 6_600).services.api.health).toBe('degraded')
    expect(r.stateAt(T + 7_100).services.api.health).toBe('failing')
    expect(r.stateAt(T + 7_100).activeAlerts).toHaveLength(1)
    expect(r.stateAt(T + 61_000).services.db.health).toBe('recovering')
    expect(r.stateAt(T + 200_000).services.db.health).toBe('healthy')
  })

  it('includes an event exactly at the query timestamp (inclusive boundary)', () => {
    const r = new ReplayEngine(incident())
    expect(r.stateAt(T + 5_000).index).toBe(3)
    expect(r.stateAt(T + 4_999).index).toBe(2)
    expect(r.indexAt(T - 1)).toBe(0)
    expect(r.indexAt(T + 1e9)).toBe(8)
  })

  it('produces identical state on repeated replay (determinism)', () => {
    const a = new ReplayEngine(incident()).stateAt(T + 6_200)
    const b = new ReplayEngine(incident()).stateAt(T + 6_200)
    expect(a).toEqual(b)
  })

  it('restores the correct earlier state when seeking backward', () => {
    const r = new ReplayEngine(incident())
    const early = r.stateAt(T + 2_000)
    r.stateAt(T + 70_000)
    expect(r.stateAt(T + 2_000)).toEqual(early)
  })

  it('is independent of input order (out-of-order arrival)', () => {
    const shuffled = incident().slice().reverse()
    expect(new ReplayEngine(shuffled).stateAt(T + 6_200)).toEqual(new ReplayEngine(incident()).stateAt(T + 6_200))
  })

  it('handles an empty timeline', () => {
    const r = new ReplayEngine([], ['api'])
    expect(r.length).toBe(0)
    expect(r.stateAt(T).services.api.health).toBe('healthy')
    expect(r.keyframes).toEqual([])
    expect(r.nextKeyframe(T)).toBeUndefined()
  })

  it('checkpointed seek equals a full replay at random times (snapshot equivalence)', () => {
    const rng = new Rng(99)
    const events: CanonicalEvent[] = []
    const sev: Severity[] = ['info', 'info', 'warn', 'error', 'critical']
    const types: EventType[] = ['log', 'error', 'retry', 'deploy', 'recovery', 'alert', 'circuit_open', 'circuit_close']
    for (let i = 0; i < 3000; i++) events.push(ev(T + rng.int(600_000), `svc-${rng.int(9)}`, sev[rng.int(5)], types[rng.int(types.length)]))
    const r = new ReplayEngine(events, [], { snapshotInterval: 64 })
    for (let k = 0; k < 60; k++) {
      const t = T + rng.int(620_000)
      expect(r.stateAt(t)).toEqual(r.stateAtFullReplay(t))
    }
  })

  it('steps and navigates keyframes', () => {
    const r = new ReplayEngine(incident())
    expect(r.stepForward(T)).toBe(T + 1_000)
    expect(r.stepBackward(T + 5_000)).toBe(T + 1_000)
    expect(r.nextKeyframe(T)!.reason).toBe('deploy')
    expect(r.prevKeyframe(T + 59_000)!.reason).toBe('alert')
    expect(r.prevKeyframe(T + 61_000)!.reason).toBe('recovery')
    expect(r.keyframes.map((k) => k.reason)).toEqual(['deploy', 'saturation', 'alert', 'recovery'])
  })

  it('incorporates late-arriving events without mutating the original', () => {
    const r = new ReplayEngine(incident())
    const late = ev(T + 3_000, 'cache', 'error')
    const r2 = r.withEvents([late])
    expect(r.length).toBe(8)
    expect(r2.length).toBe(9)
    expect(r2.stateAt(T + 3_500).services.cache.errorsInWindow).toBe(1)
  })

  it('buckets events per service for swimlanes', () => {
    const b = new ReplayEngine(incident()).buckets(10_000)
    expect(b.series.db[0].errors).toBe(3)
    expect(b.series.api[0].warnings).toBe(1)
  })
})
