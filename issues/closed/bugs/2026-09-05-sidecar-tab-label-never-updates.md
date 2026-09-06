---
title: "A sidecar tab keeps the label it was opened with — renaming or retitling the card does not change it"
workstream: sidecar-shell
area: beebox
labels: [ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-sidecar-shell — while designing the card symbol field"
priority: normal
resolution: implemented
---

**Closed 2026-09-05** by the same work as
[cards-carry-a-symbol](../features/2026-09-05-cards-carry-a-symbol.md):
`useCardIdentities` batches title+symbol lookups for open paths and
invalidates on `file-change` and bus reconnect; `SidecarTabStrip` reads it, so
a retitle now updates the tab with no reload. No divergence from what this
issue proposed.

A companion tab's label is captured once, when the document is opened, and is
never refreshed. `onZoomView({ target, label })` takes the label from whatever
opened it — a link's text (`InteractiveChat-view.tsx:272`), or the bare path
when nothing supplies one (`InteractiveChat-card-hooks.ts:50`,
`InteractiveChat-hooks.ts:131`, `markdown-rendering.tsx:219`) — and
`sidecarReducer` only replaces it when the same path is re-opened with a
different target (`components/chat/sidecar-tabs.ts`, the `open` case). Editing
the card's `title:` changes the card everywhere else and leaves the tab saying
the old thing.

The card body below the tab does update: `FileView` resyncs on a `file-change`
event for that path. So the panel can show a card titled "Weeknight Chili"
under a tab that says "Weekend Errands", which is the two halves of one pane
disagreeing.

Two things make this worse than it was:

1. **The strip has no card data at all.** Tabs hold a path and a string. Only an
   *activated* tab fetches its card, so a tab restored from `sessionStorage` and
   never clicked has never seen a title.
2. **A stale label now survives a reload**, because the strip persists
   (`components/chat/sidecar-tabs-storage.ts`, added 2026-09-05). Before that,
   reloading quietly repaired the label by discarding the tab.

This is also the blocker under
[cards-carry-a-symbol](../features/2026-09-05-cards-carry-a-symbol.md): a
symbol drawn in the tab strip would go stale in exactly the same way, and for
the same reason. The fix both want is one source of card identity for open
paths — a small batch lookup (title + symbol for these N paths) that the strip
subscribes to and that invalidates on `file-change`, rather than a label frozen
at open time. Whoever takes that issue should take this one with it.
