---
title: "Theme studio shows \"presentation.json: rules[2].theme must name a theme\" banner"
labels: [tours, themes]
workstream: tour-check
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261118-161345
priority: normal
---

Both theme-studio checkpoints show an error banner under the top bar:
"Appearance settings: presentation.json: rules[2].theme must name a theme". The
rest of the page renders. The tour check did not find which presentation file
the studio reads, or which change made rule 2 invalid; the `test1` clone has
no `_config/**/presentation.json`.

## Evidence

- Tour `theme-studio`, checkpoints `draft-theme` and `card-material`, both
  viewports: `beebox/test/tours/.artifacts/theme-studio/2026-11-18T22-53-20-760Z/draft-theme.desktop.png`
  and `card-material.mobile.png`.
