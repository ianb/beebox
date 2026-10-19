---
title: "Open todo text is almost invisible on the dark deck card theme"
workstream: unattached
area: beebox
labels: [ui, themes]
filed-by: agent
discovered-by: agent
discovered-in: worktree-bug-burndown-3 — screenshots for the strikethrough readability fix
---

On a card with the dark deck theme, an open (not done) todo's text is nearly
invisible: the open-item class in
`beebox/src/frontend/src/components/todo/item-logic.ts` hard-codes
`text-warm-800`, a dark ink, on the deck theme's dark background. Done and
dropped todos now use the theme-aware `text-card-soft`, so on this theme a
finished todo reads better than an open one.

Parked todos, open todos assigned to the agent, and muted todos still use the
fixed `text-warm-400` and probably have the same problem on dark themes.

Fix direction: use the card theme's ink tokens (as `text-card-soft` does) for
every todo state. Check each theme in the theme system.
