---
title: "Returning to a tab mid-turn can end a healthy resumed turn early"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
---

Two hooks ask the server whether a streaming chat turn has finished. They
disagree on which session ID to ask about.

- The stream watchdog (`processing-status-display.ts:125-140`) freezes the first
  session ID of each streaming episode. Its comment explains why: a resumed
  session whose SDK rotates IDs keeps its busy entry under the original ID, so
  a poll with the rotated ID reads as idle. It also requires
  `STREAM_WATCHDOG_IDLE_POLLS` idle answers in a row before it recovers.
- `useChatStallRecovery` (`InteractiveChat/hooks.ts:159-186`) runs on every return
  to a visible tab. It polls the live `sessionId` and sends `STREAM_RECOVER`
  after one idle answer.

Expected failure: during a resumed turn whose ID rotated, switch away from the
tab and back. The stall check asks about the rotated ID, reads idle, and ends
the turn while the agent still works. The reply then arrives after the UI
fell through to a history refresh.

Not reproduced. The fix is probably to share the watchdog's frozen ID (and
possibly its idle threshold) with the stall check. That changes recovery
timing, so it was not done in the sweep.

Related: [new-session-dead-socket-status-never-recovers](2026-08-09-new-session-dead-socket-status-never-recovers.md)
is the opposite failure (no recovery).
