import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Sample } from '@faultline/engine'
import { cn } from '@/lib/utils'
import { pctText, totalsAt } from './plain'

export interface TimelineMarker {
  atSec: number
  label: string
  kind?: 'change' | 'impact' | 'response' | 'recovery' | 'strain'
}

interface Props {
  durationSec: number
  baseline: readonly Sample[]
  branch?: readonly Sample[] | null
  /** Where the alternative path leaves the original (simulation seconds). */
  decisionSec?: number | null
  branchLabel?: string
  t: number
  onSeek: (t: number) => void
  /** When provided, the decision point can be dragged or set with "D". */
  onDecision?: (sec: number) => void
  markers?: TimelineMarker[]
  className?: string
  compact?: boolean
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

function strokeFor(rate: number, base: string) {
  if (rate >= 0.2) return 'var(--color-fault)'
  if (rate >= 0.01) return 'var(--color-degraded)'
  return base
}

/**
 * The Faultline Timeline: the recorded sequence of events and, after a
 * decision point, an alternative branch computed by the simulator. One
 * playhead scrubs both paths.
 */
export function FaultlineTimeline({ durationSec, baseline, branch, decisionSec, t, onSeek, onDecision, markers = [], className, compact }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(720)
  const uid = useId().replace(/:/g, '')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hasBranch = Boolean(branch && decisionSec !== null && decisionSec !== undefined)
  const narrow = w < 560
  const padL = narrow ? 12 : 116
  const padR = 16
  const amp = compact ? 22 : 34
  const yA = compact ? 44 : 64
  const yB = yA + (compact ? 64 : 92)
  const height = (hasBranch || onDecision ? yB : yA) + (compact ? 34 : 44)
  const plotW = w - padL - padR
  const x = (sec: number) => padL + (Math.max(0, Math.min(durationSec, sec)) / durationSec) * plotW
  const tAt = (px: number) => ((px - padL) / plotW) * durationSec

  const area = (samples: readonly Sample[], y: number, from = 0) => {
    const pts = samples.filter((s) => s.t >= from)
    if (pts.length === 0) return ''
    let d = `M${x(pts[0].t - 1)} ${y}`
    for (const s of pts) d += `L${x(s.t)} ${y - Math.min(1, s.errorRate) * amp}`
    d += `L${x(pts[pts.length - 1].t)} ${y}Z`
    return d
  }
  const segments = (samples: readonly Sample[], y: number, base: string, from = 0) =>
    samples
      .filter((s) => s.t > from)
      .map((s) => <line key={s.t} x1={x(s.t - 1)} x2={x(s.t)} y1={y} y2={y} stroke={strokeFor(s.errorRate, base)} strokeWidth={3} strokeLinecap="butt" />)

  const ticks = useMemo(() => {
    const step = durationSec > 420 ? 120 : durationSec > 200 ? 60 : 30
    const out: number[] = []
    for (let s = 0; s <= durationSec; s += step) out.push(s)
    return out
  }, [durationSec])

  const drag = useRef<'seek' | 'decision' | null>(null)
  const pointerSec = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.round(tAt(e.clientX - r.left))
  }

  const nowA = totalsAt(baseline, t)
  const nowB = hasBranch ? totalsAt(branch!, t) : null
  const shownMarkers = markers.filter((m) => m.atSec <= durationSec).slice(0, narrow ? 3 : 8)
  const dSec = decisionSec ?? null

