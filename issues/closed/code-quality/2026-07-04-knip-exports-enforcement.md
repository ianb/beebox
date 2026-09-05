---
title: "Enable knip's `exports` check and burn down the backlog"
workstream: knip-exports
resolution: implemented
---

2026-07-04 · **Done 2026-08-24.**

The `exports` check is on (`knip.ts`, monorepo root) and the backlog is
**651 → 0**. It runs weekly rather than as a commit gate
(`2026-08-24-run-periodic-sweeps-weekly.md`), and `docs/maintenance.md` says
the output should be empty — so it now is.

The measured number was wrong before it was large. Four blind spots made knip
count live code as dead, each fixed before anything was deleted:

- **Doctests are markdown.** The suite imports ~3,000 symbols from `src/`
  through `.doctest.md` fences, which knip cannot parse. A compiler
  (`beebox/scripts/knip-doctest-imports.ts`, itself doctested) lifts the
  import statements out, static and `await import(...)` forms alike.
- **`test/` and `scripts/` weren't in `project`**, so the suite's imports never
  counted as use.
- **The workspaces couldn't see each other.** The frontend imports
  `src/shared` via `@shared/*`, `bin/` imports `beebox/src` by relative
  path, and beebox's doctests exercise frontend machines. One rooted run
  resolves all of it.
- **knip ran per-package under `node-linker=hoisted`**, where dependencies
  install into the ROOT `node_modules`. It could not tie a binary a script
  invokes to the package declaring it, reporting the same tool as an unlisted
  binary AND an unused devDependency at once.

Fixing those took the count from 651 to 421 before a line was deleted. The
burn-down itself: ~250 exports un-exported in place, ~40 deleted, and several
barrels removed (`src/services/index.ts`, `src/frontend/src/file-types/index.ts`)
per the no-barrels decision. `code-style.md` now states that a missing `export`
is never a decision to respect — just the current call count.

Things found along the way, each with its own resolution:

- Backend `.tsx` escaped 71 reviewed lint rules, including two that demanded
  the *opposite* of this rule (every top-level declaration must be exported).
  Fixed; see `closed/code-quality/2026-08-24-backend-tsx-escapes-reviewed-lint.md`.
- `bin/` imported `better-sqlite3`, `@markdoc/markdoc`, and `esbuild` without
  declaring them, the root ran `tsc` with no `typescript` dependency, and
  `@fastify/cookie` and `knip` were likewise undeclared. All resolved only
  through hoisting. Now declared.
- Three exports are consumed from outside their package in ways the graph
  can't show; they carry a `@public` tag naming the consumer rather than an
  ignore list in the config.
