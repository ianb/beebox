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

- **The dead XML loader branch.** `callback-box/src/core/card-io.ts:285`:
  *"export type LoadedCard = FrontmatterLoadedCard | XmlLoadedCard"*;
  `card-io.ts:350` falls through to `loadXmlCard` (`card-io.ts:370`) only when
  the file has no frontmatter / unknown type. With `schemas[]` empty
  (`src/schemas/registry.ts`), the `elementSchemas` map is always empty and
  the XML branch is unreachable for any real card. **Rebuild:** collapse the
  union to `FrontmatterLoadedCard`, delete `loadXmlCard`/`XmlLoadedCard` and
  the `elementSchemas` plumbing.
- **The frontmatter primitives, in cardworks.** `cardSchema`/`body`/
  `extractRefs` (`cardworks/src/schema/card-schema.ts`, 249 LOC, imports
  `zod` only); `splitCardContent` (`cardworks/src/parser/frontmatter.ts`, 65
  LOC, zero imports); `SchemaRegistry` (`cardworks/src/schema/registry.ts`,
  63 LOC, generic `Map<string, ZodType>`); `formatLintResults` and the
  `LintSummary`/`LintResult`/`LintIssue` types (`cardworks/src/lint/format.ts`
  130 LOC + a handful of types from `lint/lint.ts`); `ParseError`
  (`cardworks/src/parser/parse.ts`, ~15 LOC of the file). **Reuse by
  copying:** these ~560 LOC have zero transitive XML dependencies (confirmed:
  `card-schema.ts` imports only zod; `frontmatter.ts` imports nothing).
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
  `reactor/procedure-trampoline.ts` XML `<procedure ref>` detection;
  `webapp/trpc/routers/todos.ts` (XML `loader.load`/mutate/`save`);
  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
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

**Compiler as the checklist.** After repointing the keep-set (Track B), the
deleted XML exports vanish; `pnpm typecheck` then enumerates every remaining
stale consumer. A site the agents flagged as a latent bug (e.g.
`chat.ts` reading a now-frontmatter landmark via `parseCard`,
`generate-docs-compile.ts:47` parsing a procedure via `parseCard`) surfaces
here and is fixed or deleted — none can be silently missed. (These pass tests
today only because no test exercises them; the typecheck is what closes the
gap.)

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
- `registry.ts` ← `cardworks/src/schema/registry.ts` (`SchemaRegistry`).
- `lint-format.ts` ← `cardworks/src/lint/format.ts` (`formatLintResults`,
  `formatLintResult`, `formatLintResultsJson`) plus the `LintSummary`/
  `LintResult`/`LintIssue`/`LintOptions` types extracted from
  `cardworks/src/lint/lint.ts`. The types reference a `Location` from the
  XML `provenance.ts`; redefine a minimal local `Location`
  (`{ source: string; line?: number; column?: number }`) — the formatter only
  reads `source`/`line`/`column`.
- `errors.ts` ← the `ParseError` class extracted from
  `cardworks/src/parser/parse.ts` (used by `search/refresh-file.ts:15`), with
  the same minimal local `Location`.

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
`pnpm-workspace.yaml:17`; run `pnpm install` to settle the lockfile; update
docs.

**Why this needs to change.** The point — no cardworks.

**Direction.** This track only runs once Tracks A+B make
`grep -rl 'from "cardworks"' callback-box/src` empty. The migrators
(`scripts/migrate/*.ts`) still import cardworks; their fate is the one open
question (below). Doc updates: `CLAUDE.md:87` (the cardworks bullet),
`CLAUDE.md:39`/`docs/adding-schemas.md` (drop "from cardworks" phrasing where
it now means "from `src/cards/`").

**First implementation chunk.** Resolve the migrator question (Open
questions), then delete the package + wiring + `pnpm install`, with a clean
`pnpm typecheck && pnpm lint && pnpm test`.

## Subplans

