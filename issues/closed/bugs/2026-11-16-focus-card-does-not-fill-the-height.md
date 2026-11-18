---
title: "Focus card does not fill the window height, and the card workspace wastes space"
workstream: card-focus-space
area: beebox
labels: [chat, workspace, layout]
filed-by: agent
discovered-by: Ian
discovered-in: main session — developer used Focus card in the chat workspace, 2026-11-16
resolution: implemented
---

**Closed (implemented, 2026-11-17):** 2551b8bf2: short cards now fill the window (card scroll area is a column flex box, .bbx-card-surface flex: 1 0 auto); long cards still scroll. Earlier fix missed short cards.

**Reopened 2026-11-18:** After that fix shipped, the developer focused an app card (a trivia board) on production. The card's sheet covered only the top half of the window, with bare desk below it down to the composer. The earlier fix gave the workspace the height, but the sheet still sized to its content: the card's scroll area is a block box and nothing stretches `.bbx-card-surface`. It reproduces on test1 with the Bars figure card. The previous fix missed short cards.

**Earlier closure (implemented, 2026-11-17):** Resolved for the Focus card layout by 93dc1938f..0eb4ca975: focus drops the app bar and tab row, thins the frame, and moves controls to a side margin. Split-layout chrome was not changed (not requested).

The chat workspace shows cards in panes beside the chat. Each pane has a row of controls: Move right or left (arrow), Focus card (four corners), and Minimize cards (dash). They are in `beebox/src/frontend/src/components/chat/workspace/PaneControls.tsx`.

Focus card makes the pane wider, but it does not make it taller. The card keeps the same height as before. The developer expected the card to fill the window.

The developer also reports that the workspace uses too much space for chrome around the card: the control row, margins, and the frame around the card.

## Open questions

- What does focus mean for the chat? It can stay visible, collapse to a strip, or go away until the person goes back to the split.
- Which chrome can go, or can become smaller, in both split and focus layouts?
- Does mobile need the same change? Focus card is hidden on mobile now.
