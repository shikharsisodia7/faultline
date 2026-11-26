# Replay

Source: `packages/engine/src/replay/replay.ts` (engine) and `src/features/workspace/useReplayController.ts` (presentation).

## Separation of concerns

- **Replay state** is owned by `ReplayEngine`: a pure function of an immutable, canonically ordered event list and a query time.
- **Presentation state** (playhead, playing, speed) is owned by a React hook. It only decides *which* time to ask the engine about.

The graph, the timeline, the inspector, and the service list all read the same `ReplayState` for the same playhead, so they cannot disagree.

## State derivation

The reducer `applyEvent(acc, e)` folds one event into per-service accumulators: totals, a bounded ring of recent error timestamps (256), last error/warning/critical/recovery times, current deployment id, and breaker state. Alerts accumulate in an active list.

Health is then derived for the query time `t` by `deriveHealth(acc, t)`:

| Health | Rule (defaults) |
| --- | --- |
| `recovering` / `healthy` | a recovery event after the last error (recovering for 30 s after it) |
| `failing` | ≥ 3 errors in the last 30 s, or a critical event in the last 30 s |
| `degraded` | any error in the window, an open breaker, or a warning in the last 30 s |
| `recovering` | the last error was within 90 s |
| `healthy` | otherwise |

Because health depends on `t` and not only on which events were applied, a service correctly fades from failing to recovering to healthy during a quiet stretch.

## Seeking

- A `Float64Array` of timestamps supports binary search: `indexAt(t)` is the number of events with `ts ≤ t` (inclusive boundary).
- A checkpoint of the accumulators is stored every 256 events. `stateAt(t)` clones the nearest checkpoint and applies at most 255 events.
- Seeking backward is the same operation as seeking forward; there is no mutable cursor to rewind.

Tests prove that a checkpointed seek equals a full replay from the start at 60 random times over 3,000 random events, that repeated replays are identical, that input order does not matter, that an empty timeline works, and that the boundary is inclusive.

## Navigation

- `stepForward` / `stepBackward` move to the next or previous distinct event timestamp.
- **Keyframes** are deploys, rollbacks, config changes, alerts, scaling, recoveries, the first error per service, and the first saturation/queue-overflow/breaker event per service per minute. `nextKeyframe` / `prevKeyframe` jump between them.
- Bookmarks are stored by the workspace adapter (browser-local in the demo, DeepSpace records in the app).

## Late and out-of-order evidence

The engine sorts defensively on construction. `withEvents(incoming)` returns a **new** engine with the merged, re-sorted evidence; the original is unchanged. Imports therefore never rewrite history in place.

## Playback

Playback advances the playhead by `realElapsed × speed` on each animation frame (speeds 1x–60x). With `prefers-reduced-motion`, CSS transitions are disabled; playback remains available because it is user-initiated.
