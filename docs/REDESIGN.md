# Faultline v2 redesign

Working inventory and checklist for the product redesign. A box is checked only when the change exists in the repository and was looked at in a real browser.

## Starting point (audited 2026-11-25, commit 48ad288)

| Area | State before the redesign |
| --- | --- |
| Engine (`packages/engine`) | Working. 88 unit tests pass. Normalization, correlation, hypotheses, replay, simulation, scenarios, postmortem, analytics. |
| Security fix 48ad288 | Present: `src/server/keys.ts` anchors keys to `apps/<appId>/users/<userId>/`; 6 tests. `appId` comes from `env.DEEPSPACE_APP_ID`, `userId` from the verified JWT (`ActionContext.userId`), never from the request body. |
| Public demo | Working in the standalone build: dark, four-panel engineering workspace. Functional but dense and technical. |
| Chaos lab, compare, analytics, docs | Working in the standalone build. |
| DeepSpace data layer, actions, ingestion job, collaboration | Written and type-checked; not yet run on the platform (blocked on `npx deepspace auth login`). |
| Deployments | None yet. |
| Background shells | (1) 10-minute auto-commit/push loop; (2) standalone Vite dev server on 127.0.0.1:5190. Both left running. |
| Checks | `npm run test:engine` 88 passed; server/schema tests 10 passed; `tsc` clean; ESLint 0 errors; standalone build passes. |

## Design reference

LightSprint (lightsprint.ai) was inspected in Chrome at 1512 px (dark and light themes) on 2026-11-25. Measured: page background `rgb(245,243,240)`, headline color `rgb(44,42,38)`, h1 48 px at weight 400. Observed patterns: warm off-white surfaces with a faint grid; light-weight grotesk headlines with tight leading; monospace uppercase eyebrows; a single saturated accent CTA with a soft glow; product UI presented inside large rounded bezel frames over textured art; a scroll-linked step list; generous whitespace around a ~1,100 px column; footer with a large closing line and sitemap columns.

Limitation: the browser-automation window resize did not take effect (the viewport stayed 1536 px), so LightSprint's mobile layout could not be captured. Faultline's own mobile layouts are verified separately.

Faultline borrows principles, not assets: its texture is an original topographic "fault contour" drawing, its type is Geist (OFL), and its accent palette is terracotta/amber/sage.

## Checklist

- [x] Light-first design tokens; dark theme kept as an alternative (contrast-checked against WCAG AA)
- [x] Brand: wordmark, symbol, favicon, app icon, social image (og.png rendered with the site fonts)
- [x] Landing page rebuilt around the flight-recorder story
- [x] Interactive hero driven by the real simulator
- [x] Faultline Timeline (branching) component, keyboard-operable (covered by the usability suite)
- [x] Guided demo: What happened / Why / What if / Compare
- [x] Guided and Engineering modes sharing state
- [x] App navigation: Home, Investigate, Experiment, Reports (verified live on DeepSpace)
- [x] Guided import flow, four steps (verified live: real upload through to a persisted investigation)
- [x] Approachable experiment lab (simple mode + Advanced settings; banking template)
- [x] Copy and terminology pass
- [x] Security test expansion (`src/server/keys.test.ts`) and scan review (Semgrep, gitleaks)
- [x] Vercel deployment verified: https://faultline-coral.vercel.app (direct routes, refresh, desktop + phone)
- [x] DeepSpace deployment verified: https://faultline.app.space
- [x] Visual QA at 1920, 1440, 1280, 768, 390 (`docs/screenshots/`); axe-core: 0 violations on the six main pages
- [x] README, screenshots, demo GIF
- [ ] Usability testing with real people (not done; automated acceptance tests are not a substitute — see HUMAN-VERIFICATION.md)
