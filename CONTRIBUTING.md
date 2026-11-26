# Contributing to Faultline

Thanks for taking a look. Issues and pull requests are welcome.

## Setup

```sh
npm install
npm run dev:standalone   # standalone demo, no account needed
```

The full app runs on DeepSpace (`npx deepspace auth login`, then `npm run dev`).

## Before you open a pull request

```sh
npm run test:engine
npm run typecheck:engine
npm run type-check
npm run lint
npm run build:vercel
```

All of these run in CI. Server and schema tests:

```sh
npx vitest run src/lib src/server src/schemas
```

## Ground rules

- **No fake results.** Every number shown in the UI must come from the engine. Never hard-code a favorable outcome. If a change makes things worse, the UI must say so.
- **Label synthetic data.** Anything generated rather than imported carries a synthetic label.
- **Keep the engine dependency-free and deterministic.** Use the seeded `Rng` (`packages/engine/src/util/rng.ts`), never `Math.random()`, in anything that affects results.
- **Permissions live on the server.** Collection roles and server actions enforce access. A hidden button is not a permission check.
- **Private evidence stays private.** It is never sent to an external service unless the workspace owner has turned integrations on, and the UI discloses it.

## Adding an intervention

`docs/INTERVIEW.md` walks through a real example (`set_timeout`): the union member, label, description, compiler case with a stated assumption, editor fields, and the tests to write first.

## Commit style

Short imperative subject with a conventional prefix (`feat`, `fix`, `docs`, `test`, `chore`), and a body explaining why.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
