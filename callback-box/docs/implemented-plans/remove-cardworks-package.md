# Remove the cardworks package

Delete the `cardworks` package from the monorepo. All six card schemas are
now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
large XML half of cardworks — parser, serializer, JSX, XPath, the
`CardLoader`, the XML element schema — has no real users. This plan removes
the dead XML code paths in callback-box, copies the small frontmatter-primitive
core of cardworks into callback-box, and deletes the package, its
`node_modules` symlink, the `workspace:*` dependency, and the
`pnpm-workspace.yaml` entry.

This is the follow-up round to `remove-cardworks-and-xml.md` (the schema
migrations). Plan-only; nothing executes until approved and run end-to-end on
this worktree branch.

> **Load-bearing decision (settled): drop box-local XML schema support.**
> The built-in `schemas[]` is empty, but boxes can still author *their own* XML
> card types via `config/schemas/*.ts` + cardworks' `element()` — and two real
> boxes do (`ledger-copy`/`ledger-shrink-test` define a `bill` schema in
> `config/schemas/bill.ts`, with 23 `.bill.card` data files). So the XML loader
> is **not** dead — it's live for box-authored schemas. This plan therefore
> includes an explicit decision, confirmed with the boxholder, that **boxes may
> define only frontmatter (`cardSchema`) card types going forward**; the
> box-local `element()` path is removed, and existing box-local XML schemas
> (the `bill` schema + its cards) are migrated to frontmatter as part of the
> box-migration prerequisite before deletion. Without this decision the "dead
> XML path" premise is false (see Cross-model review applied).

## Cross-model review applied (Codex)

A Codex (different model family) read this plan against the source and
falsified several claims; the findings are folded in above and throughout:

- **Box-local XML is live** (`test/box-schemas.doctest.md` proves a `gadget`
  XML card loads; `loadBoxSchemas` segregates `elementSchemas`,
  `src/schemas/registry.ts:257`). → New load-bearing decision (drop it) above;
  Track A now *removes* that path rather than treating it as already-dead.
- **`tsc` is not a complete safety net** (`callback-box/tsconfig.json` covers
  only `src/**/*`, so `scripts/`, `test/`, box `config/schemas/*.ts` runtime
  imports, and `dist/` are invisible to it). → Track B's completeness check is
  grep-based across those surfaces, not typecheck-only.
- **Don't delete `MIGRATIONS` entries** — `src/core/migrations.ts:6`: *"never
  reorder or remove existing entries — the `name` is the manifest key."* →
  Track C keeps the entries; spent XML migrator *scripts* may be stubbed, not
  unlisted.
- **Keep-set is not all copy-verbatim:** `SchemaRegistry`
  (`cardworks/src/schema/registry.ts`) is `ElementSchema`/`.tagName`-oriented,
  not a generic frontmatter registry; and the lint/`ParseError` `Location`
  reads `startLine`/`startColumn`, not `line`/`column`
  (`cardworks/src/lint/format.ts:37`). → Track B adapts these, not copies.
- **`card`/`todos` tRPC endpoints are XML-only live API** (`card.ts:271`
  patch, `todos.ts` updateItem) → an explicit keep-rewrite-or-remove decision,
  not a silent delete (Open question 4).
- **`ls --format` lives in two files** (the CLI wrapper `cli/commands/ls.ts:14`
  registers the flag; core evaluates XPath) and the dotted-path helper is
  private → both surfaces updated (Critical gap resolution).
- **`dist/cli.mjs` has baked `cardworks` imports** → Track C rebuilds/validates
  the artifact.

A **second Codex pass on the revised plan** (the revision was same-model, so it
carried my blind spots) found more:

