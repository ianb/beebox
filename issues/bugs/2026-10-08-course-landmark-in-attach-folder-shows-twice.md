---
title: "A course landmark in the attach folder names the folder and lists the course twice"
workstream: unattached
area: courseware
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
`.attach` folder (`beebox/src/core/box/guidance-sync/skills/content.ts:97`,
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
[a nested landmark row opens the landmark file](../closed/bugs/2026-10-08-nested-landmark-row-opens-the-landmark-file.md).

Report: [D](../../beebox/test/plugins/courseware/journeys/D-chemistry/reports/2026-10-08.md) (rows 65, 70).

## Re-encounter 2026-10-09 (journey walks)

Re-checked in [D2](../../beebox/test/plugins/courseware/journeys/D-chemistry/reports/2026-10-09-2.md) (row 47; reproduced in `aa-d4`). Symptom 1 is still present: the place pill reads "Here: Intro_Chemistry.attach" (`PlacePill.tsx` shows the landmark directory's basename; the landmark is in the attach folder, `skills-content.ts:97`). Symptom 2 did not reproduce: "Places inside" lists Chemistry once and the place menu shows "Chemistry" and the box only, because the agent gave the course no `prominence`. The mechanism (`derived-links.ts`) is unchanged, so a `primary` course would still list twice.

## 2026-10-17 bug burn-down: skipped, needs a decision

Symptom 1 is not the one-line fix it looks like. The pill has two halves: the
left half ("Where you are") already shows `landmark.label`; the right half
("Here", `PlacePill.tsx:229-233`) is the current folder by design (the file's
header comment: "folder icon + the dir's basename"; its title is the full
directory path). Showing `landmark.label` there would print the same name in
both halves for every landmark, for example "Chemistry | Chemistry". Choices:
keep the folder but drop a `.attach` suffix ("Intro_Chemistry"), show the
label only when the folder is an `.attach` folder, or move course landmarks
out of the attach folder in the build-course skill. Symptom 2 still did not
reproduce.

**2026-10-17:** symptom 1 fixed on the bug-burndown branch ("The Here pill drops
the .attach suffix"), the boxholder's choice of the three options above. The
folder half reads "Here: Intro_Chemistry"; `dirBasename` moved to
`beebox/src/frontend/src/lib/place-label.ts`. Checked in the browser on the
worktree test box with a landmark in an attach folder. Symptom 2 is left: it did
not reproduce, but `derived-links.ts` still lists a `primary` course card once
as a card and once as a nested landmark. This issue stays open for it.

## 2026-10-17: courseware plugin scope

Courses are the opt-in courseware plugin, not core Bee Box
(`beebox/src/plugins/courseware/`). This issue now has `area: courseware`, so
core and journey work leave it out.

Symptom 1 is fixed. Symptom 2 needs a `primary` card and a landmark in
that card's own attach folder. Only the courseware skill (step 7) puts a
landmark there, and symptom 2 did not reproduce. The cheaper fix is in the
skill: give the course no `prominence`, or place its landmark outside the
attach folder. Change `derived-links.ts` only if a core pattern starts to
nest a landmark in an attach folder.

Re-reviewed 2026-10-30: Symptom 2 still latent and unreproduced; the step-7 skill text is now at beebox/src/plugins/courseware/skill.ts:88-92.
