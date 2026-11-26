import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, Wrench } from 'lucide-react'
import { demoScenario, deriveScenarioFromIncident } from '@faultline/engine'
import { Button, ConfirmModal, useToast } from '@/components/ui'
import { LogoMark } from '../brand/Logo'
import { WorkspaceLoading, SUGGESTED } from '../demo/DemoWorkspacePage'
import { Workspace } from '../workspace/Workspace'
import { callAction } from './api'
import { IncidentTools } from './IncidentTools'
import { useCloudIncident } from './useCloudIncident'

export function CloudIncidentPage({ incidentId }: { incidentId: string }) {
  const data = useCloudIncident(incidentId)
  const [tools, setTools] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const navigate = useNavigate()
  const { success, error } = useToast()

  const sim = useMemo(() => {
    if (!data.analysis || data.analysis.dataset.events.length === 0) return null
    const slug = data.incident?.data.demoSlug
    const demo = slug ? demoScenario(slug) : undefined
    if (demo) return { scenario: demo.scenario, origin: demo.baseTime, assumptions: ['This incident is a copy of a synthetic demo; the model is the one that generated it.'], suggestedAt: demo.suggested.atSec, suggested: SUGGESTED[demo.slug] }
    const derived = deriveScenarioFromIncident(data.analysis.dataset)
    return { scenario: derived.scenario, origin: data.analysis.dataset.events[0].ts, assumptions: derived.assumptions, suggestedAt: Math.round(derived.scenario.durationSec / 3), suggested: undefined }
  }, [data.analysis, data.incident?.data.demoSlug])

  if (data.status === 'loading') return <WorkspaceLoading label="Loading incident records…" />
  if (data.status === 'error') return <Centered title="Could not load this incident." body={data.error ?? 'The records connection failed.'} />
  if (data.status === 'missing' || !data.analysis || !data.adapter) return <Centered title="Incident not found." body="It may have been deleted, or you may not have access to its workspace." />

  const empty = data.analysis.dataset.events.length === 0
  const latestJob = data.jobs[0]
  if (empty) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-[18px] font-semibold">{data.incident!.data.title}</h1>
        {latestJob && !['completed', 'failed', 'canceled'].includes(latestJob.data.stage) ? (
          <p role="status" className="font-mono text-[12.5px] text-muted-foreground">Import {latestJob.data.stage}: {latestJob.data.message} ({Math.round((latestJob.data.progress ?? 0) * 100)}%)</p>
        ) : latestJob?.data.stage === 'failed' ? (
          <p role="alert" className="text-[13px] text-[var(--color-fault)]">{latestJob.data.error}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground">No evidence yet.</p>
        )}
        <div className="flex gap-2">
          <Link to={`/incidents/new?incident=${incidentId}`} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground">Add evidence</Link>
          <Button variant="outline" onClick={() => setTools(true)}>Imports</Button>
        </div>
        {tools ? <IncidentTools data={data} onClose={() => setTools(false)} onSelectEvent={() => undefined} /> : null}
      </div>
    )
  }

  return (
    <>
      <Workspace
        analysis={data.analysis}
        adapter={data.adapter}
        scenario={sim?.scenario}
        scenarioOrigin={sim?.origin}
        modelAssumptions={sim?.assumptions}
        suggestedBranchSec={sim?.suggestedAt}
        suggestedInterventions={sim?.suggested}
        headerLeft={
          <Link to="/incidents" className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Back to incidents">
            <ArrowLeft className="size-4" /><LogoMark className="size-4" title="" />
          </Link>
        }
        headerRight={
          <>
            {data.incident?.data.analysis?.stale ? <span className="font-mono text-[11px] text-[var(--color-degraded)]">analysis stale</span> : null}
            <button type="button" onClick={() => setTools(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[12px] text-muted-foreground hover:text-foreground"><Wrench className="size-3.5" /> Evidence & tools</button>
            {data.role === 'owner' ? <button type="button" aria-label="Delete incident" onClick={() => setConfirm(true)} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-[var(--color-fault)]"><Trash2 className="size-3.5" /></button> : null}
          </>
        }
      />
      {tools ? <IncidentTools data={data} onClose={() => setTools(false)} onSelectEvent={(id) => { setTools(false); window.location.hash = `event=${id}`; window.location.reload() }} /> : null}
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Delete "${data.incident!.data.title}"?`}
        description="Permanently deletes the incident, all of its events, correlations, notes, simulations, postmortems, and the raw uploaded files. Collaborators lose access immediately. This cannot be undone."
        confirmLabel="Delete incident"
        variant="destructive"
        onConfirm={async () => {
          setConfirm(false)
          try {
            await callAction('deleteIncident', { incidentId })
            success('Incident deleted')
            navigate('/incidents')
          } catch (e) {
            error('Could not delete', e instanceof Error ? e.message : String(e))
          }
        }}
      />
    </>
  )
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-[15px] text-foreground">{title}</p>
      <p className="max-w-md text-[13px] text-muted-foreground">{body}</p>
      <Link to="/incidents" className="mt-2 text-[13px] underline">All incidents</Link>
    </div>
  )
}
