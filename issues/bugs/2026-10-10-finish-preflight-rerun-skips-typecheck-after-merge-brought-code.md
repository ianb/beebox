---
title: "A second finish-preflight run skips typecheck and lint that the first run's merge made necessary"
workstream: unattached
area: bin
labels: [finish, verification]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
---

`skipTypecheckLintDecision` in `bin/finish-preflight-lib.ts` asks whether
*this* run's `git merge main` was a no-op. When an earlier preflight run already
merged code from main (a merge commit that pre-commit never checked), the next
run sees a no-op merge and reports "merge of main was a no-op; pre-commit
covered every commit". `bin/finish-verify --only typecheck` then prints
"nothing to run", so the merged tree is never typechecked or linted unless the
agent runs `pnpm typecheck` and `pnpm lint` by hand.

Three finish runs hit it in three days. Coding feedback:
test-cleanup/20261008T173241Z-landed.md, lifeos-research/20261009T033555Z-landed.md,
agents-md/20261010T143719Z-landed.md (preflight said "merge brought code in";
verify said no-op).

Direction: decide from the delta since the last tree that typecheck and lint
actually ran on, not from the current merge alone. The newest non-merge commit
is not that tree: a docs-only commit skips both checks. Which evidence records
the checked tree is a decision for whoever takes this on; the conservative
fallback is to verify whenever main's code arrived since the last code commit.
