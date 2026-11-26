# Correlation and root-cause ranking

Source: `packages/engine/src/correlate/`. Algorithm versions: `faultline-corr/1.0.0`, `faultline-rca/1.0.0`.

The correlation engine is deterministic and explainable. It does not use a language model. It produces **candidate relationships** between events and **ranked hypotheses** about initiating causes. Neither is proof of causation, and the UI says so.

## Which events participate

Events at or above `minSeverity` (default `warn`), plus events whose type is inherently interesting regardless of level: deploys, rollbacks, config changes, alerts, saturation, queue overflow, breaker transitions, scaling, recovery, timeouts, retries. Healthy `info` traffic does not create edges.

## Candidate generation (no all-pairs comparison)

For each destination event `d`, candidates come only from indexes, each lookup binary-searched to a bounded time window and capped at `maxCandidatesPerIndex` (12) most recent hits:

| Index | Window |
| --- | --- |
| parent span (`traceId:parentSpanId`) | any earlier position |
| same trace | `windowMs` (120 s) |
| same request | `windowMs` |
| same deployment id | `changeWindowMs` (900 s) |
| same service | `windowMs` |
| each service `d.service` depends on | `windowMs` |
| change events (deploy, config, rollback, scale) on the same service, a dependency, or the same deployment | `changeWindowMs` |

Work per event is therefore bounded by a small constant times `log n`. A test asserts that 4,000 events produce far fewer candidate pairs than the ~8 million an all-pairs scan would examine.

## Scoring

Each candidate pair `(s → d)` is checked for evidence signals:

| Signal | Default weight | Meaning |
| --- | --- | --- |
| `parentSpan` | 0.60 | `s` is the direct parent span of `d` |
| `sharedTrace` | 0.35 | same trace id |
| `sharedRequest` | 0.35 | same request id |
| `sharedDeployment` | 0.30 | same deployment id |
| `dependency` | 0.30 | `d.service` calls `s.service`, so a failure in `s` reaches `d` |
| `typeRelation` | 0.25 | `s.type → d.type` is a documented failure chain (e.g. saturation → timeout, timeout → retry, deploy → error) |
| `errorPropagation` | 0.15 | both are errors along a call path |
| `sameService` | 0.12 | same service |
| `severityEscalation` | 0.10 | severity rises from a warning or higher |

Signals combine by **noisy-OR**, then decay with the time gap:

```
evidence = 1 − Π (1 − w_i)            over present signals
score    = evidence × exp(−Δt / τ)     τ = 60 s, or 300 s when s is a change event
```

Properties that tests enforce:

- `score ∈ [0, 1]`; adding a signal or raising a weight can only raise a score.
- Proximity alone is not evidence: a pair whose only signal is `sameService` is discarded.
- Edges always point from an earlier position to a later one in the canonical order, so the graph is a DAG and no edge is temporally invalid.
- Pairs below `minScore` (0.12) are dropped; each event keeps its `topKIncoming` (3) strongest causes.
- The output is deterministic and carries the algorithm version and every parameter used.

Change events decay on the slower clock because a bad deploy's effects typically surface minutes later, when connection pools fill or a rollout widens.

**These scores are heuristic, not calibrated probabilities.** No calibration against labeled incidents has been performed, so the UI never presents them as percentages of likelihood.

## Hypothesis ranking

Candidates are anomalies (warn and above, plus deploys, config changes, saturation) that are not symptoms or fixes (`recovery`, `rollback`, `circuit_close`, `scale` are excluded). Each gets five factors in `[0, 1]`:

| Factor | Default weight | Computation |
| --- | --- | --- |
| influence | 0.35 | damped downstream sum over edges in one reverse pass of the DAG: `I(e) = Σ score · (1 + 0.5 · I(target))`, log-normalized |
| dependencyPosition | 0.20 | share of the other affected services that transitively depend on this service |
| originality | 0.15 | `1 −` strongest incoming edge: how unexplained the event is by anything earlier |
| precedence | 0.15 | earlier anomalies rank higher |
| typePrior | 0.15 | documented prior: deploy 1.0, config 0.95, saturation 0.7, error/latency 0.5, ... |

The weighted sum is normalized by the weight total. One hypothesis is kept per service (its best event). Each hypothesis lists supporting events (the strongest downstream chain) and plain-language reasons. Every hypothesis starts as **inferred**; only a human can mark one supported, rejected, or confirmed, and the postmortem never calls an unconfirmed hypothesis a root cause.

## Tuning

Weights and windows are parameters of `correlate(events, graph, overrides)` and `rankHypotheses(..., { weights })`. See the worked example in `docs/ENGINEERING-WALKTHROUGH.md` for changing a weight and updating its tests.
