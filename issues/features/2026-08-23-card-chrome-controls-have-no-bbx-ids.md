---
title: Card chrome inside FileView has no bbx- ids (multi-mount)
workstream: browse-click
priority: backlog
---

The 2026-08-23 id pass put a `bbx-` id on every static control in the frontend
except the chrome that renders *inside* `FileView`: the "Card actions" menu and
its trash confirm (`card-actions/CardActions.tsx`), `MissingCardState`'s two
actions, the renderer toggle tabs (`FileView.tsx`), the recipe scale buttons,
`TabArrangementView`'s apply/undo, `ViewErrorBoundary`'s retry, and the
comments accordion toggle. Skipped because `FileView` mounts many times in one
document — once per attached card in a transcript, per expanded file row, in
the companion pane, in overlays — and an id authored inside it duplicates as
soon as two cards are on screen (`getElementById` returns the first, silently).

This is the chrome a first-time user walking a card page most needs to be
addressable (`user-stories/journeys/`), so a journey walker on `/card/…` is
back to positional refs there.

Two shapes, pick one:

- **Only the page/companion instance publishes ids.** Thread an `idPrefix`
  (or a boolean `addressable`) from the singleton call sites —
  `BrowseDetailPanel`, `CardViewPage`, `ViewPage` — and leave transcript-embedded
  cards unaddressed (they are `data-bbx-scan="exclude"` content anyway).
- **A per-mount prefix everywhere**, derived from the mount site rather than
  the card path (paths carry `/`, `.`, uppercase — outside the id grammar).

The renderer toggle is the odd one: the renderer set is registry-driven plus
box-supplied view names, so `bbx-card-view-<key>` needs a kebab-safe key the
registry does not guarantee today.

Related: the dev-harness duplicates in
`bugs/2026-08-23-composer-states-gallery-duplicates-bbx-ids.md`.
