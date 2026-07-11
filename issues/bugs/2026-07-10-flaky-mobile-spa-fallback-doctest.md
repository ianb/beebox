---
title: "mobile-spa-fallback doctest flakes under parallel suite runs"
area: callback-box
filed-by: agent
discovered-in: worktree-chat-steering — running the full suite after the agent-SDK 0.3 bump
---

`test/webapp/mobile-spa-fallback.doctest.md` failed (exit 1, jobId 1) in a full
`pnpm test` run but passes cleanly when run in isolation
(`pnpm exec tap run test/webapp/mobile-spa-fallback.doctest.md` → 4/4). Likely
parallel-run resource contention rather than a real defect — same family as
[2026-07-09-flaky-child-output-log-doctest](../closed/bugs/2026-07-09-flaky-child-output-log-doctest.md).
The failing full-run output didn't surface a per-assertion diff (the child
exited 1 with the failure detail above the TAP summary), so next occurrence,
capture the file's own stdio from the parallel run before rerunning.

## Research (2026-07-11)

Could not reproduce (worktree-fix-bugs bug-queue validation): 20/20 isolated
runs pass, and ~120 stress runs (up to 20 concurrent copies of this file plus
the suite's heaviest doctests alongside) produced 0 failures. The doctest has
no obvious contention vector — `Fastify().inject()` opens no socket,
`makeTmpBox()` gets a unique tmpdir, pairing state is process-local. Best
current theory: it was an occasional victim of the suite-wide
timeout/thundering-herd hazard `.taprc` already documents at `jobs: 6` (a
SIGALRM'd child matches "exit 1 with no per-assertion diff" better than an
assertion race). Note the sibling child-output-log flake turned out to be a
REAL logger bug (unserialized `appendRollingLog`), now fixed — so "same
family" no longer holds. Keep the original next step: on next occurrence,
capture this file's own stdio from the parallel run.

Trap for investigators: without a built `src/frontend/dist` this doctest fails
100% deterministically (SPA fallback ENOENT → 500) — run `pnpm build:frontend`
first; that failure is not the flake.
