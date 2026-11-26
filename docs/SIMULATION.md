# Simulation methodology

Source: `packages/engine/src/simulate/`. Version `faultline-des/1.0.0`.

Faultline's counterfactuals come from a **seeded discrete-event simulation** (DES) of a simplified distributed system. Results are model estimates under explicit assumptions. They are never presented as predictions about a real system.

## Model

A `SimModel` is a directed acyclic call graph:

- **Services** with `capacity` (concurrent workers; a database's capacity is its connection pool), `queueCapacity`, mean `serviceTimeMs` (lognormal, `serviceTimeCv`), intrinsic `errorRate`, `latencyMultiplier`, `available`, the `timeoutMs` they apply to each downstream call, a `retry` policy, a caller-side `circuitBreaker` per dependency, and `contention` (latency growth under load).
- **Calls** `from → to`, made sequentially in declaration order. `optional` calls degrade instead of failing the caller; disabled calls are skipped.
- **Traffic**: piecewise-constant Poisson arrivals at the entry service; client timeout and client retry policy; optional token-bucket rate limit at the entry.

## Request lifecycle

1. A call arrives at a service. If the service is unavailable it fails immediately. If a worker is free it starts; otherwise it waits in the FIFO queue; if the queue is full it is rejected (`queue_full`).
2. Local processing time is sampled: `lognormal(serviceTime × latencyMultiplier × contention)`, where `contention = 1 + c × max(0, utilization − 0.7) / 0.3`.
3. The intrinsic error rate is applied.
4. Each dependency is called in turn **while the worker stays busy**. This is synchronous RPC, and it is what lets a slow database exhaust its callers.
5. Each downstream call has a caller-side timeout. **A timeout does not cancel the callee**: the work continues as zombie load, which is how retries amplify an overload.
6. Failures retry per the caller's policy (`maxAttempts`, exponential backoff, jitter). An open breaker fails fast without calling. After retries, a required dependency failure fails the caller; an optional one is skipped.
7. The worker is released, the next queued call starts, and the response travels back after `networkMs`.

**Circuit breakers** count outcomes per caller→callee pair in a sliding window; they open at `failureRateThreshold` after `minRequests`, stay open for `openMs`, then allow one half-open probe.

## Determinism

- All randomness comes from one seeded `sfc32` generator. `Math.random` is never used.
- The scheduler is a binary heap ordered by `(time, seq)`, where `seq` is an insertion counter. Events at the same instant always run in scheduling order.
- Trace and span ids are counter-hashed, not drawn from the generator, so enabling telemetry does not change a run.
- `runSimulation(scenario)` is a pure function: a test asserts deep equality between two runs.

## Counterfactual branches

`branchScenario(scenario, atSec, interventions)` returns a new scenario. The original timeline object is never mutated. Interventions compile to scheduled model changes at `atSec`:

| Intervention | Effect |
| --- | --- |
| Roll back deployment | Restores every parameter the most recent deployment of that service changed (all parts sharing its deployment id) to pre-deployment values. A deployment that had not happened yet is removed. |
| Scale capacity / resize pool | Sets workers or connections; queued work is admitted immediately. |
| Circuit breaker | Enables or disables the caller's breakers with a threshold and open time. |
| Rate limit | Token bucket at the entry; rejections are counted as failures. |
| Retry policy | Attempts and backoff for a service or for clients. |
| Isolate dependency | Disables a call edge; the caller serves without it. |
| Recover service | Restores availability, error rate, and latency to baseline. |

Because both runs consume identical randomness until `atSec`, every sample before the branch point is identical. The comparison verifies this and shows the result in the UI.

## Outputs

Per second: requests, successes, failures, rate-limited, error rate, p50/p95 latency, retries, timeouts, and per-service busy workers, queue depth, completions, and failures.

Summary: success and error rate; p50/p90/p95/p99/mean latency and a histogram; peak error rate and when it occurred; onset (first second above 5% errors); time to recovery (from onset to the start of 30 consecutive seconds at or below 5%), or "not recovered"; retries, timeouts, breaker openings; affected services (above 20% failures in some second with at least 5 calls).

`compareRuns` reports each metric's delta and verdict, plus an overall verdict across success rate, failed requests, p95, and peak error rate. An intervention that makes things worse is reported as worse. A test proves this with a shrunken connection pool.

## Synthetic incidents

The demo incidents are produced by running a scenario with telemetry enabled and converting what actually happened (failed calls, timeouts, retries, queue rejections, breaker transitions, scheduled changes) into log events, capped at 2 per service, kind, and second. Pool saturation, SLO alerts (rolling-window rule per scenario), and recoveries are derived from the per-second samples. Logs, traces, alerts, and the counterfactual baseline therefore agree by construction.

## Imported incidents

For real evidence, `deriveScenarioFromIncident` builds a model from the observed topology with documented defaults (40 rps, default capacities and service times). It models each deploy that preceded an increase in that service's error-event share as an intrinsic error rate. Every one of these assumptions is listed next to the results. Treat such counterfactuals as hypothetical.

## Known simplifications

- One request type; no request mix or payload sizes.
- Network latency is constant per hop; no packet loss or partitions.
- No autoscaling unless scheduled; no cold starts or warm-up.
- Timeouts never cancel downstream work, which is pessimistic for systems with deadline propagation.
- Queue discipline is FIFO; there is no load shedding inside services beyond queue limits.
