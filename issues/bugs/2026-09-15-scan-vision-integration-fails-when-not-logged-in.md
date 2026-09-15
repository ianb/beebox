---
title: "scan-vision integration doctest errors instead of skipping when Claude Code is not logged in"
workstream: glm-v2-layout
area: beebox
priority: normal
labels: [tests, environments]
filed-by: agent
discovered-in: full beebox suite runs, worktree-glm-v2-layout 2026-09-15 (also in ledger on HEAD 2026-09-11)
---

`test/services/scan-vision-claude-integration.doctest.md` shells out to a real
Claude Code subprocess. When the invoking environment has no Claude login, the
call rejects with `ClaudeScanSubprocessError: Not logged in · Please run
/login` and the doctest reports a failure rather than a skip. The skip-reason
plumbing exists (the block guards on `skipReason`), but whatever decides
"credentials available" does not catch this state.

Seen twice on this machine (2026-09-11 and 2026-09-15 ledger records, both
unimplicated by the running changes). Environmental, not a product bug — the
suite goes red for anyone running the full beebox suite without a logged-in
Claude in the test context.

Fix shape: detect the not-logged-in error in the skip decision and emit a TAP
skip with that reason, so the integration tier still runs when credentials
exist and degrades to a visible skip when they don't.
