/**
 * True only for an R2 key inside the caller's private folder of this app:
 * exactly `apps/<appId>/users/<userId>/<something>`. Anchored to the prefix
 * (never a substring match) and refusing traversal, doubled separators,
 * backslashes, and control characters.
 */
export function isOwnPrivateKey(key: string, appId: string, userId: string): boolean {
  if (typeof key !== 'string' || !appId || !userId) return false
  if (key.includes('..') || key.includes('//') || key.includes('\\')) return false
  for (let i = 0; i < key.length; i++) if (key.charCodeAt(i) < 0x20) return false
  const prefix = `apps/${appId}/users/${userId}/`
  return key.startsWith(prefix) && key.length > prefix.length
}
