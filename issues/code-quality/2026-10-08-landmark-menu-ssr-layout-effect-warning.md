---
title: Landmark menu server-rendering doctest emits a layout-effect warning
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-polish — changed frontend doctest run
---

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

The frontend doctest run emits React's `useLayoutEffect does nothing on the
server` warning from `AppNav/PlacePill-landmarks.tsx`. The assertions pass, but
the warning obscures actionable test diagnostics.

`beebox/src/frontend/test/components/AppNav/PlacePill.menus.test.ts` renders
`SwitchMenuBody` with `renderToString`. That component renders the landmark
list in `beebox/src/frontend/src/components/AppNav/PlacePill-landmarks.tsx`.
The list calls `useLayoutEffect` unconditionally, including when search is
closed. The callback's early return does not prevent React's server-render
warning, because the server does not execute layout effects.

## Research (2026-10-08)

The test's server-render path and the component's layout-effect call both
exist at predecessor commit `9550fa6e3`. Neither file changed in theme-polish.
The theme work adds a presentation-context read to Dropdown, but this warning
comes from the existing landmark component's hook. This attribution is based
on source comparison; the predecessor suite was not separately rerun.

Keep the menu's browser focus and viewport behavior when resolving this.
Choose whether the test should render in a browser-like environment or the
component should use an SSR-compatible effect. Do not suppress all console
warnings in the doctest harness.
