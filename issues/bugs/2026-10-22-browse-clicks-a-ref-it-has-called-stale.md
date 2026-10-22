---
title: "bin/browse warns that a ref may be stale and then clicks it anyway"
workstream: unattached
area: browse
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — A-lending and H-handover walks, 2026-10-22
---

Walkers chain a ref click after another action without a new snapshot. In the A-lending walk one `click @e27` after a tab change opened a different card. The notes then said that the front card's button was not reachable, which was false. The H-handover walker hit the same pattern twice; chat links have no `bbx-` id, so refs are the only handle. The B-inventory walk of 2026-10-09 saw six "may be stale" warnings. The walker prompt already says to snapshot again.

`bin/browse` detects some of these: it prints `browse: @eN may be stale — …` when the ref was renumbered since the previous snapshot (`browse/src/act.ts:302-303`), and then it runs the click.

Reports: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-22.md) (row 37, H3), [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (rows 8, 45).

## Why the fix is not obvious

Refusing a renumbered ref is the strict option, but it covers only renumbering. A ref issued before a navigation or a tab change can keep its number and point at a new element. Options: refuse a ref click after any navigation since the snapshot that issued it; or give chat links and other id-less controls `bbx-` ids so that walkers need fewer refs.
