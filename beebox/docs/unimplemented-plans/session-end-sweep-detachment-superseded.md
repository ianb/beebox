---
title: "Detach global sweep from SessionEnd teardown (superseded)"
status: superseded
workstream: streams-and-issues
issues:
  - ../../../issues/closed/bugs/2026-08-20-session-end-hook-cancelled-by-slow-sweep.md
---

# Detach global sweep from SessionEnd teardown

This exact launchd/request-marker design was superseded during integration by
the implemented [dev-loop lifecycle](../implemented-plans/dev-loop-lifecycle.md)
design already on `main`. That implementation keeps the core outcome—true
process-group detachment and serialized sweeps—but uses the shared Node detach
helper and skips concurrent triggers instead of queueing a trailing request.

SessionEnd must finish the one bounded cleanup decision only it can make. The
global sweep remains triggered on session start/end, but runs as a real
one-shot background service rather than a child of the hook's process group.

## Established cause

`auto-sweep.sh` has always used `&`, but that is not sufficient detachment for
the hook host. The lifecycle log can record the child process's `START` and then
lose both its `END` and the parent SessionEnd decision when the hook process
group is cancelled. A local non-interactive-shell probe likewise waited on a
plain background child despite `disown`.

macOS `launchctl submit` crosses that process-group boundary immediately, but a
plain submitted command is daemon-like and restarts. The submitted worker must
remove its own unique launchd label after writing `END`. It receives an
explicit `HOME` and `PATH` because submitted jobs do not inherit the interactive
environment. Non-macOS uses `setsid` when available, with a best-effort nohup
fallback.

## Implementation

1. Split `auto-sweep.sh` into a tiny trigger mode and an internal worker mode.
   Trigger mode submits the absolute script path and returns; submission
   failure logs and returns nonzero, never falls back to blocking SessionEnd.
2. Every trigger writes a shared request marker before submitting a uniquely
   labeled worker. Worker mode waits on a kernel-owned global sweep lock, then
   consumes that marker. Concurrent requests therefore produce one trailing
   sweep; excess queued workers observe no marker and exit as coalesced rather
   than dropping the newest request.
3. The worker closes its sweep-lock descriptor in the `workstreams` child, so
   detached trash reapers cannot extend whole-sweep ownership. It writes
   `START`, output, terminal status, and `END`; an EXIT trap unloads its bound
   launchd label on success and failure. Trigger mode logs `SUBMITTED` before
   returning, preserving a trace even if the worker never reaches `START`.
4. Keep the trigger before SessionEnd's early returns. True detachment makes
   its position cheap, so the session-specific liveness/state/teardown logic
   always runs inside the hook budget.
5. Add a doctest whose fake `launchctl` genuinely launches a blocked worker,
   proving trigger mode exits while sweep remains blocked. Worker tests prove
   request coalescing, whole-sweep locking, START/END/status logging, failure
   visibility, and label removal. A macOS fixture canary covers real launchd.

## Boundaries

- This does not make sweep itself incremental or faster.
- The existing 300-second hook timeout remains defense in depth for the
  session-specific checks and teardown.
- The detached worker uses the managed teardown locks from the concurrent
  creation fix; it does not add another Git mutation implementation.
- The existing teardown trash reaper has a separate lifecycle and is not
  refactored here.

## Done when

- Trigger mode returns without waiting for a deliberately blocked fake sweep.
- Three overlapping worker invocations run exactly two sweeps (the active one
  plus one trailing request), coalesce the excess worker, and leave complete
  lifecycle log records.
- SessionEnd/cull integration doctests, root typecheck/lint, doc-check, and
  cross-model review pass with no unresolved hook-lifecycle finding.
