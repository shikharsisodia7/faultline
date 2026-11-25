import { useEffect, useMemo, useRef, useState } from 'react'

export interface Series {
  id: string
  label: string
  color: string
  dashed?: boolean
  points: Array<{ x: number; y: number | null }>
}

interface Props {
  series: Series[]
  height?: number
  yFormat: (v: number) => string
  xFormat?: (v: number) => string
  yMax?: number
  marker?: { x: number; label: string; color: string } | null
  title: string
  description?: string
}

/** Minimal multi-series line chart with a hover readout. */
export function SeriesChart({ series, height = 150, yFormat, xFormat = (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`, yMax, marker, title, description }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const padL = 46
  const padR = 10
  const padT = 8
  const padB = 20
  const { xMin, xMax, top } = useMemo(() => {
    let xMin = Infinity
    let xMax = -Infinity
    let top = 0
    for (const s of series) for (const p of s.points) {
      xMin = Math.min(xMin, p.x)
      xMax = Math.max(xMax, p.x)
      if (p.y !== null) top = Math.max(top, p.y)
    }
    if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1 }
    return { xMin, xMax, top: yMax ?? (top > 0 ? top * 1.1 : 1) }
  }, [series, yMax])
  const plotW = Math.max(10, w - padL - padR)
  const plotH = height - padT - padB
  const sx = (x: number) => padL + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * plotW
  const sy = (y: number) => padT + plotH - (y / top) * plotH
  const path = (pts: Series['points']) => {
    let d = ''
    let pen = false
    for (const p of pts) {
      if (p.y === null) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(Math.min(p.y, top)).toFixed(1)}`
      pen = true
    }
    return d
  }
  const hx = hover !== null ? xMin + ((hover - padL) / plotW) * (xMax - xMin) : null

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">{title}</span>
        <span className="flex flex-wrap justify-end gap-x-3 gap-y-0.5">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
              <svg width="16" height="6" aria-hidden="true"><path d="M0 3h16" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} /></svg>
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      {description ? <p className="sr-only">{description}</p> : null}
      <div ref={ref} className="relative">
        <svg width={w} height={height} className="block" onPointerMove={(e) => { const r = ref.current!.getBoundingClientRect(); const px = e.clientX - r.left; setHover(px >= padL && px <= padL + plotW ? px : null) }} onPointerLeave={() => setHover(null)} role="img" aria-label={`${title}${description ? `. ${description}` : ''}`}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={padL} x2={padL + plotW} y1={sy(top * f)} y2={sy(top * f)} stroke="var(--color-grid)" />
              <text x={padL - 6} y={sy(top * f) + 3} textAnchor="end" fontSize={10} fontFamily="var(--font-mono)" fill="var(--color-faint)">{yFormat(top * f)}</text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const xv = xMin + f * (xMax - xMin)
            return <text key={f} x={sx(xv)} y={height - 5} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fill="var(--color-faint)">{xFormat(xv)}</text>
          })}
          {marker ? (
            <g>
              <line x1={sx(marker.x)} x2={sx(marker.x)} y1={padT} y2={padT + plotH} stroke={marker.color} strokeDasharray="4 3" />
              <text x={sx(marker.x) + 4} y={padT + 9} fontSize={10} fontFamily="var(--font-mono)" fill={marker.color}>{marker.label}</text>
            </g>
          ) : null}
          {series.map((s) => <path key={s.id} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={1.6} strokeDasharray={s.dashed ? '5 3' : undefined} />)}
          {hover !== null ? <line x1={hover} x2={hover} y1={padT} y2={padT + plotH} stroke="var(--color-muted-foreground)" strokeOpacity={0.5} /> : null}
        </svg>
        {hover !== null && hx !== null ? (
          <div className="pointer-events-none absolute top-1 rounded-md border border-border bg-popover px-2 py-1 font-mono text-[10.5px] shadow-lg" style={{ left: Math.min(hover + 8, w - 150) }}>
            <div className="text-muted-foreground">T+{xFormat(hx)}</div>
            {series.map((s) => {
              let best: { x: number; y: number | null } | undefined
              for (const p of s.points) if (!best || Math.abs(p.x - hx) < Math.abs(best.x - hx)) best = p
              return <div key={s.id} style={{ color: s.color }}>{s.label}: {best?.y === null || best?.y === undefined ? '—' : yFormat(best.y)}</div>
            })}
          </div>
        ) : null}
      </div>
    </figure>
  )
}
