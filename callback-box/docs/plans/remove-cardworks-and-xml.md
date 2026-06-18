# Remove cardworks and all XML from callback-box

This plan retires the XML card format and the `cardworks` package. It
migrates the five remaining XML-bodied schemas to YAML-frontmatter +
Markdoc body tags (a per-schema mix), removes the dual-format loader and
every XML-only code path, absorbs the small set of frontmatter
primitives callback-box still imports from cardworks into callback-box
itself, and deletes the `cardworks` package, its symlink, and the
`workspace:*` dependency.

After this plan, a `.card` file is exactly one thing: YAML frontmatter
optionally followed by a markdown body that may carry Markdoc tags.
There is no second format, no `content-type: application/x-card+xml`,
no element tree, no XPath.

> **Status update.** **All six schemas are migrated off XML.** Round 1:
> landmark, recipe, guide, procedure, procedure-run — all **pure YAML**
> (key finding that overrode the plan: their parsers already produce flat
> structured data, so none needed Markdoc). Round 2: **capture-session**
> — the one schema that genuinely needed Markdoc (its transcript is
> ordered mixed content), now frontmatter + a markdown body with
> `{% image %}` / `{% silence %}` tags. Each schema has a registered
> migrator and a per-schema commit; the full suite stays green (2173).
> `schemas[]` (the XML `ElementSchema` list) is now empty.
>
> **Remaining (its own round): delete cardworks.** With no XML schema
> left, the dormant dual-format loader branch, `element()`, `serialize`,
> the XML parser, JSX runtime, and `evaluateXPathString` have no users.
> That round removes them, absorbs the frontmatter primitives
> (`cardSchema`, `body`, `splitCardContent`, `extractRefs`) into
> callback-box, and drops the package + symlink + `workspace:*` dep.

This is plan-only. Nothing here is executed until the plan is approved
and then run end-to-end on this worktree branch.

---

## Stated preferences this plan trades against

The docs this plan must be evaluated against:

- **`callback-box/CLAUDE.md`** — the cards format contract and the
  loader contract. `callback-box/CLAUDE.md:28`: *"a handful of schemas
  with inline-attributed structure (guide, recipe, procedure,
  procedure-run, capture-session, landmark) remain on the older XML
  body until cardworks grows Markdoc-style body tags."* This plan is
  the thing that lets that sentence be deleted.
  `callback-box/CLAUDE.md:101`: *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* — every migrator in this
  plan reads the real card before rewriting it.
- **`callback-box/CODE-STYLE.md`** — `CODE-STYLE.md:25`: *"NEVER use
  `any` type"*; `CODE-STYLE.md:36`: *"No default parameters"*;
  `CODE-STYLE.md:37`: *"Max 2 positional parameters."* The new parsing
  helpers (frontmatter + Markdoc body) follow these.
- **The shipped Markdoc precedent.** `{% source %}` (committed
  `63141dce`) and `{% quote %}` are the densest preference for how a
  new tag is shaped — schema in `src/shared/markdoc-config.ts`, a
  renderer in the frontend, ref-attributes tracked by `extractBodyRefs`.
  Every new tag in this plan copies that shape.
- **CLAUDE.md "don't add features beyond what the task requires."** This
  plan deletes far more than it adds; the one temptation to resist is
  building a general XML→Markdoc converter when five hand-written
  migrators are what the task needs.

Every design choice below traces to one of these.

---

## What already exists

The migration is roughly 80% done already; this plan finishes the last
five schemas and removes the scaffolding. Concretely:

- **The two-format loader.** `src/core/card-io.ts:285`: *"export type
  LoadedCard = FrontmatterLoadedCard | XmlLoadedCard"* with
  `loadCardFile` (`card-io.ts:318`) dispatching to `loadXmlCard`
  (`card-io.ts:370`) when the body is XML. **Reuse then delete:** the
  frontmatter path stays and becomes the only path; the XML branch and
  the `XmlLoadedCard` arm of the union are removed.
- **The schema registry split.** `src/schemas/registry.ts:53`:
  *"export const schemas: ElementSchema[] = [ ProcedureSchema,
  ProcedureRunSchema, CaptureSessionSchema, GuideSchema, LandmarkSchema
  ]"* — **exactly five** XML schemas remain.
  `src/schemas/registry.ts:66`: *"export const cardSchemas: CardSchema[]
  = [ RecipeSchema, … ]"* already holds 28 frontmatter schemas,
  **including `RecipeSchema`.** **Reuse:** as each schema migrates it
  moves from `schemas[]` to `cardSchemas[]`; when `schemas[]` is empty
  the `ElementSchema` machinery is deleted.
