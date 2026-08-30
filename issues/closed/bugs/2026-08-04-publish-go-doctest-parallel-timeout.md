---
title: "Publish go doctest waits for confirmation under parallel load"
workstream: turn-buffer-byte-budget
area: beebox
filed-by: agent
discovered-in: worktree-turn-buffer-byte-budget — full-suite verification during finish
resolution: implemented
---

Resolved by `8d3feaf9`. The doctest now sets `process.stdin.isTTY = false`
explicitly, which makes its non-interactive refusal path deterministic and
prevents the publication confirmation prompt from blocking the suite.

`test/publish/go.doctest.md` timed out during a full parallel `pnpm test` run.
The test passed 22/22 when rerun by itself.

In the failed run, the subtest that starts at line 89 printed the live-publish
confirmation prompt and waited for the publication ID. TAP expired the subtest
after about 300 seconds. The next subtest then expired immediately under the
suite alarm.

This branch changed only the turn replay buffer and its doctest. It did not
change this test or the publication code. The isolated run correctly detected a
non-interactive terminal and refused the live transition without prompting.
This suggests that parallel execution can change or leak the terminal state
observed by this test.

Find why the full-suite worker can appear interactive. Make the non-interactive
test setup deterministic under parallel load.
