import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * A deliberately small Markdown subset rendered to React elements: headings,
 * paragraphs, lists, fenced code, tables, blockquotes, and inline code, bold,
 * emphasis, and links. It never produces raw HTML, so content cannot inject
 * markup. Links are limited to http(s), mailto, in-app paths, and anchors.
 */

const SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i

/** Repository doc links (`docs/X.md`) map to in-app routes. */
export type DocLinkResolver = (href: string) => string | null

function inline(text: string, resolve: DocLinkResolver | undefined, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(_[^_\s][^_]*_)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (m[1]) out.push(<code key={key} className="rounded bg-secondary px-1 py-px font-mono text-[0.88em] text-foreground">{tok.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>)
    else if (m[4]) out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    else if (m[3]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!
      const mapped = resolve?.(lm[2]) ?? lm[2]
      if (mapped.startsWith('/') && !mapped.startsWith('//')) out.push(<Link key={key} to={mapped} className="text-foreground underline underline-offset-2">{lm[1]}</Link>)
      else if (SAFE_URL.test(mapped)) out.push(<a key={key} href={mapped} className="text-foreground underline underline-offset-2" rel="noreferrer" target={mapped.startsWith('http') ? '_blank' : undefined}>{lm[1]}</a>)
      else out.push(lm[1])
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function Markdown({ source, resolve }: { source: string; resolve?: DocLinkResolver }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = `b${k++}`
    if (!line.trim()) { i++; continue }
    const fence = /^```(\w*)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++
      blocks.push(<pre key={key} className="my-4 overflow-x-auto rounded-md border border-border bg-card p-3 font-mono text-[12px] leading-relaxed text-foreground"><code>{body.join('\n')}</code></pre>)
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      const text = h[2]
      const id = slugify(text)
      const cls = level === 1 ? 'mb-4 mt-2 text-[26px] font-semibold tracking-[-0.02em]' : level === 2 ? 'mb-2 mt-9 text-[18px] font-semibold tracking-[-0.01em]' : 'mb-2 mt-6 text-[15px] font-semibold'
      const Tag = (`h${level}` as 'h1' | 'h2' | 'h3' | 'h4')
      blocks.push(<Tag key={key} id={id} className={`scroll-mt-20 text-foreground ${cls}`}>{inline(text, resolve, key)}</Tag>)
      i++
      continue
    }
    if (line.startsWith('|') && lines[i + 1]?.match(/^\|\s*:?-{3,}/)) {
      const parse = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
      const head = parse(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].startsWith('|')) rows.push(parse(lines[i++]))
      blocks.push(
        <div key={key} className="my-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary/50"><tr>{head.map((c, j) => <th key={j} className="px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{inline(c, resolve, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-border/60">{r.map((c, j) => <td key={j} className="px-3 py-1.5 align-top text-muted-foreground">{inline(c, resolve, `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={key} className="my-4 border-l-2 border-[var(--color-degraded)] pl-3 text-muted-foreground">{inline(body.join(' '), resolve, key)}</blockquote>)
      continue
    }
    const listRe = /^(\s*)([-*]|\d+\.)\s+(.*)$/
    if (listRe.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && (listRe.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const lm = listRe.exec(lines[i])
        if (lm) items.push(lm[3])
        else items[items.length - 1] += ` ${lines[i].trim()}`
        i++
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={key} className={`my-3 space-y-1 pl-5 text-muted-foreground ${ordered ? 'list-decimal' : 'list-disc'} marker:text-faint`}>{items.map((it, j) => <li key={j}>{inline(it.replace(/^\[[ x]\]\s*/, ''), resolve, `${key}i${j}`)}</li>)}</List>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||>|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={key} className="my-3 leading-relaxed text-muted-foreground">{inline(para.join(' '), resolve, key)}</p>)
  }
  return <Fragment>{blocks}</Fragment>
}
