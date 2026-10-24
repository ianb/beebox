---
title: "Read YAML with js-yaml; keep yaml for writes and edits"
status: draft
workstream: perf-easy-wins
issues:
  - ../../../issues/code-quality/2026-10-23-card-frontmatter-parse-with-js-yaml.md
---
# Read YAML with js-yaml; keep yaml for writes and edits

Every card read parses its frontmatter with the `yaml` package, and that parse
is 60 ms of `bbx todos` and 140 ms of `bbx validate` on test1. js-yaml parses
the same text 4–7× faster to the same values. This plan moves the read-only
YAML parses in beebox to one helper backed by js-yaml. Writes,
comment-preserving edits, and the public `beebox/schema` export stay on
`yaml`.

**Issues addressed:** `issues/code-quality/2026-10-23-card-frontmatter-parse-with-js-yaml.md`
(its decision is made: the boxholder asked for read-only parsing on js-yaml,
2026-10-24). Searched the queue for "js-yaml", "yaml parse", "frontmatter
parse": no other open item.

## Design

No design section: no card, surface, or output changes. Only parse speed and
the wording of malformed-YAML error messages change.

## Smallest fix and budget

Smallest fix: swap the parser in `parseFrontmatterMapping`
(`src/core/card-io.ts:282`) only. That gets most of the `bbx todos` gain, but
leaves the schema parsers, the lint pass (`lint-cards.ts:387`), and the
ledger (`ledger-schema.ts:88`) on `yaml`, so two parsers with different edge
behavior read the same cards depending on the reader.

The gain is parse time only. `yaml` is still imported on every card read:
`card-io.ts` imports `exports/cards`, which re-exports
`src/cards/frontmatter.ts`, which needs `yaml` for `stringify` and
`parseDocument` (review finding, 2026-10-24). Making the write side lazy is
out of scope.

Chosen: one helper, `src/lib/read-yaml.ts`, and the read-only `parse` sites
in `src/` move to it: 37 files. Two stay on `yaml`:
`src/core/card-fields/field-edits.ts`, whose `convertCardFile` plans an edit
from parsed values and applies it through a `yaml` document, so plan and edit
must read the text the same way; and `src/exports/schema.ts`, the public
`parseYaml` for box schema files, whose signature (options, reviver) the
helper does not keep. Estimate: helper and its test about 60 lines; 37 import
swaps (about 80 changed lines); 4 tests whose expected error wording changes;
one `instanceof YAMLParseError` site. About 200 changed
source and test lines. Docs: `docs/development/performance.md`, about 10
lines. The `docs/cards/schemas.md` example parses and rewrites a card, a write
path, so it stays on `yaml`.

## Stated preferences this plan trades against

- **Two libraries for one format.** The cost the boxholder accepted
  (2026-10-24 discussion): `yaml` stays because js-yaml has no document model.
  The boundary is "read to plain values" versus "write or edit text", and one
  helper owns the read side.
- **Bias toward strict.** js-yaml throws on an unknown tag (`!foo`) where
  `yaml` warns and keeps the string. That is stricter; it is accepted.
- **No dependency weakening.** The root override `js-yaml: ^4.3.0`
  (`package.json`, from d90aaae5c, a security patch floor) stays. beebox
  depends on `js-yaml@^4.3.0` directly; 5.x is out of scope.

## What already exists

- `yaml` `parse` imported as `parseYaml` at 39 sites in `src/` (32 plain
  `import { parse as parseYaml } from "yaml"`, the rest combined with
  `stringify`, `parseDocument`, or the default `YAML` import). Rebuilt as an
  import of the helper: the call shape `parseYaml(text): unknown` is kept, so
  each site changes one import line.
- `src/exports/schema.ts:13` re-exports `parse as parseYaml` for box schema
  files. It stays on `yaml`: box scripts may pass options, and those scripts
  are not on the per-card read path.
- `src/core/chat/routing/quick-chat-submit/catalog.ts:50`:
  `error instanceof YAMLParseError` — the only site that tests the error
  class. It changes to the helper's error check.
- `js-yaml@4.3.0` is already in the lockfile (a dependency of
  `@eslint/eslintrc`). Added to beebox `dependencies` with `@types/js-yaml`
  (types beside the runtime package, as `@types/ws` is).
- The frontend bundle does not contain `yaml`'s parser (checked
  `src/frontend/dist/assets` for its error strings); nothing changes there.

## Prior art (external)

