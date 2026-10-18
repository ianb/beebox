---
title: "Move the repo to TypeScript 7, except typescript-eslint"
status: implemented
workstream: ts7
issues:
  - ../../../issues/closed/exploration/2026-10-17-try-typescript-7-native-compiler.md
---
# Move the repo to TypeScript 7, except typescript-eslint

Every compile, typecheck, and beebox runtime use of TypeScript moves to 7.0
(the Go compiler). The `typescript` package name stays on the 6.0
compatibility package because typescript-eslint imports its old JavaScript
API, and 7.0 has none. `agent-doctest`'s doctest typecheck also stays on 6.0
pending the boxholder's decision (Open design questions). A follow-up issue
tracks the move of those tools when 7.1 ships an API.

**Issues addressed:** `issues/exploration/2026-10-17-try-typescript-7-native-compiler.md`
(measurements and error diff in its Research section). Related, not closed:
`issues/docs-and-chores/2026-09-27-drop-typescript-eslint-no-misused-promises-patch.md`
(patches typescript-eslint 8.59.4; this plan does not change that version).
Searched `issues/` for "typescript 7", "tsgo", "native-preview", "baseUrl":
nothing else.

## Design

No design section: tooling and dependency change. A person using a box sees no
change. The agent edit hook (Markdown check on views) keeps its messages.

## Smallest fix and budget

Smallest fix: alias 7.0 beside 6.0 and point the `typecheck` scripts at it
(the "switch only the typecheck step" option from the issue). The boxholder
asked for more: "upgrade everything but typescript-eslint". So this plan also
ports beebox's runtime and dev-tool uses of the TypeScript API to the 7.0 API,
moves `build` emit to 7.0, and scaffolds new boxes on 7.0.

Estimate, additions plus deletions:

| Track | Source | Tests |
|---|---|---|
| A. Config fixes (tsconfigs, one source line, css declaration) | 30 | 0 |
| B. Dependencies (11 `package.json` files) | 40 | 0 |
| C. `src/lib/typescript/` module and the eight call-site ports | 350 | 60 |
| D. Box scaffold and base tsconfig | 20 | 20 |
| Docs touched (version mentions, `beebox/AGENTS.md` if any) | 30 | — |

About 550 lines. `pnpm-lock.yaml` changes are generated and reported
separately. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Boxholder, this conversation: "I don't really want to support both
  versions". The plan installs two packages (7.0 as `@typescript/native`, 6.0
  as `typescript`). Only third-party tools and `agent-doctest` load 6.0; no
  beebox code imports it after Track C. This is the side-by-side setup the
  TypeScript team recommends for 7.0 (see Prior art).
- Boxholder: "if we can upgrade everything but typescript-eslint, and setup a
  future issue for fixing that later". Then, 2026-10-17: "we should update
  knip and investigate what it found. We don't have to port agent-doctest
  typecheck." So knip moves to 6.x, and `agent-doctest` stays on 6.0.
- Handoff: "The human may remove doctests entirely, so do not invest in
  doctest-specific accommodation." So `agent-doctest` stays on the 6.0 API.
- `beebox/docs/engineering-principles.md` §8 "One way to do each thing": every
  beebox use of the compiler goes through one module (Track C).
- §4 "Resilient AND never silent": a failed API call or missing binary must
  fail the check loudly, never pass it.
- Memory "Bias toward strict": keep `noUncheckedSideEffectImports` on (7.0's
  new default) and declare CSS modules, rather than turn the check off.

## What already exists

- `beebox/src/dev/layout/scan/imports.ts:27` *"export function
  parseSourceFile(params: { fileName: string; sourceText: string }):
  ts.SourceFile"* — already the single parse entry point for the layout
  tooling (`scan/package/scan.ts:86`, `move/edges.ts:33`, `move/ts-edit.ts:48`,
  `move/doctest-edit.ts:48`). Reuse: it moves into the shared module.
