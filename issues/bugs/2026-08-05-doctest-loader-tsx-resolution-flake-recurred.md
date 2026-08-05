---
title: "Doctest TSX resolution flake recurred after the loader fix"
area: callback-box
filed-by: agent
discovered-in: worktree-load-older-label — full finish-suite verification
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
