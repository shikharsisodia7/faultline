# Security

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) for `shikharsisodia7/faultline`, or open an issue without exploit details and ask for a private channel. Please do not test against other people's data.

## Security model

The full model is in [docs/DATA-MODEL.md](docs/DATA-MODEL.md). In short:

- **Reads** are filtered inside the DeepSpace RecordRoom before data leaves the server. Every workspace-scoped row carries its own `workspaceId` and is readable only by active members of that workspace (`'team'` permission). No collection is readable anonymously.
- **Writes** never come from the browser directly: clients have `create: false` on every workspace-scoped collection. All writes go through server actions that verify the caller's JWT, validate input, check the caller's workspace role (default deny), and append an audit event.
- **Files.** Uploads go to the uploader's private storage folder. `registerSource` accepts a file key only if it begins with exactly `apps/<appId>/users/<userId>/`, where `appId` comes from the worker's environment and `userId` from the verified JWT, and refuses `..`, `//`, backslashes, percent-encoded separators, and control characters (`src/server/keys.ts`, with tests). The ingestion job downloads using the uploader's own private scope.
- **Background jobs.** The job queue refuses all browser reads and writes. Jobs are enqueued only by actions, which set the verified caller as `enqueuedBy`; the job re-checks that user's workspace role.
- **Redaction** of secrets and personal data runs before any event is stored.
- **Untrusted content.** Log text is rendered as text, never as HTML. The optional AI investigator treats evidence as untrusted data, has no tools, and its citations are validated against the evidence actually provided.
- **Integrations** that spend owner credits are disabled unless the owner sets `FAULTLINE_INTEGRATIONS=enabled`, and are rate-limited per user.

## Verification on the live platform (2026-11-26)

Run against https://faultline.app.space. Full evidence is in `docs/FINAL-RELEASE-AUDIT.md`.

- **Private files.** A real upload is stored at `apps/<appId>/users/<userId>/…`, the exact prefix the server enforces. Anonymous read, list, delete and upload were refused (401). Reading or deleting another user's file with a valid token was refused (403). Listing is confined to the caller's own folder, and the public file area holds no files.
- **File ownership.** `registerSource` refused 10 forged keys with the owner's real token: another user, nested prefix, id-prefix, cross-app, app name, encoded and double-encoded traversal, `..`, a Unicode slash, and a control character. An empty key was refused too.
- **Server actions.** All refuse anonymous callers and forged (`alg: none`) tokens with 401.
- **Roles.** Outsider, viewer, collaborator and revocation are enforced by the real action code (`src/server/actions.test.ts`, in CI). The live three-account run (`tests/authz.spec.ts`) has not been executed yet.
- **Scans.** Semgrep found 0 issues on the final revision. The five findings Semgrep Guardian reported during development were all fixed (rule ids and commits are in the audit). gitleaks found no leaks. One low dev-only esbuild advisory is accepted, with reasons, in the audit.

- **Credential hygiene.** Local DeepSpace credentials (`.dev.vars`) were found in two private Vercel deployment sources (never public, never in git). Uploads now exclude them via `.vercelignore`; deleting those deployments and rotating the credentials are owner actions (see the audit).

Automated scans and these probes reduce risk; they do not prove the absence of vulnerabilities.

## Known limitations

- Presence rooms (who is viewing an incident) are keyed by unguessable incident ids but do not check workspace membership; they carry names and playheads only.
- Multi-account enforcement on the live platform awaits the `tests/authz.spec.ts` run.
- External integration-proxy features are off by default and have not been exercised.
- No independent security review or penetration test has been done.
