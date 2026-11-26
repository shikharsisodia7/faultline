import { service, type ScheduledChange, type SimScenario } from '../simulate/model'
import type { Choice } from './storefront'

/**
 * Synthetic demo incidents. Each is a simulation scenario; its logs, traces,
 * alerts, and the counterfactual baseline are all produced by running it, so
 * every artifact is internally consistent. Clearly labeled synthetic in the UI.
 */
export interface DemoScenario {
  slug: string
  title: string
  tagline: string
  severity: 'sev1' | 'sev2' | 'sev3'
  category: string
  summary: string
  /** Wall-clock anchor for generated timestamps (fixed for reproducibility). */
  baseTime: number
  scenario: SimScenario
  /** Suggested branch point and intervention for the guided tour. */
  suggested: { atSec: number; label: string }
  /** Generated SLO alert rule: rolling error rate over `windowSec` above `threshold`. */
  alert: { threshold: number; windowSec: number }
  annotations: Array<{ atSec: number; author: string; body: string; kind: 'note' | 'hypothesis' | 'action' }>
  /** Everyday framing for the guided demo. */
  plain: {
    headline: string
    /** What each part of the system does, in ordinary words. */
    parts: Record<string, string>
    /**
     * The sequence in ordinary language. `kind` ties a beat to something the
     * simulation must actually show (tests check this): 'change' and
     * 'response' beats sit on a scheduled change, 'impact' beats at or after
     * the failure onset, 'recovery' beats only when the run recovered.
     */
    story: Array<{ atSec: number; text: string; kind: 'change' | 'strain' | 'impact' | 'response' | 'recovery' }>
  }
  /** Decisions offered in the guided "What if?" step (real interventions). */
  choices: Choice[]
}

const retry = (maxAttempts: number, backoffMs: number, jitter = 0.2) => ({ maxAttempts, backoffMs, backoffMultiplier: 2, jitter })

/* ----------------------------------------------------------------- Scenario A */

