---
title: "`bin/workstreams sweep`'s live-agent guard fails OPEN when ps/lsof can't answer"
area: bin
filed-by: agent
discovered-in: worktree-codex-exit-cleanup — cross-model (codex) review of the codex teardown work
design: ../../../callback-box/docs/plans/worktree-control-surface.md
resolution: implemented
---

Resolved 2026-08 in `worktree-worktree-seam` (the worktree control surface
refactor, Track B). `bin/workstreams sweep` now uses the shared tri-state
`wt_other_agent_live` via `wt_agent_snapshot_capture`, so a `ps`/`lsof` that
can't answer skips the worktree instead of authorizing the delete. The
secondary issue named below (the argv signal's name pattern) is also
addressed — worktree names are now validated at the CLI boundary
(`wt_paths_valid_name`), and the shared guard checks process cwd in addition
to argv, so a name that doesn't match the argv pattern still resolves via cwd.

> **Was being fixed as part of a plan.** Track B / chunk 2 of
> [the worktree control surface plan](../../../callback-box/docs/plans/worktree-control-surface.md)
> took the "fold sweep onto `wt_other_agent_live` with a snapshot passed in"
> option sketched below.

`bin/workstreams sweep` removes a worktree when it is merged + clean + has no
active agent session. The active-session guard stands in front of an
irreversible delete, but unlike its counterparts it treats "I couldn't find
out" as "nothing is running":

- `bin/workstreams:145` — if `ps -axo command` fails, `active` is empty and the
  argv signal silently matches nothing.
- `bin/workstreams:155-160` — if `lsof` fails or returns nothing for pids we know
  are alive, `active_cwds` is empty and the cwd signal silently matches nothing.

Both signals then say "no active session" and removal proceeds
(`bin/workstreams:193-224`). Concrete trigger: a live codex session is cwd'd in a
merged + clean worktree, `lsof` returns empty or non-zero during that sweep, and
the worktree is deleted out from under it.

This is the same class of bug the SessionEnd path already fixed. The shared
`bin/lib/worktree-teardown.sh` (`wt_other_agent_live`) distinguishes
`none` / `live` / `unknown` and its callers treat `unknown` as `live`; sweep
predates that and still collapses the three into two. Sweep is also the *most*
consequential caller, since it fires unattended from `auto-sweep.sh` at every
session start and end.

Same file, lower severity — sweep's argv signal only recognizes worktree names
matching `[a-zA-Z0-9_-]+` (`bin/workstreams:145`), so a hand-made worktree named
`foo.bar` running as `claude --worktree foo.bar` from the main checkout matches
neither signal (its cwd is main). `bin/launch-worktree-session:79-82` rejects
such names, so this only reaches manually created worktrees.

## Why it wasn't fixed in place

Found during the cross-model review of the codex-teardown change, which
deliberately left sweep alone: sweep takes ONE process snapshot and reuses it
across N worktrees, and removes with `git worktree remove --force` rather than
the trash-mv the hooks use, so converging it onto the shared lib is its own
change with its own risk. That change did make sweep run somewhat more often
(`bin/codex-session-end` triggers `auto-sweep.sh` on the way out too).

## Fix sketch

Make the two signals distinguish failure from absence — capture exit status
rather than emptiness, and skip the worktree (with a printed reason) when
either can't answer. Then either fold sweep onto `wt_other_agent_live` with a
snapshot passed in, or keep its batched form and mirror the tri-state.
