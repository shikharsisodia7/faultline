import { describe, expect, it } from 'vitest'
import { isOwnPrivateKey } from './keys'

const APP = 'app_01HFAULT'
const ME = 'user_me'

describe('isOwnPrivateKey', () => {
  it('accepts a key in the caller’s own private folder', () => {
    expect(isOwnPrivateKey(`apps/${APP}/users/${ME}/incident.jsonl`, APP, ME)).toBe(true)
    expect(isOwnPrivateKey(`apps/${APP}/users/${ME}/nested/a-b_c.log`, APP, ME)).toBe(true)
  })

  it('rejects another user’s folder even when the caller id appears later in the key', () => {
    expect(isOwnPrivateKey(`apps/${APP}/users/victim/users/${ME}/x.jsonl`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/users/victim/x.jsonl`, APP, ME)).toBe(false)
  })

  it('rejects other apps, public scope, and prefix-only keys', () => {
    expect(isOwnPrivateKey(`apps/other_app/users/${ME}/x.jsonl`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/x.jsonl`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/users/${ME}/`, APP, ME)).toBe(false)
  })

  it('rejects a user id that is only a prefix of the folder name', () => {
    expect(isOwnPrivateKey(`apps/${APP}/users/${ME}x/file`, APP, ME)).toBe(false)
  })

  it('rejects traversal, doubled separators, backslashes, and control characters', () => {
    for (const bad of [
      `apps/${APP}/users/${ME}/../victim/x`,
      `apps/${APP}/users/${ME}//x`,
      `apps/${APP}/users/${ME}/a\\b`,
      `apps/${APP}/users/${ME}/a\u0000b`,
      `apps/${APP}/users/${ME}/a\nb`,
    ]) {
      expect(isOwnPrivateKey(bad, APP, ME), JSON.stringify(bad)).toBe(false)
    }
  })

  it('fails closed on missing identity', () => {
    expect(isOwnPrivateKey(`apps/${APP}/users/${ME}/x`, '', ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/users//x`, APP, '')).toBe(false)
  })
})
