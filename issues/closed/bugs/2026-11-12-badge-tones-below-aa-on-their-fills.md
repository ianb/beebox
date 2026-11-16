---
title: "Badge text is below AA on its own fill for some tones"
workstream: theme-check-gate
area: beebox
labels: [frontend, contrast]
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-ink-dark-themes — theme studio specimen for an answered question's status badge
resolution: implemented
---

`components/ui/Badge.tsx` pairs each tone's text with a light fill. The
success pair measured 3.86:1 (`#3C7F49` on `#D6EADD`); this workstream darkened
`success.dark` to `#306B3C` (5.06:1). The warning pair, `accent-dark`
`#C98A20` text on `accent-100` `#FBE9C5`, computes 2.5:1; other tones were not
measured. The theme studio shows only the success badge, so
`bin/theme-check` does not see the others. Measure each tone and fix the
palette pairs below 4.5:1.

## Manual testing

> Verified by boxholder 2026-11-15

The contrast changes are committed in 5631c13ae; they are not landed. Review the “Theme contrast before and after” exhibit in the theme-check-gate workstream. Confirm that the adjusted text and chip colors preserve the intended appearance. The full catalog check passed with exit 0 across all 25 cases; evidence is recorded in the [implementation plan](../../../beebox/docs/implemented-plans/theme-check-gate.md); visual approval remains a separate gate.

## Measurements 2026-11-15

The six solid palette pairs now compute to neutral 5.64:1, info 5.74:1, success 5.06:1, warning 4.68:1, danger 4.87:1, and accent 5.45:1. Only warning and danger text changed; their fills did not. The studio now renders all six tones and the material-neutral variant. Targeted phone and laptop pixel checks passed.

