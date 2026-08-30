---
title: "The issues browser can't filter by workstream, though every issue carries one"
workstream: dev-comments
area: monorepo
filed-by: agent
discovered-in: worktree-dev-comments — using the issues browser as the model for the general browser
labels: [workstreams-app]
---

`/workstreams/issues` filters by category, priority, needs, status, and sort
(`workstreams-app/src/frontend/router.tsx:15`), but not by **workstream** —
even though issue frontmatter carries `workstream:` and the server already has
`issuesForWorkstream` (`documents-service.ts`) plus a per-workstream summary on
the detail page (`WorkstreamIssueSummary.tsx`).

So the aggregate view and the per-workstream view exist at opposite ends — the
whole issue list, or one workstream's issues on its detail page — with no way to
narrow the browser itself to a workstream and keep its other filters.

This surfaced because the issues browser is the model for the general browser
([general-browser](../../beebox/docs/plans/general-browser.md)), which
does have a `?workstream=` lens. The two behaving differently on the same
question would be the kind of small inconsistency that makes a consolidated
surface feel less consolidated than it is.

Small: one more search param, one more filter predicate, and the workstream list
is already fetched for other purposes.
