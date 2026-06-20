# Remove cardworks — final deletion phase

The execution plan for the last phase of `remove-cardworks-package.md`: sever
the remaining XML code paths in callback-box, replace the one piece of loader
functionality that is genuinely still used (broken-ref checking), drop
box-local XML schema support, and delete the `cardworks` package, its
`node_modules` symlink, the `workspace:*` dependency, and the
`pnpm-workspace.yaml` entry.

This plan supersedes the parent's gating: **all box data and box-local schemas
are already migrated to frontmatter** (the user's separate effort, now complete
on every server box and every local dev box — 0 XML cards remain anywhere), so
the parent's "gated on box migration" tracks (chunk 2, Track C) are now
ungated. Tracks A-chunk-1, B (the `src/cards/` absorption), the `todos`
rewrite, `card.patch` removal, and `ls --format` are already shipped (parent
tasks #7–#10). What remains is the residual XML severance + the package
deletion, with three file-level findings the parent plan did not have.

Plan-only; nothing executes until approved. Runs on this worktree branch; ships
(merges to main) only when the user asks.

## New findings since the parent plan

Three facts from a fresh file-by-file investigation that the parent plan
states imprecisely or misses:

1. **The one genuinely-needed loader function is `resolveRef`.** Every other
   `CardLoader` use is dead XML. `card-lint.ts:118` calls
   `options.loader.resolveRef(ref, path)` to mark broken refs as **warnings**
   (not errors) during `cb validate` and the PostToolUse hook. This is the
   single load-bearing replacement in the whole deletion. `listCards()`
   (`validate.ts:242`, `move-operations.ts:105`/`:213`) is the only other live
   call and reduces to a `.card` glob.

2. **Two paths parse now-frontmatter cards with the XML parser — suspected
   already-broken.** `chat.ts:103` `loadLandmarkSummaries` reads
   `**/*.landmark.card` (frontmatter since migration) via `parseCard` (the XML
   parser), and `generate-docs-compile.ts:47` reads `*.procedure.card`
   (frontmatter) via `parseCard`. Both wrap the call in try/catch and
   `continue`/skip on failure, so they **silently degrade to empty** rather than
   error. These are latent bugs the migration left behind, not just dead code —
   removing cardworks forces a frontmatter rewrite that also fixes them.

3. **`src/cards/` is already self-contained and complete.** It imports only
   `zod`/`yaml` (no cardworks); the refs primitives (`parseRef`/`resolveRef`/
   `extractRefs` from cardworks `refs/`) are **not used anywhere in `src/`** —
   callback-box has its own `body-refs.ts` + `frontmatter-field.ts`. So Track B
   needs nothing further; the absorption is done.

## Cross-model review applied (Codex)

A Codex pass (different model family) read this plan against source and
falsified several claims; folded in throughout. The load-bearing ones:

- **`loader.move()` is NOT dead for box-local frontmatter schemas** —
  `isPhase2CardPath` (`move-phase2.ts:46`) tests `PHASE2_TYPES =
  new Set(cardSchemas.map(s => s.type))` built from the *built-in* registry
  (`move-phase2.ts:20`), never `createCardSchemaMap(boxRoot)`. A migrated
  `*.bill.card` (box-local) isn't in that set, so `cb mv` falls through to the
  XML `loader.load()`/`move()` (`move-operations.ts:169`/`:175`) and **fails on
  frontmatter today**. → New **Track C0** (the first gate): make move
  classification box-local-schema-aware before anything is deleted.
- **`scan-import` is a live registered command** (`scan-import.ts:297`), and
  its photo flow writes frontmatter image cards then `loader.load`/`loader.save`s
  them via `applyBundleAnalysisToCard` (`scan-import-cards.ts:71`/`:167`) — a
  live broken write-back, not a dead path. → rewrite-or-disable is a **deletion
  gate** (C3), not an Open-question follow-up.
- **The C2 ref-checker must preserve more than `#fragment`** — cardworks strips
  a version-like suffix (`foo.card@1.0.0`, `parse-ref.ts:47`), resolves box-root
  absolute refs as `projectRoot + parsed.path` (`resolve.ts:176`), resolves bare
  `attach` to the attach dir (`resolve.ts:183`), and ignores fragments for
  existence (`resolve.ts:103`). → C2 ports those semantics, not naive
  `fs.access`.
- **C1's build target was wrong** — `bin/cb` runs the esbuild bundle
  `dist/cli.mjs` (`bin/cb:25`), not `dist/cli/index.js`; `exports["./cards"]`
  points at TS source (`package.json:7`); `bin/cb:63` probes `cardworks/dist`
  for staleness. → C1 wires `dist/cards` into the real build and drops the
  cardworks staleness probe.
- **`/api/card/*` is registered + doctested**, not just frontend-unused
  (`api.ts:98`, `routes-api.doctest.md:72`). → C3 removes the route *and* the
  REST doctest, not just the handler.
- **`generate-docs-compile.ts` degrades to a `"(could not parse)"` placeholder,
  not empty** (`:56`); only `chat.ts:101` degrades to empty. → the C3 verify
  step checks the right symptom per file.
- **Residual importers the dead-path sweep missed** — `views.ts:107`/`:175`
  (XML `ViewCard` fallback), `init-rules.ts:95` (mixes `schemas` +
  `elementSchemas`), `generate-docs.ts:420`/`:432` (computes both schema sets,
  passes `allSchemas` to the agent guide), `agent-guide/cards.ts:6`
  (`ElementSchema`/`.tagName`). → added to C3/C4 scope.

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md:28`**: *"Every built-in schema is now frontmatter;
  the legacy XML-body format and its loader branch remain in place but dormant
  … until cardworks is removed in a follow-up."* This plan makes that promise
  good and updates the sentence.
- **`callback-box/CLAUDE.md` "don't add features beyond what the task
  requires"** — we delete the XML loader/serializer/XPath rather than port
  them; they have no consumer.
- **`callback-box/CODE-STYLE.md:25`** (no `any`), **`:55`** (`as` is like Rust
  `unsafe`; centralize at parse boundaries — relevant to the ref-resolver
  replacement and the `ElementNode` removals), files ≤300 lines.
- **The schema-migration precedent** (`remove-cardworks-and-xml.md`):
  compiler-driven refactoring — delete the exports, let `tsc` enumerate the
  stale consumers. The completeness gate here is `typecheck && lint && test`
  **plus** a `grep -rl cardworks` sweep across `src/scripts/test` and box
  `config/schemas/` (because tsconfig covers only `src/**/*`; parent Codex
  finding #2).

## What already exists

- **`src/cards/` — the absorbed frontmatter primitives, done.** `index.ts`
  re-exports `cardSchema`/`body`/`extractRefs`/`splitCardContent`/
  `formatLintResults`/`LintIssue`/`ParseError`; imports `zod`/`yaml` only.
  **Reuse as-is.** No further absorption.
- **`frontmatter-field.ts` — the frontmatter reader.** `loadCardFrontmatter`
  (`:35`) + `lookupField` (`:19`) already parse a card's YAML mapping and walk
  dotted paths. **Reuse** as the base for the ref-existence replacement.
- **`body-refs.ts` — Markdoc body-ref extraction**, callback-box-owned.
  **Reuse** — `card-lint.ts:114` already calls `extractBodyRefs` and only uses
  the loader to check whether each extracted ref *exists*.
- **cardworks `refs/resolve.ts:49` `resolveRef`** — the existing implementation:
  parse the ref → resolve the path relative to the referring card → `fs.exists`
  → `{ exists }` (`refs/types.ts:40`). This is the model for the replacement;
  ~40 LOC, no XML in the existence check itself. **Rebuild** in callback-box as
  a small frontmatter-aware helper (must handle the `attach/`-scope rule,
  CLAUDE.md "refs starting with `attach/` resolve into this scope").
- **`movePhase2CardFiles` + `rewrite-card-refs.ts`** — Phase-2 card moves +
  substring ref rewriting, already callback-box-owned. **Reuse** — but only
  reached for cards `isPhase2CardPath` recognizes, which today is **built-in
  types only** (`move-phase2.ts:20`/`:46`); box-local frontmatter cards
  (`bill`) currently miss it and fall to the XML `loader.move()`. C0 fixes that
  (shape-based classification) so `loader.move()` becomes the genuinely-dead
  twin it was claimed to be.
- **The 19 remaining cardworks importers in `src/`** — all XML-side:
  `parseCard`, `ElementNode`, `ElementSchema`, `element`, `CardLoader`/
  `ICardLoader`/`MemoryCardLoader`, `lintCard`, `SchemaRegistry`, `Card`.
  Dispositions in Track C3/C4 below.
- **Only callback-box consumes cardworks** — verified clean in
  `callback-clerk/`, `agent-doctest/`, `personal-vibe-check/` (parent plan,
  unchanged).

## Prior art (external)

Skip-with-rationale: a purely internal refactor — deleting a first-party
workspace package and replacing ~40 LOC of ref-resolution. No third-party
behavior is in question. The one in-repo technique is **compiler-driven
refactoring** (delete exports → `tsc` enumerates stale consumers), already
established by the six schema migrations. No external search warranted.

## Tracks / scope

Ordered by dependency. Two hard gates precede the severance: **C0** (box-local
card moves must stop falling through to the XML loader — a current bug) and
**C1 (#17)** (the public `callback-box/cards` specifier must resolve under the
bundled `cb`, or deletion breaks every box-local schema at runtime). Then C2
builds the one needed loader replacement, C3/C4 sever the dead XML, and C5
deletes the package.

### Track C0 — Make `cb mv` recognize box-local frontmatter schemas (current bug, first gate)

**What.** `cb mv` classifies a card as Phase-2 (frontmatter) via
`isPhase2CardPath` (`move-phase2.ts:46`), which tests the type against
`PHASE2_TYPES` — a set built from the **built-in** `cardSchemas`
(`move-phase2.ts:20/:22`). Box-local frontmatter types (the migrated `bill`
schema in the ledger boxes) are loaded at runtime via
`createCardSchemaMap(boxRoot)` and are absent from that set, so a `*.bill.card`
move returns `isPhase2CardPath === false` and falls through to the XML
`loader.load()`/`loader.move()` (`move-operations.ts:169`/`:175`).

**Why this needs to change.** The XML loader can't parse a frontmatter card, so
`cb mv` on a migrated box-local card **already fails today** — and once
cardworks is deleted there is no fallback at all. This is a data-integrity
gate: the deletion can't ship while box-local cards can't be moved.

**Direction.** Classify by **file shape**, not a static built-in type set:
a `.card` whose content `splitCardContent(...).hasFrontmatter` is Phase-2,
regardless of whether its type is built-in or box-local. (Equivalently, build
`PHASE2_TYPES` from `createCardSchemaMap(ctx.boxRoot)` at call time — but
file-shape is simpler and needs no schema map.) The move then uses
`movePhase2CardFiles` + `rewrite-card-refs.ts` uniformly; the XML
`loader.move()` path is what gets deleted in C3.

**First implementation chunk.** Switch `isPhase2CardPath` (or the
`move-operations.ts` dispatch) to a frontmatter shape check; add a move doctest
covering a box-local-typed frontmatter card (the `bill` case). Green. This
lands first because it fixes a live bug independent of everything else and
removes the last frontmatter dependency on `loader.move()`.

### Track C1 — Make `callback-box/cards` resolve under the bundled `cb` (#17, the gate)

**What.** Box `config/schemas/*.ts` load via a tsx `registerHooks` resolver at
runtime (`registry.ts` `SCHEMA_DEPS = {callback-box, zod, yaml, cardworks}`).
The migrated `bill` schemas currently import `cardworks` (a JS package the
bundle resolves) as a stopgap; the scaffold template
(`box-templates.ts:31`/`:77`) already says `import … from "callback-box/cards"`.
After cardworks is deleted, every box schema must import `callback-box/cards`,
and that specifier must resolve **both** under plain tsx (dev) **and** under the
esbuild bundle that `bin/cb` ships (`dist/cli.mjs`).

**Why this needs to change.** The known failure: the bundle follows JS package
imports but not the TS-source `.js` re-exports in `src/cards/index.ts`
(`export { … } from "./schema.js"` resolving to `schema.ts`) — it throws
`Cannot find module schema.js`. So `package.json` `exports: { "./cards":
"./src/cards/index.ts" }` works in dev but not in the shipped bundle. This is
the one thing that *must* be solved before deletion; it is the parent's task
#17, still open.

**Direction (lean, with a spike to confirm).** Point the public `./cards`
export at **built JS**, not TS source, and wire that build into the paths `cb`
actually runs:

- Add a build step compiling `src/cards/*.ts` → `dist/cards/*.js` (the layer is
  zero-cardworks, `zod`/`yaml`-only — builds standalone), and set
  `exports: { "./cards": "./dist/cards/index.js" }`. The emitted `./schema.js`
  re-exports then resolve normally — no TS-source `.js`-rewrite hazard.
- **Wire it into the real build path.** `cb` runs the esbuild bundle
  `dist/cli.mjs` (`bin/cb:25`), built by `scripts/build-cli.mjs` (single entry
  `src/cli/index.ts`, `:24`); the server self-heals through **tsx** running
  `src/cli/index.ts` directly. Box `config/schemas/*.ts` are loaded at runtime
  (not bundled) via the tsx `registerHooks` resolver, so `callback-box/cards`
  must resolve in **both** worlds: the bundled-host dev path and the tsx server
  path. Building `dist/cards` and pointing `exports` at it covers the bundle;
  confirm the tsx path resolves the same built JS (or have the resolver map
  `callback-box/cards` → `dist/cards` explicitly). Update `build-cli.mjs` (or
  the `prepare`/`build` script) to emit `dist/cards`, and ensure deploy ships it.
- **Drop the cardworks staleness probe** in `bin/cb:63` (it `find`s
  `node_modules/cardworks/dist` to invalidate the bundle) as part of C5 — it
  dangles once cardworks is gone.
- Repoint the deployed `bill` schemas (ledger boxes) from `cardworks` →
  `callback-box/cards`.

Two alternatives, ranked below the lean: (b) have the tsx resolver rewrite
`callback-box/cards` → on-disk `src/cards/*.ts` and teach the re-exported `.js`
specifiers to resolve to source (keeps it source-only, but re-introduces the
`.js`→`.ts` resolution the bundle already fails at); (c) inline `src/cards/`
into the bundle behind a virtual specifier (more bundler surgery). **Lean is
(a)** — a tiny dedicated build output, least magic.

**First implementation chunk.** Spike: add the `dist/cards` build + `exports`
entry + build-script wiring, then prove a box schema importing
`callback-box/cards` loads under **both** `bin/cb validate` (bundle) and the
tsx path on a box whose schema uses the specifier (ledger `bill`). This chunk
*is* the gate — its unknowns (does the bundle resolve the built JS? does the
tsx/server path?) are resolved by running it, before anything is deleted.

### Track C2 — Replace the one needed loader function (broken-ref checking)

**What.** A callback-box frontmatter-aware ref-existence checker to replace
`loader.resolveRef(ref, path) → { exists }` (`card-lint.ts:118`) and a `.card`
glob to replace `loader.listCards()` (`validate.ts:242`,
`move-operations.ts:105`/`:213`).

**Why this needs to change.** These are the only two live `CardLoader` calls
that survive XML removal. `card-lint.ts` already extracts the refs itself
(`extractRefs` over frontmatter fields + `extractBodyRefs` over the body); it
only delegates the *existence* check to the loader. Once the XML `CardLoader`
is gone, that check needs a frontmatter-side home.

**Direction.**
- New `src/core/ref-exists.ts` (or fold into `body-refs.ts`): `resolveRefExists(
  { ref, fromPath, boxRoot }): Promise<boolean>`. **Port cardworks'
  `parse-ref.ts` + `resolve.ts` semantics rather than reinvent them** — a naive
  "strip `#fragment`, `fs.access`" would warn on valid refs. Specifically
  preserve: (a) a version-like `@x.y.z` suffix is stripped before path
  resolution (`parse-ref.ts:47`) — `foo.card@1.0.0` resolves to `foo.card`;
  (b) box-root-absolute refs resolve as `boxRoot + parsed.path`
  (`resolve.ts:176`); (c) the `attach/` scope — and bare `attach` —
  resolve into the sibling `Name.attach/` dir (`resolve.ts:183`); (d) the
  `#fragment` does **not** affect existence (`resolve.ts:103`); (e) `fs.access`
  follows today's symlink/directory behavior (`node-fs.ts:35`). `card-lint.ts`
  swaps its `loader.resolveRef` call for this; `LintDispatchOptions` drops the
  `loader: ICardLoader` field.
- `listCards()` → a `.card` glob filtered by `isTrashedCard`/`isCardFile`
  (the filters already exist at the call sites). Reuse whatever card-glob helper
  the codebase already has; otherwise a `fast-glob`/`fs` walk of `**/*.card`.

**Failure-mode note (carried to the table).** The ref-existence check is the
one place where a semantic regression would be **silent** — broken refs are
warnings, so a checker that wrongly reports "exists" suppresses a warning
nobody sees fail. Mitigation: a doctest that feeds a card with a known-broken
ref and known-good ones — covering an `attach/` ref, a box-root-absolute ref,
and a versioned `foo.card@1.0.0` ref (the semantics most likely to regress) —
through `lintCardsDispatch` and asserts the warning set. The existing validate
doctests are the template.

**First implementation chunk.** Write `resolveRefExists` + its doctest; repoint
`card-lint.ts`; confirm the validate suite green. (Independent of C3/C4 — can
land first since it removes the lint dispatcher's loader dependency.)

### Track C3 — Delete the dead XML consumers; rewrite the two broken paths

**What.** Remove or rewrite the remaining `src/` files that import a cardworks
XML symbol, by disposition.

**Delete outright (dead XML-only, no frontmatter reaches them):**
- `webapp/routes/api-card-routes.ts:37-62` — the legacy `/api/card/*` GET route
  (`loader.load` + `loader.serialize`). No frontend caller (grep `src/frontend`
  for `api/card` is empty), **but the route is still registered**
  (`webapp/routes/api.ts:98`) **and doctested as public behavior**
  (`test/routes-api.doctest.md:72`). Retiring it means: remove the handler + the
  registration **and** delete/update the REST doctest + any doc reference — not
  just dropping the handler.
- `webapp/routes/api-card-patch.ts` — `sanitizeElement(el: ElementNode)`, only
  consumed by that GET route and the already-removed PATCH. Delete the file.
- `webapp/trpc/routers/card.ts:150-215` — the XML loader fallback
  (`createLoader`/`loader.load`/`serialize`/`parseCard` at `:195`). The
  frontmatter dispatch at `:143-147` is the only reachable path; delete the
  fallback + the local `sanitizeElement`, drop the `parseCard`/`ElementNode`
  imports.
- `webapp/trpc/routers/status.ts:138-148` + `webapp/routes/api-browse.ts:102-111`
  — browse listings that `loader.load()` every card to read `card.element.attrs`.
  Rewrite to read frontmatter via `loadCardFrontmatter`
  (`frontmatter-field.ts`) instead of constructing the XML loader. (These two
  *display* live; the XML access is what's dead.)
- `webapp/routes/views.ts:107`/`:175` — the `/api/views/:slug/cards` renderer
  still imports `createLoader`/`ElementNode` for the XML `ViewCard` fallback
  (`xmlViewCard`); the frontmatter branch (`frontmatterViewCard`) is the
  reachable one. Delete the XML fallback + the dispatch, drop the imports.
- `commands/scan-import.ts:206-211` + `scan-import-cards.ts` — **a live,
  registered command** (`scan-import.ts:297`), NOT a dead path. The photo flow
  *writes frontmatter image cards* and then `loader.load(cardPath)` /
  `loader.save(card)`s them via `applyBundleAnalysisToCard`
  (`scan-import-cards.ts:71`/`:167`/`:233`) — a **broken frontmatter
  write-back** through the XML loader. **Gate (not a follow-up):** before
  deletion, either rewrite the bundle-analysis write-back to frontmatter
  (`card-io` parse-mutate-reserialize) or disable the bundle-analysis step.
  Settle which at the C3 chunk (Open question 1).
- `core/search/extract.ts:269-315` — `xmlDoc`/`collectElementText`/`isElementNode`
  and the `card.kind === "xml"` dispatch (`:103`). Dead branch; delete.
- `core/preactions/transcribe.ts:165-200` — the XML transcription helpers + the
  `"xml" in ctx` branch (`:43-52`); keep the frontmatter path.
- `core/preactions/types.ts:11` + `index.ts:109-127` — the `{ xml: { card: Card } }`
  union member and the `ctx.loader.save(ctx.xml.card)` XML persistence branch.
  Drop the union member, the `ICardLoader` loader field, and the import.

**Rewrite to frontmatter (suspected already-broken — finding #2):**
- `webapp/trpc/routers/chat.ts:90-110` — `loadLandmarkSummaries` parses
  `.landmark.card` (frontmatter) via `parseCard`. Rewrite to read navigation
  data from `loadCardFrontmatter` fields; delete the `findNavigation`/
  `readChildText`/`readSymbol` ElementNode helpers. **Verify first**: confirm
  chat landmark context is empty today, then that the rewrite restores it.
- `core/generate-docs-compile.ts:44-56` — `scanProcedures` reads procedure
  name/description from `parseCard(...).attrs`/`children`. Rewrite to
  `parseCardText`/`loadCardFrontmatter` and read the `name`/`description`
  fields. **Verify first** — note the symptom differs from `chat.ts`: on a
  frontmatter card the `parseCard` throws, caught at `:56`, which emits a
  **`"(could not parse)"` placeholder entry**, not an empty result. So the
  current breakage shows up as placeholder procedure docs; the rewrite restores
  real names/descriptions.

**Repoint type-only / agent-guide schema types:**
- `core/file-summary.ts:36` — drop the `element?: ElementNode` field from
  `LoaderInput`.
- `core/agent-guide/cards.ts:9` + `index.ts:50/58/82` — change the
  `ElementSchema[]` parameter to `CardSchema[]`, default from the empty XML
  `schemas` to `cardSchemas`, read `.type` instead of `.tagName`.

**Rewrite the live `CardLoader` users (depends on C2):**
- `cli/lib/loader.ts` — the factory re-exporting `CardLoader`/`MemoryCardLoader`.
  Once C2 lands and no router needs XML load/serialize, this file is deleted
  along with its consumers' imports (each router that called `createLoader` for
  the dead paths above loses the call).
- `commands/move-operations.ts:104-176/213-320` — replace `listCards()` with the
  glob. The XML `loader.move()` (`:176`) becomes dead **only after C0** routes
  box-local frontmatter cards through `movePhase2CardFiles` (today a
  `*.bill.card` move reaches `loader.move()` and fails — see Track C0). Once C0
  lands, no frontmatter move needs `loader.move()`; confirm via the move
  doctests (including the box-local-typed card added in C0).
- `core/sdk-hooks.ts:109` + `cli/commands/validate.ts:188/242/339` — these only
  built the loader to feed `lintCardsDispatch` (now loader-free after C2) and to
  `listCards()` (now a glob). Drop the `createLoader` calls.

**Why this needs to change.** While any of these import a cardworks XML symbol,
the package can't be deleted. The completeness proof is the typecheck: once
Track C5 removes the imports' target, `tsc` enumerates anything missed — but
because tsconfig covers only `src/**/*`, the grep sweep (below) backs it up.

**First implementation chunk.** The pure deletes with no rewrite
(`api-card-routes`/`api-card-patch`, `search/extract` `xmlDoc`,
`transcribe` XML helpers, `preactions` XML branch) — self-contained, green
after each. Then the two broken-path rewrites (verify-then-fix). Then the
loader-user rewrites (gated on C2).

### Track C4 — Drop box-local XML schema support (#11)

**What.** Remove the `element()` / `ElementSchema` half of the box-schema and
card-loading machinery, now that no box defines an XML schema.

**Why this needs to change.** The parent settled this (header decision, boxholder
confirmed): boxes may define only frontmatter `cardSchema` types. The ledger
`bill` schema (the one box-local XML schema) is migrated. So the box-local XML
path is now dead and removable.

**Direction.**
- `schemas/registry.ts` — drop `schemas: ElementSchema[] = []` (`:56`), the
  `elementSchemas` field on `BoxSchemas` (`:181`), the `isElementSchema`
  discriminator branch (`:249`/`:274`), and the `ElementSchema` loops in
  `createSchemaRegistry`. Remove `cardworks` from `SCHEMA_DEPS` (`:108`) — box
  schemas now import only `callback-box/cards`/`zod`/`yaml`.
- `core/card-io.ts` — collapse `LoadedCard` to `FrontmatterLoadedCard` (drop
  `XmlLoadedCard`, `:280`), delete `loadXmlCard` (`:365`) and the dispatch to it
  (`:345`), the `CARD_XML_CONTENT_TYPE` constant and its XML body
  validate/serialize branches (`:225`/`:262`), the `elementSchemas` field on
  `LoadCardContext` (`:301`), and the `parseCard`/`ElementSchema`/`ElementNode`
  imports (`:21`).
- `core/load-context.ts` — drop the `elementSchemas` construction; keep
  `cardSchemas`.
- `core/card-lint.ts:89` — delete the `lintCard(options.loader, …)` XML fallback;
  a frontmatter card with no matching schema becomes an explicit
  skip/error-result rather than an XML lint. Drop the `lintCard`/`ICardLoader`
  imports.
- `core/box-templates.ts:106-169` — remove the "Legacy: XML / `element()`
  schemas" scaffold section and the `import { element } from "cardworks"`
  example; the template keeps only the `callback-box/cards` `cardSchema` form.
- Retire the box `gadget`-XML doctest (`test/box-schemas.doctest.md`) if still
  present.
- **Registry-removal ripples (Codex finding #7) — the `schemas[]`/
  `elementSchemas` export has consumers beyond `registry.ts`/`card-io.ts`:**
  `core/init-rules.ts:95` mixes `schemas` with `boxSchemas.elementSchemas` when
  generating rule sources; `core/generate-docs.ts:420`/`:432` computes both the
  XML and frontmatter schema sets and passes `allSchemas` to the agent guide;
  `core/agent-guide/cards.ts:6` is still `ElementSchema`/`.tagName`-based (also
  listed in C3's type-repoint). All three must move to `cardSchemas`/`.type`
  when the empty `schemas[]` export is deleted, or they break at compile time.
  `core/reactor/batch-jobs.ts:11`/`:127` also imports `schemas` and calls
  `schemas.find(s => s.tagName === tag)` for job-instruction lookup — repoint to
  `cardSchemas`/`.type` (it's already returning nothing since `schemas[]` is
  empty).

**First implementation chunk.** The `registry.ts` + `card-io.ts` union
collapse (the two interlocking files) in one commit, with the box-schema
doctest updated; green.

### Track C5 — Delete the package and its wiring

**What.** Remove `cardworks/`, the `callback-box/node_modules/cardworks`
symlink, the `"cardworks": "workspace:*"` dep (`package.json`), and the
`- cardworks` line in `pnpm-workspace.yaml`; **stub (do not unlist) the spent
XML migrators** — replace each cardworks-importing `scripts/migrate/*.ts` with
an obsolete no-op while **keeping its `MIGRATIONS` entry** (`migrations.ts:6`:
the `name` is an append-only manifest key); `pnpm install` to settle the
lockfile; **rebuild and validate `dist/`** (`dist/cli.mjs` bakes cardworks
imports — a stale artifact would carry dead imports); update docs.

**Why this needs to change.** The goal. The migrators were the last legitimate
cardworks consumer (they read pre-migration XML via `parseCard`); every box is
migrated, so they're spent and get stubbed in the same push.

**Gate.** Runs only when C1–C4 make `grep -rl cardworks
callback-box/{src,scripts,test}` empty for `src` (migrators are stubbed here, so
they're the last to clear) **and** the box-schema audit
(`grep -rl cardworks ~/src/boxes/*/config/schemas/` + the server boxes) is
clean. Doc updates: `CLAUDE.md:28` (the dormant-loader sentence),
`CLAUDE.md:87`/`docs/adding-schemas.md` (the cardworks bullet → `src/cards/`),
`docs/migrations.md` (retire deleted-migrator references).

**First implementation chunk.** Delete package + wiring + stub migrators +
`pnpm install` + `dist` rebuild, with a final clean
`typecheck && lint && test` and an empty `grep` sweep.

## Subplans

None. C1 (#17) carries the one real unknown and is structured as a
spike-first chunk (prove the bundle resolves the built `./cards` before any
deletion), not a separate design step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `cb mv` on a box-local frontmatter card (`*.bill.card`) falls to the XML loader and fails | No (C0 adds one) | C0 makes classification shape-based; **broken today** | Clear-but-fatal (move errors) — but unnoticed until someone moves a box-local card |
| `callback-box/cards` doesn't resolve under the bundled `cb` OR the tsx/server path after deletion | No | C1 spike proves both paths on a real box before deletion | **Silent until a box schema loads at runtime** — the spike is the gate |
| `scan-import` photo bundle-analysis writes back through the XML loader to a frontmatter card | No | C3 gate: rewrite to frontmatter or disable before deletion | **Silent today** (live command, broken write-back) |
| The frontmatter ref-existence checker (C2) wrongly reports "exists", suppressing a broken-ref warning | New doctest (C2) | Port cardworks `parse-ref`/`resolve` semantics | **Silent** (warnings nobody sees fail) — the doctest is the guard |
| A versioned (`foo.card@1.0.0`) or box-root-absolute ref mis-resolves in the C2 checker | New doctest (C2) | Strip `@version`; resolve box-root-absolute as `boxRoot + path` | **Silent** — doctest covers both |
| `attach/`-scope (and bare `attach`) refs resolve wrong | New doctest (C2) | Honor the `attach/` rule explicitly | **Silent** — doctest covers a known-good `attach/` ref |
| `chat.ts` landmark summaries already empty; rewrite doesn't restore them | No (verify-first) | Verify current breakage, then rewrite | Currently **silent** (try/catch → empty); rewrite + manual check |
| `generate-docs-compile.ts` procedure names/descriptions already missing | No (verify-first) | Verify, then rewrite to frontmatter | Currently **silent** (try/catch → skip) |
| `move-operations.ts` loses a referrer-rewrite that XML `loader.move()` did | Yes — move doctests | Phase-2 move + substring rewrite already own this | Clear (move doctests) |
| A `scripts/` or box `config/schemas/*.ts` cardworks import (not in tsconfig) | No | Grep sweep gate (tsc doesn't see these) | **Silent until runtime** — grep, not compiler |
| Stubbing a migrator removes its `MIGRATIONS` entry → shifts a box's applied set | No | Keep entries; stub scripts only (`migrations.ts:6`) | Clear-but-fatal if violated |
| Stale `dist/cli.mjs` keeps baked cardworks imports | No | C5 rebuilds + validates dist | Clear (import error if dist runs) |
| `card-lint.ts` no-matching-schema path: removing the XML fallback changes behavior for an unknown card type | Partial — validate doctests | Explicit skip/error-result replaces the XML lint | Clear (validate output) |

**Critical gap: the frontmatter ref-existence checker (C2).** It is the one
new codepath whose failure is silent *and* security-adjacent to data integrity
(broken refs are how the system surfaces stale links). It must land with a
doctest that asserts the warning set for a broken ref, a good ref, and an
`attach/`-scoped ref before C3 removes the old loader. Resolution: the C2 chunk
is doctest-first.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **N/A.** No new vocabulary; internal deletion.
- **Stale ref** — **ADDRESSED.** This plan *reimplements* the stale-ref check
  (C2); the doctest is exactly the stale-ref scenario, including `attach/`.
  Behavior must match today's (warning, not error — `card-lint.ts:105-111`).
- **Two agents touching the same card** — **N/A.** No card-write path changes;
  `card-io.ts` parse-mutate-reserialize untouched except the XML branch
  collapse.
- **Hand-edit drift** — **ADDRESSED.** The `unknownKeyWarnings` path
  (`card-lint.ts:154`) is untouched; drifted frontmatter still warns.
- **Fabricated free-form value** — **N/A.** No new fields.
- **Validation error UX** — **ADDRESSED.** `card-io.ts:62` `formatZodIssues`
  (the agent-facing validator) and the copied `formatLintResults` (the CLI
  formatter) are both untouched; only the broken-ref *source* changes (C2), and
  its message string matches today's (`card-lint.ts:123`).
- **Partial migration / transition state** — **ADDRESSED.** The transition is
  compile-time, not data — all boxes are already migrated. The worktree never
  ships a half-state: the plan completes (cardworks gone, green) before merge.

## NOT in scope

- **Re-implementing the XML loader/serializer/XPath/JSX.** Zero consumers;
  deletion beats porting.
- **Box data migration.** Already complete (the user's separate, finished
  effort) — this plan's gate, not its work.
- **Reworking the photo-bundle feature** beyond severing its XML mutation. If
  `scan-import` bundle-analysis is still wanted, its frontmatter rewrite is a
  small follow-up; if it's vestigial, it's deleted (Open question 1). Either
  way the XML path goes.
- **A general npm-vendoring mechanism.** We delete one first-party package; no
  reusable infra.
- **Changing `.card` semantics, ref syntax, or the `attach/` rule.** C2
  preserves them exactly.

## Open design questions

1. **`scan-import` photo-bundle: rewrite or disable? (a C3 gate, not a
   deferral.)** `scan-import` is a live registered command
   (`scan-import.ts:297`); its bundle-analysis write-back goes through the XML
   `loader.load`/`save` against a now-frontmatter image card
   (`scan-import-cards.ts:71`/`:167`/`:233`) — already broken. The choice is
   rewrite-to-frontmatter vs disable the bundle-analysis step, and it must be
   settled **before** deletion (the command can't be left calling a deleted
   loader). **Lean:** check whether anything triggers `scan-import` bundle
   analysis in practice; rewrite if used, disable if vestigial — decide at the
   C3 chunk, resolved before C5.
2. **C1 resolution mechanism.** Lean is (a) a `dist/cards` build + `exports`
   `./cards` → built JS. The spike confirms the bundle resolves it; if it
   doesn't, fall back to (b) the tsx-source resolver. Not an open question
   *inside* the first chunk — the chunk *is* running the spike to decide.
3. **`card-lint.ts` no-matching-schema behavior.** Today an unknown card type
   falls to cardworks `lintCard` (XML). After removal it should
   skip-with-no-issues (a non-card or pre-init file shouldn't error) vs
   error (a typo'd `.card` should be caught). **Lean:** skip cleanly — the
   filename-type discriminator already gates real cards; an unmatched `.card`
   is drift, surfaced elsewhere (`unknownKeyWarnings`). Confirm against the
   validate doctests.

## Knowledge audits

Skip-with-rationale: no new agent-facing concept. The one agent-facing fact
(*cards are never XML; the filename is the type discriminator; no `type:`
field*) landed with the schema migrations and lives in `CLAUDE.md:28`/`:39`.
The box-schema scaffold change (C4: drop the `element()` section) makes the
template match that existing understanding rather than introducing anything new.

## Implementation order

1. **C0 — fix `cb mv` box-local classification** (shape-based `isPhase2CardPath`)
   + a box-local-typed move doctest. Fixes a live bug and removes the last
   frontmatter dependency on `loader.move()`. **First gate**, independent of all
   else.
2. **C1 (#17) — spike the public specifier under the bundle AND tsx.** Build
   `dist/cards`, set `exports` `./cards`, wire it into `build-cli.mjs`/deploy,
   prove a box schema importing `callback-box/cards` loads under both
   `bin/cb validate` (bundle) and the tsx path. Repoint deployed `bill` schemas.
   **Gate for deletion.**
3. **C2 — frontmatter ref-existence checker + doctest** (port `parse-ref`/
   `resolve` semantics: `@version`, box-root-absolute, `attach/`), repoint
   `card-lint.ts`, drop the lint dispatcher's loader field. Green. (Independent
   of C3/C4.)
4. **C3 chunk 1 — pure deletes** (`api-card-routes` handler+registration+REST
   doctest / `api-card-patch`, `views.ts` XML fallback, `search/extract`
   `xmlDoc`, `transcribe` XML helpers, `preactions` XML branch,
   `file-summary`/`agent-guide` type repoints). Green per commit.
5. **C3 chunk 2 — verify-then-rewrite the broken/live paths** (`chat.ts`
   landmark → empty today; `generate-docs-compile.ts` procedure → placeholder
   today; **`scan-import` bundle write-back — rewrite-to-frontmatter or
   disable, a gate**).
6. **C3 chunk 3 — rewrite the live `CardLoader` users** (`move-operations.ts`
   glob + drop the now-dead `move()` — dead only post-C0; `status.ts`/
   `api-browse.ts` frontmatter listing; delete `cli/lib/loader.ts` + the
   `createLoader` calls in `sdk-hooks`/`validate`/routers).
7. **C4 — drop box-local XML support** (`registry.ts` + `card-io.ts` union
   collapse together, `load-context.ts`, `box-templates.ts` scaffold, the
   gadget doctest, **plus the registry-removal ripples: `init-rules.ts`,
   `generate-docs.ts` `allSchemas`, `agent-guide/cards.ts`, `batch-jobs.ts`**).
   Green.
8. **C5 — delete cardworks** + symlink + dep + workspace entry, **drop the
   `bin/cb:63` cardworks staleness probe**, stub the spent migrators (keep
   `MIGRATIONS` entries), `pnpm install`, rebuild/validate `dist`, update docs.
   Final gate: `typecheck && lint && test` clean + `grep -rl cardworks src
   scripts test` empty + box-schema audit clean.

Dependencies: **C0 fixes a live bug and unblocks C3-chunk-3's `loader.move()`
deletion** (a box-local move depends on `move()` until C0 lands). C1 gates all
deletion (box schemas break without it). C2 must land before C3-chunk-3 (it
removes the lint loader dependency) and before C5 (the last live loader use).
C3+C4 make the `src/` cardworks imports vanish; C5 deletes the target and the
typecheck enumerates anything missed.

## Rollout shape

- **Test posture.** No new behavior except the C2 ref-checker, which gets a
  doctest (the one regression-risk piece — broken-ref warnings are silent if
  wrong). The existing suite (~2172) + `pnpm typecheck` is the completeness
  proof for the deletions; the grep sweep backs up the tsconfig blind spots.
- **Knowledge-audit entries.** None (see Knowledge audits).
- **Migration approach.** No box-data migration here — already done. The only
  data-adjacent step is repointing deployed `bill` schemas to
  `callback-box/cards` (C1), done in this push.
- **Ship as one unit.** Merge to main only when cardworks is gone and
  `typecheck`/`lint`/`test` are clean — never a state where `src/cards/` and
  cardworks both supply a primitive. Per the plan discipline and the user's
  standing instruction, the merge is a separate signal from the user, not
  agent-triggered. Auto-deploy fires on the main merge (`dist` must be rebuilt
  first — C5).
