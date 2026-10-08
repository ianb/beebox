---
title: "At the box root the top-left place pill shows the box name twice"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, B-inventory, C-reconnecting, D-chemistry and F-newcomer journey walks, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: The `{box} ▸` prefix is dropped at the box root (`PlacePill.tsx`).

On first load every walker saw the pill read like a glitch or a path, for
example `d-chemistry-2026-10-08 ▸ 📦 d-chemistry-2026-10-08`. The F-newcomer
walker said it "reads like a file path". Reports:
[A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (row 1),
[B-inventory](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (row 1) and
[second walk](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 2),
[C-reconnecting](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 3),
[D-chemistry](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 6),
[F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (row 1).

## Mechanism

- The prefix `{boxName} ▸` is always printed on wide screens
  (`beebox/src/frontend/src/components/AppNav/PlacePill.tsx:186`).
- The face label is the current landmark's label (`:147`). At the root, the
  root landmark's label is the box name: `boxIdentity` reads the root
  landmark's `navigation.label` and falls back to the slug
  (`beebox/src/core/landmark/box-identity.ts:114-118`).
- With no custom label both halves are the slug.

## Fix direction

At the root, show the name once. The prefix exists to anchor nested
landmarks ("Box ▸ Lending"), so it can be dropped when the place is the
root. The pill's other wording problems ("Here: /", the box emoji, "Find a
landmark") belong to
[First screen says nothing about what this is](../../features/2026-08-23-first-screen-says-nothing-about-what-this-is.md).

## Related

[Place pill loses the chat place after Browse closes](2026-10-08-place-pill-loses-the-chat-place-after-browse-closes.md)
