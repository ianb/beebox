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
the same text 4–7× faster. This plan moves the read-only YAML parses in
beebox to one helper that parses with js-yaml and hands `yaml` any text where
the two could disagree, so every value and error stays `yaml`'s. Writes,
comment-preserving edits, and the public `beebox/schema` export stay on
`yaml`.

**Issues addressed:** `issues/code-quality/2026-10-23-card-frontmatter-parse-with-js-yaml.md`
(its decision is made: the boxholder asked for read-only parsing on js-yaml,
2026-10-24). Searched the queue for "js-yaml", "yaml parse", "frontmatter
parse": no other open item.

## Design

No design section: no card, surface, output, or error message changes. Only
parse speed changes.

## Smallest fix and budget

Smallest fix: swap the parser in `parseFrontmatterMapping`
(`src/core/card-io.ts:282`) only. That gets most of the `bbx todos` gain, but
leaves the lint pass (`lint-cards.ts:387`), the ledger
(`ledger-schema.ts:88`), and the schema parsers on `yaml`.

The gain is parse time only. `yaml` is still imported on every card read:
`card-io.ts` imports `exports/cards`, which re-exports
`src/cards/frontmatter.ts`, which needs `yaml` for `stringify` and
`parseDocument` (plan review, 2026-10-24). The helper's fallback relies on
that: `yaml` costs nothing extra to call. Making the write side lazy is out of
scope.

Chosen: one helper, `src/lib/read-yaml.ts`, and the read-only `parse` sites
in `src/` move to it: 37 files. Two stay on `yaml`:
`src/core/card-fields/field-edits.ts`, whose `convertCardFile` plans an edit
from parsed values and applies it through a `yaml` document (an edit path);
and `src/exports/schema.ts`, the public `parseYaml` for box schema files,
whose signature (options, reviver) the helper does not keep. Estimate: helper
and its test about 120 lines; 37 import swaps (about 80 changed lines). About
200 changed source and test lines. Docs: `docs/development/performance.md`,
about 10 lines.

## Stated preferences this plan trades against

- **Two libraries for one format.** The cost the boxholder accepted
  (2026-10-24 discussion): `yaml` stays because js-yaml has no document model.
  The boundary is "read to plain values" versus "write or edit text", and one
  helper owns the read side.
- **Never resilient to the impossible** (`code-style.md`). The fallback to
  `yaml` is for inputs that occur (hand-typed values, malformed cards), and it
  returns `yaml`'s result or throws `yaml`'s error; it hides no failure.
- **No dependency weakening.** The root override `js-yaml: ^4.3.0`
  (`package.json`, from d90aaae5c, a security patch floor) stays. beebox
  depends on `js-yaml@^4.3.0` directly; 5.x is out of scope.

## What already exists

- `yaml` `parse` imported as `parseYaml` at 39 sites in `src/` (32 plain
  `import { parse as parseYaml } from "yaml"`, the rest combined with
  `stringify`, `parseDocument`, `YAMLParseError`, or the default `YAML`
  import). The call shape `parseYaml(text): unknown` is kept, so each site
  changes one import line.
- `src/exports/schema.ts:13` re-exports `parse as parseYaml` for box schema
  files. It stays on `yaml`: box scripts may pass options, and those scripts
  are not on the per-card read path.
- `src/core/chat/routing/quick-chat-submit/catalog.ts:50` tests
  `error instanceof YAMLParseError`. Errors still come from `yaml`, so it is
  unchanged.
- `js-yaml@4.3.0` is already in the lockfile (a dependency of
  `@eslint/eslintrc`). Added to beebox `dependencies` with `@types/js-yaml`
  (types beside the runtime package, as `@types/ws` is).
- The frontend bundle does not contain `yaml`'s parser (checked
  `src/frontend/dist/assets` for its error strings); nothing changes there.

## Prior art (external)

