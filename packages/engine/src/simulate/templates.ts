import type { IncidentDataset } from '../types'
import { SEVERITY_RANK } from '../types'
import { ServiceGraph } from '../graph/topology'
import { service, type ScheduledChange, type SimScenario } from './model'

const retry = (maxAttempts: number, backoffMs: number, jitter = 0.2) => ({ maxAttempts, backoffMs, backoffMultiplier: 2, jitter })

export interface LabTemplate {
  slug: string
  name: string
  description: string
  build: () => SimScenario
}

function scenario(id: string, name: string, s: Omit<SimScenario, 'id' | 'name' | 'seed' | 'sampleMs'> & { seed?: number }): SimScenario {
  return { id, name, seed: s.seed ?? 42, sampleMs: 1000, durationSec: s.durationSec, model: s.model, timeline: s.timeline }
}

/**
 * Chaos-lab starting points. Every fault is injected into the virtual model
 * only; nothing here touches real infrastructure.
 */
export const LAB_TEMPLATES: LabTemplate[] = [
  {
    slug: 'ecommerce-checkout',
    name: 'E-commerce checkout',
    description: 'Gateway, checkout, pricing with its database, inventory, and a payments provider. Healthy baseline.',
    build: () => scenario('lab-ecommerce', 'E-commerce checkout', {
      durationSec: 300,
      timeline: [],
      model: {
        entry: 'gateway', networkMs: 1, clientTimeoutMs: 5000, clientRetry: retry(2, 250), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 60 }],
        services: [
          service('gateway', 'edge', { capacity: 300, serviceTimeMs: 2, timeoutMs: 4000 }),
          service('checkout', 'service', { capacity: 80, serviceTimeMs: 10, timeoutMs: 1500 }),
          service('pricing', 'service', { capacity: 60, serviceTimeMs: 6, timeoutMs: 600, retry: retry(2, 50) }),
          service('pricing-db', 'database', { capacity: 14, serviceTimeMs: 6 }),
          service('inventory', 'service', { capacity: 60, serviceTimeMs: 7 }),
          service('payments', 'external', { capacity: 150, serviceTimeMs: 45 }),
        ],
        calls: [
          { from: 'gateway', to: 'checkout' }, { from: 'checkout', to: 'pricing' }, { from: 'checkout', to: 'inventory' },
          { from: 'checkout', to: 'payments' }, { from: 'pricing', to: 'pricing-db' },
        ],
      },
    }),
  },
  {
    slug: 'event-driven',
    name: 'Event-driven microservices',
    description: 'An API that writes through a broker to consumers. The broker queue absorbs bursts until it does not.',
    build: () => scenario('lab-event-driven', 'Event-driven microservices', {
      durationSec: 300,
      timeline: [{ atSec: 90, label: 'Traffic burst x2.5', origin: 'scenario', category: 'traffic', change: { kind: 'set_traffic', rps: 150 } }, { atSec: 180, label: 'Burst ends', origin: 'scenario', category: 'traffic', change: { kind: 'set_traffic', rps: 60 } }],
      model: {
        entry: 'orders-api', networkMs: 1, clientTimeoutMs: 4000, clientRetry: retry(1, 0), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 60 }],
        services: [
          service('orders-api', 'edge', { capacity: 200, serviceTimeMs: 3, timeoutMs: 3500 }),
          service('event-broker', 'queue', { capacity: 30, queueCapacity: 2000, serviceTimeMs: 4 }),
          service('fulfillment', 'service', { capacity: 25, serviceTimeMs: 18 }),
          service('orders-db', 'database', { capacity: 20, serviceTimeMs: 8 }),
        ],
        calls: [{ from: 'orders-api', to: 'event-broker' }, { from: 'event-broker', to: 'fulfillment' }, { from: 'fulfillment', to: 'orders-db' }],
      },
    }),
  },
  {
    slug: 'social-media',
    name: 'Social media application',
    description: 'Timeline fan-out reads from a cache backed by a posts database, with optional media enrichment.',
    build: () => scenario('lab-social', 'Social media application', {
      durationSec: 300,
      timeline: [],
      model: {
        entry: 'edge', networkMs: 1, clientTimeoutMs: 3000, clientRetry: retry(3, 100), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 120 }],
        services: [
          service('edge', 'edge', { capacity: 500, serviceTimeMs: 2, timeoutMs: 2500 }),
          service('timeline', 'service', { capacity: 120, serviceTimeMs: 6, timeoutMs: 800, retry: retry(2, 30) }),
          service('timeline-cache', 'cache', { capacity: 200, serviceTimeMs: 1.5 }),
          service('posts-db', 'database', { capacity: 30, serviceTimeMs: 7 }),
          service('media', 'service', { capacity: 60, serviceTimeMs: 20 }),
        ],
        calls: [
          { from: 'edge', to: 'timeline' }, { from: 'timeline', to: 'timeline-cache' }, { from: 'timeline', to: 'posts-db' },
          { from: 'timeline', to: 'media', optional: true },
        ],
      },
    }),
  },
  {
    slug: 'ai-inference',
    name: 'AI inference pipeline',
    description: 'Requests pass a router, an embedding service, a vector store, and a GPU-bound model server with a small concurrency limit.',
    build: () => scenario('lab-ai', 'AI inference pipeline', {
      durationSec: 300,
      timeline: [],
      model: {
        entry: 'inference-api', networkMs: 2, clientTimeoutMs: 20_000, clientRetry: retry(1, 0), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 12 }],
        services: [
          service('inference-api', 'edge', { capacity: 100, serviceTimeMs: 3, timeoutMs: 15_000 }),
          service('embedder', 'service', { capacity: 16, serviceTimeMs: 35, timeoutMs: 2000 }),
          service('vector-store', 'database', { capacity: 24, serviceTimeMs: 12 }),
          service('model-server', 'service', { capacity: 8, queueCapacity: 40, serviceTimeMs: 450, serviceTimeCv: 0.6, timeoutMs: 10_000 }),
        ],
        calls: [{ from: 'inference-api', to: 'embedder' }, { from: 'embedder', to: 'vector-store' }, { from: 'inference-api', to: 'model-server' }],
      },
    }),
  },
  {
    slug: 'realtime-sports',
    name: 'Real-time sports application',
    description: 'A live-score API that spikes when a match ends; the stats service and its database must keep up.',
    build: () => scenario('lab-sports', 'Real-time sports application', {
      durationSec: 300,
      timeline: [{ atSec: 120, label: 'Final whistle: traffic x4', origin: 'scenario', category: 'traffic', change: { kind: 'set_traffic', rps: 240 } }, { atSec: 200, label: 'Traffic subsides', origin: 'scenario', category: 'traffic', change: { kind: 'set_traffic', rps: 80 } }],
      model: {
        entry: 'scores-api', networkMs: 1, clientTimeoutMs: 2500, clientRetry: retry(3, 0, 0), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 60 }],
        services: [
          service('scores-api', 'edge', { capacity: 400, serviceTimeMs: 2, timeoutMs: 2000 }),
          service('stats', 'service', { capacity: 90, serviceTimeMs: 6, timeoutMs: 700 }),
          service('stats-db', 'database', { capacity: 24, serviceTimeMs: 5 }),
        ],
        calls: [{ from: 'scores-api', to: 'stats' }, { from: 'stats', to: 'stats-db' }],
      },
    }),
  },
  {
    slug: 'banking',
    name: 'Banking application',
    description: 'A mobile banking API that signs people in, checks transfers for fraud with an outside service, and writes to a ledger database.',
    build: () => scenario('lab-banking', 'Banking application', {
      durationSec: 300,
      timeline: [],
      model: {
        entry: 'mobile-api', networkMs: 1, clientTimeoutMs: 6000, clientRetry: retry(2, 300), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 45 }],
        services: [
          service('mobile-api', 'edge', { capacity: 200, serviceTimeMs: 3, timeoutMs: 5000 }),
          service('auth', 'service', { capacity: 60, serviceTimeMs: 6, timeoutMs: 800 }),
          service('transfers', 'service', { capacity: 50, serviceTimeMs: 10, timeoutMs: 2500, retry: retry(2, 100) }),
          service('fraud-check', 'external', { capacity: 40, serviceTimeMs: 60, serviceTimeCv: 0.6 }),
          service('ledger-db', 'database', { capacity: 16, serviceTimeMs: 9 }),
        ],
        calls: [
          { from: 'mobile-api', to: 'auth' }, { from: 'mobile-api', to: 'transfers' },
          { from: 'transfers', to: 'fraud-check' }, { from: 'transfers', to: 'ledger-db' },
        ],
      },
    }),
  },
  {
    slug: 'pool-exhaustion',
    name: 'Database connection pool exhaustion',
    description: 'A slow query halves database throughput at T+60s. Try a bigger pool, a breaker, or a rate limit.',
    build: () => scenario('lab-pool', 'Database connection pool exhaustion', {
      durationSec: 300,
      timeline: [{ atSec: 60, label: 'Slow query: orders-db 4x slower', origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: 'orders-db', patch: { serviceTimeMs: 32 } } }],
      model: {
        entry: 'api', networkMs: 1, clientTimeoutMs: 3000, clientRetry: retry(2, 100), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 80 }],
        services: [
          service('api', 'edge', { capacity: 200, serviceTimeMs: 3, timeoutMs: 2500 }),
          service('orders', 'service', { capacity: 60, serviceTimeMs: 6, timeoutMs: 700, retry: retry(2, 25) }),
          service('orders-db', 'database', { capacity: 12, serviceTimeMs: 8 }),
        ],
        calls: [{ from: 'api', to: 'orders' }, { from: 'orders', to: 'orders-db' }],
      },
    }),
  },
  {
    slug: 'retry-storm',
    name: 'Retry storm',
    description: 'A dependency stalls for 60 seconds; aggressive retries at two layers keep the system down after it recovers.',
    build: () => scenario('lab-retry', 'Retry storm', {
      durationSec: 300,
      timeline: [
        { atSec: 60, label: 'inventory stalls', origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: 'inventory', patch: { latencyMultiplier: 50 } } },
        { atSec: 120, label: 'inventory recovers', origin: 'scenario', category: 'recovery', change: { kind: 'set_service', service: 'inventory', patch: { latencyMultiplier: 1 } } },
      ],
      model: {
        entry: 'gateway', networkMs: 1, clientTimeoutMs: 2500, clientRetry: retry(4, 0, 0), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 70 }],
        services: [
          service('gateway', 'edge', { capacity: 400, serviceTimeMs: 2, timeoutMs: 2000 }),
          service('cart', 'service', { capacity: 70, serviceTimeMs: 6, timeoutMs: 900, retry: retry(3, 0, 0) }),
          service('inventory', 'service', { capacity: 50, serviceTimeMs: 10 }),
          service('cart-db', 'database', { capacity: 14, serviceTimeMs: 20, contention: 3 }),
        ],
        calls: [{ from: 'gateway', to: 'cart' }, { from: 'cart', to: 'cart-db' }, { from: 'cart', to: 'inventory' }],
      },
    }),
  },
  {
    slug: 'failed-deployment',
    name: 'Failed deployment',
    description: 'A deploy at T+60s makes 15% of requests to the API fail. Compare a rollback with retries.',
    build: () => scenario('lab-deploy', 'Failed deployment', {
      durationSec: 300,
      timeline: [{ atSec: 60, label: 'Deploy api v4.0.0', origin: 'scenario', category: 'deploy', deploymentId: 'api@v4.0.0', change: { kind: 'set_service', service: 'api', patch: { errorRate: 0.15, version: 'v4.0.0' } } }] as ScheduledChange[],
      model: {
        entry: 'edge', networkMs: 1, clientTimeoutMs: 3000, clientRetry: retry(1, 0), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 50 }],
        services: [
          service('edge', 'edge', { capacity: 200, serviceTimeMs: 2, timeoutMs: 2500 }),
          service('api', 'service', { capacity: 60, serviceTimeMs: 12, version: 'v3.9.1' }),
          service('api-db', 'database', { capacity: 20, serviceTimeMs: 6 }),
        ],
        calls: [{ from: 'edge', to: 'api' }, { from: 'api', to: 'api-db' }],
      },
    }),
  },
  {
    slug: 'queue-backlog',
    name: 'Message queue backlog',
    description: 'Consumers slow down at T+60s; the queue absorbs the backlog until it overflows and producers see rejections.',
    build: () => scenario('lab-queue', 'Message queue backlog', {
      durationSec: 300,
      timeline: [{ atSec: 60, label: 'Consumer slowdown (GC pressure)', origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: 'consumer', patch: { latencyMultiplier: 3 } } }],
      model: {
        entry: 'producer', networkMs: 1, clientTimeoutMs: 10_000, clientRetry: retry(1, 0), rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 90 }],
        services: [
          service('producer', 'edge', { capacity: 300, serviceTimeMs: 2, timeoutMs: 9000 }),
          service('queue', 'queue', { capacity: 40, queueCapacity: 1500, serviceTimeMs: 1 }),
          service('consumer', 'service', { capacity: 40, serviceTimeMs: 30, timeoutMs: 8000 }),
        ],
        calls: [{ from: 'producer', to: 'queue' }, { from: 'queue', to: 'consumer' }],
      },
    }),
  },
]

