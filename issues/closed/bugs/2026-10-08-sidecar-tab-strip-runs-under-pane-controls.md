---
title: "An overflowing sidecar tab strip puts tab close buttons under the pane controls"
workstream: chat-chrome-fixes
area: beebox
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walk, 2026-10-08
---

> **Closed 2026-10-16:** Fixed by `bf3ff305e`, `1e591920f`, `34dc323b8`. Traced on the test box: the strip already scrolled in the space left of the pane controls. A reveal scrolled only as far as the active tab needed, so the leftmost tab was cut through its middle and showed only its "×"; a tab cut at the right edge had its "×" clipped, which `bin/browse` reports as under the pane controls. Now unpinned tabs shrink to 5.5rem before the strip scrolls; a narrow inactive tab hides pin and close until hover or focus; a reveal snaps the left edge to a whole tab, with trailing room near the end so the browser's scroll clamp cannot undo it; and positions are measured in the scroller's own coordinates (neutral cards included).

With five tabs open in the sidecar, the strip overflows. The close button of
the last visible tab sits under the pane controls and cannot be clicked.
`bin/browse` refused the click: "under div 'Pane controls'". Shots 16, 17 and
19 of the walk show it. A person would see the same overlap and lose the
ability to close those tabs by mouse.

The strip needs to reserve space for the controls, or scroll inside the room
left of them. The mechanism is not traced to a file. Related and closed:
[new tab not scrolled into view](../bugs/2026-08-29-new-tab-not-scrolled-into-view.md).

Report: [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md).

## Re-encounter 2026-10-09 (journey walks)

Seen again in two walks, as a second overflow symptom: with four or five tabs the first tabs lose their labels and show only "×". [D2](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) (row 42, shot 19): the "Box" tab shows only its close button. [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 41, shots 14, 15, 17): the Box and briefing tabs show only "×".
