import { SiteHeader } from '../shell/SiteHeader'
import { ChaosLab, type LabStore } from './ChaosLab'

export function LabPage({ store }: { store: LabStore }) {
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <SiteHeader compact />
      <div className="flex items-baseline gap-3 border-b border-border px-4 py-2">
        <h1 className="text-[15px] font-semibold text-foreground">Chaos lab</h1>
        <p className="hidden text-[12px] text-muted-foreground sm:block">Build a virtual system, inject faults, and compare strategies. Nothing touches real infrastructure.</p>
      </div>
      <ChaosLab store={store} />
    </div>
  )
}
