OpenAI Codex v0.137.0
--------
workdir: /Users/ianbicking/src/callback-worktrees/remove-cardworks
model: gpt-5.5
provider: openai
approval: never
sandbox: read-only
reasoning effort: high
reasoning summaries: none
session id: 019edfdd-1bfc-75c0-8f2f-f459ae9b7434
--------
user
IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, or .claude/skills/ — those are skill definitions for a different AI runtime and will waste your time. Everything else in this repo, including docs/ and .claude/rules/, is fair game.

This targets the callback-box/ subproject. Paths like src/…, docs/…, test/… are under callback-box/; bin/… is at the monorepo root. cardworks/ is a sibling subproject at the monorepo root. You may read any repo file (read-only), including docs/ and .claude/rules/, to verify claims.

You are an independent, adversarial engineering+design reviewer. A Claude model wrote callback-box/docs/plans/remove-cardworks-deletion.md. Read it, then read the source it cites and verify the citations and the "we already do X / free reuse / validation catches it / this path is dead / this is suspected-broken" claims against the actual code — you are a different model; find what a same-model self-review would miss.

Essential context: this plan is the FINAL phase of a larger effort (callback-box/docs/plans/remove-cardworks-package.md, the parent — read it for background). All card data and all box-local schemas have ALREADY been migrated from XML to YAML-frontmatter across every box (0 XML cards remain) — treat that as given, not something to re-litigate. The plan's job is to delete the now-dead XML code paths and the cardworks package itself.

The plan makes several load-bearing claims I most want verified against source:
1. That `loader.resolveRef` at card-lint.ts:118 is the ONLY genuinely-needed CardLoader function — i.e. every other CardLoader/parseCard/ElementNode/ElementSchema/lintCard usage in src/ is dead XML reachable by no frontmatter card. Spot-check the "dead path" disposition for the files listed in Track C3/C4. Is anything marked "delete outright" actually still reachable?
2. That chat.ts:90-110 (loadLandmarkSummaries) and generate-docs-compile.ts:44-55 are CURRENTLY BROKEN — they parse now-frontmatter cards with the XML parseCard inside a try/catch and silently degrade to empty. Verify the parseCard calls and the try/catch, and whether landmark/procedure cards are in fact frontmatter (cardSchemas[], not the empty schemas[]).
3. That the frontmatter ref-existence replacement (Track C2) can faithfully reproduce cardworks resolveRef semantics, including the `attach/`-scope rule. Read cardworks/src/refs/resolve.ts and the callback-box attach-scope handling; is there a semantic the plan's simple `fs.access` approach would miss (fragments, ref normalization, case, symlinks, directory refs)?
4. That `loader.move()` (move-operations.ts:176) is genuinely dead for frontmatter cards and movePhase2CardFiles + rewrite-card-refs.ts fully cover referrer rewriting. This is a data-integrity claim — verify it carefully.
5. That the C1/#17 bundle problem is correctly diagnosed (the esbuild bundle in dist/cli.mjs can't follow src/cards/index.ts's TS-source `.js` re-exports) and that pointing exports "./cards" at a built dist/cards/index.js actually fixes it for BOTH plain tsx and the bundle. Look at how box config/schemas/*.ts are loaded (the tsx registerHooks resolver in src/schemas/registry.ts) and whether the proposed fix is sound.
6. That the legacy /api/card GET route (api-card-routes.ts) truly has no caller (the plan claims the frontend grep is empty).

Review for, in priority: (1) wrong-problem / over-engineering — what's the minimal version, what to cut; (2) architecture flaws; (3) silent failure modes (no test AND no handling AND invisible) — especially in the C2 ref-checker and the C3 "dead path" deletions where a wrongly-classified live path would vanish silently; (4) things treated as settled that will bite in implementation; (5) incorrect/unverifiable citations — name them.

Be concrete: cite plan section + file:line. Rank by impact. Don't pad. End with the single most important change.

codex
I’ll read the deletion plan and parent first, then trace each load-bearing claim back through the cited source. I’ll keep this in review mode: concrete findings, ranked, with plan/file line references.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/docs/plans/remove-cardworks-deletion.md | sed -n '1,260p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	# Remove cardworks — final deletion phase
     2	
     3	The execution plan for the last phase of `remove-cardworks-package.md`: sever
     4	the remaining XML code paths in callback-box, replace the one piece of loader
     5	functionality that is genuinely still used (broken-ref checking), drop
     6	box-local XML schema support, and delete the `cardworks` package, its
     7	`node_modules` symlink, the `workspace:*` dependency, and the
     8	`pnpm-workspace.yaml` entry.
     9	
    10	This plan supersedes the parent's gating: **all box data and box-local schemas
    11	are already migrated to frontmatter** (the user's separate effort, now complete
    12	on every server box and every local dev box — 0 XML cards remain anywhere), so
    13	the parent's "gated on box migration" tracks (chunk 2, Track C) are now
    14	ungated. Tracks A-chunk-1, B (the `src/cards/` absorption), the `todos`
    15	rewrite, `card.patch` removal, and `ls --format` are already shipped (parent
    16	tasks #7–#10). What remains is the residual XML severance + the package
    17	deletion, with three file-level findings the parent plan did not have.
    18	
    19	Plan-only; nothing executes until approved. Runs on this worktree branch; ships
    20	(merges to main) only when the user asks.
    21	
    22	## New findings since the parent plan
    23	
    24	Three facts from a fresh file-by-file investigation that the parent plan
    25	states imprecisely or misses:
    26	
    27	1. **The one genuinely-needed loader function is `resolveRef`.** Every other
    28	   `CardLoader` use is dead XML. `card-lint.ts:118` calls
    29	   `options.loader.resolveRef(ref, path)` to mark broken refs as **warnings**
    30	   (not errors) during `cb validate` and the PostToolUse hook. This is the
    31	   single load-bearing replacement in the whole deletion. `listCards()`
    32	   (`validate.ts:242`, `move-operations.ts:105`/`:213`) is the only other live
    33	   call and reduces to a `.card` glob.
    34	
    35	2. **Two paths parse now-frontmatter cards with the XML parser — suspected
    36	   already-broken.** `chat.ts:103` `loadLandmarkSummaries` reads
    37	   `**/*.landmark.card` (frontmatter since migration) via `parseCard` (the XML
    38	   parser), and `generate-docs-compile.ts:47` reads `*.procedure.card`
    39	   (frontmatter) via `parseCard`. Both wrap the call in try/catch and
    40	   `continue`/skip on failure, so they **silently degrade to empty** rather than
    41	   error. These are latent bugs the migration left behind, not just dead code —
    42	   removing cardworks forces a frontmatter rewrite that also fixes them.
    43	
    44	3. **`src/cards/` is already self-contained and complete.** It imports only
    45	   `zod`/`yaml` (no cardworks); the refs primitives (`parseRef`/`resolveRef`/
    46	   `extractRefs` from cardworks `refs/`) are **not used anywhere in `src/`** —
    47	   callback-box has its own `body-refs.ts` + `frontmatter-field.ts`. So Track B
    48	   needs nothing further; the absorption is done.
    49	
    50	## Stated preferences this plan trades against
    51	
    52	- **`callback-box/CLAUDE.md:28`**: *"Every built-in schema is now frontmatter;
    53	  the legacy XML-body format and its loader branch remain in place but dormant
    54	  … until cardworks is removed in a follow-up."* This plan makes that promise
    55	  good and updates the sentence.
    56	- **`callback-box/CLAUDE.md` "don't add features beyond what the task
    57	  requires"** — we delete the XML loader/serializer/XPath rather than port
    58	  them; they have no consumer.
    59	- **`callback-box/CODE-STYLE.md:25`** (no `any`), **`:55`** (`as` is like Rust
    60	  `unsafe`; centralize at parse boundaries — relevant to the ref-resolver
    61	  replacement and the `ElementNode` removals), files ≤300 lines.
    62	- **The schema-migration precedent** (`remove-cardworks-and-xml.md`):
    63	  compiler-driven refactoring — delete the exports, let `tsc` enumerate the
    64	  stale consumers. The completeness gate here is `typecheck && lint && test`
    65	  **plus** a `grep -rl cardworks` sweep across `src/scripts/test` and box
    66	  `config/schemas/` (because tsconfig covers only `src/**/*`; parent Codex
    67	  finding #2).
    68	
    69	## What already exists
    70	
    71	- **`src/cards/` — the absorbed frontmatter primitives, done.** `index.ts`
    72	  re-exports `cardSchema`/`body`/`extractRefs`/`splitCardContent`/
    73	  `formatLintResults`/`LintIssue`/`ParseError`; imports `zod`/`yaml` only.
    74	  **Reuse as-is.** No further absorption.
    75	- **`frontmatter-field.ts` — the frontmatter reader.** `loadCardFrontmatter`
    76	  (`:35`) + `lookupField` (`:19`) already parse a card's YAML mapping and walk
    77	  dotted paths. **Reuse** as the base for the ref-existence replacement.
    78	- **`body-refs.ts` — Markdoc body-ref extraction**, callback-box-owned.
    79	  **Reuse** — `card-lint.ts:114` already calls `extractBodyRefs` and only uses
    80	  the loader to check whether each extracted ref *exists*.
    81	- **cardworks `refs/resolve.ts:49` `resolveRef`** — the existing implementation:
    82	  parse the ref → resolve the path relative to the referring card → `fs.exists`
    83	  → `{ exists }` (`refs/types.ts:40`). This is the model for the replacement;
    84	  ~40 LOC, no XML in the existence check itself. **Rebuild** in callback-box as
    85	  a small frontmatter-aware helper (must handle the `attach/`-scope rule,
    86	  CLAUDE.md "refs starting with `attach/` resolve into this scope").
    87	- **`movePhase2CardFiles` + `rewrite-card-refs.ts`** — Phase-2 card moves +
    88	  substring ref rewriting, already callback-box-owned. **Reuse**; the XML
    89	  `loader.move()` (`move-operations.ts:176`) is the dead twin.
    90	- **The 19 remaining cardworks importers in `src/`** — all XML-side:
    91	  `parseCard`, `ElementNode`, `ElementSchema`, `element`, `CardLoader`/
    92	  `ICardLoader`/`MemoryCardLoader`, `lintCard`, `SchemaRegistry`, `Card`.
    93	  Dispositions in Track C3/C4 below.
    94	- **Only callback-box consumes cardworks** — verified clean in
    95	  `callback-clerk/`, `agent-doctest/`, `personal-vibe-check/` (parent plan,
    96	  unchanged).
    97	
    98	## Prior art (external)
    99	
   100	Skip-with-rationale: a purely internal refactor — deleting a first-party
   101	workspace package and replacing ~40 LOC of ref-resolution. No third-party
   102	behavior is in question. The one in-repo technique is **compiler-driven
   103	refactoring** (delete exports → `tsc` enumerates stale consumers), already
   104	established by the six schema migrations. No external search warranted.
   105	
   106	## Tracks / scope
   107	
   108	Ordered by dependency. The hard gate is **C1 (#17)** — until the public
   109	`callback-box/cards` specifier resolves under the bundled `cb`, deleting
   110	cardworks breaks every box-local frontmatter schema at runtime. Then C2 builds
   111	the one needed replacement, C3/C4 sever the dead XML, and C5 deletes the
   112	package.
   113	
   114	### Track C1 — Make `callback-box/cards` resolve under the bundled `cb` (#17, the gate)
   115	
   116	**What.** Box `config/schemas/*.ts` load via a tsx `registerHooks` resolver at
   117	runtime (`registry.ts` `SCHEMA_DEPS = {callback-box, zod, yaml, cardworks}`).
   118	The migrated `bill` schemas currently import `cardworks` (a JS package the
   119	bundle resolves) as a stopgap; the scaffold template
   120	(`box-templates.ts:31`/`:77`) already says `import … from "callback-box/cards"`.
   121	After cardworks is deleted, every box schema must import `callback-box/cards`,
   122	and that specifier must resolve **both** under plain tsx (dev) **and** under the
   123	esbuild bundle that `bin/cb` ships (`dist/cli.mjs`).
   124	
   125	**Why this needs to change.** The known failure: the bundle follows JS package
   126	imports but not the TS-source `.js` re-exports in `src/cards/index.ts`
   127	(`export { … } from "./schema.js"` resolving to `schema.ts`) — it throws
   128	`Cannot find module schema.js`. So `package.json` `exports: { "./cards":
   129	"./src/cards/index.ts" }` works in dev but not in the shipped bundle. This is
   130	the one thing that *must* be solved before deletion; it is the parent's task
   131	#17, still open.
   132	
   133	**Direction (lean, with a spike to confirm).** Point the public `./cards`
   134	export at **built JS**, not TS source:
   135	
   136	- Add a build step that compiles `src/cards/*.ts` → `dist/cards/*.js` (the
   137	  layer is zero-cardworks, `zod`/`yaml`-only, so it builds standalone), and set
   138	  `exports: { "./cards": "./dist/cards/index.js" }`.
   139	- The box-schema tsx resolver maps `callback-box/cards` → that built JS, which
   140	  both tsx and the bundle resolve by normal package semantics (no TS-source
   141	  `.js`-rewrite hazard).
   142	- Repoint the deployed `bill` schemas (ledger boxes) from `cardworks` →
   143	  `callback-box/cards`.
   144	
   145	Two alternatives, ranked below the lean: (b) have the tsx resolver rewrite
   146	`callback-box/cards` → the on-disk `src/cards/*.ts` and register tsx for the
   147	re-exported `.js` specifiers inside the bundle too (keeps it source-only, but
   148	re-introduces the `.js`→`.ts` resolution the bundle already fails at); (c)
   149	inline `src/cards/` into the bundle and expose a virtual specifier (more bundler
   150	surgery). **The lean is (a)** — a tiny dedicated build output is the least
   151	magic and matches how `dist/cli/index.js` (the `.` export) already ships.
   152	
   153	**First implementation chunk.** Spike: add the `dist/cards` build + `exports`
   154	entry, then prove a box schema importing `callback-box/cards` loads under
   155	`bin/cb validate` on a box whose schema uses the specifier (ledger `bill`).
   156	This chunk *is* the gate — it has one unknown (does the bundle resolve the
   157	built JS cleanly?), resolved by running it, before anything is deleted.
   158	
   159	### Track C2 — Replace the one needed loader function (broken-ref checking)
   160	
   161	**What.** A callback-box frontmatter-aware ref-existence checker to replace
   162	`loader.resolveRef(ref, path) → { exists }` (`card-lint.ts:118`) and a `.card`
   163	glob to replace `loader.listCards()` (`validate.ts:242`,
   164	`move-operations.ts:105`/`:213`).
   165	
   166	**Why this needs to change.** These are the only two live `CardLoader` calls
   167	that survive XML removal. `card-lint.ts` already extracts the refs itself
   168	(`extractRefs` over frontmatter fields + `extractBodyRefs` over the body); it
   169	only delegates the *existence* check to the loader. Once the XML `CardLoader`
   170	is gone, that check needs a frontmatter-side home.
   171	
   172	**Direction.**
   173	- New `src/core/ref-exists.ts` (or fold into `body-refs.ts`): `resolveRefExists(
   174	  { ref, fromPath, boxRoot }): Promise<boolean>`. Parse the ref into
   175	  path + optional `#fragment`; resolve the path component relative to the
   176	  referring card's directory, honoring the `attach/` scope rule (refs starting
   177	  `attach/` resolve into the sibling `Name.attach/` dir); `fs.access` the
   178	  target. Mirror cardworks `refs/resolve.ts:49` semantics for the existence
   179	  result (fragments don't affect file existence — same as today). `card-lint.ts`
   180	  swaps its `loader.resolveRef` call for this; `LintDispatchOptions` drops the
   181	  `loader: ICardLoader` field.
   182	- `listCards()` → a `.card` glob filtered by `isTrashedCard`/`isCardFile`
   183	  (the filters already exist at the call sites). Reuse whatever card-glob helper
   184	  the codebase already has; otherwise a `fast-glob`/`fs` walk of `**/*.card`.
   185	
   186	**Failure-mode note (carried to the table).** The ref-existence check is the
   187	one place where a semantic regression would be **silent** — broken refs are
   188	warnings, so a checker that wrongly reports "exists" suppresses a warning
   189	nobody sees fail. Mitigation: a doctest that feeds a card with a known-broken
   190	ref (and a known-good one, including an `attach/` ref) through
   191	`lintCardsDispatch` and asserts the warning set — the existing validate
   192	doctests are the template.
   193	
   194	**First implementation chunk.** Write `resolveRefExists` + its doctest; repoint
   195	`card-lint.ts`; confirm the validate suite green. (Independent of C3/C4 — can
   196	land first since it removes the lint dispatcher's loader dependency.)
   197	
   198	### Track C3 — Delete the dead XML consumers; rewrite the two broken paths
   199	
   200	**What.** Remove or rewrite the remaining `src/` files that import a cardworks
   201	XML symbol, by disposition.
   202	
   203	**Delete outright (dead XML-only, no frontmatter reaches them):**
   204	- `webapp/routes/api-card-routes.ts:37-62` — the legacy `/api/card/*` GET route
   205	  (`loader.load` + `loader.serialize`); **no frontend caller** (grep
   206	  `src/frontend` for `api/card` is empty). Remove the route + its registration.
   207	- `webapp/routes/api-card-patch.ts` — `sanitizeElement(el: ElementNode)`, only
   208	  consumed by that GET route and the already-removed PATCH. Delete the file.
   209	- `webapp/trpc/routers/card.ts:150-215` — the XML loader fallback
   210	  (`createLoader`/`loader.load`/`serialize`/`parseCard` at `:195`). The
   211	  frontmatter dispatch at `:143-147` is the only reachable path; delete the
   212	  fallback + the local `sanitizeElement`, drop the `parseCard`/`ElementNode`
   213	  imports.
   214	- `webapp/trpc/routers/status.ts:138-148` + `webapp/routes/api-browse.ts:102-111`
   215	  — browse listings that `loader.load()` every card to read `card.element.attrs`.
   216	  Rewrite to read frontmatter via `loadCardFrontmatter`
   217	  (`frontmatter-field.ts`) instead of constructing the XML loader. (These two
   218	  *display* live; the XML access is what's dead.)
   219	- `commands/scan-import.ts:206-211` + `scan-import-cards.ts` — the photo-bundle
   220	  flow that `loader.load`/mutates an XML image card's element tree and
   221	  `loader.save`s it (`scan-import-cards.ts:171`/`:233`). Image cards are
   222	  frontmatter now; this element-tree mutation is unreachable. Remove the
   223	  cardworks path (rewrite to frontmatter parse-mutate-reserialize if the bundle
   224	  feature is still wanted, else delete — see Open question 1).
   225	- `core/search/extract.ts:269-315` — `xmlDoc`/`collectElementText`/`isElementNode`
   226	  and the `card.kind === "xml"` dispatch (`:103`). Dead branch; delete.
   227	- `core/preactions/transcribe.ts:165-200` — the XML transcription helpers + the
   228	  `"xml" in ctx` branch (`:43-52`); keep the frontmatter path.
   229	- `core/preactions/types.ts:11` + `index.ts:109-127` — the `{ xml: { card: Card } }`
   230	  union member and the `ctx.loader.save(ctx.xml.card)` XML persistence branch.
   231	  Drop the union member, the `ICardLoader` loader field, and the import.
   232	
   233	**Rewrite to frontmatter (suspected already-broken — finding #2):**
   234	- `webapp/trpc/routers/chat.ts:90-110` — `loadLandmarkSummaries` parses
   235	  `.landmark.card` (frontmatter) via `parseCard`. Rewrite to read navigation
   236	  data from `loadCardFrontmatter` fields; delete the `findNavigation`/
   237	  `readChildText`/`readSymbol` ElementNode helpers. **Verify first**: confirm
   238	  chat landmark context is empty today, then that the rewrite restores it.
   239	- `core/generate-docs-compile.ts:44-55` — reads procedure name/description from
   240	  `parseCard(...).attrs`/`children`. Rewrite to `parseCardText`/
   241	  `loadCardFrontmatter` and read the `name`/`description` fields. **Verify
   242	  first**: confirm the compiled procedure docs are currently missing
   243	  names/descriptions.
   244	
   245	**Repoint type-only / agent-guide schema types:**
   246	- `core/file-summary.ts:36` — drop the `element?: ElementNode` field from
   247	  `LoaderInput`.
   248	- `core/agent-guide/cards.ts:9` + `index.ts:50/58/82` — change the
   249	  `ElementSchema[]` parameter to `CardSchema[]`, default from the empty XML
   250	  `schemas` to `cardSchemas`, read `.type` instead of `.tagName`.
   251	
   252	**Rewrite the live `CardLoader` users (depends on C2):**
   253	- `cli/lib/loader.ts` — the factory re-exporting `CardLoader`/`MemoryCardLoader`.
   254	  Once C2 lands and no router needs XML load/serialize, this file is deleted
   255	  along with its consumers' imports (each router that called `createLoader` for
   256	  the dead paths above loses the call).
   257	- `commands/move-operations.ts:104-176/213-320` — replace `listCards()` with the
   258	  glob; the XML `loader.move()` (`:176`) re-serializes referrers in XML and is
   259	  dead for frontmatter cards (Phase-2 cards already go through
   260	  `movePhase2CardFiles` + substring rewriting). Confirm via the move doctests

exec
/opt/homebrew/bin/bash -lc "pwd && rg --files -g '"'!**/.claude/skills/**'"' -g '"'!**/.claude/**'"' -g '"'!**/node_modules/**'"' | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
/Users/ianbicking/src/callback-worktrees/remove-cardworks
pnpm-workspace.yaml
cardworks/src/jsx/jsx-runtime.ts
cardworks/src/jsx/index.ts
cardworks/src/jsx/create-element.ts
cardworks/src/jsx/types.ts
cardworks/src/jsx/factory.ts
cardworks/src/fs/node-fs.ts
cardworks/src/fs/glob-skip.ts
cardworks/src/fs/types.ts
cardworks/src/fs/memory-fs.ts
cardworks/src/index.ts
cardworks/src/refs/parse-ref.ts
cardworks/src/refs/resolve.ts
cardworks/src/refs/types.ts
cardworks/src/refs/xpath.ts
cardworks/src/loader/types.ts
cardworks/src/loader/path-utils.ts
cardworks/src/loader/loader.ts
cardworks/src/loader/ref-traversal.ts
cardworks/src/schema/card-schema.ts
cardworks/src/schema/format-error.ts
cardworks/src/schema/registry.ts
cardworks/src/schema/element.ts
cardworks/src/schema/base.ts
cardworks/src/parser/frontmatter.ts
cardworks/src/parser/dom-to-object.ts
cardworks/src/parser/parse.ts
cardworks/src/parser/provenance.ts
cardworks/src/serialize/serialize.ts
cardworks/src/card/index.ts
cardworks/src/card/card.ts
cardworks/src/lint/index.ts
cardworks/src/lint/format.ts
cardworks/src/lint/lint.ts
cardworks/CLAUDE.md
cardworks/eslint.config.mjs
cardworks/DESIGN.md
cardworks/tsconfig.json
cardworks/package.json
cardworks/README.md
cardworks/CONVENTIONS.md
cardworks/test/loader.test.ts
cardworks/test/card-schema.test.ts
cardworks/test/format-error.test.ts
cardworks/test/fixtures/With_Interleaved.technique.card
cardworks/test/fixtures/Simple.audience.card
cardworks/test/fixtures/With_Refs.tutorial.card
cardworks/test/fixtures/malformed.card
cardworks/test/jsx.test.ts
cardworks/test/lint.test.ts
cardworks/test/parser.test.ts
cardworks/test/schema.test.ts
cardworks/test/refs.test.ts
cardworks/test/glob.test.ts
cardworks/test/round-trip.test.ts
cardworks/knip.json
CLAUDE.md
agent-doctest/src/serialize.ts
agent-doctest/src/doctest-loader.ts
agent-doctest/src/check.ts
agent-doctest/src/doctest-hooks.mjs
agent-doctest/src/tap-check.ts
agent-doctest/src/match.ts
agent-doctest/eslint.config.mjs
agent-doctest/tsconfig.json
agent-doctest/package.json
agent-doctest/README.md
agent-doctest/docs/check-reference.md
agent-doctest/docs/getting-started.md
agent-doctest/docs/syntax.md
agent-doctest/test/serialize.doctest.md
agent-doctest/test/doctest.test.ts
agent-doctest/test/example.doctest.md
agent-doctest/test/check.test.ts
agent-doctest/LICENSE
browse/src/cli.ts
browse/src/worktree.ts
browse/src/screenshot.ts
browse/eslint.config.mjs
browse/tsconfig.json
browse/packages/agent-browser-typed/src/runner.ts
browse/packages/agent-browser-typed/src/index.ts
browse/package.json
krell-alarm-7.wav
tsconfig.json
package.json
dropbox-capture-icon.png
pnpm-lock.yaml
skills-lock.json
browse/packages/agent-browser-typed/package.json
new-icon.png
browse/packages/agent-browser-typed/src/commands/click.ts
browse/packages/agent-browser-typed/src/commands/set-viewport.ts
browse/packages/agent-browser-typed/src/commands/close.ts
browse/packages/agent-browser-typed/src/commands/fill.ts
browse/packages/agent-browser-typed/src/commands/press.ts
browse/packages/agent-browser-typed/src/commands/open.ts
browse/packages/agent-browser-typed/src/commands/screenshot.ts
browse/packages/agent-browser-typed/src/commands/get.ts
browse/packages/agent-browser-typed/src/commands/snapshot.ts
browse/README.md
feedback-review/CLAUDE.md
feedback-review/collect.ts
feedback-review/eslint.config.mjs
feedback-review/run-on-server.ts
patches/eslint-config-agent+1.9.3.patch
implementation-order.mmd
browse/packages/agent-browser-typed/help/snapshot.txt
docs/openclaw-architecture-review.md
callback-icon.png
docs/memory-atlas-architecture-review.md
browse/packages/agent-browser-typed/scripts/verify-help.ts
browse/packages/agent-browser-typed/help/screenshot.txt
docs/eslint-rule-suppression-audit.md
browse/packages/agent-browser-typed/help/get.txt
browse/packages/agent-browser-typed/help/click.txt
browse/packages/agent-browser-typed/help/set.txt
browse/packages/agent-browser-typed/help/fill.txt
browse/packages/agent-browser-typed/help/close.txt
browse/packages/agent-browser-typed/help/press.txt

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/docs/plans/remove-cardworks-package.md | sed -n '1,260p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	# Remove the cardworks package
     2	
     3	Delete the `cardworks` package from the monorepo. All six card schemas are
     4	now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
     5	large XML half of cardworks — parser, serializer, JSX, XPath, the
     6	`CardLoader`, the XML element schema — has no real users. This plan removes
     7	the dead XML code paths in callback-box, copies the small frontmatter-primitive
     8	core of cardworks into callback-box, and deletes the package, its
     9	`node_modules` symlink, the `workspace:*` dependency, and the
    10	`pnpm-workspace.yaml` entry.
    11	
    12	This is the follow-up round to `remove-cardworks-and-xml.md` (the schema
    13	migrations). Plan-only; nothing executes until approved and run end-to-end on
    14	this worktree branch.
    15	
    16	> **Load-bearing decision (settled): drop box-local XML schema support.**
    17	> The built-in `schemas[]` is empty, but boxes can still author *their own* XML
    18	> card types via `config/schemas/*.ts` + cardworks' `element()` — and two real
    19	> boxes do (`ledger-copy`/`ledger-shrink-test` define a `bill` schema in
    20	> `config/schemas/bill.ts`, with 23 `.bill.card` data files). So the XML loader
    21	> is **not** dead — it's live for box-authored schemas. This plan therefore
    22	> includes an explicit decision, confirmed with the boxholder, that **boxes may
    23	> define only frontmatter (`cardSchema`) card types going forward**; the
    24	> box-local `element()` path is removed, and existing box-local XML schemas
    25	> (the `bill` schema + its cards) are migrated to frontmatter as part of the
    26	> box-migration prerequisite before deletion. Without this decision the "dead
    27	> XML path" premise is false (see Cross-model review applied).
    28	
    29	## Cross-model review applied (Codex)
    30	
    31	A Codex (different model family) read this plan against the source and
    32	falsified several claims; the findings are folded in above and throughout:
    33	
    34	- **Box-local XML is live** (`test/box-schemas.doctest.md` proves a `gadget`
    35	  XML card loads; `loadBoxSchemas` segregates `elementSchemas`,
    36	  `src/schemas/registry.ts:257`). → New load-bearing decision (drop it) above;
    37	  Track A now *removes* that path rather than treating it as already-dead.
    38	- **`tsc` is not a complete safety net** (`callback-box/tsconfig.json` covers
    39	  only `src/**/*`, so `scripts/`, `test/`, box `config/schemas/*.ts` runtime
    40	  imports, and `dist/` are invisible to it). → Track B's completeness check is
    41	  grep-based across those surfaces, not typecheck-only.
    42	- **Don't delete `MIGRATIONS` entries** — `src/core/migrations.ts:6`: *"never
    43	  reorder or remove existing entries — the `name` is the manifest key."* →
    44	  Track C keeps the entries; spent XML migrator *scripts* may be stubbed, not
    45	  unlisted.
    46	- **Keep-set is not all copy-verbatim:** `SchemaRegistry`
    47	  (`cardworks/src/schema/registry.ts`) is `ElementSchema`/`.tagName`-oriented,
    48	  not a generic frontmatter registry; and the lint/`ParseError` `Location`
    49	  reads `startLine`/`startColumn`, not `line`/`column`
    50	  (`cardworks/src/lint/format.ts:37`). → Track B adapts these, not copies.
    51	- **`card`/`todos` tRPC endpoints are XML-only live API** (`card.ts:271`
    52	  patch, `todos.ts` updateItem) → an explicit keep-rewrite-or-remove decision,
    53	  not a silent delete (Open question 4).
    54	- **`ls --format` lives in two files** (the CLI wrapper `cli/commands/ls.ts:14`
    55	  registers the flag; core evaluates XPath) and the dotted-path helper is
    56	  private → both surfaces updated (Critical gap resolution).
    57	- **`dist/cli.mjs` has baked `cardworks` imports** → Track C rebuilds/validates
    58	  the artifact.
    59	
    60	A **second Codex pass on the revised plan** (the revision was same-model, so it
    61	carried my blind spots) found more:
    62	
    63	- **Box-local frontmatter schemas need a public import contract.** Box
    64	  `config/schemas/*.ts` import bare `"cardworks"` via a custom tsx resolver
    65	  (`SCHEMA_DEPS = {"cardworks","zod"}`, `src/schemas/registry.ts:97`), and
    66	  package.json has **no `exports` map** (`package.json:6`). After cardworks is
    67	  deleted, a migrated box schema (e.g. frontmatter `bill.ts`) has nothing to
    68	  import `cardSchema` from. → **New Track B requirement:** expose the primitives
    69	  under a public specifier — add an `exports` entry and have box schemas import
    70	  `callback-box/cards`, or keep `"cardworks"` as a resolver alias mapping to
    71	  `src/cards/`. This must land *before* deletion.
    72	- **The box-local-`element()` removal (Track A chunk 2) is NOT box-state
    73	  independent** — it breaks the ledger boxes' live `bill` schema, so it's gated
    74	  on the box-schema audit like Track C, not free to ship early.
    75	- **Drop `SchemaRegistry`, don't copy it** — it's reached only through the XML
    76	  `CardLoader`/`load-context.ts` bridges; once those go it has no user.
    77	- **`todos` is broken on *both* sides** — `TodoListView` parses XML
    78	  (`TodoListView.tsx:31`) and frontmatter responses set `element: undefined`
    79	  (`card.ts:152`), so the render *and* the edit need a frontmatter rewrite.
    80	- **`card.patch` removal has a REST-route + doctest tail**
    81	  (`api-card-routes.ts:71-120`, `test/routes-api.doctest.md:112-128`).
    82	- **Migrator wording fix** — Track C *stubs* the migrator scripts in place
    83	  (files remain, exit 0); it does not "delete" them.
    84	
    85	## Stated preferences this plan trades against
    86	
    87	- **`callback-box/CLAUDE.md`** — `CLAUDE.md:28` (current): *"Every built-in
    88	  schema is now frontmatter; the legacy XML-body format and its loader branch
    89	  remain in place but dormant (no schema uses them) until cardworks is
    90	  removed."* This plan makes that sentence's promise good. Also the "don't
    91	  add features beyond what the task requires" rule — we copy in only the
    92	  primitives that are actually imported, deleting the rest.
    93	- **`callback-box/CODE-STYLE.md`** — `CODE-STYLE.md:25` (no `any`),
    94	  `CODE-STYLE.md:55` (`as` is like Rust `unsafe`; centralize at parse
    95	  boundaries), `CODE-STYLE.md` files ≤300 lines. The copied-in primitives
    96	  already obey these (they're cardworks' own clean modules).
    97	- **The migration precedent** — `remove-cardworks-and-xml.md` shipped six
    98	  schema migrations using TypeScript's typecheck as the completeness check
    99	  (each migration's consumers were found by compile errors). This plan leans
   100	  on the same mechanism harder: it is the safety net (see Direction).
   101	
   102	## What already exists
   103	
   104	- **The XML loader branch — live for box-local schemas, made dead by this
   105	  plan.** `callback-box/src/core/card-io.ts:285`: *"export type LoadedCard =
   106	  FrontmatterLoadedCard | XmlLoadedCard"*; `card-io.ts:350` falls through to
   107	  `loadXmlCard` (`card-io.ts:370`). Built-in `schemas[]` is empty, but
   108	  `loadBoxSchemas` populates `elementSchemas` from `config/schemas/*.ts`
   109	  (`src/schemas/registry.ts:240`/`:257`) and `box-schemas.doctest.md` proves a
   110	  box `gadget` XML card loads — so the branch is **reachable** today. **Rebuild
   111	  (after the box-local-XML decision):** migrate existing box-local XML schemas
   112	  to frontmatter, remove the box-local `element()` path (the `elementSchemas`
   113	  half of `loadBoxSchemas`, `isElementSchema`, the gadget doctest, and the
   114	  `element()` scaffolding in `box-templates.ts:31`/`:126`), then collapse the
   115	  `LoadedCard` union to `FrontmatterLoadedCard` and delete `loadXmlCard`.
   116	- **The frontmatter primitives, in cardworks.** `cardSchema`/`body`/
   117	  `extractRefs` (`cardworks/src/schema/card-schema.ts`, 249 LOC, imports
   118	  `zod` only — copy-verbatim); `splitCardContent`
   119	  (`cardworks/src/parser/frontmatter.ts`, 65 LOC, zero imports — copy-verbatim);
   120	  `formatLintResults` (`cardworks/src/lint/format.ts`, 130 LOC) plus the
   121	  `LintSummary`/`LintResult`/`LintIssue` types from `lint/lint.ts`; `ParseError`
   122	  (`cardworks/src/parser/parse.ts`). **Caveats (Codex-verified, not
   123	  copy-verbatim):** (a) `SchemaRegistry` (`cardworks/src/schema/registry.ts`)
   124	  is `ElementSchema`/`.tagName`-keyed, **not** a generic frontmatter registry —
   125	  adapt it to `CardSchema`/`.type` or check whether callback-box's
   126	  `registry.ts` still needs it at all post-migration; (b) the `Location` these
   127	  carry reads `startLine`/`startColumn` (`format.ts:37`), not `line`/`column` —
   128	  the local minimal `Location` must match. ~560 LOC of *frontmatter* primitives,
   129	  but the copy is an adaptation, not a verbatim lift.
   130	- **The XML bulk, in cardworks, with no real consumer.** parser
   131	  (`parse.ts`/`dom-to-object.ts`/`provenance.ts`), `serialize/serialize.ts`,
   132	  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
   133	  `refs/resolve.ts` (261), `schema/element.ts`+`base.ts`,
   134	  `schema/format-error.ts`, `lint/lint.ts` (the engine), `card/*`, `fs/*`.
   135	  **Delete outright.**
   136	- **callback-box already owns its frontmatter card IO.**
   137	  `card-io.ts` `parseCardText` (`card-io.ts:114`) validates against
   138	  `schema.frontmatterSchema` (Zod) and formats its own Zod errors
   139	  (`card-io.ts:62` `formatZodIssues`) — it does *not* use cardworks'
   140	  `format-error.ts`. `card-lint.ts` has its own dispatcher and Markdoc
   141	  body-ref extraction (`body-refs.ts`). **Reuse:** these stay; only their
   142	  cardworks *imports* get repointed.
   143	- **Only callback-box consumes cardworks.** Verified: no imports in
   144	  `callback-clerk/`, `agent-doctest/`, or `personal-vibe-check/`.
   145	- **The migrators read old XML cards via cardworks.** `scripts/migrate/*.ts`
   146	  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
   147	  pre-migration XML box cards. This is the one place that still *needs* the
   148	  XML parser, and it is a sequencing constraint (see Open questions).
   149	
   150	## Prior art (external)
   151	
   152	Skip-with-rationale: this is a purely internal refactor — deleting a
   153	first-party workspace package and inlining ~560 LOC of its source. No
   154	third-party library behavior is in question. The one technique worth naming
   155	is **compiler-driven refactoring**: removing/!renaming the deleted exports so
   156	`tsc` enumerates every stale call site, rather than hunting them by grep. That
   157	is exactly how the six schema migrations were verified (each consumer surfaced
   158	as a type error), so it is established in-repo practice, not a novel bet. No
   159	external search performed; none warranted.
   160	
   161	## Tracks / scope
   162	
   163	Ordered by dependency: Track A removes dead/live XML consumers so nothing in
   164	callback-box imports a cardworks XML symbol; Track B copies the primitive core
   165	in and repoints the keep-set imports; Track C deletes the package and its
   166	wiring. The plan completes when cardworks is gone and the suite is green.
   167	
   168	### Track A — Sever callback-box from cardworks' XML surface
   169	
   170	**What.** Remove or rewrite every callback-box site that imports a cardworks
   171	XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
   172	`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
   173	`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
   174	only cardworks imports left are the frontmatter keep-set.
   175	
   176	**Why this needs to change.** These symbols are the API of the half of
   177	cardworks we're deleting. While they remain imported, cardworks can't go.
   178	Most sites are dead (unreachable now that no card is XML); a few are live and
   179	need a frontmatter replacement.
   180	
   181	**Direction.** Per the investigation, by disposition:
   182	
   183	- **Delete dead paths.** `card-io.ts` XML branch (`loadXmlCard`,
   184	  `XmlLoadedCard`, the `LoadedCard` union, `elementSchemas` in
   185	  `LoadCardContext`); `search/extract.ts` `xmlDoc`/`collectElementText` and
   186	  the `card.kind === "xml"` dispatch (`extract.ts:103`);
   187	  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
   188	  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
   189	  a frontmatter-field lookup (the dotted-path accessor already written for
   190	  landmark in `core/landmark/resolve.ts` is the model);
   191	  `preactions/transcribe.ts` XML transcription helpers;
   192	  `webapp/trpc/routers/todos.ts` (XML `loader.load`/mutate/`save`);
   193	  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
   194	- **CORRECTION (found during implementation): `procedure-trampoline.ts` is
   195	  NOT a dead path.** `detectProcedureInJob` (`procedure-trampoline.ts:22`) is
   196	  called live for every job card by the reactor (`engine.ts:344`), and
   197	  procedure-job cards are still **XML** (`<procedure ref="...">`) — the docs
   198	  (`generate-docs-procedure-guide.ts:40`) and triage
   199	  (`triage-instructions.ts`/`handle.ts`) actively generate that shape. This is
   200	  an un-migrated XML *feature*, not cleanup: removing cardworks here requires
   201	  its own subtask — a frontmatter procedure-job representation, a rewritten
   202	  detector, migration of existing box `<procedure>` job cards, and updated
   203	  doc/triage generators. Out of scope for the dead-path sweep; needs a
   204	  decision (subplan) before Track C can delete cardworks.
   205	- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
   206	  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
   207	  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
   208	  discovery and `loader.move()` for XML referrer re-serialization), and any
   209	  router that calls `createLoader`. The discovery use (`listCards()`) becomes
   210	  a glob/fs walk; the XML `move()` is dead (Phase-2 cards take
   211	  `movePhase2CardFiles`, and ref rewriting is already substring-based in
   212	  `rewrite-card-refs.ts`). `cli/commands/validate.ts` keeps
   213	  `formatLintResults` (it moves to the keep-set, Track B).
   214	- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
   215	  (`file-summary.ts`, `agent-guide/*`, `load-context.ts`, `preactions/types.ts`,
   216	  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
   217	  fields or now-empty code. Delete the XML field/branch; where a type is
   218	  genuinely still needed it is replaced by a local type or removed with the
   219	  dead path.
   220	
   221	**Completeness check — typecheck PLUS grep (Codex finding #2).** After
   222	repointing the keep-set (Track B), the deleted XML exports vanish and
   223	`pnpm typecheck` enumerates every stale consumer *in `src/`* — surfacing
   224	latent bugs like `chat.ts` reading a now-frontmatter landmark via `parseCard`
   225	or `generate-docs-compile.ts:47`. **But `tsc` is not sufficient:**
   226	`callback-box/tsconfig.json` covers only `src/**/*`, so it misses
   227	`scripts/*.ts` (e.g. `clean-broken-refs.ts` imports `splitCardContent`),
   228	`test/`, the `dist/` artifact, and — critically — box `config/schemas/*.ts`,
   229	which import `"cardworks"` at *runtime* via a custom resolver
   230	(`registry.ts:97`/`:122`) that no compile pass sees. The completeness gate is
   231	therefore: `pnpm typecheck && pnpm lint && pnpm test`, **plus**
   232	`grep -rl 'cardworks' callback-box/{src,scripts,test}` empty, **plus** the
   233	box-schema audit (`grep -rl 'cardworks' ~/src/boxes/*/config/schemas/`) clean,
   234	**plus** a `dist` rebuild (Track C).
   235	
   236	**First implementation chunk.** Delete the three unambiguously-dead,
   237	self-contained paths and confirm green: `card-io.ts` XML branch + union
   238	collapse; `search/extract.ts` `xmlDoc`; `ls.ts` `--format`/XPath. No open
   239	questions inside this chunk.
   240	
   241	### Track B — Copy the frontmatter primitives into callback-box
   242	
   243	**What.** Create a callback-box module (proposed `src/cards/`) holding the
   244	keep-set, and repoint every `from "cardworks"` keep-set import to it.
   245	
   246	**Why this needs to change.** `cardSchema`/`body`/`splitCardContent`/
   247	`CardSchema`/`SchemaRegistry`/`formatLintResults`/`ParseError` are imported by
   248	~50 callback-box files (every schema file plus `card-io.ts`, `card-lint.ts`,
   249	`registry.ts`, `validate.ts`). They must live in callback-box before cardworks
   250	can be deleted.
   251	
   252	**Direction.** New files under `src/cards/`:
   253	- `schema.ts` ← `cardworks/src/schema/card-schema.ts` (`cardSchema`, `body`,
   254	  `isBodyField`, `extractRefs`, types `CardSchema`/`BodyField`/`FieldDecl`).
   255	  Imports zod only — copy verbatim.
   256	- `frontmatter.ts` ← `cardworks/src/parser/frontmatter.ts` (`splitCardContent`).
   257	  Zero deps — copy verbatim.
   258	- **`SchemaRegistry` — drop it, don't copy** (Codex round 2). It keys on
   259	  `ElementSchema.tagName` and is reached only through the XML `CardLoader` /
   260	  `load-context.ts` bridges (`cli/lib/loader.ts:7`, `load-context.ts:7`); once

codex
I’ve got the high-level shape. The plan is explicit that some “delete outright” items are actually live displays or flows that need frontmatter rewrites, so I’m going to separate “cardworks import is dead” from “route/feature is dead”; that distinction is likely where the sharp edges are.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/docs/plans/remove-cardworks-deletion.md | sed -n '260,520p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
   260	  `movePhase2CardFiles` + substring rewriting). Confirm via the move doctests
   261	  that no frontmatter move needs `loader.move()`.
   262	- `core/sdk-hooks.ts:109` + `cli/commands/validate.ts:188/242/339` — these only
   263	  built the loader to feed `lintCardsDispatch` (now loader-free after C2) and to
   264	  `listCards()` (now a glob). Drop the `createLoader` calls.
   265	
   266	**Why this needs to change.** While any of these import a cardworks XML symbol,
   267	the package can't be deleted. The completeness proof is the typecheck: once
   268	Track C5 removes the imports' target, `tsc` enumerates anything missed — but
   269	because tsconfig covers only `src/**/*`, the grep sweep (below) backs it up.
   270	
   271	**First implementation chunk.** The pure deletes with no rewrite
   272	(`api-card-routes`/`api-card-patch`, `search/extract` `xmlDoc`,
   273	`transcribe` XML helpers, `preactions` XML branch) — self-contained, green
   274	after each. Then the two broken-path rewrites (verify-then-fix). Then the
   275	loader-user rewrites (gated on C2).
   276	
   277	### Track C4 — Drop box-local XML schema support (#11)
   278	
   279	**What.** Remove the `element()` / `ElementSchema` half of the box-schema and
   280	card-loading machinery, now that no box defines an XML schema.
   281	
   282	**Why this needs to change.** The parent settled this (header decision, boxholder
   283	confirmed): boxes may define only frontmatter `cardSchema` types. The ledger
   284	`bill` schema (the one box-local XML schema) is migrated. So the box-local XML
   285	path is now dead and removable.
   286	
   287	**Direction.**
   288	- `schemas/registry.ts` — drop `schemas: ElementSchema[] = []` (`:56`), the
   289	  `elementSchemas` field on `BoxSchemas` (`:181`), the `isElementSchema`
   290	  discriminator branch (`:249`/`:274`), and the `ElementSchema` loops in
   291	  `createSchemaRegistry`. Remove `cardworks` from `SCHEMA_DEPS` (`:108`) — box
   292	  schemas now import only `callback-box/cards`/`zod`/`yaml`.
   293	- `core/card-io.ts` — collapse `LoadedCard` to `FrontmatterLoadedCard` (drop
   294	  `XmlLoadedCard`, `:280`), delete `loadXmlCard` (`:365`) and the dispatch to it
   295	  (`:345`), the `CARD_XML_CONTENT_TYPE` constant and its XML body
   296	  validate/serialize branches (`:225`/`:262`), the `elementSchemas` field on
   297	  `LoadCardContext` (`:301`), and the `parseCard`/`ElementSchema`/`ElementNode`
   298	  imports (`:21`).
   299	- `core/load-context.ts` — drop the `elementSchemas` construction; keep
   300	  `cardSchemas`.
   301	- `core/card-lint.ts:89` — delete the `lintCard(options.loader, …)` XML fallback;
   302	  a frontmatter card with no matching schema becomes an explicit
   303	  skip/error-result rather than an XML lint. Drop the `lintCard`/`ICardLoader`
   304	  imports.
   305	- `core/box-templates.ts:106-169` — remove the "Legacy: XML / `element()`
   306	  schemas" scaffold section and the `import { element } from "cardworks"`
   307	  example; the template keeps only the `callback-box/cards` `cardSchema` form.
   308	- Retire the box `gadget`-XML doctest (`test/box-schemas.doctest.md`) if still
   309	  present.
   310	
   311	**First implementation chunk.** The `registry.ts` + `card-io.ts` union
   312	collapse (the two interlocking files) in one commit, with the box-schema
   313	doctest updated; green.
   314	
   315	### Track C5 — Delete the package and its wiring
   316	
   317	**What.** Remove `cardworks/`, the `callback-box/node_modules/cardworks`
   318	symlink, the `"cardworks": "workspace:*"` dep (`package.json`), and the
   319	`- cardworks` line in `pnpm-workspace.yaml`; **stub (do not unlist) the spent
   320	XML migrators** — replace each cardworks-importing `scripts/migrate/*.ts` with
   321	an obsolete no-op while **keeping its `MIGRATIONS` entry** (`migrations.ts:6`:
   322	the `name` is an append-only manifest key); `pnpm install` to settle the
   323	lockfile; **rebuild and validate `dist/`** (`dist/cli.mjs` bakes cardworks
   324	imports — a stale artifact would carry dead imports); update docs.
   325	
   326	**Why this needs to change.** The goal. The migrators were the last legitimate
   327	cardworks consumer (they read pre-migration XML via `parseCard`); every box is
   328	migrated, so they're spent and get stubbed in the same push.
   329	
   330	**Gate.** Runs only when C1–C4 make `grep -rl cardworks
   331	callback-box/{src,scripts,test}` empty for `src` (migrators are stubbed here, so
   332	they're the last to clear) **and** the box-schema audit
   333	(`grep -rl cardworks ~/src/boxes/*/config/schemas/` + the server boxes) is
   334	clean. Doc updates: `CLAUDE.md:28` (the dormant-loader sentence),
   335	`CLAUDE.md:87`/`docs/adding-schemas.md` (the cardworks bullet → `src/cards/`),
   336	`docs/migrations.md` (retire deleted-migrator references).
   337	
   338	**First implementation chunk.** Delete package + wiring + stub migrators +
   339	`pnpm install` + `dist` rebuild, with a final clean
   340	`typecheck && lint && test` and an empty `grep` sweep.
   341	
   342	## Subplans
   343	
   344	None. C1 (#17) carries the one real unknown and is structured as a
   345	spike-first chunk (prove the bundle resolves the built `./cards` before any
   346	deletion), not a separate design step.
   347	
   348	## Failure modes
   349	
   350	| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
   351	|---|---|---|---|
   352	| `callback-box/cards` doesn't resolve under the bundled `cb` after deletion | No | C1 spike proves it on a real box before deletion | **Silent until a box schema loads at runtime** — the spike is the gate |
   353	| The frontmatter ref-existence checker (C2) wrongly reports "exists", suppressing a broken-ref warning | New doctest (C2) | Mirror cardworks `resolveRef` semantics; cover `attach/` scope | **Silent** (warnings nobody sees fail) — the doctest is the guard |
   354	| `attach/`-scope refs resolve wrong (the one non-trivial ref rule) | New doctest (C2) | Honor the `attach/` rule explicitly | **Silent** — doctest covers a known-good `attach/` ref |
   355	| `chat.ts` landmark summaries already empty; rewrite doesn't restore them | No (verify-first) | Verify current breakage, then rewrite | Currently **silent** (try/catch → empty); rewrite + manual check |
   356	| `generate-docs-compile.ts` procedure names/descriptions already missing | No (verify-first) | Verify, then rewrite to frontmatter | Currently **silent** (try/catch → skip) |
   357	| `move-operations.ts` loses a referrer-rewrite that XML `loader.move()` did | Yes — move doctests | Phase-2 move + substring rewrite already own this | Clear (move doctests) |
   358	| A `scripts/` or box `config/schemas/*.ts` cardworks import (not in tsconfig) | No | Grep sweep gate (tsc doesn't see these) | **Silent until runtime** — grep, not compiler |
   359	| Stubbing a migrator removes its `MIGRATIONS` entry → shifts a box's applied set | No | Keep entries; stub scripts only (`migrations.ts:6`) | Clear-but-fatal if violated |
   360	| Stale `dist/cli.mjs` keeps baked cardworks imports | No | C5 rebuilds + validates dist | Clear (import error if dist runs) |
   361	| `card-lint.ts` no-matching-schema path: removing the XML fallback changes behavior for an unknown card type | Partial — validate doctests | Explicit skip/error-result replaces the XML lint | Clear (validate output) |
   362	
   363	**Critical gap: the frontmatter ref-existence checker (C2).** It is the one
   364	new codepath whose failure is silent *and* security-adjacent to data integrity
   365	(broken refs are how the system surfaces stale links). It must land with a
   366	doctest that asserts the warning set for a broken ref, a good ref, and an
   367	`attach/`-scoped ref before C3 removes the old loader. Resolution: the C2 chunk
   368	is doctest-first.
   369	
   370	## Agent-flow / user-flow edge cases
   371	
   372	- **Wrong tag / wrong field** — **N/A.** No new vocabulary; internal deletion.
   373	- **Stale ref** — **ADDRESSED.** This plan *reimplements* the stale-ref check
   374	  (C2); the doctest is exactly the stale-ref scenario, including `attach/`.
   375	  Behavior must match today's (warning, not error — `card-lint.ts:105-111`).
   376	- **Two agents touching the same card** — **N/A.** No card-write path changes;
   377	  `card-io.ts` parse-mutate-reserialize untouched except the XML branch
   378	  collapse.
   379	- **Hand-edit drift** — **ADDRESSED.** The `unknownKeyWarnings` path
   380	  (`card-lint.ts:154`) is untouched; drifted frontmatter still warns.
   381	- **Fabricated free-form value** — **N/A.** No new fields.
   382	- **Validation error UX** — **ADDRESSED.** `card-io.ts:62` `formatZodIssues`
   383	  (the agent-facing validator) and the copied `formatLintResults` (the CLI
   384	  formatter) are both untouched; only the broken-ref *source* changes (C2), and
   385	  its message string matches today's (`card-lint.ts:123`).
   386	- **Partial migration / transition state** — **ADDRESSED.** The transition is
   387	  compile-time, not data — all boxes are already migrated. The worktree never
   388	  ships a half-state: the plan completes (cardworks gone, green) before merge.
   389	
   390	## NOT in scope
   391	
   392	- **Re-implementing the XML loader/serializer/XPath/JSX.** Zero consumers;
   393	  deletion beats porting.
   394	- **Box data migration.** Already complete (the user's separate, finished
   395	  effort) — this plan's gate, not its work.
   396	- **Reworking the photo-bundle feature** beyond severing its XML mutation. If
   397	  `scan-import` bundle-analysis is still wanted, its frontmatter rewrite is a
   398	  small follow-up; if it's vestigial, it's deleted (Open question 1). Either
   399	  way the XML path goes.
   400	- **A general npm-vendoring mechanism.** We delete one first-party package; no
   401	  reusable infra.
   402	- **Changing `.card` semantics, ref syntax, or the `attach/` rule.** C2
   403	  preserves them exactly.
   404	
   405	## Open design questions
   406	
   407	1. **`scan-import` photo-bundle: rewrite or delete?** The XML element-tree
   408	   mutation (`scan-import-cards.ts:171-233`) is dead. Whether the
   409	   bundle-analysis-into-image-card feature is still used (image cards are
   410	   frontmatter now) determines rewrite-to-frontmatter vs delete. **Lean:**
   411	   check for live callers / a connector that triggers it; if none, delete.
   412	   Settle at the C3 chunk, not before.
   413	2. **C1 resolution mechanism.** Lean is (a) a `dist/cards` build + `exports`
   414	   `./cards` → built JS. The spike confirms the bundle resolves it; if it
   415	   doesn't, fall back to (b) the tsx-source resolver. Not an open question
   416	   *inside* the first chunk — the chunk *is* running the spike to decide.
   417	3. **`card-lint.ts` no-matching-schema behavior.** Today an unknown card type
   418	   falls to cardworks `lintCard` (XML). After removal it should
   419	   skip-with-no-issues (a non-card or pre-init file shouldn't error) vs
   420	   error (a typo'd `.card` should be caught). **Lean:** skip cleanly — the
   421	   filename-type discriminator already gates real cards; an unmatched `.card`
   422	   is drift, surfaced elsewhere (`unknownKeyWarnings`). Confirm against the
   423	   validate doctests.
   424	
   425	## Knowledge audits
   426	
   427	Skip-with-rationale: no new agent-facing concept. The one agent-facing fact
   428	(*cards are never XML; the filename is the type discriminator; no `type:`
   429	field*) landed with the schema migrations and lives in `CLAUDE.md:28`/`:39`.
   430	The box-schema scaffold change (C4: drop the `element()` section) makes the
   431	template match that existing understanding rather than introducing anything new.
   432	
   433	## Implementation order
   434	
   435	1. **C1 (#17) — spike the public specifier under the bundle.** Build
   436	   `dist/cards`, set `exports` `./cards`, prove a box schema importing
   437	   `callback-box/cards` loads under `bin/cb validate`. Repoint deployed `bill`
   438	   schemas. **Gate for everything else.**
   439	2. **C2 — frontmatter ref-existence checker + doctest**, repoint `card-lint.ts`,
   440	   drop the lint dispatcher's loader field. Green. (Independent of C3/C4.)
   441	3. **C3 chunk 1 — pure deletes** (`api-card-routes`/`api-card-patch`,
   442	   `search/extract` `xmlDoc`, `transcribe` XML helpers, `preactions` XML
   443	   branch, `file-summary`/`agent-guide` type repoints). Green per commit.
   444	4. **C3 chunk 2 — verify-then-rewrite the two broken paths** (`chat.ts`
   445	   landmark, `generate-docs-compile.ts` procedure).
   446	5. **C3 chunk 3 — rewrite the live `CardLoader` users** (`move-operations.ts`
   447	   glob + drop dead `move()`, `status.ts`/`api-browse.ts` frontmatter listing,
   448	   delete `cli/lib/loader.ts` + the `createLoader` calls in `sdk-hooks`/
   449	   `validate`/routers).
   450	6. **C4 — drop box-local XML support** (`registry.ts` + `card-io.ts` union
   451	   collapse together, `load-context.ts`, `box-templates.ts` scaffold, the
   452	   gadget doctest). Green.
   453	7. **C5 — delete cardworks** + symlink + dep + workspace entry, stub the spent
   454	   migrators (keep `MIGRATIONS` entries), `pnpm install`, rebuild/validate
   455	   `dist`, update docs. Final gate: `typecheck && lint && test` clean +
   456	   `grep -rl cardworks src scripts test` empty + box-schema audit clean.
   457	
   458	Dependencies: C1 gates all deletion (box schemas break without it). C2 must
   459	land before C3-chunk-3 (it removes the lint loader dependency) and before C5
   460	(the last live loader use). C3+C4 make the `src/` cardworks imports vanish; C5
   461	deletes the target and the typecheck enumerates anything missed.
   462	
   463	## Rollout shape
   464	
   465	- **Test posture.** No new behavior except the C2 ref-checker, which gets a
   466	  doctest (the one regression-risk piece — broken-ref warnings are silent if
   467	  wrong). The existing suite (~2172) + `pnpm typecheck` is the completeness
   468	  proof for the deletions; the grep sweep backs up the tsconfig blind spots.
   469	- **Knowledge-audit entries.** None (see Knowledge audits).
   470	- **Migration approach.** No box-data migration here — already done. The only
   471	  data-adjacent step is repointing deployed `bill` schemas to
   472	  `callback-box/cards` (C1), done in this push.
   473	- **Ship as one unit.** Merge to main only when cardworks is gone and
   474	  `typecheck`/`lint`/`test` are clean — never a state where `src/cards/` and
   475	  cardworks both supply a primitive. Per the plan discipline and the user's
   476	  standing instruction, the merge is a separate signal from the user, not
   477	  agent-triggered. Auto-deploy fires on the main merge (`dist` must be rebuilt
   478	  first — C5).

exec
/opt/homebrew/bin/bash -lc "rg -n \"cardworks|CardLoader|parseCard|ElementNode|ElementSchema|lintCard|SchemaRegistry|MemoryCardLoader|resolveRef|loader\\.move|loader\\.listCards|api/card|loadLandmarkSummaries|generate-docs-compile\" callback-box/src callback-box/test callback-box/scripts -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/cards/errors.ts:2: * Card parse error. Absorbed from the former `cardworks` package
callback-box/src/connectors/gmail-drafts.ts:20:import { parseCardText } from "../core/card-io.js";
callback-box/src/connectors/gmail-drafts.ts:133:  const parsed = parseCardText(content, {
callback-box/src/connectors/gmail-drafts.ts:232:    const parsed = parseCardText(content, {
callback-box/src/cards/lint-format.ts:4: * Absorbed from the former `cardworks` package (lint/format.ts + the result
callback-box/src/cards/frontmatter.ts:16: * (Absorbed from the former `cardworks` package — see
callback-box/src/cards/frontmatter.ts:17: * docs/implemented-plans/remove-cardworks-package.md.)
callback-box/src/cards/schema.ts:13: * (Absorbed from the former `cardworks` package — see
callback-box/src/cards/schema.ts:14: * docs/implemented-plans/remove-cardworks-package.md.)
callback-box/src/shared/markdoc-config.ts:174:    // ref-tracking walks for and what the cardworks frontmatter convention
callback-box/src/cards/index.ts:4: * `cardworks` package (see docs/implemented-plans/remove-cardworks-package.md).
callback-box/scripts/build-cli.mjs:7:// __dirname / asset resolution intact. cardworks resolves to its built dist.
callback-box/scripts/migrate/landmark.ts:47:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/landmark.ts:79:function text(el: ElementNode): string {
callback-box/scripts/migrate/landmark.ts:83:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/landmark.ts:87:function children(el: ElementNode, tag: string): ElementNode[] {
callback-box/scripts/migrate/landmark.ts:103:function convertNavigation(nav: ElementNode, source: string, warnings: WarningCollector): Record<string, unknown> | undefined {
callback-box/scripts/migrate/landmark.ts:164:function convertDestination(el: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/landmark.ts:195:    const root = await parseCard(content, { source: absPath });
callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/index.ts:50:  allSchemas?: ElementSchema[];
callback-box/src/webapp/routes/views.ts:21:import type { ElementNode } from "cardworks";
callback-box/src/webapp/routes/views.ts:28:function elementToViewCardChild(el: ElementNode): ViewCardChild {
callback-box/src/webapp/routes/views.ts:38:      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
callback-box/src/webapp/routes/views.ts:187:      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
callback-box/scripts/migrate/bill.ts:33:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/bill.ts:65:function text(el: ElementNode): string {
callback-box/scripts/migrate/bill.ts:68:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/bill.ts:71:function attr(el: ElementNode, name: string): string | undefined {
callback-box/scripts/migrate/bill.ts:76:function convertSources(el: ElementNode): Array<Record<string, unknown>> {
callback-box/scripts/migrate/bill.ts:89:function convertPayment(el: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/bill.ts:131:    const root = await parseCard(content, { source: absPath });
callback-box/scripts/migrate/guide.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/guide.ts:58:function text(el: ElementNode): string {
callback-box/scripts/migrate/guide.ts:62:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/guide.ts:66:function childText(el: ElementNode, tag: string): string | undefined {
callback-box/scripts/migrate/guide.ts:73:function strAttr(el: ElementNode, name: string): string | undefined {
callback-box/scripts/migrate/guide.ts:82:function convertRule(r: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/guide.ts:91:function convertExperiment(e: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/guide.ts:121:    const root = await parseCard(content, { source: absPath });
callback-box/src/webapp/routes/api-card-patch.ts:2: * Element-sanitization helper for the REST API's `GET /api/card/*` route.
callback-box/src/webapp/routes/api-card-patch.ts:4: * Converts a cardworks `ElementNode` (legacy XML card tree) into a
callback-box/src/webapp/routes/api-card-patch.ts:9:import type { ElementNode } from "cardworks";
callback-box/src/webapp/routes/api-card-patch.ts:22: * Convert an ElementNode to a JSON-safe structure.
callback-box/src/webapp/routes/api-card-patch.ts:24:export function sanitizeElement(el: ElementNode): JsonElement {
callback-box/src/webapp/routes/api-card-patch.ts:44:    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:9:export function cardTypesSection(allSchemas: ElementSchema[]): string[] {
callback-box/scripts/migrate/personality.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/personality.ts:97:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/personality.ts:101:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/personality.ts:108:function convertWithEvidence(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/personality.ts:116:function convertExperiment(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/personality.ts:139:function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/personality.ts:244:  const node = await parseCard(raw, { source: absPath });
callback-box/src/webapp/routes/api.ts:8: *   api-card-routes.ts — GET /api/card/* (helpers in api-card-patch.ts)
callback-box/src/webapp/routes/api.ts:98:  // /api/card/* — load a single card
callback-box/scripts/migrate/misc.ts:16:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/misc.ts:97:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/misc.ts:101:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/misc.ts:108:function convertItem(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:126:function convertTodoList(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:146:function convertTelegramMessage(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:174:function convertFeedback(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/misc.ts:225:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/chat-thread.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/chat-thread.ts:25:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/chat-thread.ts:83:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/chat-thread.ts:90:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/chat-thread.ts:142:  const node = await parseCard(raw, { source: absPath });
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:277:> import { element, escapeText } from "cardworks";
callback-box/scripts/migrate/doc-sheet.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/doc-sheet.ts:73:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/doc-sheet.ts:77:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/doc-sheet.ts:81:function convertDoc(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/doc-sheet.ts:121:function convertSheet(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/doc-sheet.ts:167:  const node = await parseCard(raw, { source: absPath });
callback-box/src/schemas/feedback.tsx:57:  the cardworks \`path#fragment\` form, e.g.
callback-box/src/connectors/telegram-output-cards.ts:12:import { parseCardText, serializeCardText } from "../core/card-io.js";
callback-box/src/connectors/telegram-output-cards.ts:52:      const card = parseCardText(content, { source: relPath, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/connectors/telegram-output-cards.ts:53:      // Parse boundary: parseCardText validated against the schema.
callback-box/src/webapp/routes/api-browse.ts:13:import { parseCardName } from "../../cli/lib/paths.js";
callback-box/src/webapp/routes/api-browse.ts:72:        const parsed = parseCardName(entry.name);
callback-box/src/webapp/routes/api-browse.ts:92:        const parsed = parseCardName(entry.name);
callback-box/src/webapp/routes/scheduler.ts:16:import { parseCardText } from "../../core/card-io.js";
callback-box/src/webapp/routes/scheduler.ts:116:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/init-rules.ts:90:  // both legacy XML schemas (ElementSchema with `tagName`) and phase-2
callback-box/scripts/migrate/memo.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/memo.ts:57:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/memo.ts:61:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/memo.ts:68:function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/memo.ts:123:  const node = await parseCard(raw, { source: absPath });
callback-box/src/core/preactions/index.ts:11: * - Phase 1 XML-bodied cards (loaded via cardworks ICardLoader)
callback-box/src/core/preactions/index.ts:21:import type { ICardLoader } from "cardworks";
callback-box/src/core/preactions/index.ts:50:  loader: ICardLoader;
callback-box/src/core/preactions/index.ts:91:  loader: ICardLoader;
callback-box/src/schemas/index.ts:8:  createSchemaRegistry,
callback-box/src/cli/commands/render.ts:83:        // Use the frontend tsconfig so JSX resolves to React (not cardworks)
callback-box/src/core/preactions/types.ts:1:import type { Card, ICardLoader } from "cardworks";
callback-box/src/core/preactions/types.ts:7: * via cardworks's XML loader (Phase 1) or via the frontmatter card-io
callback-box/src/core/preactions/types.ts:20:  loader: ICardLoader;
callback-box/src/core/box-file-watcher.ts:23: * on 2026-06-11). Same shape as cardworks' GLOB_SKIP_DIRS.
callback-box/scripts/migrate/scheduled-script.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/scheduled-script.ts:29:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/scheduled-script.ts:75:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/scheduled-script.ts:82:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/scheduled-script.ts:158:  const node = await parseCard(raw, { source: absPath });
callback-box/src/webapp/routes/api-card-routes.ts:6: *   GET /api/card/* — load a card, return its xml + sanitized element tree
callback-box/src/webapp/routes/api-card-routes.ts:22: * Register the `/api/card/*` GET + PATCH routes on the Fastify server.
callback-box/src/webapp/routes/api-card-routes.ts:27:  // GET /api/card/:path - Get a single card's content
callback-box/src/webapp/routes/api-card-routes.ts:29:    "/api/card/*",
callback-box/src/core/preactions/transcribe.ts:18:import type { ElementNode } from "cardworks";
callback-box/src/core/preactions/transcribe.ts:165:function hasXmlTranscription(element: ElementNode): boolean {
callback-box/src/core/preactions/transcribe.ts:170:function hasXmlPermanentError(element: ElementNode): boolean {
callback-box/src/core/preactions/transcribe.ts:175:function getXmlContent(element: ElementNode): string | null {
callback-box/src/core/preactions/transcribe.ts:181:  element: ElementNode;
callback-box/src/core/preactions/transcribe.ts:204:  element: ElementNode,
callback-box/src/core/generate-docs-shared.ts:5: * `generate-docs-compile.ts` (compile/scan helpers) so both can depend on it
callback-box/src/webapp/context.ts:13:import { parseCardText } from "../core/card-io.js";
callback-box/src/webapp/context.ts:41:      const card = parseCardText(content, { source: q.path, schemas });
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:25:> import { element } from "cardworks";
callback-box/scripts/migrate/procedure-run.ts:17:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/procedure-run.ts:46:function text(el: ElementNode): string {
callback-box/scripts/migrate/procedure-run.ts:50:function childText(el: ElementNode, tag: string): string | undefined {
callback-box/scripts/migrate/procedure-run.ts:57:function copyAttr(from: ElementNode, name: string, into: Record<string, unknown>, key: string): void {
callback-box/scripts/migrate/procedure-run.ts:62:function convertPhase(phase: ElementNode | undefined, kind: "precheck" | "run" | "validate"): Record<string, unknown> | undefined {
callback-box/scripts/migrate/procedure-run.ts:81:function convertStep(step: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure-run.ts:105:    const root = await parseCard(content, { source: absPath });
callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/src/core/load-context.ts:9:import { createCardSchemaMap, createSchemaRegistry } from "../schemas/registry.js";
callback-box/src/core/load-context.ts:12:  const registry = await createSchemaRegistry(boxRoot);
callback-box/src/core/load-context.ts:13:  const elementSchemas = new Map<string, ElementSchema>();
callback-box/src/core/load-context.ts:16:    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/scripts/migrate/question.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/question.ts:27:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/question.ts:78:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/question.ts:85:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/question.ts:154:  const node = await parseCard(raw, { source: absPath });
callback-box/src/schemas/registry.ts:2: * Central schema registration with cardworks.
callback-box/src/schemas/registry.ts:5: * by the CardLoader factory. Box-local schemas from config/schemas/
callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema } from "cardworks";
callback-box/src/schemas/registry.ts:54: * path remain until cardworks itself is removed in a follow-up.
callback-box/src/schemas/registry.ts:56:export const schemas: ElementSchema[] = [];
callback-box/src/schemas/registry.ts:105: * - `cardworks` — legacy alias, still resolvable while boxes migrate their
callback-box/src/schemas/registry.ts:106: *   schema files to `callback-box/cards`; goes away with cardworks itself.
callback-box/src/schemas/registry.ts:108:const SCHEMA_DEPS = new Set(["callback-box", "zod", "yaml", "cardworks"]);
callback-box/src/schemas/registry.ts:113: * resolve bare deps (`zod`, `cardworks`) from callback-box's node_modules
callback-box/src/schemas/registry.ts:125: * legacy `cardworks` alias even though none of those resolve from the
callback-box/src/schemas/registry.ts:181:  /** Frontmatter card schemas (cardworks CardSchema, keyed by `.type`). */
callback-box/src/schemas/registry.ts:183:  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
callback-box/src/schemas/registry.ts:184:  elementSchemas: ElementSchema[];
callback-box/src/schemas/registry.ts:235:  const loadedElement: ElementSchema[] = [];
callback-box/src/schemas/registry.ts:238:  // and register resolve hooks so bare specifiers (cardworks, zod) resolve
callback-box/src/schemas/registry.ts:249:      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
callback-box/src/schemas/registry.ts:250:      // Zod type carrying `.tagName`; check it first, because ElementSchema also
callback-box/src/schemas/registry.ts:254:      if (isElementSchema(def)) {
callback-box/src/schemas/registry.ts:274:function isElementSchema(def: unknown): def is ElementSchema {
callback-box/src/schemas/registry.ts:275:  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
callback-box/src/schemas/registry.ts:288: * Create a SchemaRegistry populated with all known schemas.
callback-box/src/schemas/registry.ts:292:export async function createSchemaRegistry(boxRoot?: string): Promise<SchemaRegistry> {
callback-box/src/schemas/registry.ts:293:  const registry = new SchemaRegistry();
callback-box/src/schemas/registry.ts:311:export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
callback-box/src/core/rewrite-card-refs.ts:52:function resolveRefToAbs(params: {
callback-box/src/core/rewrite-card-refs.ts:104:    const abs = resolveRefToAbs({ boxRoot, cardAbsPath, pathPart });
callback-box/src/core/rewrite-card-refs.ts:138:    const abs = resolveRefToAbs({ boxRoot, cardAbsPath: oldCardAbs, pathPart });
callback-box/scripts/migrate/_warnings.ts:18:import type { ElementNode } from "cardworks";
callback-box/scripts/migrate/_warnings.ts:49:  node: ElementNode;
callback-box/test/card-lint.doctest.md:3:`lintCardsDispatch` is the validate-time counterpart to
callback-box/test/card-lint.doctest.md:14:  type ElementSchema,
callback-box/test/card-lint.doctest.md:15:} from "cardworks";
callback-box/test/card-lint.doctest.md:18:import { lintCardsDispatch } from "../src/core/card-lint.js";
callback-box/test/card-lint.doctest.md:55:const memoSchema: ElementSchema = element("memo", {
callback-box/test/card-lint.doctest.md:67:  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
callback-box/test/card-lint.doctest.md:84:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:104:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:128:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:154:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:183:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:215:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:245:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:253:## XML cards still flow through the existing cardworks lintCard path
callback-box/test/card-lint.doctest.md:262:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:282:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:303:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:327:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:349:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:366:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:383:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:409:const result = await lintCardsDispatch(
callback-box/src/dev/doc-graph-data.ts:85:function resolveRef(ref: string, { fromFile, allFiles, basenameLookup }: ResolveContext): [string, boolean] {
callback-box/src/dev/doc-graph-data.ts:120:      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
callback-box/src/dev/doc-graph-data.ts:131:      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
callback-box/src/dev/doc-graph-data.ts:142:      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
callback-box/src/core/state.ts:10:import { getBoxDir, parseCardName, requireBoxRoot } from "../cli/lib/paths.js";
callback-box/src/core/state.ts:86:    const parsed = parseCardName(name);
callback-box/src/cli/commands/tick.ts:14:import { parseCardText } from "../../core/card-io.js";
callback-box/src/cli/commands/tick.ts:104:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/scripts/migrate/procedure.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/procedure.ts:50:function dtext(el: ElementNode): string {
callback-box/scripts/migrate/procedure.ts:54:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/procedure.ts:58:function convertPhase(phase: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure.ts:84:function convertStep(step: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure.ts:123:    const root = await parseCard(content, { source: absPath });
callback-box/src/core/card-lint.ts:6: * are validated through parseCardText (Zod schema check); everything
callback-box/src/core/card-lint.ts:7: * else falls through to cardworks' existing XML lintCard. Results are
callback-box/src/core/card-lint.ts:18: * it lives on each schema as a `validate` hook (cardworks), invoked generically
callback-box/src/core/card-lint.ts:24:import { lintCard, type ICardLoader } from "cardworks";
callback-box/src/core/card-lint.ts:34:import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
callback-box/src/core/card-lint.ts:38:  loader: ICardLoader;
callback-box/src/core/card-lint.ts:46:export async function lintCardsDispatch(
callback-box/src/core/card-lint.ts:89:  return lintCard(options.loader, { path });
callback-box/src/core/card-lint.ts:101:    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
callback-box/src/core/card-lint.ts:110:  // out of parseCardText as a thrown CardIOError → errorResult above)
callback-box/src/core/card-lint.ts:118:      const resolved = await options.loader.resolveRef(ref, path);
callback-box/src/core/card-lint.ts:163:    // parseCardText (which threw → errorResult); nothing to add here.
callback-box/src/core/card-lint.ts:199:  // The cardworks formatter prints the file path as a header above each
callback-box/src/core/body-refs.ts:6: * `refs`) in parsed objects. Card bodies are strings as far as cardworks
callback-box/src/core/body-refs.ts:16: * Lives in callback-box (not cardworks) on purpose: cardworks is body-
callback-box/scripts/migrate/delete-deprecated-cards.ts:11: * "no XML remains" end state for the cardworks removal. Git history is the
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:8:import { parseCardText } from "../../../core/card-io.js";
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:144:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/webapp/trpc/routers/todos.ts:12:import { parseCardText, serializeCardText, typeFromFilename } from "../../../core/card-io.js";
callback-box/src/webapp/trpc/routers/todos.ts:68:        parsed = parseCardText(content, { source: fullPath, schemas: cardSchemas, type: "todo-list" });
callback-box/src/webapp/trpc/routers/todos.ts:73:      // parseCardText validated the fields against TodoListSchema, so the
callback-box/src/core/box-templates.ts:106:From \`cardworks\` (legacy — only for \`element()\` XML schemas, see below):
callback-box/src/core/box-templates.ts:166:import { element } from "cardworks";
callback-box/scripts/migrate/jobs.ts:18:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/jobs.ts:102:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/jobs.ts:106:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/jobs.ts:113:function convertIntakeJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:135:function convertCalendarReviewJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:165:function convertChatJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:181:function convertQuestionFollowupJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:198:const CONVERTERS: Record<Kind, (n: ElementNode, src: string) => Record<string, unknown>> = {
callback-box/scripts/migrate/jobs.ts:209:  const node = await parseCard(raw, { source: absPath });
callback-box/test/card-io.doctest.md:4:module) owns YAML parsing; cardworks provides the schema primitives
callback-box/test/card-io.doctest.md:14:  type ElementSchema,
callback-box/test/card-io.doctest.md:15:} from "cardworks";
callback-box/test/card-io.doctest.md:17:  parseCardText,
callback-box/test/card-io.doctest.md:51:const card = parseCardText(text, { source: "thread.email-thread.card", schemas });
callback-box/test/card-io.doctest.md:63:const card = parseCardText(text, { source: "x.doc.card", schemas });
callback-box/test/card-io.doctest.md:75:  try { parseCardText(text, { source, schemas }); return "did not throw"; }
callback-box/test/card-io.doctest.md:92:const parsed = parseCardText(text, { source: "rt.doc.card", schemas });
callback-box/test/card-io.doctest.md:101:  try { parseCardText(text, { source, schemas }); return "did not throw"; }
callback-box/test/card-io.doctest.md:119:const drifted = parseCardText("---\ntype: doc\ndrive-id: d1\ntitle: T\nbogus-field: oops\n---\n", { source: "typo.doc.card", schemas });
callback-box/test/card-io.doctest.md:128:const ct = parseCardText("---\ntype: email-thread\nthread-id: t1\nsubject: hi\ncontent-type: text/plain\nparticipants:\n  - a@x\n---\n", { source: "ct.email-thread.card", schemas });
callback-box/test/card-io.doctest.md:136:const xmlMemo: ElementSchema = element("memo", {
callback-box/test/card-io.doctest.md:145:  elementSchemas: new Map<string, ElementSchema>([
callback-box/test/capture-pipeline.test.ts:22:import { parseCardText, serializeCardText } from "../src/core/card-io.js";
callback-box/test/capture-pipeline.test.ts:82:    const parsed = parseCardText(content, {
callback-box/test/capture-pipeline.test.ts:143:    const parsed = parseCardText(content, {
callback-box/src/core/schedule-health-box.ts:22:import { parseCardText } from "./card-io.js";
callback-box/src/core/schedule-health-box.ts:102:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/scripts/migrate/file.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/file.ts:53:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/file.ts:57:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/file.ts:104:  const node = await parseCard(raw, { source: absPath });
callback-box/src/core/file-summary.ts:13:import type { ElementNode } from "cardworks";
callback-box/src/core/file-summary.ts:36:  element?: ElementNode;
callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/test/search-extract.doctest.md:21:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/src/cli/commands/validate.ts:18:import { lintCardsDispatch } from "../../core/card-lint.js";
callback-box/src/cli/commands/validate.ts:190:  const summary = await lintCardsDispatch([fp], { loader, ctx });
callback-box/src/cli/commands/validate.ts:236:  const cardSummary = all.length > 0 ? await lintCardsDispatch(all, { loader, ctx }) : null;
callback-box/src/cli/commands/validate.ts:242:  const cardPaths = (await loader.listCards()).filter((p) => !isTrashedCard(p));
callback-box/src/cli/commands/validate.ts:243:  const cardSummary = await lintCardsDispatch(cardPaths, { loader, ctx });
callback-box/src/cli/commands/validate.ts:260:  const cardSummary = cardPaths.length > 0 ? await lintCardsDispatch(cardPaths, { loader, ctx }) : null;
callback-box/scripts/migrate/audio.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/audio.ts:55:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/audio.ts:59:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/audio.ts:113:  const node = await parseCard(raw, { source: absPath });
callback-box/src/webapp/trpc/routers/card.ts:7:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/card.ts:9:import { parseCardText } from "../../../core/card-io.js";
callback-box/src/webapp/trpc/routers/card.ts:23:function sanitizeElement(el: ElementNode): JsonElement {
callback-box/src/webapp/trpc/routers/card.ts:32:    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/src/webapp/trpc/routers/card.ts:70:    const parsed = parseCardText(raw, { source, schemas: cardSchemas, type });
callback-box/src/webapp/trpc/routers/card.ts:130:      // Dispatch on file shape: frontmatter cards parse via parseCardText;
callback-box/src/webapp/trpc/routers/card.ts:131:      // legacy XML cards fall through to the cardworks loader.
callback-box/src/webapp/trpc/routers/card.ts:195:          const parsed = await parseCard(rawXml, { source: input.path });
callback-box/src/cli/commands/tick-utils.ts:15:import { parseCardText } from "../../core/card-io.js";
callback-box/src/cli/commands/tick-utils.ts:33:import { parseCardName } from "../lib/paths.js";
callback-box/src/cli/commands/tick-utils.ts:71:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/tick-utils.ts:165:    const cardName = parseCardName(basename);
callback-box/scripts/migrate/record-person.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/record-person.ts:77:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/record-person.ts:81:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/record-person.ts:88:function convertRecord(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/record-person.ts:182:function convertPerson(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/record-person.ts:220:  const node = await parseCard(raw, { source: absPath });
callback-box/src/webapp/trpc/routers/chat.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/chat.ts:43:function findNavigation(element: ElementNode): ElementNode | null {
callback-box/src/webapp/trpc/routers/chat.ts:50:function readChildText(navigation: ElementNode | null, tagName: string): string {
callback-box/src/webapp/trpc/routers/chat.ts:61:  navigation: ElementNode | null,
callback-box/src/webapp/trpc/routers/chat.ts:90:async function loadLandmarkSummaries(boxRoot: string): Promise<LandmarkSummary[]> {
callback-box/src/webapp/trpc/routers/chat.ts:100:    let element: ElementNode;
callback-box/src/webapp/trpc/routers/chat.ts:103:      element = await parseCard(content, { source: absPath });
callback-box/src/webapp/trpc/routers/chat.ts:241:      loadLandmarkSummaries(ctx.boxRoot),
callback-box/src/cli/commands/scheduled.ts:14:import { parseCardText } from "../../core/card-io.js";
callback-box/src/cli/commands/scheduled.ts:53:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/scripts/migrate/recipe.ts:40:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/recipe.ts:63:function text(el: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:67:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/recipe.ts:71:function attrPart(el: ElementNode, name: string): string {
callback-box/scripts/migrate/recipe.ts:77:function ingredientTag(ing: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:82:function sectionBody(section: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:134:    const root = await parseCard(content, { source: absPath });
callback-box/src/core/sdk-hooks.ts:18:import { lintCardsDispatch } from "./card-lint.js";
callback-box/src/core/sdk-hooks.ts:35: *   - Validate `.card` files via cardworks lint and surface any issues
callback-box/src/core/sdk-hooks.ts:111:    const summary = await lintCardsDispatch([filePath], { loader, ctx });
callback-box/src/core/generate-docs-compile.ts:12:import { parseCard } from "cardworks";
callback-box/src/core/generate-docs-compile.ts:16:import { parseCardText } from "./card-io.js";
callback-box/src/core/generate-docs-compile.ts:47:      const root = await parseCard(content, { source: filename });
callback-box/src/core/generate-docs-compile.ts:84:    const parsed = parseCardText(content, {
callback-box/src/core/generate-docs-compile.ts:358:    const parsed = parseCardText(content, {
callback-box/src/core/commands/answer.ts:18:import { parseCardText } from "../card-io.js";
callback-box/src/core/commands/answer.ts:53:    const card = parseCardText(content, {
callback-box/scripts/migrate/briefing.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/briefing.ts:104:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/briefing.ts:108:function convertOne(node: ElementNode, source: string): { fields: BriefingOut; body: string } {
callback-box/scripts/migrate/briefing.ts:198:  const node = await parseCard(raw, { source: absPath });
callback-box/src/webapp/trpc/routers/scheduler.ts:15:import { parseCardText } from "../../../core/card-io.js";
callback-box/src/webapp/trpc/routers/scheduler.ts:152:      const card = parseCardText(content, { source: fileName, schemas: await createCardSchemaMap(ctx.boxRoot) });
callback-box/test/extfile-sync.doctest.md:12:import { splitCardContent } from "cardworks";
callback-box/scripts/migrate/email-thread.ts:43:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/email-thread.ts:96:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/email-thread.ts:100:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/email-thread.ts:106:  parent: ElementNode,
callback-box/scripts/migrate/email-thread.ts:110:    pluck: (item: ElementNode) => string | undefined;
callback-box/scripts/migrate/email-thread.ts:124:function convertOne(node: ElementNode, source: string): ThreadFields {
callback-box/scripts/migrate/email-thread.ts:183:  const node = await parseCard(raw, { source: absPath });
callback-box/src/core/commands/transcribe-captures.ts:19:import { parseCardText, serializeCardText } from "../card-io.js";
callback-box/src/core/commands/transcribe-captures.ts:34:  const parsed = parseCardText(content, {
callback-box/src/core/commands/transcribe-captures.ts:42:  const parsed = parseCardText(`---\n${stringifyYaml(fields)}---\n`, {
callback-box/src/core/commands/create.ts:14:import { parseCardName, isCardFile, boxPath } from "../../cli/lib/paths.js";
callback-box/src/core/commands/create.ts:83:  const parsed = parseCardName(basename);
callback-box/src/core/commands/create.ts:141:  // through cardworks's loader.
callback-box/src/core/commands/describe-images-helpers.ts:10:import { parseCardName } from "../../cli/lib/paths.js";
callback-box/src/core/commands/describe-images-helpers.ts:41:  const parsed = parseCardName(path.basename(cardPath));
callback-box/scripts/migrate/capture-session.ts:19:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/capture-session.ts:43:function text(el: ElementNode): string {
callback-box/scripts/migrate/capture-session.ts:47:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/capture-session.ts:51:function refList(el: ElementNode | undefined, childTag: string): string[] {
callback-box/scripts/migrate/capture-session.ts:62:function buildTranscriptBody(transcript: ElementNode | undefined): string {
callback-box/scripts/migrate/capture-session.ts:89:    const root = await parseCard(content, { source: absPath });
callback-box/src/webapp/trpc/routers/status.ts:8:import { parseCardName } from "../../../cli/lib/paths.js";
callback-box/src/webapp/trpc/routers/status.ts:108:        const parsed = parseCardName(e.name);
callback-box/src/webapp/trpc/routers/status.ts:139:          const parsed = parseCardName(entry.name);
callback-box/src/core/commands/assemble-timeline-helpers.ts:6:import { parseCardText } from "../card-io.js";
callback-box/src/core/commands/assemble-timeline-helpers.ts:15:    const parsed = parseCardText(content, {
callback-box/src/core/commands/assemble-timeline-helpers.ts:31:    const parsed = parseCardText(content, {
callback-box/scripts/migrate/email-message.ts:48:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/email-message.ts:118:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/email-message.ts:122:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/email-message.ts:127:function convertOne(node: ElementNode, source: string): MessageFields {
callback-box/scripts/migrate/email-message.ts:195:  const node = await parseCard(raw, { source: absPath });
callback-box/src/cli/lib/paths.ts:165:export function parseCardName(filename: string): { name: string; type: string } | null {
callback-box/src/core/commands/move-operations.ts:5: * Beyond what cardworks' built-in move handles (card file + same-basename
callback-box/src/core/commands/move-operations.ts:9: * cardworks misses: refs written relative to the referring card, refs into
callback-box/src/core/commands/move-operations.ts:11: * Phase-2 frontmatter cards cardworks can't parse.
callback-box/src/core/commands/move-operations.ts:16:import { CardLoader } from "cardworks";
callback-box/src/core/commands/move-operations.ts:104:  const loader = new CardLoader(ctx.boxRoot);
callback-box/src/core/commands/move-operations.ts:105:  const allCards = await loader.listCards();
callback-box/src/core/commands/move-operations.ts:153: * files and any references cardworks itself re-serialized.
callback-box/src/core/commands/move-operations.ts:162:  loader: CardLoader;
callback-box/src/core/commands/move-operations.ts:169:  // Phase-2 cards: cardworks' XML-only loader can't parse them, so handle
callback-box/src/core/commands/move-operations.ts:170:  // the file + attach-dir rename ourselves. XML cards: delegate to cardworks
callback-box/src/core/commands/move-operations.ts:176:  const { result } = await loader.move(card, destPath);
callback-box/src/core/commands/move-operations.ts:191: * frontmatter alike. cardworks already re-serialized card-to-card refs in
callback-box/src/core/commands/move-operations.ts:193: * attach-scope refs and every Phase-2 card cardworks can't parse.
callback-box/src/core/commands/move-operations.ts:203:  loader: CardLoader;
callback-box/src/core/commands/move-operations.ts:213:  const allCards = await loader.listCards();
callback-box/src/core/commands/move-operations.ts:320:  const loader = new CardLoader(ctx.boxRoot);
callback-box/scripts/migrate/repair-refs.ts:7: * For each broken ref discovered via cardworks `extractRefs`:
callback-box/scripts/migrate/repair-refs.ts:34:import { extractRefs, splitCardContent } from "cardworks";
callback-box/scripts/migrate/repair-refs.ts:69:function resolveRefPath(ctx: RefCtx, ref: string): string {
callback-box/scripts/migrate/repair-refs.ts:212:    const target = resolveRefPath({ boxRoot, sourceCardAbs: cardAbs }, ref);
callback-box/scripts/migrate/repair-refs.ts:234:      const destPath = resolveRefPath({ boxRoot, sourceCardAbs: cardAbs }, ref);
callback-box/src/core/commands/trash.ts:15:import { getBoxDir, isCardFile, boxPath, parseCardName } from "../../cli/lib/paths.js";
callback-box/src/core/commands/trash.ts:82:  const parsed = parseCardName(basename);
callback-box/src/core/commands/move.ts:4: * Uses cardworks' move functionality to handle:
callback-box/src/cli/lib/loader.ts:2: * CardLoader factory for callback box.
callback-box/src/cli/lib/loader.ts:4: * Creates a configured CardLoader instance with all known schemas.
callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/src/cli/lib/loader.ts:8:import { createSchemaRegistry } from "../../schemas/registry.js";
callback-box/src/cli/lib/loader.ts:18: * Create a CardLoader for the given box root.
callback-box/src/cli/lib/loader.ts:24: * @returns A configured CardLoader
callback-box/src/cli/lib/loader.ts:29:): Promise<CardLoader> {
callback-box/src/cli/lib/loader.ts:31:  const loaderOptions: CardLoaderOptions = {
callback-box/src/cli/lib/loader.ts:32:    schemas: await createSchemaRegistry(boxRoot),
callback-box/src/cli/lib/loader.ts:37:  return new CardLoader(boxRoot, loaderOptions);
callback-box/src/cli/lib/loader.ts:50: * Create an in-memory CardLoader for testing.
callback-box/src/cli/lib/loader.ts:53: * @returns A configured MemoryCardLoader
callback-box/src/cli/lib/loader.ts:57:): Promise<MemoryCardLoader> {
callback-box/src/cli/lib/loader.ts:61:  return new MemoryCardLoader(projectRoot, {
callback-box/src/cli/lib/loader.ts:62:    schemas: await createSchemaRegistry(),
callback-box/src/cli/lib/loader.ts:69:// Re-export CardLoader types for convenience
callback-box/src/cli/lib/loader.ts:70:export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/src/cli/lib/loader.ts:71:export type { ICardLoader, CardLoaderOptions } from "cardworks";
callback-box/scripts/migrate/image.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/image.ts:61:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/image.ts:65:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/image.ts:160:  const node = await parseCard(raw, { source: absPath });
callback-box/src/core/commands/move-phase2.ts:13: * card, plain file, unknown type) falls through to the cardworks
callback-box/src/core/commands/move-phase2.ts:53: * directory atomically — the Phase-2 analogue of what cardworks'
callback-box/src/core/commands/move-phase2.ts:54: * `loader.move()` does for XML cards. Returns the list of moved
callback-box/src/core/commands/move-phase2.ts:55: * file paths in the same `{from, to}` shape cardworks emits.
callback-box/scripts/migrate/card-frontmatter.ts:12: * No body content is altered. The cardworks parser handles the new prefix
callback-box/scripts/migrate/card-frontmatter.ts:13: * transparently via `parseCard()`, so this migration is a no-op for readers
callback-box/src/schemas/extfile.tsx:29: * Wired onto the schema as its `validate` hook (cardworks invokes it during
callback-box/src/schemas/extfile.tsx:35:  // A missing href is already a schema (Zod) error from parseCardText; here we
callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scripts/clean-broken-refs.ts:72: * Resolve a ref the way cardworks does (subset): absolute = box-root;
callback-box/scripts/clean-broken-refs.ts:78:function resolveRefPath(ctx: RefCtx, ref: string): string {
callback-box/scripts/clean-broken-refs.ts:115:  const targetPath = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, filename.ref);
callback-box/scripts/clean-broken-refs.ts:149:    const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
callback-box/scripts/clean-broken-refs.ts:186:      const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
callback-box/scripts/clean-broken-refs.ts:201:      const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
callback-box/scripts/clean-broken-refs.ts:246:    const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
callback-box/src/frontend/src/renderers/image.tsx:18:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/image.tsx:36:function parseImageCard(element: ElementNode): ParsedImageCard {
callback-box/src/frontend/src/renderers/image.tsx:37:  const children = (element.children || []) as ElementNode[];
callback-box/src/frontend/src/renderers/image.tsx:74:  const card = parseImageCard(data.element as ElementNode);
callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/test/contains-state.doctest.md:26:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/test/schemas.doctest.md:11:  createSchemaRegistry,
callback-box/test/schemas.doctest.md:18:import { parseCard } from "cardworks";
callback-box/test/schemas.doctest.md:58:The full registry of XML schemas is available via `createSchemaRegistry()`:
callback-box/test/schemas.doctest.md:61:const registry = await createSchemaRegistry();
callback-box/src/frontend/src/renderers/index.ts:8:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/index.ts:18:  element?: ElementNode;
callback-box/src/core/commands/describe-images-card.ts:13:import { parseCardName } from "../../cli/lib/paths.js";
callback-box/src/core/commands/describe-images-card.ts:14:import { parseCardText, serializeCardText } from "../card-io.js";
callback-box/src/core/commands/describe-images-card.ts:21:  const parsed = parseCardText(content, {
callback-box/src/core/commands/describe-images-card.ts:29:  const parsed = parseCardText(`---\n${stringifyYaml(fields)}---\n`, {
callback-box/src/core/commands/describe-images-card.ts:137:  const currentName = parseCardName(path.basename(cardPath));
callback-box/src/core/card-io.ts:14: * The host application (this module) owns YAML parsing so cardworks
callback-box/src/core/card-io.ts:15: * stays YAML-free. cardworks provides the schema declaration primitives
callback-box/src/core/card-io.ts:21:import { parseCard, type ElementSchema, type ElementNode } from "cardworks";
callback-box/src/core/card-io.ts:109:export function parseCardText(
callback-box/src/core/card-io.ts:126:  // cardworks bakes `type: z.literal(...)` into frontmatterSchema, so we
callback-box/src/core/card-io.ts:293:  readonly schema: ElementSchema | undefined;
callback-box/src/core/card-io.ts:294:  readonly element: ElementNode;
callback-box/src/core/card-io.ts:300:  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
callback-box/src/core/card-io.ts:301:  elementSchemas: Map<string, ElementSchema>;
callback-box/src/core/card-io.ts:311: *   tag's ElementSchema (if any) is used for validation.
callback-box/src/core/card-io.ts:335:      const parsed = parseCardText(content, { source, schemas: ctx.cardSchemas, type: fileType });
callback-box/src/core/card-io.ts:371:  const element = await parseCard(content, { source });
callback-box/test/move-command.doctest.md:161:stays box-root-absolute. (No leading `./`; that was a cardworks XML-loader
callback-box/test/routes-api.doctest.md:74:`GET /api/card/*` returns a parsed card by path:
callback-box/test/routes-api.doctest.md:82:await ctx.inject({ method: "GET", url: "/api/card/box/inbox/hello.memo.card" })
callback-box/test/routes-api.doctest.md:103:const res = await ctx.request({ method: "GET", url: "/api/card/box/inbox/nope.memo.card" });
callback-box/src/core/generate-docs.ts:44:} from "./generate-docs-compile.js";
callback-box/src/core/generate-docs.ts:45:import type { ProcedureSummary } from "./generate-docs-compile.js";
callback-box/src/core/generate-docs.ts:48:export type { ProcedureSummary, GuideSummary } from "./generate-docs-compile.js";
callback-box/src/core/generate-docs.ts:343:    // Per-schema generated docs cover both legacy XML schemas (ElementSchema
callback-box/src/frontend/src/renderers/sheet.tsx:8:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/sheet.tsx:29:function parseSheetElement(el: ElementNode): ParsedSheet {
callback-box/test/paths.doctest.md:6:import { parseCardName, buildCardName, isCardFile, BOX_DIRS } from "../src/cli/lib/paths.js";
callback-box/test/paths.doctest.md:14:parseCardName("Test.memo.card")
callback-box/test/paths.doctest.md:25:parseCardName("Meeting_Tomorrow.email-thread.card")
callback-box/test/paths.doctest.md:36:parseCardName("invalid.card")
callback-box/test/paths.doctest.md:39:parseCardName("no-extension")
callback-box/test/paths.doctest.md:42:parseCardName("only.card")
callback-box/test/paths.doctest.md:48:`buildCardName` is the inverse of `parseCardName`:
callback-box/test/card-loaders.doctest.md:8:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/card-loaders.doctest.md:10:function el(tagName: string, attrs: Record<string, string>, children: ElementNode[] = []): ElementNode {
callback-box/test/card-loaders.doctest.md:18:  } as ElementNode;
callback-box/test/card-loaders.doctest.md:21:function textChild(tagName: string, text: string): ElementNode {
callback-box/test/card-loaders.doctest.md:22:  return { ...el(tagName, {}), text } as ElementNode;
callback-box/test/loader-registry.doctest.md:13:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/loader-registry.doctest.md:15:function makeElement(tagName: string, attrs: Record<string, string>, text?: string): ElementNode {
callback-box/test/loader-registry.doctest.md:24:  } as ElementNode;
callback-box/test/box-schemas.doctest.md:50:const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/src/core/search/extract.ts:19:import type { ElementNode } from "cardworks";
callback-box/src/core/search/extract.ts:290:function collectElementText(node: ElementNode): string {
callback-box/src/core/search/extract.ts:292:  const visit = (n: ElementNode): void => {
callback-box/src/core/search/extract.ts:297:        else if (isElementNode(m)) visit(m);
callback-box/src/core/search/extract.ts:301:      if (isElementNode(child)) visit(child);
callback-box/src/core/search/extract.ts:308:function isElementNode(value: unknown): value is ElementNode {
callback-box/src/frontend/src/components/CommitDetail-tabs.tsx:10:import { extractNewFileContent, parseXmlToElementNode } from "./CommitDetail-diff";
callback-box/src/frontend/src/components/CommitDetail-tabs.tsx:103:        const cardElement = isCard && content ? parseXmlToElementNode(content) : null;
callback-box/src/frontend/src/components/CommitDetail-diff.ts:6:import type { ElementNode } from "./CardTreeView";
callback-box/src/frontend/src/components/CommitDetail-diff.ts:127:function domToElementNode(el: Element): ElementNode {
callback-box/src/frontend/src/components/CommitDetail-diff.ts:133:  const children: ElementNode[] = [];
callback-box/src/frontend/src/components/CommitDetail-diff.ts:138:      children.push(domToElementNode(child as Element));
callback-box/src/frontend/src/components/CommitDetail-diff.ts:155:export function parseXmlToElementNode(xml: string): ElementNode | null {
callback-box/src/frontend/src/components/CommitDetail-diff.ts:160:    return domToElementNode(doc.documentElement);
callback-box/src/frontend/src/api.ts:65:export interface ElementNode {
callback-box/src/frontend/src/api.ts:69:  children?: ElementNode[];
callback-box/src/frontend/src/components/CardTreeView.tsx:25:export interface ElementNode {
callback-box/src/frontend/src/components/CardTreeView.tsx:29:  children?: ElementNode[];
callback-box/src/frontend/src/components/CardTreeView.tsx:33:  element: ElementNode;
callback-box/src/frontend/src/components/CardTreeView.tsx:73:function resolveRef(ref: string, cardPath: string): string {
callback-box/src/frontend/src/components/CardTreeView.tsx:135:  data: { element?: ElementNode; path: string; tagName?: string; xml?: string; version?: string; status?: string };
callback-box/src/frontend/src/components/CardTreeView.tsx:201:  const resolvedRef = refAttr && cardPath ? resolveRef(refAttr, cardPath) : null;
callback-box/src/frontend/src/components/CardTreeView.tsx:284:  element: ElementNode;

exec
/opt/homebrew/bin/bash -lc "rg -n \"cardSchemas|schemas\\[|schemas =|elementSchemas|attach/|Name\\.attach|loadCardFrontmatter|resolveRefExists|movePhase2CardFiles|rewrite-card-refs|callback-box/cards|exports|SCHEMA_DEPS|registerHooks\" callback-box/src callback-box/package.json callback-box/docs callback-box/test -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/package.json:7:  "exports": {
callback-box/src/services/CLAUDE.md:123:| `index.ts` | `Services` container | — | Barrel exports all of the above |
callback-box/src/services/index.ts:18:// ─── Re-exports ─────────────────────────────────────────────────────────────
callback-box/src/services/google-drive-fake.ts:36: * `exports` maps mimeType → content so tests can prepare the markdown body
callback-box/src/services/google-drive-fake.ts:44:  exports: Map<string, string>;
callback-box/src/services/google-drive-fake.ts:118:      const content = doc.exports.get(mimeType);
callback-box/src/services/google-drive-fake.ts:128:      doc.exports.set(updateOpts.mimeType, updateOpts.content);
callback-box/src/services/claude-chat-types.ts:8: * cycle. `claude-chat.ts` re-exports everything here so the public surface
callback-box/src/services/claude-chat-fake.ts:7: * re-exports these symbols so the public surface is one module.
callback-box/src/lib/attach-lint.ts:2: * Lint rules for the `.attach/` layout.
callback-box/src/lib/attach-lint.ts:8: *    make `<basename>.attach/` ambiguous — which card owns it?
callback-box/src/lib/attach-lint.ts:11: *    (other than inside an existing `<basename>.attach/` scope) a directory or
callback-box/src/lib/attach-lint.ts:13: *    `attach/` virtual prefix used in refs. Names like `attachments/`,
callback-box/src/lib/attach-lint.ts:113:        message: "Name \"attach\" is reserved (collides with the attach/ virtual ref prefix). Rename or use the <basename>.attach/ convention.",
callback-box/docs/migrations.md:95:| 1 | `attachments`       | `attachments.ts`       | Structural: move flat sibling attachments into `<basename>.attach/` directories |
callback-box/docs/migrations.md:139:- Ledger's eulogy `.md` moved into a proper `.attach/` scope; trash duplicate removed.
callback-box/docs/testing.md:200:- **No `import type`** in setup blocks — the loader doesn't support it. Import value exports only.
callback-box/docs/testing.md:564:pnpm lint:knip      # Unused files, exports, dependencies
callback-box/docs/implemented-plans/narration-mode-design.md:367:**Registry.** A small module — `src/core/chat-features.ts` (new) — exports the closed set of recognized feature names and their defaults. Initial entries: `narration`, `prose`. Any unknown attribute on a `<chat-app>` tag is ignored with a warning. This file is also where the `<chat-app>` snapshot serializer and the agent-delta parser live.
callback-box/src/schemas/image.tsx:8: * Layout: `photo-001.image.card` next to `photo-001.attach/photo-001.jpg`.
callback-box/src/schemas/image.tsx:9: * `filename.ref:` points into the attach scope via the `attach/` virtual
callback-box/src/schemas/image.tsx:89:\`photo-001.image.card\` with \`photo-001.attach/photo-001.jpg\`);
callback-box/src/schemas/image.tsx:90:\`filename.ref:\` points into that scope via the \`attach/\` prefix.
callback-box/src/schemas/image.tsx:198:      ref: `attach/${options.filename}`,
callback-box/docs/activities-design.md:267:  index.ts                  # exports Polyglot activity class (default)
callback-box/docs/agent-knowledge.md:254:Agents can define new card types by creating `.ts` files in `config/schemas/`. Each file exports a default `ElementSchema` using the same `element()` + `z` (Zod) API as built-in schemas. Optionally, files can also export a `template` for `cb create`.
callback-box/docs/agent-knowledge.md:308:- Watch for: does it read the views doc, or guess the file format? Key details to get right: named exports for metadata, default export for component, dependency globs, `ViewProps` shape
callback-box/src/schemas/index.ts:2: * Schema module - exports all schemas and registry utilities.
callback-box/src/schemas/index.ts:87:// Guide exports
callback-box/src/schemas/index.ts:91:// Scheduled script exports
callback-box/test/connector-drive-docs.doctest.md:45:    exports: new Map([["text/markdown", opts.markdown]]),
callback-box/test/connector-drive-docs.doctest.md:96:JSON.stringify(await box.read("store/drive/Project_Notes.attach/Project_Notes.md"))
callback-box/test/connector-drive-docs.doctest.md:227:await box3.seed("store/drive/Editable.attach/Editable.md", "Edited body.\n");
callback-box/test/connector-drive-docs.doctest.md:284:await box4.seed("store/drive/Contended.attach/Contended.md", "Local edit.\n");
callback-box/test/connector-drive-docs.doctest.md:290:driveDoc.exports.set("text/markdown", "Remote edit.\n");
callback-box/test/connector-drive-docs.doctest.md:297:await box4.read("store/drive/Contended.attach/Contended.md")
callback-box/test/connector-drive-docs.doctest.md:301:await box4.read("store/drive/Contended.attach/Contended.remote.md")
callback-box/test/connector-drive-docs.doctest.md:325:await box4.seed("store/drive/Contended.attach/Contended.md", "Merged.\n");
callback-box/test/connector-drive-docs.doctest.md:326:await unlink(join(box4.root, "store/drive/Contended.attach/Contended.remote.md"));
callback-box/test/connector-drive-docs.doctest.md:387:await box5.read("store/drive/Degraded.attach/Degraded.md")
callback-box/src/schemas/recipe.tsx:41:  to the recipe card's attach scope, e.g. \`attach/finished.jpg\`).
callback-box/docs/maintenance.md:9:A second category catches the kind of code-health issues that pile up if nobody looks: dead exports, circular dependencies, unused dependencies. These compile and pass tests today, but they make refactors more expensive over time.
callback-box/docs/maintenance.md:68:Detects unused files, exports, and dependencies. Knip can have false positives for entry-point scripts that aren't imported (CLI tools, dev scripts) — those go in `knip.json`'s `entry` array or get registered as `npm run` scripts in `package.json`.
callback-box/docs/maintenance.md:72:**Output:** console list of unused files / exports / deps. Triage each: real dead code → delete; legitimate entry point → register; deferred/in-progress → leave with a comment explaining why it's currently unused.
callback-box/src/schemas/memo.ts:70:**attach scope** — a sibling directory named \`<basename>.attach/\`
callback-box/src/schemas/memo.ts:78:box/inbox/Voice_2026-05-24T18-22-10.attach/recording.m4a
callback-box/test/card-lint.doctest.md:60:  cardSchemas: new Map<string, CardSchema>([
callback-box/test/card-lint.doctest.md:67:  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
callback-box/test/card-lint.doctest.md:77:  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread-x.attach/msg-001.email-message.card\n---\n",
callback-box/test/card-lint.doctest.md:80:  "box/inbox/email/thread-x.attach/msg-001.email-message.card",
callback-box/test/card-lint.doctest.md:81:  "---\ncontent-type: application/x-card+xml\n---\n<email-message message-id=\"m1\" thread-id=\"t1\"><from>a@x</from><date>2026-02-15T10:00:00Z</date><subject>hi</subject><body-file>attach/msg-001.body.txt</body-file></email-message>\n",
callback-box/test/card-lint.doctest.md:151:  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread.attach/missing.email-message.card\n---\n",
callback-box/test/card-lint.doctest.md:165:=> Broken reference at messages[0].ref: thread.attach/missing.email-message.card does not exist
callback-box/test/card-lint.doctest.md:278:  "store/review/Plan.attach/Plan.commentary.card",
callback-box/test/card-lint.doctest.md:283:  [box.path("store/review/Plan.attach/Plan.commentary.card")],
callback-box/src/dev/knowledge-audits.yaml:1806:  #   explicitly named the `.attach/` scope and showed a layout example
callback-box/src/dev/knowledge-audits.yaml:1811:  #   resulting `.doc.card` content for `attach/photo.jpg`.
callback-box/src/dev/knowledge-audits.yaml:1827:  #   a flat sibling with matching basename, not in `<basename>.attach/`.
callback-box/src/dev/knowledge-audits.yaml:1835:  #   the agent identified the `.attach/` scope correctly but put the doc
callback-box/src/dev/knowledge-audits.yaml:1836:  #   body in a separate `Trip_Report.attach/Trip_Report.md` rather than in
callback-box/src/dev/knowledge-audits.yaml:1843:  # schemas) but never `cardSchemas` (24 phase-2 YAML schemas), so
callback-box/src/dev/knowledge-audits.yaml:1860:      but not `cardSchemas`, so phase-2 per-schema docs never regenerated.
callback-box/src/dev/knowledge-audits.yaml:1879:      Names a sibling `<basename>.attach/` directory (e.g.
callback-box/src/dev/knowledge-audits.yaml:1880:      `Foo.memo.card` + `Foo.attach/recording.m4a`) and a scoped ref
callback-box/src/dev/knowledge-audits.yaml:1881:      starting with `attach/` (e.g. `attach/recording.m4a`), NOT an
callback-box/src/dev/knowledge-audits.yaml:1883:    correct_contains_any: [".attach/", "attach/"]
callback-box/src/dev/knowledge-audits.yaml:1894:      whose markdown body embeds one image referenced as `attach/photo.jpg`.
callback-box/src/dev/knowledge-audits.yaml:1900:      contains a markdown image reference like `![...](attach/photo.jpg)`.
callback-box/src/dev/knowledge-audits.yaml:1901:      The `.doc.card` body (not a separate `.md` inside `.attach/`) carries
callback-box/src/dev/knowledge-audits.yaml:1902:      the markdown; the image path uses the scoped `attach/` form. Bonus:
callback-box/src/dev/knowledge-audits.yaml:1903:      mkdir's `Trip_Report.attach/` even without a real binary.
callback-box/src/dev/knowledge-audits.yaml:1904:    cards_contain: ["attach/photo.jpg"]
callback-box/src/dev/knowledge-audits.yaml:1969:      card; NOT inside a `.attach/` directory. Single file: just
callback-box/src/dev/knowledge-audits.yaml:1972:    response_not_contains: ["Notes.attach/Notes.md", ".attach/Notes.md"]
callback-box/src/dev/knowledge-audits.yaml:1977:      agent put body in `Trip_Report.attach/Trip_Report.md` (pattern-matching
callback-box/src/dev/knowledge-audits.yaml:1989:      frontmatter AND the markdown body with `![...](attach/<image>)`) and
callback-box/src/dev/knowledge-audits.yaml:1990:      `store/notes/Trip.attach/<image>` (the image file itself). The body
callback-box/src/dev/knowledge-audits.yaml:1991:      is INSIDE the .doc.card, NOT in a separate `Trip.attach/Trip.md`.
callback-box/src/dev/knowledge-audits.yaml:1992:    response_not_contains: ["Trip.attach/Trip.md", "attach/Trip.md"]
callback-box/src/dev/knowledge-audits.yaml:1993:    correct_contains: ["Trip.attach/", "attach/"]
callback-box/src/dev/knowledge-audits.yaml:2420:      store/playground/Playground.attach/sessions/history.jsonl. The
callback-box/src/dev/knowledge-audits.yaml:2601:      attach/page.frozen, and a separate .commentary.card inside the webpage
callback-box/src/dev/knowledge-audits.yaml:2603:      commentary card with attach/readable.md.
callback-box/docs/implemented-plans/extfile-card.md:23:(in the pointer's `.attach/` scope) instead of fusing an external target onto
callback-box/docs/implemented-plans/extfile-card.md:32:  registered in `cardSchemas[]` (`src/schemas/registry.ts:65`).
callback-box/docs/implemented-plans/extfile-card.md:118:  it discovers `.commentary.card` files in the card's `.attach/` scope via
callback-box/docs/implemented-plans/extfile-card.md:264:  commentary about the file lives in the card's `.attach/` scope with bare
callback-box/docs/implemented-plans/extfile-card.md:331:from the card's `.attach/` scope with jump-to-quote against the rendered file.
callback-box/docs/implemented-plans/extfile-card.md:399:**always** attach-scoped: it lives in a host card's `.attach/` scope and its
callback-box/docs/implemented-plans/extfile-card.md:445:  `.attach/` scope; for a single external file, make an `extfile` and attach the
callback-box/docs/implemented-plans/extfile-card.md:457:  become an `extfile` pointer with remarks moved into its `.attach/` scope; the
callback-box/src/schemas/registry.ts:12:import { registerHooks } from "node:module";
callback-box/src/schemas/registry.ts:62:export const cardSchemas: CardSchema[] = [
callback-box/src/schemas/registry.ts:100: * - `callback-box/cards` — the public card-primitive surface (cardSchema,
callback-box/src/schemas/registry.ts:106: *   schema files to `callback-box/cards`; goes away with cardworks itself.
callback-box/src/schemas/registry.ts:108:const SCHEMA_DEPS = new Set(["callback-box", "zod", "yaml", "cardworks"]);
callback-box/src/schemas/registry.ts:114: * AND self-references (`callback-box/cards`) via callback-box's own
callback-box/src/schemas/registry.ts:115: * `exports` map. Pointing it *inside* node_modules would break the
callback-box/src/schemas/registry.ts:117: * node_modules boundary, so the package's own exports never match. The
callback-box/src/schemas/registry.ts:124: * (under config/schemas/) can import `callback-box/cards`, `zod`, and the
callback-box/src/schemas/registry.ts:128: * Uses Node's synchronous registerHooks API which chains correctly
callback-box/src/schemas/registry.ts:136:  registerHooks({
callback-box/src/schemas/registry.ts:137:    // eslint-disable-next-line max-params -- Node's registerHooks API requires 3 params
callback-box/src/schemas/registry.ts:142:        SCHEMA_DEPS.has(bare) &&
callback-box/src/schemas/registry.ts:158: * so Node treats .ts files as ESM (needed for registerHooks to apply).
callback-box/src/schemas/registry.ts:182:  cardSchemas: CardSchema[];
callback-box/src/schemas/registry.ts:184:  elementSchemas: ElementSchema[];
callback-box/src/schemas/registry.ts:219:  const empty: BoxSchemas = { cardSchemas: [], elementSchemas: [] };
callback-box/src/schemas/registry.ts:271:  return { cardSchemas: loadedCard, elementSchemas: loadedElement };
callback-box/src/schemas/registry.ts:298:    const { elementSchemas } = await loadBoxSchemas(boxRoot);
callback-box/src/schemas/registry.ts:299:    for (const schema of elementSchemas) {
callback-box/src/schemas/registry.ts:313:  const { elementSchemas } = await loadBoxSchemas(boxRoot);
callback-box/src/schemas/registry.ts:314:  return [...schemas, ...elementSchemas];
callback-box/src/schemas/registry.ts:323:    ...cardSchemas.map(s => s.type),
callback-box/src/schemas/registry.ts:333:  const elementSchemas = await getAllSchemas(boxRoot);
callback-box/src/schemas/registry.ts:334:  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
callback-box/src/schemas/registry.ts:335:  const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
callback-box/src/schemas/registry.ts:337:    ...elementSchemas.filter(s => s.searchable !== false).map(s => s.tagName),
callback-box/src/schemas/registry.ts:348:    || cardSchemas.some(s => s.type === type)
callback-box/src/schemas/registry.ts:362:  for (const schema of cardSchemas) {
callback-box/src/schemas/registry.ts:366:    const { cardSchemas: boxCardSchemas } = await loadBoxSchemas(boxRoot);
callback-box/docs/IMPLEMENTATION.md:73:        schemas[schemas]
callback-box/test/card-io.doctest.md:41:const schemas = new Map<string, CardSchema>([
callback-box/test/card-io.doctest.md:141:  cardSchemas: new Map<string, CardSchema>([
callback-box/test/card-io.doctest.md:145:  elementSchemas: new Map<string, ElementSchema>([
callback-box/test/card-io.doctest.md:174:  cardSchemas: await createCardSchemaMap(),
callback-box/test/card-io.doctest.md:175:  elementSchemas: new Map(),
callback-box/src/schemas/commentary.tsx:5: * **Attach-only:** a commentary card lives in a host card's `.attach/` scope and
callback-box/src/schemas/commentary.tsx:79:It is **attach-only**: it lives in the host's \`.attach/\` scope
callback-box/src/schemas/commentary.tsx:80:(\`<host-basename>.attach/<name>.commentary.card\`) and the host's view surfaces
callback-box/src/schemas/commentary.tsx:133: * (e.g. a `.webpage.card`'s `<basename>.attach/`). It carries no default target
callback-box/test/capture-pipeline.test.ts:112:  // Each image lives inside its own attach scope (e.g. photo-001.attach/photo-001.jpg).
callback-box/src/schemas/audio.tsx:7: * Layout: `audio-001.audio.card` next to `audio-001.attach/audio-001.webm`.
callback-box/src/schemas/audio.tsx:9: * `audio-001.attach/audio-001.timing.json`.
callback-box/src/schemas/audio.tsx:45:(e.g. \`audio-001.audio.card\` with \`audio-001.attach/audio-001.webm\`);
callback-box/src/schemas/audio.tsx:46:\`filename.ref:\` points into that scope via the \`attach/\` prefix.
callback-box/src/schemas/audio.tsx:91:      ref: `attach/${options.filename}`,
callback-box/src/schemas/email-outbound.tsx:79:- **Reply drafts** go inside the existing thread's \`.attach/\` next to
callback-box/src/schemas/email-outbound.tsx:81:  \`box/inbox/email/thread-X.attach/draft-001.email-outbound.card\`. This
callback-box/test/search-extract.doctest.md:20:  cardSchemas: await createCardSchemaMap(),
callback-box/test/search-extract.doctest.md:21:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/test/search-extract.doctest.md:64:  "box/inbox/email/t.attach/msg-001.email-message.card",
callback-box/test/search-extract.doctest.md:65:  "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: alice@example.com\nto: bob@example.com\ndate: 2026-05-14T19:00:00Z\nsubject: Weekend plans\nsnippet: Hey, are you free Saturday...\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n"
callback-box/test/search-extract.doctest.md:76:JSON.stringify(declareInputFiles({ path: "box/inbox/email/t.attach/msg-001.email-message.card", card: await loadCardFromText({ content: "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: a@x.com\ndate: 2026-05-14T19:00:00Z\nsubject: s\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n", source: "box/inbox/email/t.attach/msg-001.email-message.card", ctx }) }))
callback-box/test/search-extract.doctest.md:85:  "---\nthread-id: t1\nsubject: Usage-based pricing demo\nparticipants:\n  - hello@metricly.example\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nlabels:\n  - promotions\nmessages:\n  - ref: attach/msg-001.email-message.card\n---\n"
callback-box/test/search-extract.doctest.md:102:const cardText = "---\ndrive-id: d1\ntitle: Project Notes\nmodified: 2026-05-01\nlink: https://docs.google.com/document/d/d1/edit\nowner: owner@example.com\ncontent:\n  ref: attach/Project_Notes.md\n---\n";
callback-box/test/search-extract.doctest.md:106:=> ["store/drive/Project_Notes.attach/Project_Notes.md"]
callback-box/test/search-extract.doctest.md:108:const inputContents = new Map([["store/drive/Project_Notes.attach/Project_Notes.md", "Quarterly planning notes for the project."]]);
callback-box/test/search-extract.doctest.md:122:  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: The boiler's serial-number plate (K-44210)\ntext:\n  - source: plate\n    content: Serial K-44210 Model HX-200 240V\n---\n"
callback-box/test/search-extract.doctest.md:195:  "---\ndrive-id: d2\ntitle: Family Budget\nmodified: 2026-05-01\nlink: https://docs.google.com/spreadsheets/d/d2/edit\nowner: o@example.com\nsheets:\n  - ref: attach/tab-0.json\n    title: Monthly Spending\n    gid: \"0\"\n---\n"
callback-box/src/schemas/gdoc.tsx:5: * inside the card's `.attach/` scope; `content.ref` points at it.
callback-box/src/schemas/gdoc.tsx:11: *   store/drive/Project_Notes.attach/Project_Notes.md
callback-box/src/schemas/gdoc.tsx:56:the card's \`.attach/\` scope (e.g.
callback-box/src/schemas/gdoc.tsx:57:\`Project_Notes.attach/Project_Notes.md\`). The \`content.ref:\` field
callback-box/src/schemas/gdoc.tsx:122:    content: { ref: `attach/${options.contentFile}` },
callback-box/test/routes-views.doctest.md:173:export const dependencies = ["box/**/*.card", "box/inbox/Test.attach/**/*.jsonl"];
callback-box/test/routes-views.doctest.md:178:await ctx.seed("box/inbox/Test.attach/sessions/history.jsonl", '{"summary":"first run"}\n{"summary":"second run"}\n');
callback-box/test/routes-views.doctest.md:184:=> box/inbox/Test.attach/sessions/history.jsonl
callback-box/test/routes-views.doctest.md:193:=> box/inbox/Test.attach/sessions/history.jsonl
callback-box/test/routes-views.doctest.md:206:const full = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl" });
callback-box/test/routes-views.doctest.md:213:const tail = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=-25" } });
callback-box/test/routes-views.doctest.md:223:const mid = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=0-22" } });
callback-box/test/routes-views.doctest.md:227:const past = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=999-" } });
callback-box/test/maps-precheck.doctest.md:306:await box.write("emails/Foo.attach/x.card", "x");
callback-box/test/maps-precheck.doctest.md:310:await box.write("box/inbox/capture-1.attach/audio.webm", "x");
callback-box/test/maps-precheck.doctest.md:325:- `emails/Foo.attach/` is hidden (matches `**/*.attach`).
callback-box/src/schemas/templates.ts:13: * built-in templates as a side effect and re-exports the public API.
callback-box/src/schemas/capture-session.tsx:53:A capture session groups images, audio clips, and uploaded files from a single recording session (e.g., a voice walkthrough with photos, or a batch of documents). The session card lives at the inbox level; its child cards (audio, image, file) live inside the session's attach scope (\`{basename}.attach/\`). Refs to children use the \`attach/\` virtual prefix.
callback-box/src/schemas/capture-session.tsx:110: * (e.g. `photo-001.image.card`). They're emitted with the `attach/` virtual
callback-box/src/schemas/capture-session.tsx:133:    images: options.imageRefs.map((ref) => `attach/${ref}`),
callback-box/src/schemas/capture-session.tsx:134:    "audio-clips": options.audioRefs.map((ref) => `attach/${ref}`),
callback-box/src/schemas/capture-session.tsx:137:  if (fileRefs.length > 0) fields.files = fileRefs.map((ref) => `attach/${ref}`);
callback-box/test/connector-drive.doctest.md:116:await box3.seed("store/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","5"]\n]\n');
callback-box/test/connector-drive.doctest.md:123:await box3.seed("store/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","6"],\n["Tea","3"]\n]\n');
callback-box/src/schemas/email-message.tsx:20: *     ref: attach/msg-001.body.txt
callback-box/src/schemas/email-message.tsx:22: *     - ref: attach/invoice.pdf
callback-box/src/schemas/email-message.tsx:88: * attach scope (e.g. `msg-001.body.txt`); the template prefixes `attach/`.
callback-box/src/schemas/email-message.tsx:119:  fields["body-file"] = { ref: `attach/${options.bodyFile}` };
callback-box/src/schemas/email-message.tsx:123:        ref: `attach/${a.ref}`,
callback-box/src/schemas/file.tsx:5: * The actual file lives in the card's `.attach/` scope; `filename.ref`
callback-box/src/schemas/file.tsx:10: *   inbox/scan-XX.attach/source.file.card
callback-box/src/schemas/file.tsx:11: *   inbox/scan-XX.attach/source.attach/tax-return.pdf
callback-box/src/schemas/file.tsx:42:\`file-001-tax-return.attach/file-001-tax-return.pdf\`); \`filename.ref:\`
callback-box/src/schemas/file.tsx:48:  (e.g. \`attach/{storedName}\`). \`captured:\` is the upload timestamp,
callback-box/src/schemas/file.tsx:86:    ref: `attach/${options.filename}`,
callback-box/src/schemas/email-thread.tsx:24: *     - ref: attach/msg-001.email-message.card
callback-box/src/schemas/email-thread.tsx:25: *     - ref: attach/msg-002.email-message.card
callback-box/src/schemas/email-thread.tsx:55:(\`{basename}.attach/\`) containing:
callback-box/src/schemas/email-thread.tsx:57:  the \`messages\` field as \`attach/msg-NNN.email-message.card\`)
callback-box/src/schemas/email-thread.tsx:58:- \`msg-NNN.attach/\` — per-message attach scope holding the body text and any
callback-box/src/schemas/email-thread.tsx:81: * the template emits them prefixed with `attach/` pointing into the thread's
callback-box/src/schemas/email-thread.tsx:104:  fields["messages"] = options.messageRefs.map((r) => ({ ref: `attach/${r}` }));
callback-box/src/schemas/sheet.tsx:4: * Pure frontmatter. Each tab's JSON data lives in the card's `.attach/`
callback-box/src/schemas/sheet.tsx:10: *   store/drive/Budget.attach/Summary.json
callback-box/src/schemas/sheet.tsx:11: *   store/drive/Budget.attach/Expenses.json
callback-box/src/schemas/sheet.tsx:39:an attach scope (\`{basename}.attach/\`) containing one JSON file per
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/audio-001.audio.card:5:  ref: attach/audio-001.webm
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-001.image.card:5:  ref: attach/photo-001.jpg
callback-box/src/schemas/webpage.tsx:6: * the card's `.attach/` scope. Frontmatter carries capture provenance — the
callback-box/src/schemas/webpage.tsx:31:    // In-box ref to the frozen, self-contained snapshot (attach/page.frozen).
callback-box/src/schemas/webpage.tsx:50:- \`frozen:\` — optional in-box ref (\`attach/page.frozen\`) to the frozen
callback-box/src/schemas/webpage.tsx:58:\`attach/readable.md\` file; the card *is* the page.
callback-box/src/schemas/webpage.tsx:64:(\`<basename>.attach/\`), and the webpage view surfaces them inline. A
callback-box/src/schemas/webpage.tsx:72:box/inbox/My_Page.attach/page.frozen    # frozen snapshot
callback-box/src/schemas/webpage.tsx:73:box/inbox/My_Page.attach/My_Page.commentary.card   # remarks (optional)
callback-box/docs/google-drive.md:117:- **Sheets** (`drive-handler-sheets.ts`) -- exports as CSV with formulas
callback-box/docs/ideas.md:444:- **Card-related**: tagName, ref, ref graph, schema instructions, validation, virtual `attach/` prefix, basename, card title
callback-box/docs/ideas.md:461:The asset-manifest hook (`docs/asset-manifests.md`) scopes its discipline to `**/*.attach/**` only. Binaries outside attach scopes commit normally, with a soft "this is big, consider moving it" advisory. Revisit once we have real usage: if agents routinely drop binaries outside attach scopes anyway (logs, screenshots, scratch files), either tighten enforcement (gitignore more aggressively, hard-block large binaries anywhere), or accept the looser model and beef up the advisory. Also worth revisiting: per-dir JSON manifest vs per-asset sidecar — if per-dir produces noisy diffs in practice, the sidecar form is a drop-in replacement.
callback-box/docs/ideas.md:794:## Directory "head cards" — `Foo.type.card` + `Foo/` instead of `Foo.attach/`
callback-box/docs/ideas.md:796:Exploratory structural idea (2026-06-12), the deep version of [[card-level-prominence]]. Today a card relates to a sibling container exactly one way — `Foo.attach/` is Foo's private bag of binaries — and a *directory* gets its identity a different way: a `landmark`/`briefing` card placed *inside* it. What if instead `Foo.type.card` paired with a plain `Foo/`? Then **a directory's "head card" — a same-named sibling of any type — gives the directory its type, identity, prominence, and primary content at once.** `Recipes.landmark.card + Recipes/`, `Chat.sandbox.card + Chat/`, `Foo.doc.card + Foo/` all become one pattern, recursive down the tree (every directory optionally typed by its sibling). This generalizes the prominence insight: a bare directory lacks the renderable identity a card has, so it needs a proxy — the head card *is* that proxy, and making it any-typed unifies attachments, landmarks, and briefings into "directories have head cards."
callback-box/docs/ideas.md:799:- **Owns** — `Foo.attach/` is *private content, addressed via `attach/` refs*, owned by Foo; it has no independent existence.
callback-box/docs/ideas.md:802:A bare `Foo/` can't say which, and the `.attach` suffix is doing real disambiguating work today: it keys the asset-manifest discipline (`**/*.attach/**`), gitignore patterns, and `attach/`-prefix ref resolution, and it sidesteps basename-uniqueness (`Foo.doc.card` + `Foo.attach/` don't collide; `Foo.doc.card` + `Foo/` would need a blessed pairing exception). Drop the suffix and you lose the "private, owned, ref-addressed" signal.
callback-box/docs/ideas.md:808:- **Ref resolution** — how do refs point into `Foo/` vs the current `attach/` prefix?
callback-box/docs/ideas.md:809:- **mv coupling flips.** A head card *beside* its directory must move as a pair (`cb mv` already does this for `.attach/`); a landmark *inside* travels with the directory automatically. Beside is more visible in the parent listing (identity without descending) but more fragile to manual moves.
callback-box/docs/ideas.md:810:- **Asset-manifest** keys on `.attach/`; a rename of the convention is a migration touching that hook, gitignore, ref resolution, and `cb mv`.
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-003.image.card:5:  ref: attach/photo-003.jpg
callback-box/src/schemas/doc.tsx:66:\`<basename>.attach/\` (where \`<basename>\` is the card's filename
callback-box/src/schemas/doc.tsx:68:the scoped form \`attach/<filename>\`.
callback-box/src/schemas/doc.tsx:74:store/notes/Trip_Report.attach/photo.jpg
callback-box/src/schemas/doc.tsx:82:![A view from the cabin](attach/photo.jpg)
callback-box/src/schemas/doc.tsx:87:The image lives inside \`Trip_Report.attach/\` (the card's scope), not
callback-box/src/schemas/extfile.tsx:9: * the card's `.attach/` scope (bare `{% source %}` anchors target the live file).
callback-box/src/schemas/extfile.tsx:113:\`.commentary.card\` inside this card's attach scope (\`<basename>.attach/\`), and
callback-box/src/schemas/extfile.tsx:122:box/reviews/Foo_Source.attach/Foo_Source.commentary.card   # remarks (optional)
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-002.image.card:5:  ref: attach/photo-002.jpg
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.capture-session.card:9:  - attach/photo-001.image.card
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.capture-session.card:10:  - attach/photo-002.image.card
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.capture-session.card:11:  - attach/photo-003.image.card
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.capture-session.card:13:  - attach/audio-001.audio.card
callback-box/docs/glossary.md:24:**attach scope** — A directory named `<basename>.attach/` sitting next to a card with the same basename. Holds the card's attached files. Cards reference into it via `<filename ref="attach/...">`. Nested cards have nested attach scopes.
callback-box/docs/glossary.md:26:**attachment** — Any file inside a `.attach/` scope, regardless of how it's stored in git. A markdown sidecar, a notes file, a photo — all attachments. Commits to git normally unless it's also an asset.
callback-box/docs/glossary.md:30:**asset manifest** — `manifest.json` inside each `.attach/` directory recording every asset's size, mtime, and sha256. Commits to git; the assets themselves don't. Kept in sync by the pre-commit hook. See `docs/asset-manifests.md`.
callback-box/test/search-index.doctest.md:140:await box.write("store/notes/Note.attach/snippet.md", "apportioned share duplicate inside attach scope");
callback-box/test/search-index.doctest.md:159:  "---\ndrive-id: d1\ntitle: Project Notes\nmodified: 2026-05-01\nlink: https://docs.google.com/document/d/d1/edit\nowner: o@example.com\ncontent:\n  ref: attach/Notes.md\n---\n"
callback-box/test/search-index.doctest.md:161:await box.write("store/drive/Notes.attach/Notes.md", "Planning the lighthouse migration.");
callback-box/test/search-index.doctest.md:166:await box.write("store/drive/Notes.attach/Notes.md", "Planning the submarine migration instead.");
callback-box/test/card-loaders.doctest.md:105:  filename: { ref: "attach/photo.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
callback-box/test/card-loaders.doctest.md:132:  filename: { ref: "attach/p.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
callback-box/test/card-loaders.doctest.md:137:=> {"status":"analyzed","has-text":true,"rotation":"90","filename":"attach/p.jpg"}
callback-box/docs/doc-graph.html:380:        <div class="ring-chips"><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/CLAUDE-MD-REVIEW.md" style="--c:#a3a394" title="CLAUDE-MD-REVIEW.md — &quot;CLAUDE.md Review — 2026-04-28&quot; (448 lines)">CLAUDE-MD-REVIEW.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/activities-design.md" style="--c:#a3a394" title="docs/activities-design.md — &quot;Activities — Design Proposal&quot; (311 lines)">docs/activities-design.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/activities-retrospective.md" style="--c:#a3a394" title="docs/activities-retrospective.md — &quot;Activities — Retrospective&quot; (44 lines)">docs/activities-retrospective.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/01-what-is-this.md" style="--c:#a3a394" title="docs/architecture/01-what-is-this.md — &quot;What Is This Thing?&quot; (66 lines)">docs/architecture/01-what-is-this.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/02-cards-and-memory.md" style="--c:#a3a394" title="docs/architecture/02-cards-and-memory.md — &quot;Cards and Memory&quot; (99 lines)">docs/architecture/02-cards-and-memory.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/attach-implementation.md" style="--c:#a3a394" title="docs/attach-implementation.md — &quot;Implementation spec: `.attach/` directories&quot; (344 lines)">docs/attach-implementation.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/box-user-account-spec.md" style="--c:#a3a394" title="docs/box-user-account-spec.md — &quot;Spec: Box as Linux User Account&quot; (402 lines)">docs/box-user-account-spec.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/boxes-as-packages.md" style="--c:#a3a394" title="docs/boxes-as-packages.md — &quot;Design Exploration: Boxes as Code Repositories&quot; (701 lines)">docs/boxes-as-packages.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/capture-pipeline-redesign.md" style="--c:#a3a394" title="docs/capture-pipeline-redesign.md — &quot;Capture Pipeline Redesign&quot; (128 lines)">docs/capture-pipeline-redesign.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/chat-schedules.md" style="--c:#6d28d9" title="docs/chat-schedules.md — &quot;Chat Schedules&quot; (94 lines) · Wakeup &amp; Reactor">docs/chat-schedules.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/cli-restructure.md" style="--c:#a3a394" title="docs/cli-restructure.md — &quot;`cb` CLI Restructure — Plan&quot; (163 lines)">docs/cli-restructure.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/design-card-views.md" style="--c:#a3a394" title="docs/design-card-views.md — &quot;Card View Plugin System&quot; (876 lines)">docs/design-card-views.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/design-vision.md" style="--c:#a3a394" title="docs/design-vision.md — &quot;Callback Box: Design Vision and Architecture&quot; (68 lines)">docs/design-vision.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/event-bus-design.md" style="--c:#a3a394" title="docs/event-bus-design.md — &quot;Event Bus Design&quot; (142 lines)">docs/event-bus-design.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/gmail-setup.md" style="--c:#0e7490" title="docs/gmail-setup.md — &quot;Gmail Connector Setup&quot; (85 lines) · Connectors">docs/gmail-setup.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/google-drive.md" style="--c:#0e7490" title="docs/google-drive.md — &quot;Google Drive Integration&quot; (140 lines) · Connectors">docs/google-drive.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/google-setup.md" style="--c:#a3a394" title="docs/google-setup.md — &quot;Google Cloud Console Setup&quot; (136 lines)">docs/google-setup.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/landmark-curation.md" style="--c:#a3a394" title="docs/landmark-curation.md — &quot;Landmark Curation&quot; (48 lines)">docs/landmark-curation.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/photo-storage-investigation.md" style="--c:#a3a394" title="docs/photo-storage-investigation.md — &quot;Photo storage investigation: the ledger box is 20G&quot; (187 lines)">docs/photo-storage-investigation.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/prompt-logging.md" style="--c:#a3a394" title="docs/prompt-logging.md — &quot;Prompt Logging for Agent Invocations&quot; (212 lines)">docs/prompt-logging.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/scheduler.md" style="--c:#6d28d9" title="docs/scheduler.md — &quot;Scheduler&quot; (93 lines) · Wakeup &amp; Reactor">docs/scheduler.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/stack-decisions.md" style="--c:#a3a394" title="docs/stack-decisions.md — &quot;Stack Decisions&quot; (1186 lines)">docs/stack-decisions.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/state-management-comparison.md" style="--c:#a3a394" title="docs/state-management-comparison.md — &quot;State Management Comparison: Zustand vs MobX-State-Tree vs Valtio vs XState&quot; (831 lines)">docs/state-management-comparison.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/telegram-setup.md" style="--c:#0e7490" title="docs/telegram-setup.md — &quot;Telegram Connector Setup&quot; (136 lines) · Connectors">docs/telegram-setup.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/todo-security.md" style="--c:#a3a394" title="docs/todo-security.md — &quot;Security TODOs&quot; (25 lines)">docs/todo-security.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/test/manual/README.md" style="--c:#a3a394" title="test/manual/README.md — &quot;Manual tests&quot; (21 lines)">test/manual/README.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/THINKING_CLAUDE.md" style="--c:#a3a394" title="THINKING_CLAUDE.md — &quot;Thinking Machine Mode&quot; (93 lines)">THINKING_CLAUDE.md</a></div>
callback-box/docs/implemented-plans/box-search.md:81:  card's `.attach/` scope referenced by `content.ref`
callback-box/docs/implemented-plans/box-search.md:84:  `attach/msg-N.body.txt` via `body-file.ref`
callback-box/docs/stack-decisions.md:225:- `src/webapp/trpc/router.ts` — Root appRouter merging the sub-routers, exports `AppRouter` type
callback-box/docs/stack-decisions.md:247:**Frontend `api.ts`** shrank substantially (from ~815 lines) and now holds only `getApiBase()`, SSE/streaming functions, file upload functions, and legacy type exports. These functions use manual `fetch()` (not TanStack Query) because TanStack Query is designed for cacheable request/response patterns — SSE streams, file uploads, and long-lived connections don't fit that model.
callback-box/docs/cards-as-markdown.md:40:**Loader dispatch:** `src/core/card-io.ts` `loadCardFile()` returns a discriminated union of `FrontmatterLoadedCard | XmlLoadedCard`. Frontmatter dispatch uses `cardSchemas` (Map keyed by `type:` field); XML falls through to the legacy cardworks `parseCard`. This lets XML and frontmatter cards coexist during and after the migration.
callback-box/docs/cards-as-markdown.md:48:**Question (original):** Should cards change format — keeping `Name.type.card` filenames but moving the contents from XML (Zod-validated via cardworks) to Markdown body + YAML frontmatter + Markdoc inline tags (validated by per-type schemas), with related files moving into a sibling `Name.attach/` directory?
callback-box/docs/cards-as-markdown.md:76:Attachments can be plain `.md` files (not cards — they're attached markdown) or cards themselves (e.g., a capture session's photo cards). The `.attach/` scope doesn't restrict the format inside it; cards within an attachment scope are still cards, plain `.md` inside is still plain markdown.
callback-box/docs/cards-as-markdown.md:100:**`BaseName.attach/`** — basename only, no type qualifier. Examples:
callback-box/docs/cards-as-markdown.md:104:Voice_Memo.attach/
callback-box/docs/cards-as-markdown.md:108:photo-001.attach/
callback-box/docs/cards-as-markdown.md:117:**No two cards in the same directory may share a basename.** `Foo.memo.card` and `Foo.image.card` cannot coexist as siblings — that's a lint error. Each card's basename is unique within its directory, and `Foo.attach/` therefore has exactly one owner.
callback-box/docs/cards-as-markdown.md:121:- The old XML format used same-basename-different-type for implied pairing (e.g. `Voice_Memo.memo.card` next to `Voice_Memo.m4a`, where the `.m4a` implicitly belonged to the memo). The `.attach/` directory mechanism replaces that pattern explicitly. Keeping both would give two ways to associate files with cards — confusing.
callback-box/docs/cards-as-markdown.md:122:- `cb mv Foo.memo.card` moves `Foo.attach/` if it exists, with no ambiguity about which directory belongs to which card.
callback-box/docs/cards-as-markdown.md:123:- `ls` shows the pairing visually: `Foo.memo.card` next to `Foo.attach/`, same prefix.
callback-box/docs/cards-as-markdown.md:126:#### `attach/` as a virtual path prefix
callback-box/docs/cards-as-markdown.md:128:Inside reference values (frontmatter strings or Markdoc tag attribute values), the prefix `attach/` is reserved to mean "this card's own attachment scope." A reference value `attach/photo-002.jpg` resolves to `<basename>.attach/photo-002.jpg` — no need for the writer to spell out the directory.
callback-box/docs/cards-as-markdown.md:131:audio: attach/voice-memo-001.webm
callback-box/docs/cards-as-markdown.md:133:  ref: attach/photo-002.jpg
callback-box/docs/cards-as-markdown.md:138:{% image-ref ref="attach/photo-001.jpg" /%}
callback-box/docs/cards-as-markdown.md:143:- Starts with `attach/` → virtual; this card's attachment scope
callback-box/docs/cards-as-markdown.md:147:The `attach/` prefix being reserved means a real directory literally named `attach/` is forbidden **anywhere in the regular box tree** (lint error) — not just at the root. The one place this rule loosens is inside an attachment scope: `Foo.attach/` directories are more free-form, and contents can be named whatever fits the data.
callback-box/docs/cards-as-markdown.md:151:Virtual interpretation in reference values only fires when `attach/` is the *first* path segment of a value — mid-path occurrences (`store/captures/audio-001.attach/clip.webm`) are literal directory names within `Foo.attach/` scopes, not virtual prefixes.
callback-box/docs/cards-as-markdown.md:188:  scan-XXXXX.attach/
callback-box/docs/cards-as-markdown.md:190:    photo-001.attach/
callback-box/docs/cards-as-markdown.md:194:    photo-002.attach/
callback-box/docs/cards-as-markdown.md:197:    source.attach/
callback-box/docs/cards-as-markdown.md:201:Note the uniform `Foo.attach/` rule — capture session children live inside `scan-XXXXX.attach/`, same as any other card's attachments. The session card and its attachment dir share the basename; nested cards (image, file) follow the same pattern recursively.
callback-box/docs/cards-as-markdown.md:210:  ref: attach/photo-002.jpg
callback-box/docs/cards-as-markdown.md:237:Today the inbox is a flat soup of cards and binaries; a fresh agent has to infer that `photo-001-back.jpg` belongs to `photo-001.image.card` by basename matching. With `.attach/` directories, ownership is mechanical: anything inside `Foo.attach/` belongs to `Foo`. Searches scoped to a card become a directory walk.
callback-box/docs/cards-as-markdown.md:239:This benefit is fully independent of the body-format change. We could adopt `.attach/` while keeping XML cards — and should, as phase 1, regardless of whether phases 2–4 happen.
callback-box/docs/cards-as-markdown.md:293:### 5. The `Foo.attach/` indirection is slightly verbose
callback-box/docs/cards-as-markdown.md:295:Today: `ref="photo-001.jpg"`. Tomorrow with the explicit prefix: `ref: attach/photo-001.jpg`. A small cost, paid uniformly. The `attach/` virtual prefix discussed later in this doc resolves this — the prefix lets the writer use just the filename, with the card's `.attach/` directory inferred.
callback-box/docs/cards-as-markdown.md:337:The "uniform `Foo.attach/`" rule from earlier in this doc resolves this: capture-session children live in `scan-XXXXX.attach/` like any other card's attachments. There's no special "directory IS the card" case — cards always have a single file, and attachments always live in a sibling `Foo.attach/` directory.
callback-box/docs/cards-as-markdown.md:346:2. **One card owns the directory; others attached to it.** An arbitrary "main" card claims ownership; tagging cards live in its `.attach/`. Forced and unnatural for things that genuinely are peers.
callback-box/docs/cards-as-markdown.md:357:- **String with prefix** (`ref:photo-001.image.card` or `attach/foo.jpg`): viable. The `attach/` virtual prefix we adopted IS this approach for attachment paths. Easy to grep (search the value, not just keys). Works for content situations and lists.
callback-box/docs/cards-as-markdown.md:360:The design as it stands uses object form `{ ref: "..." }` for refs that wrap metadata, and bare paths with the `attach/` virtual prefix for attachments. The Ref design section details this.
callback-box/docs/cards-as-markdown.md:368:**For phase 1 (`.attach/` adoption):** standalone, no body-format change, can happen before any of the rest. Fixes a real cleanliness wart in the current ad-hoc system.
callback-box/docs/cards-as-markdown.md:417:For phase 1 (`.attach/`): feels-right is enough. Cleaner ad-hoc layout is its own justification; no measurement needed.
callback-box/docs/cards-as-markdown.md:423:Ran the explanation-length test by rewriting the "Cards" section of `CLAUDE.md` under three scenarios: current (baseline), `.attach/` change only, full migration to `.attach/` + Markdown.
callback-box/docs/cards-as-markdown.md:443:### Scenario B — `.attach/` only
callback-box/docs/cards-as-markdown.md:450:**Naming**: `Name.type.card` — the type determines which schema validates it (e.g. `Meeting_Notes.memo.card`, `2026-05-22_kitchen.capture-session.card`). Attachments live in a sibling `Name.attach/` directory: `Voice_Memo.memo.card` + `Voice_Memo.attach/voice-memo.webm`. No two cards in the same directory may share a basename.
callback-box/docs/cards-as-markdown.md:461:### Scenario C — `.attach/` + Markdown
callback-box/docs/cards-as-markdown.md:468:**Naming**: `Name.type.card` — the middle extension is the type. Attachments live in `Name.attach/`. No basename collisions across types in the same directory.
callback-box/docs/cards-as-markdown.md:472:**Refs**: `ref:` for box-internal pointers, `href:` for external URLs. Paths starting with `attach/` resolve to this card's attachment scope. Refs usually carry a reason — body content or a `reason=` attribute.
callback-box/docs/cards-as-markdown.md:479:~165 words. 11 concepts. Bespoke project-specific shrinks to 3: `defineCard()`, Markdoc, `attach/` virtual prefix. The XML-specific items (`cardworks`, `element()`, flat-XML formatting, `instructions` field) disappear; in their place are concepts more likely to be familiar (Markdown, YAML, JSON Schema, Markdoc).
callback-box/docs/cards-as-markdown.md:486:| B (`.attach/` only) | ~155 | 10 | 6 |
callback-box/docs/cards-as-markdown.md:495:4. **B is a real but small win.** One concept added (the `.attach/` directory pattern), one rule added (no basename collisions), in exchange for eliminating the "which files exactly belong to this card?" ambiguity. Net cognitive load: slightly lower. Worth doing.
callback-box/docs/cards-as-markdown.md:513:1. **Just the attachment directory change.** Keep `.card` XML, but introduce `.attach/` directories for binary siblings. Lowest cost, captures the "ownership normalization" benefit. Also serves as a low-risk dress rehearsal.
callback-box/docs/cards-as-markdown.md:525:**Phase 1 (`.attach/`) is unambiguously worth doing**, regardless of whether the body-format change ever happens. The current layout is ad hoc — sibling binaries that pair by basename, no clear "this file belongs to that card" rule. The cleanup is its own justification. It's not optimized for agent legibility (that's not really the point); it's optimized for not-being-ad-hoc.
callback-box/docs/cards-as-markdown.md:546:3. **Attachments** — does it have any? Are they explicit or implicit? Does `Foo.attach/` help?
callback-box/docs/cards-as-markdown.md:556:| `memo` | ✅ `<content>` is obvious. ⚠️ Voice memos have `<transcription>` too — second prose block needs a frontmatter `\|`-block or a `## Transcription` section convention. | ✅ Flat, simple. | ⚠️ Voice memos have a sibling audio file. `.attach/` helps a little, but the audio is the only attached file ever — overkill. | ⚠️ If transcription stays in frontmatter, one `\|`-block per voice memo. | ✅ `<context url=…>` is URL not card-ref; trivial. |
callback-box/docs/cards-as-markdown.md:558:| `feedback` | ⚠️ `<response>` or `<comment>` is the prose; voice feedback adds `<transcription>`. Same multi-prose pattern as memo. | ✅ Discriminated text/voice union. | ⚠️ Voice feedback has audio. `.attach/` helps. | ⚠️ Transcription as `\|`-block. | ✅ `<target ref="path#fragment">` is well-defined. |
callback-box/docs/cards-as-markdown.md:560:| `procedure-run` | ❌ No prose body. Execution log: steps with status, stdout, session-id, git-ref, review. | ✅ Clean. | ⚠️ `<stdout>` can be huge. Strong argument for moving stdout into `run.attach/step-N.stdout.txt` files instead of inline strings — same problem the XML form has, format change is an opportunity to fix it. | ❌ Without stdout-as-file, frontmatter would balloon. | ✅ None. |
callback-box/docs/cards-as-markdown.md:561:| `image` | ⚠️ `<description>` is the obvious body. But `<text source="back">` elements (multiple, can be long) are also prose extracted from the image. Picking one for the body forces the other into frontmatter as a list of `\|`-blocks. | ⚠️ Doable; `<filename>` and `<exif>` are flat, `<text>` is array, `<document>` has nested `<date>`. | ✅ **Strong fit for `.attach/`.** Today: `photo-001.jpg`, `photo-001-back.jpg`, sometimes EXIF dumps live as siblings. `photo-001.attach/` cleanly contains them. | ⚠️ Multiple `<text>` blocks could be heavy. | ✅ `<filename ref=…>` becomes a path inside the attachment scope. |
callback-box/docs/cards-as-markdown.md:562:| `audio` | ⚠️ `<transcript>` is the obvious body. `<summary>` is also prose. Same problem. | ✅ Clean. | ✅ **Strong fit for `.attach/`.** `audio-001.webm` + `audio-001.timing.json` siblings → `audio-001.attach/`. | ⚠️ Summary in frontmatter as a `\|`-block. | ✅ Filename ref. |
callback-box/docs/cards-as-markdown.md:563:| `file` | ⚠️ `<description>` is the natural body, but it's typically empty or one sentence. | ✅ Clean. | ✅ **Strong fit.** The file itself IS the attachment. `tax-return.attach/tax-return.pdf`. | ✅ Tiny. | ✅ Filename ref. |
callback-box/docs/cards-as-markdown.md:564:| `capture-session` | ❌ No prose body. Container card with refs to image/audio/file cards plus a `<transcript>` of interleaved `<text>`/`<silence>`/`<image>`. | ⚠️ Mixed-content `<transcript>` is the awkward part — array of typed nodes (text/silence/image-marker). | ⚠️ Container card. Today the directory IS the session; siblings are the children. With the new format, either: (a) keep using the directory as the scope (no `.attach/`), or (b) treat sub-cards as members of the parent `.attach/`. (a) is more natural. | ⚠️ The transcript array can be long with multi-line text segments. | ✅ Many refs to child cards — works as object list. |
callback-box/docs/cards-as-markdown.md:566:| `recipe` | ⚠️ `<description>` is the obvious body. But sections, ingredients, steps, notes are all structured AND contain prose. Steps have `@`-syntax for inline ingredient refs (custom syntax — survives in either format). | ⚠️ Sections with ingredients (amount/unit/text) and steps. Tractable. | ⚠️ Optional `<image src=…>`. Minor `.attach/` win. | ⚠️ Steps in frontmatter would be ugly; better as a body section list. Forces a body-sections convention for multi-prose cards. | ✅ Image src as path. |
callback-box/docs/cards-as-markdown.md:568:| `email-message` | ✅ Snippet only; the actual body **is already** in a sibling `.txt` file (security boundary). The card is metadata-only by design. | ✅ Clean. | ✅ **Strong fit for `.attach/`** — the body `.txt` and binary attachments naturally belong inside. Already half-there with the sibling-`.txt` convention. | ✅ Snippet is short. | ✅ body-file path, attachment refs. |
callback-box/docs/cards-as-markdown.md:569:| `email-outbound` | ✅ `<body>` IS the body. **Cleanest fit.** Markdown subset already enforced. | ✅ Clean. | ✅ None today (future attachments would fit `.attach/`). | ✅ Body in body. | ✅ in-reply-to ref. |
callback-box/docs/cards-as-markdown.md:581:| `person` | ✅ `<notes>` is the natural body. Other fields are short scalars. Decent fit. | ✅ Clean. | ✅ None typically (a portrait could live in `.attach/`). | ✅ Notes in body. | ✅ None directly. |
callback-box/docs/cards-as-markdown.md:582:| `sheet` | ❌ No prose body. Metadata pointing to JSON tab files. | ✅ Clean. | ✅ **Already uses sibling directory pattern** (`Budget/` next to `Budget.sheet.card`). Renaming to `.attach/` is mechanical. | ✅ Tiny. | ✅ Sheet-tab refs. |
callback-box/docs/cards-as-markdown.md:583:| `doc` | ✅ **No body needed** — the doc body lives in a sibling `.md` file (`Project_Notes.md`). Card is metadata-only by design. | ✅ Clean. | ✅ **Already uses sibling-file pattern.** Move into `.attach/`. | ✅ Tiny. | ✅ `<content ref=…>`. |
callback-box/docs/cards-as-markdown.md:584:| `landmark` | ❌ No prose body. Bookmark structure: label, symbol, links, expand templates. | ⚠️ `<link ref=…>` vs `<link template-ref=…>` distinction must survive — different validation rules. Two link variants in oneOf. | ⚠️ Optional portrait via `<symbol src=…>`; minor `.attach/` use. | ✅ Tiny. | ⚠️ Two ref kinds (literal vs template) need careful schema design. |
callback-box/docs/cards-as-markdown.md:599:1. **`.attach/` is a clear win** for the cards that have attachments: `image`, `audio`, `file`, `email-message`, `sheet` (rename), `doc` (rename). Six clean wins. For `capture-session` and `email-thread`, the choice between "directory IS the scope" vs "directory contains a sentinel card + `.attach/`" is real and needs a call. **None of this needs the body-format change.**
callback-box/docs/cards-as-markdown.md:615:1. **Definitely do the `.attach/` change** for the six clear-win schemas (`image`, `audio`, `file`, `email-message`, `sheet`, `doc`) and the two container-cards (`capture-session`, `email-thread`). That's a concrete, separable improvement that captures the strongest claim ("ownership is mechanical") and doesn't depend on changing the body format.
callback-box/docs/cards-as-markdown.md:1005:  run.attach/
callback-box/docs/cards-as-markdown.md:1034:(stdout files live in `run.procedure-run.attach/`; paths in `stdout-file` are relative to that scope, declared via `format: attachment-path` in the schema.)
callback-box/docs/cards-as-markdown.md:1038:**Verdict.** Easy win, **but only if `.attach/` exists.** This is one of the strongest arguments for adopting `.attach/` independently of the body-format question — the same fix improves both the XML and the proposed MD forms.
callback-box/docs/cards-as-markdown.md:1064:  photo-001.attach/
callback-box/docs/cards-as-markdown.md:1068:  photo-002.attach/
callback-box/docs/cards-as-markdown.md:1071:  source.attach/
callback-box/docs/cards-as-markdown.md:1075:Closest to today. The session directory remains the unit. Each child card has its own `.attach/` for its binaries. The session card refs to children with paths relative to the session dir.
callback-box/docs/cards-as-markdown.md:1077:#### Option B — Uniform: every card has a sibling `.attach/`
callback-box/docs/cards-as-markdown.md:1082:  scan-XXXX.attach/
callback-box/docs/cards-as-markdown.md:1084:    photo-001.attach/
callback-box/docs/cards-as-markdown.md:1088:    photo-002.attach/
callback-box/docs/cards-as-markdown.md:1091:    source.attach/
callback-box/docs/cards-as-markdown.md:1095:More uniform with single-card cases (every card lives next to its `.attach/`). But adds one level of nesting and the session directory loses its identity as "the unit" — it's just an attach dir now.
callback-box/docs/cards-as-markdown.md:1111:    filename: photo-001.attach/photo-001.jpg
callback-box/docs/cards-as-markdown.md:1179:  ref: photo-002.attach/photo-002.jpg
callback-box/docs/cards-as-markdown.md:1203:filename: photo-002.attach/photo-002.jpg
callback-box/docs/cards-as-markdown.md:1233:  ref: attach/photo-002.jpg
callback-box/docs/cards-as-markdown.md:1587:image: { src: pasta-norma.attach/norma.jpg }
callback-box/docs/cards-as-markdown.md:1646:5. **`.attach/` adoption is still independent of all of this.** Stdout-in-XML is already a wart. Email-attachments-in-thread-dir is already a sibling-by-convention. Doing `.attach/` first cleans up several pre-existing issues independently of the body-format question.
callback-box/docs/cards-as-markdown.md:1648:6. **Append-only and unbounded-text cards still need attached files.** `chat-thread` → JSONL. `procedure-run.stdout` → text file in `.attach/`. This is a scale problem that no body format solves.
callback-box/docs/cards-as-markdown.md:1656:### Phase 1 — `.attach/` (no format change)
callback-box/docs/cards-as-markdown.md:1658:Adopt `Foo.attach/` directories for cards that have attachments. This is the strongest single claim ("ownership is mechanical") and is fully separable from any body-format change. Six clean wins (`image`, `audio`, `file`, `email-message`, `sheet` rename, `doc` rename) plus two container-card layout decisions (`capture-session`, `email-thread`).
callback-box/docs/cards-as-markdown.md:1662:**Deliverables:** `.attach/` convention documented and enforced; migrator for existing boxes; `procedure-run` stdout extraction. No schema changes.
callback-box/docs/cards-as-markdown.md:1719:- **`.attach/` directory convention** with refs resolving relative to it for in-card paths and absolute from box root for cross-card paths.
callback-box/docs/cards-as-markdown.md:1739:The case for proceeding is stronger than it was at the start of this RFC. The case against is the same as ever: it's a real migration with real cost, and the agent-clarity payoff is unproven until we measure it. Phase 1 (`.attach/`) is unambiguously worth doing; phase 2 (Markdoc pilot) is worth doing if we're willing to pay for the measurement to justify phases 3-4.
callback-box/docs/cards-as-markdown.md:1755:- **Refs** point **inside the box** — to another card, or to a file in this card's `.attach/` scope. They must resolve. They're rewritten when files move. Examples: `<context ref="related.memo.card">`, `<message-ref ref="msg-001.email-message.card">`, `<filename ref="photo.jpg">`.
callback-box/docs/cards-as-markdown.md:1872:- **Attachment paths** (path to a file in this card's `.attach/`) → **bare strings in schema-declared fields**. Schema says `{ type: "string", format: "attachment-path" }`. Different concept from refs; doesn't need the wrapping.
callback-box/docs/cards-as-markdown.md:1936:- `audio` is a bare string. Schema declares it `format: attachment-path`. Resolved relative to `{basename}.attach/`. Validates that `voice-memo.attach/voice-memo-001.webm` exists.
callback-box/docs/cards-as-markdown.md:1945:  ref: attach/photo-002.jpg
callback-box/docs/cards-as-markdown.md:2054:- **Attachment paths** — relative to the card's `{basename}.attach/` directory. Schema-declared via `format: attachment-path`. Example: `audio: voice-memo-001.webm` resolves to `Voice_Memo.attach/voice-memo-001.webm`.
callback-box/docs/cards-as-markdown.md:2072:store/recipes/Norma.recipe.card:23: Attachment path "norma.jpg" not found at Norma.attach/norma.jpg
callback-box/docs/doc-graph.md:14:- **docs/attach-implementation.md** — "Implementation spec: `.attach/` directories" (344 lines)
callback-box/docs/doc-graph.md:273:Title: "Implementation spec: `.attach/` directories" | 344 lines
callback-box/docs/doc-graph.md:284:- docs/glossary.md:30 (mention) — **asset manifest** — `manifest.json` inside each `.attach/` directory recording every asset's size, mtime, and sha256. C
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:12:markdown + frozen snapshot in `.attach/`) *and* the boxholder's remarks.
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:79:  writes card + `attach/readable.md` + `attach/page.frozen` in one commit,
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:80:  sets `defaultRef: "attach/readable.md"`, returns `{ created, open }` where
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:90:  every `*.card` *including inside `.attach/`* but `:35` treats attach-scope
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:106:  `Foo.attach/` is the *private-bag* special case; a typed `Foo/` is a
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:159:    frozen: z.string().optional(),  // in-box ref to attach/page.frozen
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:168:`attach/readable.md` file. The webpage card *is* the document (mirrors how
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:171:(readable in `.attach/`) and it's what makes the webpage card render itself.
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:176:`attach/page.frozen`.
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:184:(body = readable markdown, `attach/page.frozen`, provenance frontmatter) and,
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:194:- `<destDir>/<name>.attach/page.frozen` — the snapshot.
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:195:- `<destDir>/<name>.attach/<name>.commentary.card` — the commentary, **inside
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:208:**First chunk:** endpoint writes `.webpage.card` + `attach/page.frozen` + an
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:209:empty-body `attach/*.commentary.card` + route doctest asserting the three-file
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:252:  `Foo.attach/readable.md`, provenance frontmatter copied over, `frozen` ref
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:253:  kept (`Foo.attach/page.frozen` stays in place);
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:254:- move the remarks into the attach scope as `Foo.attach/Foo.commentary.card`,
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:256:  `attach/readable.md` to the owning page (per Open question 1);
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:257:- delete `Foo.attach/readable.md` (now the webpage body).
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:267:`Foo.attach/Foo.commentary.card`, no stray `readable.md`) and that the webpage
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:301:| Migrator hits a `.commentary.card` with `frozen` set but no `attach/page.frozen` on disk | No | No | Silent (webpage card with dangling frozen ref) |
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:308:inside `Host.attach/` (correctly owned, per the boxholder), the *only* way the
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:402:plus its attachments — readable markdown (attach/readable.md) and the frozen
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:406:  body + `attach/page.frozen`) *and* a separate commentary card referencing
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:424:   (renders a hand-made `.webpage.card` + `attach/*.commentary.card`,
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:427:3. **Track 2** — endpoint writes `.webpage.card` + `attach/page.frozen` +
callback-box/src/cli/commands/attachments.ts:7: *   cb attachments migrate        # write manifests for every asset in .attach/
callback-box/src/cli/commands/attachments.ts:22:  .description("Scan all .attach/ scopes; non-zero exit on errors. Read-only.")
callback-box/src/cli/commands/attachments.ts:27:  .description("Write manifests for every asset in .attach/. Idempotent.")
callback-box/docs/implemented-plans/shared-frontend-backend-code.subplan.md:49:  its `exports` field is null, so Node ESM imports resolve to the
callback-box/docs/plans/box-commentary-surface.md:155:  (`cardSchemas[]`). A schema's `instructions` becomes a path-scoped agent
callback-box/test/asset-manifest.doctest.md:3:Per-`.attach/` manifest format, hashing, and load/save. See
callback-box/test/asset-manifest.doctest.md:42:=> /box/inbox/foo.attach/manifest.json
callback-box/test/asset-manifest.doctest.md:64:await box2.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest.doctest.md:65:const entry = await computeEntry(box2.path("foo.attach/photo.jpg"));
callback-box/test/asset-manifest.doctest.md:87:await box3.write("foo.attach/.gitkeep", "");
callback-box/test/asset-manifest.doctest.md:136:const raw = await box5.read("foo.attach/manifest.json");
callback-box/test/asset-manifest.doctest.md:157:await box6.write("foo.attach/manifest.json", JSON.stringify({ files: "not an object" }));
callback-box/test/asset-manifest.doctest.md:187:await box7.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest.doctest.md:188:const fileStat = await stat(box7.path("foo.attach/photo.jpg"));
callback-box/test/routes-files-write.doctest.md:22:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:29:=> store/playground/Playground.attach/sessions/history.jsonl
callback-box/test/routes-files-write.doctest.md:43:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:61:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:76:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:89:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:121:  payload: { path: "store/playground/Playground.attach/sessions/history.jsonl", message: "Save session history" },
callback-box/test/routes-files-write.doctest.md:146:  payload: { path: "store/playground/Playground.attach/sessions/history.jsonl", message: "noop" },
callback-box/test/routes-files-write.doctest.md:168:JSON.stringify(byPath["store/playground/Playground.attach/sessions/history.jsonl"])
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:263:different surfaces in the registry (per CLAUDE.md: *"`cardSchemas[]`
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:264:for frontmatter, `schemas[]` for XML"*).
callback-box/docs/plans/box-migration.subplan.md:72:- **Box-local XML still loads** — `loadBoxSchemas` populates `elementSchemas`
callback-box/docs/plans/box-migration.subplan.md:119:to `cardSchema("bill", { fields, … })` importing from `callback-box/cards` (the
callback-box/test/box-schemas.doctest.md:3:Boxes define their own card types under `config/schemas/*.ts`. Each file default-exports
callback-box/test/box-schemas.doctest.md:35:// `callback-box/cards` specifier (resolved by the tsx hook in registry.ts).
callback-box/test/box-schemas.doctest.md:36:const WIDGET_SCHEMA = `import { body, cardSchema } from "callback-box/cards";
callback-box/test/box-schemas.doctest.md:73:box). The loader segregates them: the `cardSchema()` lands in `cardSchemas`, the `element()`
callback-box/test/box-schemas.doctest.md:74:in `elementSchemas`:
callback-box/test/box-schemas.doctest.md:82:[loaded.cardSchemas.length, loaded.elementSchemas.length, loaded.cardSchemas[0].type, loaded.elementSchemas[0].tagName].join("|")
callback-box/docs/asset-manifests.md:8:**Terminology.** Inside a `.attach/` scope, an *attachment* is any file
callback-box/docs/asset-manifests.md:10:live on disk only and are tracked via this manifest. The `.attach/`
callback-box/docs/asset-manifests.md:11:directory and the `<filename ref="attach/...">` virtual prefix are about
callback-box/docs/asset-manifests.md:14:whole `.attach/` scope even though its job is the asset subset.
callback-box/docs/asset-manifests.md:18:Cards reference assets via `<filename ref="attach/foo.jpg">` into the
callback-box/docs/asset-manifests.md:41:**Manifest in git, blobs out of git.** Each `.attach/` directory contains
callback-box/docs/asset-manifests.md:57:One `manifest.json` per `.attach/` directory, listing direct asset
callback-box/docs/asset-manifests.md:114:Runs on every commit attempt. Walks every `.attach/` directory in the
callback-box/docs/asset-manifests.md:144:This means agents can `mv attach/foo.jpg attach/bar.jpg` freely without
callback-box/docs/asset-manifests.md:158:**/*.attach/**/*.jpg
callback-box/docs/asset-manifests.md:159:**/*.attach/**/*.jpeg
callback-box/docs/asset-manifests.md:160:**/*.attach/**/*.png
callback-box/docs/asset-manifests.md:161:**/*.attach/**/*.webp
callback-box/docs/asset-manifests.md:162:**/*.attach/**/*.avif
callback-box/docs/asset-manifests.md:163:**/*.attach/**/*.heic
callback-box/docs/asset-manifests.md:164:**/*.attach/**/*.tif
callback-box/docs/asset-manifests.md:165:**/*.attach/**/*.tiff
callback-box/docs/asset-manifests.md:166:**/*.attach/**/*.gif
callback-box/docs/asset-manifests.md:167:**/*.attach/**/*.webm
callback-box/docs/asset-manifests.md:168:**/*.attach/**/*.mp3
callback-box/docs/asset-manifests.md:169:**/*.attach/**/*.m4a
callback-box/docs/asset-manifests.md:170:**/*.attach/**/*.wav
callback-box/docs/asset-manifests.md:171:**/*.attach/**/*.pdf
callback-box/docs/asset-manifests.md:172:**/*.attach/**/*.mp4
callback-box/docs/asset-manifests.md:173:**/*.attach/**/*.mov
callback-box/docs/asset-manifests.md:176:Scoped to `**/*.attach/**` only. Binaries outside attach scopes commit
callback-box/docs/asset-manifests.md:252:  scope are both `**/*.attach/**`. If agents start putting big binaries
callback-box/test/attach-path.doctest.md:3:Helpers for the `.attach/` directory convention. Every card may have a sibling directory named `<basename>.attach/`. Refs from the card to its attached files use the virtual prefix `attach/<file>`.
callback-box/test/attach-path.doctest.md:72:=> inbox/Foo.attach/photo-001.jpg
callback-box/test/attach-path.doctest.md:75:=> Foo.attach/audio.webm
callback-box/test/attach-path.doctest.md:78:=> inbox/scan-001.attach/photo-001.image.card
callback-box/test/attach-path.doctest.md:85:=> inbox/Foo.attach/attachments/quarterly.pdf
callback-box/test/attach-path.doctest.md:90:A ref uses the `attach/` virtual prefix when it starts with `attach/` (or is exactly `attach`).
callback-box/test/attach-path.doctest.md:93:isAttachRef("attach/photo-001.jpg")
callback-box/test/attach-path.doctest.md:99:isAttachRef("attach/sub/scan.image.card")
callback-box/test/attach-path.doctest.md:106:isAttachRef("store/x.attach/y.jpg")
callback-box/test/attach-path.doctest.md:112:isAttachRef("./attach/photo.jpg")
callback-box/test/attach-path.doctest.md:119:splitAttachRef("attach/photo-001.jpg")
callback-box/test/attach-path.doctest.md:122:splitAttachRef("attach/sub/scan.image.card")
callback-box/test/attach-path.doctest.md:128:splitAttachRef("store/x.attach/y.jpg")
callback-box/test/attach-path.doctest.md:134:Expands a ref that uses the `attach/` prefix to a path against a card's attach scope.
callback-box/test/attach-path.doctest.md:137:resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg")
callback-box/test/attach-path.doctest.md:138:=> inbox/Foo.attach/photo-001.jpg
callback-box/test/attach-path.doctest.md:140:resolveAttachRef("inbox/Foo.email-message.card", "attach/attachments/foo.pdf")
callback-box/test/attach-path.doctest.md:141:=> inbox/Foo.attach/attachments/foo.pdf
callback-box/test/attach-path.doctest.md:202:isInsideAttachScope("inbox/Foo.attach/photo.jpg")
callback-box/test/attach-path.doctest.md:205:isInsideAttachScope("inbox/Foo.attach/nested/deeper/thing.jpg")
callback-box/test/attach-path.doctest.md:208:isInsideAttachScope("inbox/Foo.attach/scan.image.attach/photo.jpg")
callback-box/test/schemas.doctest.md:299:  frozenRef: "attach/page.frozen",
callback-box/test/schemas.doctest.md:307:frozen: attach/page.frozen
callback-box/docs/plans/pdf-intake-design.md:34:<filename ref="attach/Tax_Return_2025.pdf" captured="2026-05-04T10:23:00Z" source="disk" original-name="tax-return.pdf" mime-type="application/pdf" size="2483920" />
callback-box/docs/plans/pdf-intake-design.md:35:<docling ref="attach/docling.json.gz" />
callback-box/docs/plans/pdf-intake-design.md:38:<text>... rendered markdown, including figure refs like ![](attach/figure-001.avif) ...</text>
callback-box/docs/plans/pdf-intake-design.md:56:Tax_Return_2025.attach/
callback-box/test/contains-state.doctest.md:25:  cardSchemas: await createCardSchemaMap(),
callback-box/test/contains-state.doctest.md:26:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/test/contains-state.doctest.md:126:  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: " + desc + "\n---\n";
callback-box/test/views-compiler.doctest.md:3:The views compiler takes agent-written `.tsx` files and compiles them to ES modules using esbuild. It extracts metadata from named exports and caches compiled output by mtime.
callback-box/test/views-compiler.doctest.md:66:The compiled output is a valid ES module with exports:
callback-box/test/views-compiler.doctest.md:97:When metadata exports are missing, sensible defaults are used:
callback-box/test/migrate-webpage-card.doctest.md:22:// A fused capture commentary: readable + frozen in .attach/, remarks (with an
callback-box/test/migrate-webpage-card.doctest.md:24:const FUSED = "---\ntitle: Foo\ndefaultRef: attach/readable.md\nsource: https://example.com/foo\ncaptured: 2026-06-14\nfrozen: attach/page.frozen\n---\n{% source ref=\"attach/readable.md\" pos=\"body\" version=\"sha256:abc\" %}{% quote %}a distinctive span{% /quote %}{% /source %}\n\nMy remark about it.\n";
callback-box/test/migrate-webpage-card.doctest.md:33:await fs.writeFile(path.join(box, "store/reading/Foo.attach/readable.md"), "# Foo\n\nThe readable body with a distinctive span inside.\n");
callback-box/test/migrate-webpage-card.doctest.md:34:await fs.writeFile(path.join(box, "store/reading/Foo.attach/page.frozen"), "<html>frozen</html>");
callback-box/test/migrate-webpage-card.doctest.md:47:[wpText.includes("source: https://example.com/foo"), wpText.includes("frozen: attach/page.frozen"), wpText.includes("The readable body with a distinctive span")].join(",")
callback-box/test/migrate-webpage-card.doctest.md:64:const cmText = await fs.readFile(path.join(box, "store/reading/Foo.attach/Foo.commentary.card"), "utf8");
callback-box/test/migrate-webpage-card.doctest.md:65:[cmText.includes("My remark about it."), cmText.includes("attach/readable.md")].join(",")
callback-box/test/migrate-webpage-card.doctest.md:77:const cm = await loadCardFromText({ content: cmText, source: "store/reading/Foo.attach/Foo.commentary.card", ctx });
callback-box/test/migrate-webpage-card.doctest.md:95:const BODYPROV = "---\ntitle: Old\ndefaultRef: attach/readable.md\n---\n[Original page](https://old.example.com/x) · captured 2026-06-14T10:36:55.904Z\n\n{% source ref=\"attach/readable.md\" pos=\"body\" version=\"sha256:1\" %}{% quote %}a span{% /quote %}{% /source %}\n\nA remark here.\n";
callback-box/test/migrate-webpage-card.doctest.md:97:await fs.writeFile(path.join(box, "store/reading/Old.attach/readable.md"), "# Old\n\nThe page body.\n");
callback-box/test/migrate-webpage-card.doctest.md:109:const cmText = await fs.readFile(path.join(box, "store/reading/Old.attach/Old.commentary.card"), "utf8");
callback-box/test/migrate-webpage-card.doctest.md:110:[cmText.includes("A remark here."), cmText.includes("Original page"), cmText.includes("attach/readable.md")].join(",")
callback-box/docs/plans/remove-cardworks-and-xml.md:24:> `schemas[]` (the XML `ElementSchema` list) is now empty.
callback-box/docs/plans/remove-cardworks-and-xml.md:84:  `src/schemas/registry.ts:66`: *"export const cardSchemas: CardSchema[]
callback-box/docs/plans/remove-cardworks-and-xml.md:87:  moves from `schemas[]` to `cardSchemas[]`; when `schemas[]` is empty
callback-box/docs/plans/remove-cardworks-and-xml.md:179:tracks run last because they can't start until `schemas[]` is empty.
callback-box/docs/plans/remove-cardworks-and-xml.md:249:`.attach/*.txt` files referenced by path.
callback-box/docs/plans/remove-cardworks-and-xml.md:271:→ complete). Stdout-file handling is in-chunk (write to `.attach/`,
callback-box/docs/plans/remove-cardworks-and-xml.md:355:`src/schemas/landmark.ts` to `cardSchema`; move it `schemas[]`→
callback-box/docs/plans/remove-cardworks-and-xml.md:356:`cardSchemas[]`; rewrite literal-link + destination consumers; doctest
callback-box/docs/plans/remove-cardworks-and-xml.md:391:**What.** Once `schemas[]` is empty: delete the `XmlLoadedCard` arm of
callback-box/docs/plans/remove-cardworks-and-xml.md:473:| procedure-run stdout-file path points at a `.attach/` file deleted by gc | No | No | Silent (empty stdout shown) |
callback-box/docs/plans/remove-cardworks-and-xml.md:571:   stdout to `.attach/*.txt`, or keep short stdout inline and only spill
callback-box/docs/plans/remove-cardworks-and-xml.md:573:   `.attach/` file count becomes noisy.
callback-box/docs/plans/remove-cardworks-and-xml.md:620:   `schemas[]` empty → all of 1–5 done; runs the leftover-XML sweep
callback-box/docs/plans/remove-cardworks-and-xml.md:659:- **Recipe is not a remaining XML *schema*** — already in `cardSchemas[]`
callback-box/docs/plans/web-page-commentary.md:28:  `POST /api/clerk/commentary` (bundle: commentary card + `attach/readable.md`
callback-box/docs/plans/web-page-commentary.md:29:  + `attach/page.frozen`, returns `{created, open}`). Route doctests green.
callback-box/docs/plans/web-page-commentary.md:32:  the dev router: the readable `attach/readable.md` renders in the left pane,
callback-box/docs/plans/web-page-commentary.md:47:returns it → `POST /api/clerk/commentary` writes the card + `attach/readable.md`
callback-box/docs/plans/web-page-commentary.md:48:+ `attach/page.frozen` and returns the `open` URL → browsing the card shows the
callback-box/docs/plans/web-page-commentary.md:86:  quoted text. Two fixes alongside: the chip's `attach/readable.md` ref now
callback-box/docs/plans/web-page-commentary.md:174:  `attachmentPath` (`:60-63`), `attach/` ref prefix (`:17`). *Reuse* to place
callback-box/docs/plans/web-page-commentary.md:176:  `.attach/`.
callback-box/docs/plans/web-page-commentary.md:301:  <destDir>/<Name>.attach/readable.md        # the readable rendering
callback-box/docs/plans/web-page-commentary.md:302:  <destDir>/<Name>.attach/page.frozen        # SingleFile self-contained HTML (LFS)
callback-box/docs/plans/web-page-commentary.md:304:  - The commentary card's `defaultRef: "attach/readable.md"` (in-box, prod-
callback-box/docs/plans/web-page-commentary.md:433:- **Stale ref** — `defaultRef: "attach/readable.md"` lives in the same card's
callback-box/docs/plans/web-page-commentary.md:509:  files appear in the box?" → commentary card + `attach/readable.md` +
callback-box/docs/plans/web-page-commentary.md:510:  `attach/page.frozen`.
callback-box/test/asset-manifest-scan.doctest.md:3:The directory walk that reconciles every `.attach/` manifest against
callback-box/test/asset-manifest-scan.doctest.md:32:await box.write("box/inbox/scan-1.attach/photo-001.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:33:await box.write("box/inbox/scan-1.attach/photo-001.image.attach/photo-001.jpg", "def");
callback-box/test/asset-manifest-scan.doctest.md:34:await box.write("store/old/voice.attach/audio.webm", "ghi");
callback-box/test/asset-manifest-scan.doctest.md:40:box/inbox/scan-1.attach/photo-001.image.attach
callback-box/test/asset-manifest-scan.doctest.md:52:await box2.write("foo.attach/photo-001.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:53:await box2.write("foo.attach/photo-002.jpg", "def");
callback-box/test/asset-manifest-scan.doctest.md:81:await box3.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:108:await box4.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:113:await backdate(box4.path("foo.attach/photo.jpg"));
callback-box/test/asset-manifest-scan.doctest.md:133:await box5.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:136:await box5.write("foo.attach/photo.jpg", "abcdef");
callback-box/test/asset-manifest-scan.doctest.md:157:await box6.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:161:await unlink(box6.path("foo.attach/photo.jpg"));
callback-box/test/asset-manifest-scan.doctest.md:184:await box7.write("foo.attach/old.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:188:await rename(box7.path("foo.attach/old.jpg"), box7.path("foo.attach/new.jpg"));
callback-box/test/asset-manifest-scan.doctest.md:214:await box8.write("session.attach/photo-001.image.card", "<image status='new'/>\n");
callback-box/test/asset-manifest-scan.doctest.md:218:print(`manifest file exists: ${await fileExists(box8.path("session.attach/manifest.json"))}`)
callback-box/test/asset-manifest-scan.doctest.md:236:await box9.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:243:print(`manifest file exists: ${await fileExists(box9.path("foo.attach/manifest.json"))}`)
callback-box/test/asset-manifest-scan.doctest.md:257:inside nested `.attach/` directories (which have their own manifests).
callback-box/test/asset-manifest-scan.doctest.md:259:`<thread>.attach/msg-001.attach/attachments/<file>`. The `attachments/`
callback-box/test/asset-manifest-scan.doctest.md:265:await boxR.write("msg.attach/attachments/Outlook.png", "alpha");
callback-box/test/asset-manifest-scan.doctest.md:266:await boxR.write("msg.attach/attachments/img/inline.jpg", "beta");
callback-box/test/asset-manifest-scan.doctest.md:267:await boxR.write("msg.attach/photo-001.attach/photo-001.jpg", "gamma");
callback-box/test/asset-manifest-scan.doctest.md:276:The nested `.attach/` scope is left to its own scan — not picked up here.
callback-box/test/asset-manifest-scan.doctest.md:288:await box10.write("box/inbox/scan-1.attach/photo-001.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:289:await box10.write("box/inbox/scan-2.attach/photo-001.jpg", "def");
callback-box/test/move-command.doctest.md:9:were written. A card's sibling `<basename>.attach/` directory moves with it,
callback-box/test/move-command.doctest.md:26:Moving a frontmatter card carries its `.attach/` directory along. Other cards
callback-box/test/move-command.doctest.md:29:links to cards that stayed put are rewritten too, while its `attach/`-prefixed
callback-box/test/move-command.doctest.md:36:  "---\ntype: doc\ntitle: Engine\n---\n# Engine\nPhoto: ![p](attach/photo.jpg)\nRelated: [Priya](Priya.doc.card)\n",
callback-box/test/move-command.doctest.md:38:await box.write("box/notes/Engine.attach/photo.jpg", "JPG");
callback-box/test/move-command.doctest.md:41:  "---\ntype: doc\ntitle: Priya\n---\nSee [Engine](Engine.doc.card) and its [photo](Engine.attach/photo.jpg).\n",
callback-box/test/move-command.doctest.md:45:  "---\ntype: doc\ntitle: Index\n---\nAbs [Engine](/box/notes/Engine.doc.card) and [photo](/box/notes/Engine.attach/photo.jpg).\n",
callback-box/test/move-command.doctest.md:59:store/archive/Engine.attach/photo.jpg
callback-box/test/move-command.doctest.md:62:await box.read("store/archive/Engine.attach/photo.jpg")
callback-box/test/move-command.doctest.md:66:The moved card keeps its `attach/` self-ref and gets a recomputed relative link
callback-box/test/move-command.doctest.md:77:Photo: ![p](attach/photo.jpg)
callback-box/test/move-command.doctest.md:91:See [Engine](../../store/archive/Engine.doc.card) and its [photo](../../store/archive/Engine.attach/photo.jpg).
callback-box/test/move-command.doctest.md:103:Abs [Engine](/store/archive/Engine.doc.card) and [photo](/store/archive/Engine.attach/photo.jpg).
callback-box/test/move-command.doctest.md:242:await box.write("box/Old_Name.attach/note.txt", "hi");
callback-box/test/move-command.doctest.md:243:await box.write("box/ref.memo.card", "---\ntype: memo\nref: /box/Old_Name.doc.card\n---\nlink [n](Old_Name.attach/note.txt)\n");
callback-box/test/move-command.doctest.md:248:box/New_Name.attach
callback-box/test/move-command.doctest.md:249:box/New_Name.attach/note.txt
callback-box/test/move-command.doctest.md:259:link [n](New_Name.attach/note.txt)
callback-box/src/cli/lib/git.ts:8: * internals in `git-internal.ts`. This file re-exports the public surface of
callback-box/docs/adding-schemas.md:116:  flags unused exports); only the `validate` reference uses them. `extfile.tsx`
callback-box/docs/adding-schemas.md:129:// Add to cardSchemas[] (frontmatter cards):
callback-box/docs/adding-schemas.md:130:export const cardSchemas: CardSchema[] = [
callback-box/docs/adding-schemas.md:139:(If you're adding a legacy XML schema instead, add it to `schemas[]` and `getCardTypes()` picks it up via `s.tagName` rather than `s.type`.)
callback-box/docs/adding-schemas.md:219:2. `generateDocs()` reads both `schemas` (XML) and `cardSchemas` (frontmatter) from `registry.ts`
callback-box/docs/plans/remove-cardworks-package.md:4:now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
callback-box/docs/plans/remove-cardworks-package.md:17:> The built-in `schemas[]` is empty, but boxes can still author *their own* XML
callback-box/docs/plans/remove-cardworks-package.md:35:  XML card loads; `loadBoxSchemas` segregates `elementSchemas`,
callback-box/docs/plans/remove-cardworks-package.md:65:  (`SCHEMA_DEPS = {"cardworks","zod"}`, `src/schemas/registry.ts:97`), and
callback-box/docs/plans/remove-cardworks-package.md:66:  package.json has **no `exports` map** (`package.json:6`). After cardworks is
callback-box/docs/plans/remove-cardworks-package.md:69:  under a public specifier — add an `exports` entry and have box schemas import
callback-box/docs/plans/remove-cardworks-package.md:70:  `callback-box/cards`, or keep `"cardworks"` as a resolver alias mapping to
callback-box/docs/plans/remove-cardworks-package.md:107:  `loadXmlCard` (`card-io.ts:370`). Built-in `schemas[]` is empty, but
callback-box/docs/plans/remove-cardworks-package.md:108:  `loadBoxSchemas` populates `elementSchemas` from `config/schemas/*.ts`
callback-box/docs/plans/remove-cardworks-package.md:112:  to frontmatter, remove the box-local `element()` path (the `elementSchemas`
callback-box/docs/plans/remove-cardworks-package.md:155:is **compiler-driven refactoring**: removing/!renaming the deleted exports so
callback-box/docs/plans/remove-cardworks-package.md:184:  `XmlLoadedCard`, the `LoadedCard` union, `elementSchemas` in
callback-box/docs/plans/remove-cardworks-package.md:211:  `movePhase2CardFiles`, and ref rewriting is already substring-based in
callback-box/docs/plans/remove-cardworks-package.md:212:  `rewrite-card-refs.ts`). `cli/commands/validate.ts` keeps
callback-box/docs/plans/remove-cardworks-package.md:222:repointing the keep-set (Track B), the deleted XML exports vanish and
callback-box/docs/plans/remove-cardworks-package.md:262:  `cardSchemas` Map + `createCardSchemaMap` already cover frontmatter lookup.
callback-box/docs/plans/remove-cardworks-package.md:265:  (`registry.ts:97`); package.json has no `exports` map (`package.json:6`).
callback-box/docs/plans/remove-cardworks-package.md:266:  Add an `exports` entry exposing `src/cards/` as `callback-box/cards` (or keep
callback-box/docs/plans/remove-cardworks-package.md:282:Then a barrel `src/cards/index.ts` re-exports them, and a codemod-style
callback-box/docs/plans/remove-cardworks-package.md:458:   audit; breaks any box still on `element()`).** Remove the `elementSchemas`
callback-box/docs/plans/remove-cardworks-package.md:461:   `load-context.ts`'s `elementSchemas`, the XML branch of `agent-guide/cards.ts`
callback-box/src/shared/attach-path.ts:2: * Helpers for the `.attach/` directory convention.
callback-box/src/shared/attach-path.ts:4: * Every card may have a sibling directory named `<basename>.attach/`. Files
callback-box/src/shared/attach-path.ts:6: * attached files use the virtual prefix `attach/<file>`; the resolver expands
callback-box/src/shared/attach-path.ts:18:export const ATTACH_PREFIX = "attach/";
callback-box/src/shared/attach-path.ts:56: *   → `"inbox/Foo.attach/photo-001.jpg"`
callback-box/src/shared/attach-path.ts:67: * Test whether a ref value uses the `attach/` virtual prefix. The prefix is
callback-box/src/shared/attach-path.ts:77: * Return the portion of a ref after the `attach/` prefix, or `null` if the ref
callback-box/src/shared/attach-path.ts:80: * `splitAttachRef("attach/photo-001.jpg")` → `"photo-001.jpg"`
callback-box/src/shared/attach-path.ts:81: * `splitAttachRef("attach/sub/scan.image.card")` → `"sub/scan.image.card"`
callback-box/src/shared/attach-path.ts:82: * `splitAttachRef("store/x.attach/y.jpg")` → `null` (mid-path occurrence is literal)
callback-box/src/shared/attach-path.ts:91: * Resolve a ref value that uses the `attach/` prefix to a filesystem path
callback-box/src/shared/attach-path.ts:94: * `resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg")`
callback-box/src/shared/attach-path.ts:95: *   → `"inbox/Foo.attach/photo-001.jpg"`
callback-box/src/shared/attach-path.ts:132: * `<basename>.attach/` directory.
callback-box/docs/plans/remove-cardworks-deletion.md:63:  compiler-driven refactoring — delete the exports, let `tsc` enumerate the
callback-box/docs/plans/remove-cardworks-deletion.md:72:  re-exports `cardSchema`/`body`/`extractRefs`/`splitCardContent`/
callback-box/docs/plans/remove-cardworks-deletion.md:75:- **`frontmatter-field.ts` — the frontmatter reader.** `loadCardFrontmatter`
callback-box/docs/plans/remove-cardworks-deletion.md:85:  a small frontmatter-aware helper (must handle the `attach/`-scope rule,
callback-box/docs/plans/remove-cardworks-deletion.md:86:  CLAUDE.md "refs starting with `attach/` resolve into this scope").
callback-box/docs/plans/remove-cardworks-deletion.md:87:- **`movePhase2CardFiles` + `rewrite-card-refs.ts`** — Phase-2 card moves +
callback-box/docs/plans/remove-cardworks-deletion.md:103:refactoring** (delete exports → `tsc` enumerates stale consumers), already
callback-box/docs/plans/remove-cardworks-deletion.md:109:`callback-box/cards` specifier resolves under the bundled `cb`, deleting
callback-box/docs/plans/remove-cardworks-deletion.md:114:### Track C1 — Make `callback-box/cards` resolve under the bundled `cb` (#17, the gate)
callback-box/docs/plans/remove-cardworks-deletion.md:116:**What.** Box `config/schemas/*.ts` load via a tsx `registerHooks` resolver at
callback-box/docs/plans/remove-cardworks-deletion.md:117:runtime (`registry.ts` `SCHEMA_DEPS = {callback-box, zod, yaml, cardworks}`).
callback-box/docs/plans/remove-cardworks-deletion.md:120:(`box-templates.ts:31`/`:77`) already says `import … from "callback-box/cards"`.
callback-box/docs/plans/remove-cardworks-deletion.md:121:After cardworks is deleted, every box schema must import `callback-box/cards`,
callback-box/docs/plans/remove-cardworks-deletion.md:126:imports but not the TS-source `.js` re-exports in `src/cards/index.ts`
callback-box/docs/plans/remove-cardworks-deletion.md:128:`Cannot find module schema.js`. So `package.json` `exports: { "./cards":
callback-box/docs/plans/remove-cardworks-deletion.md:138:  `exports: { "./cards": "./dist/cards/index.js" }`.
callback-box/docs/plans/remove-cardworks-deletion.md:139:- The box-schema tsx resolver maps `callback-box/cards` → that built JS, which
callback-box/docs/plans/remove-cardworks-deletion.md:143:  `callback-box/cards`.
callback-box/docs/plans/remove-cardworks-deletion.md:146:`callback-box/cards` → the on-disk `src/cards/*.ts` and register tsx for the
callback-box/docs/plans/remove-cardworks-deletion.md:153:**First implementation chunk.** Spike: add the `dist/cards` build + `exports`
callback-box/docs/plans/remove-cardworks-deletion.md:154:entry, then prove a box schema importing `callback-box/cards` loads under
callback-box/docs/plans/remove-cardworks-deletion.md:173:- New `src/core/ref-exists.ts` (or fold into `body-refs.ts`): `resolveRefExists(
callback-box/docs/plans/remove-cardworks-deletion.md:176:  referring card's directory, honoring the `attach/` scope rule (refs starting
callback-box/docs/plans/remove-cardworks-deletion.md:177:  `attach/` resolve into the sibling `Name.attach/` dir); `fs.access` the
callback-box/docs/plans/remove-cardworks-deletion.md:190:ref (and a known-good one, including an `attach/` ref) through
callback-box/docs/plans/remove-cardworks-deletion.md:194:**First implementation chunk.** Write `resolveRefExists` + its doctest; repoint
callback-box/docs/plans/remove-cardworks-deletion.md:216:  Rewrite to read frontmatter via `loadCardFrontmatter`
callback-box/docs/plans/remove-cardworks-deletion.md:236:  data from `loadCardFrontmatter` fields; delete the `findNavigation`/
callback-box/docs/plans/remove-cardworks-deletion.md:241:  `loadCardFrontmatter` and read the `name`/`description` fields. **Verify
callback-box/docs/plans/remove-cardworks-deletion.md:250:  `schemas` to `cardSchemas`, read `.type` instead of `.tagName`.
callback-box/docs/plans/remove-cardworks-deletion.md:260:  `movePhase2CardFiles` + substring rewriting). Confirm via the move doctests
callback-box/docs/plans/remove-cardworks-deletion.md:289:  `elementSchemas` field on `BoxSchemas` (`:181`), the `isElementSchema`
callback-box/docs/plans/remove-cardworks-deletion.md:291:  `createSchemaRegistry`. Remove `cardworks` from `SCHEMA_DEPS` (`:108`) — box
callback-box/docs/plans/remove-cardworks-deletion.md:292:  schemas now import only `callback-box/cards`/`zod`/`yaml`.
callback-box/docs/plans/remove-cardworks-deletion.md:296:  validate/serialize branches (`:225`/`:262`), the `elementSchemas` field on
callback-box/docs/plans/remove-cardworks-deletion.md:299:- `core/load-context.ts` — drop the `elementSchemas` construction; keep
callback-box/docs/plans/remove-cardworks-deletion.md:300:  `cardSchemas`.
callback-box/docs/plans/remove-cardworks-deletion.md:307:  example; the template keeps only the `callback-box/cards` `cardSchema` form.
callback-box/docs/plans/remove-cardworks-deletion.md:352:| `callback-box/cards` doesn't resolve under the bundled `cb` after deletion | No | C1 spike proves it on a real box before deletion | **Silent until a box schema loads at runtime** — the spike is the gate |
callback-box/docs/plans/remove-cardworks-deletion.md:353:| The frontmatter ref-existence checker (C2) wrongly reports "exists", suppressing a broken-ref warning | New doctest (C2) | Mirror cardworks `resolveRef` semantics; cover `attach/` scope | **Silent** (warnings nobody sees fail) — the doctest is the guard |
callback-box/docs/plans/remove-cardworks-deletion.md:354:| `attach/`-scope refs resolve wrong (the one non-trivial ref rule) | New doctest (C2) | Honor the `attach/` rule explicitly | **Silent** — doctest covers a known-good `attach/` ref |
callback-box/docs/plans/remove-cardworks-deletion.md:367:`attach/`-scoped ref before C3 removes the old loader. Resolution: the C2 chunk
callback-box/docs/plans/remove-cardworks-deletion.md:374:  (C2); the doctest is exactly the stale-ref scenario, including `attach/`.
callback-box/docs/plans/remove-cardworks-deletion.md:402:- **Changing `.card` semantics, ref syntax, or the `attach/` rule.** C2
callback-box/docs/plans/remove-cardworks-deletion.md:413:2. **C1 resolution mechanism.** Lean is (a) a `dist/cards` build + `exports`
callback-box/docs/plans/remove-cardworks-deletion.md:436:   `dist/cards`, set `exports` `./cards`, prove a box schema importing
callback-box/docs/plans/remove-cardworks-deletion.md:437:   `callback-box/cards` loads under `bin/cb validate`. Repoint deployed `bill`
callback-box/docs/plans/remove-cardworks-deletion.md:472:  `callback-box/cards` (C1), done in this push.
callback-box/src/cli/lib/git-trailers.ts:6: * git.ts re-exports the public constants from here so callers keep importing
callback-box/src/webapp/routes/api-image.ts:9: *    resolves the `attach/` virtual prefix to `<stem>.attach/<file>`,
callback-box/src/webapp/routes/api-image.ts:66:        if (typeof r === "string" && r.startsWith("attach/")) ref = r;
callback-box/src/webapp/routes/api-image.ts:70:    // XML format (legacy) — grab ref="attach/..." from <filename> element
callback-box/src/webapp/routes/api-image.ts:77:  // `attach/<file>` is a virtual prefix scoped to `<cardStem>.attach/`.
callback-box/src/webapp/routes/api-image.ts:82:  const filePart = ref.slice("attach/".length);
callback-box/docs/boxes-as-packages.md:39:- Replace the regex meta-extractor with a real ESM `import()` of the compiled view module so `name`/`description`/etc. come from actual exports.
callback-box/docs/boxes-as-packages.md:98:Now `callback-box` is genuinely a library: it exports a `startServer(dataRoot)` API, schema helpers, connector base classes, view types. The box uses them like any other Node application.
callback-box/docs/boxes-as-packages.md:330:- Make `callback-box` consumable as a library (proper `exports`, no internal leaks). Validate by getting `test1` to run via `pnpm install && pnpm dev` against a published-locally callback-box. Pure dev-machine work.
callback-box/docs/boxes-as-packages.md:465:1. **Define the public surface** that `callback-box` exports for box consumption: `ViewProps`, schema helpers (re-exported from cardworks), connector base, registration APIs, `startServer(dataRoot)`. Lock import paths.
callback-box/docs/boxes-as-packages.md:466:2. **Make `callback-box` consumable as a library** — proper `exports` map, no deep imports leaking internals, document the surface.
callback-box/docs/attach-implementation.md:1:# Implementation spec: `.attach/` directories
callback-box/docs/attach-implementation.md:5:**Goal:** Replace today's basename-pairing convention for card attachments (`Voice_Memo.memo.card` + sibling `Voice_Memo.m4a`) with explicit `Foo.attach/` directories. No change to the XML card format or to cardworks.
callback-box/docs/attach-implementation.md:9:- Every card may have a sibling directory named `<basename>.attach/`.
callback-box/docs/attach-implementation.md:10:- Files in `<basename>.attach/` belong to the card with that basename.
callback-box/docs/attach-implementation.md:16:### Refs use the `attach/` virtual prefix from day one
callback-box/docs/attach-implementation.md:18:Refs to a card's own attached files use the `attach/` prefix:
callback-box/docs/attach-implementation.md:21:<filename ref="attach/photo-001.jpg" captured="..." source="gallery"/>
callback-box/docs/attach-implementation.md:24:The prefix is resolved by the resolver against the current card's `<basename>.attach/` scope. It's only meaningful as the first path segment of a ref value; mid-path occurrences (e.g. `store/captures/scan-XX.attach/photo-001.jpg`) are literal directory names.
callback-box/docs/attach-implementation.md:26:Cross-card refs to another card's attached files use the full path (no `attach/` prefix, since that prefix means "this card's scope"):
callback-box/docs/attach-implementation.md:29:<source ref="/box/inbox/scan-XX.attach/photo-001.image.attach/photo-001.jpg">
callback-box/docs/attach-implementation.md:41:- No `Foo.<type>.attach/` form (settled on basename-only).
callback-box/docs/attach-implementation.md:52:Phase 1 doesn't change what cardworks does. The application code that *uses* an attachment path is what changes (looks in `.attach/` instead of as a sibling).
callback-box/docs/attach-implementation.md:54:**Possible small addition** (optional): a helper in `cardworks/fs/` or similar called `attachmentPath(cardPath, fileName) → string` that computes `<basename>.attach/<fileName>`. Centralizes the convention. Could live in callback-box instead. Lean toward callback-box — keep cardworks format-agnostic.
callback-box/docs/attach-implementation.md:60:Today's loader (`cardworks/loader/loader.ts` and callers in `src/core/`) walks the filesystem and identifies cards. **`.attach/` directories are not opaque** — they can contain real cards (a capture-session's children are image cards living inside its `.attach/`), and the walker must recurse into them normally to find every card in the box.
callback-box/docs/attach-implementation.md:64:- A card's `<basename>.attach/` directory is conceptually part of that card's scope. "What files belong to this card" includes `<basename>.attach/**` recursively, including any nested cards and their own `.attach/` subdirectories.
callback-box/docs/attach-implementation.md:65:- The lint rule that forbids a directory literally named `attach/` applies only outside an existing `.attach/` scope.
callback-box/docs/attach-implementation.md:67:The walker walks everything. Regular `.attach/` contents (cards, attached files, nested attach dirs) are first-class box content.
callback-box/docs/attach-implementation.md:69:Look at `src/core/CardLoader` (or wherever the file walker is) — needs scope-awareness for path resolution. No recursion-skipping for `.attach/`.
callback-box/docs/attach-implementation.md:73:Schemas don't need structural changes for phase 1 (refs are still strings, still validated as `z.string()`), but the content of refs changes — values pointing at attached files get the `attach/` prefix.
callback-box/docs/attach-implementation.md:76:- `src/schemas/image.tsx` — `<filename ref="attach/photo-001.jpg">` (was bare filename)
callback-box/docs/attach-implementation.md:77:- `src/schemas/audio.tsx` — `<filename ref="attach/audio-001.webm">`
callback-box/docs/attach-implementation.md:78:- `src/schemas/file.tsx` — `<filename ref="attach/source.pdf">`
callback-box/docs/attach-implementation.md:79:- `src/schemas/doc.tsx` — `<content ref="attach/Project_Notes.md">`
callback-box/docs/attach-implementation.md:80:- `src/schemas/sheet.tsx` — `<sheet-tab ref="attach/Summary.csv">` (was `Budget/Summary.csv`)
callback-box/docs/attach-implementation.md:81:- `src/schemas/email-message.tsx` — `<body-file>attach/msg-001.body.txt</body-file>` + `<attachment ref="attach/attachments/foo.pdf">`. Note: `attachments/` inside an attach scope is fine (the exact-name-`attach` rule applies to literal `attach`, not `attachments`).
callback-box/docs/attach-implementation.md:82:- `src/schemas/email-thread.tsx` — `<message-ref ref="attach/msg-001.email-message.card">` (children moved into thread's attach scope, like capture-session)
callback-box/docs/attach-implementation.md:83:- `src/schemas/capture-session.tsx` — `<image-ref ref="attach/photo-001.image.card">` (children moved into session's attach scope)
callback-box/docs/attach-implementation.md:85:Templates (`createXxxTemplate()` functions) in each schema emit the `attach/`-prefixed refs by default.
callback-box/docs/attach-implementation.md:91:Connectors create cards with attachments. Each needs to put the file in `<basename>.attach/` instead of as a sibling:
callback-box/docs/attach-implementation.md:93:- `src/connectors/capture.ts` (or wherever capture sessions land) — write `<photo-id>.image.attach/<photo-id>.jpg` instead of sibling `.jpg`
callback-box/docs/attach-implementation.md:94:- `src/connectors/gmail.ts` — write `<msg-id>.email-message.attach/<msg-id>.body.txt` + `attach/attachments/...`
callback-box/docs/attach-implementation.md:95:- `src/connectors/google-drive.ts` — already uses a subdirectory pattern for Sheets; rename `Budget/` → `Budget.attach/` (small change). For Docs, the sibling `.md` moves into `Foo.attach/<basename>.md`.
callback-box/docs/attach-implementation.md:99:For each connector, the change is small: replace path-to-sibling with path-to-attach-dir, and ensure the `.attach/` directory exists before writing.
callback-box/docs/attach-implementation.md:103:The webapp serves attached files for the frontend (image renderer, audio player, download endpoints). Today these resolve `Foo.jpg` next to `Foo.image.card`. Under the new layout, they resolve `Foo.image.attach/Foo.jpg`.
callback-box/docs/attach-implementation.md:112:The frontend renders attached files (images in image cards, audio players, file download links). Today they resolve sibling files. Under the new layout, they resolve into `.attach/`.
callback-box/docs/attach-implementation.md:117:- `src/frontend/src/renderers/directory.tsx` — how directory views show `.attach/` subdirs (likely hide them by default)
callback-box/docs/attach-implementation.md:124:Today's `cb mv Foo.memo.card destination/` moves the card and any sibling files with matching basename. Under the new layout, it moves the card + `Foo.attach/` + everything inside `Foo.attach/` (recursively, including nested cards and their own attach scopes).
callback-box/docs/attach-implementation.md:131:2. If `<basename>.attach/` exists, move the entire directory tree along with it.
callback-box/docs/attach-implementation.md:139:In the UI, a card that has a `.attach/` directory is rendered as a navigable directory — you go INTO the card to see its attachments and any nested cards. The `.attach/` directory itself is not shown as a separate UI element; it's an implementation detail.
callback-box/docs/attach-implementation.md:148:- `src/frontend/src/renderers/directory.tsx` — when listing a directory's contents, treat `Foo.attach/` as folded into `Foo.<type>.card`
callback-box/docs/attach-implementation.md:149:- The browse UI, tree views, breadcrumbs — should describe paths in terms of card-containment, not literal `.attach/` segments
callback-box/docs/attach-implementation.md:154:Throughout prompts, generated docs, agent instructions, and `CLAUDE.md` mentions, the user-facing terminology is "card attachments" — never "attach directory" or "the `.attach/` folder."
callback-box/docs/attach-implementation.md:156:The disk layout is implementation detail. The conceptual model: cards have attachments. When the agent reads a description of how to attach a file to a card, that description talks about attaching it to the card, not creating a `.attach/` directory.
callback-box/docs/attach-implementation.md:170:2. **No literal `attach/` directory outside attach scopes.** A directory named `attach/` anywhere in the regular box tree (not inside a `Foo.attach/` scope) is an error.
callback-box/docs/attach-implementation.md:171:3. **Attachment ref resolves.** For each schema that has an attachment-path ref, validate the file exists in the card's `<basename>.attach/`. (Today's validators might already check sibling existence; the resolution target moves.)
callback-box/docs/attach-implementation.md:181:Source editor (file viewer for cards in the frontend) needs to understand that `.attach/` directories are part of a card's "scope" when displaying file relationships.
callback-box/docs/attach-implementation.md:190:Each test that creates a card with an attachment now creates the `.attach/` directory too.
callback-box/docs/attach-implementation.md:196:1. **File move pass.** Move sibling files into `<basename>.attach/` directories.
callback-box/docs/attach-implementation.md:197:2. **Ref rewrite pass.** Walk every card and rewrite any ref that points at a path that was moved — including both refs to attached files within the same card (now `attach/<file>`) and cross-card refs that included the old absolute or relative path.
callback-box/docs/attach-implementation.md:203:| `<filename ref="photo-001.jpg">` on the owning card (bare filename) | `<filename ref="attach/photo-001.jpg">` | Add `attach/` prefix. |
callback-box/docs/attach-implementation.md:204:| `<source ref="/box/inbox/scan-XX/photo-001.jpg">` on a different card (full path) | `<source ref="/box/inbox/scan-XX.attach/photo-001.image.attach/photo-001.jpg">` | New full path through nested attach scopes. |
callback-box/docs/attach-implementation.md:205:| `<source ref="scan-XX/photo-001.jpg">` (relative path) | `<source ref="scan-XX.attach/photo-001.image.attach/photo-001.jpg">` | Same kind of rewrite. |
callback-box/docs/attach-implementation.md:206:| `<sheet-tab ref="Budget/Summary.csv">` (subdir-based) | `<sheet-tab ref="attach/Summary.csv">` | Collapse the subdirectory into the attach scope. |
callback-box/docs/attach-implementation.md:207:| `<content ref="Project_Notes.md">` (sibling) | `<content ref="attach/Project_Notes.md">` | Add `attach/` prefix. |
callback-box/docs/attach-implementation.md:208:| `<image-ref ref="photo-001.image.card">` inside a capture session (sibling card in session dir) | `<image-ref ref="attach/photo-001.image.card">` | Add `attach/` prefix; the child cards move into the session's attach scope. |
callback-box/docs/attach-implementation.md:228:   - For each card, find sibling files matching `<basename>*` (excluding other cards). These are the files that will move into `<basename>.attach/`.
callback-box/docs/attach-implementation.md:239:   - Empty `.attach/` directories already present in the source: warn, leave alone.
callback-box/docs/attach-implementation.md:243:   - Move files in the order computed in pass 1 (creating `.attach/` directories as needed).
callback-box/docs/attach-implementation.md:249:- **Capture-session restructure.** Today: `inbox/scan-XXX/` (directory) containing `scan-XXX.capture-session.card` + child image/audio/file cards + their binaries, all as siblings. New: `inbox/scan-XXX.capture-session.card` + `inbox/scan-XXX.attach/` containing the children. **The wrapper `scan-XXX/` directory goes away** — the session card lives at the inbox level alongside its attach scope. Not doubly nested; the depth is the same as today (`inbox/scan-XXX.attach/photo-001.image.card` matches today's `inbox/scan-XXX/photo-001.image.card`).
callback-box/docs/attach-implementation.md:251:  Internal refs in the session card (`<image-ref ref="photo-001.image.card">`) get rewritten to `<image-ref ref="attach/photo-001.image.card">`. Same `attach/` prefix as everywhere else.
callback-box/docs/attach-implementation.md:257:  The migrator does update refs inside email-message cards to use `attach/` prefix for things that move into the message's attach scope, but the `attachments/` subdirectory of a thread stays as-is.
callback-box/docs/attach-implementation.md:259:- **Sheet's `Budget/` subdirectory.** Today's drive-sheets connector writes JSON tab files into a `Budget/` subdirectory next to `Budget.sheet.card`. Migration moves the contents into `Budget.attach/`, and the sheet's `<sheet-tab ref="Budget/Summary.csv" />` becomes `<sheet-tab ref="attach/Summary.csv" />`. Per-schema migrator adapter for sheet.
callback-box/docs/attach-implementation.md:261:- **Doc's sibling `.md`.** Today the drive-docs connector writes `Project_Notes.md` next to `Project_Notes.doc.card`. Migration moves it into `Project_Notes.attach/`, and the card's `<content ref="Project_Notes.md">` becomes `<content ref="attach/Project_Notes.md">`.
callback-box/docs/attach-implementation.md:288:1. **Build the code on a branch** — walker, resolver, schemas (templates emit `attach/` prefix), connectors (write to `.attach/`), `cb mv`/`cb rm`, lint rules, frontend renderers, card-as-directory UI, migrator script.
callback-box/docs/attach-implementation.md:299:- File walker: given a directory with a card and `.attach/`, identifies them correctly.
callback-box/docs/attach-implementation.md:301:- File walker: given a real `attach/` directory in the tree, raises lint error.
callback-box/docs/attach-implementation.md:302:- `cb mv` moves the `.attach/` along with the card.
callback-box/docs/attach-implementation.md:303:- `cb rm` removes the `.attach/` along with the card.
callback-box/docs/attach-implementation.md:319:- Capture a new voice memo. Confirms the capture connector writes to `.attach/`.
callback-box/docs/attach-implementation.md:321:- Send a chat message with an attachment. Confirm `attach/` placement.
callback-box/docs/attach-implementation.md:327:1. **Resolution helper** for the `attach/` virtual prefix. A small util in `src/shared/attach-path.ts`: parse `attach/<file>` refs against a current-card context. Used everywhere attached files are resolved.
callback-box/docs/attach-implementation.md:328:2. **File walker + loader** updated to recognize `.attach/` directories as part of card scope (still walks them; not opaque).
callback-box/docs/attach-implementation.md:330:4. **Schemas and templates** updated: `createXxxTemplate()` functions emit `attach/`-prefixed refs.
callback-box/docs/attach-implementation.md:331:5. **Connectors** updated: capture, gmail, google-drive, telegram (etc.) write files into `.attach/` and emit `attach/`-prefixed refs in cards they create. Capture is the highest-stakes connector; do it first.
callback-box/docs/attach-implementation.md:333:7. **Card-as-directory UI**: cards with `.attach/` appear as navigable directories in the frontend; `.attach/` itself is hidden as a separate entity.
callback-box/src/webapp/routes/clerk.ts:154: * frozen snapshot is provided, `<card>.attach/page.frozen` beside it. Returns
callback-box/src/webapp/routes/clerk.ts:180:    frozenRef: hasFrozen ? "attach/page.frozen" : undefined,
callback-box/src/connectors/drive-handler-docs.ts:5: * (`<basename>.attach/<basename>.md`). On push, replaces the upstream
callback-box/src/connectors/gmail-threads.ts:5: * `*.attach/` scope holding per-message `*.email-message.card` files, body
callback-box/src/frontend/src/api-chat.ts:4: * that file under the line limit; api.ts re-exports everything here so callers
callback-box/src/webapp/routes/capture-finalize.ts:6: * and its attach scope (`box/inbox/<basename>.attach/`) holds the audio/image/file
callback-box/src/connectors/drive-handler-sheets.ts:71:      // card ref uses the "attach/" virtual prefix.
callback-box/src/connectors/drive-handler-sheets.ts:74:      sheetRefs.push({ ref: `attach/${jsonFileName}`, title: tabTitle, gid });
callback-box/src/connectors/drive-handler-sheets.ts:147:      const key = r.ref.startsWith("attach/") ? r.ref.slice("attach/".length) : r.ref;
callback-box/src/frontend/src/renderers/image.tsx:77:  // Resolve the ref against the card's path. Refs use the `attach/` virtual
callback-box/src/frontend/src/renderers/image.tsx:78:  // prefix (e.g. `attach/photo-001.jpg`) which resolves to the card's
callback-box/src/frontend/src/renderers/image.tsx:79:  // `<basename>.attach/` directory.
callback-box/src/frontend/src/lib/view-bindings.ts:4: * A box view that exports `rendersCardTypes = ["sandbox"]` becomes the
callback-box/src/webapp/routes/api-files-write.ts:191:/** Find `<base>.<type>.card` next to a `<base>.attach/` scope. */
callback-box/src/webapp/routes/api-browse.ts:5: * box directory that folds `<basename>.attach/` directories into their owning
callback-box/src/webapp/routes/api-browse.ts:65:      // Build basename → owning-card lookup so we can fold `<basename>.attach/`
callback-box/src/webapp/routes/api-browse.ts:80:          // Hide `<basename>.attach/` when a sibling card owns it. Stray
callback-box/src/webapp/routes/api-browse.ts:81:          // .attach/ directories (no owning card) still surface for triage.
callback-box/src/webapp/views/compiler.ts:143: * Build an error module that exports an error component.
callback-box/src/webapp/context.ts:32:  const schemas = await createCardSchemaMap(root);
callback-box/src/core/asset-manifest.ts:3: * attachments) via a per-`.attach/` `manifest.json` file while the asset
callback-box/src/core/asset-manifest.ts:7: * Terminology: an *attachment* is anything inside a `.attach/` scope (a
callback-box/src/frontend/src/api.ts:9: * - Legacy type exports still referenced by components
callback-box/src/frontend/src/lib/view-url.ts:81: * Special case: if `relative` starts with `attach/`, the prefix is resolved
callback-box/src/frontend/src/lib/view-url.ts:82: * against the base card's attach scope (`<basename>.attach/`) instead of the
callback-box/src/frontend/src/lib/view-url.ts:88:  if ((relative === "attach" || relative.startsWith("attach/")) && basePath) {
callback-box/src/frontend/src/lib/view-url.ts:93:    const rest = relative === "attach" ? "" : relative.slice("attach/".length);
callback-box/src/core/reactor/CLAUDE.md:16:| `index.ts` | Public API re-exports |
callback-box/src/frontend/src/components/Source.tsx:34:  /** The host doc's path, so relative / `attach/` refs resolve correctly. */
callback-box/src/frontend/src/components/Source.tsx:79: * leading `/` is box-root-absolute, `attach/` resolves into the host card's
callback-box/src/frontend/src/components/Source.tsx:81: * commentary anchor's `ref="attach/readable.md"` lands on the actual
callback-box/src/frontend/src/components/Source.tsx:82: * `<dir>/<card>.attach/readable.md`, not the literal path. Fragments after `#`
callback-box/src/webapp/trpc/routers/todos.ts:65:      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/todos.ts:68:        parsed = parseCardText(content, { source: fullPath, schemas: cardSchemas, type: "todo-list" });
callback-box/src/frontend/src/components/AttachedCommentary.tsx:3: * `.attach/` scope, as a bordered "Commentary" block. Each `{% source %}` chip
callback-box/src/frontend/src/components/file-entries/ImageCardListEntry.tsx:6: * computed `filename` attr uses the `attach/…` virtual prefix.
callback-box/src/webapp/trpc/routers/card.ts:61:  cardSchemas: Map<string, CardSchema>;
callback-box/src/webapp/trpc/routers/card.ts:63:  const { raw, source, type, cardSchemas } = input;
callback-box/src/webapp/trpc/routers/card.ts:70:    const parsed = parseCardText(raw, { source, schemas: cardSchemas, type });
callback-box/src/webapp/trpc/routers/card.ts:145:      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/card.ts:146:      if (split.hasFrontmatter && fileType !== undefined && cardSchemas.has(fileType)) {
callback-box/src/webapp/trpc/routers/card.ts:147:        return loadFrontmatterCard({ raw, source: input.path, type: fileType, cardSchemas });
callback-box/src/frontend/src/components/browse/BrowseSidebarList.tsx:77:        // A card with an `.attach/` scope behaves like a directory: the row
callback-box/src/webapp/trpc/routers/status.ts:23:  /** True if this card has a `<basename>.attach/` directory (i.e. attachments). */
callback-box/src/webapp/trpc/routers/status.ts:102:      // Build a set of card basenames so we can fold owned `<basename>.attach/`
callback-box/src/webapp/trpc/routers/status.ts:115:          // Hide `<basename>.attach/` when an owning card sits next to it.
callback-box/src/core/box.ts:153:# Assets inside .attach/ scopes are tracked via per-dir manifest.json
callback-box/src/core/box.ts:155:**/*.attach/**/*.jpg
callback-box/src/core/box.ts:156:**/*.attach/**/*.jpeg
callback-box/src/core/box.ts:157:**/*.attach/**/*.png
callback-box/src/core/box.ts:158:**/*.attach/**/*.webp
callback-box/src/core/box.ts:159:**/*.attach/**/*.avif
callback-box/src/core/box.ts:160:**/*.attach/**/*.heic
callback-box/src/core/box.ts:161:**/*.attach/**/*.tif
callback-box/src/core/box.ts:162:**/*.attach/**/*.tiff
callback-box/src/core/box.ts:163:**/*.attach/**/*.gif
callback-box/src/core/box.ts:164:**/*.attach/**/*.webm
callback-box/src/core/box.ts:165:**/*.attach/**/*.mp3
callback-box/src/core/box.ts:166:**/*.attach/**/*.m4a
callback-box/src/core/box.ts:167:**/*.attach/**/*.wav
callback-box/src/core/box.ts:168:**/*.attach/**/*.pdf
callback-box/src/core/box.ts:169:**/*.attach/**/*.mp4
callback-box/src/core/box.ts:170:**/*.attach/**/*.mov
callback-box/src/frontend/src/components/ExtfileView.tsx:10: * lives in the card's `.attach/` scope and is surfaced inline; bare `{% source %}`
callback-box/src/core/sdk-binary-path.ts:58:    // declare an `exports` field, so subpath resolution works. Resolving
callback-box/src/core/sdk-binary-path.ts:60:    // *does* declare `exports` and excludes `./package.json`.
callback-box/src/core/box-templates.ts:28:Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:
callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "callback-box/cards";
callback-box/src/core/box-templates.ts:77:import { cardSchema, type LintIssue } from "callback-box/cards";
callback-box/src/core/box-templates.ts:101:From \`callback-box/cards\`:
callback-box/src/core/box-templates.ts:119:import { cardSchema } from "callback-box/cards";
callback-box/src/core/body-refs.ts:29:// Markdoc ships dual CJS/ESM but its `exports` field is null, so Node
callback-box/src/core/agent-guide/box-shape.ts:54:    "- **Clerk browser extension** — the user's \"Comment on this page\" captures a web page as a `*.webpage.card`: the readable markdown rendering as its body, with `source`/`captured`/`frozen` frontmatter, plus a frozen self-contained snapshot at `attach/page.frozen`. The user's remarks live in a separate `*.commentary.card` *inside the webpage card's attach scope* (`<basename>.attach/`); the webpage view surfaces them inline, and bare `{% source %}` anchors there default to the containing page. \"Save page\" produces the same `*.webpage.card` without the commentary. It lands in the chosen `<destination for=\"commentary\">` landmark dir, or `box/inbox/` by default.",
callback-box/src/core/init-rules.ts:13:import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/init-rules.ts:98:    ...boxSchemas.elementSchemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
callback-box/src/core/init-rules.ts:99:    ...cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
callback-box/src/core/init-rules.ts:100:    ...boxSchemas.cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
callback-box/src/cards/index.ts:7: * `callback-box/cards` specifier; internal code imports from `../cards/`.
callback-box/src/frontend/src/components/WebpageView.tsx:7: * lives in the card's `.attach/` scope as `.commentary.card` files; this view
callback-box/src/core/load-context.ts:13:  const elementSchemas = new Map<string, ElementSchema>();
callback-box/src/core/load-context.ts:16:    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/src/core/load-context.ts:18:  return { cardSchemas: await createCardSchemaMap(boxRoot), elementSchemas };
callback-box/src/core/rewrite-card-refs.ts:14: * card. The `attach/` virtual prefix is scoped to its owning card and is left
callback-box/src/core/rewrite-card-refs.ts:48: * rules as the renderer: leading `/` is box-root-absolute, `attach/` resolves
callback-box/src/core/rewrite-card-refs.ts:121: * location. Box-root-absolute refs are unaffected by the move; `attach/` refs
callback-box/src/core/rewrite-card-refs.ts:124: * the `attach/` prefix).
callback-box/src/frontend/src/components/CommentaryView.tsx:4: * Commentary is **attach-only**: it lives in a host card's `.attach/` scope and
callback-box/src/core/chat-session-prompts.ts:5: * that file. `chat-session.ts` re-exports `CHAT_SYSTEM_PROMPT` and
callback-box/src/core/agent-guide/chat.ts:67:    "- Each view declares metadata (name, description, dependencies, modes) as named exports",
callback-box/src/core/landmark/resolve.ts:19:import { lookupField, loadCardFrontmatter } from "../frontmatter-field.js";
callback-box/src/core/landmark/resolve.ts:93:      frontmatter = await loadCardFrontmatter(path.join(options.landmarkDir, matchRel));
callback-box/src/core/asset-manifest-scan.ts:2: * Walk a box's `.attach/` directories and reconcile each one's manifest
callback-box/src/core/asset-manifest-scan.ts:93: * but stops at nested `.attach/` directories — those are separate scopes
callback-box/src/core/asset-manifest-scan.ts:117: * Find every `.attach/` directory under boxRoot. Returns absolute and
callback-box/src/core/asset-manifest-scan.ts:153: * Reconcile a single `.attach/` directory against its manifest. Returns the
callback-box/src/core/asset-manifest-scan.ts:187:  // non-`.attach/` subdirectories (e.g. an email-thread's `attachments/`
callback-box/src/core/asset-manifest-scan.ts:188:  // dir), but stop at nested `.attach/` boundaries — those are separate
callback-box/src/core/commands/scan-import-document.ts:62:    `${sessionAttachRelDir}/${fileCardBasename}.attach/source.pdf`,
callback-box/src/core/views-doc-files.ts:20:- \`"store/playground/Playground.attach/**/*.jsonl"\` — a card's attachment files
callback-box/src/core/views-doc-files.ts:25:\`attachments\` listing (or a dependency glob into the \`.attach/\` dir) tells
callback-box/src/core/views-doc-files.ts:33:  "store/playground/Playground.attach/**/*.jsonl",
callback-box/src/core/commands/attachments-gitignore.ts:5: * `.gitignore` so asset binaries inside `.attach/` scopes are ignored
callback-box/src/core/commands/attachments-gitignore.ts:45:# Assets inside .attach/ scopes are tracked via per-dir manifest.json
callback-box/src/core/commands/attachments-gitignore.ts:47:**/*.attach/**/*.jpg
callback-box/src/core/commands/attachments-gitignore.ts:48:**/*.attach/**/*.jpeg
callback-box/src/core/commands/attachments-gitignore.ts:49:**/*.attach/**/*.png
callback-box/src/core/commands/attachments-gitignore.ts:50:**/*.attach/**/*.webp
callback-box/src/core/commands/attachments-gitignore.ts:51:**/*.attach/**/*.avif
callback-box/src/core/commands/attachments-gitignore.ts:52:**/*.attach/**/*.heic
callback-box/src/core/commands/attachments-gitignore.ts:53:**/*.attach/**/*.tif
callback-box/src/core/commands/attachments-gitignore.ts:54:**/*.attach/**/*.tiff
callback-box/src/core/commands/attachments-gitignore.ts:55:**/*.attach/**/*.gif
callback-box/src/core/commands/attachments-gitignore.ts:56:**/*.attach/**/*.webm
callback-box/src/core/commands/attachments-gitignore.ts:57:**/*.attach/**/*.mp3
callback-box/src/core/commands/attachments-gitignore.ts:58:**/*.attach/**/*.m4a
callback-box/src/core/commands/attachments-gitignore.ts:59:**/*.attach/**/*.wav
callback-box/src/core/commands/attachments-gitignore.ts:60:**/*.attach/**/*.pdf
callback-box/src/core/commands/attachments-gitignore.ts:61:**/*.attach/**/*.mp4
callback-box/src/core/commands/attachments-gitignore.ts:62:**/*.attach/**/*.mov
callback-box/src/core/commands/attachments-gitignore.ts:114: * Find the deepest `.attach/` directory enclosing a path. Returns the
callback-box/src/core/commands/attachments-gitignore.ts:118: *   thread.attach/msg-001.attach/attachments/foo.png
callback-box/src/core/commands/attachments-gitignore.ts:119: *   → thread.attach/msg-001.attach   (NOT thread.attach — deepest wins)
callback-box/src/core/commands/attachments-gitignore.ts:173:    if (relPath.includes(".attach/")) inAttach.push(relPath);
callback-box/src/core/commands/attachments-gitignore.ts:219:  // about — refuse). Files outside .attach/ scopes aren't our concern; we
callback-box/src/core/commands/attachments-gitignore.ts:223:    ctx.writeLine(`Skipping ${outsideAttach.length} file(s) outside .attach/ scopes (gitignored for other reasons):`);
callback-box/src/core/commands/attachments-gitignore.ts:233:  // A binary at `msg-001.attach/attachments/foo.png` belongs to
callback-box/src/core/commands/attachments-gitignore.ts:234:  // `msg-001.attach/manifest.json` under key `attachments/foo.png`.
callback-box/src/core/search/refresh.ts:170:    if (!state.ctx.cardSchemas.has(kind)) continue; // XML kinds can't carry contains
callback-box/src/core/card-lint.ts:85:    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
callback-box/src/core/card-lint.ts:101:    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
callback-box/src/core/search/walk.ts:4: * Enumerates every `*.card` file under a box (including inside `.attach/`
callback-box/src/core/chat-session-options.ts:6: * without a value-level import cycle. `chat-session.ts` re-exports it so
callback-box/src/core/card-io.ts:299:  cardSchemas: Map<string, CardSchema>;
callback-box/src/core/card-io.ts:301:  elementSchemas: Map<string, ElementSchema>;
callback-box/src/core/card-io.ts:334:    if (fileType !== undefined && ctx.cardSchemas.has(fileType)) {
callback-box/src/core/card-io.ts:335:      const parsed = parseCardText(content, { source, schemas: ctx.cardSchemas, type: fileType });
callback-box/src/core/card-io.ts:372:  const schema = ctx.elementSchemas.get(element.tagName);
callback-box/src/core/views-doc.ts:28:Each view is a \`.tsx\` file with named exports for metadata and a default export for the component:
callback-box/src/core/views-doc.ts:71:A view that exports \`rendersCardTypes\` becomes the **default renderer for
callback-box/src/core/views-doc.ts:136:\`store/playground/Playground.attach/sessions/history.jsonl\`). Content is
callback-box/src/core/commands/transcribe-captures.ts:112:          ctx.writeLine(`  Skipping ${cardFile}: ref does not use attach/ prefix: ${audioRef}`);
callback-box/src/core/commands/move-phase2.ts:20:import { cardSchemas } from "../../schemas/registry.js";
callback-box/src/core/commands/move-phase2.ts:22:const PHASE2_TYPES = new Set(cardSchemas.map((s) => s.type));
callback-box/src/core/commands/move-phase2.ts:52: * Rename a file and (if present) its sibling `<basename>.attach/`
callback-box/src/core/commands/move-phase2.ts:57:export async function movePhase2CardFiles(
callback-box/src/core/generate-docs.ts:16:import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/generate-docs.ts:316:  allCardSchemas: typeof cardSchemas;
callback-box/src/core/generate-docs.ts:359:  allCardSchemas: typeof cardSchemas;
callback-box/src/core/generate-docs.ts:420:  const allSchemas = [...schemas, ...boxSchemas.elementSchemas];
callback-box/src/core/generate-docs.ts:421:  const allCardSchemas = [...cardSchemas, ...boxSchemas.cardSchemas];
callback-box/src/core/chat-session-messages.ts:7: * here as a self-contained module; `chat-session.ts` re-exports the public
callback-box/src/core/commands/scan-import-session.ts:6: * `.attach/` scope. `createSessionLayout` computes those paths and creates the
callback-box/src/core/commands/scan-import.ts:5: * live in the session's attach scope (`scan-….attach/`).
callback-box/src/core/commands/scan-import.ts:14: *   <sessionAttach>/photo-NNN.image.card + photo-NNN.attach/photo-NNN.jpg
callback-box/src/core/commands/scan-import.ts:20: *   <sessionAttach>/source.file.card + source.attach/source.pdf
callback-box/src/core/commands/scan-import.ts:24: *   <sessionAttach>/source.file.card + source.attach/source.pdf
callback-box/src/core/agent-types.ts:5: * `agent.ts` re-exports these, so consumers can keep importing them from
callback-box/src/core/commands/move-operations.ts:6: * siblings, including the `<basename>.attach/` directory, plus cross-card
callback-box/src/core/commands/move-operations.ts:8: * rewrite (rewrite-card-refs.ts) over every other card. That covers what
callback-box/src/core/commands/move-operations.ts:23:} from "../rewrite-card-refs.js";
callback-box/src/core/commands/move-operations.ts:24:import { isPhase2CardPath, movePhase2CardFiles } from "./move-phase2.js";
callback-box/src/core/commands/move-operations.ts:173:    return { movedFiles: await movePhase2CardFiles(sourcePath, destPath), updatedCards: [] };
callback-box/src/core/commands/move-operations.ts:188: * its attach directory. Resolution-based (see rewrite-card-refs.ts), so refs
callback-box/src/core/commands/move-operations.ts:242: * from its new location (absolute and `attach/` refs are unaffected).
callback-box/src/core/commands/ls.ts:18:import { lookupField, loadCardFrontmatter } from "../frontmatter-field.js";
callback-box/src/core/commands/ls.ts:117:    const frontmatter = await loadCardFrontmatter(filePath);
callback-box/src/core/commands/scan-import-cards.ts:62:  filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${photoFilename}`);
callback-box/src/core/commands/scan-import-cards.ts:68:    filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}`);
callback-box/src/core/commands/scan-import-cards.ts:89:      directiveParts.push(`Cross-check the back transcription against ${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}.`);
callback-box/src/core/commands/attachments.ts:3: * subset of attachments). The command operates on the whole `.attach/`
callback-box/src/core/commands/attachments.ts:7: *   - verify   : scan all .attach/ scopes, report errors, no writes
callback-box/src/core/commands/attachments.ts:157:    return { success: false, error: `${relPath} is not inside an .attach/ directory` };
callback-box/src/core/commands/attachments.ts:191:    return { success: false, error: `${relPath} is not inside an .attach/ directory` };
callback-box/src/frontend/src/ssr/css-loader.mjs:6: * - ?url suffix imports → exports empty string (Vite asset URL pattern)
callback-box/src/core/commands/assemble-timeline-helpers.ts:51:  ref: string; // session-scope ref to the image card (e.g. attach/photo-001.image.card)
callback-box/src/core/commands/assemble-timeline-helpers.ts:176:      ref: `attach/${ic}`,
callback-box/src/core/frontmatter-field.ts:35:export async function loadCardFrontmatter(absPath: string): Promise<Record<string, unknown> | null> {

codex
A useful wrinkle already surfaced: this branch appears to have some prior absorption work in `src/cards/` and `package.json` already has an exports map. I’m going to verify whether the plan’s C1 diagnosis is stale, partially right, or still a real bundle issue.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/cards/index.ts | sed -n '1,140p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/package.json | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Card primitive layer — the frontmatter-schema building blocks callback-box
     3	 * uses to declare and parse `.card` files. Absorbed from the former
     4	 * `cardworks` package (see docs/implemented-plans/remove-cardworks-package.md).
     5	 *
     6	 * Box-local schemas (`config/schemas/*.ts`) import these via the public
     7	 * `callback-box/cards` specifier; internal code imports from `../cards/`.
     8	 */
     9	
    10	export {
    11	  cardSchema,
    12	  body,
    13	  extractRefs,
    14	  isBodyField,
    15	  GLOBAL_CARD_FIELDS,
    16	  type BodyKind,
    17	  type BodyField,
    18	  type BodyFieldOptions,
    19	  type FieldDecl,
    20	  type CardSchemaConfig,
    21	  type CardSchema,
    22	  type CardValidateInput,
    23	} from "./schema.js";
    24	
    25	export {
    26	  splitCardContent,
    27	  type SplitCardContent,
    28	} from "./frontmatter.js";
    29	
    30	export {
    31	  formatLintResults,
    32	  type LintIssue,
    33	  type LintResult,
    34	  type LintSummary,
    35	} from "./lint-format.js";
    36	
    37	export { ParseError } from "./errors.js";

 succeeded in 0ms:
     1	{
     2	  "name": "callback-box",
     3	  "version": "0.1.0",
     4	  "description": "A Claude Code wrapper system for file-based processing",
     5	  "type": "module",
     6	  "main": "dist/cli/index.js",
     7	  "exports": {
     8	    ".": "./dist/cli/index.js",
     9	    "./cards": "./src/cards/index.ts"
    10	  },
    11	  "bin": {
    12	    "cb": "./bin/cb"
    13	  },
    14	  "scripts": {
    15	    "build": "tsc",
    16	    "build:frontend": "cd src/frontend && pnpm build",
    17	    "build:all": "pnpm build && pnpm build:frontend",
    18	    "build:cli": "node scripts/build-cli.mjs",
    19	    "dev": "echo 'The dev server is the monorepo router. Run \\`pnpm dev\\` from the monorepo root.' && exit 1",
    20	    "cb": "./bin/cb",
    21	    "typecheck": "tsc --noEmit && cd src/frontend && pnpm exec tsc --noEmit",
    22	    "typecheck:frontend": "cd src/frontend && pnpm typecheck",
    23	    "typecheck:all": "pnpm typecheck && pnpm typecheck:frontend",
    24	    "lint": "eslint src/ && cd src/frontend && pnpm exec eslint src/",
    25	    "start": "node dist/webapp/server.js",
    26	    "cli": "node dist/cli/index.js",
    27	    "pretest": "node scripts/build-cli.mjs",
    28	    "test": "tap",
    29	    "test:manual": "tap 'test/manual/**/*.doctest.md' 'test/manual/**/*.test.ts'",
    30	    "knowledge-audit": "tsx src/dev/knowledge-audit.ts",
    31	    "prompt-report": "tsx src/dev/prompt-report.ts",
    32	    "generate:doc-images": "tsx src/dev/generate-doc-images.ts",
    33	    "doc-graph": "tsx src/dev/doc-graph.ts > docs/doc-graph.md",
    34	    "doc-graph-html": "tsx src/dev/doc-graph-html.ts",
    35	    "test:watch": "tap --watch",
    36	    "lint:oxlint": "oxlint -A no-unused-vars",
    37	    "lint:knip": "knip",
    38	    "lint:circular": "madge --circular --extensions ts,tsx src/"
    39	  },
    40	  "keywords": [
    41	    "claude",
    42	    "automation",
    43	    "inbox",
    44	    "procedure"
    45	  ],
    46	  "author": "",
    47	  "license": "ISC",
    48	  "devDependencies": {
    49	    "@ianbicking/personal-vibe-check": "workspace:*",
    50	    "@types/chokidar": "^1.7.5",
    51	    "@types/node": "^22.0.0",
    52	    "@types/xml2js": "^0.4.14",
    53	    "agent-doctest": "workspace:*",
    54	    "axe-core": "^4.11.4",
    55	    "eslint": "^9.39.2",
    56	    "eslint-import-resolver-typescript": "^4.4.4",
    57	    "husky": "^9.1.7",
    58	    "knip": "^5.83.1",
    59	    "lint-staged": "^16.2.7",
    60	    "madge": "^8.0.0",
    61	    "oxlint": "^1.47.0",
    62	    "tap": "^21.0.0",
    63	    "tsx": "^4.21.0",
    64	    "typescript": "^5.7.0"
    65	  },
    66	  "dependencies": {
    67	    "@anthropic-ai/claude-agent-sdk": "^0.2.128",
    68	    "@fastify/cookie": "^11.0.2",
    69	    "@fastify/multipart": "^9.4.0",
    70	    "@fastify/static": "^9.0.0",
    71	    "@fastify/websocket": "^11.2.0",
    72	    "@google/genai": "^1.44.0",
    73	    "@markdoc/markdoc": "^0.5.7",
    74	    "@modelcontextprotocol/sdk": "^1.29.0",
    75	    "@orama/orama": "^3.1.18",
    76	    "@orama/plugin-data-persistence": "^3.1.18",
    77	    "@parcel/markdown-ansi": "^2.16.3",
    78	    "@trpc/server": "^11.11.0",
    79	    "@types/better-sqlite3": "^7.6.13",
    80	    "@types/turndown": "^5.0.6",
    81	    "@types/ws": "^8.18.1",
    82	    "ansi-to-html": "^0.7.2",
    83	    "better-sqlite3": "^12.6.2",
    84	    "cardworks": "workspace:*",
    85	    "chalk": "^5.6.2",
    86	    "cheerio": "^1.2.0",
    87	    "chokidar": "^5.0.0",
    88	    "commander": "^13.0.0",
    89	    "cron-parser": "^5.5.0",
    90	    "esbuild": "^0.25.0",
    91	    "execa": "^9.6.1",
    92	    "exifr": "^7.1.3",
    93	    "fastify": "^5.7.2",
    94	    "glob": "^13.0.0",
    95	    "google-auth-library": "^10.5.0",
    96	    "grammy": "^1.40.1",
    97	    "ical.js": "^2.2.1",
    98	    "ky": "^1.14.3",
    99	    "markdownlint": "^0.40.0",
   100	    "open": "^11.0.0",
   101	    "react-virtuoso": "^4.18.6",
   102	    "rrule": "^2.8.1",
   103	    "sanitize-filename": "^1.6.3",
   104	    "simple-git": "^3.32.3",
   105	    "turndown": "^7.2.2",
   106	    "xml2js": "^0.6.2",
   107	    "yaml": "^2.7.0",
   108	    "zod": "^4.4.3"
   109	  },
   110	  "overrides": {
   111	    "react": "^18.3.1",
   112	    "react-dom": "^18.3.1"
   113	  },
   114	  "lint-staged": {
   115	    "src/frontend/src/**/*.{ts,tsx,js}": [
   116	      "eslint --config src/frontend/eslint.config.mjs"
   117	    ],
   118	    "src/!(frontend)/**/*.ts": [
   119	      "eslint"
   120	    ]

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/schemas/registry.ts | sed -n '1,390p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Central schema registration with cardworks.
     3	 *
     4	 * All card schemas are registered here and exported for use
     5	 * by the CardLoader factory. Box-local schemas from config/schemas/
     6	 * are loaded dynamically at runtime.
     7	 */
     8	
     9	import { readdir } from "node:fs/promises";
    10	import { join } from "node:path";
    11	import { pathToFileURL } from "node:url";
    12	import { registerHooks } from "node:module";
    13	import { PACKAGE_ROOT } from "../lib/package-root.js";
    14	import { SchemaRegistry, type ElementSchema } from "cardworks";
    15	import { type CardSchema } from "../cards/index.js";
    16	import { MemoSchema } from "./memo.js";
    17	import { QuestionSchema } from "./question.js";
    18	import { FeedbackSchema } from "./feedback.js";
    19	import { ProcedureSchema } from "./procedure.js";
    20	import { ProcedureRunSchema } from "./procedure-run.js";
    21	import { ImageSchema } from "./image.js";
    22	import { AudioSchema } from "./audio.js";
    23	import { FileSchema } from "./file.js";
    24	import { CaptureSessionSchema } from "./capture-session.js";
    25	import { RecordSchema } from "./record.js";
    26	import { RecipeSchema } from "./recipe.js";
    27	import { EmailThreadSchema } from "./email-thread.js";
    28	import { EmailMessageSchema } from "./email-message.js";
    29	import { EmailOutboundSchema } from "./email-outbound.js";
    30	import { IntakeJobSchema } from "./intake-job.js";
    31	import { CalendarReviewJobSchema } from "./calendar-review-job.js";
    32	import { GuideSchema } from "./guide.js";
    33	import { ScheduledScriptSchema } from "./scheduled-script.js";
    34	import { TelegramMessageSchema } from "./telegram-message.js";
    35	import { ChatThreadSchema } from "./chat-thread.js";
    36	import { ChatJobSchema } from "./chat-job.js";
    37	import { PersonalitySchema } from "./personality.js";
    38	import { QuestionFollowupJobSchema } from "./question-followup-job.js";
    39	import { TodoListSchema } from "./todo-list.js";
    40	import { BriefingSchema } from "./briefing.js";
    41	import { PersonSchema } from "./person.js";
    42	import { SheetSchema } from "./sheet.js";
    43	import { DocSchema } from "./doc.js";
    44	import { GdocSchema } from "./gdoc.js";
    45	import { CommentarySchema } from "./commentary.js";
    46	import { WebpageSchema } from "./webpage.js";
    47	import { ExtfileSchema } from "./extfile.js";
    48	import { LandmarkSchema } from "./landmark.js";
    49	import { registerTemplate, type TemplateDefinition } from "./templates.js";
    50	
    51	/**
    52	 * Built-in XML (legacy `element()`) card schemas. Now empty — every schema
    53	 * has migrated to the frontmatter form below. The array and the XML loader
    54	 * path remain until cardworks itself is removed in a follow-up.
    55	 */
    56	export const schemas: ElementSchema[] = [];
    57	
    58	/**
    59	 * Phase-2 markdown-frontmatter card schemas. Loaded into a separate
    60	 * Map<type, CardSchema> by createCardSchemaMap below.
    61	 */
    62	export const cardSchemas: CardSchema[] = [
    63	  CaptureSessionSchema,
    64	  GuideSchema,
    65	  LandmarkSchema,
    66	  ProcedureSchema,
    67	  ProcedureRunSchema,
    68	  RecipeSchema,
    69	  EmailThreadSchema,
    70	  EmailMessageSchema,
    71	  EmailOutboundSchema,
    72	  BriefingSchema,
    73	  DocSchema,
    74	  GdocSchema,
    75	  CommentarySchema,
    76	  WebpageSchema,
    77	  ExtfileSchema,
    78	  SheetSchema,
    79	  FileSchema,
    80	  ImageSchema,
    81	  AudioSchema,
    82	  RecordSchema,
    83	  PersonSchema,
    84	  MemoSchema,
    85	  TodoListSchema,
    86	  TelegramMessageSchema,
    87	  FeedbackSchema,
    88	  IntakeJobSchema,
    89	  CalendarReviewJobSchema,
    90	  ChatJobSchema,
    91	  QuestionFollowupJobSchema,
    92	  PersonalitySchema,
    93	  ScheduledScriptSchema,
    94	  QuestionSchema,
    95	  ChatThreadSchema,
    96	];
    97	
    98	/**
    99	 * Specifiers a box-local schema file may import from callback-box's tree:
   100	 * - `callback-box/cards` — the public card-primitive surface (cardSchema,
   101	 *   body, splitCardContent, …); the specifier new box schemas should use.
   102	 * - `zod` — peer dependency every schema needs.
   103	 * - `yaml` — frontmatter card templates `stringify` their fields with it (the
   104	 *   scaffolding in box-templates.ts shows exactly this).
   105	 * - `cardworks` — legacy alias, still resolvable while boxes migrate their
   106	 *   schema files to `callback-box/cards`; goes away with cardworks itself.
   107	 */
   108	const SCHEMA_DEPS = new Set(["callback-box", "zod", "yaml", "cardworks"]);
   109	
   110	/**
   111	 * Virtual parent URL at callback-box's package root (NOT inside
   112	 * node_modules). Rewriting a box schema's parentURL to this makes Node
   113	 * resolve bare deps (`zod`, `cardworks`) from callback-box's node_modules
   114	 * AND self-references (`callback-box/cards`) via callback-box's own
   115	 * `exports` map. Pointing it *inside* node_modules would break the
   116	 * self-reference: Node's LOOKUP_PACKAGE_SCOPE returns null at a
   117	 * node_modules boundary, so the package's own exports never match. The
   118	 * file need not exist — only the directory's package.json scope is read.
   119	 */
   120	const CB_VIRTUAL_PARENT = pathToFileURL(join(PACKAGE_ROOT, "_virtual.js")).href;
   121	
   122	/**
   123	 * Register module resolution hooks so that box-local schema files
   124	 * (under config/schemas/) can import `callback-box/cards`, `zod`, and the
   125	 * legacy `cardworks` alias even though none of those resolve from the
   126	 * box's own node_modules.
   127	 *
   128	 * Uses Node's synchronous registerHooks API which chains correctly
   129	 * with tsx's async loader hooks.
   130	 */
   131	let hooksRegistered = false;
   132	function ensureResolveHooks(): void {
   133	  if (hooksRegistered) return;
   134	  hooksRegistered = true;
   135	
   136	  registerHooks({
   137	    // eslint-disable-next-line max-params -- Node's registerHooks API requires 3 params
   138	    resolve(specifier, context, nextResolve) {
   139	      // Check if a box schema file is importing a known package
   140	      const bare = specifier.split("/")[0] ?? "";
   141	      if (
   142	        SCHEMA_DEPS.has(bare) &&
   143	        context.parentURL?.includes("/config/schemas/")
   144	      ) {
   145	        // Resolve as if imported from callback-box's node_modules
   146	        return nextResolve(specifier, {
   147	          ...context,
   148	          parentURL: CB_VIRTUAL_PARENT,
   149	        });
   150	      }
   151	      return nextResolve(specifier, context);
   152	    },
   153	  });
   154	}
   155	
   156	/**
   157	 * Ensure config/schemas/ has a package.json with "type": "module"
   158	 * so Node treats .ts files as ESM (needed for registerHooks to apply).
   159	 */
   160	async function ensureEsmPackageJson(schemasDir: string): Promise<void> {
   161	  const pkgJsonPath = join(schemasDir, "package.json");
   162	  try {
   163	    const { stat } = await import("node:fs/promises");
   164	    await stat(pkgJsonPath);
   165	  } catch (_e) {
   166	    // package.json is absent (stat throws ENOENT) — that's the expected
   167	    // trigger to create it; the error carries no other actionable info.
   168	    const { writeFile } = await import("node:fs/promises");
   169	    await writeFile(pkgJsonPath, '{"type":"module"}\n');
   170	  }
   171	}
   172	
   173	/**
   174	 * Box-local schemas, segregated by format. A box's `config/schemas/*.ts`
   175	 * files may default-export either a frontmatter `cardSchema()` (the default
   176	 * for new card types) or a legacy XML `element()` schema; we branch on the
   177	 * discriminator (`.type` vs `.tagName`) and keep the two kinds apart so each
   178	 * flows into the right runtime map.
   179	 */
   180	export interface BoxSchemas {
   181	  /** Frontmatter card schemas (cardworks CardSchema, keyed by `.type`). */
   182	  cardSchemas: CardSchema[];
   183	  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
   184	  elementSchemas: ElementSchema[];
   185	}
   186	
   187	/**
   188	 * Per-boxRoot cache. loadBoxSchemas is called from ~24 sites (every place
   189	 * that builds a card-schema map); without this, each would re-readdir and
   190	 * re-import. Node already permanently caches the dynamic `import()` by URL,
   191	 * so a process never sees on-disk schema edits anyway — caching the readdir
   192	 * + branch result alongside it changes nothing observable and avoids the
   193	 * repeated I/O. `cb` commands are fresh processes, so edits are picked up on
   194	 * the next invocation; long-lived dev servers already required a restart to
   195	 * see schema changes (the import cache), and still do.
   196	 */
   197	const boxSchemaCache = new Map<string, BoxSchemas>();
   198	
   199	/**
   200	 * Load box-local schemas from config/schemas/*.ts.
   201	 *
   202	 * Each file should default-export either a frontmatter `cardSchema()` or a
   203	 * legacy XML `element()` schema. Optionally it can also export a `template`
   204	 * (TemplateDefinition) for `cb create` — registered the same way regardless
   205	 * of schema kind.
   206	 *
   207	 * Errors in individual files are logged as warnings, not fatal.
   208	 */
   209	export async function loadBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
   210	  const cached = boxSchemaCache.get(boxRoot);
   211	  if (cached) return cached;
   212	
   213	  const result = await loadBoxSchemasUncached(boxRoot);
   214	  boxSchemaCache.set(boxRoot, result);
   215	  return result;
   216	}
   217	
   218	async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
   219	  const empty: BoxSchemas = { cardSchemas: [], elementSchemas: [] };
   220	  const schemasDir = join(boxRoot, "config/schemas");
   221	  let files: string[];
   222	  try {
   223	    files = await readdir(schemasDir);
   224	  } catch (e) {
   225	    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   226	      console.warn(`Could not read box schemas dir ${schemasDir}, skipping box-local schemas:`, e);
   227	    }
   228	    return empty;
   229	  }
   230	
   231	  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("."));
   232	  if (tsFiles.length === 0) return empty;
   233	
   234	  const loadedCard: CardSchema[] = [];
   235	  const loadedElement: ElementSchema[] = [];
   236	
   237	  // Ensure package.json with "type": "module" so .ts files load as ESM,
   238	  // and register resolve hooks so bare specifiers (cardworks, zod) resolve
   239	  // from callback-box's node_modules.
   240	  await ensureEsmPackageJson(schemasDir);
   241	  ensureResolveHooks();
   242	
   243	  for (const file of tsFiles) {
   244	    try {
   245	      const filePath = join(schemasDir, file);
   246	      const mod = await import(pathToFileURL(filePath).href);
   247	      const def: unknown = mod.default;
   248	
   249	      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
   250	      // Zod type carrying `.tagName`; check it first, because ElementSchema also
   251	      // inherits a string `.type` from ZodType, so a `.type`-only check would
   252	      // misclassify it. CardSchema (frontmatter) is a plain object identified by
   253	      // its `.frontmatterSchema`.
   254	      if (isElementSchema(def)) {
   255	        loadedElement.push(def);
   256	      } else if (isCardSchema(def)) {
   257	        loadedCard.push(def);
   258	      } else {
   259	        console.warn(`Warning: ${file} does not export a default cardSchema() or element(), skipping`);
   260	        continue;
   261	      }
   262	
   263	      if (mod.template) {
   264	        registerTemplate(mod.template as TemplateDefinition);
   265	      }
   266	    } catch (err) {
   267	      console.warn(`Warning: failed to load box schema ${file}: ${(err as Error).message}`);
   268	    }
   269	  }
   270	
   271	  return { cardSchemas: loadedCard, elementSchemas: loadedElement };
   272	}
   273	
   274	function isElementSchema(def: unknown): def is ElementSchema {
   275	  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
   276	}
   277	
   278	function isCardSchema(def: unknown): def is CardSchema {
   279	  return (
   280	    typeof def === "object"
   281	    && def !== null
   282	    && typeof (def as CardSchema).type === "string"
   283	    && "frontmatterSchema" in def
   284	  );
   285	}
   286	
   287	/**
   288	 * Create a SchemaRegistry populated with all known schemas.
   289	 *
   290	 * If boxRoot is provided, also loads box-local schemas from config/schemas/.
   291	 */
   292	export async function createSchemaRegistry(boxRoot?: string): Promise<SchemaRegistry> {
   293	  const registry = new SchemaRegistry();
   294	  for (const schema of schemas) {
   295	    registry.register(schema);
   296	  }
   297	  if (boxRoot) {
   298	    const { elementSchemas } = await loadBoxSchemas(boxRoot);
   299	    for (const schema of elementSchemas) {
   300	      registry.register(schema);
   301	    }
   302	  }
   303	  return registry;
   304	}
   305	
   306	/**
   307	 * Get all schemas (built-in + box-local).
   308	 *
   309	 * If boxRoot is provided, includes box-local schemas.
   310	 */
   311	export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
   312	  if (!boxRoot) return schemas;
   313	  const { elementSchemas } = await loadBoxSchemas(boxRoot);
   314	  return [...schemas, ...elementSchemas];
   315	}
   316	
   317	/**
   318	 * Get the list of known card types.
   319	 */
   320	export function getCardTypes(): string[] {
   321	  return [
   322	    ...schemas.map(s => s.tagName),
   323	    ...cardSchemas.map(s => s.type),
   324	  ];
   325	}
   326	
   327	/**
   328	 * Get the card types that belong in content search indexes — every type
   329	 * whose schema doesn't set `searchable: false`. Includes box-local schemas
   330	 * when a boxRoot is given (they default to searchable).
   331	 */
   332	export async function getSearchableTypes(boxRoot?: string): Promise<string[]> {
   333	  const elementSchemas = await getAllSchemas(boxRoot);
   334	  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
   335	  const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
   336	  return [
   337	    ...elementSchemas.filter(s => s.searchable !== false).map(s => s.tagName),
   338	    ...allCardSchemas.filter(s => s.searchable).map(s => s.type),
   339	  ];
   340	}
   341	
   342	/**
   343	 * Check if a card type is known.
   344	 */
   345	export function isKnownCardType(type: string): boolean {
   346	  return (
   347	    schemas.some(s => s.tagName === type)
   348	    || cardSchemas.some(s => s.type === type)
   349	  );
   350	}
   351	
   352	/**
   353	 * Build a Map<type, CardSchema> for the markdown-frontmatter loader path.
   354	 *
   355	 * When boxRoot is given, box-local frontmatter schemas (from
   356	 * config/schemas/*.ts) are merged in on top of the built-in ones, so box
   357	 * card types parse and validate as first-class. A box schema whose type
   358	 * collides with a built-in wins (last write) — boxes can override.
   359	 */
   360	export async function createCardSchemaMap(boxRoot?: string): Promise<Map<string, CardSchema>> {
   361	  const map = new Map<string, CardSchema>();
   362	  for (const schema of cardSchemas) {
   363	    map.set(schema.type, schema);
   364	  }
   365	  if (boxRoot) {
   366	    const { cardSchemas: boxCardSchemas } = await loadBoxSchemas(boxRoot);
   367	    for (const schema of boxCardSchemas) {
   368	      map.set(schema.type, schema);
   369	    }
   370	  }
   371	  return map;
   372	}
   373	
   374	// Re-export individual schemas for direct access
   375	export { MemoSchema } from "./memo.js";
   376	export { QuestionSchema } from "./question.js";
   377	export { FeedbackSchema } from "./feedback.js";
   378	export { ProcedureSchema } from "./procedure.js";
   379	export { ProcedureRunSchema } from "./procedure-run.js";
   380	export { ImageSchema } from "./image.js";
   381	export { AudioSchema } from "./audio.js";
   382	export { FileSchema } from "./file.js";
   383	export { CaptureSessionSchema } from "./capture-session.js";
   384	export { RecordSchema } from "./record.js";
   385	export { RecipeSchema } from "./recipe.js";
   386	export { EmailThreadSchema } from "./email-thread.js";
   387	export { EmailMessageSchema } from "./email-message.js";
   388	export { EmailOutboundSchema } from "./email-outbound.js";
   389	export { IntakeJobSchema } from "./intake-job.js";
   390	export { CalendarReviewJobSchema } from "./calendar-review-job.js";

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/scripts/build-cli.mjs | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	// Bundles the CLI (src/cli/index.ts) into a single dist/cli.mjs for fast
     2	// cold starts — collapsing our ~hundreds of source modules into one file
     3	// removes the per-module ESM loader-hook overhead that dominates tsx startup.
     4	//
     5	// node_modules are externalized (`packages: "external"`): native addons like
     6	// better-sqlite3 can't be bundled, and loading deps from disk keeps their own
     7	// __dirname / asset resolution intact. cardworks resolves to its built dist.
     8	//
     9	// An external sourcemap (cli.mjs.map) gives real stack traces under
    10	// `node --enable-source-maps` without slowing startup — node loads the map
    11	// lazily, only when formatting an error. We build into a temp dir and rename
    12	// both files in, so a concurrent `cb` invocation (bin/cb self-heals on
    13	// staleness) never sees a half-written bundle.
    14	import { build } from "esbuild";
    15	import { rename, rm } from "node:fs/promises";
    16	import { join } from "node:path";
    17	
    18	const root = join(import.meta.dirname, "..");
    19	const distDir = join(root, "dist");
    20	const tmpDir = join(distDir, `.build-${process.pid}`);
    21	
    22	const t = process.hrtime.bigint();
    23	await build({
    24	  entryPoints: [join(root, "src/cli/index.ts")],
    25	  // Build "cli.mjs" inside a temp dir so the emitted //# sourceMappingURL is
    26	  // the relative "cli.mjs.map", which stays correct after we move both into dist/.
    27	  outfile: join(tmpDir, "cli.mjs"),
    28	  bundle: true,
    29	  platform: "node",
    30	  format: "esm",
    31	  target: "node22",
    32	  packages: "external",
    33	  sourcemap: true,
    34	  logLevel: "warning",
    35	});
    36	
    37	// Move the map first, then the .mjs, so the bundle never references a
    38	// not-yet-present map. rename() is atomic within the same filesystem.
    39	await rename(join(tmpDir, "cli.mjs.map"), join(distDir, "cli.mjs.map"));
    40	await rename(join(tmpDir, "cli.mjs"), join(distDir, "cli.mjs"));
    41	await rm(tmpDir, { recursive: true, force: true });
    42	
    43	const ms = Number(process.hrtime.bigint() - t) / 1e6;
    44	process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);

codex
On C1, the bundle detail is subtler than “bundle can’t follow TS source”: `esbuild` externalizes all packages, so a bare self-reference from a dynamically loaded schema will be resolved by Node at runtime through `package.json`, not by esbuild. That makes the `exports` target especially important.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/card-lint.ts | sed -n '1,240p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Lint dispatcher for mixed XML / markdown-frontmatter cards.
     3	 *
     4	 * For each card path, peeks at the frontmatter to decide which path to
     5	 * take: cards declaring a `type:` that matches a registered CardSchema
     6	 * are validated through parseCardText (Zod schema check); everything
     7	 * else falls through to cardworks' existing XML lintCard. Results are
     8	 * merged into a single LintSummary so callers (e.g. cb validate) can
     9	 * format them uniformly.
    10	 *
    11	 * Ref-checking walks two sides: `extractRefs` (src/cards) over parsed
    12	 * frontmatter fields, and `extractBodyRefs` over the Markdoc body. Both
    13	 * yield `{path, ref}` entries with the same shape; both are surfaced as
    14	 * warnings (not errors) so legitimate moves don't block commits.
    15	 *
    16	 * Type-specific, self-contained validation (rules Zod can't express, e.g.
    17	 * commentary's Markdoc check or extfile's `file:`-URL refinement) is NOT here:
    18	 * it lives on each schema as a `validate` hook (cardworks), invoked generically
    19	 * below. The ref-existence walk stays here because it is box-aware (needs the
    20	 * loader), which the self-contained hook deliberately lacks.
    21	 */
    22	
    23	import { readFile } from "node:fs/promises";
    24	import { lintCard, type ICardLoader } from "cardworks";
    25	import {
    26	  splitCardContent,
    27	  extractRefs,
    28	  type CardSchema,
    29	  type LintResult,
    30	  type LintSummary,
    31	  type LintIssue,
    32	} from "../cards/index.js";
    33	import { parse as parseYaml } from "yaml";
    34	import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
    35	import { extractBodyRefs } from "./body-refs.js";
    36	
    37	export interface LintDispatchOptions {
    38	  loader: ICardLoader;
    39	  ctx: LoadCardContext;
    40	}
    41	
    42	/**
    43	 * Lint a list of card paths, dispatching each to the appropriate
    44	 * validator based on file shape.
    45	 */
    46	export async function lintCardsDispatch(
    47	  paths: string[],
    48	  options: LintDispatchOptions
    49	): Promise<LintSummary> {
    50	  const results: LintResult[] = [];
    51	  let totalErrors = 0;
    52	  let totalWarnings = 0;
    53	  let filesWithErrors = 0;
    54	
    55	  for (const path of paths) {
    56	    const result = await lintOne(path, options);
    57	    results.push(result);
    58	    totalErrors += result.errors.length;
    59	    totalWarnings += result.warnings.length;
    60	    if (result.errors.length > 0) {
    61	      filesWithErrors++;
    62	    }
    63	  }
    64	
    65	  return {
    66	    results,
    67	    filesChecked: paths.length,
    68	    filesWithErrors,
    69	    totalErrors,
    70	    totalWarnings,
    71	  };
    72	}
    73	
    74	async function lintOne(path: string, options: LintDispatchOptions): Promise<LintResult> {
    75	  let content: string;
    76	  try {
    77	    content = await readFile(path, "utf8");
    78	  } catch (e) {
    79	    return errorResult(path, (e as Error).message);
    80	  }
    81	
    82	  const split = splitCardContent(content);
    83	  if (split.hasFrontmatter) {
    84	    const type = typeFromFilename(path);
    85	    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
    86	      return lintFrontmatterCard({ path, content, options, type });
    87	    }
    88	  }
    89	  return lintCard(options.loader, { path });
    90	}
    91	
    92	async function lintFrontmatterCard(input: {
    93	  path: string;
    94	  content: string;
    95	  options: LintDispatchOptions;
    96	  type: string;
    97	}): Promise<LintResult> {
    98	  const { path, content, options, type } = input;
    99	  let parsed;
   100	  try {
   101	    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
   102	  } catch (e) {
   103	    return errorResult(path, (e as Error).message);
   104	  }
   105	  // Broken refs are surfaced as WARNINGS, not errors. Refs commonly go
   106	  // stale via legitimate operations (the referent got moved, archived,
   107	  // trashed, or hand-deleted), and treating each one as a hard error
   108	  // would have the pre-commit hook blocking every commit on any box
   109	  // with accumulated data drift. Schema validation failures (which come
   110	  // out of parseCardText as a thrown CardIOError → errorResult above)
   111	  // remain errors and do block.
   112	  const frontmatterRefs = extractRefs(parsed.fields);
   113	  const bodyField = parsed.fields["body"];
   114	  const bodyRefs = typeof bodyField === "string" ? extractBodyRefs(bodyField) : [];
   115	  const warnings: LintIssue[] = [];
   116	  for (const { path: refPath, ref } of [...frontmatterRefs, ...bodyRefs]) {
   117	    try {
   118	      const resolved = await options.loader.resolveRef(ref, path);
   119	      if (!resolved.exists) {
   120	        warnings.push({
   121	          type: "reference",
   122	          severity: "warning",
   123	          message: `Broken reference at ${refPath}: ${ref} does not exist`,
   124	        });
   125	      }
   126	    } catch (e) {
   127	      warnings.push({
   128	        type: "reference",
   129	        severity: "warning",
   130	        message: `Reference at ${refPath} failed to resolve: ${(e as Error).message}`,
   131	      });
   132	    }
   133	  }
   134	  const containsWarning = lintContainsLength(parsed.fields);
   135	  if (containsWarning !== null) warnings.push(containsWarning);
   136	  warnings.push(...unknownKeyWarnings({ content, schema: parsed.schema }));
   137	  // Type-specific, self-contained validation (rules Zod can't express) lives on
   138	  // the schema as its `validate` hook — see the commentary/extfile schema
   139	  // modules. The generic ref-existence walk above stays here because it needs
   140	  // the loader (box-aware), which the self-contained hook deliberately lacks.
   141	  const errors = parsed.schema.validate ? parsed.schema.validate({ fields: parsed.fields }) : [];
   142	  return { path, errors, warnings };
   143	}
   144	
   145	/**
   146	 * Frontmatter keys present on disk that the card's schema doesn't declare. The
   147	 * loader strips these in memory (a drifted card still loads, renders, and
   148	 * indexes), so they are surfaced as **warnings** — visible to `cb validate` and
   149	 * the PostToolUse hook — to be cleaned off disk eventually, without blocking
   150	 * commits or breaking load. Allowed keys are the schema's own fields (minus the
   151	 * body field, which lives in the file body, not frontmatter), the injected
   152	 * global fields, and `type`.
   153	 */
   154	function unknownKeyWarnings(input: { content: string; schema: CardSchema }): LintIssue[] {
   155	  const { content, schema } = input;
   156	  const split = splitCardContent(content);
   157	  if (!split.hasFrontmatter) return [];
   158	  let fm: unknown;
   159	  try {
   160	    fm = parseYaml(split.frontmatterText);
   161	  } catch (_e) {
   162	    // Malformed YAML is a separate, error-level failure already surfaced by
   163	    // parseCardText (which threw → errorResult); nothing to add here.
   164	    return [];
   165	  }
   166	  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return [];
   167	  const allowed = new Set<string>(["type", ...schema.globalFieldNames, ...Object.keys(schema.fields)]);
   168	  if (schema.bodyFieldName !== null) allowed.delete(schema.bodyFieldName);
   169	  const warnings: LintIssue[] = [];
   170	  for (const key of Object.keys(fm as Record<string, unknown>)) {
   171	    if (allowed.has(key)) continue;
   172	    warnings.push({
   173	      type: "schema",
   174	      severity: "warning",
   175	      message:
   176	        `Unknown frontmatter key "${key}" — not declared by the ${schema.type} schema; ` +
   177	        "it is ignored on load and should be removed",
   178	    });
   179	  }
   180	  return warnings;
   181	}
   182	
   183	/** Soft budget for the `contains` field — one concise sentence, not a summary essay. */
   184	const CONTAINS_MAX_CHARS = 200;
   185	
   186	function lintContainsLength(fields: Record<string, unknown>): LintIssue | null {
   187	  const contains = fields["contains"];
   188	  if (typeof contains !== "string" || contains.length <= CONTAINS_MAX_CHARS) return null;
   189	  return {
   190	    type: "contains",
   191	    severity: "warning",
   192	    message:
   193	      `contains: is ${String(contains.length)} chars (budget ${String(CONTAINS_MAX_CHARS)}) — ` +
   194	      "tighten it to one sentence stating what can be found in this card",
   195	  };
   196	}
   197	
   198	function errorResult(path: string, message: string): LintResult {
   199	  // The cardworks formatter prints the file path as a header above each
   200	  // result's issues, so strip any leading "<path>: " prefix the underlying
   201	  // error (e.g. CardIOError) included to avoid printing the path twice.
   202	  const prefix = `${path}: `;
   203	  const cleaned = message.startsWith(prefix) ? message.slice(prefix.length) : message;
   204	  const issue: LintIssue = {
   205	    type: "validation",
   206	    severity: "error",
   207	    message: cleaned,
   208	  };
   209	  return { path, errors: [issue], warnings: [] };
   210	}
   211	

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/cli/commands/validate.ts | sed -n '150,370p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
   150	  loader: Awaited<ReturnType<typeof createLoader>>;
   151	  ctx: LoadCardContext;
   152	}
   153	
   154	interface ValidationResults {
   155	  cardSummary: LintSummary | null;
   156	  mdSummary: MarkdownLintSummary | null;
   157	  attachErrors: AttachLintError[];
   158	  /** Soft, non-blocking size warnings for oversized CLAUDE.md files. */
   159	  claudeMdWarnings: string[];
   160	}
   161	
   162	/**
   163	 * Hook mode: read the touched card path from stdin, validate it, and exit.
   164	 * Non-card paths exit 0 silently; errors AND warnings exit 2 so the agent
   165	 * sees feedback (the hook is a nudge, not a gate — pre-commit blocks only
   166	 * on errors). This always exits the process and never returns.
   167	 */
   168	async function runHookMode(): Promise<never> {
   169	  const fp = await readHookFilePath();
   170	  if (fp === undefined) {
   171	    process.exit(0);
   172	  }
   173	  // CLAUDE.md gets only the soft size lint (it isn't a card and isn't markdown-
   174	  // validity-checked); a too-large one is surfaced as a warning, never blocked.
   175	  if (isClaudeMdFile(fp)) {
   176	    const boxRoot = await requireBoxRoot();
   177	    const warning = await lintClaudeMdFile(boxRoot, fp);
   178	    if (warning !== null) {
   179	      process.stderr.write(`${warning}\n`);
   180	      process.exit(2);
   181	    }
   182	    process.exit(0);
   183	  }
   184	  if (!isCardFile(fp)) {
   185	    process.exit(0);
   186	  }
   187	  const boxRoot = await requireBoxRoot();
   188	  const loader = await createLoader(boxRoot);
   189	  const ctx = await buildLoadContext(boxRoot);
   190	  const summary = await lintCardsDispatch([fp], { loader, ctx });
   191	  const stale = await staleContainsWarning(boxRoot, {
   192	    relPath: path.relative(boxRoot, fp),
   193	    ctx,
   194	  });
   195	  if (summary.totalErrors > 0 || summary.totalWarnings > 0 || stale !== null) {
   196	    const parts: string[] = [];
   197	    if (summary.totalErrors > 0 || summary.totalWarnings > 0) {
   198	      parts.push(formatLintResults(summary, { colors: false }));
   199	    }
   200	    if (stale !== null) parts.push(stale);
   201	    process.stderr.write(`${parts.join("\n")}\n`);
   202	    process.exit(2);
   203	  }
   204	  process.exit(0);
   205	}
   206	
   207	interface CollectArgs {
   208	  boxRoot: string;
   209	  loader: ValidationContext["loader"];
   210	  ctx: LoadCardContext;
   211	  resolved: string[];
   212	  json: boolean;
   213	}
   214	
   215	/**
   216	 * Pick the validation scope from the options and run it. Mirrors the original
   217	 * staged / all-or-empty / explicit-paths branch order exactly.
   218	 */
   219	async function collectResults(
   220	  options: { staged?: boolean; all?: boolean; json?: boolean },
   221	  args: CollectArgs
   222	): Promise<ValidationResults> {
   223	  if (options.staged) return collectStagedResults(args);
   224	  if (options.all || args.resolved.length === 0) return collectAllResults(args);
   225	  return collectExplicitResults(args);
   226	}
   227	
   228	/** Validate the union of git-staged cards and any explicit card paths given. */
   229	async function collectStagedResults({ boxRoot, loader, ctx, resolved, json }: CollectArgs): Promise<ValidationResults> {
   230	  const staged = await listStagedCards(boxRoot);
   231	  const explicit = resolved.filter(isCardFile);
   232	  const all = [...staged, ...explicit];
   233	  if (all.length === 0 && !json) {
   234	    console.log("No staged cards to validate.");
   235	  }
   236	  const cardSummary = all.length > 0 ? await lintCardsDispatch(all, { loader, ctx }) : null;
   237	  return { cardSummary, mdSummary: null, attachErrors: [], claudeMdWarnings: [] };
   238	}
   239	
   240	/** Validate every card, markdown file, and attach layout in the box. */
   241	async function collectAllResults({ boxRoot, loader, ctx }: CollectArgs): Promise<ValidationResults> {
   242	  const cardPaths = (await loader.listCards()).filter((p) => !isTrashedCard(p));
   243	  const cardSummary = await lintCardsDispatch(cardPaths, { loader, ctx });
   244	  const mdFiles = await findMarkdownFiles(boxRoot);
   245	  const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles) : null;
   246	  const attachErrors = await lintAttachLayout(boxRoot);
   247	  const claudeMdWarnings = await lintAllClaudeMd(boxRoot);
   248	  return { cardSummary, mdSummary, attachErrors, claudeMdWarnings };
   249	}
   250	
   251	/** Validate an explicit list of card/markdown paths; exit 1 on unknown types. */
   252	async function collectExplicitResults({ loader, ctx, resolved }: CollectArgs): Promise<ValidationResults> {
   253	  const cardPaths = resolved.filter(isCardFile);
   254	  const mdPaths = resolved.filter(isMarkdownFile);
   255	  const unknown = resolved.filter((p) => !isCardFile(p) && !isMarkdownFile(p));
   256	  if (unknown.length > 0) {
   257	    console.error(`Error: not a card or markdown file: ${unknown.join(", ")}`);
   258	    process.exit(1);
   259	  }
   260	  const cardSummary = cardPaths.length > 0 ? await lintCardsDispatch(cardPaths, { loader, ctx }) : null;
   261	  const mdSummary = mdPaths.length > 0 ? await lintMarkdownFiles(mdPaths) : null;
   262	  return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [] };
   263	}
   264	
   265	/** Print human-readable card/markdown/attach results to stdout. */
   266	function printTextResults({ cardSummary, mdSummary, attachErrors, claudeMdWarnings }: ValidationResults): void {
   267	  if (cardSummary !== null) {
   268	    const output = formatLintResults(cardSummary, { colors: true });
   269	    if (output) console.log(output);
   270	  }
   271	  if (mdSummary !== null) {
   272	    const output = formatMarkdownResults(mdSummary, { colors: true });
   273	    if (output) console.log(`\n${output}`);
   274	    if (mdSummary.totalErrors > 0) {
   275	      const fileWord = mdSummary.filesWithErrors === 1 ? "file" : "files";
   276	      console.log(
   277	        `\n${String(mdSummary.filesChecked)} markdown file${mdSummary.filesChecked === 1 ? "" : "s"} checked, ` +
   278	        `${String(mdSummary.totalErrors)} error${mdSummary.totalErrors === 1 ? "" : "s"} in ` +
   279	        `${String(mdSummary.filesWithErrors)} ${fileWord}`
   280	      );
   281	    }
   282	  }
   283	  if (attachErrors.length > 0) {
   284	    const output = formatAttachLintErrors(attachErrors, { colors: true });
   285	    console.log(`\n${output}`);
   286	    console.log(`\nAttach layout: ${attachErrors.length} issue(s)`);
   287	  }
   288	  if (claudeMdWarnings.length > 0) {
   289	    console.log(`\n${claudeMdWarnings.join("\n")}`);
   290	  }
   291	}
   292	
   293	/**
   294	 * Verify the git working tree is clean. Exits 1 (printing the dirty files) if
   295	 * not. Prints a confirmation line in non-JSON mode when clean.
   296	 */
   297	async function checkCommitted(boxRoot: string, { json }: { json: boolean }): Promise<void> {
   298	  const status = await getStatus(boxRoot);
   299	  if (!status.clean) {
   300	    const dirty = [...status.staged, ...status.modified, ...status.untracked];
   301	    console.error("\nGit working tree is not clean:");
   302	    for (const file of dirty) {
   303	      console.error(`  ${file}`);
   304	    }
   305	    process.exit(1);
   306	  }
   307	  if (!json) {
   308	    console.log("Git working tree is clean.");
   309	  }
   310	}
   311	
   312	function countTotalErrors({ cardSummary, mdSummary, attachErrors }: ValidationResults): number {
   313	  return (
   314	    (cardSummary !== null ? cardSummary.totalErrors : 0) +
   315	    (mdSummary !== null ? mdSummary.totalErrors : 0) +
   316	    attachErrors.length
   317	  );
   318	}
   319	
   320	export const validateCommand = new Command("validate")
   321	  .description("Validate cards and markdown in the box")
   322	  .argument("[paths...]", "Files to validate (cards or markdown). Omit to validate everything; pair with --staged to validate staged cards.")
   323	  .option("--all", "Validate all files in the box (default when no path given)")
   324	  .option("--staged", "Validate the cards currently staged in git")
   325	  .option("--hook", "Hook mode: read Claude Code PostToolUse JSON payload from stdin, validate the touched card. Errors go to stderr with exit code 2 so the agent sees feedback; non-card paths exit 0 silently.")
   326	  .option("--json", "Output results as JSON")
   327	  .option("--committed", "Also check that git working tree is clean")
   328	  .action(
   329	    async (
   330	      targetPaths: string[],
   331	      options: { all?: boolean; staged?: boolean; hook?: boolean; json?: boolean; committed?: boolean }
   332	    ) => {
   333	      try {
   334	        if (options.hook) {
   335	          await runHookMode();
   336	        }
   337	
   338	        const boxRoot = await requireBoxRoot();
   339	        const loader = await createLoader(boxRoot);
   340	        const ctx = await buildLoadContext(boxRoot);
   341	        const json = options.json === true;
   342	
   343	        const resolved = targetPaths.map((p) =>
   344	          path.isAbsolute(p) ? p : path.join(process.cwd(), p)
   345	        );
   346	
   347	        const results = await collectResults(options, { boxRoot, loader, ctx, resolved, json });
   348	
   349	        if (json) {
   350	          const payload = { cards: results.cardSummary, markdown: results.mdSummary, attach: results.attachErrors, claudeMd: results.claudeMdWarnings };
   351	          console.log(JSON.stringify(payload, null, 2));
   352	        } else {
   353	          printTextResults(results);
   354	        }
   355	
   356	        if (options.committed) {
   357	          await checkCommitted(boxRoot, { json });
   358	        }
   359	
   360	        if (countTotalErrors(results) > 0) {
   361	          process.exit(1);
   362	        }
   363	      } catch (error) {
   364	        console.error(`Error: ${(error as Error).message}`);
   365	        process.exit(1);
   366	      }
   367	    }
   368	  );

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/sdk-hooks.ts | sed -n '80,135p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    80	            hookSpecificOutput: {
    81	              hookEventName: "PostToolUse",
    82	              additionalContext: additional,
    83	            },
    84	          };
    85	        }
    86	
    87	        return {};
    88	      },
    89	    ],
    90	  };
    91	}
    92	
    93	async function runMarkdownLint(filePath: string): Promise<string | null> {
    94	  try {
    95	    const results = await markdownlint({ files: [filePath], config: MARKDOWN_CONFIG, customRules: CUSTOM_RULES });
    96	    const errors = results[filePath] ?? [];
    97	    if (errors.length === 0) return null;
    98	    const lines = errors.map(
    99	      (e) => `  ${filePath}:${e.lineNumber} [${e.ruleNames[0]}] ${e.ruleDescription}${e.errorDetail ? ` (${e.errorDetail})` : ""}`
   100	    );
   101	    return `Markdown lint warning for ${filePath}:\n${lines.join("\n")}`;
   102	  } catch (e) {
   103	    return `Markdown lint could not run for ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
   104	  }
   105	}
   106	
   107	async function runCardLint(cwd: string, filePath: string): Promise<string | null> {
   108	  try {
   109	    const loader = await createLoader(cwd);
   110	    const ctx = await buildLoadContext(cwd);
   111	    const summary = await lintCardsDispatch([filePath], { loader, ctx });
   112	    if (summary.totalErrors === 0 && summary.totalWarnings === 0) return null;
   113	    const formatted = formatLintResults(summary, { colors: false });
   114	    return `Card validation warning for ${filePath}:\n${formatted}`;
   115	  } catch (e) {
   116	    return `Card validation could not run for ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
   117	  }
   118	}

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/cli/lib/loader.ts | sed -n '1,100p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * CardLoader factory for callback box.
     3	 *
     4	 * Creates a configured CardLoader instance with all known schemas.
     5	 */
     6	
     7	import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
     8	import { createSchemaRegistry } from "../../schemas/registry.js";
     9	
    10	export interface CreateLoaderOptions {
    11	  /** Whether to require version attributes on cards */
    12	  requireVersion?: boolean;
    13	  /** Whether to indent serialized XML */
    14	  indent?: boolean;
    15	}
    16	
    17	/**
    18	 * Create a CardLoader for the given box root.
    19	 *
    20	 * Loads both built-in schemas and any box-local schemas from config/schemas/.
    21	 *
    22	 * @param boxRoot - The root directory of the callback box
    23	 * @param options - Optional configuration
    24	 * @returns A configured CardLoader
    25	 */
    26	export async function createLoader(
    27	  boxRoot: string,
    28	  options?: CreateLoaderOptions
    29	): Promise<CardLoader> {
    30	  options = options ?? {};
    31	  const loaderOptions: CardLoaderOptions = {
    32	    schemas: await createSchemaRegistry(boxRoot),
    33	    requireVersion: options.requireVersion ?? false,
    34	    indent: options.indent ?? false,
    35	  };
    36	
    37	  return new CardLoader(boxRoot, loaderOptions);
    38	}
    39	
    40	/**
    41	 * Parameters for createMemoryLoader
    42	 */
    43	export interface CreateMemoryLoaderParams {
    44	  projectRoot: string;
    45	  files?: Record<string, string>;
    46	  options?: CreateLoaderOptions;
    47	}
    48	
    49	/**
    50	 * Create an in-memory CardLoader for testing.
    51	 *
    52	 * @param params - Parameters object
    53	 * @returns A configured MemoryCardLoader
    54	 */
    55	export async function createMemoryLoader(
    56	  params: CreateMemoryLoaderParams
    57	): Promise<MemoryCardLoader> {
    58	  const { projectRoot } = params;
    59	  const files = params.files ?? {};
    60	  const options = params.options ?? {};
    61	  return new MemoryCardLoader(projectRoot, {
    62	    schemas: await createSchemaRegistry(),
    63	    requireVersion: options.requireVersion ?? false,
    64	    indent: options.indent ?? false,
    65	    files,
    66	  });
    67	}
    68	
    69	// Re-export CardLoader types for convenience
    70	export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
    71	export type { ICardLoader, CardLoaderOptions } from "cardworks";

codex
For the “only genuinely needed CardLoader function” claim: in current `src/`, `resolveRef` is indeed the only lint-time semantic use, and `listCards` is discovery. But there are live feature callers still constructing loaders for old routes/views, so deletion safety depends on proving those features are either dead or rewritten, not just proving frontmatter cards avoid XML.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/routes/api-card-routes.ts | sed -n '1,150p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Single-card read route for the REST API.
     3	 *
     4	 * Split out of `api.ts`. Owns the legacy XML read endpoint:
     5	 *
     6	 *   GET /api/card/* — load a card, return its xml + sanitized element tree
     7	 *
     8	 * The element-sanitization helper lives in `api-card-patch.ts`.
     9	 */
    10	
    11	import type { FastifyInstance } from "fastify";
    12	import * as path from "node:path";
    13	import { createLoader } from "../../cli/lib/loader.js";
    14	import { sanitizeElement } from "./api-card-patch.js";
    15	
    16	interface RegisterApiCardRoutesOptions {
    17	  server: FastifyInstance;
    18	  boxRoot: string;
    19	}
    20	
    21	/**
    22	 * Register the `/api/card/*` GET + PATCH routes on the Fastify server.
    23	 */
    24	export function registerApiCardRoutes(options: RegisterApiCardRoutesOptions): void {
    25	  const { server, boxRoot } = options;
    26	
    27	  // GET /api/card/:path - Get a single card's content
    28	  server.get<{ Params: { "*": string }; Querystring: { format?: string } }>(
    29	    "/api/card/*",
    30	    async (request, reply) => {
    31	      const cardPath = request.params["*"];
    32	      if (!cardPath) {
    33	        return reply.status(400).send({ error: "Card path required" });
    34	      }
    35	
    36	      const fullPath = path.join(boxRoot, cardPath);
    37	      const loader = await createLoader(boxRoot);
    38	
    39	      try {
    40	        const card = await loader.load(fullPath);
    41	        const xml = loader.serialize(card.element);
    42	
    43	        // Include element tree for tree view rendering
    44	        const element = sanitizeElement(card.element);
    45	
    46	        return {
    47	          path: cardPath,
    48	          tagName: card.element.tagName,
    49	          status: card.element.attrs["status"],
    50	          version: card.version,
    51	          xml,
    52	          element,
    53	        };
    54	      } catch (error) {
    55	        const msg = (error as Error).message;
    56	        const isNotFound = msg.includes("ENOENT") || msg.includes("no such file");
    57	        return reply.status(isNotFound ? 404 : 422).send({
    58	          error: isNotFound ? `Card not found: ${cardPath}` : `Card validation failed: ${cardPath}`,
    59	          details: msg,
    60	        });
    61	      }
    62	    }
    63	  );
    64	}

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/routes/api.ts | sed -n '80,115p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    80	    const state = await getSystemState(boxRoot);
    81	    const context = await generateContext(boxRoot);
    82	
    83	    // Enrich questions with prompt data from context
    84	    const enriched = state.questions.map(q => {
    85	      const pending = context.pendingQuestions.find(p => p.path === q.relativePath);
    86	      return {
    87	        ...q,
    88	        prompt: pending?.prompt,
    89	        options: pending?.options,
    90	      };
    91	    });
    92	
    93	    return {
    94	      items: enriched,
    95	    };
    96	  });
    97	
    98	  // /api/card/* — load a single card
    99	  registerApiCardRoutes({ server, boxRoot });
   100	
   101	  // GET /api/activity - Recent git commits (renamed from /api/log to avoid ad blockers)
   102	  server.get<{ Querystring: { count?: string } }>("/api/activity", async (request) => {
   103	    const count = parseInt(request.query.count ?? "10", 10);
   104	    const entries = await getLog(boxRoot, count);
   105	    return {
   106	      entries,
   107	    };
   108	  });
   109	
   110	  // GET /api/context - Agent context
   111	  server.get("/api/context", async () => {
   112	    const context = await generateContext(boxRoot);
   113	    return context;
   114	  });
   115	

exec
/opt/homebrew/bin/bash -lc "rg -n \"api/card|/api/card|card\\.get|trpc\\.card|getCard\\(|apiClient|fetch\\(\" callback-box/src/frontend/src callback-box/src/webapp -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/frontend/src/api-core.ts:87:  const response = await fetch(url, {
callback-box/src/frontend/src/pages/BrowsePage.tsx:169:      const response = await fetch(`${getApiBase()}/files/${path}`, {
callback-box/src/frontend/src/lib/view-bindings.ts:34:      const resp = await fetch(`${getApiBase()}/views`);
callback-box/src/webapp/routes/proxy-image.ts:139:        const resp = await fetch(current.href, {
callback-box/src/frontend/src/api.ts:95:  const response = await fetch(`${getApiBase()}/actions/create-voice-memo`, {
callback-box/src/frontend/src/api.ts:118:  const response = await fetch(`${getApiBase()}/upload`, {
callback-box/src/frontend/src/api.ts:146:  const response = await fetch(`${getApiBase()}/commands/execute`, {
callback-box/src/webapp/routes/api-card-routes.ts:6: *   GET /api/card/* — load a card, return its xml + sanitized element tree
callback-box/src/webapp/routes/api-card-routes.ts:22: * Register the `/api/card/*` GET + PATCH routes on the Fastify server.
callback-box/src/webapp/routes/api-card-routes.ts:27:  // GET /api/card/:path - Get a single card's content
callback-box/src/webapp/routes/api-card-routes.ts:29:    "/api/card/*",
callback-box/src/frontend/src/renderers/sheet.tsx:90:          const resp = await fetch(`${getApiBase()}/files/${filePath}`);
callback-box/src/frontend/src/renderers/json.tsx:43:      const resp = await fetch(url, { method: "HEAD" });
callback-box/src/frontend/src/renderers/json.tsx:63:      const resp = await fetch(url, { signal });
callback-box/src/frontend/src/renderers/binary.tsx:25:      const resp = await fetch(url, { method: "HEAD" });
callback-box/src/frontend/src/renderers/directory.tsx:69:  const { data: card, isLoading, error } = trpc.card.get.useQuery({ path: cardPath });
callback-box/src/webapp/routes/api-card-patch.ts:2: * Element-sanitization helper for the REST API's `GET /api/card/*` route.
callback-box/src/frontend/src/components/ExternalDocument.tsx:48:      const resp = await fetch(`${apiBase}/external?href=${encodeURIComponent(href)}`, { signal });
callback-box/src/frontend/src/pages/capture-api.ts:39:  const res = await fetch(`${getApiBase()}/capture/sessions`, { method: "POST" });
callback-box/src/frontend/src/pages/capture-api.ts:84:      res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/upload`, {
callback-box/src/frontend/src/pages/capture-api.ts:119:  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/finalize`, {
callback-box/src/frontend/src/pages/capture-api.ts:129:  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}`, {
callback-box/src/webapp/routes/api-adapters.ts:102:        upstream = await fetch(url, init);
callback-box/src/webapp/routes/api.ts:8: *   api-card-routes.ts — GET /api/card/* (helpers in api-card-patch.ts)
callback-box/src/webapp/routes/api.ts:98:  // /api/card/* — load a single card
callback-box/src/frontend/src/lib/trpc.ts:22:  const response = await fetch(fixedUrl, options);
callback-box/src/frontend/src/components/AttachedCommentary.tsx:27:  const { data, isLoading, error } = trpc.card.get.useQuery({ path: cardPath });
callback-box/src/webapp/trpc/routers/transcription.ts:107:      response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
callback-box/src/frontend/src/components/ViewRenderer.tsx:144:      const resp = await fetch(url);
callback-box/src/frontend/src/lib/boxes.ts:13:    const resp = await fetch(withBase("/api/boxes"));
callback-box/src/webapp/trpc/routers/files.ts:6: * rather than the full card.get endpoint so that XML bodies don't ship over
callback-box/src/frontend/src/components/CardTreeView.tsx:98:  const query = trpc.card.get.useQuery(
callback-box/src/frontend/src/components/TodoListView.tsx:156:      utils.card.get.invalidate({ path: data.path });
callback-box/src/frontend/src/components/admin/TelegramSection.tsx:24:      const resp = await fetch(`${apiBase}/admin/telegram-status`);
callback-box/src/frontend/src/components/admin/TelegramSection.tsx:52:      const resp = await fetch(`${apiBase}/admin/telegram-setup`, {
callback-box/src/frontend/src/components/admin/TelegramSection.tsx:75:      const resp = await fetch(`${apiBase}/admin/telegram-disconnect`, { method: "POST" });
callback-box/src/frontend/src/lib/file-upload.ts:24:  const response = await fetch(`${getApiBase()}/chat/upload-file`, {
callback-box/src/frontend/src/components/FileView.tsx:116:  const { data: card, isLoading: cardLoading, error: cardError } = trpc.card.get.useQuery(
callback-box/src/frontend/src/components/FileView.tsx:126:      const resp = await fetch(`${apiBase}/files/${path}`, { signal });
callback-box/src/frontend/src/components/FileView.tsx:143:        utils.card.get.invalidate({ path });
callback-box/src/frontend/src/components/FileView.tsx:145:        textQuery.refetch();
callback-box/src/frontend/src/lib/last-audio-cache.ts:45:      res = await fetch(url, {
callback-box/src/frontend/src/lib/last-audio-cache.ts:56:      res = await fetch(url, { method: "POST", body: form });
callback-box/src/frontend/src/components/chat/InteractiveChat-sse.ts:174:    fetch(`${getApiBase()}/chat/voice-config`)
callback-box/src/frontend/src/components/admin/useGoogleServices.ts:45:      const resp = await fetch(`${apiBase}/admin/google-status`);
callback-box/src/frontend/src/components/admin/useGoogleServices.ts:91:      const resp = await fetch(`${apiBase}/admin/google-setup`, {
callback-box/src/frontend/src/components/admin/useGoogleServices.ts:113:      const resp = await fetch(`${apiBase}/admin/google-disconnect`, { method: "POST" });
callback-box/src/frontend/src/components/admin/useGoogleServices.ts:133:      const resp = await fetch(`${apiBase}/admin/box-config`, {
callback-box/src/frontend/src/components/chat/user-message.tsx:167:      fetch(`${getApiBase()}/task-output?file=${encodeURIComponent(notification.outputFile)}`)
callback-box/src/frontend/src/components/admin/AllowedEmailsSection.tsx:21:      const resp = await fetch(`${apiBase}/admin/box-config`);
callback-box/src/frontend/src/components/admin/AllowedEmailsSection.tsx:49:      const resp = await fetch(`${apiBase}/admin/box-config`, {
callback-box/src/frontend/src/components/chat/InteractiveChat-hooks.ts:225:    fetch(`${getApiBase()}/chat/schedules`)
callback-box/src/frontend/src/components/chat/InteractiveChat-hooks.ts:255:      fetch(`${getApiBase()}/chat/history`)
callback-box/src/frontend/src/components/chat/InteractiveChat-hooks.ts:275:    fetch(`${getApiBase()}/chat/schedules/cancel`, {
callback-box/src/webapp/trpc/routers/card.ts:124:      // `/api/files` boundary guard (routes/api-files.ts); card.get had none.
callback-box/src/frontend/src/lib/tts-client.ts:156:  prefetch(text: string, options?: SpeechOptions): PrefetchHandle {
callback-box/src/frontend/src/lib/tts-client.ts:286:    const response = await fetch(`${getApiBase()}/chat/tts`, {
callback-box/src/frontend/src/lib/tts-client.ts:346:    const response = await fetch(`${getApiBase()}/chat/tts`, {
callback-box/src/frontend/src/components/DebugLog.tsx:35:  fetch(`${getApiBase()}/debug-log`, {
callback-box/src/frontend/src/pages/landmarks/components/LandmarkSection.tsx:83:    const { sessionId } = await utils.chat.lastSessionForDirectory.fetch({ contextDir: dir });
callback-box/src/frontend/src/hooks/useViewFileHelpers.ts:102:    return fetch(`${apiBase}/adapters/${adapter}${joined}`, init);
callback-box/src/frontend/src/hooks/useViewFileHelpers.ts:116:    const resp = await fetch(fileUrl(filePath), { headers });
callback-box/src/frontend/src/hooks/useViewFileHelpers.ts:130:    const resp = await fetch(fileUrl(filePath), {
callback-box/src/frontend/src/hooks/useViewFileHelpers.ts:150:    const resp = await fetch(`${apiBase}/files-commit`, {
callback-box/src/frontend/src/hooks/useCurrentUser.ts:20:    fetch(withBase("/auth/me"))
callback-box/src/frontend/src/api-chat.ts:102:    const res = await fetch(`${getApiBase()}/chat/transcribe-audio`, {
callback-box/src/frontend/src/api-chat.ts:207:    const response = await fetch(`${getApiBase()}/chat/send`, {
callback-box/src/frontend/src/api-chat.ts:238:    // fetch() throws TypeError on network failure.
callback-box/src/webapp/trpc/routers/chat.ts:198:   * `card.get`, so reject anything that could escape the box.
callback-box/src/frontend/src/hooks/useDevWorktreeKeepalive.ts:24:      fetch(import.meta.env.BASE_URL ?? "/", { method: "HEAD" }).catch(() => {
callback-box/src/frontend/src/pages/share-save.ts:85:  const response = await fetch(withBase(`/${boxSlug}/api/commands/execute`), {
callback-box/src/frontend/src/pages/card/components/OpenChatControl.tsx:33:      const { contextDir, sessionId } = await utils.chat.openForCard.fetch({ cardPath });
callback-box/src/frontend/src/machines/claudeAuthMachine.ts:38:  const resp = await fetch(withBase("/api/admin/claude-status"));
callback-box/src/frontend/src/machines/claudeAuthMachine.ts:47:  const resp = await fetch(withBase("/api/admin/claude-login"), { method: "POST" });
callback-box/src/frontend/src/machines/claudeAuthMachine.ts:60:  const resp = await fetch(withBase("/api/admin/claude-logout"), { method: "POST" });
callback-box/src/frontend/src/machines/claudeAuthMachine.ts:66:  const statusResp = await fetch(withBase("/api/admin/claude-status"));
callback-box/src/frontend/src/machines/claudeAuthMachine.ts:77:      const resp = await fetch(withBase("/api/admin/claude-status"));
callback-box/src/frontend/src/machines/speechPlaybackMachine.ts:72:        ? ttsClient.prefetch(segment.text, speechOptions(segment))

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/test/routes-api.doctest.md | sed -n '60,115p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    60	=> 200
    61	```
    62	
    63	``` continue
    64	res.body.items.length > 0
    65	=> true
    66	```
    67	
    68	``` cleanup
    69	await ctx.cleanup();
    70	```
    71	
    72	## Loading a card
    73	
    74	`GET /api/card/*` returns a parsed card by path:
    75	
    76	```
    77	const ctx = await makeTestServer();
    78	await ctx.seed(
    79	  "box/inbox/hello.memo.card",
    80	  '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Hello world</content></memo>\n',
    81	);
    82	await ctx.inject({ method: "GET", url: "/api/card/box/inbox/hello.memo.card" })
    83	=>
    84	200
    85	{
    86	  "path": "box/inbox/hello.memo.card",
    87	  "tagName": "memo",
    88	  «*»
    89	  "element": {
    90	    "tagName": "memo"«*»
    91	  }
    92	}
    93	```
    94	
    95	``` cleanup
    96	await ctx.cleanup();
    97	```
    98	
    99	Missing cards return 404:
   100	
   101	```
   102	const ctx = await makeTestServer();
   103	const res = await ctx.request({ method: "GET", url: "/api/card/box/inbox/nope.memo.card" });
   104	res.statusCode
   105	=> 404
   106	```
   107	
   108	``` cleanup
   109	await ctx.cleanup();
   110	```
   111	
   112	## Browsing directories
   113	
   114	`GET /api/browse/*` lists directory contents with parsed card metadata:
   115	

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/trpc/routers/card.ts | sed -n '1,260p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/frontend/src/components/CardTreeView.tsx | sed -n '80,150p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/frontend/src/renderers/directory.tsx | sed -n '55,90p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    55	  return (
    56	    <Accordion title={title}>
    57	      <CardAccordionBody cardPath={cardPath} onNavigate={onNavigate} />
    58	    </Accordion>
    59	  );
    60	}
    61	
    62	function CardAccordionBody({
    63	  cardPath,
    64	  onNavigate,
    65	}: {
    66	  cardPath: string;
    67	  onNavigate: RendererProps["onNavigate"];
    68	}) {
    69	  const { data: card, isLoading, error } = trpc.card.get.useQuery({ path: cardPath });
    70	
    71	  if (isLoading) return <Text size="sm" tone="muted">Loading...</Text>;
    72	  if (error || !card) return <Text size="sm" tone="danger">Failed to load card</Text>;
    73	
    74	  const fileData: FileData = {
    75	    path: card.path,
    76	    tagName: card.tagName,
    77	    element: card.element,
    78	    xml: card.xml,
    79	    version: card.version,
    80	    status: card.status,
    81	  };
    82	
    83	  const renderers = getRenderers(cardPath, fileData);
    84	  if (renderers.length > 0) {
    85	    const Renderer = renderers[0].Component;
    86	    return <Renderer data={fileData} onNavigate={onNavigate} />;
    87	  }
    88	  if (card.element) {
    89	    return <CardTreeView element={card.element} path={card.path} version={card.version} onNavigate={onNavigate} />;
    90	  }

 succeeded in 0ms:
    80	  // Simple path resolution: join and normalize
    81	  const parts = `${cardDir}/${ref}`.split("/");
    82	  const resolved: string[] = [];
    83	  for (const part of parts) {
    84	    if (part === "..") {
    85	      resolved.pop();
    86	    } else if (part !== ".") {
    87	      resolved.push(part);
    88	    }
    89	  }
    90	  return resolved.join("/");
    91	}
    92	
    93	/**
    94	 * Inline expandable card ref viewer.
    95	 */
    96	function RefExpander({ refPath, onNavigate }: { refPath: string; onNavigate: NavigateFn }) {
    97	  const [expanded, setExpanded] = useState(false);
    98	  const query = trpc.card.get.useQuery(
    99	    { path: refPath },
   100	    { enabled: expanded }
   101	  );
   102	
   103	  return (
   104	    <div className="mt-1">
   105	      <button
   106	        onClick={() => setExpanded(!expanded)}
   107	        className="text-xs text-primary hover:text-primary-dark hover:underline flex items-center gap-1"
   108	      >
   109	        <span className="text-[10px]">{expanded ? "\u25BC" : "\u25B6"}</span>
   110	        {refPath.split("/").pop()}
   111	      </button>
   112	      {expanded ? (
   113	        <div className="mt-1 ml-2 border-l-2 border-primary-light pl-3">
   114	          {query.isLoading ? (
   115	            <div className="text-xs text-warm-500">Loading...</div>
   116	          ) : query.error ? (
   117	            <div className="text-xs text-danger-dark">
   118	              Failed to load: {query.error.message}
   119	            </div>
   120	          ) : query.data ? (
   121	            <RefExpanderCard refPath={refPath} data={query.data} onNavigate={onNavigate} />
   122	          ) : null}
   123	        </div>
   124	      ) : null}
   125	    </div>
   126	  );
   127	}
   128	
   129	/**
   130	 * Render a loaded card ref — uses the renderer registry (same as card viewer),
   131	 * falls back to ElementTree.
   132	 */
   133	function RefExpanderCard({ refPath, data, onNavigate }: {
   134	  refPath: string;
   135	  data: { element?: ElementNode; path: string; tagName?: string; xml?: string; version?: string; status?: string };
   136	  onNavigate: NavigateFn;
   137	}) {
   138	  const fileData: FileData = {
   139	    path: data.path || refPath,
   140	    tagName: data.tagName,
   141	    element: data.element,
   142	    xml: data.xml,
   143	    version: data.version,
   144	    status: data.status,
   145	  };
   146	
   147	  const renderers = getRenderers(refPath, fileData);
   148	  if (renderers.length > 0) {
   149	    const Renderer = renderers[0].Component;
   150	    return <Renderer data={fileData} onNavigate={onNavigate} />;

 succeeded in 0ms:
     1	import { z } from "zod";
     2	import * as fs from "node:fs/promises";
     3	import * as path from "node:path";
     4	import { TRPCError } from "@trpc/server";
     5	import { router, publicProcedure } from "../trpc.js";
     6	import { createLoader } from "../../../cli/lib/loader.js";
     7	import { parseCard, type ElementNode } from "cardworks";
     8	import { splitCardContent, type CardSchema } from "../../../cards/index.js";
     9	import { parseCardText } from "../../../core/card-io.js";
    10	import { createCardSchemaMap } from "../../../schemas/registry.js";
    11	import { parse as parseYaml } from "yaml";
    12	
    13	/**
    14	 * JSON-safe element node for the frontend.
    15	 */
    16	export interface JsonElement {
    17	  tagName: string;
    18	  attrs: Record<string, string>;
    19	  text?: string;
    20	  children?: JsonElement[];
    21	}
    22	
    23	function sanitizeElement(el: ElementNode): JsonElement {
    24	  const result: JsonElement = { tagName: el.tagName, attrs: {} };
    25	  for (const [key, value] of Object.entries(el.attrs)) {
    26	    if (typeof value === "string") result.attrs[key] = value;
    27	  }
    28	  if (el.text !== undefined && el.text !== null) {
    29	    result.text = String(el.text).trim();
    30	  }
    31	  if (el.children && Array.isArray(el.children) && el.children.length > 0) {
    32	    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
    33	  }
    34	  return result;
    35	}
    36	
    37	function typeFromFilename(source: string): string | undefined {
    38	  const base = source.split("/").pop();
    39	  if (base === undefined) return undefined;
    40	  const match = base.match(/^.+\.([^.]+)\.card$/);
    41	  return match ? match[1] : undefined;
    42	}
    43	
    44	export interface FrontmatterCardResponse {
    45	  path: string;
    46	  kind: "frontmatter";
    47	  tagName: string;
    48	  status: string | undefined;
    49	  version: string | undefined;
    50	  xml: string;
    51	  element: JsonElement | undefined;
    52	  frontmatter: Record<string, unknown> | undefined;
    53	  body: string | undefined;
    54	  validationError: string | undefined;
    55	}
    56	
    57	function loadFrontmatterCard(input: {
    58	  raw: string;
    59	  source: string;
    60	  type: string;
    61	  cardSchemas: Map<string, CardSchema>;
    62	}): FrontmatterCardResponse {
    63	  const { raw, source, type, cardSchemas } = input;
    64	  let frontmatter: Record<string, unknown> | undefined;
    65	  let body: string | undefined;
    66	  let validationError: string | undefined;
    67	  let status: string | undefined;
    68	
    69	  try {
    70	    const parsed = parseCardText(raw, { source, schemas: cardSchemas, type });
    71	    const fields = { ...parsed.fields };
    72	    if (parsed.schema.bodyFieldName !== null) {
    73	      const bodyValue = fields[parsed.schema.bodyFieldName];
    74	      body = typeof bodyValue === "string" ? bodyValue : parsed.rawBody;
    75	      delete fields[parsed.schema.bodyFieldName];
    76	    } else {
    77	      body = parsed.rawBody;
    78	    }
    79	    delete fields["type"];
    80	    frontmatter = fields;
    81	    const statusField = fields["status"];
    82	    if (typeof statusField === "string") status = statusField;
    83	  } catch (e) {
    84	    validationError = (e as Error).message;
    85	    // Still surface what we can — split the file and parse YAML loosely.
    86	    const split = splitCardContent(raw);
    87	    body = split.body;
    88	    try {
    89	      const fm = parseYaml(split.frontmatterText);
    90	      if (fm !== null && typeof fm === "object" && !Array.isArray(fm)) {
    91	        frontmatter = fm as Record<string, unknown>;
    92	        const statusField = (fm as Record<string, unknown>)["status"];
    93	        if (typeof statusField === "string") status = statusField;
    94	      }
    95	    } catch (_e) {
    96	      // YAML itself is malformed — leave frontmatter undefined.
    97	    }
    98	  }
    99	
   100	  return {
   101	    path: source,
   102	    kind: "frontmatter",
   103	    tagName: type,
   104	    status,
   105	    version: undefined,
   106	    xml: raw,
   107	    element: undefined,
   108	    frontmatter,
   109	    body,
   110	    validationError,
   111	  };
   112	}
   113	
   114	export const cardRouter = router({
   115	  get: publicProcedure
   116	    .input(z.object({ path: z.string().min(1) }))
   117	    .query(async ({ input, ctx }) => {
   118	      const fullPath = path.join(ctx.boxRoot, input.path);
   119	
   120	      // Security: `input.path` arrives from the client (and now from the chat
   121	      // `?card=` deep-link a card-page click writes). Ensure the resolved path
   122	      // stays inside the box before any read — `path.join` collapses `..`, so a
   123	      // crafted `../../etc/...` would otherwise escape boxRoot. Mirrors the
   124	      // `/api/files` boundary guard (routes/api-files.ts); card.get had none.
   125	      const resolved = path.resolve(fullPath);
   126	      if (!resolved.startsWith(path.resolve(ctx.boxRoot))) {
   127	        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid card path" });
   128	      }
   129	
   130	      // Dispatch on file shape: frontmatter cards parse via parseCardText;
   131	      // legacy XML cards fall through to the cardworks loader.
   132	      let raw: string | null = null;
   133	      try {
   134	        raw = await fs.readFile(fullPath, "utf-8");
   135	      } catch (e) {
   136	        const msg = (e as Error).message;
   137	        if (msg.includes("ENOENT") || msg.includes("no such file")) {
   138	          throw new TRPCError({ code: "NOT_FOUND", message: `Card not found: ${input.path}` });
   139	        }
   140	        throw new TRPCError({ code: "BAD_REQUEST", message: msg });
   141	      }
   142	
   143	      const split = splitCardContent(raw);
   144	      const fileType = typeFromFilename(input.path);
   145	      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
   146	      if (split.hasFrontmatter && fileType !== undefined && cardSchemas.has(fileType)) {
   147	        return loadFrontmatterCard({ raw, source: input.path, type: fileType, cardSchemas });
   148	      }
   149	
   150	      const loader = await createLoader(ctx.boxRoot);
   151	
   152	      try {
   153	        const card = await loader.load(fullPath);
   154	        const xml = loader.serialize(card.element);
   155	        const element = sanitizeElement(card.element);
   156	
   157	        return {
   158	          path: input.path,
   159	          kind: "xml" as const,
   160	          tagName: card.element.tagName,
   161	          status: card.element.attrs["status"] as string | undefined,
   162	          version: card.version,
   163	          xml,
   164	          element,
   165	          frontmatter: undefined as Record<string, unknown> | undefined,
   166	          body: undefined as string | undefined,
   167	          validationError: undefined as string | undefined,
   168	        };
   169	      } catch (error) {
   170	        const msg = (error as Error).message;
   171	        const isNotFound = msg.includes("ENOENT") || msg.includes("no such file");
   172	        if (isNotFound) {
   173	          throw new TRPCError({
   174	            code: "NOT_FOUND",
   175	            message: `Card not found: ${input.path}`,
   176	          });
   177	        }
   178	
   179	        // Validation failed — parse XML without validation so we can still show the tree
   180	        let rawXml: string;
   181	        try {
   182	          rawXml = await fs.readFile(fullPath, "utf-8");
   183	        } catch (e) {
   184	          console.warn(`Could not re-read ${input.path} after validation failure:`, e);
   185	          throw new TRPCError({
   186	            code: "BAD_REQUEST",
   187	            message: `Card validation failed: ${msg}`,
   188	          });
   189	        }
   190	
   191	        // Try to parse the raw XML into a tree (no schema validation)
   192	        let element: JsonElement | undefined;
   193	        let tagName: string | undefined;
   194	        try {
   195	          const parsed = await parseCard(rawXml, { source: input.path });
   196	          element = sanitizeElement(parsed);
   197	          tagName = parsed.tagName;
   198	        } catch (e) {
   199	          // XML itself is malformed — fall back to raw text only.
   200	          console.warn(`Could not parse raw XML for ${input.path}, showing raw text only:`, e);
   201	        }
   202	
   203	        return {
   204	          path: input.path,
   205	          kind: "xml" as const,
   206	          tagName,
   207	          status: undefined as string | undefined,
   208	          version: undefined as string | undefined,
   209	          xml: rawXml,
   210	          element,
   211	          frontmatter: undefined as Record<string, unknown> | undefined,
   212	          body: undefined as string | undefined,
   213	          validationError: msg,
   214	        };
   215	      }
   216	    }),
   217	});

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/frontend/src/components/AttachedCommentary.tsx | sed -n '1,65p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Discover and render `.commentary.card` files living in a host card's
     3	 * `.attach/` scope, as a bordered "Commentary" block. Each `{% source %}` chip
     4	 * jumps to its verbatim span in the host's rendered content via the supplied
     5	 * `onJumpToQuote`. Shared by the webpage and extfile views — both surface
     6	 * attached commentary above their document.
     7	 */
     8	
     9	import { attachDirFor } from "@shared/attach-path";
    10	import { trpc } from "../lib/trpc";
    11	import { Markdown } from "./Markdown";
    12	import { Text } from "./ui/Text";
    13	import { type NavigateHint, type ViewTarget } from "../lib/view-url";
    14	
    15	export type JumpToQuote = (quoteText: string) => Promise<boolean>;
    16	
    17	/** One commentary card's remarks, fetched from the host's attach scope. */
    18	function CommentaryRemarks({
    19	  cardPath,
    20	  onNavigate,
    21	  onJumpToQuote,
    22	}: {
    23	  cardPath: string;
    24	  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
    25	  onJumpToQuote: JumpToQuote;
    26	}) {
    27	  const { data, isLoading, error } = trpc.card.get.useQuery({ path: cardPath });
    28	  if (isLoading) {
    29	    return <Text as="div" tone="subtle" className="italic">Loading commentary…</Text>;
    30	  }
    31	  if (error !== null) {
    32	    return <Text as="div" tone="danger">Couldn’t load commentary.</Text>;
    33	  }
    34	  const body = data?.body;
    35	  if (body === undefined || body.trim() === "") {
    36	    return <Text as="div" tone="subtle" className="italic">No commentary yet.</Text>;
    37	  }
    38	  return (
    39	    <div data-card-section="body">
    40	      <Markdown prose="block" onNavigate={onNavigate} onJumpToQuote={onJumpToQuote} basePath={cardPath}>
    41	        {body}
    42	      </Markdown>
    43	    </div>
    44	  );
    45	}
    46	
    47	/**
    48	 * The bordered "Commentary" block for a host card. Discovers `.commentary.card`
    49	 * files in the host's attach scope (a missing scope browses to an empty result,
    50	 * so no commentary renders nothing) and renders each. Returns null when there is
    51	 * no commentary, so callers can place it unconditionally.
    52	 */
    53	export function AttachedCommentary({
    54	  cardPath,
    55	  onNavigate,
    56	  onJumpToQuote,
    57	}: {
    58	  cardPath: string;
    59	  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
    60	  onJumpToQuote: JumpToQuote;
    61	}) {
    62	  const attachDir = attachDirFor(cardPath);
    63	  const { data: browse } = trpc.status.browse.useQuery({ path: attachDir });
    64	  const commentaryPaths = (browse?.cards ?? [])
    65	    .filter((c) => c.type === "commentary")

codex
The REST `/api/card/*` route’s frontend grep claim checks out for the Vite frontend, but there is still a doctest explicitly covering that endpoint. So “no caller” is not the same as “free delete”; the plan should name the test removal/update and any external API compatibility decision.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/trpc/routers/chat.ts | sed -n '70,125p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/generate-docs-compile.ts | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/schemas/landmark.tsx | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
nl: callback-box/src/schemas/landmark.tsx: No such file or directory

 succeeded in 0ms:
    70	      const absolute = path.resolve(landmarkDir, rawSrc);
    71	      src = path.relative(boxRoot, absolute);
    72	    }
    73	    const text = typeof child.text === "string" ? child.text.trim() : "";
    74	    return { text, src };
    75	  }
    76	  return { text: "", src: null };
    77	}
    78	
    79	interface LandmarkSummary {
    80	  dir: string;
    81	  label: string;
    82	  symbol: string;
    83	  symbolSrc: string | null;
    84	}
    85	
    86	/**
    87	 * Like `landmarks.list` but without resolving links/expand — just the
    88	 * tile-level metadata the picker needs.
    89	 */
    90	async function loadLandmarkSummaries(boxRoot: string): Promise<LandmarkSummary[]> {
    91	  const matches = await glob("**/*.landmark.card", {
    92	    cwd: boxRoot,
    93	    nodir: true,
    94	    ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
    95	  });
    96	
    97	  const out: LandmarkSummary[] = [];
    98	  for (const relPath of matches) {
    99	    const absPath = path.join(boxRoot, relPath);
   100	    let element: ElementNode;
   101	    try {
   102	      const content = await fs.readFile(absPath, "utf-8");
   103	      element = await parseCard(content, { source: absPath });
   104	    } catch (e) {
   105	      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   106	        console.warn(`Skipping unreadable/unparsable landmark card ${absPath}:`, e);
   107	      }
   108	      continue;
   109	    }
   110	    if (element.tagName !== "landmark") continue;
   111	
   112	    const dir = path.dirname(relPath);
   113	    const navigation = findNavigation(element);
   114	    const symbol = readSymbol(navigation, { landmarkDir: path.dirname(absPath), boxRoot });
   115	    out.push({
   116	      dir: dir === "." ? "" : dir,
   117	      label: readChildText(navigation, "label") || path.basename(relPath, ".landmark.card"),
   118	      symbol: symbol.text,
   119	      symbolSrc: symbol.src,
   120	    });
   121	  }
   122	  out.sort((a, b) => {
   123	    // Root first, then alphabetical.
   124	    if (a.dir === "") return -1;
   125	    if (b.dir === "") return 1;

 succeeded in 0ms:
     1	/**
     2	 * Box-scanning and card-compilation helpers for doc generation.
     3	 *
     4	 * These functions read the box filesystem (config cards, per-chat guides,
     5	 * briefings, personalities), compile them to markdown / rule files, and
     6	 * return summaries the agent guide needs. Split out of generate-docs.ts so
     7	 * the orchestration file stays focused on cache logic and top-level wiring.
     8	 */
     9	
    10	import { join } from "node:path";
    11	import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
    12	import { parseCard } from "cardworks";
    13	import { parseGuide, parseGuideCard, compileGuide } from "../schemas/guide.js";
    14	import { compilePersonality, compileSpeakingVoice, type PersonalityFields } from "../schemas/personality.js";
    15	import { compileBriefing, type BriefingFields } from "../schemas/briefing.js";
    16	import { parseCardText } from "./card-io.js";
    17	import { createCardSchemaMap } from "../schemas/registry.js";
    18	import { DOCS_DIR, withDocId } from "./generate-docs-shared.js";
    19	
    20	/**
    21	 * Scan procedure cards and extract name + first-line description.
    22	 */
    23	export interface ProcedureSummary {
    24	  name: string;
    25	  filename: string;
    26	  description: string;
    27	}
    28	
    29	export async function scanProcedures(boxRoot: string): Promise<ProcedureSummary[]> {
    30	  const procedureDir = join(boxRoot, "config/procedures");
    31	  let files: string[];
    32	  try {
    33	    files = await readdir(procedureDir);
    34	  } catch (e) {
    35	    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    36	      console.warn(`[generate-docs] could not read ${procedureDir}; assuming no procedures:`, e);
    37	    }
    38	    return [];
    39	  }
    40	
    41	  const cards = files.filter((f) => f.endsWith(".procedure.card")).toSorted();
    42	  const results: ProcedureSummary[] = [];
    43	
    44	  for (const filename of cards) {
    45	    try {
    46	      const content = await readFile(join(procedureDir, filename), "utf-8");
    47	      const root = await parseCard(content, { source: filename });
    48	      const name = root.attrs["name"] ?? filename.replace(".procedure.card", "");
    49	      const descEl = (root.children ?? []).find(
    50	        (c: { tagName?: string }) => c.tagName === "description"
    51	      );
    52	      const desc = (descEl as { text?: string })?.text?.trim() ?? "";
    53	      // Take just the first sentence/line for the compact index
    54	      const shortDesc = desc.split(/\n/)[0]?.replace(/\.\s.*/, ".").trim() || desc;
    55	      results.push({ name, filename, description: shortDesc });
    56	    } catch (e) {
    57	      // Skip unparseable procedure cards — still index them with a placeholder.
    58	      console.warn(`[generate-docs] could not parse procedure card ${filename}:`, e);
    59	      results.push({
    60	        name: filename.replace(".procedure.card", ""),
    61	        filename,
    62	        description: "(could not parse)",
    63	      });
    64	    }
    65	  }
    66	
    67	  return results;
    68	}
    69	
    70	/**
    71	 * Find and compile all briefing.briefing.card files in the box.
    72	 *
    73	 * Each briefing card is compiled to a .md file next to the .card file.
    74	 * Returns the list of compiled briefing paths (relative to box root)
    75	 * so CLAUDE.md can include them.
    76	 */
    77	export async function compileBriefings(boxRoot: string, debug: boolean): Promise<string[]> {
    78	  const compiledPaths: string[] = [];
    79	
    80	  // Check root briefing
    81	  const rootBriefingPath = join(boxRoot, "briefing.briefing.card");
    82	  try {
    83	    const content = await readFile(rootBriefingPath, "utf-8");
    84	    const parsed = parseCardText(content, {
    85	      source: "briefing.briefing.card",
    86	      schemas: await createCardSchemaMap(boxRoot),
    87	    });
    88	    const compiled = compileBriefing(parsed.fields as unknown as BriefingFields);
    89	    const mdPath = join(boxRoot, "briefing.md");
    90	    await writeFile(
    91	      mdPath,
    92	      withDocId({ relativePath: "briefing.md", content: compiled, debug })
    93	    );
    94	    compiledPaths.push("briefing.md");
    95	  } catch (e) {
    96	    // Missing root briefing is normal (skip); a parse error means a malformed
    97	    // card we failed to compile — surface it either way so bad cards aren't silent.
    98	    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    99	      console.warn(`[generate-docs] could not compile ${rootBriefingPath} (absent or malformed):`, e);
   100	    }
   101	  }
   102	
   103	  // TODO: scan subdirectories for directory briefings in the future
   104	  // For now, only the root briefing is supported
   105	
   106	  return compiledPaths;
   107	}
   108	
   109	/**
   110	 * Scan config/*.guide.card, compile each, and generate job-type rules.
   111	 * Also scan per-chat guide cards in store/chat/ directories.
   112	 * Returns summaries of config-level guides (for inclusion in agent guide).
   113	 */
   114	export async function compileGuides(boxRoot: string, debug: boolean): Promise<GuideSummary[]> {
   115	  const rulesDir = join(boxRoot, ".claude/rules");
   116	  await mkdir(rulesDir, { recursive: true });
   117	
   118	  const ctx = { boxRoot, rulesDir, debug };
   119	  const guides = await compileConfigGuides(ctx);
   120	  await compileChatGuides(ctx);

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/schemas/procedure.tsx | sed -n '1,180p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
nl: callback-box/src/schemas/procedure.tsx: No such file or directory

codex
The “suspected broken” claim is half right and half overstated: landmark parsing does catch-and-continue to empty; procedure docs catch too, but they do not silently become empty, they emit placeholder entries with warnings. I’ll check the actual schema files next to confirm the cards are frontmatter-only.
exec
/opt/homebrew/bin/bash -lc "ls callback-box/src/schemas | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/schemas/procedure.ts | sed -n '1,200p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/schemas/landmark.ts | sed -n '1,240p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
audio.tsx
briefing.tsx
calendar-review-job.tsx
capture-session.tsx
chat-job.ts
chat-thread.ts
commentary.tsx
doc.tsx
email-message.tsx
email-outbound.tsx
email-thread.tsx
extfile.tsx
feedback.tsx
file.tsx
gdoc.tsx
guide-compile.tsx
guide-elements.tsx
guide-parse.tsx
guide-templates.tsx
guide.tsx
image.tsx
index.ts
intake-job.tsx
landmark.ts
memo.ts
person.tsx
personality-compile.ts
personality-fields.ts
personality-instructions.ts
personality-template.ts
personality.tsx
procedure-run.ts
procedure.ts
question-followup-job.ts
question.ts
recipe.tsx
record.tsx
registry.ts
scheduled-script-duration.ts
scheduled-script.tsx
sheet.tsx
telegram-message.ts
templates-builtins.ts
templates-describe.ts
templates-registry.ts
templates.ts
todo-list.ts
webpage.tsx

 succeeded in 0ms:
     1	/**
     2	 * Procedure definition card schema (Phase-2 frontmatter, no body).
     3	 *
     4	 * Defines the structure of procedure definition cards in config/procedures/.
     5	 * A procedure is a sequence of steps, each with optional precheck, run, and
     6	 * validate phases. Each phase groups its shell commands, agent prompts,
     7	 * instructions, and whys by kind (the engine runs them grouped, not
     8	 * interleaved), which is why flat YAML fits.
     9	 */
    10	
    11	import { splitCardContent, cardSchema, type CardSchema } from "../cards/index.js";
    12	import { parse as parseYaml } from "yaml";
    13	import { z } from "zod";
    14	
    15	/** Run-expiry value: a duration like "30d"/"12w", or "never". */
    16	const RunExpiryValue = z.union([
    17	  z.literal("never"),
    18	  z.string().regex(/^\d+\.?\d*\s*[dhmsw]$/, 'duration like "30d", or "never"'),
    19	]);
    20	
    21	/** Agent invocation: a Claude Code prompt with optional model/turn cap. */
    22	export const ProcedureAgent = z.object({
    23	  prompt: z.string(),
    24	  model: z.enum(["haiku", "sonnet", "opus"]).optional(),
    25	  "max-turns": z.number().optional(),
    26	});
    27	
    28	const phaseFields = {
    29	  shells: z.array(z.string()).optional(),
    30	  agents: z.array(ProcedureAgent).optional(),
    31	  instructions: z.array(z.string()).optional(),
    32	  whys: z.array(z.string()).optional(),
    33	};
    34	
    35	/** Precheck phase — gates whether a step runs. */
    36	export const ProcedurePrecheck = z.object({
    37	  ...phaseFields,
    38	  "pass-output": z.boolean().optional(),
    39	});
    40	
    41	/** Run phase — the step's main action. */
    42	export const ProcedureRun = z.object(phaseFields);
    43	
    44	/** Validate phase — checks results after the run. */
    45	export const ProcedureValidate = z.object({
    46	  ...phaseFields,
    47	  severity: z.enum(["warn", "review", "abort"]).optional(),
    48	});
    49	
    50	/** One step. */
    51	export const ProcedureStep = z.object({
    52	  id: z.string(),
    53	  description: z.string().optional(),
    54	  precheck: ProcedurePrecheck.optional(),
    55	  run: ProcedureRun.optional(),
    56	  validate: ProcedureValidate.optional(),
    57	});
    58	
    59	const procedureFields = {
    60	  name: z.string(),
    61	  description: z.string().optional(),
    62	  "run-expiry": RunExpiryValue.optional(),
    63	  "failed-run-expiry": RunExpiryValue.optional(),
    64	  steps: z.array(ProcedureStep),
    65	};
    66	
    67	export const ProcedureSchema: CardSchema = cardSchema("procedure", {
    68	  searchable: false,
    69	  fields: procedureFields,
    70	  instructions: `# Handling Procedure Definitions
    71	
    72	Procedure cards are declarative definitions — they describe WHAT should happen, not track execution. Execution state lives in a separate procedure-run card.
    73	
    74	Don't modify a procedure card while a run is active. The engine reads the definition at run start. Changes during execution won't be picked up and may cause confusion.
    75	
    76	Each entry in \`steps\` has optional phases: \`precheck\` (should this step run?), \`run\` (the main action), \`validate\` (did it work?). Each phase groups its actions by kind:
    77	
    78	- \`shells:\` — a list of bash commands run in the box root.
    79	- \`agents:\` — a list of \`{ prompt, model?, max-turns? }\` Claude Code invocations.
    80	- \`instructions:\` — a list of natural-language pass/fail judgments evaluated by a model.
    81	- \`whys:\` — a list of explanations (for humans, fixing agents, and review models).
    82	
    83	Use YAML block scalars (\`|\`) for multi-line shell scripts and agent prompts so indentation is preserved. \`precheck.pass-output: true\` passes precheck stdout into the run phase; \`validate.severity\` is one of warn/review/abort.
    84	
    85	Optional \`run-expiry\` / \`failed-run-expiry\` override how long this procedure's finished run dirs are kept before \`cb procedure gc\` deletes them (defaults: 30d completed, 90d failed). Value is a duration ("60d", "12w") or "never".`,
    86	});
    87	
    88	const ProcedureObject = z.object(procedureFields);
    89	export type ProcedureFields = z.infer<typeof ProcedureObject>;
    90	export type ProcedureStepDef = z.infer<typeof ProcedureStep>;
    91	/** Back-compat alias for the procedure-definition fields type. */
    92	export type Procedure = ProcedureFields;
    93	
    94	/**
    95	 * Parse a procedure card's raw text into typed fields, or null if it has
    96	 * no frontmatter or fails validation. Used by the engine to load a
    97	 * definition without going through the full card loader.
    98	 */
    99	export function parseProcedureDefinition(content: string): ProcedureFields | null {
   100	  const split = splitCardContent(content);
   101	  if (!split.hasFrontmatter) return null;
   102	  let fm: unknown;
   103	  try {
   104	    fm = parseYaml(split.frontmatterText);
   105	  } catch (_e) {
   106	    return null;
   107	  }
   108	  const parsed = ProcedureObject.safeParse(fm ?? {});
   109	  if (!parsed.success) return null;
   110	  return parsed.data;
   111	}

 succeeded in 0ms:
     1	/**
     2	 * Landmark card schema — a hand-curated bookmark for a directory.
     3	 *
     4	 * One landmark per directory; the file lives inside the directory it
     5	 * describes (e.g. `store/recipes/Recipes.landmark.card`). A landmark is
     6	 * pure structured metadata (YAML frontmatter, no body) carrying one or
     7	 * more *roles*:
     8	 *
     9	 *   ---
    10	 *   navigation:                      # human-facing surface
    11	 *     label: Recipes
    12	 *     symbol: 🍳
    13	 *     links:
    14	 *       - { ref: Bread.recipe.card, label: the bread }
    15	 *     expand:
    16	 *       - { query: "*.recipe.card", order: modified-desc }
    17	 *   destinations:                    # filing targets
    18	 *     - for: [triage]
    19	 *       rules: "Recipes — anything describing how to cook a dish."
    20	 *       procedure-ref: archive-recipe.procedure.card
    21	 *   ---
    22	 *
    23	 * At least one role should be present; a landmark with neither is inert.
    24	 * See docs/landmarks.md and docs/plans/triage-design.md.
    25	 */
    26	
    27	import { splitCardContent, cardSchema, type CardSchema } from "../cards/index.js";
    28	import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
    29	import { z } from "zod";
    30	
    31	/** Sort order for `expand` fan-out results. */
    32	export const LandmarkOrder = z.enum(["alphabetical", "modified-desc", "modified-asc"]);
    33	export type LandmarkOrderType = z.infer<typeof LandmarkOrder>;
    34	
    35	/**
    36	 * The iconic mark for a landmark. Either an emoji / short text, or an
    37	 * image (`{ src }`, a path relative to the landmark's directory).
    38	 */
    39	export const LandmarkSymbol = z.union([z.string(), z.object({ src: z.string() })]);
    40	export type LandmarkSymbolData = z.infer<typeof LandmarkSymbol>;
    41	
    42	/**
    43	 * A pinned reference to another card. `ref` is a literal path relative to
    44	 * the landmark's directory, validated like any other ref. `label` is an
    45	 * optional display label (falls back to the target's filename title).
    46	 */
    47	export const LandmarkLink = z.object({
    48	  ref: z.string(),
    49	  label: z.string().optional(),
    50	});
    51	export type LandmarkLinkData = z.infer<typeof LandmarkLink>;
    52	
    53	/**
    54	 * Templated fan-out. Runs `query` (a glob, relative to the landmark's
    55	 * directory) and emits one link per match.
    56	 *
    57	 * `template-ref` / `template-label` are placeholder strings substituted
    58	 * per match: `${path}` is the matched card's path (relative to the
    59	 * landmark dir); any other `${field}` reads that field from the matched
    60	 * card's frontmatter (dotted paths allowed, e.g. `${exif.camera}`).
    61	 * When omitted, `template-ref` defaults to `${path}`.
    62	 */
    63	export const LandmarkExpand = z.object({
    64	  query: z.string(),
    65	  order: LandmarkOrder.optional(),
    66	  "template-ref": z.string().optional(),
    67	  "template-label": z.string().optional(),
    68	});
    69	export type LandmarkExpandData = z.infer<typeof LandmarkExpand>;
    70	
    71	/**
    72	 * Chat-feature seed for chats opened from this landmark. Each key is a
    73	 * feature name; only applied at session open.
    74	 */
    75	export const LandmarkChatApp = z.object({
    76	  narration: z.enum(["on", "off"]).optional(),
    77	  prose: z.enum(["on", "off"]).optional(),
    78	});
    79	export type LandmarkChatAppData = z.infer<typeof LandmarkChatApp>;
    80	
    81	/**
    82	 * Human-facing navigation role: the bookmark surface shown on the
    83	 * Landmarks page.
    84	 */
    85	export const LandmarkNavigation = z.object({
    86	  label: z.string().optional(),
    87	  symbol: LandmarkSymbol.optional(),
    88	  links: z.array(LandmarkLink).optional(),
    89	  expand: z.array(LandmarkExpand).optional(),
    90	  "chat-app": LandmarkChatApp.optional(),
    91	});
    92	export type LandmarkNavigationData = z.infer<typeof LandmarkNavigation>;
    93	
    94	/**
    95	 * Filing-target role: marks the landmark's directory as a destination for
    96	 * one or more *kinds* of content. `for` lists the kinds (e.g. `triage`,
    97	 * `commentary`). `rules`/`procedure-ref` are only meaningful when `for`
    98	 * includes `triage`.
    99	 */
   100	export const LandmarkDestination = z.object({
   101	  for: z.array(z.string()),
   102	  rules: z.string().optional(),
   103	  "procedure-ref": z.string().optional(),
   104	});
   105	export type LandmarkDestinationData = z.infer<typeof LandmarkDestination>;
   106	
   107	const landmarkFields = {
   108	  navigation: LandmarkNavigation.optional(),
   109	  destinations: z.array(LandmarkDestination).optional(),
   110	};
   111	
   112	/**
   113	 * Standalone object schema for the landmark frontmatter, used by
   114	 * lightweight readers (the landmarks router, triage-instructions, etc.)
   115	 * that parse a landmark file directly rather than through the card
   116	 * loader. Unknown keys (global card fields, a stray `type:`) are stripped.
   117	 */
   118	const LandmarkObject = z.object(landmarkFields);
   119	export type LandmarkFields = z.infer<typeof LandmarkObject>;
   120	
   121	export const LandmarkSchema: CardSchema = cardSchema("landmark", {
   122	  fields: landmarkFields,
   123	  searchable: false,
   124	  instructions: `# Landmark Cards
   125	
   126	A landmark marks a directory as a notable spot in the box — a hand-curated bookmark that can also be a triage destination. One per directory; the file lives inside the directory it describes, e.g. \`store/recipes/Recipes.landmark.card\`. Directories without a landmark are invisible to the Landmarks page and to triage.
   127	
   128	A landmark is pure YAML frontmatter (no body) with one or more roles. At least one role should be present.
   129	
   130	## \`navigation\` (human-facing surface)
   131	
   132	\`\`\`yaml
   133	navigation:
   134	  label: Recipes            # short bookmark name; treat like a tab name, not a sentence
   135	  symbol: 🍳                # emoji/short text, OR { src: images/portrait.webp } for an image
   136	  links:                    # optional curated links to other cards
   137	    - ref: Bread.recipe.card  # literal path relative to the landmark's directory; validated
   138	      label: the bread        # optional; falls back to the target's filename title
   139	  expand:                   # optional templated fan-out
   140	    - query: "*.recipe.card"  # glob, like cb ls
   141	      order: modified-desc    # alphabetical (default) | modified-desc | modified-asc
   142	  chat-app:                 # optional chat-feature seed for chats opened here
   143	    narration: "on"
   144	    prose: "off"
   145	\`\`\`
   146	
   147	In an \`expand\`, \`template-ref\` / \`template-label\` are placeholder strings substituted per match: \`\${path}\` is the matched card's path, any other \`\${field}\` reads that field from the matched card's frontmatter. When omitted, \`template-ref\` defaults to \`\${path}\`.
   148	
   149	**Don't add a description or purpose field.** A bookmark seen many times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs prose, write a doc card and link to it.
   150	
   151	## \`destinations\` (agent-facing filing targets)
   152	
   153	\`\`\`yaml
   154	destinations:
   155	  - for: [triage]           # kinds: triage (inbox→triage routing target) and/or commentary
   156	    rules: "Recipes — anything describing how to cook a dish."  # read by the triage agent
   157	    procedure-ref: archive-recipe.procedure.card                # handler run at the handle stage
   158	  - for: [commentary]       # a commentary-only spot needs neither rules nor procedure-ref
   159	\`\`\`
   160	
   161	A pure routing target (an archive humans don't browse) can have only \`destinations\`; a pure bookmark can have only \`navigation\`.
   162	
   163	**Dedup**: a card appearing in both a hand-listed \`links\` entry and an \`expand\` result shows once — hand-listed links come first.`,
   164	});
   165	
   166	export type Landmark = LandmarkFields;
   167	
   168	/**
   169	 * Parse a landmark card's raw text into its typed frontmatter, or null if
   170	 * it has no frontmatter or fails validation. Used by readers that scan
   171	 * landmark files directly (the landmarks router, triage-instructions,
   172	 * list-destinations, feature seeds) instead of going through the card
   173	 * loader.
   174	 */
   175	export function parseLandmarkFields(content: string): LandmarkFields | null {
   176	  const split = splitCardContent(content);
   177	  if (!split.hasFrontmatter) return null;
   178	  let fm: unknown;
   179	  try {
   180	    fm = parseYaml(split.frontmatterText);
   181	  } catch (_e) {
   182	    return null;
   183	  }
   184	  const parsed = LandmarkObject.safeParse(fm ?? {});
   185	  if (!parsed.success) return null;
   186	  return parsed.data;
   187	}
   188	
   189	/**
   190	 * Template for `cb create` — produces a starter landmark with a
   191	 * `navigation` role containing label + symbol.
   192	 *
   193	 * Pass `symbol` for an emoji/text symbol, or `symbolSrc` for an image
   194	 * path (relative to the landmark's directory).
   195	 */
   196	export function createLandmarkTemplate(options: {
   197	  label: string;
   198	  symbol?: string;
   199	  symbolSrc?: string;
   200	}): string {
   201	  const navigation: Record<string, unknown> = { label: options.label };
   202	  if (typeof options.symbolSrc === "string" && options.symbolSrc !== "") {
   203	    navigation.symbol = { src: options.symbolSrc };
   204	  } else if (typeof options.symbol === "string" && options.symbol !== "") {
   205	    navigation.symbol = options.symbol;
   206	  }
   207	  const yamlText = stringifyYaml({ navigation });
   208	  return `---\n${yamlText}---\n`;
   209	}

exec
/opt/homebrew/bin/bash -lc "rg -n \"landmark\\.card|procedure\\.card|content-type: application/x-card\\+xml|<landmark|<procedure|type: landmark|navigation:|name:|description:\" callback-box/test callback-box/docs callback-box/src -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/docs/design-card-views.md:60:  name: string;
callback-box/docs/design-card-views.md:140:  { name: "Source", Component: SourceView, priority: 0 },
callback-box/docs/design-card-views.md:145:  { name: "XML", Component: XmlView, priority: 10 },
callback-box/docs/design-card-views.md:150:  { name: "Card Tree", Component: CardTreeView, priority: 20 },
callback-box/docs/design-card-views.md:155:  { name: "Audio", Component: AudioPlayer, priority: 30 },
callback-box/docs/design-card-views.md:160:  { name: "Recipe", Component: RecipeDetailView, priority: 100 },
callback-box/docs/design-card-views.md:164:  { name: "Timeline", Component: CaptureTimelineView, priority: 100 },
callback-box/docs/design-card-views.md:740:  name: string;
callback-box/docs/design-card-views.md:754:    description: text("description"),
callback-box/docs/design-card-views.md:771:    name: el.attrs.name,
callback-box/docs/design-card-views.md:774:      name: ing.text?.trim() ?? "",
callback-box/src/types/views.ts:100:  name: string;
callback-box/src/types/views.ts:102:  description: string;
callback-box/src/services/CLAUDE.md:42:- **Fakes are domain-specific**, not generic `Partial<T>` overrides. Constructor params reflect what the service needs to function (e.g. `createFakeTelegram({ username: "bot" })` requires a username because `getMe()` returns it).
callback-box/src/services/CLAUDE.md:66:const tg = withCallLog(createFakeTelegram({ username: "bot" }));
callback-box/src/services/CLAUDE.md:100:const tg = createFakeTelegram({ username: "my_bot" });
callback-box/src/scenario/runner.ts:49:  name: string;
callback-box/src/scenario/runner.ts:62:  name: string;
callback-box/src/scenario/runner.ts:122:    const agent = createAgent({ name: "scenario-validator" });
callback-box/src/scenario/runner.ts:161:    return { name: step.name, status: "passed", validations };
callback-box/src/scenario/runner.ts:172:      name: step.name,
callback-box/src/scenario/runner.ts:191:      return { name: step.name, status: "failed", validations };
callback-box/src/scenario/runner.ts:203:  return { name: step.name, status: "passed", validations };
callback-box/src/scenario/runner.ts:299:      stepResults.push({ name: step.name, status: "skipped", validations: [] });
callback-box/src/scenario/runner.ts:304:      stepResults.push({ name: step.name, status: "skipped", validations: [] });
callback-box/src/services/call-log.ts:5: *   const telegram = withCallLog(createFakeTelegram({ username: "bot" }));
callback-box/test/service-openai-audio.doctest.md:27:await svc.transcribe(Buffer.from("data"), { filename: "test.webm", prompt: "English" });
callback-box/src/lib/attach-lint.ts:62:  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
callback-box/test/intake-utils.doctest.md:20:  description: "Triage 1 item",
callback-box/test/intake-utils.doctest.md:34:description: Triage 1 item
callback-box/test/intake-utils.doctest.md:54:  description: "Triage 1 item",
callback-box/test/intake-utils.doctest.md:60:  description: "Triage 2 items",
callback-box/test/intake-utils.doctest.md:66:The updated file contains both items with the new description:
callback-box/test/intake-utils.doctest.md:76:description: Triage 2 items
callback-box/test/intake-utils.doctest.md:97:  description: "From A",
callback-box/test/intake-utils.doctest.md:103:  description: "From B",
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:282:>   name: "task",
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:283:>   description: "A task card",
callback-box/test/routes-admin.doctest.md:144:  services: { telegram: createFakeTelegram({ username: "test_bot" }) },
callback-box/test/routes-admin.doctest.md:160:const tg = createFakeTelegram({ username: "my_bot", firstName: "MyBot" });
callback-box/test/routes-admin.doctest.md:189:const tg = createFakeTelegram({ username: "new_bot", firstName: "NewBot" });
callback-box/test/routes-admin.doctest.md:227:  services: { telegram: createFakeTelegram({ username: "bot" }) },
callback-box/test/routes-admin.doctest.md:245:const tg = createFakeTelegram({ username: "bot" });
callback-box/src/scenario/types.ts:6:  name: string;
callback-box/src/scenario/types.ts:19:  name: string;
callback-box/src/scenario/types.ts:20:  description: string;
callback-box/src/services/google-drive-types.ts:11:  name: string;
callback-box/src/scenario/loader.ts:37:export function getScenarioDir(name: string): string {
callback-box/src/scenario/loader.ts:44:export function getBoxRoot(name: string): string {
callback-box/src/scenario/loader.ts:79:export async function loadScenario(name: string): Promise<ScenarioDefinition> {
callback-box/src/scenario/loader.ts:95:export async function loadStubs(name: string): Promise<StubsDefinition | null> {
callback-box/src/services/google-gmail.ts:20:  name: string;
callback-box/src/services/google-gmail.ts:57:  name: string;
callback-box/docs/landmarks.md:15:- **Singular per directory.** One `*.landmark.card` per opted-in directory. Directories without one are invisible to the navigation surface — that's the point.
callback-box/docs/landmarks.md:37:navigation:
callback-box/docs/landmarks.md:128:A new top-level page at `/<box>/landmarks`. Lists every `**/*.landmark.card` in the box as a flat grid of tiles. Click-through opens the landmark's full form; from there, click any referenced card to view it.
callback-box/test/file-lock.doctest.md:31:print(`hostname: ${holder.hostname === os.hostname()}`);
callback-box/test/file-lock.doctest.md:36:hostname: true
callback-box/test/file-lock.doctest.md:111:  hostname: os.hostname(),
callback-box/test/file-lock.doctest.md:138:  hostname: os.hostname(),
callback-box/test/file-lock.doctest.md:198:  hostname: "some-other-machine",
callback-box/test/file-lock.doctest.md:223:  hostname: os.hostname(),
callback-box/test/file-lock.doctest.md:277:  hostname: os.hostname(),
callback-box/test/file-lock.doctest.md:305:  hostname: os.hostname(),
callback-box/test/file-lock.doctest.md:371:  hostname: os.hostname(),
callback-box/test/move-command.doctest.md:112:await box.write("box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
callback-box/test/move-command.doctest.md:218:await box.write("box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
callback-box/src/lib/file-lock.ts:73:  hostname: string;
callback-box/src/lib/file-lock.ts:118:    hostname: os.hostname(),
callback-box/test/telegram-output-cards.doctest.md:32:const tg = createFakeTelegram({ username: "test_bot" });
callback-box/test/telegram-output-cards.doctest.md:70:const tg = createFakeTelegram({ username: "test_bot" });
callback-box/src/services/google-drive.ts:15:  name: string;
callback-box/test/wakeup-helpers.doctest.md:166:const fakeGmail = { name: "gmail", inboxPaths: ["box/inbox/email"] };
callback-box/test/service-telegram.doctest.md:15:const tg = createFakeTelegram({ username: "test_bot" });
callback-box/test/service-telegram.doctest.md:26:const tg = createFakeTelegram({ username: "bot" });
callback-box/test/service-telegram.doctest.md:45:const tg = createFakeTelegram({ username: "bot" });
callback-box/test/service-telegram.doctest.md:58:  username: "bot",
callback-box/test/service-telegram.doctest.md:83:  username: "bot",
callback-box/test/service-telegram.doctest.md:103:const tg = createFakeTelegram({ username: "bot" });
callback-box/test/service-telegram.doctest.md:134:const tg = withCallLog(createFakeTelegram({ username: "bot" }));
callback-box/src/lib/filename.ts:34:export function splitExtension(filename: string): { stem: string; ext: string } {
callback-box/src/lib/filename.ts:45:  filename: string,
callback-box/src/schemas/guide-parse.tsx:39:      name: a.name,
callback-box/src/services/telegram.ts:21:      first_name: string;
callback-box/src/services/telegram.ts:42:  username: string;
callback-box/src/services/telegram.ts:43:  first_name: string;
callback-box/src/services/telegram.ts:81:      return { username: me.username, first_name: me.first_name };
callback-box/src/services/telegram.ts:108:  username: string;
callback-box/src/services/telegram.ts:137:        username: opts.username,
callback-box/src/services/telegram.ts:138:        first_name: opts.firstName ?? opts.username,
callback-box/src/schemas/landmark.ts:5: * describes (e.g. `store/recipes/Recipes.landmark.card`). A landmark is
callback-box/src/schemas/landmark.ts:10: *   navigation:                      # human-facing surface
callback-box/src/schemas/landmark.ts:20: *       procedure-ref: archive-recipe.procedure.card
callback-box/src/schemas/landmark.ts:108:  navigation: LandmarkNavigation.optional(),
callback-box/src/schemas/landmark.ts:126:A landmark marks a directory as a notable spot in the box — a hand-curated bookmark that can also be a triage destination. One per directory; the file lives inside the directory it describes, e.g. \`store/recipes/Recipes.landmark.card\`. Directories without a landmark are invisible to the Landmarks page and to triage.
callback-box/src/schemas/landmark.ts:133:navigation:
callback-box/src/schemas/landmark.ts:157:    procedure-ref: archive-recipe.procedure.card                # handler run at the handle stage
callback-box/src/schemas/landmark.ts:201:  const navigation: Record<string, unknown> = { label: options.label };
callback-box/src/connectors/google-calendar-ics.ts:65:function addStandardOnly(vtimezone: ICAL.Component, opts: { offset: number; name: string }): void {
callback-box/src/connectors/google-calendar-ics.ts:146:    addStandardOnly(vtimezone, { offset: janOffset, name: janName });
callback-box/src/services/openai-audio.ts:56:      const addField = (name: string, value: string) => {
callback-box/test/reactor-integration.doctest.md:42:    name: opts.name,
callback-box/test/reactor-integration.doctest.md:92:    name: opts.name,
callback-box/test/reactor-integration.doctest.md:135:  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
callback-box/test/reactor-integration.doctest.md:164:  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
callback-box/test/reactor-integration.doctest.md:196:    name: opts.name,
callback-box/test/reactor-integration.doctest.md:243:    name: opts.name,
callback-box/test/reactor-integration.doctest.md:281:  hostname: os.hostname(),
callback-box/test/reactor-integration.doctest.md:290:  createAgent: (opts) => createFakeAgent({ name: opts.name, act: async () => ({ success: true }) }),
callback-box/test/reactor-integration.doctest.md:312:  hostname: os.hostname(),
callback-box/test/reactor-integration.doctest.md:324:    name: opts.name,
callback-box/test/reactor-integration.doctest.md:363:    name: opts.name,
callback-box/test/tick-force.doctest.md:28:    description: undefined,
callback-box/test/connector-telegram.doctest.md:23:    from: { id: 1, first_name: "Alice", last_name: "Smith", username: "alice" },
callback-box/test/connector-telegram.doctest.md:57:    from: { id: 1, first_name: "Bob" },
callback-box/test/connector-telegram.doctest.md:79:    from: { id: 10, first_name: "Alice" },
callback-box/test/connector-telegram.doctest.md:125:  username: "test_bot",
callback-box/test/connector-telegram.doctest.md:132:      from: { id: 20, first_name: "Bob" },
callback-box/test/connector-telegram.doctest.md:189:const tg = createFakeTelegram({ username: "test_bot" });
callback-box/src/dev/prompt-report.ts:124:    const procedureFiles = files.filter((f) => f.endsWith(".procedure.card")).toSorted();
callback-box/src/dev/prompt-report.ts:128:      const name = file.replace(".procedure.card", "");
callback-box/src/dev/prompt-report.ts:186:    { name: "Agent System Prompts", prefix: ["Reactor", "Chat", "Commit"] },
callback-box/src/dev/prompt-report.ts:187:    { name: "Job-Specific Prompts", prefix: ["News", "Feedback", "Guide Revision"] },
callback-box/src/dev/prompt-report.ts:188:    { name: "Schema Instructions", prefix: ["Schema:"] },
callback-box/src/dev/prompt-report.ts:189:    { name: "Connector Rules", prefix: ["Connector"] },
callback-box/src/dev/prompt-report.ts:190:    { name: "Procedure Templates", prefix: ["Procedure:"] },
callback-box/src/dev/prompt-report.ts:191:    { name: "Procedure Infrastructure", prefix: ["Procedure Context"] },
callback-box/test/scan-import-helpers.doctest.md:19:    description: `Photo ${index}`,
callback-box/test/scan-import-helpers.doctest.md:37:    description: "",
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:57:>   name: "task",
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:58:>   description: "A task card",
callback-box/src/schemas/guide-elements.tsx:74:  name: z.string(),
callback-box/src/schemas/guide-elements.tsx:168:    name: string;
callback-box/src/connectors/google-calendar-sync.ts:76:  opts: { boxRoot: string; calDir: string; oldName: string | undefined; filename: string; acc: SyncAccumulator },
callback-box/src/connectors/google-calendar-sync.ts:96:    filename: string; localContent: string; existingEntry: string | { calendarId: string };
callback-box/src/connectors/google-calendar-sync.ts:136:    filename: string; relPath: string; calendarId: string; icsOpts: IcsOpts;
callback-box/test/init.doctest.md:90:process-captures.procedure.card
callback-box/test/init.doctest.md:91:process-pages.procedure.card
callback-box/test/init.doctest.md:92:process-retrospective.procedure.card
callback-box/test/init.doctest.md:93:refresh-maps.procedure.card
callback-box/src/connectors/google-calendar-state.ts:23:  filename: string;
callback-box/src/frontend/src/renderers/pdf.tsx:27:  { name: "PDF", Component: PdfRenderer, priority: 30 },
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:30:> There are also `.orig-procedure.card` variants for `process-captures` and `process-news` (likely original/backup versions).
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:46:- Files read: /Users/ianbicking/src/boxes/test1/docs/generated/procedures.md, /Users/ianbicking/src/boxes/test1/config/procedures/process-pages.procedure.card, /Users/ianbicking/src/boxes/test1/docs/generated/card-bookmark.md
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:47:- Searches: Glob: config/procedures/*.procedure.card
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:56:> **1. Create the file** at `config/procedures/process-bookmarks.procedure.card`
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:61:> <procedure name="process-bookmarks">
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:183:> You can also embed a directive in a job card's `<procedure>` element:
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:187:>   <procedure ref="process-news">
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:204:**Watch for:** Describes <procedure ref='...'> in job cards and reactor trampolining
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:218:> A job card can embed a `<procedure>` element that references a procedure by name:
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:223:>   <procedure ref="process-news">
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:230:> When the **reactor** (`cb reactor`) picks up that job, it detects the `<procedure ref="...">` element and runs the procedure engine directly — no nested agent session needed. The job is automatically finished when the procedure completes. If the procedure fails, the job stays in `box/jobs/` for retry.
callback-box/src/schemas/todo-list.ts:18:    name: z.string(),
callback-box/src/schemas/todo-list.ts:28:  name: string;
callback-box/src/schemas/todo-list.ts:38:    name: z.string(),
callback-box/src/schemas/todo-list.ts:53:- \`name:\` — display name for the list
callback-box/src/schemas/todo-list.ts:68:Active todo lists live in \`store/todos/\`. Filename:
callback-box/src/schemas/todo-list.ts:92:  name: string;
callback-box/src/schemas/todo-list.ts:99:  name: string;
callback-box/src/schemas/todo-list.ts:101:  items?: Array<{ name: string; status?: string | undefined }>;
callback-box/src/schemas/todo-list.ts:104:    name: options.name,
callback-box/src/schemas/todo-list.ts:111:      name: it.name,
callback-box/src/frontend/src/pages/BrowsePage.tsx:30:function basenameTitle(filename: string): string {
callback-box/test/helpers/fake-agent.ts:9: *     name: "triage",
callback-box/test/helpers/fake-agent.ts:49:  name: string;
callback-box/test/helpers/fake-agent.ts:70:    name: options.name,
callback-box/src/frontend/src/renderers/image.tsx:26:  filename: string | null;
callback-box/src/frontend/src/renderers/image.tsx:27:  description: string | null;
callback-box/src/frontend/src/renderers/image.tsx:53:    filename: filenameEl ? (filenameEl.attrs.ref as string) : null,
callback-box/src/frontend/src/renderers/image.tsx:54:    description: descEl ? (descEl.text as string) || null : null,
callback-box/src/frontend/src/renderers/image.tsx:149:  name: "Image",
callback-box/src/frontend/src/renderers/image.tsx:171:  { name: "Image", Component: RawImageRenderer, priority: 30 },
callback-box/src/connectors/index.ts:12:  name: string;
callback-box/src/connectors/index.ts:53:export function getConnector(name: string): Connector | undefined {
callback-box/test/landmark-schema.doctest.md:42:navigation:
callback-box/test/landmark-schema.doctest.md:86:navigation:
callback-box/test/landmark-schema.doctest.md:98:navigation:
callback-box/test/landmark-schema.doctest.md:369:navigation:
callback-box/test/landmark-schema.doctest.md:391:const navOnly = parseLandmarkFields("---\nnavigation:\n  label: Just a bookmark\n---\n");
callback-box/src/frontend/src/renderers/builtins.tsx:60:  { name: "XML", Component: XmlRenderer, priority: 10 },
callback-box/src/frontend/src/renderers/builtins.tsx:65:  { name: "Source", Component: SourceRenderer, priority: 10 },
callback-box/src/frontend/src/renderers/builtins.tsx:70:  { name: "Card Tree", Component: TreeRenderer, priority: 20 },
callback-box/src/schemas/intake-job.tsx:20:    description: z.string(),
callback-box/src/schemas/intake-job.tsx:58:  description: string;
callback-box/src/schemas/intake-job.tsx:65:  description: string;
callback-box/src/schemas/intake-job.tsx:74:    description: options.description,
callback-box/test/install-template-file.doctest.md:267:const stale = path.join(subdir, "x.procedure.card");
callback-box/test/install-template-file.doctest.md:283:const stale = path.join(subdir, "old.procedure.card");
callback-box/test/install-template-file.doctest.md:285:await fs.writeFile(path.join(subdir, "fresh.procedure.card"), "fresh\n");
callback-box/test/install-template-file.doctest.md:294:    "config/_template-updates/procedures/old.procedure.card"
callback-box/test/handle.doctest.md:21:  "store/recipes/Recipes.landmark.card",
callback-box/test/handle.doctest.md:23:navigation:
callback-box/test/handle.doctest.md:29:    procedure-ref: archive.procedure.card
callback-box/test/handle.doctest.md:52:    "procedurePath": "store/recipes/archive.procedure.card",
callback-box/test/handle.doctest.md:73:  "store/recipes/Recipes.landmark.card",
callback-box/test/handle.doctest.md:75:navigation:
callback-box/test/handle.doctest.md:80:    procedure-ref: archive.procedure.card
callback-box/test/handle.doctest.md:112:  "store/recipes/Recipes.landmark.card",
callback-box/test/handle.doctest.md:114:navigation:
callback-box/test/handle.doctest.md:119:    procedure-ref: archive.procedure.card
callback-box/test/handle.doctest.md:151:  "store/notes/Notes.landmark.card",
callback-box/test/handle.doctest.md:153:navigation:
callback-box/test/triage.doctest.md:24:  "store/recipes/Recipes.landmark.card",
callback-box/test/triage.doctest.md:26:navigation:
callback-box/test/triage.doctest.md:32:    procedure-ref: archive-recipe.procedure.card
callback-box/test/triage.doctest.md:37:  "store/todos/Todos.landmark.card",
callback-box/test/triage.doctest.md:39:navigation:
callback-box/test/triage.doctest.md:49:  "store/bookmarks/Bookmarks.landmark.card",
callback-box/test/triage.doctest.md:51:navigation:
callback-box/test/triage.doctest.md:59:JSON.stringify(categories.map((c) => ({ name: c.name, dir: c.dir, rules: c.rules })), null, 2)
callback-box/test/triage.doctest.md:88:  "store/recipes/Recipes.landmark.card",
callback-box/test/triage.doctest.md:90:navigation:
callback-box/test/triage.doctest.md:136:  "store/recipes/Recipes.landmark.card",
callback-box/test/triage.doctest.md:138:navigation:
callback-box/test/triage.doctest.md:179:  "store/recipes/Recipes.landmark.card",
callback-box/test/triage.doctest.md:181:navigation:
callback-box/test/triage.doctest.md:191:  "store/todos/Todos.landmark.card",
callback-box/test/triage.doctest.md:193:navigation:
callback-box/test/helpers/fixture-replay.ts:43:  recordOrReplay<T>(name: string, producer: () => Promise<T>): Promise<T>;
callback-box/test/helpers/fixture-replay.ts:54:  hasFixture(name: string): Promise<boolean>;
callback-box/test/helpers/fixture-replay.ts:75:    async recordOrReplay<T>(name: string, producer: () => Promise<T>): Promise<T> {
callback-box/test/helpers/fixture-replay.ts:102:    async hasFixture(name: string): Promise<boolean> {
callback-box/src/frontend/src/pages/BoxSelection.tsx:38:  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
callback-box/src/frontend/src/pages/BoxSelection.tsx:102:  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
callback-box/src/frontend/src/renderers/index.ts:45:  name: string;
callback-box/test/asset-manifest-scan.doctest.md:140:print(`error name: ${r.errors[0].name}`);
callback-box/test/asset-manifest-scan.doctest.md:145:error name: photo.jpg
callback-box/src/schemas/image.tsx:77:    filename: FilenameEntry,
callback-box/src/schemas/image.tsx:78:    description: z.string().optional(),
callback-box/src/schemas/image.tsx:93:- \`filename:\` — \`{ref, captured, source}\` for the attached image
callback-box/src/schemas/image.tsx:95:- \`description:\` — one sentence describing what the image *looks
callback-box/src/schemas/image.tsx:138:  filename: { ref: string; captured: string; source: ImageSource };
callback-box/src/schemas/image.tsx:193:  filename: string;
callback-box/src/schemas/image.tsx:197:    filename: {
callback-box/test/schedule-health.doctest.md:26:    name: "demo",
callback-box/test/routes-commands.doctest.md:28:Each command has a name and description:
callback-box/src/dev/lib/test-runner.ts:156:    name: "knowledge-audit",
callback-box/src/frontend/src/renderers/recipe.tsx:12:  name: "Recipe",
callback-box/src/connectors/telegram.ts:223:          description: `New messages in ${slug}`,
callback-box/src/connectors/telegram.ts:305:          description: `Callback timer for ${slug}`,
callback-box/src/connectors/telegram.ts:395:      description: `New messages in ${slug}`,
callback-box/src/dev/knowledge-audits.yaml:297:    watch_for: "Describes <procedure ref='...'> in job cards and reactor trampolining"
callback-box/src/schemas/chat-thread.ts:43:    description: z.string().optional(),
callback-box/src/schemas/chat-thread.ts:55:- \`description:\` — what this chat is (e.g. "Family group chat")
callback-box/test/calendar-utils.doctest.md:44:const events = parseIcsContent(simpleIcs, { filename: "test.ics" });
callback-box/test/calendar-utils.doctest.md:72:const ev = parseIcsContent(allDayIcs, { filename: "holiday.ics" })[0];
callback-box/test/calendar-utils.doctest.md:95:parseIcsContent(cancelledIcs, { filename: "cancelled.ics" }).length
callback-box/test/calendar-utils.doctest.md:116:const meta = parseIcsContent(metaIcs, { filename: "play.ics" })[0];
callback-box/test/calendar-utils.doctest.md:141:    filename: "test.ics",
callback-box/test/calendar-utils.doctest.md:168:A subscribed calendar event shows the calendar name:
callback-box/test/calendar-utils.doctest.md:178:formatEvent(makeEvent({ summary: "Offsite", location: "HQ", description: "Bring laptop" }))
callback-box/src/frontend/src/renderers/markdown-card.tsx:14:  { name: "Card", Component: MarkdownCardView, priority: 30 },
callback-box/src/dev/lib/session-report.ts:27:  description: string;
callback-box/src/dev/lib/session-report.ts:122:        description: describeToolCall(block.name, input),
callback-box/src/dev/lib/session-report.ts:170:function describeToolCall(name: string, input: Record<string, unknown>): string {
callback-box/test/chat-task-events.doctest.md:24:const m = task({ subtype: "task_started", task_id: "t1", tool_use_id: "tool1", description: "Generate image" });
callback-box/test/chat-task-events.doctest.md:35:task({ subtype: "task_started", task_id: "t2", description: "housekeeping", skip_transcript: true })
callback-box/test/chat-task-events.doctest.md:42:const m = task({ subtype: "task_progress", task_id: "t1", description: "Generate image", last_tool_name: "Bash", usage: { total_tokens: 10, tool_uses: 2, duration_ms: 4200 } });
callback-box/test/chat-task-events.doctest.md:67:const m = task({ subtype: "task_updated", task_id: "t1", patch: { status: "running", description: "still going" } });
callback-box/test/chat-task-events.doctest.md:79:tasks = applyTaskEvent(tasks, { phase: "started", taskId: "t1", description: "Generate image", status: "running" });
callback-box/src/frontend/src/renderers/binary.tsx:58:  { name: "Download", Component: BinaryRenderer, priority: 2 },
callback-box/src/connectors/chat-utils.ts:75:      ...(options.description != null ? { description: options.description } : {}),
callback-box/src/connectors/chat-utils.ts:210:  description: string;
callback-box/src/connectors/chat-utils.ts:272:    const cardYaml = `status: active\nname: ${displayName}\n`;
callback-box/test/tours/nav-pages.tour.ts:23:  { name: "nav-pages", description: "Walk every routed page in the primary nav and capture artifacts." },
callback-box/src/schemas/templates-describe.ts:58:export function describeTemplateArgs(name: string): string {
callback-box/src/frontend/src/renderers/commentary.tsx:12:  name: "Commentary",
callback-box/test/connector-drive-docs.doctest.md:66:    name: "Project Notes",
callback-box/test/connector-drive-docs.doctest.md:145:    name: "Reviewed Doc",
callback-box/test/connector-drive-docs.doctest.md:198:    name: "Editable",
callback-box/test/connector-drive-docs.doctest.md:259:    name: "Contended",
callback-box/test/connector-drive-docs.doctest.md:350:    name: "Degraded",
callback-box/src/dev/doc-graph-html-data.ts:19:  name: string;
callback-box/src/dev/doc-graph-html-data.ts:32:    name: "Cards",
callback-box/src/dev/doc-graph-html-data.ts:47:    name: "Connectors",
callback-box/src/dev/doc-graph-html-data.ts:64:    name: "Wakeup & Reactor",
callback-box/src/dev/doc-graph-html-data.ts:78:    name: "Procedures",
callback-box/src/dev/doc-graph-html-data.ts:89:    name: "Frontend",
callback-box/src/dev/doc-graph-html-data.ts:105:    name: "Testing",
callback-box/src/dev/doc-graph-html-data.ts:120:    name: "Boxes",
callback-box/src/dev/doc-graph-html-data.ts:133:    name: "Deploy & Ops",
callback-box/src/dev/doc-graph-html-data.ts:225:  name: string;
callback-box/src/dev/doc-graph-html-data.ts:233:    name: "Always in the room",
callback-box/src/dev/doc-graph-html-data.ts:239:    name: "On the way in",
callback-box/src/dev/doc-graph-html-data.ts:245:    name: "One link away",
callback-box/src/dev/doc-graph-html-data.ts:251:    name: "Two links away",
callback-box/src/dev/doc-graph-html-data.ts:257:    name: "Out in the field",
callback-box/test/schedule-health-alert.doctest.md:48:await checkHealthAndAlert(box.root, { now: NOW, tg: createFakeTelegram({ username: "bot" }) })
callback-box/test/schedule-health-alert.doctest.md:69:const tg = createFakeTelegram({ username: "bot" });
callback-box/src/connectors/intake-utils.ts:33:  description: string;
callback-box/src/connectors/intake-utils.ts:52:      description: opts.description,
callback-box/src/connectors/intake-utils.ts:68:    description: opts.description,
callback-box/src/connectors/intake-utils.ts:98:    description: opts.description,
callback-box/src/connectors/intake-utils.ts:159:  opts: { items: string[]; description: string }
callback-box/test/tours/browse-walk.tour.ts:10:  { name: "browse-walk", description: "Open the browse tree, drill down into box/inbox, then into email/." },
callback-box/test/tours/browse-walk.tour.ts:16:    await t.click({ role: "button", name: "box directory, 3357 items" });
callback-box/test/service-google-gmail.doctest.md:46:        headers: [{ name: "Subject", value: "Hi" }],
callback-box/test/service-google-gmail.doctest.md:90:    { id: "INBOX", name: "INBOX", type: "system" },
callback-box/test/service-google-gmail.doctest.md:91:    { id: "Label_1", name: "Work", type: "user" },
callback-box/src/frontend/src/renderers/directory.tsx:32:  name: string;
callback-box/src/frontend/src/renderers/directory.tsx:163:  { name: "Directory", Component: DirectoryRenderer, priority: 60 },
callback-box/src/connectors/gmail-threads.ts:94:  bodyFilename: string,
callback-box/src/connectors/gmail-threads.ts:125:}): Promise<{ created: string[]; cardFilename: string }> {
callback-box/src/connectors/gmail-threads.ts:176:  cardFilename: string;
callback-box/src/connectors/gmail-threads.ts:263:    cardFilename: actualCardFilename,
callback-box/src/frontend/src/pages/capture-api.ts:49:  filename: string;
callback-box/test/tours/capture.tour.ts:10:  { name: "capture", description: "Load the capture page in its camera-off state and capture artifacts." },
callback-box/test/service-call-log.doctest.md:77:  name: "test-service",
callback-box/test/contains-state.doctest.md:126:  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: " + desc + "\n---\n";
callback-box/src/frontend/src/renderers/plaintext.tsx:36:  { name: "Plaintext", Component: PlaintextRenderer, priority: 1 },
callback-box/test/card-lint.doctest.md:81:  "---\ncontent-type: application/x-card+xml\n---\n<email-message message-id=\"m1\" thread-id=\"t1\"><from>a@x</from><date>2026-02-15T10:00:00Z</date><subject>hi</subject><body-file>attach/msg-001.body.txt</body-file></email-message>\n",
callback-box/test/card-lint.doctest.md:238:  "---\ntype: person\nname: Dana\n---\n",
callback-box/test/card-lint.doctest.md:259:  "---\ncontent-type: application/x-card+xml\n---\n<memo status=\"new\"/>\n",
callback-box/test/tours/dashboard.tour.ts:9:  { name: "dashboard", description: "Walk the dashboard and follow Browse from the primary nav." },
callback-box/test/tours/dashboard.tour.ts:18:    await t.click({ role: "link", name: "Browse" });
callback-box/src/schemas/recipe.tsx:23:    description: z.string().optional(),
callback-box/src/schemas/recipe.tsx:37:- \`description:\` — optional prose.
callback-box/test/procedure-agent.doctest.md:20:await box.write("config/procedures/agent-test.procedure.card", `---
callback-box/test/procedure-agent.doctest.md:21:name: agent-test
callback-box/test/procedure-agent.doctest.md:22:description: Test agent injection
callback-box/test/procedure-agent.doctest.md:25:    description: An agent does work
callback-box/test/procedure-agent.doctest.md:44:    name: opts.name,
callback-box/test/procedure-agent.doctest.md:95:await box.write("config/procedures/directed.procedure.card", `---
callback-box/test/procedure-agent.doctest.md:96:name: directed
callback-box/test/procedure-agent.doctest.md:97:description: Directive test
callback-box/test/procedure-agent.doctest.md:100:    description: Do work
callback-box/test/procedure-agent.doctest.md:111:    name: opts.name,
callback-box/test/procedure-agent.doctest.md:143:await box.write("config/procedures/messy.procedure.card", `---
callback-box/test/procedure-agent.doctest.md:144:name: messy
callback-box/test/procedure-agent.doctest.md:145:description: Agent forgets to commit
callback-box/test/procedure-agent.doctest.md:148:    description: Agent leaves uncommitted changes
callback-box/test/procedure-agent.doctest.md:158:  name: opts.name,
callback-box/test/reactor.doctest.md:159:await box.write("box/jobs/y1.intake.job.card", "---\nstatus: pending\ncreated: 2026-06-09T00:00:00Z\nsource: gmail\npriority: low\ndescription: Triage 1 inbox item\nitems:\n  - ref: box/inbox/a.memo.card\n---\n");
callback-box/test/reactor.doctest.md:160:await box.write("box/jobs/y2.intake.job.card", "---\nstatus: pending\ncreated: 2026-06-09T00:00:00Z\nsource: telegram\npriority: normal\ndescription: Triage 0 items\nitems: []\n---\n");
callback-box/test/landmark-nearest.doctest.md:58:Landmark directories are keyed on the `*.landmark.card` filename — a glob, no
callback-box/test/landmark-nearest.doctest.md:64:await box.write("Home.landmark.card", "---\ntype: landmark\n---\n");
callback-box/test/landmark-nearest.doctest.md:65:await box.write("class/activities/Activities.landmark.card", "garbled not-even-yaml {{{");
callback-box/test/landmark-nearest.doctest.md:74:await box.write("class/activities/Activities.landmark.card", "---\ntype: landmark\n---\n");
callback-box/src/frontend/src/renderers/todo-list.tsx:10:  name: "Todo List",
callback-box/src/frontend/src/renderers/sheet.tsx:157:  name: "Spreadsheet",
callback-box/test/connector-gmail-pull.doctest.md:39:        { name: "Message-ID", value: `<${opts.id}@example.com>` },
callback-box/test/connector-gmail-pull.doctest.md:40:        { name: "From", value: "alice@example.com" },
callback-box/test/connector-gmail-pull.doctest.md:41:        { name: "To", value: "me@example.com" },
callback-box/test/connector-gmail-pull.doctest.md:42:        { name: "Subject", value: opts.subject },
callback-box/test/connector-gmail-pull.doctest.md:86:  labels: [{ id: "Label_7", name: "callback", type: "user" }],
callback-box/test/connector-gmail-pull.doctest.md:246:  labels: [{ id: "Label_7", name: "callback", type: "user" }],
callback-box/test/chat-routes.doctest.md:218:  name: "Read",
callback-box/test/chat-routes.doctest.md:350:summarizeToolInput("Bash", { description: "Run tests", command: "npm test" })
callback-box/docs/asset-manifests.md:140:the hook treats it as a rename: removes the `foo.jpg` entry, adds a
callback-box/test/tours/tour-lib/browse.ts:113:  async findRef(role: string, name: string): Promise<string | null> {
callback-box/src/frontend/src/renderers/markdown.tsx:24:  { name: "Markdown", Component: MarkdownRenderer, priority: 50 },
callback-box/test/schemas.doctest.md:171:  description: "Triage 2 new capture sessions",
callback-box/test/schemas.doctest.md:183:description: Triage 2 new capture sessions
callback-box/test/schemas.doctest.md:195:  description: "Triage bookmarks",
callback-box/test/schemas.doctest.md:205:description: Triage bookmarks
callback-box/test/schemas.doctest.md:218:  description: "2 calendar changes to review",
callback-box/test/schemas.doctest.md:230:description: 2 calendar changes to review
callback-box/test/schemas.doctest.md:246:  description: "1 deletion",
callback-box/test/schemas.doctest.md:260:  description: "test",
callback-box/test/connector-drive.doctest.md:36:    name: "Test Budget",
callback-box/test/connector-drive.doctest.md:98:    name: "Expenses",
callback-box/test/connector-drive.doctest.md:170:    name: "Multi",
callback-box/test/routes-clerk.doctest.md:18:await ctx.seed("store/reading/Reading.landmark.card", `---
callback-box/test/routes-clerk.doctest.md:19:navigation:
callback-box/test/routes-clerk.doctest.md:26:await ctx.seed("store/recipes/Recipes.landmark.card", `---
callback-box/test/routes-clerk.doctest.md:27:navigation:
callback-box/test/routes-clerk.doctest.md:53:await ctx.seed("store/reading/Reading.landmark.card", `---
callback-box/test/routes-clerk.doctest.md:54:navigation:
callback-box/test/card-loaders.doctest.md:105:  filename: { ref: "attach/photo.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
callback-box/test/card-loaders.doctest.md:106:  description: "Whiteboard with project timeline",
callback-box/test/card-loaders.doctest.md:118:  filename: { ref: "photo-001.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
callback-box/test/card-loaders.doctest.md:132:  filename: { ref: "attach/p.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
callback-box/test/card-loaders.doctest.md:133:  description: "Note",
callback-box/test/tours/tour-lib/checkpoint.ts:14:  name: string;
callback-box/test/migrate-webpage-card.doctest.md:123:const REC = "---\nstatus: draft\nname: A Saved Page\ndescription: Short summary.\nsources:\n  - ref: https://example.com/saved\n    note: Example — Author\n---\n# A Saved Page\n\nPage content.\n";
callback-box/test/migrate-webpage-card.doctest.md:166:await fs.writeFile(path.join(box, "store/notes/Thing.record.card"), "---\nstatus: draft\nname: A Couch\n---\n");
callback-box/docs/procedure-implementation.md:18:    process-captures.procedure.card
callback-box/src/frontend/src/renderers/webpage.tsx:12:  name: "Webpage",
callback-box/test/landmark-feature-seed.doctest.md:48:  "store/dump/Daily.landmark.card",
callback-box/test/landmark-feature-seed.doctest.md:49:  "---\nnavigation:\n  label: Daily dump\n  symbol: 🎙️\n  chat-app:\n    narration: on\n---\n",
callback-box/test/landmark-feature-seed.doctest.md:78:  "store/plain/Plain.landmark.card",
callback-box/test/landmark-feature-seed.doctest.md:79:  "---\nnavigation:\n  label: Plain\n  symbol: 📁\n---\n",
callback-box/test/check.test.ts:15:    { name: "CheckError" },
callback-box/test/check.test.ts:349:  const ext = t.check('name: "Alice"', "name: «string»");
callback-box/test/check.test.ts:354:  const ext = t.check("name: 'Bob'", "name: «string»");
callback-box/test/tours/tour-lib/index.ts:5: *   tour({ name: "dashboard", description: "Walk the dashboard" }, async (t) => {
callback-box/test/tours/tour-lib/index.ts:20:export function tour({ name, description }: { name: string; description: string }, fn: TourFn): void {
callback-box/test/tours/tour-lib/cli.ts:23:  name: string | null;
callback-box/test/tours/tour-lib/cli.ts:27:  if (argv.length === 0) return { command: "list", name: null };
callback-box/test/tours/tour-lib/cli.ts:29:  if (first === "--list" || first === "-l") return { command: "list", name: null };
callback-box/test/tours/tour-lib/cli.ts:30:  if (first === "--all") return { command: "all", name: null };
callback-box/test/tours/tour-lib/cli.ts:31:  return { command: "run", name: first ?? null };
callback-box/test/tours/tour-lib/cli.ts:95:async function runOne(name: string, baseUrl: string): Promise<number> {
callback-box/src/frontend/src/renderers/json.tsx:140:  { name: "JSON", Component: JsonRenderer, priority: 40 },
callback-box/test/card-io.doctest.md:180:  description: "Triage 1 inbox item",
callback-box/test/card-io.doctest.md:194:const text = "---\ncontent-type: application/x-card+xml\n---\n<memo status=\"new\"/>";
callback-box/test/procedure-engine.doctest.md:21:await box.write("config/procedures/greet.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:22:name: greet
callback-box/test/procedure-engine.doctest.md:23:description: A simple greeting procedure
callback-box/test/procedure-engine.doctest.md:26:    description: Say hello
callback-box/test/procedure-engine.doctest.md:70:await box.write("config/procedures/maybe.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:71:name: maybe
callback-box/test/procedure-engine.doctest.md:72:description: Conditional steps
callback-box/test/procedure-engine.doctest.md:75:    description: This step skips
callback-box/test/procedure-engine.doctest.md:85:    description: This step runs
callback-box/test/procedure-engine.doctest.md:131:await box.write("config/procedures/idle.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:132:name: idle
callback-box/test/procedure-engine.doctest.md:133:description: Nothing to do
callback-box/test/procedure-engine.doctest.md:136:    description: Skips
callback-box/test/procedure-engine.doctest.md:146:    description: Also skips
callback-box/test/procedure-engine.doctest.md:187:await box.write("config/procedures/fail-early.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:188:name: fail-early
callback-box/test/procedure-engine.doctest.md:189:description: First step fails
callback-box/test/procedure-engine.doctest.md:192:    description: Precheck fails
callback-box/test/procedure-engine.doctest.md:202:    description: Should not run
callback-box/test/procedure-engine.doctest.md:237:await box.write("config/procedures/validate.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:238:name: validate
callback-box/test/procedure-engine.doctest.md:239:description: Validation test
callback-box/test/procedure-engine.doctest.md:242:    description: Validation warns but continues
callback-box/test/procedure-engine.doctest.md:253:    description: Runs after warning
callback-box/test/procedure-engine.doctest.md:294:await box.write("config/procedures/abort.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:295:name: abort
callback-box/test/procedure-engine.doctest.md:296:description: Abort on validation failure
callback-box/test/procedure-engine.doctest.md:299:    description: Validation aborts
callback-box/test/procedure-engine.doctest.md:310:    description: Should not run
callback-box/test/procedure-engine.doctest.md:341:await box.write("config/procedures/preview.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:342:name: preview
callback-box/test/procedure-engine.doctest.md:343:description: Preview procedure
callback-box/test/procedure-engine.doctest.md:346:    description: First step
callback-box/test/procedure-engine.doctest.md:361:    description: Second step
callback-box/test/procedure-engine.doctest.md:399:await box.write("config/procedures/multi.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:400:name: multi
callback-box/test/procedure-engine.doctest.md:401:description: Multi-step
callback-box/test/procedure-engine.doctest.md:404:    description: Alpha
callback-box/test/procedure-engine.doctest.md:410:    description: Beta
callback-box/test/procedure-engine.doctest.md:467:await box.write("config/procedures/stamped.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:468:name: stamped
callback-box/test/procedure-engine.doctest.md:469:description: Gets an expires stamp
callback-box/test/procedure-engine.doctest.md:472:    description: Does work
callback-box/test/procedure-engine.doctest.md:479:await box.write("config/procedures/doomed.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:480:name: doomed
callback-box/test/procedure-engine.doctest.md:481:description: Fails
callback-box/test/procedure-engine.doctest.md:484:    description: Precheck fails
callback-box/test/procedure-engine.doctest.md:530:await box.write("config/procedures/keeper.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:531:name: keeper
callback-box/test/procedure-engine.doctest.md:533:description: Runs are kept forever
callback-box/test/procedure-engine.doctest.md:536:    description: Does work
callback-box/test/procedure-engine.doctest.md:567:await box.write("config/procedures/steps.procedure.card", `---
callback-box/test/procedure-engine.doctest.md:568:name: steps
callback-box/test/procedure-engine.doctest.md:569:description: Has steps
callback-box/test/procedure-engine.doctest.md:572:    description: Real
callback-box/test/tours/tour-lib/types.ts:11:  name: Viewport;
callback-box/test/tours/tour-lib/types.ts:17:  { name: "desktop", width: 1280, height: 800 },
callback-box/test/tours/tour-lib/types.ts:18:  { name: "mobile", width: 375, height: 800 },
callback-box/test/tours/tour-lib/types.ts:40:  description: string;
callback-box/test/tours/tour-lib/types.ts:55:  name: string;
callback-box/test/tours/tour-lib/types.ts:65:  checkpoint: (name: string) => Promise<void>;
callback-box/test/tours/tour-lib/types.ts:76:  name: string;
callback-box/test/tours/tour-lib/types.ts:80:  heading: (name: string, opts?: { level?: number }) => Promise<void>;
callback-box/test/tours/tour-lib/types.ts:81:  landmark: (name: string) => Promise<void>;
callback-box/test/tours/tour-lib/types.ts:82:  button: (name: string) => Promise<void>;
callback-box/test/tours/tour-lib/types.ts:90:  name: string;
callback-box/test/tours/tour-lib/types.ts:91:  description: string;
callback-box/test/tours/tour-lib/axe.ts:45:    description: v.description,
callback-box/src/frontend/src/renderers/extfile.tsx:12:  name: "Extfile",
callback-box/test/capture-pipeline.test.ts:66:        filename: "audio-001.webm",
callback-box/test/capture-pipeline.test.ts:200:    name: "assemble-timeline",
callback-box/test/migrate-delete-deprecated.doctest.md:31:  isDeprecatedCard("Onboard.procedure.card"),
callback-box/test/session-context.doctest.md:99:    filename: `${summary}.ics`,
callback-box/src/frontend/eslint.config.mjs:43:          allow: [{ from: "package", name: "Redirect", package: "@tanstack/router-core" }],
callback-box/test/describe-images-helpers.doctest.md:79:Finds image files that share a card's basename:
callback-box/test/retro-walker.doctest.md:159:      { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "store/todos/shopping.todo-list.card" } },
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-003.image.card:4:filename:
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-001.image.card:4:filename:
callback-box/test/search-extract.doctest.md:122:  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: The boiler's serial-number plate (K-44210)\ntext:\n  - source: plate\n    content: Serial K-44210 Model HX-200 240V\n---\n"
callback-box/src/frontend/src/pages/dev/components/SpeechTestHarness.tsx:29:  { text: "And now here is the second segment, a little different.", displayText: "And now here is the second segment, a little different.", name: "Bob", hasTextBefore: false },
callback-box/src/frontend/src/pages/dev/components/SpeechTestHarness.tsx:44:    const num = (name: string, fallback: number) => {
callback-box/src/connectors/google-calendar.ts:272:      description: `${changes.length} calendar change${changes.length === 1 ? "" : "s"} to review`,
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/audio-001.audio.card:4:filename:
callback-box/test/routes-scheduler.doctest.md:36:  JSON.stringify({ event: "tick", ts: "2026-01-20T10:00:00Z", result: { scripts: [{ name: "test", status: "ran" }] } }),
callback-box/test/routes-scheduler.doctest.md:37:  JSON.stringify({ event: "tick", ts: "2026-01-20T11:00:00Z", result: { scripts: [{ name: "test", status: "skipped" }] } }),
callback-box/test/routes-scheduler.doctest.md:61:  JSON.stringify({ event: "tick", ts: "2026-01-20T10:00:00Z", result: { scripts: [{ name: "test", status: "ran" }] } }),
callback-box/test/routes-scheduler.doctest.md:62:  JSON.stringify({ event: "tick", ts: "2026-01-20T11:00:00Z", result: { scripts: [{ name: "test", status: "skipped" }] } }),
callback-box/test/routes-scheduler.doctest.md:105:  `---\ntype: scheduled-script\ncron: "0 * * * *"\ndescription: Echo test\nruns: echo hello\n---\n`,
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-002.image.card:4:filename:
callback-box/src/connectors/calendar-utils.ts:38:  filename: string;
callback-box/src/connectors/calendar-utils.ts:85:  opts: { filename: string; range?: { from: Date; to: Date } },
callback-box/src/connectors/calendar-utils.ts:136:  opts: { meta: VeventMeta; filename: string; range: { from: Date; to: Date } },
callback-box/src/connectors/calendar-utils.ts:226:    const parsed = parseIcsContent(content, { filename: file, ...(range ? { range } : {}) });
callback-box/src/connectors/requirements.ts:46:async function legacySecretPresent(boxRoot: string, name: string): Promise<boolean> {
callback-box/src/schemas/audio.tsx:36:    filename: FilenameEntry,
callback-box/src/schemas/audio.tsx:49:- \`filename:\` — \`{ref, recorded, source, duration?}\` for the audio
callback-box/src/schemas/audio.tsx:67:  filename: {
callback-box/src/schemas/audio.tsx:86:  filename: string;
callback-box/src/schemas/audio.tsx:90:    filename: {
callback-box/docs/adding-schemas.md:157:  name: "my-thing",
callback-box/docs/adding-schemas.md:158:  description: "A my-thing card — short description for `cb create -t`",
callback-box/docs/testing.md:135:const tg = createFakeTelegram({ username: "test_bot" });
callback-box/docs/testing.md:148:const tg = createFakeTelegram({ username: "my_bot" });
callback-box/docs/testing.md:161:const tg = withCallLog(createFakeTelegram({ username: "bot" }));
callback-box/docs/testing.md:190:const tg = createFakeTelegram({ username: "bot", updates: [...] });
callback-box/docs/testing.md:231:name: intake-basic
callback-box/docs/testing.md:232:description: Basic intake-job creation and processing
callback-box/docs/testing.md:235:  - name: sync
callback-box/docs/testing.md:244:  - name: process
callback-box/src/frontend/src/pages/landmarks/LandmarksPage.tsx:2: * Landmarks page — flat list of all `**\/*.landmark.card` in the box,
callback-box/src/frontend/src/pages/landmarks/LandmarksPage.tsx:38:            No landmarks yet. Add a *.landmark.card to any directory you
callback-box/src/connectors/google-calendar-notes.ts:54:    const getProp = (v: ICAL.Component, name: string): string =>
callback-box/docs/cli-restructure.md:114:| ~~`cb assemble-timeline`~~ | **Initial audit was wrong** — used by `templates/procedures/process-captures.procedure.card:230` as `<shell>cb assemble-timeline</shell>` and has its own test (`test/capture-pipeline.test.ts`). **Keep.** | — |
callback-box/docs/cli-restructure.md:137:The renames are independent — implement in any order. For each rename:
callback-box/docs/architecture/02-cards-and-memory.md:46:A card is a file. Specifically, an XML file on disk with a name like `Tio_Raul_Birthday.audio.card` or `Costco_List.list.card`. The name has two parts that matter: a human-readable label and a type. The type — `audio`, `memo`, `list`, `question` — determines what the card can contain. Everything is in the filename: you know what a card is and roughly what it's about without opening it. This matters because the filename is human-readable and LLM-readable at the same time — an agent listing a directory already knows what it's looking at.
callback-box/docs/cards-as-markdown.md:9:**Phase 1 — frontmatter wrapper** (May 21–22): every `.card` file gained a YAML frontmatter block, initially with `content-type: application/x-card+xml` so legacy XML bodies kept parsing through cardworks. This is the substrate that lets per-schema cards flip to flat YAML without breaking the loader. See `scripts/migrate/card-frontmatter.ts`.
callback-box/docs/cards-as-markdown.md:132:filename:
callback-box/docs/cards-as-markdown.md:155:Cards are XML files validated by Zod schemas defined with cardworks `element()`. Filename pattern: `Name.type.card`. Attachments share the basename:
callback-box/docs/cards-as-markdown.md:209:filename:
callback-box/docs/cards-as-markdown.md:341:A related question doesn't fully resolve with attachments: how do "tagging" cards relate to their directory? Landmarks bookmark a directory (`store/recipes/Recipes.landmark.card`). Future triage-destination markers might similarly mark a directory. Categories with associated procedures might too. These don't have a clear primary-owner relationship — they're peer attributes of the directory itself.
callback-box/docs/cards-as-markdown.md:347:3. **Multiple-types-per-basename** (would require relaxing the no-collision rule). `Recipes.landmark.card` + `Recipes.category.card` + `Recipes.triage-destination.card` as peer-typed views of the same conceptual object — ECS-style. Strongly associated, share a basename.
callback-box/docs/cards-as-markdown.md:432:**Naming**: `Name.type.card` — the type determines which schema validates it (e.g. `Meeting_Notes.memo.card`, `2026-05-22_kitchen.capture-session.card`). Attachments share the basename: `Voice_Memo.memo.card` + `Voice_Memo.m4a`.
callback-box/docs/cards-as-markdown.md:890:description: Family Group
callback-box/docs/cards-as-markdown.md:929:description: Family Group
callback-box/docs/cards-as-markdown.md:956:description: Family Group
callback-box/docs/cards-as-markdown.md:986:<procedure-run procedure="process-captures" status="completed" started-at="..." completed-at="...">
callback-box/docs/cards-as-markdown.md:1110:    description: Whiteboard with Q2 milestones
callback-box/docs/cards-as-markdown.md:1111:    filename: photo-001.attach/photo-001.jpg
callback-box/docs/cards-as-markdown.md:1178:filename:
callback-box/docs/cards-as-markdown.md:1203:filename: photo-002.attach/photo-002.jpg
callback-box/docs/cards-as-markdown.md:1226:With Markdoc, the OCR'd texts become block tags in the body, alongside the description:
callback-box/docs/cards-as-markdown.md:1232:filename:
callback-box/docs/cards-as-markdown.md:1273:<landmark>
callback-box/docs/cards-as-markdown.md:1359:  - name: Archive
callback-box/docs/cards-as-markdown.md:1363:  - name: Trash
callback-box/docs/cards-as-markdown.md:1466:  full-name: Jane Smith
callback-box/docs/cards-as-markdown.md:1557:name: Brown Leather Couch
callback-box/docs/cards-as-markdown.md:1592:  - name: Sauce
callback-box/docs/cards-as-markdown.md:1596:      - { amount: 1, unit: "28oz can", name: San Marzano tomatoes }
callback-box/docs/cards-as-markdown.md:1597:      - { amount: 3, unit: cloves, name: garlic }
callback-box/docs/cards-as-markdown.md:1598:      - { name: fresh basil }
callback-box/docs/cards-as-markdown.md:1613:name: Kitchen Remodel
callback-box/docs/cards-as-markdown.md:1619:  - name: Get cabinet quotes
callback-box/docs/cards-as-markdown.md:1624:  - name: Choose backsplash
callback-box/docs/cards-as-markdown.md:1627:      - { name: Get tile samples, status: pending }
callback-box/docs/cards-as-markdown.md:1628:      - { name: Check outlet covers, status: deferred }
callback-box/docs/cards-as-markdown.md:1944:filename:
callback-box/docs/cards-as-markdown.md:2094:- **Cross-box refs.** Out of scope for this RFC, but worth noting: today refs are always within a single box. If we ever want cross-box references (one box reading another's data), we'd need a syntax for that. Probably `box-name:/path/to/card.md` or similar. Don't design it now; flag it.
callback-box/docs/cards-as-markdown.md:2209:  name: "memo",
callback-box/docs/cards-as-markdown.md:2245:  name: "person",
callback-box/docs/cards-as-markdown.md:2403:  name: "memo",
callback-box/docs/cards-as-markdown.md:2410:      name: "Text memo",
callback-box/docs/cards-as-markdown.md:2414:      name: "Voice memo (transcribed)",
callback-box/docs/cards-as-markdown.md:2422:      description: "Voice memos marked `processed` should have a `{% transcription %}` body tag",
callback-box/docs/cards-as-markdown.md:2426:      description: "Memos marked `processed` typically have body content",
callback-box/src/connectors/telegram-ingest.ts:62:      ...(msg.from.username != null ? { username: msg.from.username } : {}),
callback-box/src/schemas/templates-registry.ts:15:  name: string;
callback-box/src/schemas/templates-registry.ts:17:  description: string;
callback-box/src/schemas/templates-registry.ts:45:export function getTemplate(name: string): TemplateDefinition | undefined {
callback-box/src/schemas/procedure.ts:53:  description: z.string().optional(),
callback-box/src/schemas/procedure.ts:60:  name: z.string(),
callback-box/src/schemas/procedure.ts:61:  description: z.string().optional(),
callback-box/docs/implemented-plans/narration-mode-design.md:245:<landmark>
callback-box/docs/implemented-plans/narration-mode-design.md:365:**Feature state.** Per-session map of `{ feature-name: "on" | "off" }`. Stored as a `features` field on `SessionHistoryEntry` (defined in `src/core/chat-session-history.ts`). Default is empty — empty means "default behavior, no features active." Server-side is the source of truth.
callback-box/src/connectors/gmail-mime.ts:26:    filename: string;
callback-box/src/connectors/gmail-mime.ts:83:  opts: { originalFilename: string | undefined; contentType: string; partId: string | undefined },
callback-box/src/connectors/gmail-mime.ts:108:function getHeader(payload: GmailPayload | undefined, name: string): string | undefined {
callback-box/src/connectors/gmail-mime.ts:176:  filename: string;
callback-box/src/connectors/gmail-mime.ts:192:      filename: safeAttachmentFilename({
callback-box/src/connectors/gmail-mime.ts:193:        originalFilename: p.filename || undefined,
callback-box/src/connectors/gmail-mime.ts:236:      filename: ref.filename,
callback-box/src/schemas/templates-builtins.ts:29:  name: "memo",
callback-box/src/schemas/templates-builtins.ts:30:  description: "A text memo card",
callback-box/src/schemas/templates-builtins.ts:41:  name: "voice-memo",
callback-box/src/schemas/templates-builtins.ts:42:  description: "A voice memo card (audio attached separately)",
callback-box/src/schemas/templates-builtins.ts:50:  name: "question",
callback-box/src/schemas/templates-builtins.ts:51:  description: "A multiple-choice question card",
callback-box/src/schemas/templates-builtins.ts:74:  name: "question-text",
callback-box/src/schemas/templates-builtins.ts:75:  description: "A free-text question card",
callback-box/src/schemas/templates-builtins.ts:85:  name: "question-confirm",
callback-box/src/schemas/templates-builtins.ts:86:  description: "A yes/no confirmation question card",
callback-box/src/schemas/templates-builtins.ts:96:  name: "guide",
callback-box/src/schemas/templates-builtins.ts:97:  description: "A generic guide card — triage rules, actions, experiments, reactions",
callback-box/src/schemas/templates-builtins.ts:101:    name: z.string().describe("Domain name (intake, calendar, drive, chat, or custom)"),
callback-box/src/schemas/templates-builtins.ts:103:  generate: (args) => createInitialGuideTemplate({ name: args.name }),
callback-box/src/schemas/templates-builtins.ts:107:  name: "record",
callback-box/src/schemas/templates-builtins.ts:108:  description: "A record card — generic extracted unit from capture sessions",
callback-box/src/schemas/templates-builtins.ts:112:    name: z.string().describe("Short identifying label for the record"),
callback-box/src/schemas/templates-builtins.ts:113:    description: z.string().optional().describe("Description of the thing"),
callback-box/src/schemas/templates-builtins.ts:117:      name: args.name,
callback-box/src/schemas/templates-builtins.ts:125:  name: "recipe",
callback-box/src/schemas/templates-builtins.ts:126:  description: "A recipe card with ingredients, steps, and scaling support",
callback-box/src/schemas/templates-builtins.ts:131:    description: z.string().optional().describe("What the dish is"),
callback-box/src/schemas/templates-builtins.ts:145:  name: "scheduled-script",
callback-box/src/schemas/templates-builtins.ts:146:  description: "A scheduled script card — declarative scheduling for commands",
callback-box/src/schemas/templates-builtins.ts:151:    description: z.string().optional().describe("Human-readable summary of what this schedule does"),
callback-box/src/schemas/templates-builtins.ts:179:  name: "todo-list",
callback-box/src/schemas/templates-builtins.ts:180:  description: "A todo list card — human-oriented action items",
callback-box/src/schemas/templates-builtins.ts:184:    name: z.string().describe("Display name for the todo list"),
callback-box/src/schemas/templates-builtins.ts:188:        name: z.string().describe("Item name"),
callback-box/src/schemas/templates-builtins.ts:196:      name: args.name,
callback-box/src/schemas/templates-builtins.ts:205:  name: "briefing",
callback-box/src/schemas/templates-builtins.ts:206:  description: "A briefing card — core situational context for a box or directory",
callback-box/src/schemas/templates-builtins.ts:214:  name: "doc",
callback-box/src/schemas/templates-builtins.ts:215:  description: "A generic typed document — use instead of .md when an agent creates a new document",
callback-box/src/schemas/templates-builtins.ts:230:  name: "person",
callback-box/src/schemas/templates-builtins.ts:231:  description: "A person card — key people referenced from briefings",
callback-box/src/schemas/templates-builtins.ts:235:    name: z.string().describe("Full name of the person"),
callback-box/src/schemas/templates-builtins.ts:241:      name: args.name,
callback-box/docs/migrations.md:37:     description: "*.thing.card: XML → flat YAML.",
callback-box/docs/migrations.md:59:       filename: { attrs: ["ref", "captured", "source"] },
callback-box/docs/migrations.md:60:       description: { attrs: [] },
callback-box/docs/migrations.md:96:| 2 | `card-frontmatter`  | `card-frontmatter.ts`  | Phase 1: wrap every `.card` in `---\ncontent-type: application/x-card+xml\n---` so the loader treats them uniformly |
callback-box/docs/migrations.md:140:- Several boxes had `Box.landmark.card` with `<label>` / `<symbol>` directly under `<landmark>` instead of inside `<navigation>`. Wrapped via perl one-liner.
callback-box/src/connectors/telegram-types.ts:27:    first_name: string;
callback-box/docs/implemented-plans/extfile-card.md:458:  `_Prompt_Review_Index.doc.card` and `Prompts.landmark.card` are repointed.
callback-box/docs/activities-design.md:77:    description: string;
callback-box/docs/activities-design.md:85:  abstract createInstance(ctx: { boxRoot: string; name: string; displayName: string }): Promise<void>;
callback-box/docs/activities-design.md:129:    description: "Learn a language through conversation and structured practice",
callback-box/docs/activities-design.md:149:      name: "polyglot-main",
callback-box/src/connectors/google-calendar-push.ts:86:        state.eventFiles[result.id] = { filename: file, calendarId };
callback-box/docs/prompt-logging.md:185:- The log filename: `.callback-box/logs/<session-id>.log`
callback-box/docs/prompt-logging.md:186:- The JSONL filename: `~/.claude/projects/.../<session-id>.jsonl`
callback-box/src/frontend/src/app-shell.tsx:25:interface KnownBox { slug: string; name: string; }
callback-box/src/schemas/file.tsx:33:    filename: FilenameEntry,
callback-box/src/schemas/file.tsx:34:    description: z.string().optional(),
callback-box/src/schemas/file.tsx:46:- \`filename:\` — the attached file as a \`{ref, captured, source, ...}\`
callback-box/src/schemas/file.tsx:52:- \`description:\` — short summary of what the file contains, filled in
callback-box/src/schemas/file.tsx:66:  filename: {
callback-box/src/schemas/file.tsx:80:  filename: string;
callback-box/src/schemas/file.tsx:85:  const filename: Record<string, unknown> = {
callback-box/src/schemas/person.tsx:21:    name: z.string(),
callback-box/src/schemas/person.tsx:36:- \`name:\` — Full name. Required.
callback-box/src/schemas/person.tsx:59:  name: string;
callback-box/src/schemas/person.tsx:67:  name: string;
callback-box/src/schemas/person.tsx:73:    name: options.name,
callback-box/docs/implemented-plans/box-retrospectives.md:43:  command; `process-guidance.procedure.card` for the
callback-box/docs/implemented-plans/box-retrospectives.md:95:  as the prompt."* `process-guidance.procedure.card` (in live boxes'
callback-box/docs/implemented-plans/box-retrospectives.md:257:Procedure: `templates/procedures/process-retrospective.procedure.card`,
callback-box/docs/implemented-plans/box-retrospectives.md:408:   `templates/procedures/process-retrospective.procedure.card` with the
callback-box/docs/IMPLEMENTATION.md:109:Binary files (audio, images, PDFs) accompany cards using the same basename:
callback-box/docs/IMPLEMENTATION.md:258:  name: "email",
callback-box/src/schemas/question-followup-job.ts:18:    description: z.string(),
callback-box/src/schemas/question-followup-job.ts:53:  description: string;
callback-box/src/schemas/question-followup-job.ts:60:  description: string;
callback-box/src/schemas/question-followup-job.ts:70:    description: options.description,
callback-box/src/frontend/src/lib/view-bindings.ts:19:  name: string;
callback-box/src/frontend/src/lib/view-bindings.ts:24:  name: string;
callback-box/src/frontend/src/lib/view-bindings.ts:39:          if (!map.has(type)) map.set(type, { slug: meta.slug, name: meta.name });
callback-box/docs/glossary.md:38:**procedure** — A multi-step workflow defined as a `*.procedure.card` (currently still XML; one of the deferred Markdoc-shaped schemas). Config in `config/procedures/`, runs in `procedure/runs/`. See `docs/procedure-implementation.md`.
callback-box/src/schemas/calendar-review-job.tsx:26:    description: z.string(),
callback-box/src/schemas/calendar-review-job.tsx:73:  description: string;
callback-box/src/schemas/calendar-review-job.tsx:85:  description: string;
callback-box/src/schemas/calendar-review-job.tsx:94:    description: options.description,
callback-box/docs/ideas.md:779:Why the directory form looks fatter (a whole separate `*.landmark.card` with label/symbol/pinned links) while the card form is a bare flag: it's forced by "a directory isn't a card." A directory has no frontmatter to mark and no intrinsic renderable identity, so it needs a proxy object supplying what a card supplies for itself — a name, an icon, a tile. The landmark's extra payload is exactly *prominence + the identity a bare directory can't carry*. A card already has a title, a type, and a renderer, so a flag suffices; the card renders its own tile.
callback-box/docs/ideas.md:796:Exploratory structural idea (2026-06-12), the deep version of [[card-level-prominence]]. Today a card relates to a sibling container exactly one way — `Foo.attach/` is Foo's private bag of binaries — and a *directory* gets its identity a different way: a `landmark`/`briefing` card placed *inside* it. What if instead `Foo.type.card` paired with a plain `Foo/`? Then **a directory's "head card" — a same-named sibling of any type — gives the directory its type, identity, prominence, and primary content at once.** `Recipes.landmark.card + Recipes/`, `Chat.sandbox.card + Chat/`, `Foo.doc.card + Foo/` all become one pattern, recursive down the tree (every directory optionally typed by its sibling). This generalizes the prominence insight: a bare directory lacks the renderable identity a card has, so it needs a proxy — the head card *is* that proxy, and making it any-typed unifies attachments, landmarks, and briefings into "directories have head cards."
callback-box/src/schemas/chat-job.ts:20:    description: z.string(),
callback-box/src/schemas/chat-job.ts:63:  description: string;
callback-box/src/schemas/chat-job.ts:69:  description: string;
callback-box/src/schemas/chat-job.ts:77:    description: options.description,
callback-box/docs/doc-graph.md:668:- docs/glossary.md:38 (mention) — **procedure** — A multi-step workflow defined as a `*.procedure.card` (currently still XML; one of the deferred Markdoc-
callback-box/docs/doc-graph.md:797:- docs/landmarks.md:33 (mention) — A landmark is a root `<landmark>` with one or more **role** child elements. The navigation role (`<navigation>`) carries
callback-box/src/schemas/guide-templates.tsx:16:  actions: Array<{ name: string; when: string; instructions: string }>;
callback-box/src/schemas/guide-templates.tsx:29:        name: "Archive",
callback-box/src/schemas/guide-templates.tsx:34:        name: "Convert to Recipe",
callback-box/src/schemas/guide-templates.tsx:39:        name: "Keep for Reading",
callback-box/src/schemas/guide-templates.tsx:44:        name: "Trash",
callback-box/src/schemas/guide-templates.tsx:49:        name: "Ask User",
callback-box/src/schemas/guide-templates.tsx:74:        name: "Create Reminder",
callback-box/src/schemas/guide-templates.tsx:79:        name: "Note Change",
callback-box/src/schemas/guide-templates.tsx:84:        name: "Create Event",
callback-box/src/schemas/guide-templates.tsx:89:        name: "Edit Event",
callback-box/src/schemas/guide-templates.tsx:94:        name: "Delete Event",
callback-box/src/schemas/guide-templates.tsx:99:        name: "Ignore",
callback-box/src/schemas/guide-templates.tsx:121:        name: "Read Spreadsheet",
callback-box/src/schemas/guide-templates.tsx:126:        name: "Edit Spreadsheet",
callback-box/src/schemas/guide-templates.tsx:148:        name: "Respond",
callback-box/src/schemas/guide-templates.tsx:153:        name: "Acknowledge",
callback-box/src/schemas/guide-templates.tsx:158:        name: "Follow Up",
callback-box/src/schemas/guide-templates.tsx:184:export function createInitialGuideTemplate(options: { name: string }): string {
callback-box/src/schemas/guide-templates.tsx:194:        name: "Ask User",
callback-box/src/schemas/guide-templates.tsx:222:  fields.actions = seed.actions.map((a) => ({ name: a.name, when: a.when, instructions: a.instructions }));
callback-box/docs/adding-api-endpoints.md:43:      name: z.string().min(1),
callback-box/docs/adding-api-endpoints.md:97:    mutation.mutate({ name: "test", content: "hello" });
callback-box/docs/adding-api-endpoints.md:177:  name: string;
callback-box/docs/adding-api-endpoints.md:202:  name: string;
callback-box/src/schemas/record.tsx:31:  name: z.string(),
callback-box/src/schemas/record.tsx:51:    name: z.string(),
callback-box/src/schemas/record.tsx:52:    description: z.string().optional(),
callback-box/src/schemas/record.tsx:72:- \`name:\` — Always present. A short identifying label for this
callback-box/src/schemas/record.tsx:75:- \`description:\` — About the thing — context, what it is, its
callback-box/src/schemas/record.tsx:121:  name: string;
callback-box/src/schemas/record.tsx:125:  persons?: Array<{ name: string; ref?: string; role?: string; notes?: string; note?: string }>;
callback-box/src/schemas/record.tsx:135:  name: string;
callback-box/src/schemas/record.tsx:142:    name: options.name,
callback-box/docs/implemented-plans/open-chat-from-card.md:26:  The resolver globs `*.landmark.card` filenames only (no parse), so a hand-created landmark
callback-box/docs/implemented-plans/open-chat-from-card.md:87:  `**/*.landmark.card` (ignoring `node_modules`, `.git`, `tmp`, `.callback-box`) and maps each
callback-box/docs/implemented-plans/open-chat-from-card.md:162:  const dirs = await landmarkDirs(boxRoot);      // globs **/*.landmark.card → Set of dirs ("" for root)
callback-box/docs/implemented-plans/open-chat-from-card.md:245:  a malformed body still defines its *directory*: `nearestLandmarkDir` globs `*.landmark.card`
callback-box/src/schemas/scheduled-script.tsx:62:    description: z.string().optional(),
callback-box/src/schemas/scheduled-script.tsx:140:  description: string | undefined;
callback-box/src/schemas/scheduled-script.tsx:172:    description: fields.description,
callback-box/src/core/intake.ts:42:  name: string;
callback-box/src/core/intake.ts:69:function normalizeFilename(name: string): string {
callback-box/src/core/intake.ts:78:  name: "filename-normalization",
callback-box/src/frontend/src/lib/earcons.ts:11:  name: string;
callback-box/src/frontend/src/lib/earcons.ts:12:  filename: string;
callback-box/src/frontend/src/lib/earcons.ts:15:  constructor({ name, filename, volume }: { name: string; filename: string; volume: number }) {
callback-box/src/frontend/src/lib/earcons.ts:46:export const sendSound = new EarCon({ name: "send", filename: "beeprising.wav", volume: 0.3 });
callback-box/src/frontend/src/lib/earcons.ts:47:export const tick = new EarCon({ name: "tick", filename: "tick2.wav", volume: 0.6 });
callback-box/src/frontend/src/lib/earcons.ts:48:export const stillListening = new EarCon({ name: "stillListening", filename: "book-close.wav", volume: 0.3 });
callback-box/src/frontend/src/lib/earcons.ts:49:export const recordingStart = new EarCon({ name: "recordingStart", filename: "recording-start.mp3", volume: 0.7 });
callback-box/src/frontend/src/lib/earcons.ts:50:export const recordingStop = new EarCon({ name: "recordingStop", filename: "recording-stop.mp3", volume: 0.7 });
callback-box/src/frontend/src/lib/earcons.ts:52:export const recordingError = new EarCon({ name: "recordingError", filename: "recording-error.wav", volume: 0.7 });
callback-box/src/frontend/src/lib/earcons.ts:54:export const alarm = new EarCon({ name: "alarm", filename: "krell-alarm-7.wav", volume: 0.8 });
callback-box/src/frontend/src/lib/earcons.ts:63:export const recordingDropped = new EarCon({ name: "recordingDropped", filename: "krell-alarm-7.wav", volume: 0.7 });
callback-box/src/frontend/src/lib/earcons.ts:64:export const recordingResumed = new EarCon({ name: "recordingResumed", filename: "recording-start.mp3", volume: 0.7 });
callback-box/src/core/asset-manifest.ts:52:export function findEntry(m: AssetManifest, name: string): AssetManifestEntry | undefined {
callback-box/docs/architecture/images/card-anatomy-diagram.mmd:4:        a2["filename: .webm"]
callback-box/docs/plans/web-page-commentary.md:26:  test1 `Box.landmark.card`.)
callback-box/docs/plans/web-page-commentary.md:239:`triage-destination` carries `<rules>`/`<procedure>` meant for the inbox-triage
callback-box/docs/plans/web-page-commentary.md:249:- `<rules>`/`<procedure>` remain meaningful only for `for` including `triage`.
callback-box/docs/plans/web-page-commentary.md:258:- Element name: **`destination`** (not `dest`, not `route-to`).
callback-box/docs/plans/web-page-commentary.md:522:   `Box.landmark.card`) `<triage-destination>` → `<destination for="triage">`.
callback-box/src/core/reactor/chat-jobs.ts:58:      name: "reactor-chat",
callback-box/src/frontend/src/lib/boxes.ts:7:  boxes: Array<{ slug: string; name: string }>;
callback-box/docs/plans/remove-cardworks-package.md:197:  procedure-job cards are still **XML** (`<procedure ref="...">`) — the docs
callback-box/docs/plans/remove-cardworks-package.md:202:  detector, migration of existing box `<procedure>` job cards, and updated
callback-box/docs/plans/remove-cardworks-and-xml.md:13:There is no second format, no `content-type: application/x-card+xml`,
callback-box/docs/plans/remove-cardworks-and-xml.md:317:- **Inline procedures are dead.** No box landmark uses a `<procedure>`
callback-box/docs/plans/remove-cardworks-and-xml.md:320:  only `<procedure ref=…/>`."* So `TriageProcedure`'s
callback-box/docs/plans/remove-cardworks-and-xml.md:334:navigation:
callback-box/docs/plans/remove-cardworks-and-xml.md:440:every real `.landmark.card` across all of `~/src/boxes` found the
callback-box/src/frontend/src/lib/view-url.ts:114:function cardBasenameOf(filename: string): string {
callback-box/docs/google-setup.md:28:2. App name: "Callback Box" (only you see this)
callback-box/docs/plans/remove-cardworks-deletion.md:37:   `**/*.landmark.card` (frontmatter since migration) via `parseCard` (the XML
callback-box/docs/plans/remove-cardworks-deletion.md:38:   parser), and `generate-docs-compile.ts:47` reads `*.procedure.card`
callback-box/docs/plans/remove-cardworks-deletion.md:235:  `.landmark.card` (frontmatter) via `parseCard`. Rewrite to read navigation
callback-box/docs/plans/triage-design.md:72:**Discovery: glob, filter by role.** `**/*.landmark.card` finds all landmarks; triage filters to cards with `<triage-destination>`; the Landmarks UI filters to ones with `<navigation>`.
callback-box/docs/plans/triage-design.md:87:- **By reference.** `<procedure ref="..."/>` inside `<triage-destination>`. Reuses the existing procedure-running machinery directly, lets one procedure serve multiple categories, lets the handler grow without bloating the landmark.
callback-box/docs/plans/triage-design.md:149:**Intake-complete items move out before triage runs.** When all applicable intake steps' preconditions are false for an item, intake moves it out of `inbox/intake/` into a triage staging spot (working name: `inbox/staged/`). Triage reads from that staging spot. Two reasons the move matters: (1) the boundary between "still being prepared" and "ready to categorize" is visible in the filesystem, and (2) triage doesn't have to re-check intake preconditions on every pass.
callback-box/docs/plans/triage-design.md:253:2. **Category storage** — *Resolved: landmark cards, extended.* The existing `*.landmark.card` type carries the new `<triage-destination>` role alongside `<navigation>`. One landmark per spot, living at its directory, discovered by glob (`**/*.landmark.card`). Triage filters to cards with `<triage-destination>` child. Compiled into the triage-instructions doc on demand. Existing landmarks get their current fields wrapped in `<navigation>` during migration. `<chat>` deferred. Open: compilation cadence.
callback-box/src/core/init-rules.ts:17:  name: string;
callback-box/src/core/init-rules.ts:29:    name: "connector-calendar",
callback-box/src/core/init-rules.ts:96:  const cardRuleSources: Array<{ name: string; instructions: string | undefined }> = [
callback-box/src/core/init-rules.ts:97:    ...schemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
callback-box/src/core/init-rules.ts:98:    ...boxSchemas.elementSchemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
callback-box/src/core/init-rules.ts:99:    ...cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
callback-box/src/core/init-rules.ts:100:    ...boxSchemas.cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
callback-box/src/core/reactor/batch-jobs.ts:45:    name: "reactor-batch",
callback-box/docs/plans/source-editor.md:103:  { name: "Edit", Component: SourceEditor, priority: 5 },
callback-box/src/core/preactions/index.ts:52:}): Promise<Array<{ name: string; result: PreActionResult }>> {
callback-box/src/core/preactions/index.ts:58:  const results: Array<{ name: string; result: PreActionResult }> = [];
callback-box/src/core/preactions/index.ts:65:        results.push({ name: action.name, result });
callback-box/src/core/preactions/index.ts:80:        name: action.name,
callback-box/docs/box-layout.md:96:| `config/procedures/` | Procedure cards (`*.procedure.card`). `cb init` installs default templates. |
callback-box/src/frontend/src/hooks/useCurrentUser.ts:11:  name: string;
callback-box/src/frontend/src/hooks/useCurrentUser.ts:25:      .then((data: { email: string; name: string; picture?: string; isOwner: boolean } | null) => {
callback-box/src/frontend/src/hooks/useCurrentUser.ts:27:          setUser({ email: data.email, name: data.name, picture: data.picture, isOwner: data.isOwner });
callback-box/src/cli/commands/intake.ts:20:      const result = await runCommand({ name: "intake", args: {}, ctx });
callback-box/src/core/preactions/types.ts:33:  name: string;
callback-box/src/frontend/src/hooks/useBoxIdentityMeta.ts:12:export function useBoxIdentityMeta(box: { slug: string; name: string } | null) {
callback-box/src/core/agent-guide/behavior.ts:79:    "A landmark marks its directory as a destination for one or more kinds of content via `<destination for=\"…\">`, where `for` is a space-separated set: `triage` (a routing target for the intake→triage→handle pipeline, carrying `<rules>`/`<procedure>` — see `docs/plans/triage-design.md`) and/or `commentary` (a place web-page commentary documents are filed by the clerk capture flow). When the user clarifies what kind of item belongs in which spot, update the landmark, not a guide card. (The older `<triage-destination>` element still works and means `<destination for=\"triage\">`.)",
callback-box/src/frontend/src/lib/source-tag.ts:47:export function cbSourceItem(description: string): { "data-cb-source-item": string } {
callback-box/src/core/preactions/transcribe.ts:37:  name: "transcribe-voice",
callback-box/src/core/generate-docs-content.ts:17:  name: string;
callback-box/src/core/generate-docs-content.ts:19:  description: string;
callback-box/src/core/generate-docs-content.ts:24:    name: "gmail",
callback-box/src/core/generate-docs-content.ts:26:    description: "Pulls emails from Gmail via IMAP. Creates thread directories with message cards and body text files.",
callback-box/src/core/generate-docs-content.ts:29:    name: "google-drive",
callback-box/src/core/generate-docs-content.ts:31:    description: "Two-way sync with Google Drive. Spreadsheets become `.sheet.card` files with JSON tabs; Google Docs become `.gdoc.card` files with sibling markdown. Push detects conflicts when remote changed since the last pull.",
callback-box/src/core/generate-docs-content.ts:38:export function generateCardDoc(name: string, instructions: string): string {
callback-box/src/cli/commands/wakeup.ts:62:    console.log("  Refilled Box.landmark.card (root landmark was missing)");
callback-box/docs/plans/box-migration.subplan.md:133:**What.** Procedure-job cards are still XML (`<procedure ref="…">`), detected
callback-box/docs/plans/box-migration.subplan.md:145:detector that reads frontmatter, a migrator for existing `<procedure>` job
callback-box/src/cli/commands/chat-audio.ts:282:    let filename: string;
callback-box/src/cli/commands/transcribe-captures.ts:19:        name: "transcribe-captures",
callback-box/src/cli/commands/tick-helpers.ts:259:    return { name: scriptName, status: "ran", command: parsed.runs, durationMs };
callback-box/src/cli/commands/tick-helpers.ts:265:    return { name: scriptName, status: "error", command: parsed.runs, durationMs, error: (err as Error).message };
callback-box/src/cli/commands/triage.ts:20:        name: "triage",
callback-box/src/core/agent-guide/landmarks.ts:15:    "The Landmarks page is the user's quick-jump surface to the spots in the box they actually live in. Directories organize the box for the system — inbox, jobs, archive, etc. Landmarks orient that organization toward the user: the places they keep returning to, the destinations of their recurring asks. Each is a `*.landmark.card` inside the directory it represents.",
callback-box/src/core/triage.ts:145:  const agent = createAgent({ name: "triage" });
callback-box/src/core/generate-docs-cb-commands-scheduling.ts:26:    "The `<name-or-path>` argument can be a bare name (resolves to `config/procedures/<name>.procedure.card`)",
callback-box/src/core/generate-docs-cb-commands-scheduling.ts:27:    "or a direct path to any `.procedure.card` file.",
callback-box/src/cli/commands/assemble-timeline.ts:19:        name: "assemble-timeline",
callback-box/src/core/state.ts:26:  name: string;
callback-box/src/core/state.ts:64:  let entries: Array<{ name: string; isDirectory: () => boolean }>;
callback-box/src/core/state.ts:95:          name: parsed.name,
callback-box/src/core/state.ts:105:          name: parsed.name,
callback-box/src/core/state.ts:117:        name: parsed.name,
callback-box/src/core/landmark/resolve.ts:47:  navigation: LandmarkNavigationData | undefined,
callback-box/src/core/landmark/nearest.ts:10: * Landmark *directories* are keyed on the `*.landmark.card` filename alone (a
callback-box/src/core/landmark/nearest.ts:60:  const matches = await glob("**/*.landmark.card", {
callback-box/src/core/landmark/list-destinations.ts:35:  const matches = await glob("**/*.landmark.card", {
callback-box/src/core/transcription-voxtral-request.ts:54:function fieldPart(boundary: string, { name, value }: { name: string; value: string }): Buffer {
callback-box/src/core/transcription-voxtral-request.ts:101:  formParts.push(fieldPart(boundary, { name: "model", value: VOXTRAL_MODEL }));
callback-box/src/core/transcription-voxtral-request.ts:106:    formParts.push(fieldPart(boundary, { name: "timestamp_granularities", value: granularity }));
callback-box/src/core/transcription-voxtral-request.ts:113:    formParts.push(fieldPart(boundary, { name: "diarize", value: "true" }));
callback-box/src/core/transcription-voxtral-request.ts:118:    formParts.push(fieldPart(boundary, { name: "context_bias", value: prompt }));
callback-box/src/core/maps/precheck-ignore.ts:102:function basenameGlobMatch(pattern: string, name: string): boolean {
callback-box/src/core/maps/precheck-ignore.ts:121:  basename: string;
callback-box/src/core/maps/precheck-ignore.ts:170:export function joinChildPath(parentRel: string, name: string): string {
callback-box/src/cli/commands/answer.ts:22:      name: "answer",
callback-box/src/core/landmark/features.ts:5: *   navigation:
callback-box/src/core/landmark/features.ts:35:  navigation: LandmarkNavigationData | undefined,
callback-box/src/core/landmark/features.ts:67:  const landmarkName = entries.find((n) => n.endsWith(".landmark.card"));
callback-box/src/core/box-templates.ts:124:  name: "task",
callback-box/src/core/box-templates.ts:125:  description: "A task card",
callback-box/src/core/box-templates.ts:192:    name: "tricks",
callback-box/src/cli/commands/upload.ts:29:      const result = await runCommand({ name: "upload", args, ctx });
callback-box/src/cli/commands/ls.ts:24:        name: "ls",
callback-box/src/core/generate-docs-compile.ts:24:  name: string;
callback-box/src/core/generate-docs-compile.ts:25:  filename: string;
callback-box/src/core/generate-docs-compile.ts:26:  description: string;
callback-box/src/core/generate-docs-compile.ts:41:  const cards = files.filter((f) => f.endsWith(".procedure.card")).toSorted();
callback-box/src/core/generate-docs-compile.ts:48:      const name = root.attrs["name"] ?? filename.replace(".procedure.card", "");
callback-box/src/core/generate-docs-compile.ts:55:      results.push({ name, filename, description: shortDesc });
callback-box/src/core/generate-docs-compile.ts:60:        name: filename.replace(".procedure.card", ""),
callback-box/src/core/generate-docs-compile.ts:62:        description: "(could not parse)",
callback-box/src/core/generate-docs-compile.ts:134:  name: string;
callback-box/src/core/generate-docs-compile.ts:187:        name: guideName,
callback-box/src/cli/commands/scenario.ts:28:  .action(async (name: string, options: { from?: string; dryRun?: boolean }) => {
callback-box/src/cli/commands/create.ts:114:        name: "create",
callback-box/src/cli/commands/tick.ts:38:  name: string;
callback-box/src/cli/commands/tick.ts:109:      scripts.push({ name: scriptName, status: "error", error: `parse: ${(err as Error).message}` });
callback-box/src/cli/commands/tick.ts:118:      scripts.push({ name: scriptName, status: "skipped" });
callback-box/src/cli/commands/tick.ts:125:      scripts.push({ name: scriptName, status: "ran", command: parsed.runs });
callback-box/src/core/generate-docs-procedure-guide.ts:17:cb procedure run config/procedures/my.procedure.card  # Run by path
callback-box/src/core/generate-docs-procedure-guide.ts:52:name: my-procedure
callback-box/src/core/generate-docs-procedure-guide.ts:53:description: What this procedure does
callback-box/src/core/generate-docs-procedure-guide.ts:56:    description: Human-readable description of this step
callback-box/src/core/generate-docs-procedure-guide.ts:149:1. Create \`config/procedures/my-procedure.procedure.card\`
callback-box/src/core/generate-docs-procedure-guide.ts:179:- **\`cb init\` on an existing box (modified procedures)**: The new template is parked under \`config/_template-updates/procedures/<name>.procedure.card\` so you can diff and merge manually. The active file at \`config/procedures/<name>.procedure.card\` is left untouched.
callback-box/src/core/generate-docs-procedure-guide.ts:185:diff config/procedures/process-captures.procedure.card config/_template-updates/procedures/process-captures.procedure.card
callback-box/src/cli/commands/procedure.ts:21:  .argument("<name-or-path>", "Procedure name (e.g., process-captures) or path to .procedure.card")
callback-box/src/cli/commands/procedure.ts:26:  .action(async (name: string, options: { dryRun?: boolean; force?: boolean; step?: string; directive?: string }) => {
callback-box/src/cli/commands/procedure.ts:32:        name: "procedure-run",
callback-box/src/cli/commands/procedure.ts:62:        name: "procedure-list",
callback-box/src/cli/commands/procedure.ts:86:        name: "procedure-gc",
callback-box/src/cli/commands/procedure.ts:111:        name: "procedure-status",
callback-box/src/cli/commands/move.ts:30:        name: "move",
callback-box/src/core/asset-manifest-scan.ts:36:  name: string;
callback-box/src/core/asset-manifest-scan.ts:43:  name: string;
callback-box/src/core/asset-manifest-scan.ts:50:  name: null;
callback-box/src/core/asset-manifest-scan.ts:180:      name: null,
callback-box/src/core/asset-manifest-scan.ts:277:      name: orphan,
callback-box/src/core/schedule-health.ts:38:  name: string;
callback-box/src/core/schedule-health.ts:40:  description: string | undefined;
callback-box/src/core/schedule-health.ts:64:  name: string;
callback-box/src/core/schedule-health.ts:85:    description: parsed.description,
callback-box/src/core/transcription.ts:100:  filename: string;
callback-box/src/core/chat-session-features.ts:113:  async set(name: string, value: string): Promise<void> {
callback-box/src/core/agent.ts:44:  name: string;
callback-box/src/core/agent.ts:71:  name: string;
callback-box/src/core/agent.ts:83:      name: options.name,
callback-box/src/core/agent.ts:115:    name: options.name,
callback-box/src/cli/commands/describe-images.ts:15:  .action(async (paths: string[], options: { rename: boolean }) => {
callback-box/src/cli/commands/describe-images.ts:21:        name: "describe-images",
callback-box/src/cli/commands/describe-images.ts:22:        args: { paths, noRename: !options.rename },
callback-box/src/cli/commands/attachments.ts:56:    const result = await runCommand({ name: "attachments", args, ctx });
callback-box/src/core/markdown-lint-rules.ts:19:  description: "view: belongs in the URL, not the link label — use [label](view:path) not [view:path]",
callback-box/src/core/markdown-lint-rules.ts:41:  description: "Relative links must point to existing files",
callback-box/src/cli/commands/handle.ts:21:      const result = await runCommand({ name: "handle", args, ctx });
callback-box/src/cli/commands/search.ts:52:        const result = await runCommand({ name: "search", args, ctx });
callback-box/src/cli/commands/search.ts:62:        name: "search",
callback-box/src/core/external-ref.ts:70:function isDeniedRel(rel: string, basename: string): boolean {
callback-box/src/cli/commands/trash.ts:23:        name: "trash",
callback-box/src/core/migrations.ts:19:  readonly name: string;
callback-box/src/core/migrations.ts:25:  { name: "attachments",       script: "scripts/migrate/attachments.ts" },
callback-box/src/core/migrations.ts:26:  { name: "card-frontmatter",  script: "scripts/migrate/card-frontmatter.ts" },
callback-box/src/core/migrations.ts:27:  { name: "email-thread",      script: "scripts/migrate/email-thread.ts" },
callback-box/src/core/migrations.ts:28:  { name: "email-message",     script: "scripts/migrate/email-message.ts" },
callback-box/src/core/migrations.ts:29:  { name: "briefing",          script: "scripts/migrate/briefing.ts" },
callback-box/src/core/migrations.ts:30:  { name: "doc-sheet",         script: "scripts/migrate/doc-sheet.ts" },
callback-box/src/core/migrations.ts:31:  { name: "file",              script: "scripts/migrate/file.ts" },
callback-box/src/core/migrations.ts:32:  { name: "image",             script: "scripts/migrate/image.ts" },
callback-box/src/core/migrations.ts:33:  { name: "audio",             script: "scripts/migrate/audio.ts" },
callback-box/src/core/migrations.ts:34:  { name: "record-person",     script: "scripts/migrate/record-person.ts" },
callback-box/src/core/migrations.ts:35:  { name: "memo",              script: "scripts/migrate/memo.ts" },
callback-box/src/core/migrations.ts:36:  { name: "misc",              script: "scripts/migrate/misc.ts" },
callback-box/src/core/migrations.ts:37:  { name: "jobs",              script: "scripts/migrate/jobs.ts" },
callback-box/src/core/migrations.ts:38:  { name: "personality",       script: "scripts/migrate/personality.ts" },
callback-box/src/core/migrations.ts:39:  { name: "scheduled-script",  script: "scripts/migrate/scheduled-script.ts" },
callback-box/src/core/migrations.ts:40:  { name: "question",          script: "scripts/migrate/question.ts" },
callback-box/src/core/migrations.ts:41:  { name: "chat-thread",       script: "scripts/migrate/chat-thread.ts" },
callback-box/src/core/migrations.ts:42:  { name: "doc-to-gdoc",       script: "scripts/migrate/doc-to-gdoc.ts" },
callback-box/src/core/migrations.ts:43:  { name: "strip-type-field",  script: "scripts/migrate/strip-type-field.ts" },
callback-box/src/core/migrations.ts:44:  { name: "repair-refs",       script: "scripts/migrate/repair-refs.ts" },
callback-box/src/core/migrations.ts:45:  { name: "asset-marker",      script: "scripts/migrate/asset-marker.ts" },
callback-box/src/core/migrations.ts:46:  { name: "webpage-card",      script: "scripts/migrate/webpage-card.ts" },
callback-box/src/core/migrations.ts:47:  { name: "landmark",          script: "scripts/migrate/landmark.ts" },
callback-box/src/core/migrations.ts:48:  { name: "recipe",            script: "scripts/migrate/recipe.ts" },
callback-box/src/core/migrations.ts:49:  { name: "procedure-run",     script: "scripts/migrate/procedure-run.ts" },
callback-box/src/core/migrations.ts:50:  { name: "procedure",         script: "scripts/migrate/procedure.ts" },
callback-box/src/core/migrations.ts:51:  { name: "guide",             script: "scripts/migrate/guide.ts" },
callback-box/src/core/migrations.ts:52:  { name: "capture-session",   script: "scripts/migrate/capture-session.ts" },
callback-box/src/core/migrations.ts:53:  { name: "delete-deprecated-cards", script: "scripts/migrate/delete-deprecated-cards.ts" },
callback-box/src/core/migrations.ts:54:  { name: "bill",              script: "scripts/migrate/bill.ts" },
callback-box/src/core/migrations.ts:60:  readonly name: string;
callback-box/src/core/triage-instructions.ts:25:   * (boxes' top-level `Box.landmark.card`) uses the literal `root`.
callback-box/src/core/triage-instructions.ts:27:  name: string;
callback-box/src/core/triage-instructions.ts:78:  const matches = await glob("**/*.landmark.card", {
callback-box/src/core/triage-instructions.ts:96:      name: deriveCategoryName(normalizedDir),
callback-box/src/cli/commands/prompt.ts:40:        name: "prompt",
callback-box/src/core/box.ts:80:        .map((m) => `${JSON.stringify({ name: m.name, "applied-at": now })}\n`)
callback-box/src/core/box-defaults.ts:53:      f.endsWith(".procedure.card")
callback-box/src/core/box-defaults.ts:107:    const templateContent = createInitialGuideTemplate({ name: domain });
callback-box/src/core/box-defaults.ts:142: * root has no `*.landmark.card` at all.
callback-box/src/core/box-defaults.ts:156:  if (entries.some((name) => name.endsWith(".landmark.card"))) return false;
callback-box/src/core/box-defaults.ts:159:    relPath: "Box.landmark.card",
callback-box/src/core/box-defaults.ts:186:  name: string;
callback-box/src/core/box-defaults.ts:187:  description: string;
callback-box/src/core/box-defaults.ts:201:    name: "check-email",
callback-box/src/core/box-defaults.ts:202:    description: "Pull new emails from Gmail for triage and response",
callback-box/src/core/box-defaults.ts:212:    name: "check-calendar",
callback-box/src/core/box-defaults.ts:213:    description: "Sync Google Calendar events and detect changes",
callback-box/src/core/box-defaults.ts:223:    name: "refresh-maps",
callback-box/src/core/box-defaults.ts:224:    description: "Refresh MAP.md files when files or directories were added/deleted",
callback-box/src/core/box-defaults.ts:233:    name: "gc-procedure-runs",
callback-box/src/core/box-defaults.ts:234:    description:
callback-box/src/core/box-defaults.ts:244:    name: "process-retrospective",
callback-box/src/core/box-defaults.ts:245:    description:
callback-box/src/core/box-defaults.ts:277:      description: sched.description,
callback-box/src/cli/commands/wakeup-steps.ts:354:      description: `Triage ${batch.length} ${opts.label}${batch.length === 1 ? "" : "s"}`,
callback-box/src/core/retro/observer.ts:68:      const agent = createAgent({ name: `retro-observer:${args.sessionId}` });
callback-box/src/core/procedure/engine-types.ts:42:  description: string;
callback-box/src/core/procedure/engine-types.ts:49:  name: string;
callback-box/src/core/procedure/engine-types.ts:50:  description: string;
callback-box/src/core/schedule-health-box.ts:112:        description: undefined,
callback-box/src/core/procedure/engine-step.ts:233:      name: `procedure-${procedure.name}-${step.id}`,
callback-box/src/cli/commands/trick.ts:44:  name: string;
callback-box/src/cli/commands/trick.ts:45:  description: string;
callback-box/src/cli/commands/trick.ts:97:    tricks.push({ name: entry, description, entryPoint });
callback-box/src/cli/commands/trick.ts:105:  name: string;
callback-box/src/cli/commands/trick.ts:142:  .action(async function (this: Command, name: string | undefined) {
callback-box/src/frontend/src/machines/transcription-mic.ts:94:  async start({ step }: { step: (name: string) => void }) {
callback-box/src/cli/commands/scan-import.ts:22:      const result = await runCommand({ name: "scan-import", args, ctx });
callback-box/src/core/procedure/engine.ts:38:    procedureNameOrPath.endsWith(".procedure.card") ||
callback-box/src/core/procedure/engine.ts:46:  // Bare name → config/procedures/<name>.procedure.card
callback-box/src/core/procedure/engine.ts:50:    `${procedureNameOrPath}.procedure.card`
callback-box/src/core/procedure/engine.ts:260:    const cards = files.filter((f) => f.endsWith(".procedure.card"));
callback-box/src/core/procedure/engine.ts:268:      const name = card.replace(".procedure.card", "");
callback-box/src/core/procedure/engine-parse.ts:33:    name: def.name,
callback-box/src/core/procedure/engine-parse.ts:34:    description: def.description ?? "",
callback-box/src/core/procedure/engine-parse.ts:65:  const result: ParsedStep = { id: step.id, description: step.description ?? "" };
callback-box/src/core/chat-session.ts:379:  async setFeature(name: string, value: string): Promise<void> {
callback-box/src/cli/commands/init.ts:90:        console.log("\nInstalled Box.landmark.card (edit to customize the root landmark)");
callback-box/src/core/chat-features.ts:19:  readonly name: string;
callback-box/src/core/chat-features.ts:32:    name: "narration",
callback-box/src/core/chat-features.ts:39:    name: "prose",
callback-box/src/core/chat-features.ts:57:export function getFeature(name: string): FeatureDescriptor | null {
callback-box/src/core/chat-features.ts:62:export function isKnownFeature(name: string): boolean {
callback-box/src/core/chat-features.ts:67:export function isValidValue(name: string, value: string): boolean {
callback-box/src/core/generate-docs.ts:363:    ...allSchemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
callback-box/src/core/generate-docs.ts:365:      name: s.type,
callback-box/src/core/generate-docs.ts:373:    .filter((s): s is { name: string; instructions: string } => s.instructions !== undefined)
callback-box/src/core/handle.ts:6: * <procedure>` element, and invoke that procedure with the bucket of
callback-box/src/core/handle.ts:10: * Inline procedures aren't supported yet — only `<procedure ref=…/>`
callback-box/src/core/handle.ts:11: * pointing at a real `.procedure.card`. Inline-vs-ref carriage is an
callback-box/src/core/handle.ts:42:  /** Box-relative path to the `.procedure.card`. */
callback-box/src/core/python-tools-doc.ts:20:# or, for tools where the CLI name differs from the package name:
callback-box/src/frontend/src/api.ts:52:  name: string;
callback-box/src/frontend/src/ssr/render.tsx:120:  name: string;
callback-box/src/core/agent-types.ts:86:  readonly name: string;
callback-box/src/shared/attach-path.ts:110:export function isLiteralAttachName(name: string): boolean {
callback-box/src/shared/attach-path.ts:118:export function isAttachDirName(name: string): boolean {
callback-box/src/core/command-runner.ts:25:  name: string;
callback-box/src/core/command-runner.ts:27:  description: string;
callback-box/src/core/command-runner.ts:41:  name: string;
callback-box/src/core/command-runner.ts:43:  description: string;
callback-box/src/core/command-runner.ts:66:  constructor(name: string) {
callback-box/src/core/command-runner.ts:88:export function getCommand(name: string): CommandDefinition | undefined {
callback-box/src/core/command-runner.ts:103:  name: string;
callback-box/src/core/commands/intake.ts:13:  name: "intake",
callback-box/src/core/commands/intake.ts:14:  description:
callback-box/src/frontend/src/ssr/setup.ts:36:      pathname: fullPath,
callback-box/src/frontend/src/ssr/state-registry-types.ts:16:  description: string;
callback-box/src/frontend/src/ssr/state-registry-routes.ts:17:        description: "Dashboard with live data from box",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:21:        description: "Empty dashboard — no inbox, no schedules",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:38:        description: "Dashboard with many items",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:48:        description: "Chat with message history",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:52:        description: "Chat with history, not streaming",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:56:        description: "Chat mid-response with partial text",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:60:        description: "Fresh chat — no messages",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:68:        description: "Chat with error banner",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:78:        description: "Voice recording in progress",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:91:        description: "Settings with Claude logged in",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:95:        description: "Settings with Claude not authenticated",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:99:        description: "Settings during auth flow — waiting for OAuth",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:108:        description: "Questions page with live data",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:112:        description: "No pending questions",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:122:        description: "History page with live data",
callback-box/src/frontend/src/ssr/state-registry-routes.ts:131:        description: "Browse page with live data",
callback-box/src/core/commands/wakeup.ts:65:  name: "wakeup",
callback-box/src/core/commands/wakeup.ts:66:  description: "Run the full wakeup cycle (preprocess, triage, connectors, jobs, reactor)",
callback-box/src/cli/commands/migrate.ts:126:        name: m.name,
callback-box/src/cli/commands/migrate.ts:169:      await appendManifestEntry(boxRoot, { name: m.name, "applied-at": new Date().toISOString() });
callback-box/src/cli/lib/lock.ts:30:  hostname: string;
callback-box/src/cli/lib/lock.ts:47:      hostname: holder.hostname,
callback-box/src/cli/lib/lock.ts:72:    hostname: holder.hostname,
callback-box/src/cli/lib/format.ts:100:  phase: (name: string) => chalk.bold.cyan(`=== ${name} ===`),
callback-box/src/core/commands/scan-import-reconcile.ts:100:    description: "",
callback-box/src/webapp/server-root.ts:49:async function listAccessibleBoxes(boxes: BoxSpec[], email: string): Promise<Array<{ slug: string; name: string }>> {
callback-box/src/webapp/server-root.ts:51:  const accessible: Array<{ slug: string; name: string }> = [];
callback-box/src/webapp/server-root.ts:54:      accessible.push({ slug: b.slug, name: b.slug });
callback-box/src/webapp/server-root.ts:60:      accessible.push({ slug: b.slug, name: b.slug });
callback-box/src/webapp/server-root.ts:112:    return { boxes: boxes.map((b) => ({ slug: b.slug, name: b.slug })) };
callback-box/src/cli/lib/git.ts:374:export async function createBranch(boxRoot: string, name: string): Promise<void> {
callback-box/src/cli/lib/git.ts:381:export async function checkoutBranch(boxRoot: string, name: string): Promise<void> {
callback-box/src/cli/lib/git.ts:388:export async function createTag(boxRoot: string, name: string): Promise<void> {
callback-box/src/cli/lib/git.ts:395:export async function deleteTag(boxRoot: string, name: string): Promise<void> {
callback-box/src/cli/lib/paths.ts:165:export function parseCardName(filename: string): { name: string; type: string } | null {
callback-box/src/cli/lib/paths.ts:171:    name: match[1]!,
callback-box/src/cli/lib/paths.ts:183:export function buildCardName(name: string, type: string): string {
callback-box/src/shared/markdoc-config.ts:225:    name: { type: String },
callback-box/src/shared/markdoc-config.ts:312:    name: { type: String },
callback-box/src/webapp/auth.ts:95:  name: string;
callback-box/src/webapp/auth.ts:105:    name: user.name,
callback-box/src/webapp/auth.ts:147:    return { email: data.email, name: data.name || data.email, picture: data.picture };
callback-box/src/core/commands/attachments.ts:239:  name: "attachments",
callback-box/src/core/commands/attachments.ts:240:  description: "Manifest-aware operations on assets (verify, migrate, overwrite, add)",
callback-box/src/core/commands/attachments.ts:243:      name: "subcommand",
callback-box/src/core/commands/attachments.ts:244:      description: "verify | migrate | overwrite | add",
callback-box/src/core/commands/attachments.ts:249:      name: "pathArg",
callback-box/src/core/commands/attachments.ts:250:      description: "Box-relative path (for overwrite, add)",
callback-box/src/core/commands/scan-import-document.ts:44:    filename: "source.pdf",
callback-box/src/core/commands/scan-import-document.ts:76:    description: `Document PDF: ${path.basename(args.pdfPath)}`,
callback-box/src/core/commands/trash.ts:30:  readonly basename: string;
callback-box/src/core/commands/trash.ts:31:  constructor(basename: string) {
callback-box/src/core/commands/trash.ts:224:  name: "trash",
callback-box/src/core/commands/trash.ts:225:  description: "Move one or more cards to the trash directory",
callback-box/src/core/commands/trash.ts:228:      name: "paths",
callback-box/src/core/commands/trash.ts:229:      description: "Paths to the cards to trash",
callback-box/src/core/commands/trash.ts:234:      name: "commit",
callback-box/src/core/commands/trash.ts:235:      description: "Commit the change",
callback-box/src/core/commands/trash.ts:241:      name: "reason",
callback-box/src/core/commands/trash.ts:242:      description: "Reason for trashing (recorded in commit message)",
callback-box/src/core/commands/connector-sync.ts:96:  name: "connector-sync",
callback-box/src/core/commands/connector-sync.ts:97:  description: "Sync data with connectors",
callback-box/src/core/commands/connector-sync.ts:100:      name: "connector",
callback-box/src/core/commands/connector-sync.ts:101:      description: "Only run specific connector",
callback-box/src/core/commands/assemble-timeline.ts:22:  name: "assemble-timeline",
callback-box/src/core/commands/assemble-timeline.ts:23:  description: "Assemble structured transcript from timing data and images",
callback-box/src/frontend/src/components/TodoListView.tsx:18:  name: string;
callback-box/src/frontend/src/components/TodoListView.tsx:25:  name: string;
callback-box/src/frontend/src/components/TodoListView.tsx:55:    name: stringField(raw, "name") ?? "",
callback-box/src/frontend/src/components/TodoListView.tsx:84:    name: stringField(frontmatter, "name") ?? "",
callback-box/src/core/commands/transcribe-captures.ts:53:  name: "transcribe-captures",
callback-box/src/core/commands/transcribe-captures.ts:54:  description: "Transcribe audio in capture sessions with word-level timestamps",
callback-box/src/core/commands/transcribe-captures.ts:60:    let entries: Array<{ name: string; isDirectory: () => boolean }>;
callback-box/src/core/commands/transcribe-captures.ts:132:            filename: audioFilename,
callback-box/src/frontend/src/components/chat/InteractiveChat-sse.ts:135:        const data = event.data as { sessionId: string | null; message: string; user: { email: string; name: string } | null; timestamp: string };
callback-box/src/webapp/routes/auth.ts:103:      const sessionValue = signSession({ email, name: displayName, ...(picture ? { picture } : {}) });
callback-box/src/webapp/routes/auth.ts:147:      name: user.name,
callback-box/src/core/commands/triage.ts:12:  name: "triage",
callback-box/src/core/commands/triage.ts:13:  description:
callback-box/src/core/commands/triage.ts:17:      name: "dryRun",
callback-box/src/core/commands/triage.ts:18:      description: "Print agent decisions without moving files.",
callback-box/src/core/commands/answer.ts:190:    description: `Follow up on answered question: ${fields.prompt}`,
callback-box/src/core/commands/answer.ts:294:  name: "answer",
callback-box/src/core/commands/answer.ts:295:  description: "Answer a pending question",
callback-box/src/core/commands/answer.ts:298:      name: "question",
callback-box/src/core/commands/answer.ts:299:      description: "Question card path (relative to box root)",
callback-box/src/core/commands/answer.ts:304:      name: "answer",
callback-box/src/core/commands/answer.ts:305:      description: "Answer text or option ID (a, b, c, etc.)",
callback-box/src/core/commands/answer.ts:310:      name: "selectedId",
callback-box/src/core/commands/answer.ts:311:      description: "Selected option ID (for select questions)",
callback-box/src/core/commands/answer.ts:316:      name: "via",
callback-box/src/core/commands/answer.ts:317:      description: "Answer source (e.g., 'cli', 'web')",
callback-box/src/frontend/src/components/MarkdownCardView.tsx:86:function FieldRow({ name, value }: { name: string; value: unknown }) {
callback-box/src/core/commands/upload.ts:147:  const result = await runCommand({ name: "scan-import", args: scanArgs, ctx });
callback-box/src/core/commands/upload.ts:222:  name: "upload",
callback-box/src/core/commands/upload.ts:223:  description: "Upload a batch of files to the box (dedup by content hash)",
callback-box/src/core/commands/upload.ts:225:    { name: "files", description: "Files to upload", required: true, type: "string[]" },
callback-box/src/core/commands/upload.ts:226:    { name: "kind", description: "Destination kind (currently: scan)", required: true, type: "string" },
callback-box/src/core/commands/upload.ts:227:    { name: "force", description: "Re-import files already in the ledger", required: false, default: false, type: "boolean" },
callback-box/src/core/commands/upload.ts:228:    { name: "context", description: "Per-batch context passed to the destination handler", required: false, type: "string" },
callback-box/src/core/commands/upload.ts:229:    { name: "limit", description: "Process at most N files (sorted; useful for smoke tests)", required: false, type: "number" },
callback-box/src/frontend/src/components/browse/BrowseSidebarList.tsx:17:function imageDataAttrs(relativePath: string, name: string): Record<string, string> | null {
callback-box/src/frontend/src/components/AppNav.tsx:74:  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
callback-box/src/frontend/src/components/CommitDetail-diff.ts:13:  move?: { basename: string; fromDir: string; toDir: string };
callback-box/src/frontend/src/components/CommitDetail-diff.ts:36:    file.move = { basename: toName, fromDir, toDir };
callback-box/src/frontend/src/components/BoxSelectionTiles.tsx:13:  name: string;
callback-box/src/frontend/src/components/chat/activity-rendering.tsx:90:function toolCategory(name: string): string {
callback-box/src/core/commands/assemble-timeline-helpers.ts:72:): Promise<Array<{ name: string; isDirectory: () => boolean }> | null> {
callback-box/src/frontend/src/components/chat/background-tasks.ts:26:  description: string;
callback-box/src/frontend/src/components/chat/background-tasks.ts:54:    description: event.description ?? existing?.description ?? "Background task",
callback-box/src/webapp/routes/capture-finalize.ts:54:    childBasename: string;
callback-box/src/webapp/routes/capture-finalize.ts:56:    mediaFilename: string;
callback-box/src/webapp/routes/capture-finalize.ts:101:    filename: mediaFilename,
callback-box/src/webapp/routes/capture-finalize.ts:105:    childBasename: audioBasename,
callback-box/src/webapp/routes/capture-finalize.ts:140:      filename: mediaFilename,
callback-box/src/webapp/routes/capture-finalize.ts:144:      childBasename: photoBasename,
callback-box/src/webapp/routes/capture-finalize.ts:176:      filename: mediaFilename,
callback-box/src/webapp/routes/capture-finalize.ts:184:      childBasename: baseWithoutExt,
callback-box/src/webapp/routes/capture-finalize.ts:327:    description: "Process new capture sessions (auto-created by capture finalize)",
callback-box/src/core/commands/create.ts:236:  name: "create",
callback-box/src/core/commands/create.ts:237:  description: "Create a new card from template",
callback-box/src/core/commands/create.ts:240:      name: "path",
callback-box/src/core/commands/create.ts:241:      description: "Path for new card (relative to box root or absolute)",
callback-box/src/core/commands/create.ts:246:      name: "template",
callback-box/src/core/commands/create.ts:247:      description: "Template to use (overrides type-based default)",
callback-box/src/core/commands/create.ts:252:      name: "args",
callback-box/src/core/commands/create.ts:253:      description: "Template arguments as key=value pairs",
callback-box/src/core/commands/create.ts:258:      name: "commit",
callback-box/src/core/commands/create.ts:259:      description: "Commit the new card",
callback-box/src/core/commands/create.ts:265:      name: "attachment",
callback-box/src/core/commands/create.ts:266:      description: "Path to an attachment file",
callback-box/src/core/commands/create.ts:271:      name: "attachmentMimetype",
callback-box/src/core/commands/create.ts:272:      description: "MIME type of the attachment",
callback-box/src/frontend/src/components/chat/user-message.tsx:223:function MessageFileChip({ name }: { name: string }) {
callback-box/src/core/commands/move.ts:284:  name: "move",
callback-box/src/core/commands/move.ts:285:  description: "Move/rename cards or directories and update all references",
callback-box/src/core/commands/move.ts:288:      name: "from",
callback-box/src/core/commands/move.ts:289:      description: "Path(s) to the card(s) or directory to move",
callback-box/src/core/commands/move.ts:294:      name: "to",
callback-box/src/core/commands/move.ts:295:      description: "Destination path (file or directory)",
callback-box/src/core/commands/move.ts:300:      name: "commit",
callback-box/src/core/commands/move.ts:301:      description: "Commit the change",
callback-box/src/core/commands/move.ts:307:      name: "dryRun",
callback-box/src/core/commands/move.ts:308:      description: "Show what would happen without doing it",
callback-box/src/webapp/routes/actions.ts:88:    const result = await runCommand({ name: "connector-sync", args: { dryRun }, ctx });
callback-box/src/webapp/routes/actions.ts:153:      name: "answer",
callback-box/src/webapp/routes/actions.ts:215:      name: "create",
callback-box/src/webapp/routes/actions.ts:290:      name: "create",
callback-box/src/core/commands/describe-images.ts:162:    filename: {
callback-box/src/core/commands/describe-images.ts:211:  noRename: boolean | undefined;
callback-box/src/core/commands/describe-images.ts:293:  name: "describe-images",
callback-box/src/core/commands/describe-images.ts:294:  description: "Analyze images using Gemini Flash (OCR, description, titles)",
callback-box/src/core/commands/describe-images.ts:297:      name: "paths",
callback-box/src/core/commands/describe-images.ts:298:      description: "Image files (.jpg/.png) or image cards (.image.card)",
callback-box/src/core/commands/describe-images.ts:303:      name: "noRename",
callback-box/src/core/commands/describe-images.ts:304:      description: "Skip renaming files to descriptive names",
callback-box/src/frontend/src/components/FileView.tsx:196:  onSelect: (name: string) => void;
callback-box/src/frontend/src/components/FileView.tsx:224:  onSelect: (name: string) => void;
callback-box/src/frontend/src/components/FileView.tsx:251:  onSelect: (name: string) => void;
callback-box/src/frontend/src/components/FileView.tsx:285:  const [userSelection, setUserSelection] = useState<{ path: string; name: string } | null>(null);
callback-box/src/frontend/src/components/FileView.tsx:286:  const selectForPath = useCallback((name: string) => {
callback-box/src/frontend/src/components/FileView.tsx:307:    return [{ name: binding.name, Component: Bound, priority: 100 }, ...base];
callback-box/src/frontend/src/components/CardTreeView.tsx:57:function getAttrColor(name: string): string {
callback-box/src/core/commands/search.ts:70:  name: "search",
callback-box/src/core/commands/search.ts:71:  description: "Full-text search over the box's cards",
callback-box/src/core/commands/search.ts:73:    { name: "query", description: "Search terms", required: true, type: "string" },
callback-box/src/core/commands/search.ts:74:    { name: "kinds", description: "Restrict to card types", required: false, type: "string[]" },
callback-box/src/core/commands/search.ts:75:    { name: "path", description: "Restrict to a box-relative path prefix", required: false, type: "string" },
callback-box/src/core/commands/search.ts:76:    { name: "limit", description: "Maximum results (default 10)", required: false, type: "number" },
callback-box/src/core/commands/search.ts:77:    { name: "rebuild", description: "Rebuild the index from scratch", required: false, type: "boolean" },
callback-box/src/frontend/src/components/dashboard/ScheduleOverview.tsx:53:function EnableToggle({ name, enabled }: { name: string; enabled: boolean }) {
callback-box/src/frontend/src/components/dashboard/ScheduleOverview.tsx:72:function TriggerButton({ name, enabled }: { name: string; enabled: boolean }) {
callback-box/src/core/commands/handle.ts:13:  name: "handle",
callback-box/src/core/commands/handle.ts:14:  description:
callback-box/src/core/commands/handle.ts:18:      name: "category",
callback-box/src/core/commands/handle.ts:19:      description: "Only handle this category. Defaults to all non-empty buckets.",
callback-box/src/webapp/routes/commands.ts:58:    const result = await runCommand({ name: command, args: args ?? {}, ctx });
callback-box/src/webapp/routes/commands.ts:93:        name: cmd.name,
callback-box/src/webapp/routes/commands.ts:94:        description: cmd.description,
callback-box/src/webapp/routes/commands.ts:101:  server.get<{ Params: { name: string } }>(
callback-box/src/webapp/routes/commands.ts:109:        name: cmd.name,
callback-box/src/webapp/routes/commands.ts:110:        description: cmd.description,
callback-box/src/webapp/routes/commands.ts:180:        const result = await runCommand({ name: command, args: args ?? {}, ctx });
callback-box/src/core/commands/scan-import.ts:275:    description: intakeDescription,
callback-box/src/core/commands/scan-import.ts:298:  name: "scan-import",
callback-box/src/core/commands/scan-import.ts:299:  description: "Import an image batch as photo image cards, or a PDF as a document, into box/inbox/scan-…/",
callback-box/src/core/commands/scan-import.ts:302:      name: "inputs",
callback-box/src/core/commands/scan-import.ts:303:      description: "PDF (one) or image files (many) — absolute or relative to box root",
callback-box/src/core/commands/scan-import.ts:308:      name: "context",
callback-box/src/core/commands/scan-import.ts:309:      description: "Extra context appended to CLAUDE_SCANS.md content for this run",
callback-box/src/webapp/routes/scheduler.ts:121:          name: scriptName,
callback-box/src/webapp/routes/scheduler.ts:122:          description: undefined,
callback-box/src/webapp/routes/scheduler.ts:166:        name: scriptName,
callback-box/src/webapp/routes/scheduler.ts:167:        description: parsed.description,
callback-box/src/webapp/routes/capture-session-store.ts:20:  name: string;
callback-box/src/webapp/routes/api-adapters.ts:28:  authHeader: (key: string) => [name: string, value: string];
callback-box/src/webapp/routes/api-adapters.ts:119:function singleHeader(request: FastifyRequest, name: string): string | undefined {
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:17:  name: string;
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:18:  description: string | undefined;
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:38:    name: scriptName,
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:39:    description: undefined,
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:100:    name: scriptName,
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:101:    description: parsed.description,
callback-box/src/webapp/trpc/routers/actions.ts:23:        const result = await runCommand({ name: "connector-sync", args: { dryRun: input.dryRun }, ctx: cmdCtx });
callback-box/src/webapp/trpc/routers/actions.ts:77:        name: "answer",
callback-box/src/webapp/trpc/routers/actions.ts:117:        name: "create",
callback-box/src/webapp/trpc/routers/chat.ts:50:function readChildText(navigation: ElementNode | null, tagName: string): string {
callback-box/src/webapp/trpc/routers/chat.ts:61:  navigation: ElementNode | null,
callback-box/src/webapp/trpc/routers/chat.ts:91:  const matches = await glob("**/*.landmark.card", {
callback-box/src/webapp/trpc/routers/chat.ts:117:      label: readChildText(navigation, "label") || path.basename(relPath, ".landmark.card"),
callback-box/src/webapp/trpc/routers/landmarks.ts:4: * Reads every `**\/*.landmark.card` in the box, parses its frontmatter,
callback-box/src/webapp/trpc/routers/landmarks.ts:50:  navigation: LandmarkNavigationData | undefined,
callback-box/src/webapp/trpc/routers/landmarks.ts:62:    const matches = await glob("**/*.landmark.card", {
callback-box/src/webapp/routes/chat-uploads.ts:26:function sanitizeFilename(name: string): string {
callback-box/src/core/commands/scan-import-gemini.ts:24:  description: string;
callback-box/src/core/commands/scan-import-gemini.ts:41:  description: string;
callback-box/src/core/commands/scan-import-gemini.ts:71:   - description: one sentence describing what's in the photo (subjects, setting, era cues if visible).
callback-box/src/core/commands/scan-import-gemini.ts:79:   - description: empty string — backs don't get descriptions of their own.
callback-box/src/core/commands/scan-import-gemini.ts:101:      description: { type: "STRING" },
callback-box/src/core/commands/scan-import-session.ts:24:  sessionBasename: string;
callback-box/src/core/commands/scan-import-session.ts:30:  sessionCardFilename: string;
callback-box/src/webapp/routes/chat-last-audio-routes.ts:46:  name: string
callback-box/src/webapp/trpc/routers/health.ts:19:  name: string;
callback-box/src/webapp/trpc/routers/health.ts:128:    name: "inbox-writable",
callback-box/src/webapp/trpc/routers/health.ts:140:    name: "git-writable",
callback-box/src/webapp/trpc/routers/health.ts:152:    name: "connectors-writable",
callback-box/src/webapp/trpc/routers/health.ts:164:    name: "archive-writable",
callback-box/src/webapp/trpc/routers/health.ts:180:      name: "mistral-api-key",
callback-box/src/webapp/trpc/routers/health.ts:190:      name: "deepgram-credentials",
callback-box/src/webapp/trpc/routers/health.ts:200:      name: "openai-api-key",
callback-box/src/webapp/trpc/routers/health.ts:213:    name: "openai-api-key",
callback-box/src/webapp/trpc/routers/health.ts:226:    name: "gemini-api-key",
callback-box/src/webapp/trpc/routers/health.ts:251:      name: "claude-credentials",
callback-box/src/webapp/trpc/routers/admin.ts:46:        botUsername: me.username,
callback-box/src/webapp/trpc/routers/admin.ts:106:            botUsername: me.username,
callback-box/src/webapp/trpc/routers/admin.ts:116:        botUsername: me.username,
callback-box/src/webapp/views/compiler.ts:33:  name: "react-external",
callback-box/src/webapp/views/compiler.ts:60:function slugFromFilename(filename: string): string {
callback-box/src/webapp/views/compiler.ts:89:    name: extractString("name") || slug,
callback-box/src/webapp/views/compiler.ts:91:    description: extractString("description") || "",
callback-box/src/webapp/views/compiler.ts:183:        name: slug,
callback-box/src/webapp/views/compiler.ts:185:        description: "Failed to compile",
callback-box/src/frontend/src/components/ui/Avatar.tsx:14:  name: string | null;
callback-box/src/core/commands/ls.ts:135:  name: "ls",
callback-box/src/core/commands/ls.ts:136:  description: "List cards with optional frontmatter-field template extraction",
callback-box/src/core/commands/ls.ts:139:      name: "paths",
callback-box/src/core/commands/ls.ts:140:      description: "Glob patterns or directories to list",
callback-box/src/core/commands/ls.ts:145:      name: "format",
callback-box/src/core/commands/ls.ts:146:      description:
callback-box/src/webapp/routes/capture.ts:100:        console.error(`[capture] No file data in upload for session ${session.id}, filename: ${filename}`);
callback-box/src/webapp/routes/capture.ts:108:      name: filename,
callback-box/src/core/commands/scan-import-helpers.ts:308:    description: raw.description,
callback-box/src/webapp/routes/chat-send-routes.ts:194:      user: user ? { email: user.email, name: user.name } : null,
callback-box/src/webapp/trpc/routers/scheduler.ts:33:      name: string;
callback-box/src/webapp/trpc/routers/scheduler.ts:98:      name: z.string().min(1),
callback-box/src/webapp/trpc/routers/scheduler.ts:138:      name: z.string().min(1),
callback-box/src/webapp/trpc/routers/scheduler.ts:155:      await checkTriggerPreconditions({ boxRoot: ctx.boxRoot, name: input.name, parsed });
callback-box/src/webapp/trpc/routers/scheduler.ts:157:      return runScheduledScript({ boxRoot: ctx.boxRoot, name: input.name, parsed });
callback-box/src/webapp/trpc/routers/scheduler-run.ts:21:  name: string;
callback-box/src/webapp/trpc/routers/scheduler-run.ts:65:  name: string;
callback-box/src/webapp/routes/admin.ts:189:        botUsername: me.username,
callback-box/src/webapp/routes/admin.ts:239:          botUsername: me.username,
callback-box/src/webapp/routes/admin.ts:249:      botUsername: me.username,
callback-box/src/core/commands/describe-images-helpers.ts:179:  description: string;
callback-box/src/core/commands/describe-images-helpers.ts:224:1. description: one sentence describing what's in the image — visual, suitable as alt text.
callback-box/src/core/commands/describe-images-helpers.ts:266:            description: { type: "STRING" },
callback-box/src/core/commands/scan-import-cards.ts:64:  let backFilename: string | null = null;
callback-box/src/core/commands/scan-import-cards.ts:74:    filename: photoFilename,
callback-box/src/core/commands/procedure.ts:17:  name: "procedure-run",
callback-box/src/core/commands/procedure.ts:18:  description: "Run a procedure by name or path",
callback-box/src/core/commands/procedure.ts:21:      name: "name",
callback-box/src/core/commands/procedure.ts:24:      description: "Procedure name (e.g., process-captures) or path to .procedure.card",
callback-box/src/core/commands/procedure.ts:27:      name: "dryRun",
callback-box/src/core/commands/procedure.ts:31:      description: "Preview without executing",
callback-box/src/core/commands/procedure.ts:34:      name: "force",
callback-box/src/core/commands/procedure.ts:38:      description: "Force even if another process is running",
callback-box/src/core/commands/procedure.ts:41:      name: "step",
callback-box/src/core/commands/procedure.ts:44:      description: "Run only this step, skip all others",
callback-box/src/core/commands/procedure.ts:47:      name: "directive",
callback-box/src/core/commands/procedure.ts:50:      description: "Directive string passed to procedure agents",
callback-box/src/core/commands/procedure.ts:74:  name: "procedure-list",
callback-box/src/core/commands/procedure.ts:75:  description: "List available procedure definitions",
callback-box/src/core/commands/procedure.ts:83:  name: "procedure-gc",
callback-box/src/core/commands/procedure.ts:84:  description: "Delete expired procedure run directories",
callback-box/src/core/commands/procedure.ts:92:  name: "procedure-status",
callback-box/src/core/commands/procedure.ts:93:  description: "Show status of a procedure run",
callback-box/src/core/commands/procedure.ts:96:      name: "runDir",
callback-box/src/core/commands/procedure.ts:99:      description: "Run directory (defaults to latest)",
callback-box/src/core/commands/describe-images-card.ts:39:export async function markCardInvalid(cardPath: string, description: string): Promise<void> {
callback-box/src/core/commands/describe-images-card.ts:151:      name: "move",
callback-box/src/core/commands/describe-images-card.ts:159:    ctx.writeLine(`  Warning: Failed to rename: ${(err as Error).message}`);
callback-box/src/frontend/src/components/ui/fields-radio.tsx:77:  name: string;
callback-box/src/webapp/trpc/routers/commands.ts:16:        name: cmd.name,
callback-box/src/webapp/trpc/routers/commands.ts:17:        description: cmd.description,
callback-box/src/webapp/trpc/routers/commands.ts:24:    .input(z.object({ name: z.string().min(1) }))
callback-box/src/webapp/trpc/routers/commands.ts:30:      return { name: cmd.name, description: cmd.description, args: cmd.args };
callback-box/src/webapp/trpc/routers/commands.ts:53:      const result = await runCommand({ name: input.command, args: input.args, ctx: cmdCtx });
callback-box/src/webapp/trpc/routers/status.ts:12:  name: string;
callback-box/src/webapp/trpc/routers/status.ts:18:  name: string;
callback-box/src/webapp/trpc/routers/status.ts:29:  name: string;
callback-box/src/webapp/trpc/routers/status.ts:87:      let entries: Array<{ name: string; isDirectory: () => boolean }>;
callback-box/src/webapp/trpc/routers/status.ts:132:          dirs.push({ name: entry.name, fileCount });
callback-box/src/webapp/trpc/routers/status.ts:151:              name: parsed.name,
callback-box/src/webapp/trpc/routers/status.ts:161:            cards.push({ relativePath, name: parsed.name, type: parsed.type, tagName: "unknown", hasAttachments });
callback-box/src/webapp/trpc/routers/status.ts:167:        files.push({ relativePath, name: entry.name });
callback-box/src/webapp/routes/api-browse.ts:17:  name: string;
callback-box/src/webapp/routes/api-browse.ts:50:      let entries: Array<{ name: string; isDirectory: () => boolean }>;
callback-box/src/webapp/routes/api-browse.ts:106:            name: parsed.name,
callback-box/src/webapp/routes/api-browse.ts:116:            name: parsed.name,
callback-box/src/webapp/trpc/routers/drive.ts:72:        name: file.name,

codex
Both schemas are definitely frontmatter schemas now: `LandmarkSchema` and `ProcedureSchema` are `cardSchema(...)` exports in `cardSchemas[]`. Also note the plan’s wording “procedure cards silently degrade to empty” is inaccurate: the current code logs a warning and returns placeholder names/descriptions.
exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/parser/parse.ts | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/parser/frontmatter.ts | sed -n '1,110p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Frontmatter stripping for .card files.
     3	 *
     4	 * Cards may optionally begin with a YAML frontmatter block delimited by
     5	 * `---` fences. cardworks does not parse the YAML — that responsibility
     6	 * lives with the host application (callback-box). cardworks only needs
     7	 * to locate the body and report a line offset so XML error locations
     8	 * line up with the original file.
     9	 *
    10	 *   ---
    11	 *   content-type: application/x-card+xml
    12	 *   ---
    13	 *   <root>...</root>
    14	 *
    15	 * If no frontmatter is present, the input is returned unchanged with
    16	 * lineOffset 0.
    17	 */
    18	
    19	/**
    20	 * Result of splitting a card's text into frontmatter prefix and body.
    21	 */
    22	export interface SplitCardContent {
    23	  /** Raw frontmatter text (between the fences, no fences). Empty string if no frontmatter. */
    24	  frontmatterText: string;
    25	  /** Body text (everything after the closing fence). Equals input if no frontmatter. */
    26	  body: string;
    27	  /** Number of lines preceding the body in the original input. */
    28	  lineOffset: number;
    29	  /** Whether a well-formed frontmatter block was found. */
    30	  hasFrontmatter: boolean;
    31	}
    32	
    33	const FRONTMATTER_BLOCK = /^---\r?\n([\S\s]*?)\r?\n---\r?\n/;
    34	
    35	/**
    36	 * Split a .card file's raw text into optional frontmatter and body.
    37	 *
    38	 * Only detects the block; does not parse the YAML inside it.
    39	 */
    40	export function splitCardContent(content: string): SplitCardContent {
    41	  const match = FRONTMATTER_BLOCK.exec(content);
    42	  if (!match) {
    43	    return {
    44	      frontmatterText: "",
    45	      body: content,
    46	      lineOffset: 0,
    47	      hasFrontmatter: false,
    48	    };
    49	  }
    50	  const prefixLength = match[0].length;
    51	  const frontmatterText = match[1] === undefined ? "" : match[1];
    52	  const body = content.slice(prefixLength);
    53	  let lineOffset = 0;
    54	  for (let i = 0; i < prefixLength; i++) {
    55	    if (content.codePointAt(i) === 10) {
    56	      lineOffset++;
    57	    }
    58	  }
    59	  return {
    60	    frontmatterText,
    61	    body,
    62	    lineOffset,
    63	    hasFrontmatter: true,
    64	  };
    65	}

 succeeded in 0ms:
     1	import { DOMParser } from "@xmldom/xmldom";
     2	import type { ElementNode, Location } from "./provenance.js";
     3	import { domToObject, createLineTracker } from "./dom-to-object.js";
     4	import { splitCardContent } from "./frontmatter.js";
     5	
     6	/**
     7	 * Options for parseXml.
     8	 *
     9	 * `lineOffset` shifts reported line numbers so a caller that parses only the
    10	 * body of a frontmatter-prefixed file still gets locations relative to the
    11	 * original file. The number of lines preceding the body — for a file whose
    12	 * body starts on file-line N, pass `lineOffset: N - 1`.
    13	 */
    14	export interface ParseXmlOptions {
    15	  source: string;
    16	  lineOffset?: number;
    17	}
    18	
    19	/**
    20	 * Location details for a {@link ParseError}.
    21	 */
    22	export interface ParseErrorLocation {
    23	  source: string;
    24	  line?: number | undefined;
    25	  column?: number | undefined;
    26	}
    27	
    28	/**
    29	 * Error thrown when XML parsing fails.
    30	 */
    31	export class ParseError extends Error {
    32	  public readonly location: Location;
    33	
    34	  constructor(message: string, { source, line, column }: ParseErrorLocation) {
    35	    const loc = line ? `${source}:${String(line)}:${String(column ?? 1)}` : source;
    36	    super(`${loc}: ${message}`);
    37	    this.name = "ParseError";
    38	    this.location = {
    39	      source,
    40	      startLine: line ?? 0,
    41	      startColumn: column ?? 0,
    42	      endLine: line ?? 0,
    43	      endColumn: column ?? 0,
    44	    };
    45	  }
    46	}
    47	
    48	/**
    49	 * Parse XML content into an ElementNode tree.
    50	 *
    51	 * @param xml - The XML string to parse
    52	 * @param options - Source identifier and optional line offset
    53	 * @returns The parsed ElementNode tree
    54	 * @throws ParseError if the XML is malformed
    55	 */
    56	export function parseXml(xml: string, options: ParseXmlOptions): Promise<ElementNode> {
    57	  const source = options.source;
    58	  const lineOffset = options.lineOffset === undefined ? 0 : options.lineOffset;
    59	  const shift = (line: number | undefined): number | undefined =>
    60	    line === undefined ? undefined : line + lineOffset;
    61	
    62	  const errors: Array<{ message: string; line?: number; column?: number }> = [];
    63	
    64	  const parser = new DOMParser({
    65	    onError: (level, msg): void => {
    66	      if (level === "warning") {
    67	        // Ignore warnings
    68	        return;
    69	      }
    70	      errors.push({ message: msg });
    71	    },
    72	  });
    73	
    74	  let doc;
    75	  try {
    76	    doc = parser.parseFromString(xml, "text/xml");
    77	  } catch (e) {
    78	    // xmldom throws directly for fatal errors
    79	    const err = e as Error & { locator?: { lineNumber?: number; columnNumber?: number } };
    80	    return Promise.reject(
    81	      new ParseError(err.message, {
    82	        source,
    83	        line: shift(err.locator?.lineNumber),
    84	        column: err.locator?.columnNumber,
    85	      })
    86	    );
    87	  }
    88	
    89	  // Check for parsing errors collected by onError
    90	  if (errors.length > 0) {
    91	    const firstError = errors[0];
    92	    return Promise.reject(
    93	      new ParseError(firstError?.message ?? "Unknown parse error", {
    94	        source,
    95	        line: shift(firstError?.line),
    96	        column: firstError?.column,
    97	      })
    98	    );
    99	  }
   100	
   101	  // Find the root element
   102	  const root = doc.documentElement;
   103	  if (!root) {
   104	    const message = "No root element found";
   105	    return Promise.reject(new ParseError(message, { source }));
   106	  }
   107	
   108	  // Create line tracker for location
   109	  const tracker = createLineTracker(xml, { source, lineOffset });
   110	
   111	  // Transform to our object model
   112	  const result = domToObject(root as unknown as Element, { tracker, xml });
   113	
   114	  // Validate version format if present (version itself is optional)
   115	  const version = result.attrs["version"];
   116	  if (version) {
   117	    const versionPattern = /^\d+\.\d+\.\d+$/;
   118	    if (!versionPattern.test(version)) {
   119	      const message = `Invalid version "${version}" - must be in X.Y.Z format (e.g., "1.0.0")`;
   120	      return Promise.reject(
   121	        new ParseError(message, {
   122	          source,
   123	          line: result.location.startLine,
   124	          column: result.location.startColumn,
   125	        })
   126	      );
   127	    }
   128	  }
   129	
   130	  return Promise.resolve(result);
   131	}
   132	
   133	/**
   134	 * Parse XML from a file using a filesystem.
   135	 */
   136	export async function parseXmlFile(
   137	  fs: { read(path: string): Promise<string> },
   138	  path: string
   139	): Promise<ElementNode> {
   140	  const content = await fs.read(path);
   141	  return parseCard(content, { source: path });
   142	}
   143	
   144	/**
   145	 * Parse a `.card` file's text content.
   146	 *
   147	 * Strips optional YAML frontmatter (delimited by `---` fences) before
   148	 * parsing the body as XML. cardworks does not interpret the frontmatter;
   149	 * callers that need its values must parse it themselves.
   150	 */
   151	export function parseCard(content: string, options: ParseXmlOptions): Promise<ElementNode> {
   152	  const baseOffset = options.lineOffset === undefined ? 0 : options.lineOffset;
   153	  const split = splitCardContent(content);
   154	  return parseXml(split.body, {
   155	    source: options.source,
   156	    lineOffset: baseOffset + split.lineOffset,
   157	  });
   158	}

exec
/opt/homebrew/bin/bash -lc "rg -n \"parseCard\\(|splitCardContent|content-type\" cardworks/src/parser cardworks/test/parser.test.ts cardworks/test/fixtures -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
cardworks/test/parser.test.ts:3:import { splitCardContent } from "../src/parser/frontmatter.js";
cardworks/test/parser.test.ts:199:test("splitCardContent returns input unchanged when no frontmatter", (t) => {
cardworks/test/parser.test.ts:200:  const r = splitCardContent("<root/>");
cardworks/test/parser.test.ts:207:test("splitCardContent peels off a frontmatter block", (t) => {
cardworks/test/parser.test.ts:208:  const r = splitCardContent("---\ncontent-type: application/x-card+xml\n---\n<root/>\n");
cardworks/test/parser.test.ts:210:  t.equal(r.frontmatterText, "content-type: application/x-card+xml");
cardworks/test/parser.test.ts:217:  const text = "---\ncontent-type: application/x-card+xml\n---\n<root version=\"1.0.0\">\n  <child>hi</child>\n</root>\n";
cardworks/test/parser.test.ts:218:  const result = await parseCard(text, { source: "frontmattered.card" });
cardworks/test/parser.test.ts:228:  const result = await parseCard(text, { source: "plain.card" });
cardworks/src/parser/frontmatter.ts:11: *   content-type: application/x-card+xml
cardworks/src/parser/frontmatter.ts:40:export function splitCardContent(content: string): SplitCardContent {
cardworks/src/parser/parse.ts:4:import { splitCardContent } from "./frontmatter.js";
cardworks/src/parser/parse.ts:141:  return parseCard(content, { source: path });
cardworks/src/parser/parse.ts:151:export function parseCard(content: string, options: ParseXmlOptions): Promise<ElementNode> {
cardworks/src/parser/parse.ts:153:  const split = splitCardContent(content);

codex
`parseCard` does strip frontmatter before XML parsing, so a frontmatter card with no XML body fails as “no root element,” which matches the broken landmark/procedure diagnosis. The exception handling behavior, though, differs between the two paths and should be stated precisely.
exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/refs/resolve.ts | sed -n '1,280p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/refs/parse-ref.ts | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	import type { ParsedRef, RefFragment } from "./types.js";
     2	
     3	/**
     4	 * Parse a reference string into its components.
     5	 *
     6	 * Reference format: path[@version][#fragment]
     7	 *
     8	 * Examples:
     9	 * - ./Other.card
    10	 * - ./Other.card@1.0.0
    11	 * - ./Other.card#section
    12	 * - ./Other.card@1.0.0#section
    13	 * - ./Other.card#query(//element)
    14	 * - /absolute/path.card@2.0.0#id
    15	 *
    16	 * @param ref - The reference string to parse
    17	 * @returns The parsed reference structure
    18	 */
    19	/**
    20	 * Parse a whitespace-separated list of references.
    21	 *
    22	 * Used for the `refs` attribute which can contain multiple references.
    23	 *
    24	 * @param refs - The refs string (whitespace-separated references)
    25	 * @returns Array of parsed references
    26	 */
    27	export function parseRefs(refs: string): ParsedRef[] {
    28	  return refs
    29	    .split(/\s+/)
    30	    .filter((s) => s.length > 0)
    31	    .map((ref) => parseRef(ref));
    32	}
    33	
    34	export function parseRef(ref: string): ParsedRef {
    35	  let remaining = ref;
    36	  let fragment: RefFragment | undefined;
    37	  let version: string | undefined;
    38	
    39	  // Extract fragment (after #)
    40	  const fragmentIndex = remaining.indexOf("#");
    41	  if (fragmentIndex !== -1) {
    42	    const fragmentStr = remaining.slice(fragmentIndex + 1);
    43	    remaining = remaining.slice(0, fragmentIndex);
    44	    fragment = parseFragment(fragmentStr);
    45	  }
    46	
    47	  // Extract version (after @)
    48	  const versionIndex = remaining.lastIndexOf("@");
    49	  if (versionIndex !== -1) {
    50	    // Make sure @ is not part of a path (e.g., not in the middle of a filename)
    51	    const afterAt = remaining.slice(versionIndex + 1);
    52	    // Version should look like a version string (starts with digit or has version-like pattern)
    53	    if (/^\d/.test(afterAt) || /^v\d/.test(afterAt)) {
    54	      version = afterAt;
    55	      remaining = remaining.slice(0, versionIndex);
    56	    }
    57	  }
    58	
    59	  const path = remaining;
    60	  const isAbsolute = path.startsWith("/");
    61	
    62	  return {
    63	    path,
    64	    isAbsolute,
    65	    version,
    66	    fragment,
    67	    original: ref,
    68	  };
    69	}
    70	
    71	/**
    72	 * Parse a fragment string into its structure.
    73	 */
    74	function parseFragment(fragmentStr: string): RefFragment {
    75	  // Check for query-all(...) syntax (must check before query())
    76	  if (fragmentStr.startsWith("query-all(") && fragmentStr.endsWith(")")) {
    77	    return {
    78	      type: "query-all",
    79	      value: fragmentStr.slice(10, -1), // Extract content between query-all( and )
    80	    };
    81	  }
    82	
    83	  // Check for query(...) syntax
    84	  if (fragmentStr.startsWith("query(") && fragmentStr.endsWith(")")) {
    85	    return {
    86	      type: "query",
    87	      value: fragmentStr.slice(6, -1), // Extract content between query( and )
    88	    };
    89	  }
    90	
    91	  // Otherwise treat as ID
    92	  return {
    93	    type: "id",
    94	    value: fragmentStr,
    95	  };
    96	}
    97	
    98	export type { ParsedRef, RefFragment };

 succeeded in 0ms:
     1	import type { FileSystem } from "../fs/types.js";
     2	import type { ElementNode } from "../parser/provenance.js";
     3	import { parseCard } from "../parser/parse.js";
     4	import { parseRef, parseRefs } from "./parse-ref.js";
     5	import { executeXPath } from "./xpath.js";
     6	import type { ResolvedRef, ParsedRef, RefFragment } from "./types.js";
     7	
     8	/**
     9	 * Resolve multiple references from a whitespace-separated refs string.
    10	 *
    11	 * @param refs - The refs attribute value (whitespace-separated references)
    12	 * @param resolver - The resolver context
    13	 * @returns Array of resolved references
    14	 */
    15	export async function resolveRefs(
    16	  refs: string,
    17	  resolver: RefResolver
    18	): Promise<ResolvedRef[]> {
    19	  const parsedRefs = parseRefs(refs);
    20	  const results: ResolvedRef[] = [];
    21	
    22	  for (const parsed of parsedRefs) {
    23	    const resolved = await resolveRef(parsed.original, resolver);
    24	    results.push(resolved);
    25	  }
    26	
    27	  return results;
    28	}
    29	
    30	/**
    31	 * Context for resolving references.
    32	 */
    33	export interface RefResolver {
    34	  /** Filesystem to use for reading files */
    35	  fs: FileSystem;
    36	  /** Root directory of the project */
    37	  projectRoot: string;
    38	  /** Path of the file containing the reference */
    39	  currentFile: string;
    40	}
    41	
    42	/**
    43	 * Resolve a reference string to its target.
    44	 *
    45	 * @param ref - The reference string to resolve
    46	 * @param resolver - The resolver context
    47	 * @returns The resolved reference result
    48	 */
    49	export async function resolveRef(
    50	  ref: string,
    51	  resolver: RefResolver
    52	): Promise<ResolvedRef> {
    53	  const parsed = parseRef(ref);
    54	
    55	  // Resolve the path
    56	  const resolvedPath = resolvePath(parsed, resolver);
    57	
    58	  // Check if file exists
    59	  const exists = await resolver.fs.exists(resolvedPath);
    60	
    61	  if (!exists) {
    62	    return {
    63	      original: ref,
    64	      parsed,
    65	      resolvedPath,
    66	      exists: false,
    67	      error: `File not found: ${resolvedPath}`,
    68	      versionMismatch: false,
    69	    };
    70	  }
    71	
    72	  // Load and parse the target file
    73	  let targetNode: ElementNode;
    74	  try {
    75	    const content = await resolver.fs.read(resolvedPath);
    76	    targetNode = await parseCard(content, { source: resolvedPath });
    77	  } catch (e) {
    78	    return {
    79	      original: ref,
    80	      parsed,
    81	      resolvedPath,
    82	      exists: true,
    83	      error: `Failed to parse ${resolvedPath}: ${e instanceof Error ? e.message : String(e)}`,
    84	      versionMismatch: false,
    85	    };
    86	  }
    87	
    88	  // Extract version from target
    89	  const actualVersion = targetNode.attrs["version"];
    90	
    91	  // Check version mismatch
    92	  const versionMismatch =
    93	    parsed.version !== undefined &&
    94	    actualVersion !== undefined &&
    95	    parsed.version !== actualVersion;
    96	
    97	  // Resolve fragment if specified
    98	  let fragment: ElementNode | undefined;
    99	  let fragments: ElementNode[] | undefined;
   100	  let fragmentError: string | undefined;
   101	  let fragmentWarning: string | undefined;
   102	
   103	  if (parsed.fragment) {
   104	    const fragmentResult = resolveFragment(parsed.fragment, targetNode);
   105	
   106	    if (fragmentResult.error) {
   107	      fragmentError = fragmentResult.error;
   108	    } else if (fragmentResult.warning) {
   109	      fragmentWarning = fragmentResult.warning;
   110	    }
   111	
   112	    if (parsed.fragment.type === "query-all") {
   113	      fragments = fragmentResult.nodes;
   114	      if (fragments.length === 0 && !fragmentError) {
   115	        fragmentWarning = `No elements matched query-all: #query-all(${parsed.fragment.value})`;
   116	      }
   117	    } else {
   118	      // id or query - expect single result
   119	      fragment = fragmentResult.nodes[0];
   120	      if (!fragment && !fragmentError) {
   121	        fragmentError = `Fragment not found: ${formatFragment(parsed.fragment)}`;
   122	      }
   123	    }
   124	  }
   125	
   126	  const result: ResolvedRef = {
   127	    original: ref,
   128	    parsed,
   129	    resolvedPath,
   130	    exists: true,
   131	    requestedVersion: parsed.version,
   132	    actualVersion,
   133	    versionMismatch,
   134	  };
   135	
   136	  // Add optional fields only if defined
   137	  if (fragment !== undefined) {
   138	    result.fragment = fragment;
   139	  }
   140	  if (fragments !== undefined) {
   141	    result.fragments = fragments;
   142	  }
   143	  if (fragmentError !== undefined) {
   144	    result.fragmentError = fragmentError;
   145	  }
   146	  if (fragmentWarning !== undefined) {
   147	    result.fragmentWarning = fragmentWarning;
   148	  }
   149	
   150	  return result;
   151	}
   152	
   153	/**
   154	 * Format a fragment for error messages.
   155	 */
   156	function formatFragment(fragment: RefFragment): string {
   157	  switch (fragment.type) {
   158	    case "id":
   159	      return `#${fragment.value}`;
   160	    case "query":
   161	      return `#query(${fragment.value})`;
   162	    case "query-all":
   163	      return `#query-all(${fragment.value})`;
   164	  }
   165	}
   166	
   167	/**
   168	 * Resolve a path from a parsed reference.
   169	 *
   170	 * The path part of a ref is one of:
   171	 * - Absolute (`/box/...`) — resolved against project root
   172	 * - `attach/<rest>` — virtual prefix; resolved against the current card's
   173	 *   attach scope (`<basename>.attach/`)
   174	 * - Relative — resolved from the current file's directory
   175	 */
   176	function resolvePath(parsed: ParsedRef, resolver: RefResolver): string {
   177	  if (parsed.isAbsolute) {
   178	    return resolver.projectRoot + parsed.path;
   179	  }
   180	
   181	  // `attach/` virtual prefix — resolve against the current card's
   182	  // <basename>.attach/ scope.
   183	  if (parsed.path === "attach" || parsed.path.startsWith("attach/")) {
   184	    const attachDir = computeAttachDir(resolver.currentFile);
   185	    if (attachDir !== null) {
   186	      const rest = parsed.path === "attach" ? "" : parsed.path.slice("attach/".length);
   187	      return rest === "" ? attachDir : `${attachDir}/${rest}`;
   188	    }
   189	  }
   190	
   191	  return resolver.fs.resolve(resolver.currentFile, parsed.path);
   192	}
   193	
   194	/**
   195	 * Given a card's absolute path, return its attach scope directory:
   196	 * `<basename>.attach` next to the card. Returns null if the path doesn't
   197	 * look like a `.card` file.
   198	 */
   199	function computeAttachDir(cardPath: string): string | null {
   200	  const slash = cardPath.lastIndexOf("/");
   201	  const dir = slash === -1 ? "" : cardPath.slice(0, slash);
   202	  const name = slash === -1 ? cardPath : cardPath.slice(slash + 1);
   203	  if (!name.endsWith(".card")) return null;
   204	  const withoutCard = name.slice(0, -".card".length);
   205	  const lastDot = withoutCard.lastIndexOf(".");
   206	  const basename = lastDot === -1 ? withoutCard : withoutCard.slice(0, lastDot);
   207	  const attachName = `${basename}.attach`;
   208	  return dir === "" ? attachName : `${dir}/${attachName}`;
   209	}
   210	
   211	/**
   212	 * Result of resolving a fragment.
   213	 */
   214	interface FragmentResult {
   215	  nodes: ElementNode[];
   216	  error?: string;
   217	  warning?: string;
   218	}
   219	
   220	/**
   221	 * Resolve a fragment within a parsed document.
   222	 */
   223	function resolveFragment(fragment: RefFragment, root: ElementNode): FragmentResult {
   224	  if (fragment.type === "id") {
   225	    const node = findById(root, fragment.value);
   226	    return { nodes: node ? [node] : [] };
   227	  }
   228	
   229	  // XPath query
   230	  const expectOne = fragment.type === "query";
   231	  const xpathResult = executeXPath(fragment.value, { root, expectOne });
   232	
   233	  const result: FragmentResult = { nodes: xpathResult.nodes };
   234	  if (xpathResult.error !== undefined) {
   235	    result.error = xpathResult.error;
   236	  }
   237	  if (xpathResult.warning !== undefined) {
   238	    result.warning = xpathResult.warning;
   239	  }
   240	  return result;
   241	}
   242	
   243	/**
   244	 * Find an element by its id attribute.
   245	 */
   246	function findById(node: ElementNode, id: string): ElementNode | undefined {
   247	  if (node.attrs["id"] === id) {
   248	    return node;
   249	  }
   250	
   251	  for (const child of node.children) {
   252	    const found = findById(child, id);
   253	    if (found) {
   254	      return found;
   255	    }
   256	  }
   257	
   258	  return undefined;
   259	}
   260	
   261	export type { ResolvedRef };

exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/loader/path-utils.ts | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Internal path manipulation helpers for the card loader.
     3	 *
     4	 * These operate on POSIX-style "/"-separated paths (the canonical form used
     5	 * throughout cardworks), independent of the host platform's path separator.
     6	 */
     7	
     8	/**
     9	 * Get the directory portion of a path.
    10	 */
    11	export function dirname(path: string): string {
    12	  const lastSlash = path.lastIndexOf("/");
    13	  return lastSlash === -1 ? "." : path.slice(0, lastSlash);
    14	}
    15	
    16	/**
    17	 * Get the filename portion of a path.
    18	 */
    19	export function basename(path: string): string {
    20	  const lastSlash = path.lastIndexOf("/");
    21	  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
    22	}
    23	
    24	/**
    25	 * Get the extension of a filename (including the dot).
    26	 */
    27	export function extname(filename: string): string {
    28	  const lastDot = filename.lastIndexOf(".");
    29	  return lastDot === -1 ? "" : filename.slice(lastDot);
    30	}
    31	
    32	/**
    33	 * Get the shared basename of a card/attachment pair.
    34	 *
    35	 * Cards are named `Name.type.card` and their sibling attachments are named
    36	 * `Name.ext` (e.g. `photo-001.image.card` + `photo-001.jpg`). To detect the
    37	 * pair we need to treat "Name" as the shared stem — which means stripping
    38	 * BOTH `.type` and `.card` for card files, but only the single extension for
    39	 * non-card files.
    40	 */
    41	export function sharedStem(filename: string): string {
    42	  if (filename.endsWith(".card")) {
    43	    const withoutCard = filename.slice(0, -".card".length);
    44	    const lastDot = withoutCard.lastIndexOf(".");
    45	    return lastDot === -1 ? withoutCard : withoutCard.slice(0, lastDot);
    46	  }
    47	  const ext = extname(filename);
    48	  return ext ? filename.slice(0, -ext.length) : filename;
    49	}
    50	
    51	/**
    52	 * Compute relative path from a directory to a file.
    53	 * Unlike relativePath, this takes a directory, not a file path.
    54	 */
    55	export function relative(from: string, to: string): string {
    56	  const fromParts = from.split("/").filter(Boolean);
    57	  const toParts = to.split("/").filter(Boolean);
    58	
    59	  // Find common prefix
    60	  let commonLength = 0;
    61	  while (
    62	    commonLength < fromParts.length &&
    63	    commonLength < toParts.length &&
    64	    fromParts[commonLength] === toParts[commonLength]
    65	  ) {
    66	    commonLength++;
    67	  }
    68	
    69	  // Build relative path
    70	  const upCount = fromParts.length - commonLength;
    71	  const downParts = toParts.slice(commonLength);
    72	
    73	  const parts: string[] = [];
    74	  for (let i = 0; i < upCount; i++) {
    75	    parts.push("..");
    76	  }
    77	  parts.push(...downParts);
    78	
    79	  return parts.join("/") || ".";
    80	}
    81	
    82	/**
    83	 * Compute relative path from one file to another.
    84	 */
    85	export function relativePath(from: string, to: string): string {
    86	  const fromParts = dirname(from).split("/").filter(Boolean);
    87	  const toParts = to.split("/").filter(Boolean);
    88	  const toFilename = toParts.pop() ?? "";
    89	
    90	  // Find common prefix
    91	  let commonLength = 0;
    92	  while (
    93	    commonLength < fromParts.length &&
    94	    commonLength < toParts.length &&
    95	    fromParts[commonLength] === toParts[commonLength]
    96	  ) {
    97	    commonLength++;
    98	  }
    99	
   100	  // Build relative path
   101	  const upCount = fromParts.length - commonLength;
   102	  const downParts = toParts.slice(commonLength);
   103	
   104	  const parts: string[] = [];
   105	  for (let i = 0; i < upCount; i++) {
   106	    parts.push("..");
   107	  }
   108	  parts.push(...downParts, toFilename);
   109	
   110	  const result = parts.join("/");
   111	  return result.startsWith(".") ? result : "./" + result;
   112	}

exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/loader/loader.ts | sed -n '1,260p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	import type { FileSystem } from "../fs/types.js";
     2	import type { ElementNode } from "../parser/provenance.js";
     3	import { parseCard } from "../parser/parse.js";
     4	import { serialize as serializeElement } from "../serialize/serialize.js";
     5	import { resolveRef, resolveRefs, type ResolvedRef } from "../refs/resolve.js";
     6	import { NodeFileSystem } from "../fs/node-fs.js";
     7	import { MemoryFileSystem } from "../fs/memory-fs.js";
     8	import { SchemaRegistry } from "../schema/registry.js";
     9	import { formatValidationError } from "../schema/format-error.js";
    10	import type { ZodError } from "zod";
    11	import { type Card, createCard } from "../card/card.js";
    12	import { basename, dirname, extname, sharedStem } from "./path-utils.js";
    13	import {
    14	  collectRefsFromNode,
    15	  updateRefsInNode,
    16	  type RefTraversalContext,
    17	} from "./ref-traversal.js";
    18	import type {
    19	  CardLoaderOptions,
    20	  CardReference,
    21	  ICardLoader,
    22	  MemoryCardLoaderOptions,
    23	  MoveResult,
    24	} from "./types.js";
    25	
    26	export type {
    27	  CardLoaderOptions,
    28	  CardReference,
    29	  ICardLoader,
    30	  MemoryCardLoaderOptions,
    31	  MoveResult,
    32	} from "./types.js";
    33	
    34	/**
    35	 * Details for a {@link ValidationError}.
    36	 */
    37	export interface ValidationErrorOptions {
    38	  path: string;
    39	  tagName: string;
    40	  zodError: ZodError;
    41	}
    42	
    43	/**
    44	 * Error thrown when card validation fails.
    45	 */
    46	export class ValidationError extends Error {
    47	  public readonly path: string;
    48	  public readonly tagName: string;
    49	  public readonly zodError: ZodError;
    50	
    51	  constructor(message: string, { path, tagName, zodError }: ValidationErrorOptions) {
    52	    super(message);
    53	    this.name = "ValidationError";
    54	    this.path = path;
    55	    this.tagName = tagName;
    56	    this.zodError = zodError;
    57	  }
    58	}
    59	
    60	/**
    61	 * Error thrown when a move would change a card's file extension.
    62	 */
    63	class ExtensionChangeError extends Error {
    64	  constructor(
    65	    public readonly fromExt: string,
    66	    public readonly toExt: string
    67	  ) {
    68	    super(`Cannot change extension from "${fromExt}" to "${toExt}"`);
    69	    this.name = "ExtensionChangeError";
    70	  }
    71	}
    72	
    73	/**
    74	 * Constructor arguments for {@link BaseCardLoader}, grouping the filesystem
    75	 * and loader options that come after the positional `projectRoot`.
    76	 */
    77	interface BaseCardLoaderArgs {
    78	  fs: FileSystem;
    79	  options?: CardLoaderOptions;
    80	}
    81	
    82	/**
    83	 * Base implementation of card loader with reference resolution.
    84	 */
    85	abstract class BaseCardLoader implements ICardLoader {
    86	  protected readonly schemas: SchemaRegistry;
    87	  protected readonly requireVersion: boolean;
    88	  protected readonly indent: boolean;
    89	  protected readonly fs: FileSystem;
    90	
    91	  constructor(
    92	    protected readonly projectRoot: string,
    93	    { fs, options }: BaseCardLoaderArgs
    94	  ) {
    95	    this.fs = fs;
    96	    options = options ?? {};
    97	    if (options.schemas instanceof SchemaRegistry) {
    98	      this.schemas = options.schemas;
    99	    } else if (Array.isArray(options.schemas)) {
   100	      this.schemas = new SchemaRegistry(options.schemas);
   101	    } else {
   102	      this.schemas = new SchemaRegistry();
   103	    }
   104	    this.requireVersion = options.requireVersion ?? false;
   105	    this.indent = options.indent ?? false;
   106	  }
   107	
   108	  /**
   109	   * Get serialization options based on loader configuration.
   110	   */
   111	  protected getSerializeOptions(): { indent: string } {
   112	    return { indent: this.indent ? "  " : "" };
   113	  }
   114	
   115	  /**
   116	   * Prepare element for serialization, adding version if required.
   117	   * Returns a shallow copy if modification is needed.
   118	   */
   119	  protected prepareForSave(element: ElementNode): ElementNode {
   120	    if (this.requireVersion && !element.attrs["version"]) {
   121	      // Create shallow copy with version added
   122	      return {
   123	        ...element,
   124	        attrs: { version: "1.0.0", ...element.attrs },
   125	      };
   126	    }
   127	    return element;
   128	  }
   129	
   130	  /**
   131	   * Serialize an element to XML string using the loader's options.
   132	   * Adds version if requireVersion is true and element has no version.
   133	   * Uses indent setting to format output.
   134	   *
   135	   * @param element - The ElementNode to serialize
   136	   * @returns The XML string
   137	   */
   138	  serialize(element: ElementNode): string {
   139	    const prepared = this.prepareForSave(element);
   140	    return serializeElement(prepared, this.getSerializeOptions());
   141	  }
   142	
   143	  /**
   144	   * Load a card from a file path.
   145	   * If a schema is registered for the card's tag name, the card is validated.
   146	   *
   147	   * @param path - The absolute path to the card file
   148	   * @returns The loaded Card
   149	   * @throws ValidationError if validation fails
   150	   */
   151	  async load(path: string): Promise<Card> {
   152	    const content = await this.fs.read(path);
   153	    const node = await parseCard(content, { source: path });
   154	
   155	    // Validate against schema if registered
   156	    const schema = this.schemas.get(node.tagName);
   157	    if (schema) {
   158	      const result = schema.safeParse(node);
   159	      if (!result.success) {
   160	        const formatted = formatValidationError(result.error, node);
   161	        const message = `${path}: Validation failed for <${node.tagName}>:\n${formatted}`;
   162	        throw new ValidationError(message, { path, tagName: node.tagName, zodError: result.error });
   163	      }
   164	    }
   165	
   166	    // Use serialized content as snapshot for consistent dirty comparison
   167	    // Note: uses default serialize options (not loader options) since Card.isDirty()
   168	    // compares against serializeElement() with default options
   169	    const snapshot = serializeElement(node);
   170	    return createCard(path, { element: node, fs: this.fs, snapshot });
   171	  }
   172	
   173	  /**
   174	   * Save a card to its file path.
   175	   *
   176	   * @param card - The Card to serialize and write
   177	   */
   178	  async save(card: Card): Promise<void> {
   179	    const element = this.prepareForSave(card.element);
   180	    const content = serializeElement(element, this.getSerializeOptions());
   181	    await this.fs.write(card.path, content);
   182	  }
   183	
   184	  /**
   185	   * Save a card to a different path, returning a new Card.
   186	   *
   187	   * @param card - The Card to save
   188	   * @param newPath - The new path to save to
   189	   * @returns A new Card instance with the new path
   190	   */
   191	  async saveAs(card: Card, newPath: string): Promise<Card> {
   192	    const element = this.prepareForSave(card.element);
   193	    const content = serializeElement(element, this.getSerializeOptions());
   194	    await this.fs.write(newPath, content);
   195	    return createCard(newPath, { element: card.element, fs: this.fs, snapshot: content });
   196	  }
   197	
   198	  /**
   199	   * Resolve a reference from a given source file.
   200	   *
   201	   * @param ref - The reference string (e.g., "./Other.card@1.0.0#section")
   202	   * @param fromPath - The path of the file containing the reference
   203	   * @returns The resolved reference result
   204	   */
   205	  async resolveRef(ref: string, fromPath: string): Promise<ResolvedRef> {
   206	    return resolveRef(ref, {
   207	      fs: this.fs,
   208	      projectRoot: this.projectRoot,
   209	      currentFile: fromPath,
   210	    });
   211	  }
   212	
   213	  /**
   214	   * Resolve multiple references from a refs attribute value.
   215	   *
   216	   * @param refs - Whitespace-separated reference strings
   217	   * @param fromPath - The path of the file containing the references
   218	   * @returns Array of resolved reference results
   219	   */
   220	  async resolveRefs(refs: string, fromPath: string): Promise<ResolvedRef[]> {
   221	    return resolveRefs(refs, {
   222	      fs: this.fs,
   223	      projectRoot: this.projectRoot,
   224	      currentFile: fromPath,
   225	    });
   226	  }
   227	
   228	  /**
   229	   * Check if a card file exists.
   230	   *
   231	   * @param path - The absolute path to check
   232	   * @returns Whether the file exists
   233	   */
   234	  async exists(path: string): Promise<boolean> {
   235	    return this.fs.exists(path);
   236	  }
   237	
   238	  /**
   239	   * Get the project root directory.
   240	   */
   241	  getProjectRoot(): string {
   242	    return this.projectRoot;
   243	  }
   244	
   245	  /**
   246	   * Check if a schema is registered for a given tag name.
   247	   */
   248	  hasSchema(tagName: string): boolean {
   249	    return this.schemas.has(tagName);
   250	  }
   251	
   252	  /**
   253	   * Check if any schemas are registered.
   254	   */
   255	  hasAnySchemas(): boolean {
   256	    return !this.schemas.isEmpty();
   257	  }
   258	
   259	  /**
   260	   * Validate XML content in memory without writing to disk.

exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/fs/node-fs.ts | sed -n '1,140p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/loader/loader.ts | sed -n '260,560p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	import * as fs from "node:fs/promises";
     2	import * as path from "node:path";
     3	import type { FileSystem } from "./types.js";
     4	import { GLOB_SKIP_DIRS } from "./glob-skip.js";
     5	
     6	/**
     7	 * Context for a recursive directory walk, invariant across the recursion.
     8	 */
     9	interface WalkDirOptions {
    10	  basePath: string;
    11	  pattern: RegExp;
    12	  results: string[];
    13	}
    14	
    15	/**
    16	 * Node.js filesystem implementation.
    17	 */
    18	export class NodeFileSystem implements FileSystem {
    19	  async read(filePath: string): Promise<string> {
    20	    return fs.readFile(filePath, "utf-8");
    21	  }
    22	
    23	  async readBinary(filePath: string): Promise<Uint8Array> {
    24	    const buffer = await fs.readFile(filePath);
    25	    return new Uint8Array(buffer);
    26	  }
    27	
    28	  async write(filePath: string, content: string): Promise<void> {
    29	    // Ensure directory exists
    30	    const dir = path.dirname(filePath);
    31	    await fs.mkdir(dir, { recursive: true });
    32	    await fs.writeFile(filePath, content, "utf-8");
    33	  }
    34	
    35	  async exists(filePath: string): Promise<boolean> {
    36	    try {
    37	      await fs.access(filePath);
    38	      return true;
    39	    } catch (e) {
    40	      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    41	        console.warn(`exists: access failed for ${filePath}`, e);
    42	      }
    43	      return false;
    44	    }
    45	  }
    46	
    47	  async list(dirPath: string): Promise<string[]> {
    48	    try {
    49	      return await fs.readdir(dirPath);
    50	    } catch (e) {
    51	      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    52	        console.warn(`list: readdir failed for ${dirPath}`, e);
    53	      }
    54	      return [];
    55	    }
    56	  }
    57	
    58	  async glob(basePath: string, pattern: string): Promise<string[]> {
    59	    const results: string[] = [];
    60	
    61	    // Convert glob pattern to regex using placeholders
    62	    let regexPattern = pattern;
    63	
    64	    // First, protect ** and * with placeholders (using unlikely strings)
    65	    regexPattern = regexPattern.replace(/\*\*\//g, "<<GLOBSTARSLASH>>");
    66	    regexPattern = regexPattern.replace(/\*\*/g, "<<GLOBSTAR>>");
    67	    regexPattern = regexPattern.replace(/\*/g, "<<STAR>>");
    68	    regexPattern = regexPattern.replace(/\?/g, "<<QUESTION>>");
    69	
    70	    // Escape regex special chars
    71	    regexPattern = regexPattern.replace(/[$()+.[\\\]^{|}]/g, "\\$&");
    72	
    73	    // Replace placeholders with regex equivalents
    74	    regexPattern = regexPattern.replace(/<<GLOBSTARSLASH>>/g, "(.*/)?");
    75	    regexPattern = regexPattern.replace(/<<GLOBSTAR>>/g, ".*");
    76	    regexPattern = regexPattern.replace(/<<STAR>>/g, "[^/]*");
    77	    regexPattern = regexPattern.replace(/<<QUESTION>>/g, "[^/]");
    78	
    79	    // regexPattern is derived solely from the glob `pattern` via the controlled
    80	    // placeholder substitutions above, with all regex-special chars escaped, so
    81	    // it cannot inject arbitrary regex syntax.
    82	    // eslint-disable-next-line security/detect-non-literal-regexp
    83	    const regex = new RegExp(`^${regexPattern}$`);
    84	
    85	    // Recursively walk the directory
    86	    await this.walkDir(basePath, { basePath, pattern: regex, results });
    87	
    88	    return results.toSorted();
    89	  }
    90	
    91	  private async walkDir(
    92	    currentPath: string,
    93	    { basePath, pattern, results }: WalkDirOptions
    94	  ): Promise<void> {
    95	    let entries: string[];
    96	    try {
    97	      entries = await fs.readdir(currentPath);
    98	    } catch (e) {
    99	      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   100	        console.warn(`walkDir: readdir failed for ${currentPath}`, e);
   101	      }
   102	      return;
   103	    }
   104	
   105	    for (const entry of entries) {
   106	      const fullPath = path.join(currentPath, entry);
   107	      const relativePath = path.relative(basePath, fullPath);
   108	
   109	      try {
   110	        const stat = await fs.stat(fullPath);
   111	        if (stat.isDirectory()) {
   112	          if (!GLOB_SKIP_DIRS.has(entry)) {
   113	            await this.walkDir(fullPath, { basePath, pattern, results });
   114	          }
   115	        } else if (stat.isFile()) {
   116	          if (pattern.test(relativePath)) {
   117	            results.push(fullPath);
   118	          }
   119	        }
   120	      } catch (e) {
   121	        // Skip files we can't stat; a vanished/inaccessible entry is expected.
   122	        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   123	          console.warn(`walkDir: stat failed for ${fullPath}`, e);
   124	        }
   125	      }
   126	    }
   127	  }
   128	
   129	  async move(from: string, to: string): Promise<void> {
   130	    // Ensure target directory exists
   131	    const dir = path.dirname(to);
   132	    await fs.mkdir(dir, { recursive: true });
   133	    await fs.rename(from, to);
   134	  }
   135	
   136	  resolve(base: string, relative: string): string {
   137	    if (path.isAbsolute(relative)) {
   138	      return relative;
   139	    }
   140	    const baseDir = path.dirname(base);

 succeeded in 0ms:
   260	   * Validate XML content in memory without writing to disk.
   261	   */
   262	  async validateContent(content: string, sourceName?: string): Promise<ElementNode> {
   263	    sourceName = sourceName ?? "<inline>";
   264	    const node = await parseCard(content, { source: sourceName });
   265	
   266	    const schema = this.schemas.get(node.tagName);
   267	    if (schema) {
   268	      const result = schema.safeParse(node);
   269	      if (!result.success) {
   270	        const formatted = formatValidationError(result.error, node);
   271	        const message = `${sourceName}: Validation failed for <${node.tagName}>:\n${formatted}`;
   272	        throw new ValidationError(message, { path: sourceName, tagName: node.tagName, zodError: result.error });
   273	      }
   274	    }
   275	
   276	    return node;
   277	  }
   278	
   279	  /**
   280	   * Move/rename a card and update all references to it.
   281	   *
   282	   * @param card - The Card to move
   283	   * @param to - The new absolute path for the card
   284	   * @returns The updated Card and information about moved files and updated references
   285	   * @throws Error if extension changes
   286	   */
   287	  async move(card: Card, to: string): Promise<{ card: Card; result: MoveResult }> {
   288	    const from = card.path;
   289	
   290	    // Validate extension hasn't changed
   291	    const fromExt = extname(basename(from));
   292	    const toExt = extname(basename(to));
   293	    if (fromExt !== toExt) {
   294	      throw new ExtensionChangeError(fromExt, toExt);
   295	    }
   296	
   297	    const result: MoveResult = {
   298	      movedFiles: [],
   299	      updatedCards: [],
   300	    };
   301	
   302	    // Find related files sharing the card's stem.
   303	    // Cards are named `Name.type.card` and pair with `Name.ext` attachments;
   304	    // the shared stem is `Name`. sharedStem() strips `.type.card` for .card
   305	    // files and a single extension for everything else.
   306	    const fromDir = dirname(from);
   307	    const toDir = dirname(to);
   308	    const fromStem = sharedStem(basename(from));
   309	    const toStem = sharedStem(basename(to));
   310	
   311	    const filesInDir = await this.fs.list(fromDir);
   312	    const relatedFiles: Array<{ from: string; to: string }> = [];
   313	
   314	    for (const filename of filesInDir) {
   315	      if (sharedStem(filename) !== fromStem) continue;
   316	      const suffix = filename.slice(fromStem.length); // e.g. ".image.card" or ".jpg"
   317	      const fromPath = `${fromDir}/${filename}`;
   318	      const toPath = `${toDir}/${toStem}${suffix}`;
   319	      relatedFiles.push({ from: fromPath, to: toPath });
   320	    }
   321	
   322	    // Find all card files and update references
   323	    const cardFiles = await this.listCards();
   324	
   325	    for (const cardPath of cardFiles) {
   326	      // Skip the card being moved (we'll move it, not update refs in it)
   327	      if (cardPath === from) continue;
   328	
   329	      try {
   330	        const content = await this.fs.read(cardPath);
   331	        const node = await parseCard(content, { source: cardPath });
   332	
   333	        const refsUpdated = await updateRefsInNode(node, {
   334	          ctx: this.refContext(),
   335	          cardPath,
   336	          oldPath: from,
   337	          newPath: to,
   338	        });
   339	
   340	        if (refsUpdated > 0) {
   341	          await this.fs.write(cardPath, serializeElement(node, this.getSerializeOptions()));
   342	          result.updatedCards.push({ path: cardPath, refsUpdated });
   343	        }
   344	      } catch (e) {
   345	        // Skip cards that can't be parsed (malformed XML, etc.)
   346	        console.warn(`Skipping card that could not be processed: ${cardPath}`, e);
   347	        continue;
   348	      }
   349	    }
   350	
   351	    // Now move all the related files
   352	    for (const file of relatedFiles) {
   353	      await this.fs.move(file.from, file.to);
   354	      result.movedFiles.push(file);
   355	    }
   356	
   357	    // Return a new Card with the updated path
   358	    const element = this.prepareForSave(card.element);
   359	    const content = serializeElement(element, this.getSerializeOptions());
   360	    const newCard = createCard(to, { element: card.element, fs: this.fs, snapshot: content });
   361	
   362	    return { card: newCard, result };
   363	  }
   364	
   365	  /**
   366	   * List all card files in the project.
   367	   */
   368	  async listCards(): Promise<string[]> {
   369	    return this.fs.glob(this.projectRoot, "**/*.card");
   370	  }
   371	
   372	  /**
   373	   * Find all references pointing to a given card (incoming links / backlinks).
   374	   *
   375	   * @param targetPath - The absolute path of the card to find references to
   376	   * @returns Array of references from other cards to the target
   377	   */
   378	  async findIncomingRefs(targetPath: string): Promise<CardReference[]> {
   379	    const results: CardReference[] = [];
   380	    const cardFiles = await this.listCards();
   381	
   382	    for (const cardPath of cardFiles) {
   383	      // Skip the target card itself
   384	      if (cardPath === targetPath) continue;
   385	
   386	      try {
   387	        const content = await this.fs.read(cardPath);
   388	        const node = await parseCard(content, { source: cardPath });
   389	        const refs = await collectRefsFromNode(node, { ctx: this.refContext(), cardPath });
   390	
   391	        // Filter to refs that point to the target
   392	        for (const ref of refs) {
   393	          if (ref.toPath === targetPath) {
   394	            results.push(ref);
   395	          }
   396	        }
   397	      } catch (e) {
   398	        // Skip cards that can't be parsed
   399	        console.warn(`Skipping card that could not be processed: ${cardPath}`, e);
   400	      }
   401	    }
   402	
   403	    return results;
   404	  }
   405	
   406	  /**
   407	   * Find all references from a given card (outgoing links).
   408	   *
   409	   * @param sourcePath - The absolute path of the card to find references from
   410	   * @returns Array of references from this card to other cards
   411	   */
   412	  async findOutgoingRefs(sourcePath: string): Promise<CardReference[]> {
   413	    const content = await this.fs.read(sourcePath);
   414	    const node = await parseCard(content, { source: sourcePath });
   415	    return collectRefsFromNode(node, { ctx: this.refContext(), cardPath: sourcePath });
   416	  }
   417	
   418	  /**
   419	   * Build the context passed to the reference-traversal helpers.
   420	   */
   421	  private refContext(): RefTraversalContext {
   422	    return { fs: this.fs, projectRoot: this.projectRoot };
   423	  }
   424	}
   425	
   426	/**
   427	 * Card loader for the real filesystem.
   428	 *
   429	 * @example
   430	 * ```typescript
   431	 * const loader = new CardLoader("/path/to/project", {
   432	 *   schemas: [RecipeSchema, IngredientSchema],
   433	 * });
   434	 * const card = await loader.load("/path/to/project/cards/Recipe.card");
   435	 * ```
   436	 */
   437	export class CardLoader extends BaseCardLoader {
   438	  constructor(projectRoot: string, options?: CardLoaderOptions) {
   439	    super(projectRoot, { fs: new NodeFileSystem(), options: options ?? {} });
   440	  }
   441	}
   442	
   443	/**
   444	 * Card loader with in-memory filesystem, useful for testing.
   445	 *
   446	 * @example
   447	 * ```typescript
   448	 * const loader = new MemoryCardLoader("/project", {
   449	 *   files: {
   450	 *     "/project/cards/Recipe.card": `<recipe version="1.0.0">...</recipe>`,
   451	 *   },
   452	 *   schemas: [RecipeSchema],
   453	 * });
   454	 * const card = await loader.load("/project/cards/Recipe.card");
   455	 * ```
   456	 */
   457	export class MemoryCardLoader extends BaseCardLoader {
   458	  private memoryFs: MemoryFileSystem;
   459	
   460	  constructor(projectRoot: string, options?: MemoryCardLoaderOptions) {
   461	    options = options ?? {};
   462	    const memoryFs = new MemoryFileSystem(options.files ?? {});
   463	    super(projectRoot, { fs: memoryFs, options });
   464	    this.memoryFs = memoryFs;
   465	  }
   466	
   467	  /**
   468	   * Set a file's content directly.
   469	   */
   470	  setFile(path: string, content: string): void {
   471	    this.memoryFs.setFile(path, content);
   472	  }
   473	}

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/rewrite-card-refs.ts | sed -n '1,280p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Resolution-based ref rewriting for `cb mv`.
     3	 *
     4	 * The old move path did a blind box-root-relative substring replace, which
     5	 * only caught refs written as the full box-root path. Refs written *relative*
     6	 * to the referencing card — the common form for inline markdown links and for
     7	 * sibling/parent refs — slipped through, leaving dangling links after a move.
     8	 *
     9	 * This module instead *resolves* every ref it finds against the card that
    10	 * holds it (the same way the renderer and `cb validate` resolve them), asks a
    11	 * caller-supplied `remap` whether that resolved target is moving, and if so
    12	 * rewrites the ref in whatever style it was written — box-root-absolute
    13	 * (`/box/…`) stays absolute, everything else is re-expressed relative to the
    14	 * card. The `attach/` virtual prefix is scoped to its owning card and is left
    15	 * untouched.
    16	 *
    17	 * Three ref-bearing forms are covered, matching the conventions the rest of
    18	 * the system uses:
    19	 *  - frontmatter `ref:` scalar and `refs:` list entries (block, inline, or a
    20	 *    one-line scalar),
    21	 *  - body `ref="…"` attributes (Markdoc body tags like `{% source %}`, and —
    22	 *    harmlessly, since remap gates every change — XML `ref=` attributes),
    23	 *  - inline markdown links and images: `[text](path)`, `![alt](path)`.
    24	 *
    25	 * Over-matching is safe: a candidate that doesn't resolve to a remapped target
    26	 * is returned unchanged, so scanning the whole text with loose patterns can't
    27	 * corrupt non-ref content.
    28	 */
    29	
    30	import * as path from "node:path";
    31	import { isAttachRef, resolveAttachRef } from "../shared/attach-path.js";
    32	
    33	/**
    34	 * Decide where a resolved target moves to. Receives an absolute path; returns
    35	 * the absolute destination, or `null` if the target isn't moving.
    36	 */
    37	export type Remap = (resolvedAbsPath: string) => string | null;
    38	
    39	/** Split a ref's path from a trailing `#fragment` (anchor / message id). */
    40	function splitFragment(ref: string): { pathPart: string; fragment: string } {
    41	  const fragmentStart = ref.indexOf("#");
    42	  if (fragmentStart === -1) return { pathPart: ref, fragment: "" };
    43	  return { pathPart: ref.slice(0, fragmentStart), fragment: ref.slice(fragmentStart) };
    44	}
    45	
    46	/**
    47	 * Resolve a ref's path part to an absolute filesystem path, using the same
    48	 * rules as the renderer: leading `/` is box-root-absolute, `attach/` resolves
    49	 * into the card's own attach scope, everything else is relative to the card.
    50	 * Returns `null` for refs we don't resolve (empty, protocol URLs).
    51	 */
    52	function resolveRefToAbs(params: {
    53	  boxRoot: string;
    54	  cardAbsPath: string;
    55	  pathPart: string;
    56	}): string | null {
    57	  const { boxRoot, cardAbsPath, pathPart } = params;
    58	  if (pathPart === "") return null;
    59	  if (pathPart.includes("://")) return null;
    60	  if (pathPart.startsWith("/")) {
    61	    return path.normalize(path.join(boxRoot, pathPart));
    62	  }
    63	  if (isAttachRef(pathPart)) {
    64	    const resolved = resolveAttachRef(cardAbsPath, pathPart);
    65	    return resolved === null ? null : path.normalize(resolved);
    66	  }
    67	  return path.resolve(path.dirname(cardAbsPath), pathPart);
    68	}
    69	
    70	/**
    71	 * Re-express a moved target as a ref string from `cardAbsPath`, preserving the
    72	 * original ref's absolute-vs-relative style and trailing fragment.
    73	 */
    74	function restyleRef(params: {
    75	  boxRoot: string;
    76	  cardAbsPath: string;
    77	  newAbs: string;
    78	  wasAbsolute: boolean;
    79	  fragment: string;
    80	}): string {
    81	  const { boxRoot, cardAbsPath, newAbs, wasAbsolute, fragment } = params;
    82	  const body = wasAbsolute
    83	    ? "/" + path.relative(boxRoot, newAbs)
    84	    : path.relative(path.dirname(cardAbsPath), newAbs);
    85	  return body + fragment;
    86	}
    87	
    88	/** A per-ref transform: given a raw ref token, return it unchanged or rewritten. */
    89	type RefTransform = (rawRef: string) => string;
    90	
    91	/**
    92	 * Build the transform used for cards *other* than the one being moved: resolve
    93	 * each ref against this card, and if it points at a remapped target, restyle
    94	 * it to the new location.
    95	 */
    96	function transformForReferrer(params: {
    97	  boxRoot: string;
    98	  cardAbsPath: string;
    99	  remap: Remap;
   100	}): RefTransform {
   101	  const { boxRoot, cardAbsPath, remap } = params;
   102	  return (rawRef) => {
   103	    const { pathPart, fragment } = splitFragment(rawRef);
   104	    const abs = resolveRefToAbs({ boxRoot, cardAbsPath, pathPart });
   105	    if (abs === null) return rawRef;
   106	    const newAbs = remap(abs);
   107	    if (newAbs === null) return rawRef;
   108	    return restyleRef({
   109	      boxRoot,
   110	      cardAbsPath,
   111	      newAbs,
   112	      wasAbsolute: pathPart.startsWith("/"),
   113	      fragment,
   114	    });
   115	  };
   116	}
   117	
   118	/**
   119	 * Build the transform used for the moved card itself: it has relocated, so its
   120	 * *relative* refs to anything that stayed put must be recomputed from the new
   121	 * location. Box-root-absolute refs are unaffected by the move; `attach/` refs
   122	 * are scoped to the card and travel with it, so both are left alone. `remap`
   123	 * relocates the card's own attached files (referenced by full path rather than
   124	 * the `attach/` prefix).
   125	 */
   126	function transformForMovedCard(params: {
   127	  boxRoot: string;
   128	  oldCardAbs: string;
   129	  newCardAbs: string;
   130	  remap: Remap;
   131	}): RefTransform {
   132	  const { boxRoot, oldCardAbs, newCardAbs, remap } = params;
   133	  return (rawRef) => {
   134	    const { pathPart, fragment } = splitFragment(rawRef);
   135	    if (pathPart === "" || pathPart.startsWith("/") || isAttachRef(pathPart)) {
   136	      return rawRef;
   137	    }
   138	    const abs = resolveRefToAbs({ boxRoot, cardAbsPath: oldCardAbs, pathPart });
   139	    if (abs === null) return rawRef;
   140	    const remapped = remap(abs);
   141	    const target = remapped === null ? abs : remapped;
   142	    return path.relative(path.dirname(newCardAbs), target) + fragment;
   143	  };
   144	}
   145	
   146	/** Quote-aware unwrap of a YAML scalar value. Returns the inner value + quote char. */
   147	function unquote(value: string): { inner: string; quote: string } {
   148	  if (value.length >= 2) {
   149	    const first = value[0];
   150	    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
   151	      return { inner: value.slice(1, -1), quote: first };
   152	    }
   153	  }
   154	  return { inner: value, quote: "" };
   155	}
   156	
   157	/**
   158	 * Rewrite refs inside the frontmatter block (between the leading `---` and the
   159	 * next `---`). Only the `ref:` and `refs:` keys carry refs, matching the
   160	 * frontmatter ref convention. Returns the text with that region rewritten.
   161	 */
   162	function rewriteFrontmatter(text: string, wrap: RefTransform): string {
   163	  if (!text.startsWith("---\n")) return text;
   164	  const lines = text.split("\n");
   165	  let end = -1;
   166	  for (let i = 1; i < lines.length; i++) {
   167	    if (lines[i] === "---") {
   168	      end = i;
   169	      break;
   170	    }
   171	  }
   172	  if (end === -1) return text;
   173	
   174	  const apply = (value: string): string => {
   175	    const { inner, quote } = unquote(value);
   176	    return quote + wrap(inner) + quote;
   177	  };
   178	
   179	  let refsIndent = -1; // indentation of an open `refs:` block, or -1
   180	  for (let i = 1; i < end; i++) {
   181	    const line = lines[i];
   182	    if (line === undefined) continue;
   183	
   184	    const scalar = /^(\s*ref:\s+)(\S.*?)\s*$/.exec(line);
   185	    if (scalar !== null) {
   186	      lines[i] = scalar[1]! + apply(scalar[2]!);
   187	      refsIndent = -1;
   188	      continue;
   189	    }
   190	
   191	    const inlineList = /^(\s*refs:\s*\[)(.*)(]\s*)$/.exec(line);
   192	    if (inlineList !== null) {
   193	      const items = inlineList[2]!
   194	        .split(",")
   195	        .map((item) => {
   196	          const m = /^(\s*)(\S.*?)(\s*)$/.exec(item);
   197	          if (m === null) return item;
   198	          return m[1]! + apply(m[2]!) + m[3]!;
   199	        })
   200	        .join(",");
   201	      lines[i] = inlineList[1]! + items + inlineList[3]!;
   202	      refsIndent = -1;
   203	      continue;
   204	    }
   205	
   206	    const blockOpen = /^(\s*)refs:\s*$/.exec(line);
   207	    if (blockOpen !== null) {
   208	      refsIndent = blockOpen[1]!.length;
   209	      continue;
   210	    }
   211	
   212	    if (refsIndent !== -1) {
   213	      const item = /^(\s+-\s+)(\S.*?)\s*$/.exec(line);
   214	      if (item !== null && line.search(/\S/) > refsIndent) {
   215	        lines[i] = item[1]! + apply(item[2]!);
   216	        continue;
   217	      }
   218	      // A line that isn't a deeper list item closes the refs block.
   219	      if (line.trim() !== "") refsIndent = -1;
   220	    }
   221	  }
   222	
   223	  return lines.join("\n");
   224	}
   225	
   226	/**
   227	 * Apply a ref transform to every ref-bearing token in a card's text. Returns
   228	 * the rewritten text and how many tokens actually changed.
   229	 */
   230	function applyTransform(text: string, transform: RefTransform): { text: string; count: number } {
   231	  let count = 0;
   232	  const wrap: RefTransform = (raw) => {
   233	    const out = transform(raw);
   234	    if (out !== raw) count++;
   235	    return out;
   236	  };
   237	
   238	  let updated = rewriteFrontmatter(text, wrap);
   239	
   240	  // Inline markdown links and images: [text](path) / ![alt](path).
   241	  updated = updated.replace(
   242	    /(!?\[[^\]]*]\(\s*)([^\s()]+)/g,
   243	    (_m: string, ...g: string[]) => g[0]! + wrap(g[1]!),
   244	  );
   245	
   246	  // Body `ref="…"` attributes (Markdoc tags; XML attributes pass through
   247	  // harmlessly since remap gates every change).
   248	  updated = updated.replace(
   249	    /(\bref=)(["'])([^"']*)\2/g,
   250	    (_m: string, ...g: string[]) => g[0]! + g[1]! + wrap(g[2]!) + g[1]!,
   251	  );
   252	
   253	  return { text: updated, count };
   254	}
   255	
   256	/**
   257	 * Rewrite refs in a card that *points at* moved targets. Used for every card
   258	 * except the one being moved.
   259	 */
   260	export function rewriteReferrerRefs(params: {
   261	  boxRoot: string;
   262	  cardAbsPath: string;
   263	  text: string;
   264	  remap: Remap;
   265	}): { text: string; count: number } {
   266	  const transform = transformForReferrer({
   267	    boxRoot: params.boxRoot,
   268	    cardAbsPath: params.cardAbsPath,
   269	    remap: params.remap,
   270	  });
   271	  return applyTransform(params.text, transform);
   272	}
   273	
   274	/**
   275	 * Rewrite a moved card's own outgoing relative refs so they still resolve from
   276	 * its new location.
   277	 */
   278	export function rewriteMovedCardRefs(params: {
   279	  boxRoot: string;
   280	  oldCardAbs: string;

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/frontend/src/lib/view-url.ts | sed -n '70,110p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    70	  }
    71	  const qs = parts.join("&");
    72	  return qs ? `${target.path}?${qs}` : target.path;
    73	}
    74	
    75	/**
    76	 * Resolve a relative path against a base document's path (like a filesystem
    77	 * would). `basePath` is the path of the containing document — the filename on
    78	 * the end is stripped and `relative` is resolved against the remaining dir.
    79	 * Empty/undefined `basePath` treats `relative` as already box-root-relative.
    80	 *
    81	 * Special case: if `relative` starts with `attach/`, the prefix is resolved
    82	 * against the base card's attach scope (`<basename>.attach/`) instead of the
    83	 * base's directory.
    84	 */
    85	export function resolveRelativePath(basePath: string | undefined, relative: string): string {
    86	  if (relative.startsWith("/")) return relative.replace(/^\/+/, "");
    87	
    88	  if ((relative === "attach" || relative.startsWith("attach/")) && basePath) {
    89	    const baseName = basePath.includes("/") ? basePath.slice(basePath.lastIndexOf("/") + 1) : basePath;
    90	    const baseDir =
    91	      basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
    92	    const cardBasename = cardBasenameOf(baseName);
    93	    const rest = relative === "attach" ? "" : relative.slice("attach/".length);
    94	    const attachPath = `${cardBasename}.attach${rest ? `/${rest}` : ""}`;
    95	    return baseDir ? `${baseDir}/${attachPath}` : attachPath;
    96	  }
    97	
    98	  const baseDir =
    99	    basePath && basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
   100	  const parts = [...baseDir.split("/"), ...relative.split("/")];
   101	  const out: string[] = [];
   102	  for (const part of parts) {
   103	    if (part === "" || part === ".") continue;
   104	    if (part === "..") {
   105	      out.pop();
   106	      continue;
   107	    }
   108	    out.push(part);
   109	  }
   110	  return out.join("/");

codex
For C2, the plan is right that fragments are irrelevant to today’s lint warning: `resolveRef` returns `exists: true` even if an XML fragment is missing. The bigger implementation risk is matching path semantics exactly: absolute refs are box-root relative in cardworks (`projectRoot + parsed.path`), `attach` alone can resolve to a directory, and `@version` is stripped only when it looks version-like.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/shared/attach-path.ts | sed -n '1,160p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/frontmatter-field.ts | sed -n '1,130p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Dotted-path frontmatter field lookup for card files.
     3	 *
     4	 * Shared by the landmark navigation resolver (`landmark/resolve.ts`) and the
     5	 * `cb ls --format` command (`commands/ls.ts`). Both read a scalar field out of
     6	 * a card's YAML frontmatter by a dotted path — this replaces the old
     7	 * XPath-over-XML evaluation now that cards are YAML frontmatter.
     8	 */
     9	
    10	import * as fs from "node:fs/promises";
    11	import { parse as parseYaml } from "yaml";
    12	import { splitCardContent } from "../cards/index.js";
    13	
    14	/**
    15	 * Read a dotted field path out of a frontmatter mapping. `title` →
    16	 * `frontmatter.title`; `exif.camera` walks nested mappings. Missing or
    17	 * non-scalar values render as the empty string.
    18	 */
    19	export function lookupField(frontmatter: Record<string, unknown>, expr: string): string {
    20	  let cursor: unknown = frontmatter;
    21	  for (const key of expr.split(".")) {
    22	    if (cursor === null || typeof cursor !== "object") return "";
    23	    cursor = (cursor as Record<string, unknown>)[key];
    24	  }
    25	  if (cursor === null || cursor === undefined) return "";
    26	  if (typeof cursor === "object") return "";
    27	  return String(cursor);
    28	}
    29	
    30	/**
    31	 * Read + parse a card file's frontmatter mapping. Returns null when the file
    32	 * can't be read, has no frontmatter block, or the frontmatter isn't a YAML
    33	 * mapping (malformed YAML, an array, a scalar).
    34	 */
    35	export async function loadCardFrontmatter(absPath: string): Promise<Record<string, unknown> | null> {
    36	  let content: string;
    37	  try {
    38	    content = await fs.readFile(absPath, "utf-8");
    39	  } catch (_e) {
    40	    return null;
    41	  }
    42	  const split = splitCardContent(content);
    43	  if (!split.hasFrontmatter) return null;
    44	  let fm: unknown;
    45	  try {
    46	    fm = parseYaml(split.frontmatterText);
    47	  } catch (_e) {
    48	    return null;
    49	  }
    50	  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return null;
    51	  return fm as Record<string, unknown>;
    52	}

 succeeded in 0ms:
     1	/**
     2	 * Helpers for the `.attach/` directory convention.
     3	 *
     4	 * Every card may have a sibling directory named `<basename>.attach/`. Files
     5	 * placed in that directory belong to the card. Refs from the card to its
     6	 * attached files use the virtual prefix `attach/<file>`; the resolver expands
     7	 * the prefix against the card's attach scope.
     8	 *
     9	 * Pure string operations — no Node deps. Lives in `src/shared/` so both the
    10	 * backend (CLI, connectors, webapp; relative `../shared/attach-path.js`) and
    11	 * the frontend (`@shared/attach-path`) import the one source of truth.
    12	 */
    13	
    14	/** Suffix that marks a directory as a card's attach scope. */
    15	export const ATTACH_SUFFIX = ".attach";
    16	
    17	/** Virtual prefix used in ref values pointing into the current card's attach scope. */
    18	export const ATTACH_PREFIX = "attach/";
    19	
    20	/**
    21	 * Card basename — the part of the filename before `.<type>.card`.
    22	 *
    23	 * `Foo.image.card` → `Foo`
    24	 * `Voice_Memo.memo.card` → `Voice_Memo`
    25	 * `scan-001.capture-session.card` → `scan-001`
    26	 *
    27	 * Returns the filename unchanged if it doesn't end with `.card` or has no type
    28	 * segment before `.card`.
    29	 */
    30	export function cardBasename(cardFileNameOrPath: string): string {
    31	  const name = lastSegment(cardFileNameOrPath);
    32	  if (!name.endsWith(".card")) return name;
    33	  const withoutCard = name.slice(0, -".card".length);
    34	  const lastDot = withoutCard.lastIndexOf(".");
    35	  if (lastDot === -1) return withoutCard;
    36	  return withoutCard.slice(0, lastDot);
    37	}
    38	
    39	/**
    40	 * Compute the attach directory path for a given card. The returned path is in
    41	 * the same directory as the card, with name `<basename>.attach`.
    42	 *
    43	 * Works with absolute or relative paths — uses the input's directory.
    44	 */
    45	export function attachDirFor(cardPath: string): string {
    46	  const dir = dirSegment(cardPath);
    47	  const base = cardBasename(cardPath);
    48	  const suffix = base + ATTACH_SUFFIX;
    49	  return dir === "" ? suffix : dir + "/" + suffix;
    50	}
    51	
    52	/**
    53	 * Compute the path of an attached file under a card's scope.
    54	 *
    55	 * `attachmentPath("inbox/Foo.image.card", "photo-001.jpg")`
    56	 *   → `"inbox/Foo.attach/photo-001.jpg"`
    57	 *
    58	 * `fileName` is a path *within* the attach scope — may itself contain
    59	 * subdirectories (`"attachments/foo.pdf"`, `"sub/scan.image.card"`).
    60	 */
    61	export function attachmentPath(cardPath: string, fileName: string): string {
    62	  const dir = attachDirFor(cardPath);
    63	  return dir + "/" + fileName;
    64	}
    65	
    66	/**
    67	 * Test whether a ref value uses the `attach/` virtual prefix. The prefix is
    68	 * only meaningful as the first path segment.
    69	 */
    70	export function isAttachRef(ref: string): boolean {
    71	  if (ref.startsWith(ATTACH_PREFIX)) return true;
    72	  if (ref === "attach") return true;
    73	  return false;
    74	}
    75	
    76	/**
    77	 * Return the portion of a ref after the `attach/` prefix, or `null` if the ref
    78	 * doesn't use the prefix.
    79	 *
    80	 * `splitAttachRef("attach/photo-001.jpg")` → `"photo-001.jpg"`
    81	 * `splitAttachRef("attach/sub/scan.image.card")` → `"sub/scan.image.card"`
    82	 * `splitAttachRef("store/x.attach/y.jpg")` → `null` (mid-path occurrence is literal)
    83	 */
    84	export function splitAttachRef(ref: string): string | null {
    85	  if (!isAttachRef(ref)) return null;
    86	  if (ref === "attach") return "";
    87	  return ref.slice(ATTACH_PREFIX.length);
    88	}
    89	
    90	/**
    91	 * Resolve a ref value that uses the `attach/` prefix to a filesystem path
    92	 * (in the same path-style as `cardPath`).
    93	 *
    94	 * `resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg")`
    95	 *   → `"inbox/Foo.attach/photo-001.jpg"`
    96	 *
    97	 * Returns `null` if the ref doesn't use the prefix.
    98	 */
    99	export function resolveAttachRef(cardPath: string, ref: string): string | null {
   100	  const rest = splitAttachRef(ref);
   101	  if (rest === null) return null;
   102	  if (rest === "") return attachDirFor(cardPath);
   103	  return attachDirFor(cardPath) + "/" + rest;
   104	}
   105	
   106	/**
   107	 * True when the given basename is exactly `attach` (no extension). Used by the
   108	 * lint rule that forbids the literal name `attach` outside an attach scope.
   109	 */
   110	export function isLiteralAttachName(name: string): boolean {
   111	  return name === "attach";
   112	}
   113	
   114	/**
   115	 * True when the given basename ends with `.attach` (the suffix that marks a
   116	 * card's attach scope).
   117	 */
   118	export function isAttachDirName(name: string): boolean {
   119	  return name.endsWith(ATTACH_SUFFIX) && name.length > ATTACH_SUFFIX.length;
   120	}
   121	
   122	/**
   123	 * If `dirName` is `<basename>.attach`, return `<basename>`. Otherwise null.
   124	 */
   125	export function attachDirOwnerBasename(dirName: string): string | null {
   126	  if (!isAttachDirName(dirName)) return null;
   127	  return dirName.slice(0, -ATTACH_SUFFIX.length);
   128	}
   129	
   130	/**
   131	 * Test whether a path lies inside an attach scope — any descendant of a
   132	 * `<basename>.attach/` directory.
   133	 *
   134	 * Used by lint rules: the exact-name `attach` ban only applies outside attach
   135	 * scopes (attachments may have a subdirectory named `attach` if a user
   136	 * really wants — unusual but not forbidden).
   137	 */
   138	export function isInsideAttachScope(relativePath: string): boolean {
   139	  const segments = relativePath.split("/");
   140	  for (const segment of segments) {
   141	    if (isAttachDirName(segment)) return true;
   142	  }
   143	  return false;
   144	}
   145	
   146	function lastSegment(p: string): string {
   147	  const i = p.lastIndexOf("/");
   148	  return i === -1 ? p : p.slice(i + 1);
   149	}
   150	
   151	function dirSegment(p: string): string {
   152	  const i = p.lastIndexOf("/");
   153	  return i === -1 ? "" : p.slice(0, i);
   154	}

exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/fs/types.ts | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/fs/node-fs.ts | sed -n '136,180p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Filesystem abstraction interface for reading and writing card files.
     3	 */
     4	export interface FileSystem {
     5	  /**
     6	   * Read a text file at the given path.
     7	   */
     8	  read(path: string): Promise<string>;
     9	
    10	  /**
    11	   * Read a binary file at the given path.
    12	   */
    13	  readBinary(path: string): Promise<Uint8Array>;
    14	
    15	  /**
    16	   * Write content to a text file at the given path.
    17	   */
    18	  write(path: string, content: string): Promise<void>;
    19	
    20	  /**
    21	   * Check if a file exists at the given path.
    22	   */
    23	  exists(path: string): Promise<boolean>;
    24	
    25	  /**
    26	   * List immediate entries in a directory (files and subdirectories).
    27	   */
    28	  list(path: string): Promise<string[]>;
    29	
    30	  /**
    31	   * Find all files matching a glob pattern.
    32	   * Pattern supports * (any chars) and ** (any path segments).
    33	   * Returns absolute paths.
    34	   *
    35	   * @example
    36	   * fs.glob("/project", "**\/*.card")  // all .card files
    37	   * fs.glob("/project", "*.card")       // .card files in root only
    38	   * fs.glob("/project", "cards/**\/*")   // all files under cards/
    39	   */
    40	  glob(basePath: string, pattern: string): Promise<string[]>;
    41	
    42	  /**
    43	   * Move/rename a file.
    44	   */
    45	  move(from: string, to: string): Promise<void>;
    46	
    47	  /**
    48	   * Resolve a relative path against a base path.
    49	   */
    50	  resolve(base: string, relative: string): string;
    51	
    52	  /**
    53	   * Get file metadata including modification time.
    54	   */
    55	  stat(path: string): Promise<{ mtime: Date; size: number }>;
    56	}

 succeeded in 0ms:
   136	  resolve(base: string, relative: string): string {
   137	    if (path.isAbsolute(relative)) {
   138	      return relative;
   139	    }
   140	    const baseDir = path.dirname(base);
   141	    return path.resolve(baseDir, relative);
   142	  }
   143	
   144	  async stat(filePath: string): Promise<{ mtime: Date; size: number }> {
   145	    const stats = await fs.stat(filePath);
   146	    return {
   147	      mtime: stats.mtime,
   148	      size: stats.size,
   149	    };
   150	  }
   151	}

codex
One correction for C2 is likely important: the plan says “path + optional #fragment,” but cardworks also strips an `@version` suffix before the fragment when it looks version-like. A simple `fs.access(ref.split("#")[0])` would incorrectly warn on valid `Some.card@1.0.0` refs.
exec
/opt/homebrew/bin/bash -lc "rg -n \"resolveRef\\(|resolveRefs\\(|findIncomingRefs|findOutgoingRefs|createLoader\\(|new CardLoader|MemoryCardLoader|loader\\.\" callback-box/src callback-box/test -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "rg -n \"ref: .*@[0-9v]|refs: .*@[0-9v]|\\]\\(["'^)]*@[0-9v]|ref='"\\\"["'^'"\\\"]*@[0-9v]|#[A-Za-z0-9_-]+|#query\" callback-box/src callback-box/test callback-box/docs -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/scenario/runner.ts:24:import { loadScenario, loadStubs, getScenarioDir, getBoxRoot } from "./loader.js";
callback-box/src/schemas/landmark.ts:116: * loader. Unknown keys (global card fields, a stray `type:`) are stripped.
callback-box/src/schemas/landmark.ts:173: * loader.
callback-box/test/card-lint.doctest.md:17:import { createLoader } from "../src/cli/lib/loader.js";
callback-box/test/card-lint.doctest.md:83:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:103:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:127:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:153:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:182:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:214:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:244:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:261:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:281:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:302:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:326:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:348:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:365:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:382:const loader = await createLoader(box.root);
callback-box/test/card-lint.doctest.md:408:const loader = await createLoader(box.root);
callback-box/src/webapp/routes/views.ts:14:import { createLoader } from "../../cli/lib/loader.js";
callback-box/src/webapp/routes/views.ts:107:      const loader = await createLoader(boxRoot);
callback-box/src/webapp/routes/views.ts:180:  const card = await loader.load(absPath);
callback-box/src/webapp/box-config.ts:2: * Per-box configuration loader.
callback-box/src/dev/doc-graph-data.ts:85:function resolveRef(ref: string, { fromFile, allFiles, basenameLookup }: ResolveContext): [string, boolean] {
callback-box/src/dev/doc-graph-data.ts:120:      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
callback-box/src/dev/doc-graph-data.ts:131:      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
callback-box/src/dev/doc-graph-data.ts:142:      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
callback-box/src/webapp/routes/api-card-routes.ts:13:import { createLoader } from "../../cli/lib/loader.js";
callback-box/src/webapp/routes/api-card-routes.ts:37:      const loader = await createLoader(boxRoot);
callback-box/src/webapp/routes/api-card-routes.ts:40:        const card = await loader.load(fullPath);
callback-box/src/webapp/routes/api-card-routes.ts:41:        const xml = loader.serialize(card.element);
callback-box/src/webapp/routes/api-browse.ts:12:import { createLoader } from "../../cli/lib/loader.js";
callback-box/src/webapp/routes/api-browse.ts:63:      const loader = await createLoader(boxRoot);
callback-box/src/webapp/routes/api-browse.ts:103:          const card = await loader.load(fullPath);
callback-box/src/schemas/procedure-run.ts:80: * cards directly without going through the full card loader.
callback-box/src/schemas/procedure.ts:97: * definition without going through the full card loader.
callback-box/src/frontend/src/ssr/register-loader.mjs:3: * Used as: node --import ./register-loader.mjs ...
callback-box/src/frontend/src/ssr/register-loader.mjs:7:register("./css-loader.mjs", import.meta.url);
callback-box/src/webapp/trpc/routers/card.ts:6:import { createLoader } from "../../../cli/lib/loader.js";
callback-box/src/webapp/trpc/routers/card.ts:131:      // legacy XML cards fall through to the cardworks loader.
callback-box/src/webapp/trpc/routers/card.ts:150:      const loader = await createLoader(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/card.ts:153:        const card = await loader.load(fullPath);
callback-box/src/webapp/trpc/routers/card.ts:154:        const xml = loader.serialize(card.element);
callback-box/src/core/sdk-hooks.ts:17:import { createLoader } from "../cli/lib/loader.js";
callback-box/src/core/sdk-hooks.ts:109:    const loader = await createLoader(cwd);
callback-box/src/cli/commands/render.ts:49:    const ssrLoader = path.join(projectDir, "src/frontend/src/ssr/register-loader.mjs");
callback-box/src/webapp/trpc/routers/status.ts:7:import { createLoader } from "../../../cli/lib/loader.js";
callback-box/src/webapp/trpc/routers/status.ts:100:      const loader = await createLoader(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/status.ts:148:            const card = await loader.load(fullPath);
callback-box/src/cli/commands/wakeup-steps.ts:15:import { createLoader } from "../lib/loader.js";
callback-box/src/cli/commands/wakeup-steps.ts:31:  const loader = await createLoader(boxRoot);
callback-box/src/core/preactions/index.ts:115:      xml: { card: await loader.load(cardPath) },
callback-box/src/core/preactions/index.ts:126:    await ctx.loader.save(ctx.xml.card);
callback-box/src/core/file-summary.ts:29: * Input passed to a loader. The server populates `element` for parsed cards
callback-box/src/cli/commands/scenario.ts:7:import { listScenarios } from "../../scenario/loader.js";
callback-box/src/core/card-lint.ts:118:      const resolved = await options.loader.resolveRef(ref, path);
callback-box/src/cli/commands/validate.ts:15:import { createLoader } from "../lib/loader.js";
callback-box/src/cli/commands/validate.ts:188:  const loader = await createLoader(boxRoot);
callback-box/src/cli/commands/validate.ts:242:  const cardPaths = (await loader.listCards()).filter((p) => !isTrashedCard(p));
callback-box/src/cli/commands/validate.ts:339:        const loader = await createLoader(boxRoot);
callback-box/src/core/commands/create.ts:141:  // through cardworks's loader.
callback-box/src/core/commands/move-phase2.ts:4: * Cardworks' `loader.load()` parses card bodies as XML — fine for the
callback-box/src/core/commands/move-phase2.ts:54: * `loader.move()` does for XML cards. Returns the list of moved
callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/src/cli/lib/loader.ts:26:export async function createLoader(
callback-box/src/cli/lib/loader.ts:37:  return new CardLoader(boxRoot, loaderOptions);
callback-box/src/cli/lib/loader.ts:53: * @returns A configured MemoryCardLoader
callback-box/src/cli/lib/loader.ts:57:): Promise<MemoryCardLoader> {
callback-box/src/cli/lib/loader.ts:61:  return new MemoryCardLoader(projectRoot, {
callback-box/src/cli/lib/loader.ts:70:export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/src/core/commands/scan-import.ts:40:import { createLoader } from "../../cli/lib/loader.js";
callback-box/src/core/commands/scan-import.ts:206:  const loader = await createLoader(ctx.boxRoot);
callback-box/src/core/commands/move-operations.ts:104:  const loader = new CardLoader(ctx.boxRoot);
callback-box/src/core/commands/move-operations.ts:105:  const allCards = await loader.listCards();
callback-box/src/core/commands/move-operations.ts:175:  const card = await loader.load(sourcePath);
callback-box/src/core/commands/move-operations.ts:176:  const { result } = await loader.move(card, destPath);
callback-box/src/core/commands/move-operations.ts:213:  const allCards = await loader.listCards();
callback-box/src/core/commands/move-operations.ts:320:  const loader = new CardLoader(ctx.boxRoot);
callback-box/src/core/loader-registry.ts:69: * Built-in fallback loader. Reads nothing beyond the path.
callback-box/src/core/commands/scan-import-cards.ts:20:import type { createLoader } from "../../cli/lib/loader.js";
callback-box/src/core/commands/scan-import-cards.ts:171:  const card = await loader.load(cardPath);
callback-box/src/core/commands/scan-import-cards.ts:233:  await loader.save(card);
callback-box/src/frontend/src/components/CardTreeView.tsx:73:function resolveRef(ref: string, cardPath: string): string {
callback-box/src/frontend/src/components/CardTreeView.tsx:201:  const resolvedRef = refAttr && cardPath ? resolveRef(refAttr, cardPath) : null;

 succeeded in 0ms:
callback-box/test/connector-gmail-drafts.doctest.md:49:stamped.includes("gmail-draft-url: https://mail.google.com/mail/u/0/#drafts/m-fake-1")
callback-box/test/connector-gmail-drafts.doctest.md:196:  "---\ntype: email-outbound\nstatus: draft\nto: bob@example.com\nsubject: Already done\ngmail-draft-id: r-existing\ngmail-draft-url: https://mail.google.com/mail/u/0/#drafts/m-existing\n---\nTest.\n",
callback-box/test/drive-types.doctest.md:12:extractDriveFileId("https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsT/edit#gid=0")
callback-box/test/speech-message.doctest.md:36:  selections: [{ id: 1, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body; heading: Proofing (#proofing)" }],
callback-box/test/speech-message.doctest.md:40:"<speech local-time=\"14:23\">look at this part\n<user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body; heading: Proofing (#proofing)\">let it rise</user-selection></speech>"
callback-box/test/manual/selection-commentary.manual.md:57:  `body; heading: What this unlocks (#what-this-unlocks); paragraph 2; ~line 83`
callback-box/test/manual/selection-commentary.manual.md:59:  `heading: Map: (root) (#map-root); ~line 1` (no `section`, no `paragraph`)
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:73:>         count=${#cards[@]}
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:113:>         echo "Remaining: ${#remaining[@]}"
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:114:>         [ "${#remaining[@]}" -eq 0 ]
callback-box/test/selection-position.doctest.md:25:body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42
callback-box/test/selection-position.doctest.md:46:heading: Notes (#notes); ~line 5
callback-box/test/search-index.doctest.md:72:## Persist → restore is stable (pins oramasearch/orama#695 at our version)
callback-box/docs/capture-pipeline-redesign.md:99:- **Quality**: #1 on OmniDocBench V1.5. Excellent on tables, formulas, documents.
callback-box/src/schemas/feedback.tsx:57:  the cardworks \`path#fragment\` form, e.g.
callback-box/src/schemas/feedback.tsx:58:  \`store/briefings/2026-02-01.briefing.card#q1\`.
callback-box/test/selection-serialize.doctest.md:18:  { id: 1, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body; heading: Proofing (#proofing)" },
callback-box/test/selection-serialize.doctest.md:21:"Compare <user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body; heading: Proofing (#proofing)\">let it rise</user-selection> with the intro"
callback-box/test/view-url.doctest.md:83:JSON.stringify(classifyMarkdownHref("#anchor"))
callback-box/docs/server-operations.md:156:**Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — a weekly remote routine reminds the user to run that runbook.
callback-box/src/dev/doc-graph-html-data.ts:35:    color: "#c2410c",
callback-box/src/dev/doc-graph-html-data.ts:50:    color: "#0e7490",
callback-box/src/dev/doc-graph-html-data.ts:67:    color: "#6d28d9",
callback-box/src/dev/doc-graph-html-data.ts:81:    color: "#a21caf",
callback-box/src/dev/doc-graph-html-data.ts:92:    color: "#15803d",
callback-box/src/dev/doc-graph-html-data.ts:108:    color: "#1d4ed8",
callback-box/src/dev/doc-graph-html-data.ts:123:    color: "#a16207",
callback-box/src/dev/doc-graph-html-data.ts:136:    color: "#475569",
callback-box/docs/boxes-as-packages.md:23:**Secondary driver — isolation between coexisting boxes.** All boxes on a server share one Node process and one OS user. Box A's connector code can read Box B's `config/connectors/*.secret.json`. A buggy view, runaway agent, or hung connector affects every box. Network egress is uncapped per-box. Important on its own, but it wouldn't justify upending the deploy model. It's a co-benefit of the same architectural change that fixes #1–6.
callback-box/docs/boxes-as-packages.md:697:- **Interaction with the [Markdown cards idea](ideas.md#markdown-cards-replacing-xml).** Both touch the schema-definition surface. Probably independent; markdown-cards is about on-disk format, this is about who runs the schema validator and where. Decide before locking the schema-helper export surface.
callback-box/docs/doc-graph.html:8:    --bg: #f5efe2;
callback-box/docs/doc-graph.html:9:    --paper: #fbf6e9;
callback-box/docs/doc-graph.html:10:    --paper-2: #ede4cc;
callback-box/docs/doc-graph.html:11:    --ink: #2a241d;
callback-box/docs/doc-graph.html:12:    --ink-soft: #5a4e3e;
callback-box/docs/doc-graph.html:13:    --muted: #8a7d68;
callback-box/docs/doc-graph.html:14:    --rule: #d8cdb1;
callback-box/docs/doc-graph.html:15:    --accent: #b35a1f;
callback-box/docs/doc-graph.html:16:    --link: #8c3d12;
callback-box/docs/doc-graph.html:22:      radial-gradient(ellipse at top, #fff8e7 0%, var(--bg) 60%) no-repeat,
callback-box/docs/doc-graph.html:114:  .ring-0 { --c: #b35a1f; background: linear-gradient(90deg, #fef1d8 0%, var(--paper) 80%); }
callback-box/docs/doc-graph.html:115:  .ring-1 { --c: #d97706; background: linear-gradient(90deg, #fdf3e0 0%, var(--paper) 80%); }
callback-box/docs/doc-graph.html:116:  .ring-2 { --c: #b08c4a; }
callback-box/docs/doc-graph.html:117:  .ring-3 { --c: #8a7d68; }
callback-box/docs/doc-graph.html:118:  .ring-4 { --c: #b3a487; opacity: 0.92; }
callback-box/docs/doc-graph.html:148:  .chip:hover { text-decoration: none; transform: translateY(-1px); background: #e6dcc0; }
callback-box/docs/doc-graph.html:166:    color: #fff8e7;
callback-box/docs/doc-graph.html:179:    color: #fff;
callback-box/docs/doc-graph.html:205:  .pillar-entry:hover { background: #e6dcc0; text-decoration: none; }
callback-box/docs/doc-graph.html:217:  .pillar-entry.missing { color: #b91c1c; background: #fef2f2; border-color: #b91c1c; }
callback-box/docs/doc-graph.html:225:  .pillar-support li.missing { color: #b91c1c; }
callback-box/docs/doc-graph.html:273:  .curator-list li.missing { color: #b91c1c; }
callback-box/docs/doc-graph.html:336:        <div class="ring-chips"><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/CLAUDE.md" style="--c:#a3a394" title="CLAUDE.md — &quot;Callback Box&quot; (147 lines)">CLAUDE.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/CODE-STYLE.md" style="--c:#a3a394" title="CODE-STYLE.md — &quot;Code Style&quot; (60 lines)">CODE-STYLE.md</a></div>
callback-box/docs/doc-graph.html:347:        <div class="ring-chips"><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/deploy/CLAUDE.md" style="--c:#475569" title="deploy/CLAUDE.md — &quot;Deploy&quot; (26 lines) · Deploy &amp; Ops">deploy/CLAUDE.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/CLAUDE.md" style="--c:#a3a394" title="docs/architecture/CLAUDE.md — &quot;Architecture Docs&quot; (55 lines)">docs/architecture/CLAUDE.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/src/connectors/CLAUDE.md" style="--c:#0e7490" title="src/connectors/CLAUDE.md — &quot;Connectors&quot; (23 lines) · Connectors">src/connectors/CLAUDE.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/src/core/reactor/CLAUDE.md" style="--c:#6d28d9" title="src/core/reactor/CLAUDE.md — &quot;Reactor&quot; (24 lines) · Wakeup &amp; Reactor">src/core/reactor/CLAUDE.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/src/dev/CLAUDE.md" style="--c:#a3a394" title="src/dev/CLAUDE.md — &quot;Dev Scripts&quot; (14 lines)">src/dev/CLAUDE.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/src/services/CLAUDE.md" style="--c:#a3a394" title="src/services/CLAUDE.md — &quot;Services&quot; (126 lines)">src/services/CLAUDE.md</a></div>
callback-box/docs/doc-graph.html:358:        <div class="ring-chips"><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/deploy/README.md" style="--c:#475569" title="deploy/README.md — &quot;Deploy&quot; (191 lines) · Deploy &amp; Ops">deploy/README.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/adding-a-box.md" style="--c:#a16207" title="docs/adding-a-box.md — &quot;Adding a New Box&quot; (149 lines) · Boxes">docs/adding-a-box.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/adding-api-endpoints.md" style="--c:#a3a394" title="docs/adding-api-endpoints.md — &quot;Adding API Endpoints&quot; (247 lines)">docs/adding-api-endpoints.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/adding-schemas.md" style="--c:#c2410c" title="docs/adding-schemas.md — &quot;Adding a New Card Schema&quot; (192 lines) · Cards">docs/adding-schemas.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/family.md" style="--c:#a3a394" title="docs/architecture/family.md — &quot;The Lund-Vega Family&quot; (95 lines)">docs/architecture/family.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/outline.md" style="--c:#a3a394" title="docs/architecture/outline.md — &quot;Architecture Docs Outline&quot; (214 lines)">docs/architecture/outline.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/spirit.md" style="--c:#a3a394" title="docs/architecture/spirit.md — &quot;The Spirit of the Thing&quot; (112 lines)">docs/architecture/spirit.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/writing-style.md" style="--c:#a3a394" title="docs/architecture/writing-style.md — &quot;Writing Style Guide&quot; (95 lines)">docs/architecture/writing-style.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/box-layout.md" style="--c:#a16207" title="docs/box-layout.md — &quot;Box Layout&quot; (148 lines) · Boxes">docs/box-layout.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/calendar.md" style="--c:#0e7490" title="docs/calendar.md — &quot;Calendar Integration&quot; (89 lines) · Connectors">docs/calendar.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/cards-as-markdown.md" style="--c:#c2410c" title="docs/cards-as-markdown.md — &quot;RFC: Cards as Markdown + YAML Frontmatter&quot; (2553 lines) · Cards">docs/cards-as-markdown.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/client-debug-log.md" style="--c:#15803d" title="docs/client-debug-log.md — &quot;Client Debug Log&quot; (68 lines) · Frontend">docs/client-debug-log.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/connectors.md" style="--c:#0e7490" title="docs/connectors.md — &quot;Connectors&quot; (86 lines) · Connectors">docs/connectors.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/DESIGN.md" style="--c:#a3a394" title="docs/DESIGN.md — &quot;Callback Box: comprehensive design notes&quot; (531 lines)">docs/DESIGN.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/doc-graph.md" style="--c:#a3a394" title="docs/doc-graph.md — &quot;Documentation Graph Report&quot; (944 lines)">docs/doc-graph.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/EXAMPLE_FILES.md" style="--c:#c2410c" title="docs/EXAMPLE_FILES.md — &quot;Callback Box: Example Files&quot; (820 lines) · Cards">docs/EXAMPLE_FILES.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/glossary.md" style="--c:#a3a394" title="docs/glossary.md — &quot;Glossary&quot; (53 lines)">docs/glossary.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/ideas.md" style="--c:#a3a394" title="docs/ideas.md — &quot;Ideas &amp; Planned Features&quot; (936 lines)">docs/ideas.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/IMPLEMENTATION.md" style="--c:#a3a394" title="docs/IMPLEMENTATION.md — &quot;Callback Box: Implementation Guide&quot; (1018 lines)">docs/IMPLEMENTATION.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/knowledge-audits.md" style="--c:#1d4ed8" title="docs/knowledge-audits.md — &quot;Knowledge Audits&quot; (65 lines) · Testing">docs/knowledge-audits.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/landmarks.md" style="--c:#15803d" title="docs/landmarks.md — &quot;Landmarks&quot; (164 lines) · Frontend">docs/landmarks.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/maintenance.md" style="--c:#1d4ed8" title="docs/maintenance.md — &quot;Code Maintenance&quot; (97 lines) · Testing">docs/maintenance.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/migrations.md" style="--c:#c2410c" title="docs/migrations.md — &quot;Box Migrations&quot; (160 lines) · Cards">docs/migrations.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/plans/pdf-intake-design.md" style="--c:#a3a394" title="docs/plans/pdf-intake-design.md — &quot;PDF Intake&quot; (166 lines)">docs/plans/pdf-intake-design.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/procedure-implementation.md" style="--c:#a21caf" title="docs/procedure-implementation.md — &quot;Procedures&quot; (133 lines) · Procedures">docs/procedure-implementation.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/server-operations.md" style="--c:#475569" title="docs/server-operations.md — &quot;Server Operations&quot; (148 lines) · Deploy &amp; Ops">docs/server-operations.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/plans/source-editor.md" style="--c:#15803d" title="docs/plans/source-editor.md — &quot;Source Editor Plan&quot; (138 lines) · Frontend">docs/plans/source-editor.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/ssr-render-testing.md" style="--c:#15803d" title="docs/ssr-render-testing.md — &quot;SSR Render Testing (`cb render`)&quot; (177 lines) · Frontend">docs/ssr-render-testing.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/testing.md" style="--c:#1d4ed8" title="docs/testing.md — &quot;Testing&quot; (537 lines) · Testing">docs/testing.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/FRONTEND.md" style="--c:#15803d" title="FRONTEND.md — &quot;Frontend Conventions&quot; (108 lines) · Frontend">FRONTEND.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/src/core/reactor/DESIGN.md" style="--c:#a3a394" title="src/core/reactor/DESIGN.md — &quot;Reactor Design&quot; (122 lines)">src/core/reactor/DESIGN.md</a></div>
callback-box/docs/doc-graph.html:369:        <div class="ring-chips"><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/agent-knowledge.md" style="--c:#a3a394" title="docs/agent-knowledge.md — &quot;Agent Knowledge Audit: What It Should Know and How to Verify&quot; (493 lines)">docs/agent-knowledge.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/attach-manifests.md" style="--c:#a3a394" title="docs/attach-manifests.md — &quot;Attach Manifests&quot; (255 lines)">docs/attach-manifests.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/data-source-tagging.md" style="--c:#a3a394" title="docs/data-source-tagging.md — &quot;Data Source Tagging Convention&quot; (89 lines)">docs/data-source-tagging.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/health-checks.md" style="--c:#a3a394" title="docs/health-checks.md — &quot;Health Checks&quot; (60 lines)">docs/health-checks.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/implemented-plans/narration-mode-design.md" style="--c:#a3a394" title="docs/implemented-plans/narration-mode-design.md — &quot;Narration Mode — Design&quot; (465 lines)">docs/implemented-plans/narration-mode-design.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/prompt-audits.md" style="--c:#a3a394" title="docs/prompt-audits.md — &quot;Prompt Audits&quot; (203 lines)">docs/prompt-audits.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/testing-gaps.md" style="--c:#a3a394" title="docs/testing-gaps.md — &quot;Testing Gaps — Working Document&quot; (95 lines)">docs/testing-gaps.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/plans/triage-design.md" style="--c:#a3a394" title="docs/plans/triage-design.md — &quot;Triage — Design&quot; (262 lines)">docs/plans/triage-design.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/README.md" style="--c:#a3a394" title="README.md — &quot;callback-box&quot; (2 lines)">README.md</a></div>
callback-box/docs/doc-graph.html:377:          <p class="ring-trigger">Working notes, archaeology, speculative designs. See the Curator&#39;s stroll below.</p>
callback-box/docs/doc-graph.html:380:        <div class="ring-chips"><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/CLAUDE-MD-REVIEW.md" style="--c:#a3a394" title="CLAUDE-MD-REVIEW.md — &quot;CLAUDE.md Review — 2026-04-28&quot; (448 lines)">CLAUDE-MD-REVIEW.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/activities-design.md" style="--c:#a3a394" title="docs/activities-design.md — &quot;Activities — Design Proposal&quot; (311 lines)">docs/activities-design.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/activities-retrospective.md" style="--c:#a3a394" title="docs/activities-retrospective.md — &quot;Activities — Retrospective&quot; (44 lines)">docs/activities-retrospective.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/01-what-is-this.md" style="--c:#a3a394" title="docs/architecture/01-what-is-this.md — &quot;What Is This Thing?&quot; (66 lines)">docs/architecture/01-what-is-this.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/architecture/02-cards-and-memory.md" style="--c:#a3a394" title="docs/architecture/02-cards-and-memory.md — &quot;Cards and Memory&quot; (99 lines)">docs/architecture/02-cards-and-memory.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/attach-implementation.md" style="--c:#a3a394" title="docs/attach-implementation.md — &quot;Implementation spec: `.attach/` directories&quot; (344 lines)">docs/attach-implementation.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/box-user-account-spec.md" style="--c:#a3a394" title="docs/box-user-account-spec.md — &quot;Spec: Box as Linux User Account&quot; (402 lines)">docs/box-user-account-spec.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/boxes-as-packages.md" style="--c:#a3a394" title="docs/boxes-as-packages.md — &quot;Design Exploration: Boxes as Code Repositories&quot; (701 lines)">docs/boxes-as-packages.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/capture-pipeline-redesign.md" style="--c:#a3a394" title="docs/capture-pipeline-redesign.md — &quot;Capture Pipeline Redesign&quot; (128 lines)">docs/capture-pipeline-redesign.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/chat-schedules.md" style="--c:#6d28d9" title="docs/chat-schedules.md — &quot;Chat Schedules&quot; (94 lines) · Wakeup &amp; Reactor">docs/chat-schedules.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/cli-restructure.md" style="--c:#a3a394" title="docs/cli-restructure.md — &quot;`cb` CLI Restructure — Plan&quot; (163 lines)">docs/cli-restructure.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/design-card-views.md" style="--c:#a3a394" title="docs/design-card-views.md — &quot;Card View Plugin System&quot; (876 lines)">docs/design-card-views.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/design-vision.md" style="--c:#a3a394" title="docs/design-vision.md — &quot;Callback Box: Design Vision and Architecture&quot; (68 lines)">docs/design-vision.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/event-bus-design.md" style="--c:#a3a394" title="docs/event-bus-design.md — &quot;Event Bus Design&quot; (142 lines)">docs/event-bus-design.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/gmail-setup.md" style="--c:#0e7490" title="docs/gmail-setup.md — &quot;Gmail Connector Setup&quot; (85 lines) · Connectors">docs/gmail-setup.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/google-drive.md" style="--c:#0e7490" title="docs/google-drive.md — &quot;Google Drive Integration&quot; (140 lines) · Connectors">docs/google-drive.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/google-setup.md" style="--c:#a3a394" title="docs/google-setup.md — &quot;Google Cloud Console Setup&quot; (136 lines)">docs/google-setup.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/landmark-curation.md" style="--c:#a3a394" title="docs/landmark-curation.md — &quot;Landmark Curation&quot; (48 lines)">docs/landmark-curation.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/photo-storage-investigation.md" style="--c:#a3a394" title="docs/photo-storage-investigation.md — &quot;Photo storage investigation: the ledger box is 20G&quot; (187 lines)">docs/photo-storage-investigation.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/prompt-logging.md" style="--c:#a3a394" title="docs/prompt-logging.md — &quot;Prompt Logging for Agent Invocations&quot; (212 lines)">docs/prompt-logging.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/scheduler.md" style="--c:#6d28d9" title="docs/scheduler.md — &quot;Scheduler&quot; (93 lines) · Wakeup &amp; Reactor">docs/scheduler.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/stack-decisions.md" style="--c:#a3a394" title="docs/stack-decisions.md — &quot;Stack Decisions&quot; (1186 lines)">docs/stack-decisions.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/state-management-comparison.md" style="--c:#a3a394" title="docs/state-management-comparison.md — &quot;State Management Comparison: Zustand vs MobX-State-Tree vs Valtio vs XState&quot; (831 lines)">docs/state-management-comparison.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/telegram-setup.md" style="--c:#0e7490" title="docs/telegram-setup.md — &quot;Telegram Connector Setup&quot; (136 lines) · Connectors">docs/telegram-setup.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/todo-security.md" style="--c:#a3a394" title="docs/todo-security.md — &quot;Security TODOs&quot; (25 lines)">docs/todo-security.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/test/manual/README.md" style="--c:#a3a394" title="test/manual/README.md — &quot;Manual tests&quot; (21 lines)">test/manual/README.md</a><a class="chip" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/THINKING_CLAUDE.md" style="--c:#a3a394" title="THINKING_CLAUDE.md — &quot;Thinking Machine Mode&quot; (93 lines)">THINKING_CLAUDE.md</a></div>
callback-box/docs/doc-graph.html:393:      <article class="pillar" style="--c:#c2410c">
callback-box/docs/doc-graph.html:396:          <p class="pillar-blurb">The core data format. YAML-frontmatter markdown with typed schemas — that&#39;s it.</p>
callback-box/docs/doc-graph.html:400:          <a class="pillar-entry" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/cards-as-markdown.md" style="--c:#c2410c">
callback-box/docs/doc-graph.html:407:        <p class="entry-note">The deep design RFC. 2,553 lines. The first ~200 are the spine; skim the rest unless you&#39;re migrating.</p>
callback-box/docs/doc-graph.html:425:      <article class="pillar" style="--c:#0e7490">
callback-box/docs/doc-graph.html:431:          <p class="pillar-vibe">Each connector&#39;s job is small: pull stuff, turn it into cards, leave them in the inbox. Boring on purpose.</p>
callback-box/docs/doc-graph.html:432:          <a class="pillar-entry" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/connectors.md" style="--c:#0e7490">
callback-box/docs/doc-graph.html:447:          <span class="curator-note">OAuth dance for Gmail. Notable for &#39;just one more callback&#39; energy.</span>
callback-box/docs/doc-graph.html:465:      <article class="pillar" style="--c:#6d28d9">
callback-box/docs/doc-graph.html:472:          <a class="pillar-entry" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/src/core/reactor/CLAUDE.md" style="--c:#6d28d9">
callback-box/docs/doc-graph.html:483:          <span class="curator-note">How the next wakeup gets set. Cron, except it&#39;s a CLI.</span>
callback-box/docs/doc-graph.html:493:      <article class="pillar" style="--c:#a21caf">
callback-box/docs/doc-graph.html:499:          <p class="pillar-vibe">The least settled part of the system. The engine works; the design isn&#39;t done.</p>
callback-box/docs/doc-graph.html:500:          <a class="pillar-entry" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/procedure-implementation.md" style="--c:#a21caf">
callback-box/docs/doc-graph.html:507:        <p class="entry-note">Engine internals. Short — it&#39;s a small piece.</p>
callback-box/docs/doc-graph.html:513:      <article class="pillar" style="--c:#15803d">
callback-box/docs/doc-graph.html:520:          <a class="pillar-entry" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/FRONTEND.md" style="--c:#15803d">
callback-box/docs/doc-graph.html:527:        <p class="entry-note">Palette, primitives, the &#39;no className except outer layout&#39; rule. Required reading before touching pages.</p>
callback-box/docs/doc-graph.html:549:      <article class="pillar" style="--c:#1d4ed8">
callback-box/docs/doc-graph.html:556:          <a class="pillar-entry" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/testing.md" style="--c:#1d4ed8">
callback-box/docs/doc-graph.html:567:          <span class="curator-note">Periodic &#39;does the agent still know what we think it knows?&#39; tests.</span>
callback-box/docs/doc-graph.html:577:      <article class="pillar" style="--c:#a16207">
callback-box/docs/doc-graph.html:583:          <p class="pillar-vibe">Boxes live outside this repo on purpose — so the agent doesn&#39;t accidentally inherit dev-time context when it&#39;s working on someone&#39;s life.</p>
callback-box/docs/doc-graph.html:584:          <a class="pillar-entry" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/docs/box-layout.md" style="--c:#a16207">
callback-box/docs/doc-graph.html:591:        <p class="entry-note">What a box&#39;s filesystem actually looks like, top to bottom.</p>
callback-box/docs/doc-graph.html:601:      <article class="pillar" style="--c:#475569">
callback-box/docs/doc-graph.html:608:          <a class="pillar-entry" href="vscode://file/Users/ianbicking/src/callback-mono/callback-box/deploy/README.md" style="--c:#475569">
callback-box/docs/doc-graph.html:615:        <p class="entry-note">Two scripts. That&#39;s the whole story.</p>
callback-box/docs/doc-graph.html:640:        <p class="curator-blurb">Ian thinking out loud, mostly for himself. None of these are required reading — but they&#39;re where the project&#39;s voice actually lives.</p>
callback-box/docs/doc-graph.html:648:          <p class="curator-note">The &#39;so what IS this thing&#39; question, answered patiently.</p>
callback-box/docs/doc-graph.html:652:          <p class="curator-note">Companion piece — the &#39;what&#39;s a card, really&#39; explainer.</p>
callback-box/docs/doc-graph.html:686:        <p class="curator-blurb">Designs for things that don&#39;t exist yet — or might never. Useful for finding out where Ian&#39;s head was at when he wrote them.</p>
callback-box/docs/doc-graph.html:736:          <p class="curator-note">1,186 lines of &#39;why X and not Y&#39;. Archived so the question doesn&#39;t recur.</p>
callback-box/docs/doc-graph.html:748:          <p class="curator-note">Plan that&#39;s mostly executed; the doc lingers as a record.</p>
callback-box/docs/doc-graph.html:758:        <p class="curator-blurb">Loose ends, late-night thoughts, things that are someone&#39;s problem (Ian&#39;s) and not yet anyone else&#39;s.</p>
callback-box/docs/doc-graph.html:766:          <p class="curator-note">When something&#39;s on fire, this is what to grep.</p>
callback-box/docs/implemented-plans/box-search.md:400:| Orama ranking drift after persist/restore (issue #695) | doctest pins persist→restore→search at pinned version | `cb search --rebuild` remedy | clear once doctest exists |
callback-box/docs/implemented-plans/box-search.md:454:  fallback; no Orama plugins (issue #640) so vectors will be computed by a
callback-box/docs/implemented-plans/box-search.md:525:   doctests including the persist/restore pin for issue #695 and lock
callback-box/docs/procedure-implementation.md:13:Run directories are a **recent cache, not an archive** — git history retains every committed run, so deleting a run dir loses nothing. Two mechanisms keep `procedure/runs/` small (see [Run Hygiene](#run-hygiene)): no-op runs never persist, and finished runs expire.
callback-box/docs/procedure-implementation.md:145:Skipped steps don't commit — their precheck result is recorded in the run card and rides along in the next commit. A run where every step skips produces no commits at all (see [Run Hygiene](#run-hygiene)).
callback-box/src/schemas/commentary.tsx:99:{% source pos="body; heading: Track A (#track-a); ~line 210"
callback-box/src/dev/doc-graph-html-render.ts:20:  return s.replace(/["&'<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
callback-box/src/dev/doc-graph-html-render.ts:28:  const color = pillar ? pillar.color : "#a3a394";
callback-box/docs/implemented-plans/markdoc-format-investigation.md:100:- Heading annotations `# H {% #id .class x=1 %}` round-trip exactly.
callback-box/docs/implemented-plans/markdoc-format-investigation.md:262:Identical (corrections to the earlier report): Setext H1 with short `===` and Setext H1 with long `========` **both round-trip exactly** — only Setext H2 is broken, because `---` collides with hr. ATX h1–h6 all round-trip. Heading inside list item, heading with annotation `{% #id %}`, heading with multiple annotations `{% #id .cls x=1 %}` — all identical.
callback-box/docs/implemented-plans/markdoc-format-investigation.md:325:- Before: `"&#39;\n"` → After: `"'\n"` — numeric entity decoded.
callback-box/docs/implemented-plans/markdoc-format-investigation.md:326:- Before: `"&#x27;\n"` → After: `"'\n"` — hex entity decoded.
callback-box/docs/implemented-plans/markdoc-format-investigation.md:422:- heading annotations `{% #id .cls x=1 %}`: identical.
callback-box/src/dev/doc-graph-html-css.ts:10:    --bg: #f5efe2;
callback-box/src/dev/doc-graph-html-css.ts:11:    --paper: #fbf6e9;
callback-box/src/dev/doc-graph-html-css.ts:12:    --paper-2: #ede4cc;
callback-box/src/dev/doc-graph-html-css.ts:13:    --ink: #2a241d;
callback-box/src/dev/doc-graph-html-css.ts:14:    --ink-soft: #5a4e3e;
callback-box/src/dev/doc-graph-html-css.ts:15:    --muted: #8a7d68;
callback-box/src/dev/doc-graph-html-css.ts:16:    --rule: #d8cdb1;
callback-box/src/dev/doc-graph-html-css.ts:17:    --accent: #b35a1f;
callback-box/src/dev/doc-graph-html-css.ts:18:    --link: #8c3d12;
callback-box/src/dev/doc-graph-html-css.ts:24:      radial-gradient(ellipse at top, #fff8e7 0%, var(--bg) 60%) no-repeat,
callback-box/src/dev/doc-graph-html-css.ts:116:  .ring-0 { --c: #b35a1f; background: linear-gradient(90deg, #fef1d8 0%, var(--paper) 80%); }
callback-box/src/dev/doc-graph-html-css.ts:117:  .ring-1 { --c: #d97706; background: linear-gradient(90deg, #fdf3e0 0%, var(--paper) 80%); }
callback-box/src/dev/doc-graph-html-css.ts:118:  .ring-2 { --c: #b08c4a; }
callback-box/src/dev/doc-graph-html-css.ts:119:  .ring-3 { --c: #8a7d68; }
callback-box/src/dev/doc-graph-html-css.ts:120:  .ring-4 { --c: #b3a487; opacity: 0.92; }
callback-box/src/dev/doc-graph-html-css.ts:150:  .chip:hover { text-decoration: none; transform: translateY(-1px); background: #e6dcc0; }
callback-box/src/dev/doc-graph-html-css.ts:168:    color: #fff8e7;
callback-box/src/dev/doc-graph-html-css.ts:181:    color: #fff;
callback-box/src/dev/doc-graph-html-css.ts:207:  .pillar-entry:hover { background: #e6dcc0; text-decoration: none; }
callback-box/src/dev/doc-graph-html-css.ts:219:  .pillar-entry.missing { color: #b91c1c; background: #fef2f2; border-color: #b91c1c; }
callback-box/src/dev/doc-graph-html-css.ts:227:  .pillar-support li.missing { color: #b91c1c; }
callback-box/src/dev/doc-graph-html-css.ts:275:  .curator-list li.missing { color: #b91c1c; }
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:163:  is a fragment (`#m12`) or a shorter relative form.
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:419:`ref="old/path#m12"` becomes `ref="new/path#m12"` correctly by
callback-box/src/dev/knowledge-audits.yaml:959:      <user-selection ref="/store/notes/Bread.doc.card" position="body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42">let it rise until doubled in size</user-selection>
callback-box/src/dev/knowledge-audits.yaml:1795:  # discriminator (the `type:` field was stripped in migration #19). These
callback-box/docs/implemented-plans/companion-pane-card-activity.md:94:  helpers, no new git code" for ranged diff/log is **false** (review #1,
callback-box/docs/implemented-plans/companion-pane-card-activity.md:107:  ([#453](https://github.com/TanStack/router/issues/453)); two `navigate` calls
callback-box/docs/implemented-plans/companion-pane-card-activity.md:109:  ([#2028](https://github.com/TanStack/router/issues/2028)). Mitigation:
callback-box/docs/implemented-plans/companion-pane-card-activity.md:141:**low-confidence hints, not assertions of intent** (review #7) — documented in
callback-box/docs/implemented-plans/companion-pane-card-activity.md:154:clearing**). **Capture on the SEND event, not drain-before-ack** (review #3):
callback-box/docs/implemented-plans/companion-pane-card-activity.md:176:navigate-only-on-change + `replace: true`. **Clobber fixes** (review #4): carry
callback-box/docs/implemented-plans/companion-pane-card-activity.md:203:  per-path diff. **Precise semantic** (review #1): *"commits since my last reply
callback-box/docs/implemented-plans/companion-pane-card-activity.md:235:| `cb chat whats-changed` claims a delta the git helpers can't produce (review #1) | Track D doctest | Yes — new ranged helpers (`marker..HEAD`) + uncommitted tree; semantic documented as "commits since last reply + uncommitted" | Was the original silent gap; now explicit |
callback-box/docs/implemented-plans/companion-pane-card-activity.md:236:| Queued sends lose earlier activity (latest-wins copy of `channel`, review #2) | `combineQueuedInputs` doctest | Yes — `cardActivity` unions, `openCard` latest-wins | Would be silent; union fixes it |
callback-box/docs/implemented-plans/companion-pane-card-activity.md:237:| Activity drained before send is acknowledged → permanent loss (review #3) | No (manual) | Yes — capture on SEND, clear only on ack; retained on failure | Would be silent; lifecycle fixes it |
callback-box/docs/implemented-plans/companion-pane-card-activity.md:238:| `?card=` dropped by bare-`/chat` / new-session assignment (review #4) | No (manual) | Yes — carry `card` through `ChatPage.tsx:42` + `InteractiveChat-sse.ts:150` | Would be silent (card vanishes on reload/new id) |
callback-box/docs/implemented-plans/companion-pane-card-activity.md:239:| URL sync `navigate` loop (TanStack #453/#2028) | Manual | Yes — spread-prev + changed-only + `replace:true` | Loud (hang) if unguarded; guarded → no-op |
callback-box/docs/implemented-plans/companion-pane-card-activity.md:257:  activity kinds are framed as hints to *discourage* overclaiming (review #7).
callback-box/docs/implemented-plans/companion-pane-card-activity.md:270:  (User direction; also dissolves review #5's retirement-breadth concern.)
callback-box/docs/implemented-plans/companion-pane-card-activity.md:342:- **#1** the git helpers can't do a ranged/baseline diff or log (`getDiff` has no
callback-box/docs/implemented-plans/companion-pane-card-activity.md:346:- **#2** `combineQueuedInputs` is latest-wins for `channel`
callback-box/docs/implemented-plans/companion-pane-card-activity.md:349:- **#3** draining activity before send-ack loses it on failure → capture on the
callback-box/docs/implemented-plans/companion-pane-card-activity.md:351:- **#4** bare-`/chat` and new-session assignment drop all search params but
callback-box/docs/implemented-plans/companion-pane-card-activity.md:353:- **#6** `channel` is threaded into `composeSendSnapshot`, not stored in
callback-box/docs/implemented-plans/companion-pane-card-activity.md:356:- **#7** activity vocabulary risks overclaiming intent → framed as
callback-box/docs/implemented-plans/companion-pane-card-activity.md:358:- **#5** (zoomed-view retirement breadth) is moot — retirement is out of scope;
callback-box/docs/migrations.md:100:| 6 | `doc-sheet`         | `doc-sheet.ts`         | `*.doc.card`, `*.sheet.card`: XML → flat YAML (note: `.doc.card` was the Google-Doc type at the time; renamed to `gdoc` later — see #18) |
callback-box/docs/box-layout.md:54:| `box/inbox/unhandled/` | Items with no clear destination after triage. Pre-existing catch-all; predates the formal triage pipeline (its lifecycle is `docs/plans/triage-design.md` Open Question #9). |
callback-box/docs/ideas.md:483:- Open feature request: [anthropics/claude-code#25739](https://github.com/anthropics/claude-code/issues/25739)
callback-box/docs/ideas.md:497:Related: [claude-agent-sdk-typescript#296](https://github.com/anthropics/claude-agent-sdk-typescript/issues/296) — the SDK's binary resolver tries musl before glibc on Linux. Worked around in `src/core/sdk-binary-path.ts` by passing `pathToClaudeCodeExecutable` ourselves.
callback-box/docs/ideas.md:1024:- `text-warm-500` (#B8A890, ~2.3:1) — used widely as secondary text
callback-box/docs/ideas.md:1025:- `text-warm-600` (#9B8E7E, ~3.5:1) — borderline; still fails AA
callback-box/docs/ideas.md:1026:- `text-warm-400` (#D9CEBD, ~1.4:1) — used on the lightest secondary text
callback-box/docs/ideas.md:1027:- `text-warning` (#D99A2B, ~2.0:1), `text-primary` (#9B6BA6, ~3.7:1)
callback-box/docs/stack-decisions.md:11:| 2 | [tRPC (API layer)](#decision-2-api-layer--trpc) | Default for HTTP endpoints. A small, deliberate set stays REST (SSE streaming, file uploads, WebSocket, OAuth, webhooks, binary proxy) — see the watch-list in the decision. |
callback-box/docs/stack-decisions.md:12:| 3 | [TanStack Query (data fetching)](#decision-3-data-fetching--tanstack-query) | All tRPC-migrated components use TanStack Query via `@trpc/react-query` hooks. |
callback-box/docs/stack-decisions.md:13:| 5 | [Fastify (keep)](#decision-5-backend-server--fastify-keep) | Already in use, no change needed. |
callback-box/docs/stack-decisions.md:14:| 7 | [Zod (expand)](#decision-7-schema-validation--zod-keepexpand) | All tRPC input schemas use Zod (now zod v4). No manual validation in new API code. |
callback-box/docs/stack-decisions.md:15:| 10 | [simple-git](#decision-10-git-operations--simple-git) | `src/cli/lib/git.ts` rewritten from execa to simple-git. |
callback-box/docs/stack-decisions.md:16:| 12 | [Agent SDK](#decision-12-agent-invocation--anthropic-agent-sdk) | `@anthropic-ai/claude-agent-sdk` drives agent invocation: typed message stream, session resume, in-process hooks, structured output. MCP tools + file checkpointing not yet used. |
callback-box/docs/stack-decisions.md:17:| 14 | [Testing (TAP + doctest)](#decision-14-testing-strategy--tap--doctest--snapshot-testing) | Doctest system built (runner: `tap`). DI pattern established. |
callback-box/docs/stack-decisions.md:18:| 15 | [Markdoc](#decision-15-markdown-parsing--markdoc) | Frontend renders markdown via `@markdoc/markdoc` (replaced react-markdown/remark in 2026-05) for custom tags like `{% quote %}`. See `docs/cards-as-markdown.md`. |
callback-box/docs/stack-decisions.md:19:| 23 | [Utility library replacements](#decision-23-utility-libraries--replace-hand-rolled-code) | Adopted: execa, sanitize-filename, ky. proper-lockfile reverted 2026-04 → `src/lib/file-lock.ts`. date-fns still TODO. html-entities now orphaned (rss connector removed). |
callback-box/docs/stack-decisions.md:20:| 1 | [XState (frontend state)](#decision-1-frontend-state-management--xstate) | All 6 machines migrated (`src/frontend/src/machines/`), replaced ~30 useState + ~15 useRef hooks. SSR state injection via `cb render` with scenario/state exploration. |
callback-box/docs/stack-decisions.md:21:| 20 | [Overmind + node --watch](#decision-20-dev-runner--overmind--node---watch) | Superseded by Decision 24. `cb serve --dev` still works for backend-only. |
callback-box/docs/stack-decisions.md:22:| 4 | [TanStack Router](#decision-4-routing--tanstack-router) | Code-based route tree, typed params, `href()` helper for dynamic paths. Replaced react-router-dom (dep removed). |
callback-box/docs/stack-decisions.md:28:| 6 | [Tailwind + component catalog](#decision-6-component-system--tailwind--custom-components) | **Partial** | Tailwind in use. Build catalog when agent component duplication becomes a problem. |
callback-box/docs/stack-decisions.md:29:| 19 | [Knowledge/acceptance audits](#decision-19-acceptance-testing--extend-knowledge-audit-framework) | **Partial** | knowledge-audit.ts exists. Extend to task completion audits when needed. |
callback-box/docs/stack-decisions.md:35:| 8 | [SQLite file index](#decision-8-file-based-storage-with-queryable-index) | Build when query-time parsing is a bottleneck. |
callback-box/docs/stack-decisions.md:36:| 9 | [Resource subscription](#decision-9-resource-subscription-service) | Depends on #8. Current SSE works. |
callback-box/docs/stack-decisions.md:37:| 11 | [CASL authorization](#decision-11-authorization--typed-principals--casl) | Build when agent API keys are needed. |
callback-box/docs/stack-decisions.md:38:| 13 | [Pino + OTel + Jaeger](#decision-13-tracing-and-logging--pino--opentelemetry--jaeger) | Still console.log. Build when debugging becomes painful. |
callback-box/docs/stack-decisions.md:39:| 16 | [react-hotkeys-hook](#decision-16-keyboard-shortcuts--react-hotkeys-hook) | Add when shortcuts are needed. |
callback-box/docs/stack-decisions.md:40:| 17 | [Phosphor Icons](#decision-17-icons--phosphor-icons) | Add when icon surface grows. |
callback-box/docs/stack-decisions.md:41:| 18 | [Mistral Voxtral](#decision-18-speech-recognition--mistral-voxtra) | Note for future model preference. |
callback-box/docs/stack-decisions.md:42:| 21 | [View Transitions API](#decision-21-page-transitions--view-transitions-api) | Pure CSS, no dependency. Add when transitions are desired. |
callback-box/docs/stack-decisions.md:43:| 22 | [Syntax highlighting](#decision-22-syntax-highlighting--rehype-highlight-or-rehype-prism) | Premise gone (no remark pipeline — Markdoc now). If wanted, do it Markdoc-style, not via rehype-highlight. |
callback-box/docs/stack-decisions.md:326:- **XState routable states.** Investigated: XState v5.28.0's "routable states" are a machine-internal feature for jumping to any marked state via `{ type: "xstate.route", to: "#stateId" }`. They have **no URL awareness** — no path matching, no params, no `pushState`. A URL router is still needed regardless. Routable states are useful for within-machine navigation but don't replace a URL router.
callback-box/docs/stack-decisions.md:957:1. **tsx --watch + npm = broken signals.** npm v10.3+ changed how it sends SIGINT to process groups. tsx's watcher doesn't get a chance to let the child exit gracefully, prints "Previous process hasn't exited yet. Force killing..." and leaves orphans (tsx issue #586, open since 2024).
callback-box/docs/stack-decisions.md:987:- **tsx --watch** — Broken signal handling when run through npm (issue #586). Running directly works but is fragile.
callback-box/docs/stack-decisions.md:988:- **node --watch alone** — Hardcoded SIGTERM instead of SIGINT (Node issue #49321). Servers that do graceful shutdown on SIGINT don't clean up properly.
callback-box/docs/stack-decisions.md:989:- **concurrently** — Popular but has its own orphaned process issues (issue #67). Shell-spawned commands may fork to different PIDs than what concurrently tracks.
callback-box/docs/stack-decisions.md:990:- **turbo dev** — Graceful shutdown is an open issue (#4274). Good for build orchestration, rough edges for dev servers.
callback-box/docs/stack-decisions.md:991:- **ts-node-dev** — Long-standing issue where child processes are not killed on restart (issue #79).
callback-box/docs/architecture/images/git-history-diagram.mmd:10:    style c1 fill:#b8d4e3,stroke:#333
callback-box/docs/architecture/images/git-history-diagram.mmd:11:    style c2 fill:#b8d4e3,stroke:#333
callback-box/docs/architecture/images/git-history-diagram.mmd:12:    style c3 fill:#b8d4e3,stroke:#333
callback-box/docs/architecture/images/git-history-diagram.mmd:13:    style c4 fill:#e3c8a0,stroke:#333
callback-box/docs/architecture/images/git-history-diagram.mmd:14:    style c5 fill:#e3c8a0,stroke:#333
callback-box/docs/architecture/images/git-history-diagram.mmd:15:    style c6 fill:#c8e0b8,stroke:#333
callback-box/docs/implemented-plans/websocket-chat-transport.md:186:  client beyond link lifecycle callbacks (trpc/trpc#4122). We rely on
callback-box/docs/plans/box-commentary-surface.md:104:  — codex #9 caught that `gdoc` is body-less and points at an attach file
callback-box/docs/plans/box-commentary-surface.md:124:  so generalizing it to `href` is a real change — **not** free reuse (codex #4;
callback-box/docs/plans/box-commentary-surface.md:131:  clauses `section`, `heading: TEXT (#id)`, `paragraph N`, `~line N`, joined
callback-box/docs/plans/box-commentary-surface.md:165:  to copy (codex #9).
callback-box/docs/plans/box-commentary-surface.md:197:  https://vite.dev/config/server-options.html#server-fs-allow. The accepted
callback-box/docs/plans/box-commentary-surface.md:258:          pos="body; heading: Track A (#track-a); paragraph 2; ~line 210" %}
callback-box/docs/plans/box-commentary-surface.md:283:  not otherwise wired (codex #7).
callback-box/docs/plans/box-commentary-surface.md:290:    is the drift primary** (codex #2): the only marker that identifies *this
callback-box/docs/plans/box-commentary-surface.md:297:    fallback. (Codex #2: HEAD is wrong as a *drift* signal — it changes when any
callback-box/docs/plans/box-commentary-surface.md:344:Because `Markdoc.validate` is not invoked anywhere today (codex #7 —
callback-box/docs/plans/box-commentary-surface.md:389:  `/foobar`; codex #6): in-bounds iff the relative path doesn't start with `..`
callback-box/docs/plans/box-commentary-surface.md:398:  segment — codex #6). It returns a **JSON envelope**
callback-box/docs/plans/box-commentary-surface.md:401:  codex #6). **Registered only when a dev flag is set** (the deployed server at
callback-box/docs/plans/box-commentary-surface.md:407:  affordance only (codex #2: a worktree HEAD is not a file version). Used by the
callback-box/docs/plans/box-commentary-surface.md:413:  `bin/router.ts:55` (codex #6), so this is *not* free reuse — export it (and a
callback-box/docs/plans/box-commentary-surface.md:452:  codex #9 — *not* body-less `gdoc`). Frontmatter declares the render canvas +
callback-box/docs/plans/box-commentary-surface.md:463:  `defaultVersion`** — version is per-anchor (codex #3). The body is freeform
callback-box/docs/plans/box-commentary-surface.md:477:- **Selection → composer (bigger than "one href branch" — codex #4).** The
callback-box/docs/plans/box-commentary-surface.md:576:| Wrapped target edited since anchor | Yes — `buildVersionMarkers` unit test + drift-check functional test (Track C) | Yes — compare the anchor's **content hash** to the target's current hash; mismatch paints stale (git rev is diff-only, never the drift signal — codex #2) | Clear (stale flag) — *the core drift case; silent here would be confidently-wrong commentary* |
callback-box/docs/plans/box-commentary-surface.md:578:| Selection over a `.ts` (plaintext) target → no `pos` | n/a (degraded, not failure) | plaintext is one `<Pre>` with no headings/paragraphs/`data-line`, so `pos` is usually **empty** for code (codex #8); the quoted span is the only anchor. (Optional later: emit `data-line` from the plaintext renderer for line anchors.) | Clear (span-only anchor; quoted body still present) |
callback-box/docs/plans/box-commentary-surface.md:580:| Commentary card body hand-edited with malformed/anchor-less `{% source %}` | Yes — card-lint doctest (Track A) | The new exactly-one-of-`ref`/`href` validate, **wired into `card-lint` for `*.commentary.card`** (codex #7: `Markdoc.validate` is not otherwise invoked; `body-refs.ts:49` swallows parse errors) | Clear (lint error) |
callback-box/docs/plans/box-commentary-surface.md:598:  anchor-less source. **ADDRESSED via the new card-lint** (Track A): codex #7
callback-box/docs/plans/box-commentary-surface.md:612:  --hook` PostToolUse path. (Per #7 this is new work, not an existing
callback-box/docs/plans/box-commentary-surface.md:642:  selection has no `pos` — codex #8 — so the quoted span is the anchor; emitting
callback-box/docs/plans/box-commentary-surface.md:664:read the source and falsified several claims. Applied: **#2** (content hash is
callback-box/docs/plans/box-commentary-surface.md:666:last-modifying-commit per the boxholder); **#3** (no frontmatter-default
callback-box/docs/plans/box-commentary-surface.md:668:removed); **#5** (don't weaken the global `source` schema — `ref`/`href` is
callback-box/docs/plans/box-commentary-surface.md:669:exactly-one, enforced for commentary via card-lint); **#4** (the `ref`→`href`
callback-box/docs/plans/box-commentary-surface.md:671:**#6** (route is a JSON envelope on a `?href=` query param, allowlist via
callback-box/docs/plans/box-commentary-surface.md:672:`path.relative`, `WORKTREES_ROOT` must be exported); **#7** (`cb validate` does
callback-box/docs/plans/box-commentary-surface.md:674:**#8** (`.ts` plaintext selection yields *no* `pos`, not line-only); **#9**
callback-box/docs/plans/box-commentary-surface.md:676:**#1** ("cut the whole live-wrapper build") — codex independently reinvented the
callback-box/docs/plans/box-commentary-surface.md:678:rejected in favour of the live wrapper; recorded, not adopted. **#10** (memory/
callback-box/docs/plans/box-commentary-surface.md:689:  #3). Per-box-data exemption covers the `/Users/...` literal. The `cb mv`
callback-box/docs/plans/web-page-commentary.md:66:  an extension is present (intentional upstream, v0.17.0 #652 — `.crx` can't be
callback-box/docs/plans/remove-cardworks-deletion.md:16:tasks #7–#10). What remains is the residual XML severance + the package
callback-box/docs/plans/remove-cardworks-deletion.md:67:  finding #2).
callback-box/docs/plans/remove-cardworks-deletion.md:108:Ordered by dependency. The hard gate is **C1 (#17)** — until the public
callback-box/docs/plans/remove-cardworks-deletion.md:114:### Track C1 — Make `callback-box/cards` resolve under the bundled `cb` (#17, the gate)
callback-box/docs/plans/remove-cardworks-deletion.md:131:#17, still open.
callback-box/docs/plans/remove-cardworks-deletion.md:175:  path + optional `#fragment`; resolve the path component relative to the
callback-box/docs/plans/remove-cardworks-deletion.md:233:**Rewrite to frontmatter (suspected already-broken — finding #2):**
callback-box/docs/plans/remove-cardworks-deletion.md:277:### Track C4 — Drop box-local XML schema support (#11)
callback-box/docs/plans/remove-cardworks-deletion.md:344:None. C1 (#17) carries the one real unknown and is structured as a
callback-box/docs/plans/remove-cardworks-deletion.md:435:1. **C1 (#17) — spike the public specifier under the bundle.** Build
callback-box/docs/plans/box-migration.subplan.md:4:the gated box-local-XML removal (`remove-cardworks-package.md`, task #11) and
callback-box/docs/plans/box-migration.subplan.md:138:dead data (parent plan correction, commit `35daf6c2`; task #12).
callback-box/docs/plans/box-migration.subplan.md:199:| Procedure job silently stops trampolining after migration | task #12 / sub-subplan must add a frontmatter-detector test | none yet | **Critical gap — deferred to Track 2 sub-subplan** |
callback-box/docs/plans/box-migration.subplan.md:229:  task #11/Track C, *unblocked by* this subplan, not part of it.
callback-box/docs/plans/box-migration.subplan.md:268:6. **Unblocks parent** — task #11 (drop box-local XML support) then Track C
callback-box/docs/cards-as-markdown.md:255:Agents handle both markdown and XML well. XML is also "native" — it's not the case that markdown is intrinsically more legible to an LLM. The training-data bias toward markdown for free-form writing is real (see #1), but XML's self-documenting tags are a genuine advantage that markdown gives up.
callback-box/docs/cards-as-markdown.md:257:This proposal trades XML's tag self-documentation for the friction reduction in #1 and the uniform inline-tag system Markdoc provides. It's a swap, not an unambiguous win on the format-quality axis.
callback-box/docs/cards-as-markdown.md:558:| `feedback` | ⚠️ `<response>` or `<comment>` is the prose; voice feedback adds `<transcription>`. Same multi-prose pattern as memo. | ✅ Discriminated text/voice union. | ⚠️ Voice feedback has audio. `.attach/` helps. | ⚠️ Transcription as `\|`-block. | ✅ `<target ref="path#fragment">` is well-defined. |
callback-box/docs/cards-as-markdown.md:613:This was the recommendation before considering structured-body markup options. See the [revised recommendation](#revised-recommendation-after-considering-markdoc) at the end of the doc, which changes several of these calls.
callback-box/docs/cards-as-markdown.md:647:| AsciiDoc | `[#id.class,attr=v]` blocks | N/A (own format) | Built-in ✓ | Limited | Block-only | Asciidoctor |
callback-box/docs/cards-as-markdown.md:701:This is an important [point](https://example.com) {% .featured #pt-1 %}.
callback-box/docs/cards-as-markdown.md:703:# The Big Three {% #s1 .section %}
callback-box/docs/cards-as-markdown.md:1998:{% target ref="store/briefings/2026-02-01.briefing.card#q1" %}
callback-box/docs/cards-as-markdown.md:2009:- `target ref` includes `#fragment`. The `Ref` validator parses two stages: (a) does `store/briefings/2026-02-01.briefing.card` exist? (b) does that card contain an element with `id="q1"`? Both stages produce line-located errors on failure.
callback-box/docs/plans/pdf-intake-design.md:19:**Intake-time extraction.** When a PDF arrives (`cb import`, capture endpoint, email connector), the intake path runs docling synchronously, writes a `.pdf.card` with structured contents alongside the original PDF as an [asset](glossary.md#asset), and lands the card in `box/inbox/`.
callback-box/docs/plans/pdf-intake-design.md:84:| Picture description (VLM captioning) | off | Use existing [`cb describe-images`](glossary.md#cb-attachments) pipeline (Gemini Flash) on extracted figures instead |
callback-box/docs/implemented-plans/markdoc-tags-design.md:240:  `box/chats/Mar15.chat-thread.card#m12`).
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:38:- **Handling exists?** Not specified — the plan's open question #4 acknowledges bilingualism but doesn't address conflict/dedup.
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:50:- **Handling exists?** Open question #2 flags scaling math as "confirm before implementing." No specified behavior for un-listed inline ingredients.
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:65:- **Bilingual `compileBriefing` reading both old and new — does it dedupe?** GAP. Open question #4 punts on sunset but doesn't ask about conflict semantics during the bilingual window. See failure modes.
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:74:**Issue:** The plan doesn't say what happens when a single briefing has both forms simultaneously. During the migration window — which open question #4 leaves indefinite — partial migrations and parallel edits will produce this state.
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:84:**Suggested action:** Either land lean #1 (auto-number on render) and lean from #2 (read `amount` attribute, reuse existing scaling) as actual decisions in the plan, or scope Track 1's first step down to just `{% ingredient %}` (which has the scaling dependency but skips the numbering question entirely).
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:90:**Issue:** The renderer assumes `ref` resolves. Open question #3 covers the *vague-ref* case (no path known) but not the *invalid-ref* case (path was valid, now isn't).
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:114:- **Sunsetting bilingual `compileBriefing`** — open question #4. Sensible to defer; the bilingual-conflict semantics finding above is the one piece that *can't* wait.
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:116:- **Renderer density tuning for `{% source %}`** — open question #6. Sensible to dogfood first.
callback-box/docs/plans/remove-cardworks-package.md:221:**Completeness check — typecheck PLUS grep (Codex finding #2).** After
callback-box/docs/implemented-plans/shared-frontend-backend-code.subplan.md:69:  ([Discussion #366](https://github.com/markdoc/markdoc/discussions/366)):
callback-box/docs/implemented-plans/shared-frontend-backend-code.subplan.md:75:  ([Issue #145](https://github.com/markdoc/markdoc/issues/145)):
callback-box/docs/implemented-plans/selection-commentary.md:55:<user-selection ref="/store/notes/Bread.doc.card" position="body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42">let it rise until doubled in size</user-selection>
callback-box/docs/implemented-plans/selection-commentary.md:299:    `h1–h6` (its text + `#id` from Track 1), paragraph index within that
callback-box/docs/implemented-plans/selection-commentary.md:594:  (`"body; heading: X (#x); paragraph 2; ~line 42"`). Alternative: discrete
callback-box/docs/implemented-plans/selection-commentary.md:642:      position="body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42">
callback-box/docs/implemented-plans/selection-commentary.md:665:   slug helper + doctest). No dependencies. Unblocks the `#id` clause of the
callback-box/docs/doc-graph.md:513:- docs/server-operations.md:126 (link) — **Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — 
callback-box/docs/doc-graph.md:525:- docs/boxes-as-packages.md:697 (link) — - **Interaction with the [Markdown cards idea](ideas.md#markdown-cards-replacing-xml).** Both touch the schema-definitio
callback-box/docs/implemented-plans/open-chat-from-card.md:30:  the planned `landmarkDirs` extraction (codex #5). `src/core/landmark/nearest.ts` owns its
callback-box/docs/implemented-plans/open-chat-from-card.md:33:- **Root fallback is intended (codex #2 declined).** When no non-root landmark encloses the
callback-box/docs/implemented-plans/open-chat-from-card.md:38:- **Control has a visible error state (codex #4).** The `OpenChatControl` uses the `Button`
callback-box/src/connectors/gmail-drafts.ts:178:  const url = `https://mail.google.com/mail/u/0/#drafts/${draft.message.id}`;
callback-box/src/connectors/gmail-mime.ts:149:    .replace(/&#39;/g, "'")
callback-box/src/cli/commands/google-auth.ts:72:                 min-height: 100vh; background: #fafafa; color: #333; }
callback-box/src/cli/commands/google-auth.ts:76:          p { color: #666; font-size: 0.95rem; }
callback-box/src/webapp/server-root.ts:169:    h1 { color: #333; }
callback-box/src/webapp/server-root.ts:170:    code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 3px; }
callback-box/src/frontend/src/pages/SharePage.tsx:68:        <Text size="2xl" className="mb-3">&#10003;</Text>
callback-box/src/frontend/src/index.css:76:  color: #ccc;
callback-box/src/frontend/src/index.css:80:  color: #22863a;
callback-box/src/frontend/src/index.css:85:  color: #6f42c1;
callback-box/src/frontend/src/index.css:89:  color: #032f62;
callback-box/src/frontend/src/index.css:97:    color: #1a1a1a !important;
callback-box/src/frontend/src/index.css:126:    color: #1a1a1a !important;
callback-box/src/frontend/src/index.css:134:    color: #111 !important;
callback-box/src/frontend/src/index.css:150:    color: #111 !important;
callback-box/src/frontend/src/index.css:161:    background: #f5f5f5 !important;
callback-box/src/frontend/src/index.css:162:    color: #1a1a1a !important;
callback-box/src/frontend/src/index.css:173:  color: #1a1a1a;
callback-box/src/frontend/src/index.css:186:  border-top: 3px solid #1a1a1a;
callback-box/src/frontend/src/index.css:199:  color: #555;
callback-box/src/frontend/src/index.css:205:  color: #777;
callback-box/src/frontend/src/index.css:219:  color: #111;
callback-box/src/frontend/src/index.css:224:  color: #555;
callback-box/src/frontend/src/index.css:249:  color: #111;
callback-box/src/frontend/src/index.css:252:  border-bottom: 1px solid #ccc;
callback-box/src/frontend/src/index.css:259:  border-left: 3px solid #999;
callback-box/src/frontend/src/index.css:260:  background: #f9f9f9;
callback-box/src/frontend/src/index.css:267:  color: #333;
callback-box/src/frontend/src/index.css:273:  color: #777;
callback-box/src/frontend/src/index.css:279:  border-left: 3px solid #999;
callback-box/src/frontend/src/index.css:280:  background: #f9f9f9;
callback-box/src/frontend/src/index.css:286:  color: #333;
callback-box/src/frontend/src/index.css:292:  color: #555;
callback-box/src/frontend/src/index.css:305:  color: #555;
callback-box/src/frontend/src/index.css:325:  border-top: 1px solid #ccc;
callback-box/src/frontend/src/index.css:334:  color: #555;
callback-box/src/frontend/src/index.css:347:  color: #555;
callback-box/src/frontend/src/index.css:353:  color: #333;
callback-box/src/frontend/src/index.css:361:  color: #888;
callback-box/src/frontend/src/index.css:426:  color: #666;
callback-box/src/frontend/src/index.css:436:  color: #999;
callback-box/src/frontend/src/index.css:447:    color: #999;
callback-box/src/frontend/src/index.css:502:  background-color: #fde68a;
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:221:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:232:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:240:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:244:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:248:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:252:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:297:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:301:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:337:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:341:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:349:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/realtimeTranscriptionMachine.ts:363:              target: "#realtimeTranscription.idle",
callback-box/src/frontend/src/machines/composerMachine.ts:223:                MESSAGE_SENT: "#composer.keyboard.closed", // auto-close after send
callback-box/src/frontend/public/manifest.webmanifest:6:  "background_color": "#FAF7F2",
callback-box/src/frontend/public/manifest.webmanifest:7:  "theme_color": "#9B6BA6",
callback-box/src/frontend/src/lib/selection-position.ts:7: * (with its `#id` anchor), the paragraph number, and an approximate source
callback-box/src/frontend/index.html:6:    <meta name="theme-color" content="#9B6BA6" />
callback-box/src/frontend/src/components/capture/StatusBar.tsx:46:                <span className="text-danger-light">&#10007;</span>
callback-box/src/frontend/src/components/capture/StatusBar.tsx:51:              <><span className="text-success-light">&#10003;</span><span className="text-success-light">audio ({props.audioUploaded})</span></>
callback-box/src/frontend/src/components/capture/StatusBar.tsx:63:                <span className="text-danger-light">&#10007;</span>
callback-box/src/frontend/src/components/capture/StatusBar.tsx:69:              <><span className="text-success-light">&#10003;</span><span className="text-success-light">{props.photoTotal} photos</span></>
callback-box/src/frontend/src/components/capture/StatusBar.tsx:79:                <span className="text-danger-light">&#10007;</span>
callback-box/src/frontend/src/components/capture/StatusBar.tsx:85:              <><span className="text-success-light">&#10003;</span><span className="text-success-light">{props.fileTotal} files</span></>
callback-box/src/frontend/src/components/capture/StatusBar.tsx:89:        <button onClick={props.onPickFile} className="text-gray-400 hover:text-white p-1" title="Upload file" aria-label="Upload file"><span aria-hidden="true">&#128206;</span></button>
callback-box/src/frontend/src/components/capture/StatusBar.tsx:90:        <button onClick={props.onPickGallery} className="text-gray-400 hover:text-white p-1" title="Add from gallery" aria-label="Add from gallery"><span aria-hidden="true">&#128247;</span></button>
callback-box/src/frontend/src/components/capture/StatusBar.tsx:97:        ><span aria-hidden="true">&#9881;</span></button>
callback-box/src/frontend/tailwind.config.js:9:    DEFAULT: "#E8A838",
callback-box/src/frontend/tailwind.config.js:10:    light: "#F0C56E",
callback-box/src/frontend/tailwind.config.js:11:    dark: "#C98A20",
callback-box/src/frontend/tailwind.config.js:12:    50: "#FDF6E8",
callback-box/src/frontend/tailwind.config.js:13:    100: "#FBE9C5",
callback-box/src/frontend/tailwind.config.js:16:    DEFAULT: "#D4845A",
callback-box/src/frontend/tailwind.config.js:17:    light: "#E0A080",
callback-box/src/frontend/tailwind.config.js:18:    dark: "#B56A40",
callback-box/src/frontend/tailwind.config.js:19:    50: "#FBF2EC",
callback-box/src/frontend/tailwind.config.js:22:    DEFAULT: "#C2788A",
callback-box/src/frontend/tailwind.config.js:23:    light: "#D49AAA",
callback-box/src/frontend/tailwind.config.js:24:    dark: "#A05A6C",
callback-box/src/frontend/tailwind.config.js:25:    50: "#F9EEF0",
callback-box/src/frontend/tailwind.config.js:26:    100: "#F2DDE1",
callback-box/src/frontend/tailwind.config.js:29:    DEFAULT: "#9B6BA6",
callback-box/src/frontend/tailwind.config.js:30:    light: "#B88DC0",
callback-box/src/frontend/tailwind.config.js:31:    dark: "#7B4F8A",
callback-box/src/frontend/tailwind.config.js:32:    50: "#F3ECF5",
callback-box/src/frontend/tailwind.config.js:33:    100: "#E4D6E9",
callback-box/src/frontend/tailwind.config.js:36:    DEFAULT: "#7B6FB0",
callback-box/src/frontend/tailwind.config.js:37:    light: "#9B92C8",
callback-box/src/frontend/tailwind.config.js:38:    dark: "#5E5490",
callback-box/src/frontend/tailwind.config.js:39:    50: "#EEEDF5",
callback-box/src/frontend/tailwind.config.js:40:    100: "#D8D4E8",
callback-box/src/frontend/tailwind.config.js:41:    muted: "#C4BAD8",
callback-box/src/frontend/tailwind.config.js:45:    DEFAULT: "#4F9E5E",
callback-box/src/frontend/tailwind.config.js:46:    light: "#7BBC87",
callback-box/src/frontend/tailwind.config.js:47:    dark: "#3C7F49",
callback-box/src/frontend/tailwind.config.js:48:    50: "#EBF5ED",
callback-box/src/frontend/tailwind.config.js:49:    100: "#D6EADD",
callback-box/src/frontend/tailwind.config.js:53:    DEFAULT: "#D99A2B",
callback-box/src/frontend/tailwind.config.js:54:    light: "#E8B85F",
callback-box/src/frontend/tailwind.config.js:55:    dark: "#B07D1C",
callback-box/src/frontend/tailwind.config.js:56:    50: "#FBF3E4",
callback-box/src/frontend/tailwind.config.js:57:    100: "#F6E4BC",
callback-box/src/frontend/tailwind.config.js:61:    50: "#FBF5EE",
callback-box/src/frontend/tailwind.config.js:62:    100: "#F7F0E6",
callback-box/src/frontend/tailwind.config.js:63:    200: "#F3EBE0",
callback-box/src/frontend/tailwind.config.js:64:    300: "#E8DDD0",
callback-box/src/frontend/tailwind.config.js:65:    400: "#D9CEBD",
callback-box/src/frontend/tailwind.config.js:66:    500: "#B8A890",
callback-box/src/frontend/tailwind.config.js:67:    600: "#9B8E7E",
callback-box/src/frontend/tailwind.config.js:68:    700: "#6B5D4B",
callback-box/src/frontend/tailwind.config.js:69:    800: "#4A3F32",
callback-box/src/frontend/tailwind.config.js:70:    900: "#2E2720",
callback-box/src/frontend/src/components/Source.tsx:57: *   `box/chats/Mar15.chat-thread.card#m12`      → "Mar15"
callback-box/src/frontend/src/components/Source.tsx:60: * `.<type>.card` suffix, strips a trailing `#fragment`, then replaces
callback-box/src/frontend/src/components/SessionLog.tsx:33:            &#9654;
callback-box/src/core/chat-whats-changed.ts:5: * Precise semantic (the cross-model review's review #1): the report is the
callback-box/src/frontend/src/components/chat/activity-rendering.tsx:154:        <span className="text-warm-500 group-open/tool:rotate-90 transition-transform text-[10px]">&#9654;</span>
callback-box/src/frontend/src/components/chat/activity-rendering.tsx:209:                <span className="text-warm-500 group-open/think:rotate-90 transition-transform text-[10px]">&#9654;</span>
callback-box/src/frontend/src/components/chat/activity-rendering.tsx:247:        <span className="text-warm-500 group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
callback-box/src/frontend/src/components/chat/activity-rendering.tsx:267:        <span className="text-warm-500 group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
callback-box/src/core/script-env.ts:39: * `config/box.json#publicUrl` so that a running local dev server (which
callback-box/src/core/script-env.ts:50: * `config/box.json#publicUrl`: full URL including slug (e.g.
callback-box/src/core/script-env.ts:88: *   `config/box.json#publicUrl` (or `PUBLIC_URL` env fallback).
callback-box/src/frontend/src/components/chat/user-message.tsx:190:          <span className={statusColor}>&#x25CF;</span>
callback-box/src/frontend/src/components/chat/InteractiveChat-message-items.tsx:101:      <Grid size={40} color="#D4845A" speed={1.5} /> {/* coral */}
callback-box/src/frontend/src/components/Redacted.tsx:29:      "<rect width=\"100%\" height=\"100%\" filter=\"url(#n)\" opacity=\"0.85\"/>" +
callback-box/src/frontend/src/components/CommandRunner.tsx:14:  fg: "#e5e7eb", // gray-200
callback-box/src/frontend/src/components/CommandRunner.tsx:15:  bg: "#111827", // gray-900
callback-box/src/frontend/src/components/CommandRunner.tsx:17:    0: "#374151",  // black -> gray-700
callback-box/src/frontend/src/components/CommandRunner.tsx:18:    1: "#ef4444",  // red
callback-box/src/frontend/src/components/CommandRunner.tsx:19:    2: "#22c55e",  // green
callback-box/src/frontend/src/components/CommandRunner.tsx:20:    3: "#eab308",  // yellow
callback-box/src/frontend/src/components/CommandRunner.tsx:21:    4: "#3b82f6",  // blue
callback-box/src/frontend/src/components/CommandRunner.tsx:22:    5: "#a855f7",  // magenta
callback-box/src/frontend/src/components/CommandRunner.tsx:23:    6: "#06b6d4",  // cyan
callback-box/src/frontend/src/components/CommandRunner.tsx:24:    7: "#e5e7eb",  // white -> gray-200
callback-box/src/frontend/src/components/CommandRunner.tsx:25:    8: "#6b7280",  // bright black -> gray-500
callback-box/src/frontend/src/components/CommandRunner.tsx:26:    9: "#f87171",  // bright red
callback-box/src/frontend/src/components/CommandRunner.tsx:27:    10: "#4ade80", // bright green
callback-box/src/frontend/src/components/CommandRunner.tsx:28:    11: "#facc15", // bright yellow
callback-box/src/frontend/src/components/CommandRunner.tsx:29:    12: "#60a5fa", // bright blue
callback-box/src/frontend/src/components/CommandRunner.tsx:30:    13: "#c084fc", // bright magenta
callback-box/src/frontend/src/components/CommandRunner.tsx:31:    14: "#22d3ee", // bright cyan
callback-box/src/frontend/src/components/CommandRunner.tsx:32:    15: "#f9fafb", // bright white -> gray-50
callback-box/src/frontend/src/components/dashboard/ScheduleOverview.tsx:137:              &#9888; {s.missingRequirements.join(", ")}
callback-box/src/frontend/src/components/dashboard/ScheduleOverview.tsx:201:    return <span className="text-success text-xs">&#10003;</span>;
callback-box/src/frontend/src/components/dashboard/ScheduleOverview.tsx:211:        &#10007; {lastError ? <span className="text-warm-600">{lastError.substring(0, 60)}&#8230;</span> : null}
callback-box/src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:93: * state, no debounce needed). Lifecycle (review #3): `capture` snapshots the
callback-box/src/core/views-doc.ts:263:            <div key={i} style={{ padding: "0.25rem 0", color: item.attrs.status === "done" ? "#999" : "#000" }}>
callback-box/src/core/views-doc.ts:305:          <div key={type} style={{ padding: "0.5rem 1rem", background: "#f0f0f0", borderRadius: "0.5rem" }}>
callback-box/src/core/rewrite-card-refs.ts:39:/** Split a ref's path from a trailing `#fragment` (anchor / message id). */
callback-box/src/frontend/src/components/ui/Accordion.tsx:27:      &#9654;
callback-box/src/core/agent-guide/chat.ts:47:    "<user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42\">let it rise until doubled in size</user-selection>",
callback-box/src/core/agent-guide/chat.ts:52:    "- `pos` is a **rough** locator (section, nearest heading + its `#id`, paragraph, approximate line) — a hint for finding the original, not an exact offset. Clauses are omitted when not determinable.",
callback-box/src/core/agent-guide/source.ts:32:    "card path plus a fragment (`#m12` for a chat message, `#step-3` for",
callback-box/src/core/agent-guide/source.ts:78:    "- `pos` — a rough locator (section, nearest heading + `#id`, paragraph,",

exec
/opt/homebrew/bin/bash -lc "rg -n \"listCards\\(|loader\\.move\\(|movePhase2CardFiles|rewriteReferrerRefs|rewriteMovedCardRefs|rewrite-card-refs|cb mv|move command|attach/\" callback-box/test callback-box/src/core/commands callback-box/src/core/rewrite-card-refs.ts -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/core/rewrite-card-refs.ts:2: * Resolution-based ref rewriting for `cb mv`.
callback-box/src/core/rewrite-card-refs.ts:14: * card. The `attach/` virtual prefix is scoped to its owning card and is left
callback-box/src/core/rewrite-card-refs.ts:48: * rules as the renderer: leading `/` is box-root-absolute, `attach/` resolves
callback-box/src/core/rewrite-card-refs.ts:121: * location. Box-root-absolute refs are unaffected by the move; `attach/` refs
callback-box/src/core/rewrite-card-refs.ts:124: * the `attach/` prefix).
callback-box/src/core/rewrite-card-refs.ts:260:export function rewriteReferrerRefs(params: {
callback-box/src/core/rewrite-card-refs.ts:278:export function rewriteMovedCardRefs(params: {
callback-box/src/core/commands/scan-import-document.ts:62:    `${sessionAttachRelDir}/${fileCardBasename}.attach/source.pdf`,
callback-box/test/asset-manifest.doctest.md:3:Per-`.attach/` manifest format, hashing, and load/save. See
callback-box/test/asset-manifest.doctest.md:42:=> /box/inbox/foo.attach/manifest.json
callback-box/test/asset-manifest.doctest.md:64:await box2.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest.doctest.md:65:const entry = await computeEntry(box2.path("foo.attach/photo.jpg"));
callback-box/test/asset-manifest.doctest.md:87:await box3.write("foo.attach/.gitkeep", "");
callback-box/test/asset-manifest.doctest.md:136:const raw = await box5.read("foo.attach/manifest.json");
callback-box/test/asset-manifest.doctest.md:157:await box6.write("foo.attach/manifest.json", JSON.stringify({ files: "not an object" }));
callback-box/test/asset-manifest.doctest.md:187:await box7.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest.doctest.md:188:const fileStat = await stat(box7.path("foo.attach/photo.jpg"));
callback-box/test/schemas.doctest.md:299:  frozenRef: "attach/page.frozen",
callback-box/test/schemas.doctest.md:307:frozen: attach/page.frozen
callback-box/test/search-index.doctest.md:140:await box.write("store/notes/Note.attach/snippet.md", "apportioned share duplicate inside attach scope");
callback-box/test/search-index.doctest.md:159:  "---\ndrive-id: d1\ntitle: Project Notes\nmodified: 2026-05-01\nlink: https://docs.google.com/document/d/d1/edit\nowner: o@example.com\ncontent:\n  ref: attach/Notes.md\n---\n"
callback-box/test/search-index.doctest.md:161:await box.write("store/drive/Notes.attach/Notes.md", "Planning the lighthouse migration.");
callback-box/test/search-index.doctest.md:166:await box.write("store/drive/Notes.attach/Notes.md", "Planning the submarine migration instead.");
callback-box/test/attach-path.doctest.md:3:Helpers for the `.attach/` directory convention. Every card may have a sibling directory named `<basename>.attach/`. Refs from the card to its attached files use the virtual prefix `attach/<file>`.
callback-box/test/attach-path.doctest.md:72:=> inbox/Foo.attach/photo-001.jpg
callback-box/test/attach-path.doctest.md:75:=> Foo.attach/audio.webm
callback-box/test/attach-path.doctest.md:78:=> inbox/scan-001.attach/photo-001.image.card
callback-box/test/attach-path.doctest.md:85:=> inbox/Foo.attach/attachments/quarterly.pdf
callback-box/test/attach-path.doctest.md:90:A ref uses the `attach/` virtual prefix when it starts with `attach/` (or is exactly `attach`).
callback-box/test/attach-path.doctest.md:93:isAttachRef("attach/photo-001.jpg")
callback-box/test/attach-path.doctest.md:99:isAttachRef("attach/sub/scan.image.card")
callback-box/test/attach-path.doctest.md:106:isAttachRef("store/x.attach/y.jpg")
callback-box/test/attach-path.doctest.md:112:isAttachRef("./attach/photo.jpg")
callback-box/test/attach-path.doctest.md:119:splitAttachRef("attach/photo-001.jpg")
callback-box/test/attach-path.doctest.md:122:splitAttachRef("attach/sub/scan.image.card")
callback-box/test/attach-path.doctest.md:128:splitAttachRef("store/x.attach/y.jpg")
callback-box/test/attach-path.doctest.md:134:Expands a ref that uses the `attach/` prefix to a path against a card's attach scope.
callback-box/test/attach-path.doctest.md:137:resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg")
callback-box/test/attach-path.doctest.md:138:=> inbox/Foo.attach/photo-001.jpg
callback-box/test/attach-path.doctest.md:140:resolveAttachRef("inbox/Foo.email-message.card", "attach/attachments/foo.pdf")
callback-box/test/attach-path.doctest.md:141:=> inbox/Foo.attach/attachments/foo.pdf
callback-box/test/attach-path.doctest.md:202:isInsideAttachScope("inbox/Foo.attach/photo.jpg")
callback-box/test/attach-path.doctest.md:205:isInsideAttachScope("inbox/Foo.attach/nested/deeper/thing.jpg")
callback-box/test/attach-path.doctest.md:208:isInsideAttachScope("inbox/Foo.attach/scan.image.attach/photo.jpg")
callback-box/src/core/commands/attachments-gitignore.ts:5: * `.gitignore` so asset binaries inside `.attach/` scopes are ignored
callback-box/src/core/commands/attachments-gitignore.ts:45:# Assets inside .attach/ scopes are tracked via per-dir manifest.json
callback-box/src/core/commands/attachments-gitignore.ts:47:**/*.attach/**/*.jpg
callback-box/src/core/commands/attachments-gitignore.ts:48:**/*.attach/**/*.jpeg
callback-box/src/core/commands/attachments-gitignore.ts:49:**/*.attach/**/*.png
callback-box/src/core/commands/attachments-gitignore.ts:50:**/*.attach/**/*.webp
callback-box/src/core/commands/attachments-gitignore.ts:51:**/*.attach/**/*.avif
callback-box/src/core/commands/attachments-gitignore.ts:52:**/*.attach/**/*.heic
callback-box/src/core/commands/attachments-gitignore.ts:53:**/*.attach/**/*.tif
callback-box/src/core/commands/attachments-gitignore.ts:54:**/*.attach/**/*.tiff
callback-box/src/core/commands/attachments-gitignore.ts:55:**/*.attach/**/*.gif
callback-box/src/core/commands/attachments-gitignore.ts:56:**/*.attach/**/*.webm
callback-box/src/core/commands/attachments-gitignore.ts:57:**/*.attach/**/*.mp3
callback-box/src/core/commands/attachments-gitignore.ts:58:**/*.attach/**/*.m4a
callback-box/src/core/commands/attachments-gitignore.ts:59:**/*.attach/**/*.wav
callback-box/src/core/commands/attachments-gitignore.ts:60:**/*.attach/**/*.pdf
callback-box/src/core/commands/attachments-gitignore.ts:61:**/*.attach/**/*.mp4
callback-box/src/core/commands/attachments-gitignore.ts:62:**/*.attach/**/*.mov
callback-box/src/core/commands/attachments-gitignore.ts:114: * Find the deepest `.attach/` directory enclosing a path. Returns the
callback-box/src/core/commands/attachments-gitignore.ts:118: *   thread.attach/msg-001.attach/attachments/foo.png
callback-box/src/core/commands/attachments-gitignore.ts:119: *   → thread.attach/msg-001.attach   (NOT thread.attach — deepest wins)
callback-box/src/core/commands/attachments-gitignore.ts:173:    if (relPath.includes(".attach/")) inAttach.push(relPath);
callback-box/src/core/commands/attachments-gitignore.ts:219:  // about — refuse). Files outside .attach/ scopes aren't our concern; we
callback-box/src/core/commands/attachments-gitignore.ts:223:    ctx.writeLine(`Skipping ${outsideAttach.length} file(s) outside .attach/ scopes (gitignored for other reasons):`);
callback-box/src/core/commands/attachments-gitignore.ts:233:  // A binary at `msg-001.attach/attachments/foo.png` belongs to
callback-box/src/core/commands/attachments-gitignore.ts:234:  // `msg-001.attach/manifest.json` under key `attachments/foo.png`.
callback-box/src/core/commands/transcribe-captures.ts:112:          ctx.writeLine(`  Skipping ${cardFile}: ref does not use attach/ prefix: ${audioRef}`);
callback-box/test/contains-state.doctest.md:126:  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: " + desc + "\n---\n";
callback-box/test/card-loaders.doctest.md:105:  filename: { ref: "attach/photo.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
callback-box/test/card-loaders.doctest.md:132:  filename: { ref: "attach/p.jpg", captured: "2024-01-15T00:00:00Z", source: "camera-environment" },
callback-box/test/card-loaders.doctest.md:137:=> {"status":"analyzed","has-text":true,"rotation":"90","filename":"attach/p.jpg"}
callback-box/test/migrate-webpage-card.doctest.md:22:// A fused capture commentary: readable + frozen in .attach/, remarks (with an
callback-box/test/migrate-webpage-card.doctest.md:24:const FUSED = "---\ntitle: Foo\ndefaultRef: attach/readable.md\nsource: https://example.com/foo\ncaptured: 2026-06-14\nfrozen: attach/page.frozen\n---\n{% source ref=\"attach/readable.md\" pos=\"body\" version=\"sha256:abc\" %}{% quote %}a distinctive span{% /quote %}{% /source %}\n\nMy remark about it.\n";
callback-box/test/migrate-webpage-card.doctest.md:33:await fs.writeFile(path.join(box, "store/reading/Foo.attach/readable.md"), "# Foo\n\nThe readable body with a distinctive span inside.\n");
callback-box/test/migrate-webpage-card.doctest.md:34:await fs.writeFile(path.join(box, "store/reading/Foo.attach/page.frozen"), "<html>frozen</html>");
callback-box/test/migrate-webpage-card.doctest.md:47:[wpText.includes("source: https://example.com/foo"), wpText.includes("frozen: attach/page.frozen"), wpText.includes("The readable body with a distinctive span")].join(",")
callback-box/test/migrate-webpage-card.doctest.md:64:const cmText = await fs.readFile(path.join(box, "store/reading/Foo.attach/Foo.commentary.card"), "utf8");
callback-box/test/migrate-webpage-card.doctest.md:65:[cmText.includes("My remark about it."), cmText.includes("attach/readable.md")].join(",")
callback-box/test/migrate-webpage-card.doctest.md:77:const cm = await loadCardFromText({ content: cmText, source: "store/reading/Foo.attach/Foo.commentary.card", ctx });
callback-box/test/migrate-webpage-card.doctest.md:95:const BODYPROV = "---\ntitle: Old\ndefaultRef: attach/readable.md\n---\n[Original page](https://old.example.com/x) · captured 2026-06-14T10:36:55.904Z\n\n{% source ref=\"attach/readable.md\" pos=\"body\" version=\"sha256:1\" %}{% quote %}a span{% /quote %}{% /source %}\n\nA remark here.\n";
callback-box/test/migrate-webpage-card.doctest.md:97:await fs.writeFile(path.join(box, "store/reading/Old.attach/readable.md"), "# Old\n\nThe page body.\n");
callback-box/test/migrate-webpage-card.doctest.md:109:const cmText = await fs.readFile(path.join(box, "store/reading/Old.attach/Old.commentary.card"), "utf8");
callback-box/test/migrate-webpage-card.doctest.md:110:[cmText.includes("A remark here."), cmText.includes("Original page"), cmText.includes("attach/readable.md")].join(",")
callback-box/src/core/commands/assemble-timeline-helpers.ts:51:  ref: string; // session-scope ref to the image card (e.g. attach/photo-001.image.card)
callback-box/src/core/commands/assemble-timeline-helpers.ts:176:      ref: `attach/${ic}`,
callback-box/test/capture-pipeline.test.ts:112:  // Each image lives inside its own attach scope (e.g. photo-001.attach/photo-001.jpg).
callback-box/test/move-command.doctest.md:1:# `cb mv` — move/rename cards and rewrite references
callback-box/test/move-command.doctest.md:3:The move command relocates a card (or directory) and keeps every reference
callback-box/test/move-command.doctest.md:9:were written. A card's sibling `<basename>.attach/` directory moves with it,
callback-box/test/move-command.doctest.md:26:Moving a frontmatter card carries its `.attach/` directory along. Other cards
callback-box/test/move-command.doctest.md:29:links to cards that stayed put are rewritten too, while its `attach/`-prefixed
callback-box/test/move-command.doctest.md:36:  "---\ntype: doc\ntitle: Engine\n---\n# Engine\nPhoto: ![p](attach/photo.jpg)\nRelated: [Priya](Priya.doc.card)\n",
callback-box/test/move-command.doctest.md:38:await box.write("box/notes/Engine.attach/photo.jpg", "JPG");
callback-box/test/move-command.doctest.md:41:  "---\ntype: doc\ntitle: Priya\n---\nSee [Engine](Engine.doc.card) and its [photo](Engine.attach/photo.jpg).\n",
callback-box/test/move-command.doctest.md:45:  "---\ntype: doc\ntitle: Index\n---\nAbs [Engine](/box/notes/Engine.doc.card) and [photo](/box/notes/Engine.attach/photo.jpg).\n",
callback-box/test/move-command.doctest.md:59:store/archive/Engine.attach/photo.jpg
callback-box/test/move-command.doctest.md:62:await box.read("store/archive/Engine.attach/photo.jpg")
callback-box/test/move-command.doctest.md:66:The moved card keeps its `attach/` self-ref and gets a recomputed relative link
callback-box/test/move-command.doctest.md:77:Photo: ![p](attach/photo.jpg)
callback-box/test/move-command.doctest.md:91:See [Engine](../../store/archive/Engine.doc.card) and its [photo](../../store/archive/Engine.attach/photo.jpg).
callback-box/test/move-command.doctest.md:103:Abs [Engine](/store/archive/Engine.doc.card) and [photo](/store/archive/Engine.attach/photo.jpg).
callback-box/test/move-command.doctest.md:242:await box.write("box/Old_Name.attach/note.txt", "hi");
callback-box/test/move-command.doctest.md:243:await box.write("box/ref.memo.card", "---\ntype: memo\nref: /box/Old_Name.doc.card\n---\nlink [n](Old_Name.attach/note.txt)\n");
callback-box/test/move-command.doctest.md:249:box/New_Name.attach/note.txt
callback-box/test/move-command.doctest.md:259:link [n](New_Name.attach/note.txt)
callback-box/test/asset-manifest-scan.doctest.md:3:The directory walk that reconciles every `.attach/` manifest against
callback-box/test/asset-manifest-scan.doctest.md:32:await box.write("box/inbox/scan-1.attach/photo-001.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:33:await box.write("box/inbox/scan-1.attach/photo-001.image.attach/photo-001.jpg", "def");
callback-box/test/asset-manifest-scan.doctest.md:34:await box.write("store/old/voice.attach/audio.webm", "ghi");
callback-box/test/asset-manifest-scan.doctest.md:40:box/inbox/scan-1.attach/photo-001.image.attach
callback-box/test/asset-manifest-scan.doctest.md:52:await box2.write("foo.attach/photo-001.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:53:await box2.write("foo.attach/photo-002.jpg", "def");
callback-box/test/asset-manifest-scan.doctest.md:81:await box3.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:108:await box4.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:113:await backdate(box4.path("foo.attach/photo.jpg"));
callback-box/test/asset-manifest-scan.doctest.md:133:await box5.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:136:await box5.write("foo.attach/photo.jpg", "abcdef");
callback-box/test/asset-manifest-scan.doctest.md:157:await box6.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:161:await unlink(box6.path("foo.attach/photo.jpg"));
callback-box/test/asset-manifest-scan.doctest.md:184:await box7.write("foo.attach/old.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:188:await rename(box7.path("foo.attach/old.jpg"), box7.path("foo.attach/new.jpg"));
callback-box/test/asset-manifest-scan.doctest.md:214:await box8.write("session.attach/photo-001.image.card", "<image status='new'/>\n");
callback-box/test/asset-manifest-scan.doctest.md:218:print(`manifest file exists: ${await fileExists(box8.path("session.attach/manifest.json"))}`)
callback-box/test/asset-manifest-scan.doctest.md:236:await box9.write("foo.attach/photo.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:243:print(`manifest file exists: ${await fileExists(box9.path("foo.attach/manifest.json"))}`)
callback-box/test/asset-manifest-scan.doctest.md:257:inside nested `.attach/` directories (which have their own manifests).
callback-box/test/asset-manifest-scan.doctest.md:259:`<thread>.attach/msg-001.attach/attachments/<file>`. The `attachments/`
callback-box/test/asset-manifest-scan.doctest.md:265:await boxR.write("msg.attach/attachments/Outlook.png", "alpha");
callback-box/test/asset-manifest-scan.doctest.md:266:await boxR.write("msg.attach/attachments/img/inline.jpg", "beta");
callback-box/test/asset-manifest-scan.doctest.md:267:await boxR.write("msg.attach/photo-001.attach/photo-001.jpg", "gamma");
callback-box/test/asset-manifest-scan.doctest.md:276:The nested `.attach/` scope is left to its own scan — not picked up here.
callback-box/test/asset-manifest-scan.doctest.md:288:await box10.write("box/inbox/scan-1.attach/photo-001.jpg", "abc");
callback-box/test/asset-manifest-scan.doctest.md:289:await box10.write("box/inbox/scan-2.attach/photo-001.jpg", "def");
callback-box/test/search-extract.doctest.md:64:  "box/inbox/email/t.attach/msg-001.email-message.card",
callback-box/test/search-extract.doctest.md:65:  "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: alice@example.com\nto: bob@example.com\ndate: 2026-05-14T19:00:00Z\nsubject: Weekend plans\nsnippet: Hey, are you free Saturday...\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n"
callback-box/test/search-extract.doctest.md:76:JSON.stringify(declareInputFiles({ path: "box/inbox/email/t.attach/msg-001.email-message.card", card: await loadCardFromText({ content: "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: a@x.com\ndate: 2026-05-14T19:00:00Z\nsubject: s\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n", source: "box/inbox/email/t.attach/msg-001.email-message.card", ctx }) }))
callback-box/test/search-extract.doctest.md:85:  "---\nthread-id: t1\nsubject: Usage-based pricing demo\nparticipants:\n  - hello@metricly.example\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nlabels:\n  - promotions\nmessages:\n  - ref: attach/msg-001.email-message.card\n---\n"
callback-box/test/search-extract.doctest.md:102:const cardText = "---\ndrive-id: d1\ntitle: Project Notes\nmodified: 2026-05-01\nlink: https://docs.google.com/document/d/d1/edit\nowner: owner@example.com\ncontent:\n  ref: attach/Project_Notes.md\n---\n";
callback-box/test/search-extract.doctest.md:106:=> ["store/drive/Project_Notes.attach/Project_Notes.md"]
callback-box/test/search-extract.doctest.md:108:const inputContents = new Map([["store/drive/Project_Notes.attach/Project_Notes.md", "Quarterly planning notes for the project."]]);
callback-box/test/search-extract.doctest.md:122:  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: The boiler's serial-number plate (K-44210)\ntext:\n  - source: plate\n    content: Serial K-44210 Model HX-200 240V\n---\n"
callback-box/test/search-extract.doctest.md:195:  "---\ndrive-id: d2\ntitle: Family Budget\nmodified: 2026-05-01\nlink: https://docs.google.com/spreadsheets/d/d2/edit\nowner: o@example.com\nsheets:\n  - ref: attach/tab-0.json\n    title: Monthly Spending\n    gid: \"0\"\n---\n"
callback-box/src/core/commands/move.ts:28: * Arguments for the move command.
callback-box/src/core/commands/move.ts:225:      "Moved-By": "cb mv",
callback-box/src/core/commands/move.ts:232: * Execute the move command (supports single or multiple source paths).
callback-box/src/core/commands/move-operations.ts:6: * siblings, including the `<basename>.attach/` directory, plus cross-card
callback-box/src/core/commands/move-operations.ts:8: * rewrite (rewrite-card-refs.ts) over every other card. That covers what
callback-box/src/core/commands/move-operations.ts:20:  rewriteReferrerRefs,
callback-box/src/core/commands/move-operations.ts:21:  rewriteMovedCardRefs,
callback-box/src/core/commands/move-operations.ts:23:} from "../rewrite-card-refs.js";
callback-box/src/core/commands/move-operations.ts:24:import { isPhase2CardPath, movePhase2CardFiles } from "./move-phase2.js";
callback-box/src/core/commands/move-operations.ts:105:  const allCards = await loader.listCards();
callback-box/src/core/commands/move-operations.ts:111:        ? rewriteMovedCardRefs({
callback-box/src/core/commands/move-operations.ts:118:        : rewriteReferrerRefs({
callback-box/src/core/commands/move-operations.ts:173:    return { movedFiles: await movePhase2CardFiles(sourcePath, destPath), updatedCards: [] };
callback-box/src/core/commands/move-operations.ts:176:  const { result } = await loader.move(card, destPath);
callback-box/src/core/commands/move-operations.ts:188: * its attach directory. Resolution-based (see rewrite-card-refs.ts), so refs
callback-box/src/core/commands/move-operations.ts:213:  const allCards = await loader.listCards();
callback-box/src/core/commands/move-operations.ts:221:      const { text: updated, count } = rewriteReferrerRefs({
callback-box/src/core/commands/move-operations.ts:242: * from its new location (absolute and `attach/` refs are unaffected).
callback-box/src/core/commands/move-operations.ts:257:    const { text: relocated, count } = rewriteMovedCardRefs({
callback-box/src/core/commands/move-operations.ts:318:  // The loader is constructed unconditionally because `listCards()` is
callback-box/test/markdoc-source.doctest.md:4:in-box, `cb mv`-tracked target) or `href` (an external full URL), plus optional
callback-box/test/routes-views.doctest.md:173:export const dependencies = ["box/**/*.card", "box/inbox/Test.attach/**/*.jsonl"];
callback-box/test/routes-views.doctest.md:178:await ctx.seed("box/inbox/Test.attach/sessions/history.jsonl", '{"summary":"first run"}\n{"summary":"second run"}\n');
callback-box/test/routes-views.doctest.md:184:=> box/inbox/Test.attach/sessions/history.jsonl
callback-box/test/routes-views.doctest.md:193:=> box/inbox/Test.attach/sessions/history.jsonl
callback-box/test/routes-views.doctest.md:206:const full = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl" });
callback-box/test/routes-views.doctest.md:213:const tail = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=-25" } });
callback-box/test/routes-views.doctest.md:223:const mid = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=0-22" } });
callback-box/test/routes-views.doctest.md:227:const past = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=999-" } });
callback-box/src/core/commands/scan-import-session.ts:6: * `.attach/` scope. `createSessionLayout` computes those paths and creates the
callback-box/src/core/commands/move-phase2.ts:8: * the move ourselves; the substring rewrite pass in the move command
callback-box/src/core/commands/move-phase2.ts:52: * Rename a file and (if present) its sibling `<basename>.attach/`
callback-box/src/core/commands/move-phase2.ts:54: * `loader.move()` does for XML cards. Returns the list of moved
callback-box/src/core/commands/move-phase2.ts:57:export async function movePhase2CardFiles(
callback-box/test/routes-files-write.doctest.md:22:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:29:=> store/playground/Playground.attach/sessions/history.jsonl
callback-box/test/routes-files-write.doctest.md:43:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:61:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:76:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:89:  url: "/api/files/store/playground/Playground.attach/sessions/history.jsonl",
callback-box/test/routes-files-write.doctest.md:121:  payload: { path: "store/playground/Playground.attach/sessions/history.jsonl", message: "Save session history" },
callback-box/test/routes-files-write.doctest.md:146:  payload: { path: "store/playground/Playground.attach/sessions/history.jsonl", message: "noop" },
callback-box/test/routes-files-write.doctest.md:168:JSON.stringify(byPath["store/playground/Playground.attach/sessions/history.jsonl"])
callback-box/test/maps-precheck.doctest.md:306:await box.write("emails/Foo.attach/x.card", "x");
callback-box/test/maps-precheck.doctest.md:310:await box.write("box/inbox/capture-1.attach/audio.webm", "x");
callback-box/test/maps-precheck.doctest.md:325:- `emails/Foo.attach/` is hidden (matches `**/*.attach`).
callback-box/src/core/commands/scan-import.ts:5: * live in the session's attach scope (`scan-….attach/`).
callback-box/src/core/commands/scan-import.ts:14: *   <sessionAttach>/photo-NNN.image.card + photo-NNN.attach/photo-NNN.jpg
callback-box/src/core/commands/scan-import.ts:20: *   <sessionAttach>/source.file.card + source.attach/source.pdf
callback-box/src/core/commands/scan-import.ts:24: *   <sessionAttach>/source.file.card + source.attach/source.pdf
callback-box/test/connector-drive-docs.doctest.md:96:JSON.stringify(await box.read("store/drive/Project_Notes.attach/Project_Notes.md"))
callback-box/test/connector-drive-docs.doctest.md:227:await box3.seed("store/drive/Editable.attach/Editable.md", "Edited body.\n");
callback-box/test/connector-drive-docs.doctest.md:284:await box4.seed("store/drive/Contended.attach/Contended.md", "Local edit.\n");
callback-box/test/connector-drive-docs.doctest.md:297:await box4.read("store/drive/Contended.attach/Contended.md")
callback-box/test/connector-drive-docs.doctest.md:301:await box4.read("store/drive/Contended.attach/Contended.remote.md")
callback-box/test/connector-drive-docs.doctest.md:325:await box4.seed("store/drive/Contended.attach/Contended.md", "Merged.\n");
callback-box/test/connector-drive-docs.doctest.md:326:await unlink(join(box4.root, "store/drive/Contended.attach/Contended.remote.md"));
callback-box/test/connector-drive-docs.doctest.md:387:await box5.read("store/drive/Degraded.attach/Degraded.md")
callback-box/test/connector-drive.doctest.md:116:await box3.seed("store/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","5"]\n]\n');
callback-box/test/connector-drive.doctest.md:123:await box3.seed("store/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","6"],\n["Tea","3"]\n]\n');
callback-box/test/card-lint.doctest.md:77:  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread-x.attach/msg-001.email-message.card\n---\n",
callback-box/test/card-lint.doctest.md:80:  "box/inbox/email/thread-x.attach/msg-001.email-message.card",
callback-box/test/card-lint.doctest.md:81:  "---\ncontent-type: application/x-card+xml\n---\n<email-message message-id=\"m1\" thread-id=\"t1\"><from>a@x</from><date>2026-02-15T10:00:00Z</date><subject>hi</subject><body-file>attach/msg-001.body.txt</body-file></email-message>\n",
callback-box/test/card-lint.doctest.md:151:  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread.attach/missing.email-message.card\n---\n",
callback-box/test/card-lint.doctest.md:165:=> Broken reference at messages[0].ref: thread.attach/missing.email-message.card does not exist
callback-box/test/card-lint.doctest.md:278:  "store/review/Plan.attach/Plan.commentary.card",
callback-box/test/card-lint.doctest.md:283:  [box.path("store/review/Plan.attach/Plan.commentary.card")],
callback-box/src/core/commands/attachments.ts:3: * subset of attachments). The command operates on the whole `.attach/`
callback-box/src/core/commands/attachments.ts:7: *   - verify   : scan all .attach/ scopes, report errors, no writes
callback-box/src/core/commands/attachments.ts:157:    return { success: false, error: `${relPath} is not inside an .attach/ directory` };
callback-box/src/core/commands/attachments.ts:191:    return { success: false, error: `${relPath} is not inside an .attach/ directory` };
callback-box/src/core/commands/scan-import-cards.ts:62:  filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${photoFilename}`);
callback-box/src/core/commands/scan-import-cards.ts:68:    filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}`);
callback-box/src/core/commands/scan-import-cards.ts:89:      directiveParts.push(`Cross-check the back transcription against ${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}.`);
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/audio-001.audio.card:5:  ref: attach/audio-001.webm
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-001.image.card:5:  ref: attach/photo-001.jpg
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-002.image.card:5:  ref: attach/photo-002.jpg
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.attach/photo-003.image.card:5:  ref: attach/photo-003.jpg
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.capture-session.card:9:  - attach/photo-001.image.card
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.capture-session.card:10:  - attach/photo-002.image.card
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.capture-session.card:11:  - attach/photo-003.image.card
callback-box/test/fixtures/capture-session/capture-20260323T0004-1d088356.capture-session.card:13:  - attach/audio-001.audio.card

codex
I also found an extra live `createLoader` route outside the plan’s C3 list: `webapp/routes/views.ts` uses the loader to render view outputs for XML card-shaped results. That may be dead after frontmatter migration, but the plan doesn’t account for it; it will show up in grep, but it’s still a missed cited disposition.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/commands/move-operations.ts | sed -n '1,360p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/test/move-command.doctest.md | sed -n '1,130p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	# `cb mv` — move/rename cards and rewrite references
     2	
     3	The move command relocates a card (or directory) and keeps every reference
     4	pointing at the new location. References live in many places — frontmatter
     5	`ref:`/`refs:`, body Markdoc tags (`{% source ref="…" %}`), inline markdown
     6	links and images (`[text](path)`, `![alt](path)`), and XML body `ref=`
     7	attributes — and may be written box-root-absolute (`/box/…`) or relative to
     8	the referencing card. All of them follow the move, in whichever style they
     9	were written. A card's sibling `<basename>.attach/` directory moves with it,
    10	and references that point *into* that attach directory from other cards are
    11	rewritten too.
    12	
    13	```ts setup
    14	import { executeMove } from "../src/core/commands/move.js";
    15	import { createCollectorContext } from "../src/core/commands/index.js";
    16	import { makeTmpBox } from "./helpers/doctest-helpers.js";
    17	
    18	async function mv(box, args) {
    19	  const { ctx } = createCollectorContext(box.root);
    20	  return executeMove(ctx, args);
    21	}
    22	```
    23	
    24	## Phase-2 card: file + attach dir move, inbound refs rewritten (relative + absolute, into attachments too)
    25	
    26	Moving a frontmatter card carries its `.attach/` directory along. Other cards
    27	that link to the card — or *into* its attach directory — are rewritten whether
    28	they used a relative or a box-root-absolute path. The moved card's own relative
    29	links to cards that stayed put are rewritten too, while its `attach/`-prefixed
    30	self references (scoped to the card) are left untouched.
    31	
    32	```
    33	const box = await makeTmpBox();
    34	await box.write(
    35	  "box/notes/Engine.doc.card",
    36	  "---\ntype: doc\ntitle: Engine\n---\n# Engine\nPhoto: ![p](attach/photo.jpg)\nRelated: [Priya](Priya.doc.card)\n",
    37	);
    38	await box.write("box/notes/Engine.attach/photo.jpg", "JPG");
    39	await box.write(
    40	  "box/notes/Priya.doc.card",
    41	  "---\ntype: doc\ntitle: Priya\n---\nSee [Engine](Engine.doc.card) and its [photo](Engine.attach/photo.jpg).\n",
    42	);
    43	await box.write(
    44	  "box/index.doc.card",
    45	  "---\ntype: doc\ntitle: Index\n---\nAbs [Engine](/box/notes/Engine.doc.card) and [photo](/box/notes/Engine.attach/photo.jpg).\n",
    46	);
    47	
    48	const result = await mv(box, { from: "box/notes/Engine.doc.card", to: "store/archive/Engine.doc.card" });
    49	result.success
    50	=> true
    51	```
    52	
    53	The card file and its attach directory now live under `store/archive/`:
    54	
    55	```continue
    56	await box.list("store/archive")
    57	=>
    58	store/archive/Engine.attach
    59	store/archive/Engine.attach/photo.jpg
    60	store/archive/Engine.doc.card
    61	
    62	await box.read("store/archive/Engine.attach/photo.jpg")
    63	=> JPG
    64	```
    65	
    66	The moved card keeps its `attach/` self-ref and gets a recomputed relative link
    67	to the card that stayed behind:
    68	
    69	```continue
    70	await box.read("store/archive/Engine.doc.card")
    71	=>
    72	---
    73	type: doc
    74	title: Engine
    75	---
    76	# Engine
    77	Photo: ![p](attach/photo.jpg)
    78	Related: [Priya](../../box/notes/Priya.doc.card)
    79	```
    80	
    81	The sibling card's relative links — to the card and into its attach dir — are
    82	recomputed from its own location:
    83	
    84	```continue
    85	await box.read("box/notes/Priya.doc.card")
    86	=>
    87	---
    88	type: doc
    89	title: Priya
    90	---
    91	See [Engine](../../store/archive/Engine.doc.card) and its [photo](../../store/archive/Engine.attach/photo.jpg).
    92	```
    93	
    94	The absolute links stay absolute, repointed at the new location:
    95	
    96	```continue
    97	await box.read("box/index.doc.card")
    98	=>
    99	---
   100	type: doc
   101	title: Index
   102	---
   103	Abs [Engine](/store/archive/Engine.doc.card) and [photo](/store/archive/Engine.attach/photo.jpg).
   104	```
   105	
   106	## Body Markdoc `{% source ref %}` rewritten (relative + absolute)
   107	
   108	Refs carried by Markdoc body tags follow the move in either style.
   109	
   110	```
   111	const box = await makeTmpBox();
   112	await box.write("box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
   113	await box.write(
   114	  "box/notes/Mtg.doc.card",
   115	  '---\ntype: doc\ntitle: Mtg\n---\n' +
   116	    'Abs: {% source ref="/box/people/dana.person.card" as="x" %}a{% /source %}\n' +
   117	    'Rel: {% source ref="../people/dana.person.card" as="y" %}b{% /source %}\n',
   118	);
   119	
   120	await mv(box, { from: "box/people/dana.person.card", to: "store/people/dana.person.card" });
   121	await box.read("box/notes/Mtg.doc.card")
   122	=>
   123	---
   124	type: doc
   125	title: Mtg
   126	---
   127	Abs: {% source ref="/store/people/dana.person.card" as="x" %}a{% /source %}
   128	Rel: {% source ref="../../store/people/dana.person.card" as="y" %}b{% /source %}
   129	```
   130	

 succeeded in 0ms:
     1	/**
     2	 * Core move operations: relocating a single card or an entire directory
     3	 * and rewriting every affected cross-card reference.
     4	 *
     5	 * Beyond what cardworks' built-in move handles (card file + same-basename
     6	 * siblings, including the `<basename>.attach/` directory, plus cross-card
     7	 * refs that point at the moved card), these run a resolution-based ref
     8	 * rewrite (rewrite-card-refs.ts) over every other card. That covers what
     9	 * cardworks misses: refs written relative to the referring card, refs into
    10	 * the moved attach scope, body Markdoc tag refs, inline markdown links, and
    11	 * Phase-2 frontmatter cards cardworks can't parse.
    12	 */
    13	
    14	import * as fs from "node:fs/promises";
    15	import * as path from "node:path";
    16	import { CardLoader } from "cardworks";
    17	import type { CommandContext } from "../command-runner.js";
    18	import { attachDirFor } from "../../shared/attach-path.js";
    19	import {
    20	  rewriteReferrerRefs,
    21	  rewriteMovedCardRefs,
    22	  type Remap,
    23	} from "../rewrite-card-refs.js";
    24	import { isPhase2CardPath, movePhase2CardFiles } from "./move-phase2.js";
    25	
    26	export interface MoveOneResult {
    27	  from: string;
    28	  to: string;
    29	  movedFiles: Array<{ from: string; to: string }>;
    30	  updatedCards: Array<{ path: string; refsUpdated: number }>;
    31	  filesToStage: string[];
    32	}
    33	
    34	interface MoveDirResult {
    35	  from: string;
    36	  to: string;
    37	  filesToStage: string[];
    38	  updatedCards: Array<{ path: string; refsUpdated: number }>;
    39	}
    40	
    41	interface MoveDirParams {
    42	  ctx: CommandContext;
    43	  sourcePath: string;
    44	  destPath: string;
    45	}
    46	
    47	interface MoveOneParams {
    48	  ctx: CommandContext;
    49	  sourcePath: string;
    50	  destPath: string;
    51	}
    52	
    53	/**
    54	 * Remove empty ancestor directories up to (but not including) stopAt.
    55	 * Walks up from dirPath, removing each directory if empty, stopping
    56	 * when it reaches stopAt or a non-empty directory.
    57	 */
    58	async function removeEmptyAncestors(
    59	  dirPath: string,
    60	  stopAt: string
    61	): Promise<void> {
    62	  let current = dirPath;
    63	  while (current !== stopAt && current.startsWith(stopAt + "/")) {
    64	    try {
    65	      const entries = await fs.readdir(current);
    66	      if (entries.length > 0) break;
    67	      await fs.rmdir(current);
    68	    } catch (e) {
    69	      console.warn(`Stopping ancestor cleanup at ${current}:`, e);
    70	      break;
    71	    }
    72	    current = path.dirname(current);
    73	  }
    74	}
    75	
    76	/**
    77	 * Move an entire directory (e.g., a capture session) and update external references.
    78	 */
    79	export async function moveDir(params: MoveDirParams): Promise<MoveDirResult> {
    80	  const { ctx, sourcePath, destPath } = params;
    81	  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
    82	  const relDestPath = path.relative(ctx.boxRoot, destPath);
    83	
    84	  // Move the directory
    85	  await fs.mkdir(path.dirname(destPath), { recursive: true });
    86	  await fs.rename(sourcePath, destPath);
    87	  ctx.writeLine(`Moved directory: ${relSourcePath} → ${relDestPath}`);
    88	
    89	  const filesToStage: string[] = [];
    90	  const updatedCards: Array<{ path: string; refsUpdated: number }> = [];
    91	
    92	  // Anything that resolved under the old directory now lives under the new one.
    93	  const remap: Remap = (abs) => {
    94	    if (abs === sourcePath) return destPath;
    95	    if (abs.startsWith(sourcePath + path.sep)) {
    96	      return destPath + abs.slice(sourcePath.length);
    97	    }
    98	    return null;
    99	  };
   100	
   101	  // Rewrite refs from cards *outside* the moved directory that point into it
   102	  // (relative or absolute), and recompute the moved cards' own *outgoing*
   103	  // relative refs to targets that stayed outside.
   104	  const loader = new CardLoader(ctx.boxRoot);
   105	  const allCards = await loader.listCards();
   106	  for (const cardPath of allCards) {
   107	    const inside = cardPath === destPath || cardPath.startsWith(destPath + path.sep);
   108	    try {
   109	      const content = await fs.readFile(cardPath, "utf-8");
   110	      const result = inside
   111	        ? rewriteMovedCardRefs({
   112	            boxRoot: ctx.boxRoot,
   113	            oldCardAbs: sourcePath + cardPath.slice(destPath.length),
   114	            newCardAbs: cardPath,
   115	            text: content,
   116	            remap,
   117	          })
   118	        : rewriteReferrerRefs({
   119	            boxRoot: ctx.boxRoot,
   120	            cardAbsPath: cardPath,
   121	            text: content,
   122	            remap,
   123	          });
   124	      if (result.count === 0 || result.text === content) continue;
   125	      await fs.writeFile(cardPath, result.text);
   126	      const relPath = path.relative(ctx.boxRoot, cardPath);
   127	      updatedCards.push({ path: relPath, refsUpdated: result.count });
   128	      filesToStage.push(relPath);
   129	      ctx.writeLine(`  Updated ${result.count} ref${result.count > 1 ? "s" : ""} in ${relPath}`);
   130	    } catch (e) {
   131	      console.warn(`Skipping card that can't be read during ref rewrite: ${cardPath}:`, e);
   132	    }
   133	  }
   134	
   135	  // Clean up empty parent of source directory
   136	  await removeEmptyAncestors(path.dirname(sourcePath), ctx.boxRoot);
   137	
   138	  // Stage old directory removal and new directory addition
   139	  // git add with the old path marks it as deleted, new path as added
   140	  filesToStage.push(relSourcePath);
   141	  filesToStage.push(relDestPath);
   142	
   143	  return {
   144	    from: relSourcePath,
   145	    to: relDestPath,
   146	    filesToStage,
   147	    updatedCards,
   148	  };
   149	}
   150	
   151	/**
   152	 * Perform the actual file relocation for a single card, returning the moved
   153	 * files and any references cardworks itself re-serialized.
   154	 */
   155	async function relocateCardFiles({
   156	  ctx,
   157	  loader,
   158	  sourcePath,
   159	  destPath,
   160	}: {
   161	  ctx: CommandContext;
   162	  loader: CardLoader;
   163	  sourcePath: string;
   164	  destPath: string;
   165	}): Promise<{
   166	  movedFiles: Array<{ from: string; to: string }>;
   167	  updatedCards: Array<{ path: string; refsUpdated: number }>;
   168	}> {
   169	  // Phase-2 cards: cardworks' XML-only loader can't parse them, so handle
   170	  // the file + attach-dir rename ourselves. XML cards: delegate to cardworks
   171	  // for the file moves and referrer re-serialization.
   172	  if (isPhase2CardPath(sourcePath)) {
   173	    return { movedFiles: await movePhase2CardFiles(sourcePath, destPath), updatedCards: [] };
   174	  }
   175	  const card = await loader.load(sourcePath);
   176	  const { result } = await loader.move(card, destPath);
   177	  return {
   178	    movedFiles: result.movedFiles,
   179	    updatedCards: result.updatedCards.map((u) => ({
   180	      path: path.relative(ctx.boxRoot, u.path),
   181	      refsUpdated: u.refsUpdated,
   182	    })),
   183	  };
   184	}
   185	
   186	/**
   187	 * Rewrite refs in every *other* card that points at the moved card or into
   188	 * its attach directory. Resolution-based (see rewrite-card-refs.ts), so refs
   189	 * written relative to the referring card are caught — not just box-root
   190	 * paths — and refs sitting in body Markdoc tags, inline markdown links, and
   191	 * frontmatter alike. cardworks already re-serialized card-to-card refs in
   192	 * XML referrers; this pass is idempotent over those and additionally covers
   193	 * attach-scope refs and every Phase-2 card cardworks can't parse.
   194	 */
   195	async function rewriteOtherCards({
   196	  ctx,
   197	  loader,
   198	  destPath,
   199	  newAttachAbsDir,
   200	  remap,
   201	}: {
   202	  ctx: CommandContext;
   203	  loader: CardLoader;
   204	  destPath: string;
   205	  newAttachAbsDir: string;
   206	  remap: Remap;
   207	}): Promise<{
   208	  extraStaged: string[];
   209	  extraUpdated: Array<{ path: string; refsUpdated: number }>;
   210	}> {
   211	  const extraStaged: string[] = [];
   212	  const extraUpdated: Array<{ path: string; refsUpdated: number }> = [];
   213	  const allCards = await loader.listCards();
   214	  for (const cardPath of allCards) {
   215	    // Skip the moved card (handled separately) and cards that just moved into
   216	    // the new attach scope (their internal refs travelled with them intact).
   217	    if (cardPath === destPath) continue;
   218	    if (cardPath.startsWith(newAttachAbsDir + path.sep)) continue;
   219	    try {
   220	      const original = await fs.readFile(cardPath, "utf-8");
   221	      const { text: updated, count } = rewriteReferrerRefs({
   222	        boxRoot: ctx.boxRoot,
   223	        cardAbsPath: cardPath,
   224	        text: original,
   225	        remap,
   226	      });
   227	      if (count === 0 || updated === original) continue;
   228	      await fs.writeFile(cardPath, updated);
   229	      const relPath = path.relative(ctx.boxRoot, cardPath);
   230	      extraUpdated.push({ path: relPath, refsUpdated: count });
   231	      extraStaged.push(relPath);
   232	      ctx.writeLine(`  Updated ${count} ref${count > 1 ? "s" : ""} in ${relPath}`);
   233	    } catch (e) {
   234	      console.warn(`Skipping card that can't be read during ref rewrite: ${cardPath}:`, e);
   235	    }
   236	  }
   237	  return { extraStaged, extraUpdated };
   238	}
   239	
   240	/**
   241	 * Recompute the moved card's own *relative* refs to cards that stayed put,
   242	 * from its new location (absolute and `attach/` refs are unaffected).
   243	 */
   244	async function relocateMovedCardRefs({
   245	  ctx,
   246	  sourcePath,
   247	  destPath,
   248	  remap,
   249	}: {
   250	  ctx: CommandContext;
   251	  sourcePath: string;
   252	  destPath: string;
   253	  remap: Remap;
   254	}): Promise<void> {
   255	  try {
   256	    const movedText = await fs.readFile(destPath, "utf-8");
   257	    const { text: relocated, count } = rewriteMovedCardRefs({
   258	      boxRoot: ctx.boxRoot,
   259	      oldCardAbs: sourcePath,
   260	      newCardAbs: destPath,
   261	      text: movedText,
   262	      remap,
   263	    });
   264	    if (count > 0 && relocated !== movedText) {
   265	      await fs.writeFile(destPath, relocated);
   266	      ctx.writeLine(`  Rewrote ${count} relative ref${count > 1 ? "s" : ""} in the moved card`);
   267	    }
   268	  } catch (e) {
   269	    console.warn(`Moved card unreadable; nothing to relocate: ${destPath}:`, e);
   270	  }
   271	}
   272	
   273	function reportMove({
   274	  ctx,
   275	  relSourcePath,
   276	  relDestPath,
   277	  sourcePath,
   278	  movedFiles,
   279	  updatedCards,
   280	}: {
   281	  ctx: CommandContext;
   282	  relSourcePath: string;
   283	  relDestPath: string;
   284	  sourcePath: string;
   285	  movedFiles: Array<{ from: string; to: string }>;
   286	  updatedCards: Array<{ path: string; refsUpdated: number }>;
   287	}): void {
   288	  ctx.writeLine(`Moved: ${relSourcePath} → ${relDestPath}`);
   289	
   290	  for (const file of movedFiles) {
   291	    if (file.from !== sourcePath) {
   292	      const relFrom = path.relative(ctx.boxRoot, file.from);
   293	      const relTo = path.relative(ctx.boxRoot, file.to);
   294	      ctx.writeLine(`  Also moved: ${relFrom} → ${relTo}`);
   295	    }
   296	  }
   297	
   298	  if (updatedCards.length > 0) {
   299	    ctx.writeLine(`Updated references in ${updatedCards.length} card(s):`);
   300	    for (const update of updatedCards) {
   301	      ctx.writeLine(`  ${update.path} (${update.refsUpdated} ref${update.refsUpdated > 1 ? "s" : ""})`);
   302	    }
   303	  }
   304	}
   305	
   306	/**
   307	 * Move a single card, returning structured results. See module header and
   308	 * the helper docstrings for the ref-rewrite strategy.
   309	 */
   310	export async function moveOne(params: MoveOneParams): Promise<MoveOneResult> {
   311	  const { ctx, sourcePath, destPath } = params;
   312	  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
   313	  const relDestPath = path.relative(ctx.boxRoot, destPath);
   314	
   315	  const oldAttachAbsDir = attachDirFor(sourcePath);
   316	  const newAttachAbsDir = attachDirFor(destPath);
   317	
   318	  // The loader is constructed unconditionally because `listCards()` is
   319	  // needed for the ref rewrite pass below regardless of card kind.
   320	  const loader = new CardLoader(ctx.boxRoot);
   321	  const { movedFiles, updatedCards } = await relocateCardFiles({
   322	    ctx,
   323	    loader,
   324	    sourcePath,
   325	    destPath,
   326	  });
   327	
   328	  reportMove({ ctx, relSourcePath, relDestPath, sourcePath, movedFiles, updatedCards });
   329	
   330	  const remap: Remap = (abs) => {
   331	    if (abs === sourcePath) return destPath;
   332	    if (abs === oldAttachAbsDir) return newAttachAbsDir;
   333	    if (abs.startsWith(oldAttachAbsDir + path.sep)) {
   334	      return newAttachAbsDir + abs.slice(oldAttachAbsDir.length);
   335	    }
   336	    return null;
   337	  };
   338	
   339	  const { extraStaged, extraUpdated } = await rewriteOtherCards({
   340	    ctx,
   341	    loader,
   342	    destPath,
   343	    newAttachAbsDir,
   344	    remap,
   345	  });
   346	
   347	  await relocateMovedCardRefs({ ctx, sourcePath, destPath, remap });
   348	
   349	  // Clean up empty source directory
   350	  await removeEmptyAncestors(path.dirname(sourcePath), ctx.boxRoot);
   351	
   352	  const filesToStage: string[] = [];
   353	  for (const file of movedFiles) {
   354	    filesToStage.push(path.relative(ctx.boxRoot, file.from));
   355	    filesToStage.push(path.relative(ctx.boxRoot, file.to));
   356	  }
   357	  for (const update of updatedCards) {
   358	    filesToStage.push(update.path);
   359	  }
   360	  filesToStage.push(...extraStaged);

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/commands/move-phase2.ts | sed -n '1,160p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Phase-2 card file moving.
     3	 *
     4	 * Cardworks' `loader.load()` parses card bodies as XML — fine for the
     5	 * legacy XML schemas (procedure, guide, landmark, capture-session,
     6	 * procedure-run) but not for Phase-2 frontmatter+markdown cards
     7	 * (doc, briefing, memo, recipe, …). For Phase-2 cards we have to do
     8	 * the move ourselves; the substring rewrite pass in the move command
     9	 * picks up ref updates in every other card regardless of card kind.
    10	 *
    11	 * Detect by extracting the type from the filename and checking it
    12	 * against the registered Phase-2 card schemas. Anything else (XML
    13	 * card, plain file, unknown type) falls through to the cardworks
    14	 * loader path.
    15	 */
    16	
    17	import * as fs from "node:fs/promises";
    18	import * as path from "node:path";
    19	import { attachDirFor } from "../../shared/attach-path.js";
    20	import { cardSchemas } from "../../schemas/registry.js";
    21	
    22	const PHASE2_TYPES = new Set(cardSchemas.map((s) => s.type));
    23	
    24	class AttachDirRenameError extends Error {
    25	  readonly from: string;
    26	  readonly to: string;
    27	  constructor({ from, to, cause }: { from: string; to: string; cause: unknown }) {
    28	    super(`failed to rename attach directory: ${from} → ${to}`, { cause });
    29	    this.name = "AttachDirRenameError";
    30	    this.from = from;
    31	    this.to = to;
    32	  }
    33	}
    34	
    35	function cardTypeFromPath(p: string): string | undefined {
    36	  const base = p.split("/").pop() ?? p;
    37	  const match = /^.+\.([^.]+)\.card$/.exec(base);
    38	  if (match === null) return undefined;
    39	  return match[1];
    40	}
    41	
    42	/**
    43	 * Whether a path names a Phase-2 frontmatter+markdown card (vs. a legacy
    44	 * XML card, plain file, or unknown type).
    45	 */
    46	export function isPhase2CardPath(p: string): boolean {
    47	  const type = cardTypeFromPath(p);
    48	  return type !== undefined && PHASE2_TYPES.has(type);
    49	}
    50	
    51	/**
    52	 * Rename a file and (if present) its sibling `<basename>.attach/`
    53	 * directory atomically — the Phase-2 analogue of what cardworks'
    54	 * `loader.move()` does for XML cards. Returns the list of moved
    55	 * file paths in the same `{from, to}` shape cardworks emits.
    56	 */
    57	export async function movePhase2CardFiles(
    58	  sourcePath: string,
    59	  destPath: string,
    60	): Promise<Array<{ from: string; to: string }>> {
    61	  const moved: Array<{ from: string; to: string }> = [];
    62	  const oldAttach = attachDirFor(sourcePath);
    63	  const newAttach = attachDirFor(destPath);
    64	  await fs.mkdir(path.dirname(destPath), { recursive: true });
    65	  await fs.rename(sourcePath, destPath);
    66	  moved.push({ from: sourcePath, to: destPath });
    67	  if (oldAttach !== newAttach) {
    68	    try {
    69	      await fs.rename(oldAttach, newAttach);
    70	      moved.push({ from: oldAttach, to: newAttach });
    71	    } catch (e) {
    72	      const err = e as NodeJS.ErrnoException;
    73	      if (err.code !== "ENOENT") throw new AttachDirRenameError({ from: oldAttach, to: newAttach, cause: err });
    74	      // No attach dir to move; fine.
    75	    }
    76	  }
    77	  return moved;
    78	}

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/routes/views.ts | sed -n '1,230p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * REST routes for agent-generated views.
     3	 *
     4	 * - GET /api/views — list all views
     5	 * - GET /api/views/:slug/module.js — compiled JS module
     6	 * - GET /api/views/:slug/cards — cards matching view dependencies
     7	 */
     8	
     9	import type { FastifyInstance } from "fastify";
    10	import * as path from "node:path";
    11	import { glob } from "glob";
    12	import { promises as fs } from "node:fs";
    13	import { compileView, listViews, buildErrorModule } from "../views/compiler.js";
    14	import { createLoader } from "../../cli/lib/loader.js";
    15	import { loadCardFile } from "../../core/card-io.js";
    16	import { buildLoadContext } from "../../core/load-context.js";
    17	import { getStatus, isRepo } from "../../cli/lib/git.js";
    18	import { fileEtag } from "../file-etag.js";
    19	import { attachDirFor } from "../../shared/attach-path.js";
    20	import type { ViewCard, ViewCardChild, ViewFile } from "../../types/views.js";
    21	import type { ElementNode } from "cardworks";
    22	
    23	interface RegisterViewRoutesOptions {
    24	  server: FastifyInstance;
    25	  boxRoot: string;
    26	}
    27	
    28	function elementToViewCardChild(el: ElementNode): ViewCardChild {
    29	  const result: ViewCardChild = {
    30	    tagName: el.tagName,
    31	    attrs: el.attrs,
    32	  };
    33	  if (el.text) {
    34	    result.text = el.text;
    35	  }
    36	  if (el.children && el.children.length > 0) {
    37	    result.children = el.children
    38	      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
    39	      .map(elementToViewCardChild);
    40	  }
    41	  return result;
    42	}
    43	
    44	export async function registerViewRoutes(options: RegisterViewRoutesOptions): Promise<void> {
    45	  const { server, boxRoot } = options;
    46	
    47	  // GET /api/views — list all views
    48	  server.get("/api/views", async () => {
    49	    return listViews(boxRoot);
    50	  });
    51	
    52	  // GET /api/views/:slug/module.js — compiled JS module
    53	  server.get<{ Params: { slug: string } }>(
    54	    "/api/views/:slug/module.js",
    55	    async (request, reply) => {
    56	      const { slug } = request.params;
    57	      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);
    58	
    59	      try {
    60	        const { output } = await compileView(viewPath);
    61	        return reply
    62	          .header("Content-Type", "application/javascript")
    63	          .header("Cache-Control", "no-cache")
    64	          .send(output);
    65	      } catch (e) {
    66	        const message = e instanceof Error ? e.message : String(e);
    67	        return reply
    68	          .header("Content-Type", "application/javascript")
    69	          .header("Cache-Control", "no-cache")
    70	          .send(buildErrorModule(message));
    71	      }
    72	    }
    73	  );
    74	
    75	  // GET /api/views/:slug/cards — cards + non-card files matching view dependencies
    76	  server.get<{ Params: { slug: string } }>(
    77	    "/api/views/:slug/cards",
    78	    async (request, reply) => {
    79	      const { slug } = request.params;
    80	      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);
    81	
    82	      let dependencies: string[];
    83	      try {
    84	        const { meta } = await compileView(viewPath);
    85	        dependencies = meta.dependencies;
    86	      } catch (_e) {
    87	        return reply.status(404).send({ error: "View not found" });
    88	      }
    89	
    90	      if (dependencies.length === 0) {
    91	        return { cards: [], files: [] };
    92	      }
    93	
    94	      // Collect matching files from all dependency globs: cards parse into
    95	      // ViewCard; everything else (attachments, .md, .jsonl, ...) arrives
    96	      // as raw text in `files`.
    97	      const cardPaths = new Set<string>();
    98	      const filePaths = new Set<string>();
    99	      for (const pattern of dependencies) {
   100	        const matches = await glob(pattern, { cwd: boxRoot, nodir: true });
   101	        for (const m of matches) {
   102	          if (m.endsWith(".card")) cardPaths.add(m);
   103	          else filePaths.add(m);
   104	        }
   105	      }
   106	
   107	      const loader = await createLoader(boxRoot);
   108	      const ctx = await buildLoadContext(boxRoot);
   109	      const cards: ViewCard[] = [];
   110	
   111	      for (const relPath of cardPaths) {
   112	        try {
   113	          const absPath = path.join(boxRoot, relPath);
   114	          const loaded = await loadCardFile(absPath, ctx);
   115	          const viewCard =
   116	            loaded.kind === "frontmatter"
   117	              ? frontmatterViewCard(relPath, loaded.fields)
   118	              : await xmlViewCard(relPath, { loader, absPath });
   119	          const attachments = await listAttachments(boxRoot, relPath);
   120	          if (attachments.length > 0) {
   121	            viewCard.attachments = attachments;
   122	          }
   123	          cards.push(viewCard);
   124	        } catch (_e) {
   125	          // Skip cards that fail to load (validation errors, etc.)
   126	        }
   127	      }
   128	
   129	      const files: ViewFile[] = [];
   130	      for (const relPath of [...filePaths].toSorted()) {
   131	        const meta = await statViewFile(boxRoot, relPath);
   132	        if (meta !== null) files.push(meta);
   133	      }
   134	
   135	      // Annotate git working-tree state so views can show unsaved/uncommitted
   136	      // indicators and decide when to offer a commit affordance.
   137	      const gitStatusOf = await buildGitStatusLookup(boxRoot);
   138	      if (gitStatusOf !== null) {
   139	        for (const file of files) annotateGitStatus(file, gitStatusOf);
   140	        for (const card of cards) {
   141	          for (const att of card.attachments ?? []) annotateGitStatus(att, gitStatusOf);
   142	        }
   143	      }
   144	
   145	      return { cards, files };
   146	    }
   147	  );
   148	}
   149	
   150	/** Phase-2 card → ViewCard: parsed fields in `frontmatter`, body split out. */
   151	function frontmatterViewCard(relPath: string, fields: Record<string, unknown>): ViewCard {
   152	  const frontmatter: Record<string, unknown> = {};
   153	  let body: string | undefined;
   154	  for (const [key, value] of Object.entries(fields)) {
   155	    if (key === "type") continue;
   156	    if (key === "body") {
   157	      // The body field is always named `body` — enforced by cardSchema().
   158	      if (typeof value === "string") body = value;
   159	      continue;
   160	    }
   161	    frontmatter[key] = value;
   162	  }
   163	  const type = fields["type"];
   164	  const viewCard: ViewCard = {
   165	    path: relPath,
   166	    tagName: typeof type === "string" ? type : "",
   167	    attrs: {},
   168	    frontmatter,
   169	  };
   170	  if (body !== undefined) viewCard.body = body;
   171	  if (typeof frontmatter["status"] === "string") viewCard.status = frontmatter["status"];
   172	  return viewCard;
   173	}
   174	
   175	/** Legacy XML card → ViewCard via the element tree (original shape). */
   176	async function xmlViewCard(
   177	  relPath: string,
   178	  { loader, absPath }: { loader: Awaited<ReturnType<typeof createLoader>>; absPath: string }
   179	): Promise<ViewCard> {
   180	  const card = await loader.load(absPath);
   181	  const el = card.element;
   182	  const viewCard: ViewCard = { path: relPath, tagName: el.tagName, attrs: el.attrs };
   183	  if (el.text) viewCard.text = el.text;
   184	  if (el.attrs["status"]) viewCard.status = el.attrs["status"];
   185	  if (el.children && el.children.length > 0) {
   186	    viewCard.children = el.children
   187	      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
   188	      .map(elementToViewCardChild);
   189	  }
   190	  return viewCard;
   191	}
   192	
   193	type GitStatusLookup = (relPath: string) => "dirty" | "untracked" | null;
   194	
   195	/**
   196	 * One repo-wide status call mapped to a per-path lookup. Untracked entries
   197	 * from porcelain can be whole directories ("?? new-dir/"), so untracked
   198	 * matching is prefix-aware; dirty (modified/staged) entries are exact.
   199	 */
   200	async function buildGitStatusLookup(boxRoot: string): Promise<GitStatusLookup | null> {
   201	  if (!(await isRepo(boxRoot))) return null;
   202	  const status = await getStatus(boxRoot);
   203	  const dirty = new Set([...status.modified, ...status.staged]);
   204	  const untracked = status.untracked;
   205	  return (relPath: string) => {
   206	    if (dirty.has(relPath)) return "dirty";
   207	    for (const entry of untracked) {
   208	      if (entry === relPath || (entry.endsWith("/") && relPath.startsWith(entry))) {
   209	        return "untracked";
   210	      }
   211	    }
   212	    return null;
   213	  };
   214	}
   215	
   216	function annotateGitStatus(file: ViewFile, lookup: GitStatusLookup): void {
   217	  const status = lookup(file.path);
   218	  if (status !== null) file.gitStatus = status;
   219	}
   220	
   221	/** Stat one file into ViewFile metadata; null when it vanished mid-request. */
   222	async function statViewFile(boxRoot: string, relPath: string): Promise<ViewFile | null> {
   223	  try {
   224	    const st = await fs.stat(path.join(boxRoot, relPath));
   225	    if (!st.isFile()) return null;
   226	    return { path: relPath, size: st.size, mtimeMs: st.mtimeMs, etag: fileEtag(st) };
   227	  } catch (_e) {
   228	    return null;
   229	  }
   230	}

codex
The most consequential move-path issue is not `loader.move()` itself. It is `isPhase2CardPath`: it only knows built-in `cardSchemas`, so a migrated box-local frontmatter card such as `*.bill.card` would still fall through to `loader.load()` and fail XML parsing. That directly contradicts the plan’s “frontmatter cards are covered” premise.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/tsconfig.json | sed -n '1,160p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	{
     2	  "compilerOptions": {
     3	    "target": "ES2023",
     4	    "module": "NodeNext",
     5	    "moduleResolution": "NodeNext",
     6	    "jsx": "react-jsx",
     7	    "jsxImportSource": "react",
     8	    "strict": true,
     9	    "noImplicitAny": true,
    10	    "noUncheckedIndexedAccess": true,
    11	    "noImplicitReturns": true,
    12	    "noFallthroughCasesInSwitch": true,
    13	    "exactOptionalPropertyTypes": true,
    14	    "esModuleInterop": true,
    15	    "skipLibCheck": true,
    16	    "forceConsistentCasingInFileNames": true,
    17	    "resolveJsonModule": true,
    18	    // No .d.ts emit: the backend runs via tsx and the frontend type-checks
    19	    // against backend *source* (the @backend/* path alias), so nothing consumes
    20	    // dist/*.d.ts. Declaration emit also makes tRPC subscription routers fail to
    21	    // type-check (TS2742 — their inferred type references tRPC's internal
    22	    // `unstable-core-do-not-import` and can't be portably named for a .d.ts).
    23	    "declaration": false,
    24	    "sourceMap": true,
    25	    "outDir": "dist",
    26	    "rootDir": "src",
    27	    "lib": ["ES2023"],
    28	    "types": ["node"]
    29	  },
    30	  "include": ["src/**/*"],
    31	  "exclude": ["node_modules", "dist", "src/frontend"]
    32	}

exec
/opt/homebrew/bin/bash -lc "ls callback-box/dist 2>/dev/null | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
cli.mjs
cli.mjs.map

exec
/opt/homebrew/bin/bash -lc "find callback-box/dist -maxdepth 3 -type f \\( -path '*/cards/*' -o -name 'index.js' -o -name 'cli.mjs' \\) 2>/dev/null | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "rg -n \"callback-box/cards|src/cards|dist/cards|external|packages: \\\"external\\\"|package.json|exports\" callback-box/dist/cli.mjs callback-box/dist/cli/index.js callback-box/dist/schemas/registry.js 2>/dev/null" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/dist/cli.mjs

 exited 2 in 0ms:
callback-box/dist/cli.mjs:12:// src/cards/schema.ts
callback-box/dist/cli.mjs:108:  "src/cards/schema.ts"() {
callback-box/dist/cli.mjs:127:// src/cards/frontmatter.ts
callback-box/dist/cli.mjs:156:  "src/cards/frontmatter.ts"() {
callback-box/dist/cli.mjs:162:// src/cards/lint-format.ts
callback-box/dist/cli.mjs:215:  "src/cards/lint-format.ts"() {
callback-box/dist/cli.mjs:229:// src/cards/errors.ts
callback-box/dist/cli.mjs:232:  "src/cards/errors.ts"() {
callback-box/dist/cli.mjs:249:// src/cards/index.ts
callback-box/dist/cli.mjs:251:  "src/cards/index.ts"() {
callback-box/dist/cli.mjs:529:- Set reasonable not-before values to prevent hammering external services.
callback-box/dist/cli.mjs:537:var fetch_exports = {};
callback-box/dist/cli.mjs:538:__export(fetch_exports, {
callback-box/dist/cli.mjs:696:var command_runner_exports = {};
callback-box/dist/cli.mjs:697:__export(command_runner_exports, {
callback-box/dist/cli.mjs:780:  const { installStrictFetch: installStrictFetch2 } = await Promise.resolve().then(() => (init_fetch(), fetch_exports));
callback-box/dist/cli.mjs:1547:Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:
callback-box/dist/cli.mjs:1550:import { body, cardSchema } from "callback-box/cards";
callback-box/dist/cli.mjs:1596:import { cardSchema, type LintIssue } from "callback-box/cards";
callback-box/dist/cli.mjs:1620:From \`callback-box/cards\`:
callback-box/dist/cli.mjs:1638:import { cardSchema } from "callback-box/cards";
callback-box/dist/cli.mjs:1729:  package.json        <- npm dependencies for tricks
callback-box/dist/cli.mjs:1818:  const packageJsonPath = path5.join(boxRoot, "tricks/package.json");
callback-box/dist/cli.mjs:3217:    const pkgPath = join4(dir, "package.json");
callback-box/dist/cli.mjs:5597:    // In-box target (box-relative, `cb mv`-tracked) or external target
callback-box/dist/cli.mjs:5860:- an **\`extfile\`** card \u2014 to comment on a live external file (repo docs/source,
callback-box/dist/cli.mjs:5937:A webpage card is a **captured external web page**, stored in the box. The
callback-box/dist/cli.mjs:6040:    // Full external URL of the pointed-to file, e.g.
callback-box/dist/cli.mjs:6042:    // box's `externalRoots` allowlist; untracked by `cb mv` (it's external).
callback-box/dist/cli.mjs:6055:An extfile card is an **in-box pointer to a live external file** \u2014 like a
callback-box/dist/cli.mjs:6063:- \`href:\` \u2014 required. The full \`file:\` URL of the external file, e.g.
callback-box/dist/cli.mjs:6065:  the box's \`externalRoots\` (\`config/box.json\`). Use a single-slash \`file:/abs\`
callback-box/dist/cli.mjs:6435:  const pkgJsonPath = join7(schemasDir, "package.json");
callback-box/dist/cli.mjs:6721:### Calling external APIs (LLMs) from a view
callback-box/dist/cli.mjs:6805:Each view is a \`.tsx\` file with named exports for metadata and a default export for the component:
callback-box/dist/cli.mjs:6847:A view that exports \`rendersCardTypes\` becomes the **default renderer for
callback-box/dist/cli.mjs:6885:| \`adapterFetch\` | (adapter, {path, ...init}) => Promise<Response> | Call an external API with the box's key injected server-side |
callback-box/dist/cli.mjs:7265:- Don't add Python deps to \`package.json\` or a project-level \`requirements.txt\` just to call a CLI. Use that path only when you need to **import** the library in Python code (in which case it belongs in a real project venv, not a CLI invocation).
callback-box/dist/cli.mjs:7295:    "| `box/resources/` | Synced external state |",
callback-box/dist/cli.mjs:7318:    "- **Connectors** \u2014 external services (Gmail, Telegram, Google Calendar, Google Drive) sync during `cb wakeup`. Connectors create cards in `box/inbox/` and job cards in `box/jobs/` for processing.",
callback-box/dist/cli.mjs:7330:    '**Common mistake:** Do NOT tell users to "put" or "place" files in directories. Users interact through the web UI, chat, or external services. Only agents use `cb create` and `cb mv`.',
callback-box/dist/cli.mjs:7503:function externalToolsSection() {
callback-box/dist/cli.mjs:7561:    "- Each view declares metadata (name, description, dependencies, modes) as named exports",
callback-box/dist/cli.mjs:7569:    "- Views call external APIs (LLMs) via `adapterFetch` \u2014 the server injects",
callback-box/dist/cli.mjs:7873:    "- `href` instead of `ref` for an **external** target (a full URL: `file:`,",
callback-box/dist/cli.mjs:7988:    ...externalToolsSection(),
callback-box/dist/cli.mjs:8504:    "Connectors bridge external services to the box filesystem.",
callback-box/dist/cli.mjs:10526:      console.log("  box/resources/      - Synced external state");
callback-box/dist/cli.mjs:16429:    const { runCommand: runCommand3 } = await Promise.resolve().then(() => (init_command_runner(), command_runner_exports));
callback-box/dist/cli.mjs:22242:// src/webapp/routes/api-external.ts
callback-box/dist/cli.mjs:22246:// src/core/external-ref.ts
callback-box/dist/cli.mjs:22353:// src/core/external-roots.ts
callback-box/dist/cli.mjs:22372:  return Promise.all([boxRoot, ...config.externalRoots ?? []].map(resolveRoot));
callback-box/dist/cli.mjs:22375:// src/webapp/routes/api-external.ts
callback-box/dist/cli.mjs:22394:  server.get("/api/external", async (request, reply) => {
callback-box/dist/cli.mjs:22409:      request.log.error({ err: e }, "unexpected error resolving external href");
callback-box/dist/cli.mjs:22410:      return reply.status(500).send({ error: "external read failed" });
callback-box/dist/cli.mjs:29519:  name: "react-external",
callback-box/dist/cli.mjs:41793:var extfileCommand = new Command46("extfile").description("Manage extfile cards (pointers to live external files)").addCommand(syncCommand);

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/bin/cb | sed -n '1,180p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	#!/usr/bin/env bash
     2	# Callback Box CLI wrapper.
     3	#
     4	# Runs a bundled, single-file build of the CLI (dist/cli.mjs) for fast cold
     5	# starts. The bundle collapses the source module graph into one file, avoiding
     6	# the per-module tsx loader-hook overhead that makes plain `tsx src/cli` slow.
     7	#
     8	# Hybrid behavior:
     9	#   - Prod (CB_CLI_PREBUILT set): trust the bundle, no staleness check.
    10	#   - Dev (default): self-heal — rebuild the bundle when any backend source is
    11	#     newer than it, then run it. If a build ever fails, fall back to tsx so
    12	#     `cb` always works.
    13	
    14	# Resolve symlinks to get the real script location
    15	SOURCE="${BASH_SOURCE[0]}"
    16	while [ -L "$SOURCE" ]; do
    17	  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    18	  SOURCE="$(readlink "$SOURCE")"
    19	  # If $SOURCE was a relative symlink, resolve it relative to the symlink's directory
    20	  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
    21	done
    22	SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    23	PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    24	
    25	BUNDLE="$PROJECT_DIR/dist/cli.mjs"
    26	# V8 compile cache — caches bytecode of the bundle across runs (~20% faster).
    27	export NODE_COMPILE_CACHE="$PROJECT_DIR/dist/.compile-cache"
    28	
    29	run_bundle() {
    30	  exec node --disable-warning=DEP0040 --enable-source-maps "$BUNDLE" "$@"
    31	}
    32	
    33	run_tsx() {
    34	  # Resolve tsx's real install dir rather than assuming it sits in this
    35	  # package's own node_modules. Under the pnpm workspace (node-linker=hoisted)
    36	  # tsx is hoisted to the workspace-root node_modules, not callback-box's — so
    37	  # a hardcoded ./node_modules/tsx path is wrong on the server (and anywhere
    38	  # the workspace hoists). require.resolve walks up from PROJECT_DIR and finds
    39	  # it wherever it landed. This is the path prod actually runs: the dist bundle
    40	  # rebuild fails on the server (dist/ is owned by the deploying user, not the
    41	  # callback service user), so cb self-heals through tsx every time.
    42	  local tsx_dir
    43	  tsx_dir="$(node -e "process.stdout.write(require('path').dirname(require.resolve('tsx/package.json',{paths:['$PROJECT_DIR']})))")"
    44	  exec node \
    45	    --disable-warning=DEP0040 \
    46	    --import "file://$PROJECT_DIR/tsx-preload.mjs" \
    47	    --require "$tsx_dir/dist/preflight.cjs" \
    48	    --import "file://$tsx_dir/dist/loader.mjs" \
    49	    "$PROJECT_DIR/src/cli/index.ts" "$@"
    50	}
    51	
    52	# Prod fast path: a deploy built the bundle and source won't change underneath
    53	# us, so skip the staleness scan entirely.
    54	if [ -n "$CB_CLI_PREBUILT" ] && [ -f "$BUNDLE" ]; then
    55	  run_bundle "$@"
    56	fi
    57	
    58	# Dev: rebuild if the bundle is missing or any backend source (.ts, excluding
    59	# the frontend tree, which is spawned separately and not in the bundle) is
    60	# newer than it. Pruning src/frontend keeps this scan ~5ms even on a fresh
    61	# bundle. package.json is checked too so dependency changes trigger a rebuild.
    62	#
    63	# cardworks/dist is checked as well: it's a sibling workspace package inlined
    64	# into the bundle (consumed via `link:../cardworks`), so a cardworks rebuild
    65	# must invalidate our bundle too. Without this, a stale inlined cardworks
    66	# silently ships an old API surface — exactly how chat broke when cardworks'
    67	# named-params refactor landed but the bundle wasn't rebundled. `-L` follows
    68	# the node_modules symlink into the live build.
    69	needs_build=0
    70	if [ ! -f "$BUNDLE" ]; then
    71	  needs_build=1
    72	elif [ "$PROJECT_DIR/package.json" -nt "$BUNDLE" ]; then
    73	  needs_build=1
    74	elif [ -n "$(find "$PROJECT_DIR/src" -path "$PROJECT_DIR/src/frontend" -prune -o -name '*.ts' -newer "$BUNDLE" -print -quit 2>/dev/null)" ]; then
    75	  needs_build=1
    76	elif [ -n "$(find -L "$PROJECT_DIR/node_modules/cardworks/dist" -name '*.js' -newer "$BUNDLE" -print -quit 2>/dev/null)" ]; then
    77	  needs_build=1
    78	fi
    79	
    80	if [ "$needs_build" = 1 ]; then
    81	  if ! node "$PROJECT_DIR/scripts/build-cli.mjs" >/dev/null 2>&1; then
    82	    # Build failed — fall back to running source directly via tsx.
    83	    run_tsx "$@"
    84	  fi
    85	fi
    86	
    87	if [ -f "$BUNDLE" ]; then
    88	  run_bundle "$@"
    89	else
    90	  run_tsx "$@"
    91	fi

exec
/opt/homebrew/bin/bash -lc "find callback-box -maxdepth 3 -type f -path '*/dist/*' -print | sed -n '1,160p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/dist/cli.mjs.map
callback-box/dist/cli.mjs

exec
/opt/homebrew/bin/bash -lc "rg -n \"dist/cli/index|dist/cli\\.mjs|build-cli|tsx|NODE_OPTIONS|--import\" callback-box/bin callback-box/package.json callback-box/src callback-box/scripts -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/package.json:6:  "main": "dist/cli/index.js",
callback-box/package.json:8:    ".": "./dist/cli/index.js",
callback-box/package.json:18:    "build:cli": "node scripts/build-cli.mjs",
callback-box/package.json:26:    "cli": "node dist/cli/index.js",
callback-box/package.json:27:    "pretest": "node scripts/build-cli.mjs",
callback-box/package.json:30:    "knowledge-audit": "tsx src/dev/knowledge-audit.ts",
callback-box/package.json:31:    "prompt-report": "tsx src/dev/prompt-report.ts",
callback-box/package.json:32:    "generate:doc-images": "tsx src/dev/generate-doc-images.ts",
callback-box/package.json:33:    "doc-graph": "tsx src/dev/doc-graph.ts > docs/doc-graph.md",
callback-box/package.json:34:    "doc-graph-html": "tsx src/dev/doc-graph-html.ts",
callback-box/package.json:38:    "lint:circular": "madge --circular --extensions ts,tsx src/"
callback-box/package.json:63:    "tsx": "^4.21.0",
callback-box/package.json:115:    "src/frontend/src/**/*.{ts,tsx,js}": [
callback-box/bin/cb:4:# Runs a bundled, single-file build of the CLI (dist/cli.mjs) for fast cold
callback-box/bin/cb:6:# the per-module tsx loader-hook overhead that makes plain `tsx src/cli` slow.
callback-box/bin/cb:11:#     newer than it, then run it. If a build ever fails, fall back to tsx so
callback-box/bin/cb:25:BUNDLE="$PROJECT_DIR/dist/cli.mjs"
callback-box/bin/cb:33:run_tsx() {
callback-box/bin/cb:34:  # Resolve tsx's real install dir rather than assuming it sits in this
callback-box/bin/cb:36:  # tsx is hoisted to the workspace-root node_modules, not callback-box's — so
callback-box/bin/cb:37:  # a hardcoded ./node_modules/tsx path is wrong on the server (and anywhere
callback-box/bin/cb:41:  # callback service user), so cb self-heals through tsx every time.
callback-box/bin/cb:42:  local tsx_dir
callback-box/bin/cb:43:  tsx_dir="$(node -e "process.stdout.write(require('path').dirname(require.resolve('tsx/package.json',{paths:['$PROJECT_DIR']})))")"
callback-box/bin/cb:46:    --import "file://$PROJECT_DIR/tsx-preload.mjs" \
callback-box/bin/cb:47:    --require "$tsx_dir/dist/preflight.cjs" \
callback-box/bin/cb:48:    --import "file://$tsx_dir/dist/loader.mjs" \
callback-box/bin/cb:81:  if ! node "$PROJECT_DIR/scripts/build-cli.mjs" >/dev/null 2>&1; then
callback-box/bin/cb:82:    # Build failed — fall back to running source directly via tsx.
callback-box/bin/cb:83:    run_tsx "$@"
callback-box/bin/cb:90:  run_tsx "$@"
callback-box/bin/gen-image:2:// Thin stub: run src/dev/gen-image.ts via the project's local tsx.
callback-box/bin/gen-image:5:// Uses require.resolve to find tsx because under the pnpm workspace
callback-box/bin/gen-image:6:// (node-linker=hoisted) tsx is hoisted to the workspace root, not
callback-box/bin/gen-image:19:const tsxPkgPath = require.resolve("tsx/package.json", { paths: [projectRoot] });
callback-box/bin/gen-image:20:const tsxBin = join(dirname(tsxPkgPath), "dist", "cli.mjs");
callback-box/bin/gen-image:22:const child = spawn("node", [tsxBin, tsSrc, ...process.argv.slice(2)], {
callback-box/scripts/gen-tts-fixtures.ts:11: *   pnpm tsx scripts/gen-tts-fixtures.ts
callback-box/scripts/build-cli.mjs:1:// Bundles the CLI (src/cli/index.ts) into a single dist/cli.mjs for fast
callback-box/scripts/build-cli.mjs:3:// removes the per-module ESM loader-hook overhead that dominates tsx startup.
callback-box/scripts/build-cli.mjs:44:process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:682:> - Scripts run via `tsx` — no build step needed
callback-box/src/dev/doc-graph-html-data.ts:134:    blurb: "Auto-deploy on commit to main; rsync to a small VPS; server runs tsx directly.",
callback-box/src/dev/doc-graph-html.ts:1:#!/usr/bin/env node --import tsx
callback-box/scripts/migrate/landmark.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/landmark.ts:42: *   pnpm exec tsx scripts/migrate/landmark.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/landmark.ts:43: *   pnpm exec tsx scripts/migrate/landmark.ts <boxRoot> --apply
callback-box/src/dev/gen-image.ts:26: * Invoked via the bin/gen-image stub, which runs this through tsx.
callback-box/scripts/migrate/file.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/file.ts:8: *   pnpm exec tsx scripts/migrate/file.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/file.ts:9: *   pnpm exec tsx scripts/migrate/file.ts <boxRoot> --apply
callback-box/scripts/migrate/image.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/image.ts:8: *   pnpm exec tsx scripts/migrate/image.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/image.ts:9: *   pnpm exec tsx scripts/migrate/image.ts <boxRoot> --apply
callback-box/src/dev/prompt-report.ts:1:#!/usr/bin/env tsx
callback-box/scripts/test-calendar-create.ts:4: * Usage: pnpm exec tsx scripts/test-calendar-create.ts <boxRoot> <calendarId> <summary> [date]
callback-box/scripts/test-calendar-create.ts:20:      "Usage: pnpm exec tsx scripts/test-calendar-create.ts <boxRoot> <calendarId> <summary> [YYYY-MM-DD]"
callback-box/scripts/migrate/_harness.ts:14: *   #!/usr/bin/env tsx
callback-box/scripts/test-voxtral-diarization.ts:9: *     tsx scripts/test-voxtral-diarization.ts
callback-box/scripts/clean-broken-refs.ts:1:#!/usr/bin/env tsx
callback-box/scripts/clean-broken-refs.ts:31: *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot>           # dry-run
callback-box/scripts/clean-broken-refs.ts:32: *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot> --apply
callback-box/scripts/migrate/strip-type-field.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/strip-type-field.ts:16: *   pnpm exec tsx scripts/migrate/strip-type-field.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/strip-type-field.ts:17: *   pnpm exec tsx scripts/migrate/strip-type-field.ts <boxRoot> --apply
callback-box/scripts/migrate/doc-to-gdoc.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/doc-to-gdoc.ts:12: *   pnpm exec tsx scripts/migrate/doc-to-gdoc.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/doc-to-gdoc.ts:13: *   pnpm exec tsx scripts/migrate/doc-to-gdoc.ts <boxRoot> --apply
callback-box/scripts/test-calendar-push.ts:4: * Usage: pnpm exec tsx scripts/test-calendar-push.ts <boxRoot> <icsFilename>
callback-box/scripts/test-calendar-push.ts:30:    console.error("Usage: pnpm exec tsx scripts/test-calendar-push.ts <boxRoot> <icsFilename>");
callback-box/scripts/migrate/card-frontmatter.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/card-frontmatter.ts:18: *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/card-frontmatter.ts:19: *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot> --apply     # execute
callback-box/src/dev/knowledge-audit.ts:1:#!/usr/bin/env tsx
callback-box/src/dev/generate-doc-images.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/email-thread.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/email-thread.ts:37: *   pnpm exec tsx scripts/migrate/email-thread.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/email-thread.ts:38: *   pnpm exec tsx scripts/migrate/email-thread.ts <boxRoot> --apply
callback-box/scripts/migrate/audio.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/audio.ts:8: *   pnpm exec tsx scripts/migrate/audio.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/audio.ts:9: *   pnpm exec tsx scripts/migrate/audio.ts <boxRoot> --apply
callback-box/scripts/migrate/repair-refs.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/repair-refs.ts:27: *   pnpm exec tsx scripts/migrate/repair-refs.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/repair-refs.ts:28: *   pnpm exec tsx scripts/migrate/repair-refs.ts <boxRoot> --apply
callback-box/src/dev/knowledge-audits.yaml:2536:      config/schemas/) and built views/sandbox.tsx as its UI. But when the
callback-box/scripts/migrate/email-message.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/email-message.ts:42: *   pnpm exec tsx scripts/migrate/email-message.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/email-message.ts:43: *   pnpm exec tsx scripts/migrate/email-message.ts <boxRoot> --apply
callback-box/scripts/migrate/chat-thread.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/chat-thread.ts:7: *   pnpm exec tsx scripts/migrate/chat-thread.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/chat-thread.ts:8: *   pnpm exec tsx scripts/migrate/chat-thread.ts <boxRoot> --apply
callback-box/src/dev/doc-graph.ts:1:#!/usr/bin/env node --import tsx
callback-box/scripts/migrate/bill.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/bill.ts:28: *   pnpm exec tsx scripts/migrate/bill.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/bill.ts:29: *   pnpm exec tsx scripts/migrate/bill.ts <boxRoot> --apply
callback-box/scripts/migrate/recipe.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/recipe.ts:35: *   pnpm exec tsx scripts/migrate/recipe.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/recipe.ts:36: *   pnpm exec tsx scripts/migrate/recipe.ts <boxRoot> --apply
callback-box/scripts/migrate/briefing.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/briefing.ts:8: *   pnpm exec tsx scripts/migrate/briefing.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/briefing.ts:9: *   pnpm exec tsx scripts/migrate/briefing.ts <boxRoot> --apply
callback-box/scripts/migrate/record-person.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/record-person.ts:9: *   pnpm exec tsx scripts/migrate/record-person.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/record-person.ts:10: *   pnpm exec tsx scripts/migrate/record-person.ts <boxRoot> --apply
callback-box/scripts/migrate/misc.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/misc.ts:10: *   pnpm exec tsx scripts/migrate/misc.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/misc.ts:11: *   pnpm exec tsx scripts/migrate/misc.ts <boxRoot> --apply
callback-box/scripts/migrate/doc-sheet.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/doc-sheet.ts:9: *   pnpm exec tsx scripts/migrate/doc-sheet.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/doc-sheet.ts:10: *   pnpm exec tsx scripts/migrate/doc-sheet.ts <boxRoot> --apply
callback-box/scripts/migrate/personality.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/personality.ts:8: *   pnpm exec tsx scripts/migrate/personality.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/personality.ts:9: *   pnpm exec tsx scripts/migrate/personality.ts <boxRoot> --apply
callback-box/scripts/migrate/procedure-run.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/procedure-run.ts:12: *   pnpm exec tsx scripts/migrate/procedure-run.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/procedure-run.ts:13: *   pnpm exec tsx scripts/migrate/procedure-run.ts <boxRoot> --apply
callback-box/scripts/migrate/capture-session.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/capture-session.ts:14: *   pnpm exec tsx scripts/migrate/capture-session.ts <root>           # dry-run
callback-box/scripts/migrate/capture-session.ts:15: *   pnpm exec tsx scripts/migrate/capture-session.ts <root> --apply
callback-box/scripts/migrate/guide.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/guide.ts:13: *   pnpm exec tsx scripts/migrate/guide.ts <root>           # dry-run
callback-box/scripts/migrate/guide.ts:14: *   pnpm exec tsx scripts/migrate/guide.ts <root> --apply
callback-box/src/cli/bootstrap.ts:5: * to ensure TSX_TSCONFIG_PATH is set before tsx compiles any JSX.
callback-box/src/cli/bootstrap.ts:10:// Set TSX_TSCONFIG_PATH so tsx finds the correct tsconfig.json
callback-box/src/cli/bootstrap.ts:11:// regardless of working directory. This is needed because tsx uses
callback-box/src/cli/bootstrap.ts:16:// Once tsx compiles a module, changing this env var won't help.
callback-box/src/shared/markdoc-config.ts:97: * `renderers.html`; the React render config (`Markdown.tsx`) installs it.
callback-box/scripts/migrate/memo.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/memo.ts:8: *   pnpm exec tsx scripts/migrate/memo.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/memo.ts:9: *   pnpm exec tsx scripts/migrate/memo.ts <boxRoot> --apply
callback-box/scripts/migrate/question.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/question.ts:7: *   pnpm exec tsx scripts/migrate/question.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/question.ts:8: *   pnpm exec tsx scripts/migrate/question.ts <boxRoot> --apply
callback-box/src/lib/package-root.ts:5: * `callback-box` package.json. This is bundle-safe: under tsx this module
callback-box/scripts/migrate/webpage-card.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/webpage-card.ts:28: *   pnpm exec tsx scripts/migrate/webpage-card.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/webpage-card.ts:29: *   pnpm exec tsx scripts/migrate/webpage-card.ts <boxRoot> --apply
callback-box/src/webapp/server-main.ts:3: *   node --import tsx ./src/webapp/server-main.ts [boxDirs...]
callback-box/scripts/migrate/asset-marker.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/asset-marker.ts:18: *   pnpm exec tsx scripts/migrate/asset-marker.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/asset-marker.ts:19: *   pnpm exec tsx scripts/migrate/asset-marker.ts <boxRoot> --apply
callback-box/scripts/migrate/jobs.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/jobs.ts:12: *   pnpm exec tsx scripts/migrate/jobs.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/jobs.ts:13: *   pnpm exec tsx scripts/migrate/jobs.ts <boxRoot> --apply
callback-box/scripts/migrate/scheduled-script.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/scheduled-script.ts:8: *   pnpm exec tsx scripts/migrate/scheduled-script.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/scheduled-script.ts:9: *   pnpm exec tsx scripts/migrate/scheduled-script.ts <boxRoot> --apply
callback-box/scripts/migrate/delete-deprecated-cards.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/delete-deprecated-cards.ts:18: *   pnpm exec tsx scripts/migrate/delete-deprecated-cards.ts <root>           # dry-run
callback-box/scripts/migrate/delete-deprecated-cards.ts:19: *   pnpm exec tsx scripts/migrate/delete-deprecated-cards.ts <root> --apply
callback-box/scripts/migrate/attachments.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/attachments.ts:35: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/attachments.ts:36: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot> --apply     # execute
callback-box/scripts/migrate/attachments.ts:37: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot> --apply --no-commit
callback-box/scripts/migrate/procedure.ts:1:#!/usr/bin/env tsx
callback-box/scripts/migrate/procedure.ts:13: *   pnpm exec tsx scripts/migrate/procedure.ts <root>           # dry-run
callback-box/scripts/migrate/procedure.ts:14: *   pnpm exec tsx scripts/migrate/procedure.ts <root> --apply
callback-box/src/cli/commands/scheduler.ts:142:    // Find the cb binary — process.argv[1] may be a .ts file when run via tsx,
callback-box/src/schemas/briefing.tsx:13: * styled blocks via `src/frontend/src/components/BriefingTags.tsx`.
callback-box/src/cli/commands/trick.ts:7: * Scripts run as subprocesses via tsx with their own package context,
callback-box/src/cli/commands/trick.ts:22:/** Resolve the tsx CLI binary from cb's own dependencies. */
callback-box/src/cli/commands/trick.ts:24:  // tsx/cli is the entry point for the tsx binary
callback-box/src/cli/commands/trick.ts:25:  return require.resolve("tsx/cli");
callback-box/src/cli/commands/trick.ts:111: * Run a trick as a subprocess via tsx.
callback-box/src/webapp/routes/api-external.ts:29:  ".tsx": "text/plain",
callback-box/src/schemas/personality-instructions.ts:3: * personality.tsx so the schema module stays under the line limit; the
callback-box/src/cli/commands/migrate.ts:78:      ["tsx", scriptPath, args.boxRoot, "--apply"],
callback-box/src/webapp/views/compiler.ts:2: * Server-side compiler for agent-generated view .tsx files.
callback-box/src/webapp/views/compiler.ts:61:  return path.basename(filename, ".tsx");
callback-box/src/webapp/views/compiler.ts:118:      loader: "tsx",
callback-box/src/webapp/views/compiler.ts:171:  const files = await glob("*.tsx", { cwd: viewsDir });
callback-box/src/webapp/tts-mock.ts:58:      .send({ error: "mock TTS fixture missing — run: pnpm tsx scripts/gen-tts-fixtures.ts" });
callback-box/src/webapp/routes/views.ts:57:      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);
callback-box/src/webapp/routes/views.ts:80:      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);
callback-box/src/cli/commands/render.ts:47:    const renderScript = path.join(projectDir, "src/frontend/src/ssr/render.tsx");
callback-box/src/cli/commands/render.ts:52:      "--import", "tsx",
callback-box/src/cli/commands/render.ts:53:      "--import", ssrLoader,
callback-box/src/schemas/personality-template.ts:3: * personality.tsx so the schema module stays under the line limit;
callback-box/src/cli/commands/serve.ts:79:      // exec into node --watch with tsx loader, bypassing the CLI wrapper.
callback-box/src/cli/commands/serve.ts:80:      // Uses node's native watcher (not tsx --watch) for proper signal handling.
callback-box/src/cli/commands/serve.ts:89:        "--import", "tsx",
callback-box/src/frontend/src/pages/ViewPage.tsx:6: * agent-generated .tsx views.
callback-box/src/schemas/commentary.tsx:23:// module under Node's ESM loader (used by tsx / the doctest runner). Destructure
callback-box/src/frontend/src/pages/capture-api.ts:4: * Pure (non-React) logic split out of CapturePage.tsx: session lifecycle
callback-box/src/schemas/email-message.tsx:27: * For OUTBOUND email (drafts the agent authors), see `email-outbound.tsx`.
callback-box/src/schemas/personality-fields.ts:3: * Kept in a leaf module (no import back to personality.tsx) so the
callback-box/src/frontend/src/pages/SharePage.tsx:8: * The root /share route (ShareRedirect in App.tsx) handles box selection
callback-box/src/frontend/package.json:14:    "lint:circular": "madge --circular --extensions ts,tsx src/"
callback-box/src/frontend/package.json:53:    "src/**/*.{ts,tsx}": [
callback-box/src/frontend/src/ssr/render.tsx:4: * Usage: node --import tsx render.tsx <boxDir> <route> [options]
callback-box/src/schemas/gdoc.tsx:13: * Distinct from the generic `doc` schema (`src/schemas/doc.tsx`), which
callback-box/src/frontend/knip.json:4:    "src/main.tsx"
callback-box/src/frontend/knip.json:7:    "src/**/*.{ts,tsx}"
callback-box/src/schemas/personality-compile.ts:3: * markdown to the running `lines` array. Extracted from personality.tsx
callback-box/src/types/views.ts:4: * Views are .tsx files in views/ that agents write. They get compiled
callback-box/src/schemas/registry.ts:129: * with tsx's async loader hooks.
callback-box/src/frontend/tailwind.config.js:76:  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
callback-box/src/frontend/index.html:18:    <script type="module" src="/src/main.tsx"></script>
callback-box/src/frontend/src/ssr/register-loader.mjs:3: * Used as: node --import ./register-loader.mjs ...
callback-box/src/frontend/src/pages/dev/components/ComposerStatesHarness.tsx:23: * builds (see router.tsx).
callback-box/src/frontend/src/components/ViewRenderer.tsx:177:        if (changedPath === `views/${slug}.tsx`) {
callback-box/src/frontend/src/renderers/setup.ts:3: * This file should be imported once from main.tsx.
callback-box/src/frontend/eslint.config.mjs:25:    files: ["src/**/*.{ts,tsx}"],
callback-box/src/frontend/eslint.config.mjs:34:    // (router.tsx route guards).
callback-box/src/frontend/eslint.config.mjs:35:    files: ["src/**/*.{ts,tsx}"],
callback-box/src/frontend/src/components/FileView.tsx:89: * JSON is fetched by its own renderer (renderers/json.tsx), which gates on
callback-box/src/frontend/src/components/chat/message-parsing.ts:4: * the rendering components in ChatMessages.tsx and its siblings consume these.
callback-box/src/frontend/src/components/chat/InteractiveChat-message-items.tsx:6: * renderer. Split out of InteractiveChat-messages.tsx so the list shell
callback-box/src/frontend/src/pages/useCaptureDevices.ts:4: * Split out of CapturePage.tsx. Owns the media-device lists, the
callback-box/src/frontend/src/components/Markdown.tsx:17: *    `markdoc-config.ts` and `Quote.tsx`).
callback-box/src/frontend/src/pages/card/components/OpenChatControl.tsx:12: * Mirrors the landmark page's ChatButton (LandmarkSection.tsx) but adds the
callback-box/src/frontend/src/components/chat/InteractiveChat-messages.tsx:5: * InteractiveChat-message-items.tsx.
callback-box/src/frontend/src/components/chat/InteractiveChat-composer.tsx:4: * row that drops below the bar lives in InteractiveChat-mobile-row.tsx.
callback-box/src/core/agent-guide/chat.ts:63:    "Views are React components (`.tsx` files) in the `views/` directory that render in the browser.",
callback-box/src/core/search/extract.ts:13: * because the content is untrusted (see src/schemas/email-message.tsx) and
callback-box/src/frontend/src/lib/markdoc-parse.ts:20:// exception as `Markdown.tsx` / `markdoc-config.ts`.
callback-box/src/core/chat-session-prompts.ts:82:For custom interactive dashboards, you can create \`.tsx\` view components — see \`docs/generated/views.md\` for the full API. Do NOT use \`view:\` links for custom views; those links are for file paths only.
callback-box/src/frontend/src/hooks/useVoiceRecorder.ts:37: * ```tsx
callback-box/src/core/views-doc-files.ts:30:\`\`\`tsx
callback-box/src/core/views-doc-files.ts:64:\`\`\`tsx
callback-box/src/core/views-doc-files.ts:105:\`\`\`tsx
callback-box/src/core/views-doc-files.ts:142:\`\`\`tsx
callback-box/src/frontend/src/lib/binary-files.ts:7: * renderer in `renderers/binary.tsx`.
callback-box/src/core/box-templates.ts:203:Each trick runs as a standalone subprocess via tsx with its own package context,
callback-box/src/core/box-templates.ts:276:- Tricks run via tsx as subprocesses -- no build step needed
callback-box/src/core/box-templates.ts:284:This directory contains agent-generated React components (.tsx files) that render in the browser.
callback-box/src/core/views-doc.ts:11:Views are \`.tsx\` files in the \`views/\` directory at the box root. They get compiled server-side and rendered in the browser — either as standalone pages or embedded in chat messages.
callback-box/src/core/views-doc.ts:28:Each view is a \`.tsx\` file with named exports for metadata and a default export for the component:
callback-box/src/core/views-doc.ts:30:\`\`\`tsx
callback-box/src/core/views-doc.ts:76:\`\`\`tsx
callback-box/src/core/views-doc.ts:224:\`\`\`tsx
callback-box/src/core/views-doc.ts:248:\`\`\`tsx
callback-box/src/core/views-doc.ts:276:\`\`\`tsx

exec
/opt/homebrew/bin/bash -lc "find callback-box/node_modules -maxdepth 2 -type l -o -type d -name 'callback-box' -o -type l -name 'callback-box' 2>/dev/null | sed -n '1,80p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/node_modules/.bin/vibe-init
callback-box/node_modules/.bin/vibe-check
callback-box/node_modules/@ianbicking/personal-vibe-check
callback-box/node_modules/agent-doctest
callback-box/node_modules/cardworks

codex
C1’s diagnosis is basically sound for the bundled path: a dynamic box schema can resolve `callback-box/cards` to `src/cards/index.ts`, but the re-export `./schema.js` points to a file that does not exist in source mode unless a TS loader rewrites it. The plan should also fix `bin/cb`’s stale-bundle check, which currently watches `node_modules/cardworks/dist` and will break once cardworks is removed.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/lib/package-root.ts | sed -n '1,100p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Absolute path to the callback-box package root.
     3	 *
     4	 * Resolved by walking up from this module's location until we find the
     5	 * `callback-box` package.json. This is bundle-safe: under tsx this module
     6	 * lives at `src/lib/`, and in the esbuild bundle it lives at `dist/`, but
     7	 * either way the upward walk lands on the same package root — so callers
     8	 * can build paths to `bin/`, `templates/`, `tsconfig.json`, etc. without
     9	 * hard-coding a `../..` depth that only holds for one source layout.
    10	 *
    11	 * Prefer this over `import.meta.dirname` + `../..` for anything that points
    12	 * at a fixed asset relative to the package root.
    13	 */
    14	import { existsSync, readFileSync } from "node:fs";
    15	import { dirname, join } from "node:path";
    16	
    17	class PackageRootNotFoundError extends Error {
    18	  constructor() {
    19	    super("package-root: could not locate the callback-box package root");
    20	    this.name = "PackageRootNotFoundError";
    21	  }
    22	}
    23	
    24	function findPackageRoot(): string {
    25	  let dir = import.meta.dirname;
    26	  for (;;) {
    27	    const pkgPath = join(dir, "package.json");
    28	    if (existsSync(pkgPath)) {
    29	      try {
    30	        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    31	        if (pkg.name === "callback-box") return dir;
    32	      } catch (_e) {
    33	        // Unparseable package.json — keep walking up.
    34	      }
    35	    }
    36	    const parent = dirname(dir);
    37	    if (parent === dir) {
    38	      throw new PackageRootNotFoundError();
    39	    }
    40	    dir = parent;
    41	  }
    42	}
    43	
    44	export const PACKAGE_ROOT = findPackageRoot();

exec
/opt/homebrew/bin/bash -lc "rg -n \"node_modules/cardworks|cardworks/dist|dist/cards|src/cards/index.ts|\\\"\\.\\/cards\\\"|dist/cli/index.js\" callback-box/bin callback-box/scripts callback-box/package.json callback-box/docs/plans/remove-cardworks-deletion.md" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/package.json:6:  "main": "dist/cli/index.js",
callback-box/package.json:8:    ".": "./dist/cli/index.js",
callback-box/package.json:9:    "./cards": "./src/cards/index.ts"
callback-box/package.json:26:    "cli": "node dist/cli/index.js",
callback-box/docs/plans/remove-cardworks-deletion.md:126:imports but not the TS-source `.js` re-exports in `src/cards/index.ts`
callback-box/docs/plans/remove-cardworks-deletion.md:128:`Cannot find module schema.js`. So `package.json` `exports: { "./cards":
callback-box/docs/plans/remove-cardworks-deletion.md:129:"./src/cards/index.ts" }` works in dev but not in the shipped bundle. This is
callback-box/docs/plans/remove-cardworks-deletion.md:136:- Add a build step that compiles `src/cards/*.ts` → `dist/cards/*.js` (the
callback-box/docs/plans/remove-cardworks-deletion.md:138:  `exports: { "./cards": "./dist/cards/index.js" }`.
callback-box/docs/plans/remove-cardworks-deletion.md:151:magic and matches how `dist/cli/index.js` (the `.` export) already ships.
callback-box/docs/plans/remove-cardworks-deletion.md:153:**First implementation chunk.** Spike: add the `dist/cards` build + `exports`
callback-box/docs/plans/remove-cardworks-deletion.md:317:**What.** Remove `cardworks/`, the `callback-box/node_modules/cardworks`
callback-box/docs/plans/remove-cardworks-deletion.md:413:2. **C1 resolution mechanism.** Lean is (a) a `dist/cards` build + `exports`
callback-box/docs/plans/remove-cardworks-deletion.md:436:   `dist/cards`, set `exports` `./cards`, prove a box schema importing
callback-box/bin/cb:63:# cardworks/dist is checked as well: it's a sibling workspace package inlined
callback-box/bin/cb:76:elif [ -n "$(find -L "$PROJECT_DIR/node_modules/cardworks/dist" -name '*.js' -newer "$BUNDLE" -print -quit 2>/dev/null)" ]; then

exec
/opt/homebrew/bin/bash -lc 'rg -n "find -L .*cardworks|cardworks" callback-box/bin/cb callback-box/scripts/build-cli.mjs callback-box/package.json pnpm-workspace.yaml callback-box/tsconfig.json' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/bin/cb:63:# cardworks/dist is checked as well: it's a sibling workspace package inlined
callback-box/bin/cb:64:# into the bundle (consumed via `link:../cardworks`), so a cardworks rebuild
callback-box/bin/cb:65:# must invalidate our bundle too. Without this, a stale inlined cardworks
callback-box/bin/cb:66:# silently ships an old API surface — exactly how chat broke when cardworks'
callback-box/bin/cb:76:elif [ -n "$(find -L "$PROJECT_DIR/node_modules/cardworks/dist" -name '*.js' -newer "$BUNDLE" -print -quit 2>/dev/null)" ]; then
callback-box/scripts/build-cli.mjs:7:// __dirname / asset resolution intact. cardworks resolves to its built dist.
callback-box/package.json:84:    "cardworks": "workspace:*",
pnpm-workspace.yaml:17:  - cardworks

codex
Another “delete outright” wording problem: `scan-import` is a registered command, not just an orphan helper. The XML mutation inside it is dead for frontmatter image cards, but the import feature itself is very much on the command surface.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/commands/scan-import.ts | sed -n '1,340p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/commands/index.ts | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Command Registry
     3	 *
     4	 * Import this module to register all commands with the command runner.
     5	 */
     6	
     7	// Import commands to register them
     8	import "./create.js";
     9	import "./connector-sync.js";
    10	import "./answer.js";
    11	import "./trash.js";
    12	import "./move.js";
    13	import "./procedure.js";
    14	import "./transcribe-captures.js";
    15	import "./assemble-timeline.js";
    16	import "./describe-images.js";
    17	import "./scan-import.js";
    18	import "./upload.js";
    19	import "./attachments.js";
    20	import "./ls.js";
    21	import "./search.js";
    22	import "./wakeup.js";
    23	import "./intake.js";
    24	import "./triage.js";
    25	import "./handle.js";
    26	
    27	// Re-export for convenience
    28	export {
    29	  registerCommand,
    30	  getCommand,
    31	  listCommands,
    32	  runCommand,
    33	  createCliContext,
    34	  createCollectorContext,
    35	  type CommandContext,
    36	  type CommandDefinition,
    37	  type CommandResult,
    38	  type ArgDefinition,
    39	} from "../command-runner.js";
    40	
    41	export { getTemplateNames } from "../../schemas/index.js";

 succeeded in 0ms:
     1	/**
     2	 * Scan-Import command — turn a scanned PDF, OCR'd document PDF, or batch of
     3	 * scanned JPEGs into a session whose card lands at
     4	 * `box/inbox/scan-<date>-<id>.capture-session.card`. Child cards and files
     5	 * live in the session's attach scope (`scan-….attach/`).
     6	 *
     7	 * Internal dispatch:
     8	 *   - All inputs are images (.jpg/.png/etc) → photo flow with image batch
     9	 *   - Single PDF, no embedded text → photo flow with rendered pages
    10	 *   - Single PDF with embedded text → document mode (no Flash, file the PDF)
    11	 *   - Multiple PDFs or mixed types → error (callers must split)
    12	 *
    13	 * Photo flow output (`<sessionAttach>` = `scan-….attach`):
    14	 *   <sessionAttach>/photo-NNN.image.card + photo-NNN.attach/photo-NNN.jpg
    15	 *     and (optionally) photo-NNN-back.jpg in the same image attach scope
    16	 *   <sessionAttach>/photo-NNN.review.question.card (optional)
    17	 *   <sessionAttach>/orphan-back-NNN.jpg + orphan-back-NNN.question.card
    18	 *   <sessionAttach>/unsure-NNN.jpg + unsure-NNN.question.card
    19	 *   box/inbox/<name>.capture-session.card  (at inbox level)
    20	 *   <sessionAttach>/source.file.card + source.attach/source.pdf
    21	 *     (when imported from a PDF source)
    22	 *
    23	 * Document flow output:
    24	 *   <sessionAttach>/source.file.card + source.attach/source.pdf
    25	 *   box/inbox/<name>.capture-session.card  (no image refs)
    26	 *
    27	 * Internal implementation is split across siblings: `scan-import-session.ts`
    28	 * (layout + input classification), `scan-import-document.ts` (the PDF/document
    29	 * flow), `scan-import-cards.ts` (photo/back/orphan/unsure card emission), and
    30	 * `scan-import-helpers.ts` (Gemini batching + reconciliation).
    31	 */
    32	
    33	import * as fs from "node:fs/promises";
    34	import * as path from "node:path";
    35	import {
    36	  registerCommand,
    37	  type CommandContext,
    38	  type CommandResult,
    39	} from "../command-runner.js";
    40	import { createLoader } from "../../cli/lib/loader.js";
    41	import { stageFiles, commit } from "../../cli/lib/git.js";
    42	import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
    43	import { createOrAppendIntakeJob } from "../../connectors/intake-utils.js";
    44	import {
    45	  runScanBatches,
    46	  resolveScanPages,
    47	  bundleResolvedPages,
    48	} from "./scan-import-helpers.js";
    49	import {
    50	  createSessionLayout,
    51	  readScanContextFile,
    52	  isImageFile,
    53	  isPdfFile,
    54	} from "./scan-import-session.js";
    55	import { runDocumentMode } from "./scan-import-document.js";
    56	import {
    57	  emitPhotoBundle,
    58	  emitOrphanBackQuestion,
    59	  emitUnsureQuestion,
    60	} from "./scan-import-cards.js";
    61	
    62	export interface ScanImportArgs {
    63	  inputs: string[];
    64	  context?: string;
    65	}
    66	
    67	async function executeScanImport(
    68	  ctx: CommandContext,
    69	  args: Record<string, unknown>
    70	): Promise<CommandResult> {
    71	  const { inputs, context: extraContext } = args as unknown as ScanImportArgs;
    72	
    73	  if (!inputs || inputs.length === 0) {
    74	    return { success: false, error: "inputs argument is required (at least one file)" };
    75	  }
    76	
    77	  const resolved: string[] = [];
    78	  for (const f of inputs) {
    79	    const abs = path.isAbsolute(f) ? f : path.join(ctx.boxRoot, f);
    80	    try {
    81	      await fs.access(abs);
    82	    } catch (_e) {
    83	      // fs.access rejects when the input path is missing/unreadable — that
    84	      // is precisely the condition we report back to the caller. The error
    85	      // adds no detail beyond the path, so we don't surface it.
    86	      return { success: false, error: `Input file not found: ${abs}` };
    87	    }
    88	    resolved.push(abs);
    89	  }
    90	
    91	  const allPdf = resolved.every((f) => isPdfFile(f));
    92	  const allImage = resolved.every((f) => isImageFile(f));
    93	  if (!allPdf && !allImage) {
    94	    return {
    95	      success: false,
    96	      error: "Mixed file types in one scan-import invocation. PDFs run one-per-session; images can be batched together.",
    97	    };
    98	  }
    99	
   100	  if (allPdf) {
   101	    if (resolved.length > 1) {
   102	      return {
   103	        success: false,
   104	        error: "scan-import takes a single PDF at a time (use cb upload for batches)",
   105	      };
   106	    }
   107	    // PDFs are always filed as documents — Flash treatment for PDFs is deferred.
   108	    return runDocumentMode(ctx, { pdfPath: resolved[0]! });
   109	  }
   110	
   111	  const apiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"];
   112	  if (!apiKey) {
   113	    return { success: false, error: "GEMINI_KEY environment variable is required" };
   114	  }
   115	  return runPhotoMode(ctx, {
   116	    apiKey,
   117	    imagePaths: resolved,
   118	    extraContext,
   119	  });
   120	}
   121	
   122	interface RunPhotoModeArgs {
   123	  apiKey: string;
   124	  imagePaths: string[];
   125	  extraContext: string | undefined;
   126	}
   127	
   128	/**
   129	 * Build the combined boxholder context from the optional CLAUDE_SCANS.md file
   130	 * and any `--context` argument, logging which sources contributed.
   131	 */
   132	async function resolveBoxholderContext(
   133	  ctx: CommandContext,
   134	  extraContext: string | undefined
   135	): Promise<string | null> {
   136	  const fileContext = await readScanContextFile(ctx.boxRoot);
   137	  const contextParts: string[] = [];
   138	  if (fileContext) contextParts.push(fileContext.trim());
   139	  if (extraContext && extraContext.trim().length > 0) contextParts.push(extraContext.trim());
   140	  const boxholderContext = contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : null;
   141	  if (boxholderContext) {
   142	    ctx.writeLine(
   143	      `Using boxholder context (${boxholderContext.length} chars${fileContext ? " from CLAUDE_SCANS.md" : ""}${extraContext ? " + --context" : ""})`
   144	    );
   145	  }
   146	  return boxholderContext;
   147	}
   148	
   149	async function runPhotoMode(
   150	  ctx: CommandContext,
   151	  args: RunPhotoModeArgs
   152	): Promise<CommandResult> {
   153	  const { apiKey, imagePaths, extraContext } = args;
   154	  const layout = await createSessionLayout(ctx);
   155	  const {
   156	    sessionAttachRelDir,
   157	    sessionAttachAbsDir,
   158	    sessionCardAbsPath,
   159	    sessionCardRelPath,
   160	    sessionId,
   161	    startedAt,
   162	  } = layout;
   163	  ctx.writeLine(`Photo intake → ${sessionCardRelPath}`);
   164	  ctx.writeLine(`Source: ${imagePaths.length} image file(s)`);
   165	
   166	  const filesToStage: string[] = [];
   167	
   168	  // Copy each input into a scratch dir so the originals stay untouched and
   169	  // the archive copy lives inside the session for safety. Gemini handles
   170	  // ~3000-pixel JPEGs directly, so we send the same files for analysis —
   171	  // no separate API render needed. The scratch dir is removed before commit.
   172	  const archiveDir = path.join(sessionAttachAbsDir, ".scan-archive");
   173	  await fs.mkdir(archiveDir, { recursive: true });
   174	  const archivePages: string[] = [];
   175	  for (const [i, src] of imagePaths.entries()) {
   176	    const idx = String(i + 1).padStart(3, "0");
   177	    const dst = path.join(archiveDir, `page-${idx}${path.extname(src).toLowerCase()}`);
   178	    await fs.copyFile(src, dst);
   179	    archivePages.push(dst);
   180	  }
   181	  const apiPages = archivePages;
   182	  const sourceLabel = `${imagePaths.length} images`;
   183	
   184	  const boxholderContext = await resolveBoxholderContext(ctx, extraContext);
   185	
   186	  ctx.writeLine(`Analyzing ${apiPages.length} pages with Gemini Flash...`);
   187	  const batchResult = await runScanBatches({
   188	    apiKey,
   189	    imagePaths: apiPages,
   190	    boxholderContext,
   191	    log: (line) => ctx.writeLine(line),
   192	  });
   193	  if (batchResult.failed > 0) ctx.writeLine(`${batchResult.failed} page(s) failed analysis`);
   194	  if (batchResult.usage) {
   195	    ctx.writeLine(
   196	      `Tokens: input=${batchResult.usage.prompt}, output=${batchResult.usage.output}, thinking=${batchResult.usage.thinking}`
   197	    );
   198	  }
   199	
   200	  const resolvedPages = resolveScanPages(batchResult.pageAnalyses, apiPages.length);
   201	  const { bundles, orphanBacks, unsurePages, blankPages } = bundleResolvedPages(resolvedPages);
   202	  ctx.writeLine(
   203	    `\nResults: ${bundles.length} photos (${bundles.filter((b) => b.backIndex !== null).length} with backs), ${orphanBacks.length} orphan backs, ${unsurePages.length} unsure, ${blankPages.length} blank`
   204	  );
   205	
   206	  const loader = await createLoader(ctx.boxRoot);
   207	  const imageRefs: string[] = [];
   208	  const questionPaths: string[] = [];
   209	
   210	  for (const [i, bundle] of bundles.entries()) {
   211	    await emitPhotoBundle({
   212	      loader,
   213	      index: i,
   214	      bundle,
   215	      startedAt,
   216	      sessionAttachAbsDir,
   217	      sessionAttachRelDir,
   218	      archivePages,
   219	      filesToStage,
   220	      imageRefs,
   221	      questionPaths,
   222	    });
   223	  }
   224	
   225	  for (const [i, orphan] of orphanBacks.entries()) {
   226	    await emitOrphanBackQuestion(orphan, {
   227	      index: i,
   228	      sessionAttachAbsDir,
   229	      sessionAttachRelDir,
   230	      archivePages,
   231	      filesToStage,
   232	      questionPaths,
   233	    });
   234	  }
   235	
   236	  for (const [i, page] of unsurePages.entries()) {
   237	    await emitUnsureQuestion(page, {
   238	      index: i,
   239	      sessionAttachAbsDir,
   240	      sessionAttachRelDir,
   241	      archivePages,
   242	      filesToStage,
   243	      questionPaths,
   244	    });
   245	  }
   246	
   247	  await fs.rm(archiveDir, { recursive: true, force: true });
   248	
   249	  const sessionCardContent = createCaptureSessionTemplate({
   250	    sessionId,
   251	    startedAt,
   252	    endedAt: startedAt,
   253	    imageRefs,
   254	    audioRefs: [],
   255	    fileRefs: [],
   256	  });
   257	  await fs.writeFile(sessionCardAbsPath, sessionCardContent);
   258	  filesToStage.push(sessionCardRelPath);
   259	
   260	  await stageFiles(ctx.boxRoot, filesToStage);
   261	  const summaryParts: string[] = [`${bundles.length} photos`];
   262	  if (orphanBacks.length > 0) summaryParts.push(`${orphanBacks.length} orphan backs`);
   263	  if (unsurePages.length > 0) summaryParts.push(`${unsurePages.length} unsure`);
   264	  await commit(ctx.boxRoot, {
   265	    message: `Scan import: ${summaryParts.join(", ")}`,
   266	    trailers: { "Created-By": "scan-import" },
   267	  });
   268	
   269	  const intakeItems = [sessionCardRelPath, ...questionPaths];
   270	  const intakeDescription = `Scan from ${sourceLabel}: ${bundles.length} photo${bundles.length === 1 ? "" : "s"}${questionPaths.length > 0 ? `, ${questionPaths.length} review question${questionPaths.length === 1 ? "" : "s"}` : ""}`;
   271	  const intakeJobPath = await createOrAppendIntakeJob({
   272	    boxRoot: ctx.boxRoot,
   273	    source: "scan",
   274	    items: intakeItems,
   275	    description: intakeDescription,
   276	  });
   277	  ctx.writeLine(`\nIntake job: ${intakeJobPath}`);
   278	  ctx.writeLine(`Session: ${sessionCardRelPath}`);
   279	
   280	  return {
   281	    success: true,
   282	    data: {
   283	      mode: "photo",
   284	      sessionRelDir: sessionAttachRelDir,
   285	      sessionCardPath: sessionCardRelPath,
   286	      photoCount: bundles.length,
   287	      pairedCount: bundles.filter((b) => b.backIndex !== null).length,
   288	      orphanBackCount: orphanBacks.length,
   289	      unsureCount: unsurePages.length,
   290	      blankCount: blankPages.length,
   291	      reviewQuestions: questionPaths.length,
   292	      intakeJobPath,
   293	    },
   294	  };
   295	}
   296	
   297	registerCommand({
   298	  name: "scan-import",
   299	  description: "Import an image batch as photo image cards, or a PDF as a document, into box/inbox/scan-…/",
   300	  args: [
   301	    {
   302	      name: "inputs",
   303	      description: "PDF (one) or image files (many) — absolute or relative to box root",
   304	      required: true,
   305	      type: "string[]",
   306	    },
   307	    {
   308	      name: "context",
   309	      description: "Extra context appended to CLAUDE_SCANS.md content for this run",
   310	      required: false,
   311	      type: "string",
   312	    },
   313	  ],
   314	  execute: executeScanImport,
   315	});
   316	
   317	export { executeScanImport };

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/commands/scan-import-cards.ts | sed -n '1,280p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Card emission for the scan-import photo flow.
     3	 *
     4	 * Three cohesive jobs live here, all operating on the session's attach scope:
     5	 *   - `emitPhotoBundle` — write a photo's image card (renaming the photo and
     6	 *     any back JPEG into the card's attach scope), apply the Gemini analysis,
     7	 *     and emit a review question when the bundle is flagged.
     8	 *   - `emitOrphanBackQuestion` / `emitUnsureQuestion` — file a loose JPEG and
     9	 *     a text question prompting the human to place or discard it.
    10	 *   - `applyBundleAnalysisToCard` — mutate a freshly-written image card with
    11	 *     the analyzed description, text blocks, rotation, and subject bbox.
    12	 *
    13	 * Each emitter pushes onto the caller's `filesToStage`/`questionPaths` arrays
    14	 * and (for bundles) the `imageRefs` array, mirroring the original inline loops
    15	 * exactly.
    16	 */
    17	
    18	import * as fs from "node:fs/promises";
    19	import * as path from "node:path";
    20	import type { createLoader } from "../../cli/lib/loader.js";
    21	import { createImageTemplate } from "../../schemas/image.js";
    22	import { createTextQuestionTemplate } from "../../schemas/question.js";
    23	import type { PhotoBundle, OrphanBack, ResolvedPage } from "./scan-import-helpers.js";
    24	
    25	type Loader = Awaited<ReturnType<typeof createLoader>>;
    26	
    27	interface PhotoBundleEmitContext {
    28	  loader: Loader;
    29	  index: number;
    30	  bundle: PhotoBundle;
    31	  startedAt: string;
    32	  sessionAttachAbsDir: string;
    33	  sessionAttachRelDir: string;
    34	  archivePages: string[];
    35	  filesToStage: string[];
    36	  imageRefs: string[];
    37	  questionPaths: string[];
    38	}
    39	
    40	export async function emitPhotoBundle(emitCtx: PhotoBundleEmitContext): Promise<void> {
    41	  const {
    42	    loader,
    43	    index,
    44	    bundle,
    45	    startedAt,
    46	    sessionAttachAbsDir,
    47	    sessionAttachRelDir,
    48	    archivePages,
    49	    filesToStage,
    50	    imageRefs,
    51	    questionPaths,
    52	  } = emitCtx;
    53	  const photoIdx = String(index + 1).padStart(3, "0");
    54	  const photoBasename = `photo-${photoIdx}`;
    55	  const photoFilename = `${photoBasename}.jpg`;
    56	  const cardFilename = `${photoBasename}.image.card`;
    57	
    58	  // Photo and its back live in the image card's attach scope.
    59	  const photoAttachAbs = path.join(sessionAttachAbsDir, `${photoBasename}.attach`);
    60	  await fs.mkdir(photoAttachAbs, { recursive: true });
    61	  await fs.rename(archivePages[bundle.photoIndex]!, path.join(photoAttachAbs, photoFilename));
    62	  filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${photoFilename}`);
    63	
    64	  let backFilename: string | null = null;
    65	  if (bundle.backIndex !== null) {
    66	    backFilename = `${photoBasename}-back.jpg`;
    67	    await fs.rename(archivePages[bundle.backIndex]!, path.join(photoAttachAbs, backFilename));
    68	    filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}`);
    69	  }
    70	
    71	  const cardContent = createImageTemplate({
    72	    capturedAt: startedAt,
    73	    source: "gallery",
    74	    filename: photoFilename,
    75	  });
    76	  const cardPath = path.join(sessionAttachAbsDir, cardFilename);
    77	  await fs.writeFile(cardPath, cardContent);
    78	  await applyBundleAnalysisToCard(loader, { cardPath, bundle });
    79	  filesToStage.push(`${sessionAttachRelDir}/${cardFilename}`);
    80	  imageRefs.push(cardFilename);
    81	
    82	  if (bundle.flagForReview) {
    83	    const memo = [
    84	      `Photo ${photoIdx} (page ${bundle.photoIndex + 1}${bundle.backIndex !== null ? `, back on page ${bundle.backIndex + 1}` : ""}) needs review:`,
    85	      ...bundle.flagReasons.map((r) => `- ${r}`),
    86	    ].join("\n");
    87	    const directiveParts = [`Open ${sessionAttachRelDir}/${cardFilename} and adjust description or text blocks.`];
    88	    if (backFilename) {
    89	      directiveParts.push(`Cross-check the back transcription against ${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}.`);
    90	    }
    91	    const questionContent = createTextQuestionTemplate({
    92	      memo,
    93	      prompt: `Review ${photoBasename}: confirm description and back-of-photo text are accurate.`,
    94	      directive: directiveParts.join(" "),
    95	    });
    96	    const questionFilename = `${photoBasename}.review.question.card`;
    97	    const questionPath = path.join(sessionAttachAbsDir, questionFilename);
    98	    await fs.writeFile(questionPath, questionContent);
    99	    filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
   100	    questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
   101	  }
   102	}
   103	
   104	interface LooseQuestionContext {
   105	  index: number;
   106	  sessionAttachAbsDir: string;
   107	  sessionAttachRelDir: string;
   108	  archivePages: string[];
   109	  filesToStage: string[];
   110	  questionPaths: string[];
   111	}
   112	
   113	export async function emitOrphanBackQuestion(
   114	  orphan: OrphanBack,
   115	  looseCtx: LooseQuestionContext
   116	): Promise<void> {
   117	  const { index, sessionAttachAbsDir, sessionAttachRelDir, archivePages, filesToStage, questionPaths } = looseCtx;
   118	  const idx = String(index + 1).padStart(3, "0");
   119	  const basename = `orphan-back-${idx}`;
   120	  const filename = `${basename}.jpg`;
   121	  // Loose image (no card) — lives directly in the session's attach scope.
   122	  await fs.rename(archivePages[orphan.index]!, path.join(sessionAttachAbsDir, filename));
   123	  filesToStage.push(`${sessionAttachRelDir}/${filename}`);
   124	  const ocrText = orphan.analysis.text_blocks.map((b) => b.text).join("\n").trim();
   125	  const memo = [
   126	    `Found a back-of-photo with no matching photo (page ${orphan.index + 1}).`,
   127	    ocrText ? `Transcribed text:\n${ocrText}` : "(no transcribed text)",
   128	  ].join("\n\n");
   129	  const questionContent = createTextQuestionTemplate({
   130	    memo,
   131	    prompt: `Which photo does ${filename} belong with, or should it be discarded?`,
   132	    directive: `If it belongs with a photo in this session, attach by appending text blocks to that image card. Otherwise delete ${sessionAttachRelDir}/${filename}.`,
   133	  });
   134	  const questionFilename = `${basename}.question.card`;
   135	  const questionPath = path.join(sessionAttachAbsDir, questionFilename);
   136	  await fs.writeFile(questionPath, questionContent);
   137	  filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
   138	  questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
   139	}
   140	
   141	export async function emitUnsureQuestion(
   142	  page: ResolvedPage,
   143	  looseCtx: LooseQuestionContext
   144	): Promise<void> {
   145	  const { index, sessionAttachAbsDir, sessionAttachRelDir, archivePages, filesToStage, questionPaths } = looseCtx;
   146	  const idx = String(index + 1).padStart(3, "0");
   147	  const basename = `unsure-${idx}`;
   148	  const filename = `${basename}.jpg`;
   149	  await fs.rename(archivePages[page.index]!, path.join(sessionAttachAbsDir, filename));
   150	  filesToStage.push(`${sessionAttachRelDir}/${filename}`);
   151	  const memo = [
   152	    `Could not classify page ${page.index + 1}.`,
   153	    page.analysis.flag_reason ?? "(no specific reason given)",
   154	  ].join("\n\n");
   155	  const questionContent = createTextQuestionTemplate({
   156	    memo,
   157	    prompt: `What is ${filename}? (photo, back-of-photo, or trash)`,
   158	    directive: `If a photo, create an image card. If a back, attach to the relevant photo card. Otherwise delete ${sessionAttachRelDir}/${filename}.`,
   159	  });
   160	  const questionFilename = `${basename}.question.card`;
   161	  const questionPath = path.join(sessionAttachAbsDir, questionFilename);
   162	  await fs.writeFile(questionPath, questionContent);
   163	  filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
   164	  questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
   165	}
   166	
   167	async function applyBundleAnalysisToCard(
   168	  loader: Loader,
   169	  { cardPath, bundle }: { cardPath: string; bundle: PhotoBundle }
   170	): Promise<void> {
   171	  const card = await loader.load(cardPath);
   172	  const el = card.element;
   173	
   174	  el.attrs["status"] = "analyzed";
   175	  const photo = bundle.photo;
   176	  const back = bundle.back;
   177	
   178	  const photoTextBlocks = photo.text_blocks.map((b) => ({
   179	    source: b.source || "photo",
   180	    text: b.text,
   181	  }));
   182	  const backTextBlocks = back
   183	    ? back.text_blocks.map((b) => ({ source: b.source || "back", text: b.text }))
   184	    : [];
   185	  const allTextBlocks = [...photoTextBlocks, ...backTextBlocks];
   186	  const hasText = allTextBlocks.length > 0;
   187	
   188	  el.attrs["has-text"] = hasText ? "true" : "false";
   189	  if (photo.rotation !== 0) {
   190	    el.attrs["rotation"] = String(photo.rotation);
   191	  }
   192	
   193	  const descChild = el.children.find((c) => c.tagName === "description");
   194	  if (descChild) descChild.text = photo.description;
   195	
   196	  el.children = el.children.filter(
   197	    (c) =>
   198	      c.tagName !== "text" &&
   199	      c.tagName !== "exif" &&
   200	      c.tagName !== "subject-bbox" &&
   201	      c.tagName !== "document"
   202	  );
   203	
   204	  for (const block of allTextBlocks) {
   205	    el.children.push({
   206	      tagName: "text",
   207	      attrs: { source: block.source },
   208	      text: block.text,
   209	      children: [],
   210	      comments: {},
   211	      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
   212	      dirty: true,
   213	    });
   214	  }
   215	
   216	  if (photo.subject_bbox && photo.subject_bbox.length === 4) {
   217	    el.children.push({
   218	      tagName: "subject-bbox",
   219	      attrs: {
   220	        y1: String(photo.subject_bbox[0]),
   221	        x1: String(photo.subject_bbox[1]),
   222	        y2: String(photo.subject_bbox[2]),
   223	        x2: String(photo.subject_bbox[3]),
   224	      },
   225	      text: "",
   226	      children: [],
   227	      comments: {},
   228	      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
   229	      dirty: true,
   230	    });
   231	  }
   232	
   233	  await loader.save(card);
   234	}

exec
/opt/homebrew/bin/bash -lc "rg -n \"scan-import|scanImport|analyzePhotoBundle|applyPhotoBundleAnalysis|stageSessionFiles|commands/index|register.*scan\" callback-box/src callback-box/test -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/test/handle.doctest.md:12:import { createCollectorContext } from "../src/core/commands/index.js";
callback-box/test/move-command.doctest.md:15:import { createCollectorContext } from "../src/core/commands/index.js";
callback-box/test/scan-import-helpers.doctest.md:3:Helpers for the `scan-import` command: sliding-overlap batch planning, pair reconciliation across overlapping batches, and bundling resolved pages into photo/back groups.
callback-box/test/scan-import-helpers.doctest.md:12:} from "../src/core/commands/scan-import-helpers.js";
callback-box/src/dev/knowledge-audits.yaml:1494:  # paragraph (handwriting clues + cb scan-import + Gemini Flash)
callback-box/src/dev/knowledge-audits.yaml:1535:      eras, places, handwriting clues) and that `cb scan-import`
callback-box/src/dev/knowledge-audits.yaml:1548:        scans, or scan-import — the answer must come from the
callback-box/src/dev/knowledge-audits.yaml:1550:    correct_contains_any: ["handwriting", "scan-import", "Gemini Flash"]
callback-box/src/cli/index.ts:41:  scanImportCommand,
callback-box/src/cli/index.ts:59:} from "./commands/index.js";
callback-box/src/cli/index.ts:100:program.addCommand(scanImportCommand);
callback-box/src/cli/commands/intake.ts:10:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/cli/commands/assemble-timeline.ts:9:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/cli/commands/answer.ts:9:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/cli/commands/upload.ts:7:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/webapp/routes/actions.ts:17:} from "../../core/commands/index.js";
callback-box/src/cli/commands/create.ts:12:} from "../../core/commands/index.js";
callback-box/src/cli/commands/index.ts:34:export { scanImportCommand } from "./scan-import.js";
callback-box/src/cli/commands/handle.ts:10:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/core/commands/scan-import-reconcile.ts:9:import type { ScanPageAnalysis } from "./scan-import-gemini.js";
callback-box/src/core/commands/scan-import-document.ts:2: * Document flow for the scan-import command: a single PDF that already has
callback-box/src/core/commands/scan-import-document.ts:15:import { createSessionLayout } from "./scan-import-session.js";
callback-box/src/core/commands/scan-import-document.ts:43:    source: "scan-import",
callback-box/src/core/commands/scan-import-document.ts:69:    trailers: { "Created-By": "scan-import" },
callback-box/src/core/commands/upload-helpers.ts:34: * A scan-import dispatch group. PDFs are always single-file groups; image
callback-box/src/core/commands/upload-helpers.ts:57: * Partition a flat list of input files into scan-import dispatch groups.
callback-box/src/core/commands/scan-import.ts:27: * Internal implementation is split across siblings: `scan-import-session.ts`
callback-box/src/core/commands/scan-import.ts:28: * (layout + input classification), `scan-import-document.ts` (the PDF/document
callback-box/src/core/commands/scan-import.ts:29: * flow), `scan-import-cards.ts` (photo/back/orphan/unsure card emission), and
callback-box/src/core/commands/scan-import.ts:30: * `scan-import-helpers.ts` (Gemini batching + reconciliation).
callback-box/src/core/commands/scan-import.ts:48:} from "./scan-import-helpers.js";
callback-box/src/core/commands/scan-import.ts:54:} from "./scan-import-session.js";
callback-box/src/core/commands/scan-import.ts:55:import { runDocumentMode } from "./scan-import-document.js";
callback-box/src/core/commands/scan-import.ts:60:} from "./scan-import-cards.js";
callback-box/src/core/commands/scan-import.ts:96:      error: "Mixed file types in one scan-import invocation. PDFs run one-per-session; images can be batched together.",
callback-box/src/core/commands/scan-import.ts:104:        error: "scan-import takes a single PDF at a time (use cb upload for batches)",
callback-box/src/core/commands/scan-import.ts:266:    trailers: { "Created-By": "scan-import" },
callback-box/src/core/commands/scan-import.ts:298:  name: "scan-import",
callback-box/src/core/commands/scan-import-gemini.ts:3: * types, and the single-batch model call. The scan-import-helpers module and
callback-box/src/core/commands/scan-import-gemini.ts:5: * leaf module of the scan-import helper graph.
callback-box/src/webapp/routes/commands.ts:18:} from "../../core/commands/index.js";
callback-box/src/core/commands/scan-import-helpers.ts:2: * Helpers for the scan-import command.
callback-box/src/core/commands/scan-import-helpers.ts:6: * The per-image Gemini analysis lives in `scan-import-gemini.ts`; pair
callback-box/src/core/commands/scan-import-helpers.ts:7: * reconciliation and bundling live in `scan-import-reconcile.ts`. Both are
callback-box/src/core/commands/scan-import-helpers.ts:17:} from "./scan-import-gemini.js";
callback-box/src/core/commands/scan-import-helpers.ts:20:export { buildScanPrompt } from "./scan-import-gemini.js";
callback-box/src/core/commands/scan-import-helpers.ts:21:export type { ScanPageAnalysis, BatchUsage } from "./scan-import-gemini.js";
callback-box/src/core/commands/scan-import-helpers.ts:29:} from "./scan-import-reconcile.js";
callback-box/src/cli/commands/ls.ts:9:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/core/commands/upload.ts:7: * record the result. Today the only kind is `scan`, which calls scan-import.
callback-box/src/core/commands/upload.ts:114: * (unless forced), otherwise dispatch to scan-import and record the result.
callback-box/src/core/commands/upload.ts:147:  const result = await runCommand({ name: "scan-import", args: scanArgs, ctx });
callback-box/src/core/commands/scan-import-session.ts:2: * Session layout + input classification for the scan-import command.
callback-box/src/core/commands/scan-import-session.ts:4: * Every scan-import run (photo or document) allocates one capture-session
callback-box/src/cli/commands/procedure.ts:13:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/core/commands/index.ts:17:import "./scan-import.js";
callback-box/src/cli/commands/describe-images.ts:9:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/cli/commands/attachments.ts:15:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/cli/commands/search.ts:15:} from "../../core/commands/index.js";
callback-box/src/cli/commands/trash.ts:9:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/core/commands/scan-import-cards.ts:2: * Card emission for the scan-import photo flow.
callback-box/src/core/commands/scan-import-cards.ts:23:import type { PhotoBundle, OrphanBack, ResolvedPage } from "./scan-import-helpers.js";
callback-box/src/webapp/trpc/routers/actions.ts:4:import { runCommand, type CommandContext } from "../../../core/commands/index.js";
callback-box/src/webapp/trpc/routers/commands.ts:9:} from "../../../core/commands/index.js";
callback-box/src/cli/commands/transcribe-captures.ts:9:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/cli/commands/scan-import.ts:2: * cb scan-import — Import a JPEG batch as photo image cards, or file a PDF
callback-box/src/cli/commands/scan-import.ts:3: * as a document. Thin wrapper around the core scan-import command.
callback-box/src/cli/commands/scan-import.ts:8:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/cli/commands/scan-import.ts:10:export const scanImportCommand = new Command("scan-import")
callback-box/src/cli/commands/scan-import.ts:22:      const result = await runCommand({ name: "scan-import", args, ctx });
callback-box/src/cli/commands/triage.ts:10:import { runCommand, createCliContext } from "../../core/commands/index.js";
callback-box/src/cli/commands/move.ts:9:import { runCommand, createCliContext } from "../../core/commands/index.js";

codex
`scan-import` is worse than a cleanup tail: `emitPhotoBundle` writes a new frontmatter image card and immediately tries to `loader.load()` it as XML, so the photo flow is likely already broken today. The plan flags this as “open question,” but the command is live enough that it should be a required rewrite-or-disable gate, not a discretionary follow-up.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/schemas/image.tsx | sed -n '1,240p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/card-io.ts | sed -n '1,390p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/trpc/routers/status.ts | sed -n '1,190p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	import { z } from "zod";
     2	import * as fs from "node:fs/promises";
     3	import * as path from "node:path";
     4	import { router, publicProcedure } from "../trpc.js";
     5	import { getSystemState } from "../../../core/state.js";
     6	import { generateContext } from "../../context.js";
     7	import { createLoader } from "../../../cli/lib/loader.js";
     8	import { parseCardName } from "../../../cli/lib/paths.js";
     9	import { getLog } from "../../../cli/lib/git.js";
    10	
    11	export interface BrowseDir {
    12	  name: string;
    13	  fileCount: number;
    14	}
    15	
    16	export interface BrowseCard {
    17	  relativePath: string;
    18	  name: string;
    19	  type: string;
    20	  tagName: string;
    21	  status?: string | undefined;
    22	  title?: string | undefined;
    23	  /** True if this card has a `<basename>.attach/` directory (i.e. attachments). */
    24	  hasAttachments?: boolean;
    25	}
    26	
    27	export interface BrowseFile {
    28	  relativePath: string;
    29	  name: string;
    30	}
    31	
    32	export const statusRouter = router({
    33	  status: publicProcedure.query(async ({ ctx }) => {
    34	    const state = await getSystemState(ctx.boxRoot);
    35	    return {
    36	      boxRoot: state.boxRoot,
    37	      boxVersion: state.boxVersion,
    38	      created: state.created,
    39	      git: state.git,
    40	      counts: {
    41	        inbox: state.inbox.length,
    42	        questions: state.questions.length,
    43	        pendingQuestions: state.questions.filter((q) => q.status === "pending").length,
    44	      },
    45	    };
    46	  }),
    47	
    48	  inbox: publicProcedure.query(async ({ ctx }) => {
    49	    const state = await getSystemState(ctx.boxRoot);
    50	    return { items: state.inbox };
    51	  }),
    52	
    53	  questions: publicProcedure.query(async ({ ctx }) => {
    54	    const state = await getSystemState(ctx.boxRoot);
    55	    const context = await generateContext(ctx.boxRoot);
    56	    const enriched = state.questions.map((q) => {
    57	      const pending = context.pendingQuestions.find((p) => p.path === q.relativePath);
    58	      return { ...q, prompt: pending?.prompt, options: pending?.options };
    59	    });
    60	    return { items: enriched };
    61	  }),
    62	
    63	  context: publicProcedure.query(async ({ ctx }) => {
    64	    return generateContext(ctx.boxRoot);
    65	  }),
    66	
    67	  activity: publicProcedure
    68	    .input(z.object({ count: z.number().int().positive().default(10) }))
    69	    .query(async ({ input, ctx }) => {
    70	      const entries = await getLog(ctx.boxRoot, input.count);
    71	      return { entries };
    72	    }),
    73	
    74	  browse: publicProcedure
    75	    .input(z.object({ path: z.string().default("") }))
    76	    .query(async ({ input, ctx }) => {
    77	      const targetDir = input.path
    78	        ? path.join(ctx.boxRoot, input.path)
    79	        : ctx.boxRoot;
    80	
    81	      // Security: ensure we stay within boxRoot
    82	      const resolved = path.resolve(targetDir);
    83	      if (!resolved.startsWith(path.resolve(ctx.boxRoot))) {
    84	        return { path: input.path, dirs: [] as BrowseDir[], cards: [] as BrowseCard[], files: [] as BrowseFile[] };
    85	      }
    86	
    87	      let entries: Array<{ name: string; isDirectory: () => boolean }>;
    88	      try {
    89	        entries = await fs.readdir(resolved, { withFileTypes: true });
    90	      } catch (e) {
    91	        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    92	          console.warn(`browse: cannot read directory ${resolved}, returning empty listing:`, e);
    93	        }
    94	        return { path: input.path, dirs: [] as BrowseDir[], cards: [] as BrowseCard[], files: [] as BrowseFile[] };
    95	      }
    96	
    97	      const dirs: BrowseDir[] = [];
    98	      const cards: BrowseCard[] = [];
    99	      const files: BrowseFile[] = [];
   100	      const loader = await createLoader(ctx.boxRoot);
   101	
   102	      // Build a set of card basenames so we can fold owned `<basename>.attach/`
   103	      // directories into their owning card (cards-as-directories UI).
   104	      const cardBasenames = new Set<string>();
   105	      for (const e of entries) {
   106	        if (e.isDirectory()) continue;
   107	        if (!e.name.endsWith(".card")) continue;
   108	        const parsed = parseCardName(e.name);
   109	        if (parsed) cardBasenames.add(parsed.name);
   110	      }
   111	
   112	      for (const entry of entries) {
   113	        if (entry.name.startsWith(".")) continue;
   114	        if (entry.isDirectory()) {
   115	          // Hide `<basename>.attach/` when an owning card sits next to it.
   116	          // Stray attach dirs (no owner) still show up so they can be cleaned.
   117	          if (entry.name.endsWith(".attach")) {
   118	            const owner = entry.name.slice(0, -".attach".length);
   119	            if (cardBasenames.has(owner)) continue;
   120	          }
   121	          const dirFullPath = path.join(resolved, entry.name);
   122	          let fileCount = 0;
   123	          try {
   124	            const subEntries = await fs.readdir(dirFullPath, { recursive: true });
   125	            fileCount = subEntries.filter((f) => typeof f === "string" && f.endsWith(".card")).length;
   126	          } catch (e) {
   127	            // Can't read subdirectory — leave fileCount at 0 rather than failing the whole listing.
   128	            if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   129	              console.warn(`browse: cannot count cards in ${dirFullPath}:`, e);
   130	            }
   131	          }
   132	          dirs.push({ name: entry.name, fileCount });
   133	          continue;
   134	        }
   135	        const fullPath = path.join(resolved, entry.name);
   136	        const relativePath = path.relative(ctx.boxRoot, fullPath);
   137	
   138	        if (entry.name.endsWith(".card")) {
   139	          const parsed = parseCardName(entry.name);
   140	          if (!parsed) continue;
   141	
   142	          const attachDirName = `${parsed.name}.attach`;
   143	          const hasAttachments = entries.some(
   144	            (e) => e.isDirectory() && e.name === attachDirName,
   145	          );
   146	
   147	          try {
   148	            const card = await loader.load(fullPath);
   149	            cards.push({
   150	              relativePath,
   151	              name: parsed.name,
   152	              type: parsed.type,
   153	              tagName: card.element.tagName,
   154	              status: card.element.attrs["status"],
   155	              title: card.element.attrs["title"],
   156	              hasAttachments,
   157	            });
   158	          } catch (e) {
   159	            // Card failed to load/parse — still list it (as unknown) so the UI shows it.
   160	            console.warn(`browse: cannot load card ${fullPath}:`, e);
   161	            cards.push({ relativePath, name: parsed.name, type: parsed.type, tagName: "unknown", hasAttachments });
   162	          }
   163	          continue;
   164	        }
   165	
   166	        // Non-card file: list it as a generic file
   167	        files.push({ relativePath, name: entry.name });
   168	      }
   169	
   170	      dirs.sort((a, b) => a.name.localeCompare(b.name));
   171	      cards.sort((a, b) => a.name.localeCompare(b.name));
   172	      files.sort((a, b) => a.name.localeCompare(b.name));
   173	      return { path: input.path, dirs, cards, files };
   174	    }),
   175	});

 succeeded in 0ms:
     1	/**
     2	 * Image card schema — photos from capture sessions.
     3	 *
     4	 * Created by the capture connector. Processed by `cb describe-images`
     5	 * (Gemini Flash) to add description, OCR text blocks, subject bbox,
     6	 * rotation, and document metadata.
     7	 *
     8	 * Layout: `photo-001.image.card` next to `photo-001.attach/photo-001.jpg`.
     9	 * `filename.ref:` points into the attach scope via the `attach/` virtual
    10	 * prefix.
    11	 */
    12	
    13	import { stringify as stringifyYaml } from "yaml";
    14	import { z } from "zod";
    15	import { cardSchema, type CardSchema } from "../cards/index.js";
    16	import { type FileLoader, titleFromFilename, truncateTitle } from "../core/file-summary.js";
    17	
    18	export const ImageStatus = z.enum(["new", "analyzed", "invalid"]);
    19	export type ImageStatus = z.infer<typeof ImageStatus>;
    20	
    21	export const ImageSource = z.enum([
    22	  "camera-user",
    23	  "camera-environment",
    24	  "gallery",
    25	  "screenshot",
    26	  "download",
    27	  "scan",
    28	  "generated",
    29	]);
    30	export type ImageSource = z.infer<typeof ImageSource>;
    31	
    32	export const ImageRotation = z.enum(["0", "90", "180", "270"]);
    33	export type ImageRotation = z.infer<typeof ImageRotation>;
    34	
    35	const FilenameEntry = z.object({
    36	  ref: z.string(),
    37	  captured: z.string().datetime({ offset: true }),
    38	  source: ImageSource,
    39	});
    40	
    41	const TextBlock = z.object({
    42	  source: z.string().optional(),
    43	  content: z.string(),
    44	});
    45	
    46	const ExifMeta = z.object({
    47	  date: z.string().datetime({ offset: true }).optional(),
    48	  camera: z.string().optional(),
    49	  gps: z.string().optional(),
    50	  width: z.string().optional(),
    51	  height: z.string().optional(),
    52	});
    53	
    54	const SubjectBbox = z.object({
    55	  y1: z.string(),
    56	  x1: z.string(),
    57	  y2: z.string(),
    58	  x2: z.string(),
    59	});
    60	
    61	const DocumentDate = z.object({
    62	  label: z.string(),
    63	  value: z.string(),
    64	});
    65	
    66	const DocumentMeta = z.object({
    67	  kind: z.string().optional(),
    68	  from: z.string().optional(),
    69	  dates: z.array(DocumentDate).optional(),
    70	});
    71	
    72	export const ImageSchema: CardSchema = cardSchema("image", {
    73	  fields: {
    74	    status: ImageStatus.default("new"),
    75	    "has-text": z.boolean().optional(),
    76	    rotation: ImageRotation.optional(),
    77	    filename: FilenameEntry,
    78	    description: z.string().optional(),
    79	    creation: z.string().optional(),
    80	    text: z.array(TextBlock).optional(),
    81	    exif: ExifMeta.optional(),
    82	    "subject-bbox": SubjectBbox.optional(),
    83	    document: DocumentMeta.optional(),
    84	  },
    85	  instructions: `# Image Cards
    86	
    87	An image card represents a photo, typically from a capture session.
    88	The attached image file lives in the card's attach scope (e.g.
    89	\`photo-001.image.card\` with \`photo-001.attach/photo-001.jpg\`);
    90	\`filename.ref:\` points into that scope via the \`attach/\` prefix.
    91	
    92	Frontmatter fields:
    93	- \`filename:\` — \`{ref, captured, source}\` for the attached image
    94	  file. \`captured\` is set from EXIF when available.
    95	- \`description:\` — one sentence describing what the image *looks
    96	  like* (filled during analysis) — the visual field, used as alt text.
    97	- \`contains:\` — one sentence stating what someone could *learn* from
    98	  this image — the retrieval field (also filled during analysis; when
    99	  absent, search falls back to \`description\`). Carry the fact when
   100	  it's concise ("Boiler serial number K-44210"), don't point at it.
   101	- \`creation:\` — optional free-text notes on how the image came to
   102	  be. Only include when there's something worth recording. For
   103	  AI-generated images (\`source: generated\`), use \`model: {modelId}\\nprompt: {prompt text}\`.
   104	- \`text:\` — array of \`{source?, content}\` entries with transcribed
   105	  text content from the image, if any. \`source\` describes what the
   106	  text is on ("whiteboard", "business card", "printed page",
   107	  "screen").
   108	- \`exif:\` — EXIF metadata extracted from the image file.
   109	- \`subject-bbox:\` — bounding box of the main subject on a 0-1000
   110	  scale (\`{y1, x1, y2, x2}\`). Present when the subject doesn't fill
   111	  the entire frame.
   112	- \`document:\` — present when the image is a photograph of a document
   113	  (bill, letter, form, receipt, statement, …). \`kind\` is a short
   114	  free-text category ("utility bill", "lab results"), \`from\` is the
   115	  issuer/sender, \`dates\` is an array of \`{label, value}\` entries.
   116	  Date values are kept as they appear in the document; normalization
   117	  happens downstream.
   118	- \`has-text\` — true if the image contains readable text, false
   119	  otherwise. Always true when a \`document:\` field is present.
   120	- \`rotation\` — degrees clockwise the image needs to be rotated to
   121	  appear upright: \`"0"\`, \`"90"\`, \`"180"\`, or \`"270"\`.
   122	
   123	Analysis is done by \`cb describe-images\`, which sends images to
   124	Gemini Flash for OCR, description, subject detection, and rotation,
   125	and extracts EXIF metadata. Pass multiple image cards or image files
   126	to process them as a batch (provides better context when images are
   127	related). Use \`--no-rename\` to skip automatic renaming.
   128	
   129	Status: new (unanalyzed) → analyzed (description filled in) → invalid
   130	(accidental capture, too blurry, not useful).`,
   131	});
   132	
   133	export interface ImageFields {
   134	  type: "image";
   135	  status: ImageStatus;
   136	  "has-text"?: boolean;
   137	  rotation?: ImageRotation;
   138	  filename: { ref: string; captured: string; source: ImageSource };
   139	  description?: string;
   140	  contains?: string;
   141	  creation?: string;
   142	  text?: Array<{ source?: string; content: string }>;
   143	  exif?: { date?: string; camera?: string; gps?: string; width?: string; height?: string };
   144	  "subject-bbox"?: { y1: string; x1: string; y2: string; x2: string };
   145	  document?: { kind?: string; from?: string; dates?: Array<{ label: string; value: string }> };
   146	}
   147	
   148	/**
   149	 * Loader summary used by the file viewer: derives a title from
   150	 * description, filename, or path. Falls back gracefully when the file
   151	 * isn't a parsed card yet.
   152	 */
   153	export interface ImageAttrs {
   154	  status: ImageStatus;
   155	  "has-text"?: boolean;
   156	  rotation?: ImageRotation;
   157	  filename?: string;
   158	}
   159	
   160	export const imageLoader: FileLoader<ImageAttrs> = (raw) => {
   161	  const fallback = titleFromFilename(raw.path);
   162	  // For Phase 2 image cards the raw input is the parsed YAML fields object.
   163	  // eslint-disable-next-line no-restricted-syntax -- raw is the loosely-typed loader input; reading the optional Phase-2 `fields` object off it requires one boundary cast.
   164	  const fields = (raw as { fields?: Partial<ImageFields> }).fields;
   165	  if (fields === undefined) {
   166	    return { path: raw.path, tagName: "image", title: fallback, attrs: { status: "new" } };
   167	  }
   168	  const description = fields.description;
   169	  const ref = fields.filename?.ref;
   170	  let title = "";
   171	  if (typeof description === "string" && description.trim() !== "") {
   172	    title = description.trim();
   173	  } else if (typeof ref === "string" && ref !== "") {
   174	    title = titleFromFilename(ref);
   175	  }
   176	  if (title === "") title = fallback;
   177	  title = truncateTitle(title, 80);
   178	  const attrs: ImageAttrs = { status: fields.status ?? "new" };
   179	  if (typeof fields["has-text"] === "boolean") attrs["has-text"] = fields["has-text"];
   180	  if (fields.rotation !== undefined) attrs.rotation = fields.rotation;
   181	  if (typeof ref === "string" && ref !== "") attrs.filename = ref;
   182	  return { path: raw.path, tagName: "image", title, attrs };
   183	};
   184	
   185	/**
   186	 * Build the file content for a new image card. Used by the capture
   187	 * connector when first storing a photo — analysis fields are filled
   188	 * in later by `cb describe-images`.
   189	 */
   190	export function createImageTemplate(options: {
   191	  capturedAt: string;
   192	  source: ImageSource;
   193	  filename: string;
   194	}): string {
   195	  const fields = {
   196	    status: "new",
   197	    filename: {
   198	      ref: `attach/${options.filename}`,
   199	      captured: options.capturedAt,
   200	      source: options.source,
   201	    },
   202	  };
   203	  return `---\n${stringifyYaml(fields)}---\n`;
   204	}

 succeeded in 0ms:
     1	/**
     2	 * Card file IO for the markdown-frontmatter card format (Phase 2).
     3	 *
     4	 * A `.card` file is a frontmatter-prefixed text file:
     5	 *
     6	 *   ---
     7	 *   type: doc
     8	 *   drive-id: 1abc...
     9	 *   title: Project Notes
    10	 *   ...
    11	 *   ---
    12	 *   markdown body, if the schema declares one
    13	 *
    14	 * The host application (this module) owns YAML parsing so cardworks
    15	 * stays YAML-free. cardworks provides the schema declaration primitives
    16	 * (`cardSchema`, `body`) and the frontmatter splitter (`splitCardContent`).
    17	 */
    18	
    19	import { readFile } from "node:fs/promises";
    20	import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
    21	import { parseCard, type ElementSchema, type ElementNode } from "cardworks";
    22	import { splitCardContent, type CardSchema } from "../cards/index.js";
    23	
    24	const CARD_XML_CONTENT_TYPE = "application/x-card+xml";
    25	
    26	/**
    27	 * Errors raised by the card IO layer. Caller code can catch this specifically
    28	 * to distinguish format-level problems from arbitrary IO errors.
    29	 */
    30	export class CardIOError extends Error {
    31	  readonly source: string;
    32	  readonly detail: string;
    33	  constructor(source: string, detail: string) {
    34	    super(`${source}: ${detail}`);
    35	    this.name = "CardIOError";
    36	    this.source = source;
    37	    this.detail = detail;
    38	  }
    39	}
    40	
    41	interface ZodIssueLike {
    42	  path: ReadonlyArray<string | number | symbol>;
    43	  message: string;
    44	  code?: string;
    45	  expected?: string;
    46	  received?: string;
    47	}
    48	
    49	/**
    50	 * Render Zod issues as a compact, one-line-per-issue list:
    51	 *
    52	 *   - status: invalid option (expected "new"|"processing"|"processed")
    53	 *   - boxholder.relationships[0].text: required
    54	 *
    55	 * Replaces the multi-line JSON dump Zod's `.message` produces.
    56	 */
    57	function formatZodIssues(issues: ReadonlyArray<ZodIssueLike>): string {
    58	  return issues
    59	    .map((issue) => {
    60	      const pathStr =
    61	        issue.path.length === 0
    62	          ? "(root)"
    63	          : issue.path
    64	              .map((seg, i) => {
    65	                if (typeof seg === "number") return `[${String(seg)}]`;
    66	                return i === 0 ? String(seg) : `.${String(seg)}`;
    67	              })
    68	              .join("");
    69	      return `  - ${pathStr}: ${shortenIssueMessage(issue)}`;
    70	    })
    71	    .join("\n");
    72	}
    73	
    74	function shortenIssueMessage(issue: ZodIssueLike): string {
    75	  const m = issue.message;
    76	  // Zod's stock "Invalid input: expected <X>, received <Y>" → "expected X, got Y"
    77	  const expectedReceived = m.match(/^Invalid input: expected (.+?), received (.+)$/);
    78	  if (expectedReceived) {
    79	    if (expectedReceived[2] === "undefined") return `required (expected ${expectedReceived[1]})`;
    80	    return `expected ${expectedReceived[1]}, got ${expectedReceived[2]}`;
    81	  }
    82	  return m;
    83	}
    84	
    85	/**
    86	 * A parsed card. `fields` is the validated, typed object — the union of
    87	 * frontmatter fields and (if the schema declares one) the body field, keyed
    88	 * uniformly by field name.
    89	 */
    90	export interface ParsedCard<TFields extends Record<string, unknown> = Record<string, unknown>> {
    91	  schema: CardSchema;
    92	  fields: TFields;
    93	  /** Body text exactly as it appeared in the file (empty string if none). */
    94	  rawBody: string;
    95	  /** Optional content-type from frontmatter; undefined for markdown/empty bodies. */
    96	  contentType: string | undefined;
    97	}
    98	
    99	/**
   100	 * Parse a `.card` file's raw text against a registered schema.
   101	 *
   102	 * The card's type is taken from the filename (`Foo.<type>.card`), not from a
   103	 * `type:` field in the frontmatter — the filename is the canonical
   104	 * discriminator. If the YAML happens to carry a `type:` field, it must
   105	 * either match the filename type or be absent; mismatches are a lint
   106	 * error. Either way, the field is normalized into the parsed fields
   107	 * object (so consumers can still read `fields.type`).
   108	 */
   109	export function parseCardText(
   110	  content: string,
   111	  { source, schemas, type }: { source: string; schemas: Map<string, CardSchema>; type?: string }
   112	): ParsedCard {
   113	  const split = splitCardContent(content);
   114	  if (!split.hasFrontmatter) {
   115	    throw new CardIOError(source, "missing frontmatter block");
   116	  }
   117	
   118	  const fm = parseFrontmatterMapping(split.frontmatterText, source);
   119	
   120	  const resolved = resolveCardType({ fm, source, type });
   121	  const schema = schemas.get(resolved);
   122	  if (schema === undefined) {
   123	    throw new CardIOError(source, `no schema registered for type "${resolved}"`);
   124	  }
   125	
   126	  // cardworks bakes `type: z.literal(...)` into frontmatterSchema, so we
   127	  // inject the resolved type before validation. The on-disk YAML is no
   128	  // longer required to carry it.
   129	  const fmForValidation = { ...fm, type: resolved };
   130	  const fmParse = schema.frontmatterSchema.safeParse(fmForValidation);
   131	  if (!fmParse.success) {
   132	    throw new CardIOError(
   133	      source,
   134	      `invalid ${resolved} frontmatter:\n${formatZodIssues(fmParse.error.issues)}`
   135	    );
   136	  }
   137	  const fmFields = fmParse.data as Record<string, unknown>;
   138	
   139	  const contentType = typeof fm["content-type"] === "string" ? fm["content-type"] : undefined;
   140	
   141	  const bodyValue = validateCardBody({ schema, body: split.body, contentType, resolved, source });
   142	
   143	  const fields: Record<string, unknown> = { ...fmFields };
   144	  if (schema.bodyFieldName !== null) {
   145	    fields[schema.bodyFieldName] = bodyValue;
   146	  }
   147	
   148	  return {
   149	    schema,
   150	    fields,
   151	    rawBody: split.body,
   152	    contentType,
   153	  };
   154	}
   155	
   156	/**
   157	 * Parse the frontmatter YAML block into a plain mapping. An empty block
   158	 * (which YAML parses as `null`) becomes an empty mapping; non-mapping YAML
   159	 * (arrays, scalars) is a format error.
   160	 */
   161	function parseFrontmatterMapping(frontmatterText: string, source: string): Record<string, unknown> {
   162	  let frontmatter: unknown;
   163	  try {
   164	    frontmatter = parseYaml(frontmatterText);
   165	  } catch (e) {
   166	    const err = e as Error;
   167	    throw new CardIOError(source, `invalid YAML frontmatter: ${err.message}`);
   168	  }
   169	  // YAML parses an empty block as `null`; treat that as an empty mapping
   170	  // so cards whose only frontmatter field got stripped still parse.
   171	  if (Array.isArray(frontmatter) || (frontmatter !== null && typeof frontmatter !== "object")) {
   172	    throw new CardIOError(source, "frontmatter must be a YAML mapping");
   173	  }
   174	  return (frontmatter as Record<string, unknown> | null) ?? {};
   175	}
   176	
   177	/**
   178	 * Resolve the card type: caller-supplied wins, otherwise derive from the
   179	 * source filename (Foo.<type>.card), otherwise fall back to any `type:`
   180	 * field in the YAML for callers that haven't been updated yet. A YAML
   181	 * `type:` that contradicts a caller-supplied `type` is a format error.
   182	 */
   183	function resolveCardType(input: {
   184	  fm: Record<string, unknown>;
   185	  source: string;
   186	  type: string | undefined;
   187	}): string {
   188	  const { fm, source, type } = input;
   189	  const yamlType = typeof fm["type"] === "string" ? (fm["type"] as string) : undefined;
   190	  const resolved = type ?? typeFromFilename(source) ?? yamlType;
   191	  if (resolved === undefined) {
   192	    throw new CardIOError(
   193	      source,
   194	      "cannot determine card type — filename must match Foo.<type>.card"
   195	    );
   196	  }
   197	  if (type !== undefined && yamlType !== undefined && yamlType !== type) {
   198	    throw new CardIOError(
   199	      source,
   200	      `frontmatter type "${yamlType}" does not match filename type "${type}"`
   201	    );
   202	  }
   203	  return resolved;
   204	}
   205	
   206	/**
   207	 * Validate the body text against the schema's body field (if any) and
   208	 * return the parsed body value. Schemas without a body field reject any
   209	 * non-whitespace body content. Returns undefined when no body field exists.
   210	 */
   211	function validateCardBody(input: {
   212	  schema: CardSchema;
   213	  body: string;
   214	  contentType: string | undefined;
   215	  resolved: string;
   216	  source: string;
   217	}): unknown {
   218	  const { schema, body, contentType, resolved, source } = input;
   219	  if (schema.bodyField === null || schema.bodyFieldName === null) {
   220	    if (body.trim().length > 0) {
   221	      throw new CardIOError(source, `schema "${resolved}" declares no body, but file has body content`);
   222	    }
   223	    return undefined;
   224	  }
   225	  if (schema.bodyField.kind === "xml" && contentType !== CARD_XML_CONTENT_TYPE) {
   226	    throw new CardIOError(
   227	      source,
   228	      `schema "${resolved}" expects an XML body but content-type is ${contentType === undefined ? "missing" : `"${contentType}"`}`
   229	    );
   230	  }
   231	  const bodyParse = schema.bodyField.schema.safeParse(body);
   232	  if (!bodyParse.success) {
   233	    throw new CardIOError(
   234	      source,
   235	      `invalid ${resolved} body:\n${formatZodIssues(bodyParse.error.issues)}`
   236	    );
   237	  }
   238	  return bodyParse.data;
   239	}
   240	
   241	/**
   242	 * Serialize a parsed card back to its file representation.
   243	 *
   244	 * Splits the input fields object into frontmatter (everything but the body
   245	 * field) + body, sets the appropriate content-type, and emits a fenced YAML
   246	 * block followed by the body text.
   247	 */
   248	export function serializeCardText(input: {
   249	  schema: CardSchema;
   250	  fields: Record<string, unknown>;
   251	}): string {
   252	  const { schema, fields } = input;
   253	  // No `type:` field emitted — the filename is the canonical discriminator.
   254	  const frontmatter: Record<string, unknown> = {};
   255	  let body = "";
   256	  for (const [name, value] of Object.entries(fields)) {
   257	    if (name === "type") continue;
   258	    if (schema.bodyFieldName === name) {
   259	      if (schema.bodyField === null) continue;
   260	      if (schema.bodyField.kind === "markdown") {
   261	        body = typeof value === "string" ? value : String(value);
   262	      } else if (schema.bodyField.kind === "xml") {
   263	        body = typeof value === "string" ? value : String(value);
   264	        frontmatter["content-type"] = CARD_XML_CONTENT_TYPE;
   265	      }
   266	      continue;
   267	    }
   268	    if (value === undefined) continue;
   269	    frontmatter[name] = value;
   270	  }
   271	  const yamlText = stringifyYaml(frontmatter);
   272	  // YAML.stringify ends with \n already
   273	  return `---\n${yamlText}---\n${body}`;
   274	}
   275	
   276	/**
   277	 * A card loaded via the dispatcher. New (CardSchema) and legacy (XML)
   278	 * schemas coexist; callers narrow on `kind` to access the right shape.
   279	 */
   280	export type LoadedCard = FrontmatterLoadedCard | XmlLoadedCard;
   281	
   282	export interface FrontmatterLoadedCard {
   283	  readonly kind: "frontmatter";
   284	  readonly path: string;
   285	  readonly schema: CardSchema;
   286	  readonly fields: Record<string, unknown>;
   287	  readonly contentType: string | undefined;
   288	}
   289	
   290	export interface XmlLoadedCard {
   291	  readonly kind: "xml";
   292	  readonly path: string;
   293	  readonly schema: ElementSchema | undefined;
   294	  readonly element: ElementNode;
   295	}
   296	
   297	export interface LoadCardContext {
   298	  /** Schemas keyed by frontmatter `type:` value. */
   299	  cardSchemas: Map<string, CardSchema>;
   300	  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
   301	  elementSchemas: Map<string, ElementSchema>;
   302	}
   303	
   304	/**
   305	 * Load a `.card` file, dispatching on the file's frontmatter:
   306	 *
   307	 * - If the file has a `---` frontmatter block whose YAML carries a
   308	 *   `type:` field matching a registered CardSchema, it's parsed as the
   309	 *   new markdown-frontmatter format.
   310	 * - Otherwise the body is parsed as XML (legacy format) and the root
   311	 *   tag's ElementSchema (if any) is used for validation.
   312	 */
   313	export async function loadCardFile(
   314	  absPath: string,
   315	  ctx: LoadCardContext
   316	): Promise<LoadedCard> {
   317	  const content = await readFile(absPath, "utf8");
   318	  return loadCardFromText({ content, source: absPath, ctx });
   319	}
   320	
   321	/**
   322	 * In-memory variant of loadCardFile. Useful for tests and for callers
   323	 * that already have the file content in hand.
   324	 */
   325	export function loadCardFromText(input: {
   326	  content: string;
   327	  source: string;
   328	  ctx: LoadCardContext;
   329	}): Promise<LoadedCard> {
   330	  const { content, source, ctx } = input;
   331	  const split = splitCardContent(content);
   332	  if (split.hasFrontmatter) {
   333	    const fileType = typeFromFilename(source);
   334	    if (fileType !== undefined && ctx.cardSchemas.has(fileType)) {
   335	      const parsed = parseCardText(content, { source, schemas: ctx.cardSchemas, type: fileType });
   336	      return Promise.resolve<LoadedCard>({
   337	        kind: "frontmatter",
   338	        path: source,
   339	        schema: parsed.schema,
   340	        fields: parsed.fields,
   341	        contentType: parsed.contentType,
   342	      });
   343	    }
   344	  }
   345	  return loadXmlCard({ content, source, ctx });
   346	}
   347	
   348	/**
   349	 * Extract the card type from a filename matching `Foo.<type>.card`.
   350	 * Job cards use the dotted convention `Foo.<kind>.job.card` (the reactor
   351	 * discovers jobs by that suffix — see reactor/job-discovery.ts) while
   352	 * their schemas are registered under hyphenated names, so e.g.
   353	 * `Foo.intake.job.card` resolves to type `intake-job`.
   354	 * Returns undefined when the source doesn't fit either pattern (e.g.
   355	 * test fixtures with non-card paths).
   356	 */
   357	export function typeFromFilename(source: string): string | undefined {
   358	  const base = source.split("/").pop() ?? source;
   359	  const jobMatch = base.match(/^.+\.([^.]+)\.job\.card$/);
   360	  if (jobMatch) return `${jobMatch[1]}-job`;
   361	  const match = base.match(/^.+\.([^.]+)\.card$/);
   362	  return match ? match[1] : undefined;
   363	}
   364	
   365	async function loadXmlCard(input: {
   366	  content: string;
   367	  source: string;
   368	  ctx: LoadCardContext;
   369	}): Promise<XmlLoadedCard> {
   370	  const { content, source, ctx } = input;
   371	  const element = await parseCard(content, { source });
   372	  const schema = ctx.elementSchemas.get(element.tagName);
   373	  return { kind: "xml", path: source, schema, element };
   374	}
   375	

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/routes/api-browse.ts | sed -n '1,145p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Directory-browse route for the REST API.
     3	 *
     4	 * Split out of `api.ts`. Owns `GET /api/browse/*` — a one-level listing of a
     5	 * box directory that folds `<basename>.attach/` directories into their owning
     6	 * cards and loads each card so the frontend can render status + tag name.
     7	 */
     8	
     9	import type { FastifyInstance } from "fastify";
    10	import * as fs from "node:fs/promises";
    11	import * as path from "node:path";
    12	import { createLoader } from "../../cli/lib/loader.js";
    13	import { parseCardName } from "../../cli/lib/paths.js";
    14	
    15	interface BrowseCard {
    16	  relativePath: string;
    17	  name: string;
    18	  type: string;
    19	  tagName: string;
    20	  status?: string | undefined;
    21	  hasAttachments?: boolean;
    22	}
    23	
    24	interface RegisterApiBrowseRoutesOptions {
    25	  server: FastifyInstance;
    26	  boxRoot: string;
    27	}
    28	
    29	/**
    30	 * Register the `GET /api/browse/*` directory-listing route on the server.
    31	 */
    32	export function registerApiBrowseRoutes(options: RegisterApiBrowseRoutesOptions): void {
    33	  const { server, boxRoot } = options;
    34	
    35	  // GET /api/browse/* - Browse directory contents (one level)
    36	  server.get<{ Params: { "*": string } }>(
    37	    "/api/browse/*",
    38	    async (request) => {
    39	      const reqPath = request.params["*"] || "";
    40	
    41	      // Resolve the target directory
    42	      const targetDir = reqPath ? path.join(boxRoot, reqPath) : boxRoot;
    43	
    44	      // Security: ensure we stay within boxRoot
    45	      const resolved = path.resolve(targetDir);
    46	      if (!resolved.startsWith(path.resolve(boxRoot))) {
    47	        return { path: reqPath, dirs: [], cards: [] };
    48	      }
    49	
    50	      let entries: Array<{ name: string; isDirectory: () => boolean }>;
    51	      try {
    52	        entries = await fs.readdir(resolved, { withFileTypes: true });
    53	      } catch (e) {
    54	        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    55	          console.warn(`Could not read directory, returning empty listing: ${resolved}:`, e);
    56	        }
    57	        return { path: reqPath, dirs: [], cards: [] };
    58	      }
    59	
    60	      const dirs: string[] = [];
    61	      const cards: BrowseCard[] = [];
    62	
    63	      const loader = await createLoader(boxRoot);
    64	
    65	      // Build basename → owning-card lookup so we can fold `<basename>.attach/`
    66	      // directories into their owning cards (rendered as navigable cards, not
    67	      // as standalone directories).
    68	      const cardBasenames = new Set<string>();
    69	      for (const entry of entries) {
    70	        if (entry.isDirectory()) continue;
    71	        if (!entry.name.endsWith(".card")) continue;
    72	        const parsed = parseCardName(entry.name);
    73	        if (parsed) cardBasenames.add(parsed.name);
    74	      }
    75	
    76	      for (const entry of entries) {
    77	        if (entry.name.startsWith(".")) continue;
    78	
    79	        if (entry.isDirectory()) {
    80	          // Hide `<basename>.attach/` when a sibling card owns it. Stray
    81	          // .attach/ directories (no owning card) still surface for triage.
    82	          if (entry.name.endsWith(".attach")) {
    83	            const owner = entry.name.slice(0, -".attach".length);
    84	            if (cardBasenames.has(owner)) continue;
    85	          }
    86	          dirs.push(entry.name);
    87	          continue;
    88	        }
    89	
    90	        if (!entry.name.endsWith(".card")) continue;
    91	
    92	        const parsed = parseCardName(entry.name);
    93	        if (!parsed) continue;
    94	
    95	        const fullPath = path.join(resolved, entry.name);
    96	        const relativePath = path.relative(boxRoot, fullPath);
    97	        const attachDirName = `${parsed.name}.attach`;
    98	        const hasAttachments = entries.some(
    99	          (e) => e.isDirectory() && e.name === attachDirName,
   100	        );
   101	
   102	        try {
   103	          const card = await loader.load(fullPath);
   104	          cards.push({
   105	            relativePath,
   106	            name: parsed.name,
   107	            type: parsed.type,
   108	            tagName: card.element.tagName,
   109	            status: card.element.attrs["status"],
   110	            hasAttachments,
   111	          });
   112	        } catch (e) {
   113	          console.warn(`Could not load card for browse listing, marking unknown: ${relativePath}:`, e);
   114	          cards.push({
   115	            relativePath,
   116	            name: parsed.name,
   117	            type: parsed.type,
   118	            tagName: "unknown",
   119	            hasAttachments,
   120	          });
   121	        }
   122	      }
   123	
   124	      dirs.sort();
   125	      cards.sort((a, b) => a.name.localeCompare(b.name));
   126	
   127	      return { path: reqPath, dirs, cards };
   128	    }
   129	  );
   130	}

codex
The browse/status rewrite disposition is fair: those endpoints are live, but their XML metadata path already degrades cards to `unknown` for frontmatter because `loader.load` cannot parse them. So they are not safe to delete; they need a frontmatter metadata reader as the plan says.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/preactions/index.ts | sed -n '1,160p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/preactions/types.ts | sed -n '1,90p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	import type { Card, ICardLoader } from "cardworks";
     2	import type { CardSchema } from "../../cards/index.js";
     3	
     4	/**
     5	 * Context for a pre-action invocation. Exactly one of `xml` or
     6	 * `frontmatter` is present, depending on whether the card was loaded
     7	 * via cardworks's XML loader (Phase 1) or via the frontmatter card-io
     8	 * dispatcher (Phase 2).
     9	 */
    10	export type PreActionContext = PreActionContextBase &
    11	  ({ xml: { card: Card } } | { frontmatter: PreActionFrontmatter });
    12	
    13	export interface PreActionFrontmatter {
    14	  schema: CardSchema;
    15	  fields: Record<string, unknown>;
    16	}
    17	
    18	interface PreActionContextBase {
    19	  boxRoot: string;
    20	  loader: ICardLoader;
    21	  cardPath: string;
    22	  cardType: string;
    23	}
    24	
    25	export interface PreActionResult {
    26	  modified: boolean;
    27	  message?: string;
    28	  error?: string;
    29	}
    30	
    31	export interface PreAction {
    32	  /** Unique name for this pre-action */
    33	  name: string;
    34	
    35	  /** Card types this pre-action applies to */
    36	  appliesTo: string[];
    37	
    38	  /**
    39	   * Check if this pre-action needs to run for the given card.
    40	   * Return true if the pre-action should run.
    41	   */
    42	  shouldRun(context: PreActionContext): Promise<boolean>;
    43	
    44	  /**
    45	   * Execute the pre-action. Implementations branch on
    46	   * `"xml" in context` vs `"frontmatter" in context` to mutate the
    47	   * right shape. The runner persists the result.
    48	   */
    49	  execute(context: PreActionContext): Promise<PreActionResult>;
    50	}

 succeeded in 0ms:
     1	/**
     2	 * Pre-action registry.
     3	 *
     4	 * Pre-actions run during sync to prepare inbox items before
     5	 * they're processed by agents. Examples:
     6	 * - Transcribe voice memos
     7	 * - Extract text from images (OCR)
     8	 * - Parse email attachments
     9	 *
    10	 * Pre-actions work against both shapes of card:
    11	 * - Phase 1 XML-bodied cards (loaded via cardworks ICardLoader)
    12	 * - Phase 2 frontmatter cards (loaded via card-io)
    13	 *
    14	 * The runner dispatches based on what `loadCardFile` returns; the
    15	 * pre-action's `execute()` branches on `"xml" in ctx` vs
    16	 * `"frontmatter" in ctx`.
    17	 */
    18	
    19	import { writeFile } from "node:fs/promises";
    20	import { stringify as stringifyYaml } from "yaml";
    21	import type { ICardLoader } from "cardworks";
    22	import type { PreAction, PreActionContext, PreActionResult } from "./types.js";
    23	import { loadCardFile } from "../card-io.js";
    24	import { buildLoadContext } from "../load-context.js";
    25	
    26	import { transcribePreAction } from "./transcribe.js";
    27	
    28	export type { PreAction, PreActionContext, PreActionResult } from "./types.js";
    29	
    30	const registry: PreAction[] = [];
    31	
    32	export function registerPreAction(action: PreAction): void {
    33	  registry.push(action);
    34	}
    35	
    36	export function getPreActions(): PreAction[] {
    37	  return [...registry];
    38	}
    39	
    40	export function getPreActionsForType(cardType: string): PreAction[] {
    41	  return registry.filter((a) => a.appliesTo.includes(cardType));
    42	}
    43	
    44	/**
    45	 * Run all applicable pre-actions for a card. Returns one result per
    46	 * action that ran (skipping ones that decline via `shouldRun`).
    47	 */
    48	export async function runPreActions(input: {
    49	  boxRoot: string;
    50	  loader: ICardLoader;
    51	  cardPath: string;
    52	}): Promise<Array<{ name: string; result: PreActionResult }>> {
    53	  const { boxRoot, loader, cardPath } = input;
    54	  const ctx = await buildContext({ boxRoot, loader, cardPath });
    55	  if (ctx === null) return [];
    56	
    57	  const applicable = getPreActionsForType(ctx.cardType);
    58	  const results: Array<{ name: string; result: PreActionResult }> = [];
    59	
    60	  for (const action of applicable) {
    61	    try {
    62	      if (await action.shouldRun(ctx)) {
    63	        console.log(`  Running pre-action: ${action.name}`);
    64	        const result = await action.execute(ctx);
    65	        results.push({ name: action.name, result });
    66	
    67	        if (result.modified) {
    68	          await persistContext(ctx);
    69	        }
    70	
    71	        if (result.error !== undefined && result.error !== "") {
    72	          console.log(`    Error: ${result.error}`);
    73	        } else if (result.message !== undefined && result.message !== "") {
    74	          console.log(`    ${result.message}`);
    75	        }
    76	      }
    77	    } catch (error) {
    78	      console.error(`  Pre-action ${action.name} failed:`, error);
    79	      results.push({
    80	        name: action.name,
    81	        result: { modified: false, error: (error as Error).message },
    82	      });
    83	    }
    84	  }
    85	
    86	  return results;
    87	}
    88	
    89	async function buildContext(input: {
    90	  boxRoot: string;
    91	  loader: ICardLoader;
    92	  cardPath: string;
    93	}): Promise<PreActionContext | null> {
    94	  const { boxRoot, loader, cardPath } = input;
    95	
    96	  // Try frontmatter (Phase 2) first; if the file isn't a CardSchema card
    97	  // it will fall through to the XML path on its own.
    98	  try {
    99	    const loaded = await loadCardFile(cardPath, await buildLoadContext(boxRoot));
   100	    if (loaded.kind === "frontmatter") {
   101	      return {
   102	        boxRoot,
   103	        loader,
   104	        cardPath,
   105	        cardType: loaded.schema.type,
   106	        frontmatter: { schema: loaded.schema, fields: loaded.fields },
   107	      };
   108	    }
   109	    // XML branch
   110	    return {
   111	      boxRoot,
   112	      loader,
   113	      cardPath,
   114	      cardType: loaded.element.tagName,
   115	      xml: { card: await loader.load(cardPath) },
   116	    };
   117	  } catch (e) {
   118	    // Couldn't load as a known card — skip pre-actions for this file.
   119	    console.warn(`Could not load card for pre-actions: ${cardPath}:`, e);
   120	    return null;
   121	  }
   122	}
   123	
   124	async function persistContext(ctx: PreActionContext): Promise<void> {
   125	  if ("xml" in ctx) {
   126	    await ctx.loader.save(ctx.xml.card);
   127	    return;
   128	  }
   129	  // Frontmatter path: rewrite the file with the (possibly mutated) fields.
   130	  await writeFile(ctx.cardPath, `---\n${stringifyYaml(ctx.frontmatter.fields)}---\n`);
   131	}
   132	
   133	registerPreAction(transcribePreAction);

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/preactions/transcribe.ts | sed -n '1,250p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Transcribe voice content pre-action.
     3	 *
     4	 * Looks for cards with audio attachments and transcribes them via OpenAI
     5	 * Whisper. Works on memo (Phase 2 frontmatter) and feedback (still
     6	 * XML); the audio attachment lives as a sibling file sharing the card's
     7	 * basename.
     8	 *
     9	 * `audio` was historically handled here too; that path is dead now —
    10	 * capture-session audio is transcribed by `cb transcribe-captures`
    11	 * which uses the per-audio-card attach scope.
    12	 */
    13	
    14	import * as fs from "node:fs/promises";
    15	import * as path from "node:path";
    16	import type { PreAction, PreActionContext } from "./types.js";
    17	import { transcribeAudio, type TranscriptionError } from "../transcription.js";
    18	import type { ElementNode } from "cardworks";
    19	
    20	/** Audio file extensions we can transcribe. */
    21	const AUDIO_EXTENSIONS = [".webm", ".mp3", ".m4a", ".wav", ".ogg", ".flac"];
    22	
    23	interface TranscriptionFields {
    24	  language: string;
    25	  "transcribed-at": string;
    26	  text: string;
    27	}
    28	
    29	interface TranscriptionErrorFields {
    30	  permanent: boolean;
    31	  code?: string;
    32	  "attempted-at": string;
    33	  message: string;
    34	}
    35	
    36	export const transcribePreAction: PreAction = {
    37	  name: "transcribe-voice",
    38	  appliesTo: ["memo", "feedback"],
    39	
    40	  async shouldRun(ctx: PreActionContext): Promise<boolean> {
    41	    const audioFile = await findAudioAttachment(ctx.cardPath);
    42	    if (audioFile === null) return false;
    43	    if ("frontmatter" in ctx) {
    44	      const fields = ctx.frontmatter.fields;
    45	      if (fields["transcription"] !== undefined) return false;
    46	      if (isPermanentError(fields["transcription-error"])) return false;
    47	      return true;
    48	    }
    49	    const element = ctx.xml.card.element;
    50	    if (hasXmlTranscription(element)) return false;
    51	    if (hasXmlPermanentError(element)) return false;
    52	    return true;
    53	  },
    54	
    55	  async execute(ctx: PreActionContext) {
    56	    const audioFile = await findAudioAttachment(ctx.cardPath);
    57	    if (audioFile === null) {
    58	      return { modified: false, error: "No audio attachment found" };
    59	    }
    60	
    61	    try {
    62	      const audioBuffer = await fs.readFile(audioFile);
    63	      const filename = path.basename(audioFile);
    64	      const existingContent = "frontmatter" in ctx
    65	        ? getFrontmatterContent(ctx.frontmatter.fields)
    66	        : getXmlContent(ctx.xml.card.element);
    67	      const result = await transcribeAudio({
    68	        audioBuffer,
    69	        filename,
    70	        ...(existingContent !== null && { prompt: existingContent }),
    71	        boxRoot: ctx.boxRoot,
    72	      });
    73	
    74	      if ("frontmatter" in ctx) {
    75	        applyFrontmatterTranscription({ fields: ctx.frontmatter.fields, text: result.text, language: result.language });
    76	      } else {
    77	        applyXmlTranscription({ element: ctx.xml.card.element, text: result.text, language: result.language });
    78	      }
    79	
    80	      return {
    81	        modified: true,
    82	        message: `Transcribed ${String(Math.round(result.duration))}s of audio`,
    83	      };
    84	    } catch (error) {
    85	      const transcriptionError = error as TranscriptionError;
    86	      const attemptedAt = new Date().toISOString();
    87	      if ("frontmatter" in ctx) {
    88	        applyFrontmatterError(ctx.frontmatter.fields, {
    89	          permanent: transcriptionError.permanent,
    90	          ...(transcriptionError.code !== undefined && { code: transcriptionError.code }),
    91	          "attempted-at": attemptedAt,
    92	          message: transcriptionError.message,
    93	        });
    94	      } else {
    95	        applyXmlError(ctx.xml.card.element, {
    96	          permanent: transcriptionError.permanent,
    97	          ...(transcriptionError.code !== undefined && { code: transcriptionError.code }),
    98	          attemptedAt,
    99	          message: transcriptionError.message,
   100	        });
   101	      }
   102	      return { modified: true, error: transcriptionError.message };
   103	    }
   104	  },
   105	};
   106	
   107	// ─── Audio attachment discovery ─────────────────────────────────────────────
   108	
   109	async function findAudioAttachment(cardPath: string): Promise<string | null> {
   110	  const dir = path.dirname(cardPath);
   111	  const basename = path.basename(cardPath, ".card");
   112	  const nameParts = basename.split(".");
   113	  const name = nameParts.slice(0, -1).join(".") || basename;
   114	  for (const ext of AUDIO_EXTENSIONS) {
   115	    const audioPath = path.join(dir, name + ext);
   116	    try {
   117	      await fs.access(audioPath);
   118	      return audioPath;
   119	    } catch (_e) {
   120	      // access() throwing just means this extension isn't present — try the next.
   121	    }
   122	  }
   123	  return null;
   124	}
   125	
   126	// ─── Frontmatter (Phase 2) helpers ──────────────────────────────────────────
   127	
   128	function isPermanentError(raw: unknown): boolean {
   129	  if (raw === null || typeof raw !== "object") return false;
   130	  const e = raw as Record<string, unknown>;
   131	  return e["permanent"] === true;
   132	}
   133	
   134	function getFrontmatterContent(fields: Record<string, unknown>): string | null {
   135	  if (typeof fields["body"] === "string" && fields["body"].trim() !== "") {
   136	    return fields["body"];
   137	  }
   138	  return null;
   139	}
   140	
   141	function applyFrontmatterTranscription(input: {
   142	  fields: Record<string, unknown>;
   143	  text: string;
   144	  language: string;
   145	}): void {
   146	  const { fields, text, language } = input;
   147	  delete fields["transcription-error"];
   148	  const entry: TranscriptionFields = {
   149	    language,
   150	    "transcribed-at": new Date().toISOString(),
   151	    text,
   152	  };
   153	  fields["transcription"] = entry;
   154	}
   155	
   156	function applyFrontmatterError(
   157	  fields: Record<string, unknown>,
   158	  err: TranscriptionErrorFields,
   159	): void {
   160	  fields["transcription-error"] = err;
   161	}
   162	
   163	// ─── XML (Phase 1) helpers ──────────────────────────────────────────────────
   164	
   165	function hasXmlTranscription(element: ElementNode): boolean {
   166	  const children = element.children;
   167	  return children.some((c) => c.tagName === "transcription");
   168	}
   169	
   170	function hasXmlPermanentError(element: ElementNode): boolean {
   171	  const errEl = element.children.find((c) => c.tagName === "transcription-error");
   172	  return errEl !== undefined && errEl.attrs["permanent"] === "true";
   173	}
   174	
   175	function getXmlContent(element: ElementNode): string | null {
   176	  const contentEl = element.children.find((c) => c.tagName === "content");
   177	  return contentEl?.text === undefined || contentEl.text === "" ? null : contentEl.text;
   178	}
   179	
   180	function applyXmlTranscription(input: {
   181	  element: ElementNode;
   182	  text: string;
   183	  language: string;
   184	}): void {
   185	  const { element, text, language } = input;
   186	  const children = element.children;
   187	  const errorIndex = children.findIndex((c) => c.tagName === "transcription-error");
   188	  if (errorIndex !== -1) {
   189	    children.splice(errorIndex, 1);
   190	  }
   191	  children.push({
   192	    tagName: "transcription",
   193	    attrs: { language, "transcribed-at": new Date().toISOString() },
   194	    children: [],
   195	    text,
   196	    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
   197	    comments: {},
   198	    dirty: true,
   199	  });
   200	  element.dirty = true;
   201	}
   202	
   203	function applyXmlError(
   204	  element: ElementNode,
   205	  err: { permanent: boolean; code?: string; attemptedAt: string; message: string },
   206	): void {
   207	  const children = element.children;
   208	  const errorIndex = children.findIndex((c) => c.tagName === "transcription-error");
   209	  if (errorIndex !== -1) {
   210	    children.splice(errorIndex, 1);
   211	  }
   212	  const attrs: Record<string, string> = {
   213	    permanent: err.permanent ? "true" : "false",
   214	    code: err.code ?? "unknown",
   215	    "attempted-at": err.attemptedAt,
   216	  };
   217	  children.push({
   218	    tagName: "transcription-error",
   219	    attrs,
   220	    children: [],
   221	    text: err.message,
   222	    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
   223	    comments: {},
   224	    dirty: true,
   225	  });
   226	  element.dirty = true;
   227	}

exec
/opt/homebrew/bin/bash -lc "rg -n \"preactions|runPreactions|buildPreactionContext|transcribeCapture|xml in ctx|ctx\\.xml|ctx\\.frontmatter\" callback-box/src callback-box/test -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/cli/index.ts:25:  transcribeCapturesCommand,
callback-box/src/cli/index.ts:83:program.addCommand(transcribeCapturesCommand);
callback-box/src/cli/commands/index.ts:18:export { transcribeCapturesCommand } from "./transcribe-captures.js";
callback-box/src/cli/commands/wakeup-steps.ts:14:import { runPreActions } from "../../core/preactions/index.js";
callback-box/src/cli/commands/transcribe-captures.ts:11:export const transcribeCapturesCommand = new Command("transcribe-captures")
callback-box/src/core/preactions/index.ts:126:    await ctx.loader.save(ctx.xml.card);
callback-box/src/core/preactions/index.ts:130:  await writeFile(ctx.cardPath, `---\n${stringifyYaml(ctx.frontmatter.fields)}---\n`);
callback-box/src/core/preactions/transcribe.ts:44:      const fields = ctx.frontmatter.fields;
callback-box/src/core/preactions/transcribe.ts:49:    const element = ctx.xml.card.element;
callback-box/src/core/preactions/transcribe.ts:65:        ? getFrontmatterContent(ctx.frontmatter.fields)
callback-box/src/core/preactions/transcribe.ts:66:        : getXmlContent(ctx.xml.card.element);
callback-box/src/core/preactions/transcribe.ts:75:        applyFrontmatterTranscription({ fields: ctx.frontmatter.fields, text: result.text, language: result.language });
callback-box/src/core/preactions/transcribe.ts:77:        applyXmlTranscription({ element: ctx.xml.card.element, text: result.text, language: result.language });
callback-box/src/core/preactions/transcribe.ts:88:        applyFrontmatterError(ctx.frontmatter.fields, {
callback-box/src/core/preactions/transcribe.ts:95:        applyXmlError(ctx.xml.card.element, {

codex
The preaction XML branch is removable if all cards are frontmatter, but while touching that file there is an existing frontmatter persistence trap: `persistContext` writes the whole parsed `fields` object as YAML and drops the body layout. It may not be caused by cardworks deletion, but this is exactly the kind of adjacent data-integrity bug that can hide under “only XML branch removed.”
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/agent-guide/index.ts | sed -n '1,115p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/agent-guide/cards.ts | sed -n '1,80p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Card creation and inquiry: type catalogue, the cb create flow, and asking
     3	 * the user via question cards.
     4	 */
     5	
     6	import type { ElementSchema } from "cardworks";
     7	import { getAllTemplates } from "../../schemas/templates.js";
     8	
     9	export function cardTypesSection(allSchemas: ElementSchema[]): string[] {
    10	  const lines: string[] = [
    11	    "## Card Types",
    12	    "",
    13	  ];
    14	  for (const schema of allSchemas) {
    15	    const hasDoc = schema.instructions ? ` — see \`docs/generated/card-${schema.tagName}.md\`` : "";
    16	    lines.push(`- **${schema.tagName}**${hasDoc}`);
    17	  }
    18	  lines.push("");
    19	  lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
    20	  lines.push("");
    21	  return lines;
    22	}
    23	
    24	export function creatingCardsSection(): string[] {
    25	  const templates = getAllTemplates();
    26	  const lines: string[] = [
    27	    "## Creating Cards",
    28	    "",
    29	    "Prefer `cb create` with templates over writing XML directly:",
    30	    "",
    31	  ];
    32	  for (const t of templates) {
    33	    lines.push(`- \`cb create <path> -t ${t.name}\` — ${t.description}`);
    34	  }
    35	  lines.push("");
    36	  lines.push("For array arguments (like question options), repeat the key: `options=\"Red\" options=\"Blue\"` or use JSON: `options='[\"Red\",\"Blue\"]'`");
    37	  lines.push("");
    38	  lines.push("**Two-step pattern:** For complex cards, create a minimal card first with `cb create`, then edit it to fill in details. This is often easier than getting all arguments right in one command. Example: `cb create box/questions/Q.question.card -t question-text memo=\"...\" prompt=\"...\"` then edit to add a `<directive>`.");
    39	  lines.push("");
    40	  lines.push("Always run `cb validate <path>` after creating or editing a card.");
    41	  lines.push("");
    42	  return lines;
    43	}
    44	
    45	export function questionsSection(): string[] {
    46	  return [
    47	    "## Questions",
    48	    "",
    49	    "Create question cards in `box/questions/` to ask the user.",
    50	    "Set `answered-by` to your agent name so the answer routes back to you.",
    51	    "Always include a `<directive>` element describing what you'll do with the answer — when the user answers, the system creates a follow-up job using this directive.",
    52	    "See `docs/generated/card-question.md` for templates.",
    53	    "",
    54	  ];
    55	}

 succeeded in 0ms:
     1	/**
     2	 * Compose the compact agent guide (`.callback-box/agent-guide.md`,
     3	 * always loaded into context via @-include).
     4	 *
     5	 * Each section is a small file in this directory; the orchestrator below just
     6	 * concatenates them in the order they appear in the rendered guide. Adding or
     7	 * editing prose: pick the right section file. Adding a section: write a new
     8	 * file and slot it into the array below.
     9	 */
    10	
    11	import type { ElementSchema } from "cardworks";
    12	import { schemas } from "../../schemas/registry.js";
    13	import type { ProcedureSummary, GuideSummary } from "../generate-docs.js";
    14	
    15	import { directoryLayoutSection, howItemsEnterSection } from "./box-shape.js";
    16	import { keyCommandsSection } from "./commands.js";
    17	import { calendarSection } from "./calendar.js";
    18	import { driveSection } from "./drive.js";
    19	import {
    20	  proceduresSection,
    21	  guidesSection,
    22	  schedulesSection,
    23	  tricksSection,
    24	} from "./extensibility.js";
    25	import {
    26	  externalToolsSection,
    27	  chatAttachmentsSection,
    28	  selectionsSection,
    29	  viewsSection,
    30	} from "./chat.js";
    31	import {
    32	  cardTypesSection,
    33	  creatingCardsSection,
    34	  questionsSection,
    35	} from "./cards.js";
    36	import {
    37	  generalPrinciplesSection,
    38	  gitHistorySection,
    39	  whereToRecordSection,
    40	} from "./behavior.js";
    41	import { landmarksSection } from "./landmarks.js";
    42	import { secretsSection } from "./secrets.js";
    43	import { quotesSection } from "./quotes.js";
    44	import { sourceSection } from "./source.js";
    45	import { searchSection } from "./search.js";
    46	import { briefingTagsSection } from "./briefing-tags.js";
    47	
    48	export interface AgentGuideOptions {
    49	  procedures: ProcedureSummary[];
    50	  allSchemas?: ElementSchema[];
    51	  personalitySection?: string | undefined;
    52	  guides?: GuideSummary[];
    53	}
    54	
    55	export function generateAgentGuide(options: AgentGuideOptions): string {
    56	  const {
    57	    procedures,
    58	    allSchemas = schemas,
    59	    personalitySection,
    60	    guides = [],
    61	  } = options;
    62	
    63	  const lines: string[] = [
    64	    "# Callback Box Agent Guide",
    65	    "",
    66	    ...directoryLayoutSection(),
    67	    ...landmarksSection(),
    68	    ...howItemsEnterSection(),
    69	    ...keyCommandsSection(),
    70	    ...searchSection(),
    71	    ...calendarSection(),
    72	    ...driveSection(),
    73	    ...proceduresSection(procedures),
    74	    ...guidesSection(guides),
    75	    ...schedulesSection(),
    76	    ...tricksSection(),
    77	    ...secretsSection(),
    78	    ...externalToolsSection(),
    79	    ...chatAttachmentsSection(),
    80	    ...selectionsSection(),
    81	    ...viewsSection(),
    82	    ...cardTypesSection(allSchemas),
    83	    ...creatingCardsSection(),
    84	    ...questionsSection(),
    85	    ...quotesSection(),
    86	    ...sourceSection(),
    87	    ...briefingTagsSection(),
    88	    ...generalPrinciplesSection(),
    89	    ...gitHistorySection(),
    90	    ...whereToRecordSection(),
    91	  ];
    92	
    93	  if (personalitySection) {
    94	    lines.push(personalitySection);
    95	  }
    96	
    97	  return lines.join("\n");
    98	}

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/init-rules.ts | sed -n '70,115p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    70	  try {
    71	    const existing = await readdir(rulesDir);
    72	    for (const file of existing) {
    73	      if (
    74	        (file.startsWith("card-") || file.startsWith("connector-")) &&
    75	        file.endsWith(".md")
    76	      ) {
    77	        await unlink(join(rulesDir, file));
    78	      }
    79	    }
    80	  } catch (e) {
    81	    // Directory may not exist yet, that's fine — nothing to clean up.
    82	    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    83	      console.debug("Skipping old-rule cleanup (rules dir not readable):", e);
    84	    }
    85	  }
    86	
    87	  const generated: string[] = [];
    88	
    89	  // Load box-local schemas alongside built-in ones. Card rules cover
    90	  // both legacy XML schemas (ElementSchema with `tagName`) and phase-2
    91	  // frontmatter schemas (CardSchema with `type`); each gets a
    92	  // path-conditional rule keyed off its filename glob so the agent
    93	  // loads the right instructions when it reads or edits a matching
    94	  // `.<type>.card` file.
    95	  const boxSchemas = await loadBoxSchemas(boxRoot);
    96	  const cardRuleSources: Array<{ name: string; instructions: string | undefined }> = [
    97	    ...schemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
    98	    ...boxSchemas.elementSchemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
    99	    ...cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
   100	    ...boxSchemas.cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
   101	  ];
   102	
   103	  for (const { name, instructions } of cardRuleSources) {
   104	    if (instructions === undefined) continue;
   105	
   106	    const glob = `**/*.${name}.card`;
   107	    const filename = `card-${name}.md`;
   108	    const content = `---
   109	paths:
   110	  - "${glob}"
   111	---
   112	
   113	${instructions.trim()}
   114	`;
   115	

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/generate-docs.ts | sed -n '400,435p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
   400	    return; // Nothing changed — skip regeneration
   401	  }
   402	
   403	  // Sync templates from upstream callback-box source. Idempotent — only
   404	  // writes files where the box's copy differs (and emits .orig-*.card
   405	  // entries when the user modified a template). Runs before doc generation
   406	  // so newly-installed procedures are picked up by scanProcedures().
   407	  await syncTemplatesFromSource(boxRoot);
   408	
   409	  const debug = options.docIdDebug ?? await hasDocIdMarker(boxRoot);
   410	
   411	  await mkdir(join(boxRoot, AGENT_GUIDE_DIR), { recursive: true });
   412	  await mkdir(join(boxRoot, DOCS_DIR), { recursive: true });
   413	
   414	  const procedures = await scanProcedures(boxRoot);
   415	
   416	  // Load box-local schemas alongside built-in ones. Both formats are
   417	  // box-aware: legacy XML element schemas join allSchemas, phase-2
   418	  // frontmatter card schemas join allCardSchemas.
   419	  const boxSchemas = await loadBoxSchemas(boxRoot);
   420	  const allSchemas = [...schemas, ...boxSchemas.elementSchemas];
   421	  const allCardSchemas = [...cardSchemas, ...boxSchemas.cardSchemas];
   422	
   423	  // Compile personality first so we can include it in the agent guide
   424	  const personalitySection = await compilePersonalities(boxRoot, debug);
   425	
   426	  await writeStaticDocs({ boxRoot, debug, procedures, allSchemas, allCardSchemas, personalitySection });
   427	
   428	  // Compile guides and generate job-type rules
   429	  const guides = await compileGuides(boxRoot, debug);
   430	
   431	  // Rewrite agent guide now that we have guide summaries
   432	  await writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
   433	    withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allSchemas, personalitySection, guides }), debug }));
   434	
   435	  // Compile briefing cards to .md files

codex
The `agent-guide` type repoint is not just type churn. Today `generateAgentGuide` defaults to the empty XML `schemas` array, and `generate-docs.ts` computes `allCardSchemas` but passes only `allSchemas` into the guide. If the rewrite only changes the local type without changing that call, the generated Card Types section stays empty.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/test/search-extract.doctest.md | sed -n '1,230p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/search/extract.ts | sed -n '1,340p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	# search/extract: card → search documents
     2	
     3	Pure extraction: a loaded card becomes one search document, plus per-section
     4	documents when the body is long. Per-kind frontmatter folds into searchable
     5	text; email body files are deliberately never read (untrusted content stays
     6	out of the index — see `src/schemas/email-message.tsx`).
     7	
     8	```ts setup
     9	import { loadCardFromText, type LoadCardContext } from "../src/core/card-io.js";
    10	import {
    11	  declareInputFiles,
    12	  extractCardDocs,
    13	  SECTION_SPLIT_THRESHOLD,
    14	} from "../src/core/search/extract.js";
    15	import { splitMarkdownSections } from "../src/core/search/markdown-sections.js";
    16	import { schemas, createCardSchemaMap } from "../src/schemas/registry.js";
    17	import type { ElementSchema } from "cardworks";
    18	
    19	const ctx: LoadCardContext = {
    20	  cardSchemas: await createCardSchemaMap(),
    21	  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
    22	};
    23	
    24	async function docsFor(path: string, text: string, inputContents?: Map<string, string>) {
    25	  const card = await loadCardFromText({ content: text, source: path, ctx });
    26	  const input = { path, card, contentHash: "hash0" };
    27	  return extractCardDocs(inputContents ? { ...input, inputContents } : input);
    28	}
    29	```
    30	
    31	## A memo becomes one document titled from its body
    32	
    33	```
    34	const docs = await docsFor(
    35	  "box/inbox/Voice_Note.memo.card",
    36	  "---\ncreated: 2026-05-22T10:00:00Z\ncontains: Dentist moved to June 17; confirmation in this email.\n---\nThe dentist called — appointment moved to June 17.\n"
    37	);
    38	docs.length
    39	=> 1
    40	
    41	docs[0].id
    42	=> box/inbox/Voice_Note.memo.card#
    43	
    44	docs[0].kind
    45	=> memo
    46	
    47	docs[0].title
    48	=> The dentist called — appointment moved to June 17.
    49	
    50	docs[0].contains
    51	=> Dentist moved to June 17; confirmation in this email.
    52	
    53	docs[0].created
    54	=> 2026-05-22T10:00:00Z
    55	
    56	docs[0].content
    57	=> The dentist called — appointment moved to June 17.
    58	```
    59	
    60	## Email messages fold headers and snippet, never the body file
    61	
    62	```
    63	const docs = await docsFor(
    64	  "box/inbox/email/t.attach/msg-001.email-message.card",
    65	  "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: alice@example.com\nto: bob@example.com\ndate: 2026-05-14T19:00:00Z\nsubject: Weekend plans\nsnippet: Hey, are you free Saturday...\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n"
    66	);
    67	docs[0].title
    68	=> Weekend plans
    69	
    70	docs[0].content
    71	=> Weekend plans
    72	alice@example.com
    73	bob@example.com
    74	Hey, are you free Saturday...
    75	
    76	JSON.stringify(declareInputFiles({ path: "box/inbox/email/t.attach/msg-001.email-message.card", card: await loadCardFromText({ content: "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: a@x.com\ndate: 2026-05-14T19:00:00Z\nsubject: s\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n", source: "box/inbox/email/t.attach/msg-001.email-message.card", ctx }) }))
    77	=> []
    78	```
    79	
    80	## Email threads fold subject, participants, labels, and date-range
    81	
    82	```
    83	const docs = await docsFor(
    84	  "box/inbox/email/thread-x.email-thread.card",
    85	  "---\nthread-id: t1\nsubject: Usage-based pricing demo\nparticipants:\n  - hello@metricly.example\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nlabels:\n  - promotions\nmessages:\n  - ref: attach/msg-001.email-message.card\n---\n"
    86	);
    87	docs[0].title
    88	=> Usage-based pricing demo
    89	
    90	docs[0].created
    91	=> 2026-05-14T19:00:00Z
    92	
    93	docs[0].content
    94	=> Usage-based pricing demo
    95	hello@metricly.example
    96	promotions
    97	```
    98	
    99	## Gdocs declare their content snapshot and index it as the body
   100	
   101	```
   102	const cardText = "---\ndrive-id: d1\ntitle: Project Notes\nmodified: 2026-05-01\nlink: https://docs.google.com/document/d/d1/edit\nowner: owner@example.com\ncontent:\n  ref: attach/Project_Notes.md\n---\n";
   103	const path = "store/drive/Project_Notes.gdoc.card";
   104	const card = await loadCardFromText({ content: cardText, source: path, ctx });
   105	JSON.stringify(declareInputFiles({ path, card }))
   106	=> ["store/drive/Project_Notes.attach/Project_Notes.md"]
   107	
   108	const inputContents = new Map([["store/drive/Project_Notes.attach/Project_Notes.md", "Quarterly planning notes for the project."]]);
   109	const docs = extractCardDocs({ path, card, contentHash: "h1", inputContents });
   110	docs[0].title
   111	=> Project Notes
   112	
   113	docs[0].content
   114	=> Quarterly planning notes for the project.
   115	```
   116	
   117	## An image's description doubles as its contains fallback; OCR text indexes
   118	
   119	```
   120	const docs = await docsFor(
   121	  "store/archive/photo.image.card",
   122	  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: The boiler's serial-number plate (K-44210)\ntext:\n  - source: plate\n    content: Serial K-44210 Model HX-200 240V\n---\n"
   123	);
   124	docs[0].contains
   125	=> The boiler's serial-number plate (K-44210)
   126	
   127	docs[0].title
   128	=> The boiler's serial-number plate (K-44210)
   129	
   130	docs[0].content.includes("Model HX-200 240V")
   131	=> true
   132	```
   133	
   134	## Long bodies split into per-section documents; the preamble stays on the card
   135	
   136	```
   137	const section = "words ".repeat(Math.ceil(SECTION_SPLIT_THRESHOLD / 12));
   138	const bodyText = `Intro before any heading.\n\n# Mill\n${section}\n\n## Gears\n${section}\n\n# Store\n${section}\n`;
   139	const docs = await docsFor(
   140	  "box/examples/Engine.doc.card",
   141	  `---\ntitle: The Analytical Engine\n---\n${bodyText}`
   142	);
   143	JSON.stringify(docs.map((d) => d.fragment))
   144	=> ["","/Mill","/Mill/Gears","/Store"]
   145	
   146	docs[0].content
   147	=> Intro before any heading.
   148	
   149	docs[1].id
   150	=> box/examples/Engine.doc.card#/Mill
   151	
   152	docs.every((d) => d.kind === "doc" && d.title === "The Analytical Engine")
   153	=> true
   154	```
   155	
   156	## Short bodies with headings stay one document
   157	
   158	```
   159	const split = splitMarkdownSections("Preamble.\n\n# One\nalpha\n\n# Two\nbeta\n");
   160	JSON.stringify(split.preamble)
   161	=> "Preamble."
   162	
   163	JSON.stringify(split.sections.map((s) => s.fragment))
   164	=> ["/One","/Two"]
   165	
   166	const docs = await docsFor("box/examples/Short.doc.card", "---\ntitle: Short\n---\nPreamble.\n\n# One\nalpha\n");
   167	docs.length
   168	=> 1
   169	```
   170	
   171	## XML cards index their walked text
   172	
   173	```
   174	const card = await loadCardFromText({
   175	  content: "<note title=\"Saute step\"><step>Heat the pan.</step><step>Add onions.</step></note>",
   176	  source: "store/Note.note.card",
   177	  ctx,
   178	});
   179	card.kind
   180	=> xml
   181	
   182	const docs = extractCardDocs({ path: "store/Note.note.card", card, contentHash: "h2" });
   183	docs[0].title
   184	=> Saute step
   185	
   186	docs[0].content
   187	=> Heat the pan. Add onions.
   188	```
   189	
   190	## Sheets index their tab titles
   191	
   192	```
   193	const docs = await docsFor(
   194	  "store/drive/Budget.sheet.card",
   195	  "---\ndrive-id: d2\ntitle: Family Budget\nmodified: 2026-05-01\nlink: https://docs.google.com/spreadsheets/d/d2/edit\nowner: o@example.com\nsheets:\n  - ref: attach/tab-0.json\n    title: Monthly Spending\n    gid: \"0\"\n---\n"
   196	);
   197	docs[0].content
   198	=> Monthly Spending
   199	```

 succeeded in 0ms:
     1	/**
     2	 * Card → search-document extraction.
     3	 *
     4	 * Pure module: callers read files and pass content in; nothing here touches
     5	 * the filesystem. The indexer drives it in two phases:
     6	 *
     7	 *   1. `declareInputFiles(card)` — extra files (beyond the `.card` file)
     8	 *      whose content this card's documents are built from. The indexer
     9	 *      watches them in its manifest and passes their content back in.
    10	 *   2. `extractCardDocs(...)` — the card's search documents.
    11	 *
    12	 * Email bodies are deliberately NOT inputs: they live outside the card
    13	 * because the content is untrusted (see src/schemas/email-message.tsx) and
    14	 * indexing them would re-inject untrusted text into agent context via
    15	 * search excerpts. Mail is reached via subject/snippet/participants and the
    16	 * agent-written `contains`.
    17	 */
    18	
    19	import type { ElementNode } from "cardworks";
    20	import type { LoadedCard, FrontmatterLoadedCard, XmlLoadedCard } from "../card-io.js";
    21	import { resolveAttachRef } from "../../shared/attach-path.js";
    22	import { titleFromFilename, truncateTitle } from "../file-summary.js";
    23	import { splitMarkdownSections } from "./markdown-sections.js";
    24	
    25	/** One Orama document. `fragment` is "" for the card's own document. */
    26	export interface SearchDoc {
    27	  /** `<path>#<fragment>` — unique within the index. */
    28	  id: string;
    29	  path: string;
    30	  fragment: string;
    31	  kind: string;
    32	  title: string;
    33	  contains: string;
    34	  content: string;
    35	  created: string;
    36	  contentHash: string;
    37	}
    38	
    39	/** Bodies longer than this split into per-section documents. */
    40	export const SECTION_SPLIT_THRESHOLD = 2000;
    41	
    42	/** The `kind` for standalone markdown files (not cards). */
    43	export const MARKDOWN_KIND = "markdown";
    44	
    45	const TITLE_MAX = 80;
    46	
    47	/**
    48	 * Kinds whose pipeline-maintained summary field doubles as the `contains`
    49	 * fallback (role separation: `description` stays the visual/file summary —
    50	 * alt text etc. — while also satisfying retrieval until an explicit
    51	 * `contains` is written).
    52	 */
    53	const CONTAINS_FALLBACK_FIELD: Record<string, string> = {
    54	  image: "description",
    55	  file: "description",
    56	};
    57	
    58	/**
    59	 * The card's effective `contains`: the explicit field, or the per-kind
    60	 * fallback. The single source for the index column, the staleness sidecar,
    61	 * and the missing-contains worklist — a described image is not "missing".
    62	 */
    63	export function effectiveContains(kind: string, fields: Record<string, unknown>): string {
    64	  const explicit = str(fields["contains"]);
    65	  if (explicit !== undefined) return explicit;
    66	  const fallbackField = CONTAINS_FALLBACK_FIELD[kind];
    67	  if (fallbackField === undefined) return "";
    68	  return str(fields[fallbackField]) ?? "";
    69	}
    70	
    71	/**
    72	 * Extra files this card's documents are built from (box-relative paths).
    73	 * Currently only gdocs declare one: the markdown content snapshot in the
    74	 * card's attach scope.
    75	 */
    76	export function declareInputFiles(input: { path: string; card: LoadedCard }): string[] {
    77	  const { path, card } = input;
    78	  if (card.kind !== "frontmatter") return [];
    79	  if (card.schema.type !== "gdoc") return [];
    80	  const content = card.fields["content"];
    81	  const ref = isRefObject(content) ? content.ref : undefined;
    82	  if (ref === undefined) return [];
    83	  const resolved = resolveAttachRef(path, ref);
    84	  return resolved === null ? [] : [resolved];
    85	}
    86	
    87	export interface ExtractInput {
    88	  /** Box-relative card path. */
    89	  path: string;
    90	  card: LoadedCard;
    91	  /** Hash of the card file content (computed by the indexer). */
    92	  contentHash: string;
    93	  /** Content of each declared input file, keyed by box-relative path. */
    94	  inputContents?: Map<string, string>;
    95	}
    96	
    97	/**
    98	 * Extract the search documents for one card: the card document plus
    99	 * per-section documents when the body is long.
   100	 */
   101	export function extractCardDocs(input: ExtractInput): SearchDoc[] {
   102	  const { path, card, contentHash } = input;
   103	  if (card.kind === "xml") return [xmlDoc(path, { card, contentHash })];
   104	
   105	  const fields = card.fields;
   106	  const kind = card.schema.type;
   107	  const fold = foldFields(kind, fields);
   108	  const title = truncateTitle(
   109	    firstNonEmpty([str(fields["title"]), fold.title, titleFromFilename(path)])
   110	      .replace(/\s+/g, " ")
   111	      .trim(),
   112	    TITLE_MAX
   113	  );
   114	  const contains = effectiveContains(kind, fields);
   115	  const created = firstNonEmpty([str(fields["created"]), fold.created]);
   116	
   117	  const bodyText = bodyTextFor(card, input);
   118	  const base = { path, kind, title, contains, created, contentHash };
   119	
   120	  if (bodyText.length <= SECTION_SPLIT_THRESHOLD) {
   121	    const content = joinContent([...fold.extra, bodyText]);
   122	    return [{ ...base, id: docId(path, ""), fragment: "", content }];
   123	  }
   124	
   125	  const { preamble, sections } = splitMarkdownSections(bodyText);
   126	  const cardDoc: SearchDoc = {
   127	    ...base,
   128	    id: docId(path, ""),
   129	    fragment: "",
   130	    content: joinContent([...fold.extra, preamble]),
   131	  };
   132	  const sectionDocs = sections.map((s): SearchDoc => ({
   133	    ...base,
   134	    id: docId(path, s.fragment),
   135	    fragment: s.fragment,
   136	    content: normalizeContent(s.text),
   137	  }));
   138	  return dedupeDocIds([cardDoc, ...sectionDocs]);
   139	}
   140	
   141	function docId(path: string, fragment: string): string {
   142	  return `${path}#${fragment}`;
   143	}
   144	
   145	/**
   146	 * Repeated headings produce identical fragment paths; ids must be unique
   147	 * within the index, so duplicates get a ~N suffix.
   148	 */
   149	function dedupeDocIds(docs: SearchDoc[]): SearchDoc[] {
   150	  const seen = new Map<string, number>();
   151	  return docs.map((d) => {
   152	    const n = seen.get(d.id) ?? 0;
   153	    seen.set(d.id, n + 1);
   154	    if (n === 0) return d;
   155	    const fragment = `${d.fragment}~${String(n + 1)}`;
   156	    return { ...d, fragment, id: docId(d.path, fragment) };
   157	  });
   158	}
   159	
   160	/**
   161	 * Extract documents for a standalone markdown file (kind "markdown"):
   162	 * title from the first heading, same section-splitting rules as card
   163	 * bodies, no contains/created.
   164	 */
   165	export function extractMarkdownFileDocs(input: {
   166	  path: string;
   167	  content: string;
   168	  contentHash: string;
   169	}): SearchDoc[] {
   170	  const { path, content, contentHash } = input;
   171	  const heading = content.match(/^#{1,6}\s+(.+)$/m);
   172	  const title = truncateTitle(
   173	    firstNonEmpty([heading?.[1], titleFromFilename(path)]).replace(/\s+/g, " ").trim(),
   174	    TITLE_MAX
   175	  );
   176	  const base = { path, kind: MARKDOWN_KIND, title, contains: "", created: "", contentHash };
   177	
   178	  if (content.length <= SECTION_SPLIT_THRESHOLD) {
   179	    return [{ ...base, id: docId(path, ""), fragment: "", content: normalizeContent(content) }];
   180	  }
   181	  const { preamble, sections } = splitMarkdownSections(content);
   182	  return dedupeDocIds([
   183	    { ...base, id: docId(path, ""), fragment: "", content: normalizeContent(preamble) },
   184	    ...sections.map((s): SearchDoc => ({
   185	      ...base,
   186	      id: docId(path, s.fragment),
   187	      fragment: s.fragment,
   188	      content: normalizeContent(s.text),
   189	    })),
   190	  ]);
   191	}
   192	
   193	/** The markdown text a card's content documents are built from. */
   194	function bodyTextFor(card: FrontmatterLoadedCard, input: ExtractInput): string {
   195	  if (card.schema.type === "gdoc") {
   196	    const declared = declareInputFiles({ path: input.path, card });
   197	    const first = declared[0];
   198	    if (first === undefined) return "";
   199	    return input.inputContents?.get(first) ?? "";
   200	  }
   201	  const bodyName = card.schema.bodyFieldName;
   202	  if (bodyName === null) return "";
   203	  const body = card.fields[bodyName];
   204	  return typeof body === "string" ? body : "";
   205	}
   206	
   207	interface FoldResult {
   208	  title?: string | undefined;
   209	  created?: string | undefined;
   210	  /** Frontmatter text folded into the card document's content. */
   211	  extra: string[];
   212	}
   213	
   214	/** Per-kind frontmatter folding into searchable text. */
   215	function foldFields(kind: string, fields: Record<string, unknown>): FoldResult {
   216	  switch (kind) {
   217	    case "email-thread":
   218	      return {
   219	        title: str(fields["subject"]),
   220	        created: str(path2(fields["date-range"], "start")),
   221	        extra: compact([str(fields["subject"]), ...strArray(fields["participants"]), ...strArray(fields["labels"])]),
   222	      };
   223	    case "email-message":
   224	      // The body file is deliberately excluded — see module doc.
   225	      return {
   226	        title: str(fields["subject"]),
   227	        created: str(fields["date"]),
   228	        extra: compact([
   229	          str(fields["subject"]),
   230	          str(fields["from"]),
   231	          str(fields["to"]),
   232	          str(fields["snippet"]),
   233	        ]),
   234	      };
   235	    case "person":
   236	      return {
   237	        title: str(fields["name"]),
   238	        extra: compact([str(fields["name"]), str(fields["role"]), str(fields["contact"])]),
   239	      };
   240	    case "record":
   241	      return {
   242	        title: str(fields["name"]),
   243	        extra: compact([str(fields["name"]), str(fields["description"]), str(fields["notes"])]),
   244	      };
   245	    case "image":
   246	      // text: carries the OCR'd content the analysis step keeps (amounts,
   247	      // account numbers, names) — the needles people search for.
   248	      return {
   249	        title: str(fields["description"]),
   250	        extra: compact([str(fields["description"]), ...textBlockContents(fields["text"])]),
   251	      };
   252	    case "file":
   253	      return { extra: compact([str(fields["description"])]) };
   254	    case "sheet":
   255	      return { extra: tabTitles(fields["sheets"]) };
   256	    case "telegram-message":
   257	      return { extra: compact([str(fields["text"])]) };
   258	    case "memo":
   259	      // Mirrors memoLoader: a memo's display title is its (truncated) text.
   260	      return {
   261	        title: firstNonEmpty([str(fields["body"]), str(path2(fields["transcription"], "text"))]),
   262	        extra: [],
   263	      };
   264	    default:
   265	      return { extra: [] };
   266	  }
   267	}
   268	
   269	function xmlDoc(path: string, input: { card: XmlLoadedCard; contentHash: string }): SearchDoc {
   270	  const { card, contentHash } = input;
   271	  const attrs = card.element.attrs;
   272	  const title = truncateTitle(
   273	    firstNonEmpty([str(attrs["title"]), str(attrs["name"]), titleFromFilename(path)]),
   274	    TITLE_MAX
   275	  );
   276	  return {
   277	    id: docId(path, ""),
   278	    path,
   279	    fragment: "",
   280	    kind: card.element.tagName,
   281	    title,
   282	    contains: "",
   283	    content: normalizeContent(collectElementText(card.element)),
   284	    created: "",
   285	    contentHash,
   286	  };
   287	}
   288	
   289	/** Collect all text content from an XML element tree (text, mixed, children). */
   290	function collectElementText(node: ElementNode): string {
   291	  const parts: string[] = [];
   292	  const visit = (n: ElementNode): void => {
   293	    if (typeof n.text === "string" && n.text.trim() !== "") parts.push(n.text);
   294	    if (Array.isArray(n.mixed)) {
   295	      for (const m of n.mixed) {
   296	        if (typeof m === "string") parts.push(m);
   297	        else if (isElementNode(m)) visit(m);
   298	      }
   299	    }
   300	    for (const child of n.children) {
   301	      if (isElementNode(child)) visit(child);
   302	    }
   303	  };
   304	  visit(node);
   305	  return parts.join(" ").replace(/\s+/g, " ").trim();
   306	}
   307	
   308	function isElementNode(value: unknown): value is ElementNode {
   309	  return (
   310	    typeof value === "object"
   311	    && value !== null
   312	    && "tagName" in value
   313	    && "children" in value
   314	  );
   315	}
   316	
   317	function isRefObject(value: unknown): value is { ref: string } {
   318	  return (
   319	    typeof value === "object"
   320	    && value !== null
   321	    && typeof (value as { ref?: unknown }).ref === "string"
   322	  );
   323	}
   324	
   325	function str(value: unknown): string | undefined {
   326	  return typeof value === "string" && value.trim() !== "" ? value : undefined;
   327	}
   328	
   329	function strArray(value: unknown): string[] {
   330	  if (!Array.isArray(value)) return [];
   331	  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
   332	}
   333	
   334	function path2(value: unknown, key: string): unknown {
   335	  if (typeof value !== "object" || value === null) return undefined;
   336	  return (value as Record<string, unknown>)[key];
   337	}
   338	
   339	function textBlockContents(text: unknown): string[] {
   340	  if (!Array.isArray(text)) return [];

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/file-summary.ts | sed -n '1,90p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * FileSummary — slim, parsed representation of a file for list contexts.
     3	 *
     4	 * Used by the files.summarize endpoint to ship structured metadata without
     5	 * full XML/content bodies. Peek/panel/page escalations fetch full data
     6	 * separately via the existing card/file endpoints.
     7	 *
     8	 * The generic type parameter carries the per-type attrs shape, derived via
     9	 * `z.infer` from the card schema. Default `unknown` forces the fallback
    10	 * path not to reach into attrs.
    11	 */
    12	
    13	import type { ElementNode } from "cardworks";
    14	
    15	export interface FileSummary<T = unknown> {
    16	  /** Box-relative path to the file */
    17	  path: string;
    18	  /** Root element tag for cards; undefined for non-card files */
    19	  tagName?: string;
    20	  /** Always-present human-readable title. Loader computes; fallback is filename */
    21	  title: string;
    22	  /** The card's agent-written contains: sentence, when present. */
    23	  contains?: string;
    24	  /** Typed attrs — shape depends on the loader */
    25	  attrs?: T;
    26	}
    27	
    28	/**
    29	 * Input passed to a loader. The server populates `element` for parsed cards
    30	 * and `content` for text files; loaders that don't need either just return
    31	 * a summary keyed on `path`.
    32	 */
    33	export interface LoaderInput {
    34	  path: string;
    35	  /** Populated for Phase 1 XML-bodied cards. */
    36	  element?: ElementNode;
    37	  /** Populated for Phase 2 frontmatter-bodied cards. */
    38	  fields?: Record<string, unknown>;
    39	  /** Card type — from `element.tagName` (XML) or `fields.type` (frontmatter). */
    40	  type?: string;
    41	  /** Plain text content for non-card files. */
    42	  content?: string;
    43	}
    44	
    45	export type FileLoader<T> = (raw: LoaderInput) => FileSummary<T>;
    46	
    47	/**
    48	 * Strip extensions and replace separators to produce a readable title from a path.
    49	 * "Meeting_Notes.memo.card" → "Meeting Notes"
    50	 * "photo-001.jpg" → "photo 001"
    51	 */
    52	export function titleFromFilename(filePath: string): string {
    53	  const slash = filePath.lastIndexOf("/");
    54	  const base = slash === -1 ? filePath : filePath.slice(slash + 1);
    55	  const dot = base.indexOf(".");
    56	  const stem = dot === -1 ? base : base.slice(0, dot);
    57	  return stem.replaceAll("_", " ").replaceAll("-", " ");
    58	}
    59	
    60	/**
    61	 * Truncate text to n characters, appending an ellipsis if trimmed.
    62	 */
    63	export function truncateTitle(text: string, n: number): string {
    64	  if (text.length <= n) return text;
    65	  return text.slice(0, n - 1).trimEnd() + "…";
    66	}

codex
C4’s registry/card-io collapse list is incomplete. Removing `schemas`/`ElementSchema` also touches rule/doc generation (`init-rules.ts`, `generate-docs.ts`, `agent-guide/*`) and view routes. Some are mentioned elsewhere, but the implementation order doesn’t group them with the interlocking removal, which makes the “green per commit” claim optimistic.
exec
/opt/homebrew/bin/bash -lc "rg -n \"callback-box/cards|from \\\"cardworks\\\"|from 'cardworks'|cardSchema\\(\" callback-box/docs callback-box/src callback-box/test -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "rg -n \"\\bschemas\\b|getAllSchemas\\(|createSchemaRegistry\\(|ElementSchema|elementSchemas|SchemaRegistry\" callback-box/src callback-box/test -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/test/schemas.doctest.md:18:import { parseCard } from "cardworks";
callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:277:> import { element, escapeText } from "cardworks";
callback-box/docs/plans/remove-cardworks-package.md:70:  `callback-box/cards`, or keep `"cardworks"` as a resolver alias mapping to
callback-box/docs/plans/remove-cardworks-package.md:244:keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/docs/plans/remove-cardworks-package.md:266:  Add an `exports` entry exposing `src/cards/` as `callback-box/cards` (or keep
callback-box/docs/plans/remove-cardworks-package.md:283:find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/docs/plans/remove-cardworks-package.md:316:`grep -rl 'from "cardworks"' callback-box/{src,scripts,test}` empty, **and**
callback-box/docs/plans/remove-cardworks-deletion.md:109:`callback-box/cards` specifier resolves under the bundled `cb`, deleting
callback-box/docs/plans/remove-cardworks-deletion.md:114:### Track C1 — Make `callback-box/cards` resolve under the bundled `cb` (#17, the gate)
callback-box/docs/plans/remove-cardworks-deletion.md:120:(`box-templates.ts:31`/`:77`) already says `import … from "callback-box/cards"`.
callback-box/docs/plans/remove-cardworks-deletion.md:121:After cardworks is deleted, every box schema must import `callback-box/cards`,
callback-box/docs/plans/remove-cardworks-deletion.md:139:- The box-schema tsx resolver maps `callback-box/cards` → that built JS, which
callback-box/docs/plans/remove-cardworks-deletion.md:143:  `callback-box/cards`.
callback-box/docs/plans/remove-cardworks-deletion.md:146:`callback-box/cards` → the on-disk `src/cards/*.ts` and register tsx for the
callback-box/docs/plans/remove-cardworks-deletion.md:154:entry, then prove a box schema importing `callback-box/cards` loads under
callback-box/docs/plans/remove-cardworks-deletion.md:292:  schemas now import only `callback-box/cards`/`zod`/`yaml`.
callback-box/docs/plans/remove-cardworks-deletion.md:306:  schemas" scaffold section and the `import { element } from "cardworks"`
callback-box/docs/plans/remove-cardworks-deletion.md:307:  example; the template keeps only the `callback-box/cards` `cardSchema` form.
callback-box/docs/plans/remove-cardworks-deletion.md:352:| `callback-box/cards` doesn't resolve under the bundled `cb` after deletion | No | C1 spike proves it on a real box before deletion | **Silent until a box schema loads at runtime** — the spike is the gate |
callback-box/docs/plans/remove-cardworks-deletion.md:437:   `callback-box/cards` loads under `bin/cb validate`. Repoint deployed `bill`
callback-box/docs/plans/remove-cardworks-deletion.md:472:  `callback-box/cards` (C1), done in this push.
callback-box/docs/implemented-plans/extfile-card.md:31:  markdown body (Phase 2)."* `extfile` is a frontmatter `cardSchema()`,
callback-box/docs/implemented-plans/extfile-card.md:217:- Schema (`cardSchema("extfile", { fields, instructions })`, registered in
callback-box/test/box-schemas.doctest.md:4:either a frontmatter `cardSchema()` (the default for new types) or a legacy XML `element()`
callback-box/test/box-schemas.doctest.md:35:// `callback-box/cards` specifier (resolved by the tsx hook in registry.ts).
callback-box/test/box-schemas.doctest.md:36:const WIDGET_SCHEMA = `import { body, cardSchema } from "callback-box/cards";
callback-box/test/box-schemas.doctest.md:39:export default cardSchema("widget", {
callback-box/test/box-schemas.doctest.md:50:const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/test/box-schemas.doctest.md:73:box). The loader segregates them: the `cardSchema()` lands in `cardSchemas`, the `element()`
callback-box/docs/implemented-plans/box-search.md:68:  `cardSchema()` already injects `type: z.literal(type)` into every
callback-box/docs/implemented-plans/box-search.md:166:- **What**: `cardSchema()` injects two global optional frontmatter fields
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:25:> import { element } from "cardworks";
callback-box/docs/plans/box-commentary-surface.md:450:- **Schema** (`cardSchema("commentary", …)`, registered in `registry.ts:63-89`),
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:62:- **Card-type system.** `cardSchema(type, { fields })` registered in
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:151:export const WebpageSchema: CardSchema = cardSchema("webpage", {
callback-box/test/loader-registry.doctest.md:13:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/docs/EXAMPLE_FILES.md:561:import { element } from "cardworks";
callback-box/docs/EXAMPLE_FILES.md:595:import { element } from "cardworks";
callback-box/docs/plans/box-migration.subplan.md:119:to `cardSchema("bill", { fields, … })` importing from `callback-box/cards` (the
callback-box/test/extfile-sync.doctest.md:12:import { splitCardContent } from "cardworks";
callback-box/test/card-loaders.doctest.md:8:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/test/card-lint.doctest.md:15:} from "cardworks";
callback-box/test/card-lint.doctest.md:23:const threadSchema: CardSchema = cardSchema("email-thread", {
callback-box/test/card-lint.doctest.md:36:const docSchema: CardSchema = cardSchema("doc", {
callback-box/test/card-lint.doctest.md:47:const gadgetSchema: CardSchema = cardSchema("gadget", {
callback-box/docs/plans/web-page-commentary.md:134:  body-bearing `cardSchema("commentary", …)` with `defaultHref` xor
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:39:- **Per-schema `instructions`** field on `cardSchema()` (used in
callback-box/test/card-io.doctest.md:15:} from "cardworks";
callback-box/test/card-io.doctest.md:25:const docSchema: CardSchema = cardSchema("doc", {
callback-box/test/card-io.doctest.md:33:const threadSchema: CardSchema = cardSchema("email-thread", {
callback-box/docs/boxes-as-packages.md:17:2. **Schemas are a stub package.** `config/schemas/package.json` is `{"type":"module"}` with no dependencies. To define a real schema the agent would want `import { z } from "zod"; import { element } from "cardworks";` — same as built-in schemas in `src/schemas/`. Today this works only by accident (transitive resolution from the callback-box install) and gives no IDE help inside the box.
callback-box/docs/adding-schemas.md:35:export const MyThingSchema: CardSchema = cardSchema("my-thing", {
callback-box/docs/adding-schemas.md:73:- `cardSchema(type, { fields, instructions? })` is the entry point. `fields` is a flat object of Zod validators; nest with `z.object` / `z.array` as needed.
callback-box/docs/adding-schemas.md:100:export const MyThingSchema: CardSchema = cardSchema("my-thing", {
callback-box/src/dev/knowledge-audits.yaml:147:      Names the schema's `validate` hook on cardSchema() — self-contained,
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:11:- **Per-schema `instructions`** field on `cardSchema()` (used in `briefing.tsx:52`, `recipe.tsx:124`) — already the channel for agent guidance. Plan's "2-3 sentences in the relevant schema's `instructions`" lands directly here. Reuses.
callback-box/docs/implemented-plans/schema-validate-hook.md:10:Add a first-class `validate` hook to cardworks' `cardSchema()` so that
callback-box/docs/implemented-plans/schema-validate-hook.md:45:- **`cardSchema()` and its config/resolved types** —
callback-box/docs/implemented-plans/schema-validate-hook.md:47:  `:114-132` (`CardSchema`), `:142-198` (`cardSchema()`). The resolved
callback-box/docs/implemented-plans/schema-validate-hook.md:302:    Names the schema's `validate` hook on cardSchema() — self-contained,
callback-box/docs/implemented-plans/schema-validate-hook.md:322:   `CardSchema.validate?`, the conditional-spread copy in `cardSchema()`, and
callback-box/docs/glossary.md:42:**cardworks** — The card library at `~/src/cardworks/`. Provides two schema primitives — `cardSchema()` for YAML-frontmatter cards and `element()` for legacy XML cards — plus parsing, serialization, Zod-based validation, the frontmatter splitter, and JSX support. Shared between callback-box and other projects in the monorepo.
callback-box/src/webapp/routes/views.ts:21:import type { ElementNode } from "cardworks";
callback-box/src/webapp/routes/views.ts:157:      // The body field is always named `body` — enforced by cardSchema().
callback-box/src/schemas/landmark.ts:121:export const LandmarkSchema: CardSchema = cardSchema("landmark", {
callback-box/src/webapp/routes/api-card-patch.ts:9:import type { ElementNode } from "cardworks";
callback-box/src/schemas/guide-elements.tsx:120:export const GuideSchema: CardSchema = cardSchema("guide", {
callback-box/src/schemas/briefing.tsx:23:export const BriefingSchema: CardSchema = cardSchema("briefing", {
callback-box/src/schemas/todo-list.ts:36:export const TodoListSchema: CardSchema = cardSchema("todo-list", {
callback-box/src/schemas/intake-job.tsx:13:export const IntakeJobSchema: CardSchema = cardSchema("intake-job", {
callback-box/src/cards/index.ts:7: * `callback-box/cards` specifier; internal code imports from `../cards/`.
callback-box/src/cards/schema.ts:20: * Thrown when a cardSchema() declaration is invalid (multiple body fields,
callback-box/src/cards/schema.ts:26:    super(`cardSchema(${type}): ${detail}`);
callback-box/src/cards/schema.ts:76: * the frontmatter schema by cardSchema() unless the schema declares its own
callback-box/src/cards/schema.ts:109: * Configuration for cardSchema().
callback-box/src/schemas/telegram-message.ts:21:export const TelegramMessageSchema: CardSchema = cardSchema("telegram-message", {
callback-box/src/schemas/image.tsx:72:export const ImageSchema: CardSchema = cardSchema("image", {
callback-box/src/schemas/email-thread.tsx:35:export const EmailThreadSchema: CardSchema = cardSchema("email-thread", {
callback-box/src/schemas/chat-thread.ts:38:export const ChatThreadSchema: CardSchema = cardSchema("chat-thread", {
callback-box/src/schemas/feedback.tsx:40:export const FeedbackSchema: CardSchema = cardSchema("feedback", {
callback-box/src/schemas/person.tsx:18:export const PersonSchema: CardSchema = cardSchema("person", {
callback-box/src/schemas/webpage.tsx:20:export const WebpageSchema: CardSchema = cardSchema("webpage", {
callback-box/src/schemas/capture-session.tsx:48:export const CaptureSessionSchema: CardSchema = cardSchema("capture-session", {
callback-box/src/webapp/trpc/routers/card.ts:7:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/schemas/calendar-review-job.tsx:19:export const CalendarReviewJobSchema: CardSchema = cardSchema("calendar-review-job", {
callback-box/src/schemas/recipe.tsx:20:export const RecipeSchema: CardSchema = cardSchema("recipe", {
callback-box/src/schemas/email-message.tsx:34:export const EmailMessageSchema: CardSchema = cardSchema("email-message", {
callback-box/src/schemas/chat-job.ts:14:export const ChatJobSchema: CardSchema = cardSchema("chat-job", {
callback-box/src/schemas/memo.ts:36:export const MemoSchema: CardSchema = cardSchema("memo", {
callback-box/src/schemas/sheet.tsx:24:export const SheetSchema: CardSchema = cardSchema("sheet", {
callback-box/src/schemas/email-outbound.tsx:38:export const EmailOutboundSchema: CardSchema = cardSchema("email-outbound", {
callback-box/src/schemas/question-followup-job.ts:12:export const QuestionFollowupJobSchema: CardSchema = cardSchema("question-followup-job", {
callback-box/src/schemas/file.tsx:30:export const FileSchema: CardSchema = cardSchema("file", {
callback-box/src/schemas/gdoc.tsx:39:export const GdocSchema: CardSchema = cardSchema("gdoc", {
callback-box/src/schemas/procedure-run.ts:55:export const ProcedureRunSchema: CardSchema = cardSchema("procedure-run", {
callback-box/src/webapp/trpc/routers/chat.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/schemas/procedure.ts:67:export const ProcedureSchema: CardSchema = cardSchema("procedure", {
callback-box/src/schemas/question.ts:38:export const QuestionSchema: CardSchema = cardSchema("question", {
callback-box/src/schemas/record.tsx:48:export const RecordSchema: CardSchema = cardSchema("record", {
callback-box/src/schemas/scheduled-script.tsx:48:export const ScheduledScriptSchema: CardSchema = cardSchema("scheduled-script", {
callback-box/src/schemas/audio.tsx:33:export const AudioSchema: CardSchema = cardSchema("audio", {
callback-box/src/schemas/commentary.tsx:61:export const CommentarySchema: CardSchema = cardSchema("commentary", {
callback-box/src/schemas/personality.tsx:95:export const PersonalitySchema: CardSchema = cardSchema("personality", {
callback-box/src/schemas/doc.tsx:17:export const DocSchema: CardSchema = cardSchema("doc", {
callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema } from "cardworks";
callback-box/src/schemas/registry.ts:100: * - `callback-box/cards` — the public card-primitive surface (cardSchema,
callback-box/src/schemas/registry.ts:106: *   schema files to `callback-box/cards`; goes away with cardworks itself.
callback-box/src/schemas/registry.ts:114: * AND self-references (`callback-box/cards`) via callback-box's own
callback-box/src/schemas/registry.ts:124: * (under config/schemas/) can import `callback-box/cards`, `zod`, and the
callback-box/src/schemas/registry.ts:175: * files may default-export either a frontmatter `cardSchema()` (the default
callback-box/src/schemas/registry.ts:202: * Each file should default-export either a frontmatter `cardSchema()` or a
callback-box/src/schemas/registry.ts:259:        console.warn(`Warning: ${file} does not export a default cardSchema() or element(), skipping`);
callback-box/src/schemas/extfile.tsx:68:export const ExtfileSchema: CardSchema = cardSchema("extfile", {
callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/src/cli/lib/loader.ts:70:export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/src/cli/lib/loader.ts:71:export type { ICardLoader, CardLoaderOptions } from "cardworks";
callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:19:  lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
callback-box/src/core/preactions/index.ts:21:import type { ICardLoader } from "cardworks";
callback-box/src/core/preactions/types.ts:1:import type { Card, ICardLoader } from "cardworks";
callback-box/src/core/preactions/transcribe.ts:18:import type { ElementNode } from "cardworks";
callback-box/src/core/card-lint.ts:24:import { lintCard, type ICardLoader } from "cardworks";
callback-box/src/core/box-templates.ts:28:Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:
callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "callback-box/cards";
callback-box/src/core/box-templates.ts:34:export default cardSchema("my-type", {
callback-box/src/core/box-templates.ts:61:- \`cardSchema(type, { fields, instructions? })\` is the entry point. \`fields\` is a flat object
callback-box/src/core/box-templates.ts:77:import { cardSchema, type LintIssue } from "callback-box/cards";
callback-box/src/core/box-templates.ts:80:export default cardSchema("link", {
callback-box/src/core/box-templates.ts:101:From \`callback-box/cards\`:
callback-box/src/core/box-templates.ts:102:- \`cardSchema(type, config)\` — define a frontmatter card schema (the default)
callback-box/src/core/box-templates.ts:119:import { cardSchema } from "callback-box/cards";
callback-box/src/core/box-templates.ts:139:export default cardSchema("task", {
callback-box/src/core/box-templates.ts:166:import { element } from "cardworks";
callback-box/src/core/file-summary.ts:13:import type { ElementNode } from "cardworks";
callback-box/src/core/generate-docs-compile.ts:12:import { parseCard } from "cardworks";
callback-box/src/core/commands/move-operations.ts:16:import { CardLoader } from "cardworks";
callback-box/src/core/card-io.ts:21:import { parseCard, type ElementSchema, type ElementNode } from "cardworks";
callback-box/src/core/search/extract.ts:19:import type { ElementNode } from "cardworks";

 succeeded in 0ms:
callback-box/test/contains-state.doctest.md:19:import { schemas, createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/test/contains-state.doctest.md:26:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/test/schemas.doctest.md:11:  createSchemaRegistry,
callback-box/test/schemas.doctest.md:14:} from "../src/schemas/index.js";
callback-box/test/schemas.doctest.md:15:import { createIntakeJobTemplate } from "../src/schemas/intake-job.js";
callback-box/test/schemas.doctest.md:16:import { createCalendarReviewJobTemplate } from "../src/schemas/calendar-review-job.js";
callback-box/test/schemas.doctest.md:17:import { WebpageSchema, createWebpageTemplate } from "../src/schemas/webpage.js";
callback-box/test/schemas.doctest.md:43:XML schemas have a `tagName`; Phase 2 frontmatter schemas (memo,
callback-box/test/schemas.doctest.md:58:The full registry of XML schemas is available via `createSchemaRegistry()`:
callback-box/test/schemas.doctest.md:61:const registry = await createSchemaRegistry();
callback-box/test/telegram-output-cards.doctest.md:15:import { createTelegramMessageTemplate } from "../src/schemas/telegram-message.js";
callback-box/test/connector-drive.doctest.md:46:const { createSheetTemplate } = await import("../src/schemas/sheet.js");
callback-box/test/connector-drive.doctest.md:107:const { createSheetTemplate: tpl3 } = await import("../src/schemas/sheet.js");
callback-box/test/connector-drive.doctest.md:179:const { createSheetTemplate: tpl4 } = await import("../src/schemas/sheet.js");
callback-box/test/schedule-health.doctest.md:10:import { parseScheduledScript } from "../src/schemas/scheduled-script.js";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:260:**Watch for:** Navigates to config/schemas/ and finds CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:272:> ## 1. Create a schema file in `config/schemas/`
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:274:> The filename determines the card type. For example, `config/schemas/task.ts` creates the `task` type (files named `*.task.card`):
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:334:> You can see an existing box-local example at `config/schemas/bookmark.ts` for reference.
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:338:- ✗ Read config/schemas/CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:943:**Watch for:** Discovers config/schemas/CLAUDE.md to learn about custom card types
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:983:- ✗ Read config/schemas/CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:992:**Watch for:** Says yes and navigates to schemas, not 'card types are built-in'
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:995:- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schemas/bookmark.ts, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schemas/CLAUDE.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-memo.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:1014:- ✓ Read config/schemas/CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:1023:**Watch for:** Lists extension mechanisms: workflows, tricks, guides, schedules; bonus if mentions schemas
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:1054:> If you need a new data shape, you'd define a new card type with its schema. Existing types like `memo`, `recipe`, `bookmark`, etc. each have schemas in `docs/generated/`.
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:1092:> **Can I add new ones?** No — card types are defined by the callback-box framework itself (the `cb` tool), not by this box's configuration. I can create *instances* of existing card types using `cb create`, but I can't define new card type schemas. If you need a new card type, that would be a change to the callback-box codebase rather than something I can do within this box.
callback-box/test/init.doctest.md:106:schemas
callback-box/src/webapp/routes/clerk.ts:12:import { createWebpageTemplate } from "../../schemas/webpage.js";
callback-box/src/webapp/routes/clerk.ts:13:import { createCommentaryTemplate } from "../../schemas/commentary.js";
callback-box/src/core/reactor/batch-jobs.ts:11:import { schemas } from "../../schemas/registry.js";
callback-box/src/core/reactor/batch-jobs.ts:127:  const schema = schemas.find((s) => s.tagName === tagName);
callback-box/src/dev/reports/audit-report-2026-02-27T01-54-19.md:13:- Searches: Glob: config/schemas/*chat-thread*; Glob: **/chat-thread*.card; Glob: **/schemas/*chat*
callback-box/src/dev/reports/audit-report-2026-02-27T01-54-19.md:165:> Want me to look at the specific card schemas (`chat-thread`, `chat-job`, `scheduled-script`) to give you a more concrete example for your use case? For instance — are you trying to periodically check for new messages in an existing chat, or remind yourself to follow up on a conversation?
callback-box/test/box.doctest.md:60:config/schemas
callback-box/test/box-schemas.doctest.md:3:Boxes define their own card types under `config/schemas/*.ts`. Each file default-exports
callback-box/test/box-schemas.doctest.md:5:schema. `loadBoxSchemas` discovers both, segregating them by format; box frontmatter schemas
callback-box/test/box-schemas.doctest.md:13:import { loadBoxSchemas, createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/box-schemas.doctest.md:34:// frontmatter schemas import the card primitives via the public
callback-box/test/box-schemas.doctest.md:74:in `elementSchemas`:
callback-box/test/box-schemas.doctest.md:78:await fs.writeFile(path.join(box, "config/schemas/widget.ts"), WIDGET_SCHEMA);
callback-box/test/box-schemas.doctest.md:79:await fs.writeFile(path.join(box, "config/schemas/gadget.ts"), GADGET_SCHEMA);
callback-box/test/box-schemas.doctest.md:82:[loaded.cardSchemas.length, loaded.elementSchemas.length, loaded.cardSchemas[0].type, loaded.elementSchemas[0].tagName].join("|")
callback-box/test/box-schemas.doctest.md:88:`buildLoadContext` merges box frontmatter schemas into the same map built-in cards use, so a
callback-box/src/webapp/routes/capture-finalize.ts:13:import { createAudioTemplate } from "../../schemas/audio.js";
callback-box/src/webapp/routes/capture-finalize.ts:14:import { createImageTemplate } from "../../schemas/image.js";
callback-box/src/webapp/routes/capture-finalize.ts:15:import { createFileTemplate } from "../../schemas/file.js";
callback-box/src/webapp/routes/capture-finalize.ts:16:import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
callback-box/src/webapp/routes/capture-finalize.ts:17:import { createScheduledScriptTemplate } from "../../schemas/scheduled-script.js";
callback-box/src/connectors/chat-utils.ts:21:} from "../schemas/chat-thread.js";
callback-box/src/connectors/chat-utils.ts:22:import { createChatJobTemplate, type ChatJobFields } from "../schemas/chat-job.js";
callback-box/src/dev/reports/audit-report-2026-02-27T01-35-58.md:160:- Searches: Grep: telegram in .; Grep: chat.*message|send.*message in config; Grep: telegram in config; Grep: telegram in tricks; Grep: telegram in docs; Glob: config/schemas/*.ts; Glob: config/schemas/*; Grep: pushover|telegram|output in docs/generated
callback-box/src/dev/reports/audit-report-2026-02-27T01-35-58.md:191:- Searches: Grep: acknowledge|note|comment|annotation in /Users/ianbicking/src/boxes/test1/docs/generated; Grep: answer|acknowledge|note in /Users/ianbicking/src/boxes/test1/docs/generated/cb-commands.md; Grep: answer|chat|acknowledge in /Users/ianbicking/src/boxes/test1/config/schemas; Grep: question|answer|note|comment in /Users/ianbicking/src/boxes/test1/config/schemas; Glob: config/schemas/*question*; Glob: config/schemas/*.ts; Glob: box/questions/*.card
callback-box/src/dev/reports/audit-report-2026-02-27T01-35-58.md:192:- Bash: List schemas directory
callback-box/src/connectors/intake-utils.ts:18:import { createIntakeJobTemplate, type IntakeJobFields } from "../schemas/intake-job.js";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:9:**Watch for:** Navigates to config/schemas/ and finds CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:20:> ### 1. Create a schema file in `config/schemas/`
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:22:> For example, `config/schemas/task.ts`:
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:47:> - **`attrs`** — Zod schemas for XML attributes (with defaults, enums, optionals)
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:85:> You can look at the existing `config/schemas/bookmark.ts` for a real working example in this box.
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:88:- ✗ Read config/schemas/CLAUDE.md
callback-box/src/core/reactor/prompts.ts:16:A Callback Box organizes information through XML card files (validated by schemas), stored in directories that reflect lifecycle stage:
callback-box/src/connectors/gmail-threads.ts:15:import { createEmailThreadTemplate } from "../schemas/email-thread.js";
callback-box/src/connectors/gmail-threads.ts:16:import { createEmailMessageTemplate } from "../schemas/email-message.js";
callback-box/test/connector-drive-docs.doctest.md:15:import { createGdocTemplate } from "../src/schemas/gdoc.js";
callback-box/test/scheduled-script.doctest.md:14:} from "../src/schemas/scheduled-script.js";
callback-box/test/card-lint.doctest.md:14:  type ElementSchema,
callback-box/test/card-lint.doctest.md:20:import { CommentarySchema } from "../src/schemas/commentary.js";
callback-box/test/card-lint.doctest.md:21:import { ExtfileSchema } from "../src/schemas/extfile.js";
callback-box/test/card-lint.doctest.md:55:const memoSchema: ElementSchema = element("memo", {
callback-box/test/card-lint.doctest.md:67:  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
callback-box/src/connectors/drive-handler-docs.ts:35:import { createGdocTemplate } from "../schemas/gdoc.js";
callback-box/src/connectors/drive-handler-docs.ts:36:import type { GdocLossyType } from "../schemas/gdoc.js";
callback-box/test/landmark-schema.doctest.md:17:} from "../src/schemas/index.js";
callback-box/test/card-loaders.doctest.md:6:import { memoLoader } from "../src/schemas/memo.js";
callback-box/test/card-loaders.doctest.md:7:import { imageLoader } from "../src/schemas/image.js";
callback-box/src/core/chat-schedules.ts:14:import { parseDuration } from "../schemas/scheduled-script.js";
callback-box/src/connectors/gmail-drafts.ts:21:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/connectors/gmail-drafts.ts:135:    schemas: await createCardSchemaMap(opts.boxRoot),
callback-box/src/connectors/gmail-drafts.ts:234:      schemas: await createCardSchemaMap(),
callback-box/test/card-io.doctest.md:14:  type ElementSchema,
callback-box/test/card-io.doctest.md:22:import { createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/card-io.doctest.md:23:import { createIntakeJobTemplate } from "../src/schemas/intake-job.js";
callback-box/test/card-io.doctest.md:41:const schemas = new Map<string, CardSchema>([
callback-box/test/card-io.doctest.md:51:const card = parseCardText(text, { source: "thread.email-thread.card", schemas });
callback-box/test/card-io.doctest.md:63:const card = parseCardText(text, { source: "x.doc.card", schemas });
callback-box/test/card-io.doctest.md:75:  try { parseCardText(text, { source, schemas }); return "did not throw"; }
callback-box/test/card-io.doctest.md:92:const parsed = parseCardText(text, { source: "rt.doc.card", schemas });
callback-box/test/card-io.doctest.md:97:## Frontmatter-only schemas reject body content
callback-box/test/card-io.doctest.md:101:  try { parseCardText(text, { source, schemas }); return "did not throw"; }
callback-box/test/card-io.doctest.md:119:const drifted = parseCardText("---\ntype: doc\ndrive-id: d1\ntitle: T\nbogus-field: oops\n---\n", { source: "typo.doc.card", schemas });
callback-box/test/card-io.doctest.md:128:const ct = parseCardText("---\ntype: email-thread\nthread-id: t1\nsubject: hi\ncontent-type: text/plain\nparticipants:\n  - a@x\n---\n", { source: "ct.email-thread.card", schemas });
callback-box/test/card-io.doctest.md:136:const xmlMemo: ElementSchema = element("memo", {
callback-box/test/card-io.doctest.md:145:  elementSchemas: new Map<string, ElementSchema>([
callback-box/test/card-io.doctest.md:167:reactor discovers jobs by that suffix) while their schemas register under
callback-box/test/card-io.doctest.md:175:  elementSchemas: new Map(),
callback-box/src/connectors/requirements.ts:20:import type { ScheduleRequirements } from "../schemas/scheduled-script.js";
callback-box/src/dev/doc-graph-html-data.ts:33:    blurb: "The core data format. YAML-frontmatter markdown with typed schemas — that's it.",
callback-box/src/dev/doc-graph-html-data.ts:39:      { path: "docs/adding-schemas.md", note: "Read this before writing a new card type. Saves an embarrassing amount of time." },
callback-box/src/dev/doc-graph-html-data.ts:43:    code: ["src/schemas/", "src/core/card-io.ts"],
callback-box/test/procedure-engine.doctest.md:10:import { parseProcedureRun } from "../src/schemas/procedure-run.js";
callback-box/test/capture-pipeline.test.ts:23:import { createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/capture-pipeline.test.ts:24:import type { AudioFields } from "../src/schemas/audio.js";
callback-box/test/capture-pipeline.test.ts:25:import type { ImageFields } from "../src/schemas/image.js";
callback-box/test/capture-pipeline.test.ts:84:      schemas: await createCardSchemaMap(),
callback-box/test/capture-pipeline.test.ts:145:      schemas: await createCardSchemaMap(),
callback-box/src/connectors/drive-handler-sheets.ts:26:import { createSheetTemplate } from "../schemas/sheet.js";
callback-box/src/connectors/google-calendar.ts:42:} from "../schemas/calendar-review-job.js";
callback-box/src/connectors/telegram-output-cards.ts:3: * in src/schemas/telegram-message.ts: agents (and the scheduler's
callback-box/src/connectors/telegram-output-cards.ts:13:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/connectors/telegram-output-cards.ts:14:import type { TelegramMessageFields } from "../schemas/telegram-message.js";
callback-box/src/connectors/telegram-output-cards.ts:52:      const card = parseCardText(content, { source: relPath, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/landmark/destination.ts:17:import type { LandmarkDestinationData } from "../../schemas/landmark.js";
callback-box/src/core/load-context.ts:2: * Build the LoadCardContext for a box: built-in frontmatter schemas plus
callback-box/src/core/load-context.ts:3: * all element schemas (built-in and box-local). The one shared home for
callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/src/core/load-context.ts:9:import { createCardSchemaMap, createSchemaRegistry } from "../schemas/registry.js";
callback-box/src/core/load-context.ts:12:  const registry = await createSchemaRegistry(boxRoot);
callback-box/src/core/load-context.ts:13:  const elementSchemas = new Map<string, ElementSchema>();
callback-box/src/core/load-context.ts:16:    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/src/core/load-context.ts:18:  return { cardSchemas: await createCardSchemaMap(boxRoot), elementSchemas };
callback-box/test/search-extract.doctest.md:6:out of the index — see `src/schemas/email-message.tsx`).
callback-box/test/search-extract.doctest.md:16:import { schemas, createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/test/search-extract.doctest.md:21:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/src/core/body-refs.ts:18: * choice. Markdoc is one such syntax; future schemas with a different
callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/index.ts:12:import { schemas } from "../../schemas/registry.js";
callback-box/src/core/agent-guide/index.ts:50:  allSchemas?: ElementSchema[];
callback-box/src/core/agent-guide/index.ts:58:    allSchemas = schemas,
callback-box/src/dev/prompt-report.ts:13:import { schemas } from "../schemas/registry.js";
callback-box/src/dev/prompt-report.ts:99:  for (const schema of schemas) {
callback-box/src/dev/prompt-report.ts:103:      source: `src/schemas/ → ${schema.tagName} schema instructions`,
callback-box/src/connectors/telegram-outbound.ts:9:import type { ChatThreadFields } from "../schemas/chat-thread.js";
callback-box/src/webapp/routes/scheduler.ts:15:} from "../../schemas/scheduled-script.js";
callback-box/src/webapp/routes/scheduler.ts:17:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/webapp/routes/scheduler.ts:116:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/landmark/resolve.ts:16:} from "../../schemas/landmark.js";
callback-box/src/core/card-lint.ts:101:    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
callback-box/src/core/maps/precheck-ignore.ts:46: * (`config/connectors/`, `config/schemas/`). Per-box MAPs add nothing
callback-box/src/core/maps/precheck-ignore.ts:71:  "config/schemas/**",
callback-box/src/core/triage-routing.ts:16:import { createSelectQuestionTemplate } from "../schemas/question.js";
callback-box/src/core/init-rules.ts:2: * Generate `.claude/rules/` files from card schemas and connector-specific
callback-box/src/core/init-rules.ts:13:import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/init-rules.ts:89:  // Load box-local schemas alongside built-in ones. Card rules cover
callback-box/src/core/init-rules.ts:90:  // both legacy XML schemas (ElementSchema with `tagName`) and phase-2
callback-box/src/core/init-rules.ts:91:  // frontmatter schemas (CardSchema with `type`); each gets a
callback-box/src/core/init-rules.ts:97:    ...schemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
callback-box/src/core/init-rules.ts:98:    ...boxSchemas.elementSchemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:7:import { getAllTemplates } from "../../schemas/templates.js";
callback-box/src/core/agent-guide/cards.ts:9:export function cardTypesSection(allSchemas: ElementSchema[]): string[] {
callback-box/src/core/agent-guide/cards.ts:19:  lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
callback-box/src/core/box.ts:177:  // Install schemas guide CLAUDE.md if missing
callback-box/src/core/landmark/list-destinations.ts:13:import { parseLandmarkFields, type LandmarkSymbolData } from "../../schemas/landmark.js";
callback-box/src/core/loader-registrations.ts:9:import { memoLoader } from "../schemas/memo.js";
callback-box/src/core/loader-registrations.ts:10:import { imageLoader } from "../schemas/image.js";
callback-box/src/core/landmark/features.ts:16:import { parseLandmarkFields, type LandmarkNavigationData } from "../../schemas/landmark.js";
callback-box/src/core/box-templates.ts:5: * embedded string (tricks scaffolding, the schemas authoring guide, the views
callback-box/src/core/box-templates.ts:7: * no-ops on re-run; the schemas guide goes through the template tracker
callback-box/src/core/box-templates.ts:19:Box-local schemas let you define new card types inside your box. Each schema is a \`.ts\` file
callback-box/src/core/box-templates.ts:20:in \`config/schemas/\` that uses the same tools as built-in schemas.
callback-box/src/core/box-templates.ts:28:Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:
callback-box/src/core/box-templates.ts:48:The filename becomes the card type: \`config/schemas/task.ts\` → \`*.task.card\` files.
callback-box/src/core/box-templates.ts:106:From \`cardworks\` (legacy — only for \`element()\` XML schemas, see below):
callback-box/src/core/box-templates.ts:115:Export a \`template\` to enable \`cb create\` for your card type. For frontmatter schemas,
callback-box/src/core/box-templates.ts:159:## Legacy: XML / \`element()\` schemas
callback-box/src/core/box-templates.ts:181:interpolated values. See the built-in XML schemas in callback-box's \`src/schemas/\` for examples.
callback-box/src/core/box-templates.ts:328: * sha256 of the pre-frontmatter, XML-only schemas guide shipped before the
callback-box/src/core/box-templates.ts:339: * Install (or refresh) the box-local schemas guide. Uses the template tracker
callback-box/src/core/box-templates.ts:346:    relPath: "config/schemas/CLAUDE.md",
callback-box/src/core/schedule-state.ts:327: * overkill here and would couple this helper to the schemas package. Stale
callback-box/src/core/schedule-health.ts:24:} from "../schemas/scheduled-script.js";
callback-box/src/dev/knowledge-audits.yaml:88:    tags: [cards, schemas]
callback-box/src/dev/knowledge-audits.yaml:95:    tags: [cards, schemas]
callback-box/src/dev/knowledge-audits.yaml:103:    tags: [cards, schemas, questions]
callback-box/src/dev/knowledge-audits.yaml:133:    watch_for: "Navigates to config/schemas/ and finds CLAUDE.md"
callback-box/src/dev/knowledge-audits.yaml:134:    should_read: ["config/schemas/CLAUDE.md"]
callback-box/src/dev/knowledge-audits.yaml:135:    tags: [schemas, extension]
callback-box/src/dev/knowledge-audits.yaml:137:  # Status (2026-06-18): pass (verified). Agent discovered config/schemas/CLAUDE.md
callback-box/src/dev/knowledge-audits.yaml:139:  # card-lint.ts branch. Convention also in the repo's docs/adding-schemas.md.
callback-box/src/dev/knowledge-audits.yaml:151:    should_read: ["config/schemas/CLAUDE.md"]
callback-box/src/dev/knowledge-audits.yaml:153:    tags: [schemas, extension, validation]
callback-box/src/dev/knowledge-audits.yaml:418:    watch_for: "Discovers config/schemas/CLAUDE.md to create a custom card type rather than suggesting memos"
callback-box/src/dev/knowledge-audits.yaml:419:    should_read: ["config/schemas/CLAUDE.md"]
callback-box/src/dev/knowledge-audits.yaml:420:    tags: [schemas, extension]
callback-box/src/dev/knowledge-audits.yaml:422:      Agent correctly creates config/schemas/book.ts but may skip reading
callback-box/src/dev/knowledge-audits.yaml:425:      the should_read check is too strict. Reading any file in config/schemas/
callback-box/src/dev/knowledge-audits.yaml:431:    watch_for: "Says yes and navigates to schemas, not 'card types are built-in'"
callback-box/src/dev/knowledge-audits.yaml:432:    should_read: ["config/schemas/CLAUDE.md"]
callback-box/src/dev/knowledge-audits.yaml:433:    tags: [schemas, extension]
callback-box/src/dev/knowledge-audits.yaml:438:    watch_for: "Lists extension mechanisms: procedures, tricks, guides, schedules; bonus if mentions schemas"
callback-box/src/dev/knowledge-audits.yaml:445:    tags: [cards, schemas, extension]
callback-box/src/dev/knowledge-audits.yaml:1455:    tags: [landmarks, schemas]
callback-box/src/dev/knowledge-audits.yaml:1468:    tags: [landmarks, schemas]
callback-box/src/dev/knowledge-audits.yaml:1710:    tags: [triage-pipeline, landmarks, schemas]
callback-box/src/dev/knowledge-audits.yaml:1842:  # Cross-cutting finding: generate-docs.ts iterates `schemas` (6 XML legacy
callback-box/src/dev/knowledge-audits.yaml:1843:  # schemas) but never `cardSchemas` (24 phase-2 YAML schemas), so
callback-box/src/dev/knowledge-audits.yaml:1859:      stale (still shows XML) because generate-docs.ts iterates `schemas`
callback-box/src/dev/knowledge-audits.yaml:1918:      Names `docs/generated/card-bookmark.md` or `src/schemas/bookmark.ts`
callback-box/src/dev/knowledge-audits.yaml:1919:      (or a box-local `config/schemas/bookmark.ts`) as where to look.
callback-box/src/dev/knowledge-audits.yaml:1924:    correct_contains_any: ["docs/generated/", "src/schemas/", "config/schemas/"]
callback-box/src/dev/knowledge-audits.yaml:1925:    tags: [schemas, discovery]
callback-box/src/dev/knowledge-audits.yaml:1940:    tags: [schemas, knowledge]
callback-box/src/dev/knowledge-audits.yaml:2536:      config/schemas/) and built views/sandbox.tsx as its UI. But when the
callback-box/src/webapp/routes/chat-audio-routes.ts:29:} from "../../schemas/personality.js";
callback-box/src/core/chat-session-prompts.ts:14:- Data is stored as XML card files (\`Name.type.card\`) validated by schemas, in directories that reflect lifecycle stage
callback-box/src/core/triage-instructions.ts:13:import { parseLandmarkFields, type LandmarkFields } from "../schemas/landmark.js";
callback-box/src/core/schedule-health-alert.ts:27:import { createTelegramMessageTemplate } from "../schemas/telegram-message.js";
callback-box/src/core/generate-docs-content.ts:10:import { getTemplatesForCardType, describeTemplateArgs } from "../schemas/templates.js";
callback-box/src/core/generate-docs-compile.ts:13:import { parseGuide, parseGuideCard, compileGuide } from "../schemas/guide.js";
callback-box/src/core/generate-docs-compile.ts:14:import { compilePersonality, compileSpeakingVoice, type PersonalityFields } from "../schemas/personality.js";
callback-box/src/core/generate-docs-compile.ts:15:import { compileBriefing, type BriefingFields } from "../schemas/briefing.js";
callback-box/src/core/generate-docs-compile.ts:17:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/core/generate-docs-compile.ts:86:      schemas: await createCardSchemaMap(boxRoot),
callback-box/src/core/generate-docs-compile.ts:360:      schemas: await createCardSchemaMap(boxRoot),
callback-box/src/core/card-io.ts:21:import { parseCard, type ElementSchema, type ElementNode } from "cardworks";
callback-box/src/core/card-io.ts:111:  { source, schemas, type }: { source: string; schemas: Map<string, CardSchema>; type?: string }
callback-box/src/core/card-io.ts:121:  const schema = schemas.get(resolved);
callback-box/src/core/card-io.ts:278: * schemas coexist; callers narrow on `kind` to access the right shape.
callback-box/src/core/card-io.ts:293:  readonly schema: ElementSchema | undefined;
callback-box/src/core/card-io.ts:300:  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
callback-box/src/core/card-io.ts:301:  elementSchemas: Map<string, ElementSchema>;
callback-box/src/core/card-io.ts:311: *   tag's ElementSchema (if any) is used for validation.
callback-box/src/core/card-io.ts:335:      const parsed = parseCardText(content, { source, schemas: ctx.cardSchemas, type: fileType });
callback-box/src/core/card-io.ts:352: * their schemas are registered under hyphenated names, so e.g.
callback-box/src/core/card-io.ts:372:  const schema = ctx.elementSchemas.get(element.tagName);
callback-box/src/core/schedule-health-box.ts:21:} from "../schemas/scheduled-script.js";
callback-box/src/core/schedule-health-box.ts:23:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/core/schedule-health-box.ts:102:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/generate-docs.ts:16:import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/generate-docs.ts:162:  await checkDir(join(boxRoot, "config/schemas"), /\.ts$/);
callback-box/src/core/generate-docs.ts:217:  /^config\/schemas\/CLAUDE\.md$/,
callback-box/src/core/generate-docs.ts:247:  // Refresh the box-local schemas guide so boxes carrying the old XML-only
callback-box/src/core/generate-docs.ts:315:  allSchemas: typeof schemas;
callback-box/src/core/generate-docs.ts:343:    // Per-schema generated docs cover both legacy XML schemas (ElementSchema
callback-box/src/core/generate-docs.ts:344:    // with `tagName`) and phase-2 frontmatter schemas (CardSchema with
callback-box/src/core/generate-docs.ts:345:    // `type`). Both expose an optional `instructions` field; only schemas
callback-box/src/core/generate-docs.ts:353: * `instructions` (both legacy XML and phase-2 frontmatter schemas).
callback-box/src/core/generate-docs.ts:358:  allSchemas: typeof schemas;
callback-box/src/core/generate-docs.ts:416:  // Load box-local schemas alongside built-in ones. Both formats are
callback-box/src/core/generate-docs.ts:417:  // box-aware: legacy XML element schemas join allSchemas, phase-2
callback-box/src/core/generate-docs.ts:418:  // frontmatter card schemas join allCardSchemas.
callback-box/src/core/generate-docs.ts:420:  const allSchemas = [...schemas, ...boxSchemas.elementSchemas];
callback-box/src/core/search/contains-update.ts:4: * docs/adding-schemas.md § Mutating), then re-bases the staleness sidecar
callback-box/src/core/search/contains-update.ts:13:import { getSearchableTypes } from "../../schemas/registry.js";
callback-box/src/core/box-defaults.ts:15:import { createInitialGuideTemplate } from "../schemas/guide.js";
callback-box/src/core/box-defaults.ts:16:import { createScheduledScriptTemplate } from "../schemas/scheduled-script.js";
callback-box/src/core/box-defaults.ts:17:import { createInitialPersonalityTemplate } from "../schemas/personality.js";
callback-box/src/core/box-defaults.ts:18:import { createBriefingTemplate } from "../schemas/briefing.js";
callback-box/src/core/box-defaults.ts:19:import { createLandmarkTemplate } from "../schemas/landmark.js";
callback-box/src/core/search/query.ts:8:import { getSearchableTypes } from "../../schemas/registry.js";
callback-box/src/core/procedure/gc.ts:11:import { parseProcedureRun } from "../../schemas/procedure-run.js";
callback-box/src/core/procedure/gc.ts:14:import { parseDuration } from "../../schemas/scheduled-script-duration.js";
callback-box/src/core/generate-docs-cb-commands.ts:10:import { getAllTemplates } from "../schemas/templates.js";
callback-box/src/core/procedure/engine-parse.ts:10:} from "../../schemas/procedure.js";
callback-box/src/core/procedure/run-expiry.ts:12:import { parseDuration } from "../../schemas/scheduled-script-duration.js";
callback-box/src/core/procedure/engine.ts:11:import { parseProcedureRun } from "../../schemas/procedure-run.js";
callback-box/src/webapp/context.ts:14:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/webapp/context.ts:15:import type { QuestionFields } from "../schemas/question.js";
callback-box/src/webapp/context.ts:32:  const schemas = await createCardSchemaMap(root);
callback-box/src/webapp/context.ts:41:      const card = parseCardText(content, { source: q.path, schemas });
callback-box/src/core/commands/scan-import-document.ts:12:import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
callback-box/src/core/commands/scan-import-document.ts:13:import { createFileTemplate } from "../../schemas/file.js";
callback-box/src/core/search/refresh.ts:18:import { getSearchableTypes } from "../../schemas/registry.js";
callback-box/src/core/commands/transcribe-captures.ts:20:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/transcribe-captures.ts:21:import { type AudioFields } from "../../schemas/audio.js";
callback-box/src/core/commands/transcribe-captures.ts:36:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/transcribe-captures.ts:44:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/assemble-timeline-helpers.ts:7:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/assemble-timeline-helpers.ts:8:import type { ImageFields } from "../../schemas/image.js";
callback-box/src/core/commands/assemble-timeline-helpers.ts:9:import type { AudioFields } from "../../schemas/audio.js";
callback-box/src/core/commands/assemble-timeline-helpers.ts:17:      schemas: await createCardSchemaMap(),
callback-box/src/core/commands/assemble-timeline-helpers.ts:33:      schemas: await createCardSchemaMap(),
callback-box/src/core/search/extract.ts:13: * because the content is untrusted (see src/schemas/email-message.tsx) and
callback-box/src/core/commands/answer.ts:19:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/answer.ts:20:import { type QuestionFields } from "../../schemas/question.js";
callback-box/src/core/commands/answer.ts:21:import { createQuestionFollowupJobTemplate } from "../../schemas/question-followup-job.js";
callback-box/src/core/commands/answer.ts:55:      schemas: await createCardSchemaMap(),
callback-box/src/cards/index.ts:6: * Box-local schemas (`config/schemas/*.ts`) import these via the public
callback-box/src/cli/commands/session-modes.ts:18:import { parseDuration } from "../../schemas/scheduled-script.js";
callback-box/src/cards/schema.ts:5: * Card schemas describe a card file's full shape: most fields live in the
callback-box/src/core/commands/scan-import.ts:42:import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
callback-box/src/core/commands/create.ts:20:} from "../../schemas/index.js";
callback-box/src/frontend/src/file-types/builtins.tsx:17:import type { ImageAttrs } from "../../../schemas/image";
callback-box/src/cli/commands/create.ts:16:} from "../../schemas/index.js";
callback-box/src/core/commands/move-phase2.ts:5: * legacy XML schemas (procedure, guide, landmark, capture-session,
callback-box/src/core/commands/move-phase2.ts:12: * against the registered Phase-2 card schemas. Anything else (XML
callback-box/src/core/commands/move-phase2.ts:20:import { cardSchemas } from "../../schemas/registry.js";
callback-box/src/core/commands/describe-images-card.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/describe-images-card.ts:16:import { type ImageFields } from "../../schemas/image.js";
callback-box/src/core/commands/describe-images-card.ts:23:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/describe-images-card.ts:31:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/scan-import-cards.ts:21:import { createImageTemplate } from "../../schemas/image.js";
callback-box/src/core/commands/scan-import-cards.ts:22:import { createTextQuestionTemplate } from "../../schemas/question.js";
callback-box/src/schemas/index.ts:2: * Schema module - exports all schemas and registry utilities.
callback-box/src/schemas/index.ts:7:  schemas,
callback-box/src/schemas/index.ts:8:  createSchemaRegistry,
callback-box/src/schemas/gdoc.tsx:13: * Distinct from the generic `doc` schema (`src/schemas/doc.tsx`), which
callback-box/src/cli/commands/scheduled.ts:13:} from "../../schemas/scheduled-script.js";
callback-box/src/cli/commands/scheduled.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/scheduled.ts:53:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:7:} from "../../../schemas/scheduled-script.js";
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:9:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:144:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/commands/index.ts:41:export { getTemplateNames } from "../../schemas/index.js";
callback-box/src/webapp/trpc/routers/todos.ts:13:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/todos.ts:14:import { type TodoItem, type TodoItemStatusType, type TodoListFields } from "../../../schemas/todo-list.js";
callback-box/src/webapp/trpc/routers/todos.ts:68:        parsed = parseCardText(content, { source: fullPath, schemas: cardSchemas, type: "todo-list" });
callback-box/src/webapp/trpc/routers/scheduler-run.ts:2:import type { parseScheduledScript } from "../../../schemas/scheduled-script.js";
callback-box/src/webapp/trpc/routers/card.ts:10:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/card.ts:70:    const parsed = parseCardText(raw, { source, schemas: cardSchemas, type });
callback-box/src/webapp/trpc/routers/landmarks.ts:18:import { parseLandmarkFields, type LandmarkNavigationData } from "../../../schemas/landmark.js";
callback-box/src/cli/commands/init.ts:109:      // Generate card-handling rules from schemas
callback-box/src/cli/commands/validate.ts:2: * cb validate - Validate cards and markdown against schemas/rules
callback-box/src/schemas/templates.ts:2: * Template registry - defines card templates with inspectable argument schemas.
callback-box/src/cli/commands/tick.ts:13:} from "../../schemas/scheduled-script.js";
callback-box/src/cli/commands/tick.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/tick.ts:104:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/tick-utils.ts:14:} from "../../schemas/scheduled-script.js";
callback-box/src/cli/commands/tick-utils.ts:16:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/tick-utils.ts:34:import { getDefaultTemplate } from "../../schemas/templates.js";
callback-box/src/cli/commands/tick-utils.ts:71:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/schemas/registry.ts:4: * All card schemas are registered here and exported for use
callback-box/src/schemas/registry.ts:5: * by the CardLoader factory. Box-local schemas from config/schemas/
callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema } from "cardworks";
callback-box/src/schemas/registry.ts:52: * Built-in XML (legacy `element()`) card schemas. Now empty — every schema
callback-box/src/schemas/registry.ts:56:export const schemas: ElementSchema[] = [];
callback-box/src/schemas/registry.ts:59: * Phase-2 markdown-frontmatter card schemas. Loaded into a separate
callback-box/src/schemas/registry.ts:101: *   body, splitCardContent, …); the specifier new box schemas should use.
callback-box/src/schemas/registry.ts:124: * (under config/schemas/) can import `callback-box/cards`, `zod`, and the
callback-box/src/schemas/registry.ts:143:        context.parentURL?.includes("/config/schemas/")
callback-box/src/schemas/registry.ts:157: * Ensure config/schemas/ has a package.json with "type": "module"
callback-box/src/schemas/registry.ts:174: * Box-local schemas, segregated by format. A box's `config/schemas/*.ts`
callback-box/src/schemas/registry.ts:181:  /** Frontmatter card schemas (cardworks CardSchema, keyed by `.type`). */
callback-box/src/schemas/registry.ts:183:  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
callback-box/src/schemas/registry.ts:184:  elementSchemas: ElementSchema[];
callback-box/src/schemas/registry.ts:200: * Load box-local schemas from config/schemas/*.ts.
callback-box/src/schemas/registry.ts:219:  const empty: BoxSchemas = { cardSchemas: [], elementSchemas: [] };
callback-box/src/schemas/registry.ts:220:  const schemasDir = join(boxRoot, "config/schemas");
callback-box/src/schemas/registry.ts:226:      console.warn(`Could not read box schemas dir ${schemasDir}, skipping box-local schemas:`, e);
callback-box/src/schemas/registry.ts:235:  const loadedElement: ElementSchema[] = [];
callback-box/src/schemas/registry.ts:249:      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
callback-box/src/schemas/registry.ts:250:      // Zod type carrying `.tagName`; check it first, because ElementSchema also
callback-box/src/schemas/registry.ts:254:      if (isElementSchema(def)) {
callback-box/src/schemas/registry.ts:271:  return { cardSchemas: loadedCard, elementSchemas: loadedElement };
callback-box/src/schemas/registry.ts:274:function isElementSchema(def: unknown): def is ElementSchema {
callback-box/src/schemas/registry.ts:275:  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
callback-box/src/schemas/registry.ts:288: * Create a SchemaRegistry populated with all known schemas.
callback-box/src/schemas/registry.ts:290: * If boxRoot is provided, also loads box-local schemas from config/schemas/.
callback-box/src/schemas/registry.ts:292:export async function createSchemaRegistry(boxRoot?: string): Promise<SchemaRegistry> {
callback-box/src/schemas/registry.ts:293:  const registry = new SchemaRegistry();
callback-box/src/schemas/registry.ts:294:  for (const schema of schemas) {
callback-box/src/schemas/registry.ts:298:    const { elementSchemas } = await loadBoxSchemas(boxRoot);
callback-box/src/schemas/registry.ts:299:    for (const schema of elementSchemas) {
callback-box/src/schemas/registry.ts:307: * Get all schemas (built-in + box-local).
callback-box/src/schemas/registry.ts:309: * If boxRoot is provided, includes box-local schemas.
callback-box/src/schemas/registry.ts:311:export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
callback-box/src/schemas/registry.ts:312:  if (!boxRoot) return schemas;
callback-box/src/schemas/registry.ts:313:  const { elementSchemas } = await loadBoxSchemas(boxRoot);
callback-box/src/schemas/registry.ts:314:  return [...schemas, ...elementSchemas];
callback-box/src/schemas/registry.ts:322:    ...schemas.map(s => s.tagName),
callback-box/src/schemas/registry.ts:329: * whose schema doesn't set `searchable: false`. Includes box-local schemas
callback-box/src/schemas/registry.ts:333:  const elementSchemas = await getAllSchemas(boxRoot);
callback-box/src/schemas/registry.ts:337:    ...elementSchemas.filter(s => s.searchable !== false).map(s => s.tagName),
callback-box/src/schemas/registry.ts:347:    schemas.some(s => s.tagName === type)
callback-box/src/schemas/registry.ts:355: * When boxRoot is given, box-local frontmatter schemas (from
callback-box/src/schemas/registry.ts:356: * config/schemas/*.ts) are merged in on top of the built-in ones, so box
callback-box/src/schemas/registry.ts:374:// Re-export individual schemas for direct access
callback-box/src/cli/commands/tick-helpers.ts:11:} from "../../schemas/scheduled-script.js";
callback-box/src/cli/commands/tick-helpers.ts:12:import type { ParsedScheduledScript } from "../../schemas/scheduled-script.js";
callback-box/src/webapp/trpc/routers/scheduler.ts:14:} from "../../../schemas/scheduled-script.js";
callback-box/src/webapp/trpc/routers/scheduler.ts:16:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/scheduler.ts:152:      const card = parseCardText(content, { source: fileName, schemas: await createCardSchemaMap(ctx.boxRoot) });
callback-box/src/cli/lib/fetch.ts:19:import { parseDuration } from "../../schemas/scheduled-script.js";
callback-box/src/cli/lib/paths.ts:59:  schemas: "config/schemas",
callback-box/src/cli/lib/loader.ts:4: * Creates a configured CardLoader instance with all known schemas.
callback-box/src/cli/lib/loader.ts:8:import { createSchemaRegistry } from "../../schemas/registry.js";
callback-box/src/cli/lib/loader.ts:20: * Loads both built-in schemas and any box-local schemas from config/schemas/.
callback-box/src/cli/lib/loader.ts:32:    schemas: await createSchemaRegistry(boxRoot),
callback-box/src/cli/lib/loader.ts:62:    schemas: await createSchemaRegistry(),
callback-box/src/frontend/src/lib/speech-parsing.ts:7:import { VOICE_MODELS, type VoiceModel } from "../../../schemas/personality";
callback-box/src/frontend/src/components/file-entries/ImageCardListEntry.tsx:10:import type { ImageAttrs } from "../../../../schemas/image";
callback-box/src/frontend/src/components/chat/InteractiveChat-sse.ts:21:import type { CompiledSpeakingVoice } from "../../../../schemas/personality";

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/load-context.ts | sed -n '1,80p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Build the LoadCardContext for a box: built-in frontmatter schemas plus
     3	 * all element schemas (built-in and box-local). The one shared home for
     4	 * what validate, the sdk hooks, and search each used to duplicate.
     5	 */
     6	
     7	import type { ElementSchema } from "cardworks";
     8	import type { LoadCardContext } from "./card-io.js";
     9	import { createCardSchemaMap, createSchemaRegistry } from "../schemas/registry.js";
    10	
    11	export async function buildLoadContext(boxRoot: string): Promise<LoadCardContext> {
    12	  const registry = await createSchemaRegistry(boxRoot);
    13	  const elementSchemas = new Map<string, ElementSchema>();
    14	  for (const tag of registry.tagNames()) {
    15	    const schema = registry.get(tag);
    16	    if (schema) elementSchemas.set(tag, schema as ElementSchema);
    17	  }
    18	  return { cardSchemas: await createCardSchemaMap(boxRoot), elementSchemas };
    19	}

codex
There’s one more non-obvious `schemas` consumer: reactor batch jobs. Because `schemas[]` is empty now, it may already be vestigial, but dropping the export will require either deleting that XML batch-job path or replacing it with `cardSchemas` semantics.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/reactor/batch-jobs.ts | sed -n '1,170p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Batch job processing — groups non-chat jobs into a single agent session.
     3	 *
     4	 * This is the original reactor processing mode: all pending jobs are
     5	 * described in one prompt, and the agent processes them sequentially,
     6	 * calling `cb finish` after each. Efficient for small, independent jobs.
     7	 */
     8	
     9	import * as path from "node:path";
    10	import * as fs from "node:fs/promises";
    11	import { schemas } from "../../schemas/registry.js";
    12	import { ensureAgentCommitted, captureBaseline } from "../agent.js";
    13	import { buildReactorSystemPrompt, buildReactorUserPrompt } from "./prompts.js";
    14	import type { ProcessJobsOptions, JobWithContent } from "./types.js";
    15	
    16	/**
    17	 * Process agent jobs in a single batched agent session.
    18	 */
    19	export async function processBatchJobs(opts: ProcessJobsOptions): Promise<boolean> {
    20	  const { jobs, boxRoot, typeFilter, dryRun, onLog } = opts;
    21	  const jobPaths = jobs.map((j) => j.relPath);
    22	  const jobDescriptions: string[] = [];
    23	
    24	  for (const job of jobs) {
    25	    if (job.content) {
    26	      jobDescriptions.push(await buildJobDescription(job, boxRoot));
    27	    } else {
    28	      const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
    29	      jobDescriptions.push(`### ${job.relPath}${priorityLabel}\n(could not read)`);
    30	    }
    31	  }
    32	
    33	  const systemPrompt = buildReactorSystemPrompt(boxRoot);
    34	  const userPrompt = buildReactorUserPrompt(jobPaths, jobDescriptions);
    35	
    36	  if (dryRun) {
    37	    onLog?.("\n[DRY RUN] Would run agent with prompt:\n");
    38	    onLog?.(userPrompt + "\n");
    39	    return true;
    40	  }
    41	
    42	  onLog?.("\n");
    43	  const maxTurns = typeFilter ? 10 : 30;
    44	  const agent = opts.createAgent({
    45	    name: "reactor-batch",
    46	    ...(onLog && { onOutput: onLog }),
    47	  });
    48	
    49	  const baseline = await captureBaseline(boxRoot);
    50	  const agentResult = await agent.invoke({
    51	    boxRoot,
    52	    systemPrompt,
    53	    prompt: userPrompt,
    54	    maxTurns,
    55	    maxBudgetUsd: 10,
    56	  });
    57	
    58	  await ensureAgentCommitted({
    59	    boxRoot,
    60	    agent,
    61	    baseline,
    62	    fallbackMessage: "Reactor: agent work (fallback commit)",
    63	    fallbackTrailers: { Phase: "reactor" },
    64	    ...(onLog ? { onOutput: onLog } : {}),
    65	  });
    66	
    67	  return agentResult.success;
    68	}
    69	
    70	/**
    71	 * Build a formatted job description with inlined refs and schema instructions.
    72	 */
    73	export async function buildJobDescription(job: JobWithContent, boxRoot: string): Promise<string> {
    74	  const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
    75	  let desc = `### ${job.relPath}${priorityLabel}\n\`\`\`xml\n${job.content.trim()}\n\`\`\``;
    76	
    77	  const refs = extractRefs(job.content);
    78	  for (const ref of refs) {
    79	    const refPath = path.join(boxRoot, ref);
    80	    try {
    81	      const refContent = await fs.readFile(refPath, "utf-8");
    82	      desc += `\n\n#### ${ref}\n\`\`\`xml\n${refContent.trim()}\n\`\`\``;
    83	    } catch (e) {
    84	      // Referenced file doesn't exist — omit it; the agent will discover this.
    85	      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    86	        console.debug(`Could not inline ref ${ref}:`, e);
    87	      }
    88	    }
    89	  }
    90	
    91	  const rootTag = extractRootTag(job.content);
    92	  if (rootTag) {
    93	    const instructions = getSchemaInstructions(rootTag);
    94	    if (instructions) {
    95	      desc += `\n\n#### Instructions for ${rootTag}\n${instructions}`;
    96	    }
    97	  }
    98	
    99	  return desc;
   100	}
   101	
   102	/**
   103	 * Extract ref="..." attributes from elements like <thread ref="..."> and <item ref="...">.
   104	 */
   105	function extractRefs(xmlContent: string): string[] {
   106	  const refs: string[] = [];
   107	  const pattern = /<(?:thread|item)\s[^>]*ref="([^"]+)"/g;
   108	  let match;
   109	  while ((match = pattern.exec(xmlContent)) !== null) {
   110	    refs.push(match[1]!);
   111	  }
   112	  return refs;
   113	}
   114	
   115	/**
   116	 * Extract the root element tag name from XML content (e.g. "chat-job" from "<chat-job ...>").
   117	 */
   118	function extractRootTag(xmlContent: string): string | null {
   119	  const match = xmlContent.match(/<([a-z][\w-]*)/);
   120	  return match ? match[1]! : null;
   121	}
   122	
   123	/**
   124	 * Look up schema instructions for a given root tag name.
   125	 */
   126	function getSchemaInstructions(tagName: string): string | null {
   127	  const schema = schemas.find((s) => s.tagName === tagName);
   128	  return schema?.instructions ?? null;
   129	}

exec
/opt/homebrew/bin/bash -lc "rg -n \"batch-jobs|detectBatch|schemas\\.find|job-card|<procedure|procedure ref|parseProcedureRun|procedure-job\" callback-box/src/core callback-box/test callback-box/docs -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/core/reactor/chat-jobs.ts:23:import { buildJobDescription } from "./batch-jobs.js";
callback-box/src/core/reactor/CLAUDE.md:10:| `batch-jobs.ts` | Batch processing: all jobs in one agent session |
callback-box/src/core/reactor/DESIGN.md:35:**File:** `batch-jobs.ts`
callback-box/src/core/reactor/batch-jobs.ts:127:  const schema = schemas.find((s) => s.tagName === tagName);
callback-box/src/core/handle.ts:6: * <procedure>` element, and invoke that procedure with the bucket of
callback-box/src/core/handle.ts:10: * Inline procedures aren't supported yet — only `<procedure ref=…/>`
callback-box/src/core/agent-guide/behavior.ts:79:    "A landmark marks its directory as a destination for one or more kinds of content via `<destination for=\"…\">`, where `for` is a space-separated set: `triage` (a routing target for the intake→triage→handle pipeline, carrying `<rules>`/`<procedure>` — see `docs/plans/triage-design.md`) and/or `commentary` (a place web-page commentary documents are filed by the clerk capture flow). When the user clarifies what kind of item belongs in which spot, update the landmark, not a guide card. (The older `<triage-destination>` element still works and means `<destination for=\"triage\">`.)",
callback-box/src/core/reactor/engine.ts:36:import { processBatchJobs } from "./batch-jobs.js";
callback-box/src/core/procedure/gc.ts:11:import { parseProcedureRun } from "../../schemas/procedure-run.js";
callback-box/src/core/procedure/gc.ts:42:    run = parseProcedureRun(content);
callback-box/src/core/procedure/engine-run-card.ts:7: * loaded (cb validate / parseProcedureRun), so the mutators here work on a
callback-box/src/core/procedure/engine-run-card.ts:75:  // load (cb validate / parseProcedureRun); the mutators trust the shape.
callback-box/src/core/triage-instructions.ts:33:   * The destination's handler procedure ref, or null if none. The triage
callback-box/src/core/procedure/engine.ts:11:import { parseProcedureRun } from "../../schemas/procedure-run.js";
callback-box/src/core/procedure/engine.ts:318:    const run = parseProcedureRun(content);
callback-box/test/handle.doctest.md:16:## Resolves the procedure ref and passes items via env
callback-box/test/reactor.doctest.md:12:import { buildJobDescription } from "../src/core/reactor/batch-jobs.js";
callback-box/docs/cards-as-markdown.md:986:<procedure-run procedure="process-captures" status="completed" started-at="..." completed-at="...">
callback-box/docs/plans/box-migration.subplan.md:133:**What.** Procedure-job cards are still XML (`<procedure ref="…">`), detected
callback-box/docs/plans/box-migration.subplan.md:143:**Direction.** Needs design: a frontmatter procedure-job representation (a
callback-box/docs/plans/box-migration.subplan.md:144:`procedure-job` schema? a field on the existing job card?), a rewritten
callback-box/docs/plans/box-migration.subplan.md:145:detector that reads frontmatter, a migrator for existing `<procedure>` job
callback-box/docs/plans/box-migration.subplan.md:147:own sub-subplan** (`procedure-job-frontmatter.subplan.md`) — flagged, not
callback-box/docs/plans/box-migration.subplan.md:205:**Critical gap:** procedure-job trampoline — migrating the cards without a
callback-box/docs/plans/box-migration.subplan.md:208:migrate procedure-job cards until then.
callback-box/docs/plans/box-migration.subplan.md:226:- **The procedure-job feature redesign** — Track 2 flags it; its design is a
callback-box/docs/plans/box-migration.subplan.md:252:`knows_directly` audit for the new procedure-job authoring shape (it changes how
callback-box/docs/plans/box-migration.subplan.md:262:4. **Track 2 sub-subplan** — design + implement the procedure-job frontmatter
callback-box/docs/plans/box-migration.subplan.md:278:  procedure-job feature is migrated, which unblocks (does not itself perform) the
callback-box/docs/plans/web-page-commentary.md:239:`triage-destination` carries `<rules>`/`<procedure>` meant for the inbox-triage
callback-box/docs/plans/web-page-commentary.md:249:- `<rules>`/`<procedure>` remain meaningful only for `for` including `triage`.
callback-box/test/procedure-engine.doctest.md:10:import { parseProcedureRun } from "../src/schemas/procedure-run.js";
callback-box/test/procedure-engine.doctest.md:49:const run = parseProcedureRun(runCard);
callback-box/test/procedure-engine.doctest.md:108:const run = parseProcedureRun(runCard);
callback-box/test/procedure-engine.doctest.md:276:const run = parseProcedureRun(runCard);
callback-box/test/procedure-engine.doctest.md:506:const okRun = parseProcedureRun(await box.read(okDir + "/run.procedure-run.card"));
callback-box/test/procedure-engine.doctest.md:511:const badRun = parseProcedureRun(await box.read(badDir + "/run.procedure-run.card"));
callback-box/test/procedure-engine.doctest.md:552:const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
callback-box/docs/plans/remove-cardworks-package.md:197:  procedure-job cards are still **XML** (`<procedure ref="...">`) — the docs
callback-box/docs/plans/remove-cardworks-package.md:201:  its own subtask — a frontmatter procedure-job representation, a rewritten
callback-box/docs/plans/remove-cardworks-package.md:202:  detector, migration of existing box `<procedure>` job cards, and updated
callback-box/docs/plans/remove-cardworks-and-xml.md:317:- **Inline procedures are dead.** No box landmark uses a `<procedure>`
callback-box/docs/plans/remove-cardworks-and-xml.md:320:  only `<procedure ref=…/>`."* So `TriageProcedure`'s
callback-box/docs/plans/triage-design.md:87:- **By reference.** `<procedure ref="..."/>` inside `<triage-destination>`. Reuses the existing procedure-running machinery directly, lets one procedure serve multiple categories, lets the handler grow without bloating the landmark.
callback-box/docs/implemented-plans/box-search.md:353:  - **Backfill**: a job-card creator in the `createIntakeJobsForUnjobbed`

exec
/opt/homebrew/bin/bash -lc "rg -n \"procedure-trampoline|detectProcedureInJob|<procedure|procedure ref|parseCard\\(\" callback-box/src callback-box/test callback-box/docs/plans/remove-cardworks-deletion.md -g '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/docs/plans/remove-cardworks-deletion.md:240:  `parseCard(...).attrs`/`children`. Rewrite to `parseCardText`/
callback-box/test/handle.doctest.md:16:## Resolves the procedure ref and passes items via env
callback-box/src/core/generate-docs-compile.ts:47:      const root = await parseCard(content, { source: filename });
callback-box/src/core/agent-guide/behavior.ts:79:    "A landmark marks its directory as a destination for one or more kinds of content via `<destination for=\"…\">`, where `for` is a space-separated set: `triage` (a routing target for the intake→triage→handle pipeline, carrying `<rules>`/`<procedure>` — see `docs/plans/triage-design.md`) and/or `commentary` (a place web-page commentary documents are filed by the clerk capture flow). When the user clarifies what kind of item belongs in which spot, update the landmark, not a guide card. (The older `<triage-destination>` element still works and means `<destination for=\"triage\">`.)",
callback-box/src/core/triage-instructions.ts:33:   * The destination's handler procedure ref, or null if none. The triage
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:61:> <procedure name="process-bookmarks">
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:183:> You can also embed a directive in a job card's `<procedure>` element:
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:187:>   <procedure ref="process-news">
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:204:**Watch for:** Describes <procedure ref='...'> in job cards and reactor trampolining
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:218:> A job card can embed a `<procedure>` element that references a procedure by name:
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:223:>   <procedure ref="process-news">
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:230:> When the **reactor** (`cb reactor`) picks up that job, it detects the `<procedure ref="...">` element and runs the procedure engine directly — no nested agent session needed. The job is automatically finished when the procedure completes. If the procedure fails, the job stays in `box/jobs/` for retry.
callback-box/src/dev/reports/knowledge-report-2026-02-24T03-50-58.md:242:> The `<directive>` element inside the procedure reference lets you customize behavior per invocation. It gets injected into every agent step's system prompt, so you can steer a reusable procedure without modifying its definition.
callback-box/src/core/handle.ts:6: * <procedure>` element, and invoke that procedure with the bucket of
callback-box/src/core/handle.ts:10: * Inline procedures aren't supported yet — only `<procedure ref=…/>`
callback-box/src/dev/knowledge-audits.yaml:297:    watch_for: "Describes <procedure ref='...'> in job cards and reactor trampolining"
callback-box/src/core/card-io.ts:371:  const element = await parseCard(content, { source });
callback-box/src/webapp/trpc/routers/card.ts:195:          const parsed = await parseCard(rawXml, { source: input.path });
callback-box/src/webapp/trpc/routers/chat.ts:103:      element = await parseCard(content, { source: absPath });

codex
**Findings**

1. **High: `loader.move()` is not dead for all frontmatter cards.**  
The plan says `loader.move()` is dead because Phase-2 cards go through `movePhase2CardFiles` + ref rewriting ([plan](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/docs/plans/remove-cardworks-deletion.md:257)). That is only true for built-in `cardSchemas`: `isPhase2CardPath()` uses `cardSchemas` imported at module load ([move-phase2.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/move-phase2.ts:20), [move-phase2.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/move-phase2.ts:46)). Migrated box-local frontmatter schemas such as `bill` are loaded via `createCardSchemaMap(boxRoot)`, but this path never consults box-local schemas. A `*.bill.card` move falls through to XML `loader.load()`/`loader.move()` ([move-operations.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/move-operations.ts:169), [move-operations.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/move-operations.ts:175)) and will fail on frontmatter. Fix: classify by file shape plus `createCardSchemaMap(ctx.boxRoot)`, or make the move path uniformly frontmatter/text-based before deleting cardworks.

2. **High: `scan-import` is live and already hits the “dead XML” path.**  
The plan lists the XML mutation as possibly rewrite-or-delete later ([plan](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/docs/plans/remove-cardworks-deletion.md:219), [plan](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/docs/plans/remove-cardworks-deletion.md:407)), but `scan-import` is a registered command ([scan-import.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/scan-import.ts:297)) and the photo flow constructs frontmatter image cards, then immediately calls `loader.load(cardPath)` and `loader.save(card)` via `applyBundleAnalysisToCard` ([scan-import.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/scan-import.ts:206), [scan-import-cards.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/scan-import-cards.ts:71), [scan-import-cards.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/scan-import-cards.ts:167)). That means this path is not just dead; it is a live command surface with a broken frontmatter write-back. Make rewrite-or-disable a deletion gate, not a follow-up.

3. **High: C2’s “simple `fs.access`” replacement misses `@version` semantics.**  
The plan says parse path + optional fragment and `fs.access` it ([plan](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/docs/plans/remove-cardworks-deletion.md:173)). `cardworks` also strips a version suffix when it looks version-like (`foo.card@1.0.0`) before resolving the path ([parse-ref.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/refs/parse-ref.ts:47)). A checker that only strips `#fragment` would warn on valid versioned refs. Other semantics to preserve: box-root absolute refs are `projectRoot + parsed.path` ([resolve.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/refs/resolve.ts:176)), bare `attach` resolves to the attach directory ([resolve.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/refs/resolve.ts:183)), fragments do not affect `exists` ([resolve.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/refs/resolve.ts:103)), and `fs.access` follows current symlink/directory behavior ([node-fs.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/fs/node-fs.ts:35)).

4. **Medium: C1 diagnosis is right, but the proposed fix is incomplete operationally.**  
`./cards` currently exports TS source ([package.json](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/package.json:7)), and `src/cards/index.ts` re-exports `./schema.js` even though source has `schema.ts` ([index.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/cards/index.ts:10)). Built JS export is the right direction. But the plan claims this matches `dist/cli/index.js`; current package main/export points there, while the actual CLI wrapper runs only `dist/cli.mjs` ([package.json](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/package.json:6), [bin/cb](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/bin/cb:25)). Also `build-cli.mjs` only builds `cli.mjs` ([build-cli.mjs](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/scripts/build-cli.mjs:23)), and `bin/cb`’s staleness check still probes `node_modules/cardworks/dist` ([bin/cb](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/bin/cb:63)). C1 needs to wire `dist/cards` into the actual dev/prod build path and remove/update the cardworks staleness probe.

5. **Medium: `/api/card/*` has no frontend caller, but it is not citation-clean “free delete.”**  
The frontend grep claim is true; I found no `/api/card` frontend caller. But the route is still registered ([api.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/webapp/routes/api.ts:98)) and doctested as public behavior ([routes-api.doctest.md](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/test/routes-api.doctest.md:72)). If it is intentionally retired, the plan should say “remove route and update/delete REST doctest/docs,” not just “no frontend caller.”

6. **Medium: the “procedure docs silently degrade to empty” claim is inaccurate.**  
`chat.ts` does catch and continue, so landmark summaries can become empty ([chat.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/webapp/trpc/routers/chat.ts:101)). But `scanProcedures()` logs a warning and emits placeholder entries with `"(could not parse)"`, not empty results ([generate-docs-compile.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/generate-docs-compile.ts:56)). Both cards are frontmatter schemas (`LandmarkSchema`, `ProcedureSchema`) ([landmark.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/schemas/landmark.ts:121), [procedure.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/schemas/procedure.ts:67)), but the verification expectation should be corrected.

7. **Medium: Track C3/C4 misses live residual importers.**  
`webapp/routes/views.ts` still imports `createLoader`/`ElementNode` for the XML `ViewCard` fallback in `/api/views/:slug/cards` ([views.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/webapp/routes/views.ts:107), [views.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/webapp/routes/views.ts:175)). Also C4’s registry removal affects generated rules/docs and the agent guide, not just `registry.ts`/`card-io.ts`: `init-rules.ts` mixes `schemas` and `boxSchemas.elementSchemas` ([init-rules.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/init-rules.ts:95)), `generate-docs.ts` computes both XML and card schemas but passes only `allSchemas` to the agent guide ([generate-docs.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/generate-docs.ts:420), [generate-docs.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/generate-docs.ts:432)), and `agent-guide/cards.ts` is still `ElementSchema`/`.tagName`-based ([cards.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/agent-guide/cards.ts:6)).

**Single Most Important Change**

Fix `cb mv` classification before deleting cardworks: make the move path recognize box-local frontmatter schemas, not just built-in `cardSchemas`. Otherwise the final deletion ships with migrated box-local cards that cannot be moved safely.
tokens used
251,500
**Findings**

1. **High: `loader.move()` is not dead for all frontmatter cards.**  
The plan says `loader.move()` is dead because Phase-2 cards go through `movePhase2CardFiles` + ref rewriting ([plan](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/docs/plans/remove-cardworks-deletion.md:257)). That is only true for built-in `cardSchemas`: `isPhase2CardPath()` uses `cardSchemas` imported at module load ([move-phase2.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/move-phase2.ts:20), [move-phase2.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/move-phase2.ts:46)). Migrated box-local frontmatter schemas such as `bill` are loaded via `createCardSchemaMap(boxRoot)`, but this path never consults box-local schemas. A `*.bill.card` move falls through to XML `loader.load()`/`loader.move()` ([move-operations.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/move-operations.ts:169), [move-operations.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/move-operations.ts:175)) and will fail on frontmatter. Fix: classify by file shape plus `createCardSchemaMap(ctx.boxRoot)`, or make the move path uniformly frontmatter/text-based before deleting cardworks.

2. **High: `scan-import` is live and already hits the “dead XML” path.**  
The plan lists the XML mutation as possibly rewrite-or-delete later ([plan](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/docs/plans/remove-cardworks-deletion.md:219), [plan](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/docs/plans/remove-cardworks-deletion.md:407)), but `scan-import` is a registered command ([scan-import.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/scan-import.ts:297)) and the photo flow constructs frontmatter image cards, then immediately calls `loader.load(cardPath)` and `loader.save(card)` via `applyBundleAnalysisToCard` ([scan-import.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/scan-import.ts:206), [scan-import-cards.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/scan-import-cards.ts:71), [scan-import-cards.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/commands/scan-import-cards.ts:167)). That means this path is not just dead; it is a live command surface with a broken frontmatter write-back. Make rewrite-or-disable a deletion gate, not a follow-up.

3. **High: C2’s “simple `fs.access`” replacement misses `@version` semantics.**  
The plan says parse path + optional fragment and `fs.access` it ([plan](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/docs/plans/remove-cardworks-deletion.md:173)). `cardworks` also strips a version suffix when it looks version-like (`foo.card@1.0.0`) before resolving the path ([parse-ref.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/refs/parse-ref.ts:47)). A checker that only strips `#fragment` would warn on valid versioned refs. Other semantics to preserve: box-root absolute refs are `projectRoot + parsed.path` ([resolve.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/refs/resolve.ts:176)), bare `attach` resolves to the attach directory ([resolve.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/refs/resolve.ts:183)), fragments do not affect `exists` ([resolve.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/refs/resolve.ts:103)), and `fs.access` follows current symlink/directory behavior ([node-fs.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/cardworks/src/fs/node-fs.ts:35)).

4. **Medium: C1 diagnosis is right, but the proposed fix is incomplete operationally.**  
`./cards` currently exports TS source ([package.json](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/package.json:7)), and `src/cards/index.ts` re-exports `./schema.js` even though source has `schema.ts` ([index.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/cards/index.ts:10)). Built JS export is the right direction. But the plan claims this matches `dist/cli/index.js`; current package main/export points there, while the actual CLI wrapper runs only `dist/cli.mjs` ([package.json](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/package.json:6), [bin/cb](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/bin/cb:25)). Also `build-cli.mjs` only builds `cli.mjs` ([build-cli.mjs](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/scripts/build-cli.mjs:23)), and `bin/cb`’s staleness check still probes `node_modules/cardworks/dist` ([bin/cb](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/bin/cb:63)). C1 needs to wire `dist/cards` into the actual dev/prod build path and remove/update the cardworks staleness probe.

5. **Medium: `/api/card/*` has no frontend caller, but it is not citation-clean “free delete.”**  
The frontend grep claim is true; I found no `/api/card` frontend caller. But the route is still registered ([api.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/webapp/routes/api.ts:98)) and doctested as public behavior ([routes-api.doctest.md](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/test/routes-api.doctest.md:72)). If it is intentionally retired, the plan should say “remove route and update/delete REST doctest/docs,” not just “no frontend caller.”

6. **Medium: the “procedure docs silently degrade to empty” claim is inaccurate.**  
`chat.ts` does catch and continue, so landmark summaries can become empty ([chat.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/webapp/trpc/routers/chat.ts:101)). But `scanProcedures()` logs a warning and emits placeholder entries with `"(could not parse)"`, not empty results ([generate-docs-compile.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/generate-docs-compile.ts:56)). Both cards are frontmatter schemas (`LandmarkSchema`, `ProcedureSchema`) ([landmark.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/schemas/landmark.ts:121), [procedure.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/schemas/procedure.ts:67)), but the verification expectation should be corrected.

7. **Medium: Track C3/C4 misses live residual importers.**  
`webapp/routes/views.ts` still imports `createLoader`/`ElementNode` for the XML `ViewCard` fallback in `/api/views/:slug/cards` ([views.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/webapp/routes/views.ts:107), [views.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/webapp/routes/views.ts:175)). Also C4’s registry removal affects generated rules/docs and the agent guide, not just `registry.ts`/`card-io.ts`: `init-rules.ts` mixes `schemas` and `boxSchemas.elementSchemas` ([init-rules.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/init-rules.ts:95)), `generate-docs.ts` computes both XML and card schemas but passes only `allSchemas` to the agent guide ([generate-docs.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/generate-docs.ts:420), [generate-docs.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/generate-docs.ts:432)), and `agent-guide/cards.ts` is still `ElementSchema`/`.tagName`-based ([cards.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/agent-guide/cards.ts:6)).

**Single Most Important Change**

Fix `cb mv` classification before deleting cardworks: make the move path recognize box-local frontmatter schemas, not just built-in `cardSchemas`. Otherwise the final deletion ships with migrated box-local cards that cannot be moved safely.
