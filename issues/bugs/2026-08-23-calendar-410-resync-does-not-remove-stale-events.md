---
title: "Calendar 410 resync does not remove stale local events"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-connector-sync-isolation — verifying calendar partial-failure handling
stories: [connectors/calendar-sync-repairs-an-expired-sync-token-and]
priority: normal
---

**What is wrong.** The Google Calendar connector treats an invalid incremental
sync token as recoverable, but it implements only the token half of recovery.
`callback-box/src/connectors/google-calendar.ts:280-285` deletes the token,
saves state, and calls `syncCalendar` without a token. It does not clear or
reconcile the affected calendar's existing `eventFiles` entries and `.ics`
files.

`callback-box/src/connectors/google-calendar-sync.ts:267-286` fetches the full
window and reconciles only events returned by Google. There is no pass that
removes a previously tracked event absent from the new full response. The real
service does not request `showDeleted` on a full-window list
(`callback-box/src/services/google-calendar.ts:106-123`). An event deleted
remotely while the token was invalid can therefore remain indefinitely as a
stale local `.ics` file.

Google's official incremental-sync guidance says a `410` invalid token should
clear the local collection before a new full sync:
[Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync).

**Why this needs separate design.** Callback-box's calendar directory is not a
read-only cache. Local ICS edits can be pushed to Google. A blind pre-fetch wipe
could destroy a pending local edit, so the repair should decide how a full
response's absence interacts with locally edited files, then remove stale
entries per calendar.

**How this was established.** Read the 410 catch, full-sync reconciliation,
persisted event index, and real `events.list` parameters; compared them with
Google's current guidance. This is source and documentation evidence only. No
live Google account was exercised.

**Related.** The early-return defect is tracked separately in
[one failing calendar aborts the whole sync](../closed/bugs/2026-08-21-one-failing-calendar-aborts-the-whole-calendar-sync-ins.md).
