import type { ReactNode } from 'react'
import type { IncidentDataset } from '@faultline/engine'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { AnalyticsView } from './AnalyticsView'
import { CompareView } from './CompareView'

export function InsightLayout({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
        <div className="mt-2 max-w-2xl text-[13.5px] text-muted-foreground">{intro}</div>
        <div className="mt-8">{children}</div>
      </main>
      <SiteFooter />
    </div>
  )
}

function Loading({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) return <p role="alert" className="text-[13px] text-[var(--color-fault)]">{error}</p>
  if (loading) return <p role="status" className="font-mono text-[12px] text-muted-foreground">Generating incidents in the simulation worker…</p>
  return <>{children}</>
}

export function ComparePage({ datasets, loading, error, intro }: { datasets: IncidentDataset[]; loading: boolean; error: string | null; intro: ReactNode }) {
  return (
    <InsightLayout eyebrow="Incident comparison" title="Compare incidents" intro={intro}>
      <Loading loading={loading} error={error}><CompareView datasets={datasets} /></Loading>
    </InsightLayout>
  )
}

export function AnalyticsPage({ datasets, loading, error, intro }: { datasets: IncidentDataset[]; loading: boolean; error: string | null; intro: ReactNode }) {
  return (
    <InsightLayout eyebrow="Reliability analytics" title="Reliability analytics" intro={intro}>
      <Loading loading={loading} error={error}><AnalyticsView datasets={datasets} /></Loading>
    </InsightLayout>
  )
}
