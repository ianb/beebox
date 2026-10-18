---
title: "Search section results open the document without the selected section"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey C and independent verification
priority: normal
---

Journey C searched for its saved friends page and selected the result labelled
`Section: /Reconnecting with friends/Where things stand right now`. The document
opened at its beginning; the walker had to bring the status heading into view.
The section label promises a more precise destination than the click supplies.

## Verified mechanism

`beebox/src/frontend/src/renderers/search.tsx:37` constructs a navigation target
from `item.path` with empty params/view state. It drops `item.fragment`.
`beebox/src/frontend/src/components/search/QuickSearchOverlay.tsx:35` has the
same omission. The Cmd-K path was source-checked, not exercised in this walk.

The selected heading was near the bottom of the viewport in screenshot 21;
this is not a claim that the document failed to open. It opened successfully
without using the section destination. Wire the existing section identity
through navigation and verify both search entry points.

Evidence: [journey C report](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 37–40, screenshots 20–22. Related history:
[box search](../closed/features/2026-05-11-box-search.md).

## 2026-10-17: not a small fix; needs a decision

The fix is larger than "pass `item.fragment`". The frontend has no consumer
for a section destination:

- `ViewTarget` (`beebox/src/frontend/src/lib/view-url.ts`) is
  `{ path, viewer, params, viewState }`, with no fragment slot.
  `resolveContentTarget` splits only on `?`, so a markdown link to
  `Card.card#heading` puts `#heading` into `path`. In-card links with a
  fragment probably fail the same way (not checked in a browser).
- No view scrolls to a heading after navigation.
- The search `fragment` is the chain of raw heading titles (`/Parent/Child`,
  with `~2` for repeats; `beebox/src/core/search/extract/markdown-sections.ts`,
  `core.ts:162-172`). Rendered heading ids are slugs
  (`makeHeadingNode`, `beebox/src/shared/markdoc-config/tags/core.ts`). Something
  must map one to the other.
- `beebox/docs/plans/search-card.md` (lines 117-121, 282-286) chose card-level
  results on purpose until a heading scroll consumer exists.

Options: (1) add `fragment` to `ViewTarget`, which also fixes `#heading` in
markdown links but changes URL serialization and router state; (2) carry the
section in `viewState` for search only. Either way, one tested helper builds the
target for both search entry points, and the markdown card view scrolls to
the matching heading after render. Lean: option 1, through a short plan.
