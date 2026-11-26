import { useMemo } from 'react'
import { ServiceGraph } from '@faultline/engine'
import { cn } from '@/lib/utils'

export type PartStatus = 'ok' | 'strained' | 'failing' | 'idle'

export interface DiagramPart {
  id: string
  name: string
  detail?: string
}

interface Props {
  parts: DiagramPart[]
  calls: Array<{ from: string; to: string }>
  status: Record<string, PartStatus>
  /** Part to emphasize (e.g. "where it appears to have started"). */
  highlight?: string | null
  highlightLabel?: string
  className?: string
  /** Max columns before wrapping into rows (small screens). */
  dense?: boolean
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

const STATUS: Record<PartStatus, { ring: string; fill: string; dot: string; word: string }> = {
  ok: { ring: 'rgba(31,29,26,0.12)', fill: '#ffffff', dot: 'var(--color-healthy)', word: 'Working' },
  idle: { ring: 'rgba(31,29,26,0.12)', fill: '#ffffff', dot: 'var(--color-faint)', word: 'Quiet' },
  strained: { ring: 'var(--color-degraded)', fill: '#fdf6e9', dot: 'var(--color-degraded)', word: 'Struggling' },
  failing: { ring: 'var(--color-fault)', fill: '#fcefe9', dot: 'var(--color-fault)', word: 'Failing' },
}

/** A calm, readable picture of how the parts of a system connect. */
export function SystemDiagram({ parts, calls, status, highlight, highlightLabel = 'Where it appears to have started', className, dense }: Props) {
  const layout = useMemo(() => {
    const g = new ServiceGraph(parts.map((p) => ({ id: p.id, name: p.name, kind: 'service' as const })), calls.map((c) => ({ ...c, origin: 'declared' as const })))
    return g.layout()
  }, [parts, calls])
  const cols = Math.max(1, ...Array.from(layout.values()).map((l) => l.layer + 1))
  const rows = Math.max(1, ...Array.from(layout.values()).map((l) => l.order + 1))
  const NW = dense ? 172 : 196
  const NH = dense ? 64 : 72
  const GX = dense ? 44 : 64
  const GY = 22
  const W = cols * NW + (cols - 1) * GX
  const H = rows * NH + (rows - 1) * GY + (highlight ? 28 : 0)
  const colRows = new Map<number, number>()
  for (const l of layout.values()) colRows.set(l.layer, Math.max(colRows.get(l.layer) ?? 0, l.order + 1))
  const pos = (id: string) => {
    const l = layout.get(id)!
    const n = colRows.get(l.layer) ?? 1
    return { x: l.layer * (NW + GX), y: (highlight ? 28 : 0) + l.order * (NH + GY) + ((rows - n) * (NH + GY)) / 2 }
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="mx-auto block h-auto w-full" style={{ maxWidth: W + 8, minWidth: Math.min(W, 520) }} role="img" aria-label={parts.map((p) => `${p.name}: ${STATUS[status[p.id] ?? 'ok'].word}`).join('. ')}>
        {calls.map((c) => {
          if (!layout.has(c.from) || !layout.has(c.to)) return null
          const a = pos(c.from)
          const b = pos(c.to)
          const x1 = a.x + NW
          const y1 = a.y + NH / 2
          const x2 = b.x
          const y2 = b.y + NH / 2
          const s = status[c.to] ?? 'ok'
          const mid = (x1 + x2) / 2
          const d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2 - 6} ${y2}`
          const pressured = s === 'failing' || s === 'strained'
          return (
            <g key={`${c.from}-${c.to}`}>
              <path d={d} fill="none" stroke="rgba(31,29,26,0.18)" strokeWidth={1.75} />
              <path d={d} fill="none" stroke={pressured ? STATUS[s].dot : 'rgba(31,29,26,0.45)'} strokeWidth={1.75} strokeDasharray="2 8" strokeLinecap="round" className={pressured ? 'fl-flow-slow' : 'fl-flow-fwd'} />
              <path d={`M${x2 - 7} ${y2 - 4.5}L${x2} ${y2}L${x2 - 7} ${y2 + 4.5}`} fill="none" stroke="rgba(31,29,26,0.45)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )
        })}
        {parts.map((p) => {
          if (!layout.has(p.id)) return null
          const { x, y } = pos(p.id)
          const s = STATUS[status[p.id] ?? 'ok']
          const isHl = highlight === p.id
          return (
            <g key={p.id} transform={`translate(${x} ${y})`}>
              {isHl ? (
                <>
                  <rect x={-5} y={-5} width={NW + 10} height={NH + 10} rx={18} fill="none" stroke="var(--color-fault)" strokeWidth={1.5} strokeDasharray="4 4" />
                  <text x={NW / 2} y={-12} textAnchor="middle" fontSize={11.5} fontWeight={500} fill="var(--color-fault)">{highlightLabel}</text>
                </>
              ) : null}
              <rect width={NW} height={NH} rx={14} fill={s.fill} stroke={s.ring} strokeWidth={status[p.id] === 'ok' || !status[p.id] ? 1 : 1.75} style={{ transition: 'fill 300ms, stroke 300ms' }} />
              <circle cx={18} cy={24} r={4.5} fill={s.dot} style={{ transition: 'fill 300ms' }} />
              <text x={30} y={28.5} fontSize={dense ? 14 : 15} fontWeight={500} fill="var(--color-foreground)">{clip(p.name, dense ? 19 : 22)}</text>
              <text x={18} y={NH - 16} fontSize={12} fill="var(--color-muted-foreground)">{clip(p.detail ?? s.word, dense ? 24 : 28)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
