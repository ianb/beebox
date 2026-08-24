---
title: "SessionEnd hook gets cancelled mid-sweep, so worktree cleanup silently stops — and it gets worse the more worktrees there are"
workstream: streams-and-issues
design: ../../../callback-box/docs/plans/session-end-sweep-detachment.md
area: monorepo
labels: [worktrees, hooks, cleanup]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder hit it closing a worktree session
priority: important
resolution: implemented
---

> **Resolved 2026-08-24.** The 300-second hook timeout remains defense in
> depth, but global sweep no longer runs in SessionEnd's process group. See the
> resolution below.

Closing a worktree session printed:

```
SessionEnd hook [.claude/hooks/session-end.sh] failed: Hook cancelled
```

The hook was killed part-way through, before it did the job it exists for.

## What the log shows (2026-08-20)

`~/.cache/callback-box/worktree-cleanup.log`:

```
22:43:14 SessionEnd event: session=620830c5 reason=prompt_input_exit cwd=…/secret-custody
22:43:14 SessionEnd resolved worktree=…/secret-custody
22:43:14 auto-sweep trigger=session-end START
```

Then nothing. No `auto-sweep … END`, no `decision=` line. The hook resolved its
worktree correctly, entered the global sweep, and died there.

**It had work to do.** That worktree is `ahead=0, dirty=0` on
`worktree-secret-custody` — precisely the state
`session-end.sh` auto-cleans. It is still on disk, because the decision code
sits *after* the sweep and was never reached.

## Why it timed out

- **No `timeout` is configured** for the hook (`.claude/settings.json:40-48`),
  so it runs under Claude Code's default budget.
- **The sweep is not cheap and scales with worktree count.** `bin/workstreams
  list` alone — strictly less work than the sweep, which also does teardown
  decisions, box state, and an exhibits orphan scan — measured **25.6 seconds**
  across the 21 worktrees present. A prior sweep the same day (19:56) completed;
  three more worktrees were created at 21:52, 22:24 and 22:33, and the next one
  didn't.

So this is a threshold that was crossed, not a one-off.

## The part that makes it degrade rather than just fail

The sweep's cost is a function of how many worktrees exist. When the sweep is
killed, worktrees that should have been removed stay. That makes the next sweep
slower, which makes cancellation more likely. **The mechanism gets least
reliable exactly when there is most for it to do.**

It is at least fail-safe: nothing is destroyed, work is never lost. The failure
mode is accumulation, which is the same thing the sweep was built to stop —
`session-end.sh` notes the original motivation, "a long-lived main session
accumulated finished worktrees all day (2026-07-19: nine piled up in one
session)."

## The ordering is the actual defect

The hook does two jobs, and they are in the wrong order:

1. **A global sweep** over every worktree — expensive, unbounded, and not
   specific to the session that just ended.
2. **Tearing down this session's own worktree** — cheap, bounded, and the one
   thing this invocation uniquely knows how to do.

The expensive shared job runs first and starves the cheap specific one. And the
placement is deliberate — the hook's own comment says the sweep "Must be here,
above the early `exit 0`s, or it never fires in the common case" — so it can't
simply be moved down without losing the property that put it there.

That tension is the thing to resolve. Some directions, none obviously right:

- **Detach the sweep** so the hook returns immediately and the sweep runs
  fire-and-forget. Keeps the "fires on every session end" property while taking
  it off the hook's budget. Needs thought about concurrent sweeps.
- **Do the specific teardown first, sweep second.** Guarantees the session's own
  worktree is always handled; the sweep becomes best-effort. Straightforward,
  and arguably the honest priority.
- **Give the hook an explicit generous `timeout`.** Cheapest, but only moves the
  threshold — the loop above still applies.
- **Make the sweep incremental or cheaper.** 25s for ~21 worktrees suggests
  per-worktree git and process work that could be bounded or cached.

## Worth checking while in here

- Whether `reason=prompt_input_exit` shortens the budget versus other exit
  reasons — the CLI may be tearing down while the hook still runs.
- Whether a cancelled sweep can leave partial state (the log's `START` with no
  `END` is currently the only trace that anything was interrupted).
- Whether the same starvation applies to the SessionStart sweep path.

## Resolution

`auto-sweep.sh` is now a fast trigger plus a detached worker. On macOS the
trigger submits a uniquely labeled launchd job, records `SUBMITTED`, and
returns; the worker records `START`, output, and `END status=…`, then unloads
its own label from an EXIT trap. SessionEnd therefore proceeds immediately to
its session-specific liveness and teardown decision regardless of global sweep
duration.

Every trigger writes a request marker. Detached workers queue on a kernel-owned
whole-sweep lock; one consumes pending requests and excess workers coalesce, so
an overlapping SessionStart/SessionEnd trigger produces one trailing sweep
instead of being dropped. The lock descriptor is closed in the sweep child so
detached trash reapers cannot extend lock ownership. Lock timeout/tool failures
are distinct and visible.

The doctest launches a genuinely blocked worker through a fake launchctl and
proves the trigger exits first, then covers queued/coalesced workers, terminal
failure logging, lock-tool failure, and label removal. A real macOS launchd
fixture canary produced `SUBMITTED`, `START`, fake sweep output, and `END
status=0`, with the job confirmed unloaded afterward.
