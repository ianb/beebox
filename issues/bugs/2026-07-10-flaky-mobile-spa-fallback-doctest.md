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
[2026-07-09-flaky-child-output-log-doctest](2026-07-09-flaky-child-output-log-doctest.md).
The failing full-run output didn't surface a per-assertion diff (the child
exited 1 with the failure detail above the TAP summary), so next occurrence,
capture the file's own stdio from the parallel run before rerunning.
