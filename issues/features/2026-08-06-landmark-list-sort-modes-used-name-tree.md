---
title: "Landmark list menu: switch ordering between used / name / tree (per-surface pref)"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder
priority: normal
---

> **Job to be done:** *When I open the place menu to jump to another landmark's
> chat, sometimes I'm reaching for the one I was just in (used), sometimes I know
> its name and want to scan alphabetically (name), and sometimes I'm navigating by
> where it sits in the structure (tree). One fixed order only serves one of those.*

Let the **landmark list menu** (the `PlacePill` switch menu — `chat.byLandmark`,
`src/frontend/src/components/PlacePill.tsx`) offer three orderings, user-toggleable:

- **used** — most-recently-used first (recency of the landmark's chat activity;
  `byLandmark` already enumerates each landmark's sessions, so last-activity is
  derivable). Good for jumping back to active work.
- **name** — alphabetical. Good for scanning to a known name.
- **tree** — hierarchical, the same nested structure the **landmark page**
  (`src/frontend/src/pages/landmarks/LandmarksPage.tsx`) already shows. Good for
  navigating by where a landmark sits.

## Also the landmark page — but a SEPARATE pref

Offer the same three modes on the landmark page too, but persist the choice
**per surface** — the menu and the page each remember their own view, so someone
can keep the menu on "used" while the page stays "tree" (its current fixed mode).

## Notes for whoever builds it

- The tree option in a *menu* needs the nesting rendered compactly (indentation),
  vs. the flat used/name lists. Reuse the page's tree-building logic if it's
  extractable rather than duplicating it.
- "used" ordering: define it precisely — most-recent session activity per landmark
  (not landmark creation). Root/unassigned bucket handling already has a quirk in
  `PlacePill` (`:150-160`) — keep it consistent across modes.
- Persist each surface's mode (localStorage keyed per surface is simplest);
  default the menu to **used** (fastest for the common "jump back" case) and the
  page to **tree** (its current behavior), unless a knowledge/UX reason says
  otherwise.
