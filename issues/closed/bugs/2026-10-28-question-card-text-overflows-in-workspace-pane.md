---
title: "Question card text runs out of its card in the chat workspace pane"
workstream: tour-check
area: beebox
labels: [tours]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261028-161719
resolution: implemented
---

Fixed in workstream a11y-labels: the pinned row now covers the desk padding
under the sticky stop, and the question heading wraps long words.

A pending question card opened in the chat workspace pane draws its body text
outside the card. On the phone, the text continues below the card bottom and
overlaps the "Decide for me" row, and a word fragment ("ion-") shows to the
right of the card edge. On the desktop, the body text continues under the
"Answer in the chat" / "Later" / "Decide for me" row.

The card in the screenshots is the `engine-link-spec failed because
package.json has no "beebox" dependency…` question. Its prompt is long, and
it renders at a large heading size inside the card body.

## Evidence

- Tour `nav-pages`, checkpoint `chat`:
  `beebox/test/tours/.artifacts/nav-pages/2026-10-28T22-25-39-795Z/chat.mobile.png`
  and `chat.desktop.png`.
- Tour `new-chat`, checkpoints `fresh-chat` and `add-menu` show the same card
  and the same overlap:
  `beebox/test/tours/.artifacts/new-chat/2026-10-28T21-58-13-878Z/`.
- The tours report no page errors and no axe violation for it; only the
  screenshots show it.