- **Recipe is already a frontmatter schema.** `src/schemas/recipe.tsx:2`:
  *"Recipe card schema — Phase-2 frontmatter + Markdoc-annotated body."*
  The recipe Markdoc vocabulary already exists:
  `src/shared/markdoc-config.ts:379-384` registers `ingredient`, `step`,
  `yield`, `substitution`, `subrecipe`, `recipe-section`. **Reuse:**
  recipe needs only a data migration of the 2 remaining XML
  `.recipe.card` files (`~/src/boxes/test1/store/recipes/*.recipe.card`
  are still `x-card+xml`), not a schema rewrite. Recipe is the proof the
  pattern works, not a track of its own.
- **The Markdoc backend + frontend pipeline.** `@markdoc/markdoc` is a
  dependency. Backend: `src/shared/markdoc-config.ts` (tag schemas),
  `src/core/markdoc-emit*.ts` (renderable-tree → markdown emitter),
  `src/core/body-refs.ts` (`extractBodyRefs`). Frontend:
  `src/frontend/src/components/Markdown.tsx`, `Source.tsx`,
  `RecipeTags.tsx`. **Reuse:** every new tag plugs into this pipeline;
  no new infrastructure.
- **The four-track Markdoc design doc.**
  `docs/implemented-plans/markdoc-tags-design.md`. Track 4 (ref tracking
  in body tags) committed `39680dc1`; Track 3 (`{% source %}`) committed
  `63141dce` (`markdoc-tags-design.md:473-478`). Track 2 (briefing) and
  Track 1 (recipe) marked **pending** (`markdoc-tags-design.md:488-489`).
  **Reuse:** the per-tag convention discovered there
  (`markdoc-tags-design.md:35` — any tag with a `ref` attr renames it
  before React render) is a hard constraint this plan inherits.
- **The migrator harness.** `scripts/migrate/*.ts` per schema, plus
  `scripts/migrate/_warnings.ts` (`callback-box/CLAUDE.md:52`) which
  declares known attrs/children per element and surfaces anything
  outside the allow-list — it *"Surfaced real data loss during the
  production migration"* (`docs/cards-as-markdown.md`). **Reuse:** the
  five new migrators follow this exact pattern, including warnings mode.
- **The XPath dependency.** Only two call sites:
  `src/core/landmark/resolve.ts:167` (expand-template placeholders) and
  `src/core/commands/ls.ts:74` (fragment selectors). Both via cardworks'
  `evaluateXPathString`. **Rebuild/remove** — see the Landmark track and
  the XPath subplan.
- **cardworks decomposition.** Of ~4,940 LOC, ~2,716 are XML-only
  (parser, serialize, xpath, jsx, `element`/`ElementNodeSchema`, XML
  lint) and get deleted; ~411 LOC are frontmatter-core (`cardSchema`,
  `body`, `splitCardContent`, `extractRefs` in
  `cardworks/src/schema/card-schema.ts` and
  `cardworks/src/parser/frontmatter.ts`) and get absorbed; ~1,812 LOC
  (refs, fs, loader, lint-format) is a decision covered in the
  Absorption track.

---

## Prior art (external)

- **Markdoc structured-data extraction is a first-class supported
  pattern.** A custom tag's `transform` exposes `node.transformAttributes`
  and `node.transformChildren`, and recursively walking the renderable
  tree to collect matching nodes (the canonical example is building a
  table of contents) is the documented idiom — exactly the shape
  guide/procedure/landmark parsers need to extract typed data from body
  tags. <https://markdoc.dev/docs/nodes>,
  <https://markdoc.dev/docs/attributes>. This confirms we do **not**
  need cardworks' XML tree to extract structured data; Markdoc's own AST
  is sufficient.
