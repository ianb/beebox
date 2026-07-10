---
title: "flaky child output log doctest"
area: callback-box
filed-by: agent
discovered-in: worktree-architectural-review — Phase-2 lint verification runs
---

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
