---
title: "Theme studio phone specimen: place button fails axe target-size"
workstream: unattached
area: beebox
labels: [tours, a11y]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261111-153355
---

In the theme studio at phone width, axe reports `target-size` (serious) on
`#bbx-nav-place`. The place button (`aria-label="Where you are: …"`,
`min-h-[40px] w-full`) either is smaller than 24px or has a neighbor too close
in the studio's specimen nav. The same button passes on the ordinary chat
pages in every other tour at both viewports. This suggests that the studio's
screen-scale frame or its specimen nav layout shrinks it.

Commit 269641389 ("Touch targets at least 24px") added the check.

## Evidence

- `theme-studio` `draft-theme` and `card-material`, mobile:
  `beebox/test/tours/.artifacts/theme-studio/2026-11-11T22-10-13-254Z/draft-theme.mobile.axe.json`,
  `card-material.mobile.axe.json`, with screenshots `draft-theme.mobile.png`
  and `card-material.mobile.png`.
