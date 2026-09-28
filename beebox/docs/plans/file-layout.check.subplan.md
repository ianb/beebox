---
title: "Layout check: the script that enforces the file-layout rules"
status: active
workstream: file-layout
issues:
  - ../../../issues/code-quality/2026-09-26-source-file-layout-review-and-enforcement.md
---
# Layout check: the script that enforces the file-layout rules

Step 3 of [the file-layout plan](file-layout.md): a repo script that reads
the tree and the import graph and reports every breach of rules 1 to 6 and 8.
It is built before any file moves, in report mode, because its full report
over the current tree is the move list for step 4.

**Issues addressed:** the anchor issue above (step 3 of 4).

## Smallest fix and budget

Smallest: a shell one-liner per rule. Rules 2, 3, 5, and 8 need resolved
import edges and unit computation, which a one-liner cannot do.

| Track | Source | Tests |
|---|---|---|
| 1. `src/shared/registry.ts` (`defineRegistry`; first built in `src/lib/`, moved to `shared/` so the frontend package can import it) | ~90 | ~60 |
| 2. Scanner: tree walk, import parse, doctest sources | ~220 | ~120 |
| 3. Rules as a registry-fed set: `sets`, `units`, `names`, `tests` | ~420 | ~260 |
| 4. Report, CLI, `pnpm layout-check`, pre-commit report mode | ~140 | ~40 |

Estimated about 1,350 lines. **BIG CHANGE (actual):** the committed check
is about 4,400 lines: about 2,400 source and 2,000 doctest. What drove it:
the scanner (six modules, about 900 lines) handles import forms, aliases,
doctest generation, registry extraction, and build-entry parsing the estimate
treated as one pass; each rule's doctest covers every finding plus clean
cases against fixture trees. Recorded for the boxholder's review
2026-09-27. The moves are step 4 and are sized separately from this
script's first report.

## Stated preferences this plan trades against

- The parent plan's rules, verbatim; the check adds no rule.
- *Minimize invented concepts*: no config file. Package roots are the only
  input, sets come from `defineRegistry` calls, public surfaces from the
  build entry table and `package.json`.
- Engineering principle 10 (testable against a fixture tree): the scanner
  and every rule take an in-memory `Layout` model, so doctests build small
  trees under a temp directory and never depend on the real tree.
- *Bias toward strict*: the script exits nonzero on any finding. Report mode
  mode (`--report`) exists for the move window only.

## What already exists

- `bin/test-graph.ts:176` builds a transitive graph per test entrypoint with
  esbuild. The check needs direct edges per module with the type-only flag,
  which esbuild erases before the metafile. Rebuild with the TypeScript
  compiler API (`typescript` is a dependency, `package.json:163`), which
  gives `ImportDeclaration.importClause.isTypeOnly` and the `members` array
  for rule 4. Reuse: the alias table (`@shared/*` from `tsconfig.json:38`;
  the frontend's `@backend/ @core/ @schemas/` from
  `src/frontend/tsconfig.json:42-45`).
- `agent-doctest` `generateTestSource(markdown, filePath)`
  (`agent-doctest/src/doctest-hooks.ts:33` (moved to `agent-doctest/src/doctest-hooks/hooks.ts`)) turns a doctest into TypeScript;
  the check parses that for a test's imports.
- `src/dev/doc-check.ts` (moved to `beebox/src/dev/doc-check/check.ts`) is the shape of a dev script run by pre-commit
  (`.husky/pre-commit:93`): prints nothing on success, exits 1 on findings.
- `bin/lint-changed.ts` reads the staged file list. Not reused: the check
  has no changed-files mode (see *Failure modes*), so it needs no staged
  list.

## Prior art (external)

Covered in the parent plan (dependency-cruiser, eslint-plugin-boundaries).
Not adopted: rules 1, 4, 5, 6, and 8 compare listings with registries and
mirrors, which those tools do not express, and the import-edge rules are a
small part of the same pass.

## Ontology

- **Layout**: the in-memory model. Package root, source root, test root, a
  map from repo-relative path to `Module` or `TestFile`.
- **Module**: a source file with its resolved direct imports
  (`{ target, typeOnly }`) and, if it calls `defineRegistry`, its
  `RegistryDecl`.
- **RegistryDecl**: `{ directory, entry, keyKind, ordered, memberSources }`
  read from the call's object literal; `memberSources` maps each element of
  `members` to the import it came from.
