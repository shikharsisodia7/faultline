# Human verification

What a person has verified, and what still needs a person. Automated checks (tests, type checking, linting, scanners, scripted browsers) are listed separately. They don't replace human review or real usability testing.

**Status as of 2026-11-25: no item below has been verified by the owner or any other person yet.** Tick items only after doing them yourself, and add your name and the date.

## Automated checks that were run (by the agent)

| Check | Result |
| --- | --- |
| Engine unit tests (`npm run test:engine`) | 102 passing |
| Server and schema tests | 13 passing |
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

**Not run:** DeepSpace smoke, API and collaboration suites (`npm test`), which need a DeepSpace sign-in. No Lighthouse or performance benchmark has been run, so none is quoted anywhere.

## Owner checklist

### Understand the code
- [ ] Read [ENGINEERING-WALKTHROUGH.md](ENGINEERING-WALKTHROUGH.md) end to end, opening each file it names.
- [ ] Make a small change yourself, test-first (for example, a new intervention following the worked example in [INTERVIEW.md](INTERVIEW.md)), and get the tests passing.
- [ ] Be able to explain noisy-OR scoring, checkpointed replay, and the prefix-identical check without notes.

### Product, in a browser
- [ ] Landing page on desktop and on your own phone: the hero simulation plays, the what-if pills change the outcome, and every nav and footer link works.
- [ ] Guided demo, all four steps, for each of the three example incidents.
- [ ] Switch to Engineering mode mid-demo and back; the state carries over.
- [ ] Experiment lab: pick a system, trigger an event, run, pin as strategy, change one thing, run, compare.
- [ ] Keyboard only: tab through the landing page and drive the Faultline Timeline with the arrow keys, Home, End and D.
- [ ] Reduced motion turned on in your operating system: animations stop or simplify.

### DeepSpace (after `npx deepspace auth login` and deploy)
- [ ] Sign in, create a workspace, import each sample file from the import flow, and open the investigation.
- [ ] Inspect a real upload's storage key and confirm it matches `apps/<appId>/users/<userId>/…`, the format `src/server/keys.ts` assumes.
- [ ] Two accounts: invite the second as a viewer and confirm it can read but not edit. Remove it and confirm access ends.
- [ ] An unrelated third account cannot see the workspace or its files.
- [ ] Kill an import mid-way (or upload a malformed file) and confirm the failure is shown and retry works.

### Usability (people other than the builder)
- [ ] Watch at least three people who weren't involved try the guided demo without help. Note where they hesitate. Record the findings here (no names needed).
- [ ] Ask a non-engineer to explain back what the what-if step showed them.

## Log

| Date | Who | What was verified | Notes |
| --- | --- | --- | --- |
| | | | |
