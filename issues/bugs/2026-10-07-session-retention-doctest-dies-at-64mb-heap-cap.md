---
title: "session-retention doctest's 64 MB child dies of heap exhaustion most runs"
workstream: test-suite-health
area: beebox
labels: [tests, flaky]
filed-by: agent
discovered-in: worktree-knip-sweep — full beebox suite run on 2026-10-07
priority: normal
---

`test/cli/lib/session-retention.doctest.md:30` failed in the full
`pnpm -C beebox test` run on 2026-10-07. The `parseUnderHeapCap` child
exited `SIGABRT` with a V8 heap-limit stack trace and empty stdout.

When run alone it also fails, without load:

- On the knip-sweep branch: 1 of 3 runs failed.
- On `a3df03887` (main before the sweep): 4 of 6 runs failed.

This is the same failure that
`issues/closed/bugs/2026-10-02-session-oversize-lines-flakes-under-load.md`
fixed for `session.oversize-lines.doctest.md` (`50961ada5`). That fix kept the
64 MB cap here because this doctest passed 30 of 30 runs at that time. The
margin is now gone. tsx and the module graph hold ~25-45 MB before the parse
starts, so a small increase in import cost is enough to push the child past
64 MB.

Possible step: use the same approach as the sibling doctest. Assert on the heap
that the parse result retains after a forced GC, under a 128 MB backstop
cap, and stop relying on whether the child survives 64 MB.
