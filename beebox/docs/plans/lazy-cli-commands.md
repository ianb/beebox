---
title: "Lazy CLI commands: load only the verb a bbx invocation runs"
status: draft
workstream: perf-easy-wins
issues:
  - ../../../issues/code-quality/2026-10-23-bbx-verb-loads-the-whole-cli.md
---
# Lazy CLI commands: load only the verb a bbx invocation runs

Every `bbx` invocation loads all 71 command modules and everything they
import, then runs one of them. This plan makes the CLI load only the command
module the invocation names, and builds the bundle with code splitting so the
other modules and their npm packages are never read.

**Issues addressed:** `issues/code-quality/2026-10-23-bbx-verb-loads-the-whole-cli.md`
(the "Lazy commands" option; its other options, the Agent SDK and source maps,
are handled or decided elsewhere). Searched the queue for "lazy", "command
registration", "cli start", "startup floor": the only other match is the
closed `issues/closed/bugs/2026-08-18-box-precommit-hook-costs-seconds-per-commit.md`,
whose plan (`docs/plans/commit-performance.md`, "Phase 2") names this exact
step: *"a lazy registry (dynamic import in each command's action) plus esbuild
code splitting would cut the evaluated graph to what the invoked command
needs."*

## Design

No design section: the CLI's verbs, options, help text, and output do not
change. Only load time changes.

## Smallest fix and budget

Measured with single-verb probe bundles (an entry that registers one command,
built like `dist/cli.mjs`), interleaved runs on the test1 clone, 2026-10-23:

| Invocation | Full CLI | One command | Change |
| --- | --- | --- | --- |
| `bbx ls _content` (load 2) | 336 ms | 236 ms | −100 ms |
| `bbx validate --pre-commit` (load 7) | 367 ms | 224 ms | −143 ms |
| `bbx todos` (load 6) | 486 ms | 257 ms | −229 ms |
| `bbx query todos` (load 16) | 477 ms | 239 ms | −238 ms |
| `bbx search errands` (load 4) | 423 ms | 317 ms | −106 ms |

A spike with esbuild `splitting: true` and a three-verb lazy loader ran
`bbx ls` as fast as the single-command bundle (327 vs 330 ms, load 14).

Smallest fix: a loader per verb, the entry picks one from `argv`, and the
bundle is split. Tracks:

1. Registry of loaders, verb selection, program assembly (`src/cli/`): about
   250 changed lines, plus about 80 test lines.
2. Layout-check support for a loader member (`src/dev/layout/scan/`): about
   20 lines, plus about 30 test lines.
3. Split bundle output (`src/scripts/build-cli/build/bundle.ts`): about 50
   lines.
4. Rename two command files so every verb's file is named for it: about 10
   lines.

Estimate: about 450 changed source and test lines. Documentation: about 30
lines in `docs/development/performance.md` and the CLI docs. Not a BIG
CHANGE.

What the fuller approach (splitting every command into a definition module and
an action module, so `bbx --help` is also fast) would buy: a fast `--help`.
It touches all 71 command modules. Not chosen: `--help` is rare next to
verbs, and agents read `box-docs/` for the command reference.

## Stated preferences this plan trades against

- `docs/implemented-plans/file-layout.md`, rule 4: a set directory is
  enumerated by one `defineRegistry` call whose `members` are exactly the
  imports from that directory. This plan keeps the rule and teaches the
  layout scanner one more member form (a loader), rather than exempting the
  registry.
- `src/cli/commands.ts:1-10`: *"Keyed at runtime off each command's own
  `name()` rather than by a hand-written name → export mapping, which would be
  a second place for a verb's name to live."* A lazy registry cannot call
  `name()` before loading. This plan keys the registry by file name, which
  layout rule 4 already requires of a record (camelCase for a hyphenated file:
  `src/dev/layout/check/rules/sets/record-keys.ts:9-28`, so `agent-context.ts`
  is key `agentContext`). It renames the two files whose names differ from
  their verbs, so a verb's key is always `camelCase(verb)`: one name, one
  conversion. A test loads every member and checks `camelCase(command.name())`
  equals its key.
