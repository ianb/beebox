---
title: ThemedFileCard directory fails the unit layout check
workstream: theme-polish
area: beebox
filed-by: agent
discovered-in: worktree-theme-polish — theme studio verification
resolution: implemented
---

Resolved by commit `c69cd3b04`, which moved ThemedFileCard's entry, exclusive
helpers and matching doctests into the required `view/` unit and updated their
imports. The shared CardThemeSurface remained in its original location.

`cd beebox && pnpm layout-check` reported one `unit-directory` finding at
`src/frontend/src/components/themes/ThemedFileCard/view.tsx`. The checker grouped
CardAttachments, CardLastChange, CardProperties, PropertiesFace, ThemeSwatchPicker,
and property-section with that view and asked for a `view/` unit directory.

The theme studio changes did not edit that directory. This pre-existing finding
kept the repository layout check red. The shared helpers were inspected before
moving them so other consumers retained correct imports.
