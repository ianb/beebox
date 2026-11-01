---
title: "Engine branches are inline comparisons the compiler cannot list when an engine is added"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: "worktree-retrospective — retrospective 20261031-234313"
---

Work on the third engine found about 14 sites that branch on Codex and otherwise
take the Claude path, so a new engine silently gets Claude behavior. A count on
2026-10-31 finds 22 inline engine comparisons in non-test `beebox/src` code.

Possible direction: exhaustive switches with `assertNever`, an engine-keyed
table like `SESSION_STORES`, or a lint rule against comparing an engine to a literal.

Evidence:
- `pi-engine/20261029T184522Z-plan-reviewed.md`
- `pi-engine/20261029T225126Z-implemented.md`
