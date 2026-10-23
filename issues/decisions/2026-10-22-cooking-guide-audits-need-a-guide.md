---
title: "The cooking-guide knowledge audits fail because the test box has no cooking guide"
workstream: unattached
area: beebox
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-knowledge-audit-refresh — full knowledge-audit rerun, 2026-10-22
---

`cooking-guide-awareness` and `cooking-follow-recipe-pattern` in `beebox/src/dev/knowledge-audits.yaml` require a read of `_content/docs/generated/cooking-guide.md`. The test box `test1` has no cooking guide card, so that file does not exist and the agent guide lists no cooking guide. Both audits failed 2/2 on 2026-10-22. The 2026-07-03 rerun noted the same gap (`beebox/docs/reports/knowledge-audit-rerun-2026-07-03.md`).

A fixture cannot fix this: the runner writes fixtures after it regenerates docs, so a fixture guide card is not compiled and is not in the agent guide's list.

Decide one of:

- Add a cooking guide card to the `test1` setup, so the audits test what they describe.
- Retire both audits. `cooking-recipe-lookup` still covers recipe lookup.
- Let a fixture add a guide card before docs generation, so an audit can stage its own guide.
