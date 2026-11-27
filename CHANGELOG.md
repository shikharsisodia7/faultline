# Changelog

All notable changes to this project. Dates are UTC-8.

## Unreleased: release candidate for 1.0.0

Not tagged: the live three-account authorization run is still pending (see docs/FINAL-RELEASE-AUDIT.md).

### Added
- Full app deployed to DeepSpace: https://faultline.app.space. The Vercel demo links to it.
- `tests/authz.spec.ts`: owner / collaborator / outsider through direct action calls on the DeepSpace runtime (needs test accounts).
- Role-matrix and workspace-creation tests through the real action code, with an in-memory RecordRoom that enforces immutable columns.
- Regression test pinning the real platform storage-key format.
- Reproducibility test for the timeout what-if.
- docs/FINAL-RELEASE-AUDIT.md and docs/DEEPSPACE-SUBMISSION.md; interview guide expanded with five live coding exercises.

### Security
- Presence rooms admitted anonymous sockets and exposed viewers' ids and names (found on production). They now require a verified token and workspace membership; 4 tests.
- Deployment preflight (`scripts/deploy-preflight.mjs`) blocks secret-bearing files, runs in CI, and is used by the tracked-source-only manual deploy script.
- The two Vercel deployments whose source held `.dev.vars` were deleted. Credential rotation is pending with DeepSpace.
- SonarCloud `S4036` findings in the new scripts fixed in code (fixed `PATH` for git; no CLI launch from the deploy script).

### Changed
- Production builds skip autosave commits and commits that touch no build input (`vercel.json` `ignoreCommand`).
- Report exports are named `incident-report-*`; app header and navigation no longer print into the PDF.

### Fixed
- Signed-in users never got a workspace (found on the live platform): auth hook results were type-cast to a shape the SDK doesn't return. Now uses `useAuth().userId` / `useAuthUser()`, with a guard test against such casts.
- Workspace creation patched an immutable team field, which the platform refuses. The id is now chosen up front, and the caller's half-created rows are cleaned up.
- Report heading and export say "Incident report"; page title and description use the current positioning.

## 0.2.0: product redesign (2026-11-25)

### Added
- New positioning and landing page ("The flight recorder for software"), with a live simulated online store in the hero and an interactive what-if section.
- Guided demo in four steps (What happened? / Why did it happen? / What if? / Compare outcomes), sharing state with the engineering workspace through Guided and Engineering modes.
- Faultline Timeline: a branching timeline component with keyboard controls and reduced-motion support.
- App navigation (Home, Investigate, Experiment, Reports), with new Home and Reports pages.
- Four-step import flow with a dry-run preview, downloadable sample files, live background-job stages and retry.
- Experiment lab simple mode: familiar systems and failure drills with plain-language guides and one-click events. The full editor moved under Advanced settings. New banking template.
- `set_timeout` intervention ("Change timeout"), with tests.
- Privacy, Security and About pages in the in-app docs.
- Screenshot, preview-image and demo-recording scripts (`scripts/screenshots.mjs`, `render-og.mjs`, `record-demo.mjs`), all run through the Playwright relay.
- Demo GIF in the README, recorded from the live site.

### Changed
- Light-first visual design and new brand mark. The previous dark theme is kept as an alternative.
- Plain-language terminology throughout (for example, Postmortem became Incident report and Chaos lab became Experiment lab).
- Standalone build is code-split by route. The initial bundle dropped from 742 kB to 568 kB.
- Full-app links in the standalone build appear only when a verified `VITE_CANONICAL_URL` is set.

### Fixed
- Horizontal overflow on phones and tablets (hero diagram, docs, use-case tabs, problem section) and overlapping panels in the lab on phones.
- `.gitignore` ordering that would have ignored `.env.example`.

### Security
- Private file keys must match the anchored prefix `apps/<appId>/users/<userId>/`. Encoded, double-encoded, Unicode look-alike and control characters, traversal and empty segments are rejected (`src/server/keys.ts`, with tests).
- Allow-listed patch assignment in the simulator, plus null-prototype parsing of key-value logs (prototype-pollution hardening).
- Realtime document routes fail closed.

## 0.1.0: first build (2026-11-25)

- Engine: normalization, correlation and hypotheses, replay, discrete-event simulator, interventions and branching, reports, analytics.
- DeepSpace app: workspaces and roles, incidents, private uploads, background ingestion jobs, notes, decisions, presence.
- Standalone demo build for Vercel.
