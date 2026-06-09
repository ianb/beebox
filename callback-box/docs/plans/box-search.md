# Box search (`cb search`) and the global `contains` field

Add full-text search over a box's cards — an Orama index in `.callback-box/`,
queried via `cb search` — plus a new global frontmatter field, `contains`: a
one-sentence, agent-maintained statement of what can be found inside a card.
`contains` is the heavily-weighted search field today and the designated
embedding unit when semantic search lands later; it also serves listings and
triage views independent of the index.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md` § Behavioral Notes: *"Read before writing. Don't
  guess file formats, XML structures, or API shapes."* — every design choice
  below cites the code it builds on.
- `callback-box/CLAUDE.md` § Behavioral Notes: *"All cross-process locks go
  through `src/lib/file-lock.ts`."* — index persistence is a cross-process
  write.
- `callback-box/CLAUDE.md` § Behavioral Notes: *"Keep source and docs generic
  — never hardcode personal names."* — guidance text and examples use "the
  boxholder."
- `callback-box/CODE-STYLE.md`: max 2 positional params, no default
  parameters, custom error classes, files ≤300 lines, only export what's
  needed.
- `docs/ideas.md:493` § CLI Design for Agents: enumerate valid values in
  errors, fail before side effects, correct invocation in the error text,
  bounded output with navigable truncation, vocabulary menu (`--json`,
  `--limit`, `get`/`list`/`create`/`update`/`delete`).
- `docs/adding-schemas.md`: the checklist any schema-surface change follows
  (registry, index.ts, templates, generated docs, verification).
- Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — search and
  validate output must stay quiet and structured.

## What already exists

- **ske's Orama index** (`~/src/ske/ske/src/index/search-index.ts`, a
  predecessor project outside this repo). Schema
  `{path, kind, name, content, contentHash, embedding}` (:13–20), markdown
  section splitting (`extractMarkdownSections`, :87), XML text extraction
  (:48, :185), excerpt generation (:204), restore-or-rebuild on corrupt index
  (:157–171). **Adapted, not imported** — it's another repo, predates
  frontmatter cards, and its per-XML-tag granularity doesn't fit Phase-2
  cards. The contentHash-skip, section-split, and excerpt patterns carry
  over.
- **Card parsing** — `src/core/card-io.ts:114` `parseCardText` returns
  `{schema, fields, rawBody}`; `loadCardFile` (:318) dispatches
  frontmatter/XML. Reused as the only card-reading path in the indexer.
  Note `:135`: frontmatter validates via `schema.frontmatterSchema.safeParse`,
  and Zod objects **strip unknown keys** — so `contains` cannot ride along
  undeclared; it must be a declared field (Track 1).
- **Global-field precedent** — `cardworks/src/schema/card-schema.ts:117–119`:
  `cardSchema()` already injects `type: z.literal(type)` into every
  frontmatter schema. Track 1 extends this exact mechanism with `title` and
  `contains`.
- **Titles for listings** — `src/core/file-summary.ts:43` `FileLoader`
  produces a `title` per card (e.g. `src/schemas/memo.ts:112` derives it from
  body/transcription). Reused as the index's `title` source; not rebuilt.
- **Per-edit validation hooks** — `src/core/install-validation-hooks.ts:2–16`
  installs a PostToolUse hook (`cb validate --hook`, payload reader at
  `src/cli/commands/validate.ts:49`) and a pre-commit hook (:36). Reused as
  the delivery channel for `contains` staleness nudges and length warnings.
- **Ref-updating moves** — `cb mv` (`src/cli/commands/move.ts`,
  `src/core/commands/move-phase2.ts`) rewrites refs on move. The index does
  **not** hook `cb mv`; moves are detected at refresh time by content-hash
  (see Track 2) so `git mv` and shell moves are covered identically.
- **Cross-process lock** — `src/lib/file-lock.ts:215` `acquireLock`. Reused
  around index persistence.
- **Box dirs** — `src/cli/lib/paths.ts:24` `BOX_DIRS`, `:45`
  `trash: "store/trash"`. The walker excludes `store/trash` and
  `.callback-box/`.
- **Agent guidance plumbing** — `src/core/generate-docs.ts:5` writes
  `.callback-box/agent-guide.md` (always loaded) and per-type
  `docs/generated/card-<type>.md`. Reused to deliver the `contains` writing
  rule once, canonically.
- **Derived-field lifecycle precedent** — `cb describe-images`
  (`src/cli/commands/describe-images.ts`) maintains `image.description`
  (`src/schemas/image.tsx:78`). `contains` follows the same write-at-
  processing-time + batch-backfill shape.
- **Job creation precedent** — `src/cli/commands/wakeup-steps.ts:179`
  `createIntakeJobsForUnjobbed`. The backfill job creator follows this
  pattern.
- **Schema-wins precedent** — `src/schemas/doc.tsx:19` declares
  `title: z.string()` (required). Global `title` is optional; a schema's own
  stricter declaration takes precedence.

## Prior art (external)

Searched (June 2026):

- *"Orama search remove update document @orama/orama v3"* — `remove` and
  `upsert` are first-class (<https://docs.orama.com/docs/orama-js/search>,
  <https://github.com/oramasearch/orama>). Incremental update =
  remove + insert per changed file. Confirms the lazy-refresh design needs no
  full rebuild per change.
- *"@orama/plugin-data-persistence restore performance large index issues"* —
  three findings worth recording:
  - **512MB max persisted file** (string-length ceiling) —
    <https://github.com/oramasearch/orama/issues/851>. Our largest real
    corpus (~2k searchable docs after excluding operational kinds) is a few
    MB of text; not a constraint, but the plan records it as the scale
    ceiling.
  - **Search results can differ after persist/restore** —
    <https://github.com/oramasearch/orama/issues/695>. Mitigation: the index
    is a disposable cache; a doctest pins persist→restore→search behavior at
    our pinned version, and `cb search --rebuild` is the remedy.
  - **`restoreFromFile` cannot pass creation options/plugins** —
    <https://github.com/oramasearch/orama/issues/640>. Consequence: use no
    Orama plugins beyond data-persistence. When embeddings come, we compute
    vectors ourselves and store them as a plain `vector[N]` schema field
    (which restores fine), rather than using an Orama embeddings plugin.
- No external search was done for the "summary-as-retrieval-cue" pattern
  itself: the requirement (carry the fact when concise) came from the
  boxholder's design input, and the nearest internal prior art (ske,
  `docs/ideas.md:680`) already validates the index shape. Recorded as a
  deliberate skip.

## Tracks / scope

Ordered by implementation dependency: Track 1 unblocks both others; Track 2
is independent of Track 3 once Track 1 lands.

### Track 1 — cardworks: global card fields and the `searchable` flag

- **What**: `cardSchema()` injects two global optional frontmatter fields
  into every frontmatter schema — `title?: string` and `contains?: string` —
  alongside the existing `type` injection. Both schema kinds (`CardSchema`
  config and XML `ElementSchema`) gain `searchable?: boolean` (default
  `true`).
- **Why this needs to change**: Zod strips undeclared keys
  (`card-io.ts:135`), so an undeclared `contains:` written by an agent would
  silently vanish on the next parse-mutate-reserialize. And with ~30 schemas,
  per-schema opt-in means every future content type can silently forget the
  field; the boxholder explicitly wants these global.
- **Direction**: in `cardworks/src/schema/card-schema.ts`, extend the
  injected `frontmatterShape` with `title: z.string().optional()` and
  `contains: z.string().optional()` **unless the schema declares its own**
  (schema-wins, preserving `doc`'s required `title`). `searchable` is carried
  on the resolved `CardSchema`/`ElementSchema` object. Operational schemas
  set `searchable: false`: intake-job, chat-job, calendar-review-job,
  question-followup-job, procedure-run, scheduled-script,
  scheduled-script-duration, chat-thread (chat-history search is its own
  future surface; thread cards hold refs, not prose). Everything else —
  including telegram-message, email-outbound, commentary, sheet, gdoc —
  stays searchable.
- **Vocabulary lock-ins**: field names `title`, `contains`; flag name
  `searchable`. `contains` semantics: *one sentence stating what can be found
  inside this card; when the information is concise the sentence carries the
  information itself ("Dentist moved to June 17; confirmation in this
  email"), not a pointer at it ("contains scheduling information"); when it
  isn't concise, the sentence says what's learnable here. Never a list of
  parts.* Soft length budget: warn above 200 characters.
- **First implementation chunk**: the cardworks change + unit tests
  (global injection, schema-wins override, `searchable` defaulting), plus
  marking the operational schemas in `src/schemas/`.

### Track 2 — the index and `cb search`

- **What**: an Orama index over all searchable cards, persisted to
  `.callback-box/search-index.msp` with a sidecar manifest, refreshed lazily
  at query time, queried via `cb search`.
- **Why this needs to change**: discovery is path-based and rule-injected;
  there is no content-retrieval surface for humans or agents
  (`docs/ideas.md:680`). Real corpora are dominated by operational cards (a
  large local box copy: 10,446 cards of which 8,303 are procedure-runs), so
  ranking over raw files is useless without kind-aware exclusion.
- **Direction**:
  - **Module**: `src/core/search/` — `extract.ts` (card → index docs),
    `index.ts` (build/restore/persist/refresh), `excerpt.ts`. CLI command
    `src/cli/commands/search.ts` delegating to a core command, matching the
    `runCommand` pattern (`src/cli/commands/ls.ts:23`).
  - **Index schema**: `{id, path, fragment, kind, title, contains, content,
    created, contentHash}`. One doc per card; additionally one doc per
    top-level markdown section when a body exceeds 2,000 characters
    (`fragment` = `/Heading/Subheading`, ske-style). Legacy XML cards (guide,
    recipe, capture-session, landmark, procedure) index their walked text
    content. Per-kind extraction folds obvious frontmatter into
    `title`/`content` (email subject + participants, person name,
    `image.description` — which also serves as the `contains` fallback for
    images). Search-time boosts: `contains` ~3×, `title` ~2×, `content` 1×
    (numbers tuned during dogfooding).
  - **Persistence**: `search-index.msp` (Orama binary) +
    `search-index-manifest.json` `{schemaVersion, files: {path → {mtimeMs,
    size, contentHash}}}`. Writes go through `acquireLock`
    (`file-lock.ts:215`) and are atomic (write temp, rename). Schema-version
    mismatch or restore failure → silent full rebuild (ske's pattern,
    `search-index.ts:157–171`), logged to stderr.
  - **Refresh (the update trigger)**: on every `cb search`, stat-walk
    `*.card` files (excluding `store/trash`, `.callback-box`), diff
    mtime+size against the manifest, re-hash and re-extract only changed
    files, `remove`+`insert` their docs, persist if dirty. ~10k stats is
    milliseconds; correctness is at-query-time, which beats any hook-based
    trigger (hooks miss `git mv`, shell moves, connector writes, and
    uncommitted state).
  - **Moves**: a vanished path plus a new path with the same `contentHash`
    is a move — rewrite `path` on the existing docs without re-extraction.
    If multiple candidates share a hash (duplicated content), fall back to
    remove + re-extract; correctness over optimization.
  - **CLI**: `cb search <query> [--kind <type>...] [--path <prefix>]
    [--limit N] [--json] [--rebuild]`. JSON envelope: `{results: [{path,
    fragment, kind, title, contains, excerpt, score}], total, truncated,
    hint}` where `hint` teaches narrowing. Human output: `path — title` +
    excerpt. An invalid `--kind` error enumerates the registered searchable
    types (including box-local `config/schemas/`). `cb init` builds the
    initial index; a missing index builds on demand with progress on stderr.
- **Vocabulary lock-ins**: command `cb search`; flags `--kind`, `--path`,
  `--limit`, `--json`, `--rebuild`; files `search-index.msp`,
  `search-index-manifest.json`; fragment notation `/Heading/Subheading`.
- **First implementation chunk**: `extract.ts` + pure doctests (frontmatter
  card → docs, long-body section split, XML walk, per-kind folding). No open
  questions inside it.

### Track 3 — `contains` lifecycle: guidance, staleness, backfill, listings

- **What**: the writing rule delivered to agents; staleness tracked without
  touching card files; `cb contains list/update`; backfill jobs; `contains`
  surfaced in listings.
- **Why this needs to change**: a field nobody is told to write stays empty;
  a field with no staleness signal silently rots when bodies change. The
  boxholder rejected an in-card hash (`contains-hash`) as diff churn — the
  card file must stay byte-clean when only bookkeeping changes.
- **Direction**:
  - **Guidance**: one canonical block (the vocabulary-locked rule from
    Track 1, verbatim) written by `generate-docs.ts` into the agent guide and
    appended to each searchable type's `docs/generated/card-<type>.md`.
    Processing guides (intake/triage) get one line: write `contains` when
    creating or substantially editing a searchable card.
  - **Staleness sidecar**: `.callback-box/contains-state.json` —
    `{path → {basisHash, containsText}}`, where `basisHash` hashes the
    markdown body (bodied cards) or canonical YAML minus
    `contains`/`title` (frontmatter-only cards), via one helper
    `computeContainsBasis(parsedCard)`. Maintained by the index refresh:
    contains-text changed → record new basis; basis changed while
    contains-text didn't → stale. Kept as a **separate file** from the index
    manifest so schema-version index rebuilds don't wipe staleness memory.
    Single-writer under the same file lock.
  - **Nudges**: `cb validate --hook` (PostToolUse) consults the sidecar and
    warns — *"body changed but `contains:` didn't — review it"* — and warns
    when `contains` exceeds 200 characters. Warning-level only; never blocks.
  - **CLI**: `cb contains list [--missing|--stale] [--json]` (searchable
    kinds only, bounded output with hint) and
    `cb contains update <card> --text "..."` (parse-mutate-reserialize per
    `docs/adding-schemas.md:157`, then refreshes the sidecar basis).
  - **Backfill**: a job-card creator in the `createIntakeJobsForUnjobbed`
    mold (`wakeup-steps.ts:179`) batching ~25 missing-`contains` cards per
    job. Completion criterion per box: `cb contains list --missing` returns
    empty for searchable kinds.
  - **Listings**: `FileSummary` loaders (`file-summary.ts:43`) get access to
    `contains` via the fields they already receive; surfaced as a secondary
    line in list contexts. Small, per-loader, not load-bearing.
- **Vocabulary lock-ins**: `cb contains list|update` (verbs from the
  `ideas.md:515` menu); sidecar filename `contains-state.json`.
- **First implementation chunk**: `computeContainsBasis` + sidecar
  read/write + the refresh integration, with a makeTmpBox doctest covering
  fresh → edit-body → stale → update-contains → fresh.

## Subplans

None. The embeddings phase (vector field over `contains`, provider service,
hybrid ranking) is explicitly out of scope below; when it starts, it gets its
own plan — provider choice, cost model, and lazy-generation policy are a
full decision-table of their own.

## Failure modes

> **Accepted documented risk:** *fabricated `contains`* — an agent writes a
> fact the card doesn't support ("moved to June 17" when the email says
> June 16). No mechanical handling can catch semantic divergence; the
> guidance says to quote facts from the content, and any body edit re-flags
> the card for review via the staleness sidecar. Accepted because the field
> is a retrieval aid, never a source of truth — the card body remains
> authoritative, and search results always lead to the card itself.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Index file corrupt/truncated (process killed mid-persist) | doctest: restore garbage → rebuild | atomic temp+rename write; restore failure → full rebuild | clear (stderr note) |
| Two processes refresh+persist concurrently | doctest: lock contention | `acquireLock` around refresh+persist; loser re-reads | clear (`LockHeldError` path) |
| A card fails to parse during indexing (invalid YAML, schema error) | doctest: corpus with one bad card | skip + collect; reported as `warnings` in `--json`, stderr otherwise; search still answers | clear |
| Orama ranking drift after persist/restore (issue #695) | doctest pins persist→restore→search at pinned version | `cb search --rebuild` remedy | clear once doctest exists |
| Same-second body edit with identical size evades mtime+size diff | no | `contentHash` re-check on any mtime change; `--rebuild` escape hatch | silent (narrow; documented) |
| Move detection matches multiple identical-content files | doctest: duplicate cards moved | ambiguity → remove + re-extract instead of path rewrite | clear in behavior, invisible to user (correct either way) |
| `contains` exceeds length budget | doctest: validate warning fires | `cb validate` warning at >200 chars | clear |
| Body edited, `contains` left stale | doctest: sidecar flags stale | PostToolUse nudge + `cb contains list --stale` | clear |
| Fresh clone has no sidecar → staleness memory resets to "fresh" | no | none (cache semantics) | silent — documented above as inherent to per-checkout state |
| First search on a 10k-card box (cold build) | manual: large local box | on-demand build with stderr progress | clear |
| Heading renamed in a long body → old fragment docs dangle | doctest: re-extract replaces per-file docs wholesale | per-file remove-all + reinsert | n/a (cannot dangle) |

No unresolved critical gaps: every silent row above has handling or is the
explicitly accepted risk/cache-semantics case.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent writes the summary into `title`
  instead of `contains`, or enumerates contents manifest-style.
  **ADDRESSED**: the canonical guidance block contrasts the two fields and
  bans list-style `contains`; a knowledge audit (below) verifies recall.
- **Stale ref** — a result's card is moved/deleted between index write and
  read. **ADDRESSED**: refresh runs at query time, so results reflect the
  filesystem as of the query; a delete in the seconds after is an ordinary
  ENOENT the agent already handles.
- **Two agents touching the same card** — both edit `contains`
  concurrently. **ADDRESSED**: card edits keep existing
  parse-mutate-reserialize semantics (no new shared mutable card state);
  the sidecar has a single writer (the indexer) under `file-lock.ts`.
- **Hand-edit drift** — boxholder hand-writes a 400-character `contains` or
  a YAML list. **ADDRESSED**: schema validates type (string), validate warns
  on length; both fire via the existing PostToolUse/pre-commit hooks.
- **Fabricated free-form value** — see the accepted documented risk in
  Failure modes.
- **Validation error UX** — **ADDRESSED**: warnings are one-liners naming
  the field and the fix ("review `contains:` — body changed"); `--kind`
  errors enumerate valid types per `ideas.md:499`.
- **Partial migration / transition state** — during backfill, most cards
  lack `contains`. **ADDRESSED by design**: the index searches `content`
  regardless; `contains` only adds weight when present; listings fall back
  to loader titles. There is no broken intermediate state.

## NOT in scope

- **Embeddings / vector / hybrid search** — phase 3, own plan. Designed-for
  only: `schemaVersion` bump triggers rebuild; `contains` is the embedding
  unit; no Orama plugins (issue #640) so vectors will be computed by a
  service-pattern provider. Boxes' per-box Mistral keys make Mistral the
  likely candidate; nothing here commits to it.
- **Web UI (Cmd-K palette, tRPC search procedure)** — separate increment
  once the CLI proves ranking quality; tRPC-first rule applies when it
  comes.
- **MCP tool surface for search** — same reasoning.
- **Backlink counts in results** — depends on the backlinks surface
  (`ideas.md:711`), not yet built.
- **`contains` for legacy XML card types** — guide/recipe/capture-session
  bodies are searchable as text, but the field arrives when those schemas
  migrate to frontmatter (per `CLAUDE.md` § Cards, that migration is already
  planned independently).
- **Chat-thread search** — chat history retrieval is its own design;
  `chat-thread` is marked `searchable: false`.
- **Eager index update inside `cb mv`** — the lazy refresh detects moves by
  hash and covers non-CLI moves too; an eager hook would be a redundant
  second mechanism.
- **Sharing index/sidecar state across clones** — both are per-checkout
  caches; reconstruction from git is possible later if ever needed.

## Open design questions

- **Should wakeup opportunistically refresh the index?** Lean: yes, as a
  cheap warm step late in the cycle, but only after dogfooding shows cold
  first-search latency actually annoys — adding it preemptively violates
  bounded scope.
- **Should `contains`, when present, become the listing *title* for
  title-less cards rather than a secondary line?** Lean: secondary line
  only; titles have their own derivation logic per loader and mixing roles
  invites sloppy `contains` writing (the boxholder's stated concern).

## Knowledge audits

Three agent-facing concepts land; each gets a `knows_directly` entry in
`src/dev/knowledge-audits.yaml`:

1. **Writing `contains`** — given a concise-fact card, the agent produces a
   fact-carrying sentence (not a pointer, not a list); given a long doc, a
   what's-learnable sentence.
2. **Reaching for `cb search`** — asked "which cards mention X?", the agent
   uses `cb search` rather than grep, and knows `--kind`/`--json`.
3. **Responding to the staleness nudge** — on the "body changed but
   `contains:` didn't" warning, the agent reviews and either updates the
   field or leaves it (and knows leaving it re-arms only on the next body
   change).

## Implementation order

1. **cardworks globals + flag** (Track 1 chunk): global `title`/`contains`
   injection with schema-wins, `searchable` on both schema kinds, cardworks
   unit tests. Everything depends on this.
2. **Mark operational schemas** `searchable: false` in `src/schemas/`;
   registry exposes the searchable type set.
3. **Extraction** (`src/core/search/extract.ts`) + pure doctests. Depends
   on 1–2 for the flag and fields.
4. **Index lifecycle** (`index.ts`): build, atomic persist, restore-or-
   rebuild, manifest diff refresh, move detection, lock integration;
   makeTmpBox doctests including the persist/restore pin for issue #695.
5. **`cb search`** CLI + core command, excerpts, JSON envelope, enumerated
   `--kind` errors; `cb init` builds the index.
6. **`contains` staleness sidecar** (`computeContainsBasis`,
   `contains-state.json`, refresh integration) + validate-hook nudge +
   length warning.
7. **`cb contains list/update`** commands.
8. **Guidance + audits + backfill**: generate-docs blocks, knowledge-audit
   entries, backfill job creator; surface `contains` in FileSummary
   listings.

Chunks 6–8 depend on 4; 3–5 and 6–8 form two short serial runs after 1–2.
Each chunk is a commit-sized unit on this worktree; nothing merges to main
until the plan completes.

## Rollout shape

- **Test posture**: overriding the default deferral partially — extraction
  (chunk 3), index lifecycle (chunk 4), and the staleness sidecar (chunk 6)
  get doctests *at chunk time*, because index corruption and silent
  staleness are regression-shaped risks; CLI output formatting follows the
  dogfood-first default with one doctest once the envelope settles.
  Relevance and cold-build latency are validated manually against the large
  local box copy (~10k cards) before merge.
- **Knowledge audits**: all three entries land with the plan (chunk 8).
- **Migration**: no data-shape change — `contains` and `title` are optional
  fields, and the index/sidecar live in already-gitignored `.callback-box/`
  (`ideas.md:698`). The `contains` backfill is gradual but part of
  completion: the mechanism, guidance, and job creator ship with the plan;
  jobs drain per box until `cb contains list --missing` is empty. Per-box
  kickoff happens at the first wakeup after the merged code deploys.
- **Ship signal**: the worktree branch merges to main only on the
  boxholder's explicit go, per the plan discipline.
