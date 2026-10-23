---
title: "The place pill keeps a landmark's old label until the page reloads"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. The place pill invalidates `landmarks.identity` for the directory of a changed landmark card.

At turn 2 of the F-newcomer walk the box agent changed the root landmark's `navigation.label` from the box slug to "Home". The sidecar tab and the place page heading changed at once. The app bar's place pill kept the slug for the rest of the walk (shots 04-19). It showed "Home" only after the page was opened again (shot 20).

Report: [F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (R1).

## Mechanism

The pill reads `trpc.landmarks.identity` (`beebox/src/frontend/src/components/AppNav/PlacePill.tsx:76-79`). Nothing invalidates that query when a landmark card changes. The pill invalidates only `landmarks.forDir`, and only when the here menu opens (`PlacePill.tsx:86`).

## Why the fix is not obvious

The change feed that refreshes the open card could also invalidate `landmarks.identity` when a `*.landmark.card` changes. The pill runs on every place, and the file header asks it to stay cheap, so the invalidation should target the changed directory. The [closed sidecar tab label fix](2026-09-05-sidecar-tab-label-never-updates.md) solved the same problem for tabs.
