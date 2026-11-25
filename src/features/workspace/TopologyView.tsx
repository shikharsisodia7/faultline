import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { CanonicalEvent, ReplayState, ServiceGraph } from '@faultline/engine'
import { SEVERITY_RANK } from '@faultline/engine'
import { cn } from '@/lib/utils'
import { HEALTH_COLOR } from '../shell/atoms'

const NODE_W = 160
const NODE_H = 48
const COL = NODE_W + 92
const ROW = NODE_H + 26

interface Props {
  graph: ServiceGraph
  state: ReplayState
  events: readonly CanonicalEvent[]
  selectedService: string | null
  onSelectService: (id: string | null) => void
  /** Service ids that the selected event belongs to, to emphasize. */
  focusService?: string | null
}

interface View {
  x: number
  y: number
  k: number
}

export function TopologyView({ graph, state, events, selectedService, onSelectService, focusService }: Props) {
  const [hideUnaffected, setHideUnaffected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 400 })
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  const affected = useMemo(() => {
    const s = new Set<string>()
    for (const e of events) if (SEVERITY_RANK[e.severity] >= 2) s.add(e.service)
    return s
  }, [events])

  const layout = useMemo(() => graph.layout(), [graph])
  const visible = useMemo(() => {
    const ids = Array.from(graph.services.keys())
    return new Set(hideUnaffected ? ids.filter((id) => affected.has(id) || graph.dependenciesOf(id).some((d) => affected.has(d))) : ids)
  }, [graph, hideUnaffected, affected])

  const positions = useMemo(() => {
    const rows = new Map<number, number>()
    for (const [id, p] of layout) if (visible.has(id)) rows.set(p.layer, (rows.get(p.layer) ?? 0) + 1)
    const maxRows = Math.max(1, ...rows.values())
    const order = new Map<number, number>()
    const out = new Map<string, { x: number; y: number }>()
    const sorted = Array.from(layout.entries()).filter(([id]) => visible.has(id)).sort((a, b) => a[1].layer - b[1].layer || a[1].order - b[1].order)
    for (const [id, p] of sorted) {
      const i = order.get(p.layer) ?? 0
      order.set(p.layer, i + 1)
      const n = rows.get(p.layer) ?? 1
      out.set(id, { x: p.layer * COL, y: i * ROW + ((maxRows - n) * ROW) / 2 })
    }
    return out
  }, [layout, visible])

  const bounds = useMemo(() => {
    let w = 0
    let h = 0
    for (const p of positions.values()) {
      w = Math.max(w, p.x + NODE_W)
      h = Math.max(h, p.y + NODE_H)
    }
    return { w, h }
  }, [positions])

  const fit = useCallback(() => {
    const pad = 40
    const k = Math.min(1.25, Math.max(0.3, Math.min((size.w - pad * 2) / Math.max(1, bounds.w), (size.h - pad * 2) / Math.max(1, bounds.h))))
    setView({ k, x: (size.w - bounds.w * k) / 2, y: (size.h - bounds.h * k) / 2 })
  }, [bounds, size])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => fit(), [fit])

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const k = Math.max(0.25, Math.min(3, v.k * factor))
      const f = k / v.k
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const blast = useMemo(() => new Set(selectedService ? graph.blastRadius(selectedService) : []), [graph, selectedService])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') zoomAt(1.2, size.w / 2, size.h / 2)
    else if (e.key === '-') zoomAt(1 / 1.2, size.w / 2, size.h / 2)
    else if (e.key === '0') fit()
    else if (e.key === 'Escape') onSelectService(null)
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden" data-tour="topology">
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        tabIndex={0}
        role="application"
        aria-label="Service dependency graph. Drag to pan, scroll or plus and minus to zoom, 0 to fit."
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-node]')) return
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
          setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
        }}
        onPointerUp={() => {
          if (drag.current && !drag.current.moved) onSelectService(null)
          drag.current = null
        }}
      >
        <svg width={size.w} height={size.h} className="block select-none">
          <defs>
            <pattern id="fl-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <path d="M24 0H0V24" fill="none" stroke="var(--color-grid)" strokeWidth="1" />
            </pattern>
            <marker id="fl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L8 4L0 8z" fill="var(--color-faint)" />
            </marker>
            <marker id="fl-arrow-fault" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L8 4L0 8z" fill="var(--color-fault)" />
            </marker>
          </defs>
          <rect width={size.w} height={size.h} fill="url(#fl-grid)" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {graph.dependencies.map((d) => {
              const a = positions.get(d.from)
              const b = positions.get(d.to)
              if (!a || !b) return null
              const callee = state.services[d.to]?.health
              const caller = state.services[d.from]?.health
              const propagating = (callee === 'failing' || callee === 'degraded') && (caller === 'failing' || caller === 'degraded')
              const x1 = a.x + NODE_W
              const y1 = a.y + NODE_H / 2
              const x2 = b.x
              const y2 = b.y + NODE_H / 2
              const back = x2 <= x1
              const path = back
                ? `M${x1} ${y1} C${x1 + 60} ${y1 - 70} ${x2 - 60} ${y2 - 70} ${x2} ${y2}`
                : `M${x1} ${y1} C${x1 + (x2 - x1) / 2} ${y1} ${x1 + (x2 - x1) / 2} ${y2} ${x2} ${y2}`
              const dim = selectedService && !(d.to === selectedService || blast.has(d.from) || d.from === selectedService)
              return (
                <g key={`${d.from}->${d.to}`} opacity={dim ? 0.25 : 1}>
                  <path d={path} fill="none" stroke="var(--color-border)" strokeWidth={1.5} markerEnd="url(#fl-arrow)" strokeDasharray={d.origin === 'trace' ? '4 4' : undefined} />
                  {propagating ? (
                    <path d={path} fill="none" stroke="var(--color-fault)" strokeWidth={2} strokeDasharray="6 10" className="fl-flow" markerEnd="url(#fl-arrow-fault)" />
                  ) : null}
                </g>
              )
            })}
            {Array.from(positions.entries()).map(([id, p]) => {
              const s = state.services[id]
              const health = s?.health ?? 'healthy'
              const def = graph.services.get(id)
              const isSel = id === selectedService
              const inBlast = blast.has(id)
              const dim = selectedService && !isSel && !inBlast
              const isFocus = focusService === id
              const color = HEALTH_COLOR[health]
              return (
                <g
                  key={id}
                  data-node={id}
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={dim ? 0.35 : 1}
                  className="cursor-pointer outline-none"
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSel}
                  aria-label={`${id}, ${def?.kind ?? 'service'}, ${health}${s?.errorsInWindow ? `, ${s.errorsInWindow} errors in the last 30 seconds` : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectService(isSel ? null : id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectService(isSel ? null : id)
                    }
                  }}
                >
                  {isSel || isFocus ? <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={8} fill="none" stroke="var(--color-foreground)" strokeOpacity={isSel ? 0.9 : 0.4} strokeWidth={1.5} /> : null}
                  {inBlast ? <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={8} fill="none" stroke="var(--color-fault)" strokeDasharray="4 3" strokeWidth={1.2} /> : null}
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={6}
                    fill={health === 'failing' ? 'var(--color-fault-muted)' : health === 'degraded' ? 'var(--color-degraded-muted)' : 'var(--color-card)'}
                    stroke={health === 'healthy' ? 'var(--color-input)' : color}
                    strokeWidth={health === 'healthy' ? 1 : 1.5}
                    style={{ transition: 'fill 200ms, stroke 200ms' }}
                  />
                  <circle cx={14} cy={17} r={4} fill={color} />
                  <text x={26} y={21} fontFamily="var(--font-mono)" fontSize={12} fill="var(--color-foreground)">
                    {id.length > 18 ? `${id.slice(0, 17)}…` : id}
                  </text>
                  <text x={14} y={37} fontFamily="var(--font-mono)" fontSize={10} fill="var(--color-muted-foreground)">
                    {def?.kind ?? 'service'}
                    {s?.errorsInWindow ? ` · ${s.errorsInWindow} err/30s` : s?.circuitOpen ? ' · breaker open' : s?.deploymentId ? ` · ${s.deploymentId.split('@')[1] ?? ''}` : ''}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <div className="no-print absolute right-2 top-2 flex items-center gap-1 rounded-md border border-border bg-background/90 p-1 backdrop-blur">
        <button type="button" className={cn('h-7 rounded px-2 font-mono text-[11px]', hideUnaffected ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')} aria-pressed={hideUnaffected} onClick={() => setHideUnaffected((v) => !v)}>
          {hideUnaffected ? 'Showing affected' : 'Hide unaffected'}
        </button>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <button type="button" aria-label="Zoom in" className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => zoomAt(1.2, size.w / 2, size.h / 2)}>
          <Plus className="size-3.5" />
        </button>
        <button type="button" aria-label="Zoom out" className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)}>
          <Minus className="size-3.5" />
        </button>
        <button type="button" aria-label="Fit graph" className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={fit}>
          <Maximize2 className="size-3.5" />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-border bg-background/85 px-2 py-1 font-mono text-[10.5px] text-muted-foreground backdrop-blur">
        {(['healthy', 'degraded', 'failing', 'recovering'] as const).map((h) => (
          <span key={h} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: HEALTH_COLOR[h] }} />
            {h}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true"><path d="M0 3h18" stroke="var(--color-fault)" strokeWidth="2" strokeDasharray="4 3" /></svg>
          propagating
        </span>
        {selectedService ? (
          <span className="inline-flex items-center gap-1.5 text-[var(--color-fault)]">blast radius: {blast.size} caller{blast.size === 1 ? '' : 's'}</span>
        ) : null}
      </div>
    </div>
  )
}
