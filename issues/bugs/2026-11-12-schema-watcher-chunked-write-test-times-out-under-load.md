---
title: "schema-watcher test: a chunked write sometimes never invalidates within 5 s"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-web-guidance-scan — change-selected test runs
---

`beebox/test/core/schema-watcher.test.ts`, test "a write in three chunks
invalidates once, after the last", fails intermittently:

```text
not ok 2 - invalidation was not true after 5000ms; last value: false
```

Seen on 2026-11-11 and 2026-11-12 in several `test:changed` runs in the
`web-guidance-scan` worktree, and once run alone (fail, then pass on the
next run). The same file passed alone on `main` at `7d0de419d`. The branch
does not change the watcher, its test, or its dependencies.

Each failure came while `fseventsd` used 85–105% CPU and the load average
was 15–120. File events may be delayed past the test's 5 s wait. Not
checked: whether the watcher drops the event or only delivers it late, and
whether the debounce or the test's wait is the part that is too tight.

The file is not in `beebox/test/careful.txt`; that list says a
timing-sensitive file is a flake to fix, not to add.

2026-11-12, later: run alone three times each, alternating, on `main`
(`7d0de419d`) and on the branch at load average about 15: it failed all six
times on both. It is not specific to the branch; it now fails on `main` too
in this environment.
