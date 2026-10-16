---
title: Markdown task checkboxes have no accessible name
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-polish — Bloom browser tour
---

Markdown task lists render disabled checkbox inputs followed by ordinary list
text. The `Task` component in `beebox/src/frontend/src/components/Markdown/body.tsx`
does not associate that text with the input. Screen readers encounter unnamed
checkboxes, and axe reports `label` at both desktop and mobile widths.

Reproduce with the `bloom-theme` tour's `bloom-workspace` checkpoint. The three
checklist items in `bloom-inherited.memo.card` expose the existing renderer
behavior; the theme adds no checkbox markup. Associate each checkbox with its
task text while preserving the read-only task presentation.
