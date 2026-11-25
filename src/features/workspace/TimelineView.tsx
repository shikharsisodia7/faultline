import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark as BookmarkIcon, ChevronFirst, ChevronLast, GitBranch, Pause, Play, StepBack, StepForward } from 'lucide-react'
import type { CanonicalEvent, Keyframe, ReplayEngine } from '@faultline/engine'
import { cn } from '@/lib/utils'
import { relTime, relTimeShort, utcClock } from '@/lib/format'
import type { Bookmark } from './adapter'
import { SPEEDS, type ReplayController } from './useReplayController'

const LABEL_W = 128
const LANE_H = 18
const MARKER_H = 22
const AXIS_H = 18

interface Props {
  engine: ReplayEngine
  ctl: ReplayController
  serviceOrder: string[]
  selectedEventId: string | null
  onSelectEvent: (id: string) => void
  bookmarks: Bookmark[]
  onAddBookmark?: () => void
  branchAt: number | null
  onBranchHere?: () => void
  highlightService?: string | null
  /** Event ids passing the current filters (others are dimmed). */
  filteredIds?: Set<string> | null
}

function markerShape(kind: Keyframe['reason'] | string): 'diamond' | 'triangle' | 'circle' | 'square' {
  if (/deploy|rollback|config|scale/.test(kind)) return 'diamond'
  if (/alert|critical/.test(kind)) return 'triangle'
  if (/recovery|circuit close/.test(kind)) return 'circle'
  return 'square'
}

function markerColor(e: CanonicalEvent | undefined): string {
  if (!e) return 'var(--color-faint)'
  if (e.type === 'recovery' || e.type === 'circuit_close') return 'var(--color-healthy)'
  if (e.type === 'deploy' || e.type === 'config_change' || e.type === 'rollback' || e.type === 'scale') return 'var(--color-foreground)'
  if (e.severity === 'warn') return 'var(--color-degraded)'
  if (e.severity === 'error' || e.severity === 'critical') return 'var(--color-fault)'
  return 'var(--color-muted-foreground)'
}

