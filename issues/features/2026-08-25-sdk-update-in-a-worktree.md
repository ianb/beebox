---
title: "Run the sdk-update schedule in its own worktree instead of the main checkout"
workstream: unattached
area: monorepo
labels: [scheduler, workstreams]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-scheduled-task-voice — cross-model review of the scheduler
---

`schedules/sdk-update/schedule.yaml` runs its agent session with
`worktree: false` and `permissionMode: bypassPermissions`: the session edits,
commits, and pushes from the **main checkout**. This was carried over from the
retired `bin/update-agent-sdk-scheduled.sh`, which did the same.

The problems, from the review of `scheduled-workstreams.md`:

- The runner's liveness guard is skipped for `worktree: false`
  (`bin/lib/schedules-workstream.ts`, the `mainRoot` branch) because the
  boxholder's own sessions live in the main checkout. So the SDK agent can
  pull, edit, and commit over uncommitted work or under a live session.
- A dirty main checkout, or `bin/land` from another workstream, can collide
  with the agent's `git pull`/push mid-turn.

## Direction

Make `sdk-update` an ordinary scheduled workstream: `worktree: true`, the
session works on branch `worktree-sdk-update`, and the bump lands on `main`
through `bin/land` (ff-only) at the end of the turn instead of a direct push
from main. The persistent session keeps working; `prompt.md` changes from
"push to main" to "commit here, then `bin/land`". The Docling watch is already
separate, so nothing else depends on the main-checkout placement.

Once done, `worktree: false` has no user; consider removing the option (and
the guard exemption) rather than keeping an unused branch.

## Related

- `callback-box/docs/plans/scheduled-workstreams.md` (Track B, liveness scope)
- `schedules/sdk-update/` (`schedule.yaml`, `prompt.md`, `run.ts`)
