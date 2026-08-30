---
title: "A card opened beside chat loses the current landmark context"
workstream: landmark-in-browse
area: callback-box
labels: [chat, navigation, ui, landmarks]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-landmark-in-browse — while confirming landmark context in Browse"
resolution: implemented
---

Resolved by `d088cd77d`. A landmark-bound chat now shows a compact landmark
header above its companion card. Desktop includes the landmark's curated links.
Stacked layouts keep only the landmark identity so the card remains visible.

When a card is open in the companion panel beside a chat, the panel shows the
card but not the current landmark context. The boxholder expected the same
landmark orientation that is now available for a landmarked directory in
Browse.

This is separate from the
[Browse directory fix](2026-08-30-root-landmark-view-missing-in-browse.md).
Determine whether the chat card panel should show a compact landmark header,
expose the landmark's links, or provide a smaller orientation affordance that
fits the panel hierarchy.
