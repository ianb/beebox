---
title: "Load yaml only when needed; parse each card once in bbx validate"
status: draft
workstream: perf-easy-wins
issues: []
---
# Load yaml only when needed; parse each card once in bbx validate

Two follow-ups to [yaml-read-parser](../implemented-plans/yaml-read-parser.md),
which made js-yaml the fast path for read-only YAML. Every `bbx` verb still
loads the `yaml` package (about 12 ms with the compile cache), because 31
modules on command paths import it statically. Most need it only to write or
edit. `bbx validate` parses each card's frontmatter three times. This plan
loads `yaml` on first use, narrows the fallback patterns so ordinary cards stay
on js-yaml, and makes `validate` parse each card once.

**Issues addressed:** none filed. These are the follow-ups named in the
yaml-read-parser plan's NOT in scope ("Loading `yaml` lazily on the write
side", "Parsing each card once in `bbx validate`"). The boxholder asked for
them on 2026-10-24 ("continue with all three follow-ups"). Searched the queue
for "yaml", "lazy", "validate parse": no open item.

## Design

No design section: no card, surface, output, or error message changes. Only
load and parse time change.

## Smallest fix and budget

Measured on the worktree test1 clone (2026-10-24, load average 7–11, so
approximate):

- `require("yaml")` with the compile cache: 11–13 ms; js-yaml: 2 ms.
- `bbx validate` (CPU profile): `yaml` module loading 41 ms under the profiler;
  `yaml.parse` on the fallback path 23 ms; 839 `parseYaml` calls for 271
  distinct frontmatter texts.
- The module-load log of `status`, `todos`, `validate`, and
  `validate --pre-commit` shows `yaml/dist/index.js` loaded by every one.
- 7 of test1's 272 cards take the fallback. Six match only the anchor/tag
  pattern, on a shell `&&` inside a plain scalar
  (`src/lib/read-yaml.ts:51`, `/(?:^|[\s,:[{-])[!&]\S|.../m`); one matches
  the `0b` pattern on a value that is not a binary literal
  (`src/lib/read-yaml.ts:52`, `...|0b)/m`). Two of the seven also have an
  unbalanced bracket line (`hasOpenFlowLine`).

Smallest fix per track:

- **A, parse once:** drop the re-parse in `unknownKeyWarnings`
  (`src/core/card-lint/core/lint-cards.ts:387`) by carrying the parsed
  frontmatter's keys out of `parseCardText`. That removes one of the two
  repeats. The other repeat is the prominence lint reading every card file
  again (`src/core/lint-prominence/core.ts:261`,
  `const fm = await loadCardFrontmatter(absPath);`).
- **B, narrow the fallback:** match `&`/`!` only where a node can start, and
  `0b` only before a binary digit.
- **C, lazy `yaml`:** one module that `require`s `yaml` on first call; the 31
  importers outside `src/dev/` and `src/scripts/migrate/` import from it.

Chosen: all three. Estimate: A about 40 changed lines; B about 10 lines plus
test cases; C a 70-line module, about 70 changed import and call lines (31
files), and a 40-line test. Total about 230 source and test lines. Docs:
`docs/development/performance.md`, about 10 lines.

Expected gain: about 12 ms on every verb whose cards all stay on js-yaml and
that writes nothing (`status`, `todos`, `validate --pre-commit` on test1),
measured after implementation. `bbx validate` on test1 still loads `yaml` for
the two cards with an unbalanced bracket line; its gain is the repeat parses
(A) and five fewer fallback parses (B).

## Stated preferences this plan trades against

- **Minimize invented concepts** (boxholder feedback): the lazy module adds no
  new noun. It exports the same function names as `yaml`, so most call sites
  change only their import path. Two shapes change: `new Document({})` becomes
  a function call, and `instanceof YAMLParseError` becomes a guard function,
  because a lazily loaded class cannot be named in a static expression.
- **Bias toward strict:** the fallback patterns may only over-match. B narrows
  them, so B reruns the corpus and fuzz checks from yaml-read-parser before it
  lands.
- **No lint rule changes** (workstream brief): a static `yaml` value import
  that creeps back is caught by a test (Track C), not a lint rule.

