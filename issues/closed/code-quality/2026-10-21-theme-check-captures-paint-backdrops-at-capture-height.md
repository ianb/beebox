---
title: "theme-check's contrast captures paint backdrops at the capture's height, not the screen's"
workstream: theme-audit
area: beebox
filed-by: agent
discovered-by: codex gpt-6-sol (cross-model review)
discovered-in: worktree-theme-audit — backdrop audit review
resolution: implemented
---

> **Closed:** resolved on `worktree-theme-audit` (plan `theme-studio.md`, landed in the merge of that branch). The studio has an inner scroller; `bin/theme-check` captures by scroll step with stable `data-bbx-audit-run` ids, and `FIT_STUDIO_SCRIPT` is removed.

`bin/theme-check` captures the studio in one tall viewport (1280×2400 and
375×4400) so every sample is on screen. The studio's presentation grows to
that height, so artwork sized to the presentation (`cover`,
`auto max(1100px, 100%)`) paints at the capture's height. On a 375×667 phone
it paints at 1100px. The contrast measurement and the capture therefore show
text over a different crop and scale of the artwork than the app does. The
backdrop pass fixes the presentation to screen height, but it takes no
capture and measures no text.

## Possible resolution

Fix the studio presentation to screen height for the contrast pass too, and
scroll it one screen at a time. At each step, measure the text on screen and
merge the misses. The capture becomes one image per screen.