- **Box-local frontmatter schemas need a public import contract.** Box
  `config/schemas/*.ts` import bare `"cardworks"` via a custom tsx resolver
  (`SCHEMA_DEPS = {"cardworks","zod"}`, `src/schemas/registry.ts:97`), and
  package.json has **no `exports` map** (`package.json:6`). After cardworks is
  deleted, a migrated box schema (e.g. frontmatter `bill.ts`) has nothing to
  import `cardSchema` from. → **New Track B requirement:** expose the primitives
  under a public specifier — add an `exports` entry and have box schemas import
  `callback-box/cards`, or keep `"cardworks"` as a resolver alias mapping to
  `src/cards/`. This must land *before* deletion.
- **The box-local-`element()` removal (Track A chunk 2) is NOT box-state
  independent** — it breaks the ledger boxes' live `bill` schema, so it's gated
  on the box-schema audit like Track C, not free to ship early.
- **Drop `SchemaRegistry`, don't copy it** — it's reached only through the XML
  `CardLoader`/`load-context.ts` bridges; once those go it has no user.
- **`todos` is broken on *both* sides** — `TodoListView` parses XML
  (`TodoListView.tsx:31`) and frontmatter responses set `element: undefined`
  (`card.ts:152`), so the render *and* the edit need a frontmatter rewrite.
- **`card.patch` removal has a REST-route + doctest tail**
  (`api-card-routes.ts:71-120`, `test/routes-api.doctest.md:112-128`).
