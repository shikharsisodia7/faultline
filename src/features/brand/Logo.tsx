import { cn } from '@/lib/utils'

/**
 * The Faultline symbol: a timeline that forks at a decision point. One path
 * continues as a seismic spike (what happened); the other bends away calmly
 * (what could have happened).
 */
export function LogoMark({ className, title = 'Faultline' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-6', className)} role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}>
      <path d="M2.5 16H11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M11 16l2.4-4.6 2.8 9.4 2.2-7 1.6 2.2H29.5" stroke="var(--color-fault)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 16c4.2 0 5.6 7.5 10.4 7.5h8.1" stroke="var(--color-sim)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="11" cy="16" r="2.6" fill="currentColor" stroke="var(--color-background)" strokeWidth="1.4" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
      <LogoMark className="size-[22px]" title="" />
      <span className="text-[16px] font-medium tracking-[-0.02em]">Faultline</span>
    </span>
  )
}
