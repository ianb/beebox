---
title: "Worktree teardown trashes by `mv` and never reads git's worktree lock, so upstream's new background-session protection doesn't reach us"
workstream: unattached
area: callback-box
priority: backlog
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Claude Code 2.1.248
labels: [sdk-update]
---

Claude Code 2.1.248 fixes "a backgrounded worktree session losing its checkout"
by having the background session **hold the worktree's git lock** while it runs,
"so cleanup and `git worktree remove` leave it alone".

That protection is enforced by `git worktree remove` refusing a locked worktree,
and this repo never calls it. `wt_remove_now_locked`
(`bin/lib/worktree-teardown.sh:592-601`) renames the directory into a trash dir
and then prunes the dangling registration — deliberately, because the trash form
is the one hardened against being killed mid-delete (the 2026-06 half-deleted
worktree accumulation). A `mv` does not consult the lock, so an upstream-locked
worktree is trashed exactly as an unlocked one would be.

What actually protects a live session here is `wt_other_agent_live`, which
inspects process argv (`claude --worktree <name>`, `claude --name <name>`) and
process cwds. That is probably sufficient for the case upstream fixed — a
background session's worker generally has its cwd inside the worktree, so the
`signal=cwd` branch catches it — which is why this is filed as hardening rather
than as a bug with a demonstrated failure. But the heuristic has documented ways
to come up empty (`snapshot-with-exclude-self-unsupported`,
`cannot-enumerate-processes`, `cannot-read-agent-argv`), and it only recognizes
session shapes we thought to enumerate.

Reading the `locked` field from `git worktree list --porcelain` before trashing
would be a direct check on a signal upstream now sets deliberately, costs one
subprocess in a path that already runs several, and covers *any* locker rather
than only the process shapes we match. It composes with the existing liveness
check rather than replacing it — the sweep should refuse when either says the
worktree is in use.

The counter-argument worth weighing before doing this: a stale lock left by a
session that died badly would then wedge cleanup until someone unlocks it by
hand, which is the failure mode the trash-based path was built to avoid. Any
adoption should say what unwedges it — the sweep printing the lock reason it
refused on, at minimum.

Context: the 2.1.248 entry in `docs/agent-sdk-notes.md`, alongside 2.1.218's
worktree git isolation change.
