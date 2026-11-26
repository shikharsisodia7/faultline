# Deployment

## DeepSpace (canonical)

Prerequisites: Node 22.15+/24/26, npm 11.6+, a DeepSpace account.

```bash
npm install
npx deepspace auth login          # browser OAuth; run it in an interactive terminal
npx deepspace auth whoami         # confirm the intended owner before the first deploy
npx deepspace deploy              # builds with Vite, registers the app on first use, deploys
npx deepspace logs --follow       # watch the worker
```

Notes:

- The app registers on its first id-needing command, under whichever account the shell is logged into.
- This repository has a GitHub remote, so the first deploy latches **GitHub source** permanently: deploys ship the local working tree. Commit and push to GitHub as the source of truth; never run `deepspace push`.
- File uploads require the `APP_IDENTITY_TOKEN` minted at first deploy. Locally, `npx deepspace dev start` provisions it into `.dev.vars` once the app has been deployed.
- External integrations stay off until the owner opts in:

  ```bash
  npx deepspace secrets set FAULTLINE_INTEGRATIONS enabled
  ```

  They bill the owner's DeepSpace credits. Check `npx deepspace app usage` first.

## Vercel (standalone demo)

```bash
npm run build:vercel              # vite build --config vite.vercel.config.ts → dist-vercel/
vercel deploy --prod              # uses vercel.json (static output + SPA rewrites)
```

`vercel.json` points the build at `dist-vercel` and rewrites client routes to `index.html`. The build contains no secrets and makes no network calls beyond loading its own assets.

## Verification checklist

After every deploy, open the deployed URL and check: the landing page renders, `/demo/checkout-cascade` replays, a simulation runs, and the postmortem exports. On DeepSpace, also sign in, create an incident, upload `packages/engine/fixtures/mixed.jsonl`, and watch the import complete. The current verification status is recorded in `docs/HUMAN-VERIFICATION.md` and the README.
