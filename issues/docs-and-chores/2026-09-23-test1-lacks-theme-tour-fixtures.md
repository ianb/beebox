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

## Re-encounter, 2026-10-14 - weekly tour check run 20261014-221119

Same two misses, plus a third tour. `expressive-themes` opens
`_content/theme-tour/expressive-<name>.memo.card` for nine themes. Every one
shows "Card not found", so each checkpoint misses its "A room for useful
things" heading and both of its `expect.custom` claims, at both viewports (72
findings). Those nine fixtures were added on 2026-10-08 (`9e10a86e7`,
`7593281a4`, `6bd6eeaea`) and are also absent from stock `test1`. The fixture
set and the tours drifted apart again, as the possible resolution above
predicts.

- Artifacts: `beebox/test/tours/.artifacts/expressive-themes/2026-10-15T03-37-01-735Z/`,
  `card-themes/2026-10-15T04-24-51-767Z/` (`markdown-file`, `markdown-workspace`),
  `system-themes/2026-10-15T03-56-42-581Z/` (aborted at "Properties").

## Re-encounter, 2026-10-21 - weekly tour check run 20261021-221418

The drift is now larger. Commit `326c07df3` (retire memo) renamed the
fixtures to `.doc.card` and moved every tour to the new names, but the
tour-check worktree's box clone still has the `.memo.card` set. Every
`_content/theme-tour/*.doc.card` page shows "Card not found". The stock
`~/src/boxes/test1` has the `.doc.card` set, but it still has no
`markdown-note.md`, no `Theme_Tour.landmark.card`, and no
`bloom-inherited.doc.card` or `bloom-explicit.doc.card`.

Tours that miss for this reason, at both viewports:

- `card-themes`: every fixture heading misses; the pass aborts at
  "Could not resolve button \"Properties\"" on `theme-comparison`.
- `card-theme-interface`: the `browse-card-desk` claim fails and the pass
  aborts.
- `card-theme-previews`: both passes abort before the first checkpoint, so
  no summary is written
  ([separate issue](../code-quality/2026-10-21-tour-summary-lost-when-no-checkpoint-ran.md)).
- `bloom-theme`, `deck-theme`, `ribbon-theme`: the "A little room to grow"
  and "A note on blue paper" headings and the "unthemed card inherits" and
  "explicit Paper material stays intact" claims miss. `deck-theme` aborts at
  `deck-composer-menu`.
- `system-themes`: aborts at "Properties", as before.
- `workspace-panes`: "Card themes tour" heading misses.

Artifacts: `beebox/test/tours/.artifacts/<tour>/2026-10-22T03-*` and
`2026-10-22T04-*`. The priority may be stale: this issue now blocks about
half of the tours.

## Re-encounter, 2026-10-28 - weekly tour check run 20261028-161719

The box clone now has the `.doc.card` comparison set, so `card-themes`,
`card-theme-interface` and `card-theme-previews` walk their cards. Still
missing: `markdown-note.md` (404 at `card-themes` `markdown-file` and
`markdown-workspace`), `bloom-inherited.doc.card` and
`bloom-explicit.doc.card` ("Card not found" in `bloom-theme`, `deck-theme`,
`ribbon-theme`: the "A little room to grow" and "A note on blue paper"
headings and both claims miss; `deck-theme` aborts at `deck-composer-menu`),
and `Theme_Tour.landmark.card` (`system-themes` aborts at "Properties").
Every expectation miss in this run has this cause. Artifacts:
`beebox/test/tours/.artifacts/<tour>/2026-10-28T2*`.
