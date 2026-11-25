import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui'

export interface TourStep {
  title: string
  body: string
  /** Optional action the step performs when shown (e.g. switch tab). */
  onEnter?: () => void
}

const KEY = 'faultline:tour-dismissed'

/** A short, dismissible walkthrough. Remembers dismissal in this browser. */
export function GuidedTour({ steps }: { steps: TourStep[] }) {
  const [i, setI] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) !== '1')
    } catch {
      setOpen(true)
    }
  }, [])
  useEffect(() => {
    if (open) steps[i]?.onEnter?.()
  }, [i, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    setOpen(false)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* private mode */
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setI(0); setOpen(true) }} className="no-print fixed bottom-3 right-3 z-40 rounded-full border border-border bg-popover px-3 py-1.5 text-[12px] text-muted-foreground shadow-lg hover:text-foreground">
        Guided tour
      </button>
    )
  }
  const step = steps[i]
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="tour-title" className="no-print fixed bottom-3 right-3 z-40 w-[min(360px,calc(100vw-24px))] rounded-lg border border-border bg-popover p-4 shadow-2xl">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[10.5px] text-muted-foreground">{i + 1} / {steps.length}</span>
        <button type="button" onClick={dismiss} aria-label="Dismiss tour" className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <h2 id="tour-title" className="text-[14px] font-semibold text-foreground">{step.title}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{step.body}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="ghost" className="h-8" onClick={dismiss}>Skip</Button>
        <div className="ml-auto flex gap-1.5">
          {i > 0 ? <Button size="sm" variant="outline" className="h-8" onClick={() => setI(i - 1)}>Back</Button> : null}
          <Button size="sm" className="h-8" onClick={() => (i + 1 < steps.length ? setI(i + 1) : dismiss())}>{i + 1 < steps.length ? 'Next' : 'Done'}</Button>
        </div>
      </div>
    </div>
  )
}
