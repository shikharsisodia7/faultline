# Changelog

All notable changes to this project. Dates are UTC-8.

## Unreleased

Nothing yet.

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
- Screenshot script for the QA viewports (`scripts/screenshots.mjs`).

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