function checkoutCascade(): DemoScenario {
  const timeline: ScheduledChange[] = [
    {
      atSec: 120,
      label: 'Deploy pricing-svc v2.14.0 (30% of pods)',
      origin: 'scenario',
      category: 'deploy',
      deploymentId: 'pricing-svc@v2.14.0',
      deployService: 'pricing-svc',
      change: { kind: 'set_service', service: 'pricing-db', patch: { serviceTimeMs: 42 } },
    },
    {
      atSec: 150,
      label: 'Deploy pricing-svc v2.14.0 (60% of pods)',
      origin: 'scenario',
      category: 'deploy',
      deploymentId: 'pricing-svc@v2.14.0',
      deployService: 'pricing-svc',
      change: { kind: 'set_service', service: 'pricing-db', patch: { serviceTimeMs: 84 } },
    },
    {
      atSec: 180,
      label: 'Deploy pricing-svc v2.14.0 (100% of pods)',
      origin: 'scenario',
      category: 'deploy',
      deploymentId: 'pricing-svc@v2.14.0',
      deployService: 'pricing-svc',
      change: { kind: 'set_service', service: 'pricing-db', patch: { serviceTimeMs: 125 } },
    },
    {
      atSec: 120,
      label: 'Deploy pricing-svc v2.14.0 (30% of pods)',
      origin: 'scenario',
      category: 'deploy',
      deploymentId: 'pricing-svc@v2.14.0',
      deployService: 'pricing-svc',
      change: { kind: 'set_service', service: 'pricing-svc', patch: { latencyMultiplier: 1.4, version: 'v2.14.0' } },
    },
    {
      atSec: 430,
      label: 'Roll back pricing-svc to v2.13.2',
      origin: 'scenario',
      category: 'rollback',
      change: { kind: 'set_service', service: 'pricing-db', patch: { serviceTimeMs: 6 } },
    },
    {
      atSec: 430,
      label: 'Roll back pricing-svc to v2.13.2',
      origin: 'scenario',
      category: 'rollback',
      change: { kind: 'set_service', service: 'pricing-svc', patch: { latencyMultiplier: 1, version: 'v2.13.2' } },
    },
  ]
  return {
    slug: 'checkout-cascade',
    title: 'The Checkout Cascade',
    tagline: 'A pricing deploy saturates its database pool and takes checkout down with it.',
    severity: 'sev1',
    category: 'bad-deploy',
    summary:
      'pricing-svc v2.14.0 ships an unindexed query. As the rollout widens, pricing-db query time rises roughly 20x, its 14-connection pool saturates, pricing-svc retries timed-out queries, and checkout workers block on pricing until the gateway starts returning 5xx. Operators roll back at T+430s.',
    baseTime: Date.UTC(2026, 9, 14, 17, 2, 0),
    suggested: { atSec: 200, label: 'Roll back pricing-svc at T+200s' },
    alert: { threshold: 0.05, windowSec: 10 },
    plain: {
      headline: 'An online store suddenly stops accepting orders.',
      parts: { 'edge-gateway': 'The front door every shopper passes through', 'checkout-svc': 'Takes orders', 'pricing-svc': 'Works out prices', 'pricing-db': 'Stores prices and handles a few lookups at a time', 'inventory-svc': 'Checks stock', 'inventory-db': 'Stores stock levels', 'payments-svc': 'Charges cards', 'payments-provider': 'The outside card processor' },
      story: [
        { atSec: 120, kind: 'change', text: 'A software update to the pricing service started rolling out.' },
        { atSec: 150, kind: 'change', text: 'As more servers got the update, the pricing database slowed down: each price lookup took far longer.' },
        { atSec: 155, kind: 'impact', text: 'Requests piled up faster than the database could answer. Checkout waited, timed out, and tried again.' },
        { atSec: 170, kind: 'impact', text: 'Checkout stopped working. Customers could no longer place orders.' },
        { atSec: 430, kind: 'response', text: 'The team undid the update.' },
        { atSec: 460, kind: 'recovery', text: 'Orders went through again.' },
      ],
    },
    choices: [
      { id: 'rollback', label: 'Undo the software update', description: 'Put the previous version of the pricing service back.', build: () => [{ kind: 'rollback_deployment', service: 'pricing-svc' }] },
      { id: 'capacity', label: 'Give the database more capacity', description: 'Let the pricing database work on more lookups at once.', amount: { min: 14, max: 80, step: 2, initial: 40, unit: 'at once', label: 'Database can handle' }, build: (n) => [{ kind: 'db_pool', service: 'pricing-db', capacity: n }] },
      { id: 'limit', label: 'Temporarily limit incoming traffic', description: 'Let only a set number of shoppers in each second; the rest are asked to try again.', amount: { min: 20, max: 85, step: 5, initial: 50, unit: 'shoppers / s', label: 'Allow' }, build: (rps) => [{ kind: 'rate_limit', rps }] },
      { id: 'retries', label: 'Stop repeating failed requests', description: 'When a price lookup is slow, give up instead of trying three times.', build: () => [{ kind: 'retry_policy', service: 'pricing-svc', maxAttempts: 1, backoffMs: 0 }] },
    ],
    annotations: [
      { atSec: 175, author: 'on-call (synthetic)', body: 'Checkout p95 alert firing. Gateway shows elevated 5xx. Looking at checkout-svc first.', kind: 'note' },
      { atSec: 260, author: 'on-call (synthetic)', body: 'checkout-svc is mostly waiting on pricing-svc calls. pricing-db pool looks pinned.', kind: 'hypothesis' },
      { atSec: 410, author: 'incident lead (synthetic)', body: 'Decision: roll back pricing-svc to v2.13.2.', kind: 'action' },
    ],
    scenario: {
      id: 'checkout-cascade',
      name: 'The Checkout Cascade',
      durationSec: 600,
      seed: 1402,
      sampleMs: 1000,
      timeline,
      model: {
        entry: 'edge-gateway',
        networkMs: 1,
        clientTimeoutMs: 5000,
        clientRetry: retry(2, 250),
        rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 85 }],
        services: [
          service('edge-gateway', 'edge', { capacity: 400, queueCapacity: 400, serviceTimeMs: 2, timeoutMs: 4000 }),
          service('checkout-svc', 'service', { capacity: 90, queueCapacity: 120, serviceTimeMs: 10, timeoutMs: 1500, version: 'v5.2.0' }),
          service('pricing-svc', 'service', { capacity: 70, queueCapacity: 140, serviceTimeMs: 6, timeoutMs: 600, retry: retry(3, 50), version: 'v2.13.2' }),
          service('pricing-db', 'database', { capacity: 14, queueCapacity: 160, serviceTimeMs: 6, contention: 2.5 }),
          service('inventory-svc', 'service', { capacity: 60, serviceTimeMs: 7, timeoutMs: 800 }),
          service('inventory-db', 'database', { capacity: 30, serviceTimeMs: 5 }),
          service('payments-svc', 'service', { capacity: 60, serviceTimeMs: 14, timeoutMs: 2000 }),
          service('payments-provider', 'external', { capacity: 200, serviceTimeMs: 45, serviceTimeCv: 0.4 }),
        ],
        calls: [
          { from: 'edge-gateway', to: 'checkout-svc' },
          { from: 'checkout-svc', to: 'pricing-svc' },
          { from: 'checkout-svc', to: 'inventory-svc' },
          { from: 'checkout-svc', to: 'payments-svc' },
          { from: 'pricing-svc', to: 'pricing-db' },
          { from: 'inventory-svc', to: 'inventory-db' },
          { from: 'payments-svc', to: 'payments-provider' },
        ],
      },
    },
  }
}

