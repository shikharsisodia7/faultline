import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { useQuery, useR2Files } from 'deepspace'
import { DEMO_SCENARIOS, detectFormat, normalizeSource } from '@faultline/engine'
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from './api'
import type { IncidentRecord } from './useCloudIncident'
import { useWorkspaces } from './useWorkspaces'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = '.json,.jsonl,.ndjson,.csv,.tsv,.log,.txt,application/json,text/plain,text/csv'

interface Preview { format: string; accepted: number; rejected: number; duplicates: number; services: string[]; errors: Array<{ line: number; code: string; message: string }> }

export function NewIncidentPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { workspaces } = useWorkspaces()
  const incidents = useQuery<IncidentRecord>('incidents')
  const existingId = params.get('incident') ?? ''
  const existing = incidents.records.find((r) => r.recordId === existingId)
  const fromDemo = params.get('fromDemo')
  const editable = workspaces.filter((w) => w.role !== 'viewer')
  const [wsId, setWsId] = useState(params.get('workspace') ?? '')
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState('sev2')
  const [summary, setSummary] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { upload } = useR2Files()
  const { error: toastError } = useToast()

  useEffect(() => { if (!wsId && editable.length) setWsId(editable[0].id) }, [editable, wsId])
  const demo = useMemo(() => DEMO_SCENARIOS.find((d) => d.slug === fromDemo), [fromDemo])

  const choose = async (f: File | undefined | null) => {
    setError(null)
    setPreview(null)
    if (!f) return setFile(null)
    if (f.size > MAX_BYTES) { setFile(null); setError(`${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MiB; the limit is 10 MiB.`); return }
    setFile(f)
    if (!title && !existing) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '))
    // Local dry run so the user sees what will be accepted before uploading.
    try {
      const text = await f.text()
      const r = normalizeSource(text, { incidentId: 'preview', sourceId: 'preview', sourceName: f.name, limits: { maxRecords: 5000 } })
      setPreview({ format: r.stats.format ?? detectFormat(text, f.name), accepted: r.stats.accepted, rejected: r.stats.rejected, duplicates: r.stats.duplicates, services: r.stats.services, errors: r.errors.slice(0, 20) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const submit = async () => {
    setError(null)
    try {
      let incidentId = existingId
      if (!incidentId) {
        setStep('Creating incident')
        incidentId = (await callAction<{ incidentId: string }>('createIncident', { workspaceId: wsId, title, severity, summary })).incidentId
      }
      if (file) {
        setStep('Uploading to private storage')
        const up = await upload(file, file.name)
        if (!up.success || !up.key) throw new Error(up.error ?? 'Upload failed. Uploads work after the app has been deployed once.')
        setStep('Registering source')
        const { sourceId } = await callAction<{ sourceId: string }>('registerSource', { incidentId, fileKey: up.key, name: file.name, sizeBytes: file.size, format: preview?.format ?? '' })
        setStep('Starting background ingestion')
        await callAction('startIngestion', { incidentId, sourceId })
      }
      navigate(`/incidents/${incidentId}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toastError('Import did not start', msg)
    } finally {
      setStep(null)
    }
  }

  if (demo) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-[22px] font-semibold">Copy “{demo.title}”</h1>
        <p className="mt-2 text-[13.5px] text-muted-foreground">Creates a private, synthetic copy in your workspace so you can annotate, review hypotheses, and save simulations with collaborators.</p>
        <WorkspacePicker value={wsId} onChange={setWsId} options={editable} />
        {error ? <p role="alert" className="mt-3 text-[13px] text-[var(--color-fault)]">{error}</p> : null}
        <Button className="mt-5" loading={Boolean(step)} disabled={!wsId} onClick={async () => {
          setStep('copying')
          try { const r = await callAction<{ incidentId: string }>('copyDemo', { workspaceId: wsId, slug: demo.slug }); navigate(`/incidents/${r.incidentId}`) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setStep(null) }
        }}>Copy to workspace</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-[22px] font-semibold">{existing ? `Add evidence to “${existing.data.title}”` : 'New incident'}</h1>
      <p className="mt-2 text-[13.5px] text-muted-foreground">Supported: JSON, JSONL/NDJSON, CSV/TSV, plain-text logs, and OpenTelemetry JSON exports, up to 10 MiB and 5,000 events per incident. Files are stored privately in your upload area; secrets and emails are redacted before any event is saved.</p>

      {!existing ? (
        <div className="mt-6 space-y-4">
          <WorkspacePicker value={wsId} onChange={setWsId} options={editable} />
          <label className="block"><span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Title</span><Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Checkout errors after pricing deploy" /></label>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <label className="block"><span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Severity</span>
              <Select value={severity} onValueChange={setSeverity}><SelectTrigger className="mt-1" aria-label="Severity"><SelectValue /></SelectTrigger><SelectContent>{['sev1', 'sev2', 'sev3', 'sev4'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            </label>
            <label className="block"><span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Summary (optional)</span><Textarea className="mt-1" rows={1} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} /></label>
          </div>
        </div>
      ) : null}

      <div
        className={cn('mt-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors', drag ? 'border-foreground/50 bg-secondary' : 'border-border hover:border-foreground/30')}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void choose(e.dataTransfer.files[0]) }}
        role="button"
        tabIndex={0}
        aria-label="Choose an evidence file"
      >
        <Upload className="size-5 text-muted-foreground" />
        <p className="text-[13px]">{file ? file.name : 'Drop a log, trace, or CSV file here, or click to choose'}</p>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" data-testid="evidence-input" onChange={(e) => void choose(e.target.files?.[0])} />
      </div>

      {preview ? (
        <div className="mt-4 rounded-md border border-border p-3" data-testid="import-preview">
          <p className="font-mono text-[12px]">Dry run ({preview.format}): {preview.accepted} accepted · {preview.rejected} rejected · {preview.duplicates} duplicates · services: {preview.services.join(', ') || 'none'}</p>
          {preview.errors.length ? <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] text-muted-foreground">{preview.errors.map((e, i) => <li key={i}>line {e.line}: {e.code} — {e.message}</li>)}</ul> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-[13px] text-[var(--color-fault)]">{error}</p> : null}
      <div className="mt-6 flex items-center gap-3">
        <Button loading={Boolean(step)} disabled={(!existing && (!wsId || !title.trim())) || (!!file && !preview) || (!!existing && !file)} onClick={submit}>{file ? 'Import evidence' : 'Create empty incident'}</Button>
        {step ? <span role="status" className="font-mono text-[12px] text-muted-foreground">{step}…</span> : null}
      </div>
    </div>
  )
}

function WorkspacePicker({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ id: string; name: string }> }) {
  return (
    <label className="mt-4 block">
      <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Workspace</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1" aria-label="Workspace"><SelectValue placeholder="Choose a workspace" /></SelectTrigger>
        <SelectContent>{options.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  )
}
