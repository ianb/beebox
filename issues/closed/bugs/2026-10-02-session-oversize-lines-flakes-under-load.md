---
title: "session.oversize-lines test flakes under full-suite load (heap-capped parse child dies)"
workstream: flaky-tests
area: beebox
labels: [tests, flaky]
filed-by: agent
discovered-in: worktree-knip-sweep — two full beebox suite runs on 2026-10-02
priority: normal
resolution: implemented
---

Closed 2026-10-18 by `14b6ea5ec` (flaky-tests): the heap cap is gone, so the death it caused cannot recur; see "Heap cap removed" below.

**Reopened 2026-10-18 (doctest-typecheck).** `test/cli/lib/session.oversize-lines.test.ts`, test "40 giant lines of ~1.2 MB payload each", failed in a full `pnpm -C beebox test` run with `parse child exited SIGABRT with stdout ""` and a V8 fatal-error stack in stderr, so the 128 MB backstop cap is not always enough. Host load average was 13 (other sessions running). The same file passed alone before and after (14/14). The change under test touched only a comment in this file.

**Closed 2026-10-06 (test-suite-health, `50961ada5`).** Cause confirmed: heap death. With the exit code and stderr surfaced, the failing child printed `FATAL ERROR: Reached heap limit`. tsx plus the module graph holds ~25-45 MB before parsing, and the bounded parse peaks near 64 MB, so whether it died depended on GC timing: 6 of 10 direct runs at the cap failed, with no load. The codex-plugin-hooks landing did not change the import cost (`session.ts` retains ~7 MB before and after it); the margin was already that thin. No tight cap separates the cases: an unbounded parse survived 96 MB. The doctest now asserts on the heap the parse result retains after a forced GC (bounded ~0 MB, unbounded 30 MB, deterministic) under a 128 MB backstop cap. 8/8 runs, five under CPU load; it fails with the bound removed. The session-retention doctest shares the harness and keeps its 64 MB cap (30/30 under load at that fixture).

## Heap cap removed (2026-10-18, flaky-tests)

A heap cap on the tsx child was the wrong instrument. tsx and the module graph hold ~75 MB live before the parse (measured after a forced GC), so any cap mixes the parse's bound with that baseline and with when V8 gets to collect. The session-retention failures in the logs (SIGABRT, 2026-10-06/07) were the same death at its old 64 MB cap.

Change: the child runs without `--max-old-space-size`. It samples the live heap (forced GC, then `heapUsed`) every 50 ms while the parse runs and reports `peakLiveMb` beside `retainedMb`. A live-set sample does not depend on GC timing. Scheduling decides only which moments are sampled, so a missed sample can hide a regression but cannot fail a correct parse. `parse-under-heap-cap.ts` is now `parse-in-child.ts`.

Measured: retention tail 13 MB peak (keep-every-entry-then-slice mutation: 106-114 MB, and `retainedMb` stays 13, so only the peak catches it); page 3 MB; oversize 0 MB retained / 3 MB peak (byte bound removed: 31 / 33 MB). Assertions: `below(40)` for retention (the 32 MiB `MAX_RETAINED_BYTES` plus slack), `below(8)` for oversize. The retention test fails against the mutation.

Runs: 10/10 with load average 365-765 (other workers), 20/20 sequential with load 45-600. No failure observed before the change in this session either; the evidence is the removed mechanism.

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
