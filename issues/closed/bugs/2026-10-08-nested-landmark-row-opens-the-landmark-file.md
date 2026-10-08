---
title: "A nested landmark's menu row opens the landmark file, not its index"
workstream: unattached
area: beebox
labels: [navigation]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory and D-chemistry journey walks, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: a nested landmark's derived row now points at the first `entry-point` card in that landmark's own pruned subtree (`derived-links.ts`, `nestedEntryPoint`); without one the row still opens the landmark card, which [landmark card shows its config](../../bugs/2026-10-08-landmark-card-shows-its-config-not-its-places.md) covers. Covered in `resolve.derived.doctest.md`.

The place pill's menu lists nested landmarks as rows. Choosing "Inventory"
opens `Inventory.landmark.card` (its configuration, "No body content"), even
when the directory holds an index card with `prominence: entry-point`. The
B-inventory walk reproduced this twice, once after a reload that included the
index
([first walk](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) rows 60 and 79,
[second walk](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) row 39). The D-chemistry
walk saw "Intro Chemistry" and "Chemistry" as separate rows in the box
section; the "Chemistry" row's path is the landmark file
([report](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md), row 65).

## Mechanism

- `beebox/src/core/landmark/resolve/derived-links.ts:95-98`
  (`addNestedLandmarkTier`) emits `ref: n.path`, the landmark file itself.
- The card tiers run first (`:44-48`) and only for the landmark's own
  directory. The nested landmark's entry-point card is never consulted.
- `beebox/src/frontend/src/components/AppNav/PlacePill-here.tsx:53` navigates
  the row to `/views/<ref>`.

## Fix direction

The row should point at the nested landmark's `entry-point` card when one
exists, and otherwise at the landmark's directory. Either choice needs the
resolver to read the nested directory. The box agent in the B-inventory walk
found the same mechanism itself (box commit noted in the report).

## Related

- [Landmark card shows its config, not its places](../../bugs/2026-10-08-landmark-card-shows-its-config-not-its-places.md)
- [Collection views are badly defined](../../features/2026-08-19-collection-views-are-badly-defined.md)
- The D-chemistry walk also listed the course twice because the landmark sits
  in the course's `.attach` folder; filed separately as
  [course landmark in an attach folder shows twice](../../bugs/2026-10-08-course-landmark-in-attach-folder-shows-twice.md).
