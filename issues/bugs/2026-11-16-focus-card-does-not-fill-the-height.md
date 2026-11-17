---
title: "Focus card does not fill the window height, and the card workspace wastes space"
workstream: card-focus-space
area: beebox
labels: [chat, workspace, layout]
filed-by: agent
discovered-by: Ian
discovered-in: main session — developer used Focus card in the chat workspace, 2026-11-16
---

The chat workspace shows cards in panes beside the chat. Each pane has a row of controls: Move right or left (arrow), Focus card (four corners), and Minimize cards (dash). They are in `beebox/src/frontend/src/components/chat/workspace/PaneControls.tsx`.

Focus card makes the pane wider, but it does not make it taller. The card keeps the same height as before. The developer expected the card to fill the window.

The developer also reports that the workspace uses too much space for chrome around the card: the control row, margins, and the frame around the card.

## Open questions

- What does focus mean for the chat? It can stay visible, collapse to a strip, or go away until the person goes back to the split.
- Which chrome can go, or can become smaller, in both split and focus layouts?
- Does mobile need the same change? Focus card is hidden on mobile now.
