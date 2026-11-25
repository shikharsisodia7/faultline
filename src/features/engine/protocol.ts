import type { Comparison, IncidentDataset, Intervention, RunResult, SimScenario } from '@faultline/engine'

export type WorkerRequest =
  | { type: 'generate'; slug: string }
  | { type: 'run'; scenario: SimScenario }
  | { type: 'branch'; scenario: SimScenario; atSec: number; interventions: Intervention[]; baseline?: RunResult }

export interface BranchResponse {
  baseline: RunResult
  branch: RunResult
  comparison: Comparison
  assumptions: string[]
  branchScenario: SimScenario
}

export type WorkerResponse =
  | { type: 'generate'; dataset: IncidentDataset; run: RunResult }
  | { type: 'run'; run: RunResult }
  | { type: 'branch'; result: BranchResponse }

export type WorkerEnvelope = { id: number } & ({ ok: true; payload: WorkerResponse } | { ok: false; error: string })
