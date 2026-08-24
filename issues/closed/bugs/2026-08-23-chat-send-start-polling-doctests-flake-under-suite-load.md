---
title: "Chat-send start polling doctests flake under full-suite load"
workstream: node-env-production
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-node-env-production — finish suite rerun after main advanced
resolution: implemented
---

Closed 2026-08-24 by `3c56246c`. Both doctests now wait on the operation's own completion
signal instead of a ten-second polling deadline, and they finish background
session work before tearing down their test boxes. The focused tests, a
40-execution contention run, lint, typecheck, and the full callback-box suite
passed.

Two chat-send doctests can exhaust their polling window before asynchronous
session startup publishes the expected state under full-suite load.

The 2026-08-23 finish run used the configured six-way parallel suite. It
reported these failures:

- `test/webapp/chat-send-fast-ack.doctest.md:87` observed
  `started=false | errored=null` instead of `started=true | errored=null`.
- `test/webapp/chat-send-run-start-failure.doctest.md:60` observed no error
  frame and `complete=false` instead of the injected `spawn EBADF` failure and
  `complete=true`.

The surrounding logs showed delayed `generateDocs` work and hook processes
that received signal 9. Both files passed immediately in isolation: 3/3
assertions for `chat-send-fast-ack` and 4/4 for
`chat-send-run-start-failure`. The branch did not change either test or the
chat-start code they exercise.

The tests already poll, but their bounded wait is not sufficient under suite
contention. Investigate a deterministic readiness signal or a poll condition
that follows the operation's actual completion boundary. Do not solve this by
adding a larger fixed delay.

## Resolution

`chat-send-fast-ack.doctest.md` exposes a promise that resolves when the real
patched send operation settles. `chat-send-run-start-failure.doctest.md` waits
on `TurnBuffer` version changes for turn completion and yields to the fake
backend until its run is observable. Successful and gated sends are also
allowed to settle before test-box cleanup, eliminating teardown races with
background document generation.
