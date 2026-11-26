import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Download, Upload } from 'lucide-react'
import { useQuery, useR2Files } from 'deepspace'
import { DEMO_SCENARIOS, normalizeSource } from '@faultline/engine'
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from './api'
import type { IncidentRecord } from './useCloudIncident'
import { useWorkspaces } from './useWorkspaces'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = '.json,.jsonl,.ndjson,.csv,.tsv,.log,.txt,application/json,text/plain,text/csv'
const STEPS = ['Tell us what went wrong', 'Add the information you have', 'Build your incident timeline', 'Your investigation is ready']
const JOB_STAGES = ['queued', 'reading', 'validating', 'normalizing', 'deduplicating', 'correlating', 'persisting', 'completed']
const STAGE_WORDS: Record<string, string> = {
  queued: 'Waiting for a worker', reading: 'Reading your file', validating: 'Checking the format', normalizing: 'Putting every record in a common shape',
  deduplicating: 'Removing duplicates', correlating: 'Linking related events', persisting: 'Saving the timeline', completed: 'Done',
}
const SAMPLES = [
  { file: 'checkout-errors.jsonl', label: 'JSON lines (one event per line)' },
  { file: 'events.csv', label: 'CSV spreadsheet export' },
  { file: 'app.log', label: 'Plain-text application log' },
  { file: 'otel-traces.json', label: 'OpenTelemetry trace export' },
]

interface Preview { format: string; accepted: number; rejected: number; duplicates: number; services: string[]; errors: Array<{ line: number; code: string; message: string }> }

