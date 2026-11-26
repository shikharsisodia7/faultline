import type { ScheduledChange, SimScenario } from '@faultline/engine'

/** Plain-language guide for each lab template (all supported by the model). */
export interface LabGuide {
  slug: string
  title: string
  what: string
  parts: string
  risks: string
  decisions: string
  group: 'system' | 'drill'
}

export const LAB_GUIDES: LabGuide[] = [
  { slug: 'ecommerce-checkout', group: 'system', title: 'Online store', what: 'Shoppers browse, add to cart, and pay.', parts: 'The website sends each order to checkout, which asks pricing (and its database), inventory, and the card processor.', risks: 'A slow pricing database or a struggling card processor holds up every order.', decisions: 'More database capacity, a circuit breaker, fewer retries, or limiting traffic.' },
  { slug: 'social-media', group: 'system', title: 'Social media app', what: 'People open the app and scroll their timeline.', parts: 'Each timeline is built from a fast cache and a posts database; photos come from a media service that is optional.', risks: 'If the cache or database slows down, every timeline waits.', decisions: 'Skip the optional media step, add capacity, or retry less.' },
  { slug: 'event-driven', group: 'system', title: 'Food delivery platform', what: 'Customers place orders that are queued and matched with couriers.', parts: 'Orders land in a queue; a fulfillment service picks them up and records them in the orders database.', risks: 'A lunch-hour burst fills the queue faster than orders can be processed.', decisions: 'More fulfillment workers, a bigger queue, or limiting new orders.' },
  { slug: 'ai-inference', group: 'system', title: 'AI chatbot', what: 'People ask questions and a model writes the answer.', parts: 'Each question is embedded, matched against a knowledge store, and answered by a model server that can only handle a few requests at once.', risks: 'The model server is the bottleneck: a few extra users create a long wait.', decisions: 'More model capacity, a rate limit, or shorter timeouts.' },
  { slug: 'banking', group: 'system', title: 'Banking application', what: 'Customers sign in and send money.', parts: 'Transfers are checked by an outside fraud service and written to a ledger database.', risks: 'If the fraud service stops responding, transfers pile up behind it.', decisions: 'A circuit breaker, a shorter timeout, or fewer retries.' },
  { slug: 'realtime-sports', group: 'system', title: 'Live sports app', what: 'Fans refresh scores during a match.', parts: 'A scores API reads from a stats service and its database.', risks: 'The final whistle sends four times the traffic in seconds.', decisions: 'Add capacity ahead of time, rate limit, or stop clients retrying instantly.' },
  { slug: 'pool-exhaustion', group: 'drill', title: 'Database runs out of connections', what: 'A slow query halves database throughput.', parts: 'An API calls an orders service that uses a small connection pool.', risks: 'Requests queue for a connection and time out.', decisions: 'A bigger pool, a breaker, or limiting traffic.' },
  { slug: 'retry-storm', group: 'drill', title: 'Retry storm', what: 'A dependency stalls for a minute.', parts: 'Clients and the cart service both retry instantly.', risks: 'Retries keep the system down after the dependency recovers.', decisions: 'Retry less, add backoff, or shed load.' },
  { slug: 'failed-deployment', group: 'drill', title: 'Bad software update', what: 'An update makes 15% of requests fail.', parts: 'An edge service in front of an API and its database.', risks: 'Errors climb as soon as the update ships.', decisions: 'Roll the update back.' },
  { slug: 'queue-backlog', group: 'drill', title: 'Queue backlog', what: 'Workers slow down and the queue grows.', parts: 'A producer writes into a queue that consumers drain.', risks: 'Once the queue is full, new work is rejected.', decisions: 'More consumers or a larger queue.' },
]

export type LabEvent = 'surge' | 'db_overload' | 'bad_update' | 'external_down'

export const LAB_EVENTS: Array<{ id: LabEvent; label: string }> = [
  { id: 'surge', label: 'Too many customers arrive' },
  { id: 'db_overload', label: 'A database becomes overloaded' },
  { id: 'bad_update', label: 'A software update introduces an error' },
  { id: 'external_down', label: 'An outside service stops responding' },
]

/** Compiles a plain event into scheduled model changes, or null if this system has no matching part. */
export function eventChanges(event: LabEvent, scenario: SimScenario): ScheduledChange[] | null {
  const m = scenario.model
  const at = Math.round(scenario.durationSec / 3)
  const db = m.services.find((s) => s.kind === 'database')
  const ext = m.services.find((s) => s.kind === 'external')
  const target = m.services.find((s) => s.kind === 'service' && s.id !== m.entry) ?? m.services.find((s) => s.id !== m.entry)
  switch (event) {
    case 'surge': {
      const rps = m.traffic[m.traffic.length - 1]?.rps ?? 50
      return [
        { atSec: at, label: 'Too many customers arrive (traffic x2.5)', origin: 'scenario', category: 'traffic', change: { kind: 'set_traffic', rps: Math.round(rps * 2.5) } },
        { atSec: at + 60, label: 'Traffic returns to normal', origin: 'scenario', category: 'traffic', change: { kind: 'set_traffic', rps } },
      ]
    }
    case 'db_overload':
      return db ? [{ atSec: at, label: `${db.id} becomes overloaded (queries 6x slower)`, origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: db.id, patch: { serviceTimeMs: Math.round(db.serviceTimeMs * 6) } } }] : null
    case 'bad_update':
      return target ? [{ atSec: at, label: `A software update to ${target.id} fails 15% of requests`, origin: 'scenario', category: 'deploy', deploymentId: `${target.id}@update-${at}`, change: { kind: 'set_service', service: target.id, patch: { errorRate: 0.15 } } }] : null
    case 'external_down':
      return ext ? [
        { atSec: at, label: `${ext.id} stops responding`, origin: 'scenario', category: 'outage', change: { kind: 'set_service', service: ext.id, patch: { latencyMultiplier: 40 } } },
        { atSec: at + 60, label: `${ext.id} recovers`, origin: 'scenario', category: 'recovery', change: { kind: 'set_service', service: ext.id, patch: { latencyMultiplier: 1 } } },
      ] : null
  }
}
