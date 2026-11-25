/**
 * cyrb53: a fast, well-distributed 53-bit non-cryptographic string hash.
 * Public domain (bryc). Used for stable, content-derived identifiers, never
 * for security. Identical input always yields an identical id on every
 * runtime (browser, Workers, Node), which is what idempotent ingestion needs.
 */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Base-36 id with a prefix, e.g. `evt_1x9k2...`. Two seeds -> ~106 bits. */
export function stableId(prefix: string, ...parts: Array<string | number | undefined | null>): string {
  const key = parts.map((p) => (p === undefined || p === null ? '\u0000' : String(p))).join('\u001f')
  const a = cyrb53(key, 1).toString(36).padStart(11, '0')
  const b = cyrb53(key, 7).toString(36).padStart(11, '0')
  return `${prefix}_${a}${b}`
}
