---
title: "Auth command doctest loses expected global state under parallel load"
area: callback-box
filed-by: agent
discovered-in: worktree-turn-buffer-byte-budget — full-suite verification during finish
resolution: implemented
---

Resolved by `8d3feaf9`. The doctest now sets `process.stdin.isTTY = false`
explicitly, so its agent-safety assertions do not depend on the test runner's
terminal.

`test/cli/auth-command.doctest.md` failed during a full parallel `pnpm test` run.
The test passed 17/17 when rerun by itself.

The full-suite run failed checks 13, 14, and 16 in the subtest that starts at
line 73. The process returned `undefined` where the test expected `"1"` for the
global-scope flag. The resulting diagnostic omitted all five expected signals,
and the unrecoverable-state refusal check returned `refused: false`.

This branch changed only the turn replay buffer and its doctest. It did not
change this test or the authentication command code. The isolated pass suggests
that another parallel test changes process-global state or otherwise interferes
with the command environment.

Find the shared state that leaks into this test. Make the test or command setup
independent of parallel test order.
