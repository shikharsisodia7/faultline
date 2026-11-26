import { useMemo, useState } from 'react'
import { useAuth } from 'deepspace'
import { Switch } from '@/components/ui'
import { useMyIncidentDatasets } from '../cloud/cloudStores'
import { AnalyticsView } from './AnalyticsView'
import { CompareView } from './CompareView'
import { useDemoDatasets } from './useDemoDatasets'

/** Compare/analytics inside the app: your incidents, optionally plus labeled demo incidents. */
export function AppInsightPage({ kind }: { kind: 'compare' | 'analytics' }) {
  const { isSignedIn } = useAuth()
  const mine = useMyIncidentDatasets()
  const [withDemos, setWithDemos] = useState(true)
  const showDemos = withDemos || !isSignedIn
  const demos = useDemoDatasets(showDemos)
  const datasets = useMemo(() => [...(isSignedIn ? mine.datasets : []), ...(showDemos ? demos.datasets : [])], [isSignedIn, mine.datasets, demos.datasets, showDemos])
  const loading = (isSignedIn && mine.loading) || demos.loading
  const error = mine.error ?? demos.error
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <title>{kind === 'compare' ? 'Compare incidents · Faultline' : 'Reliability analytics · Faultline'}</title>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{kind === 'compare' ? 'Compare incidents' : 'Reliability analytics'}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{isSignedIn ? `${mine.datasets.length} incident(s) with evidence from your workspaces.` : 'Signed out: showing the synthetic demo incidents only.'}</p>
        </div>
        {isSignedIn ? (
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            Include synthetic demos <Switch checked={withDemos} onCheckedChange={(v: boolean) => setWithDemos(v)} aria-label="Include synthetic demo incidents" />
          </label>
        ) : null}
      </div>
      <div className="mt-6">
        {error ? (
          <p role="alert" className="text-[13px] text-[var(--color-fault)]">{error}</p>
        ) : loading ? (
          <p role="status" className="font-mono text-[12px] text-muted-foreground">Loading incidents…</p>
        ) : kind === 'compare' ? (
          <CompareView datasets={datasets} />
        ) : (
          <AnalyticsView datasets={datasets} />
        )}
      </div>
    </div>
  )
}
