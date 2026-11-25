/**
 * Sensitive-value redaction, applied to messages and metadata BEFORE an event
 * is persisted. Redaction is irreversible by design: the original bytes stay
 * only in the private raw upload (owner-scoped storage), never in records.
 */

export interface RedactionRule {
  name: string
  pattern: RegExp
  replacement: string
}

export const DEFAULT_REDACTION_RULES: RedactionRule[] = [
  { name: 'private_key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED:private_key]' },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: '[REDACTED:jwt]' },
  { name: 'bearer', pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, replacement: '$1 [REDACTED:token]' },
  { name: 'aws_access_key', pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: '[REDACTED:aws_key]' },
  { name: 'github_token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g, replacement: '[REDACTED:github_token]' },
  { name: 'api_key_prefixed', pattern: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED:api_key]' },
  { name: 'kv_secret', pattern: /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization)(["']?\s*[:=]\s*["']?)([^\s"',;&]+)/gi, replacement: '$1$2[REDACTED]' },
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED:email]' },
  { name: 'card', pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: '__CARD__' },
]

const SENSITIVE_KEY = /^(password|passwd|pwd|secret|token|access_token|refresh_token|id_token|api[_-]?key|apikey|authorization|cookie|set-cookie|session|client_secret|private_key|ssn|credit_card|card_number)$/i

function luhn(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

export interface RedactionResult {
  text: string
  hits: string[]
}

export function redactText(text: string, rules: RedactionRule[] = DEFAULT_REDACTION_RULES): RedactionResult {
  const hits: string[] = []
  let out = text
  for (const rule of rules) {
    if (rule.name === 'card') {
      out = out.replace(rule.pattern, (m) => {
        const digits = m.replace(/[ -]/g, '')
        if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
          hits.push('card')
          return '[REDACTED:card]'
        }
        return m
      })
      continue
    }
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(out)) {
      hits.push(rule.name)
      rule.pattern.lastIndex = 0
      out = out.replace(rule.pattern, rule.replacement)
    }
  }
  return { text: out, hits }
}

export function redactMetadata(
  metadata: Record<string, string | number | boolean | null>,
  rules: RedactionRule[] = DEFAULT_REDACTION_RULES,
): { metadata: Record<string, string | number | boolean | null>; hits: string[] } {
  const out: Record<string, string | number | boolean | null> = {}
  const hits: string[] = []
  for (const [k, v] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[REDACTED]'
      hits.push(`key:${k}`)
      continue
    }
    if (typeof v === 'string') {
      const r = redactText(v, rules)
      out[k] = r.text
      hits.push(...r.hits)
    } else {
      out[k] = v
    }
  }
  return { metadata: out, hits }
}
