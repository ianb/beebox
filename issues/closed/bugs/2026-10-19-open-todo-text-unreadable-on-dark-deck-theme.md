---
title: "Open todo text is almost invisible on the dark deck card theme"
workstream: unattached
area: beebox
labels: [ui, themes]
filed-by: agent
discovered-by: agent
discovered-in: worktree-bug-burndown-3 — screenshots for the strikethrough readability fix
resolution: implemented
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

## Resolution

2026-10-19, bug-burndown-3: every todo state now takes its color from the card
theme's ink. In `beebox/src/frontend/src/components/todo/item-logic.ts` an open
todo uses `text-card-ink`, and a parked todo (and so an open todo assigned to
the agent) uses `text-card-soft`; done and dropped keep
`text-card-soft bbx-struck`. In `TodoItem.tsx` a muted todo (list context for a
nested match) uses `text-card-soft`. Outside a themed card these fall back to
warm-900 and warm-700 (`tailwind.config.js`). The old parked color, warm-400,
was also faint on light themes. Checked in a browser on the plain, paper,
post-it, deck, night-atlas, gold-thread, phosphor, tempest and gilt card
themes.