- js-yaml `CORE_SCHEMA` is the YAML 1.2 core schema without timestamps or
  merge keys, the same resolution `yaml`'s default uses
  (https://github.com/nodeca/js-yaml#api). Adopted as the schema; no code
  copied, so no ACKNOWLEDGEMENTS entry.

## Ontology

No new nouns. The helper is `parseYaml` (the name the call sites already use)
and `isYamlSyntaxError(error)`.

## Tracks / scope

### Track 1: the helper and the swap

- **What:** add `src/lib/read-yaml.ts`; point every read-only parse at it.
- **Why:** the parse cost above, and one read parser for all callers.
- **Direction:**
  ```ts
  /** YAML text as plain values (YAML 1.2 core schema). Empty text is null. */
  export function parseYaml(text: string): unknown;
  /** A YAML syntax or structure error from parseYaml. */
  export function isYamlSyntaxError(error: unknown): boolean;
  ```
  `parseYaml` calls `load(text, { schema: CORE_SCHEMA })` and maps
  `undefined` (an empty or comment-only document) to `null`, which is what
  `yaml` returns and what callers such as `parseFrontmatterMapping` expect.
- **Vocabulary lock-ins:** `src/lib/read-yaml.ts` is where read-only parsing
  lives. `yaml` imports remain for `stringify`, `parseDocument`,
  `Document`, node helpers, an edit planned from parsed values
  (`field-edits.ts`), and the public box-schema export.
- **First chunk:** the helper, its test, and the 37 swaps in one commit; the
  4 expected error strings updated in the same commit.

## Could this be simpler?

The simplest version swaps only `parseFrontmatterMapping`. It leaves the lint
pass (`lint-cards.ts:387`, 140 ms of `bbx validate` is split between it and
card-io), the ledger, and the schema parsers on the slow parser, and the same
card would parse with two edge behaviors depending on the reader (`-.5` is a
number to one and a string to the other). A wrapper module is the
smallest way to keep the choice in one place.

## Subplans

none

## Failure modes

Corpus check (2026-10-24): every `.card`/`.md` frontmatter block and `.yaml`
file in the developer's local boxes (test1, other test and demo boxes, and
backups) and this repo, 17,854 inputs: 17,850 parse to deep-equal values; 4
throw in both. One box directory was unreadable from the worktree and is not
in the count. Synthetic cases that
differ:

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A hand-typed `-.5` reads as the string `"-.5"` (js-yaml's float pattern needs a digit before the point when signed) | read-yaml test pins it | Schema validation rejects a string where a number is required | Clear for typed fields; silent in free-form fields |
| `0b101` reads as 5, not the string `"0b101"` | read-yaml test pins it | none | Silent; no box has it |
| An unknown tag (`!foo bar`) throws instead of reading `"bar"` | read-yaml test pins it | `parseCardText` reports invalid YAML; best-effort readers (`parseFrontmatterObject`, `parseLandmarkFields`) return null and skip the card | Clear in `bbx validate` and on load; silent in the best-effort scans |
| `!!binary`, `!!timestamp`, a `%YAML 1.1` directive | no | Callers' malformed-YAML paths (the tags throw) | Clear; none in any box |
| Malformed-YAML messages change wording | 4 tests updated | unchanged | Clear |
| `quick-chat-submit` stops recognizing a syntax error and rethrows it | catalog test with a malformed rubric | `isYamlSyntaxError` | Would be clear (a crash), so tested |

No critical gap: the silent rows need hand-typed values that no local box
has, and a card with an unknown tag still fails `bbx validate` by name.

## Agent-flow / user-flow edge cases

- Hand-edit drift: an agent or person writes `-.5` or a custom tag. ADDRESSED
  above: typed fields fail validation; tags fail as invalid YAML.
- Validation error UX: ADDRESSED. js-yaml's message gives the reason,
  `(line:column)`, and a snippet with a caret, like `yaml`'s.
- Wrong field, stale ref, concurrent agents, fabricated values, partial
  migration: not affected; parsing returns the same values on every input in
  the corpus, and no on-disk shape changes.

## NOT in scope

- Writes and edits (`stringify`, `parseDocument`): js-yaml cannot keep
  comments or formatting.
- Loading `yaml` lazily on the write side, which would add the import saving.
- The public `parseYaml` export in `src/exports/schema.ts`.
- js-yaml 5.x: the root security override pins `^4.3.0`; moving needs that
  override reconsidered.
- A lint rule banning `parse` from `yaml`: the workstream brief does not
  approve lint rule changes. The helper's doc comment states the rule.
- Parsing each card once in `bbx validate` (`unknownKeyWarnings` re-parses):
  with js-yaml the second parse is about 5 ms on test1; separate change.
- Packages outside beebox (`workstreams-app`, `tap-check`, `bin/`).

## Open design questions

none

## Knowledge audits

Skipped: no agent-facing concept changes. Box scripts keep importing
`parseYaml` from the same export.

## What will hold this after it ships

`test/lib/read-yaml.test.ts` pins the empty-text null, the differing edge
cases above, and that syntax errors satisfy `isYamlSyntaxError`. The existing
card-io, search-refresh, doc-check, and scan-guide tests cover the error
paths through real callers.

## Implementation order

1. Dependency, helper, test, the 37 swaps, the 4 expected strings, the
   catalog check, docs — one commit.
2. Measure `bbx todos`, `bbx validate`, `bbx status` against the branch
   before the change; record in `docs/development/performance.md` and the
   issue.

## Rollout shape

Done when `pnpm test:changed`, typecheck, lint, and layout-check pass, the
corpus check still reports no value differences, and the measurements show
the gain. No data migration.
