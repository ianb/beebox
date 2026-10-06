---
title: "session.oversize-lines doctest flakes under full-suite load with empty child stdout"
workstream: test-suite-health
area: beebox
labels: [tests, flaky]
filed-by: agent
discovered-in: worktree-knip-sweep — two full beebox suite runs on 2026-10-02
priority: normal
resolution: implemented
---

**Closed 2026-10-06 (test-suite-health, `50961ada5`).** Cause confirmed: heap death. With the exit code and stderr surfaced, the failing child printed `FATAL ERROR: Reached heap limit`. tsx plus the module graph holds ~25-45 MB before parsing, and the bounded parse peaks near 64 MB, so whether it died depended on GC timing: 6 of 10 direct runs at the cap failed, with no load. The codex-plugin-hooks landing did not change the import cost (`session.ts` retains ~7 MB before and after it); the margin was already that thin. No tight cap separates the cases: an unbounded parse survived 96 MB. The doctest now asserts on the heap the parse result retains after a forced GC (bounded ~0 MB, unbounded 30 MB, deterministic) under a 128 MB backstop cap. 8/8 runs, five under CPU load; it fails with the bound removed. The session-retention doctest shares the harness and keeps its 64 MB cap (30/30 under load at that fixture).

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
