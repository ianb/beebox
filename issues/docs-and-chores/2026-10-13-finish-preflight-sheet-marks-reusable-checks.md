---
title: "finish-preflight sheet lists full checks after a disjoint merge of main"
workstream: unattached
area: bin
labels: [finish, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261013-224557
---

After `bin/finish-preflight` merges main, the sheet's verification list names
full app, test and site checks even when the merge brought paths disjoint from
the branch, or the branch's own diff is docs-only. The rule for reusing
earlier evidence lives only in `.claude/agents/finish.md` step 3, so each
finish agent re-derives it from the sheet.

Evidence (CODING_FEEDBACK):

- `test-oracles/20261011T194919Z-landed.md`: the sheet listed full app checks
  for a docs-only branch after the merge; doc-check evidence was reused.
- `test-selection-breadth/20261012T205538Z-landed.md`: after a merge of 30
  disjoint paths, the sheet still listed full test and site runs.

`skipTypecheckLintDecision` already requires typecheck and lint after any
code-bringing merge; that part is intended. The open question is whether the
sheet should mark the remaining checks as reusable when the merged paths and
the branch's paths do not intersect, or whether the agent's judgment in
finish.md step 3 is the right owner.
