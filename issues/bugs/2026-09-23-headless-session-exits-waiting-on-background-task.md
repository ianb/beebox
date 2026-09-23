---
title: "A headless scheduled session exits for good when it ends its turn to wait on a background task"
workstream: unattached
area: schedules
filed-by: agent
discovered-by: agent
discovered-in: main — investigating the 2026-09-23 knip-sweep failure
---

A scheduled session runs headless and single-shot. If the agent starts a
command in the background and ends its turn to wait for it, the process exits.
No notification can resume the session later. Its work stays uncommitted and it
sends no report.

Observed on knip-sweep run 20260915-193247. The session's last output was
"Batch 1 is edited and typechecks clean; the full suite is running in the
background. I'll continue when it finishes." The runner raised "session ended
without reporting" (`alertIfBailed`, `bin/lib/schedules-workstream.ts:429`).
The uncommitted edits then blocked the next run. See
[worktree-schedule-merge-blocked-by-dirty-tree](2026-09-23-worktree-schedule-merge-blocked-by-dirty-tree.md).

## Tension

- A guidance line ("never wait on background work; run long commands in the
  foreground") is cheap. But it applies to every schedule, so it belongs in
  the shared briefing (`briefingFor`), not in each `prompt.md`.
- The launch argv could deny background execution for scheduled sessions. That
  is stricter, but it depends on the agent CLI (Claude and Codex differ).
- The "ended without reporting" alert could also say whether the worktree is
  dirty. The person who reads the alert would then know that the next run will
  fail.