## What already exists

- `src/lib/read-yaml.ts:24` `import { parse } from "yaml";` — the fallback.
- `src/cards/frontmatter.ts:22`
  `import { Document, isMap, parseDocument, stringify as stringifyYaml } from "yaml";`
  — write and edit helpers, re-exported through `src/exports/cards.ts`, which
  `card-io.ts` imports.
- 19 schema modules import `stringify as stringifyYaml` for their templates
  (e.g. `src/schemas/person.tsx:11`); every verb loads the schema registry.
- `src/exports/schema.ts:13`
  `export { parse as parseYaml, stringify as stringifyYaml } from "yaml";` —
  the public `beebox/schema` export for box-local schemas and scripts; box
  schemas load it on every verb.
- `src/core/chat/routing/quick-chat-submit/catalog.ts:51`
  `if (error instanceof YAMLParseError || error instanceof z.ZodError) {`.
- `src/core/place-mark.ts:57` and `src/cards/frontmatter.ts:154` call
  `new Document({})`.
- `src/core/todo/set-status.ts`, `src/core/triage/todo.ts`,
  `src/core/card-fields/field-edits.ts`, `src/core/todo/review-check/core.ts`
  import `parseDocument`, `isMap`, `isSeq`, `isScalar`, `parse`, `stringify`.
- `parseCardText` (`src/core/card-io.ts:107`) parses the frontmatter
  (`:116`, `const fm = parseFrontmatterMapping(split.frontmatterText, source);`)
  and returns `{ schema, fields, rawBody }` (`ParsedCard`, `:90`). Zod drops
  undeclared keys, so `fields` cannot answer "which keys were written".
- `collectAllResults` (`src/cli/commands/validate/command.ts:186–190`) runs
  `lintCardsDispatch(cardPaths, …)` and then `lintProminenceBudget(boxRoot, ctx)`,
  which lists every card again and reads each file
  (`src/core/lint-prominence/core.ts:250–261`).
- `yaml@^2.7.0` ships CommonJS at `dist/index.js` (the module-load log above);
  `createRequire` loads it synchronously.

## Prior art (external)

