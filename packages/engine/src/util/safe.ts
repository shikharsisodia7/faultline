/**
 * Copies only allow-listed own properties from `patch` onto `target`.
 *
 * Scenario patches can originate from user-edited lab scenarios (JSON), so a
 * plain `Object.assign` could be steered into writing `__proto__`,
 * `constructor`, or `prototype` and pollute object prototypes. Values are
 * deep-cloned through JSON so later mutation of the patch cannot alias state.
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

export function assignAllowed<T extends object>(target: T, patch: unknown, allowed: ReadonlySet<string>): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return target
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN.has(key) || !allowed.has(key)) continue
    const value = (patch as Record<string, unknown>)[key]
    if (value === undefined) continue
    ;(target as Record<string, unknown>)[key] = value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
  }
  return target
}

/** Fields a scheduled change may set on a service. */
export const SERVICE_PATCH_KEYS: ReadonlySet<string> = new Set([
  'capacity', 'queueCapacity', 'serviceTimeMs', 'serviceTimeCv', 'errorRate', 'latencyMultiplier',
  'available', 'timeoutMs', 'retry', 'circuitBreaker', 'contention', 'version',
])

/** Fields a scheduled change may set on a call edge. */
export const CALL_PATCH_KEYS: ReadonlySet<string> = new Set(['optional', 'enabled'])
