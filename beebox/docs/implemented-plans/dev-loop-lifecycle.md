---
title: "Dev-loop lifecycle: stop the dev processes from interfering with each other"
status: implemented
workstream: dev-loop-lifecycle
issues:
  - ../../../issues/closed/bugs/2026-08-20-session-end-hook-cancelled-by-slow-sweep.md
  - ../../../issues/closed/bugs/2026-08-21-browse-reaper-kills-other-sessions-daemons.md
  - ../../../issues/closed/bugs/2026-08-15-main-runtime-stays-stale-after-deploy-build.md
---

# Dev-loop lifecycle: stop the dev processes from interfering with each other

Three filed bugs are the same shape: **one dev-loop process assumes an ownership
it does not have, and the resulting failure looks like something else.** The
sweep assumes it owns the ending session's lifetime; the `bin/browse` reaper
assumes it is the worktree's only user; the router assumes the hub it started is
still running current source.

Each presents as a different, wrong thing — "cleanup just didn't happen", "the
browser is flaky", "the fix didn't work".

## Evidence gathered before planning

From `~/.cache/beebox/worktree-cleanup.log` (449 lifecycle entries,
2026-07-11 → 2026-08-24):

| `auto-sweep trigger=` | START | END |
|---|---|---|
| `session-end` | 109 | **94** |
| `session-start` | 44 | 44 |
| `codex-session-end` | 72 | 72 |

Only the session-end path loses sweeps. It loses them **even when the hook
itself succeeds** — 2026-08-20T12:26:14 started a sweep, the hook logged
`decision=clean` at 12:26:15 and finished, and that sweep never logged `END`.

Separately, 11 of 44 SessionEnd invocations that resolved a worktree logged
`resolved worktree=` and then no `decision=` line at all: top-nav-ia,
workstreams-rehearsal, watcher-flake, box-git-lock, browse-capture-hang,
low-priority-jobs, commit-performance, annex-bypass-check, emission-model,
ios-retranscribe, secret-custody.

Measured on this machine with 22 worktrees and 15 live agent processes, the work
between those two log lines (`ps -axo pid=,comm=` plus one
`lsof -a -d cwd -p <15 pids>`) costs **~30 ms**, not seconds.

## What the evidence changes

The filed issue reads the SessionEnd failure as "the expensive global sweep runs
first and eats the hook's budget". That is not what happens: `auto-sweep.sh` has
run its sweep backgrounded and `disown`ed since 2026-07-11 (`f91df58e`), so the
hook returns from the sweep trigger in milliseconds and never spends 25 s
inline. There are **two independent defects** wearing one issue:

**A. The detached sweep is killed at session exit.** `disown` removes the job
from bash's job table; it does not leave the process group
(`.claude/hooks/auto-sweep.sh:45-51`). When the Claude CLI exits, the group
teardown takes the sweep with it. This is why only the `session-end` trigger
loses sweeps, and why it loses them independently of whether the hook succeeded.

**B. The hook is cancelled somewhere after resolving its worktree.** The
mechanism here is *not* established, and this plan does not pretend otherwise.
The steps between the two log lines are `wt_other_agent_live`
(`bin/lib/worktree-teardown.sh:237-282`, measured ~30 ms) and then
`wt_work_state` (`bin/lib/worktree-teardown.sh:319-343`), which runs
`git rev-parse`, `git rev-list --count main..HEAD`, and `git status --porcelain`
against the worktree — all unbounded, and all executing while the sweep this
same hook just launched is running `git status` across every other worktree.
Contention is the leading hypothesis, but a blocking git lock is not excluded by
anything we can see. The 2026-08-20 `"timeout": 300` mitigation does look
effective — 14 resolved sessions since 2026-08-21, all decided within 0–6 s
(p ≈ 0.02 under the prior 25 % failure rate) — which argues for slow rather than
blocked, without proving it.

**So the ordering tension the issue names does not dissolve, it relocates.** The
sweep is already asynchronous, so it does not need to move *down*. But it does
need to stop overlapping the hook's own git work, and the hook needs to leave
enough evidence to settle B the next time it happens.

## Track 1 — SessionEnd sweep and teardown

### 1.1 Fire the sweep from a `trap … EXIT`, not inline

This is the resolution of the ordering constraint. The hook's comment is right
that the sweep must sit above the early `exit 0`s or it never fires in the
common case — but that is an argument about *reachability*, not about position.
An `EXIT` trap installed at the top of the hook is reached from every exit path,
including all six early `exit 0`s and the failure paths, and it runs **after**
the local teardown decision.

So the sweep gets its "fires on every session end" property, the cheap specific
job gets to go first, and the two stop sharing a moment.

### 1.2 Detach the sweep for real

`disown` is not detachment. macOS ships no `setsid(1)`, so use a small Node
helper spawned with `detached: true` + `unref()`, which calls `setsid(2)` via
libuv and gives the sweep its own process group and session leader. This matters
more once 1.1 lands, not less: the sweep now starts precisely as the session is
tearing down.

### 1.3 Serialize sweeps

