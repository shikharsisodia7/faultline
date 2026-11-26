import { useEffect, useState } from 'react'
import type { IncidentDataset } from '@faultline/engine'
import { DEMO_SCENARIOS } from '@faultline/engine'
import { loadDemo } from '../engine/client'

/** Loads every synthetic demo incident (generated in the worker, cached per session). */
export function useDemoDatasets(enabled = true): { datasets: IncidentDataset[]; loading: boolean; error: string | null } {
  const [datasets, setDatasets] = useState<IncidentDataset[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) {
      setDatasets([])
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    Promise.all(DEMO_SCENARIOS.map((d) => loadDemo(d.slug).then((r) => r.dataset)))
      .then((ds) => alive && setDatasets(ds))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [enabled])
  return { datasets, loading, error }
}
