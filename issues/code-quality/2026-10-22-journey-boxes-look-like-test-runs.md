---
title: "A journey box is named by its run slug, and a box with a past has its init commit last"
workstream: unattached
area: beebox
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting, H-handover and I-deciding walks, 2026-10-22
---

Two harness facts reach the walker as product facts:

- The root landmark's label is the run slug, for example "c-reconnecting-2026-10-22". Walkers read it as "a box named like a code" or "a box named after a date". It recurs in every round.
- In H-handover the "Initialize Bee Box" commit is dated on the walk day and is the parent of the setup's commits dated August and September. `git log`, which the box agent read during the walk, is out of order.

Reports: [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (row 2, H8), [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (row 1, H3), [I-deciding](../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (row 2, H2).

## Fix direction

`prepare` (`beebox/test/user-stories/journeys/prepare/core.ts`) sets the root landmark's `navigation.label` to a neutral name, or a journey's `box.setup` sets one ("House" for H). For a box with a past, `prepare` dates the init commit before the setup's first backdated commit. The F-newcomer journey tests the agent renaming the root landmark, so it must keep a default it can rename.
