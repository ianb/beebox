# Router concurrency protocol

`bin/router.ts` supervises a lazily-spawned vite+fastify pair per worktree,
racing HTTP requests, idle timers, child-process exits, and explicit
stop/retry actions against each other over a single in-memory `worktrees`
map. Six of its last twenty commits (as of the 2026-07 architectural review)
were concurrency fixes to this same comment-guarded machinery — the bugs are
subtle, non-obvious from the code shape alone, and easy to reintroduce by a
well-intentioned refactor. This doc promotes the four incident-derived
invariants out of inline comments (where they're easy to read past) into one
place that anyone touching worktree lifecycle code should read first. Each
invariant still has a pointing comment at its code site — this doc explains
*why*; the code comment marks *where*.

If you're about to change `ensureRunning`, `startWorktree`, `stopWorktree`,
`onChildExit`, `removePidFile`, or the PID-file/`worktrees`-map shapes: read
this first.

## 1. The pidfile is single-slot — never delete a newer generation's

**Where:** `removePidFile` in `bin/router.ts`.

Each worktree's pidfile (`~/.cache/callback-box/pids/<name>.json`) holds only
the *current* generation's PIDs — there's no history. A teardown racing a
fresh start must not delete a pidfile that a newer generation has already
written, or that generation becomes invisible to the startup sweep (an
untracked orphan if the router later dies before a clean shutdown).

**Fix shape:** generation-aware callers pass `expect: { vitePid, fastifyPid }`;
`removePidFile` reads the on-disk record first and skips the unlink if the
PIDs don't match what the caller thinks it's tearing down. Generation-agnostic
callers (full router shutdown) omit `expect` and always unlink.

## 2. Registering a worktree's start must be atomic — no `await` between check and set

**Where:** `ensureRunning` in `bin/router.ts`.

`ensureRunning` checks the `worktrees` map, and if the worktree isn't already
running or starting, registers a `"starting"` placeholder and kicks off
`startWorktree`. If there is *any* `await` between reading the map and writing
the placeholder back, two near-simultaneous cold requests for the same
worktree both observe an empty map, both call `startWorktree`, and each spawns
a full vite+fastify pair — a leaked generation (the loser's pair stays alive,
unreferenced, until its eventual exit is swallowed by invariant #4's
replaced-generation guard).

**Fix shape:** the placeholder object and its `startPromise` are constructed
and written into the map in the same synchronous stretch of code, with
`startWorktree` itself (not `ensureRunning`) responsible for the worktree
lookup/404 check that used to happen — and `await` — before registration.

## 3. Swallow the execa child-process promise immediately at spawn time

**Where:** `startWorktree` in `bin/router.ts`, on both the `fastify` and
`vite` `execa()` results.

`execa()` returns a promise that rejects when the child exits non-zero — a
router routinely killing children on idle-shutdown or generation replacement
means that promise is *expected* to reject, often minutes after the call site
that would naturally `catch` it has already returned. An un-caught rejection
surfaces later as an `unhandledRejection` and crashes the whole router process
— every worktree, not just the one whose child exited. This was a real
incident (fixed 2026-06-04).

**Fix shape:** attach a no-op `.catch()` to the execa promise at the same
place it's created — never later, and never only on the success path — so the
rejection is handled the instant Node would otherwise flag it. Actual exit
handling (killing the sibling process, updating `worktrees` state, removing
the pidfile) happens via the separate `.on("exit", …)` event, not through this
promise.

## 4. A teardown must verify the exiting child still belongs to the map's current entry

**Where:** `onChildExit` in `bin/router.ts`.

Fastify drains open browser sockets for up to ~10s after `SIGTERM` before its
process actually exits. By the time that delayed `exit` event fires, a
reconnecting client has often already triggered a fresh generation for the
same worktree name. Tearing down "by name" — i.e. trusting that an exit event
for `name` means *the current* entry for `name` should die — kills the *new*
generation instead of the old one. The client then restarts it, which
eventually exits too (draining for another ~10s), restarting the cycle: a
self-sustaining restart storm with a fresh vite port every iteration (the
2026-06-09 "main restarts every 10s" incident).

**Fix shape:** every exit/teardown handler compares the entry object identity
(`worktrees.get(name) === exited`), not just the name — a stale exit from a
replaced generation reduces to a log line instead of tearing down the live
entry. The same identity-check discipline applies to `stopWorktree`, which
drops its own map entry before any `await` for exactly this reason (see its
comment).

## Related but separate: orphan sweeping

Two more mechanisms guard against leaked processes but aren't part of the
same race-condition family above — they clean up *after* a crash rather than
preventing a race during normal operation: `sweepStaleChildren` (kills PIDs
recorded in stale pidfiles at router startup) and `reclaimOrphans` in
`bin/process-cleanup.ts` (pattern-matches vite/fastify/agent-browser processes
pidfiles can't see, e.g. from an older router generation). See the comments at
their call sites in the boot sequence at the bottom of `router.ts`.

## Status: conservative extraction only (2026-07-09)

This doc and the doc-browser extraction (`bin/router-docs.ts`) are Track 8 of
`callback-box/docs/plans/architectural-review-followups.md` — pure code
motion plus this write-up, no change to the state machine or its invariants.
The fuller option — a formal `WorktreeState` transition function with an
injected clock/spawner and unit-testable fakes — remains open in
`issues/2026-07-06-architectural-review-open-decisions.md` (item 1). If you
find yourself wanting to add a fifth invariant to this doc, that's a signal
the conservative approach is running out of runway and the formal state
machine is worth revisiting.
