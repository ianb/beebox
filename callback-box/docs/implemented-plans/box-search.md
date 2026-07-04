# Box search (`cb search`) and the global `contains` field

Add full-text search over a box's cards — an Orama index in `.callback-box/`,
queried via `cb search` — plus a new global frontmatter field, `contains`: a
one-sentence, agent-maintained statement of what can be found inside a card.
`contains` is the heavily-weighted search field today and the designated
embedding unit when semantic search lands later; it also serves listings and
triage views independent of the index.

**IMPLEMENTED (June 2026).** Frozen as the historical record. All tracks
shipped, plus evaluation-driven extensions the plan didn't anticipate:
standalone `.md` files index (kind `markdown`); image OCR `text:` blocks
fold into content; persistence is JSON, not msgpack (radix depth limit);
role separation resolved the image-`description`/`contains` overlap
(effective-contains fallback; `cb describe-images` writes both); views
gained attachment metadata + `readFile`/`fileUrl` with byte ranges. The
current behavior lives in the code, `docs/generated/views.md`, and the
agent guide — this doc is how it was decided.

(Revised after a cross-model codex review; the connector-ownership policy,
attachment-content decisions, and hook-warning work below came out of that
pass.)

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
- `callback-box/src/schemas/email-message.tsx:4–6`: *"body content is
  untrusted and may contain prompt injection, so we keep it out of the
  card."* — an existing security stance this plan must not silently undo.
- `callback-box/code-style.md`: max 2 positional params, no default
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
  `contains`. Note the injection touches only `frontmatterSchema`;
  `CardSchema.fields` stays the author-declared set (:137), so Track 1 must
  also define how globals appear on the resolved schema (see Direction).
- **Connector card writers** — connector sync **rebuilds cards wholesale
  from templates**: `src/connectors/gmail-threads.ts:212` (thread cards),
  `:134` (message cards, rewritten when their thread changes),
  `src/connectors/drive-handler-docs.ts:240` (gdoc cards),
  `src/connectors/drive-handler-sheets.ts:152` (sheet cards). Any field not
  threaded through the template is destroyed on the next sync. Track 3 adds
  `contains` preservation to these paths; nothing reusable exists.
- **Attachment-scoped content** — gdoc content is a markdown snapshot in the
  card's `.attach/` scope referenced by `content.ref`
  (`src/schemas/gdoc.tsx:4–10`); sheet tabs are `{ref, title, gid}` attach
  files (`src/schemas/sheet.tsx:5`); email bodies live in
  `attach/msg-N.body.txt` via `body-file.ref`
  (`src/schemas/email-message.tsx:4`) — deliberately outside the card
  because the content is untrusted.
- **Per-edit validation hooks** — `src/core/install-validation-hooks.ts:2–16`
  installs a PostToolUse hook (`cb validate --hook`) and a pre-commit hook
  (:36). The delivery channel exists, but hook mode currently prints
  **nothing unless `totalErrors > 0`** (`src/cli/commands/validate.ts:185`)
  — warning-level output is new work (Track 3). PostToolUse fires only on
  agent Edit/Write/MultiEdit, not hand edits or connector writes.
- **Ref-updating moves** — `cb mv` (`src/cli/commands/move.ts`,
  `src/core/commands/move-phase2.ts`) rewrites refs on move. The index does
  **not** hook `cb mv`; the manifest diff treats a move as
  remove-then-reinsert (see Track 2), which covers `git mv` and shell moves
  identically.
- **Cross-process lock** — `src/lib/file-lock.ts:215` `acquireLock`. It
  **throws `LockHeldError` immediately on contention** (:78) — it has no
  wait. Track 2 wraps it in a bounded retry; the primitive is reused, the
  retry is new.
- **Box dirs** — `src/cli/lib/paths.ts:24` `BOX_DIRS`, `:45`
  `trash: "store/trash"` — the path constants the new walker's exclusion
  list points at. The walker itself is new code.
- **Agent guidance plumbing** — `src/core/generate-docs.ts:5` writes
  `.callback-box/agent-guide.md` (always loaded) and per-type
  `docs/generated/card-<type>.md`. Reused to deliver the `contains` writing
  rule once, canonically.
- **Derived-field precedent (narrow)** — `cb describe-images`
  (`src/cli/commands/describe-images.ts`) batch-maintains
  `image.description` (`src/schemas/image.tsx:78`). Precedent for "an agent
  command maintains a frontmatter field" only — it has no staleness or
  backfill machinery; Track 3 builds those.
