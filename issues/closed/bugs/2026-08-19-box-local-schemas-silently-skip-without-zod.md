---
title: "Fresh box lacks zod — box-local schemas silently fail to load"
workstream: unattached
area: callback-box
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-public-site — box-authored site page experiment
priority: important
---

Every box-local schema imports `zod`, but a fresh box package's
`package.json` ships without it (test1's had only `callback-box`/`react`).
Loading then fails with only a warning — `Warning: failed to load box schema
…: Cannot find package 'zod'` — and cards of that type silently fall back to
"no schema registered": no validation, no instructions injected, nothing
blocking.

Two parts:

- **Template gap**: `cb init`'s box template should ship `zod` (or the
  box-local schema guide should say to add it).
- **Silent fallback**: a schema file that exists but fails to load is a
  broken invariant, not a degradation — cards of that type validate as if
  the schema were never written. Fail hard, or at minimum surface it in
  `cb health`/validate output rather than a load-time warning.


## Fixed 2026-09-12

**Template gap — fixed.** `bbx init` now scaffolds `zod` into the box's
`dependencies`, at the same range the engine itself develops against (read from
the engine manifest like `react`/`typescript` already were), so a fresh box can
load a box-local schema without the owner discovering the missing dependency
through a warning. `test/cli/lib/init-v2.doctest.md` pins it.

**Silent fallback — already addressed, verified today.** A schema file that
exists but fails to load is no longer only a load-time warning:
`schemas/registry.ts` records every failure, and both surfaces read it —
`bbx status` prints a "Schema load failures" count, and the `box-schemas`
health check (`webapp/trpc/routers/health-engine.ts:79-90`) reports
`severity: "error"` naming each file and message. `server-root.ts` also reports
per-box totals. The one thing NOT done is failing hard at load; the issue
offered that or surfacing as alternatives, and surfacing is what shipped.
