---
title: Landmark menu server-rendering doctest emits a layout-effect warning
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-polish — changed frontend doctest run
resolution: implemented
---

> Resolved 2026-10-19 in bug-burndown-3: the landmark list uses an SSR-safe layout effect.

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

## Resolution

2026-10-19 (bug-burndown-3): Chose the SSR-compatible effect. New
`beebox/src/frontend/src/hooks/use-isomorphic-layout-effect.ts` exports
`useIsomorphicLayoutEffect` (`useEffect` when `window` is undefined,
`useLayoutEffect` otherwise); `PlacePill-landmarks.tsx` uses it, so browser
focus and viewport timing are unchanged. The frontend ESLint config registers
the hook with `react-hooks/exhaustive-deps` (`additionalHooks`) so its
dependency list is still checked. `PlacePill.menus.test.ts` now fails if React
reports through `console.error` during its server render; it captures only
inside that render and does not silence the harness.
