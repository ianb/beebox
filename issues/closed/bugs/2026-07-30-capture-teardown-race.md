---
title: "Capture's DELETE route and sweep can delete a session out from under its worker"
workstream: small-bugs-batch
area: beebox
filed-by: agent
discovered-in: worktree-chat-photo-batch-upload — Codex review of the bulk-upload teardown fixes
labels: [mobile]
priority: normal
resolution: implemented
---

Closed 2026-08-29 by this commit (`fix(capture): guard abandoned-session teardown`): the sweep now rechecks lifecycle, emptiness, and staleness under the staging lock before discarding.

The bulk-upload side of this race was fixed (see
[chat-photo-batch-upload](../../../beebox/docs/plans/chat-photo-batch-upload.md)):
a client cancel or an abandonment sweep could read a session's state, then delete
its staging directory *after* a finalize had sealed it — the worker then reads
`null`, silently returns, and the client, which already saw finalize succeed,
reports success while no message ever reaches the chat.

**The same class exists in capture, at two call sites left untouched:**

- `src/webapp/routes/capture.ts` — the DELETE route reads + authorizes the
  session, then calls `cleanupStagingSession` unconditionally. A finalize landing
  during authorization leaves the worker owning a session the route then deletes.
- `src/core/capture/sweep.ts` — the abandonment sweep evaluates an unlocked
  snapshot and calls bare `cleanupStagingSession`. An upload or finalize between
  the snapshot and the delete is discarded.

The fix shape already exists and is used by bulk:
`discardStagingSessionIfCancellable` (`src/core/capture/staging-teardown.ts`)
re-reads the session under the staging lock, refuses anything past the seal, and
takes a `stillDiscardable` predicate so a caller whose decision depends on more
than the lifecycle state (idleness, emptiness) re-evaluates it inside the lock
too. Capture's two sites should route through it.

**Why it wasn't fixed with the bulk one:** capture is a different subsystem that
`worktree-fixup-capture` hardened around 2026-07-29 (`ac4e12b9`, `d477aa24`), and
editing it from the photo-batch worktree risked conflicting with that work. It is
the same defect class, though, and a capture batch is as loseable as a bulk one.

Whoever picks this up: check whether capture's finalize/worker ownership model
matches bulk's closely enough for the same helper, or whether capture's
`partial`-sealing sweep (which deliberately seals abandoned sessions rather than
discarding them) needs a different guard.
