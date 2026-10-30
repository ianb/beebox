---
title: "Shared helper to spawn a bin/*.ts CLI from a test fixture"
workstream: unattached
area: bin
labels: [tests, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261013-224557
resolution: implemented
---

**Closed 2026-10-29 (tooling-burndown).** `bin/lib/bin-ts.ts` exports
`binTsArgs(entry, args)`: the node arguments that run a `bin/*.ts` entry with
tsx resolved from the repository, the entry absolute or repo-relative. Every
call site that spawned a bin TS entry with `--import tsx` or
`import.meta.resolve("tsx")` uses it: `finish-verify`, finish-preflight's
selector spawn, `test-select --run`, the schedules test support, and the bin
tests for commit-provenance, codex-preamble, schedules-lint, skill-lint,
test-select, finish-preflight, finish-preflight-merge, finish-verify,
doc-lifecycle-check, briefing-sigils, and schedules alerts. Shebangs and
package scripts keep `--import tsx`: they run where `node_modules` is present.

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

bin/ tests (doctests when filed; `bin/test/*.test.ts` since 2026-10-18, e.g. `finish-preflight.test.ts`, `finish-verify.test.ts`) that run a `bin/*.ts` CLI from a fixture repo each hand-roll
the spawn: tsx resolution (`import.meta.resolve("tsx")`), cwd and env. A bare
`--import tsx` resolves relative to cwd, so it fails when cwd is a fixture
outside the repo or a checkout without `node_modules`.

Evidence (CODING_FEEDBACK):

- `finish-tooling/20261012T164458Z-implemented.md`: three doctests hand-roll
  the spawn.
- `finish-tooling/20261012T165414Z-review-adjudicated.md`: finish-verify
  spawned preflight with a bare `--import tsx` and broke outside the repo;
  the pattern recurs in bin shims.
- Retrospective watch item `tsx-shim-needs-node-modules` (2026-10-08): the bin
  tsx shim cannot run from a checkout without `node_modules`, so a doctest
  loads tsx by absolute path.

Done when one exported helper spawns a bin TS entry with tsx resolved from the
repo, and the existing hand-rolled call sites use it.
