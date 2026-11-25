import type { IncidentDataset, Intervention, RunResult, SimScenario } from '@faultline/engine'
import type { BranchResponse, WorkerEnvelope, WorkerRequest, WorkerResponse } from './protocol'

/**
 * Promise wrapper around the simulation worker. Falls back to running on the
 * main thread (lazily imported) when Workers are unavailable.
 */
let worker: Worker | null | undefined
let nextId = 1
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  if (typeof Worker === 'undefined') return (worker = null)
  try {
    worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'faultline-sim' })
    worker.onmessage = (e: MessageEvent<WorkerEnvelope>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.payload)
      else p.reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Simulation worker crashed'))
      pending.clear()
    }
  } catch {
    worker = null
  }
  return worker
}

async function request(req: WorkerRequest): Promise<WorkerResponse> {
  const w = getWorker()
  if (!w) {
    const { handleRequest } = await import('./handle')
    return handleRequest(req)
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, req })
  })
}

const generated = new Map<string, Promise<{ dataset: IncidentDataset; run: RunResult }>>()

/** Generates (once per session) a synthetic demo incident and its baseline run. */
export function loadDemo(slug: string): Promise<{ dataset: IncidentDataset; run: RunResult }> {
  let p = generated.get(slug)
  if (!p) {
    p = request({ type: 'generate', slug }).then((r) => {
      if (r.type !== 'generate') throw new Error('Unexpected worker response')
      return { dataset: r.dataset, run: r.run }
    })
    p.catch(() => generated.delete(slug))
    generated.set(slug, p)
  }
  return p
}

export async function runScenario(scenario: SimScenario): Promise<RunResult> {
  const r = await request({ type: 'run', scenario })
  if (r.type !== 'run') throw new Error('Unexpected worker response')
  return r.run
}

export async function runBranch(scenario: SimScenario, atSec: number, interventions: Intervention[], baseline?: RunResult): Promise<BranchResponse> {
  const r = await request({ type: 'branch', scenario, atSec, interventions, baseline })
  if (r.type !== 'branch') throw new Error('Unexpected worker response')
  return r.result
}