- **Custom attribute validation lives in the tag schema.** Markdoc lets
  a tag declare typed/`matches`-constrained attributes validated during
  transform (<https://markdoc.dev/docs/tags>), so per-tag validation
  (e.g. `confidence` ∈ enum on `{% rule %}`) is expressible without Zod
  on the body — though we will likely still post-validate extracted
  objects with Zod for parity with frontmatter validation.
- **`Markdoc.format()` round-trip safety — internal prior art is
  stronger than the web.** A general web search for `Markdoc.format()`
  data loss returned no specific issue tracker results; the
  authoritative source is this repo's own
  `docs/implemented-plans/markdoc-format-investigation.md:5`: *"safe for
  our actual use cases — namely move-time"* with the mitigation at
  `markdoc-format-investigation.md:142`: *"on rewrite, only write …"*
  and the pre-migration grep advice at
  `markdoc-format-investigation.md:158`. **Consequence for this plan:**
  migrators must *emit* canonical Markdoc (tool-generated, never
  round-trip hand-edited input through `format()`), and any later
  body-rewrite stays substring-based like `move.ts`
  (`markdoc-tags-design.md:421`).
- **No external prior art for the XPath-in-templates feature.** The
  `${title}` / `${path}` expand-template placeholder is a callback-box
  invention; there is no library pattern to adopt. The replacement is
  designed from scratch in the XPath subplan. (Search for general
  "markdown frontmatter templating cross-document field reference"
  surfaced static-site-generator collection APIs, none transferable.)

---

## Tracks / scope

Ordered by implementation dependency, then surface size. Track 0
unblocks everything; the schema tracks run easy→hard; the teardown
tracks run last because they can't start until `schemas[]` is empty.

### Track 0 — Migrator + parse-helper foundation

**What.** Establish the two reusable helpers every schema migration
needs: (a) a frontmatter+body Markdoc *parser* in callback-box that
extracts typed objects from body tags (wrapping `Markdoc.parse` +
renderable-tree walk), and (b) confirm the `_warnings.ts` migrator
harness covers element→tag conversion. Finish recipe as the worked
example: migrate the 2 XML `.recipe.card` files and verify Track 1's
recipe tags render.

**Why this needs to change.** Five migrators and five parser rewrites
will each need "parse a card's body into structured data." Building that
once, proven on recipe (whose schema and tags already exist), de-risks
the four hard schemas.

**Direction.** A `src/core/card-body.ts` module exposing
`parseBodyTags(body: string, tagNames: string[]): ParsedTag[]` built on
`Markdoc.parse` and a renderable-tree walk (per
<https://markdoc.dev/docs/nodes>). Recipe data migration is a
`scripts/migrate/recipe.ts` that reads the old `<recipe>` XML (still
parseable while cardworks exists) and emits frontmatter + `{% ingredient %}`
/`{% step %}` body.

**Vocabulary lock-ins.** None new — recipe tags are already locked at
`src/shared/markdoc-config.ts:379-384`.

**First implementation chunk.** Write `src/core/card-body.ts`
`parseBodyTags` + a doctest; migrate the 2 test1 recipe cards; confirm
`RecipeView` renders them. No open questions inside this chunk.

### Track 1 — Guide

**What.** Migrate `guide` to frontmatter (actions, experiments, context,
reactions as YAML arrays) + a markdown body whose triage rules are
`{% rule %}` tags carrying per-statement `confidence`/`source`/`ref`/
`action`, and experiment observations are `{% observation %}` tags.

**Why this needs to change.** `guide` is the schema whose consumers are
best insulated: parsing already funnels through
`parseGuide() → ParsedGuide → compileGuide()`, so swapping the parser's
input (XML tree → frontmatter + body tags) leaves `compileGuide` and all
downstream agent-guide generation untouched.

**Direction.** Frontmatter holds `job-types`, `applies-to`, `actions[]`,
`experiments[]` (id/status/dates/hypothesis/approach), `context[]`,
`reactions[]`. Body holds `{% rule confidence= source= ref= action= %}…{% /rule %}`,
`{% default-action action= %}…{% /default-action %}`, and per-experiment
`{% observation ref= date= %}…{% /observation %}`. `parseGuide` is
rewritten to read frontmatter via Zod and body via `parseBodyTags`,
returning the **same `ParsedGuide` interface**.

**Vocabulary lock-ins.** `{% rule %}` attrs: `confidence` (enum:
confirmed|high|medium|low|hypothesis), `source` (enum:
user-stated|feedback|inferred|default), `ref` (optional), `action`
(optional). `{% default-action %}` attr: `action`. `{% observation %}`
attrs: `ref` (optional), `date` (optional). These names are repo-wide
and must not collide with existing tags.

**First implementation chunk.** Add the three tag schemas to
`markdoc-config.ts` + frontend renderers; rewrite `parseGuide` to
produce `ParsedGuide` from frontmatter+body; one doctest asserting
`compileGuide` output is byte-identical to the XML-era output for a
fixture guide.

### Track 2 — Procedure-run

**What.** Migrate `procedure-run` to **pure YAML frontmatter** (no body);
move unbounded `<stdout>` content out of the card into sibling
`.attach/*.txt` files referenced by path.

**Why this needs to change.** Run cards are execution records, not
prose; they have no inline-attribution problem. The only reason they're
XML is they were authored alongside `procedure`. Frontmatter is the
natural fit, and moving large stdout to attachments keeps the card and
its git diffs small.

**Direction.** Frontmatter: `procedure`, `status`, `started-at`,
`completed-at`, `expires`, `directive`, and `steps[]` where each step is
`{id, status, started-at, completed-at, precheck?, run?, validate?}` and
each phase result is `{status?, session-id?, git-ref?, review?,
stdout-file?}`. `engine-run-card.ts` is rewritten from
`createElement`/`serialize` to YAML parse-mutate-stringify (the existing
frontmatter mutation idiom, `callback-box/CLAUDE.md:41`). `gc.ts` reads
the same fields from frontmatter instead of element attrs.

**Vocabulary lock-ins.** None (no body tags).

**First implementation chunk.** Rewrite `buildInitialRunCard` +
`updateStepInRunCard` + `updateRunCardStatus` against the YAML shape;
`gc.ts` field reads; doctest a full run lifecycle (create → update step
→ complete). Stdout-file handling is in-chunk (write to `.attach/`,
reference by relative path).

### Track 3 — Procedure

**What.** Migrate `procedure` definitions to frontmatter (`name`,
`run-expiry`, `failed-run-expiry`) + a markdown body of `{% step %}`
tags containing `{% precheck %}`/`{% run %}`/`{% validate %}` phase tags,
each holding `{% shell %}`/`{% agent %}`/`{% instruction %}`/`{% why %}`
in any order.

**Why this needs to change.** The phase containers are *intentionally
loose* — any count and order of children. Flat YAML forces a discriminated
array (`- type: shell`), which the RFC rejected as ugly. Markdoc body
tags preserve the write-in-any-order ergonomics for agents authoring
procedures.

**Direction.** `engine-parse.ts` rewritten to read frontmatter + walk
body tags via `parseBodyTags`, producing the existing `ParsedProcedure`
/`ParsedStep` structures (consumer-insulating, same as guide).
`getStepLineRange()` (currently regex over `<step id=>`) is reworked to
locate `{% step id= %}` — or, better, dropped in favor of the Markdoc
AST node's source location if available. `dedent()` stays (body tags
still carry indented shell/prompt text).

**Vocabulary lock-ins.** Tags: `step` (attr `id`), `precheck` (attr
`pass-output`), `run`, `validate` (attr `severity`: warn|review|abort),
`shell`, `agent` (attrs `model`, `max-turns`), `instruction`, `why`.
**Note collision risk:** `step` is already a recipe tag
(`markdoc-config.ts`). Per `markdoc-tags-design.md` "no tag may exist
with two different shapes," this must be resolved — see Open Questions.

**First implementation chunk.** Add the procedure tag schemas (resolving
the `step` collision); rewrite `engine-parse.ts`; doctest parsing a
fixture procedure to the same `ParsedProcedure` the XML parser produced.

### Track 4 — Landmark (all-YAML; depends on XPath subplan)

**What.** Migrate `landmark` to **pure YAML frontmatter, no body.**
Navigation (label, symbol, links, expand, chat-app) and destinations
(`for` kinds, rules, procedure-ref) all become structured frontmatter.
Replace the XPath expand-template mechanism per the XPath subplan.

**Why all-YAML (revised).** Landmark has **no prose body** — it is
entirely structured navigation/filing metadata. The two things that
looked like they needed body tags don't:
- **Inline procedures are dead.** No box landmark uses a `<procedure>`
  with children (verified: zero matches across `~/src/boxes`), and
  `src/core/handle.ts:10`: *"Inline procedures aren't supported yet —
  only `<procedure ref=…/>`."* So `TriageProcedure`'s
  `children: z.array(z.unknown())` (`landmark.ts:151`) is an unused
  affordance — drop it; `procedure-ref` is the only real form.
- **`ref` vs `template-ref`** is a discriminated YAML shape, not a prose
  problem: literal links carry `ref` (validated), expand templates carry
  `template-ref`/`template-label` placeholder strings (not validated).
- **`${expr}` placeholders** are plain string values in YAML; they're
  substituted at render time by the XPath-replacement evaluator (subplan).

This is strictly simpler than the body-tag approach — no new Markdoc
vocabulary for landmark at all.

**Direction.** Frontmatter:
```yaml
navigation:
  label: string
  symbol: string | { src: string }      # text/emoji XOR image
  links: [{ ref: string, label?: string }]
  expand: [{ query: string, order?: enum, template-ref?: string, template-label?: string }]
  chat-app?: { narration?: on|off, prose?: on|off }
destinations: [{ for: string[], rules?: string, procedure-ref?: string }]
```
`resolve.ts`, `features.ts`, `destination.ts`, `list-destinations.ts`,
`triage-instructions.ts`, `landmarkLoader`, `createLandmarkTemplate`,
`renderLandmarkLink` (all in/around `src/schemas/landmark.ts` and
`src/core/landmark/`) rewritten to read the frontmatter object instead of
walking the element tree.

**Vocabulary lock-ins.** None — no body tags. Field names: `navigation`,
`destinations`, `links`, `expand`, `template-ref`, `template-label`,
`procedure-ref`, `chat-app`. `symbol` is a `z.union([z.string(),
z.object({ src })])`.

**First implementation chunk.** *(The non-template parts need no subplan;
only `expand` template resolution is gated on it.)* Rewrite
`src/schemas/landmark.ts` to `cardSchema`; move it `schemas[]`→
`cardSchemas[]`; rewrite literal-link + destination consumers; doctest
navigation resolution for a fixture landmark. `expand` template
resolution lands once the XPath subplan settles.

### Track 5 — Capture-session (hardest)

**What.** Migrate `capture-session` to frontmatter (status, session-id,
image/audio/file refs) + a markdown body whose **transcript** is prose
interleaved with `{% image-ref %}` and `{% silence %}` block tags in
chronological order.

**Why this needs to change.** The `<transcript>` is ordered mixed content
— the load-bearing thing flat YAML destroys. Markdoc body preserves the
chronology as readable text with structured markers, and the
timeline-assembly code can emit/parse the tags.

**Direction.** Frontmatter: `status`, `session-id`, `created`,
`images[]`, `audio-clips[]`, `files[]`. Body: transcript text
interleaved with `{% image-ref ref= description= filename= /%}` and
`{% silence duration= /%}` (both self-closing). `assemble-timeline-
helpers.ts` rewritten to emit body-tag strings instead of `ElementNode`s;
`search/extract.ts` `xmlDoc()`/`collectElementText()` path replaced by
extracting text from the Markdoc body; `preactions/transcribe.ts` XML
mutation path removed (frontmatter audio cards already handle their own
transcription).

**Vocabulary lock-ins.** `{% image-ref %}` attrs: `ref` (required),
`description`, `filename`. `{% silence %}` attr: `duration`.

**First implementation chunk.** Add the two tag schemas; rewrite
`assemble-timeline-helpers.ts` to emit body tags; doctest assembling a
fixture session (audio timing + images) into the expected body.

### Track 6 — Teardown: remove the XML loader + XML-only paths

**What.** Once `schemas[]` is empty: delete the `XmlLoadedCard` arm of
`card-io.ts`, the `loadXmlCard` branch, `CARD_XML_CONTENT_TYPE`, the
`ElementSchema` registry plumbing, the search `xmlDoc()` path, the
frontend `ElementNode`/`CardTreeView` rendering, and update the LLM
prompts that say *"Data is stored as XML card files"*
(`src/core/chat-session-prompts.ts`, `src/core/reactor/prompts.ts`).

**Why this needs to change.** These paths only exist to serve XML cards;
with no XML schema they're dead code that still costs maintenance and
confuses agents (the prompts actively misdescribe the format).

**Direction.** Mechanical deletion + prompt rewrite. The discriminated
union `LoadedCard` collapses to `FrontmatterLoadedCard`.

**First implementation chunk.** Delete `loadXmlCard` + union arm; fix the
type errors that cascade; rewrite the two system prompts.

### Track 7 — Absorb frontmatter primitives, delete cardworks

**What.** Move the ~411 LOC of frontmatter-core (`cardSchema`, `body`,
`splitCardContent`, `extractRefs`) from `cardworks/src/schema/` and
`cardworks/src/parser/frontmatter.ts` into callback-box (e.g.
`src/core/card-schema.ts`). Decide the fate of the ~1,812 LOC shared
layer (refs/fs/loader/lint-format). Delete the `cardworks` package, the
`node_modules/cardworks` symlink, the `workspace:*` dependency, and the
pnpm-workspace entry. Update `callback-box/CLAUDE.md`, root `CLAUDE.md`,
`docs/cards-as-markdown.md`, `docs/adding-schemas.md`.

**Why this needs to change.** The whole point — no cardworks.

**Direction.** Absorb frontmatter-core verbatim (it's already YAML-free).
For the shared layer, the lean answer is: callback-box already has its
own body-ref extraction (`body-refs.ts`) and Markdoc lint
(`card-lint.ts`); keep only the ref *resolution* + path utils + fs
abstraction it genuinely uses, inline them, and delete the rest with the
XML bulk.

**First implementation chunk.** Inline `cardSchema`/`body`/
`splitCardContent`/`extractRefs` into callback-box and repoint the ~28
schema imports + `card-io.ts`; verify build green with cardworks still
present-but-unused; *then* delete cardworks in a follow-up commit.

---

## Subplans

### ~~XPath replacement subplan~~ — DISSOLVED (no subplan needed)

The XPath replacement turned out to need no design. A scoped audit of
every real `.landmark.card` across all of `~/src/boxes` found the
**only** placeholder in use is `${path}` (5 occurrences, all the default
`<link template-ref="${path}"/>`); zero use of `${title}` or any XPath
expression. And `${path}` is already special-cased before XPath
(`landmark/resolve.ts`: *"if (expr === "path") return vars.matchRel"*),
so `evaluateXPathString` is never exercised by any card in practice. The
second site, `cb ls --format` (`ls.ts:74`), is an ad-hoc CLI affordance
invoked from no box config.

**Decision (no query language).** Replace `evaluateXPathString` with a
~10-line dotted-path frontmatter accessor:
`${field}` → `frontmatter.field`, `${a.b}` → nested walk, missing → `""`.
`${path}` keeps its special-case. No jq, no JSONPath — those are query
engines for a querying need that doesn't exist; the data is shallow YAML
frontmatter and the one expression in the wild isn't even a query. This
helper lives in callback-box (e.g. alongside the landmark resolver and
reused by `ls`); cardworks' XPath module
(`cardworks/src/refs/xpath.ts`, 334 LOC) is deleted with the XML bulk.

This collapses Track 4's only external dependency — landmark no longer
waits on anything. The `_warnings.ts` migrator should still flag any
landmark carrying a non-`${path}` template so a stray `${title}` in some
box surfaces rather than silently rendering `""`.

---

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Migrator drops an XML attr/child not in the allow-list (e.g. a box-local `<rule>` attr) | Yes — `_warnings.ts` harness | Yes — surfaced at run end | Clear (printed) |
| `parseBodyTags` silently ignores an unknown tag the agent wrote | No (new code) | Partial — `markdoc-emit-tags.ts` warns on unknown tags to stderr | Risk of silent for *parse* path |
| `{% step %}` name collision between recipe and procedure resolves to wrong schema | No | No (collision unresolved) | **Silent** until render mismatch |
| procedure-run stdout-file path points at a `.attach/` file deleted by gc | No | No | Silent (empty stdout shown) |
| XPath replacement returns empty for a `${expr}` it can't resolve | Partial (current code `catch → ""`) | Yes — `resolve.ts` returns `""` on failure today | Silent (matches current behavior) |
| capture-session transcript body tag order corrupted on agent re-edit | No | No | Silent (timeline wrong) |
| Frontmatter Zod validation rejects a migrated card (lossy migration) | Yes — `cb validate` on load | Yes — load fails loudly | Clear |
| After cardworks deletion, a stray box still has an XML card | No | No — loader no longer parses XML | **Clear-but-fatal** (load throws) |

**Critical gap: `{% step %}` tag collision** (Track 3 vs recipe). A
procedure body `{% step %}` and a recipe body `{% step %}` would share
one schema entry in `markdoc-config.ts`. `markdoc-tags-design.md` states
*"no tag may exist with two different shapes"*; recipe `step` takes no
attributes, procedure `step` needs `id`. If both register the same name
with different shapes, one silently wins. **Resolution required in the
plan** (see Open Questions) — e.g. namespacing procedure tags
(`{% proc-step %}`) or making the shared `step` accept an optional `id`.

**Critical gap: leftover XML cards after teardown.** A box not covered by
the migration run (boxes live outside this repo) could still hold XML
cards when cardworks is deleted, making them unloadable. **Mitigation in
the plan:** Track 6 adds a `cb validate --all-boxes`-style sweep (or a
documented pre-deletion grep for `x-card+xml`) as a gate before Track 7
deletes the XML parser. Documented risk if a box is offline during
rollout.

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **ADDRESSED.** The collision between
  recipe `{% step %}` and procedure `{% step %}` is exactly this; Open
  Questions resolves it. Other tags are schema-distinct.
- **Stale ref** — **ADDRESSED (existing).** `{% image-ref ref= %}`,
  `{% link ref= %}`, and procedure-run's `procedure:` ref all flow
  through the existing ref-resolution + `cb validate` broken-ref check
  (`card-lint.ts`); no new handling needed, behavior matches today.
- **Two agents touching the same card** — **DEFERRED.** Concurrent edits
  to a guide or procedure are no more dangerous than today's XML cards
  (last-write-wins, git catches conflicts). No new reconciliation; cited
  here as out of scope for a format migration.
- **Hand-edit drift** — **ADDRESSED (with caveat).** A boxholder writing
  `{%rule%}` (no spaces) or lowercase attrs hits the same Markdoc
  tolerance as `{% quote %}`/`{% source %}` today. The
  `markdoc-format-investigation.md` mitigation (migrators emit canonical
  form; never round-trip hand-edited input through `format()`) is the
  guard. Caveat: a *malformed* tag parses as prose and silently loses
  structure — same risk the shipped tags already carry.
- **Fabricated free-form value** — **ADDRESSED.** Migration is
  mechanical (XML→tag), so no agent invents values during migration. The
  `{% rule source= %}` enum makes provenance honest, not free-form.
- **Validation error UX** — **ADDRESSED (existing).** `card-io.ts`
  already renders Zod issues as one-line-per-issue (`card-io.ts` issue
  formatter); body-tag validation errors surface through the same
  `cb validate` path. No new UX.
- **Partial migration / transition state** — **ADDRESSED.** This is the
  whole reason for the dual-format loader: during the rollout window
  `card-io.ts` keeps loading both XML and frontmatter (it already does).
  Track 6 only removes the XML path *after* every schema is migrated and
  the leftover-card sweep is clean.

---

## NOT in scope

- **A general XML→Markdoc converter.** Five hand-written migrators are
  what the task needs; a general converter is more surface than the job
  requires (CLAUDE.md "don't add features beyond what the task
  requires").
- **chat-thread `.jsonl` reformatting.** `docs/cards-as-markdown.md`
  floats storing chat-thread as JSONL; that's an independent idea, not
  blocked by XML removal (chat-thread is already a frontmatter schema).
- **Changing the `{% quote %}`/`{% source %}` vocabulary.** Shipped and
  stable; this plan only *adds* tags.
- **Briefing Track 2.** Already its own pending track in
  `markdoc-tags-design.md`; briefing is already a frontmatter schema, so
  it is not part of XML removal.
- **Touching boxes' git history / migrating archived runs.** procedure-run
  cards under expired/gc'd run dirs are deleted by `gc.ts` anyway; we
  migrate live cards, not tombstones.
- **Replacing `yaml` or Zod.** The frontmatter stack stays exactly as is.

---

## Open design questions

1. **`{% step %}` collision (must-resolve, blocks Track 3).** Options:
   (a) namespace procedure tags `{% proc-step %}`/`{% proc-precheck %}`;
   (b) make a single `step` tag accept optional `id` and let context
   disambiguate; (c) keep them separate but assert at registration that
   shapes match. **Lean: (a) namespacing** — cleanest under the
   "no tag two shapes" rule, and procedure/recipe bodies never co-occur
   so readability doesn't suffer. Resolve before Track 3's first chunk.
2. ~~**XPath replacement.**~~ **Resolved** — cross-box audit shows only
   `${path}` is used; replace with a dotted-path frontmatter accessor,
   no query language. See the dissolved-subplan note above.
3. **cardworks shared-layer fate (Track 7).** Absorb the ref-resolution +
   fs + path utils, or rewrite leaner against frontmatter-only
   assumptions? Lean: absorb verbatim first (smallest diff), slim later
   if it proves heavier than needed. Not blocking — it's the last track.
4. **procedure-run stdout: attach-file vs inline-capped.** Move all
   stdout to `.attach/*.txt`, or keep short stdout inline and only spill
   large output? Lean: always-attach for uniform code; revisit if the
   `.attach/` file count becomes noisy.

---

## Knowledge audits

This plan introduces agent-facing vocabulary: `{% rule %}`,
`{% observation %}`, `{% default-action %}` (guide); procedure body tags;
`{% link %}`/`{% expand %}` (landmark); `{% image-ref %}`/`{% silence %}`
(capture-session). It also *removes* an agent-facing concept (XML cards)
— the system prompts currently teach agents the XML format
(`reactor/prompts.ts`).

**Default applies:** each new tag vocabulary gets at least one
`knows_directly` audit in `src/dev/knowledge-audits.yaml`, mirroring the
four `{% quote %}` audits that verified recall across compaction. At
minimum:

- One audit per migrated schema's primary tag (can the agent recall that
  guide triage rules use `{% rule confidence= source= %}`, not XML?).
- One **negative** audit: after Track 6, can the agent correctly state
  that cards are *never* XML (the prompt rewrite must stick)?

Audits land **run**, not just written:
`pnpm knowledge-audit run --box <abs-path-to-test-box> --filter <tag>`
with the status comment recorded before the plan completes. (Note:
`--box` must be an absolute path outside the monorepo — a box path inside
the repo trips the nested-box guard.)

---

## Implementation order

Chunks land in this order; each is one or a few commits on the worktree
branch. Dependencies noted. The plan ships as one unit when all land.

1. **Track 0** — `card-body.ts` parser + recipe data migration. (Unblocks
   all schema tracks.)
2. **Track 1 — guide.** (Independent; smallest consumer surface.)
3. **Track 2 — procedure-run.** (Independent; pure YAML.)
4. **Track 4 — landmark.** (All-YAML; now self-contained — the dotted-path
   accessor replaces XPath, and inline procedures are dead, so it no
   longer waits on Track 3.)
5. **Track 3 — procedure.** (Resolves `{% step %}` collision first.)
7. **Track 5 — capture-session.** (Hardest; independent of 1–4 but last
   by size/risk.)
8. **Track 6 — teardown of XML loader + paths + prompts.** (Requires
   `schemas[]` empty → all of 1–5 done; runs the leftover-XML sweep
   gate.)
9. **Track 7 — absorb primitives, delete cardworks, update docs.**
   (Requires Track 6.)

Each schema track internally orders: add tag schema(s) →
migrator(script) → parser/consumer rewrite → box data migration →
doctest. Migrate `~/src/boxes/test1` data per schema as its track lands
(test1 is the manual playground — warn before any wakeup-triggered run).

---

## Rollout shape

- **Test posture.** Dogfooding precedes tests. One doctest per
  substantial new codepath lands once the shape feels settled:
  `parseBodyTags`, each rewritten parser (`parseGuide`, `engine-parse`,
  landmark `resolve`, timeline assembly), and the procedure-run
  lifecycle. The migrators are exercised against real box data with
  `_warnings.ts` in noisy mode — a clean run is the migrator's test.
- **Migration approach.** Per-schema scripted migrators
  (`scripts/migrate/<schema>.ts`), atomic per card, idempotent, with
  field-loss warnings. Run against every box's live cards. **Data
  surface (across `~/src/boxes`):** procedure 103, procedure-run 132,
  capture-session 306, guide 68, landmark 95, recipe 2 — capture-session
  and procedure-run dominate, so their migrators get the most fixture
  coverage. Cards in gc-eligible run dirs are not migrated (they expire).
- **Knowledge-audit entries.** The per-tag `knows_directly` audits and
  the negative "cards are never XML" audit land **run** with their
  tracks, not deferred (per the Knowledge audits section).
- **Ship as one unit.** The plan does not merge to main until every
  track is complete and the leftover-XML sweep is clean across boxes.
  No partial ship — a half-migrated state ships nothing; it only lives
  on the worktree branch behind the still-present dual-format loader.

---

## Things checked and found clean

- **Recipe is not a remaining XML *schema*** — already in `cardSchemas[]`
  (`registry.ts:66`); only 2 data cards + Track 1 tag finish remain. The
  "6 schemas" framing collapses to **5 XML schemas + recipe data**.
- **Markdoc backend + frontend pipeline** already handles tag schemas,
  emission, ref-extraction, and rendering — no new infra needed, only
  new tag entries.
- **The dual-format loader** already implements the transition state, so
  no new coexistence mechanism is invented.
- **XPath blast radius** is exactly two call sites, not pervasive.
- **Migrator harness** (`_warnings.ts`) already exists and already caught
  real data loss in the prior migration wave.
