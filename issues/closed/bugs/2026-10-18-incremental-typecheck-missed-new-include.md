---
title: "typecheck:frontend's --incremental build info kept reporting errors after an include fixed them"
workstream: bug-burndown-4
resolution: implemented
area: beebox
labels: [tooling, typecheck]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doctest-typecheck — full typecheck of the converted doctests in a scratch worktree
---

> **Closed 2026-10-20 (bug-burndown-4):** reproduced in isolation under
> TypeScript 7.0.2; 6.0.3 handles the same steps. `--incremental` and
> `--tsBuildInfoFile` were dropped from `typecheck:frontend`
> (`beebox/src/frontend/package.json`), `typecheck:backend`, and
> `build:declarations` (`beebox/package.json`). A cold run of each typecheck
> took 11–12 s here. Restore the flags once an upstream fix ships. The upstream
> report is drafted below and has not been filed.

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

## Reproduction (2026-10-20)

Two files and a tsconfig whose `include` gains the second file:

```sh
cat > a.ts <<'X'
export const n: number = (globalThis as unknown as Thing).value;
X
cat > types.d.ts <<'X'
interface Thing { value: number }
X
cat > tsconfig.json <<'X'
{ "compilerOptions": { "strict": true, "module": "esnext", "target": "es2022",
    "moduleResolution": "bundler" }, "include": ["a.ts"] }
X
tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile b.tsbuildinfo
# a.ts(1,52): error TS2304: Cannot find name 'Thing'.   (expected)
sed -i '' 's/"include": \["a.ts"\]/"include": ["a.ts", "types.d.ts"]/' tsconfig.json
tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile b.tsbuildinfo
# a.ts(1,52): error TS2304: Cannot find name 'Thing'.   (stale)
tsc --noEmit -p tsconfig.json                          # clean
tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile c.tsbuildinfo  # clean
```

| Compiler | Second incremental run |
|---|---|
| `typescript@7.0.2` (native) | stale TS2304 |
| `@typescript/typescript6` 6.0.3 | clean |

## Draft upstream report (not filed)

> **Title:** `--incremental`: adding a file to `include` does not invalidate
> the build info (7.0.2 regression from 6.0)
>
> With `--incremental --noEmit`, after a run writes the `.tsbuildinfo`, adding
> a declaration file to `tsconfig.json`'s `include` does not change the result
> of the next incremental run: diagnostics that the new root file resolves are
> still reported. A non-incremental run, or an incremental run with a fresh
> build info file, is clean. TypeScript 6.0.3 reports correctly on the same
> steps. Steps: the script above. Expected: the second incremental run
> reports no errors. Actual: `a.ts(1,52): error TS2304: Cannot find name
> 'Thing'.` Version: 7.0.2, macOS.
