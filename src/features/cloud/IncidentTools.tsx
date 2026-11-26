import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Github, RotateCcw, Search, Square, Trash2, X } from 'lucide-react'
import { Button, ConfirmModal, Input, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { KindTag } from '../shell/atoms'
import { callAction } from './api'
import type { CloudIncident } from './useCloudIncident'

const STAGES = ['queued', 'reading', 'validating', 'normalizing', 'deduplicating', 'correlating', 'persisting', 'completed']

export function IncidentTools({ data, onClose, onSelectEvent }: { data: CloudIncident; onClose: () => void; onSelectEvent: (id: string) => void }) {
  const inc = data.incident!
  const canEdit = data.role === 'owner' || data.role === 'collaborator'
  const isOwner = data.role === 'owner'
  return (
    <div role="dialog" aria-label="Evidence and tools" className="fixed inset-y-0 right-0 z-50 flex w-[min(520px,100vw)] flex-col border-l border-border bg-background shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold">Evidence and tools</h2>
        <span className="font-mono text-[11px] text-muted-foreground">role: {data.role ?? 'none'}</span>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="size-4" /></button>
      </div>
      <Tabs defaultValue="sources" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="ai">AI investigator</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <TabsContent value="sources"><SourcesTab data={data} canEdit={canEdit} isOwner={isOwner} /></TabsContent>
          <TabsContent value="ai"><InvestigatorTab incidentId={inc.recordId} onSelectEvent={onSelectEvent} /></TabsContent>
          <TabsContent value="integrations"><IntegrationsTab incidentId={inc.recordId} canEdit={canEdit} /></TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

function SourcesTab({ data, canEdit, isOwner }: { data: CloudIncident; canEdit: boolean; isOwner: boolean }) {
  const { success, error } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try {
      await fn()
      success(ok)
    } catch (e) {
      error('Could not complete that', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="space-y-5 pt-3">
      {canEdit ? <Link to={`/incidents/new?incident=${data.incident!.recordId}`} className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12.5px] hover:bg-secondary">Add evidence file</Link> : null}
      <section>
        <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Imports</h3>
        {data.jobs.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No imports yet.</p> : null}
        <ul className="space-y-2">
          {data.jobs.map((j) => {
            const active = !['completed', 'failed', 'canceled'].includes(j.data.stage)
            return (
              <li key={j.recordId} data-testid="ingestion-job" data-stage={j.data.stage} className="rounded-md border border-border p-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn('font-mono text-[11px] uppercase', j.data.stage === 'completed' ? 'text-[var(--color-healthy)]' : j.data.stage === 'failed' ? 'text-[var(--color-fault)]' : j.data.stage === 'canceled' ? 'text-muted-foreground' : 'text-[var(--color-degraded)]')}>{j.data.stage}</span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">attempt {j.data.attempt ?? 1}</span>
                  <span className="ml-auto flex gap-1">
                    {canEdit && active ? <Button size="sm" variant="ghost" className="h-7" loading={busy === `c${j.recordId}`} disabled={Boolean(j.data.cancelRequested)} onClick={() => run(`c${j.recordId}`, () => callAction('cancelIngestion', { jobRecordId: j.recordId }), 'Cancel requested')}><Square className="size-3" /> {j.data.cancelRequested ? 'Canceling' : 'Cancel'}</Button> : null}
                    {canEdit && (j.data.stage === 'failed' || j.data.stage === 'canceled') ? <Button size="sm" variant="ghost" className="h-7" loading={busy === `r${j.recordId}`} onClick={() => run(`r${j.recordId}`, () => callAction('retryIngestion', { jobRecordId: j.recordId }), 'Import restarted')}><RotateCcw className="size-3" /> Retry</Button> : null}
                  </span>
                </div>
                <div className="mt-2 flex gap-0.5" aria-hidden="true">
                  {STAGES.map((s, i) => <span key={s} className={cn('h-1 flex-1 rounded-full', STAGES.indexOf(j.data.stage) >= i ? (j.data.stage === 'failed' ? 'bg-[var(--color-fault)]' : 'bg-[var(--color-healthy)]') : 'bg-secondary')} />)}
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground">{j.data.error || j.data.message}</p>
              </li>
            )
          })}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Source files</h3>
        {data.sources.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No uploaded files. Synthetic copies are generated, not uploaded.</p> : null}
        <ul className="space-y-2">
          {data.sources.map((s) => (
            <li key={s.recordId} className="rounded-md border border-border p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{s.data.name}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{s.data.format || '…'} · {(s.data.sizeBytes / 1024).toFixed(0)} KiB · {s.data.status}</span>
                {isOwner ? <button type="button" aria-label={`Delete source ${s.data.name}`} onClick={() => setConfirmDelete({ id: s.recordId, name: s.data.name })} className="text-muted-foreground hover:text-[var(--color-fault)]"><Trash2 className="size-3.5" /></button> : null}
              </div>
              {s.data.stats ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">accepted {String(s.data.stats.accepted ?? '—')} · rejected {String(s.data.stats.rejected ?? '—')} · duplicates {String(s.data.stats.duplicates ?? '—')} · redactions {String(s.data.stats.redactions ?? '—')}</p> : null}
              {s.data.errors?.length ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11.5px] text-[var(--color-degraded)]">{s.data.errors.length} rejected record(s)</summary>
                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto font-mono text-[10.5px] text-muted-foreground">
                    {s.data.errors.map((e, i) => <li key={i}>line {e.line}: {e.code} — {e.message}</li>)}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <ConfirmModal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={`Delete source "${confirmDelete?.name}"?`}
        description="This permanently deletes the uploaded file and every event that came from it. Correlations are recomputed on the next import. This cannot be undone."
        confirmText="Delete source"
        variant="destructive"
        onConfirm={async () => {
          const id = confirmDelete!.id
          setConfirmDelete(null)
          await run(`d${id}`, () => callAction('deleteSource', { sourceId: id }), 'Source deleted')
        }}
      />
    </div>
  )
}

function InvestigatorTab({ incidentId, onSelectEvent }: { incidentId: string; onSelectEvent: (id: string) => void }) {
  const [q, setQ] = useState('What changed before the first error spike?')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{ answer: string; citations: string[]; evidenceCount: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const parts = answer ? answer.answer.split(/(\[evt_[a-z0-9]+\])/gi) : []
  return (
    <div className="space-y-3 pt-3">
      <p className="text-[12px] text-muted-foreground">
        Optional. Sends a bounded selection of this incident's normalized, redacted evidence (at most 70 events) and the ranked hypotheses to Anthropic through the DeepSpace integration proxy. Raw uploaded files are never sent. Answers must cite event ids; citations that do not match the evidence are removed.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {['What changed before the first error spike?', 'Which service appears to have initiated the cascade?', 'What evidence supports the top hypothesis?', 'Summarize this incident for an engineering manager.'].map((s) => (
          <button key={s} type="button" onClick={() => setQ(s)} className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">{s}</button>
        ))}
      </div>
      <Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} maxLength={600} aria-label="Question for the investigator" />
      <Button loading={busy} disabled={!q.trim()} onClick={async () => {
        setBusy(true); setErr(null)
        try { setAnswer(await callAction('askInvestigator', { incidentId, question: q.trim() })) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
      }}><Bot className="size-4" /> Ask</Button>
      {err ? <p role="alert" className="text-[12.5px] text-[var(--color-fault)]">{err}</p> : null}
      {answer ? (
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 flex gap-2"><KindTag kind="inferred">AI · inferred</KindTag><span className="font-mono text-[10.5px] text-muted-foreground">{answer.evidenceCount} events provided · {answer.citations.length} cited</span></div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            {parts.map((p, i) => {
              const m = /^\[(evt_[a-z0-9]+)\]$/i.exec(p)
              return m ? <button key={i} type="button" className="mx-0.5 rounded-sm bg-secondary px-1 font-mono text-[11px] text-[var(--color-sim)] hover:underline" onClick={() => onSelectEvent(m[1])}>{m[1].slice(0, 12)}</button> : <span key={i}>{p}</span>
            })}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function IntegrationsTab({ incidentId, canEdit }: { incidentId: string; canEdit: boolean }) {
  const { success, error } = useToast()
  const [gh, setGh] = useState({ owner: '', repo: '', service: '', branch: '' })
  const [ghBusy, setGhBusy] = useState(false)
  const [query, setQuery] = useState('database connection pool exhaustion retry storm mitigation')
  const [exaBusy, setExaBusy] = useState(false)
  const [results, setResults] = useState<Array<{ title: string; url: string; snippet: string }>>([])
  if (!canEdit) return <p className="pt-3 text-[12.5px] text-muted-foreground">Integrations need the collaborator role.</p>
  return (
    <div className="space-y-6 pt-3">
      <p className="text-[12px] text-muted-foreground">These call third-party APIs billed to the app owner's DeepSpace credits. They are disabled unless the owner enables them, and limited per user per day.</p>
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold"><Github className="size-4" /> Import commits as change events</h3>
        <p className="text-[12px] text-muted-foreground">Pulls recent commits from a public repository and imports those within the incident window as change events on the service you name. Runs through the normal ingestion pipeline.</p>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="owner" value={gh.owner} onChange={(e) => setGh({ ...gh, owner: e.target.value })} aria-label="Repository owner" />
          <Input placeholder="repo" value={gh.repo} onChange={(e) => setGh({ ...gh, repo: e.target.value })} aria-label="Repository name" />
          <Input placeholder="service it deploys" value={gh.service} onChange={(e) => setGh({ ...gh, service: e.target.value })} aria-label="Service" />
          <Input placeholder="branch (optional)" value={gh.branch} onChange={(e) => setGh({ ...gh, branch: e.target.value })} aria-label="Branch" />
        </div>
        <Button variant="outline" loading={ghBusy} disabled={!gh.owner || !gh.repo || !gh.service} onClick={async () => {
          setGhBusy(true)
          try { const r = await callAction<{ imported: number; message?: string }>('importGithubCommits', { incidentId, ...gh }); success(r.imported ? `Importing ${r.imported} commit(s)` : 'Nothing to import', r.message) } catch (e) { error('GitHub import failed', e instanceof Error ? e.message : String(e)) } finally { setGhBusy(false) }
        }}>Import commits</Button>
      </section>
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold"><Search className="size-4" /> Research remediation</h3>
        <p className="text-[12px] text-muted-foreground">Searches the web with Exa. Only your query is sent, never incident evidence.</p>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={300} aria-label="Search query" />
        <Button variant="outline" loading={exaBusy} disabled={!query.trim()} onClick={async () => {
          setExaBusy(true)
          try { setResults((await callAction<{ results: typeof results }>('searchRemediation', { incidentId, query: query.trim() })).results) } catch (e) { error('Search failed', e instanceof Error ? e.message : String(e)) } finally { setExaBusy(false) }
        }}>Search</Button>
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.url} className="rounded-md border border-border p-2.5">
              <a href={r.url} target="_blank" rel="noreferrer noopener" className="text-[12.5px] text-foreground underline underline-offset-2">{r.title}</a>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{r.snippet}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
