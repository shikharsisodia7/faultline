import { useCallback, useEffect, useRef, useState } from 'react'
import type { Intervention, RunResult, SimScenario } from '@faultline/engine'
import type { BranchResponse } from '../engine/protocol'
import { runBranch, runScenario } from '../engine/client'

/**
 * Baseline + one counterfactual branch for a scenario, computed by the real
 * simulator in the worker. `branch` is null until a decision has been run.
 */
export function useWhatIf(scenario: SimScenario, initialBaseline?: RunResult) {
  const [baseline, setBaseline] = useState<RunResult | null>(initialBaseline ?? null)
  const [result, setResult] = useState<(BranchResponse & { atSec: number; label: string }) | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (initialBaseline) {
      setBaseline(initialBaseline)
      return
    }
    let alive = true
    runScenario(scenario).then((r) => alive && setBaseline(r)).catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [scenario, initialBaseline])

  const explore = useCallback(
    async (atSec: number, interventions: Intervention[], label: string) => {
      const mine = ++seq.current
      setRunning(true)
      setError(null)
      try {
        const r = await runBranch(scenario, atSec, interventions, baseline ?? undefined)
        if (mine === seq.current) {
          setBaseline(r.baseline)
          setResult({ ...r, atSec, label })
        }
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (mine === seq.current) setRunning(false)
      }
    },
    [scenario, baseline],
  )

  return { baseline, result, running, error, explore, reset: () => setResult(null) }
}

/** A playhead in simulation seconds that can play, pause, and seek. */
export function usePlayhead(durationSec: number, { speed = 24, autoplay = false } = {}) {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(autoplay)
  const last = useRef<number | null>(null)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    if (!playing) {
      last.current = null
      return
    }
    let raf = 0
    const tick = (now: number) => {
      const prev = last.current ?? now
      last.current = now
      setT((cur) => {
        // Reduced motion: advance in larger, calmer steps (no smooth sweep).
        const next = cur + ((now - prev) / 1000) * (reduced ? speed * 2 : speed)
        if (next >= durationSec) {
          setPlaying(false)
          return durationSec
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, durationSec, reduced])
  return {
    t,
    playing,
    seek: (v: number) => setT(Math.max(0, Math.min(durationSec, v))),
    play: () => {
      setT((cur) => (cur >= durationSec ? 0 : cur))
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    replay: () => {
      setT(0)
      setPlaying(true)
    },
  }
}
