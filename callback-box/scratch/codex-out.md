OpenAI Codex v0.137.0
--------
workdir: /Users/ianbicking/src/callback-worktrees/remove-cardworks
model: gpt-5.5
provider: openai
approval: never
sandbox: read-only
reasoning effort: high
reasoning summaries: none
session id: 019ede00-23db-74e0-9b01-1213c613313e
--------
user
IMPORTANT: Do NOT read or execute files under `~/.claude/`, `~/.agents/`, or `.claude/skills/` — those are skill definitions for a different AI runtime and will waste your time. Everything else in this repo, including `docs/` and `.claude/rules/`, is fair game.

This targets the `callback-box/` subproject. Paths like `src/…`, `docs/…`, `test/…` are under `callback-box/`; `bin/…` is at the monorepo root. You may read any repo file (read-only), including `docs/` and `.claude/rules/`, to verify claims.

You are an independent, adversarial engineering+design reviewer. A Claude model wrote callback-box/docs/plans/remove-cardworks-package.md. Read it, then read the source it cites and verify the citations and the "we already do X / free reuse / validation catches it / this path is dead / zero transitive XML dependencies" claims against the actual code — you are a different model; find what a same-model self-review would miss.

Context: this is the final round of a larger effort that already migrated all six card schemas (landmark, recipe, procedure-run, procedure, guide, capture-session) from an XML body format to YAML frontmatter (+ Markdoc body for capture-session). Those migrations are committed on this branch; the full test suite passes (2173). This plan removes the now-unused `cardworks` package.

Verify especially:
1. Is `schemas[]` (the XML ElementSchema list in callback-box/src/schemas/registry.ts) actually empty, and are the "dead path" claims real — card-io.ts loadXmlCard branch, search/extract.ts xmlDoc, ls.ts evaluateXPathString, the CardLoader users (move-operations.ts, cli/lib/loader.ts, todos.ts)? Is any "dead" path actually still reachable?
2. Is the keep-set's "zero transitive XML dependencies" claim true? Read cardworks/src/schema/card-schema.ts, parser/frontmatter.ts, schema/registry.ts, lint/format.ts (and the lint types it needs) — do any transitively import ElementNode / the XML parser / xpath?
3. Does the plan miss any callback-box cardworks consumer? Is the "TypeScript typecheck is the safety net" claim sound, or are there runtime-only / dynamic-import / test-only usages that tsc would NOT catch?
4. Is the box-migration-first sequencing actually safe, and are the migrators really the only remaining cardworks consumer besides the keep-set?

Review for, in priority: (1) wrong-problem / over-engineering — what's the minimal version, what to cut; (2) architecture flaws; (3) silent failure modes (no test AND no handling AND invisible); (4) things treated as settled that will bite in implementation; (5) incorrect/unverifiable citations — name them.

Be concrete: cite plan section + file:line. Rank by impact. Don't pad. End with the single most important change.

2026-06-19T03:50:12.317164Z ERROR codex_memories_write::phase2: Phase 2 no changes
codex
I’ll do this as a code-review pass: first anchor on the plan’s exact claims, then trace each cited path against the implementation rather than trusting the narrative. I’ll keep the `.claude/skills/` exclusion in mind and stay inside read-only inspection.
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
    16	## Stated preferences this plan trades against
    17	
    18	- **`callback-box/CLAUDE.md`** — `CLAUDE.md:28` (current): *"Every built-in
    19	  schema is now frontmatter; the legacy XML-body format and its loader branch
    20	  remain in place but dormant (no schema uses them) until cardworks is
    21	  removed."* This plan makes that sentence's promise good. Also the "don't
    22	  add features beyond what the task requires" rule — we copy in only the
    23	  primitives that are actually imported, deleting the rest.
    24	- **`callback-box/CODE-STYLE.md`** — `CODE-STYLE.md:25` (no `any`),
    25	  `CODE-STYLE.md:55` (`as` is like Rust `unsafe`; centralize at parse
    26	  boundaries), `CODE-STYLE.md` files ≤300 lines. The copied-in primitives
    27	  already obey these (they're cardworks' own clean modules).
    28	- **The migration precedent** — `remove-cardworks-and-xml.md` shipped six
    29	  schema migrations using TypeScript's typecheck as the completeness check
    30	  (each migration's consumers were found by compile errors). This plan leans
    31	  on the same mechanism harder: it is the safety net (see Direction).
    32	
    33	## What already exists
    34	
    35	- **The dead XML loader branch.** `callback-box/src/core/card-io.ts:285`:
    36	  *"export type LoadedCard = FrontmatterLoadedCard | XmlLoadedCard"*;
    37	  `card-io.ts:350` falls through to `loadXmlCard` (`card-io.ts:370`) only when
    38	  the file has no frontmatter / unknown type. With `schemas[]` empty
    39	  (`src/schemas/registry.ts`), the `elementSchemas` map is always empty and
    40	  the XML branch is unreachable for any real card. **Rebuild:** collapse the
    41	  union to `FrontmatterLoadedCard`, delete `loadXmlCard`/`XmlLoadedCard` and
    42	  the `elementSchemas` plumbing.
    43	- **The frontmatter primitives, in cardworks.** `cardSchema`/`body`/
    44	  `extractRefs` (`cardworks/src/schema/card-schema.ts`, 249 LOC, imports
    45	  `zod` only); `splitCardContent` (`cardworks/src/parser/frontmatter.ts`, 65
    46	  LOC, zero imports); `SchemaRegistry` (`cardworks/src/schema/registry.ts`,
    47	  63 LOC, generic `Map<string, ZodType>`); `formatLintResults` and the
    48	  `LintSummary`/`LintResult`/`LintIssue` types (`cardworks/src/lint/format.ts`
    49	  130 LOC + a handful of types from `lint/lint.ts`); `ParseError`
    50	  (`cardworks/src/parser/parse.ts`, ~15 LOC of the file). **Reuse by
    51	  copying:** these ~560 LOC have zero transitive XML dependencies (confirmed:
    52	  `card-schema.ts` imports only zod; `frontmatter.ts` imports nothing).
    53	- **The XML bulk, in cardworks, with no real consumer.** parser
    54	  (`parse.ts`/`dom-to-object.ts`/`provenance.ts`), `serialize/serialize.ts`,
    55	  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
    56	  `refs/resolve.ts` (261), `schema/element.ts`+`base.ts`,
    57	  `schema/format-error.ts`, `lint/lint.ts` (the engine), `card/*`, `fs/*`.
    58	  **Delete outright.**
    59	- **callback-box already owns its frontmatter card IO.**
    60	  `card-io.ts` `parseCardText` (`card-io.ts:114`) validates against
    61	  `schema.frontmatterSchema` (Zod) and formats its own Zod errors
    62	  (`card-io.ts:62` `formatZodIssues`) — it does *not* use cardworks'
    63	  `format-error.ts`. `card-lint.ts` has its own dispatcher and Markdoc
    64	  body-ref extraction (`body-refs.ts`). **Reuse:** these stay; only their
    65	  cardworks *imports* get repointed.
    66	- **Only callback-box consumes cardworks.** Verified: no imports in
    67	  `callback-clerk/`, `agent-doctest/`, or `personal-vibe-check/`.
    68	- **The migrators read old XML cards via cardworks.** `scripts/migrate/*.ts`
    69	  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
    70	  pre-migration XML box cards. This is the one place that still *needs* the
    71	  XML parser, and it is a sequencing constraint (see Open questions).
    72	
    73	## Prior art (external)
    74	
    75	Skip-with-rationale: this is a purely internal refactor — deleting a
    76	first-party workspace package and inlining ~560 LOC of its source. No
    77	third-party library behavior is in question. The one technique worth naming
    78	is **compiler-driven refactoring**: removing/!renaming the deleted exports so
    79	`tsc` enumerates every stale call site, rather than hunting them by grep. That
    80	is exactly how the six schema migrations were verified (each consumer surfaced
    81	as a type error), so it is established in-repo practice, not a novel bet. No
    82	external search performed; none warranted.
    83	
    84	## Tracks / scope
    85	
    86	Ordered by dependency: Track A removes dead/live XML consumers so nothing in
    87	callback-box imports a cardworks XML symbol; Track B copies the primitive core
    88	in and repoints the keep-set imports; Track C deletes the package and its
    89	wiring. The plan completes when cardworks is gone and the suite is green.
    90	
    91	### Track A — Sever callback-box from cardworks' XML surface
    92	
    93	**What.** Remove or rewrite every callback-box site that imports a cardworks
    94	XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
    95	`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
    96	`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
    97	only cardworks imports left are the frontmatter keep-set.
    98	
    99	**Why this needs to change.** These symbols are the API of the half of
   100	cardworks we're deleting. While they remain imported, cardworks can't go.
   101	Most sites are dead (unreachable now that no card is XML); a few are live and
   102	need a frontmatter replacement.
   103	
   104	**Direction.** Per the investigation, by disposition:
   105	
   106	- **Delete dead paths.** `card-io.ts` XML branch (`loadXmlCard`,
   107	  `XmlLoadedCard`, the `LoadedCard` union, `elementSchemas` in
   108	  `LoadCardContext`); `search/extract.ts` `xmlDoc`/`collectElementText` and
   109	  the `card.kind === "xml"` dispatch (`extract.ts:103`);
   110	  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
   111	  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
   112	  a frontmatter-field lookup (the dotted-path accessor already written for
   113	  landmark in `core/landmark/resolve.ts` is the model);
   114	  `preactions/transcribe.ts` XML transcription helpers;
   115	  `reactor/procedure-trampoline.ts` XML `<procedure ref>` detection;
   116	  `webapp/trpc/routers/todos.ts` (XML `loader.load`/mutate/`save`);
   117	  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
   118	- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
   119	  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
   120	  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
   121	  discovery and `loader.move()` for XML referrer re-serialization), and any
   122	  router that calls `createLoader`. The discovery use (`listCards()`) becomes
   123	  a glob/fs walk; the XML `move()` is dead (Phase-2 cards take
   124	  `movePhase2CardFiles`, and ref rewriting is already substring-based in
   125	  `rewrite-card-refs.ts`). `cli/commands/validate.ts` keeps
   126	  `formatLintResults` (it moves to the keep-set, Track B).
   127	- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
   128	  (`file-summary.ts`, `agent-guide/*`, `load-context.ts`, `preactions/types.ts`,
   129	  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
   130	  fields or now-empty code. Delete the XML field/branch; where a type is
   131	  genuinely still needed it is replaced by a local type or removed with the
   132	  dead path.
   133	
   134	**Compiler as the checklist.** After repointing the keep-set (Track B), the
   135	deleted XML exports vanish; `pnpm typecheck` then enumerates every remaining
   136	stale consumer. A site the agents flagged as a latent bug (e.g.
   137	`chat.ts` reading a now-frontmatter landmark via `parseCard`,
   138	`generate-docs-compile.ts:47` parsing a procedure via `parseCard`) surfaces
   139	here and is fixed or deleted — none can be silently missed. (These pass tests
   140	today only because no test exercises them; the typecheck is what closes the
   141	gap.)
   142	
   143	**First implementation chunk.** Delete the three unambiguously-dead,
   144	self-contained paths and confirm green: `card-io.ts` XML branch + union
   145	collapse; `search/extract.ts` `xmlDoc`; `ls.ts` `--format`/XPath. No open
   146	questions inside this chunk.
   147	
   148	### Track B — Copy the frontmatter primitives into callback-box
   149	
   150	**What.** Create a callback-box module (proposed `src/cards/`) holding the
   151	keep-set, and repoint every `from "cardworks"` keep-set import to it.
   152	
   153	**Why this needs to change.** `cardSchema`/`body`/`splitCardContent`/
   154	`CardSchema`/`SchemaRegistry`/`formatLintResults`/`ParseError` are imported by
   155	~50 callback-box files (every schema file plus `card-io.ts`, `card-lint.ts`,
   156	`registry.ts`, `validate.ts`). They must live in callback-box before cardworks
   157	can be deleted.
   158	
   159	**Direction.** New files under `src/cards/`:
   160	- `schema.ts` ← `cardworks/src/schema/card-schema.ts` (`cardSchema`, `body`,
   161	  `isBodyField`, `extractRefs`, types `CardSchema`/`BodyField`/`FieldDecl`).
   162	  Imports zod only — copy verbatim.
   163	- `frontmatter.ts` ← `cardworks/src/parser/frontmatter.ts` (`splitCardContent`).
   164	  Zero deps — copy verbatim.
   165	- `registry.ts` ← `cardworks/src/schema/registry.ts` (`SchemaRegistry`).
   166	- `lint-format.ts` ← `cardworks/src/lint/format.ts` (`formatLintResults`,
   167	  `formatLintResult`, `formatLintResultsJson`) plus the `LintSummary`/
   168	  `LintResult`/`LintIssue`/`LintOptions` types extracted from
   169	  `cardworks/src/lint/lint.ts`. The types reference a `Location` from the
   170	  XML `provenance.ts`; redefine a minimal local `Location`
   171	  (`{ source: string; line?: number; column?: number }`) — the formatter only
   172	  reads `source`/`line`/`column`.
   173	- `errors.ts` ← the `ParseError` class extracted from
   174	  `cardworks/src/parser/parse.ts` (used by `search/refresh-file.ts:15`), with
   175	  the same minimal local `Location`.
   176	
   177	Then a barrel `src/cards/index.ts` re-exports them, and a codemod-style
   178	find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
   179	adjusted per file) for the keep-set symbols.
   180	
   181	**Vocabulary lock-ins.** None — these are internal primitives, no
   182	agent-facing names.
   183	
   184	**First implementation chunk.** Create `src/cards/` with the two zero-dep
   185	files (`frontmatter.ts`, `schema.ts`) and repoint the schema files + `card-io.ts`
   186	to them; leave lint-format/errors for the next chunk. No open questions
   187	inside this chunk (these two files have no transitive deps).
   188	
   189	### Track C — Delete cardworks and its wiring
   190	
   191	**What.** Remove the `cardworks/` directory, the
   192	`callback-box/node_modules/cardworks` symlink, the `"cardworks": "workspace:*"`
   193	dependency (`callback-box/package.json:80`), the `- cardworks` line in
   194	`pnpm-workspace.yaml:17`, **and the now-spent XML migrators**
   195	(`scripts/migrate/*.ts` plus the `_warnings.ts`/`_harness.ts` they share, and
   196	their `MIGRATIONS` entries in `src/core/migrations.ts`); run `pnpm install` to
   197	settle the lockfile; update docs.
   198	
   199	**Why this needs to change.** The point — no cardworks. The migrators are
   200	the last cardworks consumer (they read pre-migration XML cards via
   201	`parseCard`); once every box is migrated (decided: box-migration-first) they
   202	have done their job and are deleted in the same push.
   203	
   204	**Gated on box migration.** This track runs only once (1) Tracks A+B make
   205	`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
   206	has been migrated off XML so the migrators are no longer needed. Box
   207	migration is the user's separate effort; Tracks A+B do not wait on it (they
   208	touch only callback-box source), so they land first while boxes are migrated
   209	out of band. Doc updates: `CLAUDE.md:87` (the cardworks bullet),
   210	`CLAUDE.md:39`/`docs/adding-schemas.md` (drop "from cardworks" phrasing where
   211	it now means "from `src/cards/`"); retire `docs/migrations.md` references to
   212	the deleted migrators as appropriate.
   213	
   214	**First implementation chunk.** After box migration is confirmed complete,
   215	delete the package + wiring + migrators + `pnpm install`, with a clean
   216	`pnpm typecheck && pnpm lint && pnpm test`.
   217	
   218	## Subplans
   219	
   220	None. The one sub-question (migrator dependency on the XML parser) is small
   221	enough to settle inline as an Open question with a lean, not a separate design
   222	step.
   223	
   224	## Failure modes
   225	
   226	| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
   227	|---|---|---|---|
   228	| A stale consumer reads a frontmatter card via deleted `parseCard` | Partial | Yes — `tsc` fails to compile once the symbol is gone | Clear (compile error) |
   229	| `cli/lib/loader.ts` rewrite changes card-listing semantics (misses a card / includes a non-card) | Yes — move/validate doctests | Yes — `isCardFile` filter | Clear (tests / validate output) |
   230	| `ls --format` removed but a box config / agent still calls it | No | No | **Silent** (format arg ignored) |
   231	| Copied `extractRefs` drifts from cardworks' (behavior change in ref-checking) | Yes — `cb validate` ref doctests | Yes — copy is verbatim | Clear |
   232	| Local minimal `Location` loses a field the formatter reads | Yes — validate output doctests | Yes — formatter only reads source/line/column | Clear (format looks wrong) |
   233	| Box still on XML when cardworks deleted (migrators already gone) | No | Gate: Track C waits until all boxes migrated | Clear-but-fatal (that box's cards won't load) |
   234	| Lockfile/`pnpm install` leaves a dangling `cardworks` reference | No | Partial — install errors on missing workspace pkg | Clear (install fails) |
   235	
   236	**Critical gap: `ls --format` silent removal.** `commands/ls.ts:74`'s
   237	XPath `--format` is the one user-facing feature being dropped. If an agent or
   238	box command still passes `--format`, today it would XPath-extract (broken on
   239	frontmatter anyway); after removal the arg is ignored silently. **Resolution
   240	in the plan:** either reduce `--format` to a dotted-path frontmatter accessor
   241	(reusing the landmark resolver's `lookupField`), or remove the arg from the
   242	command registration so an unknown-arg error fires. Lean: reduce to
   243	frontmatter-field lookup — small, and keeps `cb ls --format '{title}'` working.
   244	
   245	## Agent-flow / user-flow edge cases
   246	
   247	- **Wrong tag / wrong field** — **N/A.** No new vocabulary or agent-authored
   248	  shape; this is an internal package move.
   249	- **Stale ref** — **ADDRESSED (unchanged).** Ref-checking moves verbatim
   250	  (`extractRefs` copied; `body-refs.ts` already callback-box-owned); broken-ref
   251	  detection behaves identically.
   252	- **Two agents touching the same card** — **N/A.** No card-write path changes
   253	  semantics; `card-io.ts` parse-mutate-reserialize is untouched.
   254	- **Hand-edit drift** — **N/A.** Frontmatter/Markdoc parsing is unchanged.
   255	- **Fabricated free-form value** — **N/A.** No new fields.
   256	- **Validation error UX** — **ADDRESSED.** `card-io.ts:62` `formatZodIssues`
   257	  (callback-box's own) is the agent-facing validator and is untouched; the
   258	  copied `formatLintResults` is the `cb validate` CLI formatter and is copied
   259	  verbatim. Both error surfaces read as they do today.
   260	- **Partial migration / transition state** — **ADDRESSED.** The transition is

exec
/opt/homebrew/bin/bash -lc "pwd && rg --files callback-box | sed 's#"'^#/#'"' | head -200" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
/Users/ianbicking/src/callback-worktrees/remove-cardworks
/callback-box/src/services/CLAUDE.md
/callback-box/src/services/google-drive-types.ts
/callback-box/src/services/google-gmail.ts
/callback-box/src/services/index.ts
/callback-box/src/services/google-drive.ts
/callback-box/src/services/telegram.ts
/callback-box/src/services/openai-audio.ts
/callback-box/src/services/google-auth.ts
/callback-box/src/services/google-drive-fake.ts
/callback-box/src/services/claude-chat.ts
/callback-box/src/services/google-calendar.ts
/callback-box/src/services/claude-chat-queue.ts
/callback-box/src/services/claude-chat-fake.ts
/callback-box/src/services/claude-chat-types.ts
/callback-box/src/services/call-log.ts
/callback-box/src/services/claude-cli.ts
/callback-box/src/dev/CLAUDE.md
/callback-box/src/dev/doc-graph-data.ts
/callback-box/src/dev/lib/box-guard.ts
/callback-box/src/dev/lib/test-runner.ts
/callback-box/src/dev/lib/report.ts
/callback-box/src/dev/lib/session-report.ts
/callback-box/src/dev/generate-doc-images.ts
/callback-box/src/dev/doc-graph-html-data.ts
/callback-box/src/dev/generate-doc-images-parse.ts
/callback-box/src/dev/generate-doc-images-render.ts
/callback-box/src/dev/doc-graph-html.ts
/callback-box/src/dev/prompt-report.ts
/callback-box/src/dev/knowledge-audit.ts
/callback-box/src/dev/doc-graph-html-render.ts
/callback-box/src/dev/gen-image.ts
/callback-box/src/dev/doc-graph-html-css.ts
/callback-box/src/dev/knowledge-audits.yaml
/callback-box/src/dev/generate-doc-images-types.ts
/callback-box/src/dev/doc-graph.ts
/callback-box/src/lib/attach-lint.ts
/callback-box/src/lib/awake-timeout.ts
/callback-box/src/lib/package-root.ts
/callback-box/src/lib/exec-with-timeout.ts
/callback-box/src/lib/errors.ts
/callback-box/src/lib/file-lock.ts
/callback-box/src/lib/filename.ts
/callback-box/src/scenario/runner.ts
/callback-box/src/scenario/types.ts
/callback-box/src/scenario/loader.ts
/callback-box/src/schemas/guide-parse.tsx
/callback-box/src/schemas/landmark.ts
/callback-box/src/schemas/guide-elements.tsx
/callback-box/src/schemas/briefing.tsx
/callback-box/src/schemas/todo-list.ts
/callback-box/src/schemas/personality-instructions.ts
/callback-box/src/schemas/intake-job.tsx
/callback-box/src/schemas/personality-template.ts
/callback-box/src/schemas/image.tsx
/callback-box/src/schemas/chat-thread.ts
/callback-box/src/schemas/feedback.tsx
/callback-box/src/schemas/templates-describe.ts
/callback-box/src/schemas/index.ts
/callback-box/src/schemas/recipe.tsx
/callback-box/src/schemas/memo.ts
/callback-box/src/schemas/registry.ts
/callback-box/src/schemas/personality.tsx
/callback-box/src/schemas/procedure-run.ts
/callback-box/src/schemas/question.ts
/callback-box/src/schemas/commentary.tsx
/callback-box/src/schemas/scheduled-script-duration.ts
/callback-box/src/schemas/audio.tsx
/callback-box/src/schemas/email-outbound.tsx
/callback-box/src/schemas/gdoc.tsx
/callback-box/src/schemas/templates-registry.ts
/callback-box/src/schemas/procedure.ts
/callback-box/src/schemas/templates-builtins.ts
/callback-box/src/schemas/templates.ts
/callback-box/src/schemas/capture-session.tsx
/callback-box/src/schemas/guide.tsx
/callback-box/src/schemas/email-message.tsx
/callback-box/src/schemas/guide-compile.tsx
/callback-box/src/schemas/file.tsx
/callback-box/src/schemas/email-thread.tsx
/callback-box/src/schemas/person.tsx
/callback-box/src/schemas/personality-fields.ts
/callback-box/src/schemas/sheet.tsx
/callback-box/src/schemas/question-followup-job.ts
/callback-box/src/schemas/telegram-message.ts
/callback-box/src/schemas/webpage.tsx
/callback-box/src/schemas/calendar-review-job.tsx
/callback-box/src/schemas/chat-job.ts
/callback-box/src/schemas/guide-templates.tsx
/callback-box/src/schemas/personality-compile.ts
/callback-box/src/schemas/record.tsx
/callback-box/src/schemas/scheduled-script.tsx
/callback-box/src/schemas/doc.tsx
/callback-box/src/schemas/extfile.tsx
/callback-box/src/cli/bootstrap.ts
/callback-box/src/cli/index.ts
/callback-box/src/cli/commands/intake.ts
/callback-box/src/cli/commands/wakeup.ts
/callback-box/src/cli/commands/chat-audio.ts
/callback-box/src/cli/commands/reactor.ts
/callback-box/src/cli/commands/assemble-timeline.ts
/callback-box/src/cli/commands/session-render.ts
/callback-box/src/cli/commands/answer.ts
/callback-box/src/cli/commands/upload.ts
/callback-box/src/cli/commands/session-modes.ts
/callback-box/src/cli/commands/create.ts
/callback-box/src/cli/commands/index.ts
/callback-box/src/cli/commands/render.ts
/callback-box/src/cli/commands/health.ts
/callback-box/src/cli/commands/handle.ts
/callback-box/src/cli/commands/feedback.ts
/callback-box/src/cli/commands/wakeup-steps.ts
/callback-box/src/cli/commands/tick-helpers.ts
/callback-box/src/cli/commands/session.ts
/callback-box/src/cli/commands/scheduler-helpers.ts
/callback-box/src/cli/commands/finalize.ts
/callback-box/src/cli/commands/google-auth.ts
/callback-box/src/cli/commands/serve.ts
/callback-box/src/cli/commands/boxes.ts
/callback-box/src/cli/commands/ls.ts
/callback-box/src/cli/commands/session-format.ts
/callback-box/src/cli/commands/procedure.ts
/callback-box/src/cli/commands/attachments.ts
/callback-box/src/cli/commands/trash.ts
/callback-box/src/cli/commands/calendar.ts
/callback-box/src/cli/commands/validate.ts
/callback-box/src/cli/commands/chat.ts
/callback-box/src/cli/commands/transcribe-captures.ts
/callback-box/src/cli/commands/triage.ts
/callback-box/src/cli/commands/wakeup-connectors.ts
/callback-box/src/cli/commands/scheduled.ts
/callback-box/src/cli/commands/contains.ts
/callback-box/src/cli/commands/extfile.ts
/callback-box/src/cli/commands/refresh-maps.ts
/callback-box/src/cli/commands/scenario.ts
/callback-box/src/cli/commands/tick.ts
/callback-box/src/cli/commands/move.ts
/callback-box/src/cli/commands/describe-images.ts
/callback-box/src/cli/commands/search.ts
/callback-box/src/cli/commands/scheduler.ts
/callback-box/src/cli/commands/prompt.ts
/callback-box/src/cli/commands/trick.ts
/callback-box/src/cli/commands/scan-import.ts
/callback-box/src/cli/commands/init.ts
/callback-box/src/cli/commands/retro.ts
/callback-box/src/cli/commands/usage.ts
/callback-box/src/cli/commands/tick-utils.ts
/callback-box/src/cli/commands/drive.ts
/callback-box/src/cli/commands/migrate.ts
/callback-box/src/cli/commands/status.ts
/callback-box/src/cli/commands/finish.ts
/callback-box/src/cli/lib/fetch.ts
/callback-box/src/cli/lib/time.ts
/callback-box/src/cli/lib/session-content.ts
/callback-box/src/cli/lib/git.ts
/callback-box/src/cli/lib/paths.ts
/callback-box/src/cli/lib/git-log.ts
/callback-box/src/cli/lib/git-internal.ts
/callback-box/src/cli/lib/session-text.ts
/callback-box/src/cli/lib/session.ts
/callback-box/src/cli/lib/format.ts
/callback-box/src/cli/lib/git-trailers.ts
/callback-box/src/cli/lib/loader.ts
/callback-box/src/cli/lib/lock.ts
/callback-box/src/cli/lib/git-range.ts
/callback-box/src/cli/lib/session-entry.ts
/callback-box/src/shared/attach-path.ts
/callback-box/src/shared/markdoc-config.ts
/callback-box/src/webapp/server-root.ts
/callback-box/src/webapp/auth.ts
/callback-box/src/webapp/server-main.ts
/callback-box/src/webapp/routes/api-image.ts
/callback-box/src/webapp/routes/auth.ts
/callback-box/src/webapp/routes/chat-session-routes.ts
/callback-box/src/webapp/routes/clerk.ts
/callback-box/src/webapp/routes/telegram.ts
/callback-box/src/webapp/routes/capture-finalize.ts
/callback-box/src/webapp/routes/actions.ts
/callback-box/src/webapp/routes/calendar.ts
/callback-box/src/webapp/routes/capture-session-store.ts
/callback-box/src/webapp/routes/api.ts
/callback-box/src/webapp/routes/chat.ts
/callback-box/src/webapp/routes/capture.ts
/callback-box/src/webapp/routes/chat-context.ts
/callback-box/src/webapp/routes/admin.ts
/callback-box/src/webapp/routes/api-browse.ts
/callback-box/src/webapp/routes/scheduler.ts
/callback-box/src/webapp/routes/proxy-image.ts
/callback-box/src/webapp/routes/chat-uploads.ts
/callback-box/src/webapp/routes/api-card-routes.ts
/callback-box/src/webapp/routes/chat-audio-routes.ts
/callback-box/src/webapp/routes/api-debug-log.ts
/callback-box/src/webapp/routes/api-external.ts
/callback-box/src/webapp/routes/chat-helpers.ts
/callback-box/src/webapp/routes/commands.ts
/callback-box/src/webapp/routes/api-files-write.ts
/callback-box/src/webapp/routes/chat-last-audio-routes.ts
/callback-box/src/webapp/routes/views.ts
/callback-box/src/webapp/routes/chat-send-routes.ts
/callback-box/src/webapp/routes/history.ts
/callback-box/src/webapp/routes/api-card-patch.ts

exec
/opt/homebrew/bin/bash -lc 'git status --short && git rev-parse --show-toplevel' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-MGk0sjZC' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-T3x7sTiW' (errno=Operation not permitted)
?? callback-box/scratch/
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-2x1LWQBf' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-6SmwGJpR' (errno=Operation not permitted)
/Users/ianbicking/src/callback-worktrees/remove-cardworks

codex
The plan is asserting a lot from grep and typecheck, so I’m going to split the review into two traces: actual `cardworks` imports/consumers, and actual XML reachability after `schemas[]` is empty. The git warnings are from the read-only temp sandbox; status still returned enough to note an untracked `callback-box/scratch/`.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/docs/plans/remove-cardworks-package.md | sed -n '260,520p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
   260	- **Partial migration / transition state** — **ADDRESSED.** The transition is
   261	  compile-time, not data: until Track B repoints imports, both cardworks and
   262	  `src/cards/` exist; the worktree never ships a half-state because the plan
   263	  completes (cardworks gone, green) before merge. The *box-data* transition
   264	  (XML cards still in unmigrated boxes) is the migrator dependency — see Open
   265	  questions.
   266	
   267	## NOT in scope
   268	
   269	- **Re-implementing the XML loader/serializer/XPath in callback-box.** They
   270	  have zero real consumers; deleting beats porting (CLAUDE.md "don't add
   271	  features beyond what the task requires").
   272	- **Migrating the boxes themselves.** That is the user's separate task
   273	  ("I'll set you on migrating the individual boxes"). It is *not* part of this
   274	  plan's work, but it is a **prerequisite for Track C** (the deletion can't
   275	  land while a box still has XML cards the about-to-be-deleted migrators would
   276	  service). Tracks A+B are independent of it.
   277	- **Reworking `card-lint.ts` / `body-refs.ts` Markdoc validation.** Already
   278	  callback-box-owned and working; only its cardworks *imports* change.
   279	- **A general "vendor any npm dep" mechanism.** We copy these specific files;
   280	  no reusable vendoring infra.
   281	- **Renaming `.card` semantics or the schema-registry API.** `SchemaRegistry`
   282	  is copied as-is; callers unchanged.
   283	
   284	## Open design questions
   285	
   286	1. ~~**Migrator dependency on the XML parser.**~~ **Resolved:
   287	   box-migration-first.** Run the migrators against every box, then delete
   288	   cardworks *and* the now-spent migrators together (Track C). No XML parser is
   289	   vendored; the migrators die with cardworks once they've done their job. This
   290	   makes box migration (the user's separate effort) a prerequisite for Track C
   291	   only — Tracks A+B land first, independent of box state.
   292	2. **Home for the copied primitives.** `src/cards/` (proposed) vs
   293	   `src/lib/cards/` vs `src/core/cards/`. Lean: `src/cards/` — top-level,
   294	   sibling to `src/schemas/`, reads as "the card primitive layer." Minor;
   295	   settle at first chunk.
   296	3. **`cli/lib/loader.ts` — rewrite vs delete.** Several routers call
   297	   `createLoader`. If their only use is listing + frontmatter loading, the
   298	   factory becomes a thin glob-lister; if any genuinely needs cardworks'
   299	   ref-traversal `move()`, that caller needs a frontmatter rewrite first.
   300	   Lean: rewrite to a glob-lister + `card-io` loader; verify no caller needs
   301	   XML `move()` (the suite + typecheck will confirm).
   302	
   303	## Knowledge audits
   304	
   305	Skip-with-rationale: this plan introduces no agent-facing concept — it is an
   306	internal package deletion. The one agent-facing fact (*cards are never XML;
   307	the filename is the type discriminator; no `type:` field*) already landed with
   308	the schema migrations and is in `CLAUDE.md:28`/`CLAUDE.md:39`. No new audit;
   309	the existing "cards are frontmatter" understanding is unchanged.
   310	
   311	## Implementation order
   312	
   313	1. **Track A, chunk 1** — delete the self-contained dead paths (`card-io.ts`
   314	   XML branch, `search/extract.ts` `xmlDoc`, `ls.ts` `--format`). Green.
   315	2. **Track A, chunk 2** — delete the remaining dead paths (`transcribe.ts`
   316	   XML helpers, `procedure-trampoline.ts`, `todos.ts`, `card-lint.ts`
   317	   fallback) and the type-only `ElementNode`/`ElementSchema`/`Card` carriers.
   318	3. **Track A, chunk 3** — rewrite the live `CardLoader` users
   319	   (`cli/lib/loader.ts`, `move-operations.ts`, routers). After this,
   320	   callback-box imports only the keep-set from cardworks.
   321	4. **Track B** — create `src/cards/` (frontmatter.ts + schema.ts first, then
   322	   registry/lint-format/errors), repoint all keep-set imports. Now
   323	   `grep -rl 'from "cardworks"' callback-box/src` is empty.
   324	5. **[Out of band] Migrate every box** off XML with the migrators (the
   325	   user's separate effort; can overlap Tracks A+B).
   326	6. **Track C** — once boxes are migrated, delete cardworks + symlink + dep +
   327	   workspace entry + the spent migrators, `pnpm install`, update docs. Final
   328	   `pnpm typecheck && pnpm lint && pnpm test` clean.
   329	
   330	Dependencies: Track C is gated on A+B (no cardworks imports in src) *and* on
   331	box migration being complete (so the deleted migrators aren't needed). Track
   332	B's repoint is what makes the deleted XML symbols disappear, so Track A's
   333	"compiler as checklist" verification happens as B lands. Tracks A+B do not
   334	depend on box state and can land while boxes are migrated.
   335	
   336	## Rollout shape
   337	
   338	- **Test posture.** No new behavior, so no new tests are the goal — the
   339	  existing suite (2173) plus `pnpm typecheck` is the regression gate, and it is
   340	  load-bearing here (the typecheck *is* the completeness proof). One small
   341	  exception: if `ls --format` is reduced to frontmatter-field lookup (Critical
   342	  gap resolution), add one doctest for it, mirroring the landmark
   343	  `lookupField` doctest.
   344	- **Knowledge-audit entries.** None (see Knowledge audits).
   345	- **Migration approach.** No box-data migration in this plan. The only "data"
   346	  concern is the migrators' XML-read dependency (Open question 1); whichever
   347	  option is chosen, it lands inside this plan (vendored snapshot or
   348	  box-first), not deferred midway.
   349	- **Ship as one unit.** Merge only when cardworks is gone and
   350	  `typecheck`/`lint`/`test` are clean — never a state where `src/cards/` and
   351	  cardworks both supply the same primitive in shipped code.

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/schemas/registry.ts | sed -n '1,220p' && nl -ba callback-box/src/core/card-io.ts | sed -n '1,460p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
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
    14	import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
    15	import { MemoSchema } from "./memo.js";
    16	import { QuestionSchema } from "./question.js";
    17	import { FeedbackSchema } from "./feedback.js";
    18	import { ProcedureSchema } from "./procedure.js";
    19	import { ProcedureRunSchema } from "./procedure-run.js";
    20	import { ImageSchema } from "./image.js";
    21	import { AudioSchema } from "./audio.js";
    22	import { FileSchema } from "./file.js";
    23	import { CaptureSessionSchema } from "./capture-session.js";
    24	import { RecordSchema } from "./record.js";
    25	import { RecipeSchema } from "./recipe.js";
    26	import { EmailThreadSchema } from "./email-thread.js";
    27	import { EmailMessageSchema } from "./email-message.js";
    28	import { EmailOutboundSchema } from "./email-outbound.js";
    29	import { IntakeJobSchema } from "./intake-job.js";
    30	import { CalendarReviewJobSchema } from "./calendar-review-job.js";
    31	import { GuideSchema } from "./guide.js";
    32	import { ScheduledScriptSchema } from "./scheduled-script.js";
    33	import { TelegramMessageSchema } from "./telegram-message.js";
    34	import { ChatThreadSchema } from "./chat-thread.js";
    35	import { ChatJobSchema } from "./chat-job.js";
    36	import { PersonalitySchema } from "./personality.js";
    37	import { QuestionFollowupJobSchema } from "./question-followup-job.js";
    38	import { TodoListSchema } from "./todo-list.js";
    39	import { BriefingSchema } from "./briefing.js";
    40	import { PersonSchema } from "./person.js";
    41	import { SheetSchema } from "./sheet.js";
    42	import { DocSchema } from "./doc.js";
    43	import { GdocSchema } from "./gdoc.js";
    44	import { CommentarySchema } from "./commentary.js";
    45	import { WebpageSchema } from "./webpage.js";
    46	import { ExtfileSchema } from "./extfile.js";
    47	import { LandmarkSchema } from "./landmark.js";
    48	import { registerTemplate, type TemplateDefinition } from "./templates.js";
    49	
    50	/**
    51	 * Built-in XML (legacy `element()`) card schemas. Now empty — every schema
    52	 * has migrated to the frontmatter form below. The array and the XML loader
    53	 * path remain until cardworks itself is removed in a follow-up.
    54	 */
    55	export const schemas: ElementSchema[] = [];
    56	
    57	/**
    58	 * Phase-2 markdown-frontmatter card schemas. Loaded into a separate
    59	 * Map<type, CardSchema> by createCardSchemaMap below.
    60	 */
    61	export const cardSchemas: CardSchema[] = [
    62	  CaptureSessionSchema,
    63	  GuideSchema,
    64	  LandmarkSchema,
    65	  ProcedureSchema,
    66	  ProcedureRunSchema,
    67	  RecipeSchema,
    68	  EmailThreadSchema,
    69	  EmailMessageSchema,
    70	  EmailOutboundSchema,
    71	  BriefingSchema,
    72	  DocSchema,
    73	  GdocSchema,
    74	  CommentarySchema,
    75	  WebpageSchema,
    76	  ExtfileSchema,
    77	  SheetSchema,
    78	  FileSchema,
    79	  ImageSchema,
    80	  AudioSchema,
    81	  RecordSchema,
    82	  PersonSchema,
    83	  MemoSchema,
    84	  TodoListSchema,
    85	  TelegramMessageSchema,
    86	  FeedbackSchema,
    87	  IntakeJobSchema,
    88	  CalendarReviewJobSchema,
    89	  ChatJobSchema,
    90	  QuestionFollowupJobSchema,
    91	  PersonalitySchema,
    92	  ScheduledScriptSchema,
    93	  QuestionSchema,
    94	  ChatThreadSchema,
    95	];
    96	
    97	/** Packages that box-local schemas can import from callback-box's tree. */
    98	const SCHEMA_DEPS = new Set(["cardworks", "zod"]);
    99	
   100	/**
   101	 * Virtual parent URL inside callback-box's node_modules.
   102	 * When we rewrite parentURL to this, Node resolves bare specifiers
   103	 * by searching callback-box's node_modules.
   104	 */
   105	const CB_VIRTUAL_PARENT = pathToFileURL(
   106	  join(PACKAGE_ROOT, "node_modules", "_virtual.js")
   107	).href;
   108	
   109	/**
   110	 * Register module resolution hooks so that box-local schema files
   111	 * (under config/schemas/) can import "cardworks" and "zod" even though
   112	 * those packages live in callback-box's node_modules, not the box's.
   113	 *
   114	 * Uses Node's synchronous registerHooks API which chains correctly
   115	 * with tsx's async loader hooks.
   116	 */
   117	let hooksRegistered = false;
   118	function ensureResolveHooks(): void {
   119	  if (hooksRegistered) return;
   120	  hooksRegistered = true;
   121	
   122	  registerHooks({
   123	    // eslint-disable-next-line max-params -- Node's registerHooks API requires 3 params
   124	    resolve(specifier, context, nextResolve) {
   125	      // Check if a box schema file is importing a known package
   126	      const bare = specifier.split("/")[0] ?? "";
   127	      if (
   128	        SCHEMA_DEPS.has(bare) &&
   129	        context.parentURL?.includes("/config/schemas/")
   130	      ) {
   131	        // Resolve as if imported from callback-box's node_modules
   132	        return nextResolve(specifier, {
   133	          ...context,
   134	          parentURL: CB_VIRTUAL_PARENT,
   135	        });
   136	      }
   137	      return nextResolve(specifier, context);
   138	    },
   139	  });
   140	}
   141	
   142	/**
   143	 * Ensure config/schemas/ has a package.json with "type": "module"
   144	 * so Node treats .ts files as ESM (needed for registerHooks to apply).
   145	 */
   146	async function ensureEsmPackageJson(schemasDir: string): Promise<void> {
   147	  const pkgJsonPath = join(schemasDir, "package.json");
   148	  try {
   149	    const { stat } = await import("node:fs/promises");
   150	    await stat(pkgJsonPath);
   151	  } catch (_e) {
   152	    // package.json is absent (stat throws ENOENT) — that's the expected
   153	    // trigger to create it; the error carries no other actionable info.
   154	    const { writeFile } = await import("node:fs/promises");
   155	    await writeFile(pkgJsonPath, '{"type":"module"}\n');
   156	  }
   157	}
   158	
   159	/**
   160	 * Box-local schemas, segregated by format. A box's `config/schemas/*.ts`
   161	 * files may default-export either a frontmatter `cardSchema()` (the default
   162	 * for new card types) or a legacy XML `element()` schema; we branch on the
   163	 * discriminator (`.type` vs `.tagName`) and keep the two kinds apart so each
   164	 * flows into the right runtime map.
   165	 */
   166	export interface BoxSchemas {
   167	  /** Frontmatter card schemas (cardworks CardSchema, keyed by `.type`). */
   168	  cardSchemas: CardSchema[];
   169	  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
   170	  elementSchemas: ElementSchema[];
   171	}
   172	
   173	/**
   174	 * Per-boxRoot cache. loadBoxSchemas is called from ~24 sites (every place
   175	 * that builds a card-schema map); without this, each would re-readdir and
   176	 * re-import. Node already permanently caches the dynamic `import()` by URL,
   177	 * so a process never sees on-disk schema edits anyway — caching the readdir
   178	 * + branch result alongside it changes nothing observable and avoids the
   179	 * repeated I/O. `cb` commands are fresh processes, so edits are picked up on
   180	 * the next invocation; long-lived dev servers already required a restart to
   181	 * see schema changes (the import cache), and still do.
   182	 */
   183	const boxSchemaCache = new Map<string, BoxSchemas>();
   184	
   185	/**
   186	 * Load box-local schemas from config/schemas/*.ts.
   187	 *
   188	 * Each file should default-export either a frontmatter `cardSchema()` or a
   189	 * legacy XML `element()` schema. Optionally it can also export a `template`
   190	 * (TemplateDefinition) for `cb create` — registered the same way regardless
   191	 * of schema kind.
   192	 *
   193	 * Errors in individual files are logged as warnings, not fatal.
   194	 */
   195	export async function loadBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
   196	  const cached = boxSchemaCache.get(boxRoot);
   197	  if (cached) return cached;
   198	
   199	  const result = await loadBoxSchemasUncached(boxRoot);
   200	  boxSchemaCache.set(boxRoot, result);
   201	  return result;
   202	}
   203	
   204	async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
   205	  const empty: BoxSchemas = { cardSchemas: [], elementSchemas: [] };
   206	  const schemasDir = join(boxRoot, "config/schemas");
   207	  let files: string[];
   208	  try {
   209	    files = await readdir(schemasDir);
   210	  } catch (e) {
   211	    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   212	      console.warn(`Could not read box schemas dir ${schemasDir}, skipping box-local schemas:`, e);
   213	    }
   214	    return empty;
   215	  }
   216	
   217	  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("."));
   218	  if (tsFiles.length === 0) return empty;
   219	
   220	  const loadedCard: CardSchema[] = [];
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
    21	import {
    22	  splitCardContent,
    23	  parseCard,
    24	  type CardSchema,
    25	  type ElementSchema,
    26	  type ElementNode,
    27	} from "cardworks";
    28	
    29	const CARD_XML_CONTENT_TYPE = "application/x-card+xml";
    30	
    31	/**
    32	 * Errors raised by the card IO layer. Caller code can catch this specifically
    33	 * to distinguish format-level problems from arbitrary IO errors.
    34	 */
    35	export class CardIOError extends Error {
    36	  readonly source: string;
    37	  readonly detail: string;
    38	  constructor(source: string, detail: string) {
    39	    super(`${source}: ${detail}`);
    40	    this.name = "CardIOError";
    41	    this.source = source;
    42	    this.detail = detail;
    43	  }
    44	}
    45	
    46	interface ZodIssueLike {
    47	  path: ReadonlyArray<string | number | symbol>;
    48	  message: string;
    49	  code?: string;
    50	  expected?: string;
    51	  received?: string;
    52	}
    53	
    54	/**
    55	 * Render Zod issues as a compact, one-line-per-issue list:
    56	 *
    57	 *   - status: invalid option (expected "new"|"processing"|"processed")
    58	 *   - boxholder.relationships[0].text: required
    59	 *
    60	 * Replaces the multi-line JSON dump Zod's `.message` produces.
    61	 */
    62	function formatZodIssues(issues: ReadonlyArray<ZodIssueLike>): string {
    63	  return issues
    64	    .map((issue) => {
    65	      const pathStr =
    66	        issue.path.length === 0
    67	          ? "(root)"
    68	          : issue.path
    69	              .map((seg, i) => {
    70	                if (typeof seg === "number") return `[${String(seg)}]`;
    71	                return i === 0 ? String(seg) : `.${String(seg)}`;
    72	              })
    73	              .join("");
    74	      return `  - ${pathStr}: ${shortenIssueMessage(issue)}`;
    75	    })
    76	    .join("\n");
    77	}
    78	
    79	function shortenIssueMessage(issue: ZodIssueLike): string {
    80	  const m = issue.message;
    81	  // Zod's stock "Invalid input: expected <X>, received <Y>" → "expected X, got Y"
    82	  const expectedReceived = m.match(/^Invalid input: expected (.+?), received (.+)$/);
    83	  if (expectedReceived) {
    84	    if (expectedReceived[2] === "undefined") return `required (expected ${expectedReceived[1]})`;
    85	    return `expected ${expectedReceived[1]}, got ${expectedReceived[2]}`;
    86	  }
    87	  return m;
    88	}
    89	
    90	/**
    91	 * A parsed card. `fields` is the validated, typed object — the union of
    92	 * frontmatter fields and (if the schema declares one) the body field, keyed
    93	 * uniformly by field name.
    94	 */
    95	export interface ParsedCard<TFields extends Record<string, unknown> = Record<string, unknown>> {
    96	  schema: CardSchema;
    97	  fields: TFields;
    98	  /** Body text exactly as it appeared in the file (empty string if none). */
    99	  rawBody: string;
   100	  /** Optional content-type from frontmatter; undefined for markdown/empty bodies. */
   101	  contentType: string | undefined;
   102	}
   103	
   104	/**
   105	 * Parse a `.card` file's raw text against a registered schema.
   106	 *
   107	 * The card's type is taken from the filename (`Foo.<type>.card`), not from a
   108	 * `type:` field in the frontmatter — the filename is the canonical
   109	 * discriminator. If the YAML happens to carry a `type:` field, it must
   110	 * either match the filename type or be absent; mismatches are a lint
   111	 * error. Either way, the field is normalized into the parsed fields
   112	 * object (so consumers can still read `fields.type`).
   113	 */
   114	export function parseCardText(
   115	  content: string,
   116	  { source, schemas, type }: { source: string; schemas: Map<string, CardSchema>; type?: string }
   117	): ParsedCard {
   118	  const split = splitCardContent(content);
   119	  if (!split.hasFrontmatter) {
   120	    throw new CardIOError(source, "missing frontmatter block");
   121	  }
   122	
   123	  const fm = parseFrontmatterMapping(split.frontmatterText, source);
   124	
   125	  const resolved = resolveCardType({ fm, source, type });
   126	  const schema = schemas.get(resolved);
   127	  if (schema === undefined) {
   128	    throw new CardIOError(source, `no schema registered for type "${resolved}"`);
   129	  }
   130	
   131	  // cardworks bakes `type: z.literal(...)` into frontmatterSchema, so we
   132	  // inject the resolved type before validation. The on-disk YAML is no
   133	  // longer required to carry it.
   134	  const fmForValidation = { ...fm, type: resolved };
   135	  const fmParse = schema.frontmatterSchema.safeParse(fmForValidation);
   136	  if (!fmParse.success) {
   137	    throw new CardIOError(
   138	      source,
   139	      `invalid ${resolved} frontmatter:\n${formatZodIssues(fmParse.error.issues)}`
   140	    );
   141	  }
   142	  const fmFields = fmParse.data as Record<string, unknown>;
   143	
   144	  const contentType = typeof fm["content-type"] === "string" ? fm["content-type"] : undefined;
   145	
   146	  const bodyValue = validateCardBody({ schema, body: split.body, contentType, resolved, source });
   147	
   148	  const fields: Record<string, unknown> = { ...fmFields };
   149	  if (schema.bodyFieldName !== null) {
   150	    fields[schema.bodyFieldName] = bodyValue;
   151	  }
   152	
   153	  return {
   154	    schema,
   155	    fields,
   156	    rawBody: split.body,
   157	    contentType,
   158	  };
   159	}
   160	
   161	/**
   162	 * Parse the frontmatter YAML block into a plain mapping. An empty block
   163	 * (which YAML parses as `null`) becomes an empty mapping; non-mapping YAML
   164	 * (arrays, scalars) is a format error.
   165	 */
   166	function parseFrontmatterMapping(frontmatterText: string, source: string): Record<string, unknown> {
   167	  let frontmatter: unknown;
   168	  try {
   169	    frontmatter = parseYaml(frontmatterText);
   170	  } catch (e) {
   171	    const err = e as Error;
   172	    throw new CardIOError(source, `invalid YAML frontmatter: ${err.message}`);
   173	  }
   174	  // YAML parses an empty block as `null`; treat that as an empty mapping
   175	  // so cards whose only frontmatter field got stripped still parse.
   176	  if (Array.isArray(frontmatter) || (frontmatter !== null && typeof frontmatter !== "object")) {
   177	    throw new CardIOError(source, "frontmatter must be a YAML mapping");
   178	  }
   179	  return (frontmatter as Record<string, unknown> | null) ?? {};
   180	}
   181	
   182	/**
   183	 * Resolve the card type: caller-supplied wins, otherwise derive from the
   184	 * source filename (Foo.<type>.card), otherwise fall back to any `type:`
   185	 * field in the YAML for callers that haven't been updated yet. A YAML
   186	 * `type:` that contradicts a caller-supplied `type` is a format error.
   187	 */
   188	function resolveCardType(input: {
   189	  fm: Record<string, unknown>;
   190	  source: string;
   191	  type: string | undefined;
   192	}): string {
   193	  const { fm, source, type } = input;
   194	  const yamlType = typeof fm["type"] === "string" ? (fm["type"] as string) : undefined;
   195	  const resolved = type ?? typeFromFilename(source) ?? yamlType;
   196	  if (resolved === undefined) {
   197	    throw new CardIOError(
   198	      source,
   199	      "cannot determine card type — filename must match Foo.<type>.card"
   200	    );
   201	  }
   202	  if (type !== undefined && yamlType !== undefined && yamlType !== type) {
   203	    throw new CardIOError(
   204	      source,
   205	      `frontmatter type "${yamlType}" does not match filename type "${type}"`
   206	    );
   207	  }
   208	  return resolved;
   209	}
   210	
   211	/**
   212	 * Validate the body text against the schema's body field (if any) and
   213	 * return the parsed body value. Schemas without a body field reject any
   214	 * non-whitespace body content. Returns undefined when no body field exists.
   215	 */
   216	function validateCardBody(input: {
   217	  schema: CardSchema;
   218	  body: string;
   219	  contentType: string | undefined;
   220	  resolved: string;
   221	  source: string;
   222	}): unknown {
   223	  const { schema, body, contentType, resolved, source } = input;
   224	  if (schema.bodyField === null || schema.bodyFieldName === null) {
   225	    if (body.trim().length > 0) {
   226	      throw new CardIOError(source, `schema "${resolved}" declares no body, but file has body content`);
   227	    }
   228	    return undefined;
   229	  }
   230	  if (schema.bodyField.kind === "xml" && contentType !== CARD_XML_CONTENT_TYPE) {
   231	    throw new CardIOError(
   232	      source,
   233	      `schema "${resolved}" expects an XML body but content-type is ${contentType === undefined ? "missing" : `"${contentType}"`}`
   234	    );
   235	  }
   236	  const bodyParse = schema.bodyField.schema.safeParse(body);
   237	  if (!bodyParse.success) {
   238	    throw new CardIOError(
   239	      source,
   240	      `invalid ${resolved} body:\n${formatZodIssues(bodyParse.error.issues)}`
   241	    );
   242	  }
   243	  return bodyParse.data;
   244	}
   245	
   246	/**
   247	 * Serialize a parsed card back to its file representation.
   248	 *
   249	 * Splits the input fields object into frontmatter (everything but the body
   250	 * field) + body, sets the appropriate content-type, and emits a fenced YAML
   251	 * block followed by the body text.
   252	 */
   253	export function serializeCardText(input: {
   254	  schema: CardSchema;
   255	  fields: Record<string, unknown>;
   256	}): string {
   257	  const { schema, fields } = input;
   258	  // No `type:` field emitted — the filename is the canonical discriminator.
   259	  const frontmatter: Record<string, unknown> = {};
   260	  let body = "";
   261	  for (const [name, value] of Object.entries(fields)) {
   262	    if (name === "type") continue;
   263	    if (schema.bodyFieldName === name) {
   264	      if (schema.bodyField === null) continue;
   265	      if (schema.bodyField.kind === "markdown") {
   266	        body = typeof value === "string" ? value : String(value);
   267	      } else if (schema.bodyField.kind === "xml") {
   268	        body = typeof value === "string" ? value : String(value);
   269	        frontmatter["content-type"] = CARD_XML_CONTENT_TYPE;
   270	      }
   271	      continue;
   272	    }
   273	    if (value === undefined) continue;
   274	    frontmatter[name] = value;
   275	  }
   276	  const yamlText = stringifyYaml(frontmatter);
   277	  // YAML.stringify ends with \n already
   278	  return `---\n${yamlText}---\n${body}`;
   279	}
   280	
   281	/**
   282	 * A card loaded via the dispatcher. New (CardSchema) and legacy (XML)
   283	 * schemas coexist; callers narrow on `kind` to access the right shape.
   284	 */
   285	export type LoadedCard = FrontmatterLoadedCard | XmlLoadedCard;
   286	
   287	export interface FrontmatterLoadedCard {
   288	  readonly kind: "frontmatter";
   289	  readonly path: string;
   290	  readonly schema: CardSchema;
   291	  readonly fields: Record<string, unknown>;
   292	  readonly contentType: string | undefined;
   293	}
   294	
   295	export interface XmlLoadedCard {
   296	  readonly kind: "xml";
   297	  readonly path: string;
   298	  readonly schema: ElementSchema | undefined;
   299	  readonly element: ElementNode;
   300	}
   301	
   302	export interface LoadCardContext {
   303	  /** Schemas keyed by frontmatter `type:` value. */
   304	  cardSchemas: Map<string, CardSchema>;
   305	  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
   306	  elementSchemas: Map<string, ElementSchema>;
   307	}
   308	
   309	/**
   310	 * Load a `.card` file, dispatching on the file's frontmatter:
   311	 *
   312	 * - If the file has a `---` frontmatter block whose YAML carries a
   313	 *   `type:` field matching a registered CardSchema, it's parsed as the
   314	 *   new markdown-frontmatter format.
   315	 * - Otherwise the body is parsed as XML (legacy format) and the root
   316	 *   tag's ElementSchema (if any) is used for validation.
   317	 */
   318	export async function loadCardFile(
   319	  absPath: string,
   320	  ctx: LoadCardContext
   321	): Promise<LoadedCard> {
   322	  const content = await readFile(absPath, "utf8");
   323	  return loadCardFromText({ content, source: absPath, ctx });
   324	}
   325	
   326	/**
   327	 * In-memory variant of loadCardFile. Useful for tests and for callers
   328	 * that already have the file content in hand.
   329	 */
   330	export function loadCardFromText(input: {
   331	  content: string;
   332	  source: string;
   333	  ctx: LoadCardContext;
   334	}): Promise<LoadedCard> {
   335	  const { content, source, ctx } = input;
   336	  const split = splitCardContent(content);
   337	  if (split.hasFrontmatter) {
   338	    const fileType = typeFromFilename(source);
   339	    if (fileType !== undefined && ctx.cardSchemas.has(fileType)) {
   340	      const parsed = parseCardText(content, { source, schemas: ctx.cardSchemas, type: fileType });
   341	      return Promise.resolve<LoadedCard>({
   342	        kind: "frontmatter",
   343	        path: source,
   344	        schema: parsed.schema,
   345	        fields: parsed.fields,
   346	        contentType: parsed.contentType,
   347	      });
   348	    }
   349	  }
   350	  return loadXmlCard({ content, source, ctx });
   351	}
   352	
   353	/**
   354	 * Extract the card type from a filename matching `Foo.<type>.card`.
   355	 * Job cards use the dotted convention `Foo.<kind>.job.card` (the reactor
   356	 * discovers jobs by that suffix — see reactor/job-discovery.ts) while
   357	 * their schemas are registered under hyphenated names, so e.g.
   358	 * `Foo.intake.job.card` resolves to type `intake-job`.
   359	 * Returns undefined when the source doesn't fit either pattern (e.g.
   360	 * test fixtures with non-card paths).
   361	 */
   362	export function typeFromFilename(source: string): string | undefined {
   363	  const base = source.split("/").pop() ?? source;
   364	  const jobMatch = base.match(/^.+\.([^.]+)\.job\.card$/);
   365	  if (jobMatch) return `${jobMatch[1]}-job`;
   366	  const match = base.match(/^.+\.([^.]+)\.card$/);
   367	  return match ? match[1] : undefined;
   368	}
   369	
   370	async function loadXmlCard(input: {
   371	  content: string;
   372	  source: string;
   373	  ctx: LoadCardContext;
   374	}): Promise<XmlLoadedCard> {
   375	  const { content, source, ctx } = input;
   376	  const element = await parseCard(content, { source });
   377	  const schema = ctx.elementSchemas.get(element.tagName);
   378	  return { kind: "xml", path: source, schema, element };
   379	}
   380	

exec
/opt/homebrew/bin/bash -lc "rg -n \"from ['\\\"]cardworks|require\\(['\\\"]cardworks|import\\(['\\\"]cardworks|cardworks/|CardLoader|parseCard|ElementNode|ElementSchema|evaluateXPathString|serialize|escapeText|lintCard|splitCardContent|formatLintResults|SchemaRegistry|cardSchema|body\\(\" callback-box cardworks bin scripts pnpm-workspace.yaml package.json 2>/dev/null" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 exited 2 in 0ms:
package.json:5:  "description": "Monorepo root. Holds shared dev infrastructure (husky hooks, the dev router). Individual packages live in callback-box/, cardworks/, personal-vibe-check/, agent-doctest/, callback-clerk/.",
cardworks/src/jsx/jsx-runtime.ts:5: * the "react-jsx" transform with jsxImportSource: "cardworks/jsx"
cardworks/src/jsx/jsx-runtime.ts:9:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/jsx/jsx-runtime.ts:19:): ElementNode {
cardworks/src/jsx/jsx-runtime.ts:29:): ElementNode {
cardworks/src/jsx/jsx-runtime.ts:37:  children?: ElementNode | ElementNode[];
cardworks/src/jsx/jsx-runtime.ts:38:}): ElementNode[] {
cardworks/src/jsx/jsx-runtime.ts:58:  export type Element = ElementNode;
cardworks/src/card/card.ts:1:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/card/card.ts:3:import { serialize } from "../serialize/serialize.js";
cardworks/src/card/card.ts:7: * Cards wrap ElementNodes with file path, version, media files, and dirty tracking.
cardworks/src/card/card.ts:14:  readonly element: ElementNode;
cardworks/src/card/card.ts:81:  element: ElementNode;
cardworks/src/card/card.ts:94:  public readonly element: ElementNode;
cardworks/src/card/card.ts:113:    return serialize(this.element) !== this.snapshot;
cardworks/src/card/card.ts:159:  element: ElementNode;
cardworks/src/card/card.ts:171:  public readonly element: ElementNode;
cardworks/src/card/card.ts:231:function attachCardToElements(element: ElementNode, card: Card): void {
cardworks/src/card/card.ts:255:  element: ElementNode;
cardworks/src/card/card.ts:263: * This is used internally by CardLoader.
cardworks/src/lint/index.ts:2:  lintCard,
cardworks/src/lint/index.ts:3:  lintCards,
cardworks/src/lint/index.ts:14:  formatLintResults,
cardworks/src/lint/index.ts:15:  formatLintResultsJson,
cardworks/src/jsx/create-element.ts:1:import type { ElementNode, MixedContent, Comments } from "../parser/provenance.js";
cardworks/src/jsx/create-element.ts:15:export type JSXChild = string | ElementNode | null | undefined;
cardworks/src/jsx/create-element.ts:22:  children: ElementNode[];
cardworks/src/jsx/create-element.ts:27: * Process JSX children into ElementNode format.
cardworks/src/jsx/create-element.ts:44:  if (isElementNode(children)) {
cardworks/src/jsx/create-element.ts:52:      (c): c is string | ElementNode => c !== null && c !== undefined
cardworks/src/jsx/create-element.ts:60:    const hasElements = filtered.some((c) => isElementNode(c));
cardworks/src/jsx/create-element.ts:65:      const elementChildren = filtered.filter((c): c is ElementNode =>
cardworks/src/jsx/create-element.ts:66:        isElementNode(c)
cardworks/src/jsx/create-element.ts:72:        children: filtered.filter((c): c is ElementNode => isElementNode(c)),
cardworks/src/jsx/create-element.ts:84: * Type guard for ElementNode.
cardworks/src/jsx/create-element.ts:86:function isElementNode(value: unknown): value is ElementNode {
cardworks/src/jsx/create-element.ts:91:    typeof (value as ElementNode).tagName === "string"
cardworks/src/jsx/create-element.ts:96: * Create an ElementNode from JSX-style arguments.
cardworks/src/jsx/create-element.ts:101: * @returns An ElementNode
cardworks/src/jsx/create-element.ts:106:): ElementNode {
cardworks/src/jsx/create-element.ts:141:  const element: ElementNode = {
cardworks/src/lint/format.ts:84:export function formatLintResults(summary: LintSummary, options?: FormatOptions): string {
cardworks/src/lint/format.ts:128:export function formatLintResultsJson(summary: LintSummary): string {
cardworks/src/jsx/types.ts:2:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/jsx/types.ts:3:import type { ElementSchema } from "../schema/element.js";
cardworks/src/jsx/types.ts:6: * Extract the inferred type from an ElementSchema.
cardworks/src/jsx/types.ts:9:export type InferElementType<S> = S extends ElementSchema<infer T> ? T : never;
cardworks/src/jsx/types.ts:12: * Extract JSX props from an ElementSchema.
cardworks/src/jsx/types.ts:15:export type InferJSXProps<S extends ElementSchema> =
cardworks/src/jsx/types.ts:17:    ? A & { children?: ElementNode | ElementNode[] | string }
cardworks/src/jsx/types.ts:18:    : { children?: ElementNode | ElementNode[] | string };
cardworks/src/jsx/types.ts:35:export type InferJSXElements<T extends Record<string, ElementSchema>> = {
cardworks/src/jsx/types.ts:43:  children?: ElementNode | ElementNode[] | string | (ElementNode | string)[];
cardworks/src/jsx/types.ts:50:export interface CardJSXFactory<T extends Record<string, ElementSchema>> {
cardworks/src/jsx/types.ts:54:  jsx: (tag: keyof T | string, props: JSXRuntimeProps) => ElementNode;
cardworks/src/jsx/types.ts:59:  jsxs: (tag: keyof T | string, props: JSXRuntimeProps) => ElementNode;
cardworks/src/jsx/types.ts:64:  Fragment: (props: { children?: ElementNode | ElementNode[] }) => ElementNode[];
cardworks/src/jsx/types.ts:70:  createCard: (path: string, element: ElementNode) => Card;
callback-box/CLAUDE.md:21:- Use `t.check(actual, expected)` for string comparisons. Objects serialize as `JSON.stringify(val, null, 2)`.
callback-box/CLAUDE.md:39:**Schemas** live in `src/schemas/`. Cards use `cardSchema(type, { fields, instructions? })` from cardworks. `src/schemas/registry.ts` lists them in `cardSchemas[]` (the legacy `schemas[]` XML list is now empty); boxes can add local schemas under `config/schemas/`. The type is taken from the filename (`Foo.<type>.card`) — there is no `type:` field in frontmatter.
callback-box/CLAUDE.md:41:**Loading:** `src/core/card-io.ts` `loadCardFile(absPath, ctx)` returns a discriminated `FrontmatterLoadedCard | XmlLoadedCard`. Most consumer code uses `parseCardText()` directly when it already has the file contents. Mutations to frontmatter cards are parse-mutate-reserialize via `yaml`'s `parse`/`stringify`.
callback-box/CLAUDE.md:73:src/schemas/      Card type definitions (Zod + cardworks `cardSchema`)
cardworks/src/lint/lint.ts:1:import type { ICardLoader } from "../loader/loader.js";
cardworks/src/lint/lint.ts:2:import type { ElementNode, Location } from "../parser/provenance.js";
cardworks/src/lint/lint.ts:4:import { parseCard } from "../parser/parse.js";
cardworks/src/lint/lint.ts:45: * Options for {@link lintCard}: the card path plus optional lint settings.
cardworks/src/lint/lint.ts:55:export async function lintCard(
cardworks/src/lint/lint.ts:56:  loader: ICardLoader,
cardworks/src/lint/lint.ts:120:function checkDuplicateIds(root: ElementNode, warnings: LintIssue[]): void {
cardworks/src/lint/lint.ts:147:function collectIds(node: ElementNode, occurrences: IdOccurrence[]): void {
cardworks/src/lint/lint.ts:164:  loader: ICardLoader;
cardworks/src/lint/lint.ts:172:async function checkRefsInNode(node: ElementNode, ctx: RefCheckContext): Promise<void> {
cardworks/src/lint/lint.ts:266: * unknown root tags). For full schema validation, use `lintCard` with
cardworks/src/lint/lint.ts:273:  loader: ICardLoader,
cardworks/src/lint/lint.ts:282:    const node = await parseCard(content, { source: sourceName });
cardworks/src/lint/lint.ts:314:  loader: ICardLoader,
cardworks/src/lint/lint.ts:319:  return lintCards(loader, { paths, ...resolved });
cardworks/src/lint/lint.ts:323: * Options for {@link lintCards}: the card paths plus optional lint settings.
cardworks/src/lint/lint.ts:333:export async function lintCards(
cardworks/src/lint/lint.ts:334:  loader: ICardLoader,
cardworks/src/lint/lint.ts:344:    const result = await lintCard(loader, { path, ...lintOptions });
callback-box/test/dictation-draft.doctest.md:6:key shape, the parse/serialize boundary, and the age label.
callback-box/test/dictation-draft.doctest.md:12:  serializeDraft,
callback-box/test/dictation-draft.doctest.md:30:## serializeDraft / parseDraft
callback-box/test/dictation-draft.doctest.md:36:JSON.stringify(parseDraft(serializeDraft(draft)))
cardworks/src/jsx/factory.ts:1:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/jsx/factory.ts:2:import type { ElementSchema } from "../schema/element.js";
cardworks/src/jsx/factory.ts:41: * This returns jsx/jsxs functions that create ElementNodes, a Fragment
cardworks/src/jsx/factory.ts:64:export function defineCardJSX<T extends Record<string, ElementSchema>>(
cardworks/src/jsx/factory.ts:73:  function jsx(tag: keyof T | string, props: JSXRuntimeProps): ElementNode {
cardworks/src/jsx/factory.ts:82:  function jsxs(tag: keyof T | string, props: JSXRuntimeProps): ElementNode {
cardworks/src/jsx/factory.ts:93:    children?: ElementNode | ElementNode[];
cardworks/src/jsx/factory.ts:94:  }): ElementNode[] {
cardworks/src/jsx/factory.ts:106:   * Create a Card from a JSX-created ElementNode.
cardworks/src/jsx/factory.ts:111:  function createCard(path: string, element: ElementNode): Card {
callback-box/test/chat-features.doctest.md:163:serialize after `time`, in a fixed order, and are simply omitted when
callback-box/scripts/migrate/landmark.ts:47:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/landmark.ts:79:function text(el: ElementNode): string {
callback-box/scripts/migrate/landmark.ts:83:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/landmark.ts:87:function children(el: ElementNode, tag: string): ElementNode[] {
callback-box/scripts/migrate/landmark.ts:103:function convertNavigation(nav: ElementNode, source: string, warnings: WarningCollector): Record<string, unknown> | undefined {
callback-box/scripts/migrate/landmark.ts:164:function convertDestination(el: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/landmark.ts:188:    const split = splitCardContent(content);
callback-box/scripts/migrate/landmark.ts:195:    const root = await parseCard(content, { source: absPath });
callback-box/docs/design-card-views.md:82:  element?: ElementNode;
callback-box/docs/design-card-views.md:449:function extractSummary(element: ElementNode): Record<string, string> {
callback-box/docs/design-card-views.md:511:    const registry = createSchemaRegistry();
callback-box/docs/design-card-views.md:524:    const xml = loader.serialize(card.element);
callback-box/docs/design-card-views.md:550:function resolvePath(root: ElementNode, pathStr?: string): ElementNode {
callback-box/docs/design-card-views.md:745:function parseRecipeElement(el: ElementNode): ParsedRecipe {
callback-box/docs/design-card-views.md:764:function parseSection(el: ElementNode): RecipeSection {
cardworks/DESIGN.md:20:The library is schema-agnostic: it parses, validates, and serializes XML but doesn't prescribe what elements your cards should contain. You define your own schemas using Zod.
cardworks/DESIGN.md:559:cardworks/
cardworks/DESIGN.md:822:4. **Round-trip tests** - Parse → serialize → parse produces same result
cardworks/DESIGN.md:831:const result = serializeForTest(parsed)
cardworks/DESIGN.md:849:const loader = new CardLoader(fs)
cardworks/DESIGN.md:874:5. Build serializer with round-trip tests
cardworks/test/loader.test.ts:2:import { MemoryCardLoader, ValidationError } from "../src/loader/loader.js";
cardworks/test/loader.test.ts:6:test("MemoryCardLoader.load: loads a simple card", async (t) => {
cardworks/test/loader.test.ts:7:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:27:test("MemoryCardLoader.load: throws on non-existent file", async (t) => {
cardworks/test/loader.test.ts:28:  const loader = new MemoryCardLoader("/project");
cardworks/test/loader.test.ts:35:test("MemoryCardLoader.save: saves a card", async (t) => {
cardworks/test/loader.test.ts:36:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:54:test("MemoryCardLoader.resolveRef: resolves cross-card reference", async (t) => {
cardworks/test/loader.test.ts:55:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:74:test("MemoryCardLoader.resolveRef: detects version mismatch", async (t) => {
cardworks/test/loader.test.ts:75:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:93:test("MemoryCardLoader: full workflow with fixture files", async (t) => {
cardworks/test/loader.test.ts:94:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:139:test("MemoryCardLoader.exists: checks if card file exists", async (t) => {
cardworks/test/loader.test.ts:140:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:150:test("MemoryCardLoader: handles absolute project-relative refs", async (t) => {
cardworks/test/loader.test.ts:151:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:167:test("MemoryCardLoader.getProjectRoot: returns project root", (t) => {
cardworks/test/loader.test.ts:168:  const loader = new MemoryCardLoader("/my/project");
cardworks/test/loader.test.ts:184:test("MemoryCardLoader: validates against registered schema", async (t) => {
cardworks/test/loader.test.ts:185:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:199:test("MemoryCardLoader: throws ValidationError on schema mismatch", async (t) => {
cardworks/test/loader.test.ts:204:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:222:test("MemoryCardLoader: skips validation for unregistered tag names", async (t) => {
cardworks/test/loader.test.ts:223:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:239:test("MemoryCardLoader.move: moves a card file", async (t) => {
cardworks/test/loader.test.ts:240:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:267:test("MemoryCardLoader.move: moves related files with same basename", async (t) => {
cardworks/test/loader.test.ts:268:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:294:test("MemoryCardLoader.move: moves sibling of a .type.card (compound extension)", async (t) => {
cardworks/test/loader.test.ts:298:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:326:test("MemoryCardLoader.move: updates references in other cards", async (t) => {
cardworks/test/loader.test.ts:327:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:352:test("MemoryCardLoader.move: throws if extension changes", async (t) => {
cardworks/test/loader.test.ts:353:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:368:test("MemoryCardLoader.move: handles move to different directory", async (t) => {
cardworks/test/loader.test.ts:369:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:390:test("MemoryCardLoader.findIncomingRefs: finds cards that reference target", async (t) => {
cardworks/test/loader.test.ts:391:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:411:test("MemoryCardLoader.findIncomingRefs: includes ref details", async (t) => {
cardworks/test/loader.test.ts:412:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:430:test("MemoryCardLoader.findIncomingRefs: finds refs from refs attribute", async (t) => {
cardworks/test/loader.test.ts:431:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:448:test("MemoryCardLoader.findOutgoingRefs: finds all references from a card", async (t) => {
cardworks/test/loader.test.ts:449:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:469:test("MemoryCardLoader.findOutgoingRefs: handles nested elements", async (t) => {
cardworks/test/loader.test.ts:470:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:490:test("MemoryCardLoader.move: updates refs attribute", async (t) => {
cardworks/test/loader.test.ts:491:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:516:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:527:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:540:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:551:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:568:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:579:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:598:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:610:test("MemoryCardLoader.saveAs: creates new card at different path", async (t) => {
cardworks/test/loader.test.ts:611:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:631:// serialize method tests
cardworks/test/loader.test.ts:633:test("loader.serialize: returns XML string with loader options", async (t) => {
cardworks/test/loader.test.ts:634:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:642:  const xml = loader.serialize(card.element);
cardworks/test/loader.test.ts:650:test("loader.serialize: compact output when indent is false", async (t) => {
cardworks/test/loader.test.ts:651:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:659:  const xml = loader.serialize(card.element);
cardworks/test/loader.test.ts:666:test("loader.serialize: adds version when requireVersion is true", (t) => {
cardworks/test/loader.test.ts:667:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:681:  const xml = loader.serialize(element);
cardworks/test/loader.test.ts:686:test("loader.serialize: does not add version when requireVersion is false", (t) => {
cardworks/test/loader.test.ts:687:  const loader = new MemoryCardLoader("/project", {
cardworks/test/loader.test.ts:700:  const xml = loader.serialize(element);
callback-box/scripts/migrate/guide.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/guide.ts:58:function text(el: ElementNode): string {
callback-box/scripts/migrate/guide.ts:62:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/guide.ts:66:function childText(el: ElementNode, tag: string): string | undefined {
callback-box/scripts/migrate/guide.ts:73:function strAttr(el: ElementNode, name: string): string | undefined {
callback-box/scripts/migrate/guide.ts:82:function convertRule(r: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/guide.ts:91:function convertExperiment(e: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/guide.ts:117:    const split = splitCardContent(content);
callback-box/scripts/migrate/guide.ts:121:    const root = await parseCard(content, { source: absPath });
cardworks/test/card-schema.test.ts:3:import { cardSchema, body, isBodyField, extractRefs } from "../src/schema/card-schema.js";
cardworks/test/card-schema.test.ts:5:test("body() marks a Zod schema as a body field", (t) => {
cardworks/test/card-schema.test.ts:6:  const field = body(z.string());
cardworks/test/card-schema.test.ts:12:test("body() accepts an xml kind", (t) => {
cardworks/test/card-schema.test.ts:13:  const field = body(z.string(), { kind: "xml" });
cardworks/test/card-schema.test.ts:25:test("cardSchema with all frontmatter fields produces a bodyless shape", (t) => {
cardworks/test/card-schema.test.ts:26:  const schema = cardSchema("email-thread", {
cardworks/test/card-schema.test.ts:45:test("cardSchema with one body field extracts it from the frontmatter shape", (t) => {
cardworks/test/card-schema.test.ts:46:  const schema = cardSchema("doc", {
cardworks/test/card-schema.test.ts:50:      body: body(z.string()),
cardworks/test/card-schema.test.ts:72:test("cardSchema rejects a second body field (it can't be named \"body\")", (t) => {
cardworks/test/card-schema.test.ts:74:    cardSchema("twobody", {
cardworks/test/card-schema.test.ts:76:        body: body(z.string()),
cardworks/test/card-schema.test.ts:77:        b: body(z.string()),
cardworks/test/card-schema.test.ts:85:test("cardSchema rejects empty field set", (t) => {
cardworks/test/card-schema.test.ts:86:  t.throws(() => cardSchema("empty", { fields: {} }), /at least one field/);
cardworks/test/card-schema.test.ts:90:test("cardSchema injects global fields as optional frontmatter", (t) => {
cardworks/test/card-schema.test.ts:91:  const schema = cardSchema("memo-like", {
cardworks/test/card-schema.test.ts:116:  const schema = cardSchema("memo-like", {
cardworks/test/card-schema.test.ts:139:  const schema = cardSchema("titled", {
cardworks/test/card-schema.test.ts:150:    () => cardSchema("misnamed", { fields: { content: body(z.string()) } }),
cardworks/test/card-schema.test.ts:156:test("cardSchema searchable defaults true and is settable", (t) => {
cardworks/test/card-schema.test.ts:157:  const on = cardSchema("content", { fields: { status: z.string() } });
cardworks/test/card-schema.test.ts:159:  const off = cardSchema("job-like", {
cardworks/src/index.ts:12:export { parseXml, parseXmlFile, parseCard, ParseError } from "./parser/parse.js";
cardworks/src/index.ts:13:export { splitCardContent, type SplitCardContent } from "./parser/frontmatter.js";
cardworks/src/index.ts:15:  type ElementNode,
cardworks/src/index.ts:27:  ElementNodeSchema,
cardworks/src/index.ts:29:  type ElementSchema,
cardworks/src/index.ts:33:  cardSchema,
cardworks/src/index.ts:45:export { SchemaRegistry } from "./schema/registry.js";
cardworks/src/index.ts:50:  serialize,
cardworks/src/index.ts:51:  escapeText,
cardworks/src/index.ts:54:} from "./serialize/serialize.js";
cardworks/src/index.ts:66:export { executeXPath, evaluateXPathString } from "./refs/xpath.js";
cardworks/src/index.ts:70:  CardLoader,
cardworks/src/index.ts:71:  MemoryCardLoader,
cardworks/src/index.ts:73:  type ICardLoader,
cardworks/src/index.ts:74:  type CardLoaderOptions,
cardworks/src/index.ts:75:  type MemoryCardLoaderOptions,
cardworks/src/index.ts:82:  lintCard,
cardworks/src/index.ts:83:  lintCards,
cardworks/src/index.ts:87:  formatLintResults,
cardworks/src/index.ts:88:  formatLintResultsJson,
callback-box/scripts/migrate/personality.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/personality.ts:97:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/personality.ts:101:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/personality.ts:108:function convertWithEvidence(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/personality.ts:116:function convertExperiment(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/personality.ts:139:function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/personality.ts:243:  const node = await parseCard(raw, { source: absPath });
cardworks/test/format-error.test.ts:6:import type { ElementNode } from "../src/parser/provenance.js";
cardworks/test/format-error.test.ts:7:import { MemoryCardLoader, ValidationError } from "../src/loader/loader.js";
cardworks/test/format-error.test.ts:9:function makeNode(partial: Partial<ElementNode> & { tagName: string }): ElementNode {
cardworks/test/format-error.test.ts:113:  const loader = new MemoryCardLoader("/project", {
callback-box/src/webapp/context.ts:13:import { parseCardText } from "../core/card-io.js";
callback-box/src/webapp/context.ts:41:      const card = parseCardText(content, { source: q.path, schemas });
callback-box/src/core/extfile-sync.ts:13:import { splitCardContent } from "cardworks";
callback-box/src/core/extfile-sync.ts:44:  const split = splitCardContent(content);
cardworks/README.md:24:import { CardLoader, element } from "cardworks";
cardworks/README.md:28:const loader = new CardLoader("/path/to/project");
cardworks/README.md:89:  element: ElementNode;               // The root XML element
cardworks/README.md:98:### ElementNode
cardworks/README.md:100:The `ElementNode` is the core data structure representing a parsed XML element:
cardworks/README.md:103:interface ElementNode {
cardworks/README.md:108:  children: ElementNode[];            // Child elements
cardworks/README.md:117:// MixedContent is: string | ElementNode | { comment: string }
cardworks/README.md:120:Each ElementNode has a non-enumerable `card` property that references back to its containing Card.
cardworks/README.md:143:import { parseXml } from "cardworks";
cardworks/README.md:236:import { parseXml, ParseError } from "cardworks";
cardworks/README.md:257:import { element } from "cardworks";
cardworks/README.md:295:When you pass schemas to a `CardLoader`, cards are validated automatically on load:
cardworks/README.md:298:import { CardLoader, ValidationError } from "cardworks";
cardworks/README.md:301:const loader = new CardLoader("/project", {
cardworks/README.md:378:import { parseRef } from "cardworks";
cardworks/README.md:392:import { CardLoader } from "cardworks";
cardworks/README.md:394:const loader = new CardLoader("/project");
cardworks/README.md:511:async function loadRecipeWithIngredients(loader: CardLoader, path: string) {
cardworks/README.md:541:Convert `ElementNode` trees back to XML strings.
cardworks/README.md:546:import { CardLoader, serialize } from "cardworks";
cardworks/README.md:548:const loader = new CardLoader("/project");
cardworks/README.md:558:  const output = serialize(card.element);
cardworks/README.md:569:const output = serialize(card, {
cardworks/README.md:577:Cardworks preserves structure through parse-serialize cycles:
cardworks/README.md:590:const output = serialize(card);
cardworks/README.md:598:## CardLoader
cardworks/README.md:600:The `CardLoader` provides high-level card management.
cardworks/README.md:605:import { CardLoader } from "cardworks";
cardworks/README.md:608:const loader = new CardLoader("/path/to/project");
cardworks/README.md:611:const validatingLoader = new CardLoader("/path/to/project", {
cardworks/README.md:619:const loader = new CardLoader("/path/to/project", {
cardworks/README.md:635:| `indent` | `false` | Indent serialized XML (2 spaces) vs compact output |
cardworks/README.md:665:const xml = loader.serialize(card.element);
cardworks/README.md:751:import { CardLoader, lintAll, formatLintResults } from "cardworks";
cardworks/README.md:754:const loader = new CardLoader("/path/to/project", {
cardworks/README.md:759:console.log(formatLintResults(summary, { basePath: "/path/to/project/" }));
cardworks/README.md:777:import { lintCard, lintCards, lintAll } from "cardworks";
cardworks/README.md:780:const result = await lintCard(loader, "/project/Recipe.card");
cardworks/README.md:784:const summary = await lintCards(loader, [path1, path2]);
cardworks/README.md:794:import { formatLintResults, formatLintResultsJson } from "cardworks";
cardworks/README.md:797:console.log(formatLintResults(summary));
cardworks/README.md:800:console.log(formatLintResults(summary, {
cardworks/README.md:807:console.log(formatLintResultsJson(summary));
cardworks/README.md:820:## Testing with MemoryCardLoader
cardworks/README.md:822:For testing, use `MemoryCardLoader` which stores files in memory:
cardworks/README.md:825:import { MemoryCardLoader } from "cardworks";
cardworks/README.md:827:const loader = new MemoryCardLoader("/project", {
cardworks/README.md:840:// Use it just like CardLoader
cardworks/README.md:861:import { defineCardJSX, element } from "cardworks";
cardworks/README.md:892:import { CardLoader } from "cardworks";
cardworks/README.md:908:const loader = new CardLoader("/project");
cardworks/README.md:928:import { createElement, defineCardJSX } from "cardworks";
cardworks/README.md:973:import { JSXValidationError } from "cardworks";
cardworks/README.md:1004:const loader = new CardLoader("/project", { requireVersion: true });
cardworks/README.md:1014:import type { ElementNode, InferJSXElements } from "cardworks";
cardworks/README.md:1022:    interface Element extends ElementNode {}
cardworks/README.md:1035:Cardworks uses a filesystem interface internally. The `CardLoader` and `MemoryCardLoader` handle this automatically, but you can access the underlying filesystem classes directly if needed.
cardworks/README.md:1042:import { NodeFileSystem } from "cardworks";
cardworks/README.md:1053:import { MemoryFileSystem } from "cardworks";
cardworks/README.md:1069:import { NodeFileSystem } from "cardworks";
cardworks/README.md:1094:import type { FileSystem } from "cardworks";
cardworks/README.md:1167:import { CardLoader } from "cardworks";
cardworks/README.md:1170:const loader = new CardLoader("/project");
cardworks/README.md:1263:| `parseXml(xml, source)` | Parse XML string to ElementNode |
cardworks/README.md:1272:| `ElementNodeSchema` | Base schema for any ElementNode |
cardworks/README.md:1279:| `serialize(node, options?)` | Convert ElementNode to XML string |
cardworks/README.md:1295:| `element` | Root ElementNode |
cardworks/README.md:1302:### CardLoader
cardworks/README.md:1309:| `serialize(element)` | Serialize element to XML string with loader options |
cardworks/README.md:1322:| `lintCard(loader, path, options?)` | Lint a single card |
cardworks/README.md:1323:| `lintCards(loader, paths, options?)` | Lint specific cards |
cardworks/README.md:1325:| `formatLintResults(summary, options?)` | Format results for display |
cardworks/README.md:1326:| `formatLintResultsJson(summary)` | Format results as JSON |
cardworks/README.md:1332:| `CardLoader` | File-based card loader for production use |
cardworks/README.md:1333:| `MemoryCardLoader` | In-memory card loader for testing |
cardworks/README.md:1339:| `createElement(tag, props)` | Create ElementNode programmatically |
cardworks/README.md:1345:| `InferJSXProps<S>` | Extract JSX props from ElementSchema |
callback-box/scripts/migrate/misc.ts:16:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/misc.ts:97:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/misc.ts:101:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/misc.ts:108:function convertItem(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:126:function convertTodoList(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:146:function convertTelegramMessage(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:174:function convertFeedback(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/misc.ts:226:  const node = await parseCard(raw, { source: absPath });
cardworks/src/refs/resolve.ts:2:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/refs/resolve.ts:3:import { parseCard } from "../parser/parse.js";
cardworks/src/refs/resolve.ts:73:  let targetNode: ElementNode;
cardworks/src/refs/resolve.ts:76:    targetNode = await parseCard(content, { source: resolvedPath });
cardworks/src/refs/resolve.ts:98:  let fragment: ElementNode | undefined;
cardworks/src/refs/resolve.ts:99:  let fragments: ElementNode[] | undefined;
cardworks/src/refs/resolve.ts:215:  nodes: ElementNode[];
cardworks/src/refs/resolve.ts:223:function resolveFragment(fragment: RefFragment, root: ElementNode): FragmentResult {
cardworks/src/refs/resolve.ts:246:function findById(node: ElementNode, id: string): ElementNode | undefined {
callback-box/src/core/reactor/procedure-trampoline.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/core/reactor/procedure-trampoline.ts:24:    const root = await parseCard(content, { source: filePath });
callback-box/src/core/reactor/procedure-trampoline.ts:25:    for (const child of root.children as ElementNode[]) {
callback-box/src/core/reactor/procedure-trampoline.ts:28:        for (const grandchild of (child.children ?? []) as ElementNode[]) {
callback-box/test/helpers/check-serializers.ts:2: * Custom serializers for t.check() in route tests.
callback-box/docs/testing-gaps.md:82:- **Property testing** — Semantically meaningful invariants via fast-check (e.g., `parse(serialize(x)) === x`).
cardworks/src/refs/types.ts:1:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/refs/types.ts:44:  fragment?: ElementNode | undefined;
cardworks/src/refs/types.ts:46:  fragments?: ElementNode[] | undefined;
callback-box/scripts/migrate/chat-thread.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/chat-thread.ts:25:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/chat-thread.ts:83:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/chat-thread.ts:90:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/chat-thread.ts:141:  const node = await parseCard(raw, { source: absPath });
cardworks/test/jsx.test.ts:5:import { MemoryCardLoader } from "../src/loader/loader.js";
cardworks/test/jsx.test.ts:294:// Integration with CardLoader
cardworks/test/jsx.test.ts:296:test("JSX card can be saved via CardLoader", async (t) => {
cardworks/test/jsx.test.ts:305:  const loader = new MemoryCardLoader("/project");
callback-box/test/helpers/doctest-server.ts:6: * so check() works directly without custom serializers.
cardworks/src/schema/card-schema.ts:16: * Thrown when a cardSchema() declaration is invalid (multiple body fields,
cardworks/src/schema/card-schema.ts:22:    super(`cardSchema(${type}): ${detail}`);
cardworks/src/schema/card-schema.ts:68: * A field declaration: either a Zod schema (frontmatter) or a body()-wrapped
cardworks/src/schema/card-schema.ts:75: * the frontmatter schema by cardSchema() unless the schema declares its own
cardworks/src/schema/card-schema.ts:84: *   structural field set by the serializer, not author data, so it is allowed on
cardworks/src/schema/card-schema.ts:96: * Configuration for cardSchema().
cardworks/src/schema/card-schema.ts:99:  /** All fields keyed by name. At most one may be body()-wrapped. */
cardworks/src/schema/card-schema.ts:111: * Resolved shape of a card schema. Used by loaders, serializers, and migration
cardworks/src/schema/card-schema.ts:135: * Declare a card schema. The result tells the loader/serializer which
cardworks/src/schema/card-schema.ts:142:export function cardSchema<
cardworks/src/refs/xpath.ts:3:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/refs/xpath.ts:14:  /** Matched ElementNodes (empty if no matches) */
cardworks/src/refs/xpath.ts:15:  nodes: ElementNode[];
cardworks/src/refs/xpath.ts:26:  /** The root ElementNode to query */
cardworks/src/refs/xpath.ts:27:  root: ElementNode;
cardworks/src/refs/xpath.ts:33: * Execute an XPath query against an ElementNode tree.
cardworks/src/refs/xpath.ts:36: * @param options - The root ElementNode to query and whether one match is expected
cardworks/src/refs/xpath.ts:43:  // Rebuild DOM from ElementNode
cardworks/src/refs/xpath.ts:79:  // Map DOM nodes back to ElementNodes
cardworks/src/refs/xpath.ts:80:  const matchedNodes = mapDomNodesToElementNodes(elementDomNodes, { root, doc });
cardworks/src/refs/xpath.ts:94: * Convert an ElementNode tree to an XML Document.
cardworks/src/refs/xpath.ts:96:function elementNodeToDocument(root: ElementNode): XmldomDocument {
cardworks/src/refs/xpath.ts:97:  const xml = serializeElementNode(root);
cardworks/src/refs/xpath.ts:103: * Serialize an ElementNode to XML string.
cardworks/src/refs/xpath.ts:105:function serializeElementNode(node: ElementNode): string {
cardworks/src/refs/xpath.ts:135:        parts.push(escapeText(item));
cardworks/src/refs/xpath.ts:139:        parts.push(serializeElementNode(item));
cardworks/src/refs/xpath.ts:144:      parts.push(escapeText(node.text));
cardworks/src/refs/xpath.ts:147:      parts.push(serializeElementNode(child));
cardworks/src/refs/xpath.ts:160:function escapeText(text: string): string {
cardworks/src/refs/xpath.ts:168: * Map DOM Element nodes back to their corresponding ElementNodes.
cardworks/src/refs/xpath.ts:171: * matched DOM node, then following the same path in the ElementNode tree.
cardworks/src/refs/xpath.ts:174:  root: ElementNode;
cardworks/src/refs/xpath.ts:178:function mapDomNodesToElementNodes(
cardworks/src/refs/xpath.ts:181:): ElementNode[] {
cardworks/src/refs/xpath.ts:182:  const results: ElementNode[] = [];
cardworks/src/refs/xpath.ts:193:      // Follow path in ElementNode tree
cardworks/src/refs/xpath.ts:250: * Follow a path of child indices in an ElementNode tree.
cardworks/src/refs/xpath.ts:252:function followPath(root: ElementNode, path: number[]): ElementNode | null {
cardworks/src/refs/xpath.ts:253:  let current: ElementNode = root;
cardworks/src/refs/xpath.ts:272: * Evaluate an XPath expression against an ElementNode tree and return a string result.
cardworks/src/refs/xpath.ts:274: * Unlike executeXPath which returns ElementNode references, this function extracts
cardworks/src/refs/xpath.ts:279: * @param root - The root ElementNode to query
cardworks/src/refs/xpath.ts:282:export function evaluateXPathString(expr: string, root: ElementNode): string {
cardworks/src/refs/xpath.ts:324: * Get element children from an ElementNode (handles both children and mixed).
cardworks/src/refs/xpath.ts:326:function getElementChildren(node: ElementNode): ElementNode[] {
cardworks/src/refs/xpath.ts:329:      (item): item is ElementNode =>
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:8:import { parseCardText } from "../../../core/card-io.js";
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:144:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
cardworks/test/lint.test.ts:2:import { MemoryCardLoader } from "../src/loader/loader.js";
cardworks/test/lint.test.ts:3:import { lintCard, lintAll, formatLintResults } from "../src/lint/index.js";
cardworks/test/lint.test.ts:11:test("lintCard: valid card returns no errors", async (t) => {
cardworks/test/lint.test.ts:12:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:19:  const result = await lintCard(loader, { path: "/project/Valid.card" });
cardworks/test/lint.test.ts:25:test("lintCard: parse error is reported", async (t) => {
cardworks/test/lint.test.ts:26:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:32:  const result = await lintCard(loader, { path: "/project/Invalid.card" });
cardworks/test/lint.test.ts:39:test("lintCard: validation error is reported", async (t) => {
cardworks/test/lint.test.ts:44:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:51:  const result = await lintCard(loader, { path: "/project/Invalid.card" });
cardworks/test/lint.test.ts:57:test("lintCard: broken reference is reported", async (t) => {
cardworks/test/lint.test.ts:58:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:66:  const result = await lintCard(loader, { path: "/project/Main.card" });
cardworks/test/lint.test.ts:73:test("lintCard: version mismatch is reported as warning", async (t) => {
cardworks/test/lint.test.ts:74:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:83:  const result = await lintCard(loader, { path: "/project/Main.card" });
cardworks/test/lint.test.ts:91:test("lintCard: checkRefs can be disabled", async (t) => {
cardworks/test/lint.test.ts:92:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:100:  const result = await lintCard(loader, { path: "/project/Main.card", checkRefs: false });
cardworks/test/lint.test.ts:107:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:124:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:138:test("formatLintResults: formats clean results", async (t) => {
cardworks/test/lint.test.ts:139:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:147:  const output = formatLintResults(summary, { colors: false });
cardworks/test/lint.test.ts:153:test("formatLintResults: formats errors", async (t) => {
cardworks/test/lint.test.ts:154:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:161:  const output = formatLintResults(summary, { colors: false });
cardworks/test/lint.test.ts:168:test("formatLintResults: basePath shortens paths", async (t) => {
cardworks/test/lint.test.ts:169:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:176:  const output = formatLintResults(summary, { colors: false, basePath: "/project/" });
cardworks/test/lint.test.ts:185:test("lintCard: duplicate IDs are reported as warning", async (t) => {
cardworks/test/lint.test.ts:186:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:196:  const result = await lintCard(loader, { path: "/project/DupIds.card" });
cardworks/test/lint.test.ts:204:test("lintCard: multiple duplicate IDs are all reported", async (t) => {
cardworks/test/lint.test.ts:205:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:217:  const result = await lintCard(loader, { path: "/project/MultiDup.card" });
cardworks/test/lint.test.ts:224:test("lintCard: refs attribute checks multiple references", async (t) => {
cardworks/test/lint.test.ts:225:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:235:  const result = await lintCard(loader, { path: "/project/Main.card" });
cardworks/test/lint.test.ts:243:test("lintCard: refs attribute reports version mismatches", async (t) => {
cardworks/test/lint.test.ts:244:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:254:  const result = await lintCard(loader, { path: "/project/Main.card" });
cardworks/test/lint.test.ts:262:test("lintCard: fragment errors are reported", async (t) => {
cardworks/test/lint.test.ts:263:  const loader = new MemoryCardLoader("/project", {
cardworks/test/lint.test.ts:274:  const result = await lintCard(loader, { path: "/project/Main.card" });
callback-box/scripts/migrate/doc-sheet.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/doc-sheet.ts:73:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/doc-sheet.ts:77:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/doc-sheet.ts:81:function convertDoc(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/doc-sheet.ts:121:function convertSheet(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/doc-sheet.ts:166:  const node = await parseCard(raw, { source: absPath });
cardworks/src/loader/types.ts:1:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/loader/types.ts:3:import type { SchemaRegistry } from "../schema/registry.js";
cardworks/src/loader/types.ts:4:import type { ElementSchema } from "../schema/element.js";
cardworks/src/loader/types.ts:40:export interface CardLoaderOptions {
cardworks/src/loader/types.ts:42:  schemas?: SchemaRegistry | ElementSchema[];
cardworks/src/loader/types.ts:50:   * Whether to indent serialized XML.
cardworks/src/loader/types.ts:58: * Options for MemoryCardLoader.
cardworks/src/loader/types.ts:60:export interface MemoryCardLoaderOptions extends CardLoaderOptions {
cardworks/src/loader/types.ts:68:export interface ICardLoader {
cardworks/src/loader/types.ts:87:  serialize(element: ElementNode): string;
cardworks/src/loader/types.ts:147:  validateContent(content: string, sourceName?: string): Promise<ElementNode>;
cardworks/test/parser.test.ts:2:import { parseXml, parseCard } from "../src/parser/parse.js";
cardworks/test/parser.test.ts:3:import { splitCardContent } from "../src/parser/frontmatter.js";
cardworks/test/parser.test.ts:199:test("splitCardContent returns input unchanged when no frontmatter", (t) => {
cardworks/test/parser.test.ts:200:  const r = splitCardContent("<root/>");
cardworks/test/parser.test.ts:207:test("splitCardContent peels off a frontmatter block", (t) => {
cardworks/test/parser.test.ts:208:  const r = splitCardContent("---\ncontent-type: application/x-card+xml\n---\n<root/>\n");
cardworks/test/parser.test.ts:216:test("parseCard handles a card with frontmatter and reports original-file lines", async (t) => {
cardworks/test/parser.test.ts:218:  const result = await parseCard(text, { source: "frontmattered.card" });
cardworks/test/parser.test.ts:226:test("parseCard is a no-op when there is no frontmatter", async (t) => {
cardworks/test/parser.test.ts:228:  const result = await parseCard(text, { source: "plain.card" });
callback-box/src/webapp/trpc/routers/todos.ts:9:import { CardLoader, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/todos.ts:22:      const loader = new CardLoader(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/todos.ts:35:      function updateInChildren(children: ElementNode[]): boolean {
callback-box/src/webapp/trpc/routers/todos.ts:47:            if (updateInChildren(child.children as ElementNode[])) return true;
callback-box/src/webapp/trpc/routers/todos.ts:53:      const found = updateInChildren((card.element.children ?? []) as ElementNode[]);
cardworks/src/schema/registry.ts:2:import type { ElementSchema } from "./element.js";
cardworks/src/schema/registry.ts:7:export class SchemaRegistry {
cardworks/src/schema/registry.ts:13:   * @param schemas - Optional array of ElementSchemas to register
cardworks/src/schema/registry.ts:15:  constructor(schemas?: ElementSchema[]) {
cardworks/src/schema/registry.ts:25:   * @param schema - The ElementSchema to register (must have .tagName)
cardworks/src/schema/registry.ts:27:  register(schema: ElementSchema): void {
callback-box/src/webapp/routes/api-browse.ts:13:import { parseCardName } from "../../cli/lib/paths.js";
callback-box/src/webapp/routes/api-browse.ts:72:        const parsed = parseCardName(entry.name);
callback-box/src/webapp/routes/api-browse.ts:92:        const parsed = parseCardName(entry.name);
callback-box/scripts/migrate/memo.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/memo.ts:57:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/memo.ts:61:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/memo.ts:68:function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/memo.ts:122:  const node = await parseCard(raw, { source: absPath });
cardworks/test/schema.test.ts:3:import { element, ElementNodeSchema } from "../src/schema/element.js";
cardworks/test/schema.test.ts:4:import type { ElementNode } from "../src/parser/provenance.js";
cardworks/test/schema.test.ts:7:function makeNode(partial: Partial<ElementNode> & { tagName: string }): ElementNode {
cardworks/test/schema.test.ts:181:test("ElementNodeSchema validates basic element structure", (t) => {
cardworks/test/schema.test.ts:186:  t.ok(ElementNodeSchema.safeParse(validNode).success, "accepts valid element");
cardworks/test/schema.test.ts:195:  t.notOk(ElementNodeSchema.safeParse(invalid).success, "rejects invalid element");
callback-box/src/core/preactions/index.ts:11: * - Phase 1 XML-bodied cards (loaded via cardworks ICardLoader)
callback-box/src/core/preactions/index.ts:21:import type { ICardLoader } from "cardworks";
callback-box/src/core/preactions/index.ts:50:  loader: ICardLoader;
callback-box/src/core/preactions/index.ts:91:  loader: ICardLoader;
callback-box/src/webapp/routes/scheduler.ts:16:import { parseCardText } from "../../core/card-io.js";
callback-box/src/webapp/routes/scheduler.ts:116:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
cardworks/src/schema/element.ts:7:export interface ElementSchema<T = unknown> extends ZodType<T> {
cardworks/src/schema/element.ts:15: * Base schema for any ElementNode without tag-specific validation.
cardworks/src/schema/element.ts:17:export const ElementNodeSchema: ZodType<{
cardworks/src/schema/element.ts:39:      .array(z.union([z.string(), MixedCommentSchema, z.lazy(() => ElementNodeSchema)]))
cardworks/src/schema/element.ts:41:    children: z.array(ElementNodeSchema),
cardworks/src/schema/element.ts:82:): ElementSchema<{
cardworks/src/schema/element.ts:117:    mixed: z.array(z.union([z.string(), MixedCommentSchema, ElementNodeSchema])).optional(),
cardworks/src/schema/element.ts:124:  const schemaWithTag = schema.passthrough() as unknown as ElementSchema<{
callback-box/src/core/preactions/types.ts:1:import type { Card, ICardLoader, CardSchema } from "cardworks";
callback-box/src/core/preactions/types.ts:19:  loader: ICardLoader;
cardworks/src/loader/loader.ts:2:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/loader/loader.ts:3:import { parseCard } from "../parser/parse.js";
cardworks/src/loader/loader.ts:4:import { serialize as serializeElement } from "../serialize/serialize.js";
cardworks/src/loader/loader.ts:8:import { SchemaRegistry } from "../schema/registry.js";
cardworks/src/loader/loader.ts:19:  CardLoaderOptions,
cardworks/src/loader/loader.ts:21:  ICardLoader,
cardworks/src/loader/loader.ts:22:  MemoryCardLoaderOptions,
cardworks/src/loader/loader.ts:27:  CardLoaderOptions,
cardworks/src/loader/loader.ts:29:  ICardLoader,
cardworks/src/loader/loader.ts:30:  MemoryCardLoaderOptions,
cardworks/src/loader/loader.ts:74: * Constructor arguments for {@link BaseCardLoader}, grouping the filesystem
cardworks/src/loader/loader.ts:77:interface BaseCardLoaderArgs {
cardworks/src/loader/loader.ts:79:  options?: CardLoaderOptions;
cardworks/src/loader/loader.ts:85:abstract class BaseCardLoader implements ICardLoader {
cardworks/src/loader/loader.ts:86:  protected readonly schemas: SchemaRegistry;
cardworks/src/loader/loader.ts:93:    { fs, options }: BaseCardLoaderArgs
cardworks/src/loader/loader.ts:97:    if (options.schemas instanceof SchemaRegistry) {
cardworks/src/loader/loader.ts:100:      this.schemas = new SchemaRegistry(options.schemas);
cardworks/src/loader/loader.ts:102:      this.schemas = new SchemaRegistry();
cardworks/src/loader/loader.ts:119:  protected prepareForSave(element: ElementNode): ElementNode {
cardworks/src/loader/loader.ts:135:   * @param element - The ElementNode to serialize
cardworks/src/loader/loader.ts:138:  serialize(element: ElementNode): string {
cardworks/src/loader/loader.ts:140:    return serializeElement(prepared, this.getSerializeOptions());
cardworks/src/loader/loader.ts:153:    const node = await parseCard(content, { source: path });
cardworks/src/loader/loader.ts:166:    // Use serialized content as snapshot for consistent dirty comparison
cardworks/src/loader/loader.ts:167:    // Note: uses default serialize options (not loader options) since Card.isDirty()
cardworks/src/loader/loader.ts:168:    // compares against serializeElement() with default options
cardworks/src/loader/loader.ts:169:    const snapshot = serializeElement(node);
cardworks/src/loader/loader.ts:176:   * @param card - The Card to serialize and write
cardworks/src/loader/loader.ts:180:    const content = serializeElement(element, this.getSerializeOptions());
cardworks/src/loader/loader.ts:193:    const content = serializeElement(element, this.getSerializeOptions());
cardworks/src/loader/loader.ts:262:  async validateContent(content: string, sourceName?: string): Promise<ElementNode> {
cardworks/src/loader/loader.ts:264:    const node = await parseCard(content, { source: sourceName });
cardworks/src/loader/loader.ts:331:        const node = await parseCard(content, { source: cardPath });
cardworks/src/loader/loader.ts:341:          await this.fs.write(cardPath, serializeElement(node, this.getSerializeOptions()));
cardworks/src/loader/loader.ts:359:    const content = serializeElement(element, this.getSerializeOptions());
cardworks/src/loader/loader.ts:388:        const node = await parseCard(content, { source: cardPath });
cardworks/src/loader/loader.ts:414:    const node = await parseCard(content, { source: sourcePath });
cardworks/src/loader/loader.ts:431: * const loader = new CardLoader("/path/to/project", {
cardworks/src/loader/loader.ts:437:export class CardLoader extends BaseCardLoader {
cardworks/src/loader/loader.ts:438:  constructor(projectRoot: string, options?: CardLoaderOptions) {
cardworks/src/loader/loader.ts:448: * const loader = new MemoryCardLoader("/project", {
cardworks/src/loader/loader.ts:457:export class MemoryCardLoader extends BaseCardLoader {
cardworks/src/loader/loader.ts:460:  constructor(projectRoot: string, options?: MemoryCardLoaderOptions) {
callback-box/scripts/migrate/scheduled-script.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/scheduled-script.ts:29:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/scheduled-script.ts:75:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/scheduled-script.ts:82:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/scheduled-script.ts:158:  const node = await parseCard(raw, { source: absPath });
callback-box/src/webapp/routes/api-card-routes.ts:47:        const xml = loader.serialize(card.element);
callback-box/src/webapp/routes/api-card-routes.ts:130:        const xml = loader.serialize(updated.element);
callback-box/src/core/preactions/transcribe.ts:18:import type { ElementNode } from "cardworks";
callback-box/src/core/preactions/transcribe.ts:165:function hasXmlTranscription(element: ElementNode): boolean {
callback-box/src/core/preactions/transcribe.ts:170:function hasXmlPermanentError(element: ElementNode): boolean {
callback-box/src/core/preactions/transcribe.ts:175:function getXmlContent(element: ElementNode): string | null {
callback-box/src/core/preactions/transcribe.ts:181:  element: ElementNode;
callback-box/src/core/preactions/transcribe.ts:204:  element: ElementNode,
cardworks/src/parser/frontmatter.ts:40:export function splitCardContent(content: string): SplitCardContent {
cardworks/src/loader/ref-traversal.ts:2:import type { ElementNode } from "../parser/provenance.js";
cardworks/src/loader/ref-traversal.ts:29:  node: ElementNode,
cardworks/src/loader/ref-traversal.ts:145:  node: ElementNode,
callback-box/scripts/migrate/procedure-run.ts:17:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/procedure-run.ts:46:function text(el: ElementNode): string {
callback-box/scripts/migrate/procedure-run.ts:50:function childText(el: ElementNode, tag: string): string | undefined {
callback-box/scripts/migrate/procedure-run.ts:57:function copyAttr(from: ElementNode, name: string, into: Record<string, unknown>, key: string): void {
callback-box/scripts/migrate/procedure-run.ts:62:function convertPhase(phase: ElementNode | undefined, kind: "precheck" | "run" | "validate"): Record<string, unknown> | undefined {
callback-box/scripts/migrate/procedure-run.ts:81:function convertStep(step: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure-run.ts:101:    const split = splitCardContent(content);
callback-box/scripts/migrate/procedure-run.ts:105:    const root = await parseCard(content, { source: absPath });
callback-box/src/webapp/trpc/routers/card.ts:7:import { parseCard, splitCardContent, type CardSchema, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/card.ts:8:import { parseCardText } from "../../../core/card-io.js";
callback-box/src/webapp/trpc/routers/card.ts:22:function sanitizeElement(el: ElementNode): JsonElement {
callback-box/src/webapp/trpc/routers/card.ts:31:    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/src/webapp/trpc/routers/card.ts:39:function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
callback-box/src/webapp/trpc/routers/card.ts:41:  let current: ElementNode = el;
callback-box/src/webapp/trpc/routers/card.ts:55: * Parse a simple XML fragment into an ElementNode.
callback-box/src/webapp/trpc/routers/card.ts:57:function parseXmlFragment(xml: string): ElementNode | null {
callback-box/src/webapp/trpc/routers/card.ts:79:  } as ElementNode;
callback-box/src/webapp/trpc/routers/card.ts:106:  cardSchemas: Map<string, CardSchema>;
callback-box/src/webapp/trpc/routers/card.ts:108:  const { raw, source, type, cardSchemas } = input;
callback-box/src/webapp/trpc/routers/card.ts:115:    const parsed = parseCardText(raw, { source, schemas: cardSchemas, type });
callback-box/src/webapp/trpc/routers/card.ts:131:    const split = splitCardContent(raw);
callback-box/src/webapp/trpc/routers/card.ts:183:      // Dispatch on file shape: frontmatter cards parse via parseCardText;
callback-box/src/webapp/trpc/routers/card.ts:196:      const split = splitCardContent(raw);
callback-box/src/webapp/trpc/routers/card.ts:198:      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/card.ts:199:      if (split.hasFrontmatter && fileType !== undefined && cardSchemas.has(fileType)) {
callback-box/src/webapp/trpc/routers/card.ts:200:        return loadFrontmatterCard({ raw, source: input.path, type: fileType, cardSchemas });
callback-box/src/webapp/trpc/routers/card.ts:207:        const xml = loader.serialize(card.element);
callback-box/src/webapp/trpc/routers/card.ts:248:          const parsed = await parseCard(rawXml, { source: input.path });
callback-box/src/webapp/trpc/routers/card.ts:317:        const xml = loader.serialize(updated.element);
callback-box/src/dev/knowledge-audits.yaml:1825:  # schemas) but never `cardSchemas` (24 phase-2 YAML schemas), so
callback-box/src/dev/knowledge-audits.yaml:1842:      but not `cardSchemas`, so phase-2 per-schema docs never regenerated.
cardworks/test/round-trip.test.ts:3:import { serialize } from "../src/serialize/serialize.js";
cardworks/test/round-trip.test.ts:11:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:12:  const reparsed = await parseXml(serialized, { source: "test.card" });
cardworks/test/round-trip.test.ts:24:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:25:  const reparsed = await parseXml(serialized, { source: "test.card" });
cardworks/test/round-trip.test.ts:42:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:43:  const reparsed = await parseXml(serialized, { source: "test.card" });
cardworks/test/round-trip.test.ts:57:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:58:  const reparsed = await parseXml(serialized, { source: "test.card" });
cardworks/test/round-trip.test.ts:71:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:74:  t.ok(serialized.includes("Comment before"), "contains before comment");
cardworks/test/round-trip.test.ts:75:  t.ok(serialized.includes("Comment after"), "contains after comment");
cardworks/test/round-trip.test.ts:82:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:83:  const reparsed = await parseXml(serialized, { source: "test.card" });
cardworks/test/round-trip.test.ts:98:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:99:  const reparsed = await parseXml(serialized, { source: "test.card" });
cardworks/test/round-trip.test.ts:108:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:109:  const reparsed = await parseXml(serialized, { source: "test.card" });
cardworks/test/round-trip.test.ts:117:test("serialize: configurable indentation", async (t) => {
cardworks/test/round-trip.test.ts:122:  const withTwoSpaces = serialize(parsed, { indent: "  " });
cardworks/test/round-trip.test.ts:123:  const withFourSpaces = serialize(parsed, { indent: "    " });
cardworks/test/round-trip.test.ts:129:test("serialize: attribute escaping", async (t) => {
cardworks/test/round-trip.test.ts:133:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:137:    serialized.includes('&quot;') || serialized.includes("&apos;") || serialized.includes('"'),
cardworks/test/round-trip.test.ts:149:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:150:  const reparsed = await parseXml(serialized, { source: "Simple.audience.card" });
cardworks/test/round-trip.test.ts:169:  const serialized = serialize(parsed);
cardworks/test/round-trip.test.ts:170:  const reparsed = await parseXml(serialized, { source: "With_Interleaved.technique.card" });
cardworks/src/parser/dom-to-object.ts:1:import type { ElementNode, Location, Comments, MixedContent } from "./provenance.js";
cardworks/src/parser/dom-to-object.ts:145: * Transform a DOM element to an ElementNode.
cardworks/src/parser/dom-to-object.ts:150:): ElementNode {
cardworks/src/parser/dom-to-object.ts:167:  const children: ElementNode[] = [];
cardworks/src/parser/dom-to-object.ts:222:  const result: ElementNode = {
callback-box/test/card-lint.doctest.md:3:`lintCardsDispatch` is the validate-time counterpart to
callback-box/test/card-lint.doctest.md:11:  cardSchema,
callback-box/test/card-lint.doctest.md:14:  type ElementSchema,
callback-box/test/card-lint.doctest.md:15:} from "cardworks";
callback-box/test/card-lint.doctest.md:18:import { lintCardsDispatch } from "../src/core/card-lint.js";
callback-box/test/card-lint.doctest.md:23:const threadSchema: CardSchema = cardSchema("email-thread", {
callback-box/test/card-lint.doctest.md:36:const docSchema: CardSchema = cardSchema("doc", {
callback-box/test/card-lint.doctest.md:39:    body: body(z.string()),
callback-box/test/card-lint.doctest.md:43:const memoSchema: ElementSchema = element("memo", {
callback-box/test/card-lint.doctest.md:48:  cardSchemas: new Map<string, CardSchema>([
callback-box/test/card-lint.doctest.md:54:  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
callback-box/test/card-lint.doctest.md:71:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:91:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:115:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:141:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:170:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:202:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:232:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:240:## XML cards still flow through the existing cardworks lintCard path
callback-box/test/card-lint.doctest.md:249:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:269:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:290:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:314:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:336:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:353:const result = await lintCardsDispatch(
callback-box/test/card-lint.doctest.md:370:const result = await lintCardsDispatch(
callback-box/scripts/migrate/question.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/question.ts:27:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/question.ts:78:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/question.ts:85:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/question.ts:153:  const node = await parseCard(raw, { source: absPath });
cardworks/src/parser/parse.ts:2:import type { ElementNode, Location } from "./provenance.js";
cardworks/src/parser/parse.ts:4:import { splitCardContent } from "./frontmatter.js";
cardworks/src/parser/parse.ts:49: * Parse XML content into an ElementNode tree.
cardworks/src/parser/parse.ts:53: * @returns The parsed ElementNode tree
cardworks/src/parser/parse.ts:56:export function parseXml(xml: string, options: ParseXmlOptions): Promise<ElementNode> {
cardworks/src/parser/parse.ts:139:): Promise<ElementNode> {
cardworks/src/parser/parse.ts:141:  return parseCard(content, { source: path });
cardworks/src/parser/parse.ts:151:export function parseCard(content: string, options: ParseXmlOptions): Promise<ElementNode> {
cardworks/src/parser/parse.ts:153:  const split = splitCardContent(content);
callback-box/src/core/landmark/resolve.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/core/landmark/resolve.ts:153:  const split = splitCardContent(content);
callback-box/test/selection-serialize.doctest.md:4:message body. The single serializer every send path shares: `[selectionN]`
callback-box/test/selection-serialize.doctest.md:11:import { applySelections } from "../src/frontend/src/lib/selection-serialize.js";
callback-box/test/schemas.doctest.md:11:  createSchemaRegistry,
callback-box/test/schemas.doctest.md:18:import { parseCard } from "cardworks";
callback-box/test/schemas.doctest.md:58:The full registry of XML schemas is available via `createSchemaRegistry()`:
callback-box/test/schemas.doctest.md:61:const registry = await createSchemaRegistry();
callback-box/scripts/migrate/_warnings.ts:18:import type { ElementNode } from "cardworks";
callback-box/scripts/migrate/_warnings.ts:49:  node: ElementNode;
callback-box/src/webapp/trpc/routers/chat.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/chat.ts:43:function findNavigation(element: ElementNode): ElementNode | null {
callback-box/src/webapp/trpc/routers/chat.ts:50:function readChildText(navigation: ElementNode | null, tagName: string): string {
callback-box/src/webapp/trpc/routers/chat.ts:61:  navigation: ElementNode | null,
callback-box/src/webapp/trpc/routers/chat.ts:100:    let element: ElementNode;
callback-box/src/webapp/trpc/routers/chat.ts:103:      element = await parseCard(content, { source: absPath });
cardworks/src/parser/provenance.ts:37:export type MixedContent = string | ElementNode | MixedComment;
cardworks/src/parser/provenance.ts:42:export interface ElementNode {
cardworks/src/parser/provenance.ts:54:  children: ElementNode[];
callback-box/test/view-url.doctest.md:8:  serializeViewUrl,
callback-box/test/view-url.doctest.md:27:`serializeViewUrl` is the round-trip inverse (without the `view:` prefix):
callback-box/test/view-url.doctest.md:30:serializeViewUrl({ path: "a/b.md", viewer: "source", params: {}, zoom: true })
callback-box/test/check.test.ts:86:test("serialize objects as JSON", async (t) => {
callback-box/test/check.test.ts:96:test("serialize null and undefined", async (t) => {
callback-box/test/check.test.ts:101:test("serialize numbers", async (t) => {
callback-box/test/check.test.ts:106:test("custom serializer takes priority", async (t) => {
callback-box/test/check.test.ts:132:test("check awaits promise and serializes result", async (t) => {
callback-box/test/check.test.ts:158:test("print() with serialized return value", async (t) => {
cardworks/src/serialize/serialize.ts:1:import type { ElementNode, MixedContent, MixedComment } from "../parser/provenance.js";
cardworks/src/serialize/serialize.ts:16:export function escapeText(text: string): string {
cardworks/src/serialize/serialize.ts:35: * Serialize an ElementNode back to XML string.
cardworks/src/serialize/serialize.ts:37: * @param node - The ElementNode to serialize
cardworks/src/serialize/serialize.ts:41:export function serialize(
cardworks/src/serialize/serialize.ts:42:  node: ElementNode,
cardworks/src/serialize/serialize.ts:53:  serializeNode(node, { lines, depth: 0, indent });
cardworks/src/serialize/serialize.ts:59: * Options for {@link serializeNode}: the output buffer, current depth, and
cardworks/src/serialize/serialize.ts:71:function serializeNode(
cardworks/src/serialize/serialize.ts:72:  node: ElementNode,
cardworks/src/serialize/serialize.ts:83:  const attrs = serializeAttrs(node.attrs);
cardworks/src/serialize/serialize.ts:96:    const textContent = serializeTextContent(node.text ?? "", { depth, indent });
cardworks/src/serialize/serialize.ts:104:      lines.push(`${padding}${tagOpen}>${escapeText(textContent)}</${node.tagName}>`);
cardworks/src/serialize/serialize.ts:108:    const mixedContent = serializeMixedContent(node.mixed ?? []);
cardworks/src/serialize/serialize.ts:114:      serializeNode(child, { lines, depth: depth + 1, indent });
cardworks/src/serialize/serialize.ts:128:function serializeAttrs(attrs: Record<string, string>): string {
cardworks/src/serialize/serialize.ts:135: * Options for {@link serializeTextContent}.
cardworks/src/serialize/serialize.ts:145:function serializeTextContent(
cardworks/src/serialize/serialize.ts:157:  return lines.map((line) => `${padding}${escapeText(line)}`).join("\n");
cardworks/src/serialize/serialize.ts:170:function serializeMixedContent(mixed: MixedContent[]): string {
cardworks/src/serialize/serialize.ts:176:      parts.push(escapeText(item));
cardworks/src/serialize/serialize.ts:181:      // Element node - serialize inline
cardworks/src/serialize/serialize.ts:182:      const attrs = serializeAttrs(item.attrs);
cardworks/src/serialize/serialize.ts:186:        parts.push(`${tagOpen}>${escapeText(item.text)}</${item.tagName}>`);
cardworks/src/serialize/serialize.ts:188:        // Nested children in mixed content - serialize recursively inline
cardworks/src/serialize/serialize.ts:191:          serializeNode(child, { lines: childLines, depth: 0, indent: "" });
callback-box/src/webapp/trpc/routers/scheduler.ts:10:import { splitCardContent } from "cardworks";
callback-box/src/webapp/trpc/routers/scheduler.ts:15:import { parseCardText } from "../../../core/card-io.js";
callback-box/src/webapp/trpc/routers/scheduler.ts:114:      const split = splitCardContent(content);
callback-box/src/webapp/trpc/routers/scheduler.ts:152:      const card = parseCardText(content, { source: fileName, schemas: await createCardSchemaMap(ctx.boxRoot) });
callback-box/src/webapp/routes/views.ts:21:import type { ElementNode } from "cardworks";
callback-box/src/webapp/routes/views.ts:28:function elementToViewCardChild(el: ElementNode): ViewCardChild {
callback-box/src/webapp/routes/views.ts:38:      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
callback-box/src/webapp/routes/views.ts:157:      // The body field is always named `body` — enforced by cardSchema().
callback-box/src/webapp/routes/views.ts:187:      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/test/contains-state.doctest.md:25:  cardSchemas: await createCardSchemaMap(),
callback-box/test/contains-state.doctest.md:26:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/src/core/markdoc-emit.ts:10: * **Why not `Markdoc.format()`.** The upstream serializer has several
callback-box/scripts/migrate/procedure.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/procedure.ts:50:function dtext(el: ElementNode): string {
callback-box/scripts/migrate/procedure.ts:54:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/procedure.ts:58:function convertPhase(phase: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure.ts:84:function convertStep(step: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure.ts:119:    const split = splitCardContent(content);
callback-box/scripts/migrate/procedure.ts:123:    const root = await parseCard(content, { source: absPath });
callback-box/test/card-io.doctest.md:10:  cardSchema,
callback-box/test/card-io.doctest.md:14:  type ElementSchema,
callback-box/test/card-io.doctest.md:15:} from "cardworks";
callback-box/test/card-io.doctest.md:17:  parseCardText,
callback-box/test/card-io.doctest.md:18:  serializeCardText,
callback-box/test/card-io.doctest.md:25:const docSchema: CardSchema = cardSchema("doc", {
callback-box/test/card-io.doctest.md:29:    body: body(z.string()),
callback-box/test/card-io.doctest.md:33:const threadSchema: CardSchema = cardSchema("email-thread", {
callback-box/test/card-io.doctest.md:51:const card = parseCardText(text, { source: "thread.email-thread.card", schemas });
callback-box/test/card-io.doctest.md:63:const card = parseCardText(text, { source: "x.doc.card", schemas });
callback-box/test/card-io.doctest.md:75:  try { parseCardText(text, { source, schemas }); return "did not throw"; }
callback-box/test/card-io.doctest.md:82:## Round-trip: serialize then parse returns the same fields
callback-box/test/card-io.doctest.md:91:const text = serializeCardText({ schema: docSchema, fields });
callback-box/test/card-io.doctest.md:92:const parsed = parseCardText(text, { source: "rt.doc.card", schemas });
callback-box/test/card-io.doctest.md:101:  try { parseCardText(text, { source, schemas }); return "did not throw"; }
callback-box/test/card-io.doctest.md:119:const drifted = parseCardText("---\ntype: doc\ndrive-id: d1\ntitle: T\nbogus-field: oops\n---\n", { source: "typo.doc.card", schemas });
callback-box/test/card-io.doctest.md:128:const ct = parseCardText("---\ntype: email-thread\nthread-id: t1\nsubject: hi\ncontent-type: text/plain\nparticipants:\n  - a@x\n---\n", { source: "ct.email-thread.card", schemas });
callback-box/test/card-io.doctest.md:136:const xmlMemo: ElementSchema = element("memo", {
callback-box/test/card-io.doctest.md:141:  cardSchemas: new Map<string, CardSchema>([
callback-box/test/card-io.doctest.md:145:  elementSchemas: new Map<string, ElementSchema>([
callback-box/test/card-io.doctest.md:174:  cardSchemas: await createCardSchemaMap(),
callback-box/CODE-STYLE.md:55:- **`as` type assertions are like Rust's `unsafe`** (banned in `.tsx` by lint, discouraged everywhere): allowed only when genuinely necessary — e.g. at a parse boundary where data arrives untyped. When you need one, either guard it with an `// eslint-disable-next-line no-restricted-syntax -- <why it's sound>` comment, or centralize the cast in a single well-named typed helper (`getChildren(el): ElementNode[]`) that does it once and is reused. Never sprinkle bare `as` to silence the type checker. (`as const` is always fine.)
callback-box/src/webapp/routes/api-card-patch.ts:12:import type { ElementNode } from "cardworks";
callback-box/src/webapp/routes/api-card-patch.ts:25:export function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
callback-box/src/webapp/routes/api-card-patch.ts:27:  let current: ElementNode = el;
callback-box/src/webapp/routes/api-card-patch.ts:41: * Parse a simple XML fragment like `<tag attr="val">text</tag>` into an ElementNode.
callback-box/src/webapp/routes/api-card-patch.ts:44:export function parseXmlFragment(xml: string): ElementNode | null {
callback-box/src/webapp/routes/api-card-patch.ts:66:  } as ElementNode;
callback-box/src/webapp/routes/api-card-patch.ts:80: * Convert an ElementNode to a JSON-safe structure.
callback-box/src/webapp/routes/api-card-patch.ts:82:export function sanitizeElement(el: ElementNode): JsonElement {
callback-box/src/webapp/routes/api-card-patch.ts:102:    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/src/core/box-templates.ts:22:**Default to the frontmatter form** (\`cardSchema\`) shown below: it produces standard cards —
callback-box/src/core/box-templates.ts:28:Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:
callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "cardworks";
callback-box/src/core/box-templates.ts:34:export default cardSchema("my-type", {
callback-box/src/core/box-templates.ts:38:    body: body(z.string()),  // omit this line if the card has no prose body
callback-box/src/core/box-templates.ts:61:- \`cardSchema(type, { fields, instructions? })\` is the entry point. \`fields\` is a flat object
callback-box/src/core/box-templates.ts:63:- \`body(z.string())\` declares the markdown body field — it must be named \`body\`. Omit it for a
callback-box/src/core/box-templates.ts:72:- \`cardSchema(type, config)\` — define a frontmatter card schema (the default)
callback-box/src/core/box-templates.ts:73:- \`body(zodSchema)\` — declare the single markdown body field
callback-box/src/core/box-templates.ts:75:- \`escapeText(str)\` / \`escapeAttr(str)\` — XML-escape helpers (only for \`element()\` schemas)
callback-box/src/core/box-templates.ts:86:import { cardSchema } from "cardworks";
callback-box/src/core/box-templates.ts:106:export default cardSchema("task", {
callback-box/src/core/box-templates.ts:130:\`capture-session\` types still use it. For everything else, prefer \`cardSchema\` above.
callback-box/src/core/box-templates.ts:133:import { element } from "cardworks";
callback-box/src/core/box-templates.ts:147:A legacy template's \`generate\` emits XML instead of YAML, using \`escapeText\` / \`escapeAttr\` for
callback-box/src/webapp/trpc/routers/status.ts:8:import { parseCardName } from "../../../cli/lib/paths.js";
callback-box/src/webapp/trpc/routers/status.ts:108:        const parsed = parseCardName(e.name);
callback-box/src/webapp/trpc/routers/status.ts:139:          const parsed = parseCardName(entry.name);
callback-box/scripts/migrate/jobs.ts:18:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/jobs.ts:102:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/jobs.ts:106:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/jobs.ts:113:function convertIntakeJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:135:function convertCalendarReviewJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:165:function convertChatJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:181:function convertQuestionFollowupJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:198:const CONVERTERS: Record<Kind, (n: ElementNode, src: string) => Record<string, unknown>> = {
callback-box/scripts/migrate/jobs.ts:210:  const node = await parseCard(raw, { source: absPath });
callback-box/test/capture-pipeline.test.ts:22:import { parseCardText, serializeCardText } from "../src/core/card-io.js";
callback-box/test/capture-pipeline.test.ts:82:    const parsed = parseCardText(content, {
callback-box/test/capture-pipeline.test.ts:90:    await writeFile(cardPath, serializeCardText({
callback-box/test/capture-pipeline.test.ts:143:    const parsed = parseCardText(content, {
callback-box/scripts/migrate/file.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/file.ts:53:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/file.ts:57:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/file.ts:103:  const node = await parseCard(raw, { source: absPath });
callback-box/test/composer-draft.doctest.md:7:parse/serialize boundary.
callback-box/test/composer-draft.doctest.md:13:  serializeComposerDraft,
callback-box/test/composer-draft.doctest.md:31:## serializeComposerDraft / parseComposerDraft
callback-box/test/composer-draft.doctest.md:37:JSON.stringify(parseComposerDraft(serializeComposerDraft(draft)))
callback-box/test/card-loaders.doctest.md:8:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/card-loaders.doctest.md:10:function el(tagName: string, attrs: Record<string, string>, children: ElementNode[] = []): ElementNode {
callback-box/test/card-loaders.doctest.md:18:  } as ElementNode;
callback-box/test/card-loaders.doctest.md:21:function textChild(tagName: string, text: string): ElementNode {
callback-box/test/card-loaders.doctest.md:22:  return { ...el(tagName, {}), text } as ElementNode;
callback-box/test/speech-message.doctest.md:4:folds any attached selections into the body through the shared serializer.
callback-box/src/core/init-rules.ts:13:import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/init-rules.ts:90:  // both legacy XML schemas (ElementSchema with `tagName`) and phase-2
callback-box/src/core/init-rules.ts:99:    ...cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
callback-box/src/core/init-rules.ts:100:    ...boxSchemas.cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/test/search-extract.doctest.md:20:  cardSchemas: await createCardSchemaMap(),
callback-box/test/search-extract.doctest.md:21:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/test/drive-sheet-data.doctest.md:6:import { buildSheetData, serializeSheetData, parseSheetData, sheetDataToValues, isFormulaCell } from "../src/connectors/drive-sheet-data.js";
callback-box/test/drive-sheet-data.doctest.md:42:const json = serializeSheetData(data);
callback-box/test/drive-sheet-data.doctest.md:50:## Round-trip: serialize then parse
callback-box/test/drive-sheet-data.doctest.md:54:const json = serializeSheetData(original);
callback-box/scripts/migrate/audio.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/audio.ts:55:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/audio.ts:59:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/audio.ts:112:  const node = await parseCard(raw, { source: absPath });
callback-box/test/session-context.doctest.md:8:attributes serialize into the tag.
callback-box/test/box-schemas.doctest.md:4:either a frontmatter `cardSchema()` (the default for new types) or a legacy XML `element()`
callback-box/test/box-schemas.doctest.md:34:const WIDGET_SCHEMA = `import { body, cardSchema } from "cardworks";
callback-box/test/box-schemas.doctest.md:37:export default cardSchema("widget", {
callback-box/test/box-schemas.doctest.md:41:    body: body(z.string()),
callback-box/test/box-schemas.doctest.md:48:const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/test/box-schemas.doctest.md:71:box). The loader segregates them: the `cardSchema()` lands in `cardSchemas`, the `element()`
callback-box/test/box-schemas.doctest.md:80:[loaded.cardSchemas.length, loaded.elementSchemas.length, loaded.cardSchemas[0].type, loaded.elementSchemas[0].tagName].join("|")
callback-box/scripts/migrate/record-person.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/record-person.ts:77:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/record-person.ts:81:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/record-person.ts:88:function convertRecord(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/record-person.ts:182:function convertPerson(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/record-person.ts:221:  const node = await parseCard(raw, { source: absPath });
callback-box/src/schemas/guide-parse.tsx:10:import { splitCardContent } from "cardworks";
callback-box/src/schemas/guide-parse.tsx:75:  const split = splitCardContent(content);
callback-box/test/extfile-sync.doctest.md:12:import { splitCardContent } from "cardworks";
callback-box/test/extfile-sync.doctest.md:18:  return (parseYaml(splitCardContent(content).frontmatterText) ?? {}) as Record<string, unknown>;
callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/src/core/load-context.ts:9:import { createCardSchemaMap, createSchemaRegistry } from "../schemas/registry.js";
callback-box/src/core/load-context.ts:12:  const registry = await createSchemaRegistry(boxRoot);
callback-box/src/core/load-context.ts:13:  const elementSchemas = new Map<string, ElementSchema>();
callback-box/src/core/load-context.ts:16:    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/src/core/load-context.ts:18:  return { cardSchemas: await createCardSchemaMap(boxRoot), elementSchemas };
callback-box/src/frontend/src/pages/BrowsePage.tsx:11:import { serializeViewUrl, type ViewTarget } from "../lib/view-url";
callback-box/src/frontend/src/pages/BrowsePage.tsx:84:        navigate({ to: href(`/${boxSlug}/views/${serializeViewUrl({ ...target, zoom: false })}`) });
callback-box/src/schemas/landmark.ts:27:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/landmark.ts:121:export const LandmarkSchema: CardSchema = cardSchema("landmark", {
callback-box/src/schemas/landmark.ts:176:  const split = splitCardContent(content);
callback-box/test/loader-registry.doctest.md:13:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/loader-registry.doctest.md:15:function makeElement(tagName: string, attrs: Record<string, string>, text?: string): ElementNode {
callback-box/test/loader-registry.doctest.md:24:  } as ElementNode;
callback-box/scripts/migrate/recipe.ts:40:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/recipe.ts:63:function text(el: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:67:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/recipe.ts:71:function attrPart(el: ElementNode, name: string): string {
callback-box/scripts/migrate/recipe.ts:77:function ingredientTag(ing: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:82:function sectionBody(section: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:130:    const split = splitCardContent(content);
callback-box/scripts/migrate/recipe.ts:134:    const root = await parseCard(content, { source: absPath });
callback-box/scripts/migrate/briefing.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/briefing.ts:104:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/briefing.ts:108:function convertOne(node: ElementNode, source: string): { fields: BriefingOut; body: string } {
callback-box/scripts/migrate/briefing.ts:197:  const node = await parseCard(raw, { source: absPath });
callback-box/src/schemas/guide-elements.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/guide-elements.tsx:120:export const GuideSchema: CardSchema = cardSchema("guide", {
callback-box/test/serialize.doctest.md:1:# serialize
callback-box/test/serialize.doctest.md:3:`serialize()` converts any value to a string for comparison in `check()`. It tries registered serializers first, then falls back to sensible defaults.
callback-box/test/serialize.doctest.md:6:import { serialize } from "agent-doctest/check";
callback-box/test/serialize.doctest.md:12:serialize("hello")
callback-box/test/serialize.doctest.md:19:serialize(42)
callback-box/test/serialize.doctest.md:26:serialize(null)
callback-box/test/serialize.doctest.md:31:serialize(undefined)
callback-box/test/serialize.doctest.md:38:serialize({ a: 1, b: "two" })
callback-box/test/serialize.doctest.md:47:serialize([1, 2, 3])
callback-box/src/schemas/briefing.tsx:19:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/briefing.tsx:23:export const BriefingSchema: CardSchema = cardSchema("briefing", {
callback-box/src/schemas/briefing.tsx:25:    body: body(z.string()),
callback-box/scripts/migrate/email-thread.ts:43:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/email-thread.ts:96:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/email-thread.ts:100:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/email-thread.ts:106:  parent: ElementNode,
callback-box/scripts/migrate/email-thread.ts:110:    pluck: (item: ElementNode) => string | undefined;
callback-box/scripts/migrate/email-thread.ts:124:function convertOne(node: ElementNode, source: string): ThreadFields {
callback-box/scripts/migrate/email-thread.ts:183:  const node = await parseCard(raw, { source: absPath });
callback-box/src/schemas/todo-list.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/todo-list.ts:36:export const TodoListSchema: CardSchema = cardSchema("todo-list", {
callback-box/src/frontend/src/pages/ChatPage.tsx:32:   * The card live-open in the companion pane (serialized view URL). Persisted
callback-box/src/core/state.ts:10:import { getBoxDir, parseCardName, requireBoxRoot } from "../cli/lib/paths.js";
callback-box/src/core/state.ts:86:    const parsed = parseCardName(name);
callback-box/test/print.doctest.md:67:Print lines are plain strings; the expression result is serialized normally.
callback-box/src/schemas/intake-job.tsx:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/intake-job.tsx:13:export const IntakeJobSchema: CardSchema = cardSchema("intake-job", {
callback-box/scripts/migrate/capture-session.ts:19:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/capture-session.ts:43:function text(el: ElementNode): string {
callback-box/scripts/migrate/capture-session.ts:47:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/capture-session.ts:51:function refList(el: ElementNode | undefined, childTag: string): string[] {
callback-box/scripts/migrate/capture-session.ts:62:function buildTranscriptBody(transcript: ElementNode | undefined): string {
callback-box/scripts/migrate/capture-session.ts:85:    const split = splitCardContent(content);
callback-box/scripts/migrate/capture-session.ts:89:    const root = await parseCard(content, { source: absPath });
callback-box/scripts/migrate/email-message.ts:48:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/email-message.ts:118:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/email-message.ts:122:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/email-message.ts:127:function convertOne(node: ElementNode, source: string): MessageFields {
callback-box/scripts/migrate/email-message.ts:194:  const node = await parseCard(raw, { source: absPath });
callback-box/docs/adding-schemas.md:23:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/docs/adding-schemas.md:35:export const MyThingSchema: CardSchema = cardSchema("my-thing", {
callback-box/docs/adding-schemas.md:40:    body: body(z.string()),  // omit this line if the card has no prose body
callback-box/docs/adding-schemas.md:73:- `cardSchema(type, { fields, instructions? })` is the entry point. `fields` is a flat object of Zod validators; nest with `z.object` / `z.array` as needed.
callback-box/docs/adding-schemas.md:74:- `body(z.string())` declares a markdown body field — it must be named `body` (enforced; one vocabulary across all card types). Omit to declare a body-less card (then any non-empty body errors on load).
callback-box/docs/adding-schemas.md:85:// Add to cardSchemas[] (frontmatter cards):
callback-box/docs/adding-schemas.md:86:export const cardSchemas: CardSchema[] = [
callback-box/docs/adding-schemas.md:157:When code needs to update a frontmatter card on disk (e.g. setting `status: answered` on a question), use `splitCardContent` + `yaml`:
callback-box/docs/adding-schemas.md:160:import { splitCardContent } from "cardworks";
callback-box/docs/adding-schemas.md:164:const split = splitCardContent(content);
callback-box/docs/adding-schemas.md:170:For typed reads, use `parseCardText({content, source, schemas: createCardSchemaMap()})` — it validates against the schema and returns `{schema, fields, rawBody, contentType}`. See `src/core/commands/answer.ts` for a worked example.
callback-box/docs/adding-schemas.md:175:2. `generateDocs()` reads both `schemas` (XML) and `cardSchemas` (frontmatter) from `registry.ts`
callback-box/docs/cli-restructure.md:117:| `cb format` | Manual normalizer (re-serializes flat XML). 80 lines. Zero callers in code, procedures, agent prompts, or tests. | ✅ Deleted. Future normalization work tracked separately. |
callback-box/docs/cli-restructure.md:127:- **Card normalization story.** `cb format` was deleted (80-line one-off normalizer that re-serialized cards to flat XML). We still want *some* way to keep cards normalized — open question on the right shape: a pre-commit hook that auto-formats on stage? A library function called by `cb create` / `cb mv` so cards are always written normalized in the first place? A periodic `npm run`-style sweep added to `docs/maintenance.md`? Decide before this becomes a noticeable drift problem.
callback-box/scripts/migrate/repair-refs.ts:34:import { extractRefs, splitCardContent } from "cardworks";
callback-box/scripts/migrate/repair-refs.ts:135:  const split = splitCardContent(content);
callback-box/src/schemas/image.tsx:13:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/image.tsx:72:export const ImageSchema: CardSchema = cardSchema("image", {
callback-box/docs/ideas.md:816:Cardworks already exposes the ref graph — `findIncomingRefs(targetPath)` and `findOutgoingRefs(sourcePath)` in `cardworks/src/loader/loader.ts`. The data exists; no read surface does. Obsidian's Backlinks pane is widely considered its most-used navigation surface, and we have a richer (typed, versioned, fragment-addressable) reference model — closing the UI gap is mostly plumbing.
callback-box/docs/ideas.md:1052:The repeated failure mode: agent is asked for X, agent writes X from scratch, X already existed under a slightly different name in `src/components/ui/` or `src/lib/` or `cardworks/`. The agent doesn't know what to grep for because the existing thing's name doesn't match the task vocabulary. Result: parallel implementations, drift, the codebase gets harder to navigate over time precisely *because* it has more in it.
callback-box/scripts/migrate/image.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/image.ts:61:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/image.ts:65:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/image.ts:159:  const node = await parseCard(raw, { source: absPath });
callback-box/src/core/commands/answer.ts:10:import { splitCardContent } from "cardworks";
callback-box/src/core/commands/answer.ts:18:import { parseCardText } from "../card-io.js";
callback-box/src/core/commands/answer.ts:53:    const card = parseCardText(content, {
callback-box/src/core/commands/answer.ts:255:  const split = splitCardContent(content);
callback-box/docs/agent-knowledge.md:254:Agents can define new card types by creating `.ts` files in `config/schemas/`. Each file exports a default `ElementSchema` using the same `element()` + `z` (Zod) API as built-in schemas. Optionally, files can also export a `template` for `cb create`.
callback-box/src/schemas/chat-thread.ts:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/chat-thread.ts:38:export const ChatThreadSchema: CardSchema = cardSchema("chat-thread", {
callback-box/test/paths.doctest.md:6:import { parseCardName, buildCardName, isCardFile, BOX_DIRS } from "../src/cli/lib/paths.js";
callback-box/test/paths.doctest.md:14:parseCardName("Test.memo.card")
callback-box/test/paths.doctest.md:25:parseCardName("Meeting_Tomorrow.email-thread.card")
callback-box/test/paths.doctest.md:36:parseCardName("invalid.card")
callback-box/test/paths.doctest.md:39:parseCardName("no-extension")
callback-box/test/paths.doctest.md:42:parseCardName("only.card")
callback-box/test/paths.doctest.md:48:`buildCardName` is the inverse of `parseCardName`:
callback-box/docs/EXAMPLE_FILES.md:561:import { element } from "cardworks";
callback-box/docs/EXAMPLE_FILES.md:595:import { element } from "cardworks";
callback-box/src/schemas/feedback.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/feedback.tsx:40:export const FeedbackSchema: CardSchema = cardSchema("feedback", {
callback-box/src/schemas/feedback.tsx:48:    body: body(z.string()),
callback-box/scripts/migrate/card-frontmatter.ts:13: * transparently via `parseCard()`, so this migration is a no-op for readers
callback-box/docs/testing.md:96:| `test/serialize.doctest.md` | Value serialization |
callback-box/docs/testing.md:216:| `test/check.test.ts` | Wildcard matching, extractions, diff output, serializers, inspect() |
callback-box/docs/testing.md:470:Not a test you run manually, but a live validation hook. When an agent writes or edits a `.card` file, the hook calls cardworks' `lintCards` in-process and feeds any issues back as `additionalContext`. This catches XML/schema issues during agent work rather than after.
callback-box/docs/testing.md:573:- **Property testing** — Semantically meaningful invariants (like `parse(serialize(card)) === card`), not random fuzzing.
callback-box/src/core/commands/create.ts:14:import { parseCardName, isCardFile, boxPath } from "../../cli/lib/paths.js";
callback-box/src/core/commands/create.ts:83:  const parsed = parseCardName(basename);
callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scripts/clean-broken-refs.ts:94:  const split = splitCardContent(content);
callback-box/src/schemas/index.ts:8:  createSchemaRegistry,
callback-box/docs/implemented-plans/narration-mode-design.md:367:**Registry.** A small module — `src/core/chat-features.ts` (new) — exports the closed set of recognized feature names and their defaults. Initial entries: `narration`, `prose`. Any unknown attribute on a `<chat-app>` tag is ignored with a warning. This file is also where the `<chat-app>` snapshot serializer and the agent-delta parser live.
callback-box/src/schemas/recipe.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/recipe.tsx:20:export const RecipeSchema: CardSchema = cardSchema("recipe", {
callback-box/src/schemas/recipe.tsx:27:    body: body(z.string()),
callback-box/docs/cards-as-markdown.md:40:**Loader dispatch:** `src/core/card-io.ts` `loadCardFile()` returns a discriminated union of `FrontmatterLoadedCard | XmlLoadedCard`. Frontmatter dispatch uses `cardSchemas` (Map keyed by `type:` field); XML falls through to the legacy cardworks `parseCard`. This lets XML and frontmatter cards coexist during and after the migration.
callback-box/src/schemas/memo.ts:9:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/memo.ts:36:export const MemoSchema: CardSchema = cardSchema("memo", {
callback-box/src/schemas/memo.ts:44:    body: body(z.string()),
callback-box/src/core/commands/move-operations.ts:16:import { CardLoader } from "cardworks";
callback-box/src/core/commands/move-operations.ts:104:  const loader = new CardLoader(ctx.boxRoot);
callback-box/src/core/commands/move-operations.ts:153: * files and any references cardworks itself re-serialized.
callback-box/src/core/commands/move-operations.ts:162:  loader: CardLoader;
callback-box/src/core/commands/move-operations.ts:191: * frontmatter alike. cardworks already re-serialized card-to-card refs in
callback-box/src/core/commands/move-operations.ts:203:  loader: CardLoader;
callback-box/src/core/commands/move-operations.ts:320:  const loader = new CardLoader(ctx.boxRoot);
callback-box/docs/implemented-plans/extfile-card.md:31:  markdown body (Phase 2)."* `extfile` is a frontmatter `cardSchema()`,
callback-box/docs/implemented-plans/extfile-card.md:32:  registered in `cardSchemas[]` (`src/schemas/registry.ts:65`).
callback-box/docs/implemented-plans/extfile-card.md:56:  only, no `body(z.string())`).
callback-box/docs/implemented-plans/extfile-card.md:63:  `src/schemas/webpage.tsx:20-75` is body-bearing (`body: body(z.string())`,
callback-box/docs/implemented-plans/extfile-card.md:70:  `src/schemas/file.tsx:30-61` is a frontmatter-only `cardSchema` with no
callback-box/docs/implemented-plans/extfile-card.md:71:  `body()` field, a nested metadata object, and a `createFileTemplate` helper
callback-box/docs/implemented-plans/extfile-card.md:217:- Schema (`cardSchema("extfile", { fields, instructions })`, registered in
callback-box/docs/implemented-plans/extfile-card.md:218:  `registry.ts:65`), **body-less** (mirror `file.tsx`, no `body()`):
callback-box/docs/implemented-plans/extfile-card.md:304:    `size`, and `mtime` **together** (parse-mutate-reserialize via `yaml`, per
callback-box/docs/implemented-plans/extfile-card.md:574:  `selection-serialize.ts:69`, `FileView.tsx:264`). extfile **surfaces** existing
callback-box/src/connectors/preserve-agent-fields.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/connectors/preserve-agent-fields.ts:36:  const next = splitCardContent(cardText);
callback-box/src/connectors/preserve-agent-fields.ts:53:  const split = splitCardContent(cardText);
callback-box/src/schemas/registry.ts:5: * by the CardLoader factory. Box-local schemas from config/schemas/
callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/registry.ts:55:export const schemas: ElementSchema[] = [];
callback-box/src/schemas/registry.ts:61:export const cardSchemas: CardSchema[] = [
callback-box/src/schemas/registry.ts:161: * files may default-export either a frontmatter `cardSchema()` (the default
callback-box/src/schemas/registry.ts:168:  cardSchemas: CardSchema[];
callback-box/src/schemas/registry.ts:169:  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
callback-box/src/schemas/registry.ts:170:  elementSchemas: ElementSchema[];
callback-box/src/schemas/registry.ts:188: * Each file should default-export either a frontmatter `cardSchema()` or a
callback-box/src/schemas/registry.ts:205:  const empty: BoxSchemas = { cardSchemas: [], elementSchemas: [] };
callback-box/src/schemas/registry.ts:221:  const loadedElement: ElementSchema[] = [];
callback-box/src/schemas/registry.ts:235:      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
callback-box/src/schemas/registry.ts:236:      // Zod type carrying `.tagName`; check it first, because ElementSchema also
callback-box/src/schemas/registry.ts:240:      if (isElementSchema(def)) {
callback-box/src/schemas/registry.ts:245:        console.warn(`Warning: ${file} does not export a default cardSchema() or element(), skipping`);
callback-box/src/schemas/registry.ts:257:  return { cardSchemas: loadedCard, elementSchemas: loadedElement };
callback-box/src/schemas/registry.ts:260:function isElementSchema(def: unknown): def is ElementSchema {
callback-box/src/schemas/registry.ts:261:  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
callback-box/src/schemas/registry.ts:274: * Create a SchemaRegistry populated with all known schemas.
callback-box/src/schemas/registry.ts:278:export async function createSchemaRegistry(boxRoot?: string): Promise<SchemaRegistry> {
callback-box/src/schemas/registry.ts:279:  const registry = new SchemaRegistry();
callback-box/src/schemas/registry.ts:297:export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
callback-box/src/schemas/registry.ts:309:    ...cardSchemas.map(s => s.type),
callback-box/src/schemas/registry.ts:320:  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
callback-box/src/schemas/registry.ts:321:  const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
callback-box/src/schemas/registry.ts:334:    || cardSchemas.some(s => s.type === type)
callback-box/src/schemas/registry.ts:348:  for (const schema of cardSchemas) {
callback-box/src/schemas/registry.ts:352:    const { cardSchemas: boxCardSchemas } = await loadBoxSchemas(boxRoot);
callback-box/bin/cb:63:# cardworks/dist is checked as well: it's a sibling workspace package inlined
callback-box/bin/cb:76:elif [ -n "$(find -L "$PROJECT_DIR/node_modules/cardworks/dist" -name '*.js' -newer "$BUNDLE" -print -quit 2>/dev/null)" ]; then
callback-box/src/connectors/google-calendar-ics.ts:116: * (YYYYMMDDTHHMMSS). The serialized output in the .ics file still uses the
callback-box/src/core/commands/ls.ts:11:import { type ElementNode, parseCard, evaluateXPathString } from "cardworks";
callback-box/src/core/commands/ls.ts:72:function applyTemplate(template: string, rootNode: ElementNode): string {
callback-box/src/core/commands/ls.ts:74:    return evaluateXPathString(expr, rootNode);
callback-box/src/core/commands/ls.ts:117:      const root = await parseCard(content, { source: filePath });
callback-box/docs/implemented-plans/box-search.md:61:- **Card parsing** — `src/core/card-io.ts:114` `parseCardText` returns
callback-box/docs/implemented-plans/box-search.md:67:- **Global-field precedent** — `cardworks/src/schema/card-schema.ts:117–119`:
callback-box/docs/implemented-plans/box-search.md:68:  `cardSchema()` already injects `type: z.literal(type)` into every
callback-box/docs/implemented-plans/box-search.md:166:- **What**: `cardSchema()` injects two global optional frontmatter fields
callback-box/docs/implemented-plans/box-search.md:169:  config and XML `ElementSchema`) gain `searchable?: boolean` (default
callback-box/docs/implemented-plans/box-search.md:173:  silently vanish on the next parse-mutate-reserialize. And with ~30 schemas,
callback-box/docs/implemented-plans/box-search.md:176:- **Direction**: in `cardworks/src/schema/card-schema.ts`, a
callback-box/docs/implemented-plans/box-search.md:183:  Globals are full schema surface (parse, validate, serialize, document),
callback-box/docs/implemented-plans/box-search.md:186:  the resolved `CardSchema`/`ElementSchema` object. Operational schemas set
callback-box/docs/implemented-plans/box-search.md:351:    `cb contains update <card> --text "..."` (splitCardContent + YAML
callback-box/docs/implemented-plans/box-search.md:426:  parse-mutate-reserialize semantics (no new shared mutable card state);
callback-box/src/schemas/personality.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/personality.tsx:95:export const PersonalitySchema: CardSchema = cardSchema("personality", {
callback-box/src/schemas/personality.tsx:107:    body: body(z.string()),
callback-box/src/core/commands/describe-images-helpers.ts:10:import { parseCardName } from "../../cli/lib/paths.js";
callback-box/src/core/commands/describe-images-helpers.ts:41:  const parsed = parseCardName(path.basename(cardPath));
callback-box/scratch/codex-prompt.txt:10:1. Is `schemas[]` (the XML ElementSchema list in callback-box/src/schemas/registry.ts) actually empty, and are the "dead path" claims real — card-io.ts loadXmlCard branch, search/extract.ts xmlDoc, ls.ts evaluateXPathString, the CardLoader users (move-operations.ts, cli/lib/loader.ts, todos.ts)? Is any "dead" path actually still reachable?
callback-box/scratch/codex-prompt.txt:11:2. Is the keep-set's "zero transitive XML dependencies" claim true? Read cardworks/src/schema/card-schema.ts, parser/frontmatter.ts, schema/registry.ts, lint/format.ts (and the lint types it needs) — do any transitively import ElementNode / the XML parser / xpath?
callback-box/src/schemas/procedure-run.ts:8:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/procedure-run.ts:55:export const ProcedureRunSchema: CardSchema = cardSchema("procedure-run", {
callback-box/src/schemas/procedure-run.ts:83:  const split = splitCardContent(content);
callback-box/deploy/deploy.sh:53:# dist/ we rsync must already match the source we rsync. cardworks/dist is
callback-box/deploy/deploy.sh:118:    rm -rf /opt/callback/cardworks/node_modules \
callback-box/deploy/deploy.sh:146:if [[ -d "$MONO_DIR/cardworks/.git" ]]; then
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:62:- **Card-type system.** `cardSchema(type, { fields })` registered in
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:151:export const WebpageSchema: CardSchema = cardSchema("webpage", {
callback-box/docs/implemented-plans/webpage-card-and-commentary.md:160:    body: body(z.string()),         // the readable markdown IS the body
callback-box/deploy/README.md:90:  cardworks/
callback-box/src/schemas/question.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/question.ts:38:export const QuestionSchema: CardSchema = cardSchema("question", {
callback-box/docs/implemented-plans/box-retrospectives.md:33:  parse-mutate-reserialize"*; *"Schemas can include `instructions` — prose
callback-box/docs/implemented-plans/box-retrospectives.md:290:> `lock-group` serializes retro against other scheduled procedures but not
callback-box/docs/implemented-plans/box-retrospectives.md:293:> re-reads before editing, and card edits are parse-mutate-reserialize.
callback-box/docs/implemented-plans/box-retrospectives.md:333:  reserialize per `CLAUDE.md`.
callback-box/scratch/codex-out.md:22:1. Is `schemas[]` (the XML ElementSchema list in callback-box/src/schemas/registry.ts) actually empty, and are the "dead path" claims real — card-io.ts loadXmlCard branch, search/extract.ts xmlDoc, ls.ts evaluateXPathString, the CardLoader users (move-operations.ts, cli/lib/loader.ts, todos.ts)? Is any "dead" path actually still reachable?
callback-box/scratch/codex-out.md:23:2. Is the keep-set's "zero transitive XML dependencies" claim true? Read cardworks/src/schema/card-schema.ts, parser/frontmatter.ts, schema/registry.ts, lint/format.ts (and the lint types it needs) — do any transitively import ElementNode / the XML parser / xpath?
callback-box/scratch/codex-out.md:40:     4	now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
callback-box/scratch/codex-out.md:41:     5	large XML half of cardworks — parser, serializer, JSX, XPath, the
callback-box/scratch/codex-out.md:42:     6	`CardLoader`, the XML element schema — has no real users. This plan removes
callback-box/scratch/codex-out.md:79:    43	- **The frontmatter primitives, in cardworks.** `cardSchema`/`body`/
callback-box/scratch/codex-out.md:80:    44	  `extractRefs` (`cardworks/src/schema/card-schema.ts`, 249 LOC, imports
callback-box/scratch/codex-out.md:81:    45	  `zod` only); `splitCardContent` (`cardworks/src/parser/frontmatter.ts`, 65
callback-box/scratch/codex-out.md:82:    46	  LOC, zero imports); `SchemaRegistry` (`cardworks/src/schema/registry.ts`,
callback-box/scratch/codex-out.md:83:    47	  63 LOC, generic `Map<string, ZodType>`); `formatLintResults` and the
callback-box/scratch/codex-out.md:84:    48	  `LintSummary`/`LintResult`/`LintIssue` types (`cardworks/src/lint/format.ts`
callback-box/scratch/codex-out.md:86:    50	  (`cardworks/src/parser/parse.ts`, ~15 LOC of the file). **Reuse by
callback-box/scratch/codex-out.md:90:    54	  (`parse.ts`/`dom-to-object.ts`/`provenance.ts`), `serialize/serialize.ts`,
callback-box/scratch/codex-out.md:91:    55	  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
callback-box/scratch/codex-out.md:96:    60	  `card-io.ts` `parseCardText` (`card-io.ts:114`) validates against
callback-box/scratch/codex-out.md:105:    69	  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
callback-box/scratch/codex-out.md:130:    94	XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
callback-box/scratch/codex-out.md:131:    95	`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
callback-box/scratch/codex-out.md:132:    96	`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
callback-box/scratch/codex-out.md:146:   110	  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
callback-box/scratch/codex-out.md:147:   111	  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
callback-box/scratch/codex-out.md:153:   117	  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
callback-box/scratch/codex-out.md:154:   118	- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
callback-box/scratch/codex-out.md:155:   119	  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
callback-box/scratch/codex-out.md:156:   120	  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
callback-box/scratch/codex-out.md:162:   126	  `formatLintResults` (it moves to the keep-set, Track B).
callback-box/scratch/codex-out.md:163:   127	- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
callback-box/scratch/codex-out.md:165:   129	  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
callback-box/scratch/codex-out.md:173:   137	`chat.ts` reading a now-frontmatter landmark via `parseCard`,
callback-box/scratch/codex-out.md:174:   138	`generate-docs-compile.ts:47` parsing a procedure via `parseCard`) surfaces
callback-box/scratch/codex-out.md:187:   151	keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/scratch/codex-out.md:189:   153	**Why this needs to change.** `cardSchema`/`body`/`splitCardContent`/
callback-box/scratch/codex-out.md:190:   154	`CardSchema`/`SchemaRegistry`/`formatLintResults`/`ParseError` are imported by
callback-box/scratch/codex-out.md:196:   160	- `schema.ts` ← `cardworks/src/schema/card-schema.ts` (`cardSchema`, `body`,
callback-box/scratch/codex-out.md:199:   163	- `frontmatter.ts` ← `cardworks/src/parser/frontmatter.ts` (`splitCardContent`).
callback-box/scratch/codex-out.md:201:   165	- `registry.ts` ← `cardworks/src/schema/registry.ts` (`SchemaRegistry`).
callback-box/scratch/codex-out.md:202:   166	- `lint-format.ts` ← `cardworks/src/lint/format.ts` (`formatLintResults`,
callback-box/scratch/codex-out.md:203:   167	  `formatLintResult`, `formatLintResultsJson`) plus the `LintSummary`/
callback-box/scratch/codex-out.md:205:   169	  `cardworks/src/lint/lint.ts`. The types reference a `Location` from the
callback-box/scratch/codex-out.md:210:   174	  `cardworks/src/parser/parse.ts` (used by `search/refresh-file.ts:15`), with
callback-box/scratch/codex-out.md:214:   178	find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/scratch/codex-out.md:227:   191	**What.** Remove the `cardworks/` directory, the
callback-box/scratch/codex-out.md:237:   201	`parseCard`); once every box is migrated (decided: box-migration-first) they
callback-box/scratch/codex-out.md:241:   205	`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/scratch/codex-out.md:264:   228	| A stale consumer reads a frontmatter card via deleted `parseCard` | Partial | Yes — `tsc` fails to compile once the symbol is gone | Clear (compile error) |
callback-box/scratch/codex-out.md:289:   253	  semantics; `card-io.ts` parse-mutate-reserialize is untouched.
callback-box/scratch/codex-out.md:294:   258	  copied `formatLintResults` is the `cb validate` CLI formatter and is copied
callback-box/scratch/codex-out.md:531:   269	- **Re-implementing the XML loader/serializer/XPath in callback-box.** They
callback-box/scratch/codex-out.md:543:   281	- **Renaming `.card` semantics or the schema-registry API.** `SchemaRegistry`
callback-box/scratch/codex-out.md:579:   317	   fallback) and the type-only `ElementNode`/`ElementSchema`/`Card` carriers.
callback-box/scratch/codex-out.md:580:   318	3. **Track A, chunk 3** — rewrite the live `CardLoader` users
callback-box/scratch/codex-out.md:585:   323	   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/docs/adding-api-endpoints.md:224:/** @jsxImportSource cardworks/jsx */
callback-box/src/schemas/commentary.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/commentary.tsx:19:export const CommentarySchema: CardSchema = cardSchema("commentary", {
callback-box/src/schemas/commentary.tsx:28:    body: body(z.string()),
callback-box/src/core/commands/trash.ts:15:import { getBoxDir, isCardFile, boxPath, parseCardName } from "../../cli/lib/paths.js";
callback-box/src/core/commands/trash.ts:82:  const parsed = parseCardName(basename);
callback-box/src/frontend/src/pages/card/components/OpenChatControl.tsx:34:      // A bare card path *is* its own serialized view URL (serializeViewUrl of a
callback-box/src/cli/commands/validate.ts:10:import { formatLintResults, type LintSummary } from "cardworks";
callback-box/src/cli/commands/validate.ts:18:import { lintCardsDispatch } from "../../core/card-lint.js";
callback-box/src/cli/commands/validate.ts:190:  const summary = await lintCardsDispatch([fp], { loader, ctx });
callback-box/src/cli/commands/validate.ts:198:      parts.push(formatLintResults(summary, { colors: false }));
callback-box/src/cli/commands/validate.ts:236:  const cardSummary = all.length > 0 ? await lintCardsDispatch(all, { loader, ctx }) : null;
callback-box/src/cli/commands/validate.ts:243:  const cardSummary = await lintCardsDispatch(cardPaths, { loader, ctx });
callback-box/src/cli/commands/validate.ts:260:  const cardSummary = cardPaths.length > 0 ? await lintCardsDispatch(cardPaths, { loader, ctx }) : null;
callback-box/src/cli/commands/validate.ts:268:    const output = formatLintResults(cardSummary, { colors: true });
callback-box/src/schemas/audio.tsx:12:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/audio.tsx:33:export const AudioSchema: CardSchema = cardSchema("audio", {
callback-box/docs/stack-decisions.md:254:- **`@jsxImportSource` pragma required on schema `.tsx` files.** The frontend's `@backend/*` path alias causes TypeScript to follow the full backend import chain, including `src/schemas/*.tsx` files that use cardworks custom JSX. Without per-file `/** @jsxImportSource cardworks/jsx */` pragmas, the frontend typecheck applies `react-jsx` to those files and reports hundreds of false errors. The cardworks `package.json` also needed a `./jsx/jsx-dev-runtime` export entry.
callback-box/docs/stack-decisions.md:502:- **Cards** (`.card` files — YAML frontmatter or legacy XML) → structured JSON via cardworks `parseCardText` / `loadCardFile`
callback-box/docs/stack-decisions.md:739:**Choice:** TAP protocol (runner: `tap`), doctest-style markdown tests, custom `check()` with display serializers
callback-box/docs/stack-decisions.md:773:### Display serializers
callback-box/src/schemas/email-outbound.tsx:34:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-outbound.tsx:38:export const EmailOutboundSchema: CardSchema = cardSchema("email-outbound", {
callback-box/src/schemas/email-outbound.tsx:48:    body: body(z.string()),
callback-box/src/core/commands/transcribe-captures.ts:19:import { parseCardText, serializeCardText } from "../card-io.js";
callback-box/src/core/commands/transcribe-captures.ts:34:  const parsed = parseCardText(content, {
callback-box/src/core/commands/transcribe-captures.ts:42:  const parsed = parseCardText(`---\n${stringifyYaml(fields)}---\n`, {
callback-box/src/core/commands/transcribe-captures.ts:46:  await fs.writeFile(cardPath, serializeCardText({
callback-box/docs/doc-graph.md:602:- docs/cli-restructure.md:127 (mention) — - **Card normalization story.** `cb format` was deleted (80-line one-off normalizer that re-serialized cards to flat XML
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:39:- **Per-schema `instructions`** field on `cardSchema()` (used in
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:262:The recipe schema is a `cardSchema` vs `element` choice — they're
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:263:different surfaces in the registry (per CLAUDE.md: *"`cardSchemas[]`
callback-box/docs/implemented-plans/markdoc-tags-design.review.md:407:(probably `src/lib/` or `cardworks/`) and call it out as part of
callback-box/docs/glossary.md:42:**cardworks** — The card library at `~/src/cardworks/`. Provides two schema primitives — `cardSchema()` for YAML-frontmatter cards and `element()` for legacy XML cards — plus parsing, serialization, Zod-based validation, the frontmatter splitter, and JSX support. Shared between callback-box and other projects in the monorepo.
callback-box/docs/implemented-plans/shared-frontend-backend-code.subplan.md:70:  `Markdoc.format(document)` serializes an AST back to Markdoc text.
callback-box/src/schemas/gdoc.tsx:18:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/gdoc.tsx:39:export const GdocSchema: CardSchema = cardSchema("gdoc", {
callback-box/src/cli/commands/scheduled.ts:14:import { parseCardText } from "../../core/card-io.js";
callback-box/src/cli/commands/scheduled.ts:53:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/connectors/chat-utils.ts:15:import { splitCardContent } from "cardworks";
callback-box/src/connectors/chat-utils.ts:40:  const split = splitCardContent(content);
callback-box/src/connectors/chat-utils.ts:187:      const split = splitCardContent(content);
callback-box/docs/implemented-plans/open-chat-from-card.md:69:  *"The card live-open in the companion pane (serialized view URL, no `view:` prefix).
callback-box/docs/implemented-plans/open-chat-from-card.md:74:- **View-URL serialization** — `lib/view-url.ts:64-73`: `serializeViewUrl({ path, viewer:
callback-box/docs/implemented-plans/open-chat-from-card.md:186:    const card = cardPath; // serializeViewUrl of a bare path is the path itself
callback-box/docs/implemented-plans/selection-commentary.md:14:> - **State / pills / serializer / typed wiring** (Track 3) —
callback-box/docs/implemented-plans/selection-commentary.md:15:>   `src/frontend/src/lib/selection-serialize.ts` (`applySelections`),
callback-box/docs/implemented-plans/selection-commentary.md:17:>   `test/selection-serialize.doctest.md`.
callback-box/docs/implemented-plans/selection-commentary.md:71:*per-message attachment set* (like images/files), serialized by a **single
callback-box/docs/implemented-plans/selection-commentary.md:163:  the modality fold-in must close. *Reuse the shared serializer here too.*
callback-box/docs/implemented-plans/selection-commentary.md:165:  `zoomedViewAttr()` already serializes the active companion view onto every
callback-box/docs/implemented-plans/selection-commentary.md:166:  message (`zoomed-view="view:<serialized>"`) — in both `-actions.ts` and
callback-box/docs/implemented-plans/selection-commentary.md:319:### Track 3 — Selection state, pills, and the shared serializer
callback-box/docs/implemented-plans/selection-commentary.md:322:insert/strip `[selectionN]` tokens, and provide **one pure serializer** that
callback-box/docs/implemented-plans/selection-commentary.md:328:message. Putting the serializer in `handleSend` (as a first draft would)
callback-box/docs/implemented-plans/selection-commentary.md:338:- **Shared serializer (the load-bearing piece).** A pure function:
callback-box/docs/implemented-plans/selection-commentary.md:378:serializer is proven before the harder timing work.)
callback-box/docs/implemented-plans/selection-commentary.md:383:serializer, with correct snapshot timing for the HQ two-phase flow.
callback-box/docs/implemented-plans/selection-commentary.md:407:  and serialize *that* snapshot in phase 2 — and clear it at phase 1. This
callback-box/docs/implemented-plans/selection-commentary.md:431:**Vocabulary lock-ins.** None beyond Track 3 (same serializer, same tag).
callback-box/docs/implemented-plans/selection-commentary.md:434:through `runKeywordSend`/`submit`; apply the serializer in the realtime
callback-box/docs/implemented-plans/selection-commentary.md:487:| `[selectionN]` token hand-deleted from textarea but item kept | Track 3 serializer doctest | unreferenced item appended after the body (mirrors images) | Clear |
callback-box/docs/implemented-plans/selection-commentary.md:488:| Inner text contains `<`, `&`, `]]>` | Track 3 serializer doctest | XML-escape inner text + attrs at serialization | Clear |
callback-box/docs/implemented-plans/selection-commentary.md:498:one the boxholder raised — a serializer wired only into `handleSend` drops
callback-box/docs/implemented-plans/selection-commentary.md:515:  (appended) through one shared serializer; the agent sees an identical
callback-box/docs/implemented-plans/selection-commentary.md:670:3. **Track 3 — selection state, pills, shared serializer + typed wiring**
callback-box/docs/implemented-plans/selection-commentary.md:672:   hook-in, serializer doctest). Depends on Track 2 producing
callback-box/docs/implemented-plans/selection-commentary.md:673:   `SelectionItem`s. This proves the serializer before the harder timing work.
callback-box/docs/implemented-plans/selection-commentary.md:675:   apply the serializer in both speech paths, phase-1 HQ snapshot, voice
callback-box/docs/implemented-plans/selection-commentary.md:676:   doctest). Depends on Track 3's serializer. Separated deliberately so a
callback-box/docs/implemented-plans/companion-pane-card-activity.md:100:- **`serializeViewUrl`/`parseViewUrl`** — `src/frontend/src/lib/view-url.ts`.
callback-box/docs/implemented-plans/companion-pane-card-activity.md:175:(`serializeViewUrl`) on change. **Loop guard** (prior art): spread-previous +
callback-box/src/schemas/procedure.ts:11:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/procedure.ts:67:export const ProcedureSchema: CardSchema = cardSchema("procedure", {
callback-box/src/schemas/procedure.ts:100:  const split = splitCardContent(content);
callback-box/src/core/commands/assemble-timeline-helpers.ts:5:import { splitCardContent } from "cardworks";
callback-box/src/core/commands/assemble-timeline-helpers.ts:6:import { parseCardText } from "../card-io.js";
callback-box/src/core/commands/assemble-timeline-helpers.ts:15:    const parsed = parseCardText(content, {
callback-box/src/core/commands/assemble-timeline-helpers.ts:31:    const parsed = parseCardText(content, {
callback-box/src/core/commands/assemble-timeline-helpers.ts:266:  const split = splitCardContent(content);
callback-box/src/connectors/intake-utils.ts:17:import { splitCardContent } from "cardworks";
callback-box/src/connectors/intake-utils.ts:139:    const split = splitCardContent(content);
callback-box/docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:11:- **Per-schema `instructions`** field on `cardSchema()` (used in `briefing.tsx:52`, `recipe.tsx:124`) — already the channel for agent guidance. Plan's "2-3 sentences in the relevant schema's `instructions`" lands directly here. Reuses.
callback-box/docs/plans/remove-cardworks-and-xml.md:24:> `schemas[]` (the XML `ElementSchema` list) is now empty.
callback-box/docs/plans/remove-cardworks-and-xml.md:27:> left, the dormant dual-format loader branch, `element()`, `serialize`,
callback-box/docs/plans/remove-cardworks-and-xml.md:28:> the XML parser, JSX runtime, and `evaluateXPathString` have no users.
callback-box/docs/plans/remove-cardworks-and-xml.md:30:> (`cardSchema`, `body`, `splitCardContent`, `extractRefs`) into
callback-box/docs/plans/remove-cardworks-and-xml.md:81:  *"export const schemas: ElementSchema[] = [ ProcedureSchema,
callback-box/docs/plans/remove-cardworks-and-xml.md:84:  `src/schemas/registry.ts:66`: *"export const cardSchemas: CardSchema[]
callback-box/docs/plans/remove-cardworks-and-xml.md:87:  moves from `schemas[]` to `cardSchemas[]`; when `schemas[]` is empty
callback-box/docs/plans/remove-cardworks-and-xml.md:88:  the `ElementSchema` machinery is deleted.
callback-box/docs/plans/remove-cardworks-and-xml.md:122:  `evaluateXPathString`. **Rebuild/remove** — see the Landmark track and
callback-box/docs/plans/remove-cardworks-and-xml.md:125:  (parser, serialize, xpath, jsx, `element`/`ElementNodeSchema`, XML
callback-box/docs/plans/remove-cardworks-and-xml.md:126:  lint) and get deleted; ~411 LOC are frontmatter-core (`cardSchema`,
callback-box/docs/plans/remove-cardworks-and-xml.md:127:  `body`, `splitCardContent`, `extractRefs` in
callback-box/docs/plans/remove-cardworks-and-xml.md:128:  `cardworks/src/schema/card-schema.ts` and
callback-box/docs/plans/remove-cardworks-and-xml.md:129:  `cardworks/src/parser/frontmatter.ts`) and get absorbed; ~1,812 LOC
callback-box/docs/plans/remove-cardworks-and-xml.md:262:`createElement`/`serialize` to YAML parse-mutate-stringify (the existing
callback-box/docs/plans/remove-cardworks-and-xml.md:355:`src/schemas/landmark.ts` to `cardSchema`; move it `schemas[]`→
callback-box/docs/plans/remove-cardworks-and-xml.md:356:`cardSchemas[]`; rewrite literal-link + destination consumers; doctest
callback-box/docs/plans/remove-cardworks-and-xml.md:376:helpers.ts` rewritten to emit body-tag strings instead of `ElementNode`s;
callback-box/docs/plans/remove-cardworks-and-xml.md:393:`ElementSchema` registry plumbing, the search `xmlDoc()` path, the
callback-box/docs/plans/remove-cardworks-and-xml.md:394:frontend `ElementNode`/`CardTreeView` rendering, and update the LLM
callback-box/docs/plans/remove-cardworks-and-xml.md:410:**What.** Move the ~411 LOC of frontmatter-core (`cardSchema`, `body`,
callback-box/docs/plans/remove-cardworks-and-xml.md:411:`splitCardContent`, `extractRefs`) from `cardworks/src/schema/` and
callback-box/docs/plans/remove-cardworks-and-xml.md:412:`cardworks/src/parser/frontmatter.ts` into callback-box (e.g.
callback-box/docs/plans/remove-cardworks-and-xml.md:428:**First implementation chunk.** Inline `cardSchema`/`body`/
callback-box/docs/plans/remove-cardworks-and-xml.md:429:`splitCardContent`/`extractRefs` into callback-box and repoint the ~28
callback-box/docs/plans/remove-cardworks-and-xml.md:445:so `evaluateXPathString` is never exercised by any card in practice. The
callback-box/docs/plans/remove-cardworks-and-xml.md:449:**Decision (no query language).** Replace `evaluateXPathString` with a
callback-box/docs/plans/remove-cardworks-and-xml.md:457:(`cardworks/src/refs/xpath.ts`, 334 LOC) is deleted with the XML bulk.
callback-box/docs/plans/remove-cardworks-and-xml.md:659:- **Recipe is not a remaining XML *schema*** — already in `cardSchemas[]`
callback-box/src/cli/commands/tick.ts:14:import { parseCardText } from "../../core/card-io.js";
callback-box/src/cli/commands/tick.ts:104:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/docs/boxes-as-packages.md:17:2. **Schemas are a stub package.** `config/schemas/package.json` is `{"type":"module"}` with no dependencies. To define a real schema the agent would want `import { z } from "zod"; import { element } from "cardworks";` — same as built-in schemas in `src/schemas/`. Today this works only by accident (transitive resolution from the callback-box install) and gives no IDE help inside the box.
callback-box/src/connectors/drive-handler-sheets.ts:14:  serializeSheetData,
callback-box/src/connectors/drive-handler-sheets.ts:87:      const jsonContent = serializeSheetData(sheetData);
callback-box/src/schemas/capture-session.tsx:15:import { splitCardContent, body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/capture-session.tsx:45:  body: body(z.string()),
callback-box/src/schemas/capture-session.tsx:48:export const CaptureSessionSchema: CardSchema = cardSchema("capture-session", {
callback-box/src/schemas/capture-session.tsx:92:  const split = splitCardContent(content);
callback-box/docs/state-management-comparison.md:67:  // Actions (not serialized — these are functions)
callback-box/docs/state-management-comparison.md:797:All four support the pattern of "hand it state, get UI." They differ in what they serialize and how they enforce it:
callback-box/docs/attach-implementation.md:54:**Possible small addition** (optional): a helper in `cardworks/fs/` or similar called `attachmentPath(cardPath, fileName) → string` that computes `<basename>.attach/<fileName>`. Centralizes the convention. Could live in callback-box instead. Lean toward callback-box — keep cardworks format-agnostic.
callback-box/docs/attach-implementation.md:60:Today's loader (`cardworks/loader/loader.ts` and callers in `src/core/`) walks the filesystem and identifies cards. **`.attach/` directories are not opaque** — they can contain real cards (a capture-session's children are image cards living inside its `.attach/`), and the walker must recurse into them normally to find every card in the box.
callback-box/docs/attach-implementation.md:69:Look at `src/core/CardLoader` (or wherever the file walker is) — needs scope-awareness for path resolution. No recursion-skipping for `.attach/`.
callback-box/src/connectors/drive-sheet-data.ts:73:export function serializeSheetData(data: SheetData): string {
callback-box/src/connectors/telegram-output-cards.ts:12:import { parseCardText, serializeCardText } from "../core/card-io.js";
callback-box/src/connectors/telegram-output-cards.ts:52:      const card = parseCardText(content, { source: relPath, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/connectors/telegram-output-cards.ts:53:      // Parse boundary: parseCardText validated against the schema.
callback-box/src/connectors/telegram-output-cards.ts:65:          serializeCardText({ schema: card.schema, fields: { ...fields } }),
callback-box/src/core/commands/move-phase2.ts:20:import { cardSchemas } from "../../schemas/registry.js";
callback-box/src/core/commands/move-phase2.ts:22:const PHASE2_TYPES = new Set(cardSchemas.map((s) => s.type));
callback-box/src/core/card-lint.ts:6: * are validated through parseCardText (Zod schema check); everything
callback-box/src/core/card-lint.ts:7: * else falls through to cardworks' existing XML lintCard. Results are
callback-box/src/core/card-lint.ts:19:  lintCard,
callback-box/src/core/card-lint.ts:20:  splitCardContent,
callback-box/src/core/card-lint.ts:25:  type ICardLoader,
callback-box/src/core/card-lint.ts:27:} from "cardworks";
callback-box/src/core/card-lint.ts:29:import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
callback-box/src/core/card-lint.ts:41:  loader: ICardLoader;
callback-box/src/core/card-lint.ts:49:export async function lintCardsDispatch(
callback-box/src/core/card-lint.ts:85:  const split = splitCardContent(content);
callback-box/src/core/card-lint.ts:88:    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
callback-box/src/core/card-lint.ts:92:  return lintCard(options.loader, { path });
callback-box/src/core/card-lint.ts:104:    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
callback-box/src/core/card-lint.ts:113:  // out of parseCardText as a thrown CardIOError → errorResult above)
callback-box/src/core/card-lint.ts:162:  // A missing href is already a schema (Zod) error from parseCardText; here we
callback-box/src/core/card-lint.ts:206:  const split = splitCardContent(content);
callback-box/src/core/card-lint.ts:213:    // parseCardText (which threw → errorResult); nothing to add here.
callback-box/src/core/card-lint.ts:249: * Validation cardworks/Zod can't express for commentary cards: Markdoc
callback-box/src/schemas/email-message.tsx:30:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-message.tsx:34:export const EmailMessageSchema: CardSchema = cardSchema("email-message", {
callback-box/src/connectors/gmail-drafts.ts:19:import { splitCardContent } from "cardworks";
callback-box/src/connectors/gmail-drafts.ts:20:import { parseCardText } from "../core/card-io.js";
callback-box/src/connectors/gmail-drafts.ts:133:  const parsed = parseCardText(content, {
callback-box/src/connectors/gmail-drafts.ts:211:  const split = splitCardContent(content);
callback-box/src/connectors/gmail-drafts.ts:232:    const parsed = parseCardText(content, {
callback-box/src/connectors/gmail-drafts.ts:332:  const split = splitCardContent(content);
callback-box/src/core/chat-features.ts:7: * the snapshot serializer composes the `<chat-app>` tag prepended to each
callback-box/src/schemas/file.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/file.tsx:30:export const FileSchema: CardSchema = cardSchema("file", {
callback-box/src/core/generate-docs.ts:16:import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/generate-docs.ts:316:  allCardSchemas: typeof cardSchemas;
callback-box/src/core/generate-docs.ts:343:    // Per-schema generated docs cover both legacy XML schemas (ElementSchema
callback-box/src/core/generate-docs.ts:359:  allCardSchemas: typeof cardSchemas;
callback-box/src/core/generate-docs.ts:421:  const allCardSchemas = [...cardSchemas, ...boxSchemas.cardSchemas];
callback-box/src/core/generate-docs-compile.ts:12:import { parseCard } from "cardworks";
callback-box/src/core/generate-docs-compile.ts:16:import { parseCardText } from "./card-io.js";
callback-box/src/core/generate-docs-compile.ts:47:      const root = await parseCard(content, { source: filename });
callback-box/src/core/generate-docs-compile.ts:84:    const parsed = parseCardText(content, {
callback-box/src/core/generate-docs-compile.ts:358:    const parsed = parseCardText(content, {
callback-box/src/schemas/email-thread.tsx:29:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-thread.tsx:35:export const EmailThreadSchema: CardSchema = cardSchema("email-thread", {
callback-box/docs/plans/box-commentary-surface.md:59:  target panes and threading `href` through `SelectionItem`/serializer/pill so a
callback-box/docs/plans/box-commentary-surface.md:103:  `doc`/`briefing` (`body(z.string())`, `src/schemas/doc.tsx`), **not** `gdoc`
callback-box/docs/plans/box-commentary-surface.md:125:  see Track C "Selection → composer"). The serialized form is built at
callback-box/docs/plans/box-commentary-surface.md:126:  `src/frontend/src/lib/selection-serialize.ts:69-73`: *"return
callback-box/docs/plans/box-commentary-surface.md:127:  `<user-selection ref="${escapeAttr(selection.ref)}"${positionAttr}${placementAttr}>${escapeText(selection.text)}</user-selection>`"*
callback-box/docs/plans/box-commentary-surface.md:155:  (`cardSchemas[]`). A schema's `instructions` becomes a path-scoped agent
callback-box/docs/plans/box-commentary-surface.md:162:  (`src/schemas/doc.tsx`, `body(z.string())`). `gdoc` (`src/schemas/gdoc.tsx`)
callback-box/docs/plans/box-commentary-surface.md:237:`position` + `placement` (`selection-serialize.ts:70-72`). The commentary
callback-box/docs/plans/box-commentary-surface.md:307:  (`selection-serialize.ts:71`); per-anchor (never inherited). On a durable
callback-box/docs/plans/box-commentary-surface.md:339:  selection serializer. `{% source %}` carries both; neither is re-specified.
callback-box/docs/plans/box-commentary-surface.md:348:`position` → `pos` in the `<user-selection>` serializer
callback-box/docs/plans/box-commentary-surface.md:349:(`selection-serialize.ts:70`); thread the new attributes through the
callback-box/docs/plans/box-commentary-surface.md:450:- **Schema** (`cardSchema("commentary", …)`, registered in `registry.ts:63-89`),
callback-box/docs/plans/box-commentary-surface.md:451:  **body-bearing like `doc`/`briefing`** (`body(z.string())`, `doc.tsx:17`;
callback-box/docs/plans/box-commentary-surface.md:483:  (`selection-position.ts:36`); the serializer emits `ref`/`position`
callback-box/docs/plans/box-commentary-surface.md:484:  (`selection-serialize.ts:69`); the sent-message pill parses only
callback-box/docs/plans/box-commentary-surface.md:616:  `<user-selection>` serializer + its doctests, but that tag is transient (not
callback-box/docs/plans/box-commentary-surface.md:727:   `position`→`pos` rename in the selection serializer, guide + doctest.
callback-box/src/core/commands/describe-images-card.ts:13:import { parseCardName } from "../../cli/lib/paths.js";
callback-box/src/core/commands/describe-images-card.ts:14:import { parseCardText, serializeCardText } from "../card-io.js";
callback-box/src/core/commands/describe-images-card.ts:21:  const parsed = parseCardText(content, {
callback-box/src/core/commands/describe-images-card.ts:29:  const parsed = parseCardText(`---\n${stringifyYaml(fields)}---\n`, {
callback-box/src/core/commands/describe-images-card.ts:33:  await fs.writeFile(cardPath, serializeCardText({
callback-box/src/core/commands/describe-images-card.ts:137:  const currentName = parseCardName(path.basename(cardPath));
callback-box/src/schemas/person.tsx:11:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/person.tsx:18:export const PersonSchema: CardSchema = cardSchema("person", {
callback-box/src/schemas/person.tsx:25:    body: body(z.string()),
callback-box/src/core/chat-card-activity.ts:3: * serializer (`chat-features.ts`), the queued-send combiner
callback-box/src/core/file-summary.ts:13:import type { ElementNode } from "cardworks";
callback-box/src/core/file-summary.ts:36:  element?: ElementNode;
callback-box/src/frontend/src/lib/selection-serialize.ts:38:   * selection was grabbed. The serializer inserts the selection after this
callback-box/src/frontend/src/lib/selection-serialize.ts:47:   * serializer places the selection at `spokenWords / totalBodyWords` of the
callback-box/src/frontend/src/lib/selection-serialize.ts:62:function escapeText(value: string): string {
callback-box/src/frontend/src/lib/selection-serialize.ts:72:  return `<user-selection ref="${escapeAttr(selection.ref)}"${positionAttr}${placementAttr}>${escapeText(selection.text)}</user-selection>`;
callback-box/src/schemas/sheet.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/sheet.tsx:24:export const SheetSchema: CardSchema = cardSchema("sheet", {
callback-box/src/schemas/question-followup-job.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/question-followup-job.ts:12:export const QuestionFollowupJobSchema: CardSchema = cardSchema("question-followup-job", {
callback-box/src/schemas/telegram-message.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/telegram-message.ts:21:export const TelegramMessageSchema: CardSchema = cardSchema("telegram-message", {
callback-box/docs/plans/web-page-commentary.md:134:  body-bearing `cardSchema("commentary", …)` with `defaultHref` xor
callback-box/docs/plans/remove-cardworks-package.md:4:now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
callback-box/docs/plans/remove-cardworks-package.md:5:large XML half of cardworks — parser, serializer, JSX, XPath, the
callback-box/docs/plans/remove-cardworks-package.md:6:`CardLoader`, the XML element schema — has no real users. This plan removes
callback-box/docs/plans/remove-cardworks-package.md:43:- **The frontmatter primitives, in cardworks.** `cardSchema`/`body`/
callback-box/docs/plans/remove-cardworks-package.md:44:  `extractRefs` (`cardworks/src/schema/card-schema.ts`, 249 LOC, imports
callback-box/docs/plans/remove-cardworks-package.md:45:  `zod` only); `splitCardContent` (`cardworks/src/parser/frontmatter.ts`, 65
callback-box/docs/plans/remove-cardworks-package.md:46:  LOC, zero imports); `SchemaRegistry` (`cardworks/src/schema/registry.ts`,
callback-box/docs/plans/remove-cardworks-package.md:47:  63 LOC, generic `Map<string, ZodType>`); `formatLintResults` and the
callback-box/docs/plans/remove-cardworks-package.md:48:  `LintSummary`/`LintResult`/`LintIssue` types (`cardworks/src/lint/format.ts`
callback-box/docs/plans/remove-cardworks-package.md:50:  (`cardworks/src/parser/parse.ts`, ~15 LOC of the file). **Reuse by
callback-box/docs/plans/remove-cardworks-package.md:54:  (`parse.ts`/`dom-to-object.ts`/`provenance.ts`), `serialize/serialize.ts`,
callback-box/docs/plans/remove-cardworks-package.md:55:  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
callback-box/docs/plans/remove-cardworks-package.md:60:  `card-io.ts` `parseCardText` (`card-io.ts:114`) validates against
callback-box/docs/plans/remove-cardworks-package.md:69:  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
callback-box/docs/plans/remove-cardworks-package.md:94:XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
callback-box/docs/plans/remove-cardworks-package.md:95:`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
callback-box/docs/plans/remove-cardworks-package.md:96:`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
callback-box/docs/plans/remove-cardworks-package.md:110:  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
callback-box/docs/plans/remove-cardworks-package.md:111:  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
callback-box/docs/plans/remove-cardworks-package.md:117:  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
callback-box/docs/plans/remove-cardworks-package.md:118:- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
callback-box/docs/plans/remove-cardworks-package.md:119:  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
callback-box/docs/plans/remove-cardworks-package.md:120:  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
callback-box/docs/plans/remove-cardworks-package.md:126:  `formatLintResults` (it moves to the keep-set, Track B).
callback-box/docs/plans/remove-cardworks-package.md:127:- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
callback-box/docs/plans/remove-cardworks-package.md:129:  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
callback-box/docs/plans/remove-cardworks-package.md:137:`chat.ts` reading a now-frontmatter landmark via `parseCard`,
callback-box/docs/plans/remove-cardworks-package.md:138:`generate-docs-compile.ts:47` parsing a procedure via `parseCard`) surfaces
callback-box/docs/plans/remove-cardworks-package.md:151:keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/docs/plans/remove-cardworks-package.md:153:**Why this needs to change.** `cardSchema`/`body`/`splitCardContent`/
callback-box/docs/plans/remove-cardworks-package.md:154:`CardSchema`/`SchemaRegistry`/`formatLintResults`/`ParseError` are imported by
callback-box/docs/plans/remove-cardworks-package.md:160:- `schema.ts` ← `cardworks/src/schema/card-schema.ts` (`cardSchema`, `body`,
callback-box/docs/plans/remove-cardworks-package.md:163:- `frontmatter.ts` ← `cardworks/src/parser/frontmatter.ts` (`splitCardContent`).
callback-box/docs/plans/remove-cardworks-package.md:165:- `registry.ts` ← `cardworks/src/schema/registry.ts` (`SchemaRegistry`).
callback-box/docs/plans/remove-cardworks-package.md:166:- `lint-format.ts` ← `cardworks/src/lint/format.ts` (`formatLintResults`,
callback-box/docs/plans/remove-cardworks-package.md:167:  `formatLintResult`, `formatLintResultsJson`) plus the `LintSummary`/
callback-box/docs/plans/remove-cardworks-package.md:169:  `cardworks/src/lint/lint.ts`. The types reference a `Location` from the
callback-box/docs/plans/remove-cardworks-package.md:174:  `cardworks/src/parser/parse.ts` (used by `search/refresh-file.ts:15`), with
callback-box/docs/plans/remove-cardworks-package.md:178:find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/docs/plans/remove-cardworks-package.md:191:**What.** Remove the `cardworks/` directory, the
callback-box/docs/plans/remove-cardworks-package.md:201:`parseCard`); once every box is migrated (decided: box-migration-first) they
callback-box/docs/plans/remove-cardworks-package.md:205:`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/docs/plans/remove-cardworks-package.md:228:| A stale consumer reads a frontmatter card via deleted `parseCard` | Partial | Yes — `tsc` fails to compile once the symbol is gone | Clear (compile error) |
callback-box/docs/plans/remove-cardworks-package.md:253:  semantics; `card-io.ts` parse-mutate-reserialize is untouched.
callback-box/docs/plans/remove-cardworks-package.md:258:  copied `formatLintResults` is the `cb validate` CLI formatter and is copied
callback-box/docs/plans/remove-cardworks-package.md:269:- **Re-implementing the XML loader/serializer/XPath in callback-box.** They
callback-box/docs/plans/remove-cardworks-package.md:281:- **Renaming `.card` semantics or the schema-registry API.** `SchemaRegistry`
callback-box/docs/plans/remove-cardworks-package.md:317:   fallback) and the type-only `ElementNode`/`ElementSchema`/`Card` carriers.
callback-box/docs/plans/remove-cardworks-package.md:318:3. **Track A, chunk 3** — rewrite the live `CardLoader` users
callback-box/docs/plans/remove-cardworks-package.md:323:   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/src/schemas/webpage.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/webpage.tsx:20:export const WebpageSchema: CardSchema = cardSchema("webpage", {
callback-box/src/schemas/webpage.tsx:34:    body: body(z.string()),
callback-box/src/core/search/contains-update.ts:3: * `cb contains update`. Mutates the card (splitCardContent + YAML, per
callback-box/src/core/search/contains-update.ts:11:import { splitCardContent } from "cardworks";
callback-box/src/core/search/contains-update.ts:101:  const split = splitCardContent(content);
callback-box/src/core/card-io.ts:16: * (`cardSchema`, `body`) and the frontmatter splitter (`splitCardContent`).
callback-box/src/core/card-io.ts:22:  splitCardContent,
callback-box/src/core/card-io.ts:23:  parseCard,
callback-box/src/core/card-io.ts:25:  type ElementSchema,
callback-box/src/core/card-io.ts:26:  type ElementNode,
callback-box/src/core/card-io.ts:27:} from "cardworks";
callback-box/src/core/card-io.ts:114:export function parseCardText(
callback-box/src/core/card-io.ts:118:  const split = splitCardContent(content);
callback-box/src/core/card-io.ts:253:export function serializeCardText(input: {
callback-box/src/core/card-io.ts:298:  readonly schema: ElementSchema | undefined;
callback-box/src/core/card-io.ts:299:  readonly element: ElementNode;
callback-box/src/core/card-io.ts:304:  cardSchemas: Map<string, CardSchema>;
callback-box/src/core/card-io.ts:305:  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
callback-box/src/core/card-io.ts:306:  elementSchemas: Map<string, ElementSchema>;
callback-box/src/core/card-io.ts:316: *   tag's ElementSchema (if any) is used for validation.
callback-box/src/core/card-io.ts:336:  const split = splitCardContent(content);
callback-box/src/core/card-io.ts:339:    if (fileType !== undefined && ctx.cardSchemas.has(fileType)) {
callback-box/src/core/card-io.ts:340:      const parsed = parseCardText(content, { source, schemas: ctx.cardSchemas, type: fileType });
callback-box/src/core/card-io.ts:376:  const element = await parseCard(content, { source });
callback-box/src/schemas/calendar-review-job.tsx:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/calendar-review-job.tsx:19:export const CalendarReviewJobSchema: CardSchema = cardSchema("calendar-review-job", {
callback-box/src/cli/commands/tick-utils.ts:15:import { parseCardText } from "../../core/card-io.js";
callback-box/src/cli/commands/tick-utils.ts:33:import { parseCardName } from "../lib/paths.js";
callback-box/src/cli/commands/tick-utils.ts:71:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/tick-utils.ts:165:    const cardName = parseCardName(basename);
callback-box/src/core/schedule-health-box.ts:22:import { parseCardText } from "./card-io.js";
callback-box/src/core/schedule-health-box.ts:102:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/search/refresh-file.ts:10:import { ParseError } from "cardworks";
callback-box/src/schemas/chat-job.ts:10:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/chat-job.ts:14:export const ChatJobSchema: CardSchema = cardSchema("chat-job", {
callback-box/src/core/procedure/engine-run-card.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/core/procedure/engine-run-card.ts:57:function serializeRunCard(card: MutableRunCard): string {
callback-box/src/core/procedure/engine-run-card.ts:63:  const split = splitCardContent(content);
callback-box/src/core/procedure/engine-run-card.ts:105:  return serializeRunCard(card);
callback-box/src/core/procedure/engine-run-card.ts:128:  await fs.writeFile(runCardPath, serializeRunCard(card));
callback-box/src/core/procedure/engine-run-card.ts:182:  await fs.writeFile(runCardPath, serializeRunCard(card));
callback-box/src/core/search/refresh.ts:170:    if (!state.ctx.cardSchemas.has(kind)) continue; // XML kinds can't carry contains
callback-box/src/frontend/src/lib/dictation-draft.ts:4: * state; this module owns the key shape, the serialize/parse boundary, and the
callback-box/src/frontend/src/lib/dictation-draft.ts:61:export function serializeDraft(draft: DictationDraft): string {
callback-box/src/core/search/extract.ts:19:import type { ElementNode } from "cardworks";
callback-box/src/core/search/extract.ts:290:function collectElementText(node: ElementNode): string {
callback-box/src/core/search/extract.ts:292:  const visit = (n: ElementNode): void => {
callback-box/src/core/search/extract.ts:297:        else if (isElementNode(m)) visit(m);
callback-box/src/core/search/extract.ts:301:      if (isElementNode(child)) visit(child);
callback-box/src/core/search/extract.ts:308:function isElementNode(value: unknown): value is ElementNode {
callback-box/src/frontend/src/lib/composer-draft.ts:12: * the key shape and the parse/serialize boundary so they're testable without a
callback-box/src/frontend/src/lib/composer-draft.ts:60:export function serializeComposerDraft(draft: ComposerDraft): string {
callback-box/src/core/sdk-hooks.ts:14:import { formatLintResults } from "cardworks";
callback-box/src/core/sdk-hooks.ts:18:import { lintCardsDispatch } from "./card-lint.js";
callback-box/src/core/sdk-hooks.ts:111:    const summary = await lintCardsDispatch([filePath], { loader, ctx });
callback-box/src/core/sdk-hooks.ts:113:    const formatted = formatLintResults(summary, { colors: false });
callback-box/src/frontend/src/lib/view-url.ts:64:export function serializeViewUrl(target: ViewTarget): string {
callback-box/src/schemas/record.tsx:12:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/record.tsx:48:export const RecordSchema: CardSchema = cardSchema("record", {
callback-box/src/schemas/record.tsx:61:    body: body(z.string()),
callback-box/src/schemas/scheduled-script.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/scheduled-script.tsx:48:export const ScheduledScriptSchema: CardSchema = cardSchema("scheduled-script", {
callback-box/src/schemas/doc.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/doc.tsx:17:export const DocSchema: CardSchema = cardSchema("doc", {
callback-box/src/schemas/doc.tsx:20:    body: body(z.string()),
callback-box/src/frontend/src/renderers/image.tsx:18:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/image.tsx:36:function parseImageCard(element: ElementNode): ParsedImageCard {
callback-box/src/frontend/src/renderers/image.tsx:37:  const children = (element.children || []) as ElementNode[];
callback-box/src/frontend/src/renderers/image.tsx:74:  const card = parseImageCard(data.element as ElementNode);
callback-box/src/schemas/extfile.tsx:16:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/extfile.tsx:20:export const ExtfileSchema: CardSchema = cardSchema("extfile", {
callback-box/src/frontend/src/hooks/useComposerDraft.ts:24:import { composerDraftKey, parseComposerDraft, serializeComposerDraft } from "../lib/composer-draft.js";
callback-box/src/frontend/src/hooks/useComposerDraft.ts:80:      window.localStorage.setItem(key, serializeComposerDraft({ text: input, updatedAt: Date.now() }));
callback-box/src/frontend/src/hooks/useComposerDraft.ts:92:      window.localStorage.setItem(key, serializeComposerDraft({ text: input, updatedAt: Date.now() }));
callback-box/src/cli/lib/paths.ts:165:export function parseCardName(filename: string): { name: string; type: string } | null {
callback-box/src/frontend/src/renderers/sheet.tsx:8:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/sheet.tsx:29:function parseSheetElement(el: ElementNode): ParsedSheet {
callback-box/src/frontend/src/renderers/index.ts:8:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/index.ts:18:  element?: ElementNode;
callback-box/src/frontend/src/hooks/useDictationDraft.ts:32:import { draftKey, parseDraft, serializeDraft, type DictationDraft } from "../lib/dictation-draft";
callback-box/src/frontend/src/hooks/useDictationDraft.ts:78:    window.localStorage.setItem(key, serializeDraft(draft));
callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/index.ts:50:  allSchemas?: ElementSchema[];
callback-box/src/frontend/src/router.tsx:83:    // The card live-open in the companion pane (serialized view URL, no
callback-box/src/frontend/src/hooks/useViewNavigate.ts:14:import { serializeViewUrl, type NavigateHint, type ViewTarget } from "../lib/view-url";
callback-box/src/frontend/src/hooks/useViewNavigate.ts:21:      navigate({ to: href(`/${boxSlug}/views/${serializeViewUrl(target)}`) });
callback-box/src/frontend/src/components/ChatSelections.tsx:13:import { type SelectionItem } from "../lib/selection-serialize";
callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:9:export function cardTypesSection(allSchemas: ElementSchema[]): string[] {
callback-box/src/core/agent-guide/cards.ts:19:  lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
callback-box/src/cli/lib/loader.ts:2: * CardLoader factory for callback box.
callback-box/src/cli/lib/loader.ts:4: * Creates a configured CardLoader instance with all known schemas.
callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/src/cli/lib/loader.ts:8:import { createSchemaRegistry } from "../../schemas/registry.js";
callback-box/src/cli/lib/loader.ts:13:  /** Whether to indent serialized XML */
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
callback-box/src/frontend/src/components/TodoListView.tsx:14:import type { ElementNode } from "../api";
callback-box/src/frontend/src/components/TodoListView.tsx:31:function parseItem(el: ElementNode): TodoItemInfo {
callback-box/src/frontend/src/components/TodoListView.tsx:58:function parseTodoList(element: ElementNode): TodoListInfo {
callback-box/src/frontend/src/components/CommitDetail-diff.ts:6:import type { ElementNode } from "./CardTreeView";
callback-box/src/frontend/src/components/CommitDetail-diff.ts:127:function domToElementNode(el: Element): ElementNode {
callback-box/src/frontend/src/components/CommitDetail-diff.ts:133:  const children: ElementNode[] = [];
callback-box/src/frontend/src/components/CommitDetail-diff.ts:138:      children.push(domToElementNode(child as Element));
callback-box/src/frontend/src/components/CommitDetail-diff.ts:155:export function parseXmlToElementNode(xml: string): ElementNode | null {
callback-box/src/frontend/src/components/CommitDetail-diff.ts:160:    return domToElementNode(doc.documentElement);
callback-box/src/frontend/src/components/Markdown.tsx:40:  serializeViewUrl,
callback-box/src/frontend/src/components/Markdown.tsx:69:  return withBase(`/${boxSlug ?? ""}/views/${serializeViewUrl(target)}`);
callback-box/src/frontend/src/api.ts:65:export interface ElementNode {
callback-box/src/frontend/src/api.ts:69:  children?: ElementNode[];
callback-box/src/frontend/src/components/CardTreeView.tsx:25:export interface ElementNode {
callback-box/src/frontend/src/components/CardTreeView.tsx:29:  children?: ElementNode[];
callback-box/src/frontend/src/components/CardTreeView.tsx:33:  element: ElementNode;
callback-box/src/frontend/src/components/CardTreeView.tsx:135:  data: { element?: ElementNode; path: string; tagName?: string; xml?: string; version?: string; status?: string };
callback-box/src/frontend/src/components/CardTreeView.tsx:284:  element: ElementNode;
callback-box/src/frontend/src/components/chat/InteractiveChat-actions.ts:18:import { applySelections, type SelectionItem } from "../../lib/selection-serialize";
callback-box/src/frontend/src/components/chat/InteractiveChat-voice.ts:26:import { type SelectionItem } from "../../lib/selection-serialize";
callback-box/src/frontend/src/components/chat/InteractiveChat-voice.ts:105:  // message. Spoken bodies carry no tokens, so the serializer appends them.
callback-box/src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:11:import { parseViewUrl, serializeViewUrl } from "../../lib/view-url";
callback-box/src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:23: *  - **Restore once on mount.** `initialCard` is a serialized view URL (no
callback-box/src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:30: *    `session`/`contextDir` and never loops (serialize∘parse is stable).
callback-box/src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:52:  const currentCard = activeView ? serializeViewUrl(activeView.target) : undefined;
callback-box/src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:56:    // ever open it. Navigate only on a real change (serialize∘parse is stable,
callback-box/src/frontend/src/components/chat/InteractiveChat-layout.tsx:12:import { type SelectionItem } from "../../lib/selection-serialize";
callback-box/src/frontend/src/components/CommitDetail-tabs.tsx:10:import { extractNewFileContent, parseXmlToElementNode } from "./CommitDetail-diff";
callback-box/src/frontend/src/components/CommitDetail-tabs.tsx:103:        const cardElement = isCard && content ? parseXmlToElementNode(content) : null;
callback-box/src/frontend/src/components/chat/InteractiveChat-helpers.ts:9:import { applySelections, type SelectionItem } from "../../lib/selection-serialize";
callback-box/src/frontend/src/components/chat/InteractiveChat-helpers.ts:21: * via the shared serializer (spoken text carries no `[selectionN]` tokens, so
callback-box/src/frontend/src/components/chat/InteractiveChat-view.tsx:12:import { lastWords, countWords } from "../../lib/selection-serialize";
callback-box/src/frontend/src/components/chat/InteractiveChat.tsx:18:import { serializeViewUrl } from "../../lib/view-url";
callback-box/src/frontend/src/components/chat/InteractiveChat.tsx:72:   * serialized view URL, no `view:` prefix). Restored on mount and kept in
callback-box/src/frontend/src/components/chat/InteractiveChat.tsx:130:    const uri = `view:${serializeViewUrl(activeView.target)}`;
callback-box/src/frontend/src/components/chat/InteractiveChat-selections.ts:5: * out; `resetSelections` clears after send. The items are serialized into the
callback-box/src/frontend/src/components/chat/InteractiveChat-selections.ts:12:import { type SelectionItem } from "../../lib/selection-serialize";

codex
First significant crack: built-in `schemas[]` is empty, but `registry.ts` still explicitly supports box-local legacy XML schemas through `elementSchemas`. That means “`elementSchemas` map is always empty” is too strong unless the plan is deliberately dropping all box-local XML schema support and updates the schema-loading contract.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/schemas/registry.ts | sed -n '220,380p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
   220	  const loadedCard: CardSchema[] = [];
   221	  const loadedElement: ElementSchema[] = [];
   222	
   223	  // Ensure package.json with "type": "module" so .ts files load as ESM,
   224	  // and register resolve hooks so bare specifiers (cardworks, zod) resolve
   225	  // from callback-box's node_modules.
   226	  await ensureEsmPackageJson(schemasDir);
   227	  ensureResolveHooks();
   228	
   229	  for (const file of tsFiles) {
   230	    try {
   231	      const filePath = join(schemasDir, file);
   232	      const mod = await import(pathToFileURL(filePath).href);
   233	      const def: unknown = mod.default;
   234	
   235	      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
   236	      // Zod type carrying `.tagName`; check it first, because ElementSchema also
   237	      // inherits a string `.type` from ZodType, so a `.type`-only check would
   238	      // misclassify it. CardSchema (frontmatter) is a plain object identified by
   239	      // its `.frontmatterSchema`.
   240	      if (isElementSchema(def)) {
   241	        loadedElement.push(def);
   242	      } else if (isCardSchema(def)) {
   243	        loadedCard.push(def);
   244	      } else {
   245	        console.warn(`Warning: ${file} does not export a default cardSchema() or element(), skipping`);
   246	        continue;
   247	      }
   248	
   249	      if (mod.template) {
   250	        registerTemplate(mod.template as TemplateDefinition);
   251	      }
   252	    } catch (err) {
   253	      console.warn(`Warning: failed to load box schema ${file}: ${(err as Error).message}`);
   254	    }
   255	  }
   256	
   257	  return { cardSchemas: loadedCard, elementSchemas: loadedElement };
   258	}
   259	
   260	function isElementSchema(def: unknown): def is ElementSchema {
   261	  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
   262	}
   263	
   264	function isCardSchema(def: unknown): def is CardSchema {
   265	  return (
   266	    typeof def === "object"
   267	    && def !== null
   268	    && typeof (def as CardSchema).type === "string"
   269	    && "frontmatterSchema" in def
   270	  );
   271	}
   272	
   273	/**
   274	 * Create a SchemaRegistry populated with all known schemas.
   275	 *
   276	 * If boxRoot is provided, also loads box-local schemas from config/schemas/.
   277	 */
   278	export async function createSchemaRegistry(boxRoot?: string): Promise<SchemaRegistry> {
   279	  const registry = new SchemaRegistry();
   280	  for (const schema of schemas) {
   281	    registry.register(schema);
   282	  }
   283	  if (boxRoot) {
   284	    const { elementSchemas } = await loadBoxSchemas(boxRoot);
   285	    for (const schema of elementSchemas) {
   286	      registry.register(schema);
   287	    }
   288	  }
   289	  return registry;
   290	}
   291	
   292	/**
   293	 * Get all schemas (built-in + box-local).
   294	 *
   295	 * If boxRoot is provided, includes box-local schemas.
   296	 */
   297	export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
   298	  if (!boxRoot) return schemas;
   299	  const { elementSchemas } = await loadBoxSchemas(boxRoot);
   300	  return [...schemas, ...elementSchemas];
   301	}
   302	
   303	/**
   304	 * Get the list of known card types.
   305	 */
   306	export function getCardTypes(): string[] {
   307	  return [
   308	    ...schemas.map(s => s.tagName),
   309	    ...cardSchemas.map(s => s.type),
   310	  ];
   311	}
   312	
   313	/**
   314	 * Get the card types that belong in content search indexes — every type
   315	 * whose schema doesn't set `searchable: false`. Includes box-local schemas
   316	 * when a boxRoot is given (they default to searchable).
   317	 */
   318	export async function getSearchableTypes(boxRoot?: string): Promise<string[]> {
   319	  const elementSchemas = await getAllSchemas(boxRoot);
   320	  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
   321	  const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
   322	  return [
   323	    ...elementSchemas.filter(s => s.searchable !== false).map(s => s.tagName),
   324	    ...allCardSchemas.filter(s => s.searchable).map(s => s.type),
   325	  ];
   326	}
   327	
   328	/**
   329	 * Check if a card type is known.
   330	 */
   331	export function isKnownCardType(type: string): boolean {
   332	  return (
   333	    schemas.some(s => s.tagName === type)
   334	    || cardSchemas.some(s => s.type === type)
   335	  );
   336	}
   337	
   338	/**
   339	 * Build a Map<type, CardSchema> for the markdown-frontmatter loader path.
   340	 *
   341	 * When boxRoot is given, box-local frontmatter schemas (from
   342	 * config/schemas/*.ts) are merged in on top of the built-in ones, so box
   343	 * card types parse and validate as first-class. A box schema whose type
   344	 * collides with a built-in wins (last write) — boxes can override.
   345	 */
   346	export async function createCardSchemaMap(boxRoot?: string): Promise<Map<string, CardSchema>> {
   347	  const map = new Map<string, CardSchema>();
   348	  for (const schema of cardSchemas) {
   349	    map.set(schema.type, schema);
   350	  }
   351	  if (boxRoot) {
   352	    const { cardSchemas: boxCardSchemas } = await loadBoxSchemas(boxRoot);
   353	    for (const schema of boxCardSchemas) {
   354	      map.set(schema.type, schema);
   355	    }
   356	  }
   357	  return map;
   358	}
   359	
   360	// Re-export individual schemas for direct access
   361	export { MemoSchema } from "./memo.js";
   362	export { QuestionSchema } from "./question.js";
   363	export { FeedbackSchema } from "./feedback.js";
   364	export { ProcedureSchema } from "./procedure.js";
   365	export { ProcedureRunSchema } from "./procedure-run.js";
   366	export { ImageSchema } from "./image.js";
   367	export { AudioSchema } from "./audio.js";
   368	export { FileSchema } from "./file.js";
   369	export { CaptureSessionSchema } from "./capture-session.js";
   370	export { RecordSchema } from "./record.js";
   371	export { RecipeSchema } from "./recipe.js";
   372	export { EmailThreadSchema } from "./email-thread.js";
   373	export { EmailMessageSchema } from "./email-message.js";
   374	export { EmailOutboundSchema } from "./email-outbound.js";
   375	export { IntakeJobSchema } from "./intake-job.js";
   376	export { CalendarReviewJobSchema } from "./calendar-review-job.js";
   377	export { GuideSchema } from "./guide.js";
   378	export { ScheduledScriptSchema } from "./scheduled-script.js";
   379	export { TelegramMessageSchema } from "./telegram-message.js";
   380	export { ChatThreadSchema } from "./chat-thread.js";

exec
/opt/homebrew/bin/bash -lc "rg -n \"elementSchemas|schemas\\]|createSchemaRegistry|createElementSchemaMap|createCardSchemaMap|loadBoxSchemas|BoxSchemas\" callback-box/src callback-box/scripts callback-box/test" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/test/box-schemas.doctest.md:5:schema. `loadBoxSchemas` discovers both, segregating them by format; box frontmatter schemas
callback-box/test/box-schemas.doctest.md:13:import { loadBoxSchemas, createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/box-schemas.doctest.md:70:Both schema files must exist before the first `loadBoxSchemas` call (results are cached per
callback-box/test/box-schemas.doctest.md:72:in `elementSchemas`:
callback-box/test/box-schemas.doctest.md:79:const loaded = await loadBoxSchemas(box);
callback-box/test/box-schemas.doctest.md:80:[loaded.cardSchemas.length, loaded.elementSchemas.length, loaded.cardSchemas[0].type, loaded.elementSchemas[0].tagName].join("|")
callback-box/test/box-schemas.doctest.md:114:`createCardSchemaMap(boxRoot)` includes box frontmatter types alongside the built-ins:
callback-box/test/box-schemas.doctest.md:117:const map = await createCardSchemaMap(box);
callback-box/test/search-extract.doctest.md:16:import { schemas, createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/search-extract.doctest.md:20:  cardSchemas: await createCardSchemaMap(),
callback-box/test/search-extract.doctest.md:21:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/test/schemas.doctest.md:11:  createSchemaRegistry,
callback-box/test/schemas.doctest.md:58:The full registry of XML schemas is available via `createSchemaRegistry()`:
callback-box/test/schemas.doctest.md:61:const registry = await createSchemaRegistry();
callback-box/test/contains-state.doctest.md:19:import { schemas, createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/contains-state.doctest.md:25:  cardSchemas: await createCardSchemaMap(),
callback-box/test/contains-state.doctest.md:26:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/test/card-lint.doctest.md:54:  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
callback-box/test/card-io.doctest.md:22:import { createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/card-io.doctest.md:145:  elementSchemas: new Map<string, ElementSchema>([
callback-box/test/card-io.doctest.md:174:  cardSchemas: await createCardSchemaMap(),
callback-box/test/card-io.doctest.md:175:  elementSchemas: new Map(),
callback-box/test/capture-pipeline.test.ts:23:import { createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/capture-pipeline.test.ts:84:      schemas: await createCardSchemaMap(),
callback-box/test/capture-pipeline.test.ts:145:      schemas: await createCardSchemaMap(),
callback-box/src/core/load-context.ts:9:import { createCardSchemaMap, createSchemaRegistry } from "../schemas/registry.js";
callback-box/src/core/load-context.ts:12:  const registry = await createSchemaRegistry(boxRoot);
callback-box/src/core/load-context.ts:13:  const elementSchemas = new Map<string, ElementSchema>();
callback-box/src/core/load-context.ts:16:    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/src/core/load-context.ts:18:  return { cardSchemas: await createCardSchemaMap(boxRoot), elementSchemas };
callback-box/src/dev/knowledge-audits.yaml:88:    tags: [cards, schemas]
callback-box/src/dev/knowledge-audits.yaml:95:    tags: [cards, schemas]
callback-box/src/dev/knowledge-audits.yaml:1437:    tags: [landmarks, schemas]
callback-box/src/dev/knowledge-audits.yaml:1450:    tags: [landmarks, schemas]
callback-box/src/dev/knowledge-audits.yaml:1692:    tags: [triage-pipeline, landmarks, schemas]
callback-box/src/core/init-rules.ts:13:import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/init-rules.ts:95:  const boxSchemas = await loadBoxSchemas(boxRoot);
callback-box/src/core/init-rules.ts:98:    ...boxSchemas.elementSchemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
callback-box/src/core/generate-docs-compile.ts:17:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/core/generate-docs-compile.ts:86:      schemas: await createCardSchemaMap(boxRoot),
callback-box/src/core/generate-docs-compile.ts:360:      schemas: await createCardSchemaMap(boxRoot),
callback-box/src/core/schedule-health-box.ts:23:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/core/schedule-health-box.ts:102:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/schemas/index.ts:8:  createSchemaRegistry,
callback-box/src/core/generate-docs.ts:16:import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/generate-docs.ts:419:  const boxSchemas = await loadBoxSchemas(boxRoot);
callback-box/src/core/generate-docs.ts:420:  const allSchemas = [...schemas, ...boxSchemas.elementSchemas];
callback-box/src/schemas/registry.ts:59: * Map<type, CardSchema> by createCardSchemaMap below.
callback-box/src/schemas/registry.ts:166:export interface BoxSchemas {
callback-box/src/schemas/registry.ts:170:  elementSchemas: ElementSchema[];
callback-box/src/schemas/registry.ts:174: * Per-boxRoot cache. loadBoxSchemas is called from ~24 sites (every place
callback-box/src/schemas/registry.ts:183:const boxSchemaCache = new Map<string, BoxSchemas>();
callback-box/src/schemas/registry.ts:195:export async function loadBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
callback-box/src/schemas/registry.ts:199:  const result = await loadBoxSchemasUncached(boxRoot);
callback-box/src/schemas/registry.ts:204:async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
callback-box/src/schemas/registry.ts:205:  const empty: BoxSchemas = { cardSchemas: [], elementSchemas: [] };
callback-box/src/schemas/registry.ts:257:  return { cardSchemas: loadedCard, elementSchemas: loadedElement };
callback-box/src/schemas/registry.ts:278:export async function createSchemaRegistry(boxRoot?: string): Promise<SchemaRegistry> {
callback-box/src/schemas/registry.ts:284:    const { elementSchemas } = await loadBoxSchemas(boxRoot);
callback-box/src/schemas/registry.ts:285:    for (const schema of elementSchemas) {
callback-box/src/schemas/registry.ts:299:  const { elementSchemas } = await loadBoxSchemas(boxRoot);
callback-box/src/schemas/registry.ts:300:  return [...schemas, ...elementSchemas];
callback-box/src/schemas/registry.ts:319:  const elementSchemas = await getAllSchemas(boxRoot);
callback-box/src/schemas/registry.ts:320:  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
callback-box/src/schemas/registry.ts:323:    ...elementSchemas.filter(s => s.searchable !== false).map(s => s.tagName),
callback-box/src/schemas/registry.ts:346:export async function createCardSchemaMap(boxRoot?: string): Promise<Map<string, CardSchema>> {
callback-box/src/schemas/registry.ts:352:    const { cardSchemas: boxCardSchemas } = await loadBoxSchemas(boxRoot);
callback-box/src/core/card-io.ts:306:  elementSchemas: Map<string, ElementSchema>;
callback-box/src/core/card-io.ts:377:  const schema = ctx.elementSchemas.get(element.tagName);
callback-box/src/connectors/gmail-drafts.ts:21:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/connectors/gmail-drafts.ts:135:    schemas: await createCardSchemaMap(opts.boxRoot),
callback-box/src/connectors/gmail-drafts.ts:234:      schemas: await createCardSchemaMap(),
callback-box/src/webapp/routes/scheduler.ts:17:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/webapp/routes/scheduler.ts:116:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/commands/transcribe-captures.ts:20:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/transcribe-captures.ts:36:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/transcribe-captures.ts:44:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/assemble-timeline-helpers.ts:7:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/assemble-timeline-helpers.ts:17:      schemas: await createCardSchemaMap(),
callback-box/src/core/commands/assemble-timeline-helpers.ts:33:      schemas: await createCardSchemaMap(),
callback-box/src/core/commands/describe-images-card.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/describe-images-card.ts:23:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/describe-images-card.ts:31:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/answer.ts:19:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/answer.ts:55:      schemas: await createCardSchemaMap(),
callback-box/src/webapp/context.ts:14:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/webapp/context.ts:32:  const schemas = await createCardSchemaMap(root);
callback-box/src/webapp/trpc/routers/scheduler.ts:16:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/scheduler.ts:152:      const card = parseCardText(content, { source: fileName, schemas: await createCardSchemaMap(ctx.boxRoot) });
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:9:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:144:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/connectors/telegram-output-cards.ts:13:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/connectors/telegram-output-cards.ts:52:      const card = parseCardText(content, { source: relPath, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/webapp/trpc/routers/card.ts:9:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/card.ts:198:      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/cli/commands/scheduled.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/scheduled.ts:53:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/tick-utils.ts:16:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/tick-utils.ts:71:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/tick.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/tick.ts:104:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/lib/loader.ts:8:import { createSchemaRegistry } from "../../schemas/registry.js";
callback-box/src/cli/lib/loader.ts:32:    schemas: await createSchemaRegistry(boxRoot),
callback-box/src/cli/lib/loader.ts:62:    schemas: await createSchemaRegistry(),

exec
/opt/homebrew/bin/bash -lc "rg -n \"from ['\\\"]cardworks['\\\"]|require\\(['\\\"]cardworks['\\\"]\\)|import\\(['\\\"]cardworks['\\\"]\\)\" callback-box/src callback-box/scripts callback-box/test bin callback-box/docs callback-box/*.md" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/scripts/migrate/landmark.ts:47:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/guide.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/personality.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/misc.ts:16:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:277:> import { element, escapeText } from "cardworks";
callback-box/scripts/migrate/chat-thread.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/doc-sheet.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/memo.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:25:> import { element } from "cardworks";
callback-box/scripts/migrate/scheduled-script.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/procedure-run.ts:17:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/question.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/_warnings.ts:18:import type { ElementNode } from "cardworks";
callback-box/test/card-lint.doctest.md:15:} from "cardworks";
callback-box/scripts/migrate/procedure.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/jobs.ts:18:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/file.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/test/card-io.doctest.md:15:} from "cardworks";
callback-box/scripts/migrate/audio.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/record-person.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/recipe.ts:40:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/scripts/migrate/briefing.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/email-thread.ts:43:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/capture-session.ts:19:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/test/extfile-sync.doctest.md:12:import { splitCardContent } from "cardworks";
callback-box/scripts/migrate/email-message.ts:48:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/repair-refs.ts:34:import { extractRefs, splitCardContent } from "cardworks";
callback-box/scripts/migrate/image.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/schemas/guide-parse.tsx:10:import { splitCardContent } from "cardworks";
callback-box/src/schemas/recipe.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/memo.ts:9:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/landmark.ts:27:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/sheet.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-message.tsx:30:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/guide-elements.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/briefing.tsx:19:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/procedure.ts:11:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/todo-list.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/personality.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/file.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/capture-session.tsx:15:import { splitCardContent, body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/intake-job.tsx:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/question-followup-job.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-thread.tsx:29:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/procedure-run.ts:8:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/person.tsx:11:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/cli/commands/validate.ts:10:import { formatLintResults, type LintSummary } from "cardworks";
callback-box/src/schemas/question.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/audio.tsx:12:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/image.tsx:13:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/gdoc.tsx:18:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-outbound.tsx:34:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/commentary.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/telegram-message.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/feedback.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/chat-thread.ts:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/record.tsx:12:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/webpage.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/scheduled-script.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/calendar-review-job.tsx:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/test/schemas.doctest.md:18:import { parseCard } from "cardworks";
callback-box/src/schemas/doc.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/src/schemas/chat-job.ts:10:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/extfile.tsx:16:import { cardSchema, type CardSchema } from "cardworks";
callback-box/test/card-loaders.doctest.md:8:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/box-schemas.doctest.md:34:const WIDGET_SCHEMA = `import { body, cardSchema } from "cardworks";
callback-box/test/box-schemas.doctest.md:48:const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/test/loader-registry.doctest.md:13:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/docs/EXAMPLE_FILES.md:561:import { element } from "cardworks";
callback-box/docs/EXAMPLE_FILES.md:595:import { element } from "cardworks";
callback-box/docs/adding-schemas.md:23:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/docs/adding-schemas.md:160:import { splitCardContent } from "cardworks";
callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/src/cli/lib/loader.ts:70:export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/src/cli/lib/loader.ts:71:export type { ICardLoader, CardLoaderOptions } from "cardworks";
callback-box/docs/boxes-as-packages.md:17:2. **Schemas are a stub package.** `config/schemas/package.json` is `{"type":"module"}` with no dependencies. To define a real schema the agent would want `import { z } from "zod"; import { element } from "cardworks";` — same as built-in schemas in `src/schemas/`. Today this works only by accident (transitive resolution from the callback-box install) and gives no IDE help inside the box.
callback-box/src/webapp/routes/views.ts:21:import type { ElementNode } from "cardworks";
callback-box/src/webapp/routes/api-card-patch.ts:12:import type { ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/todos.ts:9:import { CardLoader, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/card.ts:7:import { parseCard, splitCardContent, type CardSchema, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/chat.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/scheduler.ts:10:import { splitCardContent } from "cardworks";
callback-box/src/connectors/preserve-agent-fields.ts:12:import { splitCardContent } from "cardworks";
callback-box/docs/plans/remove-cardworks-package.md:151:keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/docs/plans/remove-cardworks-package.md:178:find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/docs/plans/remove-cardworks-package.md:205:`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/docs/plans/remove-cardworks-package.md:323:   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/src/core/reactor/procedure-trampoline.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "cardworks";
callback-box/src/core/box-templates.ts:86:import { cardSchema } from "cardworks";
callback-box/src/core/box-templates.ts:133:import { element } from "cardworks";
callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/src/connectors/intake-utils.ts:17:import { splitCardContent } from "cardworks";
callback-box/src/core/extfile-sync.ts:13:import { splitCardContent } from "cardworks";
callback-box/src/core/search/contains-update.ts:11:import { splitCardContent } from "cardworks";
callback-box/src/connectors/gmail-drafts.ts:19:import { splitCardContent } from "cardworks";
callback-box/src/connectors/chat-utils.ts:15:import { splitCardContent } from "cardworks";
callback-box/src/core/file-summary.ts:13:import type { ElementNode } from "cardworks";
callback-box/src/core/search/refresh-file.ts:10:import { ParseError } from "cardworks";
callback-box/src/core/card-lint.ts:27:} from "cardworks";
callback-box/src/core/preactions/index.ts:21:import type { ICardLoader } from "cardworks";
callback-box/src/core/landmark/resolve.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/core/preactions/types.ts:1:import type { Card, ICardLoader, CardSchema } from "cardworks";
callback-box/src/core/search/extract.ts:19:import type { ElementNode } from "cardworks";
callback-box/src/core/preactions/transcribe.ts:18:import type { ElementNode } from "cardworks";
callback-box/src/core/generate-docs-compile.ts:12:import { parseCard } from "cardworks";
callback-box/src/core/card-io.ts:27:} from "cardworks";
callback-box/src/core/commands/answer.ts:10:import { splitCardContent } from "cardworks";
callback-box/src/core/sdk-hooks.ts:14:import { formatLintResults } from "cardworks";
callback-box/src/core/commands/assemble-timeline-helpers.ts:5:import { splitCardContent } from "cardworks";
callback-box/src/core/procedure/engine-run-card.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/core/commands/ls.ts:11:import { type ElementNode, parseCard, evaluateXPathString } from "cardworks";
callback-box/src/core/commands/move-operations.ts:16:import { CardLoader } from "cardworks";

codex
The broad import search also found consumers the plan either downplays or omits from its “migrators are the last consumer” gating: `scripts/clean-broken-refs.ts`, tests/doctests, docs/example generator strings, and `box-templates.ts` strings that create box-local schemas importing `cardworks`. I’m checking which are real runtime blockers versus docs/test cleanup.
exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/schema/card-schema.ts | sed -n '1,340p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	import { z, type ZodType } from "zod";
     2	
     3	/**
     4	 * Card schemas describe a card file's full shape: most fields live in the
     5	 * YAML frontmatter, and at most one field lives in the file body.
     6	 *
     7	 * cardworks itself does not parse YAML — the host application reads the
     8	 * frontmatter into a plain object and hands it to a CardSchema for
     9	 * validation. CardSchema declarations are also where templates,
    10	 * documentation, and migration tooling look up per-field metadata.
    11	 */
    12	
    13	const BODY_FIELD_TAG = Symbol("cardworks.bodyField");
    14	
    15	/**
    16	 * Thrown when a cardSchema() declaration is invalid (multiple body fields,
    17	 * or no fields at all). Carries the offending card type for inspection.
    18	 */
    19	class CardSchemaDeclarationError extends Error {
    20	  readonly type: string;
    21	  constructor(type: string, detail: string) {
    22	    super(`cardSchema(${type}): ${detail}`);
    23	    this.name = "CardSchemaDeclarationError";
    24	    this.type = type;
    25	  }
    26	}
    27	
    28	/**
    29	 * Supported body content kinds. Markdown bodies are plain UTF-8 text;
    30	 * XML bodies are validated against an XML element schema (the body
    31	 * itself is the element — there is no synthetic root wrapper).
    32	 */
    33	export type BodyKind = "markdown" | "xml";
    34	
    35	export interface BodyFieldOptions {
    36	  /** Body kind. Defaults to "markdown". */
    37	  kind?: BodyKind;
    38	}
    39	
    40	export interface BodyField<TSchema extends ZodType = ZodType> {
    41	  readonly [BODY_FIELD_TAG]: true;
    42	  readonly schema: TSchema;
    43	  readonly kind: BodyKind;
    44	}
    45	
    46	/**
    47	 * Marks a field as living in the card's file body instead of the YAML
    48	 * frontmatter. Each CardSchema may declare at most one body field.
    49	 */
    50	export function body<TSchema extends ZodType>(
    51	  schema: TSchema,
    52	  options?: BodyFieldOptions
    53	): BodyField<TSchema> {
    54	  options = options ?? {};
    55	  const kind = options.kind === undefined ? "markdown" : options.kind;
    56	  return { [BODY_FIELD_TAG]: true, schema, kind };
    57	}
    58	
    59	export function isBodyField(value: unknown): value is BodyField {
    60	  return (
    61	    typeof value === "object"
    62	    && value !== null
    63	    && BODY_FIELD_TAG in value
    64	  );
    65	}
    66	
    67	/**
    68	 * A field declaration: either a Zod schema (frontmatter) or a body()-wrapped
    69	 * Zod schema (file body).
    70	 */
    71	export type FieldDecl = ZodType | BodyField;
    72	
    73	/**
    74	 * Optional frontmatter fields available on every card type, injected into
    75	 * the frontmatter schema by cardSchema() unless the schema declares its own
    76	 * field of the same name (the schema's declaration wins — e.g. a card type
    77	 * may require `title` rather than leave it optional).
    78	 *
    79	 * - `title` — human-readable display title.
    80	 * - `contains` — one sentence stating what can be found inside this card;
    81	 *   the prime retrieval field for search and listings.
    82	 * - `content-type` — body encoding marker the host reads to know how to parse
    83	 *   the body (e.g. an XML-bodied card carries `application/x-card+xml`). It is a
    84	 *   structural field set by the serializer, not author data, so it is allowed on
    85	 *   every card type rather than redeclared per schema. Required now that the
    86	 *   frontmatter schema is `.strict()` — otherwise XML-bodied cards would be
    87	 *   rejected for carrying it.
    88	 */
    89	export const GLOBAL_CARD_FIELDS: Record<string, ZodType> = {
    90	  title: z.string().optional(),
    91	  contains: z.string().optional(),
    92	  "content-type": z.string().optional(),
    93	};
    94	
    95	/**
    96	 * Configuration for cardSchema().
    97	 */
    98	export interface CardSchemaConfig<TFields extends Record<string, FieldDecl>> {
    99	  /** All fields keyed by name. At most one may be body()-wrapped. */
   100	  fields: TFields;
   101	  /** Handling instructions for agents working with this card type. */
   102	  instructions?: string;
   103	  /**
   104	   * Whether cards of this type belong in content search indexes.
   105	   * Defaults to true; operational/bookkeeping card types set false.
   106	   */
   107	  searchable?: boolean;
   108	}
   109	
   110	/**
   111	 * Resolved shape of a card schema. Used by loaders, serializers, and migration
   112	 * tooling to know what lives where.
   113	 */
   114	export interface CardSchema<
   115	  TTag extends string = string,
   116	  TFields extends Record<string, FieldDecl> = Record<string, FieldDecl>,
   117	> {
   118	  readonly type: TTag;
   119	  readonly fields: TFields;
   120	  /** Name of the single body field, or null if the card is frontmatter-only. */
   121	  readonly bodyFieldName: string | null;
   122	  /** Resolved body field (kind + schema), or null. */
   123	  readonly bodyField: BodyField | null;
   124	  /** Zod schema for the frontmatter object (everything except the body field, plus `type`). */
   125	  readonly frontmatterSchema: ZodType;
   126	  /** Names from GLOBAL_CARD_FIELDS injected here (i.e. not author-declared). */
   127	  readonly globalFieldNames: ReadonlyArray<string>;
   128	  /** Whether cards of this type belong in content search indexes. */
   129	  readonly searchable: boolean;
   130	  /** Handling instructions for agents. */
   131	  readonly instructions?: string;
   132	}
   133	
   134	/**
   135	 * Declare a card schema. The result tells the loader/serializer which
   136	 * fields are frontmatter and which is the body.
   137	 *
   138	 * Card files identify their schema via a top-level `type:` field in the
   139	 * YAML frontmatter; that field is added automatically to the frontmatter
   140	 * schema and need not be listed under `fields`.
   141	 */
   142	export function cardSchema<
   143	  TTag extends string,
   144	  TFields extends Record<string, FieldDecl>,
   145	>(type: TTag, config: CardSchemaConfig<TFields>): CardSchema<TTag, TFields> {
   146	  let bodyFieldName: string | null = null;
   147	  let bodyField: BodyField | null = null;
   148	  const frontmatterShape: Record<string, ZodType> = {
   149	    type: z.literal(type),
   150	  };
   151	  for (const [name, decl] of Object.entries(config.fields)) {
   152	    if (isBodyField(decl)) {
   153	      if (name !== "body") {
   154	        // One vocabulary across every card type: the file-body field is
   155	        // always `body`. (On disk the body has no field name at all, so
   156	        // this constrains code, not card files. It also makes multiple
   157	        // body fields impossible — object keys are unique.)
   158	        throw new CardSchemaDeclarationError(
   159	          type,
   160	          `the body field must be named "body" (got "${name}")`
   161	        );
   162	      }
   163	      bodyFieldName = name;
   164	      bodyField = decl;
   165	    } else {
   166	      frontmatterShape[name] = decl;
   167	    }
   168	  }
   169	  if (bodyField === null && Object.keys(config.fields).length === 0) {
   170	    throw new CardSchemaDeclarationError(type, "must declare at least one field");
   171	  }
   172	  const globalFieldNames: string[] = [];
   173	  for (const [name, validator] of Object.entries(GLOBAL_CARD_FIELDS)) {
   174	    if (name in config.fields) continue; // schema-wins: author declaration takes precedence
   175	    frontmatterShape[name] = validator;
   176	    globalFieldNames.push(name);
   177	  }
   178	  const schema: CardSchema<TTag, TFields> = {
   179	    type,
   180	    fields: config.fields,
   181	    bodyFieldName,
   182	    bodyField,
   183	    // Lenient (not `.strict()`): an unknown frontmatter key is stripped in
   184	    // memory, so a card that has drifted past its schema still loads, renders,
   185	    // and indexes — it lives in a usable middle-ground rather than vanishing.
   186	    // The unknown key is surfaced separately as a lint *warning* (see
   187	    // card-lint.ts) so it gets cleaned off disk eventually. A missing required
   188	    // field or wrong type still fails here at parse — those are genuine
   189	    // can't-use-this-card errors, not recoverable cruft.
   190	    frontmatterSchema: z.object(frontmatterShape),
   191	    globalFieldNames,
   192	    searchable: config.searchable ?? true,
   193	  };
   194	  if (config.instructions !== undefined) {
   195	    return { ...schema, instructions: config.instructions };
   196	  }
   197	  return schema;
   198	}
   199	
   200	/**
   201	 * Walk a parsed fields object and pull out every reference.
   202	 *
   203	 * Refs are identified by convention, not by schema declaration:
   204	 *   - any key literally named `ref` whose value is a string
   205	 *   - any key literally named `refs` whose value is an array of strings
   206	 *
   207	 * Refs can appear at any depth — inside nested objects, inside array
   208	 * elements, etc. Each result carries a JSON path (with indices filled
   209	 * in) so callers can attach lint errors to a specific position.
   210	 */
   211	export function extractRefs(
   212	  fields: Record<string, unknown>
   213	): Array<{ path: string; ref: string }> {
   214	  const out: Array<{ path: string; ref: string }> = [];
   215	  walkForRefs(fields, { currentPath: "", out });
   216	  return out;
   217	}
   218	
   219	interface WalkForRefsOptions {
   220	  currentPath: string;
   221	  out: Array<{ path: string; ref: string }>;
   222	}
   223	
   224	function walkForRefs(value: unknown, { currentPath, out }: WalkForRefsOptions): void {
   225	  if (Array.isArray(value)) {
   226	    for (const [i, item] of value.entries()) {
   227	      walkForRefs(item, { currentPath: `${currentPath}[${String(i)}]`, out });
   228	    }
   229	    return;
   230	  }
   231	  if (value === null || typeof value !== "object") return;
   232	  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
   233	    const childPath = currentPath === "" ? key : `${currentPath}.${key}`;
   234	    if (key === "ref" && typeof child === "string") {
   235	      out.push({ path: childPath, ref: child });
   236	      continue;
   237	    }
   238	    if (key === "refs" && Array.isArray(child)) {
   239	      const items = child as unknown[];
   240	      for (const [i, item] of items.entries()) {
   241	        if (typeof item === "string") {
   242	          out.push({ path: `${childPath}[${String(i)}]`, ref: item });
   243	        }
   244	      }
   245	      continue;
   246	    }
   247	    walkForRefs(child, { currentPath: childPath, out });
   248	  }
   249	}

exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/parser/frontmatter.ts | sed -n '1,140p' && nl -ba cardworks/src/schema/registry.ts | sed -n '1,140p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
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
     1	import type { ZodType } from "zod";
     2	import type { ElementSchema } from "./element.js";
     3	
     4	/**
     5	 * A registry of element schemas indexed by tag name.
     6	 */
     7	export class SchemaRegistry {
     8	  private schemas = new Map<string, ZodType>();
     9	
    10	  /**
    11	   * Create a new schema registry.
    12	   *
    13	   * @param schemas - Optional array of ElementSchemas to register
    14	   */
    15	  constructor(schemas?: ElementSchema[]) {
    16	    schemas = schemas ?? [];
    17	    for (const schema of schemas) {
    18	      this.register(schema);
    19	    }
    20	  }
    21	
    22	  /**
    23	   * Register an element schema.
    24	   *
    25	   * @param schema - The ElementSchema to register (must have .tagName)
    26	   */
    27	  register(schema: ElementSchema): void {
    28	    this.schemas.set(schema.tagName, schema);
    29	  }
    30	
    31	  /**
    32	   * Get the schema for a tag name.
    33	   *
    34	   * @param tagName - The tag name to look up
    35	   * @returns The schema, or undefined if not registered
    36	   */
    37	  get(tagName: string): ZodType | undefined {
    38	    return this.schemas.get(tagName);
    39	  }
    40	
    41	  /**
    42	   * Check if a schema is registered for a tag name.
    43	   *
    44	   * @param tagName - The tag name to check
    45	   */
    46	  has(tagName: string): boolean {
    47	    return this.schemas.has(tagName);
    48	  }
    49	
    50	  /**
    51	   * Get all registered tag names.
    52	   */
    53	  tagNames(): string[] {
    54	    return Array.from(this.schemas.keys());
    55	  }
    56	
    57	  /**
    58	   * Check if any schemas are registered.
    59	   */
    60	  isEmpty(): boolean {
    61	    return this.schemas.size === 0;
    62	  }
    63	}

exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/lint/format.ts | sed -n '1,220p' && nl -ba cardworks/src/lint/lint.ts | sed -n '1,120p' && nl -ba cardworks/src/parser/parse.ts | sed -n '1,80p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	import type { LintResult, LintSummary, LintIssue } from "./lint.js";
     2	
     3	/**
     4	 * Options for formatting lint results.
     5	 */
     6	export interface FormatOptions {
     7	  /** Use colors in output (default: true if TTY) */
     8	  colors?: boolean;
     9	  /** Show only files with issues (default: false) */
    10	  onlyIssues?: boolean;
    11	  /** Base path to strip from file paths for shorter output */
    12	  basePath?: string;
    13	}
    14	
    15	// ANSI color codes
    16	const colors = {
    17	  red: "\u001B[31m",
    18	  yellow: "\u001B[33m",
    19	  green: "\u001B[32m",
    20	  gray: "\u001B[90m",
    21	  bold: "\u001B[1m",
    22	  reset: "\u001B[0m",
    23	};
    24	
    25	/**
    26	 * Format a single lint issue.
    27	 */
    28	function formatIssue(issue: LintIssue, useColors: boolean): string {
    29	  const c = useColors ? colors : { red: "", yellow: "", gray: "", bold: "", reset: "" };
    30	
    31	  const severity =
    32	    issue.severity === "error"
    33	      ? `${c.red}error${c.reset}`
    34	      : `${c.yellow}warning${c.reset}`;
    35	
    36	  const location = issue.location
    37	    ? `${c.gray}${String(issue.location.startLine)}:${String(issue.location.startColumn)}${c.reset} `
    38	    : "";
    39	
    40	  return `  ${location}${severity}: ${issue.message}`;
    41	}
    42	
    43	/**
    44	 * Format a single lint result.
    45	 */
    46	export function formatLintResult(result: LintResult, options?: FormatOptions): string {
    47	  options = options ?? {};
    48	  const useColors = options.colors ?? true;
    49	  const c = useColors ? colors : { red: "", yellow: "", green: "", gray: "", bold: "", reset: "" };
    50	
    51	  let path = result.path;
    52	  if (options.basePath && path.startsWith(options.basePath)) {
    53	    path = path.slice(options.basePath.length);
    54	    if (path.startsWith("/")) path = path.slice(1);
    55	  }
    56	
    57	  const lines: string[] = [];
    58	  const hasIssues = result.errors.length > 0 || result.warnings.length > 0;
    59	
    60	  if (!hasIssues && options.onlyIssues) {
    61	    return "";
    62	  }
    63	
    64	  if (hasIssues) {
    65	    lines.push(`${c.bold}${path}${c.reset}`);
    66	
    67	    for (const error of result.errors) {
    68	      lines.push(formatIssue(error, useColors));
    69	    }
    70	
    71	    for (const warning of result.warnings) {
    72	      lines.push(formatIssue(warning, useColors));
    73	    }
    74	
    75	    lines.push(""); // blank line after
    76	  }
    77	
    78	  return lines.join("\n");
    79	}
    80	
    81	/**
    82	 * Format all lint results.
    83	 */
    84	export function formatLintResults(summary: LintSummary, options?: FormatOptions): string {
    85	  options = options ?? {};
    86	  const useColors = options.colors ?? true;
    87	  const c = useColors ? colors : { red: "", yellow: "", green: "", gray: "", bold: "", reset: "" };
    88	
    89	  const lines: string[] = [];
    90	
    91	  // Format each result
    92	  for (const result of summary.results) {
    93	    const formatted = formatLintResult(result, options);
    94	    if (formatted) {
    95	      lines.push(formatted);
    96	    }
    97	  }
    98	
    99	  // Summary line
   100	  if (summary.totalErrors === 0 && summary.totalWarnings === 0) {
   101	    lines.push(
   102	      `${c.green}✓${c.reset} ${String(summary.filesChecked)} files checked, no issues found`
   103	    );
   104	  } else {
   105	    const errorPart =
   106	      summary.totalErrors > 0
   107	        ? `${c.red}${String(summary.totalErrors)} error${summary.totalErrors === 1 ? "" : "s"}${c.reset}`
   108	        : "";
   109	
   110	    const warningPart =
   111	      summary.totalWarnings > 0
   112	        ? `${c.yellow}${String(summary.totalWarnings)} warning${summary.totalWarnings === 1 ? "" : "s"}${c.reset}`
   113	        : "";
   114	
   115	    const parts = [errorPart, warningPart].filter(Boolean).join(" and ");
   116	
   117	    lines.push(
   118	      `${String(summary.filesChecked)} file${summary.filesChecked === 1 ? "" : "s"} checked, ${parts} in ${String(summary.filesWithErrors)} file${summary.filesWithErrors === 1 ? "" : "s"}`
   119	    );
   120	  }
   121	
   122	  return lines.join("\n");
   123	}
   124	
   125	/**
   126	 * Format lint results as JSON.
   127	 */
   128	export function formatLintResultsJson(summary: LintSummary): string {
   129	  return JSON.stringify(summary, null, 2);
   130	}
     1	import type { ICardLoader } from "../loader/loader.js";
     2	import type { ElementNode, Location } from "../parser/provenance.js";
     3	import { parseRef, parseRefs } from "../refs/parse-ref.js";
     4	import { parseCard } from "../parser/parse.js";
     5	
     6	/**
     7	 * A lint issue (error or warning).
     8	 */
     9	export interface LintIssue {
    10	  type: "parse" | "validation" | "reference" | "id" | "schema" | "contains";
    11	  severity: "error" | "warning";
    12	  message: string;
    13	  location?: Location;
    14	}
    15	
    16	/**
    17	 * Result of linting a single card.
    18	 */
    19	export interface LintResult {
    20	  path: string;
    21	  errors: LintIssue[];
    22	  warnings: LintIssue[];
    23	}
    24	
    25	/**
    26	 * Summary of all lint results.
    27	 */
    28	export interface LintSummary {
    29	  results: LintResult[];
    30	  totalErrors: number;
    31	  totalWarnings: number;
    32	  filesChecked: number;
    33	  filesWithErrors: number;
    34	}
    35	
    36	/**
    37	 * Options for linting.
    38	 */
    39	export interface LintOptions {
    40	  /** Check references for broken links and version mismatches (default: true) */
    41	  checkRefs?: boolean;
    42	}
    43	
    44	/**
    45	 * Options for {@link lintCard}: the card path plus optional lint settings.
    46	 */
    47	export interface LintCardOptions extends LintOptions {
    48	  /** The path to the card file to lint */
    49	  path: string;
    50	}
    51	
    52	/**
    53	 * Lint a single card file.
    54	 */
    55	export async function lintCard(
    56	  loader: ICardLoader,
    57	  options: LintCardOptions
    58	): Promise<LintResult> {
    59	  const { path } = options;
    60	  const errors: LintIssue[] = [];
    61	  const warnings: LintIssue[] = [];
    62	  const checkRefs = options.checkRefs ?? true;
    63	
    64	  try {
    65	    // Load will parse and validate against schema
    66	    const card = await loader.load(path);
    67	
    68	    // Check if schema exists for this tag (only if schemas are in use)
    69	    if (loader.hasAnySchemas() && !loader.hasSchema(card.element.tagName)) {
    70	      warnings.push({
    71	        type: "schema",
    72	        severity: "warning",
    73	        message: `Unknown root tag <${card.element.tagName}> (no schema registered)`,
    74	        location: card.element.location,
    75	      });
    76	    }
    77	
    78	    // Check for duplicate IDs
    79	    checkDuplicateIds(card.element, warnings);
    80	
    81	    // Check references if enabled
    82	    if (checkRefs) {
    83	      await checkRefsInNode(card.element, { cardPath: path, loader, errors, warnings });
    84	    }
    85	  } catch (e) {
    86	    if (e instanceof Error) {
    87	      // Determine error type based on error class name
    88	      const isValidation = e.name === "ValidationError";
    89	      const isParse = e.name === "ParseError";
    90	
    91	      const issue: LintIssue = {
    92	        type: isValidation ? "validation" : isParse ? "parse" : "parse",
    93	        severity: "error",
    94	        message: e.message,
    95	      };
    96	
    97	      // Add location if available
    98	      if ("location" in e && typeof e.location === "object" && e.location !== null) {
    99	        issue.location = e.location as Location;
   100	      }
   101	
   102	      errors.push(issue);
   103	    }
   104	  }
   105	
   106	  return { path, errors, warnings };
   107	}
   108	
   109	/**
   110	 * Collected ID information for duplicate checking.
   111	 */
   112	interface IdOccurrence {
   113	  id: string;
   114	  location: Location;
   115	}
   116	
   117	/**
   118	 * Check for duplicate IDs within a card.
   119	 */
   120	function checkDuplicateIds(root: ElementNode, warnings: LintIssue[]): void {
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

codex
The keep-set is mostly clean, but one detail matters: `SchemaRegistry` is not a generic frontmatter registry in the actual file; it is still an XML element registry keyed by `.tagName`. Also the lint formatter reads `startLine/startColumn`, so the plan’s proposed `{ source, line, column }` replacement would silently drop locations.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/load-context.ts | sed -n '1,120p' && nl -ba callback-box/src/core/search/extract.ts | sed -n '1,360p' && nl -ba callback-box/src/core/commands/ls.ts | sed -n '1,190p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/cli/lib/loader.ts | sed -n '1,130p' && nl -ba callback-box/src/core/commands/move-operations.ts | sed -n '1,260p' && nl -ba callback-box/src/webapp/trpc/routers/todos.ts | sed -n '1,240p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
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
     1	/**
     2	 * tRPC router for todo lists — update todo items. Rendering is handled
     3	 * by the todo-list card renderer (TodoListView).
     4	 */
     5	
     6	import * as path from "node:path";
     7	import { z } from "zod";
     8	import { TRPCError } from "@trpc/server";
     9	import { CardLoader, type ElementNode } from "cardworks";
    10	import { router, publicProcedure } from "../trpc.js";
    11	import { stageFiles, commit } from "../../../cli/lib/git.js";
    12	
    13	export const todosRouter = router({
    14	  updateItem: publicProcedure
    15	    .input(z.object({
    16	      listPath: z.string().min(1),
    17	      itemName: z.string().min(1),
    18	      status: z.enum(["pending", "done", "cancelled", "deferred"]),
    19	    }))
    20	    .mutation(async ({ input, ctx }) => {
    21	      const fullPath = path.join(ctx.boxRoot, input.listPath);
    22	      const loader = new CardLoader(ctx.boxRoot);
    23	      let card;
    24	      try {
    25	        card = await loader.load(fullPath);
    26	      } catch (_e) {
    27	        throw new TRPCError({ code: "NOT_FOUND", message: `Todo list not found: ${input.listPath}` });
    28	      }
    29	
    30	      if (card.element.tagName !== "todo-list") {
    31	        throw new TRPCError({ code: "BAD_REQUEST", message: "Not a todo-list card" });
    32	      }
    33	
    34	      // Find and update the item by name (recursive)
    35	      function updateInChildren(children: ElementNode[]): boolean {
    36	        for (const child of children) {
    37	          if (child.tagName === "item" && child.attrs.name === input.itemName) {
    38	            child.attrs.status = input.status;
    39	            if (input.status === "done") {
    40	              child.attrs.completed = new Date().toISOString();
    41	            } else {
    42	              delete child.attrs.completed;
    43	            }
    44	            return true;
    45	          }
    46	          if (child.tagName === "item" && child.children) {
    47	            if (updateInChildren(child.children as ElementNode[])) return true;
    48	          }
    49	        }
    50	        return false;
    51	      }
    52	
    53	      const found = updateInChildren((card.element.children ?? []) as ElementNode[]);
    54	      if (!found) {
    55	        throw new TRPCError({ code: "NOT_FOUND", message: `Item not found: ${input.itemName}` });
    56	      }
    57	
    58	      await loader.save(card);
    59	      await stageFiles(ctx.boxRoot, [input.listPath]);
    60	      await commit(ctx.boxRoot, {
    61	        message: `Update todo item "${input.itemName}" to ${input.status}`,
    62	        trailers: { Source: "webapp", Endpoint: "todos.updateItem" },
    63	      });
    64	
    65	      return { success: true };
    66	    }),
    67	});

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
   341	  const contents: string[] = [];
   342	  for (const block of text) {
   343	    const content = str(path2(block, "content"));
   344	    if (content !== undefined) contents.push(content);
   345	  }
   346	  return contents;
   347	}
   348	
   349	function tabTitles(sheets: unknown): string[] {
   350	  if (!Array.isArray(sheets)) return [];
   351	  const titles: string[] = [];
   352	  for (const tab of sheets) {
   353	    const title = str(path2(tab, "title"));
   354	    if (title !== undefined) titles.push(title);
   355	  }
   356	  return titles;
   357	}
   358	
   359	function compact(values: Array<string | undefined>): string[] {
   360	  return values.filter((v): v is string => v !== undefined);
     1	/**
     2	 * ls command - List cards with optional XPath-based template extraction.
     3	 *
     4	 * Supports glob patterns for file matching and {xpath} placeholders
     5	 * in format templates for extracting card metadata.
     6	 */
     7	
     8	import * as fs from "node:fs/promises";
     9	import * as path from "node:path";
    10	import { glob } from "glob";
    11	import { type ElementNode, parseCard, evaluateXPathString } from "cardworks";
    12	import {
    13	  registerCommand,
    14	  type CommandContext,
    15	  type CommandResult,
    16	} from "../command-runner.js";
    17	import { isCardFile, boxPath } from "../../cli/lib/paths.js";
    18	
    19	/**
    20	 * Check if a string contains glob special characters.
    21	 */
    22	function hasGlobChars(s: string): boolean {
    23	  return /[*?[\]{}]/.test(s);
    24	}
    25	
    26	/**
    27	 * Expand a single path argument into matching card file paths.
    28	 * If it's a directory, list .card files in it (non-recursive).
    29	 * If it contains glob chars, expand the glob.
    30	 * Otherwise treat as a literal file path.
    31	 */
    32	async function expandPath(
    33	  pattern: string,
    34	  boxRoot: string
    35	): Promise<string[]> {
    36	  const absolute = path.isAbsolute(pattern)
    37	    ? pattern
    38	    : boxPath(boxRoot, pattern);
    39	
    40	  if (hasGlobChars(pattern)) {
    41	    const matches = await glob(pattern, { cwd: boxRoot, nodir: true });
    42	    return matches
    43	      .map((m) => (path.isAbsolute(m) ? m : path.join(boxRoot, m)))
    44	      .filter((m) => isCardFile(m))
    45	      .toSorted();
    46	  }
    47	
    48	  // Check if it's a directory
    49	  try {
    50	    const stat = await fs.stat(absolute);
    51	    if (stat.isDirectory()) {
    52	      const entries = await fs.readdir(absolute);
    53	      return entries
    54	        .filter((e) => isCardFile(e))
    55	        .toSorted()
    56	        .map((e) => path.join(absolute, e));
    57	    }
    58	  } catch (_e) {
    59	    // fs.stat rejects when the path doesn't exist — that's expected here,
    60	    // it just means "not a directory", and we fall through to treating the
    61	    // argument as a literal file path. No detail in the error to act on.
    62	  }
    63	
    64	  // Literal file
    65	  return [absolute];
    66	}
    67	
    68	/**
    69	 * Apply a format template to a card file, replacing {xpath} placeholders
    70	 * with values extracted from the card XML.
    71	 */
    72	function applyTemplate(template: string, rootNode: ElementNode): string {
    73	  return template.replace(/{([^}]+)}/g, (_match, expr: string) => {
    74	    return evaluateXPathString(expr, rootNode);
    75	  });
    76	}
    77	
    78	/**
    79	 * Execute the ls command.
    80	 */
    81	async function executeLs(
    82	  ctx: CommandContext,
    83	  args: Record<string, unknown>
    84	): Promise<CommandResult> {
    85	  const paths = args.paths as string[] | undefined;
    86	  const format = args.format as string | undefined;
    87	
    88	  if (!paths || paths.length === 0) {
    89	    return { success: false, error: "At least one path or glob pattern is required" };
    90	  }
    91	
    92	  // Expand all paths
    93	  const allFiles: string[] = [];
    94	  for (const p of paths) {
    95	    const expanded = await expandPath(p, ctx.boxRoot);
    96	    allFiles.push(...expanded);
    97	  }
    98	
    99	  if (allFiles.length === 0) {
   100	    return { success: true, data: { count: 0 } };
   101	  }
   102	
   103	  const lines: string[] = [];
   104	
   105	  for (const filePath of allFiles) {
   106	    const relativePath = path.relative(ctx.boxRoot, filePath);
   107	
   108	    if (!format) {
   109	      ctx.writeLine(relativePath);
   110	      lines.push(relativePath);
   111	      continue;
   112	    }
   113	
   114	    // Parse and apply template
   115	    try {
   116	      const content = await fs.readFile(filePath, "utf-8");
   117	      const root = await parseCard(content, { source: filePath });
   118	      const formatted = applyTemplate(format, root);
   119	      const line = `${relativePath}\t${formatted}`;
   120	      ctx.writeLine(line);
   121	      lines.push(line);
   122	    } catch (e) {
   123	      // Can't read or parse this card — fall back to showing just the path
   124	      // so `ls` still lists it. Warn so an unreadable/malformed card is
   125	      // visible rather than silently rendered template-free.
   126	      console.warn(`ls: could not apply format to ${relativePath}: ${e instanceof Error ? e.message : String(e)}`);
   127	      ctx.writeLine(relativePath);
   128	      lines.push(relativePath);
   129	    }
   130	  }
   131	
   132	  return { success: true, data: { count: lines.length, lines } };
   133	}
   134	
   135	// Register the command
   136	registerCommand({
   137	  name: "ls",
   138	  description: "List cards with optional XPath template extraction",
   139	  args: [
   140	    {
   141	      name: "paths",
   142	      description: "Glob patterns or directories to list",
   143	      required: true,
   144	      type: "string[]",
   145	    },
   146	    {
   147	      name: "format",
   148	      description:
   149	        "Template string with {xpath} placeholders, e.g. '{title} by {author}'",
   150	      required: false,
   151	      type: "string",
   152	    },
   153	  ],
   154	  execute: executeLs,
   155	});
   156	
   157	export { executeLs };

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/card-lint.ts | sed -n '1,240p' && nl -ba callback-box/src/core/generate-docs-compile.ts | sed -n '1,130p' && nl -ba callback-box/src/webapp/trpc/routers/card.ts | sed -n '1,260p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
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
    11	 * Ref-checking walks two sides: cardworks' `extractRefs` over parsed
    12	 * frontmatter fields, and `extractBodyRefs` over the Markdoc body. Both
    13	 * yield `{path, ref}` entries with the same shape; both are surfaced as
    14	 * warnings (not errors) so legitimate moves don't block commits.
    15	 */
    16	
    17	import { readFile } from "node:fs/promises";
    18	import {
    19	  lintCard,
    20	  splitCardContent,
    21	  extractRefs,
    22	  type LintResult,
    23	  type LintSummary,
    24	  type LintIssue,
    25	  type ICardLoader,
    26	  type CardSchema,
    27	} from "cardworks";
    28	import { parse as parseYaml } from "yaml";
    29	import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
    30	import { extractBodyRefs } from "./body-refs.js";
    31	import Markdoc, { type Node as MarkdocNode } from "@markdoc/markdoc";
    32	import { markdocConfig } from "../shared/markdoc-config.js";
    33	
    34	// Value named imports (`{ parse, validate }`) don't resolve from this CommonJS
    35	// module under Node's ESM loader (used by tsx / the doctest runner). Destructure
    36	// off the default import — same pattern + lint exception as `markdoc-config.ts`.
    37	// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
    38	const { parse: markdocParse, validate: markdocValidate } = Markdoc;
    39	
    40	export interface LintDispatchOptions {
    41	  loader: ICardLoader;
    42	  ctx: LoadCardContext;
    43	}
    44	
    45	/**
    46	 * Lint a list of card paths, dispatching each to the appropriate
    47	 * validator based on file shape.
    48	 */
    49	export async function lintCardsDispatch(
    50	  paths: string[],
    51	  options: LintDispatchOptions
    52	): Promise<LintSummary> {
    53	  const results: LintResult[] = [];
    54	  let totalErrors = 0;
    55	  let totalWarnings = 0;
    56	  let filesWithErrors = 0;
    57	
    58	  for (const path of paths) {
    59	    const result = await lintOne(path, options);
    60	    results.push(result);
    61	    totalErrors += result.errors.length;
    62	    totalWarnings += result.warnings.length;
    63	    if (result.errors.length > 0) {
    64	      filesWithErrors++;
    65	    }
    66	  }
    67	
    68	  return {
    69	    results,
    70	    filesChecked: paths.length,
    71	    filesWithErrors,
    72	    totalErrors,
    73	    totalWarnings,
    74	  };
    75	}
    76	
    77	async function lintOne(path: string, options: LintDispatchOptions): Promise<LintResult> {
    78	  let content: string;
    79	  try {
    80	    content = await readFile(path, "utf8");
    81	  } catch (e) {
    82	    return errorResult(path, (e as Error).message);
    83	  }
    84	
    85	  const split = splitCardContent(content);
    86	  if (split.hasFrontmatter) {
    87	    const type = typeFromFilename(path);
    88	    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
    89	      return lintFrontmatterCard({ path, content, options, type });
    90	    }
    91	  }
    92	  return lintCard(options.loader, { path });
    93	}
    94	
    95	async function lintFrontmatterCard(input: {
    96	  path: string;
    97	  content: string;
    98	  options: LintDispatchOptions;
    99	  type: string;
   100	}): Promise<LintResult> {
   101	  const { path, content, options, type } = input;
   102	  let parsed;
   103	  try {
   104	    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
   105	  } catch (e) {
   106	    return errorResult(path, (e as Error).message);
   107	  }
   108	  // Broken refs are surfaced as WARNINGS, not errors. Refs commonly go
   109	  // stale via legitimate operations (the referent got moved, archived,
   110	  // trashed, or hand-deleted), and treating each one as a hard error
   111	  // would have the pre-commit hook blocking every commit on any box
   112	  // with accumulated data drift. Schema validation failures (which come
   113	  // out of parseCardText as a thrown CardIOError → errorResult above)
   114	  // remain errors and do block.
   115	  const frontmatterRefs = extractRefs(parsed.fields);
   116	  const bodyField = parsed.fields["body"];
   117	  const bodyRefs = typeof bodyField === "string" ? extractBodyRefs(bodyField) : [];
   118	  const warnings: LintIssue[] = [];
   119	  for (const { path: refPath, ref } of [...frontmatterRefs, ...bodyRefs]) {
   120	    try {
   121	      const resolved = await options.loader.resolveRef(ref, path);
   122	      if (!resolved.exists) {
   123	        warnings.push({
   124	          type: "reference",
   125	          severity: "warning",
   126	          message: `Broken reference at ${refPath}: ${ref} does not exist`,
   127	        });
   128	      }
   129	    } catch (e) {
   130	      warnings.push({
   131	        type: "reference",
   132	        severity: "warning",
   133	        message: `Reference at ${refPath} failed to resolve: ${(e as Error).message}`,
   134	      });
   135	    }
   136	  }
   137	  const containsWarning = lintContainsLength(parsed.fields);
   138	  if (containsWarning !== null) warnings.push(containsWarning);
   139	  warnings.push(...unknownKeyWarnings({ content, schema: parsed.schema }));
   140	  const errors =
   141	    type === "commentary"
   142	      ? commentaryErrors({ body: typeof bodyField === "string" ? bodyField : "" })
   143	      : type === "extfile"
   144	        ? extfileErrors({ fields: parsed.fields })
   145	        : [];
   146	  return { path, errors, warnings };
   147	}
   148	
   149	/**
   150	 * Cross-field validation for extfile cards that Zod can't express: `href` must
   151	 * be a parseable `file:` URL (the schema only types it as a string), and a
   152	 * present `version` must carry a well-formed `sha256:<hex>` marker (it is
   153	 * compared byte-for-byte against the live file's hash, so a malformed one would
   154	 * never match). Whether the href *resolves* on this machine is deliberately not
   155	 * checked here — that's machine-specific and the renderer/`cb extfile sync`
   156	 * report it at use time.
   157	 */
   158	function extfileErrors(input: { fields: Record<string, unknown> }): LintIssue[] {
   159	  const { fields } = input;
   160	  const errors: LintIssue[] = [];
   161	  const href = fields["href"];
   162	  // A missing href is already a schema (Zod) error from parseCardText; here we
   163	  // only refine a present href's shape.
   164	  if (typeof href === "string" && href !== "" && !isFileUrl(href)) {
   165	    errors.push({
   166	      type: "validation",
   167	      severity: "error",
   168	      message: `extfile href must be a file: URL (got "${href}")`,
   169	    });
   170	  }
   171	  const version = fields["version"];
   172	  if (typeof version === "string" && version !== "" && !hasSha256Marker(version)) {
   173	    errors.push({
   174	      type: "validation",
   175	      severity: "error",
   176	      message: `extfile version must contain a sha256:<hex> marker (got "${version}")`,
   177	    });
   178	  }
   179	  return errors;
   180	}
   181	
   182	function isFileUrl(value: string): boolean {
   183	  try {
   184	    return new URL(value).protocol === "file:";
   185	  } catch (_e) {
   186	    return false;
   187	  }
   188	}
   189	
   190	/** A space-separated marker set containing at least one `sha256:<hex>` token. */
   191	function hasSha256Marker(version: string): boolean {
   192	  return version.split(/\s+/).some((marker) => /^sha256:[\da-f]+$/.test(marker));
   193	}
   194	
   195	/**
   196	 * Frontmatter keys present on disk that the card's schema doesn't declare. The
   197	 * loader strips these in memory (a drifted card still loads, renders, and
   198	 * indexes), so they are surfaced as **warnings** — visible to `cb validate` and
   199	 * the PostToolUse hook — to be cleaned off disk eventually, without blocking
   200	 * commits or breaking load. Allowed keys are the schema's own fields (minus the
   201	 * body field, which lives in the file body, not frontmatter), the injected
   202	 * global fields, and `type`.
   203	 */
   204	function unknownKeyWarnings(input: { content: string; schema: CardSchema }): LintIssue[] {
   205	  const { content, schema } = input;
   206	  const split = splitCardContent(content);
   207	  if (!split.hasFrontmatter) return [];
   208	  let fm: unknown;
   209	  try {
   210	    fm = parseYaml(split.frontmatterText);
   211	  } catch (_e) {
   212	    // Malformed YAML is a separate, error-level failure already surfaced by
   213	    // parseCardText (which threw → errorResult); nothing to add here.
   214	    return [];
   215	  }
   216	  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return [];
   217	  const allowed = new Set<string>(["type", ...schema.globalFieldNames, ...Object.keys(schema.fields)]);
   218	  if (schema.bodyFieldName !== null) allowed.delete(schema.bodyFieldName);
   219	  const warnings: LintIssue[] = [];
   220	  for (const key of Object.keys(fm as Record<string, unknown>)) {
   221	    if (allowed.has(key)) continue;
   222	    warnings.push({
   223	      type: "schema",
   224	      severity: "warning",
   225	      message:
   226	        `Unknown frontmatter key "${key}" — not declared by the ${schema.type} schema; ` +
   227	        "it is ignored on load and should be removed",
   228	    });
   229	  }
   230	  return warnings;
   231	}
   232	
   233	/** Soft budget for the `contains` field — one concise sentence, not a summary essay. */
   234	const CONTAINS_MAX_CHARS = 200;
   235	
   236	function lintContainsLength(fields: Record<string, unknown>): LintIssue | null {
   237	  const contains = fields["contains"];
   238	  if (typeof contains !== "string" || contains.length <= CONTAINS_MAX_CHARS) return null;
   239	  return {
   240	    type: "contains",
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
   121	  return guides;
   122	}
   123	
   124	interface GuideCompileContext {
   125	  boxRoot: string;
   126	  rulesDir: string;
   127	  debug: boolean;
   128	}
   129	
   130	/**
     1	import { z } from "zod";
     2	import * as fs from "node:fs/promises";
     3	import * as path from "node:path";
     4	import { TRPCError } from "@trpc/server";
     5	import { router, publicProcedure } from "../trpc.js";
     6	import { createLoader } from "../../../cli/lib/loader.js";
     7	import { parseCard, splitCardContent, type CardSchema, type ElementNode } from "cardworks";
     8	import { parseCardText } from "../../../core/card-io.js";
     9	import { createCardSchemaMap } from "../../../schemas/registry.js";
    10	import { parse as parseYaml } from "yaml";
    11	
    12	/**
    13	 * JSON-safe element node for the frontend.
    14	 */
    15	export interface JsonElement {
    16	  tagName: string;
    17	  attrs: Record<string, string>;
    18	  text?: string;
    19	  children?: JsonElement[];
    20	}
    21	
    22	function sanitizeElement(el: ElementNode): JsonElement {
    23	  const result: JsonElement = { tagName: el.tagName, attrs: {} };
    24	  for (const [key, value] of Object.entries(el.attrs)) {
    25	    if (typeof value === "string") result.attrs[key] = value;
    26	  }
    27	  if (el.text !== undefined && el.text !== null) {
    28	    result.text = String(el.text).trim();
    29	  }
    30	  if (el.children && Array.isArray(el.children) && el.children.length > 0) {
    31	    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
    32	  }
    33	  return result;
    34	}
    35	
    36	/**
    37	 * Navigate to a child element by a simple path like "section/ingredients/ing[2]".
    38	 */
    39	function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
    40	  const segments = pathStr.split("/").filter(Boolean);
    41	  let current: ElementNode = el;
    42	  for (const seg of segments) {
    43	    const match = seg.match(/^(\w[\w-]*?)(?:\[(\d+)])?$/);
    44	    if (!match) return null;
    45	    const tagName = match[1]!;
    46	    const idx = match[2] !== undefined ? parseInt(match[2], 10) : 0;
    47	    const matches = current.children.filter((c) => c.tagName === tagName);
    48	    if (idx >= matches.length) return null;
    49	    current = matches[idx]!;
    50	  }
    51	  return current;
    52	}
    53	
    54	/**
    55	 * Parse a simple XML fragment into an ElementNode.
    56	 */
    57	function parseXmlFragment(xml: string): ElementNode | null {
    58	  const match = xml.match(/^<(\w[\w-]*)((?:\s+[\w-]+="[^"]*")*)(?:\s*\/>|>([\S\s]*?)<\/\1>)$/);
    59	  if (!match) return null;
    60	  const tagName = match[1]!;
    61	  const attrStr = match[2] ?? "";
    62	  const text = match[3]?.trim();
    63	
    64	  const attrs: Record<string, string> = {};
    65	  const attrRegex = /([\w-]+)="([^"]*)"/g;
    66	  let attrMatch;
    67	  while ((attrMatch = attrRegex.exec(attrStr))) {
    68	    attrs[attrMatch[1]!] = attrMatch[2]!;
    69	  }
    70	
    71	  return {
    72	    tagName,
    73	    attrs,
    74	    children: [],
    75	    text: text || undefined,
    76	    comments: {},
    77	    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    78	    dirty: true,
    79	  } as ElementNode;
    80	}
    81	
    82	function typeFromFilename(source: string): string | undefined {
    83	  const base = source.split("/").pop();
    84	  if (base === undefined) return undefined;
    85	  const match = base.match(/^.+\.([^.]+)\.card$/);
    86	  return match ? match[1] : undefined;
    87	}
    88	
    89	export interface FrontmatterCardResponse {
    90	  path: string;
    91	  kind: "frontmatter";
    92	  tagName: string;
    93	  status: string | undefined;
    94	  version: string | undefined;
    95	  xml: string;
    96	  element: JsonElement | undefined;
    97	  frontmatter: Record<string, unknown> | undefined;
    98	  body: string | undefined;
    99	  validationError: string | undefined;
   100	}
   101	
   102	function loadFrontmatterCard(input: {
   103	  raw: string;
   104	  source: string;
   105	  type: string;
   106	  cardSchemas: Map<string, CardSchema>;
   107	}): FrontmatterCardResponse {
   108	  const { raw, source, type, cardSchemas } = input;
   109	  let frontmatter: Record<string, unknown> | undefined;
   110	  let body: string | undefined;
   111	  let validationError: string | undefined;
   112	  let status: string | undefined;
   113	
   114	  try {
   115	    const parsed = parseCardText(raw, { source, schemas: cardSchemas, type });
   116	    const fields = { ...parsed.fields };
   117	    if (parsed.schema.bodyFieldName !== null) {
   118	      const bodyValue = fields[parsed.schema.bodyFieldName];
   119	      body = typeof bodyValue === "string" ? bodyValue : parsed.rawBody;
   120	      delete fields[parsed.schema.bodyFieldName];
   121	    } else {
   122	      body = parsed.rawBody;
   123	    }
   124	    delete fields["type"];
   125	    frontmatter = fields;
   126	    const statusField = fields["status"];
   127	    if (typeof statusField === "string") status = statusField;
   128	  } catch (e) {
   129	    validationError = (e as Error).message;
   130	    // Still surface what we can — split the file and parse YAML loosely.
   131	    const split = splitCardContent(raw);
   132	    body = split.body;
   133	    try {
   134	      const fm = parseYaml(split.frontmatterText);
   135	      if (fm !== null && typeof fm === "object" && !Array.isArray(fm)) {
   136	        frontmatter = fm as Record<string, unknown>;
   137	        const statusField = (fm as Record<string, unknown>)["status"];
   138	        if (typeof statusField === "string") status = statusField;
   139	      }
   140	    } catch (_e) {
   141	      // YAML itself is malformed — leave frontmatter undefined.
   142	    }
   143	  }
   144	
   145	  return {
   146	    path: source,
   147	    kind: "frontmatter",
   148	    tagName: type,
   149	    status,
   150	    version: undefined,
   151	    xml: raw,
   152	    element: undefined,
   153	    frontmatter,
   154	    body,
   155	    validationError,
   156	  };
   157	}
   158	
   159	const patchOpSchema = z.discriminatedUnion("op", [
   160	  z.object({ op: z.literal("set-attr"), path: z.string().optional(), attr: z.string(), value: z.string() }),
   161	  z.object({ op: z.literal("remove-attr"), path: z.string().optional(), attr: z.string() }),
   162	  z.object({ op: z.literal("set-text"), path: z.string(), value: z.string() }),
   163	  z.object({ op: z.literal("append-child"), path: z.string().optional(), xml: z.string() }),
   164	  z.object({ op: z.literal("remove-child"), path: z.string(), index: z.number() }),
   165	]);
   166	
   167	export const cardRouter = router({
   168	  get: publicProcedure
   169	    .input(z.object({ path: z.string().min(1) }))
   170	    .query(async ({ input, ctx }) => {
   171	      const fullPath = path.join(ctx.boxRoot, input.path);
   172	
   173	      // Security: `input.path` arrives from the client (and now from the chat
   174	      // `?card=` deep-link a card-page click writes). Ensure the resolved path
   175	      // stays inside the box before any read — `path.join` collapses `..`, so a
   176	      // crafted `../../etc/...` would otherwise escape boxRoot. Mirrors the
   177	      // `/api/files` boundary guard (routes/api-files.ts); card.get had none.
   178	      const resolved = path.resolve(fullPath);
   179	      if (!resolved.startsWith(path.resolve(ctx.boxRoot))) {
   180	        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid card path" });
   181	      }
   182	
   183	      // Dispatch on file shape: frontmatter cards parse via parseCardText;
   184	      // legacy XML cards fall through to the cardworks loader.
   185	      let raw: string | null = null;
   186	      try {
   187	        raw = await fs.readFile(fullPath, "utf-8");
   188	      } catch (e) {
   189	        const msg = (e as Error).message;
   190	        if (msg.includes("ENOENT") || msg.includes("no such file")) {
   191	          throw new TRPCError({ code: "NOT_FOUND", message: `Card not found: ${input.path}` });
   192	        }
   193	        throw new TRPCError({ code: "BAD_REQUEST", message: msg });
   194	      }
   195	
   196	      const split = splitCardContent(raw);
   197	      const fileType = typeFromFilename(input.path);
   198	      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
   199	      if (split.hasFrontmatter && fileType !== undefined && cardSchemas.has(fileType)) {
   200	        return loadFrontmatterCard({ raw, source: input.path, type: fileType, cardSchemas });
   201	      }
   202	
   203	      const loader = await createLoader(ctx.boxRoot);
   204	
   205	      try {
   206	        const card = await loader.load(fullPath);
   207	        const xml = loader.serialize(card.element);
   208	        const element = sanitizeElement(card.element);
   209	
   210	        return {
   211	          path: input.path,
   212	          kind: "xml" as const,
   213	          tagName: card.element.tagName,
   214	          status: card.element.attrs["status"] as string | undefined,
   215	          version: card.version,
   216	          xml,
   217	          element,
   218	          frontmatter: undefined as Record<string, unknown> | undefined,
   219	          body: undefined as string | undefined,
   220	          validationError: undefined as string | undefined,
   221	        };
   222	      } catch (error) {
   223	        const msg = (error as Error).message;
   224	        const isNotFound = msg.includes("ENOENT") || msg.includes("no such file");
   225	        if (isNotFound) {
   226	          throw new TRPCError({
   227	            code: "NOT_FOUND",
   228	            message: `Card not found: ${input.path}`,
   229	          });
   230	        }
   231	
   232	        // Validation failed — parse XML without validation so we can still show the tree
   233	        let rawXml: string;
   234	        try {
   235	          rawXml = await fs.readFile(fullPath, "utf-8");
   236	        } catch (e) {
   237	          console.warn(`Could not re-read ${input.path} after validation failure:`, e);
   238	          throw new TRPCError({
   239	            code: "BAD_REQUEST",
   240	            message: `Card validation failed: ${msg}`,
   241	          });
   242	        }
   243	
   244	        // Try to parse the raw XML into a tree (no schema validation)
   245	        let element: JsonElement | undefined;
   246	        let tagName: string | undefined;
   247	        try {
   248	          const parsed = await parseCard(rawXml, { source: input.path });
   249	          element = sanitizeElement(parsed);
   250	          tagName = parsed.tagName;
   251	        } catch (e) {
   252	          // XML itself is malformed — fall back to raw text only.
   253	          console.warn(`Could not parse raw XML for ${input.path}, showing raw text only:`, e);
   254	        }
   255	
   256	        return {
   257	          path: input.path,
   258	          kind: "xml" as const,
   259	          tagName,
   260	          status: undefined as string | undefined,

codex
There are live web/API paths too. `cardRouter.get` still has an XML fallback and `todos.updateItem` is entirely XML/CardLoader-based; removing those may be correct, but the plan needs to call out frontend/API behavior changes and tests, not just “dead path.”
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/trpc/routers/card.ts | sed -n '260,560p' && nl -ba callback-box/src/webapp/trpc/routers/chat.ts | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/commands/move-operations.ts | sed -n '260,460p' && nl -ba callback-box/src/core/commands/move-phase2.ts | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
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
   361	
   362	  return {
   363	    from: relSourcePath,
   364	    to: relDestPath,
   365	    movedFiles: movedFiles.map((f) => ({
   366	      from: path.relative(ctx.boxRoot, f.from),
   367	      to: path.relative(ctx.boxRoot, f.to),
   368	    })),
   369	    updatedCards: [...updatedCards, ...extraUpdated],
   370	    filesToStage,
   371	  };
   372	}
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

 succeeded in 0ms:
   260	          status: undefined as string | undefined,
   261	          version: undefined as string | undefined,
   262	          xml: rawXml,
   263	          element,
   264	          frontmatter: undefined as Record<string, unknown> | undefined,
   265	          body: undefined as string | undefined,
   266	          validationError: msg,
   267	        };
   268	      }
   269	    }),
   270	
   271	  patch: publicProcedure
   272	    .input(z.object({
   273	      path: z.string().min(1),
   274	      ops: z.array(patchOpSchema).min(1),
   275	    }))
   276	    .mutation(async ({ input, ctx }) => {
   277	      const fullPath = path.join(ctx.boxRoot, input.path);
   278	      const loader = await createLoader(ctx.boxRoot);
   279	
   280	      try {
   281	        const card = await loader.load(fullPath);
   282	
   283	        for (const op of input.ops) {
   284	          const target = op.path ? navigateToChild(card.element, op.path) : card.element;
   285	          if (!target) {
   286	            throw new TRPCError({ code: "BAD_REQUEST", message: `Path not found: ${op.path}` });
   287	          }
   288	
   289	          switch (op.op) {
   290	            case "set-attr":
   291	              target.attrs[op.attr] = op.value;
   292	              break;
   293	            case "remove-attr":
   294	              delete target.attrs[op.attr];
   295	              break;
   296	            case "set-text":
   297	              target.text = op.value;
   298	              break;
   299	            case "append-child": {
   300	              const fragment = parseXmlFragment(op.xml);
   301	              if (fragment) target.children.push(fragment);
   302	              break;
   303	            }
   304	            case "remove-child": {
   305	              const idx = op.index;
   306	              if (idx >= 0 && idx < target.children.length) {
   307	                target.children.splice(idx, 1);
   308	              }
   309	              break;
   310	            }
   311	          }
   312	        }
   313	
   314	        await loader.save(card);
   315	
   316	        const updated = await loader.load(fullPath);
   317	        const xml = loader.serialize(updated.element);
   318	        const element = sanitizeElement(updated.element);
   319	
   320	        return {
   321	          path: input.path,
   322	          tagName: updated.element.tagName,
   323	          status: updated.element.attrs["status"] as string | undefined,
   324	          version: updated.version,
   325	          xml,
   326	          element,
   327	        };
   328	      } catch (error) {
   329	        if (error instanceof TRPCError) {
   330	          throw new TRPCError({ code: error.code, message: error.message, cause: error.cause });
   331	        }
   332	        throw new TRPCError({
   333	          code: "BAD_REQUEST",
   334	          message: `Patch failed: ${(error as Error).message}`,
   335	        });
   336	      }
   337	    }),
   338	});
     1	/**
     2	 * tRPC router for chat session metadata — directory associations,
     3	 * lookup helpers, and the landmark-grouped picker. Streaming send +
     4	 * history live as raw Fastify routes (see src/webapp/routes/chat.ts)
     5	 * since they don't fit tRPC's shape.
     6	 */
     7	
     8	import * as fs from "node:fs/promises";
     9	import * as path from "node:path";
    10	import { glob } from "glob";
    11	import { parseCard, type ElementNode } from "cardworks";
    12	import { z } from "zod";
    13	import { router, publicProcedure } from "../trpc.js";
    14	import {
    15	  getDirectoryForSession,
    16	  getLastSessionForDirectory,
    17	  loadHistoryEntries,
    18	  resolveSessionLogPath,
    19	} from "../../../core/chat-session-history.js";
    20	import { nearestLandmarkDir, isBoxRelativeCardPath } from "../../../core/landmark/nearest.js";
    21	import { getSessionMetadata } from "../../../cli/lib/session.js";
    22	
    23	const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    24	
    25	export interface PickerSession {
    26	  sessionId: string;
    27	  label: string;
    28	  lastActivity: string;
    29	}
    30	
    31	export interface PickerLandmark {
    32	  /** Box-relative directory; empty string for the root tile. */
    33	  dir: string;
    34	  label: string;
    35	  symbol: string;
    36	  symbolSrc: string | null;
    37	  /** Sessions touched within the fresh window (last 7 days). */
    38	  sessions: PickerSession[];
    39	  /** Sessions older than the fresh window, same landmark. */
    40	  olderSessions: PickerSession[];
    41	}
    42	
    43	function findNavigation(element: ElementNode): ElementNode | null {
    44	  for (const child of element.children) {
    45	    if (child.tagName === "navigation") return child;
    46	  }
    47	  return null;
    48	}
    49	
    50	function readChildText(navigation: ElementNode | null, tagName: string): string {
    51	  if (!navigation) return "";
    52	  for (const child of navigation.children) {
    53	    if (child.tagName === tagName && typeof child.text === "string") {
    54	      return child.text.trim();
    55	    }
    56	  }
    57	  return "";
    58	}
    59	
    60	function readSymbol(
    61	  navigation: ElementNode | null,
    62	  { landmarkDir, boxRoot }: { landmarkDir: string; boxRoot: string },
    63	): { text: string; src: string | null } {
    64	  if (!navigation) return { text: "", src: null };
    65	  for (const child of navigation.children) {
    66	    if (child.tagName !== "symbol") continue;
    67	    const rawSrc = child.attrs["src"];
    68	    let src: string | null = null;
    69	    if (typeof rawSrc === "string" && rawSrc !== "") {
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
   126	    return a.dir.localeCompare(b.dir);
   127	  });
   128	  return out;
   129	}
   130	
   131	interface SessionRow {
   132	  sessionId: string;
   133	  /** "" for root-bound, undefined for legacy unbound (treated as root). */
   134	  contextDir: string | undefined;
   135	  mtime: Date;
   136	  label: string;
   137	}
   138	
   139	async function loadAllSessions(
   140	  boxRoot: string,
   141	): Promise<SessionRow[]> {
   142	  const entries = await loadHistoryEntries(boxRoot);
   143	  const rows: SessionRow[] = [];
   144	  for (const entry of entries) {
   145	    let logPath: string;
   146	    try {
   147	      logPath = await resolveSessionLogPath(boxRoot, entry.id);
   148	    } catch (e) {
   149	      console.warn(`Skipping session ${entry.id}: cannot resolve log path:`, e);
   150	      continue;
   151	    }
   152	    let mtime: Date;
   153	    try {
   154	      const stat = await fs.stat(logPath);
   155	      mtime = stat.mtime;
   156	    } catch (_e) {
   157	      // log missing — session was cleaned up; nothing actionable, skip it
   158	      continue;
   159	    }
   160	
   161	    let label = entry.id.slice(0, 8);
   162	    try {
   163	      const meta = await getSessionMetadata({ sessionId: entry.id, logPath, snippetMaxLen: 400 });
   164	      if (meta.firstUserSnippet) label = meta.firstUserSnippet;
   165	    } catch (e) {
   166	      console.warn(`Could not read metadata for session ${entry.id}, using id-prefix label:`, e);
   167	      // keep the id-prefix fallback
   168	    }
   169	
   170	    rows.push({
   171	      sessionId: entry.id,
   172	      contextDir: entry.contextDir,
   173	      mtime,
   174	      label,
   175	    });
   176	  }
   177	  rows.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
   178	  return rows;
   179	}
   180	
   181	export const chatRouter = router({
   182	  /**
   183	   * Most-recently-created session associated with a directory, or null
   184	   * if no chat has been started for that directory.
   185	   */
   186	  lastSessionForDirectory: publicProcedure
   187	    .input(z.object({ contextDir: z.string() }))
   188	    .query(async ({ ctx, input }) => {
   189	      const sessionId = await getLastSessionForDirectory(ctx.boxRoot, input.contextDir);
   190	      return { sessionId };
   191	    }),
   192	
   193	  /**
   194	   * Resolve where a "chat about this card" click should land: the nearest
   195	   * enclosing landmark directory for the card, plus the most-recent session
   196	   * already bound to it (null when none exists, so the caller starts a new
   197	   * one). The card path is validated here — it flows into `?card=` and thence
   198	   * `card.get`, so reject anything that could escape the box.
   199	   */
   200	  openForCard: publicProcedure
   201	    .input(
   202	      z.object({
   203	        cardPath: z
   204	          .string()
   205	          .min(1)
   206	          .refine(isBoxRelativeCardPath, "card path must be box-relative and contain no '..' segments"),
   207	      }),
   208	    )
   209	    .query(async ({ ctx, input }): Promise<{ contextDir: string; sessionId: string | null }> => {
   210	      const contextDir = await nearestLandmarkDir(ctx.boxRoot, { cardPath: input.cardPath });
   211	      const sessionId = await getLastSessionForDirectory(ctx.boxRoot, contextDir);
   212	      return { contextDir, sessionId };
   213	    }),
   214	
   215	  /**
   216	   * Directory a session is associated with, or null if it isn't.
   217	   */
   218	  directoryFor: publicProcedure
   219	    .input(z.object({ sessionId: z.string().min(1) }))
   220	    .query(async ({ ctx, input }) => {

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/preactions/transcribe.ts | sed -n '1,240p' && nl -ba callback-box/src/core/reactor/procedure-trampoline.ts | sed -n '1,180p' && nl -ba callback-box/src/core/file-summary.ts | sed -n '1,180p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
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
     1	/**
     2	 * Procedure trampoline — detects and executes procedure jobs.
     3	 *
     4	 * Some job cards contain a `<procedure ref="...">` element instead of
     5	 * work for the agent. These are "trampolined" — the reactor detects
     6	 * them, runs the procedure engine directly (no agent needed), and
     7	 * finishes the job. This avoids wasting an agent session on what is
     8	 * essentially a function call.
     9	 */
    10	
    11	import { parseCard, type ElementNode } from "cardworks";
    12	import { startProcedure } from "../procedure/engine.js";
    13	import { finishJob } from "../finish-job.js";
    14	import { fmt } from "../../cli/lib/format.js";
    15	import type { CommandContext } from "../command-runner.js";
    16	import type { JobWithContent, ProcedureJobInfo } from "./types.js";
    17	
    18	/**
    19	 * Detect if a job card contains a `<procedure ref="...">` element.
    20	 * If so, return the ref and optional directive text.
    21	 */
    22	export async function detectProcedureInJob(content: string, filePath: string): Promise<ProcedureJobInfo | null> {
    23	  try {
    24	    const root = await parseCard(content, { source: filePath });
    25	    for (const child of root.children as ElementNode[]) {
    26	      if (child.tagName === "procedure" && child.attrs["ref"]) {
    27	        let directive: string | undefined;
    28	        for (const grandchild of (child.children ?? []) as ElementNode[]) {
    29	          if (grandchild.tagName === "directive") {
    30	            directive = grandchild.text?.trim();
    31	          }
    32	        }
    33	        return { procedureRef: child.attrs["ref"], ...(directive && { directive }) };
    34	      }
    35	    }
    36	  } catch (_e) {
    37	    // Expected for non-XML job cards: unparseable means "not a procedure job".
    38	    // Detection probe, not an error path — fall through to return null.
    39	  }
    40	  return null;
    41	}
    42	
    43	interface ProcessProcedureJobsOptions {
    44	  procedureJobs: JobWithContent[];
    45	  boxRoot: string;
    46	  dryRun: boolean;
    47	  onLog?: ((text: string) => void) | undefined;
    48	}
    49	
    50	/**
    51	 * Process procedure jobs by running the procedure engine directly.
    52	 * Returns the number of successfully completed procedure jobs.
    53	 */
    54	export async function processProcedureJobs(opts: ProcessProcedureJobsOptions): Promise<number> {
    55	  const { procedureJobs, boxRoot, dryRun, onLog } = opts;
    56	  onLog?.(fmt.header(`\nProcessing ${procedureJobs.length} procedure job(s):\n`));
    57	
    58	  const ctx: CommandContext = {
    59	    boxRoot,
    60	    write: (text: string) => onLog?.(text),
    61	    writeLine: (text: string) => onLog?.(text + "\n"),
    62	  };
    63	
    64	  let completed = 0;
    65	
    66	  for (const job of procedureJobs) {
    67	    const info = job.procedureInfo!;
    68	    onLog?.(`  ${fmt.strong(info.procedureRef)}${info.directive ? ` (directive: ${info.directive})` : ""}\n`);
    69	
    70	    if (dryRun) {
    71	      onLog?.(fmt.dim(`  [DRY RUN] Would run procedure: ${info.procedureRef}\n`));
    72	      continue;
    73	    }
    74	
    75	    const result = await startProcedure({
    76	      ctx,
    77	      procedureNameOrPath: info.procedureRef,
    78	      options: { ...(info.directive && { directive: info.directive }) },
    79	    });
    80	
    81	    if (result.success) {
    82	      await finishJob({ boxRoot, jobRelPath: job.relPath });
    83	      onLog?.(fmt.ok(`Finished procedure job: ${job.relPath}\n`));
    84	      completed++;
    85	    } else {
    86	      onLog?.(fmt.fail(`Procedure failed for ${job.relPath}: ${result.error ?? "unknown"}\n`));
    87	    }
    88	  }
    89	
    90	  return completed;
    91	}
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
A second architecture issue is emerging: some “dead” XML branches are wrapped in mixed-format abstractions (`PreActionContext`, `LoadedCard`, file summaries). Deleting them is feasible, but it is a data model cleanup across callers, not just import removal; typecheck will find many, but it will not tell you whether the replacement behavior is acceptable.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/box-templates.ts | sed -n '1,180p' && nl -ba callback-box/test/box-schemas.doctest.md | sed -n '1,140p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/preactions/types.ts | sed -n '1,180p' && nl -ba callback-box/src/core/preactions/index.ts | sed -n '1,260p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Static scaffold files installed into a box on init.
     3	 *
     4	 * These are the box-local guide/scaffold documents whose content is a large
     5	 * embedded string (tricks scaffolding, the schemas authoring guide, the views
     6	 * authoring guide). The tricks and views installers are "create if missing"
     7	 * no-ops on re-run; the schemas guide goes through the template tracker
     8	 * (refresh-if-unmodified, park-if-edited) so its frontmatter-first rewrite
     9	 * reaches boxes that still carry the old XML-only version. Either way, `cb
    10	 * init` can run repeatedly without clobbering user edits.
    11	 */
    12	
    13	import * as fs from "node:fs/promises";
    14	import * as path from "node:path";
    15	import { installTemplateFile } from "./install-template-file.js";
    16	
    17	const SCHEMAS_CLAUDE_MD = `# Writing Box-Local Schemas
    18	
    19	Box-local schemas let you define new card types inside your box. Each schema is a \`.ts\` file
    20	in \`config/schemas/\` that uses the same tools as built-in schemas.
    21	
    22	**Default to the frontmatter form** (\`cardSchema\`) shown below: it produces standard cards —
    23	YAML frontmatter plus a markdown body. Reach for the legacy \`element()\` / XML form only when
    24	your card needs Markdoc-shaped inline content (see the end of this guide).
    25	
    26	## Creating a Schema
    27	
    28	Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:
    29	
    30	\`\`\`typescript
    31	import { body, cardSchema } from "cardworks";
    32	import { z } from "zod";
    33	
    34	export default cardSchema("my-type", {
    35	  fields: {
    36	    status: z.enum(["draft", "final"]).default("draft"),
    37	    priority: z.enum(["low", "medium", "high"]).optional(),
    38	    body: body(z.string()),  // omit this line if the card has no prose body
    39	  },
    40	  instructions: \\\`# My Type Cards
    41	
    42	Instructions for the agent on how to handle this card type.
    43	These appear in .claude/rules/ and docs/generated/, and are loaded
    44	when the agent reads or edits a matching card file.\\\`,
    45	});
    46	\`\`\`
    47	
    48	The filename becomes the card type: \`config/schemas/task.ts\` → \`*.task.card\` files.
    49	
    50	On disk, a card of this type is YAML frontmatter + markdown body:
    51	
    52	\`\`\`
    53	---
    54	status: draft
    55	priority: high
    56	---
    57	The markdown body (present only when the schema declares a \`body\` field).
    58	\`\`\`
    59	
    60	Key patterns:
    61	- \`cardSchema(type, { fields, instructions? })\` is the entry point. \`fields\` is a flat object
    62	  of Zod validators; nest with \`z.object\` / \`z.array\` as needed.
    63	- \`body(z.string())\` declares the markdown body field — it must be named \`body\`. Omit it for a
    64	  body-less card (then any non-empty body errors on load).
    65	- \`type\` is the discriminator; don't list it under \`fields\`, and the on-disk YAML needn't carry
    66	  it — the filename \`Foo.<type>.card\` supplies it.
    67	- \`title\` and \`contains\` are available on every card type automatically.
    68	
    69	## Available Imports
    70	
    71	From \`cardworks\`:
    72	- \`cardSchema(type, config)\` — define a frontmatter card schema (the default)
    73	- \`body(zodSchema)\` — declare the single markdown body field
    74	- \`element(tagName, config)\` — define a legacy XML schema (see below)
    75	- \`escapeText(str)\` / \`escapeAttr(str)\` — XML-escape helpers (only for \`element()\` schemas)
    76	
    77	From \`zod\`:
    78	- \`z\` — Zod schema builder (z.string(), z.enum(), z.array(), etc.)
    79	
    80	## Optional: Templates
    81	
    82	Export a \`template\` to enable \`cb create\` for your card type. For frontmatter schemas,
    83	\`generate\` returns the card text — a YAML frontmatter block built with \`stringify\` from \`yaml\`:
    84	
    85	\`\`\`typescript
    86	import { cardSchema } from "cardworks";
    87	import { stringify as stringifyYaml } from "yaml";
    88	import { z } from "zod";
    89	
    90	export const template = {
    91	  name: "task",
    92	  description: "A task card",
    93	  argsSchema: z.object({
    94	    title: z.string().describe("Task title"),
    95	    priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level"),
    96	  }),
    97	  generate: (args: { title: string; priority?: string }) => {
    98	    const fields: Record<string, unknown> = { status: "todo", title: args.title };
    99	    if (args.priority !== undefined) fields.priority = args.priority;
   100	    return "---\\n" + stringifyYaml(fields) + "---\\n";
   101	  },
   102	  cardTypes: ["task"],
   103	  defaultForTypes: ["task"],
   104	};
   105	
   106	export default cardSchema("task", {
   107	  // ... schema definition
   108	});
   109	\`\`\`
   110	
   111	## After Adding or Modifying Schemas
   112	
   113	Run \`cb init\` to regenerate rules and documentation:
   114	
   115	\`\`\`bash
   116	cb init .
   117	\`\`\`
   118	
   119	This will:
   120	- Generate \`.claude/rules/card-<type>.md\` (if the schema has \`instructions\`)
   121	- Generate \`docs/generated/card-<type>.md\`
   122	- Register any templates for \`cb create\`
   123	
   124	Schema changes are picked up on the next \`cb\` invocation; a running dev server needs a restart.
   125	
   126	## Legacy: XML / \`element()\` schemas
   127	
   128	Use \`element()\` only when the card body is Markdoc-shaped inline content — nested, attributed
   129	inline structure that doesn't fit YAML frontmatter. This is why the built-in \`guide\` and
   130	\`capture-session\` types still use it. For everything else, prefer \`cardSchema\` above.
   131	
   132	\`\`\`typescript
   133	import { element } from "cardworks";
   134	import { z } from "zod";
   135	
   136	export default element("note", {
   137	  attrs: {
   138	    status: z.enum(["draft", "final"]).default("draft"),
   139	  },
   140	  children: z.array(z.unknown()),
   141	  instructions: \\\`# Note Cards
   142	
   143	Instructions for the agent on how to handle this card type.\\\`,
   144	});
   145	\`\`\`
   146	
   147	A legacy template's \`generate\` emits XML instead of YAML, using \`escapeText\` / \`escapeAttr\` for
   148	interpolated values. See the built-in XML schemas in callback-box's \`src/schemas/\` for examples.
   149	
   150	## Tips
   151	
   152	- Keep schema files focused — one card type per file
   153	- Always include \`instructions\` so the agent knows how to handle the card type
   154	- Test with \`cb validate\` after creating cards of the new type
   155	`;
   156	
   157	const TRICKS_PACKAGE_JSON = JSON.stringify(
   158	  {
   159	    name: "tricks",
   160	    private: true,
   161	    type: "module",
   162	  },
   163	  null,
   164	  2
   165	) + "\n";
   166	
   167	const TRICKS_CLAUDE_MD = `# Writing Tricks
   168	
   169	Tricks are custom TypeScript scripts that extend your box's capabilities.
   170	Each trick runs as a standalone subprocess via tsx with its own package context,
   171	so you can install and import npm packages.
   172	
   173	## Structure
   174	
   175	Each trick is a directory under \`tricks/scripts/\` with an \`index.ts\` entry point:
   176	
   177	\`\`\`
   178	tricks/
   179	  package.json        <- npm dependencies for tricks
   180	  node_modules/       <- installed packages (gitignored)
     1	# Box-Local Schemas
     2	
     3	Boxes define their own card types under `config/schemas/*.ts`. Each file default-exports
     4	either a frontmatter `cardSchema()` (the default for new types) or a legacy XML `element()`
     5	schema. `loadBoxSchemas` discovers both, segregating them by format; box frontmatter schemas
     6	become first-class in the same parse/validate path as built-in ones.
     7	
     8	```ts setup
     9	import * as fs from "node:fs/promises";
    10	import * as path from "node:path";
    11	import * as os from "node:os";
    12	import { initBox } from "../src/core/box.js";
    13	import { loadBoxSchemas, createCardSchemaMap } from "../src/schemas/registry.js";
    14	import { buildLoadContext } from "../src/core/load-context.js";
    15	import { loadCardFromText } from "../src/core/card-io.js";
    16	
    17	async function makeTmpBox() {
    18	  const box = await fs.mkdtemp(path.join(os.tmpdir(), "cb-boxschemas-"));
    19	  await initBox(box, { skipGit: true });
    20	  return box;
    21	}
    22	
    23	// Returns the error class name when a card fails to load, or "no-error".
    24	async function loadErrorName(content, source, ctx) {
    25	  try {
    26	    await loadCardFromText({ content, source, ctx });
    27	    return "no-error";
    28	  } catch (e) {
    29	    return e.constructor.name;
    30	  }
    31	}
    32	
    33	// A frontmatter card type: config in YAML + a markdown body.
    34	const WIDGET_SCHEMA = `import { body, cardSchema } from "cardworks";
    35	import { z } from "zod";
    36	
    37	export default cardSchema("widget", {
    38	  fields: {
    39	    status: z.enum(["new", "done"]).default("new"),
    40	    size: z.number(),
    41	    body: body(z.string()),
    42	  },
    43	  instructions: "# Widget Cards\\n\\nA box-local frontmatter card type.",
    44	});
    45	`;
    46	
    47	// A legacy XML card type, to prove both formats coexist.
    48	const GADGET_SCHEMA = `import { element } from "cardworks";
    49	import { z } from "zod";
    50	
    51	export default element("gadget", {
    52	  attrs: {
    53	    status: z.enum(["on", "off"]).default("off"),
    54	  },
    55	  children: z.array(z.unknown()),
    56	});
    57	`;
    58	
    59	const WIDGET_CARD = `---
    60	size: 3
    61	---
    62	Hello widget body.
    63	`;
    64	
    65	const GADGET_CARD = `<gadget status="on"></gadget>`;
    66	```
    67	
    68	## Loading segregates frontmatter from XML
    69	
    70	Both schema files must exist before the first `loadBoxSchemas` call (results are cached per
    71	box). The loader segregates them: the `cardSchema()` lands in `cardSchemas`, the `element()`
    72	in `elementSchemas`:
    73	
    74	```
    75	const box = await makeTmpBox();
    76	await fs.writeFile(path.join(box, "config/schemas/widget.ts"), WIDGET_SCHEMA);
    77	await fs.writeFile(path.join(box, "config/schemas/gadget.ts"), GADGET_SCHEMA);
    78	
    79	const loaded = await loadBoxSchemas(box);
    80	[loaded.cardSchemas.length, loaded.elementSchemas.length, loaded.cardSchemas[0].type, loaded.elementSchemas[0].tagName].join("|")
    81	=> 1|1|widget|gadget
    82	```
    83	
    84	## Box frontmatter cards load and validate
    85	
    86	`buildLoadContext` merges box frontmatter schemas into the same map built-in cards use, so a
    87	`widget` card parses as the new format with its YAML fields and markdown body:
    88	
    89	``` continue
    90	const ctx = await buildLoadContext(box);
    91	const card = await loadCardFromText({ content: WIDGET_CARD, source: "My.widget.card", ctx });
    92	[card.kind, card.schema.type, card.fields.size, card.fields.status, card.fields.body].join("|")
    93	=> frontmatter|widget|3|new|Hello widget body.
    94	```
    95	
    96	Validation rejects a malformed card — `size` must be a number:
    97	
    98	``` continue
    99	const bad = "---\nsize: not-a-number\n---\n";
   100	await loadErrorName(bad, "X.widget.card", ctx)
   101	=> CardIOError
   102	```
   103	
   104	The legacy XML `gadget` card still loads through the same context:
   105	
   106	``` continue
   107	const gadget = await loadCardFromText({ content: GADGET_CARD, source: "G.gadget.card", ctx });
   108	[gadget.kind, gadget.element.tagName].join("|")
   109	=> xml|gadget
   110	```
   111	
   112	## The box type is a first-class entry in the card-schema map
   113	
   114	`createCardSchemaMap(boxRoot)` includes box frontmatter types alongside the built-ins:
   115	
   116	``` continue
   117	const map = await createCardSchemaMap(box);
   118	map.has("widget")
   119	=> true
   120	```
   121	
   122	``` cleanup
   123	await fs.rm(box, { recursive: true, force: true });
   124	```

 succeeded in 0ms:
     1	import type { Card, ICardLoader, CardSchema } from "cardworks";
     2	
     3	/**
     4	 * Context for a pre-action invocation. Exactly one of `xml` or
     5	 * `frontmatter` is present, depending on whether the card was loaded
     6	 * via cardworks's XML loader (Phase 1) or via the frontmatter card-io
     7	 * dispatcher (Phase 2).
     8	 */
     9	export type PreActionContext = PreActionContextBase &
    10	  ({ xml: { card: Card } } | { frontmatter: PreActionFrontmatter });
    11	
    12	export interface PreActionFrontmatter {
    13	  schema: CardSchema;
    14	  fields: Record<string, unknown>;
    15	}
    16	
    17	interface PreActionContextBase {
    18	  boxRoot: string;
    19	  loader: ICardLoader;
    20	  cardPath: string;
    21	  cardType: string;
    22	}
    23	
    24	export interface PreActionResult {
    25	  modified: boolean;
    26	  message?: string;
    27	  error?: string;
    28	}
    29	
    30	export interface PreAction {
    31	  /** Unique name for this pre-action */
    32	  name: string;
    33	
    34	  /** Card types this pre-action applies to */
    35	  appliesTo: string[];
    36	
    37	  /**
    38	   * Check if this pre-action needs to run for the given card.
    39	   * Return true if the pre-action should run.
    40	   */
    41	  shouldRun(context: PreActionContext): Promise<boolean>;
    42	
    43	  /**
    44	   * Execute the pre-action. Implementations branch on
    45	   * `"xml" in context` vs `"frontmatter" in context` to mutate the
    46	   * right shape. The runner persists the result.
    47	   */
    48	  execute(context: PreActionContext): Promise<PreActionResult>;
    49	}
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
/opt/homebrew/bin/bash -lc "find callback-box -path '*/.claude/skills/*' -prune -o -path '*/node_modules/*' -prune -o -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.md' \\) -print | xargs rg -n \"from ['\\\"]cardworks['\\\"]|require\\(['\\\"]cardworks['\\\"]\\)|import\\(['\\\"]cardworks['\\\"]\\)|\\bCardLoader\\b|\\bparseCard\\b|\\bElementSchema\\b|\\bElementNode\\b|evaluateXPathString|lintCard\\b|MemoryCardLoader|ICardLoader|CardLoaderOptions\"" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/schemas/feedback.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/briefing.tsx:19:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:25:> import { element } from "cardworks";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:277:> import { element, escapeText } from "cardworks";
callback-box/src/schemas/intake-job.tsx:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/todo-list.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/image.tsx:13:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/personality.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/question.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-outbound.tsx:34:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/file.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/landmark.ts:27:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-message.tsx:30:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/person.tsx:11:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/registry.ts:5: * by the CardLoader factory. Box-local schemas from config/schemas/
callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/registry.ts:55:export const schemas: ElementSchema[] = [];
callback-box/src/schemas/registry.ts:169:  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
callback-box/src/schemas/registry.ts:170:  elementSchemas: ElementSchema[];
callback-box/src/schemas/registry.ts:221:  const loadedElement: ElementSchema[] = [];
callback-box/src/schemas/registry.ts:235:      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
callback-box/src/schemas/registry.ts:236:      // Zod type carrying `.tagName`; check it first, because ElementSchema also
callback-box/src/schemas/registry.ts:260:function isElementSchema(def: unknown): def is ElementSchema {
callback-box/src/schemas/registry.ts:261:  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
callback-box/src/schemas/registry.ts:297:export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
callback-box/src/schemas/gdoc.tsx:18:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/record.tsx:12:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/capture-session.tsx:15:import { splitCardContent, body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/guide-elements.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/doc.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/recipe.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/chat-thread.ts:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/commentary.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/calendar-review-job.tsx:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/procedure-run.ts:8:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/memo.ts:9:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/webpage.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/guide-parse.tsx:10:import { splitCardContent } from "cardworks";
callback-box/src/schemas/extfile.tsx:16:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/audio.tsx:12:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/procedure.ts:11:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/chat-job.ts:10:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-thread.tsx:29:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/question-followup-job.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/telegram-message.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/scheduled-script.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/cli/commands/validate.ts:10:import { formatLintResults, type LintSummary } from "cardworks";
callback-box/src/schemas/sheet.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/cli/lib/loader.ts:2: * CardLoader factory for callback box.
callback-box/src/cli/lib/loader.ts:4: * Creates a configured CardLoader instance with all known schemas.
callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/src/cli/lib/loader.ts:18: * Create a CardLoader for the given box root.
callback-box/src/cli/lib/loader.ts:24: * @returns A configured CardLoader
callback-box/src/cli/lib/loader.ts:29:): Promise<CardLoader> {
callback-box/src/cli/lib/loader.ts:31:  const loaderOptions: CardLoaderOptions = {
callback-box/src/cli/lib/loader.ts:37:  return new CardLoader(boxRoot, loaderOptions);
callback-box/src/cli/lib/loader.ts:50: * Create an in-memory CardLoader for testing.
callback-box/src/cli/lib/loader.ts:53: * @returns A configured MemoryCardLoader
callback-box/src/cli/lib/loader.ts:57:): Promise<MemoryCardLoader> {
callback-box/src/cli/lib/loader.ts:61:  return new MemoryCardLoader(projectRoot, {
callback-box/src/cli/lib/loader.ts:69:// Re-export CardLoader types for convenience
callback-box/src/cli/lib/loader.ts:70:export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/src/cli/lib/loader.ts:71:export type { ICardLoader, CardLoaderOptions } from "cardworks";
callback-box/src/webapp/routes/api-card-patch.ts:12:import type { ElementNode } from "cardworks";
callback-box/src/webapp/routes/api-card-patch.ts:25:export function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
callback-box/src/webapp/routes/api-card-patch.ts:27:  let current: ElementNode = el;
callback-box/src/webapp/routes/api-card-patch.ts:41: * Parse a simple XML fragment like `<tag attr="val">text</tag>` into an ElementNode.
callback-box/src/webapp/routes/api-card-patch.ts:44:export function parseXmlFragment(xml: string): ElementNode | null {
callback-box/src/webapp/routes/api-card-patch.ts:66:  } as ElementNode;
callback-box/src/webapp/routes/api-card-patch.ts:80: * Convert an ElementNode to a JSON-safe structure.
callback-box/src/webapp/routes/api-card-patch.ts:82:export function sanitizeElement(el: ElementNode): JsonElement {
callback-box/src/webapp/routes/api-card-patch.ts:102:    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/src/webapp/trpc/routers/scheduler.ts:10:import { splitCardContent } from "cardworks";
callback-box/src/webapp/routes/views.ts:21:import type { ElementNode } from "cardworks";
callback-box/src/webapp/routes/views.ts:28:function elementToViewCardChild(el: ElementNode): ViewCardChild {
callback-box/src/webapp/routes/views.ts:38:      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
callback-box/src/webapp/routes/views.ts:187:      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
callback-box/src/webapp/trpc/routers/card.ts:7:import { parseCard, splitCardContent, type CardSchema, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/card.ts:22:function sanitizeElement(el: ElementNode): JsonElement {
callback-box/src/webapp/trpc/routers/card.ts:31:    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/src/webapp/trpc/routers/card.ts:39:function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
callback-box/src/webapp/trpc/routers/card.ts:41:  let current: ElementNode = el;
callback-box/src/webapp/trpc/routers/card.ts:55: * Parse a simple XML fragment into an ElementNode.
callback-box/src/webapp/trpc/routers/card.ts:57:function parseXmlFragment(xml: string): ElementNode | null {
callback-box/src/webapp/trpc/routers/card.ts:79:  } as ElementNode;
callback-box/src/webapp/trpc/routers/card.ts:248:          const parsed = await parseCard(rawXml, { source: input.path });
callback-box/src/webapp/trpc/routers/todos.ts:9:import { CardLoader, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/todos.ts:22:      const loader = new CardLoader(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/todos.ts:35:      function updateInChildren(children: ElementNode[]): boolean {
callback-box/src/webapp/trpc/routers/todos.ts:47:            if (updateInChildren(child.children as ElementNode[])) return true;
callback-box/src/webapp/trpc/routers/todos.ts:53:      const found = updateInChildren((card.element.children ?? []) as ElementNode[]);
callback-box/src/webapp/trpc/routers/chat.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/webapp/trpc/routers/chat.ts:43:function findNavigation(element: ElementNode): ElementNode | null {
callback-box/src/webapp/trpc/routers/chat.ts:50:function readChildText(navigation: ElementNode | null, tagName: string): string {
callback-box/src/webapp/trpc/routers/chat.ts:61:  navigation: ElementNode | null,
callback-box/src/webapp/trpc/routers/chat.ts:100:    let element: ElementNode;
callback-box/src/webapp/trpc/routers/chat.ts:103:      element = await parseCard(content, { source: absPath });
callback-box/src/frontend/src/components/TodoListView.tsx:14:import type { ElementNode } from "../api";
callback-box/src/frontend/src/components/TodoListView.tsx:31:function parseItem(el: ElementNode): TodoItemInfo {
callback-box/src/frontend/src/components/TodoListView.tsx:58:function parseTodoList(element: ElementNode): TodoListInfo {
callback-box/src/frontend/src/components/CardTreeView.tsx:25:export interface ElementNode {
callback-box/src/frontend/src/components/CardTreeView.tsx:29:  children?: ElementNode[];
callback-box/src/frontend/src/components/CardTreeView.tsx:33:  element: ElementNode;
callback-box/src/frontend/src/components/CardTreeView.tsx:135:  data: { element?: ElementNode; path: string; tagName?: string; xml?: string; version?: string; status?: string };
callback-box/src/frontend/src/components/CardTreeView.tsx:284:  element: ElementNode;
callback-box/src/frontend/src/components/CommitDetail-diff.ts:6:import type { ElementNode } from "./CardTreeView";
callback-box/src/frontend/src/components/CommitDetail-diff.ts:127:function domToElementNode(el: Element): ElementNode {
callback-box/src/frontend/src/components/CommitDetail-diff.ts:133:  const children: ElementNode[] = [];
callback-box/src/frontend/src/components/CommitDetail-diff.ts:155:export function parseXmlToElementNode(xml: string): ElementNode | null {
callback-box/src/frontend/src/api.ts:65:export interface ElementNode {
callback-box/src/frontend/src/api.ts:69:  children?: ElementNode[];
callback-box/src/frontend/src/renderers/sheet.tsx:8:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/sheet.tsx:29:function parseSheetElement(el: ElementNode): ParsedSheet {
callback-box/src/frontend/src/renderers/index.ts:8:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/index.ts:18:  element?: ElementNode;
callback-box/src/core/reactor/procedure-trampoline.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/core/reactor/procedure-trampoline.ts:24:    const root = await parseCard(content, { source: filePath });
callback-box/src/core/reactor/procedure-trampoline.ts:25:    for (const child of root.children as ElementNode[]) {
callback-box/src/core/reactor/procedure-trampoline.ts:28:        for (const grandchild of (child.children ?? []) as ElementNode[]) {
callback-box/src/core/commands/ls.ts:11:import { type ElementNode, parseCard, evaluateXPathString } from "cardworks";
callback-box/src/core/commands/ls.ts:72:function applyTemplate(template: string, rootNode: ElementNode): string {
callback-box/src/core/commands/ls.ts:74:    return evaluateXPathString(expr, rootNode);
callback-box/src/core/commands/ls.ts:117:      const root = await parseCard(content, { source: filePath });
callback-box/src/core/commands/answer.ts:10:import { splitCardContent } from "cardworks";
callback-box/src/core/commands/move-operations.ts:16:import { CardLoader } from "cardworks";
callback-box/src/core/commands/move-operations.ts:104:  const loader = new CardLoader(ctx.boxRoot);
callback-box/src/core/commands/move-operations.ts:162:  loader: CardLoader;
callback-box/src/core/commands/move-operations.ts:203:  loader: CardLoader;
callback-box/src/core/commands/move-operations.ts:320:  const loader = new CardLoader(ctx.boxRoot);
callback-box/src/core/commands/assemble-timeline-helpers.ts:5:import { splitCardContent } from "cardworks";
callback-box/src/core/search/contains-update.ts:11:import { splitCardContent } from "cardworks";
callback-box/src/core/card-io.ts:23:  parseCard,
callback-box/src/core/card-io.ts:25:  type ElementSchema,
callback-box/src/core/card-io.ts:26:  type ElementNode,
callback-box/src/core/card-io.ts:27:} from "cardworks";
callback-box/src/core/card-io.ts:298:  readonly schema: ElementSchema | undefined;
callback-box/src/core/card-io.ts:299:  readonly element: ElementNode;
callback-box/src/core/card-io.ts:305:  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
callback-box/src/core/card-io.ts:306:  elementSchemas: Map<string, ElementSchema>;
callback-box/src/core/card-io.ts:316: *   tag's ElementSchema (if any) is used for validation.
callback-box/src/core/card-io.ts:376:  const element = await parseCard(content, { source });
callback-box/src/core/search/refresh-file.ts:10:import { ParseError } from "cardworks";
callback-box/src/core/generate-docs.ts:343:    // Per-schema generated docs cover both legacy XML schemas (ElementSchema
callback-box/src/frontend/src/renderers/image.tsx:18:import type { ElementNode } from "../api";
callback-box/src/frontend/src/renderers/image.tsx:36:function parseImageCard(element: ElementNode): ParsedImageCard {
callback-box/src/frontend/src/renderers/image.tsx:37:  const children = (element.children || []) as ElementNode[];
callback-box/src/frontend/src/renderers/image.tsx:74:  const card = parseImageCard(data.element as ElementNode);
callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/index.ts:50:  allSchemas?: ElementSchema[];
callback-box/src/core/search/extract.ts:19:import type { ElementNode } from "cardworks";
callback-box/src/core/search/extract.ts:290:function collectElementText(node: ElementNode): string {
callback-box/src/core/search/extract.ts:292:  const visit = (n: ElementNode): void => {
callback-box/src/core/search/extract.ts:308:function isElementNode(value: unknown): value is ElementNode {
callback-box/src/core/card-lint.ts:7: * else falls through to cardworks' existing XML lintCard. Results are
callback-box/src/core/card-lint.ts:19:  lintCard,
callback-box/src/core/card-lint.ts:25:  type ICardLoader,
callback-box/src/core/card-lint.ts:27:} from "cardworks";
callback-box/src/core/card-lint.ts:41:  loader: ICardLoader;
callback-box/src/core/card-lint.ts:92:  return lintCard(options.loader, { path });
callback-box/src/core/file-summary.ts:13:import type { ElementNode } from "cardworks";
callback-box/src/core/file-summary.ts:36:  element?: ElementNode;
callback-box/src/core/extfile-sync.ts:13:import { splitCardContent } from "cardworks";
callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "cardworks";
callback-box/src/core/box-templates.ts:86:import { cardSchema } from "cardworks";
callback-box/src/core/box-templates.ts:133:import { element } from "cardworks";
callback-box/src/core/generate-docs-compile.ts:12:import { parseCard } from "cardworks";
callback-box/src/core/generate-docs-compile.ts:47:      const root = await parseCard(content, { source: filename });
callback-box/src/core/sdk-hooks.ts:14:import { formatLintResults } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:9:export function cardTypesSection(allSchemas: ElementSchema[]): string[] {
callback-box/src/core/preactions/transcribe.ts:18:import type { ElementNode } from "cardworks";
callback-box/src/core/preactions/transcribe.ts:165:function hasXmlTranscription(element: ElementNode): boolean {
callback-box/src/core/preactions/transcribe.ts:170:function hasXmlPermanentError(element: ElementNode): boolean {
callback-box/src/core/preactions/transcribe.ts:175:function getXmlContent(element: ElementNode): string | null {
callback-box/src/core/preactions/transcribe.ts:181:  element: ElementNode;
callback-box/src/core/preactions/transcribe.ts:204:  element: ElementNode,
callback-box/src/core/preactions/types.ts:1:import type { Card, ICardLoader, CardSchema } from "cardworks";
callback-box/src/core/preactions/types.ts:19:  loader: ICardLoader;
callback-box/src/connectors/chat-utils.ts:15:import { splitCardContent } from "cardworks";
callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/src/core/load-context.ts:13:  const elementSchemas = new Map<string, ElementSchema>();
callback-box/src/core/load-context.ts:16:    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/src/core/landmark/resolve.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/core/init-rules.ts:90:  // both legacy XML schemas (ElementSchema with `tagName`) and phase-2
callback-box/scripts/migrate/misc.ts:16:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/misc.ts:97:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/misc.ts:101:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/misc.ts:108:function convertItem(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:126:function convertTodoList(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:146:function convertTelegramMessage(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/misc.ts:174:function convertFeedback(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/misc.ts:226:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/jobs.ts:18:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/jobs.ts:102:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/jobs.ts:106:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/jobs.ts:113:function convertIntakeJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:135:function convertCalendarReviewJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:165:function convertChatJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:181:function convertQuestionFollowupJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/jobs.ts:198:const CONVERTERS: Record<Kind, (n: ElementNode, src: string) => Record<string, unknown>> = {
callback-box/scripts/migrate/jobs.ts:210:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/memo.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/memo.ts:57:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/memo.ts:61:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/memo.ts:68:function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/memo.ts:122:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/question.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/question.ts:27:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/question.ts:78:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/question.ts:85:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/question.ts:153:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/landmark.ts:47:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/landmark.ts:79:function text(el: ElementNode): string {
callback-box/scripts/migrate/landmark.ts:83:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/landmark.ts:87:function children(el: ElementNode, tag: string): ElementNode[] {
callback-box/scripts/migrate/landmark.ts:103:function convertNavigation(nav: ElementNode, source: string, warnings: WarningCollector): Record<string, unknown> | undefined {
callback-box/scripts/migrate/landmark.ts:164:function convertDestination(el: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/landmark.ts:195:    const root = await parseCard(content, { source: absPath });
callback-box/src/connectors/gmail-drafts.ts:19:import { splitCardContent } from "cardworks";
callback-box/scripts/migrate/guide.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/guide.ts:58:function text(el: ElementNode): string {
callback-box/scripts/migrate/guide.ts:62:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/guide.ts:66:function childText(el: ElementNode, tag: string): string | undefined {
callback-box/scripts/migrate/guide.ts:73:function strAttr(el: ElementNode, name: string): string | undefined {
callback-box/scripts/migrate/guide.ts:82:function convertRule(r: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/guide.ts:91:function convertExperiment(e: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/guide.ts:121:    const root = await parseCard(content, { source: absPath });
callback-box/scripts/migrate/doc-sheet.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/doc-sheet.ts:73:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/doc-sheet.ts:77:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/doc-sheet.ts:81:function convertDoc(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/doc-sheet.ts:121:function convertSheet(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/doc-sheet.ts:166:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/email-thread.ts:43:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/email-thread.ts:96:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/email-thread.ts:100:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/email-thread.ts:106:  parent: ElementNode,
callback-box/scripts/migrate/email-thread.ts:110:    pluck: (item: ElementNode) => string | undefined;
callback-box/scripts/migrate/email-thread.ts:124:function convertOne(node: ElementNode, source: string): ThreadFields {
callback-box/scripts/migrate/email-thread.ts:183:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/audio.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/audio.ts:55:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/audio.ts:59:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/audio.ts:112:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/_warnings.ts:18:import type { ElementNode } from "cardworks";
callback-box/scripts/migrate/_warnings.ts:49:  node: ElementNode;
callback-box/scripts/migrate/procedure.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/procedure.ts:50:function dtext(el: ElementNode): string {
callback-box/scripts/migrate/procedure.ts:54:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/procedure.ts:58:function convertPhase(phase: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure.ts:84:function convertStep(step: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure.ts:123:    const root = await parseCard(content, { source: absPath });
callback-box/scripts/migrate/procedure-run.ts:17:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/procedure-run.ts:46:function text(el: ElementNode): string {
callback-box/scripts/migrate/procedure-run.ts:50:function childText(el: ElementNode, tag: string): string | undefined {
callback-box/scripts/migrate/procedure-run.ts:57:function copyAttr(from: ElementNode, name: string, into: Record<string, unknown>, key: string): void {
callback-box/scripts/migrate/procedure-run.ts:62:function convertPhase(phase: ElementNode | undefined, kind: "precheck" | "run" | "validate"): Record<string, unknown> | undefined {
callback-box/scripts/migrate/procedure-run.ts:81:function convertStep(step: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/procedure-run.ts:105:    const root = await parseCard(content, { source: absPath });
callback-box/scripts/migrate/email-message.ts:48:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/email-message.ts:118:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/email-message.ts:122:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/email-message.ts:127:function convertOne(node: ElementNode, source: string): MessageFields {
callback-box/scripts/migrate/email-message.ts:194:  const node = await parseCard(raw, { source: absPath });
callback-box/src/core/procedure/engine-run-card.ts:12:import { splitCardContent } from "cardworks";
callback-box/scripts/migrate/repair-refs.ts:34:import { extractRefs, splitCardContent } from "cardworks";
callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scripts/migrate/capture-session.ts:19:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/capture-session.ts:43:function text(el: ElementNode): string {
callback-box/scripts/migrate/capture-session.ts:47:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/capture-session.ts:51:function refList(el: ElementNode | undefined, childTag: string): string[] {
callback-box/scripts/migrate/capture-session.ts:62:function buildTranscriptBody(transcript: ElementNode | undefined): string {
callback-box/scripts/migrate/capture-session.ts:89:    const root = await parseCard(content, { source: absPath });
callback-box/scripts/migrate/briefing.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/briefing.ts:104:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/briefing.ts:108:function convertOne(node: ElementNode, source: string): { fields: BriefingOut; body: string } {
callback-box/scripts/migrate/briefing.ts:197:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/personality.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/personality.ts:97:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/personality.ts:101:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/personality.ts:108:function convertWithEvidence(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/personality.ts:116:function convertExperiment(node: ElementNode): Record<string, unknown> {
callback-box/scripts/migrate/personality.ts:139:function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/personality.ts:243:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/chat-thread.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/chat-thread.ts:25:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/chat-thread.ts:83:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/chat-thread.ts:90:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/chat-thread.ts:141:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/scheduled-script.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/scheduled-script.ts:29:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scripts/migrate/scheduled-script.ts:75:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/scheduled-script.ts:82:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/scheduled-script.ts:158:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/file.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/file.ts:53:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/file.ts:57:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/file.ts:103:  const node = await parseCard(raw, { source: absPath });
callback-box/scripts/migrate/card-frontmatter.ts:13: * transparently via `parseCard()`, so this migration is a no-op for readers
callback-box/docs/boxes-as-packages.md:17:2. **Schemas are a stub package.** `config/schemas/package.json` is `{"type":"module"}` with no dependencies. To define a real schema the agent would want `import { z } from "zod"; import { element } from "cardworks";` — same as built-in schemas in `src/schemas/`. Today this works only by accident (transitive resolution from the callback-box install) and gives no IDE help inside the box.
callback-box/docs/design-card-views.md:82:  element?: ElementNode;
callback-box/docs/design-card-views.md:449:function extractSummary(element: ElementNode): Record<string, string> {
callback-box/docs/design-card-views.md:550:function resolvePath(root: ElementNode, pathStr?: string): ElementNode {
callback-box/docs/design-card-views.md:745:function parseRecipeElement(el: ElementNode): ParsedRecipe {
callback-box/docs/design-card-views.md:764:function parseSection(el: ElementNode): RecipeSection {
callback-box/scripts/migrate/recipe.ts:40:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/recipe.ts:63:function text(el: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:67:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scripts/migrate/recipe.ts:71:function attrPart(el: ElementNode, name: string): string {
callback-box/scripts/migrate/recipe.ts:77:function ingredientTag(ing: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:82:function sectionBody(section: ElementNode): string {
callback-box/scripts/migrate/recipe.ts:134:    const root = await parseCard(content, { source: absPath });
callback-box/docs/attach-implementation.md:69:Look at `src/core/CardLoader` (or wherever the file walker is) — needs scope-awareness for path resolution. No recursion-skipping for `.attach/`.
callback-box/scripts/migrate/image.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/image.ts:61:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/image.ts:65:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scripts/migrate/image.ts:159:  const node = await parseCard(raw, { source: absPath });
callback-box/docs/agent-knowledge.md:254:Agents can define new card types by creating `.ts` files in `config/schemas/`. Each file exports a default `ElementSchema` using the same `element()` + `z` (Zod) API as built-in schemas. Optionally, files can also export a `template` for `cb create`.
callback-box/src/core/preactions/index.ts:11: * - Phase 1 XML-bodied cards (loaded via cardworks ICardLoader)
callback-box/src/core/preactions/index.ts:21:import type { ICardLoader } from "cardworks";
callback-box/src/core/preactions/index.ts:50:  loader: ICardLoader;
callback-box/src/core/preactions/index.ts:91:  loader: ICardLoader;
callback-box/scratch/codex-out.md:22:1. Is `schemas[]` (the XML ElementSchema list in callback-box/src/schemas/registry.ts) actually empty, and are the "dead path" claims real — card-io.ts loadXmlCard branch, search/extract.ts xmlDoc, ls.ts evaluateXPathString, the CardLoader users (move-operations.ts, cli/lib/loader.ts, todos.ts)? Is any "dead" path actually still reachable?
callback-box/scratch/codex-out.md:23:2. Is the keep-set's "zero transitive XML dependencies" claim true? Read cardworks/src/schema/card-schema.ts, parser/frontmatter.ts, schema/registry.ts, lint/format.ts (and the lint types it needs) — do any transitively import ElementNode / the XML parser / xpath?
callback-box/scratch/codex-out.md:40:     4	now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
callback-box/scratch/codex-out.md:42:     6	`CardLoader`, the XML element schema — has no real users. This plan removes
callback-box/scratch/codex-out.md:91:    55	  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
callback-box/scratch/codex-out.md:105:    69	  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
callback-box/scratch/codex-out.md:130:    94	XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
callback-box/scratch/codex-out.md:131:    95	`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
callback-box/scratch/codex-out.md:132:    96	`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
callback-box/scratch/codex-out.md:146:   110	  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
callback-box/scratch/codex-out.md:147:   111	  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
callback-box/scratch/codex-out.md:153:   117	  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
callback-box/scratch/codex-out.md:154:   118	- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
callback-box/scratch/codex-out.md:155:   119	  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
callback-box/scratch/codex-out.md:156:   120	  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
callback-box/scratch/codex-out.md:163:   127	- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
callback-box/scratch/codex-out.md:165:   129	  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
callback-box/scratch/codex-out.md:173:   137	`chat.ts` reading a now-frontmatter landmark via `parseCard`,
callback-box/scratch/codex-out.md:174:   138	`generate-docs-compile.ts:47` parsing a procedure via `parseCard`) surfaces
callback-box/scratch/codex-out.md:187:   151	keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/scratch/codex-out.md:214:   178	find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/scratch/codex-out.md:237:   201	`parseCard`); once every box is migrated (decided: box-migration-first) they
callback-box/scratch/codex-out.md:241:   205	`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/scratch/codex-out.md:264:   228	| A stale consumer reads a frontmatter card via deleted `parseCard` | Partial | Yes — `tsc` fails to compile once the symbol is gone | Clear (compile error) |
callback-box/scratch/codex-out.md:579:   317	   fallback) and the type-only `ElementNode`/`ElementSchema`/`Card` carriers.
callback-box/scratch/codex-out.md:580:   318	3. **Track A, chunk 3** — rewrite the live `CardLoader` users
callback-box/scratch/codex-out.md:585:   323	   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/scratch/codex-out.md:622:     5	 * by the CardLoader factory. Box-local schemas from config/schemas/
callback-box/scratch/codex-out.md:631:    14	import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:672:    55	export const schemas: ElementSchema[] = [];
callback-box/scratch/codex-out.md:786:   169	  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
callback-box/scratch/codex-out.md:787:   170	  elementSchemas: ElementSchema[];
callback-box/scratch/codex-out.md:860:    23	  parseCard,
callback-box/scratch/codex-out.md:862:    25	  type ElementSchema,
callback-box/scratch/codex-out.md:863:    26	  type ElementNode,
callback-box/scratch/codex-out.md:864:    27	} from "cardworks";
callback-box/scratch/codex-out.md:1135:   298	  readonly schema: ElementSchema | undefined;
callback-box/scratch/codex-out.md:1136:   299	  readonly element: ElementNode;
callback-box/scratch/codex-out.md:1142:   305	  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
callback-box/scratch/codex-out.md:1143:   306	  elementSchemas: Map<string, ElementSchema>;
callback-box/scratch/codex-out.md:1153:   316	 *   tag's ElementSchema (if any) is used for validation.
callback-box/scratch/codex-out.md:1213:   376	  const element = await parseCard(content, { source });
callback-box/scratch/codex-out.md:1220:/opt/homebrew/bin/bash -lc "rg -n \"from ['\\\"]cardworks|require\\(['\\\"]cardworks|import\\(['\\\"]cardworks|cardworks/|CardLoader|parseCard|ElementNode|ElementSchema|evaluateXPathString|serialize|escapeText|lintCard|splitCardContent|formatLintResults|SchemaRegistry|cardSchema|body\\(\" callback-box cardworks bin scripts pnpm-workspace.yaml package.json 2>/dev/null" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
callback-box/scratch/codex-out.md:1224:cardworks/src/jsx/jsx-runtime.ts:9:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1225:cardworks/src/jsx/jsx-runtime.ts:19:): ElementNode {
callback-box/scratch/codex-out.md:1226:cardworks/src/jsx/jsx-runtime.ts:29:): ElementNode {
callback-box/scratch/codex-out.md:1227:cardworks/src/jsx/jsx-runtime.ts:37:  children?: ElementNode | ElementNode[];
callback-box/scratch/codex-out.md:1228:cardworks/src/jsx/jsx-runtime.ts:38:}): ElementNode[] {
callback-box/scratch/codex-out.md:1229:cardworks/src/jsx/jsx-runtime.ts:58:  export type Element = ElementNode;
callback-box/scratch/codex-out.md:1230:cardworks/src/card/card.ts:1:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1233:cardworks/src/card/card.ts:14:  readonly element: ElementNode;
callback-box/scratch/codex-out.md:1234:cardworks/src/card/card.ts:81:  element: ElementNode;
callback-box/scratch/codex-out.md:1235:cardworks/src/card/card.ts:94:  public readonly element: ElementNode;
callback-box/scratch/codex-out.md:1237:cardworks/src/card/card.ts:159:  element: ElementNode;
callback-box/scratch/codex-out.md:1238:cardworks/src/card/card.ts:171:  public readonly element: ElementNode;
callback-box/scratch/codex-out.md:1239:cardworks/src/card/card.ts:231:function attachCardToElements(element: ElementNode, card: Card): void {
callback-box/scratch/codex-out.md:1240:cardworks/src/card/card.ts:255:  element: ElementNode;
callback-box/scratch/codex-out.md:1241:cardworks/src/card/card.ts:263: * This is used internally by CardLoader.
callback-box/scratch/codex-out.md:1242:cardworks/src/lint/index.ts:2:  lintCard,
callback-box/scratch/codex-out.md:1246:cardworks/src/jsx/create-element.ts:1:import type { ElementNode, MixedContent, Comments } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1247:cardworks/src/jsx/create-element.ts:15:export type JSXChild = string | ElementNode | null | undefined;
callback-box/scratch/codex-out.md:1248:cardworks/src/jsx/create-element.ts:22:  children: ElementNode[];
callback-box/scratch/codex-out.md:1249:cardworks/src/jsx/create-element.ts:27: * Process JSX children into ElementNode format.
callback-box/scratch/codex-out.md:1251:cardworks/src/jsx/create-element.ts:52:      (c): c is string | ElementNode => c !== null && c !== undefined
callback-box/scratch/codex-out.md:1253:cardworks/src/jsx/create-element.ts:65:      const elementChildren = filtered.filter((c): c is ElementNode =>
callback-box/scratch/codex-out.md:1255:cardworks/src/jsx/create-element.ts:72:        children: filtered.filter((c): c is ElementNode => isElementNode(c)),
callback-box/scratch/codex-out.md:1256:cardworks/src/jsx/create-element.ts:84: * Type guard for ElementNode.
callback-box/scratch/codex-out.md:1257:cardworks/src/jsx/create-element.ts:86:function isElementNode(value: unknown): value is ElementNode {
callback-box/scratch/codex-out.md:1258:cardworks/src/jsx/create-element.ts:91:    typeof (value as ElementNode).tagName === "string"
callback-box/scratch/codex-out.md:1259:cardworks/src/jsx/create-element.ts:96: * Create an ElementNode from JSX-style arguments.
callback-box/scratch/codex-out.md:1260:cardworks/src/jsx/create-element.ts:101: * @returns An ElementNode
callback-box/scratch/codex-out.md:1261:cardworks/src/jsx/create-element.ts:106:): ElementNode {
callback-box/scratch/codex-out.md:1262:cardworks/src/jsx/create-element.ts:141:  const element: ElementNode = {
callback-box/scratch/codex-out.md:1265:cardworks/src/jsx/types.ts:2:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1266:cardworks/src/jsx/types.ts:3:import type { ElementSchema } from "../schema/element.js";
callback-box/scratch/codex-out.md:1267:cardworks/src/jsx/types.ts:6: * Extract the inferred type from an ElementSchema.
callback-box/scratch/codex-out.md:1268:cardworks/src/jsx/types.ts:9:export type InferElementType<S> = S extends ElementSchema<infer T> ? T : never;
callback-box/scratch/codex-out.md:1269:cardworks/src/jsx/types.ts:12: * Extract JSX props from an ElementSchema.
callback-box/scratch/codex-out.md:1270:cardworks/src/jsx/types.ts:15:export type InferJSXProps<S extends ElementSchema> =
callback-box/scratch/codex-out.md:1271:cardworks/src/jsx/types.ts:17:    ? A & { children?: ElementNode | ElementNode[] | string }
callback-box/scratch/codex-out.md:1272:cardworks/src/jsx/types.ts:18:    : { children?: ElementNode | ElementNode[] | string };
callback-box/scratch/codex-out.md:1273:cardworks/src/jsx/types.ts:35:export type InferJSXElements<T extends Record<string, ElementSchema>> = {
callback-box/scratch/codex-out.md:1274:cardworks/src/jsx/types.ts:43:  children?: ElementNode | ElementNode[] | string | (ElementNode | string)[];
callback-box/scratch/codex-out.md:1275:cardworks/src/jsx/types.ts:50:export interface CardJSXFactory<T extends Record<string, ElementSchema>> {
callback-box/scratch/codex-out.md:1276:cardworks/src/jsx/types.ts:54:  jsx: (tag: keyof T | string, props: JSXRuntimeProps) => ElementNode;
callback-box/scratch/codex-out.md:1277:cardworks/src/jsx/types.ts:59:  jsxs: (tag: keyof T | string, props: JSXRuntimeProps) => ElementNode;
callback-box/scratch/codex-out.md:1278:cardworks/src/jsx/types.ts:64:  Fragment: (props: { children?: ElementNode | ElementNode[] }) => ElementNode[];
callback-box/scratch/codex-out.md:1279:cardworks/src/jsx/types.ts:70:  createCard: (path: string, element: ElementNode) => Card;
callback-box/scratch/codex-out.md:1284:cardworks/src/lint/lint.ts:1:import type { ICardLoader } from "../loader/loader.js";
callback-box/scratch/codex-out.md:1285:cardworks/src/lint/lint.ts:2:import type { ElementNode, Location } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1286:cardworks/src/lint/lint.ts:4:import { parseCard } from "../parser/parse.js";
callback-box/scratch/codex-out.md:1287:cardworks/src/lint/lint.ts:45: * Options for {@link lintCard}: the card path plus optional lint settings.
callback-box/scratch/codex-out.md:1288:cardworks/src/lint/lint.ts:55:export async function lintCard(
callback-box/scratch/codex-out.md:1289:cardworks/src/lint/lint.ts:56:  loader: ICardLoader,
callback-box/scratch/codex-out.md:1290:cardworks/src/lint/lint.ts:120:function checkDuplicateIds(root: ElementNode, warnings: LintIssue[]): void {
callback-box/scratch/codex-out.md:1291:cardworks/src/lint/lint.ts:147:function collectIds(node: ElementNode, occurrences: IdOccurrence[]): void {
callback-box/scratch/codex-out.md:1292:cardworks/src/lint/lint.ts:164:  loader: ICardLoader;
callback-box/scratch/codex-out.md:1293:cardworks/src/lint/lint.ts:172:async function checkRefsInNode(node: ElementNode, ctx: RefCheckContext): Promise<void> {
callback-box/scratch/codex-out.md:1294:cardworks/src/lint/lint.ts:266: * unknown root tags). For full schema validation, use `lintCard` with
callback-box/scratch/codex-out.md:1295:cardworks/src/lint/lint.ts:273:  loader: ICardLoader,
callback-box/scratch/codex-out.md:1296:cardworks/src/lint/lint.ts:282:    const node = await parseCard(content, { source: sourceName });
callback-box/scratch/codex-out.md:1297:cardworks/src/lint/lint.ts:314:  loader: ICardLoader,
callback-box/scratch/codex-out.md:1301:cardworks/src/lint/lint.ts:334:  loader: ICardLoader,
callback-box/scratch/codex-out.md:1302:cardworks/src/lint/lint.ts:344:    const result = await lintCard(loader, { path, ...lintOptions });
callback-box/scratch/codex-out.md:1307:cardworks/src/jsx/factory.ts:1:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1308:cardworks/src/jsx/factory.ts:2:import type { ElementSchema } from "../schema/element.js";
callback-box/scratch/codex-out.md:1310:cardworks/src/jsx/factory.ts:64:export function defineCardJSX<T extends Record<string, ElementSchema>>(
callback-box/scratch/codex-out.md:1311:cardworks/src/jsx/factory.ts:73:  function jsx(tag: keyof T | string, props: JSXRuntimeProps): ElementNode {
callback-box/scratch/codex-out.md:1312:cardworks/src/jsx/factory.ts:82:  function jsxs(tag: keyof T | string, props: JSXRuntimeProps): ElementNode {
callback-box/scratch/codex-out.md:1313:cardworks/src/jsx/factory.ts:93:    children?: ElementNode | ElementNode[];
callback-box/scratch/codex-out.md:1314:cardworks/src/jsx/factory.ts:94:  }): ElementNode[] {
callback-box/scratch/codex-out.md:1315:cardworks/src/jsx/factory.ts:106:   * Create a Card from a JSX-created ElementNode.
callback-box/scratch/codex-out.md:1316:cardworks/src/jsx/factory.ts:111:  function createCard(path: string, element: ElementNode): Card {
callback-box/scratch/codex-out.md:1318:callback-box/scripts/migrate/landmark.ts:47:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1319:callback-box/scripts/migrate/landmark.ts:79:function text(el: ElementNode): string {
callback-box/scratch/codex-out.md:1320:callback-box/scripts/migrate/landmark.ts:83:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:1321:callback-box/scripts/migrate/landmark.ts:87:function children(el: ElementNode, tag: string): ElementNode[] {
callback-box/scratch/codex-out.md:1322:callback-box/scripts/migrate/landmark.ts:103:function convertNavigation(nav: ElementNode, source: string, warnings: WarningCollector): Record<string, unknown> | undefined {
callback-box/scratch/codex-out.md:1323:callback-box/scripts/migrate/landmark.ts:164:function convertDestination(el: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1325:callback-box/scripts/migrate/landmark.ts:195:    const root = await parseCard(content, { source: absPath });
callback-box/scratch/codex-out.md:1326:callback-box/docs/design-card-views.md:82:  element?: ElementNode;
callback-box/scratch/codex-out.md:1327:callback-box/docs/design-card-views.md:449:function extractSummary(element: ElementNode): Record<string, string> {
callback-box/scratch/codex-out.md:1330:callback-box/docs/design-card-views.md:550:function resolvePath(root: ElementNode, pathStr?: string): ElementNode {
callback-box/scratch/codex-out.md:1331:callback-box/docs/design-card-views.md:745:function parseRecipeElement(el: ElementNode): ParsedRecipe {
callback-box/scratch/codex-out.md:1332:callback-box/docs/design-card-views.md:764:function parseSection(el: ElementNode): RecipeSection {
callback-box/scratch/codex-out.md:1337:cardworks/DESIGN.md:849:const loader = new CardLoader(fs)
callback-box/scratch/codex-out.md:1339:cardworks/test/loader.test.ts:2:import { MemoryCardLoader, ValidationError } from "../src/loader/loader.js";
callback-box/scratch/codex-out.md:1340:cardworks/test/loader.test.ts:6:test("MemoryCardLoader.load: loads a simple card", async (t) => {
callback-box/scratch/codex-out.md:1341:cardworks/test/loader.test.ts:7:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1342:cardworks/test/loader.test.ts:27:test("MemoryCardLoader.load: throws on non-existent file", async (t) => {
callback-box/scratch/codex-out.md:1343:cardworks/test/loader.test.ts:28:  const loader = new MemoryCardLoader("/project");
callback-box/scratch/codex-out.md:1344:cardworks/test/loader.test.ts:35:test("MemoryCardLoader.save: saves a card", async (t) => {
callback-box/scratch/codex-out.md:1345:cardworks/test/loader.test.ts:36:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1346:cardworks/test/loader.test.ts:54:test("MemoryCardLoader.resolveRef: resolves cross-card reference", async (t) => {
callback-box/scratch/codex-out.md:1347:cardworks/test/loader.test.ts:55:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1348:cardworks/test/loader.test.ts:74:test("MemoryCardLoader.resolveRef: detects version mismatch", async (t) => {
callback-box/scratch/codex-out.md:1349:cardworks/test/loader.test.ts:75:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1350:cardworks/test/loader.test.ts:93:test("MemoryCardLoader: full workflow with fixture files", async (t) => {
callback-box/scratch/codex-out.md:1351:cardworks/test/loader.test.ts:94:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1352:cardworks/test/loader.test.ts:139:test("MemoryCardLoader.exists: checks if card file exists", async (t) => {
callback-box/scratch/codex-out.md:1353:cardworks/test/loader.test.ts:140:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1354:cardworks/test/loader.test.ts:150:test("MemoryCardLoader: handles absolute project-relative refs", async (t) => {
callback-box/scratch/codex-out.md:1355:cardworks/test/loader.test.ts:151:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1356:cardworks/test/loader.test.ts:167:test("MemoryCardLoader.getProjectRoot: returns project root", (t) => {
callback-box/scratch/codex-out.md:1357:cardworks/test/loader.test.ts:168:  const loader = new MemoryCardLoader("/my/project");
callback-box/scratch/codex-out.md:1358:cardworks/test/loader.test.ts:184:test("MemoryCardLoader: validates against registered schema", async (t) => {
callback-box/scratch/codex-out.md:1359:cardworks/test/loader.test.ts:185:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1360:cardworks/test/loader.test.ts:199:test("MemoryCardLoader: throws ValidationError on schema mismatch", async (t) => {
callback-box/scratch/codex-out.md:1361:cardworks/test/loader.test.ts:204:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1362:cardworks/test/loader.test.ts:222:test("MemoryCardLoader: skips validation for unregistered tag names", async (t) => {
callback-box/scratch/codex-out.md:1363:cardworks/test/loader.test.ts:223:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1364:cardworks/test/loader.test.ts:239:test("MemoryCardLoader.move: moves a card file", async (t) => {
callback-box/scratch/codex-out.md:1365:cardworks/test/loader.test.ts:240:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1366:cardworks/test/loader.test.ts:267:test("MemoryCardLoader.move: moves related files with same basename", async (t) => {
callback-box/scratch/codex-out.md:1367:cardworks/test/loader.test.ts:268:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1368:cardworks/test/loader.test.ts:294:test("MemoryCardLoader.move: moves sibling of a .type.card (compound extension)", async (t) => {
callback-box/scratch/codex-out.md:1369:cardworks/test/loader.test.ts:298:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1370:cardworks/test/loader.test.ts:326:test("MemoryCardLoader.move: updates references in other cards", async (t) => {
callback-box/scratch/codex-out.md:1371:cardworks/test/loader.test.ts:327:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1372:cardworks/test/loader.test.ts:352:test("MemoryCardLoader.move: throws if extension changes", async (t) => {
callback-box/scratch/codex-out.md:1373:cardworks/test/loader.test.ts:353:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1374:cardworks/test/loader.test.ts:368:test("MemoryCardLoader.move: handles move to different directory", async (t) => {
callback-box/scratch/codex-out.md:1375:cardworks/test/loader.test.ts:369:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1376:cardworks/test/loader.test.ts:390:test("MemoryCardLoader.findIncomingRefs: finds cards that reference target", async (t) => {
callback-box/scratch/codex-out.md:1377:cardworks/test/loader.test.ts:391:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1378:cardworks/test/loader.test.ts:411:test("MemoryCardLoader.findIncomingRefs: includes ref details", async (t) => {
callback-box/scratch/codex-out.md:1379:cardworks/test/loader.test.ts:412:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1380:cardworks/test/loader.test.ts:430:test("MemoryCardLoader.findIncomingRefs: finds refs from refs attribute", async (t) => {
callback-box/scratch/codex-out.md:1381:cardworks/test/loader.test.ts:431:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1382:cardworks/test/loader.test.ts:448:test("MemoryCardLoader.findOutgoingRefs: finds all references from a card", async (t) => {
callback-box/scratch/codex-out.md:1383:cardworks/test/loader.test.ts:449:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1384:cardworks/test/loader.test.ts:469:test("MemoryCardLoader.findOutgoingRefs: handles nested elements", async (t) => {
callback-box/scratch/codex-out.md:1385:cardworks/test/loader.test.ts:470:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1386:cardworks/test/loader.test.ts:490:test("MemoryCardLoader.move: updates refs attribute", async (t) => {
callback-box/scratch/codex-out.md:1387:cardworks/test/loader.test.ts:491:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1388:cardworks/test/loader.test.ts:516:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1389:cardworks/test/loader.test.ts:527:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1390:cardworks/test/loader.test.ts:540:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1391:cardworks/test/loader.test.ts:551:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1392:cardworks/test/loader.test.ts:568:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1393:cardworks/test/loader.test.ts:579:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1394:cardworks/test/loader.test.ts:598:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1395:cardworks/test/loader.test.ts:610:test("MemoryCardLoader.saveAs: creates new card at different path", async (t) => {
callback-box/scratch/codex-out.md:1396:cardworks/test/loader.test.ts:611:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1399:cardworks/test/loader.test.ts:634:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1402:cardworks/test/loader.test.ts:651:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1405:cardworks/test/loader.test.ts:667:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1408:cardworks/test/loader.test.ts:687:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1410:callback-box/scripts/migrate/guide.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1411:callback-box/scripts/migrate/guide.ts:58:function text(el: ElementNode): string {
callback-box/scratch/codex-out.md:1412:callback-box/scripts/migrate/guide.ts:62:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:1413:callback-box/scripts/migrate/guide.ts:66:function childText(el: ElementNode, tag: string): string | undefined {
callback-box/scratch/codex-out.md:1414:callback-box/scripts/migrate/guide.ts:73:function strAttr(el: ElementNode, name: string): string | undefined {
callback-box/scratch/codex-out.md:1415:callback-box/scripts/migrate/guide.ts:82:function convertRule(r: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1416:callback-box/scripts/migrate/guide.ts:91:function convertExperiment(e: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1418:callback-box/scripts/migrate/guide.ts:121:    const root = await parseCard(content, { source: absPath });
callback-box/scratch/codex-out.md:1443:cardworks/src/index.ts:12:export { parseXml, parseXmlFile, parseCard, ParseError } from "./parser/parse.js";
callback-box/scratch/codex-out.md:1445:cardworks/src/index.ts:15:  type ElementNode,
callback-box/scratch/codex-out.md:1447:cardworks/src/index.ts:29:  type ElementSchema,
callback-box/scratch/codex-out.md:1453:cardworks/src/index.ts:66:export { executeXPath, evaluateXPathString } from "./refs/xpath.js";
callback-box/scratch/codex-out.md:1454:cardworks/src/index.ts:70:  CardLoader,
callback-box/scratch/codex-out.md:1455:cardworks/src/index.ts:71:  MemoryCardLoader,
callback-box/scratch/codex-out.md:1456:cardworks/src/index.ts:73:  type ICardLoader,
callback-box/scratch/codex-out.md:1457:cardworks/src/index.ts:74:  type CardLoaderOptions,
callback-box/scratch/codex-out.md:1458:cardworks/src/index.ts:75:  type MemoryCardLoaderOptions,
callback-box/scratch/codex-out.md:1459:cardworks/src/index.ts:82:  lintCard,
callback-box/scratch/codex-out.md:1463:callback-box/scripts/migrate/personality.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1464:callback-box/scripts/migrate/personality.ts:97:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:1465:callback-box/scripts/migrate/personality.ts:101:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:1466:callback-box/scripts/migrate/personality.ts:108:function convertWithEvidence(node: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1467:callback-box/scripts/migrate/personality.ts:116:function convertExperiment(node: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1468:callback-box/scripts/migrate/personality.ts:139:function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scratch/codex-out.md:1469:callback-box/scripts/migrate/personality.ts:243:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:1470:cardworks/test/format-error.test.ts:6:import type { ElementNode } from "../src/parser/provenance.js";
callback-box/scratch/codex-out.md:1471:cardworks/test/format-error.test.ts:7:import { MemoryCardLoader, ValidationError } from "../src/loader/loader.js";
callback-box/scratch/codex-out.md:1472:cardworks/test/format-error.test.ts:9:function makeNode(partial: Partial<ElementNode> & { tagName: string }): ElementNode {
callback-box/scratch/codex-out.md:1473:cardworks/test/format-error.test.ts:113:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1476:callback-box/src/core/extfile-sync.ts:13:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:1478:cardworks/README.md:24:import { CardLoader, element } from "cardworks";
callback-box/scratch/codex-out.md:1479:cardworks/README.md:28:const loader = new CardLoader("/path/to/project");
callback-box/scratch/codex-out.md:1480:cardworks/README.md:89:  element: ElementNode;               // The root XML element
callback-box/scratch/codex-out.md:1481:cardworks/README.md:98:### ElementNode
callback-box/scratch/codex-out.md:1482:cardworks/README.md:100:The `ElementNode` is the core data structure representing a parsed XML element:
callback-box/scratch/codex-out.md:1483:cardworks/README.md:103:interface ElementNode {
callback-box/scratch/codex-out.md:1484:cardworks/README.md:108:  children: ElementNode[];            // Child elements
callback-box/scratch/codex-out.md:1485:cardworks/README.md:117:// MixedContent is: string | ElementNode | { comment: string }
callback-box/scratch/codex-out.md:1486:cardworks/README.md:120:Each ElementNode has a non-enumerable `card` property that references back to its containing Card.
callback-box/scratch/codex-out.md:1487:cardworks/README.md:143:import { parseXml } from "cardworks";
callback-box/scratch/codex-out.md:1488:cardworks/README.md:236:import { parseXml, ParseError } from "cardworks";
callback-box/scratch/codex-out.md:1489:cardworks/README.md:257:import { element } from "cardworks";
callback-box/scratch/codex-out.md:1490:cardworks/README.md:295:When you pass schemas to a `CardLoader`, cards are validated automatically on load:
callback-box/scratch/codex-out.md:1491:cardworks/README.md:298:import { CardLoader, ValidationError } from "cardworks";
callback-box/scratch/codex-out.md:1492:cardworks/README.md:301:const loader = new CardLoader("/project", {
callback-box/scratch/codex-out.md:1493:cardworks/README.md:378:import { parseRef } from "cardworks";
callback-box/scratch/codex-out.md:1494:cardworks/README.md:392:import { CardLoader } from "cardworks";
callback-box/scratch/codex-out.md:1495:cardworks/README.md:394:const loader = new CardLoader("/project");
callback-box/scratch/codex-out.md:1496:cardworks/README.md:511:async function loadRecipeWithIngredients(loader: CardLoader, path: string) {
callback-box/scratch/codex-out.md:1497:cardworks/README.md:541:Convert `ElementNode` trees back to XML strings.
callback-box/scratch/codex-out.md:1498:cardworks/README.md:546:import { CardLoader, serialize } from "cardworks";
callback-box/scratch/codex-out.md:1499:cardworks/README.md:548:const loader = new CardLoader("/project");
callback-box/scratch/codex-out.md:1504:cardworks/README.md:598:## CardLoader
callback-box/scratch/codex-out.md:1505:cardworks/README.md:600:The `CardLoader` provides high-level card management.
callback-box/scratch/codex-out.md:1506:cardworks/README.md:605:import { CardLoader } from "cardworks";
callback-box/scratch/codex-out.md:1507:cardworks/README.md:608:const loader = new CardLoader("/path/to/project");
callback-box/scratch/codex-out.md:1508:cardworks/README.md:611:const validatingLoader = new CardLoader("/path/to/project", {
callback-box/scratch/codex-out.md:1509:cardworks/README.md:619:const loader = new CardLoader("/path/to/project", {
callback-box/scratch/codex-out.md:1512:cardworks/README.md:751:import { CardLoader, lintAll, formatLintResults } from "cardworks";
callback-box/scratch/codex-out.md:1513:cardworks/README.md:754:const loader = new CardLoader("/path/to/project", {
callback-box/scratch/codex-out.md:1515:cardworks/README.md:777:import { lintCard, lintCards, lintAll } from "cardworks";
callback-box/scratch/codex-out.md:1516:cardworks/README.md:780:const result = await lintCard(loader, "/project/Recipe.card");
callback-box/scratch/codex-out.md:1518:cardworks/README.md:794:import { formatLintResults, formatLintResultsJson } from "cardworks";
callback-box/scratch/codex-out.md:1522:cardworks/README.md:820:## Testing with MemoryCardLoader
callback-box/scratch/codex-out.md:1523:cardworks/README.md:822:For testing, use `MemoryCardLoader` which stores files in memory:
callback-box/scratch/codex-out.md:1524:cardworks/README.md:825:import { MemoryCardLoader } from "cardworks";
callback-box/scratch/codex-out.md:1525:cardworks/README.md:827:const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1526:cardworks/README.md:840:// Use it just like CardLoader
callback-box/scratch/codex-out.md:1527:cardworks/README.md:861:import { defineCardJSX, element } from "cardworks";
callback-box/scratch/codex-out.md:1528:cardworks/README.md:892:import { CardLoader } from "cardworks";
callback-box/scratch/codex-out.md:1529:cardworks/README.md:908:const loader = new CardLoader("/project");
callback-box/scratch/codex-out.md:1530:cardworks/README.md:928:import { createElement, defineCardJSX } from "cardworks";
callback-box/scratch/codex-out.md:1531:cardworks/README.md:973:import { JSXValidationError } from "cardworks";
callback-box/scratch/codex-out.md:1532:cardworks/README.md:1004:const loader = new CardLoader("/project", { requireVersion: true });
callback-box/scratch/codex-out.md:1533:cardworks/README.md:1014:import type { ElementNode, InferJSXElements } from "cardworks";
callback-box/scratch/codex-out.md:1534:cardworks/README.md:1022:    interface Element extends ElementNode {}
callback-box/scratch/codex-out.md:1535:cardworks/README.md:1035:Cardworks uses a filesystem interface internally. The `CardLoader` and `MemoryCardLoader` handle this automatically, but you can access the underlying filesystem classes directly if needed.
callback-box/scratch/codex-out.md:1536:cardworks/README.md:1042:import { NodeFileSystem } from "cardworks";
callback-box/scratch/codex-out.md:1537:cardworks/README.md:1053:import { MemoryFileSystem } from "cardworks";
callback-box/scratch/codex-out.md:1538:cardworks/README.md:1069:import { NodeFileSystem } from "cardworks";
callback-box/scratch/codex-out.md:1539:cardworks/README.md:1094:import type { FileSystem } from "cardworks";
callback-box/scratch/codex-out.md:1540:cardworks/README.md:1167:import { CardLoader } from "cardworks";
callback-box/scratch/codex-out.md:1541:cardworks/README.md:1170:const loader = new CardLoader("/project");
callback-box/scratch/codex-out.md:1542:cardworks/README.md:1263:| `parseXml(xml, source)` | Parse XML string to ElementNode |
callback-box/scratch/codex-out.md:1543:cardworks/README.md:1272:| `ElementNodeSchema` | Base schema for any ElementNode |
callback-box/scratch/codex-out.md:1544:cardworks/README.md:1279:| `serialize(node, options?)` | Convert ElementNode to XML string |
callback-box/scratch/codex-out.md:1545:cardworks/README.md:1295:| `element` | Root ElementNode |
callback-box/scratch/codex-out.md:1546:cardworks/README.md:1302:### CardLoader
callback-box/scratch/codex-out.md:1548:cardworks/README.md:1322:| `lintCard(loader, path, options?)` | Lint a single card |
callback-box/scratch/codex-out.md:1552:cardworks/README.md:1332:| `CardLoader` | File-based card loader for production use |
callback-box/scratch/codex-out.md:1553:cardworks/README.md:1333:| `MemoryCardLoader` | In-memory card loader for testing |
callback-box/scratch/codex-out.md:1554:cardworks/README.md:1339:| `createElement(tag, props)` | Create ElementNode programmatically |
callback-box/scratch/codex-out.md:1555:cardworks/README.md:1345:| `InferJSXProps<S>` | Extract JSX props from ElementSchema |
callback-box/scratch/codex-out.md:1556:callback-box/scripts/migrate/misc.ts:16:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1557:callback-box/scripts/migrate/misc.ts:97:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:1558:callback-box/scripts/migrate/misc.ts:101:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:1559:callback-box/scripts/migrate/misc.ts:108:function convertItem(node: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1560:callback-box/scripts/migrate/misc.ts:126:function convertTodoList(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:1561:callback-box/scripts/migrate/misc.ts:146:function convertTelegramMessage(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:1562:callback-box/scripts/migrate/misc.ts:174:function convertFeedback(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scratch/codex-out.md:1563:callback-box/scripts/migrate/misc.ts:226:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:1564:cardworks/src/refs/resolve.ts:2:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1565:cardworks/src/refs/resolve.ts:3:import { parseCard } from "../parser/parse.js";
callback-box/scratch/codex-out.md:1566:cardworks/src/refs/resolve.ts:73:  let targetNode: ElementNode;
callback-box/scratch/codex-out.md:1567:cardworks/src/refs/resolve.ts:76:    targetNode = await parseCard(content, { source: resolvedPath });
callback-box/scratch/codex-out.md:1568:cardworks/src/refs/resolve.ts:98:  let fragment: ElementNode | undefined;
callback-box/scratch/codex-out.md:1569:cardworks/src/refs/resolve.ts:99:  let fragments: ElementNode[] | undefined;
callback-box/scratch/codex-out.md:1570:cardworks/src/refs/resolve.ts:215:  nodes: ElementNode[];
callback-box/scratch/codex-out.md:1571:cardworks/src/refs/resolve.ts:223:function resolveFragment(fragment: RefFragment, root: ElementNode): FragmentResult {
callback-box/scratch/codex-out.md:1572:cardworks/src/refs/resolve.ts:246:function findById(node: ElementNode, id: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:1573:callback-box/src/core/reactor/procedure-trampoline.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1574:callback-box/src/core/reactor/procedure-trampoline.ts:24:    const root = await parseCard(content, { source: filePath });
callback-box/scratch/codex-out.md:1575:callback-box/src/core/reactor/procedure-trampoline.ts:25:    for (const child of root.children as ElementNode[]) {
callback-box/scratch/codex-out.md:1576:callback-box/src/core/reactor/procedure-trampoline.ts:28:        for (const grandchild of (child.children ?? []) as ElementNode[]) {
callback-box/scratch/codex-out.md:1579:cardworks/src/refs/types.ts:1:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1580:cardworks/src/refs/types.ts:44:  fragment?: ElementNode | undefined;
callback-box/scratch/codex-out.md:1581:cardworks/src/refs/types.ts:46:  fragments?: ElementNode[] | undefined;
callback-box/scratch/codex-out.md:1582:callback-box/scripts/migrate/chat-thread.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1583:callback-box/scripts/migrate/chat-thread.ts:25:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scratch/codex-out.md:1584:callback-box/scripts/migrate/chat-thread.ts:83:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:1585:callback-box/scripts/migrate/chat-thread.ts:90:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:1586:callback-box/scripts/migrate/chat-thread.ts:141:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:1587:cardworks/test/jsx.test.ts:5:import { MemoryCardLoader } from "../src/loader/loader.js";
callback-box/scratch/codex-out.md:1588:cardworks/test/jsx.test.ts:294:// Integration with CardLoader
callback-box/scratch/codex-out.md:1589:cardworks/test/jsx.test.ts:296:test("JSX card can be saved via CardLoader", async (t) => {
callback-box/scratch/codex-out.md:1590:cardworks/test/jsx.test.ts:305:  const loader = new MemoryCardLoader("/project");
callback-box/scratch/codex-out.md:1602:cardworks/src/refs/xpath.ts:3:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1604:cardworks/src/refs/xpath.ts:15:  nodes: ElementNode[];
callback-box/scratch/codex-out.md:1605:cardworks/src/refs/xpath.ts:26:  /** The root ElementNode to query */
callback-box/scratch/codex-out.md:1606:cardworks/src/refs/xpath.ts:27:  root: ElementNode;
callback-box/scratch/codex-out.md:1607:cardworks/src/refs/xpath.ts:33: * Execute an XPath query against an ElementNode tree.
callback-box/scratch/codex-out.md:1608:cardworks/src/refs/xpath.ts:36: * @param options - The root ElementNode to query and whether one match is expected
callback-box/scratch/codex-out.md:1609:cardworks/src/refs/xpath.ts:43:  // Rebuild DOM from ElementNode
callback-box/scratch/codex-out.md:1612:cardworks/src/refs/xpath.ts:94: * Convert an ElementNode tree to an XML Document.
callback-box/scratch/codex-out.md:1613:cardworks/src/refs/xpath.ts:96:function elementNodeToDocument(root: ElementNode): XmldomDocument {
callback-box/scratch/codex-out.md:1615:cardworks/src/refs/xpath.ts:103: * Serialize an ElementNode to XML string.
callback-box/scratch/codex-out.md:1616:cardworks/src/refs/xpath.ts:105:function serializeElementNode(node: ElementNode): string {
callback-box/scratch/codex-out.md:1623:cardworks/src/refs/xpath.ts:171: * matched DOM node, then following the same path in the ElementNode tree.
callback-box/scratch/codex-out.md:1624:cardworks/src/refs/xpath.ts:174:  root: ElementNode;
callback-box/scratch/codex-out.md:1626:cardworks/src/refs/xpath.ts:181:): ElementNode[] {
callback-box/scratch/codex-out.md:1627:cardworks/src/refs/xpath.ts:182:  const results: ElementNode[] = [];
callback-box/scratch/codex-out.md:1628:cardworks/src/refs/xpath.ts:193:      // Follow path in ElementNode tree
callback-box/scratch/codex-out.md:1629:cardworks/src/refs/xpath.ts:250: * Follow a path of child indices in an ElementNode tree.
callback-box/scratch/codex-out.md:1630:cardworks/src/refs/xpath.ts:252:function followPath(root: ElementNode, path: number[]): ElementNode | null {
callback-box/scratch/codex-out.md:1631:cardworks/src/refs/xpath.ts:253:  let current: ElementNode = root;
callback-box/scratch/codex-out.md:1632:cardworks/src/refs/xpath.ts:272: * Evaluate an XPath expression against an ElementNode tree and return a string result.
callback-box/scratch/codex-out.md:1633:cardworks/src/refs/xpath.ts:274: * Unlike executeXPath which returns ElementNode references, this function extracts
callback-box/scratch/codex-out.md:1634:cardworks/src/refs/xpath.ts:279: * @param root - The root ElementNode to query
callback-box/scratch/codex-out.md:1635:cardworks/src/refs/xpath.ts:282:export function evaluateXPathString(expr: string, root: ElementNode): string {
callback-box/scratch/codex-out.md:1636:cardworks/src/refs/xpath.ts:324: * Get element children from an ElementNode (handles both children and mixed).
callback-box/scratch/codex-out.md:1637:cardworks/src/refs/xpath.ts:326:function getElementChildren(node: ElementNode): ElementNode[] {
callback-box/scratch/codex-out.md:1638:cardworks/src/refs/xpath.ts:329:      (item): item is ElementNode =>
callback-box/scratch/codex-out.md:1641:cardworks/test/lint.test.ts:2:import { MemoryCardLoader } from "../src/loader/loader.js";
callback-box/scratch/codex-out.md:1642:cardworks/test/lint.test.ts:3:import { lintCard, lintAll, formatLintResults } from "../src/lint/index.js";
callback-box/scratch/codex-out.md:1643:cardworks/test/lint.test.ts:11:test("lintCard: valid card returns no errors", async (t) => {
callback-box/scratch/codex-out.md:1644:cardworks/test/lint.test.ts:12:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1645:cardworks/test/lint.test.ts:19:  const result = await lintCard(loader, { path: "/project/Valid.card" });
callback-box/scratch/codex-out.md:1646:cardworks/test/lint.test.ts:25:test("lintCard: parse error is reported", async (t) => {
callback-box/scratch/codex-out.md:1647:cardworks/test/lint.test.ts:26:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1648:cardworks/test/lint.test.ts:32:  const result = await lintCard(loader, { path: "/project/Invalid.card" });
callback-box/scratch/codex-out.md:1649:cardworks/test/lint.test.ts:39:test("lintCard: validation error is reported", async (t) => {
callback-box/scratch/codex-out.md:1650:cardworks/test/lint.test.ts:44:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1651:cardworks/test/lint.test.ts:51:  const result = await lintCard(loader, { path: "/project/Invalid.card" });
callback-box/scratch/codex-out.md:1652:cardworks/test/lint.test.ts:57:test("lintCard: broken reference is reported", async (t) => {
callback-box/scratch/codex-out.md:1653:cardworks/test/lint.test.ts:58:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1654:cardworks/test/lint.test.ts:66:  const result = await lintCard(loader, { path: "/project/Main.card" });
callback-box/scratch/codex-out.md:1655:cardworks/test/lint.test.ts:73:test("lintCard: version mismatch is reported as warning", async (t) => {
callback-box/scratch/codex-out.md:1656:cardworks/test/lint.test.ts:74:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1657:cardworks/test/lint.test.ts:83:  const result = await lintCard(loader, { path: "/project/Main.card" });
callback-box/scratch/codex-out.md:1658:cardworks/test/lint.test.ts:91:test("lintCard: checkRefs can be disabled", async (t) => {
callback-box/scratch/codex-out.md:1659:cardworks/test/lint.test.ts:92:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1660:cardworks/test/lint.test.ts:100:  const result = await lintCard(loader, { path: "/project/Main.card", checkRefs: false });
callback-box/scratch/codex-out.md:1661:cardworks/test/lint.test.ts:107:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1662:cardworks/test/lint.test.ts:124:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1664:cardworks/test/lint.test.ts:139:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1667:cardworks/test/lint.test.ts:154:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1670:cardworks/test/lint.test.ts:169:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1672:cardworks/test/lint.test.ts:185:test("lintCard: duplicate IDs are reported as warning", async (t) => {
callback-box/scratch/codex-out.md:1673:cardworks/test/lint.test.ts:186:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1674:cardworks/test/lint.test.ts:196:  const result = await lintCard(loader, { path: "/project/DupIds.card" });
callback-box/scratch/codex-out.md:1675:cardworks/test/lint.test.ts:204:test("lintCard: multiple duplicate IDs are all reported", async (t) => {
callback-box/scratch/codex-out.md:1676:cardworks/test/lint.test.ts:205:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1677:cardworks/test/lint.test.ts:217:  const result = await lintCard(loader, { path: "/project/MultiDup.card" });
callback-box/scratch/codex-out.md:1678:cardworks/test/lint.test.ts:224:test("lintCard: refs attribute checks multiple references", async (t) => {
callback-box/scratch/codex-out.md:1679:cardworks/test/lint.test.ts:225:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1680:cardworks/test/lint.test.ts:235:  const result = await lintCard(loader, { path: "/project/Main.card" });
callback-box/scratch/codex-out.md:1681:cardworks/test/lint.test.ts:243:test("lintCard: refs attribute reports version mismatches", async (t) => {
callback-box/scratch/codex-out.md:1682:cardworks/test/lint.test.ts:244:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1683:cardworks/test/lint.test.ts:254:  const result = await lintCard(loader, { path: "/project/Main.card" });
callback-box/scratch/codex-out.md:1684:cardworks/test/lint.test.ts:262:test("lintCard: fragment errors are reported", async (t) => {
callback-box/scratch/codex-out.md:1685:cardworks/test/lint.test.ts:263:  const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1686:cardworks/test/lint.test.ts:274:  const result = await lintCard(loader, { path: "/project/Main.card" });
callback-box/scratch/codex-out.md:1687:callback-box/scripts/migrate/doc-sheet.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1688:callback-box/scripts/migrate/doc-sheet.ts:73:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:1689:callback-box/scripts/migrate/doc-sheet.ts:77:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:1690:callback-box/scripts/migrate/doc-sheet.ts:81:function convertDoc(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:1691:callback-box/scripts/migrate/doc-sheet.ts:121:function convertSheet(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:1692:callback-box/scripts/migrate/doc-sheet.ts:166:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:1693:cardworks/src/loader/types.ts:1:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1695:cardworks/src/loader/types.ts:4:import type { ElementSchema } from "../schema/element.js";
callback-box/scratch/codex-out.md:1696:cardworks/src/loader/types.ts:40:export interface CardLoaderOptions {
callback-box/scratch/codex-out.md:1697:cardworks/src/loader/types.ts:42:  schemas?: SchemaRegistry | ElementSchema[];
callback-box/scratch/codex-out.md:1699:cardworks/src/loader/types.ts:58: * Options for MemoryCardLoader.
callback-box/scratch/codex-out.md:1700:cardworks/src/loader/types.ts:60:export interface MemoryCardLoaderOptions extends CardLoaderOptions {
callback-box/scratch/codex-out.md:1701:cardworks/src/loader/types.ts:68:export interface ICardLoader {
callback-box/scratch/codex-out.md:1702:cardworks/src/loader/types.ts:87:  serialize(element: ElementNode): string;
callback-box/scratch/codex-out.md:1703:cardworks/src/loader/types.ts:147:  validateContent(content: string, sourceName?: string): Promise<ElementNode>;
callback-box/scratch/codex-out.md:1704:cardworks/test/parser.test.ts:2:import { parseXml, parseCard } from "../src/parser/parse.js";
callback-box/scratch/codex-out.md:1710:cardworks/test/parser.test.ts:216:test("parseCard handles a card with frontmatter and reports original-file lines", async (t) => {
callback-box/scratch/codex-out.md:1711:cardworks/test/parser.test.ts:218:  const result = await parseCard(text, { source: "frontmattered.card" });
callback-box/scratch/codex-out.md:1712:cardworks/test/parser.test.ts:226:test("parseCard is a no-op when there is no frontmatter", async (t) => {
callback-box/scratch/codex-out.md:1713:cardworks/test/parser.test.ts:228:  const result = await parseCard(text, { source: "plain.card" });
callback-box/scratch/codex-out.md:1714:callback-box/src/webapp/trpc/routers/todos.ts:9:import { CardLoader, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1715:callback-box/src/webapp/trpc/routers/todos.ts:22:      const loader = new CardLoader(ctx.boxRoot);
callback-box/scratch/codex-out.md:1716:callback-box/src/webapp/trpc/routers/todos.ts:35:      function updateInChildren(children: ElementNode[]): boolean {
callback-box/scratch/codex-out.md:1717:callback-box/src/webapp/trpc/routers/todos.ts:47:            if (updateInChildren(child.children as ElementNode[])) return true;
callback-box/scratch/codex-out.md:1718:callback-box/src/webapp/trpc/routers/todos.ts:53:      const found = updateInChildren((card.element.children ?? []) as ElementNode[]);
callback-box/scratch/codex-out.md:1719:cardworks/src/schema/registry.ts:2:import type { ElementSchema } from "./element.js";
callback-box/scratch/codex-out.md:1722:cardworks/src/schema/registry.ts:15:  constructor(schemas?: ElementSchema[]) {
callback-box/scratch/codex-out.md:1723:cardworks/src/schema/registry.ts:25:   * @param schema - The ElementSchema to register (must have .tagName)
callback-box/scratch/codex-out.md:1724:cardworks/src/schema/registry.ts:27:  register(schema: ElementSchema): void {
callback-box/scratch/codex-out.md:1728:callback-box/scripts/migrate/memo.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1729:callback-box/scripts/migrate/memo.ts:57:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:1730:callback-box/scripts/migrate/memo.ts:61:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:1731:callback-box/scripts/migrate/memo.ts:68:function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scratch/codex-out.md:1732:callback-box/scripts/migrate/memo.ts:122:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:1734:cardworks/test/schema.test.ts:4:import type { ElementNode } from "../src/parser/provenance.js";
callback-box/scratch/codex-out.md:1735:cardworks/test/schema.test.ts:7:function makeNode(partial: Partial<ElementNode> & { tagName: string }): ElementNode {
callback-box/scratch/codex-out.md:1739:callback-box/src/core/preactions/index.ts:11: * - Phase 1 XML-bodied cards (loaded via cardworks ICardLoader)
callback-box/scratch/codex-out.md:1740:callback-box/src/core/preactions/index.ts:21:import type { ICardLoader } from "cardworks";
callback-box/scratch/codex-out.md:1741:callback-box/src/core/preactions/index.ts:50:  loader: ICardLoader;
callback-box/scratch/codex-out.md:1742:callback-box/src/core/preactions/index.ts:91:  loader: ICardLoader;
callback-box/scratch/codex-out.md:1745:cardworks/src/schema/element.ts:7:export interface ElementSchema<T = unknown> extends ZodType<T> {
callback-box/scratch/codex-out.md:1746:cardworks/src/schema/element.ts:15: * Base schema for any ElementNode without tag-specific validation.
callback-box/scratch/codex-out.md:1750:cardworks/src/schema/element.ts:82:): ElementSchema<{
callback-box/scratch/codex-out.md:1752:cardworks/src/schema/element.ts:124:  const schemaWithTag = schema.passthrough() as unknown as ElementSchema<{
callback-box/scratch/codex-out.md:1753:callback-box/src/core/preactions/types.ts:1:import type { Card, ICardLoader, CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:1754:callback-box/src/core/preactions/types.ts:19:  loader: ICardLoader;
callback-box/scratch/codex-out.md:1755:cardworks/src/loader/loader.ts:2:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1756:cardworks/src/loader/loader.ts:3:import { parseCard } from "../parser/parse.js";
callback-box/scratch/codex-out.md:1759:cardworks/src/loader/loader.ts:19:  CardLoaderOptions,
callback-box/scratch/codex-out.md:1760:cardworks/src/loader/loader.ts:21:  ICardLoader,
callback-box/scratch/codex-out.md:1761:cardworks/src/loader/loader.ts:22:  MemoryCardLoaderOptions,
callback-box/scratch/codex-out.md:1762:cardworks/src/loader/loader.ts:27:  CardLoaderOptions,
callback-box/scratch/codex-out.md:1763:cardworks/src/loader/loader.ts:29:  ICardLoader,
callback-box/scratch/codex-out.md:1764:cardworks/src/loader/loader.ts:30:  MemoryCardLoaderOptions,
callback-box/scratch/codex-out.md:1767:cardworks/src/loader/loader.ts:79:  options?: CardLoaderOptions;
callback-box/scratch/codex-out.md:1768:cardworks/src/loader/loader.ts:85:abstract class BaseCardLoader implements ICardLoader {
callback-box/scratch/codex-out.md:1774:cardworks/src/loader/loader.ts:119:  protected prepareForSave(element: ElementNode): ElementNode {
callback-box/scratch/codex-out.md:1775:cardworks/src/loader/loader.ts:135:   * @param element - The ElementNode to serialize
callback-box/scratch/codex-out.md:1776:cardworks/src/loader/loader.ts:138:  serialize(element: ElementNode): string {
callback-box/scratch/codex-out.md:1778:cardworks/src/loader/loader.ts:153:    const node = await parseCard(content, { source: path });
callback-box/scratch/codex-out.md:1786:cardworks/src/loader/loader.ts:262:  async validateContent(content: string, sourceName?: string): Promise<ElementNode> {
callback-box/scratch/codex-out.md:1787:cardworks/src/loader/loader.ts:264:    const node = await parseCard(content, { source: sourceName });
callback-box/scratch/codex-out.md:1788:cardworks/src/loader/loader.ts:331:        const node = await parseCard(content, { source: cardPath });
callback-box/scratch/codex-out.md:1791:cardworks/src/loader/loader.ts:388:        const node = await parseCard(content, { source: cardPath });
callback-box/scratch/codex-out.md:1792:cardworks/src/loader/loader.ts:414:    const node = await parseCard(content, { source: sourcePath });
callback-box/scratch/codex-out.md:1793:cardworks/src/loader/loader.ts:431: * const loader = new CardLoader("/path/to/project", {
callback-box/scratch/codex-out.md:1794:cardworks/src/loader/loader.ts:437:export class CardLoader extends BaseCardLoader {
callback-box/scratch/codex-out.md:1795:cardworks/src/loader/loader.ts:438:  constructor(projectRoot: string, options?: CardLoaderOptions) {
callback-box/scratch/codex-out.md:1796:cardworks/src/loader/loader.ts:448: * const loader = new MemoryCardLoader("/project", {
callback-box/scratch/codex-out.md:1797:cardworks/src/loader/loader.ts:457:export class MemoryCardLoader extends BaseCardLoader {
callback-box/scratch/codex-out.md:1798:cardworks/src/loader/loader.ts:460:  constructor(projectRoot: string, options?: MemoryCardLoaderOptions) {
callback-box/scratch/codex-out.md:1799:callback-box/scripts/migrate/scheduled-script.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1800:callback-box/scripts/migrate/scheduled-script.ts:29:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scratch/codex-out.md:1801:callback-box/scripts/migrate/scheduled-script.ts:75:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:1802:callback-box/scripts/migrate/scheduled-script.ts:82:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:1803:callback-box/scripts/migrate/scheduled-script.ts:158:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:1806:callback-box/src/core/preactions/transcribe.ts:18:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1807:callback-box/src/core/preactions/transcribe.ts:165:function hasXmlTranscription(element: ElementNode): boolean {
callback-box/scratch/codex-out.md:1808:callback-box/src/core/preactions/transcribe.ts:170:function hasXmlPermanentError(element: ElementNode): boolean {
callback-box/scratch/codex-out.md:1809:callback-box/src/core/preactions/transcribe.ts:175:function getXmlContent(element: ElementNode): string | null {
callback-box/scratch/codex-out.md:1810:callback-box/src/core/preactions/transcribe.ts:181:  element: ElementNode;
callback-box/scratch/codex-out.md:1811:callback-box/src/core/preactions/transcribe.ts:204:  element: ElementNode,
callback-box/scratch/codex-out.md:1813:cardworks/src/loader/ref-traversal.ts:2:import type { ElementNode } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1814:cardworks/src/loader/ref-traversal.ts:29:  node: ElementNode,
callback-box/scratch/codex-out.md:1815:cardworks/src/loader/ref-traversal.ts:145:  node: ElementNode,
callback-box/scratch/codex-out.md:1816:callback-box/scripts/migrate/procedure-run.ts:17:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1817:callback-box/scripts/migrate/procedure-run.ts:46:function text(el: ElementNode): string {
callback-box/scratch/codex-out.md:1818:callback-box/scripts/migrate/procedure-run.ts:50:function childText(el: ElementNode, tag: string): string | undefined {
callback-box/scratch/codex-out.md:1819:callback-box/scripts/migrate/procedure-run.ts:57:function copyAttr(from: ElementNode, name: string, into: Record<string, unknown>, key: string): void {
callback-box/scratch/codex-out.md:1820:callback-box/scripts/migrate/procedure-run.ts:62:function convertPhase(phase: ElementNode | undefined, kind: "precheck" | "run" | "validate"): Record<string, unknown> | undefined {
callback-box/scratch/codex-out.md:1821:callback-box/scripts/migrate/procedure-run.ts:81:function convertStep(step: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1823:callback-box/scripts/migrate/procedure-run.ts:105:    const root = await parseCard(content, { source: absPath });
callback-box/scratch/codex-out.md:1824:callback-box/src/webapp/trpc/routers/card.ts:7:import { parseCard, splitCardContent, type CardSchema, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1826:callback-box/src/webapp/trpc/routers/card.ts:22:function sanitizeElement(el: ElementNode): JsonElement {
callback-box/scratch/codex-out.md:1827:callback-box/src/webapp/trpc/routers/card.ts:31:    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/scratch/codex-out.md:1828:callback-box/src/webapp/trpc/routers/card.ts:39:function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
callback-box/scratch/codex-out.md:1829:callback-box/src/webapp/trpc/routers/card.ts:41:  let current: ElementNode = el;
callback-box/scratch/codex-out.md:1830:callback-box/src/webapp/trpc/routers/card.ts:55: * Parse a simple XML fragment into an ElementNode.
callback-box/scratch/codex-out.md:1831:callback-box/src/webapp/trpc/routers/card.ts:57:function parseXmlFragment(xml: string): ElementNode | null {
callback-box/scratch/codex-out.md:1832:callback-box/src/webapp/trpc/routers/card.ts:79:  } as ElementNode;
callback-box/scratch/codex-out.md:1843:callback-box/src/webapp/trpc/routers/card.ts:248:          const parsed = await parseCard(rawXml, { source: input.path });
callback-box/scratch/codex-out.md:1875:cardworks/src/parser/dom-to-object.ts:1:import type { ElementNode, Location, Comments, MixedContent } from "./provenance.js";
callback-box/scratch/codex-out.md:1876:cardworks/src/parser/dom-to-object.ts:145: * Transform a DOM element to an ElementNode.
callback-box/scratch/codex-out.md:1877:cardworks/src/parser/dom-to-object.ts:150:): ElementNode {
callback-box/scratch/codex-out.md:1878:cardworks/src/parser/dom-to-object.ts:167:  const children: ElementNode[] = [];
callback-box/scratch/codex-out.md:1879:cardworks/src/parser/dom-to-object.ts:222:  const result: ElementNode = {
callback-box/scratch/codex-out.md:1882:callback-box/test/card-lint.doctest.md:14:  type ElementSchema,
callback-box/scratch/codex-out.md:1883:callback-box/test/card-lint.doctest.md:15:} from "cardworks";
callback-box/scratch/codex-out.md:1888:callback-box/test/card-lint.doctest.md:43:const memoSchema: ElementSchema = element("memo", {
callback-box/scratch/codex-out.md:1890:callback-box/test/card-lint.doctest.md:54:  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
callback-box/scratch/codex-out.md:1898:callback-box/test/card-lint.doctest.md:240:## XML cards still flow through the existing cardworks lintCard path
callback-box/scratch/codex-out.md:1906:callback-box/scripts/migrate/question.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1907:callback-box/scripts/migrate/question.ts:27:function checkUnknown(node: ElementNode, source: string): void {
callback-box/scratch/codex-out.md:1908:callback-box/scripts/migrate/question.ts:78:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:1909:callback-box/scripts/migrate/question.ts:85:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:1910:callback-box/scripts/migrate/question.ts:153:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:1911:cardworks/src/parser/parse.ts:2:import type { ElementNode, Location } from "./provenance.js";
callback-box/scratch/codex-out.md:1913:cardworks/src/parser/parse.ts:49: * Parse XML content into an ElementNode tree.
callback-box/scratch/codex-out.md:1914:cardworks/src/parser/parse.ts:53: * @returns The parsed ElementNode tree
callback-box/scratch/codex-out.md:1915:cardworks/src/parser/parse.ts:56:export function parseXml(xml: string, options: ParseXmlOptions): Promise<ElementNode> {
callback-box/scratch/codex-out.md:1916:cardworks/src/parser/parse.ts:139:): Promise<ElementNode> {
callback-box/scratch/codex-out.md:1917:cardworks/src/parser/parse.ts:141:  return parseCard(content, { source: path });
callback-box/scratch/codex-out.md:1918:cardworks/src/parser/parse.ts:151:export function parseCard(content: string, options: ParseXmlOptions): Promise<ElementNode> {
callback-box/scratch/codex-out.md:1920:callback-box/src/core/landmark/resolve.ts:12:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:1925:callback-box/test/schemas.doctest.md:18:import { parseCard } from "cardworks";
callback-box/scratch/codex-out.md:1928:callback-box/scripts/migrate/_warnings.ts:18:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1929:callback-box/scripts/migrate/_warnings.ts:49:  node: ElementNode;
callback-box/scratch/codex-out.md:1930:callback-box/src/webapp/trpc/routers/chat.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1931:callback-box/src/webapp/trpc/routers/chat.ts:43:function findNavigation(element: ElementNode): ElementNode | null {
callback-box/scratch/codex-out.md:1932:callback-box/src/webapp/trpc/routers/chat.ts:50:function readChildText(navigation: ElementNode | null, tagName: string): string {
callback-box/scratch/codex-out.md:1933:callback-box/src/webapp/trpc/routers/chat.ts:61:  navigation: ElementNode | null,
callback-box/scratch/codex-out.md:1934:callback-box/src/webapp/trpc/routers/chat.ts:100:    let element: ElementNode;
callback-box/scratch/codex-out.md:1935:callback-box/src/webapp/trpc/routers/chat.ts:103:      element = await parseCard(content, { source: absPath });
callback-box/scratch/codex-out.md:1936:cardworks/src/parser/provenance.ts:37:export type MixedContent = string | ElementNode | MixedComment;
callback-box/scratch/codex-out.md:1937:cardworks/src/parser/provenance.ts:42:export interface ElementNode {
callback-box/scratch/codex-out.md:1938:cardworks/src/parser/provenance.ts:54:  children: ElementNode[];
callback-box/scratch/codex-out.md:1948:cardworks/src/serialize/serialize.ts:1:import type { ElementNode, MixedContent, MixedComment } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:1950:cardworks/src/serialize/serialize.ts:35: * Serialize an ElementNode back to XML string.
callback-box/scratch/codex-out.md:1951:cardworks/src/serialize/serialize.ts:37: * @param node - The ElementNode to serialize
callback-box/scratch/codex-out.md:1953:cardworks/src/serialize/serialize.ts:42:  node: ElementNode,
callback-box/scratch/codex-out.md:1957:cardworks/src/serialize/serialize.ts:72:  node: ElementNode,
callback-box/scratch/codex-out.md:1974:callback-box/src/webapp/trpc/routers/scheduler.ts:10:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:1978:callback-box/src/webapp/routes/views.ts:21:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1979:callback-box/src/webapp/routes/views.ts:28:function elementToViewCardChild(el: ElementNode): ViewCardChild {
callback-box/scratch/codex-out.md:1980:callback-box/src/webapp/routes/views.ts:38:      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
callback-box/scratch/codex-out.md:1982:callback-box/src/webapp/routes/views.ts:187:      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
callback-box/scratch/codex-out.md:1983:callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:1985:callback-box/test/contains-state.doctest.md:26:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/scratch/codex-out.md:1987:callback-box/scripts/migrate/procedure.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:1988:callback-box/scripts/migrate/procedure.ts:50:function dtext(el: ElementNode): string {
callback-box/scratch/codex-out.md:1989:callback-box/scripts/migrate/procedure.ts:54:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:1990:callback-box/scripts/migrate/procedure.ts:58:function convertPhase(phase: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1991:callback-box/scripts/migrate/procedure.ts:84:function convertStep(step: ElementNode): Record<string, unknown> {
callback-box/scratch/codex-out.md:1993:callback-box/scripts/migrate/procedure.ts:123:    const root = await parseCard(content, { source: absPath });
callback-box/scratch/codex-out.md:1995:callback-box/test/card-io.doctest.md:14:  type ElementSchema,
callback-box/scratch/codex-out.md:1996:callback-box/test/card-io.doctest.md:15:} from "cardworks";
callback-box/scratch/codex-out.md:2011:callback-box/test/card-io.doctest.md:136:const xmlMemo: ElementSchema = element("memo", {
callback-box/scratch/codex-out.md:2013:callback-box/test/card-io.doctest.md:145:  elementSchemas: new Map<string, ElementSchema>([
callback-box/scratch/codex-out.md:2015:callback-box/CODE-STYLE.md:55:- **`as` type assertions are like Rust's `unsafe`** (banned in `.tsx` by lint, discouraged everywhere): allowed only when genuinely necessary — e.g. at a parse boundary where data arrives untyped. When you need one, either guard it with an `// eslint-disable-next-line no-restricted-syntax -- <why it's sound>` comment, or centralize the cast in a single well-named typed helper (`getChildren(el): ElementNode[]`) that does it once and is reused. Never sprinkle bare `as` to silence the type checker. (`as const` is always fine.)
callback-box/scratch/codex-out.md:2016:callback-box/src/webapp/routes/api-card-patch.ts:12:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2017:callback-box/src/webapp/routes/api-card-patch.ts:25:export function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
callback-box/scratch/codex-out.md:2018:callback-box/src/webapp/routes/api-card-patch.ts:27:  let current: ElementNode = el;
callback-box/scratch/codex-out.md:2019:callback-box/src/webapp/routes/api-card-patch.ts:41: * Parse a simple XML fragment like `<tag attr="val">text</tag>` into an ElementNode.
callback-box/scratch/codex-out.md:2020:callback-box/src/webapp/routes/api-card-patch.ts:44:export function parseXmlFragment(xml: string): ElementNode | null {
callback-box/scratch/codex-out.md:2021:callback-box/src/webapp/routes/api-card-patch.ts:66:  } as ElementNode;
callback-box/scratch/codex-out.md:2022:callback-box/src/webapp/routes/api-card-patch.ts:80: * Convert an ElementNode to a JSON-safe structure.
callback-box/scratch/codex-out.md:2023:callback-box/src/webapp/routes/api-card-patch.ts:82:export function sanitizeElement(el: ElementNode): JsonElement {
callback-box/scratch/codex-out.md:2024:callback-box/src/webapp/routes/api-card-patch.ts:102:    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/scratch/codex-out.md:2027:callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2035:callback-box/src/core/box-templates.ts:86:import { cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2038:callback-box/src/core/box-templates.ts:133:import { element } from "cardworks";
callback-box/scratch/codex-out.md:2043:callback-box/scripts/migrate/jobs.ts:18:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2044:callback-box/scripts/migrate/jobs.ts:102:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2045:callback-box/scripts/migrate/jobs.ts:106:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:2046:callback-box/scripts/migrate/jobs.ts:113:function convertIntakeJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:2047:callback-box/scripts/migrate/jobs.ts:135:function convertCalendarReviewJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:2048:callback-box/scripts/migrate/jobs.ts:165:function convertChatJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:2049:callback-box/scripts/migrate/jobs.ts:181:function convertQuestionFollowupJob(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:2050:callback-box/scripts/migrate/jobs.ts:198:const CONVERTERS: Record<Kind, (n: ElementNode, src: string) => Record<string, unknown>> = {
callback-box/scratch/codex-out.md:2051:callback-box/scripts/migrate/jobs.ts:210:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:2056:callback-box/scripts/migrate/file.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2057:callback-box/scripts/migrate/file.ts:53:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2058:callback-box/scripts/migrate/file.ts:57:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:2059:callback-box/scripts/migrate/file.ts:103:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:2064:callback-box/test/card-loaders.doctest.md:8:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2065:callback-box/test/card-loaders.doctest.md:10:function el(tagName: string, attrs: Record<string, string>, children: ElementNode[] = []): ElementNode {
callback-box/scratch/codex-out.md:2066:callback-box/test/card-loaders.doctest.md:18:  } as ElementNode;
callback-box/scratch/codex-out.md:2067:callback-box/test/card-loaders.doctest.md:21:function textChild(tagName: string, text: string): ElementNode {
callback-box/scratch/codex-out.md:2068:callback-box/test/card-loaders.doctest.md:22:  return { ...el(tagName, {}), text } as ElementNode;
callback-box/scratch/codex-out.md:2071:callback-box/src/core/init-rules.ts:90:  // both legacy XML schemas (ElementSchema with `tagName`) and phase-2
callback-box/scratch/codex-out.md:2074:callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:2076:callback-box/test/search-extract.doctest.md:21:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/scratch/codex-out.md:2081:callback-box/scripts/migrate/audio.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2082:callback-box/scripts/migrate/audio.ts:55:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2083:callback-box/scripts/migrate/audio.ts:59:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:2084:callback-box/scripts/migrate/audio.ts:112:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:2087:callback-box/test/box-schemas.doctest.md:34:const WIDGET_SCHEMA = `import { body, cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2090:callback-box/test/box-schemas.doctest.md:48:const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/scratch/codex-out.md:2093:callback-box/scripts/migrate/record-person.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2094:callback-box/scripts/migrate/record-person.ts:77:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2095:callback-box/scripts/migrate/record-person.ts:81:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:2096:callback-box/scripts/migrate/record-person.ts:88:function convertRecord(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scratch/codex-out.md:2097:callback-box/scripts/migrate/record-person.ts:182:function convertPerson(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scratch/codex-out.md:2098:callback-box/scripts/migrate/record-person.ts:221:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:2099:callback-box/src/schemas/guide-parse.tsx:10:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2101:callback-box/test/extfile-sync.doctest.md:12:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2103:callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:2106:callback-box/src/core/load-context.ts:13:  const elementSchemas = new Map<string, ElementSchema>();
callback-box/scratch/codex-out.md:2107:callback-box/src/core/load-context.ts:16:    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/scratch/codex-out.md:2111:callback-box/src/schemas/landmark.ts:27:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2114:callback-box/test/loader-registry.doctest.md:13:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2115:callback-box/test/loader-registry.doctest.md:15:function makeElement(tagName: string, attrs: Record<string, string>, text?: string): ElementNode {
callback-box/scratch/codex-out.md:2116:callback-box/test/loader-registry.doctest.md:24:  } as ElementNode;
callback-box/scratch/codex-out.md:2117:callback-box/scripts/migrate/recipe.ts:40:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2118:callback-box/scripts/migrate/recipe.ts:63:function text(el: ElementNode): string {
callback-box/scratch/codex-out.md:2119:callback-box/scripts/migrate/recipe.ts:67:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2120:callback-box/scripts/migrate/recipe.ts:71:function attrPart(el: ElementNode, name: string): string {
callback-box/scratch/codex-out.md:2121:callback-box/scripts/migrate/recipe.ts:77:function ingredientTag(ing: ElementNode): string {
callback-box/scratch/codex-out.md:2122:callback-box/scripts/migrate/recipe.ts:82:function sectionBody(section: ElementNode): string {
callback-box/scratch/codex-out.md:2124:callback-box/scripts/migrate/recipe.ts:134:    const root = await parseCard(content, { source: absPath });
callback-box/scratch/codex-out.md:2125:callback-box/scripts/migrate/briefing.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2126:callback-box/scripts/migrate/briefing.ts:104:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2127:callback-box/scripts/migrate/briefing.ts:108:function convertOne(node: ElementNode, source: string): { fields: BriefingOut; body: string } {
callback-box/scratch/codex-out.md:2128:callback-box/scripts/migrate/briefing.ts:197:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:2129:callback-box/src/schemas/guide-elements.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2140:callback-box/src/schemas/briefing.tsx:19:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2143:callback-box/scripts/migrate/email-thread.ts:43:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2144:callback-box/scripts/migrate/email-thread.ts:96:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2145:callback-box/scripts/migrate/email-thread.ts:100:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:2146:callback-box/scripts/migrate/email-thread.ts:106:  parent: ElementNode,
callback-box/scratch/codex-out.md:2147:callback-box/scripts/migrate/email-thread.ts:110:    pluck: (item: ElementNode) => string | undefined;
callback-box/scratch/codex-out.md:2148:callback-box/scripts/migrate/email-thread.ts:124:function convertOne(node: ElementNode, source: string): ThreadFields {
callback-box/scratch/codex-out.md:2149:callback-box/scripts/migrate/email-thread.ts:183:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:2150:callback-box/src/schemas/todo-list.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2156:callback-box/src/schemas/intake-job.tsx:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2158:callback-box/scripts/migrate/capture-session.ts:19:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2159:callback-box/scripts/migrate/capture-session.ts:43:function text(el: ElementNode): string {
callback-box/scratch/codex-out.md:2160:callback-box/scripts/migrate/capture-session.ts:47:function child(el: ElementNode, tag: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2161:callback-box/scripts/migrate/capture-session.ts:51:function refList(el: ElementNode | undefined, childTag: string): string[] {
callback-box/scratch/codex-out.md:2162:callback-box/scripts/migrate/capture-session.ts:62:function buildTranscriptBody(transcript: ElementNode | undefined): string {
callback-box/scratch/codex-out.md:2164:callback-box/scripts/migrate/capture-session.ts:89:    const root = await parseCard(content, { source: absPath });
callback-box/scratch/codex-out.md:2165:callback-box/scripts/migrate/email-message.ts:48:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2166:callback-box/scripts/migrate/email-message.ts:118:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2167:callback-box/scripts/migrate/email-message.ts:122:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scratch/codex-out.md:2168:callback-box/scripts/migrate/email-message.ts:127:function convertOne(node: ElementNode, source: string): MessageFields {
callback-box/scratch/codex-out.md:2169:callback-box/scripts/migrate/email-message.ts:194:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:2170:callback-box/docs/adding-schemas.md:23:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2178:callback-box/docs/adding-schemas.md:160:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2184:callback-box/scripts/migrate/repair-refs.ts:34:import { extractRefs, splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2186:callback-box/src/schemas/image.tsx:13:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2190:callback-box/scripts/migrate/image.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2191:callback-box/scripts/migrate/image.ts:61:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scratch/codex-out.md:2192:callback-box/scripts/migrate/image.ts:65:function convertOne(node: ElementNode, source: string): Record<string, unknown> {
callback-box/scratch/codex-out.md:2193:callback-box/scripts/migrate/image.ts:159:  const node = await parseCard(raw, { source: absPath });
callback-box/scratch/codex-out.md:2194:callback-box/src/core/commands/answer.ts:10:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2198:callback-box/docs/agent-knowledge.md:254:Agents can define new card types by creating `.ts` files in `config/schemas/`. Each file exports a default `ElementSchema` using the same `element()` + `z` (Zod) API as built-in schemas. Optionally, files can also export a `template` for `cb create`.
callback-box/scratch/codex-out.md:2199:callback-box/src/schemas/chat-thread.ts:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2208:callback-box/docs/EXAMPLE_FILES.md:561:import { element } from "cardworks";
callback-box/scratch/codex-out.md:2209:callback-box/docs/EXAMPLE_FILES.md:595:import { element } from "cardworks";
callback-box/scratch/codex-out.md:2210:callback-box/src/schemas/feedback.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2213:callback-box/scripts/migrate/card-frontmatter.ts:13: * transparently via `parseCard()`, so this migration is a no-op for readers
callback-box/scratch/codex-out.md:2220:callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2224:callback-box/src/schemas/recipe.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2227:callback-box/docs/cards-as-markdown.md:40:**Loader dispatch:** `src/core/card-io.ts` `loadCardFile()` returns a discriminated union of `FrontmatterLoadedCard | XmlLoadedCard`. Frontmatter dispatch uses `cardSchemas` (Map keyed by `type:` field); XML falls through to the legacy cardworks `parseCard`. This lets XML and frontmatter cards coexist during and after the migration.
callback-box/scratch/codex-out.md:2228:callback-box/src/schemas/memo.ts:9:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2231:callback-box/src/core/commands/move-operations.ts:16:import { CardLoader } from "cardworks";
callback-box/scratch/codex-out.md:2232:callback-box/src/core/commands/move-operations.ts:104:  const loader = new CardLoader(ctx.boxRoot);
callback-box/scratch/codex-out.md:2234:callback-box/src/core/commands/move-operations.ts:162:  loader: CardLoader;
callback-box/scratch/codex-out.md:2236:callback-box/src/core/commands/move-operations.ts:203:  loader: CardLoader;
callback-box/scratch/codex-out.md:2237:callback-box/src/core/commands/move-operations.ts:320:  const loader = new CardLoader(ctx.boxRoot);
callback-box/scratch/codex-out.md:2248:callback-box/src/connectors/preserve-agent-fields.ts:12:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2251:callback-box/src/schemas/registry.ts:5: * by the CardLoader factory. Box-local schemas from config/schemas/
callback-box/scratch/codex-out.md:2252:callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2253:callback-box/src/schemas/registry.ts:55:export const schemas: ElementSchema[] = [];
callback-box/scratch/codex-out.md:2257:callback-box/src/schemas/registry.ts:169:  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
callback-box/scratch/codex-out.md:2258:callback-box/src/schemas/registry.ts:170:  elementSchemas: ElementSchema[];
callback-box/scratch/codex-out.md:2261:callback-box/src/schemas/registry.ts:221:  const loadedElement: ElementSchema[] = [];
callback-box/scratch/codex-out.md:2262:callback-box/src/schemas/registry.ts:235:      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
callback-box/scratch/codex-out.md:2263:callback-box/src/schemas/registry.ts:236:      // Zod type carrying `.tagName`; check it first, because ElementSchema also
callback-box/scratch/codex-out.md:2267:callback-box/src/schemas/registry.ts:260:function isElementSchema(def: unknown): def is ElementSchema {
callback-box/scratch/codex-out.md:2268:callback-box/src/schemas/registry.ts:261:  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
callback-box/scratch/codex-out.md:2272:callback-box/src/schemas/registry.ts:297:export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
callback-box/scratch/codex-out.md:2282:callback-box/src/core/commands/ls.ts:11:import { type ElementNode, parseCard, evaluateXPathString } from "cardworks";
callback-box/scratch/codex-out.md:2283:callback-box/src/core/commands/ls.ts:72:function applyTemplate(template: string, rootNode: ElementNode): string {
callback-box/scratch/codex-out.md:2284:callback-box/src/core/commands/ls.ts:74:    return evaluateXPathString(expr, rootNode);
callback-box/scratch/codex-out.md:2285:callback-box/src/core/commands/ls.ts:117:      const root = await parseCard(content, { source: filePath });
callback-box/scratch/codex-out.md:2290:callback-box/docs/implemented-plans/box-search.md:169:  config and XML `ElementSchema`) gain `searchable?: boolean` (default
callback-box/scratch/codex-out.md:2294:callback-box/docs/implemented-plans/box-search.md:186:  the resolved `CardSchema`/`ElementSchema` object. Operational schemas set
callback-box/scratch/codex-out.md:2297:callback-box/src/schemas/personality.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2302:callback-box/scratch/codex-prompt.txt:10:1. Is `schemas[]` (the XML ElementSchema list in callback-box/src/schemas/registry.ts) actually empty, and are the "dead path" claims real — card-io.ts loadXmlCard branch, search/extract.ts xmlDoc, ls.ts evaluateXPathString, the CardLoader users (move-operations.ts, cli/lib/loader.ts, todos.ts)? Is any "dead" path actually still reachable?
callback-box/scratch/codex-out.md:2303:callback-box/scratch/codex-prompt.txt:11:2. Is the keep-set's "zero transitive XML dependencies" claim true? Read cardworks/src/schema/card-schema.ts, parser/frontmatter.ts, schema/registry.ts, lint/format.ts (and the lint types it needs) — do any transitively import ElementNode / the XML parser / xpath?
callback-box/scratch/codex-out.md:2304:callback-box/src/schemas/procedure-run.ts:8:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2314:callback-box/src/schemas/question.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2320:callback-box/scratch/codex-out.md:22:1. Is `schemas[]` (the XML ElementSchema list in callback-box/src/schemas/registry.ts) actually empty, and are the "dead path" claims real — card-io.ts loadXmlCard branch, search/extract.ts xmlDoc, ls.ts evaluateXPathString, the CardLoader users (move-operations.ts, cli/lib/loader.ts, todos.ts)? Is any "dead" path actually still reachable?
callback-box/scratch/codex-out.md:2321:callback-box/scratch/codex-out.md:23:2. Is the keep-set's "zero transitive XML dependencies" claim true? Read cardworks/src/schema/card-schema.ts, parser/frontmatter.ts, schema/registry.ts, lint/format.ts (and the lint types it needs) — do any transitively import ElementNode / the XML parser / xpath?
callback-box/scratch/codex-out.md:2322:callback-box/scratch/codex-out.md:40:     4	now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
callback-box/scratch/codex-out.md:2324:callback-box/scratch/codex-out.md:42:     6	`CardLoader`, the XML element schema — has no real users. This plan removes
callback-box/scratch/codex-out.md:2333:callback-box/scratch/codex-out.md:91:    55	  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
callback-box/scratch/codex-out.md:2335:callback-box/scratch/codex-out.md:105:    69	  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
callback-box/scratch/codex-out.md:2336:callback-box/scratch/codex-out.md:130:    94	XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
callback-box/scratch/codex-out.md:2337:callback-box/scratch/codex-out.md:131:    95	`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
callback-box/scratch/codex-out.md:2338:callback-box/scratch/codex-out.md:132:    96	`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
callback-box/scratch/codex-out.md:2339:callback-box/scratch/codex-out.md:146:   110	  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
callback-box/scratch/codex-out.md:2340:callback-box/scratch/codex-out.md:147:   111	  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
callback-box/scratch/codex-out.md:2341:callback-box/scratch/codex-out.md:153:   117	  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
callback-box/scratch/codex-out.md:2342:callback-box/scratch/codex-out.md:154:   118	- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
callback-box/scratch/codex-out.md:2343:callback-box/scratch/codex-out.md:155:   119	  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
callback-box/scratch/codex-out.md:2344:callback-box/scratch/codex-out.md:156:   120	  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
callback-box/scratch/codex-out.md:2346:callback-box/scratch/codex-out.md:163:   127	- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
callback-box/scratch/codex-out.md:2347:callback-box/scratch/codex-out.md:165:   129	  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
callback-box/scratch/codex-out.md:2348:callback-box/scratch/codex-out.md:173:   137	`chat.ts` reading a now-frontmatter landmark via `parseCard`,
callback-box/scratch/codex-out.md:2349:callback-box/scratch/codex-out.md:174:   138	`generate-docs-compile.ts:47` parsing a procedure via `parseCard`) surfaces
callback-box/scratch/codex-out.md:2350:callback-box/scratch/codex-out.md:187:   151	keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/scratch/codex-out.md:2360:callback-box/scratch/codex-out.md:214:   178	find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/scratch/codex-out.md:2362:callback-box/scratch/codex-out.md:237:   201	`parseCard`); once every box is migrated (decided: box-migration-first) they
callback-box/scratch/codex-out.md:2363:callback-box/scratch/codex-out.md:241:   205	`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/scratch/codex-out.md:2364:callback-box/scratch/codex-out.md:264:   228	| A stale consumer reads a frontmatter card via deleted `parseCard` | Partial | Yes — `tsc` fails to compile once the symbol is gone | Clear (compile error) |
callback-box/scratch/codex-out.md:2369:callback-box/scratch/codex-out.md:579:   317	   fallback) and the type-only `ElementNode`/`ElementSchema`/`Card` carriers.
callback-box/scratch/codex-out.md:2370:callback-box/scratch/codex-out.md:580:   318	3. **Track A, chunk 3** — rewrite the live `CardLoader` users
callback-box/scratch/codex-out.md:2371:callback-box/scratch/codex-out.md:585:   323	   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/scratch/codex-out.md:2373:callback-box/src/schemas/commentary.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2379:callback-box/src/cli/commands/validate.ts:10:import { formatLintResults, type LintSummary } from "cardworks";
callback-box/scratch/codex-out.md:2387:callback-box/src/schemas/audio.tsx:12:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2393:callback-box/src/schemas/email-outbound.tsx:34:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2407:callback-box/src/schemas/gdoc.tsx:18:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2411:callback-box/src/connectors/chat-utils.ts:15:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2444:callback-box/src/schemas/procedure.ts:11:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2447:callback-box/src/core/commands/assemble-timeline-helpers.ts:5:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2452:callback-box/src/connectors/intake-utils.ts:17:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2455:callback-box/docs/plans/remove-cardworks-and-xml.md:24:> `schemas[]` (the XML `ElementSchema` list) is now empty.
callback-box/scratch/codex-out.md:2457:callback-box/docs/plans/remove-cardworks-and-xml.md:28:> the XML parser, JSX runtime, and `evaluateXPathString` have no users.
callback-box/scratch/codex-out.md:2459:callback-box/docs/plans/remove-cardworks-and-xml.md:81:  *"export const schemas: ElementSchema[] = [ ProcedureSchema,
callback-box/scratch/codex-out.md:2462:callback-box/docs/plans/remove-cardworks-and-xml.md:88:  the `ElementSchema` machinery is deleted.
callback-box/scratch/codex-out.md:2463:callback-box/docs/plans/remove-cardworks-and-xml.md:122:  `evaluateXPathString`. **Rebuild/remove** — see the Landmark track and
callback-box/scratch/codex-out.md:2472:callback-box/docs/plans/remove-cardworks-and-xml.md:376:helpers.ts` rewritten to emit body-tag strings instead of `ElementNode`s;
callback-box/scratch/codex-out.md:2473:callback-box/docs/plans/remove-cardworks-and-xml.md:393:`ElementSchema` registry plumbing, the search `xmlDoc()` path, the
callback-box/scratch/codex-out.md:2474:callback-box/docs/plans/remove-cardworks-and-xml.md:394:frontend `ElementNode`/`CardTreeView` rendering, and update the LLM
callback-box/scratch/codex-out.md:2480:callback-box/docs/plans/remove-cardworks-and-xml.md:445:so `evaluateXPathString` is never exercised by any card in practice. The
callback-box/scratch/codex-out.md:2481:callback-box/docs/plans/remove-cardworks-and-xml.md:449:**Decision (no query language).** Replace `evaluateXPathString` with a
callback-box/scratch/codex-out.md:2486:callback-box/docs/boxes-as-packages.md:17:2. **Schemas are a stub package.** `config/schemas/package.json` is `{"type":"module"}` with no dependencies. To define a real schema the agent would want `import { z } from "zod"; import { element } from "cardworks";` — same as built-in schemas in `src/schemas/`. Today this works only by accident (transitive resolution from the callback-box install) and gives no IDE help inside the box.
callback-box/scratch/codex-out.md:2489:callback-box/src/schemas/capture-session.tsx:15:import { splitCardContent, body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2497:callback-box/docs/attach-implementation.md:69:Look at `src/core/CardLoader` (or wherever the file walker is) — needs scope-awareness for path resolution. No recursion-skipping for `.attach/`.
callback-box/scratch/codex-out.md:2506:callback-box/src/core/card-lint.ts:7: * else falls through to cardworks' existing XML lintCard. Results are
callback-box/scratch/codex-out.md:2507:callback-box/src/core/card-lint.ts:19:  lintCard,
callback-box/scratch/codex-out.md:2509:callback-box/src/core/card-lint.ts:25:  type ICardLoader,
callback-box/scratch/codex-out.md:2510:callback-box/src/core/card-lint.ts:27:} from "cardworks";
callback-box/scratch/codex-out.md:2512:callback-box/src/core/card-lint.ts:41:  loader: ICardLoader;
callback-box/scratch/codex-out.md:2516:callback-box/src/core/card-lint.ts:92:  return lintCard(options.loader, { path });
callback-box/scratch/codex-out.md:2523:callback-box/src/schemas/email-message.tsx:30:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2525:callback-box/src/connectors/gmail-drafts.ts:19:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2532:callback-box/src/schemas/file.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2536:callback-box/src/core/generate-docs.ts:343:    // Per-schema generated docs cover both legacy XML schemas (ElementSchema
callback-box/scratch/codex-out.md:2539:callback-box/src/core/generate-docs-compile.ts:12:import { parseCard } from "cardworks";
callback-box/scratch/codex-out.md:2541:callback-box/src/core/generate-docs-compile.ts:47:      const root = await parseCard(content, { source: filename });
callback-box/scratch/codex-out.md:2544:callback-box/src/schemas/email-thread.tsx:29:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2570:callback-box/src/schemas/person.tsx:11:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2574:callback-box/src/core/file-summary.ts:13:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2575:callback-box/src/core/file-summary.ts:36:  element?: ElementNode;
callback-box/scratch/codex-out.md:2580:callback-box/src/schemas/sheet.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2582:callback-box/src/schemas/question-followup-job.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2584:callback-box/src/schemas/telegram-message.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2587:callback-box/docs/plans/remove-cardworks-package.md:4:now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
callback-box/scratch/codex-out.md:2589:callback-box/docs/plans/remove-cardworks-package.md:6:`CardLoader`, the XML element schema — has no real users. This plan removes
callback-box/scratch/codex-out.md:2598:callback-box/docs/plans/remove-cardworks-package.md:55:  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
callback-box/scratch/codex-out.md:2600:callback-box/docs/plans/remove-cardworks-package.md:69:  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
callback-box/scratch/codex-out.md:2601:callback-box/docs/plans/remove-cardworks-package.md:94:XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
callback-box/scratch/codex-out.md:2602:callback-box/docs/plans/remove-cardworks-package.md:95:`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
callback-box/scratch/codex-out.md:2603:callback-box/docs/plans/remove-cardworks-package.md:96:`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
callback-box/scratch/codex-out.md:2604:callback-box/docs/plans/remove-cardworks-package.md:110:  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
callback-box/scratch/codex-out.md:2605:callback-box/docs/plans/remove-cardworks-package.md:111:  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
callback-box/scratch/codex-out.md:2606:callback-box/docs/plans/remove-cardworks-package.md:117:  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
callback-box/scratch/codex-out.md:2607:callback-box/docs/plans/remove-cardworks-package.md:118:- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
callback-box/scratch/codex-out.md:2608:callback-box/docs/plans/remove-cardworks-package.md:119:  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
callback-box/scratch/codex-out.md:2609:callback-box/docs/plans/remove-cardworks-package.md:120:  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
callback-box/scratch/codex-out.md:2611:callback-box/docs/plans/remove-cardworks-package.md:127:- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
callback-box/scratch/codex-out.md:2612:callback-box/docs/plans/remove-cardworks-package.md:129:  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
callback-box/scratch/codex-out.md:2613:callback-box/docs/plans/remove-cardworks-package.md:137:`chat.ts` reading a now-frontmatter landmark via `parseCard`,
callback-box/scratch/codex-out.md:2614:callback-box/docs/plans/remove-cardworks-package.md:138:`generate-docs-compile.ts:47` parsing a procedure via `parseCard`) surfaces
callback-box/scratch/codex-out.md:2615:callback-box/docs/plans/remove-cardworks-package.md:151:keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/scratch/codex-out.md:2625:callback-box/docs/plans/remove-cardworks-package.md:178:find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/scratch/codex-out.md:2627:callback-box/docs/plans/remove-cardworks-package.md:201:`parseCard`); once every box is migrated (decided: box-migration-first) they
callback-box/scratch/codex-out.md:2628:callback-box/docs/plans/remove-cardworks-package.md:205:`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/scratch/codex-out.md:2629:callback-box/docs/plans/remove-cardworks-package.md:228:| A stale consumer reads a frontmatter card via deleted `parseCard` | Partial | Yes — `tsc` fails to compile once the symbol is gone | Clear (compile error) |
callback-box/scratch/codex-out.md:2634:callback-box/docs/plans/remove-cardworks-package.md:317:   fallback) and the type-only `ElementNode`/`ElementSchema`/`Card` carriers.
callback-box/scratch/codex-out.md:2635:callback-box/docs/plans/remove-cardworks-package.md:318:3. **Track A, chunk 3** — rewrite the live `CardLoader` users
callback-box/scratch/codex-out.md:2636:callback-box/docs/plans/remove-cardworks-package.md:323:   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/scratch/codex-out.md:2637:callback-box/src/schemas/webpage.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2641:callback-box/src/core/search/contains-update.ts:11:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2645:callback-box/src/core/card-io.ts:23:  parseCard,
callback-box/scratch/codex-out.md:2646:callback-box/src/core/card-io.ts:25:  type ElementSchema,
callback-box/scratch/codex-out.md:2647:callback-box/src/core/card-io.ts:26:  type ElementNode,
callback-box/scratch/codex-out.md:2648:callback-box/src/core/card-io.ts:27:} from "cardworks";
callback-box/scratch/codex-out.md:2652:callback-box/src/core/card-io.ts:298:  readonly schema: ElementSchema | undefined;
callback-box/scratch/codex-out.md:2653:callback-box/src/core/card-io.ts:299:  readonly element: ElementNode;
callback-box/scratch/codex-out.md:2655:callback-box/src/core/card-io.ts:305:  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
callback-box/scratch/codex-out.md:2656:callback-box/src/core/card-io.ts:306:  elementSchemas: Map<string, ElementSchema>;
callback-box/scratch/codex-out.md:2657:callback-box/src/core/card-io.ts:316: *   tag's ElementSchema (if any) is used for validation.
callback-box/scratch/codex-out.md:2661:callback-box/src/core/card-io.ts:376:  const element = await parseCard(content, { source });
callback-box/scratch/codex-out.md:2662:callback-box/src/schemas/calendar-review-job.tsx:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2670:callback-box/src/core/search/refresh-file.ts:10:import { ParseError } from "cardworks";
callback-box/scratch/codex-out.md:2671:callback-box/src/schemas/chat-job.ts:10:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2673:callback-box/src/core/procedure/engine-run-card.ts:12:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2682:callback-box/src/core/search/extract.ts:19:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:2683:callback-box/src/core/search/extract.ts:290:function collectElementText(node: ElementNode): string {
callback-box/scratch/codex-out.md:2684:callback-box/src/core/search/extract.ts:292:  const visit = (n: ElementNode): void => {
callback-box/scratch/codex-out.md:2687:callback-box/src/core/search/extract.ts:308:function isElementNode(value: unknown): value is ElementNode {
callback-box/scratch/codex-out.md:2690:callback-box/src/core/sdk-hooks.ts:14:import { formatLintResults } from "cardworks";
callback-box/scratch/codex-out.md:2695:callback-box/src/schemas/record.tsx:12:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2698:callback-box/src/schemas/scheduled-script.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2700:callback-box/src/schemas/doc.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2703:callback-box/src/frontend/src/renderers/image.tsx:18:import type { ElementNode } from "../api";
callback-box/scratch/codex-out.md:2704:callback-box/src/frontend/src/renderers/image.tsx:36:function parseImageCard(element: ElementNode): ParsedImageCard {
callback-box/scratch/codex-out.md:2705:callback-box/src/frontend/src/renderers/image.tsx:37:  const children = (element.children || []) as ElementNode[];
callback-box/scratch/codex-out.md:2706:callback-box/src/frontend/src/renderers/image.tsx:74:  const card = parseImageCard(data.element as ElementNode);
callback-box/scratch/codex-out.md:2707:callback-box/src/schemas/extfile.tsx:16:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:2713:callback-box/src/frontend/src/renderers/sheet.tsx:8:import type { ElementNode } from "../api";
callback-box/scratch/codex-out.md:2714:callback-box/src/frontend/src/renderers/sheet.tsx:29:function parseSheetElement(el: ElementNode): ParsedSheet {
callback-box/scratch/codex-out.md:2715:callback-box/src/frontend/src/renderers/index.ts:8:import type { ElementNode } from "../api";
callback-box/scratch/codex-out.md:2716:callback-box/src/frontend/src/renderers/index.ts:18:  element?: ElementNode;
callback-box/scratch/codex-out.md:2719:callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:2720:callback-box/src/core/agent-guide/index.ts:50:  allSchemas?: ElementSchema[];
callback-box/scratch/codex-out.md:2725:callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:2726:callback-box/src/core/agent-guide/cards.ts:9:export function cardTypesSection(allSchemas: ElementSchema[]): string[] {
callback-box/scratch/codex-out.md:2728:callback-box/src/cli/lib/loader.ts:2: * CardLoader factory for callback box.
callback-box/scratch/codex-out.md:2729:callback-box/src/cli/lib/loader.ts:4: * Creates a configured CardLoader instance with all known schemas.
callback-box/scratch/codex-out.md:2730:callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/scratch/codex-out.md:2733:callback-box/src/cli/lib/loader.ts:18: * Create a CardLoader for the given box root.
callback-box/scratch/codex-out.md:2734:callback-box/src/cli/lib/loader.ts:24: * @returns A configured CardLoader
callback-box/scratch/codex-out.md:2735:callback-box/src/cli/lib/loader.ts:29:): Promise<CardLoader> {
callback-box/scratch/codex-out.md:2736:callback-box/src/cli/lib/loader.ts:31:  const loaderOptions: CardLoaderOptions = {
callback-box/scratch/codex-out.md:2738:callback-box/src/cli/lib/loader.ts:37:  return new CardLoader(boxRoot, loaderOptions);
callback-box/scratch/codex-out.md:2739:callback-box/src/cli/lib/loader.ts:50: * Create an in-memory CardLoader for testing.
callback-box/scratch/codex-out.md:2740:callback-box/src/cli/lib/loader.ts:53: * @returns A configured MemoryCardLoader
callback-box/scratch/codex-out.md:2741:callback-box/src/cli/lib/loader.ts:57:): Promise<MemoryCardLoader> {
callback-box/scratch/codex-out.md:2742:callback-box/src/cli/lib/loader.ts:61:  return new MemoryCardLoader(projectRoot, {
callback-box/scratch/codex-out.md:2744:callback-box/src/cli/lib/loader.ts:69:// Re-export CardLoader types for convenience
callback-box/scratch/codex-out.md:2745:callback-box/src/cli/lib/loader.ts:70:export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/scratch/codex-out.md:2746:callback-box/src/cli/lib/loader.ts:71:export type { ICardLoader, CardLoaderOptions } from "cardworks";
callback-box/scratch/codex-out.md:2747:callback-box/src/frontend/src/components/TodoListView.tsx:14:import type { ElementNode } from "../api";
callback-box/scratch/codex-out.md:2748:callback-box/src/frontend/src/components/TodoListView.tsx:31:function parseItem(el: ElementNode): TodoItemInfo {
callback-box/scratch/codex-out.md:2749:callback-box/src/frontend/src/components/TodoListView.tsx:58:function parseTodoList(element: ElementNode): TodoListInfo {
callback-box/scratch/codex-out.md:2750:callback-box/src/frontend/src/components/CommitDetail-diff.ts:6:import type { ElementNode } from "./CardTreeView";
callback-box/scratch/codex-out.md:2751:callback-box/src/frontend/src/components/CommitDetail-diff.ts:127:function domToElementNode(el: Element): ElementNode {
callback-box/scratch/codex-out.md:2752:callback-box/src/frontend/src/components/CommitDetail-diff.ts:133:  const children: ElementNode[] = [];
callback-box/scratch/codex-out.md:2754:callback-box/src/frontend/src/components/CommitDetail-diff.ts:155:export function parseXmlToElementNode(xml: string): ElementNode | null {
callback-box/scratch/codex-out.md:2758:callback-box/src/frontend/src/api.ts:65:export interface ElementNode {
callback-box/scratch/codex-out.md:2759:callback-box/src/frontend/src/api.ts:69:  children?: ElementNode[];
callback-box/scratch/codex-out.md:2760:callback-box/src/frontend/src/components/CardTreeView.tsx:25:export interface ElementNode {
callback-box/scratch/codex-out.md:2761:callback-box/src/frontend/src/components/CardTreeView.tsx:29:  children?: ElementNode[];
callback-box/scratch/codex-out.md:2762:callback-box/src/frontend/src/components/CardTreeView.tsx:33:  element: ElementNode;
callback-box/scratch/codex-out.md:2763:callback-box/src/frontend/src/components/CardTreeView.tsx:135:  data: { element?: ElementNode; path: string; tagName?: string; xml?: string; version?: string; status?: string };
callback-box/scratch/codex-out.md:2764:callback-box/src/frontend/src/components/CardTreeView.tsx:284:  element: ElementNode;
callback-box/scratch/codex-out.md:2791:   221	  const loadedElement: ElementSchema[] = [];
callback-box/scratch/codex-out.md:2805:   235	      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
callback-box/scratch/codex-out.md:2806:   236	      // Zod type carrying `.tagName`; check it first, because ElementSchema also
callback-box/scratch/codex-out.md:2830:   260	function isElementSchema(def: unknown): def is ElementSchema {
callback-box/scratch/codex-out.md:2831:   261	  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
callback-box/scratch/codex-out.md:2867:   297	export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
callback-box/scratch/codex-out.md:2965:callback-box/test/search-extract.doctest.md:21:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/scratch/codex-out.md:2971:callback-box/test/contains-state.doctest.md:26:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/scratch/codex-out.md:2972:callback-box/test/card-lint.doctest.md:54:  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
callback-box/scratch/codex-out.md:2974:callback-box/test/card-io.doctest.md:145:  elementSchemas: new Map<string, ElementSchema>([
callback-box/scratch/codex-out.md:2982:callback-box/src/core/load-context.ts:13:  const elementSchemas = new Map<string, ElementSchema>();
callback-box/scratch/codex-out.md:2983:callback-box/src/core/load-context.ts:16:    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/scratch/codex-out.md:3004:callback-box/src/schemas/registry.ts:170:  elementSchemas: ElementSchema[];
callback-box/scratch/codex-out.md:3022:callback-box/src/core/card-io.ts:306:  elementSchemas: Map<string, ElementSchema>;
callback-box/scratch/codex-out.md:3063:callback-box/scripts/migrate/landmark.ts:47:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3064:callback-box/scripts/migrate/guide.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3065:callback-box/scripts/migrate/personality.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3066:callback-box/scripts/migrate/misc.ts:16:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3067:callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:277:> import { element, escapeText } from "cardworks";
callback-box/scratch/codex-out.md:3068:callback-box/scripts/migrate/chat-thread.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3069:callback-box/scripts/migrate/doc-sheet.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3070:callback-box/scripts/migrate/memo.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3071:callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:25:> import { element } from "cardworks";
callback-box/scratch/codex-out.md:3072:callback-box/scripts/migrate/scheduled-script.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3073:callback-box/scripts/migrate/procedure-run.ts:17:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3074:callback-box/scripts/migrate/question.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3075:callback-box/scripts/migrate/_warnings.ts:18:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3076:callback-box/test/card-lint.doctest.md:15:} from "cardworks";
callback-box/scratch/codex-out.md:3077:callback-box/scripts/migrate/procedure.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3078:callback-box/scripts/migrate/jobs.ts:18:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3079:callback-box/scripts/migrate/file.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3080:callback-box/test/card-io.doctest.md:15:} from "cardworks";
callback-box/scratch/codex-out.md:3081:callback-box/scripts/migrate/audio.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3082:callback-box/scripts/migrate/record-person.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3083:callback-box/scripts/migrate/recipe.ts:40:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3084:callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:3085:callback-box/scripts/migrate/briefing.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3086:callback-box/scripts/migrate/email-thread.ts:43:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3087:callback-box/scripts/migrate/capture-session.ts:19:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3088:callback-box/test/extfile-sync.doctest.md:12:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3089:callback-box/scripts/migrate/email-message.ts:48:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3090:callback-box/scripts/migrate/repair-refs.ts:34:import { extractRefs, splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3091:callback-box/scripts/migrate/image.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3092:callback-box/src/schemas/guide-parse.tsx:10:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3093:callback-box/src/schemas/recipe.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3094:callback-box/src/schemas/memo.ts:9:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3095:callback-box/src/schemas/landmark.ts:27:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3096:callback-box/src/schemas/sheet.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3097:callback-box/src/schemas/email-message.tsx:30:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3098:callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3099:callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3100:callback-box/src/schemas/guide-elements.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3101:callback-box/src/schemas/briefing.tsx:19:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3102:callback-box/src/schemas/procedure.ts:11:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3103:callback-box/src/schemas/todo-list.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3104:callback-box/src/schemas/personality.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3105:callback-box/src/schemas/file.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3106:callback-box/src/schemas/capture-session.tsx:15:import { splitCardContent, body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3107:callback-box/src/schemas/intake-job.tsx:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3108:callback-box/src/schemas/question-followup-job.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3109:callback-box/src/schemas/email-thread.tsx:29:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3110:callback-box/src/schemas/procedure-run.ts:8:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3111:callback-box/src/schemas/person.tsx:11:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3112:callback-box/src/cli/commands/validate.ts:10:import { formatLintResults, type LintSummary } from "cardworks";
callback-box/scratch/codex-out.md:3113:callback-box/src/schemas/question.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3114:callback-box/src/schemas/audio.tsx:12:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3115:callback-box/src/schemas/image.tsx:13:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3116:callback-box/src/schemas/gdoc.tsx:18:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3117:callback-box/src/schemas/email-outbound.tsx:34:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3118:callback-box/src/schemas/commentary.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3119:callback-box/src/schemas/telegram-message.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3120:callback-box/src/schemas/feedback.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3121:callback-box/src/schemas/chat-thread.ts:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3122:callback-box/src/schemas/record.tsx:12:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3123:callback-box/src/schemas/webpage.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3124:callback-box/src/schemas/scheduled-script.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3125:callback-box/src/schemas/calendar-review-job.tsx:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3126:callback-box/test/schemas.doctest.md:18:import { parseCard } from "cardworks";
callback-box/scratch/codex-out.md:3127:callback-box/src/schemas/doc.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3128:callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:3129:callback-box/src/schemas/chat-job.ts:10:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3130:callback-box/src/schemas/extfile.tsx:16:import { cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3131:callback-box/test/card-loaders.doctest.md:8:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3132:callback-box/test/box-schemas.doctest.md:34:const WIDGET_SCHEMA = `import { body, cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3133:callback-box/test/box-schemas.doctest.md:48:const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/scratch/codex-out.md:3134:callback-box/test/loader-registry.doctest.md:13:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3135:callback-box/docs/EXAMPLE_FILES.md:561:import { element } from "cardworks";
callback-box/scratch/codex-out.md:3136:callback-box/docs/EXAMPLE_FILES.md:595:import { element } from "cardworks";
callback-box/scratch/codex-out.md:3137:callback-box/docs/adding-schemas.md:23:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3138:callback-box/docs/adding-schemas.md:160:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3139:callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/scratch/codex-out.md:3140:callback-box/src/cli/lib/loader.ts:70:export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/scratch/codex-out.md:3141:callback-box/src/cli/lib/loader.ts:71:export type { ICardLoader, CardLoaderOptions } from "cardworks";
callback-box/scratch/codex-out.md:3142:callback-box/docs/boxes-as-packages.md:17:2. **Schemas are a stub package.** `config/schemas/package.json` is `{"type":"module"}` with no dependencies. To define a real schema the agent would want `import { z } from "zod"; import { element } from "cardworks";` — same as built-in schemas in `src/schemas/`. Today this works only by accident (transitive resolution from the callback-box install) and gives no IDE help inside the box.
callback-box/scratch/codex-out.md:3143:callback-box/src/webapp/routes/views.ts:21:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3144:callback-box/src/webapp/routes/api-card-patch.ts:12:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3145:callback-box/src/webapp/trpc/routers/todos.ts:9:import { CardLoader, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3146:callback-box/src/webapp/trpc/routers/card.ts:7:import { parseCard, splitCardContent, type CardSchema, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3147:callback-box/src/webapp/trpc/routers/chat.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3148:callback-box/src/webapp/trpc/routers/scheduler.ts:10:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3149:callback-box/src/connectors/preserve-agent-fields.ts:12:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3150:callback-box/docs/plans/remove-cardworks-package.md:151:keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/scratch/codex-out.md:3151:callback-box/docs/plans/remove-cardworks-package.md:178:find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/scratch/codex-out.md:3152:callback-box/docs/plans/remove-cardworks-package.md:205:`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/scratch/codex-out.md:3153:callback-box/docs/plans/remove-cardworks-package.md:323:   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/scratch/codex-out.md:3154:callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:3155:callback-box/src/core/reactor/procedure-trampoline.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3156:callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:3157:callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3158:callback-box/src/core/box-templates.ts:86:import { cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3159:callback-box/src/core/box-templates.ts:133:import { element } from "cardworks";
callback-box/scratch/codex-out.md:3160:callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:3161:callback-box/src/connectors/intake-utils.ts:17:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3162:callback-box/src/core/extfile-sync.ts:13:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3163:callback-box/src/core/search/contains-update.ts:11:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3164:callback-box/src/connectors/gmail-drafts.ts:19:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3165:callback-box/src/connectors/chat-utils.ts:15:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3166:callback-box/src/core/file-summary.ts:13:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3167:callback-box/src/core/search/refresh-file.ts:10:import { ParseError } from "cardworks";
callback-box/scratch/codex-out.md:3168:callback-box/src/core/card-lint.ts:27:} from "cardworks";
callback-box/scratch/codex-out.md:3169:callback-box/src/core/preactions/index.ts:21:import type { ICardLoader } from "cardworks";
callback-box/scratch/codex-out.md:3170:callback-box/src/core/landmark/resolve.ts:12:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3171:callback-box/src/core/preactions/types.ts:1:import type { Card, ICardLoader, CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:3172:callback-box/src/core/search/extract.ts:19:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3173:callback-box/src/core/preactions/transcribe.ts:18:import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:3174:callback-box/src/core/generate-docs-compile.ts:12:import { parseCard } from "cardworks";
callback-box/scratch/codex-out.md:3175:callback-box/src/core/card-io.ts:27:} from "cardworks";
callback-box/scratch/codex-out.md:3176:callback-box/src/core/commands/answer.ts:10:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3177:callback-box/src/core/sdk-hooks.ts:14:import { formatLintResults } from "cardworks";
callback-box/scratch/codex-out.md:3178:callback-box/src/core/commands/assemble-timeline-helpers.ts:5:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3179:callback-box/src/core/procedure/engine-run-card.ts:12:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3180:callback-box/src/core/commands/ls.ts:11:import { type ElementNode, parseCard, evaluateXPathString } from "cardworks";
callback-box/scratch/codex-out.md:3181:callback-box/src/core/commands/move-operations.ts:16:import { CardLoader } from "cardworks";
callback-box/scratch/codex-out.md:3507:     2	import type { ElementSchema } from "./element.js";
callback-box/scratch/codex-out.md:3520:    15	  constructor(schemas?: ElementSchema[]) {
callback-box/scratch/codex-out.md:3530:    25	   * @param schema - The ElementSchema to register (must have .tagName)
callback-box/scratch/codex-out.md:3532:    27	  register(schema: ElementSchema): void {
callback-box/scratch/codex-out.md:3703:     1	import type { ICardLoader } from "../loader/loader.js";
callback-box/scratch/codex-out.md:3704:     2	import type { ElementNode, Location } from "../parser/provenance.js";
callback-box/scratch/codex-out.md:3706:     4	import { parseCard } from "../parser/parse.js";
callback-box/scratch/codex-out.md:3747:    45	 * Options for {@link lintCard}: the card path plus optional lint settings.
callback-box/scratch/codex-out.md:3757:    55	export async function lintCard(
callback-box/scratch/codex-out.md:3758:    56	  loader: ICardLoader,
callback-box/scratch/codex-out.md:3822:   120	function checkDuplicateIds(root: ElementNode, warnings: LintIssue[]): void {
callback-box/scratch/codex-out.md:3824:     2	import type { ElementNode, Location } from "./provenance.js";
callback-box/scratch/codex-out.md:3871:    49	 * Parse XML content into an ElementNode tree.
callback-box/scratch/codex-out.md:3875:    53	 * @returns The parsed ElementNode tree
callback-box/scratch/codex-out.md:3878:    56	export function parseXml(xml: string, options: ParseXmlOptions): Promise<ElementNode> {
callback-box/scratch/codex-out.md:3912:     2	 * CardLoader factory for callback box.
callback-box/scratch/codex-out.md:3914:     4	 * Creates a configured CardLoader instance with all known schemas.
callback-box/scratch/codex-out.md:3917:     7	import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/scratch/codex-out.md:3928:    18	 * Create a CardLoader for the given box root.
callback-box/scratch/codex-out.md:3934:    24	 * @returns A configured CardLoader
callback-box/scratch/codex-out.md:3939:    29	): Promise<CardLoader> {
callback-box/scratch/codex-out.md:3941:    31	  const loaderOptions: CardLoaderOptions = {
callback-box/scratch/codex-out.md:3947:    37	  return new CardLoader(boxRoot, loaderOptions);
callback-box/scratch/codex-out.md:3960:    50	 * Create an in-memory CardLoader for testing.
callback-box/scratch/codex-out.md:3963:    53	 * @returns A configured MemoryCardLoader
callback-box/scratch/codex-out.md:3967:    57	): Promise<MemoryCardLoader> {
callback-box/scratch/codex-out.md:3971:    61	  return new MemoryCardLoader(projectRoot, {
callback-box/scratch/codex-out.md:3979:    69	// Re-export CardLoader types for convenience
callback-box/scratch/codex-out.md:3980:    70	export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/scratch/codex-out.md:3981:    71	export type { ICardLoader, CardLoaderOptions } from "cardworks";
callback-box/scratch/codex-out.md:3997:    16	import { CardLoader } from "cardworks";
callback-box/scratch/codex-out.md:4085:   104	  const loader = new CardLoader(ctx.boxRoot);
callback-box/scratch/codex-out.md:4143:   162	  loader: CardLoader;
callback-box/scratch/codex-out.md:4184:   203	  loader: CardLoader;
callback-box/scratch/codex-out.md:4250:     9	import { CardLoader, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:4263:    22	      const loader = new CardLoader(ctx.boxRoot);
callback-box/scratch/codex-out.md:4276:    35	      function updateInChildren(children: ElementNode[]): boolean {
callback-box/scratch/codex-out.md:4288:    47	            if (updateInChildren(child.children as ElementNode[])) return true;
callback-box/scratch/codex-out.md:4294:    53	      const found = updateInChildren((card.element.children ?? []) as ElementNode[]);
callback-box/scratch/codex-out.md:4317:     7	import type { ElementSchema } from "cardworks";
callback-box/scratch/codex-out.md:4323:    13	  const elementSchemas = new Map<string, ElementSchema>();
callback-box/scratch/codex-out.md:4326:    16	    if (schema) elementSchemas.set(tag, schema as ElementSchema);
callback-box/scratch/codex-out.md:4348:    19	import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:4619:   290	function collectElementText(node: ElementNode): string {
callback-box/scratch/codex-out.md:4621:   292	  const visit = (n: ElementNode): void => {
callback-box/scratch/codex-out.md:4637:   308	function isElementNode(value: unknown): value is ElementNode {
callback-box/scratch/codex-out.md:4700:    11	import { type ElementNode, parseCard, evaluateXPathString } from "cardworks";
callback-box/scratch/codex-out.md:4761:    72	function applyTemplate(template: string, rootNode: ElementNode): string {
callback-box/scratch/codex-out.md:4763:    74	    return evaluateXPathString(expr, rootNode);
callback-box/scratch/codex-out.md:4806:   117	      const root = await parseCard(content, { source: filePath });
callback-box/scratch/codex-out.md:4857:     7	 * else falls through to cardworks' existing XML lintCard. Results are
callback-box/scratch/codex-out.md:4869:    19	  lintCard,
callback-box/scratch/codex-out.md:4875:    25	  type ICardLoader,
callback-box/scratch/codex-out.md:4877:    27	} from "cardworks";
callback-box/scratch/codex-out.md:4891:    41	  loader: ICardLoader;
callback-box/scratch/codex-out.md:4942:    92	  return lintCard(options.loader, { path });
callback-box/scratch/codex-out.md:5102:    12	import { parseCard } from "cardworks";
callback-box/scratch/codex-out.md:5137:    47	      const root = await parseCard(content, { source: filename });
callback-box/scratch/codex-out.md:5227:     7	import { parseCard, splitCardContent, type CardSchema, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:5242:    22	function sanitizeElement(el: ElementNode): JsonElement {
callback-box/scratch/codex-out.md:5251:    31	    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
callback-box/scratch/codex-out.md:5259:    39	function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
callback-box/scratch/codex-out.md:5261:    41	  let current: ElementNode = el;
callback-box/scratch/codex-out.md:5275:    55	 * Parse a simple XML fragment into an ElementNode.
callback-box/scratch/codex-out.md:5277:    57	function parseXmlFragment(xml: string): ElementNode | null {
callback-box/scratch/codex-out.md:5299:    79	  } as ElementNode;
callback-box/scratch/codex-out.md:5468:   248	          const parsed = await parseCard(rawXml, { source: input.path });
callback-box/scratch/codex-out.md:5483:There are live web/API paths too. `cardRouter.get` still has an XML fallback and `todos.updateItem` is entirely XML/CardLoader-based; removing those may be correct, but the plan needs to call out frontend/API behavior changes and tests, not just “dead path.”
callback-box/scratch/codex-out.md:5549:   320	  const loader = new CardLoader(ctx.boxRoot);
callback-box/scratch/codex-out.md:5771:    11	import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:5803:    43	function findNavigation(element: ElementNode): ElementNode | null {
callback-box/scratch/codex-out.md:5810:    50	function readChildText(navigation: ElementNode | null, tagName: string): string {
callback-box/scratch/codex-out.md:5821:    61	  navigation: ElementNode | null,
callback-box/scratch/codex-out.md:5860:   100	    let element: ElementNode;
callback-box/scratch/codex-out.md:5863:   103	      element = await parseCard(content, { source: absPath });
callback-box/scratch/codex-out.md:6002:    18	import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:6149:   165	function hasXmlTranscription(element: ElementNode): boolean {
callback-box/scratch/codex-out.md:6154:   170	function hasXmlPermanentError(element: ElementNode): boolean {
callback-box/scratch/codex-out.md:6159:   175	function getXmlContent(element: ElementNode): string | null {
callback-box/scratch/codex-out.md:6165:   181	  element: ElementNode;
callback-box/scratch/codex-out.md:6188:   204	  element: ElementNode,
callback-box/scratch/codex-out.md:6222:    11	import { parseCard, type ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:6235:    24	    const root = await parseCard(content, { source: filePath });
callback-box/scratch/codex-out.md:6236:    25	    for (const child of root.children as ElementNode[]) {
callback-box/scratch/codex-out.md:6239:    28	        for (const grandchild of (child.children ?? []) as ElementNode[]) {
callback-box/scratch/codex-out.md:6315:    13	import type { ElementNode } from "cardworks";
callback-box/scratch/codex-out.md:6338:    36	  element?: ElementNode;
callback-box/scratch/codex-out.md:6407:    31	import { body, cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:6462:    86	import { cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:6509:   133	import { element } from "cardworks";
callback-box/scratch/codex-out.md:6590:    34	const WIDGET_SCHEMA = `import { body, cardSchema } from "cardworks";
callback-box/scratch/codex-out.md:6604:    48	const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/scratch/codex-out.md:6683:     1	import type { Card, ICardLoader, CardSchema } from "cardworks";
callback-box/scratch/codex-out.md:6701:    19	  loader: ICardLoader;
callback-box/scratch/codex-out.md:6742:    11	 * - Phase 1 XML-bodied cards (loaded via cardworks ICardLoader)
callback-box/scratch/codex-out.md:6752:    21	import type { ICardLoader } from "cardworks";
callback-box/scratch/codex-out.md:6781:    50	  loader: ICardLoader;
callback-box/scratch/codex-out.md:6822:    91	  loader: ICardLoader;
callback-box/docs/plans/remove-cardworks-and-xml.md:24:> `schemas[]` (the XML `ElementSchema` list) is now empty.
callback-box/docs/plans/remove-cardworks-and-xml.md:28:> the XML parser, JSX runtime, and `evaluateXPathString` have no users.
callback-box/docs/plans/remove-cardworks-and-xml.md:81:  *"export const schemas: ElementSchema[] = [ ProcedureSchema,
callback-box/docs/plans/remove-cardworks-and-xml.md:88:  the `ElementSchema` machinery is deleted.
callback-box/docs/plans/remove-cardworks-and-xml.md:122:  `evaluateXPathString`. **Rebuild/remove** — see the Landmark track and
callback-box/docs/plans/remove-cardworks-and-xml.md:376:helpers.ts` rewritten to emit body-tag strings instead of `ElementNode`s;
callback-box/docs/plans/remove-cardworks-and-xml.md:393:`ElementSchema` registry plumbing, the search `xmlDoc()` path, the
callback-box/docs/plans/remove-cardworks-and-xml.md:394:frontend `ElementNode`/`CardTreeView` rendering, and update the LLM
callback-box/docs/plans/remove-cardworks-and-xml.md:445:so `evaluateXPathString` is never exercised by any card in practice. The
callback-box/docs/plans/remove-cardworks-and-xml.md:449:**Decision (no query language).** Replace `evaluateXPathString` with a
callback-box/docs/implemented-plans/box-search.md:169:  config and XML `ElementSchema`) gain `searchable?: boolean` (default
callback-box/docs/implemented-plans/box-search.md:186:  the resolved `CardSchema`/`ElementSchema` object. Operational schemas set
callback-box/src/connectors/preserve-agent-fields.ts:12:import { splitCardContent } from "cardworks";
callback-box/docs/plans/remove-cardworks-package.md:4:now frontmatter (the XML `schemas[]` `ElementSchema` list is empty), so the
callback-box/docs/plans/remove-cardworks-package.md:6:`CardLoader`, the XML element schema — has no real users. This plan removes
callback-box/docs/plans/remove-cardworks-package.md:55:  `jsx/*`, `loader/*` (`CardLoader`, 473 LOC), `refs/xpath.ts` (334),
callback-box/docs/plans/remove-cardworks-package.md:69:  (23 files) import `parseCard`/`splitCardContent` from cardworks to read
callback-box/docs/plans/remove-cardworks-package.md:94:XML symbol (`parseCard`, `ElementNode`, `ElementSchema`, `element`,
callback-box/docs/plans/remove-cardworks-package.md:95:`serialize`/`escapeText`, `CardLoader`/`MemoryCardLoader`/`ICardLoader`/
callback-box/docs/plans/remove-cardworks-package.md:96:`CardLoaderOptions`, `evaluateXPathString`, `Card`). After this track, the
callback-box/docs/plans/remove-cardworks-package.md:110:  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
callback-box/docs/plans/remove-cardworks-package.md:111:  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
callback-box/docs/plans/remove-cardworks-package.md:117:  the `card-lint.ts` fallback to cardworks `lintCard` (`card-lint.ts:92`).
callback-box/docs/plans/remove-cardworks-package.md:118:- **Rewrite the live `CardLoader` users.** `cli/lib/loader.ts` (the factory
callback-box/docs/plans/remove-cardworks-package.md:119:  re-exporting `CardLoader`/`MemoryCardLoader`), `commands/move-operations.ts`
callback-box/docs/plans/remove-cardworks-package.md:120:  (`move-operations.ts:104` `new CardLoader(...)` → uses `listCards()` for
callback-box/docs/plans/remove-cardworks-package.md:127:- **Repoint type-only `ElementNode`/`ElementSchema` imports.** Several files
callback-box/docs/plans/remove-cardworks-package.md:129:  `card.ts`, `chat.ts`) carry `ElementNode`/`ElementSchema`/`Card` in optional
callback-box/docs/plans/remove-cardworks-package.md:137:`chat.ts` reading a now-frontmatter landmark via `parseCard`,
callback-box/docs/plans/remove-cardworks-package.md:138:`generate-docs-compile.ts:47` parsing a procedure via `parseCard`) surfaces
callback-box/docs/plans/remove-cardworks-package.md:151:keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/docs/plans/remove-cardworks-package.md:178:find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/docs/plans/remove-cardworks-package.md:201:`parseCard`); once every box is migrated (decided: box-migration-first) they
callback-box/docs/plans/remove-cardworks-package.md:205:`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/docs/plans/remove-cardworks-package.md:228:| A stale consumer reads a frontmatter card via deleted `parseCard` | Partial | Yes — `tsc` fails to compile once the symbol is gone | Clear (compile error) |
callback-box/docs/plans/remove-cardworks-package.md:317:   fallback) and the type-only `ElementNode`/`ElementSchema`/`Card` carriers.
callback-box/docs/plans/remove-cardworks-package.md:318:3. **Track A, chunk 3** — rewrite the live `CardLoader` users
callback-box/docs/plans/remove-cardworks-package.md:323:   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/docs/EXAMPLE_FILES.md:561:import { element } from "cardworks";
callback-box/docs/EXAMPLE_FILES.md:595:import { element } from "cardworks";
callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/test/search-extract.doctest.md:21:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/src/connectors/intake-utils.ts:17:import { splitCardContent } from "cardworks";
callback-box/docs/cards-as-markdown.md:40:**Loader dispatch:** `src/core/card-io.ts` `loadCardFile()` returns a discriminated union of `FrontmatterLoadedCard | XmlLoadedCard`. Frontmatter dispatch uses `cardSchemas` (Map keyed by `type:` field); XML falls through to the legacy cardworks `parseCard`. This lets XML and frontmatter cards coexist during and after the migration.
callback-box/test/extfile-sync.doctest.md:12:import { splitCardContent } from "cardworks";
callback-box/test/box-schemas.doctest.md:34:const WIDGET_SCHEMA = `import { body, cardSchema } from "cardworks";
callback-box/test/box-schemas.doctest.md:48:const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/scripts/migrate/record-person.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/record-person.ts:77:function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
callback-box/scripts/migrate/record-person.ts:81:function childText(node: ElementNode, tagName: string): string | undefined {
callback-box/scripts/migrate/record-person.ts:88:function convertRecord(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/record-person.ts:182:function convertPerson(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
callback-box/scripts/migrate/record-person.ts:221:  const node = await parseCard(raw, { source: absPath });
callback-box/test/card-lint.doctest.md:14:  type ElementSchema,
callback-box/test/card-lint.doctest.md:15:} from "cardworks";
callback-box/test/card-lint.doctest.md:43:const memoSchema: ElementSchema = element("memo", {
callback-box/test/card-lint.doctest.md:54:  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
callback-box/test/card-lint.doctest.md:240:## XML cards still flow through the existing cardworks lintCard path
callback-box/test/card-loaders.doctest.md:8:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/card-loaders.doctest.md:10:function el(tagName: string, attrs: Record<string, string>, children: ElementNode[] = []): ElementNode {
callback-box/test/card-loaders.doctest.md:18:  } as ElementNode;
callback-box/test/card-loaders.doctest.md:21:function textChild(tagName: string, text: string): ElementNode {
callback-box/test/card-loaders.doctest.md:22:  return { ...el(tagName, {}), text } as ElementNode;
callback-box/test/card-io.doctest.md:14:  type ElementSchema,
callback-box/test/card-io.doctest.md:15:} from "cardworks";
callback-box/test/card-io.doctest.md:136:const xmlMemo: ElementSchema = element("memo", {
callback-box/test/card-io.doctest.md:145:  elementSchemas: new Map<string, ElementSchema>([
callback-box/test/loader-registry.doctest.md:13:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/loader-registry.doctest.md:15:function makeElement(tagName: string, attrs: Record<string, string>, text?: string): ElementNode {
callback-box/test/loader-registry.doctest.md:24:  } as ElementNode;
callback-box/docs/adding-schemas.md:23:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/docs/adding-schemas.md:160:import { splitCardContent } from "cardworks";
callback-box/test/schemas.doctest.md:18:import { parseCard } from "cardworks";
callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/test/contains-state.doctest.md:26:  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
callback-box/CODE-STYLE.md:55:- **`as` type assertions are like Rust's `unsafe`** (banned in `.tsx` by lint, discouraged everywhere): allowed only when genuinely necessary — e.g. at a parse boundary where data arrives untyped. When you need one, either guard it with an `// eslint-disable-next-line no-restricted-syntax -- <why it's sound>` comment, or centralize the cast in a single well-named typed helper (`getChildren(el): ElementNode[]`) that does it once and is reused. Never sprinkle bare `as` to silence the type checker. (`as const` is always fine.)
callback-box/dist/cli.mjs:70:import { cardSchema } from "cardworks";
callback-box/dist/cli.mjs:1300:import { body, cardSchema } from "cardworks";
callback-box/dist/cli.mjs:1355:import { cardSchema } from "cardworks";
callback-box/dist/cli.mjs:1402:import { element } from "cardworks";
callback-box/dist/cli.mjs:1574:import { cardSchema as cardSchema2 } from "cardworks";
callback-box/dist/cli.mjs:1680:import { splitCardContent } from "cardworks";
callback-box/dist/cli.mjs:2031:import { body, cardSchema as cardSchema3 } from "cardworks";
callback-box/dist/cli.mjs:2385:import { body as body2, cardSchema as cardSchema4 } from "cardworks";
callback-box/dist/cli.mjs:2816:import { splitCardContent as splitCardContent2, cardSchema as cardSchema5 } from "cardworks";
callback-box/dist/cli.mjs:3323:import { SchemaRegistry } from "cardworks";
callback-box/dist/cli.mjs:3326:import { body as body3, cardSchema as cardSchema6 } from "cardworks";
callback-box/dist/cli.mjs:3465:import { cardSchema as cardSchema7 } from "cardworks";
callback-box/dist/cli.mjs:3558:import { body as body4, cardSchema as cardSchema8 } from "cardworks";
callback-box/dist/cli.mjs:3605:import { splitCardContent as splitCardContent3, cardSchema as cardSchema9 } from "cardworks";
callback-box/dist/cli.mjs:3682:import { splitCardContent as splitCardContent4, cardSchema as cardSchema10 } from "cardworks";
callback-box/dist/cli.mjs:3749:import { cardSchema as cardSchema11 } from "cardworks";
callback-box/dist/cli.mjs:3891:import { cardSchema as cardSchema12 } from "cardworks";
callback-box/dist/cli.mjs:3952:import { cardSchema as cardSchema13 } from "cardworks";
callback-box/dist/cli.mjs:4015:import { splitCardContent as splitCardContent5, body as body5, cardSchema as cardSchema14 } from "cardworks";
callback-box/dist/cli.mjs:4103:import { body as body6, cardSchema as cardSchema15 } from "cardworks";
callback-box/dist/cli.mjs:4224:import { body as body7, cardSchema as cardSchema16 } from "cardworks";
callback-box/dist/cli.mjs:4303:import { cardSchema as cardSchema17 } from "cardworks";
callback-box/dist/cli.mjs:4355:import { cardSchema as cardSchema18 } from "cardworks";
callback-box/dist/cli.mjs:4421:import { body as body8, cardSchema as cardSchema19 } from "cardworks";
callback-box/dist/cli.mjs:4492:import { cardSchema as cardSchema20 } from "cardworks";
callback-box/dist/cli.mjs:4548:import { cardSchema as cardSchema21 } from "cardworks";
callback-box/dist/cli.mjs:4623:import { cardSchema as cardSchema22 } from "cardworks";
callback-box/dist/cli.mjs:4668:import { cardSchema as cardSchema23 } from "cardworks";
callback-box/dist/cli.mjs:4776:import { cardSchema as cardSchema24 } from "cardworks";
callback-box/dist/cli.mjs:4836:import { cardSchema as cardSchema25 } from "cardworks";
callback-box/dist/cli.mjs:4890:import { cardSchema as cardSchema26 } from "cardworks";
callback-box/dist/cli.mjs:4976:import { body as body9, cardSchema as cardSchema27 } from "cardworks";
callback-box/dist/cli.mjs:5034:import { cardSchema as cardSchema28 } from "cardworks";
callback-box/dist/cli.mjs:5101:import { body as body10, cardSchema as cardSchema29 } from "cardworks";
callback-box/dist/cli.mjs:5205:import { cardSchema as cardSchema30 } from "cardworks";
callback-box/dist/cli.mjs:5294:import { body as body11, cardSchema as cardSchema31 } from "cardworks";
callback-box/dist/cli.mjs:5371:import { body as body12, cardSchema as cardSchema32 } from "cardworks";
callback-box/dist/cli.mjs:5459:import { cardSchema as cardSchema33 } from "cardworks";
callback-box/dist/cli.mjs:8191:import { parseCard as parseCard2 } from "cardworks";
callback-box/dist/cli.mjs:8198:  parseCard
callback-box/dist/cli.mjs:8199:} from "cardworks";
callback-box/dist/cli.mjs:8373:  const element = await parseCard(content, { source: source2 });
callback-box/dist/cli.mjs:8871:    // Per-schema generated docs cover both legacy XML schemas (ElementSchema
callback-box/dist/cli.mjs:9703:import { ParseError } from "cardworks";
callback-box/dist/cli.mjs:10342:import { formatLintResults } from "cardworks";
callback-box/dist/cli.mjs:10416:import { CardLoader, MemoryCardLoader } from "cardworks";
callback-box/dist/cli.mjs:10417:import { CardLoader as CardLoader2, MemoryCardLoader as MemoryCardLoader2, ValidationError } from "cardworks";
callback-box/dist/cli.mjs:10425:  return new CardLoader(boxRoot, loaderOptions);
callback-box/dist/cli.mjs:10500:  lintCard,
callback-box/dist/cli.mjs:10503:} from "cardworks";
callback-box/dist/cli.mjs:10819:  return lintCard(options.loader, { path: path181 });
callback-box/dist/cli.mjs:11518:import { splitCardContent as splitCardContent8 } from "cardworks";
callback-box/dist/cli.mjs:11927:import { CardLoader as CardLoader3 } from "cardworks";
callback-box/dist/cli.mjs:12712:import { splitCardContent as splitCardContent9 } from "cardworks";
callback-box/dist/cli.mjs:13041:import { formatLintResults as formatLintResults2 } from "cardworks";
callback-box/dist/cli.mjs:15490:import { splitCardContent as splitCardContent10 } from "cardworks";
callback-box/dist/cli.mjs:16376:import { splitCardContent as splitCardContent11 } from "cardworks";
callback-box/dist/cli.mjs:18284:import { parseCard as parseCard3, evaluateXPathString } from "cardworks";
callback-box/dist/cli.mjs:18306:    return evaluateXPathString(expr, rootNode);
callback-box/dist/cli.mjs:19744:import { splitCardContent as splitCardContent12 } from "cardworks";
callback-box/dist/cli.mjs:30192:import { parseCard as parseCard4, splitCardContent as splitCardContent13 } from "cardworks";
callback-box/dist/cli.mjs:30455:import { splitCardContent as splitCardContent14 } from "cardworks";
callback-box/dist/cli.mjs:31221:import { CardLoader as CardLoader4 } from "cardworks";
callback-box/dist/cli.mjs:31779:import { splitCardContent as splitCardContent15 } from "cardworks";
callback-box/dist/cli.mjs:31985:import { parseCard as parseCard5 } from "cardworks";
callback-box/dist/cli.mjs:32960:import { parseCard as parseCard6 } from "cardworks";
callback-box/dist/cli.mjs:33555:import { splitCardContent as splitCardContent16 } from "cardworks";
callback-box/dist/cli.mjs:34104:import { splitCardContent as splitCardContent17 } from "cardworks";
callback-box/dist/cli.mjs:39306:import { splitCardContent as splitCardContent18 } from "cardworks";
callback-box/dist/cli.mjs:41695:import { splitCardContent as splitCardContent19 } from "cardworks";

codex
The strongest “tsc won’t catch this” example is box-local schema strings and runtime imports: `config/schemas/*.ts` can import `cardworks` through a custom Node hook, and doctests/templates prove that behavior. A source-only typecheck of callback-box won’t enumerate user boxes or generated scaffold docs.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/package.json | sed -n '1,150p' && nl -ba callback-box/tsconfig.json | sed -n '1,220p' && nl -ba callback-box/tsconfig.build.json | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	{
     2	  "name": "callback-box",
     3	  "version": "0.1.0",
     4	  "description": "A Claude Code wrapper system for file-based processing",
     5	  "type": "module",
     6	  "main": "dist/cli/index.js",
     7	  "bin": {
     8	    "cb": "./bin/cb"
     9	  },
    10	  "scripts": {
    11	    "build": "tsc",
    12	    "build:frontend": "cd src/frontend && pnpm build",
    13	    "build:all": "pnpm build && pnpm build:frontend",
    14	    "build:cli": "node scripts/build-cli.mjs",
    15	    "dev": "echo 'The dev server is the monorepo router. Run \\`pnpm dev\\` from the monorepo root.' && exit 1",
    16	    "cb": "./bin/cb",
    17	    "typecheck": "tsc --noEmit && cd src/frontend && pnpm exec tsc --noEmit",
    18	    "typecheck:frontend": "cd src/frontend && pnpm typecheck",
    19	    "typecheck:all": "pnpm typecheck && pnpm typecheck:frontend",
    20	    "lint": "eslint src/ && cd src/frontend && pnpm exec eslint src/",
    21	    "start": "node dist/webapp/server.js",
    22	    "cli": "node dist/cli/index.js",
    23	    "pretest": "node scripts/build-cli.mjs",
    24	    "test": "tap",
    25	    "test:manual": "tap 'test/manual/**/*.doctest.md' 'test/manual/**/*.test.ts'",
    26	    "knowledge-audit": "tsx src/dev/knowledge-audit.ts",
    27	    "prompt-report": "tsx src/dev/prompt-report.ts",
    28	    "generate:doc-images": "tsx src/dev/generate-doc-images.ts",
    29	    "doc-graph": "tsx src/dev/doc-graph.ts > docs/doc-graph.md",
    30	    "doc-graph-html": "tsx src/dev/doc-graph-html.ts",
    31	    "test:watch": "tap --watch",
    32	    "lint:oxlint": "oxlint -A no-unused-vars",
    33	    "lint:knip": "knip",
    34	    "lint:circular": "madge --circular --extensions ts,tsx src/"
    35	  },
    36	  "keywords": [
    37	    "claude",
    38	    "automation",
    39	    "inbox",
    40	    "procedure"
    41	  ],
    42	  "author": "",
    43	  "license": "ISC",
    44	  "devDependencies": {
    45	    "@ianbicking/personal-vibe-check": "workspace:*",
    46	    "@types/chokidar": "^1.7.5",
    47	    "@types/node": "^22.0.0",
    48	    "@types/xml2js": "^0.4.14",
    49	    "agent-doctest": "workspace:*",
    50	    "axe-core": "^4.11.4",
    51	    "eslint": "^9.39.2",
    52	    "eslint-import-resolver-typescript": "^4.4.4",
    53	    "husky": "^9.1.7",
    54	    "knip": "^5.83.1",
    55	    "lint-staged": "^16.2.7",
    56	    "madge": "^8.0.0",
    57	    "oxlint": "^1.47.0",
    58	    "tap": "^21.0.0",
    59	    "tsx": "^4.21.0",
    60	    "typescript": "^5.7.0"
    61	  },
    62	  "dependencies": {
    63	    "@anthropic-ai/claude-agent-sdk": "^0.2.128",
    64	    "@fastify/cookie": "^11.0.2",
    65	    "@fastify/multipart": "^9.4.0",
    66	    "@fastify/static": "^9.0.0",
    67	    "@fastify/websocket": "^11.2.0",
    68	    "@google/genai": "^1.44.0",
    69	    "@markdoc/markdoc": "^0.5.7",
    70	    "@modelcontextprotocol/sdk": "^1.29.0",
    71	    "@orama/orama": "^3.1.18",
    72	    "@orama/plugin-data-persistence": "^3.1.18",
    73	    "@parcel/markdown-ansi": "^2.16.3",
    74	    "@trpc/server": "^11.11.0",
    75	    "@types/better-sqlite3": "^7.6.13",
    76	    "@types/turndown": "^5.0.6",
    77	    "@types/ws": "^8.18.1",
    78	    "ansi-to-html": "^0.7.2",
    79	    "better-sqlite3": "^12.6.2",
    80	    "cardworks": "workspace:*",
    81	    "chalk": "^5.6.2",
    82	    "cheerio": "^1.2.0",
    83	    "chokidar": "^5.0.0",
    84	    "commander": "^13.0.0",
    85	    "cron-parser": "^5.5.0",
    86	    "esbuild": "^0.25.0",
    87	    "execa": "^9.6.1",
    88	    "exifr": "^7.1.3",
    89	    "fastify": "^5.7.2",
    90	    "glob": "^13.0.0",
    91	    "google-auth-library": "^10.5.0",
    92	    "grammy": "^1.40.1",
    93	    "ical.js": "^2.2.1",
    94	    "ky": "^1.14.3",
    95	    "markdownlint": "^0.40.0",
    96	    "open": "^11.0.0",
    97	    "react-virtuoso": "^4.18.6",
    98	    "rrule": "^2.8.1",
    99	    "sanitize-filename": "^1.6.3",
   100	    "simple-git": "^3.32.3",
   101	    "turndown": "^7.2.2",
   102	    "xml2js": "^0.6.2",
   103	    "yaml": "^2.7.0",
   104	    "zod": "^4.4.3"
   105	  },
   106	  "overrides": {
   107	    "react": "^18.3.1",
   108	    "react-dom": "^18.3.1"
   109	  },
   110	  "lint-staged": {
   111	    "src/frontend/src/**/*.{ts,tsx,js}": [
   112	      "eslint --config src/frontend/eslint.config.mjs"
   113	    ],
   114	    "src/!(frontend)/**/*.ts": [
   115	      "eslint"
   116	    ]
   117	  }
   118	}
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
nl: callback-box/tsconfig.build.json: No such file or directory

exec
/opt/homebrew/bin/bash -lc "find callback-box/scripts/migrate -maxdepth 1 -type f -name '*.ts' -print | wc -l && find callback-box/scripts/migrate -maxdepth 1 -type f -name '*.ts' -print | sort" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "rg -n \"from ['\\\"]cardworks['\\\"]|require\\(['\\\"]cardworks['\\\"]\\)|import\\(['\\\"]cardworks['\\\"]\\)\" callback-box/src callback-box/scripts callback-box/test callback-box/docs callback-box/*.md bin --glob '"'!callback-box/scratch/**'"' --glob '"'!callback-box/dist/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
      30
callback-box/scripts/migrate/_harness.ts
callback-box/scripts/migrate/_warnings.ts
callback-box/scripts/migrate/asset-marker.ts
callback-box/scripts/migrate/attachments.ts
callback-box/scripts/migrate/audio.ts
callback-box/scripts/migrate/briefing.ts
callback-box/scripts/migrate/capture-session.ts
callback-box/scripts/migrate/card-frontmatter.ts
callback-box/scripts/migrate/chat-thread.ts
callback-box/scripts/migrate/doc-sheet.ts
callback-box/scripts/migrate/doc-to-gdoc.ts
callback-box/scripts/migrate/email-message.ts
callback-box/scripts/migrate/email-thread.ts
callback-box/scripts/migrate/file.ts
callback-box/scripts/migrate/guide.ts
callback-box/scripts/migrate/image.ts
callback-box/scripts/migrate/jobs.ts
callback-box/scripts/migrate/landmark.ts
callback-box/scripts/migrate/memo.ts
callback-box/scripts/migrate/misc.ts
callback-box/scripts/migrate/personality.ts
callback-box/scripts/migrate/procedure-run.ts
callback-box/scripts/migrate/procedure.ts
callback-box/scripts/migrate/question.ts
callback-box/scripts/migrate/recipe.ts
callback-box/scripts/migrate/record-person.ts
callback-box/scripts/migrate/repair-refs.ts
callback-box/scripts/migrate/scheduled-script.ts
callback-box/scripts/migrate/strip-type-field.ts
callback-box/scripts/migrate/webpage-card.ts

 succeeded in 0ms:
callback-box/scripts/migrate/email-thread.ts:43:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/landmark.ts:47:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/jobs.ts:18:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scripts/migrate/scheduled-script.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/file.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/_warnings.ts:18:import type { ElementNode } from "cardworks";
callback-box/scripts/migrate/capture-session.ts:19:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:277:> import { element, escapeText } from "cardworks";
callback-box/scripts/migrate/procedure-run.ts:17:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/guide.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/personality.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/question.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/email-message.ts:48:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/procedure.ts:18:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/doc-sheet.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/misc.ts:16:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/audio.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/memo.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/chat-thread.ts:13:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/record-person.ts:15:import { parseCard, type ElementNode } from "cardworks";
callback-box/scripts/migrate/repair-refs.ts:34:import { extractRefs, splitCardContent } from "cardworks";
callback-box/test/schemas.doctest.md:18:import { parseCard } from "cardworks";
callback-box/scripts/migrate/recipe.ts:40:import { parseCard, splitCardContent, type ElementNode } from "cardworks";
callback-box/scripts/migrate/image.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/test/contains-state.doctest.md:21:import type { ElementSchema } from "cardworks";
callback-box/src/webapp/routes/views.ts:21:import type { ElementNode } from "cardworks";
callback-box/scripts/migrate/briefing.ts:14:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:25:> import { element } from "cardworks";
callback-box/src/webapp/routes/api-card-patch.ts:12:import type { ElementNode } from "cardworks";
callback-box/test/card-lint.doctest.md:15:} from "cardworks";
callback-box/test/card-io.doctest.md:15:} from "cardworks";
callback-box/src/webapp/trpc/routers/todos.ts:9:import { CardLoader, type ElementNode } from "cardworks";
callback-box/src/core/reactor/procedure-trampoline.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/test/search-extract.doctest.md:17:import type { ElementSchema } from "cardworks";
callback-box/test/box-schemas.doctest.md:34:const WIDGET_SCHEMA = `import { body, cardSchema } from "cardworks";
callback-box/test/box-schemas.doctest.md:48:const GADGET_SCHEMA = `import { element } from "cardworks";
callback-box/test/loader-registry.doctest.md:13:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/test/extfile-sync.doctest.md:12:import { splitCardContent } from "cardworks";
callback-box/src/webapp/trpc/routers/card.ts:7:import { parseCard, splitCardContent, type CardSchema, type ElementNode } from "cardworks";
callback-box/test/card-loaders.doctest.md:8:import { emptyLocation, type ElementNode } from "cardworks";
callback-box/src/schemas/guide-parse.tsx:10:import { splitCardContent } from "cardworks";
callback-box/src/webapp/trpc/routers/chat.ts:11:import { parseCard, type ElementNode } from "cardworks";
callback-box/src/schemas/landmark.ts:27:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/webapp/trpc/routers/scheduler.ts:10:import { splitCardContent } from "cardworks";
callback-box/src/schemas/guide-elements.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/briefing.tsx:19:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/todo-list.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/intake-job.tsx:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/capture-session.tsx:15:import { splitCardContent, body, cardSchema, type CardSchema } from "cardworks";
callback-box/docs/plans/remove-cardworks-package.md:151:keep-set, and repoint every `from "cardworks"` keep-set import to it.
callback-box/docs/plans/remove-cardworks-package.md:178:find/replace switches `from "cardworks"` → `from "../cards/index.js"` (path
callback-box/docs/plans/remove-cardworks-package.md:205:`grep -rl 'from "cardworks"' callback-box/src` empty, **and** (2) every box
callback-box/docs/plans/remove-cardworks-package.md:323:   `grep -rl 'from "cardworks"' callback-box/src` is empty.
callback-box/docs/EXAMPLE_FILES.md:561:import { element } from "cardworks";
callback-box/docs/EXAMPLE_FILES.md:595:import { element } from "cardworks";
callback-box/src/schemas/image.tsx:13:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/chat-thread.ts:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-message.tsx:30:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/feedback.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/file.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/email-thread.tsx:29:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/person.tsx:11:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/sheet.tsx:14:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/question-followup-job.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/recipe.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/telegram-message.ts:9:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/memo.ts:9:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/webpage.tsx:16:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/registry.ts:14:import { SchemaRegistry, type ElementSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/calendar-review-job.tsx:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/personality.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/chat-job.ts:10:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/procedure-run.ts:8:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/question.ts:8:import { cardSchema, type CardSchema } from "cardworks";
callback-box/docs/boxes-as-packages.md:17:2. **Schemas are a stub package.** `config/schemas/package.json` is `{"type":"module"}` with no dependencies. To define a real schema the agent would want `import { z } from "zod"; import { element } from "cardworks";` — same as built-in schemas in `src/schemas/`. Today this works only by accident (transitive resolution from the callback-box install) and gives no IDE help inside the box.
callback-box/src/schemas/record.tsx:12:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/commentary.tsx:15:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/scheduled-script.tsx:11:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/audio.tsx:12:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/doc.tsx:13:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/core/extfile-sync.ts:13:import { splitCardContent } from "cardworks";
callback-box/src/schemas/email-outbound.tsx:34:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/extfile.tsx:16:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/schemas/gdoc.tsx:18:import { cardSchema, type CardSchema } from "cardworks";
callback-box/src/core/load-context.ts:7:import type { ElementSchema } from "cardworks";
callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "cardworks";
callback-box/src/core/box-templates.ts:86:import { cardSchema } from "cardworks";
callback-box/src/core/box-templates.ts:133:import { element } from "cardworks";
callback-box/src/schemas/procedure.ts:11:import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
callback-box/docs/adding-schemas.md:23:import { body, cardSchema, type CardSchema } from "cardworks";
callback-box/docs/adding-schemas.md:160:import { splitCardContent } from "cardworks";
callback-box/src/core/commands/answer.ts:10:import { splitCardContent } from "cardworks";
callback-box/src/core/preactions/index.ts:21:import type { ICardLoader } from "cardworks";
callback-box/src/core/preactions/types.ts:1:import type { Card, ICardLoader, CardSchema } from "cardworks";
callback-box/src/core/landmark/resolve.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/core/preactions/transcribe.ts:18:import type { ElementNode } from "cardworks";
callback-box/src/core/commands/move-operations.ts:16:import { CardLoader } from "cardworks";
callback-box/src/core/commands/ls.ts:11:import { type ElementNode, parseCard, evaluateXPathString } from "cardworks";
callback-box/src/core/card-lint.ts:27:} from "cardworks";
callback-box/src/core/card-io.ts:27:} from "cardworks";
callback-box/src/core/procedure/engine-run-card.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/core/commands/assemble-timeline-helpers.ts:5:import { splitCardContent } from "cardworks";
callback-box/src/connectors/preserve-agent-fields.ts:12:import { splitCardContent } from "cardworks";
callback-box/src/core/file-summary.ts:13:import type { ElementNode } from "cardworks";
callback-box/src/core/search/contains-update.ts:11:import { splitCardContent } from "cardworks";
callback-box/src/core/search/refresh-file.ts:10:import { ParseError } from "cardworks";
callback-box/src/connectors/chat-utils.ts:15:import { splitCardContent } from "cardworks";
callback-box/src/connectors/intake-utils.ts:17:import { splitCardContent } from "cardworks";
callback-box/src/core/generate-docs-compile.ts:12:import { parseCard } from "cardworks";
callback-box/src/cli/commands/validate.ts:10:import { formatLintResults, type LintSummary } from "cardworks";
callback-box/src/connectors/gmail-drafts.ts:19:import { splitCardContent } from "cardworks";
callback-box/src/core/search/extract.ts:19:import type { ElementNode } from "cardworks";
callback-box/src/core/sdk-hooks.ts:14:import { formatLintResults } from "cardworks";
callback-box/src/core/agent-guide/index.ts:11:import type { ElementSchema } from "cardworks";
callback-box/src/core/agent-guide/cards.ts:6:import type { ElementSchema } from "cardworks";
callback-box/src/cli/lib/loader.ts:7:import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
callback-box/src/cli/lib/loader.ts:70:export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
callback-box/src/cli/lib/loader.ts:71:export type { ICardLoader, CardLoaderOptions } from "cardworks";

exec
/opt/homebrew/bin/bash -lc "rg -n \"scripts/migrate|MIGRATIONS|migrate\" callback-box/src/core/migrations.ts callback-box/src/cli/commands/migrate.ts callback-box/scripts/migrate --glob '"'!**/.claude/skills/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/cli/commands/migrate.ts:2: * `cb migrate` — apply pending data migrations to the box.
callback-box/src/cli/commands/migrate.ts:5: * `MIGRATIONS` list in `src/core/migrations.ts`. Runs any pending
callback-box/src/cli/commands/migrate.ts:19:  MIGRATIONS,
callback-box/src/cli/commands/migrate.ts:70:  return MIGRATIONS.filter((m) => !seen.has(m.name));
callback-box/src/cli/commands/migrate.ts:108:export const migrateCommand = new Command("migrate")
callback-box/src/cli/commands/migrate.ts:112:  .option("--mark-all-applied", "Seed the manifest as if every known migration ran. Use only for legacy boxes that were already fully migrated before this command existed; new boxes get their manifest seeded automatically by `cb init`.")
callback-box/src/cli/commands/migrate.ts:125:      const entries: ManifestEntry[] = MIGRATIONS.map((m) => ({
callback-box/src/cli/commands/migrate.ts:137:        `No migration manifest at ${MANIFEST_PATH}.\n\nThis box predates the cb migrate command. If it has already had all data migrations applied, seed the manifest with:\n  cb migrate --mark-all-applied\n\nNew boxes (via cb init) get their manifest automatically.`,
callback-box/src/core/migrations.ts:4: * `cb migrate` reads this and the per-box manifest at
callback-box/src/core/migrations.ts:13: * data loss (see scripts/migrate/_warnings.ts and the author guide
callback-box/src/core/migrations.ts:24:export const MIGRATIONS: ReadonlyArray<Migration> = [
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
callback-box/scripts/migrate/audio.ts:4: * Phase 2 (per-schema): migrate `.audio.card` files from Phase 1
callback-box/scripts/migrate/audio.ts:8: *   pnpm exec tsx scripts/migrate/audio.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/audio.ts:9: *   pnpm exec tsx scripts/migrate/audio.ts <boxRoot> --apply
callback-box/scripts/migrate/audio.ts:107:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/audio.ts:110:    return "already-migrated";
callback-box/scripts/migrate/audio.ts:126:    console.error("Usage: migrate-audio <boxRoot> [--apply]");
callback-box/scripts/migrate/audio.ts:141:      const r = await migrateFile(f);
callback-box/scripts/migrate/audio.ts:148:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/recipe.ts:35: *   pnpm exec tsx scripts/migrate/recipe.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/recipe.ts:36: *   pnpm exec tsx scripts/migrate/recipe.ts <boxRoot> --apply
callback-box/scripts/migrate/image.ts:4: * Phase 2 (per-schema): migrate `.image.card` files from Phase 1
callback-box/scripts/migrate/image.ts:8: *   pnpm exec tsx scripts/migrate/image.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/image.ts:9: *   pnpm exec tsx scripts/migrate/image.ts <boxRoot> --apply
callback-box/scripts/migrate/image.ts:154:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/image.ts:157:    return "already-migrated";
callback-box/scripts/migrate/image.ts:173:    console.error("Usage: migrate-image <boxRoot> [--apply]");
callback-box/scripts/migrate/image.ts:188:      const r = await migrateFile(f);
callback-box/scripts/migrate/image.ts:195:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/card-frontmatter.ts:18: *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/card-frontmatter.ts:19: *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot> --apply     # execute
callback-box/scripts/migrate/card-frontmatter.ts:85:    console.error("Usage: migrate-card-frontmatter <boxRoot> [--apply]");
callback-box/scripts/migrate/capture-session.ts:14: *   pnpm exec tsx scripts/migrate/capture-session.ts <root>           # dry-run
callback-box/scripts/migrate/capture-session.ts:15: *   pnpm exec tsx scripts/migrate/capture-session.ts <root> --apply
callback-box/scripts/migrate/briefing.ts:4: * Phase 2 (per-schema): migrate `briefing.briefing.card` files from
callback-box/scripts/migrate/briefing.ts:8: *   pnpm exec tsx scripts/migrate/briefing.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/briefing.ts:9: *   pnpm exec tsx scripts/migrate/briefing.ts <boxRoot> --apply
callback-box/scripts/migrate/briefing.ts:192:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/briefing.ts:195:    return "already-migrated";
callback-box/scripts/migrate/briefing.ts:212:    console.error("Usage: migrate-briefing <boxRoot> [--apply]");
callback-box/scripts/migrate/briefing.ts:229:      const r = await migrateFile(f);
callback-box/scripts/migrate/briefing.ts:236:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/procedure-run.ts:8: * archive), so this is mostly for tidiness — unmigrated run cards age out
callback-box/scripts/migrate/procedure-run.ts:12: *   pnpm exec tsx scripts/migrate/procedure-run.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/procedure-run.ts:13: *   pnpm exec tsx scripts/migrate/procedure-run.ts <boxRoot> --apply
callback-box/scripts/migrate/email-message.ts:4: * Phase 2 (per-schema): migrate `*.email-message.card` files from the Phase 1
callback-box/scripts/migrate/email-message.ts:42: *   pnpm exec tsx scripts/migrate/email-message.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/email-message.ts:43: *   pnpm exec tsx scripts/migrate/email-message.ts <boxRoot> --apply
callback-box/scripts/migrate/email-message.ts:189:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/email-message.ts:192:    return "already-migrated";
callback-box/scripts/migrate/email-message.ts:208:    console.error("Usage: migrate-email-message <boxRoot> [--apply]");
callback-box/scripts/migrate/email-message.ts:225:      const r = await migrateFile(f);
callback-box/scripts/migrate/email-message.ts:232:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/doc-to-gdoc.ts:12: *   pnpm exec tsx scripts/migrate/doc-to-gdoc.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/doc-to-gdoc.ts:13: *   pnpm exec tsx scripts/migrate/doc-to-gdoc.ts <boxRoot> --apply
callback-box/scripts/migrate/doc-to-gdoc.ts:49:async function migrateFile(absPath: string): Promise<Outcome> {
callback-box/scripts/migrate/doc-to-gdoc.ts:97:    console.error("Usage: migrate-doc-to-gdoc <boxRoot> [--apply]");
callback-box/scripts/migrate/doc-to-gdoc.ts:114:      const o = await migrateFile(f);
callback-box/scripts/migrate/email-thread.ts:4: * Phase 2 (per-schema): migrate `*.email-thread.card` files from the Phase 1
callback-box/scripts/migrate/email-thread.ts:37: *   pnpm exec tsx scripts/migrate/email-thread.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/email-thread.ts:38: *   pnpm exec tsx scripts/migrate/email-thread.ts <boxRoot> --apply
callback-box/scripts/migrate/email-thread.ts:177:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated" | "skipped"> {
callback-box/scripts/migrate/email-thread.ts:179:  // Already migrated? Look for `type: email-thread` near the top.
callback-box/scripts/migrate/email-thread.ts:181:    return "already-migrated";
callback-box/scripts/migrate/email-thread.ts:197:    console.error("Usage: migrate-email-thread <boxRoot> [--apply]");
callback-box/scripts/migrate/email-thread.ts:223:      const result = await migrateFile(f);
callback-box/scripts/migrate/email-thread.ts:225:      else if (result === "already-migrated") alreadyMigrated++;
callback-box/scripts/migrate/email-thread.ts:230:  console.log(`Converted ${String(converted)}, already migrated ${String(alreadyMigrated)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/repair-refs.ts:27: *   pnpm exec tsx scripts/migrate/repair-refs.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/repair-refs.ts:28: *   pnpm exec tsx scripts/migrate/repair-refs.ts <boxRoot> --apply
callback-box/scripts/migrate/landmark.ts:42: *   pnpm exec tsx scripts/migrate/landmark.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/landmark.ts:43: *   pnpm exec tsx scripts/migrate/landmark.ts <boxRoot> --apply
callback-box/scripts/migrate/record-person.ts:4: * Phase 2 (per-schema): migrate `.record.card` and `.person.card` files
callback-box/scripts/migrate/record-person.ts:9: *   pnpm exec tsx scripts/migrate/record-person.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/record-person.ts:10: *   pnpm exec tsx scripts/migrate/record-person.ts <boxRoot> --apply
callback-box/scripts/migrate/record-person.ts:213:async function migrateFile(
callback-box/scripts/migrate/record-person.ts:216:): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/record-person.ts:220:  if (re.test(raw)) return "already-migrated";
callback-box/scripts/migrate/record-person.ts:232:async function migrateKind(input: {
callback-box/scripts/migrate/record-person.ts:250:      const r = await migrateFile(f, kind);
callback-box/scripts/migrate/record-person.ts:257:  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/record-person.ts:270:    console.error("Usage: migrate-record-person <boxRoot> [--apply]");
callback-box/scripts/migrate/record-person.ts:274:  await migrateKind({ absRoot, kind: "record", apply });
callback-box/scripts/migrate/record-person.ts:275:  await migrateKind({ absRoot, kind: "person", apply });
callback-box/scripts/migrate/_harness.ts:98:    const cmd = process.argv[1] ?? "migrate";
callback-box/scripts/migrate/_harness.ts:123:    `Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`,
callback-box/scripts/migrate/jobs.ts:4: * Phase 2: migrate the four remaining job schemas to flat frontmatter.
callback-box/scripts/migrate/jobs.ts:12: *   pnpm exec tsx scripts/migrate/jobs.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/jobs.ts:13: *   pnpm exec tsx scripts/migrate/jobs.ts <boxRoot> --apply
callback-box/scripts/migrate/jobs.ts:205:async function migrateFile(absPath: string, kind: Kind): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/jobs.ts:209:  if (re.test(raw)) return "already-migrated";
callback-box/scripts/migrate/jobs.ts:217:async function migrateKind(input: { absRoot: string; kind: Kind; apply: boolean }): Promise<void> {
callback-box/scripts/migrate/jobs.ts:228:      const r = await migrateFile(f, kind);
callback-box/scripts/migrate/jobs.ts:235:  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/jobs.ts:247:    console.error("Usage: migrate-jobs <boxRoot> [--apply]");
callback-box/scripts/migrate/jobs.ts:252:    await migrateKind({ absRoot, kind, apply });
callback-box/scripts/migrate/asset-marker.ts:18: *   pnpm exec tsx scripts/migrate/asset-marker.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/asset-marker.ts:19: *   pnpm exec tsx scripts/migrate/asset-marker.ts <boxRoot> --apply
callback-box/scripts/migrate/file.ts:4: * Phase 2 (per-schema): migrate `.file.card` files from Phase 1
callback-box/scripts/migrate/file.ts:8: *   pnpm exec tsx scripts/migrate/file.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/file.ts:9: *   pnpm exec tsx scripts/migrate/file.ts <boxRoot> --apply
callback-box/scripts/migrate/file.ts:98:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/file.ts:101:    return "already-migrated";
callback-box/scripts/migrate/file.ts:117:    console.error("Usage: migrate-file <boxRoot> [--apply]");
callback-box/scripts/migrate/file.ts:132:      const r = await migrateFile(f);
callback-box/scripts/migrate/file.ts:139:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/attachments.ts:35: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/attachments.ts:36: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot> --apply     # execute
callback-box/scripts/migrate/attachments.ts:37: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot> --apply --no-commit
callback-box/scripts/migrate/attachments.ts:121:    console.error("Usage: migrate-attachments.ts <boxRoot> [--apply] [--commit]");
callback-box/scripts/migrate/guide.ts:13: *   pnpm exec tsx scripts/migrate/guide.ts <root>           # dry-run
callback-box/scripts/migrate/guide.ts:14: *   pnpm exec tsx scripts/migrate/guide.ts <root> --apply
callback-box/scripts/migrate/strip-type-field.ts:16: *   pnpm exec tsx scripts/migrate/strip-type-field.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/strip-type-field.ts:17: *   pnpm exec tsx scripts/migrate/strip-type-field.ts <boxRoot> --apply
callback-box/scripts/migrate/procedure.ts:13: *   pnpm exec tsx scripts/migrate/procedure.ts <root>           # dry-run
callback-box/scripts/migrate/procedure.ts:14: *   pnpm exec tsx scripts/migrate/procedure.ts <root> --apply
callback-box/scripts/migrate/scheduled-script.ts:4: * Phase 2: migrate `.scheduled-script.card` files from
callback-box/scripts/migrate/scheduled-script.ts:8: *   pnpm exec tsx scripts/migrate/scheduled-script.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/scheduled-script.ts:9: *   pnpm exec tsx scripts/migrate/scheduled-script.ts <boxRoot> --apply
callback-box/scripts/migrate/scheduled-script.ts:151:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/scheduled-script.ts:153:  // Any frontmatter card is already migrated — the filename is the type
callback-box/scripts/migrate/scheduled-script.ts:156:    return "already-migrated";
callback-box/scripts/migrate/scheduled-script.ts:171:    console.error("Usage: migrate-scheduled-script <boxRoot> [--apply]");
callback-box/scripts/migrate/scheduled-script.ts:183:      const r = await migrateFile(f);
callback-box/scripts/migrate/scheduled-script.ts:190:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/misc.ts:4: * Phase 2 (per-schema): migrate `.todo-list.card`, `.telegram-message.card`,
callback-box/scripts/migrate/misc.ts:10: *   pnpm exec tsx scripts/migrate/misc.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/misc.ts:11: *   pnpm exec tsx scripts/migrate/misc.ts <boxRoot> --apply
callback-box/scripts/migrate/misc.ts:221:async function migrateFile(absPath: string, kind: Kind): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/misc.ts:225:  if (re.test(raw)) return "already-migrated";
callback-box/scripts/migrate/misc.ts:245:async function migrateKind(input: { absRoot: string; kind: Kind; apply: boolean }): Promise<void> {
callback-box/scripts/migrate/misc.ts:259:      const r = await migrateFile(f, kind);
callback-box/scripts/migrate/misc.ts:266:  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/misc.ts:279:    console.error("Usage: migrate-misc <boxRoot> [--apply]");
callback-box/scripts/migrate/misc.ts:283:  await migrateKind({ absRoot, kind: "todo-list", apply });
callback-box/scripts/migrate/misc.ts:284:  await migrateKind({ absRoot, kind: "telegram-message", apply });
callback-box/scripts/migrate/misc.ts:285:  await migrateKind({ absRoot, kind: "feedback", apply });
callback-box/scripts/migrate/question.ts:4: * Phase 2: migrate `.question.card` files from XML to YAML frontmatter.
callback-box/scripts/migrate/question.ts:7: *   pnpm exec tsx scripts/migrate/question.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/question.ts:8: *   pnpm exec tsx scripts/migrate/question.ts <boxRoot> --apply
callback-box/scripts/migrate/question.ts:148:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/question.ts:151:    return "already-migrated";
callback-box/scripts/migrate/question.ts:166:    console.error("Usage: migrate-question <boxRoot> [--apply]");
callback-box/scripts/migrate/question.ts:178:      const r = await migrateFile(f);
callback-box/scripts/migrate/question.ts:185:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/webpage-card.ts:28: *   pnpm exec tsx scripts/migrate/webpage-card.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/webpage-card.ts:29: *   pnpm exec tsx scripts/migrate/webpage-card.ts <boxRoot> --apply
callback-box/scripts/migrate/webpage-card.ts:93: * source URL + captured date out and strip that line, so those cards migrate
callback-box/scripts/migrate/personality.ts:4: * Phase 2: migrate `.personality.card` files from Phase 1
callback-box/scripts/migrate/personality.ts:8: *   pnpm exec tsx scripts/migrate/personality.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/personality.ts:9: *   pnpm exec tsx scripts/migrate/personality.ts <boxRoot> --apply
callback-box/scripts/migrate/personality.ts:238:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/personality.ts:241:    return "already-migrated";
callback-box/scripts/migrate/personality.ts:258:    console.error("Usage: migrate-personality <boxRoot> [--apply]");
callback-box/scripts/migrate/personality.ts:270:      const r = await migrateFile(f);
callback-box/scripts/migrate/personality.ts:277:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/doc-sheet.ts:4: * Phase 2 (per-schema): migrate `.doc.card` and `.sheet.card` files from
callback-box/scripts/migrate/doc-sheet.ts:9: *   pnpm exec tsx scripts/migrate/doc-sheet.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/doc-sheet.ts:10: *   pnpm exec tsx scripts/migrate/doc-sheet.ts <boxRoot> --apply
callback-box/scripts/migrate/doc-sheet.ts:156:async function migrateFile(
callback-box/scripts/migrate/doc-sheet.ts:159:): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/doc-sheet.ts:164:    return "already-migrated";
callback-box/scripts/migrate/doc-sheet.ts:174:async function migrateKind(input: {
callback-box/scripts/migrate/doc-sheet.ts:192:      const r = await migrateFile(f, kind);
callback-box/scripts/migrate/doc-sheet.ts:199:  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/doc-sheet.ts:212:    console.error("Usage: migrate-doc-sheet <boxRoot> [--apply]");
callback-box/scripts/migrate/doc-sheet.ts:216:  await migrateKind({ absRoot, kind: "doc", apply });
callback-box/scripts/migrate/doc-sheet.ts:217:  await migrateKind({ absRoot, kind: "sheet", apply });
callback-box/scripts/migrate/chat-thread.ts:4: * Phase 2: migrate `.chat-thread.card` files from XML to YAML frontmatter.
callback-box/scripts/migrate/chat-thread.ts:7: *   pnpm exec tsx scripts/migrate/chat-thread.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/chat-thread.ts:8: *   pnpm exec tsx scripts/migrate/chat-thread.ts <boxRoot> --apply
callback-box/scripts/migrate/chat-thread.ts:136:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/chat-thread.ts:139:    return "already-migrated";
callback-box/scripts/migrate/chat-thread.ts:154:    console.error("Usage: migrate-chat-thread <boxRoot> [--apply]");
callback-box/scripts/migrate/chat-thread.ts:166:      const r = await migrateFile(f);
callback-box/scripts/migrate/chat-thread.ts:173:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
callback-box/scripts/migrate/memo.ts:4: * Phase 2 (per-schema): migrate `.memo.card` files from Phase 1
callback-box/scripts/migrate/memo.ts:8: *   pnpm exec tsx scripts/migrate/memo.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/memo.ts:9: *   pnpm exec tsx scripts/migrate/memo.ts <boxRoot> --apply
callback-box/scripts/migrate/memo.ts:117:async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
callback-box/scripts/migrate/memo.ts:120:    return "already-migrated";
callback-box/scripts/migrate/memo.ts:137:    console.error("Usage: migrate-memo <boxRoot> [--apply]");
callback-box/scripts/migrate/memo.ts:152:      const r = await migrateFile(f);
callback-box/scripts/migrate/memo.ts:159:  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);

exec
/opt/homebrew/bin/bash -lc "rg -l \"from ['\\\"]cardworks['\\\"]|require\\(['\\\"]cardworks['\\\"]\\)|import\\(['\\\"]cardworks['\\\"]\\)\" callback-box/scripts/migrate --glob '*.ts' | wc -l && rg -l \"from ['\\\"]cardworks['\\\"]|require\\(['\\\"]cardworks['\\\"]\\)|import\\(['\\\"]cardworks['\\\"]\\)\" callback-box/scripts/migrate --glob '*.ts' | sort" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
      23
callback-box/scripts/migrate/_warnings.ts
callback-box/scripts/migrate/audio.ts
callback-box/scripts/migrate/briefing.ts
callback-box/scripts/migrate/capture-session.ts
callback-box/scripts/migrate/chat-thread.ts
callback-box/scripts/migrate/doc-sheet.ts
callback-box/scripts/migrate/email-message.ts
callback-box/scripts/migrate/email-thread.ts
callback-box/scripts/migrate/file.ts
callback-box/scripts/migrate/guide.ts
callback-box/scripts/migrate/image.ts
callback-box/scripts/migrate/jobs.ts
callback-box/scripts/migrate/landmark.ts
callback-box/scripts/migrate/memo.ts
callback-box/scripts/migrate/misc.ts
callback-box/scripts/migrate/personality.ts
callback-box/scripts/migrate/procedure-run.ts
callback-box/scripts/migrate/procedure.ts
callback-box/scripts/migrate/question.ts
callback-box/scripts/migrate/recipe.ts
callback-box/scripts/migrate/record-person.ts
callback-box/scripts/migrate/repair-refs.ts
callback-box/scripts/migrate/scheduled-script.ts

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/scripts/clean-broken-refs.ts | sed -n '1,220p' && rg -n \"clean-broken-refs\" callback-box package.json pnpm-workspace.yaml bin" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	#!/usr/bin/env tsx
     2	/* eslint-disable security/detect-non-literal-fs-filename */
     3	/**
     4	 * One-off data hygiene: remove broken references in a box.
     5	 *
     6	 * Actions, all safe and idempotent:
     7	 *
     8	 *   1. Image card whose filename.ref points to a missing file → delete
     9	 *      the image card (the card is metadata about a JPG that no longer
    10	 *      exists, so the card is orphaned).
    11	 *
    12	 *   2. Capture-session whose photo refs (markdown links to sibling
    13	 *      *.image.card files) point to missing cards → remove the dead
    14	 *      link lines. If no photos remain in the session, delete it too.
    15	 *
    16	 *   3. Record card with dead sources[].ref or persons[].ref → drop the
    17	 *      dead entries. Record body and other fields are untouched. If the
    18	 *      array becomes empty, remove the field.
    19	 *
    20	 *   4. Record persons[].ref using `../../../people/Foo.person.card`
    21	 *      relative form that doesn't resolve → rewrite to absolute
    22	 *      `/people/Foo.person.card` form if the absolute target exists.
    23	 *
    24	 *   5. Intake-job, calendar-review-job, question-followup-job with any
    25	 *      dead items[]/changes[].ref → drop the dead entries. If no
    26	 *      entries remain, delete the job (it has no real work left).
    27	 *
    28	 * Anything outside these categories is reported but not touched.
    29	 *
    30	 * Usage:
    31	 *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot>           # dry-run
    32	 *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot> --apply
    33	 */
    34	
    35	import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
    36	import { basename, dirname, join, relative, resolve } from "node:path";
    37	import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
    38	import { splitCardContent } from "cardworks";
    39	
    40	interface Action {
    41	  kind: "delete-card" | "prune-refs" | "rewrite-ref";
    42	  file: string;
    43	  detail: string;
    44	}
    45	
    46	const actions: Action[] = [];
    47	const unhandled: string[] = [];
    48	
    49	async function pathExists(p: string): Promise<boolean> {
    50	  try { await stat(p); return true; } catch { return false; }
    51	}
    52	
    53	function isCardFile(name: string): boolean { return name.endsWith(".card"); }
    54	
    55	async function walk(dir: string, out: string[]): Promise<void> {
    56	  let entries;
    57	  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    58	  for (const e of entries) {
    59	    if (e.name === ".git" || e.name === "node_modules") continue;
    60	    const full = join(dir, e.name);
    61	    if (e.isDirectory()) await walk(full, out);
    62	    else if (e.isFile() && isCardFile(e.name)) out.push(full);
    63	  }
    64	}
    65	
    66	function typeFromFilename(absPath: string): string | undefined {
    67	  const m = basename(absPath).match(/^.+\.([^.]+)\.card$/);
    68	  return m ? m[1] : undefined;
    69	}
    70	
    71	/**
    72	 * Resolve a ref the way cardworks does (subset): absolute = box-root;
    73	 * `attach/...` = source card's <basename>.attach/ scope; everything
    74	 * else = relative to source card's directory.
    75	 */
    76	interface RefCtx { boxRoot: string; sourceCardAbs: string }
    77	
    78	function resolveRefPath(ctx: RefCtx, ref: string): string {
    79	  const { boxRoot, sourceCardAbs } = ctx;
    80	  if (ref.startsWith("/")) return join(boxRoot, ref.slice(1));
    81	  if (ref === "attach" || ref.startsWith("attach/")) {
    82	    const base = basename(sourceCardAbs).replace(/\.card$/, "");
    83	    const stem = base.replace(/\.[^.]+$/, "");
    84	    const attachDir = join(dirname(sourceCardAbs), `${stem}.attach`);
    85	    const rest = ref === "attach" ? "" : ref.slice("attach/".length);
    86	    return rest === "" ? attachDir : join(attachDir, rest);
    87	  }
    88	  return join(dirname(sourceCardAbs), ref);
    89	}
    90	
    91	interface FrontmatterParts { fmText: string; body: string }
    92	
    93	function readCardParts(content: string): FrontmatterParts | null {
    94	  const split = splitCardContent(content);
    95	  if (!split.hasFrontmatter) return null;
    96	  return { fmText: split.frontmatterText, body: split.body };
    97	}
    98	
    99	function writeCardParts(fields: Record<string, unknown>, body: string): string {
   100	  return `---\n${stringifyYaml(fields)}---\n${body}`;
   101	}
   102	
   103	interface HandleCtx { absPath: string; boxRoot: string; apply: boolean }
   104	
   105	async function handleImageCard(ctx: HandleCtx): Promise<void> {
   106	  const { absPath, boxRoot, apply } = ctx;
   107	  const content = await readFile(absPath, "utf8");
   108	  const parts = readCardParts(content);
   109	  if (parts === null) return;
   110	  let fields: Record<string, unknown>;
   111	  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch { return; }
   112	  if (fields === null) return;
   113	  const filename = fields["filename"] as { ref?: string } | undefined;
   114	  if (filename === undefined || typeof filename.ref !== "string") return;
   115	  const targetPath = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, filename.ref);
   116	  if (await pathExists(targetPath)) return;
   117	  actions.push({ kind: "delete-card", file: absPath, detail: `missing ${filename.ref}` });
   118	  if (apply) await unlink(absPath);
   119	}
   120	
   121	async function handleCaptureSession(ctx: HandleCtx): Promise<void> {
   122	  const { absPath, boxRoot, apply } = ctx;
   123	  // Capture-session is legacy XML; photo refs sit on their own lines as
   124	  // bare paths inside the <photos> block. Match any line that contains
   125	  // a `*.image.card` token (allowing spaces, accented chars, absolute
   126	  // and relative forms). Resolve each via the standard ref resolver
   127	  // and drop the line if the target's gone.
   128	  const raw = await readFile(absPath, "utf8");
   129	  // Two forms appear on photo-ref lines:
   130	  //   <image-ref ref="./photo-001-Foo.image.card"/>   ← XML attr form
   131	  //   ./photo-001.image.card                          ← bare path on its line
   132	  // Try the quoted form first (preserves spaces in names), then bare.
   133	  const lines = raw.split("\n");
   134	  const kept: string[] = [];
   135	  let dead = 0;
   136	  let totalRefs = 0;
   137	  for (const line of lines) {
   138	    let ref: string | undefined;
   139	    const quoted = line.match(/ref=["']([^"']*\.image\.card)["']/);
   140	    if (quoted !== null) {
   141	      ref = quoted[1];
   142	    } else {
   143	      // eslint-disable-next-line security/detect-unsafe-regex -- bounded by line length, capture-session lines are short
   144	      const bare = line.match(/^\s*((?:\.{0,2}\/)?[^\s]\S*\.image\.card)\s*$/);
   145	      if (bare !== null) ref = bare[1];
   146	    }
   147	    if (ref === undefined) { kept.push(line); continue; }
   148	    totalRefs++;
   149	    const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
   150	    const exists = await pathExists(target);
   151	    if (exists) kept.push(line);
   152	    else dead++;
   153	  }
   154	  if (dead === 0) return;
   155	  const newRaw = kept.join("\n");
   156	  // If every photo ref is now gone, the session has no work product to
   157	  // point at — delete it.
   158	  if (dead === totalRefs) {
   159	    actions.push({ kind: "delete-card", file: absPath, detail: `no photos remain (was ${String(totalRefs)})` });
   160	    if (apply) await unlink(absPath);
   161	    return;
   162	  }
   163	  actions.push({ kind: "prune-refs", file: absPath, detail: `dropped ${String(dead)} of ${String(totalRefs)} photo ref line(s)` });
   164	  if (apply) await writeFile(absPath, newRaw);
   165	}
   166	
   167	async function handleRecord(ctx: HandleCtx): Promise<void> {
   168	  const { absPath, boxRoot, apply } = ctx;
   169	  const content = await readFile(absPath, "utf8");
   170	  const parts = readCardParts(content);
   171	  if (parts === null) return;
   172	  let fields: Record<string, unknown>;
   173	  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch { return; }
   174	  if (fields === null) return;
   175	  let mutated = false;
   176	  const droppedSources: string[] = [];
   177	  const droppedPersons: string[] = [];
   178	  const rewrittenPersons: string[] = [];
   179	
   180	  const sources = fields["sources"] as Array<{ ref?: string }> | undefined;
   181	  if (Array.isArray(sources)) {
   182	    const kept: typeof sources = [];
   183	    for (const s of sources) {
   184	      const ref = typeof s.ref === "string" ? s.ref : undefined;
   185	      if (ref === undefined) { kept.push(s); continue; }
   186	      const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
   187	      if (await pathExists(target)) { kept.push(s); continue; }
   188	      droppedSources.push(ref);
   189	      mutated = true;
   190	    }
   191	    if (kept.length === 0) delete fields["sources"];
   192	    else fields["sources"] = kept;
   193	  }
   194	
   195	  const persons = fields["persons"] as Array<{ ref?: string; name?: string }> | undefined;
   196	  if (Array.isArray(persons)) {
   197	    const kept: typeof persons = [];
   198	    for (const p of persons) {
   199	      const ref = typeof p.ref === "string" ? p.ref : undefined;
   200	      if (ref === undefined) { kept.push(p); continue; }
   201	      const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
   202	      if (await pathExists(target)) { kept.push(p); continue; }
   203	      // Try absolute-rewrite if ref ends in `.person.card`.
   204	      const personFile = basename(ref);
   205	      if (personFile.endsWith(".person.card")) {
   206	        const absAlt = join(boxRoot, "people", personFile);
   207	        if (await pathExists(absAlt)) {
   208	          p.ref = `/people/${personFile}`;
   209	          kept.push(p);
   210	          rewrittenPersons.push(`${ref} → /people/${personFile}`);
   211	          mutated = true;
   212	          continue;
   213	        }
   214	      }
   215	      droppedPersons.push(ref);
   216	      mutated = true;
   217	    }
   218	    if (kept.length === 0) delete fields["persons"];
   219	    else fields["persons"] = kept;
   220	  }
callback-box/docs/maintenance.md:23:| Broken-ref cleanup | `npx tsx scripts/clean-broken-refs.ts <boxRoot>` | One-off; when `cb validate` shows ref errors that pre-date a migration | Box working tree |
callback-box/docs/maintenance.md:57:### Broken-ref cleanup — `scripts/clean-broken-refs.ts`
callback-box/docs/maintenance.md:62:npx tsx scripts/clean-broken-refs.ts <boxRoot>           # dry-run
callback-box/docs/maintenance.md:63:npx tsx scripts/clean-broken-refs.ts <boxRoot> --apply   # write
callback-box/scratch/codex-out.md:2220:callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:2221:callback-box/scripts/clean-broken-refs.ts:94:  const split = splitCardContent(content);
callback-box/scratch/codex-out.md:3098:callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:3184:The broad import search also found consumers the plan either downplays or omits from its “migrators are the last consumer” gating: `scripts/clean-broken-refs.ts`, tests/doctests, docs/example generator strings, and `box-templates.ts` strings that create box-local schemas importing `cardworks`. I’m checking which are real runtime blockers versus docs/test cleanup.
callback-box/scratch/codex-out.md:7135:callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:7832:callback-box/scratch/codex-out.md:2220:callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:8072:callback-box/scratch/codex-out.md:3098:callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scratch/codex-out.md:8599:callback-box/scripts/clean-broken-refs.ts:38:import { splitCardContent } from "cardworks";
callback-box/scripts/clean-broken-refs.ts:31: *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot>           # dry-run
callback-box/scripts/clean-broken-refs.ts:32: *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot> --apply
callback-box/scripts/clean-broken-refs.ts:267:    console.error("Usage: clean-broken-refs <boxRoot> [--apply]");
callback-box/docs/migrations.md:121:- `scripts/clean-broken-refs.ts` — not a migration; a one-off data-hygiene tool. Deletes orphan image cards (whose `filename.ref` target is gone), prunes dead refs from capture-sessions / records / jobs, and rewrites `../../../people/Foo.person.card` style relative refs to absolute form when the target exists. Idempotent; safe to re-run.
callback-box/docs/migrations.md:131:5. Some boxes hit pre-commit validation blocks from pre-existing data drift (broken refs, malformed templates). Cleaned those up via `scripts/clean-broken-refs.ts` plus hand-fixes; see commit history.
callback-box/docs/migrations.md:146:- `docs/maintenance.md` — where `cb migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface
callback-box/docs/doc-graph.md:604:- docs/migrations.md:146 (mention) — - `docs/maintenance.md` — where `cb migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface

codex
The migration count in the plan is accurate for direct `cardworks` imports in `scripts/migrate` (23 files), but the deletion scope is broader than “spent XML migrators”: `MIGRATIONS` has 28 entries, including non-cardworks migrations, and there is a documented non-migration cleanup script using `splitCardContent`. That’s a place the plan can accidentally delete useful maintenance tooling.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/migrations.ts | sed -n '1,90p' && nl -ba callback-box/docs/migrations.md | sed -n '110,155p' && nl -ba callback-box/docs/maintenance.md | sed -n '55,75p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Canonical ordered list of box data migrations.
     3	 *
     4	 * `cb migrate` reads this and the per-box manifest at
     5	 * `config/migrations.jsonl` to decide what to run. New migrations get
     6	 * appended to the array; never reorder or remove existing entries —
     7	 * the `name` is the manifest key and reordering would change which
     8	 * migrations a box thinks it has applied.
     9	 *
    10	 * Each migration is a script under `scripts/` invoked with the box root
    11	 * and `--apply`. Scripts are expected to be idempotent (safe to re-run
    12	 * if for some reason the manifest is wrong) and noisy about possible
    13	 * data loss (see scripts/migrate/_warnings.ts and the author guide
    14	 * in docs/migrations.md § "Writing a new migration").
    15	 */
    16	
    17	export interface Migration {
    18	  /** Stable key recorded in the box's migrations.jsonl. */
    19	  readonly name: string;
    20	  /** Path to the migrator script, relative to the callback-box repo root. */
    21	  readonly script: string;
    22	}
    23	
    24	export const MIGRATIONS: ReadonlyArray<Migration> = [
    25	  { name: "attachments",       script: "scripts/migrate/attachments.ts" },
    26	  { name: "card-frontmatter",  script: "scripts/migrate/card-frontmatter.ts" },
    27	  { name: "email-thread",      script: "scripts/migrate/email-thread.ts" },
    28	  { name: "email-message",     script: "scripts/migrate/email-message.ts" },
    29	  { name: "briefing",          script: "scripts/migrate/briefing.ts" },
    30	  { name: "doc-sheet",         script: "scripts/migrate/doc-sheet.ts" },
    31	  { name: "file",              script: "scripts/migrate/file.ts" },
    32	  { name: "image",             script: "scripts/migrate/image.ts" },
    33	  { name: "audio",             script: "scripts/migrate/audio.ts" },
    34	  { name: "record-person",     script: "scripts/migrate/record-person.ts" },
    35	  { name: "memo",              script: "scripts/migrate/memo.ts" },
    36	  { name: "misc",              script: "scripts/migrate/misc.ts" },
    37	  { name: "jobs",              script: "scripts/migrate/jobs.ts" },
    38	  { name: "personality",       script: "scripts/migrate/personality.ts" },
    39	  { name: "scheduled-script",  script: "scripts/migrate/scheduled-script.ts" },
    40	  { name: "question",          script: "scripts/migrate/question.ts" },
    41	  { name: "chat-thread",       script: "scripts/migrate/chat-thread.ts" },
    42	  { name: "doc-to-gdoc",       script: "scripts/migrate/doc-to-gdoc.ts" },
    43	  { name: "strip-type-field",  script: "scripts/migrate/strip-type-field.ts" },
    44	  { name: "repair-refs",       script: "scripts/migrate/repair-refs.ts" },
    45	  { name: "asset-marker",      script: "scripts/migrate/asset-marker.ts" },
    46	  { name: "webpage-card",      script: "scripts/migrate/webpage-card.ts" },
    47	  { name: "landmark",          script: "scripts/migrate/landmark.ts" },
    48	  { name: "recipe",            script: "scripts/migrate/recipe.ts" },
    49	  { name: "procedure-run",     script: "scripts/migrate/procedure-run.ts" },
    50	  { name: "procedure",         script: "scripts/migrate/procedure.ts" },
    51	  { name: "guide",             script: "scripts/migrate/guide.ts" },
    52	  { name: "capture-session",   script: "scripts/migrate/capture-session.ts" },
    53	];
    54	
    55	export const MANIFEST_PATH = "config/migrations.jsonl";
    56	
    57	export interface ManifestEntry {
    58	  readonly name: string;
    59	  readonly "applied-at": string;
    60	}
   110	| 16 | `question`         | `question.ts`          | `*.question.card`: XML → flat YAML |
   111	| 17 | `chat-thread`      | `chat-thread.ts`       | `*.chat-thread.card`: XML → YAML with discriminated entries[] |
   112	| 18 | `doc-to-gdoc`      | `doc-to-gdoc.ts`       | Rename Google-Doc `.doc.card` → `.gdoc.card` and flip the YAML `type:` so the `doc` type name can be reused for a generic in-box document type |
   113	| 19 | `strip-type-field` | `strip-type-field.ts`  | Remove the redundant `type:` field from every card's frontmatter — filename is the canonical type discriminator. Also renames `.X.job.card` → `.X-job.card` so the filename actually carries the canonical type for jobs |
   114	
   115	## Manual runs (for debugging)
   116	
   117	The per-schema scripts are runnable standalone (`npx tsx scripts/migrate/<name>.ts <boxRoot> --apply`). Useful for debugging a single migration or for one-off boxes. The manifest is **not** updated when scripts are run directly — that only happens via `cb migrate`. If you do this and want it to count, append the entry yourself or run `cb migrate --apply` afterwards.
   118	
   119	## Maintenance tools
   120	
   121	- `scripts/clean-broken-refs.ts` — not a migration; a one-off data-hygiene tool. Deletes orphan image cards (whose `filename.ref` target is gone), prunes dead refs from capture-sessions / records / jobs, and rewrites `../../../people/Foo.person.card` style relative refs to absolute form when the target exists. Idempotent; safe to re-run.
   122	
   123	## Production rollout history (box.example.com)
   124	
   125	For reference. May 23–24, 2026.
   126	
   127	1. Pushed migrators + `cb migrate` to GitHub; post-commit hook deploys to `/opt/callback/callback-box/`.
   128	2. Stopped `callback-serve` + `callback-scheduler` to avoid races.
   129	3. Per-box backup: pre-migration commit SHA + a compact tar (text-only) into `/home/callback/backups/pre-migration-<timestamp>/`. The card data is already in git; the tar is belt-and-suspenders for non-git state.
   130	4. For each box: seeded the manifest (sometimes partially for legacy boxes), ran `cb migrate --apply`, committed.
   131	5. Some boxes hit pre-commit validation blocks from pre-existing data drift (broken refs, malformed templates). Cleaned those up via `scripts/clean-broken-refs.ts` plus hand-fixes; see commit history.
   132	6. Restarted services.
   133	
   134	Residual data fixes that were one-offs (won't apply to other boxes):
   135	
   136	- `personal/config/main.personality.card` `<boxholder ref="...">` attr restored after the personality migrator dropped it. Migrator fixed to preserve.
   137	- `hearth/Test_Timer*.memo.card` had `<memo created="...">` attr instead of a `<created>` child. Hand-converted; the migrator was not extended (one-off shape).
   138	- `personal/store/callback-box/callback-box-interaction-primitives.memo.card` legacy `<card type="memo">` root. Hand-converted.
   139	- Ledger's eulogy `.md` moved into a proper `.attach/` scope; trash duplicate removed.
   140	- Several boxes had `Box.landmark.card` with `<label>` / `<symbol>` directly under `<landmark>` instead of inside `<navigation>`. Wrapped via perl one-liner.
   141	- Ledger had two `*.email-outbound.card` files still in XML (no migrator existed for that type). Hand-converted to YAML.
   142	
   143	## See also
   144	
   145	- `docs/cards-as-markdown.md` — design rationale for the YAML-frontmatter format these migrators target
   146	- `docs/maintenance.md` — where `cb migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface
   147	- `docs/adding-schemas.md` — when a *schema* change (not a data shape change) is the right move instead of a migrator
   148	- `scripts/migrate/_warnings.ts` — the noisy-mode helper every migrator uses
   149	- `scripts/migrate/_harness.ts` — shared scaffold for new migrators
   150	
   151	## Rollback
   152	
   153	Each pending migration is committed by the user (`cb migrate` doesn't auto-commit). If a migration produced unwanted changes:
   154	
   155	```bash
    55	**Author guide + runbook:** `docs/migrations.md` (how to write a new migrator with the noisy-mode `_migrate-warnings` helper, register it, document it; production rollout history; rollback).
    56	
    57	### Broken-ref cleanup — `scripts/clean-broken-refs.ts`
    58	
    59	Ad-hoc data-hygiene tool, not a migration. Deletes orphan image cards (whose `filename.ref` target is gone), prunes dead refs from capture-sessions / records / jobs, and rewrites relative person refs to absolute form. Idempotent; safe to re-run. Useful after migrating an older box where ref integrity drifted before validation existed.
    60	
    61	```bash
    62	npx tsx scripts/clean-broken-refs.ts <boxRoot>           # dry-run
    63	npx tsx scripts/clean-broken-refs.ts <boxRoot> --apply   # write
    64	```
    65	
    66	### Dead-code sweep — `npm run lint:knip`
    67	
    68	Detects unused files, exports, and dependencies. Knip can have false positives for entry-point scripts that aren't imported (CLI tools, dev scripts) — those go in `knip.json`'s `entry` array or get registered as `npm run` scripts in `package.json`.
    69	
    70	**When to run:** before a meaningful release, or whenever the code feels accumulated. Don't include in pre-commit — the run is too slow and the false-positive resolution is judgment-based.
    71	
    72	**Output:** console list of unused files / exports / deps. Triage each: real dead code → delete; legitimate entry point → register; deferred/in-progress → leave with a comment explaining why it's currently unused.
    73	
    74	### Supplemental lint — `npm run lint:oxlint`
    75	

exec
/opt/homebrew/bin/bash -lc "nl -ba cardworks/src/index.ts | sed -n '1,180p' && nl -ba cardworks/package.json | sed -n '1,130p' && rg -n \"@xmldom|xpath|xml\" cardworks/package.json callback-box/package.json pnpm-lock.yaml | head -80" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	// Cardworks - TypeScript library for managing structured XML content
     2	
     3	// Card
     4	export { type Card, createCard } from "./card/index.js";
     5	
     6	// Filesystem
     7	export { type FileSystem } from "./fs/types.js";
     8	export { NodeFileSystem } from "./fs/node-fs.js";
     9	export { MemoryFileSystem } from "./fs/memory-fs.js";
    10	
    11	// Parser
    12	export { parseXml, parseXmlFile, parseCard, ParseError } from "./parser/parse.js";
    13	export { splitCardContent, type SplitCardContent } from "./parser/frontmatter.js";
    14	export {
    15	  type ElementNode,
    16	  type Location,
    17	  type Comments,
    18	  type MixedContent,
    19	  type MixedComment,
    20	  emptyLocation,
    21	} from "./parser/provenance.js";
    22	export { dedent } from "./parser/dom-to-object.js";
    23	
    24	// Schema
    25	export {
    26	  element,
    27	  ElementNodeSchema,
    28	  type ElementConfig,
    29	  type ElementSchema,
    30	} from "./schema/element.js";
    31	export { CommentsSchema, LocationSchema } from "./schema/base.js";
    32	export {
    33	  cardSchema,
    34	  body,
    35	  extractRefs,
    36	  isBodyField,
    37	  GLOBAL_CARD_FIELDS,
    38	  type BodyKind,
    39	  type BodyField,
    40	  type BodyFieldOptions,
    41	  type FieldDecl,
    42	  type CardSchemaConfig,
    43	  type CardSchema,
    44	} from "./schema/card-schema.js";
    45	export { SchemaRegistry } from "./schema/registry.js";
    46	export { formatValidationError } from "./schema/format-error.js";
    47	
    48	// Serializer
    49	export {
    50	  serialize,
    51	  escapeText,
    52	  escapeAttr,
    53	  type SerializeOptions,
    54	} from "./serialize/serialize.js";
    55	
    56	// References
    57	export { parseRef, parseRefs } from "./refs/parse-ref.js";
    58	export { resolveRef, resolveRefs, type RefResolver } from "./refs/resolve.js";
    59	export {
    60	  type ParsedRef,
    61	  type RefFragment,
    62	  type ResolvedRef,
    63	} from "./refs/types.js";
    64	
    65	// XPath
    66	export { executeXPath, evaluateXPathString } from "./refs/xpath.js";
    67	
    68	// Loader
    69	export {
    70	  CardLoader,
    71	  MemoryCardLoader,
    72	  ValidationError,
    73	  type ICardLoader,
    74	  type CardLoaderOptions,
    75	  type MemoryCardLoaderOptions,
    76	  type MoveResult,
    77	  type CardReference,
    78	} from "./loader/loader.js";
    79	
    80	// Lint
    81	export {
    82	  lintCard,
    83	  lintCards,
    84	  lintAll,
    85	  lintContent,
    86	  formatLintResult,
    87	  formatLintResults,
    88	  formatLintResultsJson,
    89	  type LintIssue,
    90	  type LintResult,
    91	  type LintSummary,
    92	  type LintOptions,
    93	  type FormatOptions,
    94	} from "./lint/index.js";
    95	
    96	// JSX
    97	export {
    98	  createElement,
    99	  defineCardJSX,
   100	  JSXValidationError,
   101	} from "./jsx/index.js";
   102	export type {
   103	  InferJSXProps,
   104	  InferJSXElements,
   105	  CardJSXFactory,
   106	  JSXProps,
   107	  JSXChild,
   108	  CreateCardOptions,
   109	} from "./jsx/index.js";
     1	{
     2	  "name": "cardworks",
     3	  "version": "0.1.0",
     4	  "description": "TypeScript library for managing structured XML content with cards, references, versioning, and media support",
     5	  "type": "module",
     6	  "main": "./dist/index.js",
     7	  "types": "./dist/index.d.ts",
     8	  "exports": {
     9	    ".": {
    10	      "import": "./dist/index.js",
    11	      "types": "./dist/index.d.ts"
    12	    },
    13	    "./jsx/jsx-runtime": {
    14	      "import": "./dist/jsx/jsx-runtime.js",
    15	      "types": "./dist/jsx/jsx-runtime.d.ts"
    16	    },
    17	    "./jsx/jsx-dev-runtime": {
    18	      "import": "./dist/jsx/jsx-runtime.js",
    19	      "types": "./dist/jsx/jsx-runtime.d.ts"
    20	    }
    21	  },
    22	  "scripts": {
    23	    "build": "tsc",
    24	    "test": "tap",
    25	    "typecheck": "tsc --noEmit",
    26	    "lint": "eslint src",
    27	    "lint:fix": "eslint src --fix",
    28	    "lint:oxlint": "oxlint -A no-unused-vars",
    29	    "lint:knip": "knip",
    30	    "lint:circular": "madge --circular --extensions ts src/"
    31	  },
    32	  "files": [
    33	    "dist"
    34	  ],
    35	  "keywords": [
    36	    "xml",
    37	    "cards",
    38	    "references",
    39	    "versioning"
    40	  ],
    41	  "license": "MIT",
    42	  "dependencies": {
    43	    "@xmldom/xmldom": "^0.9.10",
    44	    "xpath-ts": "^1.3.13",
    45	    "zod": "^4.4.3"
    46	  },
    47	  "devDependencies": {
    48	    "@ianbicking/personal-vibe-check": "workspace:*",
    49	    "@types/node": "^22.12.0",
    50	    "eslint": "^9.19.0",
    51	    "husky": "^9.1.7",
    52	    "knip": "^5.83.1",
    53	    "lint-staged": "^16.2.7",
    54	    "madge": "^8.0.0",
    55	    "oxlint": "^1.47.0",
    56	    "tap": "^21.0.1",
    57	    "tsx": "^4.19.2",
    58	    "typescript": "^5.7.3",
    59	    "typescript-eslint": "^8.22.0"
    60	  },
    61	  "lint-staged": {
    62	    "src/**/*.ts": [
    63	      "eslint"
    64	    ]
    65	  },
    66	  "engines": {
    67	    "node": ">=20"
    68	  }
    69	}
cardworks/package.json:36:    "xml",
cardworks/package.json:43:    "@xmldom/xmldom": "^0.9.10",
cardworks/package.json:44:    "xpath-ts": "^1.3.13",
callback-box/package.json:48:    "@types/xml2js": "^0.4.14",
callback-box/package.json:102:    "xml2js": "^0.6.2",
pnpm-lock.yaml:219:      xml2js:
pnpm-lock.yaml:238:      '@types/xml2js':
pnpm-lock.yaml:447:      '@xmldom/xmldom':
pnpm-lock.yaml:450:      xpath-ts:
pnpm-lock.yaml:2731:  '@types/xml2js@0.4.14':
pnpm-lock.yaml:3038:  '@xmldom/xmldom@0.9.10':
pnpm-lock.yaml:7500:  xml2js@0.6.2:
pnpm-lock.yaml:7504:  xmlbuilder@11.0.1:
pnpm-lock.yaml:7508:  xpath-ts@1.3.13:
pnpm-lock.yaml:9842:  '@types/xml2js@0.4.14':
pnpm-lock.yaml:10148:  '@xmldom/xmldom@0.9.10': {}
pnpm-lock.yaml:11946:      xml2js: 0.6.2
pnpm-lock.yaml:13031:      '@xmldom/xmldom': 0.9.10
pnpm-lock.yaml:15582:  xml2js@0.6.2:
pnpm-lock.yaml:15585:      xmlbuilder: 11.0.1
pnpm-lock.yaml:15587:  xmlbuilder@11.0.1: {}
pnpm-lock.yaml:15589:  xpath-ts@1.3.13: {}

exec
/opt/homebrew/bin/bash -lc "rg -n \"import .*\\.\\/element|from ['\\\"]\\.\\/element|from ['\\\"]\\.\\.\\/parser|from ['\\\"]\\.\\.\\/refs|from ['\\\"]\\.\\.\\/loader|@xmldom|xpath|parseCard|ElementNode|Location\" cardworks/src/schema/card-schema.ts cardworks/src/parser/frontmatter.ts cardworks/src/schema/registry.ts cardworks/src/lint/format.ts cardworks/src/lint/lint.ts cardworks/src/parser/parse.ts cardworks/src/schema/element.ts cardworks/src/parser/provenance.ts" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
cardworks/src/parser/provenance.ts:2: * Location information for tracking source positions.
cardworks/src/parser/provenance.ts:4:export interface Location {
cardworks/src/parser/provenance.ts:37:export type MixedContent = string | ElementNode | MixedComment;
cardworks/src/parser/provenance.ts:42:export interface ElementNode {
cardworks/src/parser/provenance.ts:54:  children: ElementNode[];
cardworks/src/parser/provenance.ts:56:  location: Location;
cardworks/src/parser/provenance.ts:64:export function emptyLocation(source: string): Location {
cardworks/src/parser/parse.ts:1:import { DOMParser } from "@xmldom/xmldom";
cardworks/src/parser/parse.ts:2:import type { ElementNode, Location } from "./provenance.js";
cardworks/src/parser/parse.ts:20: * Location details for a {@link ParseError}.
cardworks/src/parser/parse.ts:22:export interface ParseErrorLocation {
cardworks/src/parser/parse.ts:32:  public readonly location: Location;
cardworks/src/parser/parse.ts:34:  constructor(message: string, { source, line, column }: ParseErrorLocation) {
cardworks/src/parser/parse.ts:49: * Parse XML content into an ElementNode tree.
cardworks/src/parser/parse.ts:53: * @returns The parsed ElementNode tree
cardworks/src/parser/parse.ts:56:export function parseXml(xml: string, options: ParseXmlOptions): Promise<ElementNode> {
cardworks/src/parser/parse.ts:139:): Promise<ElementNode> {
cardworks/src/parser/parse.ts:141:  return parseCard(content, { source: path });
cardworks/src/parser/parse.ts:151:export function parseCard(content: string, options: ParseXmlOptions): Promise<ElementNode> {
cardworks/src/lint/lint.ts:1:import type { ICardLoader } from "../loader/loader.js";
cardworks/src/lint/lint.ts:2:import type { ElementNode, Location } from "../parser/provenance.js";
cardworks/src/lint/lint.ts:3:import { parseRef, parseRefs } from "../refs/parse-ref.js";
cardworks/src/lint/lint.ts:4:import { parseCard } from "../parser/parse.js";
cardworks/src/lint/lint.ts:13:  location?: Location;
cardworks/src/lint/lint.ts:99:        issue.location = e.location as Location;
cardworks/src/lint/lint.ts:114:  location: Location;
cardworks/src/lint/lint.ts:120:function checkDuplicateIds(root: ElementNode, warnings: LintIssue[]): void {
cardworks/src/lint/lint.ts:147:function collectIds(node: ElementNode, occurrences: IdOccurrence[]): void {
cardworks/src/lint/lint.ts:172:async function checkRefsInNode(node: ElementNode, ctx: RefCheckContext): Promise<void> {
cardworks/src/lint/lint.ts:198:  location: Location;
cardworks/src/lint/lint.ts:282:    const node = await parseCard(content, { source: sourceName });
cardworks/src/schema/registry.ts:2:import type { ElementSchema } from "./element.js";
cardworks/src/schema/element.ts:2:import { CommentsSchema, LocationSchema, MixedCommentSchema } from "./base.js";
cardworks/src/schema/element.ts:15: * Base schema for any ElementNode without tag-specific validation.
cardworks/src/schema/element.ts:17:export const ElementNodeSchema: ZodType<{
cardworks/src/schema/element.ts:39:      .array(z.union([z.string(), MixedCommentSchema, z.lazy(() => ElementNodeSchema)]))
cardworks/src/schema/element.ts:41:    children: z.array(ElementNodeSchema),
cardworks/src/schema/element.ts:42:    location: LocationSchema,
cardworks/src/schema/element.ts:117:    mixed: z.array(z.union([z.string(), MixedCommentSchema, ElementNodeSchema])).optional(),
cardworks/src/schema/element.ts:119:    location: LocationSchema,

codex
I’ve got enough for the core review now. I’m doing one last pass over line references so the findings are sharp and don’t sprawl into “this needs cleanup” noise.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/box-templates.ts | sed -n '80,150p' && nl -ba callback-box/src/schemas/landmark.ts | sed -n '1,80p' && nl -ba callback-box/src/core/landmark/resolve.ts | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    80	## Optional: Templates
    81	
    82	Export a \`template\` to enable \`cb create\` for your card type. For frontmatter schemas,
    83	\`generate\` returns the card text — a YAML frontmatter block built with \`stringify\` from \`yaml\`:
    84	
    85	\`\`\`typescript
    86	import { cardSchema } from "cardworks";
    87	import { stringify as stringifyYaml } from "yaml";
    88	import { z } from "zod";
    89	
    90	export const template = {
    91	  name: "task",
    92	  description: "A task card",
    93	  argsSchema: z.object({
    94	    title: z.string().describe("Task title"),
    95	    priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level"),
    96	  }),
    97	  generate: (args: { title: string; priority?: string }) => {
    98	    const fields: Record<string, unknown> = { status: "todo", title: args.title };
    99	    if (args.priority !== undefined) fields.priority = args.priority;
   100	    return "---\\n" + stringifyYaml(fields) + "---\\n";
   101	  },
   102	  cardTypes: ["task"],
   103	  defaultForTypes: ["task"],
   104	};
   105	
   106	export default cardSchema("task", {
   107	  // ... schema definition
   108	});
   109	\`\`\`
   110	
   111	## After Adding or Modifying Schemas
   112	
   113	Run \`cb init\` to regenerate rules and documentation:
   114	
   115	\`\`\`bash
   116	cb init .
   117	\`\`\`
   118	
   119	This will:
   120	- Generate \`.claude/rules/card-<type>.md\` (if the schema has \`instructions\`)
   121	- Generate \`docs/generated/card-<type>.md\`
   122	- Register any templates for \`cb create\`
   123	
   124	Schema changes are picked up on the next \`cb\` invocation; a running dev server needs a restart.
   125	
   126	## Legacy: XML / \`element()\` schemas
   127	
   128	Use \`element()\` only when the card body is Markdoc-shaped inline content — nested, attributed
   129	inline structure that doesn't fit YAML frontmatter. This is why the built-in \`guide\` and
   130	\`capture-session\` types still use it. For everything else, prefer \`cardSchema\` above.
   131	
   132	\`\`\`typescript
   133	import { element } from "cardworks";
   134	import { z } from "zod";
   135	
   136	export default element("note", {
   137	  attrs: {
   138	    status: z.enum(["draft", "final"]).default("draft"),
   139	  },
   140	  children: z.array(z.unknown()),
   141	  instructions: \\\`# Note Cards
   142	
   143	Instructions for the agent on how to handle this card type.\\\`,
   144	});
   145	\`\`\`
   146	
   147	A legacy template's \`generate\` emits XML instead of YAML, using \`escapeText\` / \`escapeAttr\` for
   148	interpolated values. See the built-in XML schemas in callback-box's \`src/schemas/\` for examples.
   149	
   150	## Tips
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
    27	import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
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
     1	/**
     2	 * Resolve a landmark's `navigation` links into a flat list pointing at
     3	 * real (or missing) cards. Used by the landmarks tRPC procedure to ship
     4	 * pre-resolved data to the client.
     5	 *
     6	 * See docs/landmarks.md for semantics (template syntax, dedup, order).
     7	 */
     8	
     9	import * as fs from "node:fs/promises";
    10	import * as path from "node:path";
    11	import { glob } from "glob";
    12	import { splitCardContent } from "cardworks";
    13	import { parse as parseYaml } from "yaml";
    14	import type {
    15	  LandmarkExpandData,
    16	  LandmarkNavigationData,
    17	  LandmarkOrderType,
    18	} from "../../schemas/landmark.js";
    19	import { isCardFile } from "../../cli/lib/paths.js";
    20	import { titleFromFilename } from "../file-summary.js";
    21	
    22	export interface ResolvedLink {
    23	  /** Box-relative path to the target card. */
    24	  ref: string;
    25	  /** Explicit landmark label; null means "fall back to title". */
    26	  label: string | null;
    27	  /** Display title for the target (filename-derived for now). */
    28	  title: string;
    29	  /** True if the target file exists on disk. */
    30	  exists: boolean;
    31	}
    32	
    33	export interface ResolveOptions {
    34	  /** Absolute path to the landmark card's directory. */
    35	  landmarkDir: string;
    36	  /** Absolute path to the box root. */
    37	  boxRoot: string;
    38	}
    39	
    40	const PLACEHOLDER_RE = /\${([^}]+)}/g;
    41	
    42	/**
    43	 * Resolve a landmark's navigation links. Hand-listed links come first,
    44	 * then expanded links; duplicates by ref are dropped (first wins). A
    45	 * landmark without a `navigation` role resolves to no links.
    46	 */
    47	export async function resolveLandmark(
    48	  navigation: LandmarkNavigationData | undefined,
    49	  options: ResolveOptions,
    50	): Promise<ResolvedLink[]> {
    51	  const out: ResolvedLink[] = [];
    52	  const seen = new Set<string>();
    53	  if (navigation === undefined) return out;
    54	
    55	  for (const link of navigation.links ?? []) {
    56	    if (link.ref === "") continue;
    57	    const resolved = await buildLink({ rawRef: link.ref, label: link.label ?? null, options });
    58	    addUnique(resolved, { out, seen });
    59	  }
    60	  for (const expand of navigation.expand ?? []) {
    61	    const expanded = await resolveExpand(expand, options);
    62	    for (const link of expanded) addUnique(link, { out, seen });
    63	  }
    64	  return out;
    65	}
    66	
    67	interface DedupAccumulator {
    68	  out: ResolvedLink[];
    69	  seen: Set<string>;
    70	}
    71	
    72	function addUnique(link: ResolvedLink, acc: DedupAccumulator): void {
    73	  if (acc.seen.has(link.ref)) return;
    74	  acc.seen.add(link.ref);
    75	  acc.out.push(link);
    76	}
    77	
    78	async function resolveExpand(
    79	  expand: LandmarkExpandData,
    80	  options: ResolveOptions,
    81	): Promise<ResolvedLink[]> {
    82	  if (expand.query === "") return [];
    83	  const order = parseOrder(expand.order);
    84	  const matchesRel = await runQuery(expand.query, options.landmarkDir);
    85	  const sorted = await sortMatches(matchesRel, { order, cwd: options.landmarkDir });
    86	
    87	  const refTpl = expand["template-ref"] ?? "${path}";
    88	  const labelTpl = expand["template-label"] ?? "";
    89	
    90	  const out: ResolvedLink[] = [];
    91	  for (const matchRel of sorted) {
    92	    let frontmatter: Record<string, unknown> | null = null;
    93	    if (needsLookup(refTpl) || needsLookup(labelTpl)) {
    94	      frontmatter = await loadFrontmatter(path.join(options.landmarkDir, matchRel));
    95	    }
    96	    const vars: TemplateVars = { matchRel, frontmatter };
    97	    const ref = applyTemplate(refTpl, vars);
    98	    const label = applyTemplate(labelTpl, vars).trim();
    99	    out.push(await buildLink({
   100	      rawRef: ref,
   101	      label: label.length > 0 ? label : null,
   102	      options,
   103	    }));
   104	  }
   105	  return out;
   106	}
   107	
   108	/** True if the template references any field beyond the special `${path}`. */
   109	function needsLookup(template: string): boolean {
   110	  for (const m of template.matchAll(PLACEHOLDER_RE)) {
   111	    if (m[1] !== "path") return true;
   112	  }
   113	  return false;
   114	}
   115	
   116	interface TemplateVars {
   117	  matchRel: string;
   118	  frontmatter: Record<string, unknown> | null;
   119	}
   120	

exec
/opt/homebrew/bin/bash -lc "rg -n \"move|moveOne|movePhase2|ls --format|format\" callback-box/test callback-box/docs --glob '"'!**/.claude/skills/**'"' --glob '"'!callback-box/scratch/**'"' | head -120" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/docs/composer-input-machine.md:143:  - `STOP_DICTATION` (manual stop / Esc / cancel) → **idle** (move transcript → `draft` or
callback-box/docs/composer-input-machine.md:220:for the segment-counter bookkeeping and removes the effects entirely.
callback-box/docs/composer-input-machine.md:269:   machine transition), and the two places that move text — committing a transcript into the box
callback-box/docs/procedure-implementation.md:112:**No-op runs leave nothing behind.** The run dir and card are written to disk at start (the on-disk card is the "procedure is running" signal for `cb tick`'s at-rest gate), but the first git commit is deferred until a step does something non-skip — a precheck pass, a precheck failure, or a step with no run phase. If every executed step skips, the run dir is removed at completion and nothing is committed; the tick's outcome in `scheduler.jsonl` is the provenance. A frequently-scheduled procedure that usually finds nothing to do costs nothing.
callback-box/docs/prompt-audits.md:23:- **Stale scaffolding** — instructions written for an earlier version of the feature, no longer applicable but never removed.
callback-box/docs/prompt-audits.md:61:When the agent encounters a large source (long PDF, email thread, Drive doc, transcribed audio) for the first time, the right move is to generate a card/brief *on demand* and persist it, then operate from the card thereafter. Three failure modes to audit against:
callback-box/docs/prompt-audits.md:71:Policy: when answering from a source that has a card/brief, the agent's citation should link to the card, not the underlying file. The card is the canonical reference; the file is provenance, reachable from the card. Without this discipline the brief never becomes the "reusable artifact" — the agent keeps re-deriving understanding from raw media each time, and downstream artifacts inherit references to formats (PDFs, audio) that are expensive to re-traverse.
callback-box/docs/prompt-audits.md:146:**Escape hatch is mandatory.** Forced commitment without an escape produces *fake commits* — the subagent picks an answer because the format demanded one, not because it believes it. The prompt must explicitly allow "escalate / insufficient info / would need X before recommending" so the subagent can decline to commit honestly when it can't commit honestly.
callback-box/docs/prompt-audits.md:186:Exception: when the resource genuinely has no addressable form (a person mentioned in passing who has no card yet), bare name is unavoidable — but consider whether the right move is to *create* the resource so it can be linked.
callback-box/test/dictation-draft.doctest.md:13:  formatDraftAge,
callback-box/test/dictation-draft.doctest.md:72:## formatDraftAge
callback-box/test/dictation-draft.doctest.md:78:formatDraftAge(0)
callback-box/test/dictation-draft.doctest.md:81:formatDraftAge(10_000)
callback-box/test/dictation-draft.doctest.md:88:formatDraftAge(60_000)
callback-box/test/dictation-draft.doctest.md:91:formatDraftAge(3 * 60_000)
callback-box/test/dictation-draft.doctest.md:94:formatDraftAge(60 * 60_000)
callback-box/test/dictation-draft.doctest.md:97:formatDraftAge(3 * 60 * 60_000)
callback-box/test/dictation-draft.doctest.md:100:formatDraftAge(24 * 60 * 60_000)
callback-box/test/dictation-draft.doctest.md:103:formatDraftAge(48 * 60 * 60_000)
callback-box/test/selection-position.doctest.md:1:# Selection position formatting
callback-box/test/selection-position.doctest.md:3:`formatPosition(parts)` renders the `SelectionParts` extracted from a
callback-box/test/selection-position.doctest.md:9:it depends on the live rendered document; this covers the pure formatter.
callback-box/test/selection-position.doctest.md:12:import { formatPosition } from "../src/frontend/src/lib/selection-position.js";
callback-box/test/selection-position.doctest.md:18:formatPosition({
callback-box/test/selection-position.doctest.md:31:formatPosition({ section: "body", heading: null, paragraph: 3, line: null })
callback-box/test/selection-position.doctest.md:39:formatPosition({
callback-box/test/selection-position.doctest.md:52:formatPosition({ section: "frontmatter", heading: null, paragraph: null, line: null })
callback-box/test/selection-position.doctest.md:60:JSON.stringify(formatPosition({ section: null, heading: null, paragraph: null, line: null }))
callback-box/test/search-extract.doctest.md:36:  "---\ncreated: 2026-05-22T10:00:00Z\ncontains: Dentist moved to June 17; confirmation in this email.\n---\nThe dentist called — appointment moved to June 17.\n"
callback-box/test/search-extract.doctest.md:48:=> The dentist called — appointment moved to June 17.
callback-box/test/search-extract.doctest.md:51:=> Dentist moved to June 17; confirmation in this email.
callback-box/test/search-extract.doctest.md:57:=> The dentist called — appointment moved to June 17.
callback-box/docs/design-card-views.md:482:  | { op: "remove-attr"; path?: string; attr: string }
callback-box/docs/design-card-views.md:485:  | { op: "remove-child"; path: string; index: number };
callback-box/docs/design-card-views.md:670:                  {formatAmount(ing.amount * scale)} {ing.unit}
callback-box/docs/design-card-views.md:707:function formatAmount(n: number): string {
callback-box/docs/design-card-views.md:784:  return `${formatAmount(scaled)} servings`;
callback-box/docs/design-card-views.md:790:Capture sessions are the prototypical "complex card with reading flow + lifecycle transitions" case: a structured timeline of clips and images, mutations as the agent processes them (transcriptions, descriptions), and a terminal archive step that moves the card. A plugin renderer would expose the timeline interactively, route mutations through the generic patch endpoint, and use a separate move endpoint for the archive transition. Whether that interactive surface is worth building over the default Card Tree view is a follow-up question — the architecture supports it either way.
callback-box/docs/design-card-views.md:858:POST /api/card/box/inbox/capture-2026-05-22.capture-session.card/move
callback-box/docs/design-card-views.md:862:This wraps the existing `cb mv` logic (loader.move + reference updates + git commit).
callback-box/docs/design-card-views.md:872:7. **Card move endpoint** — Lifecycle transitions (e.g. archive a processed capture session, file a triaged item) that aren't expressible as patches.
callback-box/docs/design-card-views.md:873:8. **First non-trivial plugin renderer** — Pick a card type with structured internal content (capture-session, briefing) and build its custom view as a plugin. Validates that the registry, patch endpoint, and move endpoint compose correctly.
callback-box/test/calendar-utils.doctest.md:3:Parsing and formatting utilities for `.ics` calendar files. `parseIcsContent` extracts events from iCalendar data. `formatEvent` produces terminal-friendly display strings. `parseTimespan` converts shorthand like `"7d"` into milliseconds.
callback-box/test/calendar-utils.doctest.md:6:import { parseIcsContent, formatEvent, parseTimespan, filterByDateRange } from "../src/connectors/calendar-utils.js";
callback-box/test/calendar-utils.doctest.md:127:## formatEvent
callback-box/test/calendar-utils.doctest.md:150:formatEvent(makeEvent({ summary: "Weekly Standup" }))
callback-box/test/calendar-utils.doctest.md:157:formatEvent(makeEvent({ summary: "Dentist", allDay: true }))
callback-box/test/calendar-utils.doctest.md:164:formatEvent(makeEvent({ summary: "Lunch", opaque: false }))
callback-box/test/calendar-utils.doctest.md:171:formatEvent(makeEvent({ summary: "School Play", calendarRole: "reader", calendarName: "GRS Calendar" }))
callback-box/test/calendar-utils.doctest.md:178:formatEvent(makeEvent({ summary: "Offsite", location: "HQ", description: "Bring laptop" }))
callback-box/docs/knowledge-audits.md:33:After running audits, **update the status comments in `knowledge-audits.yaml`** with the date and results. Each test section (e.g., `# === Don't Drop Important Information ===`) should have a `# Status (YYYY-MM-DD):` comment noting:
callback-box/docs/knowledge-audits.md:56:- `fixture` — map of box-relative path → file content, written before the test and removed afterward. Used to stage a `CLAUDE.md` (or any other file) without checking it into the box. Combined with `context_dir`, this lets a single audit set up its own landmark-style scratch directory.
callback-box/test/triage.doctest.md:82:`probable`. The file moves from `inbox/staged/` to
callback-box/test/triage.doctest.md:173:A `guess`-level decision moves the file into `_unsure/` and writes a
callback-box/test/chat-turn-buffer.doctest.md:97:## waitForChange resolves immediately when the version moved (no missed wakeup)
callback-box/test/connector-drive-docs.doctest.md:314:## Conflict — push stays skipped until `.remote.md` is removed
callback-box/test/parse-tags.doctest.md:99:Backticks wrapping the input are removed (common in LLM output):
callback-box/test/parse-tags.doctest.md:142:malformation worth surfacing:
callback-box/docs/landmarks.md:72:Earlier sketches included prose fields. Removed: a bookmark seen hundreds of times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs a written rationale, write a doc card and add it to `links` as the first reference. That keeps the schema honest about its job.
callback-box/test/chat-features.doctest.md:214:returns the deltas and the content with the tags removed.
callback-box/test/upload-helpers.doctest.md:104:## Bad ledger format is rejected loudly
callback-box/test/upload-helpers.doctest.md:114:err !== null && err.message.includes("not in the expected format")
callback-box/docs/boxes-as-packages.md:59:│   ├── views/              moved from <box>/views/
callback-box/docs/boxes-as-packages.md:60:│   ├── schemas/            moved from <box>/config/schemas/
callback-box/docs/boxes-as-packages.md:61:│   ├── tricks/             moved from <box>/tricks/
callback-box/docs/boxes-as-packages.md:275:What this means for the proposed migration: the per-box data layout is already correct. The deltas are all about *processes*, *users*, *front-door auth*, and *box code*. The cards on disk don't move.
callback-box/docs/boxes-as-packages.md:327:Pulling apart what can move independently:
callback-box/docs/boxes-as-packages.md:349:- When the last box flips, the shared `cb serve` is decommissioned, `/opt/callback/` source tree retired, `callback` user removed.
callback-box/docs/boxes-as-packages.md:565:Any commit under `src/` triggers a restart of that box's systemd unit (cheap, ~1–2s). `package.json` changes trigger `pnpm install` then restart. Failure path: revert the commit (or move to `wip/`), keep the previous process running, log it, surface on the dashboard.
callback-box/docs/boxes-as-packages.md:625:Constraint this imposes on library development: callback-box can never break the on-disk format in a way that requires a manual step. Any sqlite schema change ships with an in-process migration. If a breaking change is genuinely needed, it goes through a deprecation cycle (one minor version supports both formats, the next drops the old one).
callback-box/docs/boxes-as-packages.md:697:- **Interaction with the [Markdown cards idea](ideas.md#markdown-cards-replacing-xml).** Both touch the schema-definition surface. Probably independent; markdown-cards is about on-disk format, this is about who runs the schema validator and where. Decide before locking the schema-helper export surface.
callback-box/docs/health-checks.md:43:### Report format
callback-box/docs/health-checks.md:57:3. **Look for a moved/missing wrapper:** `ls -la /opt/callback/callback-box/deploy/claude-update.sh` — should be executable and owned so the callback user can read+execute. `setup-server.sh` handles this but a bad deploy could leave it wrong.
callback-box/test/install-validation-hooks.doctest.md:144:## Cb path drift — updates command when callback-box moves
callback-box/docs/architecture/CLAUDE.md:19:**Image prompt format in markdown:**
callback-box/docs/activities-retrospective.md:3:**Status:** the Activities system was removed from callback-box in May 2026. This doc records what was tried, what happened, and what replaced it.
callback-box/docs/activities-retrospective.md:15:## Why it was removed
callback-box/docs/activities-retrospective.md:32:## What was removed
callback-box/docs/agent-knowledge.md:5:When we talk about what the agent "knows," there are distinct phenomena worth naming. These categories mix together where information lives, what retrieval strategy is needed, and what failure modes look like — but that's because they describe the distinct behaviors agents actually exhibit. Some are about the knowledge architecture (knows directly, knows about), some about retrieval effort (discoverable, deducible, researchable), and some about what goes wrong when retrieval doesn't happen (guessable, improvised). They don't form a tidy linear spectrum — each is a phenomenon you might encounter when testing or observing an agent, and a starting point for further investigation.
callback-box/docs/agent-knowledge.md:7:1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CLAUDE.md` → `.callback-box/agent-guide.md`, plus any `.claude/rules/` files triggered by the current task. These answers should be immediate and accurate.
callback-box/docs/agent-knowledge.md:11:3. **Discoverable** — Information is available locally but requires search or exploration to locate. For example, grepping docs for a keyword, listing directory contents, or reading config files. The agent isn't told where to look — it has to figure that out. Success depends on search strategy and how discoverable the information is.
callback-box/docs/agent-knowledge.md:15:5. **Researchable** — The information exists somewhere on the internet but not locally. The agent would need to use web search to find it. Examples: how a third-party API works, what format a particular standard uses, best practices for something the codebase doesn't document. Distinct from deducible because the answer can't be found by reading local files — it requires going outside the environment.
callback-box/docs/agent-knowledge.md:21:8. **Knows it doesn't know** — The agent is aware of the gap. Something is acknowledged to exist but the agent genuinely lacks access to the information. Better than guessing — the agent can say "I don't have that information" or ask. Example: connector auth secrets live in `config/connectors/*.secret.*` — ideally these would be inaccessible to the agent (not just forbidden), so the agent knows connectors need credentials but can't read the actual values. (Today the agent *can* read these files, which makes this "deducible" rather than true "doesn't know" — a gap in the access model.)
callback-box/docs/agent-knowledge.md:23:9. **Does not know** — Beyond the agent's knowledge boundaries. Pursuing the question yields no answer. The agent may have given up while the information was still deducible.
callback-box/docs/agent-knowledge.md:27:The same information can sit at different levels depending on what the agent is currently doing. In Claude Code, this happens concretely through conditional rules:
callback-box/docs/agent-knowledge.md:29:- `config/schemas/CLAUDE.md` is **knows directly** when the agent is editing files in `config/schemas/` (Claude Code auto-loads directory CLAUDE.md files). But when the agent is working on something unrelated, the same information is only **discoverable** — the agent would have to navigate to that directory and find the file.
callback-box/docs/agent-knowledge.md:33:- A guide card's compiled rules (e.g., `docs/generated/intake-guide.md`) are **knows directly** when processing an intake job (the job-specific rule file references them). Outside that context, the same information is **knows about** (referenced in the agent guide's card type list) or **discoverable** (via directory listing).
callback-box/docs/agent-knowledge.md:56:- **"Think it through"** / **"Take your time"** — Encourages the agent to follow references and reason more carefully. "Knows about" questions should reliably get doc reads. But may still not trigger exploration for discoverable questions — the agent thinks harder about what it already has rather than going looking for new information.
callback-box/docs/agent-knowledge.md:137:cb prompt "How do you move a card from inbox to archive?"
callback-box/docs/agent-knowledge.md:233:- Watch for: does it read the doc to get the cron/interval format right?
callback-box/docs/agent-knowledge.md:296:- Watch for: does it know to create a `.tsx` file in `views/`? Does it read `docs/generated/views.md` for the format, or guess?
callback-box/docs/agent-knowledge.md:307:- **Expected level: Knows about** — the agent guide references `docs/generated/views.md`; the agent should read it for the exact format
callback-box/docs/agent-knowledge.md:308:- Watch for: does it read the views doc, or guess the file format? Key details to get right: named exports for metadata, default export for component, dependency globs, `ViewProps` shape
callback-box/docs/agent-knowledge.md:330:- Watch for: does it use path-first format for files, and slug format only for custom dashboard views?
callback-box/docs/agent-knowledge.md:343:| How to create a view (format, API) | Knows about | `docs/generated/views.md` |
callback-box/docs/agent-knowledge.md:397:- Watch for: does it answer immediately, or search for the information?
callback-box/docs/agent-knowledge.md:402:- **Expected level: Knows directly** — "Personal information aide" is in the compiled personality
callback-box/docs/agent-knowledge.md:445:- **Procedure authoring**: Trimmed the procedure pointer to remove specifics (phases, primitives) that were giving the agent enough to guess from.
callback-box/docs/agent-knowledge.md:449:**Procedure authoring (`create-procedure`)** — The agent constructs plausible procedure XML without reading `docs/generated/procedures.md`, even after trimming the pointer. The procedure format uses custom conventions (precheck/run/validate phases, shell/agent/instruction primitives, CHECK_SKIP exit codes) but the general shape is close enough to common XML procedure patterns that the model guesses confidently. Open question: should the format be more conventional (so guessing works reliably) or more distinctive (so guessing fails visibly)? Alternatively, the real test might be whether the generated XML actually validates — a scenario test that creates a procedure and runs `cb validate` would answer this better than a knowledge audit.
callback-box/docs/agent-knowledge.md:464:| What's your role? | Knows directly | **Pass** | "Personal information aide" — exact term. |
callback-box/docs/agent-knowledge.md:467:| What tone instructions do you follow? | Discoverable | **Guessed** | Answered from description paragraph, reformatting it as tone instructions. Did NOT read the personality card to find actual `<tone>` elements. Sounds right but isn't surfacing the real data. |
callback-box/docs/agent-knowledge.md:492:| "What should I have for dinner?" reasoning test | **Pass** | Personality traits visibly shaped reasoning: grounded suggestions in boxholder's saved data, asked clarifying questions, credited ideas back, admitted limits ("I'm not a food expert — I'm an information aide"), and imagined a long-term version with more signal. |
callback-box/test/schedule-health.doctest.md:15:  formatDurationShort,
callback-box/test/schedule-health.doctest.md:80:print(`${h.status}, pending: ${formatDurationShort(h.pendingMs)}`);
callback-box/docs/maintenance.md:7:The system carries a lot of agent-facing surface: CLAUDE.md and rule files, schemas with embedded `instructions`, prompt-builder code, connector rules, procedure templates. Ordinary code changes can quietly invalidate that surface — a refactor renames a method, a schema gains a field, a doc moves — and nothing in the type system or test suite catches it. The audits and reports below exist to keep that surface honest, with humans deciding what's intentional drift vs. regression.
callback-box/docs/maintenance.md:82:**When to run:** after large refactors that move shared code around. A new value-import cycle is almost always a sign that a module needs to be split.
callback-box/test/routes-files-write.doctest.md:38:## POST appends; the returned identity moves
callback-box/test/routes-history.doctest.md:77:Invalid hash format returns empty diff:
callback-box/test/routes-history.doctest.md:110:Invalid session ID format also returns not found:
callback-box/test/card-lint.doctest.md:131:(referents being moved, archived, trashed, or hand-deleted), and treating
callback-box/docs/testing.md:8:2. **Documentation** — Tests as literate documents that tell a story about how things work. Doctests are the primary format: readable markdown that happens to be executable.
callback-box/docs/testing.md:89:| `test/calendar-utils.doctest.md` | ICS parsing, event formatting, timespan parsing, date filtering |
callback-box/docs/testing.md:94:| `test/format.doctest.md` | `stripAnsi()` |
callback-box/docs/testing.md:326:3. **Write `scenario.yaml`** with steps. Each step runs a shell command (usually a `cb` command) and validates the result. See the format description above.
callback-box/docs/testing.md:373:**When to use:** Verifying that documentation, agent guides, and conditional rules are working — that the agent has the right information at the right time. Not for testing system behavior.
callback-box/docs/testing.md:424:3. **Output:** Structured findings with evidence, impact, and concrete suggestions (CLI format changes, new commands, `.claude/rules/` hints).
callback-box/docs/testing.md:447:3. **For unhelpful-output:** Modify the `cb` command's output format — trim noise, surface key info earlier, add structured markers the agent can parse.
callback-box/docs/architecture/image-gen.yaml:24:# illustrations but work as an information graphic — legible labels,
callback-box/docs/doc-graph.html:396:          <p class="pillar-blurb">The core data format. YAML-frontmatter markdown with typed schemas — that&#39;s it.</p>
callback-box/docs/doc-graph.html:419:          <span class="curator-note">What to run when the card format changes under a live box.</span>

exec
/opt/homebrew/bin/bash -lc 'rg -n "function lookupField|lookupField|dotted|resolve.*field" callback-box/src/core/landmark callback-box/src | head -100' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/core/landmark/resolve.ts:125:    return lookupField(vars.frontmatter, expr);
callback-box/src/core/landmark/resolve.ts:130: * Read a dotted field path out of a frontmatter mapping. `${title}` →
callback-box/src/core/landmark/resolve.ts:135:function lookupField(frontmatter: Record<string, unknown>, expr: string): string {
callback-box/src/schemas/landmark.ts:60: * card's frontmatter (dotted paths allowed, e.g. `${exif.camera}`).
callback-box/src/dev/doc-graph-html-css.ts:273:    border-top: 1px dotted var(--rule);
callback-box/src/core/landmark/resolve.ts:125:    return lookupField(vars.frontmatter, expr);
callback-box/src/core/landmark/resolve.ts:130: * Read a dotted field path out of a frontmatter mapping. `${title}` →
callback-box/src/core/landmark/resolve.ts:135:function lookupField(frontmatter: Record<string, unknown>, expr: string): string {
callback-box/src/core/commands/answer.ts:238:  const resolved = resolveAnswer(fields, {
callback-box/src/core/card-io.ts:355: * Job cards use the dotted convention `Foo.<kind>.job.card` (the reactor
callback-box/src/connectors/gmail-drafts.ts:154:      throw new UnresolvedInReplyToRefError(fields.inReplyToRef, sourcePath);
callback-box/src/frontend/src/pages/BrowsePage.tsx:55:  // not a file — despite carrying a dotted suffix.
callback-box/src/cli/commands/wakeup-steps.ts:263:      // legacy dotted names like `.intake.job.card`.

codex
One more citation nit: the plan’s proposed reuse of landmark `lookupField` is real, but it’s private inside `landmark/resolve.ts`; reusing it means extracting or duplicating it, not simply importing an existing helper. That’s small, but it’s exactly the kind of “free reuse” claim that turns into an implementation wrinkle.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/landmark/resolve.ts | sed -n '120,155p' && rg -n \"cb ls|commands/ls|executeLs|--format\" callback-box/test callback-box/docs callback-box/src --glob '"'!callback-box/scratch/**'"' --glob '"'!callback-box/dist/**'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
   120	
   121	function applyTemplate(template: string, vars: TemplateVars): string {
   122	  return template.replace(PLACEHOLDER_RE, (_match, expr: string) => {
   123	    if (expr === "path") return vars.matchRel;
   124	    if (vars.frontmatter === null) return "";
   125	    return lookupField(vars.frontmatter, expr);
   126	  });
   127	}
   128	
   129	/**
   130	 * Read a dotted field path out of a frontmatter mapping. `${title}` →
   131	 * `frontmatter.title`; `${exif.camera}` walks nested mappings. Missing or
   132	 * non-scalar values render as the empty string. This replaces the old
   133	 * XPath-over-XML evaluation now that cards are YAML frontmatter.
   134	 */
   135	function lookupField(frontmatter: Record<string, unknown>, expr: string): string {
   136	  let cursor: unknown = frontmatter;
   137	  for (const key of expr.split(".")) {
   138	    if (cursor === null || typeof cursor !== "object") return "";
   139	    cursor = (cursor as Record<string, unknown>)[key];
   140	  }
   141	  if (cursor === null || cursor === undefined) return "";
   142	  if (typeof cursor === "object") return "";
   143	  return String(cursor);
   144	}
   145	
   146	async function loadFrontmatter(absPath: string): Promise<Record<string, unknown> | null> {
   147	  let content: string;
   148	  try {
   149	    content = await fs.readFile(absPath, "utf-8");
   150	  } catch (_e) {
   151	    return null;
   152	  }
   153	  const split = splitCardContent(content);
   154	  if (!split.hasFrontmatter) return null;
   155	  let fm: unknown;
callback-box/docs/landmarks.md:80:`query` is a glob pattern, matching `cb ls` conventions (`*.recipe.card`, `**/*.todo-list.card`, etc.). Resolved relative to the landmark's directory.
callback-box/docs/landmarks.md:93:The `${}` syntax differs from `cb ls`'s `{...}` deliberately — it avoids interpolating literal braces that appear in card body text.
callback-box/docs/landmarks.md:99:- `alphabetical` — by file path. Default; matches `cb ls`.
callback-box/docs/implemented-plans/box-search.md:218:    `runCommand` pattern (`src/cli/commands/ls.ts:23`).
callback-box/docs/cards-as-markdown.md:78:`cb ls` lists files under the box with whatever glob you give it. `cb validate` checks every card. The "is this a card" check is purely filename + registry lookup, no file read needed.
callback-box/src/schemas/landmark.ts:140:    - query: "*.recipe.card"  # glob, like cb ls
callback-box/docs/stack-decisions.md:560:- **Typed output parsing.** `log()` returns parsed commit objects, `status()` returns a structured status object, `diff()` returns parsed hunks. Eliminates hand-written `--format=...` strings and stdout parsing.
callback-box/docs/stack-decisions.md:577:Adopted. `src/cli/lib/git.ts` rewritten from execa shell-outs to simple-git. All exported types and function signatures preserved — no caller changes needed (~30 importing files). Eliminated manual `--format` string parsing for log/status. Trailer parsing retained since simple-git doesn't parse git trailers. One edge case: simple-git's `modified` excludes working-tree deletions (unlike porcelain `D` status), so `deleted` files are merged into `modified` to match original behavior.
callback-box/docs/ideas.md:571:**Vocabulary consistency** is the highest-leverage item and the hardest to maintain through review alone. Agents don't relearn each CLI from scratch — they generalize from every CLI they've seen, so a command that uses `info` instead of `get`, or `--format=json` instead of `--json`, costs extra retries across every agent invocation, not just the first one. The fix isn't better reviewers; it's a prescriptive vocabulary document that defines the permitted verbs and flags, and a static check that fails on deviations. The `cb` command family is small enough that the vocabulary could be enumerated explicitly: `get`, `list`, `create`, `update`, `delete`; `--json`, `--force`, `--dry-run`, `--limit`, `--cursor`. Any new command picks from this menu. Additions to the menu require updating the doc, not ad hoc review.
callback-box/docs/ideas.md:624:The analogy is how `git log --format=json` doesn't exist but git GUIs parse git's output anyway — except here the command itself controls the schema and the renderer can be co-designed. Commands would declare their output schema; the UI maps command names to renderer components. The admin page or a debug panel could be the first surface.
callback-box/docs/cli-restructure.md:35:| `cb ls <pattern>` | List cards (XPath-templated) |
callback-box/docs/plans/box-commentary-surface.md:296:    (`git log -1 --format=%h -- <path>`); worktree HEAD is an acceptable
callback-box/docs/plans/box-commentary-surface.md:406:  (`git log -1 --format=%h -- <path>`, falling back to HEAD) for the diff
callback-box/docs/plans/remove-cardworks-package.md:110:  `commands/ls.ts` XPath format feature (`ls.ts:74` `evaluateXPathString`,
callback-box/docs/plans/remove-cardworks-package.md:111:  `ls.ts:117` `parseCard`) — keep bare `ls`, drop `--format` or reduce it to
callback-box/docs/plans/remove-cardworks-package.md:145:collapse; `search/extract.ts` `xmlDoc`; `ls.ts` `--format`/XPath. No open
callback-box/docs/plans/remove-cardworks-package.md:230:| `ls --format` removed but a box config / agent still calls it | No | No | **Silent** (format arg ignored) |
callback-box/docs/plans/remove-cardworks-package.md:236:**Critical gap: `ls --format` silent removal.** `commands/ls.ts:74`'s
callback-box/docs/plans/remove-cardworks-package.md:237:XPath `--format` is the one user-facing feature being dropped. If an agent or
callback-box/docs/plans/remove-cardworks-package.md:238:box command still passes `--format`, today it would XPath-extract (broken on
callback-box/docs/plans/remove-cardworks-package.md:240:in the plan:** either reduce `--format` to a dotted-path frontmatter accessor
callback-box/docs/plans/remove-cardworks-package.md:243:frontmatter-field lookup — small, and keeps `cb ls --format '{title}'` working.
callback-box/docs/plans/remove-cardworks-package.md:314:   XML branch, `search/extract.ts` `xmlDoc`, `ls.ts` `--format`). Green.
callback-box/docs/plans/remove-cardworks-package.md:341:  exception: if `ls --format` is reduced to frontmatter-field lookup (Critical
callback-box/docs/plans/remove-cardworks-and-xml.md:121:  `src/core/commands/ls.ts:74` (fragment selectors). Both via cardworks'
callback-box/docs/plans/remove-cardworks-and-xml.md:446:second site, `cb ls --format` (`ls.ts:74`), is an ad-hoc CLI affordance
callback-box/src/cli/lib/git.ts:418:      return await git.raw(["show", "-M10", "--format=", hash]);
callback-box/src/cli/lib/git-log.ts:123:    const baseArgs = ["log", `--max-count=${count}`, ...skipArgs, "--format=%H"];
callback-box/src/cli/lib/git-log.ts:202:      "--format=%(trailers:only,unfold)%x00",
callback-box/src/cli/lib/git-log.ts:250:      await git.raw(["log", ...logArgs, "--format=%H", "--name-status"])
callback-box/src/cli/lib/git-log.ts:253:      await git.raw(["log", ...logArgs, "--format=%H", "--numstat"])
callback-box/src/cli/lib/git-log.ts:295:      `--format=${FS}%H${FS}%aI${FS}%s${FS}%b${RS}`,
callback-box/src/cli/commands/ls.ts:2: * cb ls - List cards with optional XPath template extraction.
callback-box/src/cli/commands/ls.ts:15:    "-f, --format <template>",
callback-box/src/core/agent-guide/search.ts:16:    "card types (jobs, runs) are not indexed — find those with `cb ls` under",
callback-box/src/core/commands/ls.ts:81:async function executeLs(
callback-box/src/core/commands/ls.ts:154:  execute: executeLs,
callback-box/src/core/commands/ls.ts:157:export { executeLs };
callback-box/src/core/external-ref.ts:117:      ["-C", path.dirname(absPath), "log", "-1", "--format=%h", "--", path.basename(absPath)],

codex
There’s also a split between `src/core/commands/ls.ts` and `src/cli/commands/ls.ts`; the CLI flag is registered in the latter. The plan cites the core implementation, but removal must update the CLI wrapper too or `--format` can remain accepted and then do something surprising.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/cli/commands/ls.ts | sed -n '1,120p' && nl -ba callback-box/src/core/commands/index.ts | sed -n '1,80p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * cb ls - List cards with optional XPath template extraction.
     3	 *
     4	 * Thin wrapper around the core ls command.
     5	 */
     6	
     7	import { Command } from "commander";
     8	import { requireBoxRoot } from "../lib/paths.js";
     9	import { runCommand, createCliContext } from "../../core/commands/index.js";
    10	
    11	export const lsCommand = new Command("ls")
    12	  .description("List cards with optional XPath template extraction")
    13	  .argument("<paths...>", "Glob patterns or directories to list")
    14	  .option(
    15	    "-f, --format <template>",
    16	    "Template with {xpath} placeholders, e.g. '{title} by {author}'"
    17	  )
    18	  .action(async (paths: string[], options: { format?: string }) => {
    19	    try {
    20	      const boxRoot = await requireBoxRoot();
    21	      const ctx = createCliContext(boxRoot);
    22	
    23	      const result = await runCommand({
    24	        name: "ls",
    25	        args: {
    26	          paths,
    27	          format: options.format,
    28	        },
    29	        ctx,
    30	      });
    31	
    32	      if (!result.success) {
    33	        console.error(`Error: ${result.error}`);
    34	        process.exit(1);
    35	      }
    36	    } catch (error) {
    37	      console.error(`Error: ${(error as Error).message}`);
    38	      process.exit(1);
    39	    }
    40	  });
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

codex
**Findings**

1. **High: “XML branch is unreachable” is false for box-local schemas.**  
   Plan: `What already exists`, lines 35-40; `Track A`, lines 106-117.  
   Actual code still supports and tests box-local legacy XML schemas: `loadBoxSchemas()` loads `elementSchemas` from `config/schemas/*.ts` ([callback-box/src/schemas/registry.ts:160](callback-box/src/schemas/registry.ts:160), [callback-box/src/schemas/registry.ts:220](callback-box/src/schemas/registry.ts:220), [callback-box/src/schemas/registry.ts:240](callback-box/src/schemas/registry.ts:240)); `buildLoadContext()` passes them into `loadCardFile()` ([callback-box/src/core/load-context.ts:11](callback-box/src/core/load-context.ts:11)); `loadCardFromText()` falls through to `loadXmlCard()` ([callback-box/src/core/card-io.ts:336](callback-box/src/core/card-io.ts:336), [callback-box/src/core/card-io.ts:350](callback-box/src/core/card-io.ts:350)). The doctest explicitly proves `GADGET_CARD` loads as `xml|gadget` ([callback-box/test/box-schemas.doctest.md:104](callback-box/test/box-schemas.doctest.md:104)).  
   Impact: deleting XML loader/schema support is a breaking change to box-local schemas, not just dead-code removal.

2. **High: `tsc` is not a complete safety net.**  
   Plan: lines 134-140, 204-206, 323.  
   `callback-box` typecheck only includes `src/**/*` ([callback-box/tsconfig.json:30](callback-box/tsconfig.json:30)), so it will not catch `callback-box/scripts/clean-broken-refs.ts` importing `splitCardContent` ([callback-box/scripts/clean-broken-refs.ts:38](callback-box/scripts/clean-broken-refs.ts:38)), migration/test/doc imports, or runtime box-local schema imports. Worse, runtime schema loading has a custom resolver allowing box schemas to import `"cardworks"` ([callback-box/src/schemas/registry.ts:97](callback-box/src/schemas/registry.ts:97), [callback-box/src/schemas/registry.ts:122](callback-box/src/schemas/registry.ts:122)); scaffolding still teaches both `cardSchema` and `element` from cardworks ([callback-box/src/core/box-templates.ts:31](callback-box/src/core/box-templates.ts:31), [callback-box/src/core/box-templates.ts:126](callback-box/src/core/box-templates.ts:126)).  
   Impact: removing the package can fail at runtime in user boxes even with a clean source typecheck.

3. **High: Track C over-deletes migrations and violates the migration contract.**  
   Plan: lines 191-202 says delete `scripts/migrate/*.ts` and their `MIGRATIONS` entries.  
   Actual `MIGRATIONS` says “never reorder or remove existing entries” because the names are manifest keys ([callback-box/src/core/migrations.ts:4](callback-box/src/core/migrations.ts:4), [callback-box/src/core/migrations.ts:6](callback-box/src/core/migrations.ts:6)). It has 28 entries, not just the 23 direct cardworks-importing scripts ([callback-box/src/core/migrations.ts:24](callback-box/src/core/migrations.ts:24)). Some are non-XML/cardworks migrations (`attachments`, `doc-to-gdoc`, `strip-type-field`, etc.).  
   Impact: deleting entries can break older boxes and manifest semantics. Minimal safer version: leave historical migration entries or replace spent scripts with explicit no-op/obsolete stubs.

4. **Medium: “zero transitive XML dependencies” is overstated.**  
   Plan: lines 43-52, 159-174.  
   `card-schema.ts` and `frontmatter.ts` are clean enough ([cardworks/src/schema/card-schema.ts:1](cardworks/src/schema/card-schema.ts:1), [cardworks/src/parser/frontmatter.ts:40](cardworks/src/parser/frontmatter.ts:40)), but `SchemaRegistry` is not a generic frontmatter registry; it imports `ElementSchema` and registers `.tagName` ([cardworks/src/schema/registry.ts:1](cardworks/src/schema/registry.ts:1), [cardworks/src/schema/registry.ts:27](cardworks/src/schema/registry.ts:27)). Also the plan’s minimal `Location` shape is wrong: formatter reads `startLine/startColumn`, not `line/column` ([cardworks/src/lint/format.ts:36](cardworks/src/lint/format.ts:36)); `ParseError` uses the same `startLine` shape ([cardworks/src/parser/parse.ts:31](cardworks/src/parser/parse.ts:31)).  
   Impact: copy-verbatim will not work for registry, and the proposed lint/error type extraction can silently lose location formatting.

5. **Medium: Several “dead” web paths are live API behavior, not just code branches.**  
   Plan: lines 106-117.  
   `cardRouter.get` still serves XML fallback cards and validation-failed XML trees ([callback-box/src/webapp/trpc/routers/card.ts:183](callback-box/src/webapp/trpc/routers/card.ts:183), [callback-box/src/webapp/trpc/routers/card.ts:203](callback-box/src/webapp/trpc/routers/card.ts:203), [callback-box/src/webapp/trpc/routers/card.ts:244](callback-box/src/webapp/trpc/routers/card.ts:244)); `cardRouter.patch` is XML-only ([callback-box/src/webapp/trpc/routers/card.ts:271](callback-box/src/webapp/trpc/routers/card.ts:271)); `todos.updateItem` is entirely CardLoader/XML-based ([callback-box/src/webapp/trpc/routers/todos.ts:21](callback-box/src/webapp/trpc/routers/todos.ts:21), [callback-box/src/webapp/trpc/routers/todos.ts:58](callback-box/src/webapp/trpc/routers/todos.ts:58)).  
   Impact: deletion may be correct, but it needs explicit product decisions/tests for todo editing and card patching.

6. **Medium: `ls --format` removal/rewrite has one extra caller surface.**  
   Plan correctly flags the silent-removal risk (lines 236-243), but cites only core. The CLI wrapper still registers `-f, --format` ([callback-box/src/cli/commands/ls.ts:14](callback-box/src/cli/commands/ls.ts:14)), while core evaluates XPath ([callback-box/src/core/commands/ls.ts:72](callback-box/src/core/commands/ls.ts:72), [callback-box/src/core/commands/ls.ts:117](callback-box/src/core/commands/ls.ts:117)). The suggested landmark helper exists but is private ([callback-box/src/core/landmark/resolve.ts:135](callback-box/src/core/landmark/resolve.ts:135)).  
   Impact: update both wrapper and core, and extract/duplicate the dotted lookup intentionally.

7. **Low/Medium: “Only callback-box consumes cardworks” misses build artifacts and root cleanup scope.**  
   Source imports are mostly callback-box, but `callback-box/dist/cli.mjs` contains baked `cardworks` imports, and `callback-box/node_modules/cardworks` is a symlink. If `dist/` is committed or deployed as-is, deletion without rebuilding leaves stale runtime imports. The plan mentions symlink and `pnpm install`, but not rebuilding/validating `dist`.

**Single Most Important Change**

Rewrite the plan around an explicit decision to drop box-local XML schema support; until that is stated, tested, and documented, the “dead XML path” premise is wrong.
tokens used
218,695
**Findings**

1. **High: “XML branch is unreachable” is false for box-local schemas.**  
   Plan: `What already exists`, lines 35-40; `Track A`, lines 106-117.  
   Actual code still supports and tests box-local legacy XML schemas: `loadBoxSchemas()` loads `elementSchemas` from `config/schemas/*.ts` ([callback-box/src/schemas/registry.ts:160](callback-box/src/schemas/registry.ts:160), [callback-box/src/schemas/registry.ts:220](callback-box/src/schemas/registry.ts:220), [callback-box/src/schemas/registry.ts:240](callback-box/src/schemas/registry.ts:240)); `buildLoadContext()` passes them into `loadCardFile()` ([callback-box/src/core/load-context.ts:11](callback-box/src/core/load-context.ts:11)); `loadCardFromText()` falls through to `loadXmlCard()` ([callback-box/src/core/card-io.ts:336](callback-box/src/core/card-io.ts:336), [callback-box/src/core/card-io.ts:350](callback-box/src/core/card-io.ts:350)). The doctest explicitly proves `GADGET_CARD` loads as `xml|gadget` ([callback-box/test/box-schemas.doctest.md:104](callback-box/test/box-schemas.doctest.md:104)).  
   Impact: deleting XML loader/schema support is a breaking change to box-local schemas, not just dead-code removal.

2. **High: `tsc` is not a complete safety net.**  
   Plan: lines 134-140, 204-206, 323.  
   `callback-box` typecheck only includes `src/**/*` ([callback-box/tsconfig.json:30](callback-box/tsconfig.json:30)), so it will not catch `callback-box/scripts/clean-broken-refs.ts` importing `splitCardContent` ([callback-box/scripts/clean-broken-refs.ts:38](callback-box/scripts/clean-broken-refs.ts:38)), migration/test/doc imports, or runtime box-local schema imports. Worse, runtime schema loading has a custom resolver allowing box schemas to import `"cardworks"` ([callback-box/src/schemas/registry.ts:97](callback-box/src/schemas/registry.ts:97), [callback-box/src/schemas/registry.ts:122](callback-box/src/schemas/registry.ts:122)); scaffolding still teaches both `cardSchema` and `element` from cardworks ([callback-box/src/core/box-templates.ts:31](callback-box/src/core/box-templates.ts:31), [callback-box/src/core/box-templates.ts:126](callback-box/src/core/box-templates.ts:126)).  
   Impact: removing the package can fail at runtime in user boxes even with a clean source typecheck.

3. **High: Track C over-deletes migrations and violates the migration contract.**  
   Plan: lines 191-202 says delete `scripts/migrate/*.ts` and their `MIGRATIONS` entries.  
   Actual `MIGRATIONS` says “never reorder or remove existing entries” because the names are manifest keys ([callback-box/src/core/migrations.ts:4](callback-box/src/core/migrations.ts:4), [callback-box/src/core/migrations.ts:6](callback-box/src/core/migrations.ts:6)). It has 28 entries, not just the 23 direct cardworks-importing scripts ([callback-box/src/core/migrations.ts:24](callback-box/src/core/migrations.ts:24)). Some are non-XML/cardworks migrations (`attachments`, `doc-to-gdoc`, `strip-type-field`, etc.).  
   Impact: deleting entries can break older boxes and manifest semantics. Minimal safer version: leave historical migration entries or replace spent scripts with explicit no-op/obsolete stubs.

4. **Medium: “zero transitive XML dependencies” is overstated.**  
   Plan: lines 43-52, 159-174.  
   `card-schema.ts` and `frontmatter.ts` are clean enough ([cardworks/src/schema/card-schema.ts:1](cardworks/src/schema/card-schema.ts:1), [cardworks/src/parser/frontmatter.ts:40](cardworks/src/parser/frontmatter.ts:40)), but `SchemaRegistry` is not a generic frontmatter registry; it imports `ElementSchema` and registers `.tagName` ([cardworks/src/schema/registry.ts:1](cardworks/src/schema/registry.ts:1), [cardworks/src/schema/registry.ts:27](cardworks/src/schema/registry.ts:27)). Also the plan’s minimal `Location` shape is wrong: formatter reads `startLine/startColumn`, not `line/column` ([cardworks/src/lint/format.ts:36](cardworks/src/lint/format.ts:36)); `ParseError` uses the same `startLine` shape ([cardworks/src/parser/parse.ts:31](cardworks/src/parser/parse.ts:31)).  
   Impact: copy-verbatim will not work for registry, and the proposed lint/error type extraction can silently lose location formatting.

5. **Medium: Several “dead” web paths are live API behavior, not just code branches.**  
   Plan: lines 106-117.  
   `cardRouter.get` still serves XML fallback cards and validation-failed XML trees ([callback-box/src/webapp/trpc/routers/card.ts:183](callback-box/src/webapp/trpc/routers/card.ts:183), [callback-box/src/webapp/trpc/routers/card.ts:203](callback-box/src/webapp/trpc/routers/card.ts:203), [callback-box/src/webapp/trpc/routers/card.ts:244](callback-box/src/webapp/trpc/routers/card.ts:244)); `cardRouter.patch` is XML-only ([callback-box/src/webapp/trpc/routers/card.ts:271](callback-box/src/webapp/trpc/routers/card.ts:271)); `todos.updateItem` is entirely CardLoader/XML-based ([callback-box/src/webapp/trpc/routers/todos.ts:21](callback-box/src/webapp/trpc/routers/todos.ts:21), [callback-box/src/webapp/trpc/routers/todos.ts:58](callback-box/src/webapp/trpc/routers/todos.ts:58)).  
   Impact: deletion may be correct, but it needs explicit product decisions/tests for todo editing and card patching.

6. **Medium: `ls --format` removal/rewrite has one extra caller surface.**  
   Plan correctly flags the silent-removal risk (lines 236-243), but cites only core. The CLI wrapper still registers `-f, --format` ([callback-box/src/cli/commands/ls.ts:14](callback-box/src/cli/commands/ls.ts:14)), while core evaluates XPath ([callback-box/src/core/commands/ls.ts:72](callback-box/src/core/commands/ls.ts:72), [callback-box/src/core/commands/ls.ts:117](callback-box/src/core/commands/ls.ts:117)). The suggested landmark helper exists but is private ([callback-box/src/core/landmark/resolve.ts:135](callback-box/src/core/landmark/resolve.ts:135)).  
   Impact: update both wrapper and core, and extract/duplicate the dotted lookup intentionally.

7. **Low/Medium: “Only callback-box consumes cardworks” misses build artifacts and root cleanup scope.**  
   Source imports are mostly callback-box, but `callback-box/dist/cli.mjs` contains baked `cardworks` imports, and `callback-box/node_modules/cardworks` is a symlink. If `dist/` is committed or deployed as-is, deletion without rebuilding leaves stale runtime imports. The plan mentions symlink and `pnpm install`, but not rebuilding/validating `dist`.

**Single Most Important Change**

Rewrite the plan around an explicit decision to drop box-local XML schema support; until that is stated, tested, and documented, the “dead XML path” premise is wrong.
