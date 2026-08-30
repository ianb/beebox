---
title: "selection provenance canonical anchors"
workstream: unknown
area: beebox
needs: [design]
priority: normal
---

From the HoverSource review (`research/hoversource-review.md`). We already have a
provenance standard — `data-bbx-source` element tagging (`src/frontend/src/lib/source-tag.ts`,
`docs/data-source-tagging.md`) and text-selection capture (`SelectionCapture.tsx` +
`lib/selection/position.ts`, feeding `chat/ChatSelections.tsx`). HoverSource (hover an
element → copy its exact `file:line:col` for a coding agent) is the same idea aimed at
code, and surfaces two gaps in ours:

1. **The selection locator is "rough," not canonical.** `extractSelection` hands chat
   a rough position locator; the agent can't reliably re-find the exact span later.
   Move to a **canonical, re-resolvable anchor** — a **text fragment** (`#:~:text=…`,
   which we already use in `WebpageView.tsx`/`CommentaryView.tsx`) or a card-relative
   quote+offset — so a captured selection round-trips: the agent re-opens the exact
   bytes, and a later agent *edit* can land back at that span. This is the load-bearing
   improvement.

2. **Only text selections are capturable; whole elements aren't.** Every element already
   carries `data-bbx-source`, but there's no affordance to hand the agent "*this card /
   this list item*" without selecting prose. A **hover/point-to-capture** affordance
   that surfaces the element's existing `data-bbx-source` (+ `data-bbx-source-item`) would
   extend capture beyond text, reusing `source-tag.ts` and complementing
   `SelectionCapture`.

Design questions: anchor format (browser text-fragment vs. our own quote+offset — the
former is a W3C standard and already in the codebase, the latter survives re-rendering
better); how an anchor degrades if the underlying card changed between capture and
resolution (stale-ref handling); and whether hover-capture and selection-capture share
one "grab provenance" path or stay separate affordances.

Explicitly NOT in scope: HoverSource's literal code `file:line:col` mapping — wrong
altitude (our agents operate on cards, not the frontend source; that's `bin/browse`
territory at most).
