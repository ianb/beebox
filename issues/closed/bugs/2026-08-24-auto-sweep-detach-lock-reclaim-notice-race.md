---
title: "auto-sweep-detach.doctest.md: lock-reclaim notice race under load (\"noticed\":false)"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — /finish full-suite re-run
labels: [testing, flake]
priority: important
resolution: implemented
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

**Recurred 2026-08-25** in a full-suite run on `worktree-live-vs-stored` (load
average 23+, a deploy running alongside). Failed once at 25s, passed 6/6 in
isolation immediately after. The branch touched only session-transcript readers,
nothing under `bin/`, `dev/`, or auto-sweep — consistent with the load-race
diagnosis above rather than any regression.


## Fixed 2026-09-12

The issue guessed a flush race in `until()`'s log polling. It was not that —
`auto-sweep.sh:78` writes the "reclaiming stale lock" notice BEFORE running the
sweep, so any log containing `END` must already contain the notice. A late
flush could not produce `noticed:false` alongside `ranAnyway:true`.

What could: the block began with `await until((s) => s.includes("END"))` to let
the previous sweep finish, but **an END in the log is not proof the process
that wrote it has exited.** With the previous sweep still holding the lock, the
new run takes the `kill -0 $holder` branch and logs `SKIPPED (sweep N already
running)` — it never reclaims. Then the stale `END` satisfies `ranAnyway`, and
`noticed` is false forever, exactly as reported.

Two changes:

- Wait for the lock to be **released** (`until(() => !existsSync(lock))`), not
  merely for an END to appear, so the stale lock planted next is the only one
  present.
- Wait on **one predicate** for both strings rather than two sequential
  `until()`s, so a stale END can no longer satisfy the first wait while the
  notice is still absent.

Verified under the conditions in the report — several things running at once:
4 concurrent copies green, 6/6 assertions each, plus solo runs.
