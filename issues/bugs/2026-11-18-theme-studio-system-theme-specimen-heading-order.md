---
title: "Theme studio: system-theme specimens fail axe heading-order again"
labels: [tours, a11y]
workstream: tour-check
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261118-161345
priority: normal
---

The theme studio's Settings specimen (`SystemThemePanel` in
`beebox/src/frontend/src/pages/dev/components/ThemeStudioHarness/cards.tsx`)
puts the landmark picker's `<h4>System theme</h4>` under a level-2 heading.
axe reports `heading-order` at `.bbx-landmark-system-theme > h4`
(`draft-theme`) and at an `h4[data-bbx-audit-run]` (`card-material`), at both
viewports. The specimen came with 5631c13ae9 (2026-11-15, "isolate runs and
cover shared theme specimens"). The earlier fix for this rule on the studio is
`issues/closed/bugs/2026-10-21-theme-studio-axe-heading-order-and-duplicate-composer-landmark.md`.

The real `LandmarkSystemThemePicker` (`components/themes/SystemThemePicker.tsx`)
also uses `h4`; decide whether the specimen or the picker carries the level.

## Evidence

- Tour `theme-studio`, checkpoints `draft-theme` and `card-material`.
- `beebox/test/tours/.artifacts/theme-studio/2026-11-18T22-53-20-760Z/*.axe.json`.