- `beebox/AGENTS.md`: *"Production runs bundled `dist/cli.mjs`, not tsx."*
  The entry file name stays; it gains sibling chunk files.
- The decision to keep source maps on (`issues/bugs/2026-10-07-box-first-load-is-slow.md`)
  is unchanged. Splitting makes the map cost proportional to the loaded code.

## What already exists

- `src/cli/commands.ts:163-169`: `VERB_COMMANDS = defineRegistry<Command>({ directory: "./commands", entry: "command", key: (command) => command.name(), ordered: false, members: ALL })`. Rebuilt as a record of loaders.
- `src/shared/registry.ts:68`: `defineRegistry` supports a record form, *"a record gives keys literally and the layout check verifies each key is the member's file or directory name"* (lines 11-14). Reused as is.
- `src/cli/entry/surface-build.ts:28-31`: `verbCommand(name)` fails with an invariant when the surface table names a verb no module registers. Kept for the full load; the partial load registers only loaded verbs.
- `src/cli/entry/run.ts:30-37`: builds the program, rewrites legacy argv (`rewriteLegacyHandoff`, `src/cli/entry/legacy-argv.ts:48`), then installs box admission. The rewrite moves before verb selection.
- `src/dev/layout/scan/package/registries.ts:108-117`: `memberOf` resolves a member only when it is an identifier bound to an import (`importSources.get(...)`). Extended to read a loader's `import()` specifier.
- `src/scripts/build-cli/build/bundle.ts:142-150`: stages outputs in a temp directory and renames them into `dist/`, maps first. Extended to rename chunks before `cli.mjs` and to prune old chunks.
- `src/lib/dev-bundle-reload.ts:17-25`: a dev server reloads when the identity (`dev:ino:size:mtime`) of `dist/cli.mjs` changes. The spike confirmed a change in a shared module changes `cli.mjs` (esbuild chunk hashes cascade to importers), so this keeps working.
- `deploy/deploy.sh:444`: production builds the bundle in a clean checkout, stages it, and activates it after boxes drain. No old process reads new chunks.
- `package.json` `files` includes `"dist"`; chunks ship in the package.

## Prior art (external)

