---
title: "A worktree schedule stops for good when a prior session leaves uncommitted edits"
workstream: unattached
area: schedules
filed-by: agent
discovered-by: agent
discovered-in: main — investigating the 2026-09-23 knip-sweep failure
priority: important
---

A worktree schedule merges `main` into its branch before it starts a session
(`bin/lib/schedules-workstream.ts:306`). If a prior session left uncommitted
edits in files that `main` also changed, `git merge` refuses. The runner aborts
the merge, raises "could not bring the worktree up to date with main", and
starts no session. Nothing cleans the tree, so every later run fails the same
way until a person intervenes.

Observed on knip-sweep. The 2026-09-15 session exited mid-run (see
[headless-session-exits-waiting-on-background-task](2026-09-23-headless-session-exits-waiting-on-background-task.md)).
It left 11 edited files and a staged deletion. On 2026-09-23, `main` had
changed two of those files, and the merge failed.

The failed run also loses the handoff in practice. `schedules/knip-sweep/run.ts`
rewrites its baseline (`last-report.txt`) before it calls `handoff`. The
handoff body survives in `runs/<id>.handoff.json`, but no command replays it.
A forced rerun reports nothing new. The 2026-09-23 recovery removed the
handoff's lines from the baseline by hand, then forced a rerun.

## Tension

- Committing stray edits automatically puts unreviewed work on the branch.
  Stashing or discarding them hides or loses work.
- The runner could launch the session on the stale tree and tell it about the
  dirty state. But then the session starts on an old `main`.
- Replaying a stored handoff needs a runner command (for example,
  `bin/schedules run <name> --replay <runId>`). Alternatively, schedules could
  commit their baseline only after a session launches.
