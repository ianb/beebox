---
title: "Badge text is below AA on its own fill for some tones"
workstream: unattached
area: beebox
labels: [frontend, contrast]
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-ink-dark-themes — theme studio specimen for an answered question's status badge
---

`components/ui/Badge.tsx` pairs each tone's text with a light fill. The
success pair measured 3.86:1 (`#3C7F49` on `#D6EADD`); this workstream darkened
`success.dark` to `#306B3C` (5.06:1). The warning pair, `accent-dark`
`#C98A20` text on `accent-100` `#FBE9C5`, computes 2.5:1; other tones were not
measured. The theme studio shows only the success badge, so
`bin/theme-check` does not see the others. Measure each tone and fix the
palette pairs below 4.5:1.
