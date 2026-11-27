# Final release audit

Date: 2026-11-26 (UTC-8). Auditor: the coding agent (Claude Code), working in the owner's repository. Everything below was observed by running commands or driving the live sites; nothing is carried over from earlier summaries without being re-checked.

## Deployments

| Target | URL | State |
| --- | --- | --- |
| DeepSpace (full app) | https://faultline.app.space | Live. App `app_01M8D1XKCZTT0XPX2XRMPPZR22`, source latched to GitHub `shikharsisodia7/faultline`. Each release deployed from a clean, committed `main` (`dirty: false`) |
| Vercel (standalone demo) | https://faultline-coral.vercel.app | Live. Existing project `faultline` reused (no new project). Built with `VITE_CANONICAL_URL=https://faultline.app.space`, so Sign in and "full app" links go to the live DeepSpace app |
| GitHub | https://github.com/shikharsisodia7/faultline | Public, `main` |

`faultline.vercel.app` belongs to another account, which is why Vercel assigned `faultline-coral`.

## DeepSpace authentication

- The earlier failure (`Browser login needs an interactive terminal`) came from running `npx deepspace auth login` through Claude Code's `!` prefix, which is not a TTY. That `!` run also executed from the memory directory rather than the project, which is why npx downloaded `deepspace@0.44.2` instead of using the project's installed copy. The project's lockfile pins the same version, and it was not upgraded.
- Resolved by opening a real PowerShell window in the project folder, where the owner completed browser OAuth. `npx deepspace auth whoami` then reported a `developer` account on the production issuer.
- No password, token or session file was requested, printed, logged or committed.

## Registration and deploy

- `wrangler.toml` still carried the scaffold placeholder `__APP_ID__`, so the first deploy refused (`placeholder_committed`). Following the CLI's documented workflow, `npx deepspace app init` registered the app once, and the id was committed (`Register app_01M8…`). No duplicate apps were created.
- `npx deepspace deploy` returned `url: https://faultline.app.space`, with `serving` and `dataPlane` both `confirmed`.

## Bugs found on the live platform and fixed

Both bugs blocked every signed-in user from importing evidence. Neither showed up in unit tests or the standalone build.

1. **Auth hook misuse.** `useAuth()` in deepspace 0.44.2 returns `{ isLoaded, isSignedIn, userId, sessionId }`. Six call sites cast it to `{ user?: … }`, which hid the type error, so `user.id` was always undefined and the workspace list was always empty. Fixed by using `useAuth().userId` and `useAuthUser()`. The regression guard `src/lib/sdk-usage.test.ts` fails while any auth hook result is type-cast; it was verified failing before the fix.
2. **Immutable team field.** `newWorkspace` created a workspace with `workspaceId: 'pending'` and then patched it. The RecordRoom refuses that for an immutable column, failing with "Cannot modify immutable field 'workspaceId'". Fixed by choosing the id first. `ensureWorkspace` also removes the caller's own half-created rows. The regression test `src/server/actions.test.ts` reproduced the exact production error, then passed after the fix. An audit of every update path found no other write to an immutable column.

Smaller fixes: the report heading still said "Postmortem" (now "Incident report", pinned by a test), and the page title and description carried the old positioning.

## Native DeepSpace integrations, verified on the live platform

| Integration | Source | Why Faultline needs it | How it was tested | Result |
| --- | --- | --- | --- | --- |
| Authentication (OAuth) | `src/pages/(app)/_layout.tsx`, `useAuth` / `useAuthUser` | Private incidents and per-user files | Owner signed in on faultline.app.space; Home greets the user; actions reject anonymous and forged (`alg: none`) tokens with 401 | Pass |
| RecordRoom persistence | `src/schemas/faultline-schemas.ts`, `src/actions/index.ts` | Incidents, events, hypotheses, reviews, jobs | Imported incident persisted with 6 events, 5 services and 5 hypotheses; a hypothesis review survived a cold reload | Pass |
| Real-time sync | `useQuery` subscriptions | Shared investigations | Rejected a hypothesis in one tab; a second tab showed it within 4 s without reloading | Pass (same account, two sessions) |
| R2 file storage (`scope: self`) | `NewIncidentPage.tsx` (`useR2Files`), `src/server/keys.ts` | Raw evidence stays private and out of records | Real upload stored at `apps/<appId>/users/<userId>/…`; anonymous read, list, delete and upload refused (401); another user's file refused with a valid token (403); listing is confined to the caller's folder; public scope holds 0 files | Pass |
| JobRoom background jobs | `src/jobs.ts`, `worker.ts` | Import outlives the request; staged progress | The wizard showed the stages through to completion; the Sources panel shows "Imports completed, attempt 1: 6 events added, 0 correlations, 5 hypotheses" | Pass |
| Server actions + role checks | `src/actions/index.ts`, `src/server/domain.ts` | The only write path; default-deny | Live: 11 storage-key forgeries refused. In CI: the full role matrix through the real action code (`actions.test.ts`) | Pass (live, single account). Multi-account live run pending |
| Presence | `usePresenceRoom` in `src/features/cloud/useCloudIncident.ts` | Who else is looking | Not separately verified in this audit | Unverified |
| External integrations (Anthropic, GitHub, Exa via the integration proxy) | `src/server/integrations.ts`, `src/integrations.ts` | Optional AI summary, commit import, remediation search | Not exercised: they are off unless the owner sets `FAULTLINE_INTEGRATIONS=enabled`, and calls are billed to the owner's DeepSpace credits. The owner has not authorized charges | Implemented, disabled, unverified |

