import { getAuthToken } from 'deepspace'

export class ActionError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
  }
}

/** Calls a server action with the caller's JWT. Throws ActionError on refusal. */
export async function callAction<T = Record<string, unknown>>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new ActionError('Sign in to do that.', 'unauthenticated')
  const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  let payload: { success?: boolean; data?: T; error?: string; code?: string }
  try {
    payload = await res.json()
  } catch {
    throw new ActionError(`The server answered ${res.status} without a readable body.`)
  }
  if (!res.ok || payload.success === false) throw new ActionError(payload.error ?? `Request failed (${res.status}).`, payload.code)
  return payload.data as T
}
