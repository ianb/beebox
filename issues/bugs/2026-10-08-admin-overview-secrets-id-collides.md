---
title: "Admin Overview gives the Secrets group and the Secrets row the same element id"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walk, 2026-10-08
---

`bin/browse` reported a duplicate id, `bbx-admin-overview-secrets`, on the
Admin Overview page. Two elements get it:

- the group card, `id={`bbx-admin-overview-${group.tab}`}`
  (`beebox/src/frontend/src/components/admin/AdminOverview/view.tsx:18`), and
- the row button, `id={`bbx-admin-overview-${id}`}`
  (`beebox/src/frontend/src/components/admin/AdminOverview/AdminOverviewRow.tsx:29`).

The Secrets group has a tab named `secrets` and a section id `secrets`, so
the two strings match. Agents that address a control by `bbx-` id reach the
first element only. Give the group and the row distinct prefixes, for
example `bbx-admin-group-…` and `bbx-admin-overview-…`. Related:
[Bee Box surfaces render duplicate bbx control ids](2026-08-23-composer-states-gallery-duplicates-bbx-ids.md).

Report: [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (R2).
