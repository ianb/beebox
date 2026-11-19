---
title: "A finish-preflight merge that stops on a conflict skips the post-merge pnpm install, so the merge commit's typecheck fails"
workstream: unattached
area: beebox
labels: [finish, merge, dependencies]
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261119-010700
---

The post-merge hook runs `pnpm install --frozen-lockfile` when a merge changes
`pnpm-lock.yaml` (see
[the closed install-gap issue](../closed/docs-and-chores/2026-08-10-post-merge-install-gap.md)).
Git runs post-merge only after a merge that completes on its own. When
`bin/finish-preflight`'s merge of `main` stops on a conflict, the agent resolves
it and runs `git commit`; no post-merge hook fires, so a dependency that `main`
added is not installed, and the merge commit's pre-commit typecheck fails with a
missing-module error. Nothing in the preflight output hints at the install.

Evidence:

- `canvas-brushes/20261117T134808Z-landed.md` — merge of main conflicted on
  whats-new.md; the merge commit failed typecheck because main added a
  dependency; `pnpm install` and a recommit fixed it.
- The previous retrospective's watch list recorded the same failure from an
  earlier finish (item `preflight-install-on-lockfile-change`, 2026-11-13).

Possible fixes: finish-preflight runs the frozen install itself whenever the
merge it starts changes the lockfile, conflicted or not; or the post-commit
hook repeats the post-merge dependency sync when the commit has two parents.
