---
title: "A chat message sent while a restart is closing the run is silently dropped"
workstream: maintenance-live-tasks
area: beebox
labels: [chat, message-loss]
filed-by: agent
discovered-by: agent
discovered-in: "maintenance-live-tasks / chat-termination-notes diff review (Codex), 2026-11-02"
resolution: implemented
---

**Closed (implemented, 2026-11-02):** Fixed in bab148302: isBusy() includes liveTasks.ending(), so sends during a restart close queue and drain into the fresh run. Differs from the proposed closing state on ChatBackendRun.

`ChatSession.restart()` (and `stop()` with no tasks) calls `endRun`, which
calls `run.close()` or `run.abort()` and leaves the session in `ready`
(`src/core/chat/session/run/core.ts`, `restart`). Both end the run's input
queue at once (`src/services/claude-chat/claude-run.ts:53-66`,
`inputQueue.end()`), but `run.closed` turns true only when the message pump
finishes, so `liveRun()` (`core.ts:142-144`) still returns the run.

A `send()` in that gap passes the busy check, moves the session to
`streaming`, and calls `run.send`, which pushes into the ended queue. The
queue drops it without error (`src/services/claude-chat-queue.ts:23-24`:
`if (ended) return;`). The close handler then moves the session to idle. The
person's message is accepted, never delivered, and not reported as
undelivered (`queue-dropped` is emitted only by `stop()`).

Reachable from a model change or restart request on a running chat, the
provider-readiness restart in `sendAdmitted`, and the maintenance quiesce, each
followed quickly by a send (a queued drain, a schedule delivery, the person).

Smallest fix direction: give `ChatBackendRun` a synchronous "closing" state
(set in `close`/`abort`) that `liveRun()` treats as not live, and make a send
during it enqueue for the close handler's drain, as a send during
`starting`/`streaming` already does.

## Fixed (worktree `maintenance-live-tasks`)

`ChatSession.isBusy()` now also reads true while the server is ending the run
(`liveTasks.ending()`: set by `endRun` in `restart`/`stop`, cleared when the
close handler runs). Every sender already queues for a busy session, and the
close handler drains the queue into a fresh run, as `restart()` promises.
Test: `test/core/chat/session/run.maintenance.test.ts`, "A message sent while a
restart closes the run reaches the fresh run".