Node's `module.createRequire` is the documented way for an ES module to load a
CommonJS package synchronously on demand
(https://nodejs.org/api/module.html#modulecreaterequirefilename). No code
copied.

## Ontology

No new nouns. `src/lib/yaml-package.ts` is "the `yaml` package, loaded on
first use"; its exports keep `yaml`'s names.

## Tracks / scope

### Track A: validate parses each card once

- **What:** `ParsedCard` gains `frontmatter: Record<string, unknown>`, the
  mapping as written (before Zod). `unknownKeyWarnings` takes it instead of
  the content. `LintDispatchOptions` gains
  `frontmatterByPath?: Map<string, Record<string, unknown>>`, filled by
  `lintFrontmatterCard` for each card it parses; `lintProminenceBudget` takes
  that map and reads only the cards not in it (trashed, ignored, or failing
  to parse).
- **Why:** 568 of 839 parses in `bbx validate` on test1 are repeats; the
  prominence pass also re-reads 272 files.
- **Direction:** `collectAllResults` creates the map, passes it to both.
  Other `lintCardsDispatch` callers pass nothing and behave as before.
- **First chunk:** the whole track.

### Track B: narrow the fallback patterns

- **What:** in `YAML_ONLY[0]`, `[!&]` counts only at a node start: line start
  after indentation, after `- `, `? `, `: `, or a flow `[`, `{`, `,` (with
  optional spaces). In `YAML_ONLY[1]`, unsigned `0b` counts only before
  `[01_]`.
- **Why:** six of seven test1 fallbacks are `&&` in a shell command.
- **Direction:** rerun `pnpm perf:yaml-read` over the same corpus, the scalar
  fuzz, and the structural fuzz (probes from yaml-read-parser), with added
  cases of `&`/`!` mid-scalar, at every node start, and after a continuation
  line's indentation.
- **First chunk:** the whole track.

### Track C: load `yaml` on first use

- **What:** `src/lib/yaml-package.ts`:
  ```ts
  import type * as Yaml from "yaml";
  /** The `yaml` package, required on first call. */
  function yaml(): typeof Yaml;
  export function stringify(...): string;          // yaml's overloads
  export function parse(...): unknown;             // yaml's overloads
  export function parseDocument(text: string, options?: ...): Yaml.Document.Parsed;
  export function createDocument(value?: unknown): Yaml.Document;
  export function isMap(node: unknown): node is Yaml.YAMLMap;
  export function isSeq(node: unknown): node is Yaml.YAMLSeq;
  export function isScalar(node: unknown): node is Yaml.Scalar;
  export function isYamlParseError(error: unknown): error is Yaml.YAMLParseError;
  ```
  Every value import of `yaml` in `src/` outside `src/dev/` and
  `src/scripts/migrate/` moves to it; type imports stay
  (`import type … from "yaml"` is erased). `src/exports/schema.ts`
  re-exports `parse as parseYaml, stringify as stringifyYaml` from it, so the
  public signatures keep `yaml`'s overloads.
- **Why:** the 12 ms load on every verb.
- **Vocabulary lock-in:** value imports of `yaml` live in `yaml-package.ts`
  (plus dev tools and migrations, which no verb loads).
- **First chunk:** the module, the swaps, and the test.

## Could this be simpler?

- A without the prominence map: drops one repeat of three and leaves the 272
  file reads. The map is one optional parameter on each side.
- C as a dynamic `import("yaml")`: every caller is synchronous (`parseYaml`,
  template functions, `stringify`), so it would make many functions async.
  `createRequire` keeps them synchronous.
- C without B: on test1 `validate` and any verb reading a scheduled-script card
  would load `yaml` anyway. B is two regex edits.
- Skipping C: 12 ms on a 245–310 ms verb is 4–5%; this workstream's brief is
  those wins.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| B narrows a pattern past a construct js-yaml reads differently | read-yaml test; corpus and fuzz rerun | none beyond the pattern | Silent: a differing value |
| A static `yaml` value import returns on a verb's path | new test (Track C) | none | Silent: 12 ms back |
| `createRequire` fails to find `yaml` from the bundle location | smoke and release smoke run the bundle | none | Clear: a thrown module error on first YAML write |
| `frontmatterByPath` misses a card the prominence lint needs | prominence lint tests run without the map; validate tests with it | falls back to reading the file | Clear: same warnings either way |
| `ParsedCard.frontmatter` mutated by a caller | no | it is a fresh object per parse | Silent, local to that caller |

## Agent-flow / user-flow edge cases

Not affected: values, errors, warnings, and on-disk shapes are unchanged.

## NOT in scope

- `src/dev/` tools and `src/scripts/migrate/` keep static imports: no verb
  loads them at start.
- Making `hasOpenFlowLine` skip quoted text and block scalars (would keep the
  last two test1 cards on js-yaml): more parsing logic for 2 of 272 cards.
- Other startup costs (zod schema construction, source maps, execa).
- A lint rule banning `from "yaml"`: lint rule changes are not approved.

## Open design questions

none

## Knowledge audits

Skipped: no agent-facing concept changes. `beebox/schema` keeps `parseYaml`
and `stringifyYaml` with the same signatures.

## What will hold this after it ships

- `test/lib/read-yaml.test.ts` gains the Track B cases (mid-scalar `&&` and
  `!=` read by js-yaml with `yaml`'s value; anchors at each node start still
  hit the alias limit).
- A test runs a child process that loads the card read path and the schema
  registry, reads a card, and checks `yaml` is not in `require.cache`; then
  calls `stringifyYaml` and checks it is.
- Validate tests cover unknown-key warnings and prominence warnings with the
  shared map.

## Implementation order

1. Track A, commit.
2. Track B with the corpus and fuzz reruns, commit.
3. Track C, commit.
4. Measure `status`, `todos`, `validate`, `validate --pre-commit` against the
   branch before step 1; record in `docs/development/performance.md`.

## Rollout shape

Done when typecheck, lint, layout-check, `test:changed`, smoke, the corpus and
fuzz checks pass, and the measurements are recorded. No data migration.
