---
title: "Remove the legacy issue routes: SPA deep links and the /dev/issues router rewrite"
workstream: dev-comments
area: monorepo
filed-by: agent
discovered-by: Ian
discovered-in: worktree-dev-comments — reading the issues browser as the model for the general browser
labels: [workstreams-app, cleanup]
---

`workstreams-app/src/frontend/router.tsx:18-37` carries four routes whose only
job is to redirect an old URL shape into the current one:

```
/issues/$category/$filename
/issues/closed/$category/$filename
/issues/private/$category/$filename
/issues/private/closed/$category/$filename
```

Each parses the path back apart and `redirect`s to `/issues?issue=<relPath>`
with the right visibility. They date from the move to SPA query state
([workstreams](../../beebox/docs/implemented-plans/workstreams.md):629),
which kept the redirects *"indefinitely — one line, and habit + docs point"* at
the old form.

The boxholder's read (2026-08-22): that compatibility is not worth keeping —
*"make an issue to get rid of a legacy route for issues, that's not something I
care about."*

## What to remove, and what to leave alone

These are two different things and only the first is in scope.

- **In scope — the four SPA deep-link routes above.** They match only
  `<category>/<filename>` shapes. Deleting them plus `legacyIssueRoute` removes
  about twenty lines and one concept from the router.
- **NOT in scope — `/workstreams/issues/` itself.** The browser's own URL is
  referenced from `issues/CLAUDE.md:180`, `issues/AGENTS.md:181,333`,
  `bin/CLAUDE.md:345`, `bin/AGENTS.md:346` and several plans. It must keep
  working.
- **Also in scope — the router-level rewrite.** `bin/router.ts:70-73` maps
  `/<worktree>/dev/issues[/…]` to `/workstreams/issues…`, catching the pre-move
  location. The boxholder confirmed 2026-08-22 that this goes as well: *"/workstreams/issues/
  is NOT legacy, it's current and remains current. All the others can go."*
  One caveat for whoever does it: this line is in the **shared router**, so it
  lands only after a merge to main plus a router restart the boxholder performs
  — unlike the SPA routes, which the app picks up on its own.

## Check before deleting

Grep for the deep-link shape in issue bodies and plans — an agent may have
pasted one into a doc as a reference to a specific issue. Those links should be
updated to the query form rather than left to 404.
