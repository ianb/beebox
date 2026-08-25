---
title: "auto-sweep-detach.doctest.md: lock-reclaim notice race under load (\"noticed\":false)"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — /finish full-suite re-run
labels: [testing, flake]
---

`test/dev/auto-sweep-detach.doctest.md:72` (`await fakeSweep(2);`), assertion
at line 138, failed once during a `/finish` full-suite `pnpm test` re-run
(7914 total, 7913 pass, 1 fail — this was the only failure) while several
sibling worktree sessions were running their own test/lint/typecheck
concurrently on the same machine:

```
expected: {"noticed":true,"ranAnyway":true}
  actual: {"noticed":false,"ranAnyway":true}
```

`ranAnyway` was correct; only the "reclaiming stale lock" notice line was
missing from the captured log, consistent with a timing race reading the
sweep's log output under load rather than a logic defect — the sweep still
did the right thing (`ranAnyway:true`), only the detection of its own log
line was late/missed.

Passes cleanly in isolation: `npx tap -j1 test/dev/auto-sweep-detach.doctest.md`
→ 6/6. The branch that surfaced this (`worktree-user-stories-refresh`) touches
no file under `bin/`, `dev/`, or anything related to auto-sweep/session-end —
see its diff (`user-stories/`, `session-content.ts`, `issue-domain.ts`,
workflow scripts, `issues/`).

Not yet reproduced twice, so filed rather than fixed. If it recurs, look at
whether `fakeSweep`'s log-polling `until()` helper has a race against when
the "reclaiming stale lock" line is flushed relative to the other lines it
checks for.
