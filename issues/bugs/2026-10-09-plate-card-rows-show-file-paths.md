---
title: "The Plate's card rows print the card's file path under its summary"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting, F-newcomer journey walks, 2026-10-09
---

Each card row on The Plate shows the card's file path in grey under its
summary, for example `_content/friends/Reconnecting.doc.card`.

- C-reconnecting: the path shows under the summary of the doc card.
- F-newcomer: a grey path `_content/todos/Things_To_Do.doc.card` under the card
  title on The Plate. The "/" menu's Recent files list shows a path under each
  entry too (a related surface, not covered here).

This is the third walk with the observation. C-reconnecting reported it on
2026-09-21 (row 24) and on 2026-10-08 (row 29) as report-only rows; neither
became an issue.

## Mechanism

`CardRow` renders `FileEntry` for the card
(`beebox/src/frontend/src/components/todo-view/CardRow/view.tsx:66`), and
`FileEntry` prints the path. Place-page tiles stopped showing paths in
`00db2a570` ("link tiles show titles only"), with the stated reason that the
place page is read by people; The Plate was not changed with it. The Plate is
also a page people read.

## Why the fix is not obvious

`FileEntry` (`beebox/src/frontend/src/components/ui/FileEntry.tsx:100`) is shared with other lists, so the path is probably
wanted elsewhere. The fix needs a switch on `FileEntry` (like `hidePath` on the
place tiles) and a choice of which surfaces keep paths. Where a path is the only
way to tell two cards with the same title apart, the Plate can show the parent
folder name instead.

Related: [browse-and-plate-counts-do-not-name-what-they-count](2026-10-08-browse-and-plate-counts-do-not-name-what-they-count.md)
(also from the Plate).

Reports: [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) R8,
[F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) row 24.
