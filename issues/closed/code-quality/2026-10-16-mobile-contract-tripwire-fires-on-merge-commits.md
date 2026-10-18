---
title: "The mobile-contract tripwire blocks merge commits that only bring in main's contract files"
workstream: unattached
area: bin
labels: [finish, cli]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261016-225122
resolution: implemented
---

**Closed 2026-10-17:** fixed on the bug-burndown branch ("Mobile-contract tripwire ignores files a merge brings in"). When `MERGE_HEAD` exists, `stagedFiles` in `bin/mobile-contract-check.ts` keeps a staged file only when the index differs from every parent, so a conflict resolution or an edit made during the merge still counts. Test: `bin/mobile-contract-check.test.ts` (temp-repo merge).

`bin/mobile-contract-check.ts` reads the staged file list and blocks a commit
that stages a contract-surface anchor without the contract doc. A merge of
`main` into a worktree stages every file main changed. When main changed an
anchor, the merge commit is blocked, and the session must add a
`Contract-Unchanged:` trailer for a change that is not its own.

Evidence from CODING_FEEDBACK, 2026-10-16:

- `capture-photo-flow/20261016T151809Z-landed.md`: the hook needed the
  trailer on a merge commit; asks that the hook skip merge commits whose
  contract files come only from the other parent.
- `doctest-typecheck/20261016T164538Z-landed.md`: the tripwire blocks merge
  commits; the trailer is the escape.

What would fix it: when `MERGE_HEAD` exists, compare against the first parent
and count an anchor only when its merged content differs from both parents
(a conflict resolution or an edit made during the merge).
