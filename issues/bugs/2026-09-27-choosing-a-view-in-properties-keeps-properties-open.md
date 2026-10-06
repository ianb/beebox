---
title: "Choosing a view in a card's Properties leaves Properties open instead of showing the view"
workstream: card-view-fixes
area: beebox
labels: [frontend, views, properties]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
priority: important
---

In a card's Properties panel, the person picks a different view for the
card. The view changes, but the Properties panel stays open, so the person
does not see the view they chose. Choosing a view should close Properties
and show the card in that view at once.

The view list is in `ThemedFileCard`
(`beebox/src/frontend/src/components/themes/ThemedFileCard.tsx:93`): each
button calls `onSelect(renderer.name)`, and "Use preferred view" calls
`onSelect(null)` (line 96). Neither one closes the panel. The component
already receives `onClose`.

Check that the change works in every place a card is mounted, including
chat's side panel and multi-mount cases.
