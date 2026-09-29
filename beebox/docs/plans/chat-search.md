---
title: "Search recent chats by what was said in them"
status: active
workstream: chat-search
issues:
  - ../../../issues/features/2026-09-28-search-recent-chats.md
---
# Search recent chats by what was said in them

When the boxholder remembers discussing something in a chat but not which
chat, they want to search the conversations themselves and land in the right
one — finding a chat by what was said, not just its title.

**Issues addressed:**
`issues/features/2026-09-28-search-recent-chats.md` (the anchor).
Related, not resolved here: `issues/code-quality/2026-07-18-chat-backend-port-hygiene.md`
(owning our transcripts would simplify indexing; that work stays separate).

Scope decision (boxholder, 2026-09-28): **text-only ranking**. No embeddings
for chat content — transcripts never leave the box. Semantic ranking for
chats would need an explicit consent decision later; see NOT in scope.

## Smallest fix and budget

Smallest fix that meets the job: a **separate Orama index over chat
transcript chunks**, full-text (BM25) only, refreshed lazily at query time
like card search, queried through a new `chat.search` tRPC procedure, with a
search field at the top of the "Recent chats" panel; a result opens the chat
at the matching message via a new `m` deep-link parameter.

Tracks (detail below): store generalization, chunk extraction, incremental
refresh, query layer, tRPC procedure, panel UI, deep-link. Estimated
~1,100–1,500 changed lines including doctests (~700–900 source, ~400–600
test). Under the 2,000-line BIG CHANGE threshold.

What the fuller (semantic) design would have bought — vocabulary-mismatch
recall ("the chat about the insurance thing" where those words never appear)
— was declined for now to keep transcript text off the embeddings provider.
The index and chunk shape leave room for vectors later (schema version bump
+ embed pass, the same way card search grew them).

## Stated preferences this plan trades against

- **Strictness by default**: index and manifest stay disposable caches with
  fail-closed restore (`store.ts` model), typed manifests validated with zod.
- **Minimize invented concepts; prefer primitives**: no new card type, no new
  vocabulary — chunks reuse the `SearchDoc` shape; the UI reuses the existing
  session list and chat route.
- **Scope anchored to the ask**: index only what a "find that chat" query
  needs (user/assistant text), not tool calls or outputs.
