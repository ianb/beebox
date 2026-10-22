---
title: "A commit that changes only bin/ TypeScript is linted but not typechecked"
workstream: doctest-typecheck
area: tooling
priority: normal
labels: [tooling, hooks]
filed-by: agent
discovered-by: agent
discovered-in: doctest-typecheck — a test file with a type error committed cleanly
resolution: implemented
---

Fixed by the commit that carries this issue's `Issue:` trailer: `.husky/pre-commit` runs the root `pnpm typecheck` when staged `bin/` or `schedules/` TypeScript exists and the `beebox/src/` branch did not already run it.

`.husky/pre-commit` runs the root `pnpm typecheck` (whose program includes
`bin/**/*.ts`, `tsconfig.json:24`) only inside the `beebox/src/` branch:

    if echo "$staged" | grep -q '^beebox/src/'; then
      ...
      echo "[pre-commit] .: pnpm typecheck (bin/ imports beebox source)"

A staged `bin/` file reaches only `pnpm lint:bin`. On 2026-10-18 commit
6a16cd0c0 added `bin/test/doctest-convert/dispatch.test.ts` with a TS2345
error; the commit passed, and the error showed only in a later manual
`pnpm typecheck` (fixed in ef3d9de81). tap's TypeScript loader strips types,
so the test itself passed too.

Fix direction: in the `bin/` branch beside `lint:bin`, also run the root
`pnpm typecheck` when staged `bin/**/*.ts` files exist (skip it if the
`beebox/src/` branch already ran it).
