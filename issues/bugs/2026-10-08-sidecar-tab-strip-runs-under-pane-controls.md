---
title: "An overflowing sidecar tab strip puts tab close buttons under the pane controls"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walk, 2026-10-08
---

With five tabs open in the sidecar, the strip overflows. The close button of
the last visible tab sits under the pane controls and cannot be clicked.
`bin/browse` refused the click: "under div 'Pane controls'". Shots 16, 17 and
19 of the walk show it. A person would see the same overlap and lose the
ability to close those tabs by mouse.

The strip needs to reserve space for the controls, or scroll inside the room
left of them. The mechanism is not traced to a file. Related and closed:
[new tab not scrolled into view](../closed/bugs/2026-08-29-new-tab-not-scrolled-into-view.md).

Report: [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md).
