import type { ReactNode } from 'react'
import type { Health } from '@faultline/engine'
import { cn } from '@/lib/utils'

export const HEALTH_COLOR: Record<Health, string> = {
  healthy: 'var(--color-healthy)',
  degraded: 'var(--color-degraded)',
  failing: 'var(--color-fault)',
  recovering: 'var(--color-recovering)',
}

export const SEVERITY_COLOR: Record<string, string> = {
  debug: 'var(--color-faint)',
  info: 'var(--color-muted-foreground)',
  warn: 'var(--color-degraded)',
  error: 'var(--color-fault)',
  critical: 'var(--color-fault)',
}

export function HealthDot({ health, className, pulse }: { health: Health; className?: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', pulse && health === 'failing' && 'animate-pulse', className)}
      style={{ backgroundColor: HEALTH_COLOR[health] }}
    />
  )
}

/**
 * Evidence kinds are always labeled so facts, inferences, human input, and
 * simulated outcomes are never confused.
 */
export type EvidenceKind = 'observed' | 'inferred' | 'human' | 'simulated' | 'synthetic'

const KIND_STYLE: Record<EvidenceKind, { label: string; className: string }> = {
  observed: { label: 'Observed', className: 'border-border text-foreground' },
  inferred: { label: 'Inferred', className: 'border-dashed border-[var(--color-inferred)] text-[var(--color-inferred)]' },
  human: { label: 'Human', className: 'border-foreground/40 text-foreground' },
  simulated: { label: 'Simulated', className: 'border-[var(--color-sim)]/60 text-[var(--color-sim)]' },
  synthetic: { label: 'Synthetic data', className: 'border-[var(--color-degraded)]/50 text-[var(--color-degraded)]' },
}

export function KindTag({ kind, className, children }: { kind: EvidenceKind; className?: string; children?: ReactNode }) {
  const s = KIND_STYLE[kind]
  return (
    <span className={cn('inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[10.5px] uppercase tracking-wide', s.className, className)}>
      {children ?? s.label}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-border bg-secondary px-1 font-mono text-[10.5px] text-muted-foreground">{children}</kbd>
}

export function SectionLabel({ children, className, right }: { children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 px-3 pb-1.5 pt-3', className)}>
      <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{children}</h2>
      {right}
    </div>
  )
}

export function ScoreBar({ value, kind = 'inferred' }: { value: number; kind?: 'inferred' | 'simulated' }) {
  return (
    <span className="relative inline-block h-1 w-14 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, backgroundColor: kind === 'simulated' ? 'var(--color-sim)' : 'var(--color-inferred)' }}
      />
    </span>
  )
}
