---
title: "bin/*.ts is linted by nothing — the root eslint config covers only schedules/"
workstream: unattached
area: router
labels: [lint, bin]
filed-by: agent
discovered-by: agent
discovered-in: tour-health — a bin/smoke.ts change went in with `pnpm lint:changed` reporting "nothing lintable changed"
---

`bin/` holds real TypeScript — the dev router, `bin/smoke.ts`, `bin/lint-changed.ts`,
`bin/land`, the worktree tooling — and none of it is linted. `bin/lint-changed.ts`'s
own header says why it is skipped there: *"`schedules/` is not a package —
`bin/schedules lint` is what checks it, and it is the only root path the root
eslint config lints."* Root `pnpm lint` fans out to packages, and `bin/` is not
one. So a `bin/` change passes pre-commit on typecheck alone, while `test/` code
in callback-box is held to the full reviewed ruleset.

The pre-commit typecheck does cover `bin/` (root tsconfig), so this is the lint
rules — the `as` ban, no-floating-promises, exhaustiveness, the logging
policy — not type safety. Fix is probably to add `bin/**/*.ts` to the root
eslint config's roots alongside `schedules/`, then burn down whatever it finds
(the router is process-supervision code with a deliberately large defensive
budget, per `code-style.md`, so expect justified exceptions there).
