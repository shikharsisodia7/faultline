import type { Intervention } from '../simulate/interventions'
import { service, type SimScenario } from '../simulate/model'

/**
 * The three-part store used on the landing page: Website → Checkout →
 * Database. A flash sale doubles traffic; the database saturates; checkout
 * retries pile on. Everything shown on the landing page is computed by
 * running this scenario through the real simulator.
 */
export const STOREFRONT: SimScenario = {
  id: 'storefront',
  name: 'An online store during a flash sale',
  seed: 2024,
  sampleMs: 1000,
  durationSec: 240,
  timeline: [
    { atSec: 60, label: 'Flash sale starts: traffic more than doubles', origin: 'scenario', category: 'traffic', change: { kind: 'set_traffic', rps: 150 } },
    { atSec: 170, label: 'Sale traffic winds down', origin: 'scenario', category: 'traffic', change: { kind: 'set_traffic', rps: 70 } },
  ],
  model: {
    entry: 'website',
    networkMs: 1,
    clientTimeoutMs: 4000,
    clientRetry: { maxAttempts: 2, backoffMs: 200, backoffMultiplier: 2, jitter: 0.2 },
    rateLimitRps: null,
    traffic: [{ atSec: 0, rps: 70 }],
    services: [
      service('website', 'edge', { capacity: 400, queueCapacity: 400, serviceTimeMs: 3, timeoutMs: 3500 }),
      service('checkout', 'service', { capacity: 60, queueCapacity: 80, serviceTimeMs: 8, timeoutMs: 800, retry: { maxAttempts: 3, backoffMs: 40, backoffMultiplier: 2, jitter: 0.2 } }),
      service('database', 'database', { capacity: 8, queueCapacity: 100, serviceTimeMs: 45, contention: 2.5 }),
    ],
    calls: [
      { from: 'website', to: 'checkout' },
      { from: 'checkout', to: 'database' },
    ],
  },
}

/** Plain-language names for the storefront's parts. */
export const STOREFRONT_LABELS: Record<string, { name: string; role: string }> = {
  website: { name: 'Website', role: 'Where shoppers browse and press "Buy".' },
  checkout: { name: 'Checkout', role: 'Takes the order and asks the database to save it.' },
  database: { name: 'Database', role: 'Stores orders. It can only work on a few at once.' },
}

export interface Choice {
  id: string
  label: string
  description: string
  build: (amount: number) => Intervention[]
  /** Slider semantics for the choice, if it has one. */
  amount?: { min: number; max: number; step: number; initial: number; unit: string; label: string }
}

/** Decisions a visitor can try. Each maps onto real simulator interventions. */
export const STOREFRONT_CHOICES: Choice[] = [
  {
    id: 'limit',
    label: 'Limit incoming traffic',
    description: 'Let only a set number of shoppers in each second. The rest see "try again".',
    amount: { min: 60, max: 150, step: 10, initial: 100, unit: 'shoppers / s', label: 'Allow' },
    build: (rps) => [{ kind: 'rate_limit', rps }],
  },
  {
    id: 'capacity',
    label: 'Give the database more capacity',
    description: 'Let the database work on more orders at the same time.',
    amount: { min: 8, max: 40, step: 4, initial: 20, unit: 'at once', label: 'Database can handle' },
    build: (capacity) => [{ kind: 'db_pool', service: 'database', capacity }],
  },
  {
    id: 'retries',
    label: 'Stop repeating failed requests',
    description: 'When the database is slow, checkout gives up instead of trying again three times.',
    build: () => [{ kind: 'retry_policy', service: 'checkout', maxAttempts: 1, backoffMs: 0 }],
  },
]
