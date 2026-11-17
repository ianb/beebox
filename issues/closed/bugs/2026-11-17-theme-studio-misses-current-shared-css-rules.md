---
title: "Theme Studio misses current shared CSS rules"
workstream: theme-check-gate
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-check-gate — verifying conversation activity across themes
resolution: implemented
---

**Closed (implemented, 2026-11-17):** Commit 22aa29a1d adds real composition and focused-card coverage; commit 2d1ce6545 fixes Tempest error text contrast; full bin/theme-check --all --jobs 6 passed all catalog, contrast, backdrop and rule coverage jobs.

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

## Research (2026-11-17)

The baseline reproduced all seven selectors. Two are catalog-dependent defaults,
not absent content: `materials.css` requires layered quote and blockquote
attributes, while Tempest uses inset defaults. The studio already renders an
explicit layered quote. Paper is the real catalog case for the layered defaults.
The remaining five selectors need a composition-editor frame and focused-card
state. The repair uses the shared production frame and real PaneControls,
and measures the ordinary studio before entering the focused laptop state.
No selector exemptions or contrast thresholds change.

Verification reduced the paired Tempest report from seven unmatched selectors
to the two layered-default residuals. All five missing-state selectors match,
including the focused laptop audit. Laptop contrast passed 292 text runs;
phone's known seed-list danger text remained below AA. This targeted run does
not establish a full `--all` catalog pass. Local log:
`scratch/coverage/verified.log`.
