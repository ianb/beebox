---
title: "Theme studio: live contrast overlay"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-audit — plan theme-studio.md, "NOT in scope"
---

Contrast is measured only by `bin/theme-check`, from screenshots. A person
editing a theme sees a miss only after running the check. The studio could
show failing text live, as an overlay that outlines text below AA.

Tension: pixel contrast needs a screenshot, and a page cannot take a
screenshot of itself. An overlay would have to compute contrast from computed
styles, which misses gradients, images and translucent layers, the cases the
pixel check exists for. Decide whether an approximate overlay is worth
showing next to the exact check.
