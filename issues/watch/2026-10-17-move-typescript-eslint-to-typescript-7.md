---
title: "Move typescript-eslint off the TypeScript 6.0 API"
workstream: unattached
area: beebox
labels: [tooling, typecheck]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-ts7 — the TypeScript 7 move kept these tools on the 6.0 API
---

The [TypeScript 7 plan](../../beebox/docs/implemented-plans/typescript-7.md) moves every
compile, typecheck and beebox runtime use of TypeScript to 7.0. Two users of
the old JavaScript compiler API stay on the `typescript` name, which points at
`@typescript/typescript6` (6.0):

- **typescript-eslint** (typed rules in `personal-vibe-check/preset.ts`). Its
  peer range is `>=4.8.4 <6.1.0`. The maintainers closed the 7.0 support
  request ([#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518)):
  7.0 has no API. They track 7.x support in
  [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940).
- **`agent-doctest`'s `doctest-typecheck`** (`agent-doctest/src/typecheck/check.ts`)
  and the three doctests that import `typescript`. The boxholder decided not
  to port it (2026-10-17). If the doctest tier is removed, this item goes
  with it. Done 2026-10-18: retire-doctest track 6 removed `doctest-typecheck`,
  and the two tests that imported `typescript` now go through
  `beebox/src/lib/typescript/`.

While these stay on 6.0, typed lint can see a different diagnostic than the
7.0 typecheck on rare code. On this tree at 2026-10-17, `tsc6` and 7.0
reported the same errors on every project.

## Trigger

TypeScript 7.1 ships its stable API (the 7.1 nightlies export `./sync` and
`./ast` without the `unstable/` prefix), and typescript-eslint publishes a
release whose `typescript` peer range includes 7.x.

## Re-check then

- Change each `typescript` alias to the 7.x package, then remove
  `@typescript/native` or make it the same version.
- Rename the `unstable/` imports in `beebox/src/lib/typescript/`.
- Move existing boxes' `typescript` devDependency (new boxes already scaffold
  7.x). This is a change on boxholders' machines, so it needs its own decision.
