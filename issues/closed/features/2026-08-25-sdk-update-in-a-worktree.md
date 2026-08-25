---
title: "Run the sdk-update schedule in its own worktree instead of the main checkout"
workstream: unattached
area: monorepo
labels: [scheduler, workstreams]
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: worktree-scheduled-task-voice — cross-model review of the scheduler
---

> **Done 2026-08-25.** `sdk-update` is now `worktree: true`: the session works
> on `worktree-sdk-update`, merges `main` in at the start of a run, commits
> there, and fast-forwards `main` with `bin/land`. The runner's liveness guard
> therefore applies to it like any other scheduled workstream.
>
> `prompt.md` changed with it — the preconditions are now "this worktree is
> clean" plus a `git merge main` (not `--ff-only`, since the branch carries its
> own commits between lands), and the push steps became `bin/land`. It also
> gained the case this mode introduces: **land can legitimately refuse** (dirty
> main checkout, not on `main`, not a fast-forward), which is not a failure to
> work around — the commit is already safe on the branch, so the run alerts and
> stops and the next one re-lands. Verified: `bin/schedules lint` clean, and a
> `--dry-run --force` still detects work (4 unreviewed releases) and reports the
> handoff.
>
> **The follow-on was deliberately not done.** `worktree: false` now has no user
> in `schedules/` — `docling-update` has no `workstream:` at all, and the other
> two were already `true` — but removing the option means changing the schema,
> the runner's `mainRoot` branch, and the guard exemption
> (`bin/lib/schedules-workstream.ts:286-289`). That is a capability removal, not
> a cleanup, and it is the boxholder's call: a future schedule that genuinely
> must act on the main checkout would have to reintroduce it. Filed here rather
> than done silently.

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
