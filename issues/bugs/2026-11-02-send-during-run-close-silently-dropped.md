---
title: "A chat message sent while a restart is closing the run is silently dropped"
workstream: unattached
area: beebox
labels: [chat, message-loss]
filed-by: agent
discovered-by: agent
discovered-in: "maintenance-live-tasks / chat-termination-notes diff review (Codex), 2026-11-02"
---

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