- `beebox/CLAUDE.md`: "Work only on the requested problem" — the UI stays in
  the chat list; global-search integration and per-user privacy gating are
  filed follow-ups (see the anchor issue's Related links).

## What already exists

- **Orama index + lazy refresh machinery**: `src/core/search/store.ts`
  (schema, atomic persist, receipt-typed manifest ordering),
  `refresh/core.ts` (refresh-at-query-time under a file lock,
  `refresh/core.ts:1` — "runs at every query"), `refresh/manifest.ts`
  (per-file stat/hash diff). Reuse the pattern; the filenames are constants,
  so the store needs a small generalization (Track 1).
- **Full-text query precedent**: `query/core.ts:186`–192 — plain
  `search(db, { term, properties, boost, limit })` is the text half the chat
  query needs; the vector machinery is simply omitted.
- **Transcript readers, both engines**: Claude JSONL via `parseSessionLog`
  (`cli/lib/session.ts`; honors the `BBX_CLAUDE_PROJECTS_DIR` override,
  `session/transcript-paths.ts:44` — the test seam). Codex via
  `readCodexSessionHistory` → `adaptCodexThreadHistory`
  (`session/codex-transcript.ts:252`–290, "Pure, fixture-testable"), which
  already adapts thread items to `SessionEntry`. Both produce
  `SessionEntry` with a stable `uuid` (`cli/lib/session-entry.ts:17`–26) —
  the deep-link anchor.
- **Chat enumeration**: `session/list/core.ts:117` (`listSessionEntries`) —
  one husk read + one stat per chat, resolves engine, mtime, husk path,
  title, and splits live/dead. The refresh drives off this; no new walker.
- **Text hygiene for user messages**: `stripSpeechWrappers`
  (`transcript-render.ts:37`) strips `<typed>`/`<speech>` wrappers; tool
  results are already skipped there (`transcript-render.ts:43` — "tool_result
  skipped — adds noise without value").
- **Search UI precedent**: `QuickSearchOverlay.tsx:15` (tRPC `search.query`,
  keyboard nav) and `SearchResults` for row/highlight patterns; the panel
  target is `SessionListPanel.tsx:56`.
- **Chat route search params**: `lib/chat-route-search.ts:5` — extend with
  `m`. History windows load via `chat.history` with slice params
  (`api-chat.ts:171`, `load-history.ts:39` tail-200 default).
- Prior art in-tree: `docs/implemented-plans/semantic-search.md` and
  `docs/implemented-plans/box-search.md` (shipped card search; the text-mode
  path this plan mirrors).

## Prior art (external)

No external premise is load-bearing: Orama full-text search and the
persistence plugin's JSON restore behavior are already in production use by
card search (`store.ts:1`–26 records the one real external trap — msgpack
depth — and this plan keeps JSON). Not searched further, per the template
rule for decisions with no external premise.

## Ontology

- **Chat chunk** (new): a run of consecutive user/assistant text from one
  transcript, ~1,600 chars max, identified by `<huskPath>#<anchorUuid>` where
  `anchorUuid` is the `uuid` of the chunk's first `SessionEntry`. It is NOT a
  card, a turn, or a saved excerpt; it points at (session id, engine, husk
  path, anchor entry).
- **Chat search index** (new): a second Orama index + manifest + lock in
  `.beebox/` (`chat-search-index.json`, `chat-search-manifest.json`,
  `chat-search.lock`). It is NOT part of `search-index.json`; it never loads
  on the card-search path. Implemented with its own small schema
  (`chat-search/schema.ts`: `sessionId`, `anchor`, `title`, `content`,
  `created`) rather than the card `SearchDoc` shape — the query layer needs
  the session id on the document, and the card-only fields (`path`, `kind`,
  `contains`, `contentHash`, `embedding`) would all be dead weight.
- **Chat manifest entry** (new): keyed by session id; records engine, husk
  path, transcript mtime (Claude) or thread `updatedAt` (Codex), parsed
  `entryCount`, `docIds`. No embed state — text-only by decision.
- **Chat chunk doc id**: `<sessionId>#<anchorUuid>` — keyed on the SESSION id,
  not the husk path, so a husk rename never orphans indexed chunks (the
  session id is the husk's identity key, `schemas/chat.ts:25`–27).
- **`m` deep-link param** (new): `?m=<entryUuid>` on `/chat`, one-shot like
  `companion` (`chat-route-search.ts:11`–13). NOT a persisted view state.

## Tracks / scope

### Track 1 — generalize the index store

**What.** Extract a factory from `core/search/store.ts` taking
`{ indexFilename, manifestFilename, lockFilename, schemaVersion }` plus the
Orama schema, returning path helpers, `restore`, `persist`, `unchanged` (the
`IndexPersisted` receipt pattern stays). The card index becomes the existing
filenames' instance; exported card-index function names are unchanged.

**Why.** The chat index needs the identical persist/manifest/lock/crash
ordering; duplicating 160 lines would drift, and the receipt invariant is
subtle enough that it should exist once.

**Vocabulary lock-ins.** `IndexStoreSpec` (name for the factory's product);
card filenames and `SEARCH_SCHEMA_VERSION` unchanged; chat store uses
`CHAT_SEARCH_SCHEMA_VERSION = 1` and `searchOramaSchema` (same shape — the
chunk `SearchDoc` fits it exactly).

**First implementation chunk.** Factory + card index on it, card doctests
still pass.

### Track 2 — chunk extraction (pure)

**What.** `core/chat-search/extract.ts`: `chunkSessionEntries({ entries,
huskPath, title })` → `SearchDoc[]` (kind `"chat"`). Filter to
`user`/`assistant` entries with visible text; user text passes through
`stripSpeechWrappers`; tool_use/tool_result blocks contribute nothing.
Accumulate entry texts into a chunk until ~1,600 chars; a long entry may
start a new chunk. Reuse `normalizeContent`'s 64-char-run splitting by way of
building content through the same normalization (the radix-tree depth note in
`extract/core.ts:351`–359 applies to transcripts too).

**Why.** This is the whole "what gets indexed" decision: dialogue text in
chunks that point back at a position, per the issue; tool traffic is noise.

**First implementation chunk.** Pure function + doctest over fixture
`SessionEntry` arrays including both engines' uuid shapes and
speech-wrapper cases.

### Track 3 — incremental refresh

**What.** `core/chat-search/refresh.ts`: `openChatSearchIndex(boxRoot,
options)` mirroring `refresh/core.ts`. Enumerate with `listSessionEntries`
(also `loadDeadHusks` for removals). Per live session: if the manifest's
recorded mtime/`updatedAt` (and husk path) match, skip; else read the
transcript (Claude: `parseSessionLog` paged to completion under the
`BBX_CLAUDE_PROJECTS_DIR` root; Codex: `readCodexSessionHistory` page-mode
full), slice off the `entryCount` already indexed, chunk and insert only the
new tail. Persist under `chat-search.lock`. If the new entry count is lower
than recorded (compaction rewrite, transcript replaced), drop and rebuild
that session's docs. Dead or deleted sessions drop their docs.

**Why.** "A chat from this morning should be findable today" — refresh at
query time gives that with no scheduler; incremental tail extraction keeps
refresh cost proportional to new conversation, not corpus size.

Codex degradation: if thread metadata is unavailable
(`readCodexThreads`-style failure), warn once and refresh Claude sessions
only — the same posture as the chat list (`list/core.ts:141`–147, "a
degradation rather than a failure").

**First implementation chunk.** Claude-path refresh doctest against fixture
transcripts (`BBX_CLAUDE_PROJECTS_DIR` temp dir): initial build, append-only
update, shrink rebuild, delete removal.

### Track 4 — query layer

**What.** `core/chat-search/query.ts`: `searchChats(boxRoot, { query, limit
})`. Open the chat index (lazy refresh), run plain full-text
`search(db, { term, properties: ["title", "content"], boost: { title: 2 },
limit })` — the text-mode call shape at `query/core.ts:186`. Then group hits
by session — one result row per chat, keeping its best chunk — with
transcript recency as the tiebreak (the `_content/`-boost post-ranking at
`query/core.ts:200`–204 is the precedent for post-search ordering). Return
`{ sessionId, engine, huskPath, anchorUuid, title, snippet, timestamp, score
}[]` plus warnings/stale.

**Why.** A hit is a chat, not a chunk; the row must say which conversation
matched and where.

**First implementation chunk.** Query doctest over a fixture index: match
ordering, per-chat dedupe, recency tiebreak, snippet generation.

### Track 5 — tRPC procedure

**What.** `chat.search` in `webapp/trpc/routers/chat/` (new `search.ts`,
merged into the existing chat router): input `{ query, limit? }`,
zod-validated like `routers/search.ts`; calls `searchChats` with short lock
retries (3 × 100 ms, matching `routers/search.ts:18`–19).

**Why.** tRPC is the default for frontend-facing endpoints
(`docs/adding-api-endpoints.md`); chat search is chat-domain, not
card-search-domain, so it lives under `chat.`.

**First implementation chunk.** Procedure + doctest through the test tRPC
harness.

### Track 6 — panel UI

**What.** A search field at the top of `SessionListPanel` (debounced
~300 ms, minimum 2 non-space characters, `type="search"`, labelled). While a
query is active the panel shows result rows instead of the grouped list:
label (resolved live from the already-loaded session list where possible,
indexed title otherwise), relative time, highlighted snippet. Escape clears
and restores the list. A row navigates to `/chat?session=<id>&m=<anchorUuid>`
and closes the dropdown. Empty results, error, and loading states render
explicitly, per the panel's own fetch-state precedent
(`SessionListPanel.tsx:24`–26).

**Why.** The JTBD starts at the chat list ("scroll and open one by one" is
the failure being fixed); the field belongs where the list is.

**First implementation chunk.** Field + results wired to `chat.search`,
doctest or component test per existing frontend patterns, then a browse pass
over a test box.

### Track 7 — `m` deep-link

**What.** Add `m: z.string().optional()` to `chatSearchSchema`. On session
open, if `m` is present: message wrappers carry their entry uuids (a
`data-entry-uuids` attribute on the group wrapper — groups already key by
entry uuid, `message-items.tsx:241`); if the anchor is outside the loaded
window, page older history via `chat.history` until present (bounded by the
transcript); then reveal it **through the scroll controller** — a new
one-shot `revealEntry(uuid)` action on `useChatScroll`, treated like the
open-time action class of `settleOpen` (the "exactly one thing controls
scroll" invariant, `frontend chat CLAUDE.md`). One-shot like `companion`;
a later refresh does not re-scroll.

**Why.** The issue's ideal: "results open the chat at the matching message."
Cut line: if paging-to-entry grows past ~150 lines, ship open-chat-only and
file the landing as a follow-up issue — the search result still names the
chat.

**First implementation chunk.** Route schema + reveal-on-load for an anchor
inside the tail window (the common case), doctested; paging-to-older as the
second chunk.

## Could this be simpler?

The simplest version — grep every transcript at query time, no index —
avoids the store, manifest, and refresh tracks entirely. It fails on the
query path itself: the panel field searches per keystroke (debounced), and a
grep re-reads every transcript in the box on each one; the chat list already
pays one stat per chat per render and memoizes labels for exactly this
reason (`list/core.ts:254`–292). The index turns that into one indexed
lookup plus a stat-diff, and the incremental cursor keeps refresh
proportional to new turns.

The remaining complexity — the separate index and the store factory — buys a
query path that does not tax card search (separate files, separate lock) and
a place to add vectors later without a format change. Nothing else in the
design is new machinery.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Transcript deleted between enumerate and read | Plan: refresh doctest (delete removal) | Planned: ENOENT → drop docs, treat as dead | Clear (row disappears from results; husk still found via card search) |
| Codex app-server down during refresh | Plan: degradation doctest | Planned: warn once, Claude-only refresh (mirrors `list/core.ts:141`) | Clear (warning in result payload) |
| Chat-search lock held by another process | Plan: reuse stale-on-lock shape | Planned: serve persisted index + `stale: true` (mirrors `refresh/core.ts:93`–105) | Clear |
| Transcript shrinks / is rewritten (compaction edit, resume after rewrite) | Plan: shrink-rebuild doctest | Planned: entry-count regression → rebuild session docs | Clear |
| Husk renamed (doc ids key on the session id, so renames don't orphan chunks) | Doctest: id stability across append (rename follows the same keying) | Needs none — ids are rename-stable by construction | Clear |
| Corrupt index/manifest | Existing: `store.ts:96`/`manifest.ts:60` empty-restore rebuild | Planned (same code path) | Clear |
| Marathon transcript blows up first build | Plan: chunk cap test | Planned: extraction streams entries; first build is one-time | Clear (query completes) |
| Anchor entry not renderable after landing (edited out server-side) | Plan: reveal falls back to nearest loaded position | Planned | Clear (chat opens regardless) |

> **Critical gap:** none — every row has at least a planned handling; the
> doctests named in *Rollout shape* are the completion gate for that column.

## Agent-flow / user-flow edge cases

- **Wrong surface for the query** (card words typed into chat search): chat
  results simply miss; the boxholder falls back to card search. ADDRESSED by
  keeping the two surfaces separate and the panel field labelled "Search
  chats". Cross-surface merging is a filed follow-up (Cmd+K integration).
- **Stale ref — husk deleted after indexing**: refresh enumerates husks, so
  docs drop on the next query. The deep link's session may not resume
  (transcript expired): the chat page already handles a transcript-less id
  (`list/core.ts:396`–399 "not an error"). ADDRESSED.
- **Two writers — chat search refreshing while a chat streams**: transcripts
  are append-only files; the reader sees a partial last line,
  `parseSessionLog` tolerates it, and the next refresh indexes the rest
  (entryCount cursor). No lock is taken on the transcript. ADDRESSED.
- **Hand-edit drift — boxholder renames a husk**: rebuild-on-huskPath-change
  (above). The `m` anchor and session id are unaffected by renames
  (`schemas/chat.ts:25`–27 — "the filename is a naming convention").
- **Fabricated free-form value**: `m` is a uuid or the page ignores it
  (zod-optional, no match → no scroll, no error banner). ADDRESSED.
- **Validation error UX**: `chat.search` returns tRPC-shaped errors the panel
  renders in its existing error row. ADDRESSED.
- **Partial rollout**: each track ships behind its own commit; the panel
  field appears only with Track 6, and `m` links only with Track 7 — before
  that, results can open `/chat?session=` alone. No transition state.
- **Multi-user exposure** (a chat search surface shows one person's
  conversations to another box user): the v1 surface is the chat list panel,
  which already shows every chat in the box — no new exposure. The filed
  private-sessions/classifier follow-up gates any broader surface (Cmd+K).

## NOT in scope

- **Embeddings / semantic ranking for chats** — boxholder chose text-only
  (2026-09-28) so transcript text never reaches the embeddings provider.
  Revisit only with an explicit consent decision; the schema leaves the
  vector field in place, so adding it later is a version bump + embed pass.
- **Chats in global search / Cmd+K** — filed as its own follow-up issue,
  together with the private-session classifier and per-user gating it
  depends on (boxholder direction, 2026-09-28). The panel field is the v1
  surface.
- A `bbx` CLI verb — the CLI is agent plumbing, not the boxholder's surface;
  nothing in the JTBD needs it.
- Indexing tool calls/outputs, attachments, or nightly summaries — noise per
  the issue; husk `title`/`contains` already reach card search.
- Cross-machine search — only transcripts present on this machine
  (`origin` semantics unchanged); dead husks stay card-search-only.
- Owning transcripts in-box (`chat-backend-port-hygiene`) — would simplify
  this feature but is its own workstream.
- In-process index caching to avoid per-query restore — a vector-free index
  restores fast (the seconds-scale cost is vectors, `store.ts:16`–20);
  revisit only if chat search feels slow in use.

## Open design questions

none remaining — the two v1 questions resolved on 2026-09-28: panel field
first with Cmd+K as a filed follow-up, and text-only ranking. The deep-link
ships in v1 with its Track 7 cut line.

## Knowledge audits

No new agent-facing box concept: chunks and the chat index are engine
internals; no card shape, tag, or prompt changes. Skip-with-rationale:
purely infrastructural plus UI.

## What will hold this after it ships

- Chunking and extract purity: doctest at the `core` tier with fixture
  `SessionEntry` arrays (both engines).
- Refresh lifecycle: doctest with `BBX_CLAUDE_PROJECTS_DIR` pointed at a
  temp fixture tree — build, append, shrink, delete, codex-down.
- Query decisions (dedupe, recency): extract as pure post-search functions
  and doctest them, the same seam `query/core.ts` already uses for its sort.
- tRPC procedure: existing router doctest harness.
- Panel behavior and the deep-link reveal: browse-verified on the worktree
  test box (exhibit for the boxholder; a 264-entry transcript opened at an
  anchor outside the tail window and paged to it). No new
  `/dev/chat-scroll` harness scenario was added: the reveal reuses the
  controller's `anchorToTop` — the action the harness's send scenarios
  already exercise — and the new logic is the React wiring around it, which
  the harness does not model.
- The chat CLAUDE.md scenario-table requirement applies to scroll-controller
  changes; none were made (`scroll.ts` untouched).

## Implementation order

1. Track 1 (store factory) — unblocks 3.
2. Track 2 (extraction) — unblocks 3.
3. Track 3 (refresh) — unblocks 4.
4. Track 4 (query) + Track 5 (tRPC).
5. Track 6 (panel) — first end-to-end visible slice (without `m`).
6. Track 7 (deep-link) — schema+in-window reveal, then paging-to-older.

Each track lands as its own commit in this worktree; the plan ships as one
piece when all are done.

## Rollout shape

Done-when, as tests:

- `chat-search extract` doctest: fixtures → expected chunk docs (ids,
  anchors, text, wrapper stripping, tool-skip).
- `chat-search refresh` doctest: fixture box + transcripts → manifest state;
  append → only new chunk docs; shrink → rebuild; delete → drop; codex
  metadata failure → Claude-only + warning.
- `chat-search query` doctest: fixture index → match ordering, per-chat
  dedupe, recency tiebreak, snippet generation.
- `chat.search` router doctest: input validation, result shape, stale flag.
- Panel component test + browse exhibit on a test box (real transcripts are
  private box content — test boxes only, per repo privacy rules).
- `/dev/chat-scroll` harness: reveal scenario PASS.

No on-disk box data changes: both files live in `.beebox/` and are
disposable caches. No migration.
