---
title: "Agent-assigned todos have no reliable pickup; a bounded scheduled run needs its own design"
workstream: unattached
area: beebox
needs: [design]
labels: [todos]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-todos-ui — walking todos in a field box
---

An agent writes `{% todo assigned="agent" by="agent" created="..." %}` for
follow-up work it notices (`src/core/agent-guide/todos.ts:59-74`). Nothing
reliably brings that work back to the agent. The only path is the
todo-review job's "Your own items" section
(`src/schemas/todo-review-job.ts:83-91`), and that job lists only
escalated, newly started, or stale items. An undated agent todo is "stale"
after 45 days (`src/core/todo/review-sweep.ts:60`). The sweep also runs
only inside `bbx wakeup`, which runs automatically only from connector
schedules seeded disabled (`src/core/box/defaults.ts:294,305,316`).

The boxholder (2026-09-24): "We have to be super careful about
out-of-control agent activity on agent-assigned tasks. Super careful."

## Sketch from the todos-ui workstream (not approved)

A stock procedure and scheduled script, `agent-todos`, daily, seeded
disabled. Limits enforced in code, not only in the prompt:

1. Deterministic selection: open `assigned="agent"` todos, oldest `created`
   first, at most 2 per run, excluding todos that already used their
   attempts. None → `CHECK_SKIP`.
2. One agent step with a turn cap. Todo text is data, not instructions.
3. No self-propagation: the run may not increase the count of open agent
   todos.
4. Scope of edits: only cards that held a selected todo, and new evidence
   cards they point at.
5. Attempts end: after 2 attempts a todo is parked and shown to the
   boxholder ("agent follow-ups need you").

## Defects a cross-model review found in the sketch

- A guard shell that restores and exits non-zero short-circuits later
  shells and steps (`src/core/procedure/engine-run-phase.ts:97-128`), so a
  separate "record attempts" step would not run on exactly the failed runs.
  The guard, restore, and attempt record need one finalizer contract.
- The procedure engine does not undo a failed step
  (`docs/procedure-implementation.md:176`); restoring is the procedure's
  own job.
- `budget: "1/1d"` is invalid: a budget is runtime per window, both sides
  durations (`src/schemas/scheduled-script-duration.ts:64-73`). There is no
  run-count limit today.
- Attempt identity: todos rarely have an `id`, and path + text resets when
  the text changes.

Related: [todos in the UI plan](../../beebox/docs/implemented-plans/todos-ui.md) (hides
agent todos from boxholder surfaces; keeps the todo-review pickup until this
exists), [completion requires an answer](../exploration/2026-09-24-todo-completion-requires-an-answer.md).
