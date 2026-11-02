---
title: "The once-a-second maintenance check closes a chat that has live background subagents, because it counts only a running turn as busy"
workstream: unattached
area: beebox
labels: [chat, background-tasks, maintenance, prod]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — box-agent report from a hosted box, 2026-11-02"
---

A chat on a hosted box runs multi-hour research as background subagents
(Agent tool, `run_in_background`). When the chat's Claude process ends, the
subagents stop, and the next turn gets a task notification that they "didn't
finish before the previous session ended". Most stops line up with deploys or
a host OOM night. Two on 2026-11-02 had neither: `bbx serve` for the box had
been up since about 08:12 UTC.

## What ended the chat (verified read-only on prod, 2026-11-02)

The box's own journal, at both times:

```
14:07:13 [ChatSession:restart] Closing run — close handler will drain any queued messages
14:07:13 [ChatSession] Ending run <session> with 1 live background task(s)
14:07:14 ... (same pair)
14:07:15 ... (same pair), then [ChatSession:close] Run ended
14:07:16–18 [ChatSession:restart] No run to restart
14:08:19 [ChatSessionRegistry:sweep] Idle eviction of <session>
```

and the same shape at 18:12:15–18:12:18. No kernel OOM, no serve restart, no
deploy in either window.

The one-per-second restarts come from the maintenance poll in
`src/webapp/server/app.ts` (the `maintenanceCheck` interval, about line 433).
While any process holds the box's maintenance lock
(`boxMaintenanceStatus(box.boxRoot)?.owner`), it calls
`runtime.registry.quiesceForMaintenance()` whenever no session is `busy`.
`quiesceForMaintenance` (`src/core/chat/session/registry/core.ts`) calls
`pauseForMaintenance()` on every session, which calls `restart()` when the
session is not busy (`src/core/chat/session/run/core.ts`). `busy` means a turn
in progress. A chat between turns with live background tasks is "not busy",
so it is closed. `endRun` logs the live tasks and ends the run anyway.

The idle-eviction fix (`docs/implemented-plans/idle-eviction-background-work.md`)
made the sweep and the live cap skip chats with live tasks. This maintenance
path was not covered. The sweep line after it is the normal follow-up once the
run is gone.

## Not yet found: what took the maintenance lock

Owners in the code: `src/core/docs-refresh.ts` (docs refresh, also run by the
reactor cycle's `refreshDocsStage`), `src/core/migration-sweep.ts`,
`src/core/box-backup/run/backup.ts`, `src/cli/commands/upgrade.ts`, and
`src/hub/supervisor/supervised-reload.ts`.

- Backup: ruled out. The box's hourly backup ran at 14:09:52 and 18:01:10 and
  skipped ("backups are not configured").
- The box's scheduler pass (`beebox-pass@<box>`) runs about once a minute and
  takes about one second. One started at 18:11:45, 30 seconds before the
  stop. Check whether the pass or the reactor cycle it starts can run a docs
  refresh or migration sweep that takes the lock. The subagents were
  committing card edits in both windows, and a schema or guidance change in
  those commits could make the generated docs stale.
- The chat and its subagents ran no `bbx docs refresh`, `bbx migrate`, or
  `bbx upgrade` in either window (checked from the session transcripts).
- The lock record under the box's `.git/bbx-maintenance/` is cleared when the
  owner finishes. Logging the owner's reason when quiescing would make the
  next incident self-explaining.

## Fix directions

1. Treat a session with live background tasks as busy for maintenance: the
   poll waits (with a bound) or the maintenance owner yields, the same way the
   sweep and live cap already skip such chats. Decide what happens when
   maintenance cannot wait (a deploy): then the chat should be told.
2. When a chat with live tasks is ended for any reason, tell the chat why (a
   self-note or a task notification naming the cause: maintenance, deploy,
   eviction, OOM).
3. Find and, if it is avoidable, stop the routine work that takes the
   maintenance lock while chats are active.
4. Larger: a supported way to run multi-hour work outside the chat process
   (a detached job that survives chat restarts and deploys). Related:
   [done-but-still-working state](../features/2026-09-11-done-but-still-working-state.md)
   and [stop button and background subagents](../decisions/2026-08-25-chat-stop-and-background-subagents.md).

Still to check from the report: whether the live-task set includes nested
subagents and `run_in_background` Bash commands, and whether a subagent
waiting on its own child reads as quiet to the stall computation
(`BACKGROUND_STALL_MS`, `run/live-tasks.ts`). Host memory on the 3.8 GB host
is a separate question; see
[large box mode](../features/2026-11-01-large-box-mode.md) for the OOM history.

## Direction (boxholder, 2026-11-02)

- Docs refresh stops taking box maintenance. It takes only a light lock (the
  git lock around its commit). It writes only generated files that chat agents
  do not edit, and running chats need not restart to see new docs.
- Migrations and other exclusive maintenance keep the lock, but count a chat
  with live background tasks as busy: wait for it with a bound, never close it
  while idle-with-tasks. On a bound miss, maintenance is deferred; an operation
  that cannot defer (deploy) tells the chat why it stopped.
