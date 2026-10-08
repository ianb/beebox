---
title: "Doc generation commits template sync before it writes briefings, rules, and agent mirrors"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, D-chemistry and F-newcomer journey walks, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: `generateDocs` now calls `commitTemplateSyncChanges` once,
after `ensureAgentContext`, and `syncTemplatesFromSource` no longer commits.
Every path in the list below matches `isTemplateManagedPath`; `.beebox/` and
`_content/docs/generated/` are gitignored. Reproduced on a throwaway box (a
committed briefing-card edit, then `generateDocs`, left `_content/briefing.md`
modified) and pinned in `beebox/test/core/docs-gen/generate.doctest.md`, which
fails on the old order. `bbx docs refresh` passes `commit: false` and commits
its own measured paths, so this ordering did not affect it.

After `bbx engine init .` (or any `generateDocs` run) in a box, tracked
generated files stay uncommitted:

- A-lending: `.agents/skills/beebox-rule-card-loan/` was left untracked
  ([report](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md), R3).
- D-chemistry: `_content/briefing.md` was modified and uncommitted
  ([report](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md), R1).
- F-newcomer: the same `briefing.md` change; the dashboard showed "dirty (3
  files)" with two untracked chat cards
  ([report](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md), row 96). A person reads
  "dirty" as damaged data.

## Mechanism

`generateDocs` calls `syncTemplatesFromSource`, which commits as "Sync
templates from upstream" at the end
(`beebox/src/core/docs-gen/generate/core.ts:241`, called from `:371`). It then
writes more tracked files and never commits them:

- `compileGuides` and `compileExpositionRules` (`:396`, `:399`), the
  `guides-for-<type>` and exposition rules;
- `compileBriefings` (`:409`), which writes `_content/briefing.md`;
- `ensureAgentContext` (`:411`), which writes `AGENTS.md`, the
  `.agents/skills/…` mirrors, and `.codex/hooks.json`
  (`beebox/src/core/box/guidance-surfaces.ts:87,117-120`, all `gitTracked`).

`commitTemplateSyncChanges` runs once, before these outputs exist
(`core.ts:257-282`).

## Fix direction

Commit once at the end of `generateDocs`, or call
`commitTemplateSyncChanges` again after `ensureAgentContext`. The commit
filters on `isTemplateManagedPath`; check that it matches every path in the
list above.

## Related

[`bbx docs refresh` reports current after a box-local schema changes](../../bugs/2026-09-30-docs-refresh-misses-box-local-schema-changes.md)
notes the same uncommitted regenerated files and a staleness-marker problem.
This issue is only the commit ordering.
