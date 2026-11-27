# Agent contributions

An honest account of how this repository was produced.

## Summary

All of the source code, tests, documentation, brand assets and configuration in this repository were written by an AI coding agent (Claude Code, running Anthropic's Claude models), working in the repository on the owner's machine. The owner wrote the product briefs that defined what to build, the constraints and the quality bar, and directed the work. Commits appear under the owner's Git identity because the agent ran in the owner's local checkout. Commits carry a `Co-Authored-By` trailer for the agent.

## What the owner provided

- Two written briefs: the original build directive and the V2 redesign directive. They set the product scope, positioning, copy direction, deployment targets and constraints (no fake data, no fabricated metrics, no purchases, privacy rules for uploaded evidence, security requirements).
- Accounts and environment: GitHub repository, Vercel account, local machine, and the DeepSpace account (sign-in still pending).
- Direction during the session, such as when to continue after interruptions.

## What the agent did

- Scaffolded the DeepSpace app from the official starter (`create-deepspace 0.44.2`) and read the SDK's installed types and docs before using its APIs.
- Designed and implemented the engine: normalization, correlation, hypotheses, replay, the discrete-event simulator, interventions, scenario generation, reports and analytics, with their unit tests.
- Built the React application, both builds (DeepSpace and standalone Vercel), the brand mark, and the light and dark design tokens.
- Implemented the server layer: schemas and roles, server actions, background jobs, private-file key checks, integrations gating.
- Ran security work: fixed findings from an automated security review (a substring key check, a fail-open realtime route), ran Semgrep and gitleaks locally, and hardened the code against prototype pollution.
- Deployed the standalone build to Vercel and checked it in a browser and with a containerized Playwright browser at five viewport widths.
- Wrote all documentation, including this file.

## Where the agent made mistakes (and fixed them)

The commit history is not squashed, so these remain visible:
- **Wrong SDK assumption, hidden by type casts.** Six call sites cast `useAuth()` to a shape the SDK doesn't return (`user.id`), which hid the error from the compiler. On the live app, no signed-in user got a workspace. Found by testing the real deployment, fixed, and guarded by a test that forbids such casts.
- **Patched an immutable column.** Workspaces were created with a placeholder team id and then updated, which the platform refuses. Found on the live app, and fixed with a regression test that reproduces the platform's rule.
- A shell edit wrote a literal line break into a test file. The test file silently dropped out of the run (103 tests became 84) until the agent noticed the count change.
- Early scenario tuning produced incidents that didn't cascade, or failed from the first second. Fixed by staging the rollouts and re-tuning capacities, with tests that check the story matches the run.
- The first private-file check was a substring match. Replaced with an anchored, normalization-aware check with exhaustive tests.
- Mobile layouts overflowed horizontally and the lab's panels overlapped on phones. This was found by measuring `scrollWidth` in a real browser, then fixed.
- `vercel link` appended a `.gitignore` rule that would have ignored `.env.example`. Fixed.

## What the agent could not do

- Sign in or create accounts on the owner's behalf. The owner completed the DeepSpace CLI OAuth and the app sign-in; the three-account suite waits on owner-created test accounts.
- Test with real users. No usability testing with people has happened (see [HUMAN-VERIFICATION.md](HUMAN-VERIFICATION.md)).
- Verify behavior of the hosted DeepSpace platform, such as the actual storage key format of uploads in production.
