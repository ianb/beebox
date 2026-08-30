---
title: "supervisor.doctest.md and git-lock.doctest.md flake under the full parallel suite"
workstream: low-priority-jobs
area: beebox
filed-by: agent
discovered-in: worktree-low-priority-jobs — /finish full-suite run
labels: [flake]
resolution: implemented
---

`pnpm test` reported two failing files under the full parallel suite, both of
which passed when re-run in isolation immediately after:

- `test/hub/supervisor.doctest.md`
- `test/lib/git-lock.doctest.md`

Neither file nor the code it exercises was touched by the branch that surfaced
this, so it was filed as contention rather than a regression.

## Both had a specific mechanism, and both are fixed

"Contention" was the right instinct but the wrong stopping point: load was the
trigger, not the cause. Each test raced something real, and each race is
reproducible on an idle machine.

### `git-lock.doctest.md` — the FIFO case was asserting a guarantee the lock
### did not actually make

`withBoxGitLock` awaits `resolveLockPath(dir)` before it enqueues, and the
cache held the resolved VALUE. So three concurrent first callers on one
repository all missed the cache, all spawned their own `git rev-parse
--absolute-git-dir`, and reached the queue in whatever order those three
subprocesses happened to exit — not the order they were created. The doctest
asserts `a-enter a-exit b-enter b-exit c-enter c-exit`; a 30-round probe on an
idle machine produced `b-enter b-exit a-enter a-exit c-enter c-exit` once.
Serialization always held — only the ORDER was up for grabs, which is exactly
what the test pins.

Fixed by caching the in-flight promise rather than the settled value, so
concurrent first callers share one `rev-parse` and resume from the same
`await` in the order they attached. That makes the documented "in arrival
order" true on a cold cache instead of usually-true, and stops spawning N
subprocesses for one answer. 120 rounds clean after.

### `supervisor.doctest.md` — the readiness-timeout block raced a live 1s timer

Its readiness-timeout section drives a failing launch, which schedules a real
`setTimeout` retry at `BASE_BACKOFF_MS` (1s), and then asserts `restarts: 1`
twice further down a long `continue` chain. Spend a second anywhere in
between — one slow `makeTmpBox`, one loaded machine — and the retry lands,
readiness rejects again, and `restarts` is 2 under a test that never asked
about a second attempt. Reproduced deterministically by inserting a 1.3s pause
after `startAll()`: `{"immediate":1,"later":2}`.

Fixed by making the first-retry delay injectable (`SupervisorOptions.
baseBackoffMs`, alongside the existing `now` injection and for the same
stated reason) and having that section set it past its own runtime. The
section is about what the readiness-timeout path RECORDS, not about the retry,
so it should not have a live retry running behind its assertions. The
crash-loop policy moved to `src/hub/crash-backoff.ts` to keep `supervisor.ts`
under its line cap.

## Worth noting for the next one of these

Three full suites were running concurrently in one worktree when this
surfaced, which is what pushed both races over their edges. That made "it was
just contention" a tempting and wrong conclusion — the load was real, and so
were the two defects it exposed. A flake that only appears under load is still
a flake with a mechanism.