None. The one sub-question (migrator dependency on the XML parser) is small
enough to settle inline as an Open question with a lean, not a separate design
step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A stale consumer reads a frontmatter card via deleted `parseCard` | Partial | Yes — `tsc` fails to compile once the symbol is gone | Clear (compile error) |
| `cli/lib/loader.ts` rewrite changes card-listing semantics (misses a card / includes a non-card) | Yes — move/validate doctests | Yes — `isCardFile` filter | Clear (tests / validate output) |
| `ls --format` removed but a box config / agent still calls it | No | No | **Silent** (format arg ignored) |
| Copied `extractRefs` drifts from cardworks' (behavior change in ref-checking) | Yes — `cb validate` ref doctests | Yes — copy is verbatim | Clear |
| Local minimal `Location` loses a field the formatter reads | Yes — validate output doctests | Yes — formatter only reads source/line/column | Clear (format looks wrong) |
| Migrator run after cardworks deletion (XML parser gone) | No | No — import fails | Clear-but-fatal (script won't load) |
| Lockfile/`pnpm install` leaves a dangling `cardworks` reference | No | Partial — install errors on missing workspace pkg | Clear (install fails) |

**Critical gap: `ls --format` silent removal.** `commands/ls.ts:74`'s
XPath `--format` is the one user-facing feature being dropped. If an agent or
box command still passes `--format`, today it would XPath-extract (broken on
frontmatter anyway); after removal the arg is ignored silently. **Resolution
in the plan:** either reduce `--format` to a dotted-path frontmatter accessor
(reusing the landmark resolver's `lookupField`), or remove the arg from the
command registration so an unknown-arg error fires. Lean: reduce to
frontmatter-field lookup — small, and keeps `cb ls --format '{title}'` working.

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
- **Migrating the boxes themselves.** That is the user's separate task
  ("I'll set you on migrating the individual boxes"); this plan only removes
  the package. The migrator/box sequencing is surfaced as an Open question.
- **Reworking `card-lint.ts` / `body-refs.ts` Markdoc validation.** Already
  callback-box-owned and working; only its cardworks *imports* change.
- **A general "vendor any npm dep" mechanism.** We copy these specific files;
  no reusable vendoring infra.
- **Renaming `.card` semantics or the schema-registry API.** `SchemaRegistry`
  is copied as-is; callers unchanged.

## Open design questions

1. **Migrator dependency on the XML parser (the sequencing crux).** The
   migrators (`scripts/migrate/*.ts`) need cardworks' `parseCard`/
   `splitCardContent` to read pre-migration XML box cards, and boxes aren't
   migrated yet. Options: (a) **vendor a minimal XML reader** into
   `scripts/migrate/` (snapshot `parse.ts`+`dom-to-object.ts`+`provenance.ts`,
   ~850 LOC, scripts-only so outside `pnpm lint`) so migrators stay runnable
   after deletion; (b) **box-migration-first** — run all migrators against
   every box, then delete cardworks *and* the now-spent XML migrators together;
   (c) leave migrators importing cardworks and **defer cardworks deletion**
   until boxes are done. **Lean: (a)** — it decouples package deletion from
   box-migration scheduling and keeps the migrators self-contained historically,
   at the cost of a one-time ~850-LOC scripts-only snapshot. Confirm with the
   user, since it trades a vendored XML blob against deletion timing.
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
   XML branch, `search/extract.ts` `xmlDoc`, `ls.ts` `--format`). Green.
2. **Track A, chunk 2** — delete the remaining dead paths (`transcribe.ts`
   XML helpers, `procedure-trampoline.ts`, `todos.ts`, `card-lint.ts`
   fallback) and the type-only `ElementNode`/`ElementSchema`/`Card` carriers.
3. **Track A, chunk 3** — rewrite the live `CardLoader` users
   (`cli/lib/loader.ts`, `move-operations.ts`, routers). After this,
   callback-box imports only the keep-set from cardworks.
4. **Track B** — create `src/cards/` (frontmatter.ts + schema.ts first, then
   registry/lint-format/errors), repoint all keep-set imports. Now
   `grep -rl 'from "cardworks"' callback-box/src` is empty.
5. **Resolve Open question 1** (migrators), then **Track C** — delete
   cardworks + symlink + dep + workspace entry, `pnpm install`, update docs.
   Final `pnpm typecheck && pnpm lint && pnpm test` clean.

Dependencies: Track C is gated on A+B (no cardworks imports) and on the
migrator decision. Track B's repoint is what makes the deleted XML symbols
disappear, so Track A's "compiler as checklist" verification happens as B
lands.

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
