---
title: "flaky child output log doctest"
area: callback-box
filed-by: agent
discovered-in: worktree-architectural-review — Phase-2 lint verification runs
resolution: implemented
---

**Resolved (worktree-fix-bugs).** Root cause: `forwardStream`
(`callback-box/src/hub/child-output-log.ts`) called `void appendRollingLog(...)`
fire-and-forget per line, and `appendRollingLog` (`callback-box/src/lib/rolling-log.ts`)
is multi-step async (mkdir → appendFile → stat → maybe truncate) with no
serialization — concurrent calls, cross-stream and same-stream alike, could
complete out of order, an in-process async race rather than a POSIX pipe
ordering issue. Fix: `rolling-log.ts` now keeps a module-level
`Map<string, Promise<void>>` chaining each call for a given file path off the
previous in-flight promise for that path, clearing the entry once its chain
drains. Verified 30/30 on `pnpm exec tap run test/hub/child-output-log.doctest.md`
in a loop (previously ~15-20% failure in isolation per the prior investigator).

`callback-box/test/hub/child-output-log.doctest.md` fails intermittently on
an assertion about interleaved stdout/stderr ordering from a spawned child —
reproduced identically on an untouched tree (changes stashed), so it's a
pre-existing race in the test (or in the log capture it exercises), not
regression fallout. Seen failing 1-in-a-few full-suite runs during the
2026-07-09 follow-ups round; the rest of the suite (3394 tests) was green.

Two plausible causes to check when picking this up: the test asserting a
cross-stream ordering that POSIX pipes don't guarantee (test bug — assert
per-stream ordering only), or the child-output logger genuinely losing
ordering it promises elsewhere (code bug). Determine which before fixing.
