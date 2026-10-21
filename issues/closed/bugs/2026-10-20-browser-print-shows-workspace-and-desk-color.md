---
title: "Printing from the browser menu prints the workspace tabs, the desk color and blank pages"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-reading — printable cards
resolution: superseded
---

Closed 2026-10-20: the boxholder cares about deliberate printable forms, not printing the screen with Cmd-P. Superseded by [print options](../../features/2026-10-20-print-options-and-printable-forms.md).

The card's Print control prints that card alone. The browser's own print
(Cmd-P) does not go through it. In a check with a chat workspace open, Cmd-P
printed the workspace tab strip and the card on the grey desk color, followed by
three blank pages: six pages for a three-page card. The blank pages come from
the workspace's screen-height flex and grid boxes; the Print control's scoped
rules make those ancestors plain blocks.

The print rules hide the composer and some chrome (`themes/chrome.css`,
`themes/interface.css`, `index.css`) but not the tab strip or the desk
backgrounds (`.bbx-companion-desk`, `.bbx-conversation-desk`,
`.bbx-box-presentation`). The scoped rules for the Print control are in
`themes/card-themes.css` (`html[data-print-scope="card"]`).

What Cmd-P should print on a page with several things open is a product
choice: the focused card, the conversation, or the screen as it is.