  return (
    <div className={cn('w-full select-none', className)}>
      <div
        ref={ref}
        className="relative rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        tabIndex={0}
        role="slider"
        aria-label={`Timeline. ${hasBranch ? 'Original path and alternative path. ' : ''}Use left and right arrows to move through time${onDecision ? ', D to place the decision here' : ''}.`}
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${fmt(t)}. Original: ${pctText(nowA.rate)} failing now, ${nowA.failed.toLocaleString()} failed so far.${nowB ? ` Alternative: ${pctText(nowB.rate)} failing now, ${nowB.failed.toLocaleString()} failed so far.` : ''}`}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1
          if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(durationSec, t + step)) }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, t - step)) }
          else if (e.key === 'Home') { e.preventDefault(); onSeek(0) }
          else if (e.key === 'End') { e.preventDefault(); onSeek(durationSec) }
          else if ((e.key === 'd' || e.key === 'D') && onDecision) { e.preventDefault(); onDecision(Math.round(t)) }
        }}
      >
        <svg
          width={w}
          height={height}
          className="block touch-none"
          onPointerDown={(e) => {
            const sec = pointerSec(e)
            if (onDecision && dSec !== null && Math.abs(x(sec) - x(dSec)) < 14 && (e.target as Element).closest('[data-decision]')) drag.current = 'decision'
            else drag.current = 'seek'
            ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
            if (drag.current === 'seek') onSeek(Math.max(0, Math.min(durationSec, sec)))
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            const sec = Math.max(0, Math.min(durationSec - 5, pointerSec(e)))
            if (drag.current === 'decision') onDecision?.(sec)
            else onSeek(sec)
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <defs>
            <linearGradient id={`fA${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--color-fault)" stopOpacity="0.32" />
              <stop offset="1" stopColor="var(--color-fault)" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id={`fB${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--color-sim)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--color-sim)" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {ticks.map((s) => (
            <g key={s}>
              <line x1={x(s)} x2={x(s)} y1={yA - amp - 8} y2={height - 22} stroke="var(--color-grid)" />
              <text x={x(s)} y={height - 6} textAnchor={s === 0 ? 'start' : s === durationSec ? 'end' : 'middle'} fontSize={11} fontFamily="var(--font-mono)" fill="var(--color-faint)">{fmt(s)}</text>
            </g>
          ))}

          {!narrow ? (
            <>
              <text x={0} y={yA + 4} fontSize={12.5} fill="var(--color-foreground)" fontWeight={500}>What happened</text>
              {hasBranch || onDecision ? <text x={0} y={yB + 4} fontSize={12.5} fill="var(--color-sim)" fontWeight={500}>What if</text> : null}
            </>
          ) : null}

          {/* Original path */}
          <path d={area(baseline, yA)} fill={`url(#fA${uid})`} />
          <line x1={x(0)} x2={x(durationSec)} y1={yA} y2={yA} stroke="var(--color-border)" strokeWidth={3} />
          {segments(baseline, yA, 'var(--color-foreground)')}

          {/* Alternative branch */}
          {hasBranch && dSec !== null ? (
            <g>
              <path d={`M${x(dSec)} ${yA} C${x(dSec) + 34} ${yA} ${x(dSec) + 10} ${yB} ${x(dSec) + 44} ${yB}`} fill="none" stroke="var(--color-sim)" strokeWidth={3} />
              <path d={area(branch!, yB, dSec + 2)} fill={`url(#fB${uid})`} />
              <line x1={x(dSec) + 44} x2={x(durationSec)} y1={yB} y2={yB} stroke="var(--color-sim)" strokeOpacity={0.35} strokeWidth={3} />
              {segments(branch!, yB, 'var(--color-sim)', dSec + 3)}
            </g>
          ) : onDecision && dSec !== null ? (
            <path d={`M${x(dSec)} ${yA} C${x(dSec) + 34} ${yA} ${x(dSec) + 10} ${yB} ${x(dSec) + 44} ${yB} L${x(durationSec)} ${yB}`} fill="none" stroke="var(--color-sim)" strokeWidth={2} strokeDasharray="5 5" strokeOpacity={0.6} />
          ) : null}

          {/* Story markers */}
          {(() => {
            // Greedy two-row label placement: a label takes the first row with
            // room; otherwise it is omitted (the marker keeps a tooltip).
            const rowEnd = [-Infinity, -Infinity]
            return shownMarkers.map((m, i) => {
              const mx = x(m.atSec)
              const color = m.kind === 'response' || m.kind === 'recovery' ? 'var(--color-healthy)' : m.kind === 'impact' ? 'var(--color-fault)' : 'var(--color-foreground)'
              const text = m.label.length > 24 ? `${m.label.slice(0, 23).trimEnd()}…` : m.label
              const half = (text.length * 5.9) / 2
              let row = -1
              if (!compact) for (const r of [0, 1]) if (mx - half > rowEnd[r] + 8) { row = r; rowEnd[r] = mx + half; break }
              return (
                <g key={`${m.atSec}-${i}`}>
                  <title>{m.label}</title>
                  <rect x={mx - 4} y={yA - 4} width={8} height={8} transform={`rotate(45 ${mx} ${yA})`} fill="var(--color-background)" stroke={color} strokeWidth={2} />
                  {row >= 0 ? (
                    <text x={Math.max(padL + half, Math.min(w - padR - half, mx))} y={row === 0 ? yA - amp - 14 : yA + 22} textAnchor="middle" fontSize={11} fill="var(--color-muted-foreground)">{text}</text>
                  ) : null}
                </g>
              )
            })
          })()}

          {/* Decision point */}
          {dSec !== null && (hasBranch || onDecision) ? (
            <g data-decision className={onDecision ? 'cursor-ew-resize' : undefined}>
              <circle cx={x(dSec)} cy={yA} r={onDecision ? 9 : 7} fill="var(--color-foreground)" stroke="var(--color-background)" strokeWidth={3} />
              <text x={x(dSec)} y={yB + 24} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--color-sim)">decision {fmt(dSec)}</text>
            </g>
          ) : null}

          {/* Playhead */}
          <line x1={x(t)} x2={x(t)} y1={yA - amp - 10} y2={(hasBranch || onDecision ? yB : yA) + 12} stroke="var(--color-foreground)" strokeWidth={1.25} />
          <circle cx={x(t)} cy={yA} r={4.5} fill="var(--color-foreground)" />
          {hasBranch && dSec !== null && t >= dSec ? <circle cx={x(t)} cy={yB} r={4.5} fill="var(--color-sim)" /> : null}
        </svg>
      </div>
    </div>
  )
}
