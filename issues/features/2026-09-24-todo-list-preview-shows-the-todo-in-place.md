---
title: "The todo list's card preview should open at the todo, highlighted in its document"
workstream: unattached
area: beebox
labels: [todos, ui]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-todos-ui — boxholder request while reviewing the todos-ui plan
---

In the todo list, the "eye" preview on a card header expands the whole card
inline (`beebox/src/frontend/src/components/ui/FileEntry.tsx:191-222`,
`FileView` in companion mode). It opens at the top of the card. The
boxholder wants it to show where the todo is in the document: scrolled to
the todo, with the todo marked.

The [todos-ui plan](../../beebox/docs/implemented-plans/todos-ui.md) gives every
rendered todo its locator (`assignLocators`, shared by the collector and the
renderer), and Track 4 already scrolls a card to its first open todo. The
missing parts are a per-item preview (the eye sits on the card header, not
on each item) and a scroll-and-highlight target passed to the preview's
`FileView`. The boxholder filed it for later: "seems reasonable without
huge effort".
