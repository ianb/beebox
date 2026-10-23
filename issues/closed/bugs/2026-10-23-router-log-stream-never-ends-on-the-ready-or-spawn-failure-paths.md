---
title: "Dev router: the worktree log stream is never ended on the ready or spawn-failure paths"
workstream: unattached
area: router
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — fixing the pre-spawn failure leak
resolution: implemented
---

Resolved: `spawnGeneration` (`workstreams-app/src/router/core/generation.ts`) ends the stream once both children's execa promises have settled, which happens after each process has exited and its stdio has closed. Every teardown path ends in both children exiting, so one place covers stop, idle, child death, failed start and superseded publication. Covered in `workstreams-app/test/router/core.log-stream.test.ts`.

`prepareStart` (`workstreams-app/src/router/core/worktree-start.ts`) opens one
append stream per start through `effects.openLog`. A start that fails before
any child spawns now ends it (`failBeforeSpawn`). The two other terminals do
not: `publishGeneration` leaves the stream open for the children, which pipe
into it with `end: false`, and nothing ends it when the generation later
stops; `failStart` kills the children and parks `failed` without ending it.
Each start of a worktree therefore leaves one open file handle for the life of
the router process.

Found while closing
[the pre-spawn leak](../closed/bugs/2026-10-22-router-test-boxes-resolution-failure-retries-every-request-and-leaks-a-stream.md).
Unproven by a run; the test harness's `openLog` fake now records opened and
ended streams, so a test that starts and stops a worktree twice and counts
unended streams would show it. Fix sketch: end the stream in the teardown that
owns the generation's children (`worktree-teardown.ts`), and in `failStart`.