- **Finding**: `{ rule, path, message }`. The report groups by rule, then
  path.
- **Rule**: a function `(layout) => Finding[]`, one module per rule family,
  enumerated by `src/dev/layout/check/rules.ts`, itself a `defineRegistry` set.

## Tracks / scope

1. `src/shared/registry.ts`: `defineRegistry<M>` per the parent plan's
   signature; `DuplicateRegistryKeyError`; `Registry<M>` exposes `list`,
   `byKey`, `get`. Doctest at `test/shared/registry.doctest.md`.
2. `src/dev/layout/model.ts`, `scan/package/scan.ts`: walk `src/` and `test/` of a
   package root (skip `node_modules`, `dist`), parse each `.ts`/`.tsx`/
   `.mjs` and each `.doctest.md`/`.test.ts`, resolve relative and aliased
   specifiers to repo paths, record type-only. `registries.ts`: extract
   `RegistryDecl`s and the public-surface table from `scripts/build-cli.ts` (moved to `beebox/src/scripts/build-cli/build/bundle.ts`)
   entry points plus `package.json` `exports`.
3. `src/dev/layout/check/rules/sets.ts` (rules 1, 2, 4), `units.ts` (3, 5,
   and the name-repeats-directory check), `names.ts` (6), `tests.ts` (8),
   and the registry `check/rules.ts`.
4. `src/dev/layout/check/cli.ts`: `--root <pkg>` (repeatable; default: every
   package root with a `src/`), `--summary` (counts per rule and area),
   `--report` (exit 0). `pnpm layout-check` in `beebox/package.json`.
   Pre-commit wiring comes with the move plan, when the tree passes.

## Could this be simpler?

Skip track 1 and detect registries by name (`registry.ts`)? Then rule 4's
"nothing else constructs the list" and key uniqueness have no mechanism, and
the parent plan's answer to "how does the check do that" is lost. Keep.

## Subplans

None.

## Failure modes

- **A changed-files mode would miss findings.** A staged change in one
  directory can create a finding in another: a new importer under
  `shared/a/` makes `shared/util.ts` a helper used only under `shared/a/`.
  Filtering findings to staged directories drops that one (cross-model
  review, 2026-09-27). The check has no such mode; it scans every package
  root, about 3 seconds for the whole repo.
- **A specifier the resolver cannot map.** Reported as its own finding
  (`unresolved-import`) rather than silently dropped, so a missing alias is
  visible instead of hiding a rule breach.
- **A doctest whose markdown fails to generate.** Same: finding, not skip.
- **The rules registry breaks its own rules.** The check runs over
  `src/dev/layout/` like anywhere else; the fixture doctests also assert the
  check's own tree is clean.
- **Performance.** One TypeScript parse per file over ~2,800 files;
  `ts.createSourceFile` without type-checking runs in a few seconds. Measured
  in track 4 and recorded here.

## Agent-flow / user-flow edge cases

- An agent stages one new helper in a set directory: pre-commit runs the
  whole check and reports the rule 1 breach with the two fixes (register
  it, or move it to the unit that imports it).
- An agent adds a `defineRegistry` member but forgets the file: the stale
  import is reported by name.

## NOT in scope

- Moving any file (step 4).
- Rule 7 (`CLAUDE.md` states its axis): judgment, left to review.
- Rule 9 (layers): `pnpm lint:circular` and the boundary lint rules.
- Package roots without a `src/` (`bin/`) until the move plan gives `bin/`
  its `lib/` and `test/` shape; the scanner takes explicit roots so it can
  be pointed at `bin/` then.

## Open design questions

None; the parent plan's decisions stand. Test placement is the mirror;
frontend tests move to `src/frontend/test/`; `scripts/` and the user-stories
pipeline fold into `src/` at locations the move plan picks.

## Knowledge audits

Not applicable (dev tooling).

## What will hold this after it ships

Pre-commit runs the whole `layout-check` on every commit touching a module or
test once the tree is clean (move plan). `test/dev/layout/` doctests cover
each rule against fixture trees.

## Implementation order

Tracks 1 to 4 in order; track 3's rules land one at a time, each with its
doctest, and the full report over the real tree is recorded in the move plan.

## Rollout shape

`pnpm layout-check --report` exists from track 4; nothing blocks commits
until the move plan flips it.
