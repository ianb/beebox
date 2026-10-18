---
title: "Try the TypeScript 7 native compiler (`tsgo`) beside `tsc` 5.9"
workstream: ts7
resolution: implemented
area: beebox
labels: [tooling, typecheck]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asked whether the repo uses TypeScript 7
---

**Closed:** implemented on branch worktree-ts7 (plan `beebox/docs/implemented-plans/typescript-7.md`). The repo uses TypeScript 7.0.2 for compile and typecheck; typescript-eslint and agent-doctest's doctest typecheck stay on 6.0. Follow-up: `issues/watch/2026-10-17-move-typescript-eslint-to-typescript-7.md`.

The repo uses TypeScript 5.9.3. The root `package.json` pins `^5.9.3`.
`beebox/` and `workstreams-app/` pin `^5.7.0`. `personal-vibe-check` peers on
`>=5`. Every `typecheck` script runs `tsc`. Nothing uses `tsgo` or
`@typescript/native-preview`.

TypeScript 7 is the native (Go) port of the compiler. Its main claim is a large
typecheck speedup. Typecheck time is part of every finish run (see
[speed up lint and typecheck](../code-quality/2026-08-12-speed-up-lint-and-typecheck.md)).

## Questions

- How much faster is `tsgo --noEmit` than `tsc --noEmit` on `beebox/`
  (backend and frontend projects) and on `workstreams-app/`?
- Does `tsgo` report the same errors on a clean tree? Which differences come
  from 7.0 behavior changes, and which come from our config (for example
  options that 7.0 removed)?
- What else depends on the `typescript` package API: typescript-eslint,
  `tsx`, knip, the doctest module generation in `agent-doctest`, editor
  tooling. Can `tsgo` replace only the typecheck step while the API users
  stay on 5.x?

## First step

Run `tsgo` next to `tsc` without changing the pinned dependency. Record
timings and error differences here, then propose a migration or a reason to
wait.

## Research (2026-10-17)

### What TypeScript 7 is now

`typescript@latest` is 7.0.2 (stable). `next` is 7.1 nightlies. The 7.x
package ships the Go binary as `bin/tsc`. Its main export is only
`{ version, versionMajorMinor }`; the classic `ts.*` API is gone, and a new API
exists only under `typescript/unstable/*`. A package that does
`import ts from "typescript"` cannot run on 7.x.

The repo already has a `tsgo` in `node_modules/.bin`: a May 2026
`@typescript/native-preview` that `tshy` (via `tap`) pulls in. Nothing uses it.
This probe used `typescript@7.0.2` installed outside the repo, run against the
worktree's projects. No dependency or tracked config changed.

### Timings

Apple M2 Pro, 12 cores, load average 20–30 from other sessions, so the
numbers are noisy. Median of 3 runs, seconds. Cold: no buildinfo. Warm:
`--incremental` with an up-to-date buildinfo (the beebox scripts use
`--incremental`).

| Project | tsc cold | tsgo cold | tsc warm | tsgo warm |
|---|---|---|---|---|
| beebox backend (`tsconfig.typecheck.json`) | 21.9 | 2.3 | 2.8 | 0.38 |
| beebox frontend | 13.5 | 2.7 | 2.2 | 0.40 |
| workstreams-app backend | 2.9 | 0.65 | 0.97 | 0.19 |
| workstreams-app frontend | 2.3 | 0.48 | 0.65 | 0.12 |
| root | 3.4 | 1.8 | 1.1 | 0.42 |

Cold beebox typecheck (both projects) drops from about 35 s to 5 s.

### Error differences on a clean tree

`tsc` 5.9.3 reports nothing on any project. `tsgo` 7.0.2 also reports nothing
on root, `agent-doctest` and `personal-vibe-check`. Differences:

**tsconfig options that 7.0 removed or changed**

1. `beebox/src/frontend/tsconfig.json` sets `baseUrl`. 7.0 removed it (TS5102),
   and the error stops the check before any code is checked. All `paths`
   entries are already relative, so deleting the line is enough. With the line
   deleted, both compilers report nothing.
2. `workstreams-app/tsconfig.json` and `src/frontend/tsconfig.json`: 7.0 makes
   the tsconfig directory the default `rootDir` and checks it even under
   `noEmit`. Both programs import files outside it (`../beebox/src/...`,
   `../shared/...`), so 142 TS6059 errors. An explicit `rootDir` (`..` and
   `../../..`) clears them under both compilers.
3. `noUncheckedSideEffectImports` is now on by default. The beebox backend
   program reports TS2882 for the two CSS imports in
   `src/plugins/courseware/view/graph/ConceptGraph.tsx`. `tsc` 5.9 reports the
   same with the flag on. The underlying gap: the backend exclude
   `src/plugins/*/view.tsx` misses the `view/` directory, so the backend
   program checks browser view code under the Node lib. Fix: also exclude
   `src/plugins/*/view/**`.

