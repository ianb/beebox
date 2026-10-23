---
title: "`bbx docs refresh` reports current after a box-local schema changes; its card rules and skills stay stale"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-fields-review — applying box-local field renames on production boxes
priority: normal
resolution: implemented
---

> **Closed 2026-10-22 (issue audit):** Commit 55147cd9a makes `newestInputMtime` (`beebox/src/core/docs-gen/generate/core.ts`) scan the box schemas dir from the box shape (`src/schemas/`) instead of the legacy `_config/schemas`. A new case in `beebox/test/core/docs-refresh.test.ts` shows a changed box-local schema now makes the docs stale; it fails on the old code.

After a box's `src/schemas/*.ts` changed and was committed, `bbx docs refresh
--json` answered `{"status":"current"}` and left `.claude/rules/card-<type>.md`
and `.agents/skills/beebox-rule-card-<type>/SKILL.md` describing the old
fields. `bbx init` regenerated them (and left the regenerated files
uncommitted). So the refresh's staleness marker does not include box-local
schema source, only the inputs it tracked before box-local schemas existed.

A box agent reads those rules on every card edit; stale rules tell it to
write fields the schema no longer has. The hourly convergence pass calls the
same refresh, so nothing repairs this on its own.

Where to look: the docs refresh cache key (`beebox/src/core/docs-gen/`, the
generation marker the refresh compares) and `loadBoxSchemas`.

Related: [`bbx init` didn't refresh generated docs for newly added box-local
schemas](../closed/bugs/2026-08-12-bbx-init-stale-generated-docs.md) fixed the
add case for `bbx init`; this is the change case for `bbx docs refresh`.

## Re-encounter 2026-10-08 (journey walks)

Seen in the [A-lending walk](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (R3, R4). After the agent added a `loan` type and a `lending-list` type, `.claude/rules/card-loan.md` lacked a later field (`expected-back`) and no rule existed for `lending-list`. Part of this was the agent skipping `bbx engine init .`, which `beebox/box-docs/schemas.md:253-262` instructs. Separately, `.agents/skills/beebox-rule-card-loan/` was left untracked: `syncTemplatesFromSource` commits at `beebox/src/core/docs-gen/generate/core.ts:241`, and the `.agents` mirrors are written later by `ensureAgentContext` (`:411`), which nothing commits. The priority may be stale given the recurrence.

## Update 2026-10-08

The untracked `.agents/skills/` mirror is fixed: `generateDocs` now commits
after `ensureAgentContext`
([commit-ordering issue](2026-10-08-template-sync-commit-precedes-agent-skill-mirrors.md)).
The staleness marker still ignores box-local schema source, so this issue
stays open.

## Audit 2026-10-22

Still true. The cause is now located. `newestInputMtime` (`beebox/src/core/docs-gen/generate/core.ts:137`) watches `getBoxDir(boxRoot, "schemas")` at `:169`. That key is the legacy `_config/schemas` directory (`beebox/src/lib/paths/box-layout-spec.ts:285-292`). Box-local schemas live in `src/schemas/`, which the mtime scan never reads. A one-line fix is to add `src/schemas/*.ts` to the scan.
