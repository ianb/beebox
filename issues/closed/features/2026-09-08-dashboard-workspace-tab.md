---
title: "Open Dashboard as a workspace tab without navigating away"
workstream: interface-as-cards
area: beebox
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — planning workspace pane controls
---

Implemented in `d6056b354` (review fixes in `bbe91381a`). Dashboard opens as
one ordinary workspace card, reuses its tab, and preserves the conversation
and existing pane controls. The boxholder explicitly chose the canonical
`_config/interface/dashboard.card` file, superseding the earlier request below
to avoid an on-disk anchor. DOM/history walkthroughs exercised reuse, move/focus,
recipient/draft retention, and mobile card/conversation restoration. Trustworthy
screenshot and physical-device signoff remain tracked by the interface-as-cards
plan; these are not claimed by this closure.


When returning to Dashboard while working with cards or chat, I want Dashboard
to open as a tab, so I retain the surrounding workspace and can return to the
things I was inspecting.

The requested direction is to open or select a Dashboard tab, never navigate
away from the workspace. It should use the same focus, move, and conversation
controls as other tab content. On mobile it occupies the single visible pane.
Chat remains the background conversation, not a Dashboard-specific session.

This is deferred from the [workspace pane plan](../../../beebox/docs/plans/workspace-pane-controls.md).
Define a stable Dashboard target identity, repeated-open behavior, retained
view state, direct URL restoration, and how Dashboard links open targets. Do
not require a synthetic on-disk card just to use the tab container. Passive
inspection must not change the conversation's recipient; explicit landmark
selection keeps its own destination semantics.

Related: [directories as viewable things](../../features/2026-07-28-directories-as-viewable-things.md).
