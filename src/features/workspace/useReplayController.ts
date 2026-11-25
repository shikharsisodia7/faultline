import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayEngine, ReplayState } from '@faultline/engine'

export const SPEEDS = [1, 5, 10, 30, 60] as const

export interface ReplayController {
  t: number
  state: ReplayState
  playing: boolean
  speed: number
  progress: number
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  setSpeed: (s: number) => void
  stepForward: () => void
  stepBackward: () => void
  nextKeyframe: () => void
  prevKeyframe: () => void
}

/**
 * Presentation-side playback over a ReplayEngine. The engine owns historical
 * state (pure, deterministic); this hook only owns "where is the playhead".
 */
export function useReplayController(engine: ReplayEngine, initialT?: number): ReplayController {
  const pad = 5_000
  const min = engine.start - pad
  const max = engine.end + pad
  const [t, setT] = useState(() => initialT ?? min)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(10)
  const raf = useRef<number | null>(null)
  const last = useRef<number | null>(null)

  useEffect(() => {
    setT(initialT ?? engine.start - pad)
    setPlaying(false)
  }, [engine, initialT])

  useEffect(() => {
    if (!playing) {
      last.current = null
      return
    }
    const tick = (now: number) => {
      const prev = last.current ?? now
      last.current = now
      setT((cur) => {
        const next = cur + (now - prev) * speed
        if (next >= max) {
          setPlaying(false)
          return max
        }
        return next
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
  }, [playing, speed, max])

  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max])
  const state = useMemo(() => engine.stateAt(t), [engine, t])

  return {
    t,
    state,
    playing,
    speed,
    progress: max > min ? (t - min) / (max - min) : 0,
    play: () => {
      if (t >= max) setT(min)
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (!playing && t >= max) setT(min)
      setPlaying((p) => !p)
    },
    seek: (v) => setT(clamp(v)),
    setSpeed,
    stepForward: () => {
      setPlaying(false)
      setT((cur) => clamp(engine.stepForward(cur)))
    },
    stepBackward: () => {
      setPlaying(false)
      setT((cur) => clamp(engine.stepBackward(cur)))
    },
    nextKeyframe: () => {
      setPlaying(false)
      setT((cur) => clamp(engine.nextKeyframe(cur)?.ts ?? max))
    },
    prevKeyframe: () => {
      setPlaying(false)
      setT((cur) => clamp(engine.prevKeyframe(cur)?.ts ?? min))
    },
  }
}
