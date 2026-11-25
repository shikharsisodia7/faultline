import { branchScenario, compareRuns, demoScenario, generateIncident, runSimulation } from '@faultline/engine'
import type { WorkerRequest, WorkerResponse } from './protocol'

/** Pure request handler shared by the Web Worker and the main-thread fallback. */
export function handleRequest(req: WorkerRequest): WorkerResponse {
  switch (req.type) {
    case 'generate': {
      const demo = demoScenario(req.slug)
      if (!demo) throw new Error(`Unknown demo incident "${req.slug}".`)
      const { dataset, run } = generateIncident(demo)
      return { type: 'generate', dataset, run }
    }
    case 'run':
      return { type: 'run', run: runSimulation(req.scenario) }
    case 'branch': {
      const baseline = req.baseline ?? runSimulation(req.scenario)
      const { scenario, assumptions } = branchScenario(req.scenario, req.atSec, req.interventions)
      const branch = runSimulation(scenario)
      return {
        type: 'branch',
        result: { baseline, branch, comparison: compareRuns(baseline, branch, req.atSec), assumptions, branchScenario: scenario },
      }
    }
  }
}
