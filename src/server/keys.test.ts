import { describe, expect, it } from 'vitest'
import { isOwnPrivateKey } from './keys'

const APP = 'app_01HFAULT'
const ME = 'user_me'
const OTHER = 'user_other'
const own = (rest: string) => `apps/${APP}/users/${ME}/${rest}`

describe('isOwnPrivateKey', () => {
  it('accepts a key in the caller’s own private folder', () => {
    expect(isOwnPrivateKey(own('incident.jsonl'), APP, ME)).toBe(true)
    expect(isOwnPrivateKey(own('nested/a-b_c.log'), APP, ME)).toBe(true)
    expect(isOwnPrivateKey(own('report 2026 (1).csv'), APP, ME)).toBe(true)
  })

  it('cross-user: rejects another user’s folder, including nested prefix injection', () => {
    expect(isOwnPrivateKey(`apps/${APP}/users/${OTHER}/x.jsonl`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/users/${OTHER}/users/${ME}/x.jsonl`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`x/apps/${APP}/users/${ME}/x.jsonl`, APP, ME)).toBe(false)
  })

  it('mismatched identity: a key owned by me is not accepted for someone else', () => {
    expect(isOwnPrivateKey(own('x.jsonl'), APP, OTHER)).toBe(false)
  })

  it('cross-app: rejects other apps and the public app scope', () => {
    expect(isOwnPrivateKey(`apps/other_app/users/${ME}/x.jsonl`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}x/users/${ME}/x.jsonl`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/x.jsonl`, APP, ME)).toBe(false)
  })

  it('missing path boundaries: user id that is only a prefix, or nothing after the prefix', () => {
    expect(isOwnPrivateKey(`apps/${APP}/users/${ME}x/file`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/users/${ME}/`, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/users/${ME}`, APP, ME)).toBe(false)
  })

  it('traversal and unexpected separators', () => {
    for (const bad of [own('../victim/x'), own('a/../../x'), own('a//x'), own('a\\b'), own('a/ /b'), own('a/')]) {
      expect(isOwnPrivateKey(bad, APP, ME), JSON.stringify(bad)).toBe(false)
    }
  })

  it('percent-encoded traversal and double encoding', () => {
    for (const bad of [own('%2e%2e/x'), own('%2E%2E%2Fx'), own('a%2fb'), own('a%5Cb'), own('%252e%252e/x'), own('a%25b')]) {
      expect(isOwnPrivateKey(bad, APP, ME), bad).toBe(false)
    }
  })

  it('Unicode look-alikes, compatibility forms, and control characters', () => {
    for (const bad of [own('a∕b'), own('a／b'), own('ａ.log'), own('a\u0000b'), own('a\nb'), own('a\u007fb'), own('a⁄b')]) {
      expect(isOwnPrivateKey(bad, APP, ME), JSON.stringify(bad)).toBe(false)
    }
  })

  it('empty, malformed, and non-string input fails closed', () => {
    expect(isOwnPrivateKey('', APP, ME)).toBe(false)
    expect(isOwnPrivateKey(own('x'), '', ME)).toBe(false)
    expect(isOwnPrivateKey(`apps/${APP}/users//x`, APP, '')).toBe(false)
    expect(isOwnPrivateKey(own('x'), `${APP}/users/${ME}`, ME)).toBe(false)
    expect(isOwnPrivateKey(42 as unknown as string, APP, ME)).toBe(false)
    expect(isOwnPrivateKey(own('x'.repeat(2000)), APP, ME)).toBe(false)
  })
})
