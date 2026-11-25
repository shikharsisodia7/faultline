import { cn } from '@/lib/utils'

/** The Faultline mark: a seismograph trace displaced across a fault. */
export function LogoMark({ className, title = 'Faultline' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-6', className)} role="img" aria-label={title}>
      <path d="M2 14.5h4.5l1.6-4.2 2.2 8.6 1.7-5.4 1.4 1h1.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.4 18.5h1.4l1.5-3 1.9 6 1.5-3.6 1.1.6H30" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" opacity=".72" />
      <path d="M19.6 3.5 12.4 28.5" stroke="var(--color-fault)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
      <LogoMark className="size-5" title="" />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Faultline</span>
    </span>
  )
}
