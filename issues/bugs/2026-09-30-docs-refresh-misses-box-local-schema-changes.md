---
title: "`bbx docs refresh` reports current after a box-local schema changes; its card rules and skills stay stale"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-fields-review — applying box-local field renames on production boxes
priority: normal
---

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

Seen in the [A-lending walk](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (R3, R4). After the agent added a `loan` type and a `lending-list` type, `.claude/rules/card-loan.md` lacked a later field (`expected-back`) and no rule existed for `lending-list`. Part of this was the agent skipping `bbx engine init .`, which `beebox/box-docs/schemas.md:253-262` instructs. Separately, `.agents/skills/beebox-rule-card-loan/` was left untracked: `syncTemplatesFromSource` commits at `beebox/src/core/docs-gen/generate/core.ts:241`, and the `.agents` mirrors are written later by `ensureAgentContext` (`:411`), which nothing commits. The priority may be stale given the recurrence.
