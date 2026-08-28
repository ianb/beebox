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

## Resolved — 2026-08-28

`bin/` is in the root eslint config's `roots` alongside `schedules/`, under the
same reviewed personal-vibe-check ruleset every package uses. Because `bin/` is
not a workspace package, root `pnpm lint` cannot reach it through `-r`: a new
`lint:bin` script runs eslint over it and `pnpm lint` runs that first.
`dispatchPlan` in `bin/lint-changed.ts` emits `pnpm lint:bin` for a changed
`bin/**/*.{ts,tsx,js,jsx,cjs}` path (mirroring the `schedules/` case), and
pre-commit runs it when such a file is staged — so a `bin/` change is no longer
gated on typecheck alone.

634 findings at the wall, burned down to zero **by fixing the code**. The shape
of the debt, largest first: 163 `no-restricted-syntax` (94 `as` casts, 69
unbound `catch`), 198 across the three `error/*` rules (~50 throw sites),
63 `unicorn/no-array-sort`, 33 `max-params`, 25 `unicorn/better-regex`, 22
`default/no-default-params`, 18 `max-lines`, and a long tail.

Notable consequences:

- **Custom error classes.** Every `throw new Error("…")` became a named class
  composing its message in the constructor. Where a module had one catch-all
  (`ScheduleError`, `DoctorError`, `UsageError`, `PreflightError`,
  `SmokeFailureError`) it stayed as the base and each failure became a subclass,
  so existing `instanceof` catches and doctest assertions still hold. Every
  user-visible message string is byte-identical.
- **`as` is gone from `bin/`**, replaced by type guards and zod parses at the
  real boundaries (lock files, cache files, `.taprc`, `package.json`,
  `.cb-box`, agent-liveness JSON). One exception: `bin/router-markdown.ts`
  keeps a one-line `import-x/no-named-as-default-member` disable — `@markdoc/markdoc`
  is CJS, so the named imports its types advertise do not exist at runtime.
  Two `security/detect-non-literal-regexp` disables remain in
  `bin/commit-blocklist-check.ts`, where a `re:` entry is a user-authored
  regex by documented contract.
- **Every `catch` in the process-supervision code now names the race it
  absorbs** — the router, the workstreams-app supervisor, `process-cleanup`,
  `test-locks`. That was the point of the exercise as much as the rule was.
- **`max-lines` forced the big files apart** (pure moves, exported surface
  preserved): `router.ts` 1671 → 484, `router-core.ts` 820 → 137,
  `router-docs.ts` 908 → 429, `workstreams-app-supervisor.ts` 779 → 256,
  `agent-quotas.ts` 663 → 40, `issues.ts` 417 → 205, plus `smoke-lib.ts`,
  `doctor.ts`, `schedules.ts`, `test-ledger.ts` and four oversized test files.
  `bin/docs/router-protocol.md` and `bin/CLAUDE.md` were re-pointed at the new
  modules.
- One deliberate behavior change, flagged rather than hidden: the router's WS
  `upgrade` listener used to leave its rejection floating (an unhandled
  rejection would take down the shared router). `no-floating-promises` forced a
  decision; it now has the same log-and-destroy boundary the HTTP path already
  had.

`bin/router-doc-browser*.ts` is retired-but-not-deleted dead code; it was split
into clean siblings whose headers point at
`2026-08-22-retire-doc-browser-dead-code.md`, which gates the deletion on
porting `appendClosedIssuePills` first.