- **Job creation precedent** — `src/cli/commands/wakeup-steps.ts:179`
  `createIntakeJobsForUnjobbed`. The backfill job creator follows this
  pattern.
- **Schema-wins precedent** — `src/schemas/doc.tsx:19` declares
  `title: z.string()` (required). Global `title` is optional; a schema's own
  stricter declaration takes precedence.
- **Listing summaries** — `src/core/file-summary.ts:15` `FileSummary` has
  `{path, tagName, title, attrs}`; only memo and image register loaders
  (`src/core/loader-registrations.ts:20–21`), everything else falls back to
  filename (`src/core/loader-registry.ts:68`). Surfacing `contains` in
  listings is therefore a real (small) interface + endpoint + UI change, not
  free reuse — and index titles come from per-kind extraction, not from
  these loaders.

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
- **Direction**: in `cardworks/src/schema/card-schema.ts`, a
  `GLOBAL_CARD_FIELDS` constant (`{title, contains}` → Zod validators) is
  merged into the injected `frontmatterShape` for any name the schema does
  not itself declare (schema-wins, preserving `doc`'s required `title`).
  **Resolved-surface decision**: `schema.fields` stays the author-declared
  set; the resolved `CardSchema` gains `globalFieldNames: string[]` so
  doc/template generators and field-enumerating code can consult both.
  Globals are full schema surface (parse, validate, serialize, document),
  not validation-only; per-type `*Fields` TS interfaces add the optional
  members only where code actually reads them. `searchable` is carried on
  the resolved `CardSchema`/`ElementSchema` object. Operational schemas set
  `searchable: false`: intake-job, chat-job, calendar-review-job,
  question-followup-job, procedure-run, scheduled-script, chat-thread
  (chat-history search is its own future surface; thread cards hold refs,
  not prose). Everything else — including telegram-message, email-outbound,
  commentary, sheet, gdoc — stays searchable.
- **Vocabulary lock-ins**: field names `title`, `contains`; flag name
  `searchable`; cardworks export `GLOBAL_CARD_FIELDS`. `contains` semantics:
  *one sentence stating what can be found inside this card; when the
  information is concise the sentence carries the information itself
  ("Dentist moved to June 17; confirmation in this email"), not a pointer at
  it ("contains scheduling information"); when it isn't concise, the
  sentence says what's learnable here. Never a list of parts.* Soft length
  budget: warn above 200 characters.
- **First implementation chunk**: the cardworks change + unit tests
  (global injection, schema-wins override, `globalFieldNames`, `searchable`
  defaulting), plus marking the operational schemas in `src/schemas/`.

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
    created, contentHash}`. `id = "<path>#<fragment>"` (`fragment` empty
    for the whole-card doc); the manifest records each card's doc ids so
    removal is exact. One doc per card; additionally one doc per top-level
    markdown section when a body exceeds 2,000 characters (`fragment` =
    `/Heading/Subheading`, ske-style). Legacy XML cards (guide, recipe,
    capture-session, landmark, procedure) index their walked text content.
    The index `title` comes from per-kind extraction (email subject +
    participants, person name, doc/gdoc title, image description, filename
    fallback) — not from the `FileLoader` registry, which only covers memo
    and image. `image.description` also serves as the `contains` fallback
    for images. Search-time boosts: `contains` ~3×, `title` ~2×, `content`
    1× (numbers tuned during dogfooding).
  - **Attachment content (per-kind input files)**: an extractor may declare
    extra input files for a card beyond the `.card` file itself; the
    manifest tracks them like cards (mtime/size/hash), so attachment edits
    trigger re-extraction.
    - **gdoc**: the `content.ref` markdown snapshot is indexed as `content`
      (it's the document).
    - **sheet**: tab *titles* only in v1; cell data is deliberately skipped
      (the tabs are cell-grid JSON with formula/value pairs — it ranks
      badly and bloats the index; `contains` + titles carry retrieval).
      Recorded as a deliberate cut, revisit on demand.
    - **email-message**: the `body-file.ref` text is **not indexed**. The
      body is quarantined outside the card because it is untrusted
      (`email-message.tsx:4–6`); indexing it would re-inject untrusted text
      into agent context via excerpts. Search reaches mail via `subject`,
      `snippet`, participants, and agent-written `contains` (written at
      triage time, when an agent reads the body in a deliberate context).
      Revisiting this requires a sanitization design, not a flag flip.
  - **Persistence**: `search-index.msp` (Orama binary) +
    `search-index-manifest.json` `{schemaVersion, files: {path → {mtimeMs,
    size, contentHash, docIds, inputFiles}}}`. All writes happen under one
    `acquireLock` (`file-lock.ts:215`) wrapped in a bounded retry (~5s of
    short sleeps — the primitive itself throws `LockHeldError` immediately);
    a process that still can't get the lock serves results from the restored
    index without refreshing or persisting, with a stderr note. Files are
    written atomically (temp + rename), index first, manifest last: a crash
    between the two leaves the manifest older, so affected files simply
    re-diff as changed on the next refresh (remove + insert is idempotent) —
    self-healing, no transaction needed. Schema-version mismatch or restore
    failure → silent full rebuild (ske's pattern, `search-index.ts:157–171`),
    logged to stderr.
  - **Refresh (the update trigger)**: on every `cb search`, stat-walk
    `*.card` files, standalone `*.md` files (outside attach scopes,
    `docs/generated/`, and `.claude/` — indexed as kind `markdown`), plus
    manifest-declared input files (excluding `store/trash`,
    `.callback-box`), diff mtimeMs+size against the manifest,
    re-hash on any mtime change, re-extract changed files,
    `remove`+`insert` their docs, persist if dirty. ~10k stats is
    milliseconds; correctness is at-query-time, which beats any hook-based
    trigger (hooks miss `git mv`, shell moves, connector writes, and
    uncommitted state).
  - **Moves**: no special detection. A vanished path's docs are removed (by
    recorded doc ids); a new path is extracted and inserted. Re-extraction
    of a moved file costs one file read — not worth a hash-matching
    optimization or any `cb mv` hook, and this covers `git mv` and shell
    moves identically.
  - **CLI**: `cb search <query> [--kind <type>...] [--path <prefix>]
    [--limit N] [--json] [--rebuild]`. JSON envelope: `{results: [{path,
    fragment, kind, title, contains, excerpt, score}], total, truncated,
    hint, warnings}` where `hint` teaches narrowing and `warnings` carries
    skipped-unparseable-card notes. Human output: `path — title` + excerpt.
    An invalid `--kind` error enumerates the registered searchable types
    (including box-local `config/schemas/`). `cb init` builds the initial
    index; a missing index builds on demand with progress on stderr.
- **Vocabulary lock-ins**: command `cb search`; flags `--kind`, `--path`,
  `--limit`, `--json`, `--rebuild`; files `search-index.msp`,
  `search-index-manifest.json`; doc id `"<path>#<fragment>"`; fragment
  notation `/Heading/Subheading`.
- **First implementation chunk**: `extract.ts` + pure doctests (frontmatter
  card → docs, long-body section split, XML walk, per-kind folding and
  input-file declaration, email-body exclusion). No open questions inside
  it.

### Track 3 — `contains` lifecycle: guidance, staleness, ownership, backfill, listings

- **What**: the writing rule delivered to agents; staleness tracked without
  touching card files; connector preservation so the field survives sync;
  `cb contains list/update`; backfill jobs; `contains` surfaced in listings.
- **Why this needs to change**: a field nobody is told to write stays empty;
  a field with no staleness signal silently rots when bodies change; and a
  field connectors overwrite on every sync
  (`gmail-threads.ts:212`, `drive-handler-docs.ts:240`) is worse than
  empty — agents would keep paying to rewrite it. The boxholder rejected an
  in-card hash (`contains-hash`) as diff churn — the card file must stay
  byte-clean when only bookkeeping changes.
- **Direction**:
  - **Guidance**: one canonical block (the vocabulary-locked rule from
    Track 1, verbatim) written by `generate-docs.ts` into the agent guide and
    appended to each searchable type's `docs/generated/card-<type>.md`.
    Processing guides (intake/triage) get one line: write `contains` when
    creating or substantially editing a searchable card.
  - **Connector ownership**: connector-owned cards are rebuilt from
    templates on sync, so each rebuild path **reads the existing card's
    `contains` (and agent-set `title` where the template doesn't own title)
    and threads it through the template**: gmail thread cards
    (`gmail-threads.ts:212`), gmail message cards (`:134`), gdoc cards
    (`drive-handler-docs.ts:240`), sheet cards
    (`drive-handler-sheets.ts:152`) — via one shared helper
    (`preserveAgentFields(existingCardPath, templateFields)`). The
    gdoc/sheet schema instructions ("don't modify frontmatter",
    `gdoc.tsx:63`, `sheet.tsx:54`) are amended to carve out `contains` as
    agent-writable. Backfill for connector kinds is gated on this chunk
    landing.
  - **Staleness sidecar**: `.callback-box/contains-state.json` —
    `{path → {basisHash, containsText}}`, where `basisHash` hashes the
    markdown body (bodied cards) or canonical YAML minus
    `contains`/`title` (frontmatter-only cards), via one helper
    `computeContainsBasis(parsedCard)`. For cards with declared input files
    (gdoc), the basis covers the input file content too. Maintained by the
    index refresh: contains-text changed → record new basis; basis changed
    while contains-text didn't → stale. A path first seen with a `contains`
    (fresh clone, moved card) records the current basis as fresh. Kept as a
    **separate file** from the index manifest so schema-version index
    rebuilds don't wipe staleness memory. Single-writer (the indexer) under
    the same lock.
  - **Acknowledging a reviewed-but-unchanged `contains`**:
    `cb contains update <card> --text "..."` **always re-bases the sidecar,
    including when the text is identical** — running it is the
    acknowledgment. The stale flag therefore has exactly two exits: update
    the text, or confirm it via the same command. No separate ack state.
  - **Nudges**: `cb validate --hook` gains warning-level output — today it
    is silent unless `totalErrors > 0` (`validate.ts:185`); it will emit
    warnings (stale `contains` per the sidecar; `contains` over 200
    characters) on exit 2 even with zero errors, matching the hook's
    documented "warning, not blocking" framing
    (`install-validation-hooks.ts:8–12`). Honest scope: PostToolUse covers
    agent edits only; pre-commit covers committed hand edits; edits that
    bypass both are caught by `cb contains list --stale`, the catch-all.
  - **CLI**: `cb contains list [--missing|--stale] [--json]` (searchable
    kinds only, bounded output with hint) and
    `cb contains update <card> --text "..."` (splitCardContent + YAML
    mutation per `docs/adding-schemas.md:155`, then re-bases the sidecar).
  - **Backfill**: a job-card creator in the `createIntakeJobsForUnjobbed`
    mold (`wakeup-steps.ts:179`) batching ~25 missing-`contains` cards per
    job. Connector-owned kinds enter the backfill pool only after the
    preservation chunk lands. Completion criterion per box:
    `cb contains list --missing` returns empty for searchable kinds.
  - **Listings**: `FileSummary` (`file-summary.ts:15`) gains an optional
    `contains` field, the summarize endpoint passes it through, and the
    file-entry UI renders it as a secondary line. Small but real interface +
    endpoint + UI work (only memo/image have loaders; for the rest the
    summarize path reads frontmatter it already parses).
- **Vocabulary lock-ins**: `cb contains list|update` (verbs from the
  `ideas.md:515` menu); sidecar filename `contains-state.json`; helper names
  `computeContainsBasis`, `preserveAgentFields`.
- **First implementation chunk**: `computeContainsBasis` + sidecar
  read/write + the refresh integration, with a makeTmpBox doctest covering
  fresh → edit-body → stale → `cb contains update` (identical text) → fresh.

## Subplans

None. The embeddings phase (vector field over `contains`, provider service,
hybrid ranking) is explicitly out of scope below; when it starts, it gets its
own plan — provider choice, cost model, lazy-generation policy, and whether
sanitized email-body indexing is worth designing are a full decision-table of
their own.

## Failure modes

> **Accepted documented risk 1:** *fabricated `contains`* — an agent writes a
> fact the card doesn't support ("moved to June 17" when the email says
> June 16). No mechanical handling can catch semantic divergence; the
> guidance says to quote facts from the content, and any body edit re-flags
> the card for review via the staleness sidecar. Accepted because the field
> is a retrieval aid, never a source of truth — the card body remains
> authoritative, and search results always lead to the card itself.

> **Accepted documented risk 2:** *same-mtime same-size content change
> evades the manifest diff* — essentially only clock-frozen writes. Silent
> by nature; `--rebuild` exists but nothing signals the user to run it.
> Accepted as a narrow corner; if it ever bites, the fix is a periodic full
> re-hash during wakeup, not a redesign.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Index file corrupt/truncated (process killed mid-persist) | doctest: restore garbage → rebuild | atomic temp+rename write; restore failure → full rebuild | clear (stderr note) |
| Crash between index persist and manifest persist | doctest: stale manifest → re-diff | manifest written last; affected files re-extract idempotently (self-healing) | silent by design (converges) |
| Two processes refresh+persist concurrently | doctest: lock contention | bounded retry around `acquireLock`; loser serves stale results without persisting | clear (stderr note) |
| A card fails to parse during indexing (invalid YAML, schema error) | doctest: corpus with one bad card | skip + collect; reported as `warnings` in `--json`, stderr otherwise; search still answers | clear |
| Orama ranking drift after persist/restore (issue #695) | doctest pins persist→restore→search at pinned version | `cb search --rebuild` remedy | clear once doctest exists |
| Connector sync overwrites agent-written `contains` | doctest: sync over a card with `contains` | `preserveAgentFields` in all four connector write paths | n/a once handled (was the critical gap) |
| gdoc attachment edited without card change | doctest: input-file mtime change → re-extract | manifest tracks declared input files | n/a (handled) |
| `contains` exceeds length budget | doctest: validate warning fires | `cb validate` warning at >200 chars (new warning channel) | clear |
| Body edited, `contains` left stale | doctest: sidecar flags stale | hook nudge (new warning output) + `cb contains list --stale` | clear |
| Stale flag with nothing changed (agent reviewed, text still right) | doctest: identical-text update re-bases | `cb contains update` is the ack | clear |
| Fresh clone / moved card has no sidecar memory → resets to "fresh" | no | none (cache semantics; first-seen-with-contains records current basis) | silent — inherent to per-checkout state, documented |
| First search on a 10k-card box (cold build) | manual: large local box | on-demand build with stderr progress | clear |
| Heading renamed in a long body → old fragment docs dangle | doctest: re-extract replaces per-file docs wholesale | per-file remove-by-recorded-docIds + reinsert | n/a (cannot dangle) |

Remaining silent rows are the two accepted documented risks above plus the
two convergent-by-design rows; everything else has handling and a planned
test.

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
  the sidecar has a single writer (the indexer) under the bounded-retry
  lock.
- **Hand-edit drift** — boxholder hand-writes a 400-character `contains` or
  a YAML list. **PARTIALLY ADDRESSED, honestly scoped**: schema validates
  type (string); the length warning fires on agent edits (PostToolUse) and
  at commit (pre-commit); hand edits that bypass both surface via
  `cb contains list --stale`/`--missing` during maintenance. There is no
  real-time channel for non-agent edits and the plan does not pretend
  otherwise.
- **Fabricated free-form value** — see accepted documented risk 1.
- **Connector overwrite** — sync rebuilds a card and would drop agent
  fields. **ADDRESSED**: `preserveAgentFields` in all four connector write
  paths (Track 3); backfill of connector kinds gated on it.
- **Validation error UX** — **ADDRESSED**: warnings are one-liners naming
  the field and the fix ("review `contains:` — body changed"); `--kind`
  errors enumerate valid types per `ideas.md:499`.
- **Partial migration / transition state** — during backfill, most cards
  lack `contains`. **ADDRESSED by design**: the index searches `content`
  regardless; `contains` only adds weight when present; listings fall back
  to existing titles. There is no broken intermediate state.

## NOT in scope

- **Embeddings / vector / hybrid search** — phase 3, own plan. Designed-for
  only: `schemaVersion` bump triggers rebuild; `contains` is the embedding
  unit; Orama's native `mode: "hybrid"` (BM25 + vector fused) is the
  intended default query mode, with text-only as the offline/no-key
  fallback; no Orama plugins (issue #640) so vectors will be computed by a
  service-pattern provider. Boxes' per-box Mistral keys make Mistral the
  likely candidate; nothing here commits to it.
- **Indexing email body text** — deliberately excluded (untrusted content
  quarantine, `email-message.tsx:4–6`). Revisiting requires a sanitization
  design; goes with the embeddings subplan or its own.
- **Indexing sheet cell data** — skipped in v1; tab titles + `contains`
  carry retrieval. Revisit if real queries miss.
- **Indexing `.json` and other non-markdown plain files** — deliberate:
  cell grids and machine state rank badly and bloat the index; standalone
  `.md` is in (kind `markdown`), everything else waits for a real miss.
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
- **Eager index update inside `cb mv`** — the lazy refresh handles moves as
  remove+reinsert and covers non-CLI moves too; an eager hook would be a
  redundant second mechanism.
- **Move-detection-by-hash optimization** — cut; re-extracting a moved file
  costs one read.
- **Sharing index/sidecar state across clones** — both are per-checkout
  caches; reconstruction from git is possible later if ever needed.

## Open design questions

- **Should wakeup opportunistically refresh the index?** Lean: yes, as a
  cheap warm step late in the cycle, but only after dogfooding shows cold
  first-search latency actually annoys — adding it preemptively violates
  bounded scope. (A wakeup full-re-hash would also close accepted risk 2;
  same trigger condition.)
- **Should `contains`, when present, become the listing *title* for
  title-less cards rather than a secondary line?** Lean: secondary line
  only; titles have their own derivation logic and mixing roles invites
  sloppy `contains` writing (the boxholder's stated concern).

## Knowledge audits

Three agent-facing concepts land; each gets a `knows_directly` entry in
`src/dev/knowledge-audits.yaml`:

1. **Writing `contains`** — given a concise-fact card, the agent produces a
   fact-carrying sentence (not a pointer, not a list); given a long doc, a
   what's-learnable sentence.
2. **Reaching for `cb search`** — asked "which cards mention X?", the agent
   uses `cb search` rather than grep, and knows `--kind`/`--json`.
3. **Responding to the staleness nudge** — on the "body changed but
   `contains:` didn't" warning, the agent reviews and runs
   `cb contains update` — with new text, or with the same text to confirm
   it (the update is the acknowledgment either way).

## Implementation order

1. **cardworks globals + flag**: `GLOBAL_CARD_FIELDS` injection with
   schema-wins, `globalFieldNames` on the resolved schema, `searchable` on
   both schema kinds, cardworks unit tests. Everything depends on this.
2. **Mark operational schemas** `searchable: false` in `src/schemas/`;
   registry exposes the searchable type set.
3. **Extraction** (`src/core/search/extract.ts`): per-kind folding,
   section split, XML walk, input-file declaration, email-body exclusion;
   pure doctests. Depends on 1–2.
4. **Index lifecycle** (`index.ts`): build, atomic persist (index-then-
   manifest self-healing order), restore-or-rebuild, manifest diff refresh
   including input files, remove-by-docIds, bounded-retry lock; makeTmpBox
   doctests including the persist/restore pin for issue #695 and lock
   contention.
5. **`cb search`** CLI + core command, excerpts, JSON envelope with
   `warnings`, enumerated `--kind` errors; `cb init` builds the index.
6. **Hook warning channel**: `cb validate --hook` emits warning-level
   output on exit 2 with zero errors (`validate.ts:185`); the `contains`
   length warning rides on it. Independent of 3–5; needed before 7.
7. **`contains` staleness sidecar** (`computeContainsBasis`,
   `contains-state.json`, refresh integration, first-seen re-base) + the
   stale nudge through the chunk-6 channel.
8. **`cb contains list/update`** commands (update re-bases = ack).
9. **Connector preservation**: `preserveAgentFields` wired into gmail
   thread/message and drive doc/sheet writers + doctest (sync over a card
   with `contains`); gdoc/sheet instruction amendments.
10. **Guidance + audits + backfill + listings**: generate-docs blocks,
    knowledge-audit entries, backfill job creator (connector kinds gated on
    9), `FileSummary.contains` + summarize endpoint + file-entry secondary
    line.

Chunks 3–5 and 6–8 are two short serial runs after 1–2; 9 is independent
after 1; 10 depends on 6–9. Each chunk is a commit-sized unit on this
worktree; nothing merges to main until the plan completes.

## Rollout shape

- **Test posture**: overriding the default deferral partially — extraction
  (chunk 3), index lifecycle (chunk 4), the staleness sidecar (chunk 7), and
  connector preservation (chunk 9) get doctests *at chunk time*, because
  index corruption, silent staleness, and field-destroying syncs are
  regression-shaped risks; CLI output formatting follows the dogfood-first
  default with one doctest once the envelope settles. Relevance and
  cold-build latency are validated manually against the large local box copy
  (~10k cards) before merge.
- **Knowledge audits**: all three entries land with the plan (chunk 10).
- **Migration**: no data-shape change — `contains` and `title` are optional
  fields, and the index/sidecar live in already-gitignored `.callback-box/`
  (`ideas.md:698`). The `contains` backfill is gradual but part of
  completion: the mechanism, guidance, and job creator ship with the plan;
  jobs drain per box until `cb contains list --missing` is empty. Per-box
  kickoff happens at the first wakeup after the merged code deploys.
- **Ship signal**: the worktree branch merges to main only on the
  boxholder's explicit go, per the plan discipline.
