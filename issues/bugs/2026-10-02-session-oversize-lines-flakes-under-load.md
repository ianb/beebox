---
title: "session.oversize-lines doctest flakes under full-suite load with empty child stdout"
workstream: unattached
area: beebox
labels: [tests, flaky]
filed-by: agent
discovered-in: worktree-knip-sweep — two full beebox suite runs on 2026-10-02
priority: normal
---

`test/cli/lib/session.oversize-lines.doctest.md` failed in both full
`pnpm -C beebox test` runs on 2026-10-02 at line 65 with `SyntaxError:
Unexpected end of JSON input`. It passes when run alone (15/15, three times).

The test spawns `test/helpers/parse-session-log-child.ts` under
`--max-old-space-size=64` with `--import tsx` and parses its stdout. Empty
stdout means the child exited without printing. The likely cause is that the
child ran out of heap: tsx's startup cost plus the parse may sit near 64 MB,
and GC timing under parallel load can push it over. This is not confirmed,
because the test keeps the child's `stderr` and exit code but asserts on
`JSON.parse(run.stdout)` first, so the failure output shows neither.

Possible steps:

- Print `run.code` and `run.stderr` before parsing, so the next failure
  names its cause.
- If the cause is the heap, measure the child's baseline heap with an empty
  log and set the cap relative to it.
