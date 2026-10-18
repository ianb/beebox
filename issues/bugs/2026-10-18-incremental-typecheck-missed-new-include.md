---
title: "typecheck:frontend's --incremental build info kept reporting errors after an include fixed them"
workstream: doctest-typecheck
area: beebox
labels: [tooling, typecheck]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doctest-typecheck — full typecheck of the converted doctests in a scratch worktree
---

`beebox/src/frontend` runs `tsc --noEmit -p tsconfig.test.json --incremental
--tsBuildInfoFile node_modules/.cache/tsc/frontend.tsbuildinfo` (TypeScript
7.0.2).

In a scratch worktree, `pnpm typecheck` there reported 12 `openAccess` errors
(TS2339) after `tsconfig.test.json` had gained `../types/fastify.d.ts` in its
`include`, which declares that property. The same program without
`--incremental` (`tsc --noEmit -p tsconfig.test.json`) reported none, and
after deleting `frontend.tsbuildinfo`, `pnpm typecheck` reported none too.

The build info had been written before the worktree's checkout moved to the
commit that added the include. Not reproduced in isolation: the cause may
be TypeScript 7's incremental check not invalidating on a changed root-file
list, or something about checkouts that move under an existing cache.

The consequence runs both ways: stale build info can report errors that no
longer exist, as here, and may also hide new ones.

Next step: reproduce with a two-file project (build info written, then a
file added to `include`) under 7.0.2. If it reproduces, report it upstream
and either drop `--incremental` from the typecheck scripts or key the cache
on the tsconfig contents.
