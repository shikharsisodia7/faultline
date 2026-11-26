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

## Known limitations

- Presence rooms (who is viewing an incident) are keyed by unguessable incident ids but do not check workspace membership; they carry names and playheads only.
- Platform-level enforcement has been verified only to the extent recorded in `docs/HUMAN-VERIFICATION.md`.
