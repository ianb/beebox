---
title: "Dashboard: two \"Schedules\" regions fail axe landmark-unique"
labels: [tours, a11y]
workstream: tour-check
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261118-161345
priority: normal
---

On the dashboard, the Schedules card is `<Card as="section" aria-label="Schedules">`
(`beebox/src/frontend/src/components/dashboard/ScheduleOverview/view.tsx`). The
`Table` primitive inside it (`components/ui/Table.tsx`, `role="region"`
labelled by the card's "Schedules" heading) makes a second region with the same
name. axe reports `landmark-unique` (moderate) at both viewports.

The `Table` region wrapper came with b2ffea86b (2026-11-11, "Add List and
Table primitives"). The fix needs a decision: drop the card's own label, or name
the table's scroll region differently (for example "Schedules table").

## Evidence

- Tour `nav-pages`, checkpoint `dashboard`.
- `beebox/test/tours/.artifacts/nav-pages/2026-11-18T22-44-40-162Z/dashboard.desktop.axe.json` and
  `dashboard.mobile.axe.json`; AX tree `dashboard.desktop.ax.txt` shows
  `region "Schedules"` nested in `region "Schedules"`.
