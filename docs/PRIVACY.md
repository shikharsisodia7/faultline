# Privacy

Faultline is an open-source project. This page describes what the software does with data. It is not a legal agreement.

## The public demo

The demo incidents are synthetic. They are generated in your browser by Faultline's simulator. Nothing you do in the demo is sent to a server: replays, simulations, notes, and reviews stay in your browser (notes and reviews use local storage and can be cleared with your browser's site data).

The standalone build hosted on Vercel works the same way and has no accounts.

## The full application (DeepSpace)

When you sign in to the DeepSpace deployment:

- **Account.** Sign-in is handled by DeepSpace. Faultline stores your user id and display name on the records you create (for example, "added by").
- **Uploaded evidence.** Files you upload are stored in your private folder in the app's file storage. Before any event is saved, Faultline redacts common secrets and personal data: tokens, API keys, passwords in key=value form, email addresses, card numbers, and private keys. The original file stays private to you and is deleted when you delete its source or incident.
- **Workspaces.** Incidents and everything derived from them are visible only to members of the workspace that owns them. Personal workspaces cannot be shared.
- **Audit log.** Writes record who did what (for example, "incident.created") so workspace owners can trace changes.
- **Optional integrations.** The AI investigator, GitHub import, and web search are off by default. When an owner enables them:
  - the AI investigator sends a bounded selection of already-redacted events (at most 70) and the ranked hypotheses to Anthropic through the DeepSpace integration proxy. Raw files are never sent;
  - the web search sends only the query you type;
  - the GitHub import fetches public commit data for the repository you name.

## Deleting data

Workspace owners can delete an incident, which removes its events, correlations, notes, simulations, reports, and uploaded files. Deletion is permanent.
