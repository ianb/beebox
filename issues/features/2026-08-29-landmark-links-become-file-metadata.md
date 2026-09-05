---
title: "Landmark links move from curated lists in the landmark card to metadata on the files themselves, with a fast aggregated view"
workstream: unattached
area: beebox
needs: [design]
labels: [navigation, cards]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder proposal
priority: normal
---

Today a landmark's link list is **centralized**: `links:` (and glob `expand`
groups) in the landmark card's frontmatter (`src/schemas/landmark.ts:99,152`).
The boxholder's proposal inverts it: **membership is metadata on the
individual file/card**, and the landmark's list is derived. Three requirements
stated together:

1. **Distributed, but fast to retrieve.** The per-file metadata must aggregate
   into a landmark's list quickly — this needs an index (the mtime-keyed card
   caches and `refresh-maps` machinery are prior art; `landmarks.forDir` is
   the hot path that must not get slower).
2. **A trimmed-down tree** — "a very compact browse": the aggregated view
   reads like a pruned tree of what matters under the landmark, not a flat
   dump.
3. **The shortcut stays** — reachable the existing way from the landmark
   folder menu.

Why it matters: curated `links:` lists drift (a moved/renamed card falls out;
a new card never gets added), and the list lives far from the thing it
describes. File-side metadata travels with the file through `bbx mv`, and the
"what belongs here" answer becomes local to each card.

Design questions:

- **Where the per-file metadata lives.** Card frontmatter is natural for
  cards; plain files (docs, images) need a convention — sidecar, or the
  owning-card pattern the figure/attach machinery uses.
- **Vocabulary.** Prominence/pinning likely wants expression
  ([card-level prominence](2026-06-12-card-level-prominence.md) is this
  proposal's sibling and should probably fold in). Relation to the
  `2026-08-19` per-link-promises idea (links carrying a promise about the
  destination) — same in-band-metadata instinct, different direction.
- **Migration.** Existing `links:` lists on real boxes → per-file metadata;
  the cb-migration boundary applies (shape change existing boxes hold).
  `expand` globs may survive as landmark-side pattern rules alongside
  file-side membership, or die — decide.
- **Ordering/grouping.** Centralized lists encode order; distributed metadata
  needs an ordering story (weight? name? the sort-modes issue
  [2026-08-06](2026-08-06-landmark-list-sort-modes-used-name-tree.md) is
  adjacent and should be designed with this).
- **Who writes it.** Agents on card creation (guide + knowledge audit), and
  `refresh-maps` reconciling stragglers.

Related, same territory, design together: `2026-06-12-card-level-prominence`,
`2026-08-06-landmark-list-sort-modes-used-name-tree`,
`bugs/2026-08-24-map-children-git-vs-disk` (the derive-from-git-vs-disk
question hits any aggregator too).
