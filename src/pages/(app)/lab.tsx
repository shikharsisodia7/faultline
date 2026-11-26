/** Chaos lab: public; scenarios save to the signed-in user's private records. */
import { ChaosLab } from '../../features/lab/ChaosLab'
import { useCloudLabStore } from '../../features/cloud/cloudStores'

export default function Lab() {
  const store = useCloudLabStore()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <title>Experiment lab · Faultline</title>
      <div className="flex items-baseline gap-3 border-b border-border px-4 py-2">
        <h1 className="text-[15px] font-semibold">Experiment lab</h1>
        <p className="hidden text-[12px] text-muted-foreground sm:block">Build a virtual system, inject faults, and compare strategies. Nothing touches real infrastructure.</p>
      </div>
      <ChaosLab store={store} />
    </div>
  )
}
