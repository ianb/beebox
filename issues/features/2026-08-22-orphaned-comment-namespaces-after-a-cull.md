---
title: "Comments in a culled workstream's namespace outlive it, and a recreated name inherits them"
workstream: dev-comments
area: monorepo
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-dev-comments — boxholder asking whether the persistence issue was resolved
labels: [comments, workstreams]
---

The document-comment store
([document-comments](../../beebox/docs/plans/document-comments.md)) is
deliberately outside every worktree, so a cull cannot delete a comment — nothing
in `bin/lib/worktree-teardown.sh` or `bin/workstreams` knows the store exists.
That was the goal. It creates two follow-on problems, neither of which is data
loss.

## 1. Orphan accumulation

Comments on untracked files live at `worktree/<name>/<repo-path>.comments.yaml`.
When the workstream is culled, both the worktree and the untracked file it
annotated are gone — a `scratch/notes.md` existed only in that tree. The comment
remains, and `bin/comments list` shows it forever. Nothing cleans it up, by
design.

The exhibits store reached the same place and answered by **reporting** rather
than deleting: `bin/workstreams sweep` *"gains a report line for store
directories whose workstream is neither registered nor a live worktree"*
([workstream-exhibits](../../beebox/docs/plans/workstream-exhibits.md):265).
The same treatment fits here, plus a marker in `bin/comments list` so an orphan
is visibly an orphan rather than a live remark.

## 2. A recreated name inherits the previous incarnation's comments

Sharper, because it is wrong rather than merely untidy. `bin/workstreams create`
is idempotent and re-attaches (`bin/CLAUDE.md:302`), and recreating a culled
workstream is an expected flow — sweep restores a `keep/*` box ref during *"a
culled workstream's recreation"*. So a new workstream named `dev-comments`
inherits every `worktree/dev-comments/...` comment the old one left, and they
present as remarks about the current work.

For a communication medium that is worse than losing them: a stale remark shown
as current gets acted on.

## Directions worth weighing

- **Report, do not delete** (exhibits precedent): sweep names orphaned
  namespaces; `bin/comments list` marks them; the developer clears them. Cheapest
  and consistent with the "nothing expires on its own" rule.
- **Stamp an incarnation.** Record the worktree's creation time or branch SHA in
  the namespace so a recreated name does not collide. Correct, but it is more
  machinery than a single-user machine has yet earned.
- **Clear on cull.** Rejected on its face — the whole point of the store's
  location is that cleanup cannot reach it, and adding a hook that deletes
  comments at cull time reintroduces exactly the loss it was built to prevent.

Tracked comments (`tracked/<repo-path>`) are unaffected and must stay that way:
following the document everywhere, across every checkout and cull, is what they
are for.