- **Migrator wording fix** — Track C *stubs* the migrator scripts in place
  (files remain, exit 0); it does not "delete" them.

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md`** — `CLAUDE.md:28` (current): *"Every built-in
  schema is now frontmatter; the legacy XML-body format and its loader branch
  remain in place but dormant (no schema uses them) until cardworks is
  removed."* This plan makes that sentence's promise good. Also the "don't
  add features beyond what the task requires" rule — we copy in only the
  primitives that are actually imported, deleting the rest.
- **`callback-box/CODE-STYLE.md`** — `CODE-STYLE.md:25` (no `any`),
  `CODE-STYLE.md:55` (`as` is like Rust `unsafe`; centralize at parse
  boundaries), `CODE-STYLE.md` files ≤300 lines. The copied-in primitives
  already obey these (they're cardworks' own clean modules).
- **The migration precedent** — `remove-cardworks-and-xml.md` shipped six
  schema migrations using TypeScript's typecheck as the completeness check
  (each migration's consumers were found by compile errors). This plan leans
  on the same mechanism harder: it is the safety net (see Direction).

## What already exists

- **The XML loader branch — live for box-local schemas, made dead by this
  plan.** `callback-box/src/core/card-io.ts:285`: *"export type LoadedCard =
  FrontmatterLoadedCard | XmlLoadedCard"*; `card-io.ts:350` falls through to
  `loadXmlCard` (`card-io.ts:370`). Built-in `schemas[]` is empty, but
  `loadBoxSchemas` populates `elementSchemas` from `config/schemas/*.ts`
  (`src/schemas/registry.ts:240`/`:257`) and `box-schemas.doctest.md` proves a
  box `gadget` XML card loads — so the branch is **reachable** today. **Rebuild
  (after the box-local-XML decision):** migrate existing box-local XML schemas
  to frontmatter, remove the box-local `element()` path (the `elementSchemas`
  half of `loadBoxSchemas`, `isElementSchema`, the gadget doctest, and the
  `element()` scaffolding in `box-templates.ts:31`/`:126`), then collapse the
  `LoadedCard` union to `FrontmatterLoadedCard` and delete `loadXmlCard`.
- **The frontmatter primitives, in cardworks.** `cardSchema`/`body`/
  `extractRefs` (`cardworks/src/schema/card-schema.ts`, 249 LOC, imports
  `zod` only — copy-verbatim); `splitCardContent`
  (`cardworks/src/parser/frontmatter.ts`, 65 LOC, zero imports — copy-verbatim);
  `formatLintResults` (`cardworks/src/lint/format.ts`, 130 LOC) plus the
  `LintSummary`/`LintResult`/`LintIssue` types from `lint/lint.ts`; `ParseError`
  (`cardworks/src/parser/parse.ts`). **Caveats (Codex-verified, not
  copy-verbatim):** (a) `SchemaRegistry` (`cardworks/src/schema/registry.ts`)
  is `ElementSchema`/`.tagName`-keyed, **not** a generic frontmatter registry —
  adapt it to `CardSchema`/`.type` or check whether callback-box's
  `registry.ts` still needs it at all post-migration; (b) the `Location` these
  carry reads `startLine`/`startColumn` (`format.ts:37`), not `line`/`column` —
  the local minimal `Location` must match. ~560 LOC of *frontmatter* primitives,
  but the copy is an adaptation, not a verbatim lift.
- **The XML bulk, in cardworks, with no real consumer.** parser
  (`parse.ts`/`dom-to-object.ts`/`provenance.ts`), `serialize/serialize.ts`,
  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
  `refs/resolve.ts` (261), `schema/element.ts`+`base.ts`,
  `schema/format-error.ts`, `lint/lint.ts` (the engine), `card/*`, `fs/*`.
  **Delete outright.**
- **callback-box already owns its frontmatter card IO.**
  `card-io.ts` `parseCardText` (`card-io.ts:114`) validates against
  `schema.frontmatterSchema` (Zod) and formats its own Zod errors
  (`card-io.ts:62` `formatZodIssues`) — it does *not* use cardworks'
  `format-error.ts`. `card-lint.ts` has its own dispatcher and Markdoc
  body-ref extraction (`body-refs.ts`). **Reuse:** these stay; only their
  cardworks *imports* get repointed.
- **Only callback-box consumes cardworks.** Verified: no imports in
  `callback-clerk/`, `agent-doctest/`, or `personal-vibe-check/`.
- **The migrators read old XML cards via cardworks.** `scripts/migrate/*.ts`
  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
  pre-migration XML box cards. This is the one place that still *needs* the
  XML parser, and it is a sequencing constraint (see Open questions).

## Prior art (external)

Skip-with-rationale: this is a purely internal refactor — deleting a
first-party workspace package and inlining ~560 LOC of its source. No
third-party library behavior is in question. The one technique worth naming
is **compiler-driven refactoring**: removing/!renaming the deleted exports so
`tsc` enumerates every stale call site, rather than hunting them by grep. That
is exactly how the six schema migrations were verified (each consumer surfaced
as a type error), so it is established in-repo practice, not a novel bet. No
external search performed; none warranted.

## Tracks / scope

Ordered by dependency: Track A removes dead/live XML consumers so nothing in
callback-box imports a cardworks XML symbol; Track B copies the primitive core
in and repoints the keep-set imports; Track C deletes the package and its
wiring. The plan completes when cardworks is gone and the suite is green.

### Track A — Sever callback-box from cardworks' XML surface

**What.** Remove or rewrite every callback-box site that imports a cardworks
XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
only cardworks imports left are the frontmatter keep-set.

**Why this needs to change.** These symbols are the API of the half of
cardworks we're deleting. While they remain imported, cardworks can't go.
Most sites are dead (unreachable now that no card is XML); a few are live and
need a frontmatter replacement.

**Direction.** Per the investigation, by disposition:

- **Delete dead paths.** `card-io.ts` XML branch (`loadXmlCard`,
  `XmlLoadedCard`, the `LoadedCard` union, `elementSchemas` in
  `LoadCardContext`); `search/extract.ts` `xmlDoc`/`collectElementText` and
  the `card.kind === "xml"` dispatch (`extract.ts:103`);
  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
  a frontmatter-field lookup (the dotted-path accessor already written for
  landmark in `core/landmark/resolve.ts` is the model);
  `preactions/transcribe.ts` XML transcription helpers;
  `webapp/trpc/routers/todos.ts` (XML `loader.load`/mutate/`save`);
  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
- **CORRECTION (found during implementation): `procedure-trampoline.ts` is
  NOT a dead path.** `detectProcedureInJob` (`procedure-trampoline.ts:22`) is
  called live for every job card by the reactor (`engine.ts:344`), and
  procedure-job cards are still **XML** (`<procedure ref="...">`) — the docs
  (`generate-docs-procedure-guide.ts:40`) and triage
  (`triage-instructions.ts`/`handle.ts`) actively generate that shape. This is
  an un-migrated XML *feature*, not cleanup: removing cardworks here requires
  its own subtask — a frontmatter procedure-job representation, a rewritten
  detector, migration of existing box `<procedure>` job cards, and updated
  doc/triage generators. Out of scope for the dead-path sweep; needs a
  decision (subplan) before Track C can delete cardworks.
- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
  discovery and `loader.move()` for XML referrer re-serialization), and any
  router that calls `createLoader`. The discovery use (`listCards()`) becomes
  a glob/fs walk; the XML `move()` is dead (Phase-2 cards take
  `movePhase2CardFiles`, and ref rewriting is already substring-based in
  `rewrite-card-refs.ts`). `cli/commands/validate.ts` keeps
  `formatLintResults` (it moves to the keep-set, Track B).
- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
  (`file-summary.ts`, `agent-guide/*`, `load-context.ts`, `preactions/types.ts`,
  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
  fields or now-empty code. Delete the XML field/branch; where a type is
  genuinely still needed it is replaced by a local type or removed with the
  dead path.

**Completeness check — typecheck PLUS grep (Codex finding #2).** After
repointing the keep-set (Track B), the deleted XML exports vanish and
`pnpm typecheck` enumerates every stale consumer *in `src/`* — surfacing
latent bugs like `chat.ts` reading a now-frontmatter landmark via `parseCard`
or `generate-docs-compile.ts:47`. **But `tsc` is not sufficient:**
`callback-box/tsconfig.json` covers only `src/**/*`, so it misses
`scripts/*.ts` (e.g. `clean-broken-refs.ts` imports `splitCardContent`),
`test/`, the `dist/` artifact, and — critically — box `config/schemas/*.ts`,
which import `"cardworks"` at *runtime* via a custom resolver
(`registry.ts:97`/`:122`) that no compile pass sees. The completeness gate is
therefore: `pnpm typecheck && pnpm lint && pnpm test`, **plus**
`grep -rl 'cardworks' callback-box/{src,scripts,test}` empty, **plus** the
box-schema audit (`grep -rl 'cardworks' ~/src/boxes/*/config/schemas/`) clean,
**plus** a `dist` rebuild (Track C).

**First implementation chunk.** Delete the three unambiguously-dead,
self-contained paths and confirm green: `card-io.ts` XML branch + union
collapse; `search/extract.ts` `xmlDoc`; `ls.ts` `--format`/XPath. No open
questions inside this chunk.

### Track B — Copy the frontmatter primitives into callback-box

**What.** Create a callback-box module (proposed `src/cards/`) holding the
keep-set, and repoint every `from "cardworks"` keep-set import to it.

**Why this needs to change.** `cardSchema`/`body`/`splitCardContent`/
`CardSchema`/`SchemaRegistry`/`formatLintResults`/`ParseError` are imported by
~50 callback-box files (every schema file plus `card-io.ts`, `card-lint.ts`,
`registry.ts`, `validate.ts`). They must live in callback-box before cardworks
can be deleted.

**Direction.** New files under `src/cards/`:
- `schema.ts` ← `cardworks/src/schema/card-schema.ts` (`cardSchema`, `body`,
  `isBodyField`, `extractRefs`, types `CardSchema`/`BodyField`/`FieldDecl`).
  Imports zod only — copy verbatim.
- `frontmatter.ts` ← `cardworks/src/parser/frontmatter.ts` (`splitCardContent`).
  Zero deps — copy verbatim.
- **`SchemaRegistry` — drop it, don't copy** (Codex round 2). It keys on
  `ElementSchema.tagName` and is reached only through the XML `CardLoader` /
  `load-context.ts` bridges (`cli/lib/loader.ts:7`, `load-context.ts:7`); once
  Track A removes those bridges it has no user. callback-box's own
  `cardSchemas` Map + `createCardSchemaMap` already cover frontmatter lookup.
- **Public import specifier for box-local schemas (must land before Track C).**
  Box `config/schemas/*.ts` import bare `"cardworks"` via the tsx resolver
  (`registry.ts:97`); package.json has no `exports` map (`package.json:6`).
  Add an `exports` entry exposing `src/cards/` as `callback-box/cards` (or keep
  `"cardworks"` as a resolver alias → `src/cards/`), and update the box-schema
  template/scaffolding + the migrated `bill.ts` to import from it. Without this,
  every future frontmatter box schema breaks at runtime when cardworks is gone.
- `lint-format.ts` ← `cardworks/src/lint/format.ts` (`formatLintResults`,
  `formatLintResult`, `formatLintResultsJson`) plus the `LintSummary`/
  `LintResult`/`LintIssue`/`LintOptions` types extracted from
  `cardworks/src/lint/lint.ts`. The types reference a `Location` from the
  XML `provenance.ts`; redefine a minimal local `Location` matching what the
  formatter actually reads — **`{ source: string; startLine?: number;
  startColumn?: number }`** (`format.ts:37` reads `startLine`/`startColumn`,
  not `line`/`column`).
- `errors.ts` ← the `ParseError` class extracted from
  `cardworks/src/parser/parse.ts` (used by `search/refresh-file.ts:15`), with
  the same `startLine`/`startColumn` `Location` (`parse.ts:31`).

Then a barrel `src/cards/index.ts` re-exports them, and a codemod-style
find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
adjusted per file) for the keep-set symbols.

**Vocabulary lock-ins.** None — these are internal primitives, no
agent-facing names.

**First implementation chunk.** Create `src/cards/` with the two zero-dep
files (`frontmatter.ts`, `schema.ts`) and repoint the schema files + `card-io.ts`
to them; leave lint-format/errors for the next chunk. No open questions
inside this chunk (these two files have no transitive deps).

### Track C — Delete cardworks and its wiring

**What.** Remove the `cardworks/` directory, the
`callback-box/node_modules/cardworks` symlink, the `"cardworks": "workspace:*"`
dependency (`callback-box/package.json:80`), and the `- cardworks` line in
`pnpm-workspace.yaml:17`; **neutralize (do not unlist) the spent XML
migrators** — replace each cardworks-importing `scripts/migrate/*.ts` with an
obsolete no-op stub *while keeping its `MIGRATIONS` entry*, because
`src/core/migrations.ts:6` is explicit: *"never reorder or remove existing
entries — the `name` is the manifest key"* (28 entries, several non-XML like
`attachments`/`doc-to-gdoc`/`strip-type-field` — removing any rewrites what a
box thinks it has applied); **rebuild and validate `dist/`** (`dist/cli.mjs`
bakes in `cardworks` imports — a stale committed/deployed artifact would carry
dead imports); run `pnpm install` to settle the lockfile; update docs.

**Why this needs to change.** The point — no cardworks. The migrators are
the last cardworks consumer (they read pre-migration XML cards via
`parseCard`); once every box is migrated (decided: box-migration-first) they
have done their job and are stubbed in place (files remain, exit 0) in the
same push — **not deleted** (their `MIGRATIONS` entries are manifest keys).

**Gated on box migration.** This track runs only once (1) Tracks A+B make
`grep -rl 'from "cardworks"' callback-box/{src,scripts,test}` empty, **and**
(2) the box-schema audit is clean — every box migrated off XML *data* and every
box-local `element()` schema converted to `cardSchema`. Note (Codex round 2):
**Track A chunk 2 — removing box-local `element()` loading — is itself gated on
that audit**, since it breaks any box still defining an XML schema (the ledger
`bill` schema). So "A+B land first, box-independent" holds for everything
*except* chunk 2, which ships with Track C's gate. Doc updates: `CLAUDE.md:87` (the cardworks bullet),
`CLAUDE.md:39`/`docs/adding-schemas.md` (drop "from cardworks" phrasing where
it now means "from `src/cards/`"); retire `docs/migrations.md` references to
the deleted migrators as appropriate.

**First implementation chunk.** After box migration is confirmed complete,
delete the package + wiring + migrators + `pnpm install`, with a clean
`pnpm typecheck && pnpm lint && pnpm test`.

## Subplans

None. The one sub-question (migrator dependency on the XML parser) is small
enough to settle inline as an Open question with a lean, not a separate design
step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A stale consumer in `src/` reads a card via deleted `parseCard` | Partial | Yes — `tsc` fails once the symbol is gone | Clear (compile error) |
| A `scripts/` or box `config/schemas/*.ts` cardworks import (NOT in tsconfig) | No | No — `tsc` doesn't see it | **Silent until runtime** — covered by the grep gate, not the compiler |
| A box still defines an `element()` schema after box-local XML is dropped | No | Gate: box-schema audit before deletion (`bill` in ledger boxes is the known case) | Clear-but-fatal (that card type won't load) |
| `cli/lib/loader.ts` rewrite changes card-listing semantics | Yes — move/validate doctests | Yes — `isCardFile` filter | Clear (tests / validate output) |
| `ls --format` dropped but a box/agent still calls it | No | No | **Silent** (format arg ignored) |
| `todos.updateItem` left on XML `CardLoader` (todo-toggle UI already errors on frontmatter cards) | No | Plan rewrites it to frontmatter (Open question 4) | **Silent today** — UI toggle errors; rewrite fixes it |
| Local minimal `Location` uses wrong field names (`line` vs `startLine`) | Yes — validate output doctests | Yes — match `startLine`/`startColumn` per `format.ts:37` | Clear (format looks wrong) |
| Removing a `MIGRATIONS` entry shifts a box's applied-manifest | No | Yes — keep entries, stub scripts only | Clear-but-fatal if violated |
| Stale `dist/cli.mjs` keeps baked `cardworks` imports | No | Yes — Track C rebuilds dist | Clear (import error if dist is run) |

**Critical gap: `ls --format` silent removal.** `commands/ls.ts:74`'s
XPath `--format` is the one user-facing feature being dropped, and it lives in
**two** files — the CLI wrapper registers the flag (`cli/commands/ls.ts:14`)
and core evaluates XPath. If only one is touched the flag can keep being
accepted and then misbehave. **Resolution:** reduce `--format` to a dotted-path
frontmatter accessor in *both* surfaces, extracting the landmark resolver's
currently-private `lookupField` (`core/landmark/resolve.ts`) into a shared
helper. Lean: keep `cb ls --format '{title}'` working against frontmatter
fields.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **N/A.** No new vocabulary or agent-authored
  shape; this is an internal package move.
- **Stale ref** — **ADDRESSED (unchanged).** Ref-checking moves verbatim
  (`extractRefs` copied; `body-refs.ts` already callback-box-owned); broken-ref
  detection behaves identically.
- **Two agents touching the same card** — **N/A.** No card-write path changes
  semantics; `card-io.ts` parse-mutate-reserialize is untouched.
- **Hand-edit drift** — **N/A.** Frontmatter/Markdoc parsing is unchanged.
- **Fabricated free-form value** — **N/A.** No new fields.
- **Validation error UX** — **ADDRESSED.** `card-io.ts:62` `formatZodIssues`
  (callback-box's own) is the agent-facing validator and is untouched; the
  copied `formatLintResults` is the `cb validate` CLI formatter and is copied
  verbatim. Both error surfaces read as they do today.
- **Partial migration / transition state** — **ADDRESSED.** The transition is
  compile-time, not data: until Track B repoints imports, both cardworks and
  `src/cards/` exist; the worktree never ships a half-state because the plan
  completes (cardworks gone, green) before merge. The *box-data* transition
  (XML cards still in unmigrated boxes) is the migrator dependency — see Open
  questions.

## NOT in scope

- **Re-implementing the XML loader/serializer/XPath in callback-box.** They
  have zero real consumers; deleting beats porting (CLAUDE.md "don't add
  features beyond what the task requires").
- **Migrating the boxes themselves.** The user's separate task — and broader
  than just data: it now also includes **migrating any box-local `element()`
  schema to `cardSchema`** (known case: `bill.ts` in `ledger-copy`/
  `ledger-shrink-test`, + 23 `.bill.card` files) since box-local XML support is
  being dropped. Not part of this plan's *code* work, but a **prerequisite for
  Track C** — the deletion can't land while any box still has an XML schema or
  XML cards. Most of Tracks A+B are independent of it — **except Track A chunk 2
  (box-local `element()` removal), which is gated on the box-schema audit** like
  Track C, since it breaks any box still defining an XML schema.
- **Reworking `card-lint.ts` / `body-refs.ts` Markdoc validation.** Already
  callback-box-owned and working; only its cardworks *imports* change.
- **A general "vendor any npm dep" mechanism.** We copy these specific files;
  no reusable vendoring infra.
- **Renaming `.card` semantics.** Unchanged. (Note: `SchemaRegistry` is
  *adapted*, not copied as-is — see Track B; its `.tagName` keying becomes
  `.type` or is dropped if unused.)

## Open design questions

1. ~~**Migrator dependency on the XML parser.**~~ **Resolved:
   box-migration-first.** Run the migrators against every box, then (Track C)
   neutralize the spent migrators — **stub each cardworks-importing
   `scripts/migrate/*.ts` to an obsolete no-op but keep its `MIGRATIONS` entry**
   (the entry is an append-only manifest key, `migrations.ts:6`; deleting it
   would corrupt a box's applied-set). Box migration (which now includes
   converting box-local XML schemas) is a prerequisite for Track C *and* for
   Track A chunk 2 (box-local `element()` removal); the rest of A+B is
   box-independent.
4. ~~**`card.patch` and `todos.updateItem`.**~~ **Investigated — they differ:**
   - **`card.patch` — delete.** No frontend caller (no `trpc` call, no raw
     `fetch` to the `/api/card/*` PATCH route). Genuinely unused; remove the
     PATCH handler + its XML serialization (`api-card-patch.ts`, `card.ts:271`),
     **and the REST route + its doctest** (`api-card-routes.ts:71-120`,
     `test/routes-api.doctest.md:112-128`) — Codex round 2.
   - **`todos` — rewrite BOTH sides to frontmatter (do NOT delete).** The whole
     todo-list UI is XML-based and **already broken** on frontmatter cards (a
     latent bug the todo-list migration left behind): the renderer
     `TodoListView` parses XML `<item>` elements (`TodoListView.tsx:31`) but
     frontmatter card responses set `element: undefined` (`card.ts:152`), so it
     shows "No todo list data"; and the `todos.updateItem` mutation uses the XML
     `CardLoader` (`todos.ts:21`/`:30`/`:58`) while the schema is frontmatter
     `items:` (`schemas/todo-list.ts:36`/`:41`). Fix: **frontend** reads
     `data.frontmatter.items`; **backend** parses via `card-io`, mutates
     `fields.items`, writes via `serializeCardText`. Removes the last
     `CardLoader`/`ElementNode` use in the webapp *and* fixes a live bug.
2. **Home for the copied primitives.** `src/cards/` (proposed) vs
   `src/lib/cards/` vs `src/core/cards/`. Lean: `src/cards/` — top-level,
   sibling to `src/schemas/`, reads as "the card primitive layer." Minor;
   settle at first chunk.
3. **`cli/lib/loader.ts` — rewrite vs delete.** Several routers call
   `createLoader`. If their only use is listing + frontmatter loading, the
   factory becomes a thin glob-lister; if any genuinely needs cardworks'
   ref-traversal `move()`, that caller needs a frontmatter rewrite first.
   Lean: rewrite to a glob-lister + `card-io` loader; verify no caller needs
   XML `move()` (the suite + typecheck will confirm).

## Knowledge audits

Skip-with-rationale: this plan introduces no agent-facing concept — it is an
internal package deletion. The one agent-facing fact (*cards are never XML;
the filename is the type discriminator; no `type:` field*) already landed with
the schema migrations and is in `CLAUDE.md:28`/`CLAUDE.md:39`. No new audit;
the existing "cards are frontmatter" understanding is unchanged.

## Implementation order

1. **Track A, chunk 1** — delete the self-contained dead paths (`card-io.ts`
   XML branch, `search/extract.ts` `xmlDoc`, `ls.ts` `--format` in *both*
   wrapper + core). Green.
2. **Track A, chunk 2 — drop box-local XML support (GATED on the box-schema
   audit; breaks any box still on `element()`).** Remove the `elementSchemas`
   half of `loadBoxSchemas` + `isElementSchema`, `createSchemaRegistry`/the XML
   side of `getAllSchemas`/`getSearchableTypes` (`src/schemas/registry.ts`),
   `load-context.ts`'s `elementSchemas`, the XML branch of `agent-guide/cards.ts`
   and `generate-docs.ts:420`, the `element()` scaffolding in `box-templates.ts`,
   and the `box-schemas.doctest.md` gadget case; collapse `LoadedCard` to
   frontmatter-only. (Decision settled in the header; ships with Track C's gate.)
3. **Track A, chunk 3** — delete the remaining dead paths (`transcribe.ts` XML
   helpers, `procedure-trampoline.ts`, `card-lint.ts` fallback), resolve the
   `card.patch`/`todos.updateItem` endpoints (Open question 4), and rewrite the
   live `CardLoader` users (`cli/lib/loader.ts`, `move-operations.ts`, routers).
4. **Track B** — create `src/cards/` (frontmatter.ts + schema.ts first, then
   the *adapted* registry/lint-format/errors), repoint all keep-set imports.
   Completeness gate: `grep -rl cardworks callback-box/{src,scripts,test}` empty
   AND typecheck/lint/test green.
5. **[Out of band] Migrate every box** off XML — both data *and* any box-local
   `element()` schema → `cardSchema` (the `bill` schema is the known case). The
   user's separate effort; can overlap Tracks A+B.
6. **Track C** — once the box-schema audit is clean, delete cardworks + symlink
   + dep + workspace entry, **stub the spent migrators (keeping `MIGRATIONS`
   entries)**, `pnpm install`, **rebuild/validate `dist`**, update docs. Final
   gate clean.

Dependencies: Track C is gated on A+B (no cardworks imports in src/scripts/test)
*and* on box migration + box-schema audit being complete. Track B's repoint is
what makes the deleted XML symbols disappear, so Track A's compile-time
verification happens as B lands. Tracks A+B do not
depend on box state and can land while boxes are migrated.

## Rollout shape

- **Test posture.** No new behavior, so no new tests are the goal — the
  existing suite (2173) plus `pnpm typecheck` is the regression gate, and it is
  load-bearing here (the typecheck *is* the completeness proof). One small
  exception: if `ls --format` is reduced to frontmatter-field lookup (Critical
  gap resolution), add one doctest for it, mirroring the landmark
  `lookupField` doctest.
- **Knowledge-audit entries.** None (see Knowledge audits).
- **Migration approach.** No box-data migration in this plan. The only "data"
  concern is the migrators' XML-read dependency (Open question 1); whichever
  option is chosen, it lands inside this plan (vendored snapshot or
  box-first), not deferred midway.
- **Ship as one unit.** Merge only when cardworks is gone and
  `typecheck`/`lint`/`test` are clean — never a state where `src/cards/` and
  cardworks both supply the same primitive in shipped code.
