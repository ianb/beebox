---
title: "Printing from the browser menu prints the workspace tabs, transcript and desk color"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-reading — printable cards
---

The card's Print control prints that card alone. The browser's own print
(Cmd-P) does not go through it. In a check with a chat workspace open, Cmd-P
printed the workspace tab strip, the card on the grey desk color, and the chat
transcript, over six pages for a three-page card.

The print rules hide the composer and some chrome (`themes/chrome.css`,
`themes/interface.css`, `index.css`) but not the tab strip, the transcript, or
the desk backgrounds (`.bbx-companion-desk`, `.bbx-conversation-desk`,
`.bbx-box-presentation`). The scoped rules for the Print control are in
`themes/card-themes.css` (`html[data-print-scope="card"]`).

What Cmd-P should print on a page with several things open is a product
choice: the focused card, the conversation, or the screen as it is.
