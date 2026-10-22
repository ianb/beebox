---
title: "Google Drive sync problems reach only the server log, not the boxholder"
workstream: bug-burndown-4
area: beebox
labels: [google-drive, connectors]
filed-by: agent
discovered-by: agent
discovered-in: worktree-bug-burndown-4 — fixing the Docs API 403 misdiagnosis, 2026-10-20
priority: normal
resolution: implemented
---

**Closed:** Implemented per `beebox/docs/implemented-plans/drive-docs-api-health.md` (7b255426b through ef95483d0): a health check, a settings line, and a once-per-chat-session mention by the agent; no dismiss. Scope: only the Docs-API-unavailable case. Push refusals and folder-sync notes are not covered and remain open as future work. On-demand syncs update the diagnosis at the next scheduled pass.

When a Google Doc syncs but the Docs API call fails, `pull()` still writes the
doc with less detail (no revision tracking, no lossy-content report). The
cause is now diagnosed correctly
([Docs API 403 issue](../bugs/2026-09-21-gdoc-inspect-403-misattributed-to-scope.md)),
for example "the Docs API is disabled for the Cloud project, enable it here".
But it goes only to `console.warn` in `tryGetDocument`
(`beebox/src/connectors/google-drive/handlers/docs/handler.ts`). The
boxholder never sees it, so a doc can sync at reduced fidelity indefinitely.

The same handler logs push refusals ("unresolved conflict", "refusing to push
… wrote upstream to .remote.md") the same way. Those at least leave a
`.remote.md` file behind; the Docs API case leaves no trace in the box.

A pull result carries only `written` and `changed`, and folder-sync notes
also end in `console.warn`, so there is no existing channel to reuse.

What to decide: where connector sync problems should appear for the
boxholder (a notification, a connector status line in settings, a note on the
synced card), and which of them are worth interrupting for. A disabled API is
a one-time fix the boxholder must make in Cloud Console, so it is a good first
case.
