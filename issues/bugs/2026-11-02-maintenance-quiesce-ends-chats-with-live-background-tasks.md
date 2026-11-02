---
title: "The once-a-second maintenance check closes a chat that has live background subagents, because it counts only a running turn as busy"
workstream: maintenance-live-tasks
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

## What took the maintenance lock (verified 2026-11-02)

The hourly `box-convergence` schedule, run from the dev machine
(`schedules/box-convergence/run.ts:56`), SSHes
`bbx engine migrate --sweep --repair --yield --json` into every production
box. On the affected box its session opened at 14:07:12 and 18:12:13 UTC, one
second before each set of restarts. No migration was pending and no question
was open; the sweep's peek closed the box because `docsRefreshHasWork` was true
(mtime-based, so the subagents' card edits made it true). The box's
`.beebox/docs-generated-at` marker was rewritten at 18:12:18, just after the
third restart, and no docs commit followed: the regeneration changed nothing.

The same box's journal shows the pattern four more times that day: 03:37,
04:38, 05:43 UTC (convergence runs) and 08:10 UTC (the morning deploy).

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

## Done (worktree `maintenance-live-tasks`, plan `beebox/docs/plans/maintenance-live-tasks.md`)

- Docs refresh is ordinary box work and never takes box maintenance. The
  sweep runs it in its open peek; only a pending migration or question closes
  the box now. The snapshot/pending-ref/index-rollback machinery is removed: it
  is only correct under exclusivity, and generated output is reproducible. A
  rejected template commit now unstages what it staged.
- The server's poll does not close chat runs while any run has live
  background tasks, stalled or not. A deferrable owner (sweep, upgrade,
  backup) times out its drain and defers. A deployment or development reload
  writes `endsBackgroundTasksAt` (a minute after closing) and then ends those
  runs. The poll logs the owner once per attempt:
  `[maintenance] Closing idle chat runs for <reason> (pid, since)` or
  `[maintenance] <owner> waits for N chat(s) with live background tasks`.
- A run ended that way leaves `.beebox/chat-run-ended/<session>.json`; the next
  turn reads it as a `<run-ended reason="deployment">` element inside its
  `<chat-app>` snapshot, and it is removed once that turn is dispatched.

Findings from the report's checks:

- The live-task set includes nested subagents and `run_in_background` Bash
  commands: it is every non-ambient entry of the SDK's
  `background_tasks_changed` signal, which the SDK documents as every live
  task, with `parent_task_id` for tasks a subagent launched.
- A subagent waiting on its own child does not read as quiet: the stall clock
  resets on every message the run emits, including a nested task's
  `task_progress`. Only a whole run silent for 4 h (for example one silent
  background shell) reads as stalled, and maintenance no longer uses the stall
  rule at all.

Left open:

- The deploy that ships this fix still runs on the old server, which quiesces
  on `busy` only; that one deploy behaves as before.
- When the last background task finishes during a drain and the CLI answers
  its notification without a `send`, it is unverified whether the session
  reads as busy; pre-existing for any idle run.
- A run ended by a non-maintenance shutdown (OOM, manual restart) gets no
  cause note: the cause is not known in-process.
- Out of scope, noted only: a detached runner for multi-hour work that
  survives deploys (fix direction 4); host memory sizing
  ([large box mode](../features/2026-11-01-large-box-mode.md)).
- Accepted by the boxholder ("Agents can handle the occasional collision"), closed wontfix: [template sync read-then-write race](../closed/code-quality/2026-11-02-template-sync-read-then-write-race-with-chat-edits.md).