The original exercise **requires** the six native primitives (records and sync, R2 storage, JobRoom, auth, server-enforced permissions, deployment). It asks for three external integration-proxy endpoints only "if the exercise requires" them. Six native integrations are verified working above; the external ones are not counted.

## Storage ownership (commit 48ad288 and later hardening)

- Real key format, observed from a live `scope=self` upload: `apps/app_01M8D1XKCZTT0XPX2XRMPPZR22/users/<userId>/<name>`. The platform uses the app **id**, not the name, which is exactly the prefix `isOwnPrivateKey` anchors to. The validator needed no change. A regression test pins this shape and rejects app-name and case variants.
- Refused live through `registerSource` with the owner's real token, all with `forbidden`: another user's folder, nested-prefix injection, a user id that is only a prefix, cross-app, app name instead of id, `%2F` traversal, double encoding, `..`, Unicode slash look-alike, and a NUL control character. An empty key was refused as `invalid`.
- The validator was not weakened. The original substring issue was never tested against the live platform before it was fixed, so it is not described as "unexploitable".

## Multi-account authorization

- **Server logic (CI, every commit):** outsiders are refused everywhere and get `not_found` for incidents, so they can't even confirm one exists. Viewers are read-only. Collaborators can contribute but not manage members. Removal revokes access. Mutation-checked: allowing viewers to annotate makes the suite fail.
- **Live platform with three accounts:** `tests/authz.spec.ts` is written (direct action calls with each account's own token, rendered access, revocation, storage forgeries, demo immutability) and **has not run**. DeepSpace test accounts are created with a password through DeepSpace's hosted account service, which the agent does not do on the owner's behalf. This machine has 0 usable test accounts. Owner action: create three, then run `npx deepspace test run tests/authz.spec.ts`.

## Security scans

| Scan | Result |
| --- | --- |
| Semgrep 1.141.0 (`p/default`, `p/github-actions`, `p/secrets`) over the whole repo | 0 findings. One partial parse of the scaffold's `prerender.test.ts` |
| Semgrep Guardian (live, while files were written) | 5 findings reported during development, all fixed: `insecure-object-assign` (fixed in 35564f4), `unsafe-formatstring` in `src/vercel/main.tsx` (35564f4) and `scripts/screenshots.mjs` (c13f23a), `github-actions-mutable-action-tag` ×2 (9a5980d) |
| Semgrep Guardian hosted findings API | Holds 0 findings for this repository in any state. Guardian keeps per-scan records locally, so the "6 incomplete scans / 20 skipped files" counters cannot be itemized; the likely causes are the known partial parse and non-code files. Recorded as a limitation, not resolved |
| gitleaks 8.28.0, full history | No leaks |
| `npm audit` | 1 low advisory: esbuild dev server file read on Windows (GHSA-g7r4-m6w7-qqqr). Accepted: `npm audit fix` would *downgrade* esbuild below the SDK's range, and the code path is the local dev server only, never production |

Automated scanners finding nothing does not mean the application is secure.

### Finding: local DeepSpace credentials uploaded to Vercel (found and contained 2026-11-26)

- **What.** The gitleaks working-tree scan flagged `.dev.vars`, where the DeepSpace CLI writes the app's `APP_OWNER_JWT` (app-scoped, valid 10 years, can make owner-billed platform calls) and `APP_IDENTITY_TOKEN` (authenticates app-origin platform calls, including files). Both files are git-ignored and were never committed; the full-history scan is clean.
- **How it leaked.** `vercel deploy` uploads the project directory, and the project had no `.vercelignore`. Two CLI production deployments made after the app was registered carry `.dev.vars` in their private deployment source: `dpl_3oeZrNc8cSzAEZFbXXNsqcvqL74V` and `dpl_8LDryqTziH8FxfKJPne3fTLETHEh`. Vercel serves only `dist-vercel`, so the file was never publicly downloadable; it was visible to anyone with access to the owner's Vercel project. Git-built deployments have no uploaded source tree and are not affected. `.env.local` (Vercel's own OIDC token) was not uploaded.
- **Fixed.** `.vercelignore` excludes every local secret and tool-state file. The next deployment (`dpl_YWz1uGPBsHnSQXP84xDmHHuqWBg8`) was checked: 274 files, no `.dev.vars`.
- **Remaining (owner).** (1) Delete the two affected deployments. (2) Rotate the two credentials. The DeepSpace CLI has no rotation command for a regular app, and the documented `auth agent revoke` applies to agent accounts only, so ask DeepSpace support how to reissue `APP_OWNER_JWT` and `APP_IDENTITY_TOKEN` for app `app_01M8D1XKCZTT0XPX2XRMPPZR22`.
- **Also observed.** The Vercel project has a GitHub connection, so every push to `main` (including auto-checkpoint commits) triggers a production deployment built from the repository. Harmless for secrets, but it counts toward the account's deployment quota.

## Tests (final run)

| Suite | Count | Where it runs |
| --- | --- | --- |
| Engine unit tests | 103 passed (6 files) | Local and CI |
| Server, schema and SDK-usage tests | 21 passed (4 files) | Local and CI |
| Usability acceptance (browser) | 11 passed | CI against each commit's build; locally against the live site |
| axe-core accessibility | 0 violations on 6 primary pages | Live site |
| DeepSpace platform suites (smoke, api, collab, authz) | Not run | Need test accounts |

## Not verified

- The live three-account authorization run (above).
- Presence and collaborative editing on the live platform.
- External integrations (disabled, billing).
- Network-disconnection and session-expiry behavior.
- Report export downloads on the live app: not clicked, because downloading a file needs the owner's consent. The export code is the same client-side code verified in the demo.
- Human usability testing: none has happened.
