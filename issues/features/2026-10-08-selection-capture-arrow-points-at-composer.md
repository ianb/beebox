---
title: "The floating \"+\" that adds a selection to chat could be an arrow that points at the composer"
workstream: unattached
area: beebox
labels: [ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder idea
---

Selecting text in a card or the chat transcript shows a floating "+" near the
selection; clicking it adds the selected text to the chat message
(`beebox/src/frontend/src/components/SelectionCapture.tsx`, which owns the
button's geometry: it reads the selection's bounding rect and positions the
button with `fixed`).

The idea: make the button an **arrow that always points at the chat's text
input**, rotated toward the composer from wherever the selection is. It says
what the click does (this text goes *there*), and the slight motion as it
re-aims while the selection changes makes it feel alive.

## Notes

- Aim at the composer textarea's current rect; recompute when the selection,
  scroll, or layout changes (split panes, phone layout, a collapsed or hidden
  composer).
- When no composer is visible (for example a focused card with the chat
  hidden), decide what the arrow does: point toward where the chat will open,
  or fall back to the "+".
- Keep it accessible: the button keeps its label ("Add selection to chat"),
  the rotation is decoration, and reduced-motion users get no animation.
- Optional flourish: on click, the selected text visibly travels along the
  arrow's line into the composer.
