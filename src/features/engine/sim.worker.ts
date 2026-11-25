import { handleRequest } from './handle'
import type { WorkerEnvelope, WorkerRequest } from './protocol'

// Typed structurally: pulling in the "webworker" lib next to "dom" makes tsc
// report duplicate global declarations.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; req: WorkerRequest }>) => void) | null
  postMessage(message: WorkerEnvelope): void
}

ctx.onmessage = (e) => {
  const { id, req } = e.data
  let envelope: WorkerEnvelope
  try {
    envelope = { id, ok: true, payload: handleRequest(req) }
  } catch (err) {
    envelope = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  ctx.postMessage(envelope)
}
