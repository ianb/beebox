---
title: "Stock test1 lacks two theme-tour fixtures, so card-themes and system-themes miss"
workstream: unattached
area: beebox
labels: [tours]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20260923-193557
priority: normal
---

Two tours open theme-tour fixtures that the stock `test1` box does not
contain:

- `card-themes` opens `_content/theme-tour/markdown-note.md` at two
  checkpoints. Both show "Failed to load: 404 Not Found" and their
  expectations fail.
- `system-themes` opens `_content/theme-tour/Theme_Tour.landmark.card`. The
  card does not load, so the tour cannot find its "Properties" button and
  aborts before the `landmark-system-theme` checkpoint.

Both fixtures exist in the repository under
`beebox/test/fixtures/theme-tour/`. Commit `f6356831e` ("Theme Markdown file
surfaces", 2026-09-10) added `markdown-note.md` together with the tour steps.
The stock `test1` content was not updated. A fresh clone of `test1` has the
older fixture set only.

The app is not at fault, and the tour describes the app correctly. The gap is
in the stock box content.

## Evidence

- Tour: `beebox/test/tours/card-themes.tour.ts`, checkpoints `markdown-file`
  and `markdown-workspace`.
- Artifacts:
  `beebox/test/tours/.artifacts/card-themes/2026-09-24T00-41-23-564Z/markdown-file.desktop.png`
  and `markdown-workspace.desktop.png` (both viewports show the 404).
- Findings: "Markdown file uses the themed document surface" and "Markdown tab
  joins the themed sheet with workspace gutters" fail at both viewports.
- `system-themes`:
  `beebox/test/tours/.artifacts/system-themes/2026-09-24T00-58-16-966Z/summary.md`
  — "Could not resolve button \"Properties\"" at both viewports.

## Possible resolution

Run `node --import tsx beebox/src/scripts/install-theme-tour.ts <test1-root>` and
land the new files on stock `test1` content. Or make `bin/tour` (or the tour
worktree setup) install the theme-tour fixtures before a run, so the fixture
set and the tours cannot drift apart again.

## Re-encounter, 2026-10-07 - card-reading-properties

Both tours ran on the `card-reading-properties` test1 clone after the
Properties rework. `card-themes` missed the same two markdown-file findings at
both viewports, and `system-themes` aborted at "Could not resolve button
\"Properties\"" at both viewports, because `_content/theme-tour/` still has no
`markdown-note.md` and no `Theme_Tour.landmark.card`. The Properties control
itself is present on every card page. The priority may be stale.