- js-yaml `CORE_SCHEMA` is the YAML 1.2 core schema without timestamps or
  merge keys, close to what `yaml` resolves by default
  (https://github.com/nodeca/js-yaml#api). Adopted as the fast path's schema;
  no code copied, so no ACKNOWLEDGEMENTS entry.

## Ontology

No new nouns. The helper exports `parseYaml`, the name the call sites already
use.

## Tracks / scope

### Track 1: the helper and the swap

- **What:** add `src/lib/read-yaml.ts`; point the read-only parses at it.
- **Why:** the parse cost above.
- **Direction:**
  ```ts
  /** YAML text as plain values, as `yaml` reads it. Empty text is null. */
  export function parseYaml(text: string): unknown;
  ```
  If the text matches `YAML_ONLY`, a pattern for every construct js-yaml
  reads differently (below), it calls `yaml`'s `parse`. Otherwise it calls
  `load(text, { schema: CORE_SCHEMA })` and maps `undefined` (an empty or
  comment-only document) to `null`. If js-yaml throws, it calls `yaml`'s
  `parse`, which returns its own value (an unknown tag, keys that collide only
  in js-yaml) or throws its own error. `YAML_ONLY` matches anchors and tags,
  a `%` directive, signed `0x`/`0o`/`0b`/zero and signed leading-dot numbers,
  unsigned `0b`, null and empty keys, and collection or explicit `?` keys.
  Each repetition in it starts after a fixed character, so the test is linear.
- **Vocabulary lock-ins:** `src/lib/read-yaml.ts` is where read-only parsing
  lives. `yaml` imports remain for `stringify`, `parseDocument`,
  `Document`, node helpers, `YAMLParseError`, an edit planned from parsed
  values (`field-edits.ts`), and the public box-schema export.
- **First chunk:** the helper, its test, and the 37 swaps in one commit.

## Could this be simpler?

The simplest version is a bare js-yaml call with no fallback. The diff review
(2026-10-24) showed what that costs: js-yaml has no alias-expansion limit (a
700-byte card expanded to 268 MB when serialized, where `yaml` refuses it),
and a value js-yaml reads differently from `yaml` (`-.5`) passes validation,
then becomes a different value when an edit re-renders the same text through a
`yaml` document. Matching `yaml` exactly removes both, and keeps the error
messages agents and tests already read. The fallback adds one regular
expression and one `catch`.

## Subplans

none

## Failure modes

Checks (2026-10-24), each comparing `parseYaml` with `yaml.parse` on value,
error name, and error message:

- Corpus: every `.card`/`.md` frontmatter block and `.yaml` file in the
  developer's local boxes (test1, other test and demo boxes, and backups) and
  this repo, 17,857 inputs: no differences. 156 take the fallback by pattern.
  One box directory was unreadable from the worktree and is not in the count.
  Time over the corpus: `yaml` 1,700 ms, `parseYaml` 560 ms; on the test1
  clone alone, 28 ms against 7 ms.
- Fuzz: every scalar of up to 3 characters over a 24-character alphabet of
  number, null, and key characters, as a mapping value, sequence item, flow
  item, flow value, and key, plus the edge cases in the test: 72,148 inputs,
  no differences.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A construct js-yaml reads differently that `YAML_ONLY` misses | read-yaml test pins each known one; corpus and fuzz checks above | none beyond the pattern | Silent: a differing value |
| `YAML_ONLY` backtracks on long text (a first version took 3.7 s on a 77 KB card) | no (a timing assertion would be flaky) | the pattern's bounded repetitions | Clear: a slow command |
| Nested aliases expand without limit | read-yaml test | anchors match `YAML_ONLY`, so `yaml`'s limit applies | Clear: `yaml`'s error |

No critical gap. The first row is the residual risk of the design: it needs a
YAML construct outside the fuzzed scalars and the known list, in a box.

## Agent-flow / user-flow edge cases

- Hand-edit drift: an agent or person writes `-.5`, a custom tag, or an
  anchor. ADDRESSED: each takes `yaml`'s path and reads as before.
- Validation error UX: ADDRESSED. Errors are `yaml`'s, unchanged.
- Wrong field, stale ref, concurrent agents, fabricated values, partial
  migration: not affected; values are unchanged and no on-disk shape changes.

## NOT in scope

- Writes and edits (`stringify`, `parseDocument`): js-yaml cannot keep
  comments or formatting.
- Loading `yaml` lazily on the write side, which would add an import saving.
- The public `parseYaml` export in `src/exports/schema.ts`.
- js-yaml 5.x: the root security override pins `^4.3.0`; moving needs that
  override reconsidered.
- A lint rule banning `parse` from `yaml`: the workstream brief does not
  approve lint rule changes. The helper's doc comment states the rule.
- Parsing each card once in `bbx validate` (`unknownKeyWarnings` re-parses):
  with js-yaml the second parse is a few ms on test1; separate change.
- Packages outside beebox (`workstreams-app`, `tap-check`, `bin/`).

## Open design questions

none

## Knowledge audits

Skipped: no agent-facing concept changes. Box scripts keep importing
`parseYaml` from the same export.

## What will hold this after it ships

`test/lib/read-yaml.test.ts` pins the empty-text null, each construct that
takes `yaml`'s path with `yaml`'s value, `yaml`'s error on malformed text,
and the alias limit. The existing card-io, search-refresh, doc-check, and
scan-guide tests check `yaml`'s error wording through real callers.

## Implementation order

1. Dependency, helper, test, the 37 swaps, docs — one commit.
2. Measure `bbx todos`, `bbx validate`, `bbx status` against the branch
   before the change; record in `docs/development/performance.md` and the
   issue.

## Rollout shape

Done when `pnpm test:changed`, typecheck, lint, and layout-check pass, the
corpus and fuzz checks report no differences, and the measurements show the
gain. No data migration.
