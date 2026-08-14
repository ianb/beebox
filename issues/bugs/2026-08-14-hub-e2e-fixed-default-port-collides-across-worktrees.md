---
title: "`hub-e2e.doctest.md` binds the default hub port, so two worktrees running it at once collide"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-watcher-flake — full-suite verification of the file-watcher flake fix
---

`test/hub/hub-e2e.doctest.md` writes a hub config with no `port` field, so the
spawned hub falls back to `DEFAULT_HUB_PORT` (4310). The test then waits up to
120 seconds for the hub to print its port. A hub that cannot bind never prints
one, so the loser of a collision fails with `waitFor: timed out` after two
minutes, and the diagnostic names the *build* step at line 116 rather than the
bind failure — the readiness wait lives in a later `continue` block that shares
the same test.

Several worktree sessions run `pnpm test` concurrently on this machine as a
matter of course, so this is reachable in ordinary use, not a corner case.

Observed 2026-08-14: an orphaned `cb hub` (PPID 1) from the `points-at-ui`
worktree held 127.0.0.1:4310 for 25 minutes. Every `hub-e2e` run in this
worktree failed identically for as long as it lived, in isolation as well as
under the suite, which reads as a real regression until you check `lsof`.

Two separable problems:

1. **The fixed port.** The fixture should bind port 0 and read back the assigned
   port, the way the per-box child already does (the child in the same test got
   an ephemeral 64767). Nothing about what this test proves — routing, health,
   lazy start — needs a well-known port.
2. **The 120-second silent wait.** A bind failure is knowable immediately. The
   hub's stderr is captured but never surfaced, so the failure reports the wrong
   line and gives no cause. Failing fast on a hub that exited, and including its
   output in the diagnostic, would turn a two-minute mystery into an instant
   answer.

The orphan itself is downstream of a doctest framework bug fixed in `dc90a691`:
a cleanup block's teardown was registered after the examples, so a failing
example skipped its own cleanup and never killed the hub it spawned. That fix
should stop new orphans, but a stale one from before it still needs a manual
`kill`, and nothing sweeps them.
