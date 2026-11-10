---
title: "The prime card's tab looks like any other tab; the card a place put there should read differently"
workstream: workspaces
needs: [design]
area: beebox
labels: [ui, landmarks, themes]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workspaces — reviewing the place intention exhibit, 2026-11-09
priority: backlog
---

Arriving at a place with an intention opens its prime card beside the chat
(`beebox/docs/plans/place-intention.md`, Track A). In the cards pane that
card's tab looks exactly like a tab the person opened themselves, so the
card the place put there falls in with the rest.

The boxholder wants a real style difference for that tab, not just a mark:
the tab should say "this is the place's card" at a glance.

> It does feel like the [prime] card should look different, maybe in the
> tab itself. So that it doesn't just fall in to the rest of the tabs.

(Boxholder, 2026-11-09, discussing the exhibit.)

## Tension

A styled tab costs more than a glyph or a dot: every system theme
(`beebox/docs/card-themes.md`, the `system-theme` landmark field) needs a
version of the style, and the tab strip (`SidecarTabStrip`) has one visual
contract for all tabs today. The cheap version, a small mark on the tab, was
offered and declined as not the intent. The intention strip itself ships
as is for now; how the line should sit relative to the card is being
judged in use, and that outcome may change what the tab needs to say.

## Research

none yet
