---
title: "Shared helper to spawn a bin/*.ts CLI from a doctest fixture"
workstream: unattached
area: bin
labels: [tests, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261013-224557
---

bin/ doctests that run a `bin/*.ts` CLI from a fixture repo each hand-roll
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