- esbuild code splitting with ESM output (`splitting: true`, `format: "esm"`), chunk names via `chunkNames`: https://esbuild.github.io/api/#splitting. Adopted as documented; verified by the spike, including that a dynamic `import()` of a bundled module becomes a separate chunk whose npm imports load only with it.
- Commander has no lazy-subcommand API; its "executable subcommands" spawn a separate process per verb (https://github.com/tj/commander.js#stand-alone-executable-subcommands), which adds a process start rather than removing load time. Evaluated only.

## Ontology

- **Verb** — what a person types after `bbx` or `bbx engine` (`ls`, `serve`). Existing (`src/cli/entry/surface-data.ts`).
- **Command module** — a file or directory under `src/cli/commands/` whose export is one Commander `Command` for one verb. Existing. After this plan its file or directory name equals its verb.
- **Command loader** — `() => Promise<Command>`: imports one command module and returns its command. New. Not a command; it carries no name of its own (its registry key is the name).
- **Verb registry** (`VERB_COMMANDS`) — record from registry key to command loader. Existing name, new member type.
- **Registry key** — the command module's file or directory name in camelCase (`agentContext` for `agent-context.ts`), as layout rule 4 requires. Equals `camelCase(verb)` for every verb after Track 1.
- **Verb selection** — the verb an argv names, `"all"` (help, an unknown verb, or no verb), or `"none"` (`--version`). New; a pure function of argv.
- **CLI chunk** — a bundle file `dist/cli-<name>-<hash>.mjs` that `dist/cli.mjs` imports. New.

## Tracks / scope

### Track 1 — Rename `trash.ts` and `move.ts`

- **What:** `src/cli/commands/trash.ts` → `rm.ts`, `move.ts` → `mv.ts`; exports `rmCommand`, `mvCommand`.
- **Why:** the record form keys members by file name, and these two are the only command files whose verb differs (`trash` → `rm`, `move` → `mv`; checked over all 71 imports in `src/cli/commands.ts`).
- **Direction:** `git mv`, update `src/cli/commands.ts:32-33`, the only importer.
- **Vocabulary lock-ins:** command file name equals verb name.
- **First chunk:** the rename alone; behavior unchanged.

### Track 2 — Loader members in the layout scanner

- **What:** `memberOf` (`src/dev/layout/scan/package/registries.ts:108`) also accepts an arrow function whose body contains one `import("<specifier>")`, and reports that specifier as the member's source.
- **Why:** rule 4 needs every set directory member to be reachable from the registry declaration. A loader is.
- **Direction:** if `element` is an `ArrowFunction`, find the single `ImportCall` with a string-literal argument in its body, and set `source` to the resolved target of that specifier, the same repository-relative path the scanner already computes for dynamic-import edges (`src/dev/layout/scan/imports.ts:74-82`, `src/dev/layout/scan/package/scan.ts:26-40`). The set checks compare `source` against those paths (`src/dev/layout/check/rules/sets/set-members.ts:19-29`), so the raw specifier would fail them. Any other shape keeps today's `source: null` (a finding follows, as now).
- **First chunk:** scanner change plus a test in `test/dev/layout/scan/package/registries.test.ts` that a record of loaders reads each key with its import source.

### Track 3 — Lazy registry, verb selection, program assembly

- **What:** `VERB_COMMANDS` becomes `defineRegistry<CommandLoader>({ directory: "./commands", entry: "command", ordered: false, members: { ls: async () => (await import("./commands/ls.js")).lsCommand, ... } })`. A new `src/cli/entry/select-verb.ts` exports `selectVerb(argv: readonly string[]): VerbSelection` with `type VerbSelection = { kind: "verb"; name: string } | { kind: "all" } | { kind: "none" }`. `loadCommands(selection)` returns `Map<string, Command>`. `buildProgram(commands)` and `buildSurface(program, commands)` register only the given commands.
- **Why:** the measured load cost is the module graph of the other 71 commands.
- **Direction — selection rules** (first token after `rewriteLegacyHandoff`):
  - no token, `-h`, `--help`, `help` → `all`;
  - `-V`, `--version` → `none`;
  - any other token starting with `-` → `all` (no global options exist besides these; `src/cli/entry/program.ts:18-24`);
  - `engine` → apply the same rules to the next token, so `bbx engine serve` selects `serve` and `bbx engine --help` selects `all`;
  - a token whose `camelCase` is not a registry key → `all`, so Commander's unknown-command error and suggestions are unchanged.
  - `bbx <verb> --help` selects the verb; its help needs only its own command.
- **Assembly:** with a subset, `buildSurface` adds each SURFACE entry whose name is loaded, and always adds the `engine` parent. With `all`, the existing invariant (`surface-build.ts:30`) still fails on a SURFACE name with no loader.
- **Vocabulary lock-ins:** `CommandLoader`, `selectVerb`, `loadCommands`.
- **First chunk:** `select-verb.ts` and its test; then the registry, `run.ts`, `program.ts`, `surface-build.ts`, and the three tests that call `buildProgram()` (`test/cli/entry.surface.test.ts`, `test/cli/commands/triage.test.ts`, `test/cli/commands/remind/command.test.ts`) switched to `buildProgram(await loadCommands({ kind: "all" }))`.

### Track 4 — Split bundle output

- **What:** `bundle.ts` builds `src/cli/entry/run.ts` with `splitting: true`, `outdir`, `entryNames: "cli"`, `chunkNames: "cli-[name]-[hash]"`, `outExtension: { ".js": ".mjs" }`.
- **Why:** without splitting, esbuild inlines dynamically imported bundled modules and hoists their npm imports into `cli.mjs`, so a lazy registry alone saves only evaluation, not loading (seen this session: `src/core/views/markdown-check/core.ts:246` already dynamically imports `lib/typescript/syntax.js`, yet `@typescript/native` is a static import of `cli.mjs`).
- **Direction:** chunks sit flat in `dist/` beside `cli.mjs`, so code that resolves paths from `import.meta.url` (`src/lib/package-root.ts`, `src/cli/entry/bootstrap.ts`, and the nine others found by grep) sees the same directory depth. The staging rename order becomes: maps, then chunks, then `cli.mjs` last, so `cli.mjs` never names a chunk that is not there yet.
- **Pruning:** a dev checkout rebuilds often (`bin/bbx` rebuilds on any newer source), and each build writes about 16 MB of chunks and maps under new hashed names, so `dist/` needs pruning. Each build appends its chunk list to `dist/.cli-builds.json` (newest three kept). After the rename, a `dist/cli-*.mjs` or `.map` file is deleted only when no listed build wrote it and its mtime is more than an hour old. A running dev process loads its command chunk at start; it imports a chunk later only through the seven internal dynamic imports. Such a process fails only if it outlives three rebuilds and an hour without reloading (`dev-bundle-reload.ts` reloads at a safe boundary, but can skip a replacement after an abandoned drain, `src/lib/dev-bundle-reload.ts:28-41`, `abandonDevBundleDrain`). The failure is a loud module-not-found error, in dev only: production builds into a cleaned checkout and activates after boxes drain (`deploy/deploy.sh:386-390`, `:431-444`). Accepted as a documented risk.
- **First chunk:** the build change and a test that builds into a temp `dist`, runs `node dist/cli.mjs --version` and one verb, and checks the prune rule keeps the last three builds' chunks.

## Could this be simpler?

The simplest version is Track 3 without Track 4: a lazy registry in a single
bundle. It fails on the measured cost: esbuild would inline every loader's
module, hoist their npm imports into `cli.mjs`, and evaluate only on use. The
npm package loading (about 100 ms of the startup) stays. The cross-check in
*Prior art* is the existing `markdown-check` dynamic import that saved nothing.

A cruder version: special-case the hot verbs (`validate`, `ls`, `search`) with
a hand-written fast path. It needs a second list of verbs and leaves every
other verb slow; the registry change costs the same and covers all 71.

What the plan does not build: a resident `bbx` process, a per-command
definition/action split, or a faster `--help`.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A registry key does not match its command's `name()` (a rename missed) | New: surface test loads all and compares | Invariant at full load | Clear |
| A verb's file exists but no loader lists it | Existing: layout rule 4, with Track 2 | Layout check fails the commit | Clear |
| `selectVerb` picks the wrong verb for an argv (an option before the verb, a legacy name, a hyphenated verb) | New: `select-verb.test.ts` table | Unknown token → `all` | Clear (slower, still correct) |
| A partial program is assembled wrong (a split family's agent and engine halves, an `engine` verb) | New: partial-assembly cases in the surface test | `buildSurface` registers each loaded SURFACE entry | Clear |
| A dev process imports a chunk after a rebuild pruned it | New: `cli-chunks.test.ts` for the prune rule (last three builds, one hour) | Prune spares the last three builds' chunks and anything under an hour old | Clear (module-not-found), dev only; accepted risk, see Track 4 |
| `cli.mjs` is renamed before its chunks exist; a concurrent `bbx` fails | New: bundle rename-order test | Chunks renamed first | Clear |
| A command reads a sibling command through the program tree | Grep: `location.ts:23` and `drive/command.ts:63` read their own subcommands only; `box-admission.ts:26` walks parents only | Not needed | — |
| Code in a chunk resolves a path from `import.meta.url` at a different depth | Covered by keeping chunks flat in `dist/` | Same directory as today | — |
| The packed (installed) engine is missing chunks | Manual: `pnpm release && pnpm smoke` builds a current tarball and runs its `bbx` in a temp box; run once in Track 4 | Chunks are under `dist/`, which `files` includes | Clear |

No critical gap: every new path either has a test or fails loudly.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** not applicable; no agent-facing vocabulary changes.
- **Stale ref:** a stale chunk, covered under Failure modes (last three builds, one hour). ADDRESSED.
- **Two agents touching the same card:** unchanged; locking is per command, not per load. ADDRESSED (no change).
- **Hand-edit drift:** a developer adds a command file but no loader: layout rule 4 fails at commit. ADDRESSED.
- **Fabricated free-form value:** not applicable.
- **Validation error UX:** an unknown verb still loads all commands, so Commander's error and its "did you mean" suggestion are unchanged. ADDRESSED.
- **Partial migration / transition state:** none on disk. A dev server started on the old single-file bundle reloads on the new `cli.mjs` identity. ADDRESSED.

## NOT in scope

- `bbx --help` speed: it still loads every command. Rare next to verbs.
- Splitting command modules into definition and action: 71 files of churn for help speed only.
- Shrinking the shared graph that every verb still loads (card schemas, zod schema construction, `yaml`): the next lever after this; separate work. `bbx ls` alone still pulls 22 npm packages.
- The js-yaml decision (`issues/code-quality/2026-10-23-card-frontmatter-parse-with-js-yaml.md`): waiting on the boxholder.
- Splitting the other bundles (`dist/exports/*`, `dist/view-widgets/`): they are not on the per-verb path.
- `bin/bbx`'s dev staleness scan (about 40 ms in a dev checkout only).

## Open design questions

none: the retention rule (last three builds, one hour) is settled in Track 4.

## Knowledge audits

None: purely infrastructural. No agent-facing concept changes; verbs, options, and help text are unchanged.

## What will hold this after it ships

- `test/cli/entry/select-verb.test.ts`: the argv → selection table (pure function, unit tier).
- `test/cli/entry.surface.test.ts`: extended to load all loaders and check `camelCase(name())` equals each key; plus partial-assembly cases: a hyphenated verb (`agent-context`), an `engine` verb (`serve`), each split family (`scheduler`, `pub`, `secrets`) selected alone shows the same agent and engine subcommands as the full program, a legacy-rewritten argv, and an unknown verb (full program).
- `test/dev/layout/scan/package/registries.test.ts`: the loader member form.
- `test/scripts/build-cli/build/cli-chunks.test.ts`: the staging order (maps first, `cli.mjs` last) and the prune rule, as pure functions in `src/scripts/build-cli/build/cli-chunks.ts`. The split build itself is exercised by every test that runs `bbx` (the suite's `pretest` builds `dist/`), by `bin/smoke`, and by `pnpm release && pnpm smoke` for the packed tarball. (Implementation note: the plan first proposed building into a temp `dist`; `bundle.ts` builds only into the package's `dist/`, and the existing runs above already cover it.)
- `pnpm perf:cli-start` (added this workstream) reports per-verb time, so a regression is measurable.

## Implementation order

1. Track 1: rename `trash.ts` → `rm.ts`, `move.ts` → `mv.ts`. Commit.
2. Track 2: scanner loader member + test. Commit.
3. Track 3: `select-verb.ts` + test; lazy registry; program and surface assembly; `run.ts`; test call sites. Commit (single-file bundle still; behavior identical, small evaluation saving).
4. Track 4: split bundle output, rename order, prune, `cli-chunks.test.ts`. Commit with before/after numbers.
5. Docs: `docs/development/performance.md` (process start section) and the CLI layout note in `src/cli/` docs if one names the registry shape.

## Rollout shape

Done when: `select-verb.test.ts`, the extended surface test, the scanner test,
and `cli-chunks.test.ts` pass; `pnpm test:changed`, typecheck, lint, and
layout-check pass; `bin/smoke` passes; `pnpm release && pnpm smoke` passes (`pnpm smoke` picks the newest tarball in `dist-release/`, `src/scripts/smoke-external-box.ts:116-134`, so it must be rebuilt first); and `pnpm perf:cli-start` shows
`bbx ls`, `bbx validate --pre-commit`, and `bbx todos` within 15% of the
single-command probe figures above. No data migration. Production picks it up
on the next deploy, which builds a fresh `dist/`.
