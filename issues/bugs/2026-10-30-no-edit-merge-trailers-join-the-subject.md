---
title: "A `git merge --no-edit` on a worktree branch puts the provenance trailers in the subject"
workstream: unattached
area: bin
labels: [hooks, provenance]
filed-by: agent
discovered-by: agent
discovered-in: "tooling-burndown — merging worker branches, 2026-10-30"
---

Merge commits made with `git merge --no-edit` on a `worktree-*` branch get
`Workstream:` (and sometimes `Plan:`) on the line after the subject with no
blank line between them. Git then reads all of it as the subject, so
`git log --oneline` prints
`Merge branch 'worktree-agent-…' into worktree-tooling-burndown Workstream: tooling-burndown`.
Because the trailers are not in a trailer block, `git interpret-trailers
--parse` and `bin/commit-provenance` queries may miss them.

Examples on `worktree-tooling-burndown`: `e5427b0e5` (before any hook change in
that branch) and `eeb94e9a7`. The second also got `Plan:
doc-move-and-issue-close`, a plan that does not belong to the merged credential
branch.

`stampTrailers` in `bin/commit-provenance.ts` calls `git interpret-trailers
--in-place`. Run by hand on a one-line merge message, with or without the
`# Please enter…` comment block, it adds the blank line. The cause is therefore
in the message git hands the hook for a `--no-edit` merge, or in a later step;
it is not yet found.

Done when a `--no-edit` merge on a worktree branch records the trailers in a
trailer block, with a test that runs a real merge in a fixture repo.

Re-reviewed 2026-10-30: Reproduced on main by 5e92076e0 (2026-10-30), after the filing.