/* ----------------------------------------------------------------- Scenario B */

function retryStorm(): DemoScenario {
  return {
    slug: 'retry-storm',
    title: 'The Retry Storm',
    tagline: 'A ranking model stalls, retries multiply load, and healthy services fall over.',
    severity: 'sev1',
    category: 'retry-amplification',
    summary:
      'ranking-model stalls for 90 seconds. feed-svc retries each timed-out call three times with no backoff, and mobile clients retry on top. The amplified load exhausts users-db, so profile requests that never touch ranking start failing too. Load shedding at the gateway ends it.',
    baseTime: Date.UTC(2026, 10, 3, 9, 41, 0),
    suggested: { atSec: 160, label: 'Isolate ranking-svc from feed-svc at T+160s' },
    alert: { threshold: 0.05, windowSec: 10 },
    plain: {
      headline: 'A social app slows down, then stops loading for everyone.',
      parts: { 'api-gateway': 'The front door for the mobile app', 'feed-svc': 'Builds each person’s feed', 'profile-svc': 'Looks up profiles', 'users-db': 'Stores user accounts and handles a few queries at a time', 'ranking-svc': 'Decides the order of posts', 'ranking-model': 'An outside model that scores posts' },
      story: [
        { atSec: 150, kind: 'change', text: 'The ranking model stopped responding quickly.' },
        { atSec: 155, kind: 'impact', text: 'Feed requests waited, timed out, and were retried, both by the app and by the feed service.' },
        { atSec: 170, kind: 'impact', text: 'Feeds stopped loading for everyone.' },
        { atSec: 240, kind: 'change', text: 'The ranking model recovered, but the pile of retries kept the user database overloaded.' },
        { atSec: 340, kind: 'response', text: 'The team limited incoming traffic so the backlog could drain.' },
      ],
    },
    choices: [
      { id: 'isolate', label: 'Show feeds without ranking', description: 'Skip the slow ranking step and show posts in a simple order.', build: () => [{ kind: 'isolate_dependency', from: 'feed-svc', to: 'ranking-svc' }] },
      { id: 'retries', label: 'Stop repeating failed requests', description: 'The feed service and the app stop retrying slow requests.', build: () => [{ kind: 'retry_policy', service: 'feed-svc', maxAttempts: 1, backoffMs: 0 }, { kind: 'retry_policy', service: 'client', maxAttempts: 1, backoffMs: 0 }] },
      { id: 'limit', label: 'Temporarily limit incoming traffic', description: 'Let only a set number of requests in each second.', amount: { min: 30, max: 95, step: 5, initial: 55, unit: 'requests / s', label: 'Allow' }, build: (rps) => [{ kind: 'rate_limit', rps }] },
      { id: 'capacity', label: 'Give the user database more capacity', description: 'Let the user database handle more queries at once.', amount: { min: 16, max: 80, step: 4, initial: 40, unit: 'at once', label: 'Database can handle' }, build: (n) => [{ kind: 'db_pool', service: 'users-db', capacity: n }] },
    ],
    annotations: [
      { atSec: 170, author: 'on-call (synthetic)', body: 'ranking-model latency through the roof. Feed timeouts climbing.', kind: 'note' },
      { atSec: 260, author: 'on-call (synthetic)', body: 'ranking-model recovered but feed is still failing. users-db is at max connections?', kind: 'hypothesis' },
      { atSec: 330, author: 'incident lead (synthetic)', body: 'Enable gateway rate limit at 55 rps to shed load and let users-db drain.', kind: 'action' },
    ],
    scenario: {
      id: 'retry-storm',
      name: 'The Retry Storm',
      durationSec: 540,
      seed: 7719,
      sampleMs: 1000,
      timeline: [
        { atSec: 150, label: 'ranking-model stalls (upstream GPU node drain)', origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: 'ranking-model', patch: { latencyMultiplier: 40 } } },
        { atSec: 240, label: 'ranking-model recovers', origin: 'scenario', category: 'recovery', change: { kind: 'set_service', service: 'ranking-model', patch: { latencyMultiplier: 1 } } },
        { atSec: 340, label: 'Enable gateway rate limit at 55 rps', origin: 'scenario', category: 'config_change', change: { kind: 'set_rate_limit', rps: 55 } },
        { atSec: 420, label: 'Raise gateway rate limit to 120 rps', origin: 'scenario', category: 'config_change', change: { kind: 'set_rate_limit', rps: 120 } },
      ],
      model: {
        entry: 'api-gateway',
        networkMs: 1,
        clientTimeoutMs: 3000,
        clientRetry: retry(4, 0, 0),
        rateLimitRps: null,
        traffic: [{ atSec: 0, rps: 95 }],
        services: [
          service('api-gateway', 'edge', { capacity: 500, queueCapacity: 500, serviceTimeMs: 2, timeoutMs: 2500 }),
          service('feed-svc', 'service', { capacity: 80, queueCapacity: 150, serviceTimeMs: 8, timeoutMs: 1200, retry: retry(3, 0, 0) }),
          service('profile-svc', 'service', { capacity: 70, queueCapacity: 120, serviceTimeMs: 5, timeoutMs: 600, retry: retry(2, 20) }),
          service('users-db', 'database', { capacity: 16, queueCapacity: 120, serviceTimeMs: 22, contention: 3 }),
          service('ranking-svc', 'service', { capacity: 80, queueCapacity: 120, serviceTimeMs: 4, timeoutMs: 900 }),
          service('ranking-model', 'external', { capacity: 60, queueCapacity: 200, serviceTimeMs: 20 }),
        ],
        calls: [
          { from: 'api-gateway', to: 'feed-svc' },
          { from: 'feed-svc', to: 'profile-svc' },
          { from: 'feed-svc', to: 'ranking-svc' },
          { from: 'profile-svc', to: 'users-db' },
          { from: 'ranking-svc', to: 'ranking-model' },
          { from: 'ranking-svc', to: 'users-db' },
        ],
      },
    },
  }
}

