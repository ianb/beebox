---
title: "A /browse/ URL whose path fails validation shows the route crash page, not a not-found state"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-todos-ui — browser walkthrough of todos on test1
---

Opening `/<prefix>/test1/browse/projects/porch-rebuild/Plan.doc.card` (no
`_content/` segment) shows "This page hit an error" with a
`BrowseLocationError: Invalid Browse location` stack. The same card opens at
`/browse/_content/projects/porch-rebuild/Plan.doc.card`.

The error is thrown from `legacyBrowseTarget`
(`beebox/src/frontend/src/lib/browse-card-state.ts:77-90`) in the router's
`beforeLoad` (`src/router.tsx:162`) and reaches the generic route error
boundary. A path that does not name a box location is an ordinary user
input (an old link, a hand-typed URL), so it should get a not-found state
with a way back, not the crash page.

The manual-testing text of
[verify todo annotation rendering](../features/2026-07-29-verify-todo-annotation-rendering.md)
still gives the URL without `_content/`.
