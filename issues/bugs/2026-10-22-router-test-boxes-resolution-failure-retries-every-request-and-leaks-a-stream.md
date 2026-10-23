---
title: "Dev router: a failing TEST_BOXES resolution retries the whole start on every request and leaks the log stream each time"
workstream: unattached
area: router
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
---

`spawnGeneration` (`workstreams-app/src/router/core/generation.ts`, the
`TEST_BOXES` block from commit 9e24c0fc5) calls `resolveBoxEntries` for the test
boxes and throws a 500 when `TEST_BOXES` is set under `devNoHub`. The older
`resolveBoxEntries(wt.boxes)` call sits on the same path. All of them run after
`prepareStart` has opened the worktree log stream and picked ports, and before
any child is spawned, so none goes through `failStart`.

`ensureRunning` (`core/engine.ts`, the `inFlight.catch`) treats such a
rejection as a transient non-start and deletes the bare `starting` handle. The
record is never parked as `failed`, so there is no backoff, no retry cap, and no
failed-startup page. Every request to that worktree re-runs the whole start and
each attempt leaks one `createWriteStream` handle. The boxholder sees a plain
500.

Also: a `TEST_BOXES` entry that is not in `BOXES` is ignored silently, so it does
not get its own secret store, against the comment that says test boxes never
share entries with real boxes.

Unproven by a run; a router-core test with a fake `resolveBoxEntries` that
throws would show the repeat starts and the unclosed stream. Fix sketch: move
the resolution into `prepareStart`, or make the throw go through
`failStart`-style cleanup so the record parks as `failed` and the log stream
closes.