export function TimelineView({ engine, ctl, serviceOrder, selectedEventId, onSelectEvent, bookmarks, onAddBookmark, branchAt, onBranchHere, highlightService, filteredIds }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pad = 5_000
  const t0 = engine.start - pad
  const t1 = engine.end + pad
  const plotW = Math.max(100, width - LABEL_W - 12)
  const x = (t: number) => LABEL_W + ((t - t0) / Math.max(1, t1 - t0)) * plotW
  const tAt = (px: number) => t0 + ((px - LABEL_W) / plotW) * (t1 - t0)

  const bucketMs = useMemo(() => Math.max(500, Math.ceil((t1 - t0) / Math.max(40, plotW / 3))), [t0, t1, plotW])
  const buckets = useMemo(() => engine.buckets(bucketMs), [engine, bucketMs])
  const byId = useMemo(() => new Map(engine.events.map((e) => [e.id, e])), [engine])
  const height = AXIS_H + MARKER_H + serviceOrder.length * LANE_H + 6

  const ticks = useMemo(() => {
    const span = t1 - t0
    const steps = [5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000]
    const step = steps.find((s) => span / s <= Math.max(4, plotW / 90)) ?? 600_000
    const out: number[] = []
    for (let t = Math.ceil((t0 - engine.start) / step) * step + engine.start; t <= t1; t += step) out.push(t)
    return out
  }, [t0, t1, plotW, engine.start])

  const scrub = useRef(false)
  const seekFromPointer = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    ctl.seek(tAt(clientX - r.left))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (e.shiftKey) ctl.nextKeyframe()
      else ctl.stepForward()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (e.shiftKey) ctl.prevKeyframe()
      else ctl.stepBackward()
    } else if (e.key === 'Home') {
      e.preventDefault()
      ctl.seek(t0)
    } else if (e.key === 'End') {
      e.preventDefault()
      ctl.seek(t1)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-tour="timeline">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        <IconBtn label="Previous key event (Shift+Left)" onClick={ctl.prevKeyframe}><ChevronFirst /></IconBtn>
        <IconBtn label="Step back one event (Left)" onClick={ctl.stepBackward}><StepBack /></IconBtn>
        <button
          type="button"
          onClick={ctl.toggle}
          aria-label={ctl.playing ? 'Pause replay (Space)' : 'Play replay (Space)'}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          data-tour="play"
        >
          {ctl.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {ctl.playing ? 'Pause' : 'Replay'}
        </button>
        <IconBtn label="Step forward one event (Right)" onClick={ctl.stepForward}><StepForward /></IconBtn>
        <IconBtn label="Next key event (Shift+Right)" onClick={ctl.nextKeyframe}><ChevronLast /></IconBtn>
        <div className="ml-1 flex items-center rounded-md border border-border p-0.5" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={ctl.speed === s} onClick={() => ctl.setSpeed(s)} className={cn('h-6 rounded px-1.5 font-mono text-[11px]', ctl.speed === s ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {s}x
            </button>
          ))}
        </div>
        <div className="ml-2 font-mono text-[12px] tabular text-foreground" aria-live="off">
          {relTime(ctl.t - engine.start)}
          <span className="ml-2 text-muted-foreground">{utcClock(ctl.t)} UTC</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {onAddBookmark ? (
            <button type="button" onClick={onAddBookmark} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[12px] text-muted-foreground hover:text-foreground">
              <BookmarkIcon className="size-3.5" /> Bookmark
            </button>
          ) : null}
          {onBranchHere ? (
            <button type="button" onClick={onBranchHere} data-tour="branch" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-sim)]/50 px-2 text-[12px] text-[var(--color-sim)] hover:bg-[var(--color-sim-muted)]">
              <GitBranch className="size-3.5" /> Branch here
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={ref}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        tabIndex={0}
        role="slider"
        aria-label="Incident timeline. Left and right step events, Shift jumps between key events."
        aria-valuemin={0}
        aria-valuemax={Math.round((t1 - t0) / 1000)}
        aria-valuenow={Math.round((ctl.t - t0) / 1000)}
        aria-valuetext={relTime(ctl.t - engine.start)}
        onKeyDown={onKeyDown}
      >
        <svg
          width={width}
          height={height}
          className="block touch-none select-none"
          onPointerDown={(e) => {
            if ((e.target as Element).closest('[data-marker]')) return
            const r = ref.current!.getBoundingClientRect()
            if (e.clientX - r.left < LABEL_W) return
            scrub.current = true
            ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
            seekFromPointer(e.clientX)
          }}
          onPointerMove={(e) => scrub.current && seekFromPointer(e.clientX)}
          onPointerUp={() => (scrub.current = false)}
        >
          {/* axis */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={AXIS_H - 4} y2={height} stroke="var(--color-grid)" />
              <text x={x(t) + 3} y={11} fontSize={10} fontFamily="var(--font-mono)" fill="var(--color-faint)">
                {relTimeShort(t - engine.start)}
              </text>
            </g>
          ))}
          {/* key event markers */}
          <text x={8} y={AXIS_H + 15} fontSize={10} fontFamily="var(--font-mono)" fill="var(--color-muted-foreground)">key events</text>
          {engine.keyframes.map((k) => {
            const e = byId.get(k.eventId)
            const cx = x(k.ts)
            const cy = AXIS_H + MARKER_H / 2
            const shape = markerShape(k.reason)
            const sel = selectedEventId === k.eventId
            const fill = markerColor(e)
            return (
              <g key={k.eventId} data-marker className="cursor-pointer" onClick={() => onSelectEvent(k.eventId)}>
                <title>{`${relTime(k.ts - engine.start)} ${k.service}: ${e?.message ?? k.reason}`}</title>
                {shape === 'diamond' ? <rect x={cx - 4} y={cy - 4} width={8} height={8} transform={`rotate(45 ${cx} ${cy})`} fill={fill} /> : null}
                {shape === 'triangle' ? <path d={`M${cx} ${cy - 5}L${cx + 5} ${cy + 4}L${cx - 5} ${cy + 4}z`} fill={fill} /> : null}
                {shape === 'circle' ? <circle cx={cx} cy={cy} r={4} fill={fill} /> : null}
                {shape === 'square' ? <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill={fill} /> : null}
                {sel ? <circle cx={cx} cy={cy} r={8} fill="none" stroke="var(--color-foreground)" strokeWidth={1.2} /> : null}
              </g>
            )
          })}
          {/* lanes */}
          {serviceOrder.map((svc, i) => {
            const y = AXIS_H + MARKER_H + i * LANE_H
            const series = buckets.series[svc] ?? []
            const hl = highlightService === svc
            return (
              <g key={svc}>
                <rect x={0} y={y} width={width} height={LANE_H} fill={hl ? 'var(--color-secondary)' : i % 2 ? 'transparent' : 'rgba(255,255,255,0.012)'} />
                <text x={8} y={y + 12.5} fontSize={10.5} fontFamily="var(--font-mono)" fill={hl ? 'var(--color-foreground)' : 'var(--color-muted-foreground)'}>
                  {svc.length > 17 ? `${svc.slice(0, 16)}…` : svc}
                </text>
                {series.map((c, b) => {
                  if (c.total === 0) return null
                  const bx = x(buckets.start + b * bucketMs)
                  const bw = Math.max(1, (bucketMs / (t1 - t0)) * plotW - 0.5)
                  const h = Math.min(LANE_H - 4, 3 + Math.log2(1 + c.total) * 2.6)
                  const color = c.errors ? 'var(--color-fault)' : c.warnings ? 'var(--color-degraded)' : 'var(--color-faint)'
                  return <rect key={b} x={bx} y={y + (LANE_H - h) / 2} width={bw} height={h} fill={color} opacity={c.errors ? 0.9 : 0.7} />
                })}
              </g>
            )
          })}
          {/* selected event tick */}
          {selectedEventId && byId.get(selectedEventId) ? (() => {
            const e = byId.get(selectedEventId)!
            const lane = serviceOrder.indexOf(e.service)
            return lane >= 0 ? <rect x={x(e.ts) - 1} y={AXIS_H + MARKER_H + lane * LANE_H + 1} width={3} height={LANE_H - 2} fill="var(--color-foreground)" /> : null
          })() : null}
          {/* filtered-out dimming hint */}
          {filteredIds && filteredIds.size === 0 ? (
            <text x={LABEL_W + 8} y={height - 8} fontSize={10.5} fontFamily="var(--font-mono)" fill="var(--color-degraded)">no events match the current filters</text>
          ) : null}
          {/* bookmarks */}
          {bookmarks.map((b) => (
            <g key={b.id} data-marker className="cursor-pointer" onClick={() => ctl.seek(b.ts)}>
              <title>{`Bookmark: ${b.label}`}</title>
              <line x1={x(b.ts)} x2={x(b.ts)} y1={AXIS_H} y2={height} stroke="var(--color-degraded)" strokeOpacity={0.5} strokeDasharray="2 3" />
              <path d={`M${x(b.ts)} ${AXIS_H}h7l-2 3 2 3h-7z`} fill="var(--color-degraded)" />
            </g>
          ))}
          {/* branch point */}
          {branchAt !== null ? (
            <g>
              <line x1={x(branchAt)} x2={x(branchAt)} y1={AXIS_H - 2} y2={height} stroke="var(--color-sim)" strokeWidth={1.5} strokeDasharray="5 3" />
              <text x={x(branchAt) + 4} y={AXIS_H + 8} fontSize={10} fontFamily="var(--font-mono)" fill="var(--color-sim)">branch</text>
            </g>
          ) : null}
          {/* playhead */}
          <line x1={x(ctl.t)} x2={x(ctl.t)} y1={0} y2={height} stroke="var(--color-foreground)" strokeWidth={1.2} />
          <path d={`M${x(ctl.t) - 5} 0h10l-5 6z`} fill="var(--color-foreground)" />
        </svg>
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground [&_svg]:size-3.5">
      {children}
    </button>
  )
}
