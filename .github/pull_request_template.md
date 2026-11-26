## What and why

## How it was checked
- [ ] `npm run test:engine`
- [ ] Server and schema tests
- [ ] `npm run type-check` and `npm run typecheck:engine`
- [ ] `npm run lint`
- [ ] `npm run build:vercel`
- [ ] Checked in a browser (say which pages and widths)

## Honesty checks
- [ ] Every number shown in the UI comes from the engine. Nothing favorable is hard-coded.
- [ ] Synthetic data is labeled.
- [ ] Permission changes are enforced on the server, not only hidden in the UI.
- [ ] No secrets, environment files or real evidence files are included.
