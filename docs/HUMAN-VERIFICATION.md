# Human verification

What a person has verified, and what still needs a person. Automated checks (tests, type checking, linting, scanners, scripted browsers) are listed separately. They don't replace human review or real usability testing.

**Status as of 2026-11-26: no item below has been verified by the owner or any other person yet.** (The owner did sign in to DeepSpace and to the live app so the agent could test the authenticated workflow. That was access, not verification.) Tick items only after doing them yourself, and add your name and the date.

## Automated checks that were run (by the agent)

| Check | Result |
| --- | --- |
| Engine unit tests (`npm run test:engine`) | 103 passing |
| Server, schema, SDK-usage, presence and deploy-script tests | 34 passing (includes the role matrix through the real action code and the presence gate) |
| Live DeepSpace app, agent-driven as the signed-in owner | Real upload → background job → persisted investigation; reload persistence; two-session live sync; simulation on the imported incident; empty and malformed files handled; storage forgeries and cross-user file access refused (details in FINAL-RELEASE-AUDIT.md) |
| Type checking (app and engine) | Clean |
| ESLint | Clean |
| Standalone production build | Builds |
| Semgrep (local container) | Findings fixed. One known parse error in the scaffold's `prerender.test.ts` |
| gitleaks over full history | No leaks |
| `npm audit` | 1 low-severity advisory (esbuild, development only) |
| Live Vercel site in Chrome (agent-driven) | Landing, guided demo, engineering mode and lab worked. No console errors on the pages checked |
| Usability acceptance suite (`npm run test:usability`, 11 tests) | Passing against the live site, and in CI against each commit's build. Mutation-checked: a wrong expectation fails |
| axe-core 4.10 (WCAG 2.1 A/AA + best practice) on landing, examples, guided demo, engineering mode, lab, docs | 0 violations after fixes. Automated rules catch only part of WCAG; screen-reader testing has not been done |
| Containerized Playwright at 1920, 1440, 1280, 768 and 390 px | Screenshots in `docs/screenshots/`. No horizontal overflow at 390 or 768 px on the pages measured |

**Not run:** the DeepSpace Playwright suites (`smoke`, `api`, `collab`, and the three-account `authz` spec), which need DeepSpace test accounts the owner creates. No Lighthouse or performance benchmark has been run, so none is quoted anywhere.

## Owner checklist

A short, practical list. Tick each item only after you have done it yourself.

### Use it
- [ ] Open https://faultline.app.space and https://faultline-coral.vercel.app on your laptop and your phone.
- [ ] Complete the public demo (all four guided steps) for one example.
- [ ] Run a what-if yourself: change the decision or its timing, run it, and read the comparison.
- [ ] Explain in your own words the difference between what was **observed** (imported logs), **inferred** (ranked causes), and **simulated** (what-if results), and point to where the UI labels each.

### Understand the code (open each file)
- [ ] Replay engine: `packages/engine/src/replay/replay.ts` (binary search plus checkpoints every 256 events).
- [ ] Correlation engine: `packages/engine/src/correlate/correlate.ts` (candidate windows, noisy-OR, time decay).
- [ ] Simulation engine: `packages/engine/src/simulate/simulator.ts` and `interventions.ts` (event heap, seeded RNG, branching, `compareRuns`).
- [ ] Storage ownership fix: `src/server/keys.ts` and `keys.test.ts`. Explain why a substring check was unsafe.
- [ ] DeepSpace integrations: trace one upload from `NewIncidentPage.tsx` → `registerSource` → `src/jobs.ts` / `src/server/ingest.ts` → records.

### Change something
- [ ] Make one small code change with its test, for example one of the five exercises in [INTERVIEW.md](INTERVIEW.md), and get `npm run test:engine` passing.

### Watch someone else
- [ ] Watch at least one person who wasn't involved use the demo without help. Note where they hesitate. Record the findings below (no names needed).

### Owner-controlled release steps
- [ ] Create three DeepSpace test accounts and run `npx deepspace test run tests/authz.spec.ts`. Record the result in the log below.
- [ ] Email security@deep.space asking them to revoke the exposed `APP_IDENTITY_TOKEN` and `APP_OWNER_JWT`s for app `app_01M8D1XKCZTT0XPX2XRMPPZR22` and issue replacements (exact request in FINAL-RELEASE-AUDIT.md). Record their confirmation below.
- [ ] Review and send `docs/DEEPSPACE-SUBMISSION.md`.

## Log

| Date | Who | What was verified | Notes |
| --- | --- | --- | --- |
| | | | |
