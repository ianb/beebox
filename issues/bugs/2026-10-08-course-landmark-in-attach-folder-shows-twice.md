---
title: "A course landmark in the attach folder names the folder and lists the course twice"
workstream: unattached
area: beebox
labels: [low]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry journey walk, 2026-10-08
---

Two symptoms in the D-chemistry walk share one cause.

1. The place pill read "Here: Intro_Chemistry.attach". That is a filename,
   not a place the learner knows.
2. The box section of the place menu listed "Intro Chemistry" and "Chemistry"
   as separate entries. The "Chemistry" row opens the landmark file itself.

## Mechanism

The build-course skill puts the course's landmark card inside the course's
`.attach` folder (`beebox/src/core/box/guidance-sync/skills-content.ts:97`,
step 7). Then:

- `beebox/src/frontend/src/components/AppNav/PlacePill.tsx:230` shows
  `dirBasename(landmark.dir)`, which is `Intro_Chemistry.attach`.
- The root landmark derives links to `primary` cards
  (`beebox/src/core/landmark/resolve/derived-links.ts:44`) and to nested
  landmarks (`:95-98`). The agent gave the course card `prominence: primary`,
  so the course appears once as a card and once as a nested landmark.

## Fix direction

Name the pill from the landmark's `label`, not its directory. Decide
whether a nested landmark should hide a card it already points at. Related:
[a nested landmark row opens the landmark file](2026-10-08-nested-landmark-row-opens-the-landmark-file.md).

Report: [D](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (rows 65, 70).
