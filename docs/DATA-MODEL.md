# Data model and permissions

Source: `src/schemas/faultline-schemas.ts`. Enforcement: the DeepSpace RecordRoom (reads) and `src/server/domain.ts` (writes).

## Collections

| Collection | Purpose | Key fields |
| --- | --- | --- |
| `workspaces` | Isolation boundary | `name`, `kind` (`personal` or `team`), `ownerId`, `workspaceId` (its own id) |
| `team_members` | Membership and role | `teamId`, `userId`, `role` (`owner`, `collaborator`, `viewer`), `status`; unique on (`teamId`, `userId`) |
| `incidents` | Incident metadata | `title`, `severity`, `status`, `synthetic`, timestamps, counts, `analysis` (versions, parameters, timings) |
| `sources` | Uploaded evidence files | `fileKey` (private R2 key), `uploadedBy`, `status`, `stats`, `errors` (first 100) |
| `events` | Normalized evidence | the canonical event fields; `recordId` is the content-derived event id |
| `services`, `dependencies` | Topology | `serviceId`, `kind`; `from`, `to`, `origin` |
| `correlation_edges` | Inferred relationships | `source`, `target`, `score`, `signals`, `explanation`, `algorithmVersion` |
| `hypotheses` | Ranked candidate causes | `rank`, `title`, `score`, `factors`, `supportingEventIds`, `explanation` |
| `hypothesis_reviews` | Human review | `hypothesisId`, `userId`, `review`; unique on (`hypothesisId`, `userId`) |
| `annotations`, `bookmarks` | Collaboration | `eventId`, `ts`, `body`, `kind`; `ts`, `label` |
| `ingestion_jobs` | Persisted job progress | `stage`, `progress`, `message`, `error`, `stats`, `cancelRequested`, `attempt` |
| `timeline_branches` | Branch point + interventions | `branchAtSec`, `interventions` (typed JSON, validated) |
| `simulation_runs` | Saved counterfactual results | `overall`, `summary`, `assumptions`, `simulatorVersion` |
| `postmortems` | Saved reports | `markdown`, `document`, `status` |
| `audit_events` | Who did what | `actorId`, `action`, `target`, `detail` |
| `simulation_configs` | Personal chaos-lab scenarios | `name`, `scenario` |

Interventions are stored as a validated JSON array on `timeline_branches` and `simulation_runs` rather than a separate collection: an intervention has no identity or lifecycle apart from the branch it belongs to, and splitting it out would add a cross-collection consistency problem without adding a query anyone needs.

## Read access: workspace isolation

Every workspace-scoped collection has `teamField: 'workspaceId'` and these permissions:

| Role | read | create | update | delete |
| --- | --- | --- | --- | --- |
| anonymous (`*`) | no | no | no | no |
| `viewer` (app role) | no | no | no | no |
| `member` | `'team'` | no | no | no |
| `admin` | `'team'` | no | no | no |

`'team'` admits a reader when an **active** `team_members` row links them to the row's `workspaceId` (or they created the row). The RecordRoom applies this before anything is sent over the WebSocket, so a non-member never receives the bytes.

Each collection is checked independently. A private incident does **not** protect its children by inheritance; every event, edge, note, and job row carries its own `workspaceId` and enforces the same rule. App admins get `'team'` too, so the app operator does not see private workspaces through the client.

`simulation_configs` is personal: `read/update/delete: 'own'`, `create: true`, limited to the `name` and `scenario` fields.

## Write access: server actions only

Clients have `create: false` on every workspace-scoped collection. Without that, a client could write a row stamped with *another* workspace's id and inject content into it. Every write goes through a server action (`src/actions/index.ts`) that:

1. verifies the caller's JWT (the worker's action route);
2. validates and bounds every input;
3. checks the caller's workspace role with `requireRole` / `loadIncident` (default deny; "not found" and "not yours" return the same answer);
4. writes with RBAC off;
5. appends an `audit_events` row.

| Capability | viewer | collaborator | owner |
| --- | --- | --- | --- |
| Read incidents and evidence | yes | yes | yes |
| Ask the AI investigator | yes | yes | yes |
| Import evidence, annotate, bookmark, review, simulate | no | yes | yes |
| Confirm a root cause | no | no | yes |
| Delete an incident or source file | no | no | yes |
| Manage members | no | no | yes |

## Background jobs

The JobRoom refuses all socket writes **and reads** (`authorizeWrite`/`authorizeRead` return false). Jobs are created only by actions through `enqueueJob`, with `enqueuedBy` set to the verified caller. The handler re-checks that user's workspace role because job payloads are data. Progress is read from team-scoped `ingestion_jobs` rows. Cancellation is cooperative: an action sets `cancelRequested`, and the handler checks it between stages and write batches.

## Files

Raw uploads live in the uploader's private R2 scope (`apps/<app>/users/<userId>/…`). `registerSource` refuses keys outside the caller's area. The ingestion job downloads with the *uploader's* scope, so it can read nothing the uploader could not. Deleting an incident or source deletes the stored file.

## Presence

Live presence uses a `PresenceRoom` keyed by `incident:<incidentId>`. Incident ids are random, but the presence room does not check workspace membership; it carries only display names and playheads, never evidence. This is a documented limitation.
