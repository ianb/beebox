---
title: "schema-watcher test: a chunked write sometimes never invalidates within 5 s"
workstream: schema-watcher-flake
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

## Cause (2026-11-12, workstream schema-watcher-flake)

No probe showed a lost event; the delay is in delivery. On macOS, `fs.watch` on a directory
(recursive or not) goes through FSEvents. With `fseventsd` near 80–100% CPU,
a standalone probe saw FSEvents deliver a write 0.2–10.5 s late; kqueue
on the file saw it within 1 ms and 100 ms polling within 85 ms. A 2-minute
probe delivered all 24 writes. Inside the test, delivery took 3.6–9.1 s,
and once over 30 s. Two more effects broke the test's claims: FSEvents
split one burst into two batches 165 ms apart (two invalidations), and
it delivered the scaffold's `src/schemas` writes from before the watch
started, so a "pass" could come from those instead of the test's write.

Not established: that FSEvents never loses an event. One in-test write
went unseen for over 30 s, and that run did not wait long enough to tell
whether it was late or lost. The watcher has no fallback: a final write
whose event never comes leaves the old schemas cached until the manual
reload endpoint or the daily recycle. Production runs on Linux, where
Node's `fs.watch` uses inotify, so these probes say nothing about
production. On a busy Mac, hot reload lags by the FSEvents delay. A split
burst invalidates twice; if a load runs between the two, the schemas
are rebuilt once more.

Fix: the test now uses a fake `fs.watch` and a mocked clock for the burst
rule, and checks the watch's directory and options through the same fake.
Nothing in the file waits on the OS.
