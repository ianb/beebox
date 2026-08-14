---
title: "`file-watcher.doctest.md` can time out as a whole under parallel suite load"
workstream: watcher-flake
area: callback-box
filed-by: agent
discovered-in: worktree-ios-box-switcher-gate — /finish full-suite verification
resolution: implemented
---

Closed 2026-08-14. The whole-file expiration and the earlier assertion flakes
are the same defect seen from two angles, and the root cause was in the doctest
framework, not in the watcher.

## What the expiration actually was

A `cleanup` block's `t.teardown()` registration was emitted **after** the
example statements in the generated test function
(`agent-doctest/src/doctest-hooks.mjs`). An example that throws therefore never
reached its own cleanup registration, so the cleanup never ran. This doctest
holds live `fs.watch` handles, and a leaked handle keeps the tap child process
alive forever. tap killed it at its 300-second per-file limit and reported
`expired: test/core/box/file-watcher.doctest.md`.

So the two failure modes in this issue's history were never separate. **Every
assertion flake in this file surfaced as a whole-file expiration that named no
assertion.** That is why three rounds of fixes chased a phantom "35x slowdown":
the reported signature deleted the evidence. There was no pathological
slowdown — there was an ordinary assertion failure plus a hang.

Reproduced directly: with the notification budget deliberately broken, the file
used to report the failing assertion *and* a trailing `not ok - timeout!`. After
the fix it reports the failing assertion alone and exits.

## Why the assertion failed under load in the first place

Both bounds tests materialized their production magnitude of 1,024. Proving a
1,024-directory ceiling opens and then closes 1,024 real `fs.watch` handles, and
on macOS each `close()` is a blocking round-trip to libuv's single FSEvents
run-loop thread. Measured on this machine:

| handles | close time (loaded) |
| ------- | ------------------- |
| 128     | 165 ms              |
| 256     | 427 ms              |
| 512     | 900 ms              |
| 1,024   | 6,027 ms            |

Super-linear, and load-sensitive: the file took 5.8 s alone, 7.7 s under a clean
six-way suite, and 16–23 s once modest extra load was added. That expense
exercises macOS, not this module.

## Fixes

- `agent-doctest`: teardown registrations are hoisted to the top of the
  generated test, so a failing example can no longer skip its cleanup. Covered
  by a new end-to-end regression test. This fixes the class of bug for **every**
  doctest that holds a handle, not just this one.
- `callback-box`: `ensureBoxWatcher` takes its bounds from the caller
  (`maxWatchedDirs`, `maxNotificationWork`, `coalesceMs`), defaulting to the
  production values. Both bounds tests now prove the boundary at 16 with 64
  fixtures instead of at 1,024 with 1,100. A separate assertion pins the
  production defaults so the real numbers stay covered. Both were verified with
  mutation testing — breaking either budget fails its test.

The file now runs 13 assertions in 1.4 s, down from 12 in 5.8 s, with no section
over 140 ms, and 1.4–1.8 s under full six-way suite load (it was 7.7–23 s).

## What the cross-model review caught

The first version of the teardown fix was incomplete, and codex found it.
Hoisting registration made a *new* thrower reachable: a cleanup block belonging
to a `continue` block the test never reached closes over a `const` still in its
temporal dead zone. tap runs teardowns LIFO and abandons the rest once one
throws, so that ReferenceError would skip every earlier cleanup — including the
one holding the handle — reproducing the very leak the hoist was meant to fix.
Each teardown body is now wrapped, so one failure cannot strand its siblings.

Writing the regression test for it exposed a second mistake: **a failed
`t.check` does not throw.** The first fixture "failed" by assertion and so
proved nothing — its cleanup would have run under the old generator too. Only an
actual exception (which is what a `waitFor` timeout raises) skips the rest of a
test. Both fixtures now throw.

## Related

- [watcher assertion-race issue](2026-08-03-file-watcher-doctest-flaky-timing.md)
  — the `fs.watch` readiness handshake, still in place and still needed.
- [rapid-write event-count flake](2026-08-08-file-watcher-rapid-write-event-count-flake.md)
  — an assertion flake that, under the framework bug, would have been reported
  as an expiration.
