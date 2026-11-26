# Testing

## Engine unit tests (Vitest)

```bash
npm run test:engine        # 88 tests, ~11 s
npm run typecheck:engine   # tsc with lib ES2022 only (no DOM)
```

| Suite | What it proves |
| --- | --- |
| `normalize/normalize.test.ts` | Timestamp parsing (offsets, epoch units, ns precision, CLF, RFC 2822, syslog, invalid dates); every parser on fixtures with malformed timestamps, duplicates, unsorted lines, missing fields, invalid input; redaction; limits; cancellation; idempotent ids; 20,000-record performance. |
| `correlate/correlate.test.ts` | Dependency and trace signals, parent-span strength, no backward or temporally invalid edges, proximity is not evidence, determinism, top-K, weight validation, noisy-OR monotonicity, bounded candidate work, deploy ranked first for the Checkout Cascade. |
| `replay/replay.test.ts` | Health derivation over time, inclusive boundaries, determinism, backward seeking, order independence, empty timelines, checkpoint vs full-replay equivalence at random times, keyframes, late-arriving events. |
| `simulate/simulator.test.ts` | Reproducibility, queue overflow, cascading failure, retry amplification, circuit breakers, rate limiting, zero traffic, event cap, model validation (cycles, unknown entry); branches keep the original immutable and the prefix identical; rollback before a deploy removes it; capacity changes; a worse intervention is reported as worse; isolation; every lab template is valid; derived models disclose assumptions. |
| `reports.test.ts` | Synthetic incidents are reproducible and round-trip through the JSONL fixture format; postmortems never promote unconfirmed hypotheses and include every section; analytics denominators and insufficient-data handling. |

Fixtures live in `packages/engine/fixtures/`.

## Schema tests

`src/schemas/faultline-schemas.test.ts` runs the SDK's `lintSchema` on every collection and asserts the access invariants: no client writes to workspace-scoped rows, `'team'` reads for members and admins, no anonymous access, personal lab scenarios.

## Usability acceptance tests (standalone build)

`tests/standalone/usability.spec.ts`, run with `npm run test:usability`. Eleven tests that use the app the way a first-time visitor would, asserting through roles and visible text rather than CSS selectors:

- landing to examples without an account, with the synthetic label visible;
- the four guided steps, ending in a verdict computed by a real simulation;
- switching between Guided and Engineering modes;
- operating the Faultline Timeline with the keyboard alone (End, Home, Shift+Arrow);
- running an experiment in the lab;
- the privacy and security pages linked from the footer;
- no sideways scrolling at 390 px on five pages.

It targets the live site by default (`FAULTLINE_URL` overrides). CI builds the commit, serves it with `vite preview`, and runs the suite against that build. The suite was mutation-checked: changing an expected string makes it fail. It complements, and does not replace, testing with real people.

## Platform tests (Playwright via `deepspace test run`)

`tests/smoke.spec.ts`, `tests/api.spec.ts`, and `tests/collab.spec.ts` run against the local DeepSpace runtime with real services and the SDK's multi-user fixture. On this project's development machine Playwright runs through a Docker relay (headless Chromium inside a Linux container) because host Chromium crashes the Windows kernel; the `PW_TEST_CONNECT_*` variables route `playwright test` there automatically.

```bash
npx deepspace test run       # smoke + api
npx deepspace test run e2e   # all specs, including two-user collaboration
```

See `docs/HUMAN-VERIFICATION.md` for what has and has not been run against the deployed app.
