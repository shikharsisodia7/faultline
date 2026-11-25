import type { IncidentDataset } from './types'
import { compareEvents } from './normalize/normalize'
import { ServiceGraph, inferDependencies, servicesFromEvents } from './graph/topology'
import { correlate, type CorrelationParams, type CorrelationResult, type CorrelationWeights } from './correlate/correlate'
import { rankHypotheses, type Hypothesis } from './correlate/hypotheses'
import { ReplayEngine } from './replay/replay'

export interface IncidentAnalysis {
  dataset: IncidentDataset
  graph: ServiceGraph
  correlation: CorrelationResult
  hypotheses: Hypothesis[]
  replay: ReplayEngine
  timings: { correlateMs: number; rankMs: number; replayMs: number }
}

const perf = (globalThis as { performance?: { now(): number } }).performance
const now = () => (perf ? perf.now() : Date.now())

/**
 * One call that turns a dataset into everything the investigation surface
 * needs. Used identically by the browser demo and the ingestion job.
 */
export function analyzeIncident(
  input: IncidentDataset,
  params: Partial<Omit<CorrelationParams, 'weights'>> & { weights?: Partial<CorrelationWeights> } = {},
): IncidentAnalysis {
  const events = input.events.slice().sort(compareEvents)
  const services = servicesFromEvents(events, input.services)
  const dependencies = inferDependencies(events, input.dependencies)
  const dataset: IncidentDataset = { ...input, events, services, dependencies }
  const graph = new ServiceGraph(services, dependencies)
  const t0 = now()
  const correlation = correlate(events, graph, params)
  const t1 = now()
  const hypotheses = rankHypotheses(events, correlation.edges, graph)
  const t2 = now()
  const replay = new ReplayEngine(events, services.map((s) => s.id))
  const t3 = now()
  return {
    dataset,
    graph,
    correlation,
    hypotheses,
    replay,
    timings: { correlateMs: Math.round(t1 - t0), rankMs: Math.round(t2 - t1), replayMs: Math.round(t3 - t2) },
  }
}
