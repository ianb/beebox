---
title: "Theme Studio misses current shared CSS rules"
workstream: theme-check-gate
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-check-gate — verifying conversation activity across themes
---

`bin/theme-check --system tempest` reports seven shared CSS rules that match
nothing in Theme Studio at any screen. The list includes rules for layered
quote treatments, a composition label, and the companion focused-card layout
and controls recently merged to `main`:

- `.bbx-box-presentation:has(.bbx-companion-desk[data-card-focused]:not([hidden])) .bbx-app-nav`
- `.bbx-companion-desk[data-card-focused] .bbx-interface-card-desk[data-card-content="card"]`
- `.bbx-companion-focus-controls > [role="group"]`
- `.bbx-companion-focus-controls`

The ambient conversation panel now has real component coverage in the tour,
but this focused system run still cannot verify those other surfaces. Add
faithful specimens for renderable states and route states that Theme Studio
cannot represent to an appropriate test surface. Keep unmatched-rule reporting
active so new shared CSS does not silently escape the gate.