/* ----------------------------------------------------------------- Scenario C */

function silentDeployment(): DemoScenario {
  return {
    slug: 'silent-deployment',
    title: 'The Silent Deployment',
    tagline: 'A deploy breaks a small slice of requests and hides in the noise for minutes.',
    severity: 'sev2',
    category: 'partial-failure',
    summary:
      'recommendations-svc v3.2.0 throws on requests with an unusual locale. It rolls out in stages (25%, 50%, 100%), so the error rate creeps up instead of spiking and stays under the 2-minute burn-rate threshold until full rollout. Rolled back at T+480s.',
    baseTime: Date.UTC(2026, 10, 19, 22, 15, 0),
    suggested: { atSec: 150, label: 'Roll back recommendations-svc at T+150s' },
    alert: { threshold: 0.02, windowSec: 120 },
    plain: {
      headline: 'A search page quietly starts failing for some customers.',
      parts: { 'web-frontend': 'The website', 'search-svc': 'Runs searches', 'search-index': 'Holds the searchable catalog', 'recommendations-svc': 'Suggests related products', 'feature-store': 'A fast cache of customer data' },
      story: [
        { atSec: 90, kind: 'change', text: 'An update to the recommendations service reached a quarter of its servers.' },
        { atSec: 145, kind: 'impact', text: 'A small share of searches started failing. Not enough to look like an outage.' },
        { atSec: 240, kind: 'change', text: 'The update reached half of the servers, and more customers saw errors.' },
        { atSec: 330, kind: 'change', text: 'The update reached every server.' },
        { atSec: 480, kind: 'response', text: 'The team traced the errors to the update and undid it.' },
      ],
    },
    choices: [
      { id: 'rollback', label: 'Undo the software update', description: 'Put the previous version of the recommendations service back.', build: () => [{ kind: 'rollback_deployment', service: 'recommendations-svc' }] },
      { id: 'isolate', label: 'Show search without recommendations', description: 'Skip the failing recommendations step; search results still load.', build: () => [{ kind: 'isolate_dependency', from: 'search-svc', to: 'recommendations-svc' }] },
    ],
    annotations: [
      { atSec: 330, author: 'on-call (synthetic)', body: 'Slow-burn error budget alert on search. No obvious spike in dashboards.', kind: 'note' },
      { atSec: 420, author: 'on-call (synthetic)', body: 'Errors started right after the recommendations v3.2.0 deploy. Only some requests.', kind: 'hypothesis' },
    ],
    scenario: {
      id: 'silent-deployment',
      name: 'The Silent Deployment',
      durationSec: 600,
      seed: 3301,
      sampleMs: 1000,
      timeline: [
        { atSec: 90, label: 'Deploy recommendations-svc v3.2.0 (canary 25%)', origin: 'scenario', category: 'deploy', deploymentId: 'recommendations-svc@v3.2.0', change: { kind: 'set_service', service: 'recommendations-svc', patch: { errorRate: 0.008, latencyMultiplier: 1.05, version: 'v3.2.0' } } },
        { atSec: 240, label: 'Deploy recommendations-svc v3.2.0 (rollout 50%)', origin: 'scenario', category: 'deploy', deploymentId: 'recommendations-svc@v3.2.0', change: { kind: 'set_service', service: 'recommendations-svc', patch: { errorRate: 0.017, latencyMultiplier: 1.1 } } },
        { atSec: 330, label: 'Deploy recommendations-svc v3.2.0 (rollout 100%)', origin: 'scenario', category: 'deploy', deploymentId: 'recommendations-svc@v3.2.0', change: { kind: 'set_service', service: 'recommendations-svc', patch: { errorRate: 0.034, latencyMultiplier: 1.15 } } },
        { atSec: 480, label: 'Roll back recommendations-svc to v3.1.4', origin: 'scenario', category: 'rollback', change: { kind: 'set_service', service: 'recommendations-svc', patch: { errorRate: 0, latencyMultiplier: 1, version: 'v3.1.4' } } },
      ],
      model: {
        entry: 'web-frontend',
        networkMs: 1,
        clientTimeoutMs: 4000,
        clientRetry: retry(1, 0),
        rateLimitRps: null,
        traffic: [
          { atSec: 0, rps: 40 },
          { atSec: 200, rps: 55 },
          { atSec: 350, rps: 70 },
        ],
        services: [
          service('web-frontend', 'edge', { capacity: 300, serviceTimeMs: 3, timeoutMs: 3000 }),
          service('search-svc', 'service', { capacity: 80, serviceTimeMs: 9, timeoutMs: 1200 }),
          service('search-index', 'database', { capacity: 40, serviceTimeMs: 7 }),
          service('recommendations-svc', 'service', { capacity: 60, serviceTimeMs: 11, timeoutMs: 800, version: 'v3.1.4' }),
          service('feature-store', 'cache', { capacity: 120, serviceTimeMs: 2 }),
        ],
        calls: [
          { from: 'web-frontend', to: 'search-svc' },
          { from: 'search-svc', to: 'search-index' },
          { from: 'search-svc', to: 'recommendations-svc' },
          { from: 'recommendations-svc', to: 'feature-store' },
        ],
      },
    },
  }
}

export const DEMO_SCENARIOS: DemoScenario[] = [checkoutCascade(), retryStorm(), silentDeployment()]

export function demoScenario(slug: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((d) => d.slug === slug)
}