export function NewIncidentPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { workspaces } = useWorkspaces()
  const incidents = useQuery<IncidentRecord>('incidents')
  const existingId = params.get('incident') ?? ''
  const existing = incidents.records.find((r) => r.recordId === existingId)
  const demo = useMemo(() => DEMO_SCENARIOS.find((d) => d.slug === params.get('fromDemo')), [params])
  const editable = workspaces.filter((w) => w.role !== 'viewer')
  const [step, setStep] = useState(existingId ? 1 : 0)
  const [wsId, setWsId] = useState(params.get('workspace') ?? '')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [severity, setSeverity] = useState('sev2')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [incidentId, setIncidentId] = useState(existingId)
  const [jobRecordId, setJobRecordId] = useState('')
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { upload } = useR2Files()

  useEffect(() => { if (!wsId && editable.length) setWsId(editable[0].id) }, [editable, wsId])
  const jobs = useQuery<{ stage: string; progress: number; message?: string; error?: string }>('ingestion_jobs', { where: { incidentId: incidentId || '__none__' } })
  const job = jobs.records.find((j) => j.recordId === jobRecordId)
  useEffect(() => { if (job?.data.stage === 'completed') setStep(3) }, [job?.data.stage])

  const choose = async (f: File | undefined | null) => {
    setError(null)
    setPreview(null)
    if (!f) return setFile(null)
    if (f.size > MAX_BYTES) { setFile(null); setError(`${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB. Files can be up to 10 MB; split larger exports into parts.`); return }
    setFile(f)
    try {
      const r = normalizeSource(await f.text(), { incidentId: 'preview', sourceId: 'preview', sourceName: f.name, limits: { maxRecords: 5000 } })
      setPreview({ format: r.stats.format, accepted: r.stats.accepted, rejected: r.stats.rejected, duplicates: r.stats.duplicates, services: r.stats.services, errors: r.errors.slice(0, 12) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const start = async () => {
    setError(null)
    try {
      let id = incidentId
      if (!id) {
        setBusy('Creating your incident')
        id = (await callAction<{ incidentId: string }>('createIncident', { workspaceId: wsId, title, severity, summary })).incidentId
        setIncidentId(id)
      }
      setBusy('Uploading privately')
      const up = await upload(file!, file!.name)
      if (!up.success || !up.key) throw new Error(up.error ?? 'The upload did not complete. Try again.')
      setBusy('Registering the file')
      const { sourceId } = await callAction<{ sourceId: string }>('registerSource', { incidentId: id, fileKey: up.key, name: file!.name, sizeBytes: file!.size, format: preview?.format ?? '' })
      setBusy('Starting')
      const r = await callAction<{ jobRecordId: string }>('startIngestion', { incidentId: id, sourceId })
      setJobRecordId(r.jobRecordId)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (demo) {
    return (
      <div className="mx-auto max-w-xl px-5 py-14">
        <title>Copy example · Faultline</title>
        <h1 className="text-[30px] font-normal">Copy “{demo.title}”</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">Makes a private, synthetic copy in your workspace, imported by the same background pipeline as an upload, so you can add notes and save decisions with your team.</p>
        <WorkspacePicker value={wsId} onChange={setWsId} options={editable} />
        {error ? <p role="alert" className="mt-3 text-[14px] text-[var(--color-fault)]">{error}</p> : null}
        <button type="button" disabled={!wsId || Boolean(busy)} className="fl-cta mt-6 inline-flex h-11 items-center rounded-xl px-5 text-[15px] font-medium disabled:opacity-60" onClick={async () => {
          setBusy('copying')
          try { const r = await callAction<{ incidentId: string }>('copyDemo', { workspaceId: wsId, slug: demo.slug }); navigate(`/incidents/${r.incidentId}`) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
        }}>{busy ? 'Copying…' : 'Copy to my workspace'}</button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <title>Analyze an incident · Faultline</title>
      <ol className="mb-10 flex flex-wrap gap-x-5 gap-y-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('flex items-center gap-2 text-[13.5px]', i === step ? 'text-foreground' : 'text-muted-foreground')} aria-current={i === step ? 'step' : undefined}>
            <span className={cn('inline-flex size-6 items-center justify-center rounded-full text-[12px]', i < step ? 'bg-foreground text-background' : i === step ? 'bg-[var(--color-primary)] text-white' : 'bg-secondary')}>{i < step ? <Check className="size-3.5" /> : i + 1}</span>
            <span className="hidden sm:inline">{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section aria-labelledby="s1">
          <h1 id="s1" className="text-[32px] font-normal leading-tight">Tell us what went wrong.</h1>
          <p className="mt-3 text-[15.5px] text-muted-foreground">A short name is enough. You can describe it in your own words if you like.</p>
          <div className="mt-8 space-y-5">
            <label className="block"><span className="text-[14px] text-foreground">Name</span><Input className="mt-1.5 h-11 text-[15px]" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Checkout stopped working on Friday evening" /></label>
            <label className="block"><span className="text-[14px] text-foreground">What did people notice? <span className="text-muted-foreground">(optional)</span></span><Textarea className="mt-1.5 text-[15px]" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} placeholder="Customers saw errors when paying. It lasted about twenty minutes." /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="text-[14px] text-foreground">How serious was it?</span>
                <Select value={severity} onValueChange={setSeverity}><SelectTrigger className="mt-1.5 h-11" aria-label="Severity"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="sev1">Very serious (sev1)</SelectItem><SelectItem value="sev2">Serious (sev2)</SelectItem><SelectItem value="sev3">Moderate (sev3)</SelectItem><SelectItem value="sev4">Minor (sev4)</SelectItem></SelectContent>
                </Select>
              </label>
              <WorkspacePicker value={wsId} onChange={setWsId} options={editable} />
            </div>
          </div>
          <div className="mt-10 flex justify-end">
            <button type="button" disabled={!title.trim() || !wsId} onClick={() => setStep(1)} className="fl-cta inline-flex h-11 items-center rounded-xl px-5 text-[15px] font-medium disabled:opacity-50">Continue</button>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section aria-labelledby="s2">
          <h1 id="s2" className="text-[32px] font-normal leading-tight">{existing ? `Add information to “${existing.data.title}”.` : 'Add the information you have.'}</h1>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-muted-foreground">
            Software keeps a diary called a <strong className="font-medium text-foreground">log</strong>: a line for each thing it did, with the time. Exports from tools like Datadog, CloudWatch, Sentry, or OpenTelemetry work too. Faultline reads JSON, JSON lines, CSV, plain-text logs, and OpenTelemetry exports, up to 10 MB.
          </p>
          <div
            className={cn('mt-8 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors', drag ? 'border-[var(--color-primary)] bg-white' : 'border-border bg-card hover:border-foreground/30')}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void choose(e.dataTransfer.files[0]) }}
            role="button" tabIndex={0} aria-label="Choose a file to import"
          >
            <Upload className="size-6 text-muted-foreground" />
            <p className="text-[16px] text-foreground">{file ? file.name : 'Drop a file here, or click to choose one'}</p>
            <p className="text-[13px] text-muted-foreground">It is stored privately; secrets and email addresses are removed before anything is saved.</p>
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" data-testid="evidence-input" onChange={(e) => void choose(e.target.files?.[0])} />
          </div>
          {preview ? (
            <div className="mt-5 rounded-2xl border border-border bg-white p-5" data-testid="import-preview">
              <p className="text-[15px] text-foreground">We could read <strong className="font-medium">{preview.accepted.toLocaleString()}</strong> events from {preview.services.length} part{preview.services.length === 1 ? '' : 's'} of your system{preview.services.length ? ` (${preview.services.slice(0, 6).join(', ')}${preview.services.length > 6 ? '…' : ''})` : ''}.</p>
              {preview.duplicates ? <p className="mt-1 text-[14px] text-muted-foreground">{preview.duplicates} duplicate line(s) will be skipped.</p> : null}
              {preview.rejected ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[14px] text-[var(--color-degraded)]">{preview.rejected} line(s) could not be read and will be listed in the import report</summary>
                  <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">{preview.errors.map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}</ul>
                </details>
              ) : null}
              {preview.accepted === 0 ? <p className="mt-2 text-[14px] text-[var(--color-fault)]">Nothing in this file looked like an event with a time. Check the format, or try one of the samples below.</p> : null}
            </div>
          ) : null}
          {error ? <p role="alert" className="mt-4 text-[14px] text-[var(--color-fault)]">{error}</p> : null}
          <div className="mt-8">
            <h2 className="text-[13.5px] text-muted-foreground">No file handy? Download a sample</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {SAMPLES.map((s) => (
                <li key={s.file}><a href={`/samples/${s.file}`} download className="fl-btn-quiet inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px]"><Download className="size-3.5" />{s.label}</a></li>
              ))}
            </ul>
          </div>
          <div className="mt-10 flex items-center justify-between">
            {!existing ? <button type="button" onClick={() => setStep(0)} className="text-[14.5px] text-muted-foreground hover:text-foreground">Back</button> : <span />}
            <button type="button" disabled={!file || !preview || preview.accepted === 0 || Boolean(busy)} onClick={start} className="fl-cta inline-flex h-11 items-center rounded-xl px-5 text-[15px] font-medium disabled:opacity-50">{busy ? `${busy}…` : 'Build the timeline'}</button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-labelledby="s3">
          <h1 id="s3" className="text-[32px] font-normal leading-tight">Building your incident timeline…</h1>
          <p className="mt-3 text-[15.5px] text-muted-foreground">This runs in the background. You can leave this page; the progress is saved.</p>
          <ol className="mt-8 space-y-2" aria-live="polite">
            {JOB_STAGES.map((s, i) => {
              const cur = job ? JOB_STAGES.indexOf(job.data.stage) : 0
              const failed = job?.data.stage === 'failed' || job?.data.stage === 'canceled'
              const done = cur > i || job?.data.stage === 'completed'
              return (
                <li key={s} className={cn('flex items-center gap-3 text-[15px]', done ? 'text-foreground' : cur === i && !failed ? 'text-foreground' : 'text-muted-foreground')}>
                  <span className={cn('inline-flex size-5 items-center justify-center rounded-full', done ? 'bg-[var(--color-healthy)] text-white' : cur === i && !failed ? 'border-2 border-[var(--color-primary)]' : 'border border-border')}>{done ? <Check className="size-3" /> : null}</span>
                  {STAGE_WORDS[s]}
                  {cur === i && job?.data.message && !done ? <span className="text-[13px] text-muted-foreground">· {job.data.message}</span> : null}
                </li>
              )
            })}
          </ol>
          {job?.data.stage === 'failed' || job?.data.stage === 'canceled' ? (
            <div role="alert" className="mt-6 rounded-2xl border border-[var(--color-fault)]/30 bg-[var(--color-fault-muted)] p-5">
              <p className="text-[15px] text-foreground">{job.data.error || job.data.message || 'The import stopped.'}</p>
              <button type="button" className="fl-btn-quiet mt-3 inline-flex h-9 items-center rounded-lg px-3 text-[14px]" onClick={async () => { const r = await callAction<{ jobRecordId: string }>('retryIngestion', { jobRecordId }); setJobRecordId(r.jobRecordId) }}>Try again</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 3 ? (
        <section aria-labelledby="s4" className="text-center">
          <h1 id="s4" className="text-[34px] font-normal leading-tight">Your investigation is ready.</h1>
          <p className="mx-auto mt-3 max-w-xl text-[15.5px] text-muted-foreground">
            The timeline is built and related events are linked. Faultline suggests where the trouble may have started; treat those as leads to check, not conclusions.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to={`/incidents/${incidentId}`} className="fl-cta inline-flex h-11 items-center rounded-xl px-5 text-[15px] font-medium">Open the investigation</Link>
            <Link to={`/incidents/new?incident=${incidentId}`} onClick={() => { setStep(1); setFile(null); setPreview(null) }} className="fl-btn-quiet inline-flex h-11 items-center rounded-xl px-5 text-[15px]">Add another file</Link>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function WorkspacePicker({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ id: string; name: string }> }) {
  return (
    <label className="block">
      <span className="text-[14px] text-foreground">Workspace</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1.5 h-11" aria-label="Workspace"><SelectValue placeholder="Choose a workspace" /></SelectTrigger>
        <SelectContent>{options.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  )
}