- `beebox/src/core/views/markdown-check/core.ts:235`,`:260` — dynamic
  `await import("typescript")`, with the reason at `:233`: *"the compiler is
  ~8 MB of JS, and the CLI imports every command module eagerly"*. Keep the
  lazy load; the 7.0 API module loads in about 40 ms.
- `beebox/src/cli/commands/view/typecheck.ts:43-103` — writes a temp
  directory with `view.tsx` and `harness.ts`, builds a program, keeps
  diagnostics in `harness.ts` only.
- `beebox/src/scripts/user-stories/build-workflows.ts:52` —
  `ts.transpileModule`, keeps comments, drops TS1108 (top-level `return`).
- `beebox/src/dev/layout/scan/resolve.ts:36-41` — `readTsconfig` reads raw
  tsconfig JSON for `paths`.
- `beebox/src/core/box/package.ts:13` (in `versions`) *"typescript:
  engine.dependencies?.typescript ?? \"^5.7.0\""* and `:100` *"typescript:
  versions.typescript"* — the box gets the engine's own range.
- Tests that already pin the behaviour: `beebox/test/core/views/markdown-check.doctest.md`,
  `beebox/test/cli/commands/view/typecheck.doctest.md`,
  `beebox/test/dev/layout/move/ts-edit.doctest.md`, the `scan/` and `move/`
  doctests, and `pnpm smoke` (`beebox/src/scripts/smoke-external-box.ts:269`
  runs the box's `node_modules/.bin/tsc`).

## Prior art (external)

- TypeScript 7.0 announcement (adopted): 7.0 ships no API; the TypeScript team
  recommends `"@typescript/native": "npm:typescript@^7.0.2"` and
  `"typescript": "npm:@typescript/typescript6@^6.0.2"`. The 6.0 package's
  binary is `tsc6`, so `tsc` means 7.0.
  https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- typescript-eslint #12518 (evaluated): closed; *"no TS 7 API at this time"*.
  https://github.com/typescript-eslint/typescript-eslint/issues/12518
- `typescript@7.1.0-dev.20261017.1` exports (evaluated, `npm view`): the same
  modules without the `unstable/` prefix (`./sync`, `./ast`, `./ast/is`).
  The port should need only an import-path change at 7.1.
- Release ages against `minimumReleaseAge: 10080` (`pnpm-workspace.yaml`):
  `typescript@7.0.2` 2026-07-08, `@typescript/typescript6@6.0.2` 2026-07-06.
  Both are older than 7 days.

Adopted item is configuration only, so no ACKNOWLEDGEMENTS.md entry.

## Ontology

- **`@typescript/native`** — the dependency alias for `typescript@7.x`. Owns
  the `tsc` binary and the 7.0 API (`@typescript/native/unstable/*`). New
  name.
- **`typescript`** — the dependency name, now `@typescript/typescript6`.
  Exists for third-party peers and `agent-doctest`. No beebox import.
- **TypeScript module** (`beebox/src/lib/typescript/`) — the only beebox code
  that imports `@typescript/native`. New. Exposes the functions below.
- **Parser** — one 7.0 API instance with an in-memory file system holding one
  `tsconfig.json` (`noLib`, `noResolve`, `types: []`). Created per operation
  (one Markdown check, one layout scan or move) and closed after it. Not a
  type checker: it only returns syntax trees.

## Tracks / scope

### A. Config fixes that 6.0 and 7.0 both need

- **What:** the five diagnostics from the Research section, fixed so `tsc`
  5.9, `tsc6` and 7.0 all report nothing.
- **Why:** 7.0 and 6.0 both fail on these today (`tsc6` was run on every
  project: same errors). Typed lint runs on 6.0 after Track B, so lint also
  needs them.
- **Direction:**
  1. `beebox/src/frontend/tsconfig.json`: delete `"baseUrl": "."`. All `paths`
     values already start with `../`.
  2. `workstreams-app/tsconfig.json`: `"rootDir": ".."`.
     `workstreams-app/src/frontend/tsconfig.json`: `"rootDir": "../../.."`.
  3. `beebox/tsconfig.json` `exclude`: add `"src/plugins/*/view/**"`. The
     backend program then stops checking browser view helpers.
  4. `beebox/src/types/css.d.ts`: `declare module "*.css";`, added to
     `tsconfig.declarations.json` `include` (it emits `plugins/*/view.tsx`,
     which import CSS).
  5. `beebox-clerk/tsconfig.json`: `"types": ["chrome"]` (6.0 and 7.0
     default `types` to `[]`; the code uses the `chrome` global). Probe:
     with this one option, 7.0.2 reports nothing.
  6. `beebox/src/field-test/operator-turns.ts:137`:
     `note: outcome.note ?? pending.texts.join("\n\n")`.
- **First chunk:** all six, verified with `tsc` 5.9 (still installed at this
  point) and the 7.0.2 scratch binary. One commit.

### B. Dependencies

- **What:** every `package.json` that lists `typescript` (11 files: root,
  `beebox`, `beebox/src/frontend`, `beebox/pub-worker`, `beebox-clerk`,
  `agent-doctest`, `browse`, `canvas-loop`, `scan-uploader`, `site`,
  `workstreams-app`) gets `"@typescript/native": "npm:typescript@7.0.2"`
  and `"typescript": "npm:@typescript/typescript6@^6.0.2"` in
  `devDependencies`. The 7.0 version is exact: beebox imports `unstable/*` at
  runtime, and a fresh install outside this lockfile must not float to 7.1.
  `beebox` moves `typescript` out of `dependencies` and puts
  `@typescript/native` there (runtime use after Track C). `agent-doctest`
  keeps its `typescript` (now the 6.0 alias) in `dependencies`
  (`agent-doctest/package.json:23`; `check.ts:18` imports it at runtime).
  knip goes to 6.x, which parses with oxc and imports no TypeScript.
  `personal-vibe-check` keeps its peer `typescript >=5` (it is a published
  preset; consumers bring their own) and gets both in `devDependencies`.
- **Why:** the `tsc` binary in every script becomes 7.0 with no script edits.
  typescript-eslint (peer `>=4.8.4 <6.1.0`) resolves `typescript` to 6.0.2.
- **Lock-ins:** the alias name `@typescript/native` (the announcement's name).
- **First chunk:** edit the 11 files, `pnpm install`, then confirm
  `node_modules/.bin/tsc --version` prints 7.0.2, `node_modules/typescript`
  is 6.0.2, tap's and tshy's own copies are nested, and `pnpm install` prints
  no new peer warnings. Run every `typecheck` script and `pnpm lint` from
  root. Track C's call sites still import `typescript` and keep working on
  6.0 in this commit.

### C. The TypeScript module and its callers

- **What:** `beebox/src/lib/typescript/` with three files; the eight beebox call sites
  move to it.
- **Why:** after Track B, beebox's own code would load 6.0. The boxholder
  wants 7.0 for everything except typescript-eslint. One module also makes
  the 7.1 rename (`unstable/sync` → `sync`) one edit.
- **Direction:**
  - `syntax.ts`: `withParser<T>(fn: (parse: Parse) => T): T`, where
    `Parse = ({ fileName, sourceText }) => SourceFile` is synchronous. It
    creates the parser, runs `fn`, and closes the API in `finally`. Each
    `parse` adds the text to the in-memory file system under a fresh name,
    opens it in a new snapshot with `fileChanges: { created }`, reads the
    tree, then closes and deletes it. Re-exports the node guards and
    `SyntaxKind` from `@typescript/native/unstable/ast` so callers import from
    here. Probe (1,500 beebox files, one at a time): 1.8 s with the tsconfig,
    31 s without it (each snapshot then builds an inferred project). Same
    node counts as 5.9's `createSourceFile`. No process-wide session, so a
    dead Go process affects one operation and the next one starts fresh.
  - `check.ts`: `typecheckProject(dir): Diagnostic[]` — opens
    `dir/tsconfig.json` in a fresh API instance, returns syntactic plus
    semantic diagnostics as `{ fileName, line, text, code }`, closes the
    instance in `finally`.
  - `tsc.ts`: `tscBinary(): string` — resolves
    `@typescript/native/package.json` with `createRequire` (the package's
    `exports` lists `./package.json` but not `./bin/tsc`), then joins its
    `bin.tsc` entry. For callers that emit.
  - Call sites:
    - `core/views/markdown-check/core.ts` — one `withParser` per
      `lintViewMarkdown` / `checkViewMarkdown` call; the `Ts` parameter
      threading becomes imports. Three guards are renamed
      in 7.0: `isParameter`→`isParameterDeclaration`,
      `isPropertySignature`→`isPropertySignatureDeclaration`,
      `isStringLiteralLike`→`isStringLiteralLikeNode`.
    - `dev/layout/scan/imports.ts`, `scan/package/registries.ts`,
      `scan/package/surfaces.ts`, `move/ts-edit.ts`, `move/edges.ts`,
      `move/doctest-edit.ts` — type imports and guards from the module.
      `parseSourceFile` in `imports.ts` takes a `Parse` argument; the entry
      points (`scanPackage`, the move command) open one `withParser` for the
      whole operation and pass it down.
    - `dev/layout/scan/resolve.ts` `readTsconfig` — keeps reading the raw
      file only (no `extends`), because `loadAliases` anchors `paths` at the
      package root (`resolve.ts:60`) and an inherited entry would resolve
      from the wrong directory. Parse with `json5` (already installed
      transitively; becomes a direct dependency of `beebox`, in
      `dependencies` or `devDependencies` by whether `src/dev/layout` ships).
    - `cli/commands/view/typecheck.ts` — writes a `tsconfig.json` with the
      current options into its temp directory, calls `typecheckProject`,
      keeps the `harness.ts` filter.
    - `scripts/user-stories/build-workflows.ts` — runs `tscBinary()` with
      `--ignoreConfig --noCheck --outDir <tmp> --target es2023 --module esnext`
      on the workflow files, renames `.js` to `.mjs`, keeps the
      `export const meta = {` guard. Probe: byte-identical output to
      `transpileModule` for all five workflows; TS1108 is a checker error,
      so `--noCheck` suppresses it and the filter goes away.
- **Lock-ins:** `beebox/src/lib/typescript/` as the only importer of
  `@typescript/native` and `typescript`. The layout rule `typescript-imports`
  enforces it, per §11 (see Implementation notes).
- **Hook boundary:** `sdk-hooks.ts:69` awaits `lintViewMarkdown` with no
  catch, and the callback builds `additionalContext` only from returned
  errors (`sdk-hooks.ts:65-72`). The port wraps the call: an exception
  becomes `additionalContext: "Markdown check could not run for <path>:
  <message>"`, so the agent sees it (§4).
- **First chunk:** `syntax.ts` plus the layout callers (they already funnel
  through `parseSourceFile`). Done when the `test/dev/layout/**` doctests and
  `pnpm layout-check` pass unchanged.

### D. Box scaffold and base tsconfig

- **What:** new boxes get `typescript: ^7.0.2`; the base tsconfig keeps
  today's types behaviour under 7.0.
- **Why:** `package.ts:13` reads `engine.dependencies.typescript`, which no
  longer exists after Track B; it would fall back to `^5.7.0`. And
  `beebox/tsconfig.base.json` has no `types`, so under 7.0 a box schema that
  uses `process` or `Buffer` stops typechecking (5.9 auto-includes every
  `@types/*` package).
- **Direction:** `package.ts` reads `@typescript/native` from
  `engine.dependencies` and strips the `npm:typescript@` prefix; a box has no
  typescript-eslint, so it uses the plain `typescript` name. A malformed
  range throws (no silent fallback). `tsconfig.base.json` adds
  `"types": ["node"]`; React types come in through imports and need no entry.
- **First chunk:** both edits, the scaffold doctest asserting the new range,
  and `pnpm smoke` (it runs the box's `tsc` against the base config).

## Could this be simpler?

Simplest: Track A plus aliasing 7.0 for the `typecheck` scripts only. It gets
the 7× typecheck speedup. It fails the boxholder's request: beebox's runtime
checks, `build` emit, and new boxes would stay on 5.x/6.0. Tracks C and D buy
that. Inside Track C, the simpler choice per call site was taken where one
existed: `build-workflows` runs the binary instead of a new transpile helper;
`view typecheck` keeps its temp-directory design; `resolve.ts` keeps its raw
read. The parser with its `noLib` tsconfig is the one new mechanism, and the
probe shows why: without the tsconfig, each parse costs 21 ms. It lives for
one operation, so it needs no recovery logic.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `@typescript/native` platform binary missing on the Linux server (optional dependency not installed) | No | API constructor throws on spawn | Clear: `deploy.sh` runs `"$stage_dir/node_modules/.bin/tsc" --version` after the staged install (`deploy.sh:1113`) and before activation, so a missing binary stops the deploy |
| Markdown check hook: API call throws mid-check (Go process missing or killed) | New doctest: a `withParser` whose child is killed throws | Hook wraps the call (Track C, hook boundary) | Clear: agent sees "Markdown check could not run" |
| A 7.0 tree differs from 5.9's for a construct our walkers use | Existing doctests | — | Clear: doctests fail |
| `.bin/tsc` links to the wrong package | No | — | Clear: chunk B verifies `tsc --version`; add the check to `bin/doctor.ts` |
| typescript-eslint loads 7.0 by accident (hoisting picks the alias) | No | — | Clear: `pnpm lint` crashes. Verified in chunk B. |
| A box created before this keeps `typescript ^5.7.0` and the new base config's `types: ["node"]` | `pnpm smoke` scaffolds new boxes only | 5.x accepts `types` | Clear: same behaviour as today |
| Declaration emit order differs (7.0 sorts union members differently; probe: 2,744 changed lines across 1,175 `.d.ts`, no member changes) | No | — | Silent but harmless: no consumer compares `.d.ts` text (searched `bin/` and `beebox/src/scripts/`) |

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no vocabulary for agents.
- Stale ref: ADDRESSED — `syntax.ts` uses a fresh in-memory name per parse,
  so a cached tree from an earlier parse cannot come back (a probe that
  reused one name returned stale trees).
- Two agents touching the same card: not applicable. Two hook calls in one
  server process each get their own parser.
- Hand-edit drift: a boxholder's own box tsconfig with `baseUrl` breaks
  `bbx upgrade`'s `tsc` step only after their box moves to 7.0, which this
  plan does not do for existing boxes.
- Validation error UX: ADDRESSED — hook messages are built from our own
  problem list (`core.ts:262-268`), unchanged.
- Partial migration: during Tracks B–C, unported call sites run on 6.0. Each
  chunk leaves the tree green.

## NOT in scope

- typescript-eslint on 7.x: blocked upstream until 7.1 ships an API and
  typescript-eslint releases against it. Follow-up issue filed with this plan.
- `agent-doctest`'s `doctest-typecheck` and the three doctests that import
  `typescript`: they stay on 6.0 (boxholder, 2026-10-17).
  Porting `check.ts` means replacing `createIncrementalProgram`, which the
  7.0 API does not offer. Listed in the follow-up issue.
- Moving existing boxes' `typescript` devDependency to 7.0: a change on
  boxholders' machines. `bbx upgrade` does not edit box dependencies today.
- Editor setup: no `.vscode` in the repo. Editors that use the workspace
  `typescript` see 6.0; the 7.0 language service is an editor extension.

## Open design questions

- **`agent-doctest` on 6.0 (decided: stays).** It is outside "everything
  but typescript-eslint". Lean: accept it, because the handoff says doctests
  may be removed and porting needs a non-incremental rewrite of `check.ts`.
  If not accepted, a Track C chunk ports it to `@typescript/native` directly
  (`agent-doctest` cannot import beebox's module).
- Should the follow-up also cover moving existing boxes to 7.0? Lean: the
  follow-up lists it as its own decision, because it touches boxholders'
  installs.

## Knowledge audits

Skip: no new agent-facing concept. Box agents see the same hook messages.

## What will hold this after it ships

The existing doctests for the Markdown check, view typecheck and layout
tooling run unchanged against the 7.0 API; that is the regression anchor. New:
one doctest for `syntax.ts` (parse; a killed child makes `withParser` throw),
one for the scaffold range. `pnpm smoke` covers the box `tsc` path.
`bin/doctor.ts` gains a check that `.bin/tsc` is 7.x and `typescript` is 6.x.

## Implementation order

1. Track A (config fixes). Verify with 5.9 and the 7.0 scratch binary.
2. Track B (dependencies). Verify typecheck, lint, knip, `pnpm install` output.
3. Track C chunk 1: `syntax.ts` and layout callers.
4. Track C chunk 2: Markdown check.
5. Track C chunk 3: `check.ts` and view typecheck; `tsc.ts` and
   `build-workflows`; `json5` raw read for `resolve.ts`; the import lint rule.
6. Track D (scaffold, base tsconfig), then `pnpm smoke`.
7. `deploy.sh` staged-install check and `bin/doctor.ts` check. File the follow-up issue. Update
   the exploration issue.

## Rollout shape

Done when: every `typecheck` script passes on 7.0; `pnpm lint` passes on 6.0;
`pnpm lint:knip` passes on knip 6; the change-selected doctests pass;
`pnpm smoke` passes; `pnpm build`, `build:declarations` and
`build:workflows` succeed. No data migration.
Deploys with the next landing. The server's `pnpm install --frozen-lockfile`
(`deploy.sh:425`) installs the Linux binary from the lockfile.

## Implementation notes

Where the build differs from the tracks above, and why:

- **knip 6.** It reported findings knip 5 did not. 34 were exported values
  (mostly zod schemas and `as const` lists) whose only use outside their
  file is through an exported `typeof X` type: knip 5, built on TypeScript,
  counted that type reference as a use; knip 6, on oxc, does not. No file
  imports any of them, so they are unexported (one, `DESTINATION_KINDS`,
  became a plain union type, since only its type was used). It also found
  `ws`, imported at runtime by `webapp/routes/chat/audio-routes.ts` but
  undeclared (it came through `@fastify/websocket`), now a `beebox`
  dependency; `tail` as an unlisted system binary; six `ignoreBinaries`
  entries it no longer needs; and frontend doctests and CSS outside its
  `project`. After the fixes it reports the same seven findings knip 5 did
  before this branch.
- **The backend `exclude` for `src/plugins/*/view/**` was reverted.** Backend
  lint reaches those files through `tsconfig.json`; excluding them broke the
  lint project service. `src/types/css.d.ts` sits under `src/**`, so it
  already types their CSS imports in the backend program.
- **Layout parser lifetime.** The layout tooling keeps one parser per process
  (layout commands are short-lived) and memoizes trees by file and text.
  `layout-check` parses 4,018 files 9,102 times; without the memo it took
  13 s against 9.2 s on 5.9, with it 8.6 s. The Markdown check opens one
  parser per check. Closing the previous file in the next file's snapshot was
  tried and was slower (23 s).
- **The Markdown check keeps its `ts` parameter threading**, now with the
  parser alongside, so the module stays lazily loaded for the eagerly
  imported CLI.
- **Lock-in as a layout rule, not an eslint rule.** The eslint config's
  `no-restricted-imports` blocks replace one another per glob, so a repo-wide
  pattern would have to be repeated in five blocks.
- **madge.** madge 8.0.0 (latest) declares an optional `typescript ^5.4.4`
  peer. `lint:circular` passes on 6.0; a root `peerDependencyRules` entry
  allows `madge>typescript` 6.
- **`pnpm smoke`** fails on two pre-existing bugs (filed:
  `issues/bugs/2026-10-17-release-smoke-imports-wildcard-exports-and-calls-engine-serve.md`).
  With the first skipped locally, every TypeScript step passed from the
  release tarball.

