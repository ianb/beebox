---
title: "Moving a plan at close-out rewrites source comments and reruns code checks"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261110-003006
---

Source and test comments cite plans by path. When finish moves a plan to `docs/implemented-plans/` with `bin/doc-move`, the move rewrites those comments. A docs-only close-out commit then touches code, and the pre-commit hook runs the full typecheck again (about six minutes for a `.tsx` comment). Once the move ran during a `test:changed` run. On main, commit `55293053a` (move one plan) changed 21 source and test files.

Options that were named:

- Move the plan in the implementing commit, before verification, so its rewrites are verified with the code. The finish agent (`.claude/agents/finish.md` step 5) moves a plan only after it classifies each requirement as MET, so this changes the order.
- Cite plans from code by a stable name that does not change when the plan moves.
- Let the pre-commit hook skip typecheck when the staged diff in code files is comment-only.

Evidence: `box-feedback-bugs/20261109T204926Z-landed.md`, and the retrospective watch item `closeout-touches-code-forces-checks` (two earlier entries).

2026-11-13 (retrospective 20261113-003305): seen again. Closing one plan rewrote comments in 36 files and reran the full pre-commit typecheck (`chat-presence/20261113T042936Z-landed.md`).
