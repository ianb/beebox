# One file per tension, with a closed schema
## Supporting: the split commit and the frontmatter contract
- 107 sections became 107 files, dated by git blame; the conventions were written the same day

```text
feat: replace ideas.md with issues/ — one file per idea, in-tree tracking
Adopt the file-per-item convention… instead of any tracker tool. issues/ holds
one markdown file per idea/issue, named YYYY-MM-DD-<slug>.md (date via git
blame of the original section); closed items move to issues/closed/ with a
resolution. Conventions — tension-not-mandate, needs:[design|decision],
research-in-body… agent filing with provenance — live in issues/CLAUDE.md.
Migrated all 107 sections (95 open, 11 closed, two previously headingless
orphan entries recovered)                                        (2c6c497c2)
```

```yaml
---
title: "Short human title"
workstream: unattached            # who owns resolving it
needs: [design, decision]         # what only a human can supply
priority: important               # set only by the developer
filed-by: agent
discovered-in: worktree-foo — while doing X   # provenance, kept separate
resolution: implemented           # present only under closed/
---
```

Notes:
The schema is closed and enforced in code (issue-domain.ts); unknown keys are reported. That rule exists because an agent invented a `stories:` field while filing from the catalog and the parser silently dropped it.
