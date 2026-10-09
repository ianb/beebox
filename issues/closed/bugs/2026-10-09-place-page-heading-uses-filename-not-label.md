---
title: "A place page is headed by its landmark's filename, while the buttons use its label"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry, A-lending, B-inventory, C-reconnecting, F-newcomer journey walks, 2026-10-09
resolution: implemented
---

Fixed on worktree-journey-walks-oct: a landmark card is now headed and titled by its `navigation.label`, the label the place pill and the "Go to" buttons use, with the card's `title:` and then the filename as fallbacks. The card header reads it in `ThemedFileCard`'s `cardTitle`; the workspace tab reads the card's summary title, which the landmark schema's new `summarize` hook sets from the label. Only landmark cards change. Checked in a browser on the D-chemistry second-walk box: the Chemistry page and its tab read "Chemistry", and the root page and its tab read the box name the pill shows.

The tab and the card heading of a place page come from the landmark card's file
name. The place pill, the "Go to ..." button, and the menus use the landmark's
`navigation.label`. The two names differ.

- Root place, all six walks: the page is headed "Box" (from `Box.landmark.card`).
  The pill shows the box name. The walkers read "Box" as a computer word.
  B-inventory: "my friend didn't call it that". D-chemistry: "Box" is used three
  ways on one screen.
- Other places, D-chemistry second walk: the page is headed "Intro Chemistry"
  (from `Intro_Chemistry.landmark.card`) while the button says "Go to Chemistry".

## Mechanism

`FileView` heads a card with its frontmatter `title:` or else its file name
(`beebox/src/frontend/src/components/FileView/view.tsx:91`). A landmark card
has no `title:`, so the file name wins. `PlacePage` already draws the place's
mark and label as a heading (`beebox/src/frontend/src/components/PlaceView/view.tsx:96-100`),
but only for an embed (`heading`); the card header is assumed to show them
(`view.tsx:7`). It does not. The label is read from `navigation.label`
(`beebox/src/core/box/structure/defaults.ts:240` seeds it from the box slug).
This report did not trace which component supplies the tab title; the report
rows state the same cause.

## Why the fix is not obvious

The file name is the card's identity in Browse, and the root file is named
`Box.landmark.card` on every box. Heading by label means either `FileView`
treats a landmark's label as its title, or every landmark card also gets a
`title:`. Which one avoids two sources of truth is open. The fix should cover
every landmark, not only the root.

Related: [place pill repeats the box name at the root](../bugs/2026-10-08-place-pill-repeats-box-name-at-root.md)
(closed; the pill side). [Landmark arrival](../../../beebox/docs/implemented-plans/landmark-arrival.md).

Reports: [D-chemistry](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md) row 4,
[D-chemistry second walk](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) rows 2 and 41,
[A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) row 3,
[B-inventory](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) row 1,
[C-reconnecting](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) row 3,
[F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) row 2.
