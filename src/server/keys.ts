/**
 * True only for an R2 key inside the caller's private folder of this app:
 * exactly `apps/<appId>/users/<userId>/<rest>`.
 *
 * `appId` must come from the worker environment and `userId` from the verified
 * JWT, never from request input. The check never decodes or normalizes the
 * key (that would create a second interpretation of it); instead it refuses
 * anything that could be read differently by another layer:
 *
 *  - prefix match only, anchored at the start (never a substring match)
 *  - no `..`, `//`, or backslash
 *  - no percent-encoded dot, slash, backslash, or percent (`%2e %2f %5c %25`),
 *    which covers encoded traversal and double encoding
 *  - no ASCII control characters or DEL
 *  - no Unicode slash look-alikes, and no characters that NFKC normalization
 *    would change (compatibility forms such as fullwidth letters)
 *  - no empty path segments in the remainder
 */
const ENCODED = /%(2e|2f|5c|25)/i
const SLASH_LOOKALIKES = /[⁄∕⧸／＼∖﹨]/

export function isOwnPrivateKey(key: string, appId: string, userId: string): boolean {
  if (typeof key !== 'string' || typeof appId !== 'string' || typeof userId !== 'string') return false
  if (!appId || !userId || key.length === 0 || key.length > 1024) return false
  if (appId.includes('/') || userId.includes('/')) return false
  if (key.includes('..') || key.includes('//') || key.includes('\\')) return false
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  if (ENCODED.test(key) || SLASH_LOOKALIKES.test(key)) return false
  if (key.normalize('NFKC') !== key) return false
  const prefix = `apps/${appId}/users/${userId}/`
  if (!key.startsWith(prefix)) return false
  const rest = key.slice(prefix.length)
  if (!rest || rest.split('/').some((seg) => seg.length === 0 || seg.trim().length === 0)) return false
  return true
}
