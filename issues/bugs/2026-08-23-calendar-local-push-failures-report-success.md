---
title: "Calendar local push failures report sync success"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of Calendar failure isolation
---

`processLocalDeletes` and `pushAndCleanOrphans` in `callback-box/src/connectors/google-calendar-push.ts` warn and continue when Google rejects a delete or insert. They do not return a failure outcome. `GoogleCalendarConnector.sync` derives success only from per-calendar pull failures.

A rejected local delete or a local event that cannot be inserted can therefore repeat forever while `cb wakeup` prints zero connector errors and exits zero. The warning is transient and does not reach scheduled-task health.

Return structured failures from both post-loop passes and merge them into the connector's partial result and sanitized commit narrative. Preserve the local file for retry. Add representative delete and insert doctests plus a wakeup exit-status assertion.
