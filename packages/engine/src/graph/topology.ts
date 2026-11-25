import type { CanonicalEvent, Dependency, ServiceDef } from '../types'

/**
 * Directed service dependency graph. An edge `from -> to` means `from` calls
 * (depends on) `to`. Failures propagate AGAINST edge direction: when `to`
 * breaks, its callers (`from`) are the blast radius.
 */
export class ServiceGraph {
  readonly services: ReadonlyMap<string, ServiceDef>
  readonly dependencies: readonly Dependency[]
  private readonly out = new Map<string, Set<string>>()
  private readonly inn = new Map<string, Set<string>>()

  constructor(services: readonly ServiceDef[], dependencies: readonly Dependency[]) {
    const map = new Map<string, ServiceDef>()
    for (const s of services) map.set(s.id, s)
    const seen = new Set<string>()
    const deps: Dependency[] = []
    for (const d of dependencies) {
      if (d.from === d.to) continue
      const key = `${d.from}\u0000${d.to}`
      if (seen.has(key)) continue
      seen.add(key)
      deps.push(d)
      for (const id of [d.from, d.to]) {
        if (!map.has(id)) map.set(id, { id, name: id, kind: 'service' })
      }
      if (!this.out.has(d.from)) this.out.set(d.from, new Set())
      if (!this.inn.has(d.to)) this.inn.set(d.to, new Set())
      this.out.get(d.from)!.add(d.to)
      this.inn.get(d.to)!.add(d.from)
    }
    this.services = map
    this.dependencies = deps
  }

  /** Services `id` depends on directly. */
  dependenciesOf(id: string): string[] {
    return Array.from(this.out.get(id) ?? []).sort()
  }

  /** Services that call `id` directly. */
  dependentsOf(id: string): string[] {
    return Array.from(this.inn.get(id) ?? []).sort()
  }

  dependsOn(caller: string, callee: string): boolean {
    return this.out.get(caller)?.has(callee) ?? false
  }

  /** Every service whose requests can traverse `id` (transitive callers). Cycle-safe BFS. */
  blastRadius(id: string): string[] {
    return this.walk(id, this.inn)
  }

  /** Every service `id` transitively depends on. */
  transitiveDependencies(id: string): string[] {
    return this.walk(id, this.out)
  }

  private walk(start: string, adj: Map<string, Set<string>>): string[] {
    const seen = new Set<string>([start])
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()!
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    seen.delete(start)
    return Array.from(seen).sort()
  }

  /**
   * Layered layout for rendering: callers left, dependencies right. Longest-path
   * layering on the condensation of cycles, then barycentric ordering within
   * each layer (two sweeps) to reduce crossings. Deterministic.
   */
  layout(): Map<string, { layer: number; order: number }> {
    const ids = Array.from(this.services.keys()).sort()
    const layer = new Map<string, number>()
    // Longest path from any root, guarded against cycles by a visiting set.
    const visiting = new Set<string>()
    const depth = (id: string): number => {
      if (layer.has(id)) return layer.get(id)!
      if (visiting.has(id)) return 0
      visiting.add(id)
      let d = 0
      for (const caller of this.inn.get(id) ?? []) d = Math.max(d, depth(caller) + 1)
      visiting.delete(id)
      layer.set(id, d)
      return d
    }
    for (const id of ids) depth(id)

    const layers: string[][] = []
    for (const id of ids) {
      const l = layer.get(id)!
      ;(layers[l] ??= []).push(id)
    }
    const pos = new Map<string, number>()
    layers.forEach((ls) => ls.forEach((id, i) => pos.set(id, i)))
    const sweep = (neighbors: (id: string) => string[]) => {
      for (const ls of layers) {
        if (!ls) continue
        const bary = new Map<string, number>()
        for (const id of ls) {
          const ns = neighbors(id)
          bary.set(id, ns.length ? ns.reduce((s, n) => s + (pos.get(n) ?? 0), 0) / ns.length : pos.get(id)!)
        }
        ls.sort((a, b) => bary.get(a)! - bary.get(b)! || (a < b ? -1 : 1))
        ls.forEach((id, i) => pos.set(id, i))
      }
    }
    sweep((id) => this.dependentsOf(id))
    sweep((id) => this.dependenciesOf(id))
    const out = new Map<string, { layer: number; order: number }>()
    layers.forEach((ls, l) => ls?.forEach((id, i) => out.set(id, { layer: l, order: i })))
    return out
  }
}

/**
 * Learns call edges from distributed traces: when a span in service B has a
 * parent span in service A (same trace), A called B. Declared edges win; trace
 * edges are added with `origin: 'trace'`.
 */
export function inferDependencies(events: readonly CanonicalEvent[], declared: readonly Dependency[] = []): Dependency[] {
  const spanService = new Map<string, string>()
  for (const e of events) if (e.spanId) spanService.set(`${e.traceId ?? ''}:${e.spanId}`, e.service)
  const result = new Map<string, Dependency>()
  for (const d of declared) result.set(`${d.from}\u0000${d.to}`, d)
  for (const e of events) {
    if (!e.parentSpanId) continue
    const parentSvc = spanService.get(`${e.traceId ?? ''}:${e.parentSpanId}`)
    if (!parentSvc || parentSvc === e.service) continue
    const key = `${parentSvc}\u0000${e.service}`
    if (!result.has(key)) result.set(key, { from: parentSvc, to: e.service, origin: 'trace' })
  }
  return Array.from(result.values()).sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1))
}

/** Ensures every service seen in events has a definition. */
export function servicesFromEvents(events: readonly CanonicalEvent[], declared: readonly ServiceDef[] = []): ServiceDef[] {
  const map = new Map<string, ServiceDef>()
  for (const s of declared) map.set(s.id, s)
  for (const e of events) {
    if (!map.has(e.service)) {
      const kind: ServiceDef['kind'] = /(db|postgres|mysql|database|sql|mongo)/.test(e.service)
        ? 'database'
        : /(queue|kafka|sqs|rabbit)/.test(e.service)
          ? 'queue'
          : /(cache|redis|memcache)/.test(e.service)
            ? 'cache'
            : /(gateway|edge|lb|ingress|cdn)/.test(e.service)
              ? 'edge'
              : 'service'
      map.set(e.service, { id: e.service, name: e.service, kind })
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.id < b.id ? -1 : 1))
}
