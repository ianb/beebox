---
title: ThemedFileCard directory fails the unit layout check
workstream: unattached
area: beebox
filed-by: agent
discovered-in: worktree-theme-polish — theme studio verification
---

`cd beebox && pnpm layout-check` reports one `unit-directory` finding at
`src/frontend/src/components/themes/ThemedFileCard/view.tsx`. The checker groups
CardAttachments, CardLastChange, CardProperties, PropertiesFace, ThemeSwatchPicker,
and property-section with that view and asks for a `view/` unit directory.

The theme studio changes do not edit that directory. This pre-existing finding
keeps the repository layout check red. Inspect the shared helpers before moving
them so other consumers retain correct imports.
