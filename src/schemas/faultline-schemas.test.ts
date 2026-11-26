import { describe, expect, it } from 'vitest'
import { lintSchema } from 'deepspace/worker'
import { faultlineSchemas } from './faultline-schemas'

describe('faultline schemas', () => {
  it('pass the SDK schema lint', () => {
    for (const s of faultlineSchemas) expect(lintSchema(s), s.name).toEqual([])
  })

  it('never let a client create, update, or delete a workspace-scoped row', () => {
    for (const s of faultlineSchemas.filter((x) => x.teamField)) {
      for (const [role, p] of Object.entries(s.permissions)) {
        expect([s.name, role, p.create, p.update, p.delete]).toEqual([s.name, role, false, false, false])
      }
    }
  })

  it('gate every workspace-scoped read on team membership, with no public access', () => {
    for (const s of faultlineSchemas.filter((x) => x.teamField)) {
      expect(s.permissions['*'].read, s.name).toBe(false)
      expect(s.permissions.viewer.read, s.name).toBe(false)
      expect(s.permissions.member.read, s.name).toBe('team')
      expect(s.permissions.admin.read, s.name).toBe('team')
    }
  })

  it('keeps lab scenarios private to their owner', () => {
    const cfg = faultlineSchemas.find((s) => s.name === 'simulation_configs')!
    expect(cfg.permissions.member.read).toBe('own')
    expect(cfg.permissions['*'].read).toBe(false)
  })
})
