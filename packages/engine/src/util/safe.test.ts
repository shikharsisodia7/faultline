import { describe, expect, it } from 'vitest'
import { assignAllowed, SERVICE_PATCH_KEYS } from './safe'
import { normalizeSource } from '../normalize/normalize'
import { runSimulation } from '../simulate/simulator'
import { service, type SimScenario } from '../simulate/model'

describe('prototype-pollution hardening', () => {
  it('assignAllowed ignores __proto__, constructor, prototype, and unknown keys', () => {
    const target = { capacity: 1 } as Record<string, unknown>
    const patch = JSON.parse('{"capacity": 5, "__proto__": {"polluted": true}, "constructor": {"x": 1}, "evil": 1}')
    assignAllowed(target, patch, SERVICE_PATCH_KEYS)
    expect(target.capacity).toBe(5)
    expect(target.evil).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype)
  })

  it('a scenario patch carrying __proto__ cannot pollute Object.prototype', () => {
    const patch = JSON.parse('{"latencyMultiplier": 2, "__proto__": {"pollutedBySim": true}}')
    const scenario: SimScenario = {
      id: 'p', name: 'p', seed: 1, sampleMs: 1000, durationSec: 5,
      timeline: [{ atSec: 1, label: 'x', origin: 'scenario', change: { kind: 'set_service', service: 'a', patch } }],
      model: { entry: 'a', networkMs: 1, clientTimeoutMs: 1000, clientRetry: { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1, jitter: 0 }, rateLimitRps: null, traffic: [{ atSec: 0, rps: 5 }], services: [service('a', 'service')], calls: [] },
    }
    runSimulation(scenario)
    expect(({} as Record<string, unknown>).pollutedBySim).toBeUndefined()
  })

  it('log key=value pairs named __proto__ are dropped, not applied', () => {
    const r = normalizeSource('2026-10-14T17:04:10Z [ERROR] api: boom __proto__=x constructor=y ok=1\n', { incidentId: 'i', sourceId: 's', sourceName: 'a.log' })
    expect(r.events[0].metadata.ok).toBe('1')
    expect(Object.keys(r.events[0].metadata)).not.toContain('__proto__')
    expect(Object.keys(r.events[0].metadata)).not.toContain('constructor')
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})
