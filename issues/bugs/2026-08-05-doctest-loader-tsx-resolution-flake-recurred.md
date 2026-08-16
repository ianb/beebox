---
title: "Doctest TSX resolution flake recurred after the loader fix"
workstream: load-older-label
area: callback-box
filed-by: agent
discovered-in: worktree-load-older-label — full finish-suite verification
next-action: reconfirm
---

The full parallel `callback-box` suite still intermittently resolves an
extensionless frontend import to a missing module. This recurred after the fix
documented in
[the earlier loader issue](../closed/bugs/2026-08-05-doctest-loader-tsx-resolution-under-parallel-load.md).

One run failed 12 frontend doctest files. Each child ended with
`1..0 # no tests found`. The underlying error tried to load
`src/frontend/src/lib/trpc` without resolving its `index.ts` module. The branch
did not change the doctest loader, the failed tests, or the imported module.

All 12 failed files passed together in isolation with one job: 78/78
assertions. The one permitted full-suite rerun then passed 6,169/6,169
assertions. This matches the prior parallel-load signature, but it shows that
the earlier TSX upgrade and loader guard did not eliminate every form of the
resolution flake.

Investigate the remaining extensionless-directory import path under parallel
TAP child startup. Add a stress regression that imports the frontend tRPC
directory entrypoint from multiple child processes.

## Reproduction under machine contention (2026-08-08)

A profiling run independently reproduced the same signature in 13 frontend
doctest children: each ended with `1..0 # no tests found`, and all 13 passed at
`jobs=1` immediately afterward. The machine's load average was approximately
18 with about 37 Claude or Codex processes live. The earlier occurrence was
also a parallel full-suite run, but its machine load was not recorded. The new
measurement makes heavy contention the strongest current trigger hypothesis,
not yet a conclusion from every occurrence.

`test/frontend/trpc-directory-resolution.test.ts` now starts 12 Node children
concurrently. Each child registers the same tsx and doctest loaders used by TAP,
imports `view-bindings.ts` through its real extensionless `./trpc` edge, checks
an expected export, and emits a success marker required by the parent. This is a
targeted stress regression for the unresolved import shape. Record repeated
runs under both quiet and loaded conditions before treating a pass as evidence
that the underlying flake is fixed.

The first run plus 10 immediate repetitions passed all 132 child imports. Those
repetitions ran at load average roughly 3 with 13.85 of 15.36 GB swap used and
11 Claude or Codex processes live. The regression therefore covers the actual
import edge but does not reproduce the failure deterministically under this
moderate CPU load; substantially heavier contention remains to be tested.