export function labTemplate(slug: string): SimScenario | undefined {
  return LAB_TEMPLATES.find((t) => t.slug === slug)?.build()
}

/**
 * Builds a simulation model from an IMPORTED incident. Real systems' capacities
 * and rates are not in log files, so the parameters below are documented
 * defaults; every assumption is returned for display next to the results.
 */
export function deriveScenarioFromIncident(dataset: IncidentDataset, opts: { rps?: number } = {}): { scenario: SimScenario; assumptions: string[] } {
  const graph = new ServiceGraph(dataset.services, dataset.dependencies)
  const assumptions: string[] = [
    'Imported incident: capacities, service times, and traffic are Faultline defaults, not measured values. Treat results as hypothetical.',
  ]
  const ids = Array.from(graph.services.keys()).sort()
  // Keep the call graph acyclic: drop edges that close a cycle (in sorted order).
  const kept: Array<{ from: string; to: string }> = []
  const reaches = (a: string, b: string): boolean => {
    const seen = new Set([a])
    const q = [a]
    while (q.length) {
      const c = q.shift()!
      if (c === b) return true
      for (const e of kept) if (e.from === c && !seen.has(e.to)) { seen.add(e.to); q.push(e.to) }
    }
    return false
  }
  let dropped = 0
  for (const d of graph.dependencies) {
    if (reaches(d.to, d.from)) { dropped++; continue }
    kept.push({ from: d.from, to: d.to })
  }
  if (dropped) assumptions.push(`${dropped} dependency edge(s) were dropped to keep the synchronous call graph acyclic.`)
  const roots = ids.filter((id) => !kept.some((e) => e.to === id))
  const counts = new Map<string, number>()
  for (const e of dataset.events) counts.set(e.service, (counts.get(e.service) ?? 0) + 1)
  const entry = roots.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1))[0] ?? ids[0]
  // Services unreachable from the entry would receive no traffic; attach them.
  const reachable = new Set([entry])
  let grew = true
  while (grew) {
    grew = false
    for (const e of kept) if (reachable.has(e.from) && !reachable.has(e.to)) { reachable.add(e.to); grew = true }
  }
  for (const id of ids) if (!reachable.has(id) && id !== entry) { kept.push({ from: entry, to: id }); assumptions.push(`${id} had no inbound dependency; modeled as called by ${entry}.`) }

  const start = dataset.events[0]?.ts ?? 0
  const end = dataset.events[dataset.events.length - 1]?.ts ?? start
  const durationSec = Math.max(60, Math.min(1800, Math.ceil((end - start) / 1000) + 60))
  const rps = opts.rps ?? 40
  assumptions.push(`Entry traffic is a constant ${rps} rps at ${entry} (log volume does not reveal true request rates).`)

  const timeline: ScheduledChange[] = []
  for (const e of dataset.events) {
    if (e.type !== 'deploy' || !graph.services.has(e.service)) continue
    const atSec = Math.round((e.ts - start) / 1000)
    const window = (from: number, to: number) => dataset.events.filter((x) => x.service === e.service && x.ts >= from && x.ts < to)
    const before = window(e.ts - 300_000, e.ts)
    const after = window(e.ts, e.ts + 300_000)
    const rate = (xs: typeof before) => (xs.length ? xs.filter((x) => SEVERITY_RANK[x.severity] >= 3).length / xs.length : 0)
    const lift = Math.max(0, rate(after) - rate(before))
    if (lift <= 0) continue
    const errorRate = Math.min(0.5, Math.round(lift * 0.5 * 1000) / 1000)
    timeline.push({ atSec, label: `Deploy ${e.deploymentId ?? ''} on ${e.service}`.trim(), origin: 'scenario', category: 'deploy', deploymentId: e.deploymentId ?? `${e.service}@${atSec}`, change: { kind: 'set_service', service: e.service, patch: { errorRate } } })
    assumptions.push(`Deploy on ${e.service} at T+${atSec}s is modeled as an intrinsic error rate of ${(errorRate * 100).toFixed(1)}%, estimated from the change in its error-event share (a proxy, not a measured request error rate).`)
  }
  if (timeline.length === 0) assumptions.push('No deployment with an error increase was found, so the model has no injected fault; use the lab controls to add one.')

  const services = ids.map((id) => {
    const def = graph.services.get(id)!
    return service(id, def.kind === 'external' || def.kind === 'cache' || def.kind === 'queue' || def.kind === 'edge' || def.kind === 'database' ? def.kind : 'service')
  })
  return {
    assumptions,
    scenario: {
      id: `derived-${dataset.meta.id}`,
      name: `${dataset.meta.title} (derived model)`,
      seed: 1,
      sampleMs: 1000,
      durationSec,
      timeline,
      model: { entry, networkMs: 1, clientTimeoutMs: 5000, clientRetry: retry(1, 0), rateLimitRps: null, traffic: [{ atSec: 0, rps }], services, calls: kept },
    },
  }
}