**7.0 behavior change**

4. `beebox/src/field-test/operator-turns.ts:137`,
   `(outcome.note ?? null) ?? pending.texts.join(...)`: TS2871 "always
   nullish". 5.9 flags `a ?? null ?? b` but not the parenthesized form; 7.0
   looks through the parentheses. The `?? null` does nothing, so the code is
   redundant, not wrong. Fix: `outcome.note ?? pending.texts.join("\n\n")`.

**Real bugs `tsc` missed:** none, apart from the config gap in item 3.

All four fixes are also valid under 5.9, so they can land before any switch.

### What uses the `typescript` package API

| Consumer | Uses | Can it stay on 5.x while `tsgo` checks? |
|---|---|---|
| typescript-eslint 8.59 (typed rules in `personal-vibe-check/preset.ts:667`) | in-process program via `projectService` | Must stay. Peer is `>=4.8.4 <6.1.0`. |
| knip 5.88 | in-process program | Peer is `<7`. knip 6 parses with oxc and has no TypeScript dependency, so an upgrade removes this. |
| `tsx` | esbuild only, reads tsconfig | Not affected. |
| tap / `@tapjs/test` / `tshy` | depend on `typescript` 5.9 themselves | Not affected; they bring their own. |
| `agent-doctest` `doctest-typecheck` | `createIncrementalProgram` in-process | Must stay. No doctest work planned (the doctest tier may go away). |
| beebox runtime: `bbx view typecheck`, `core/views/markdown-check`, `dev/layout/*`, `scripts/user-stories/build-workflows.ts` | `createProgram`, `createSourceFile`, `transpileModule` | Must stay. `typescript` is a beebox runtime `dependency`. |
| Box scaffold (`core/box/package.ts`) and `bbx upgrade` | write a `typescript` range into box devDependencies, run the box's `tsc` | Stays 5.x. Boxes are a separate decision. |
| finish-verify, husky pre-commit | run `pnpm typecheck` per package | Switch automatically if the package scripts switch. |
| Editors | no `.vscode`/`typescript.tsdk` in the repo | Each editor uses its own TS. Unchanged. |

So a full move of `typescript` to 7.x is blocked by typescript-eslint. beebox's
own runtime code can move to the 7.0 `unstable/` API (see below).

### Recommendation

Switch only the typecheck step. Wait on the full migration.

1. Land the four 5.9-compatible fixes above.
2. Add 7.x under an alias, for example `"typescript-native":
   "npm:typescript@7.0.2"` in the root devDependencies. Both packages declare a
   `tsc` bin, so scripts call the alias by path (or through a small `bin/tsgo`
   wrapper) and leave `tsc` meaning 5.9. Keep `typescript` 5.9 everywhere else.
3. Point the `typecheck*` scripts (beebox backend and frontend, workstreams-app,
   root, `bin/dev-apps-typecheck`) at it. finish-verify and the pre-commit hook
   follow without changes.

Cost: two compilers. Typed lint, `bbx view typecheck` and box `tsc` still run
5.9, so a rare 7.0-only diagnostic (like item 4) can appear in typecheck but
not elsewhere. On this tree that difference was one line.

Revisit the full migration when typescript-eslint and knip support 7.x and the
7.x API is no longer `unstable`. beebox's runtime uses would then move to that
API or keep 5.x as a separate dependency.

### Parse through the 7.0 API (added 2026-10-17)

The 7.0 API parses in the Go process and returns syntax trees over a pipe.
Measured with `typescript/unstable/sync` and an in-memory file system:

| Workload | 5.9 `createSourceFile` | 7.0.2 API |
|---|---|---|
| Load | 100 ms | 40 ms + 9 ms process start |
| 4 plugin view files | 13 ms | 89 ms first, under 1 ms cached |
| 1,500 beebox files, one snapshot | 1.0 s | 1.6 s |
| 1,500 files, one snapshot each, no tsconfig | — | 31 s |
| 1,500 files, one snapshot each, `noLib`/`noResolve` tsconfig | — | 1.8 s |

Node counts match 5.9 in every run. Files left open stay open across
snapshots, so per-file use must close each file. Reusing one file name with
`fileChanges: { changed }` returned stale trees.

The 7.0 node API matches 5.9 for what our walkers use (`kind`, `parent`,
`forEachChild`, `getStart`, `getText`). Three guards are renamed:
`isParameterDeclaration`, `isPropertySignatureDeclaration`,
`isStringLiteralLikeNode`. The 7.1 nightlies export the same modules without
the `unstable/` prefix.

The decision and the work are in the
[TypeScript 7 plan](../../../beebox/docs/implemented-plans/typescript-7.md). The tools that
stay on the 6.0 API are in
[the follow-up](../../watch/2026-10-17-move-typescript-eslint-to-typescript-7.md).