A sweep that is already running makes a second one pure contention. Take an
exclusive lock (atomic `mkdir` on `$WT_STATE_DIR/sweep.lock`, holding the
owner's pid so a lock left by a killed sweep is reclaimable) and **skip** rather
than queue — the next session start or end triggers another one anyway.

### 1.4 Make an interrupted sweep visible, and time the hook's own steps

A killed sweep currently leaves a `START` with no matching line —
indistinguishable in the log from one still running. Add a trap that writes
`auto-sweep trigger=<t> INTERRUPTED sig=<n>` on SIGTERM/SIGHUP/SIGINT. This
cannot catch SIGKILL; a `START` with neither `END` nor `INTERRUPTED` then means
exactly that, which is itself the diagnosis.

For B, log elapsed milliseconds for `wt_other_agent_live` and `wt_work_state`
separately. Today a hook that dies between `resolved` and `decision` tells us
nothing about which of the two it died in. That is the evidence this plan is
missing, and it costs two `date` calls.

### 1.5 Keep the mitigation

`"timeout": 300` stays on both sweep-running hooks.

**Explicitly not doing:** having the sweep skip the worktree the ending hook
owns. Once 1.1 lands they no longer overlap, so there is nothing to skip for —
and a skip would open a real hole: a hook that dies before deciding would leave
that worktree uncleaned by the very sweep that exists to catch it.

## Track 2 — `bin/browse`'s reaper

`bin/browse:100-115` collects the pids named by `*.pid` files in the worktree's
socket dir and kills every `agent-browser` process launched from this repo that
is not in that set.

**Measured, this worktree, 2026-08-24:** a fresh `bin/browse` spawns
`agent-browser` processes at T+1 s and its socket dir contains **no `.pid` file
at all until T+3 s**. For those ~2.5 seconds the daemon is unvouched, and any
concurrent `bin/browse` in the same worktree kills it. That is the whole bug.
`--session` isolation does not help because the window is per-daemon, not
per-session.

Two changes, no new machinery:

**2.1 Stop maintaining a second copy of the predicate.** `bin/process-cleanup.ts`
already owns this decision (`classifyAgentBrowser`, `bin/process-cleanup.ts:243-249`)
and its header says in as many words: "Extend the shared guard; never grow a
second one here" (`bin/process-cleanup.ts:32-33`). The bash reaper in `bin/browse`
is that second copy, and it is the fail-open one. Delete it and call the shared
module.

Within its own worktree `bin/browse` does not need the liveness oracle: the
caller *is* the live session, so it passes `live` directly — the same answer the
oracle would give, without the subprocess.

**2.2 Add the missing input to the shared predicate: process age.** A process too
young to have registered a pidfile cannot be *proven* an orphan, so it must not
be killed. `classifyAgentBrowser` gains an age argument and spares any unvouched
process younger than 60 s. This is a correctness fix to the predicate, not a
band-aid: it closes the same window for `bin/workstreams panic` and the router's
startup sweep, which have it too.

**Explicitly not doing:** the shared/exclusive lock design considered first. A
lock proves "no other browse is running", but the reaper runs inside a browse, so
it would need self-exclusion or upgrade semantics to be usable at all — and once
the age guard is in, the lock proves nothing the age guard has not already
established.

## Track 3 — the stale main hub

The box-child half is already solved: `bin/bbx` stamps
`BBX_DEV_BUNDLE_PATH`/`BBX_DEV_BUNDLE_ID` at spawn and `src/webapp/server.ts` polls
for a replacement, draining before it re-execs. The gap is that the **hub itself**
is spawned by the router (`bin/router-core.ts:417-420`) as
`node --import=./tsx-preload.mjs --import tsx ./src/cli/index.ts hub`, never
through `bin/bbx`, so it is never stamped and never checks.

**This track detects and reports staleness. It does not restart anything.**

- At hub spawn, record a *source generation token* for the checkout: the newest
  mtime across the backend source the hub actually loads — `beebox/src`
  minus `src/frontend` (Vite HMRs that half), plus `beebox/package.json`.
  Measured at 16 ms over 1006 files, and it is recomputed at most once every
  5 s.
- Git `HEAD` was the first choice and is wrong: the hub runs TypeScript from
  source through tsx, so `HEAD` misses uncommitted edits entirely and misfires on
  commits that touch nothing the hub loads.
- On `ensureRunning` for a `ready` handle, compare. On mismatch, mark the handle
  **stale**, log it once, and surface it in the router's state — `/__router`,
  `bin/workstreams list --json`, and the `bin/workstreams` status line.

**Why not restart.** The plan first proposed replacing a stale generation once
the router had seen no activity for 3 s. That quiet window is not a safety
property: `touch()` records HTTP activity only (`bin/router-core.ts:301-315`),
and this repo's own documented lifecycle says WebSockets never count as worktree
activity. A live chat streaming over a WebSocket looks perfectly quiet to the
router. Restarting on that signal would cut the boxholder's chat to fix a
staleness they may not be waiting on.

The reported cost of this bug was an agent losing time to a fix that had landed
but was not running — a cost paid entirely because staleness was *invisible*.
Making it visible pays that back. The remedy is already one command
(`bin/workstreams down main`), and a human choosing when to run it is strictly
better than the router guessing.

## Testing

- Track 1: shell-level, in `beebox/test/dev/*.doctest.md` per
  `bin/CLAUDE.md` — the `EXIT` trap firing on early-exit paths, lock
  acquisition/skip, stale-lock reclaim, and the `INTERRUPTED` trap.
- Track 2: unit tests for `classifyAgentBrowser`'s new age dimension, including
  the unvouched-and-young case that is the reported bug.
- Track 3: `bin/router-core.test.ts` (not `router-lifecycle.test.ts`, which is
  pure transition-table coverage) holds the injected-effects harness — clock,
  spawner, timers — which is what a throttled staleness check needs to be tested
  deterministically. Extending that suite rather than writing a doctest is the
  right call despite `bin/CLAUDE.md`'s default.

## Sequencing

Track 2 first (self-contained, unblocks parallel agents in one worktree), then
Track 1 (touches teardown, which stands in front of an irreversible delete),
then Track 3 (largest, and the only one that touches the request path).
