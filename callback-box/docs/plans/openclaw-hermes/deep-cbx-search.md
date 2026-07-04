# Search in Callback Box — a map of every search-shaped surface

Root: `/Users/ianbicking/src/callback-worktrees/compare-openclaw-hermes/callback-box`

Bottom line: there is **one real search engine** (`src/core/search/`, an Orama
full-text index over cards), exposed through **two thin surfaces** (CLI +
generic command-runner used by tRPC), and documented to the box agent as the
preferred alternative to `grep`. Chat history has its own, completely
separate, non-indexed **client-side structured filter** (not text search).
There is **no dedicated search UI page**, **no tRPC `search` router**, and
**no embedding/vector search anywhere** in the repo — everything is lexical.

---

## 1. Core engine: `src/core/search/` (Orama full-text index)

**Library:** `@orama/orama` + `@orama/plugin-data-persistence`
(`package.json:79-80`) — a tokenized/ranked (BM25-style) JS full-text engine,
not a custom substring/grep implementation.

### Corpus covered
- Every `*.card` file under the box, walked recursively, **including inside
  `.attach/` scopes** (e.g. email messages live there) —
  `src/core/search/walk.ts:40-82` (`walkCardFiles`).
- Standalone `*.md` files outside attach scopes and outside
  `docs/generated/` — `walk.ts:65-68` (kind `"markdown"`, added in schema v3,
  `search-store.ts:23-24`).
- **Excluded directories:** `.git`, `node_modules`, `.callback-box`,
  `.claude`, `.scan-archive`, `.scan-api`, and `store/trash/*` —
  `walk.ts:15-24`. → **Trashed/archived cards are not indexed.**
- **Excluded card types:** any schema with `searchable: false` (operational
  types like jobs/runs), via `getSearchableTypes()`,
  `src/schemas/registry.ts:414-420`; agent guide tells the agent to use
  `cb ls` for those instead (`src/core/agent-guide/search.ts:16-17`).
- **Deliberately NOT indexed: email bodies.** `extract.ts:12-16` — untrusted
  content is kept out of the index so a search excerpt can't re-inject
  untrusted text into agent context; email is reached only via
  subject/participants/labels/snippet (folded fields, `extract.ts:213-230`)
  and the agent-written `contains:` field.
- Per-kind frontmatter folding into searchable text (`extract.ts:211-269`):
  `email-thread`, `email-message`, `person`, `record`, `image` (OCR'd `text`
  blocks — `extract.ts:247-253`), `file`, `gsheet` (tab titles),
  `telegram-message`, `memo`.
- `gdoc` cards index the content of a **declared external snapshot file**
  (attach-scope markdown), not the card body itself — `extract.ts:75-83,
  189-196`.
- Long bodies (`> SECTION_SPLIT_THRESHOLD = 2000` chars, `extract.ts:39`) are
  split into **per-heading-section documents** with a hierarchical
  `fragment` id like `/Components/Programs`, via
  `src/core/search/markdown-sections.ts:33-71` (`splitMarkdownSections`).
- **Attachments/binaries:** only OCR'd text (for images) makes it in; no raw
  binary content indexing.
- **Chat threads/transcripts: not indexed at all** (see §5).

### Indexing approach: persisted Orama index, lazily rebuilt at query time
- **Storage:** JSON (not msgpack) at `.callback-box/search-index.json` +
  a diffing manifest at `.callback-box/search-index-manifest.json`, both
  per-checkout disposable caches (`search-store.ts:1-13, 41-55`). JSON was
  chosen deliberately because Orama's radix tree nests one object level per
  branching character and OCR'd numeric runs exceed msgpack's depth-101
  limit (`search-store.ts:2-7`).
- **Schema:** `searchOramaSchema` — `path, fragment, kind, title, contains,
  content, created, contentHash` (`search-store.ts:28-39`).
  `SEARCH_SCHEMA_VERSION = 3` (`search-store.ts:26`); a version bump
  silently triggers a full rebuild (manifest version mismatch →
  `emptyManifest()`, `manifest.ts:54`).
- **Manifest** (`manifest.ts:17-30`) records per-file `mtimeMs/size/
  contentHash`, the set of `docIds` a card contributed (for exact removal),
  any declared `inputs` (e.g. gdoc snapshot files), and a `skipped` flag for
  cards that failed to parse (so a broken card warns once, not every
  refresh).
- **Refresh algorithm** — `src/core/search/refresh.ts` `openSearchIndex()`
  (line 64) → `refreshUnderLock()` (line 86): restores the persisted index +
  manifest, walks the filesystem (`walkCardFiles`), diffs by `relPath`
  against the manifest:
  - Vanished files → `dropCard()` (`refresh-file.ts:43-50`) removes their
    `docIds` from the Orama index via `remove()`.
  - Present files → `refreshOneCard()` (`refresh-file.ts:53-125`) or
    `refreshOneMarkdownFile()` (`refresh-file.ts:128-161`): skip if stat
    unchanged; if stat changed but content hash unchanged, only patch
    manifest bookkeeping (handles `git checkout` touching mtimes);
    otherwise re-parse, re-extract `SearchDoc[]`, and `insertMultiple()`/
    `remove()` into the live Orama db.
  - Broken cards (`CardIOError`/`ParseError`) are skipped with a warning,
    remembered via `skipped: true` so they don't warn on every refresh
    (`refresh-file.ts:95-112`).
  - Persist order is **index first, manifest last** so a crash between the
    two just re-diffs affected files next time (`refresh.ts:141-151`, also
    documented `search-store.ts:9-12`).
- **Freshness model: no write hooks at all.** The module doc is explicit:
  *"Correctness is at-query-time: no hooks, so `git mv`, shell moves,
  connector writes, and uncommitted state are all covered"*
  (`refresh.ts:1-8`). Every `cb search` invocation (and `cb contains list`,
  `contains.ts:34`) triggers a full manifest diff before querying — i.e.
  index freshness is guaranteed per-query, not maintained continuously.
- **Concurrency:** the whole refresh runs under a per-box file lock
  (`src/lib/file-lock.ts`) at `.callback-box/search-index.lock`
  (`search-store.ts:53-55`), with bounded retry (`refresh.ts:180-196`,
  default 10 attempts × 500ms). A process that can't acquire the lock serves
  the last persisted index **without refreshing**, flagged `stale: true`
  (`refresh.ts:75-78`, surfaced in `SearchBoxResult.stale`, `query.ts:49`).

### Query semantics: ranked full-text, not substring/regex
- `src/core/search/query.ts` `searchBox()` (line 63) calls Orama's
  `search()` over `properties: ["title", "contains", "content"]` with field
  boosts `{ contains: 3, title: 2 }` (`query.ts:14, 84-90`) — a
  BM25/TF-IDF-style ranked retrieval, tokenized, not exact substring or
  regex. The agent guide is explicit: *"It's relevance-ranked, not
  exact-match — there is no keyword or quoted-phrase mode"*
  (`agent-guide/search.ts:22-23`).
- Optional `where: { kind: { in: kinds } }` filter, validated against
  `getSearchableTypes()` before the refresh side effect runs (fail fast) —
  `query.ts:70-76, 89`.
- Optional `pathPrefix` filter is **post-search** (not pushed into Orama):
  fetches up to `PATH_FILTER_FETCH = 1000` hits then does
  `.filter(h => h.path.startsWith(pathPrefix))` (`query.ts:17-18, 83,
  94-97`) — a narrow path prefix combined with a common query can silently
  miss results beyond the 1000-hit fetch window.
- Results truncated to `limit` (default `DEFAULT_LIMIT = 10`, `query.ts:16,
  68, 98`), with a `truncated`/`hint` nudge to narrow by
  `--kind`/`--path`/`--limit` (`query.ts:113-117`).
- **Excerpting** — `src/core/search/excerpt.ts` `generateExcerpt()`
  (line 13): finds the earliest occurrence of any lowercase query token in
  the doc's `content` (or `contains` as fallback, `query.ts:108`), extends
  ±100 chars to word boundaries, adds `...` markers. This is plain substring
  matching for *display* purposes only, layered on top of the ranked
  retrieval.
- **Single-box only** — no cross-box search surface was found anywhere.

### The `contains:` field and its staleness sidecar
- `contains:` is the "prime retrieval field," boosted 3x. Two supporting
  modules:
  - `src/core/search/contains-state.ts` (227 lines) — a separate sidecar
    `.callback-box/contains-state.json` (`STATE_VERSION = 2`, line 35)
    tracking, per card, `containsText`, `basisAtWrite` (content hash when
    `contains` was last confirmed), and `currentBasis` (latest observed
    hash). `isStale()` (line 156) flags cards whose content moved since
    `contains:` was written; `listMissing()`/`listStale()` (lines 161-174)
    build agent worklists. The basis excludes `contains`, `title`, `type`,
    `status` fields deliberately (operational status flips shouldn't
    trigger staleness) — lines 9-12, 38.
  - `src/core/search/contains-update.ts` (121 lines) — `updateContainsField()`
    is the write path for `cb contains update <card> --text "..."`: parses/
    rewrites YAML frontmatter directly (`splitCardContent` + `yaml`
    stringify, lines 101-109), re-validates, and re-bases the staleness
    sidecar (`rebaseContains`, line 118). Writing identical text is the "I
    confirm this still holds" acknowledgment path (`contains-update.ts:
    106-107`, echoed in `contains-state.ts:143-147`).
- `effectiveContains()` (`extract.ts:62-68`) falls back to a per-kind field
  (`image`/`file` → `description`) when no explicit `contains:` is set, so a
  described image isn't flagged "missing."

---

## 2. CLI surface: `cb search`, `cb contains`

- `src/cli/commands/search.ts` (74 lines) — thin Commander wrapper. Flags:
  `--kind <type...>` (repeatable), `--path <prefix>`, `--limit <n>`,
  `--json`, `--rebuild` (forces full reindex before searching,
  `search.ts:22, 47`). Does **not** call `src/core/search` directly — it
  goes through the generic command-runner: `runCommand({ name: "search",
  args, ctx })` (`search.ts:52, 64`), which dispatches to
  `src/core/commands/search.ts`.
- `src/core/commands/search.ts` (82 lines) is the actual glue: validates a
  non-empty query (lines 20-22), builds `SearchBoxOptions`, calls
  `searchBox(ctx.boxRoot, options)` from `query.ts` (line 39), formats human
  output as `path[#fragment] — title` + `contains:` line + excerpt (lines
  56-61), and registers itself via `registerCommand({ name: "search", ...
  })` (lines 69-80) — the same registry the tRPC `commandsRouter` and any
  other command-runner consumer share.
- `src/cli/commands/contains.ts` (112 lines) — `cb contains list
  [--missing|--stale] [--json]` (forces an index refresh first via
  `openSearchIndex(boxRoot)`, `contains.ts:34`, before reading the sidecar)
  and `cb contains update <card> --text "..."` (calls
  `updateContainsField`, `contains.ts:68`). This is a maintenance/backfill
  tool, not itself a search command — it surfaces the
  `search/contains-state.ts` worklist.
- Neither CLI command shells out to plain `grep` — both are proper clients
  of the Orama-backed `src/core/search` engine.

---

## 3. Agent-facing surface

- `src/core/agent-guide/search.ts` (49 lines) — pure documentation text
  (`searchSection()`), injected into the agent's system-prompt/guide via
  `src/core/agent-guide/index.ts:30,63`. Key instructions to the agent
  (lines 13-22):
  - *"prefer it over `grep` for finding cards by content: it understands
    card structure, ranks by relevance, and weights the `contains:` field
    heavily."*
  - Explains query style (lead with distinctive words, not generic terms —
    because it's ranked retrieval, not exact match), gives worked examples
    (`cb search "carbonara"`, `cb search "dentist reschedule" --kind
    email-message`, `cb search "Maria phone" --path people`).
  - `CONTAINS_DOC_APPENDIX` (lines 44-49) is appended to every searchable
    card type's generated doc (`docs/generated/card-<type>.md`) reminding
    the agent to write a good `contains:` sentence.
- `src/core/agent-guide/commands.ts:25-26` also references `cb search` in
  the general commands catalogue, again nudging away from `grep`.
- **The box agent has no separate MCP search tool** — grepping across `src`
  for `mcp` + `search` turned up nothing; there is no MCP server exposing
  search. The agent's only two ways to find things are (a) run `cb search`
  as a shell command (goes through the engine above), or (b) fall back to
  its normal Read/Grep/Glob tools directly on disk — the guide explicitly
  discourages the latter for content search but doesn't (and can't) prevent
  it. **Nothing blocks a box agent from just calling `Grep` on the card
  files directly, bypassing the index, `contains:` weighting, and ranking
  entirely.**
- `src/core/box-skills-content.ts:347` references `cb search --kind
  email-message` as the way to answer "does the user have an email about X"
  without drafting a reply — a specific documented usage pattern, not a
  distinct implementation.

---

## 4. tRPC / frontend surface — no dedicated search endpoint

- Grepping `src/webapp/trpc/routers/*.ts` for `"search"` returns **zero
  hits** in any router file's content (only filenames matched incidentally).
  There is **no `search.ts` router** and no procedure like
  `trpc.search.query`.
- The only path from the frontend to `src/core/search` is generic:
  `src/webapp/trpc/routers/commands.ts` exposes `commandsRouter.list`,
  `.get`, and `.executeSync` (lines 11-67), which dispatch by name through
  the same `runCommand()`/`registerCommand()` registry the CLI uses. In
  principle a frontend caller could do `trpc.commands.executeSync({
  command: "search", args: {...} })` and reach `searchBox()`, but
  **grepping the frontend for `executeSync`/`commands.get`/`commands.list`
  usage found nothing** — no frontend code currently calls into `search`
  this way.
- **There is no search page or search box component.**
  `find src/frontend/src -iname "*search*"` returns nothing. Every
  `"search"` hit in the frontend (`HistoryPage.tsx`, `BrowsePage.tsx`,
  `components/history/history-filter.ts`, `history/HistoryBrowser.tsx`,
  `lib/trpc.ts`, etc.) is either:
  - `useSearch()`/`URLSearchParams`/`location.searchStr` — TanStack
    Router's **URL query-string** API, unrelated to full-text search
    (`HistoryPage.tsx:27`, `BrowsePage.tsx:107,110`), or
  - the word "search" inside comments about "search params"
    (`history-filter.ts:1-6,19-26`, `HistoryBrowser.tsx:4`).
  - `history-filter.ts` (69 lines) is entirely about mapping History-page
    **filter state** (connectors, workflows, touchpoint, feedback, session
    id) to/from URL search params and `view: history` card frontmatter
    params — a structured filter UI, not free-text search, and not backed
    by the Orama index at all.
- **Conclusion:** as of this codebase state, there is no user-facing
  full-text search UI. `cb search` is CLI/agent-only.

---

## 5. Chat history / transcripts — not covered by the search index at all

- `src/core/chat-session-transcript-sync.ts` and
  `src/core/chat-session-messages.ts` have zero connection to
  `src/core/search`; grepping them for `search`/`contains` only turns up
  unrelated uses of the English words ("tail window searched," "transcript
  contains an entry with `uuid`") — `chat-session-transcript-sync.ts:3,29,
  56`.
- Chat transcripts are **not walked by `walkCardFiles`** (they aren't
  `.card` or standalone `.md` files in the box tree in the way that would
  get indexed) and are **not part of the Orama corpus**.
- The History page's filtering (`history-filter.ts`, `HistoryBrowser.tsx`)
  is a structured metadata filter (by connector/workflow/touchpoint/
  feedback/session), not a text-content search — **there is no "search my
  chat history for X" capability anywhere in the codebase.**

---

## 6. No vector/embedding search anywhere

- `grep -rniE "embedding|vector search|cosine|openai.*embed"` across `src/`
  turns up only unrelated uses of the English word "embed/embedding" (e.g.
  embedding an absolute path in a git hook — `install-validation-hooks.ts:
  36`; embedding a VTIMEZONE block — `google-calendar-ics.ts:155`;
  "embedding query" as in a UI text field a user typed for a saved view —
  `chat-card-activity.ts:15`, `chat-session-messages.ts:146`,
  `chat-helpers.ts:53`; markdown "Embedding" section syntax for figures —
  `figure.ts:104`). None of these are semantic/vector search.
- `package.json:79-80` only pulls in `@orama/orama` +
  `@orama/plugin-data-persistence` — Orama does support vector fields, but
  this schema (`searchOramaSchema`, `search-store.ts:28-37`) declares no
  vector column; every field is `string`/`enum`. **Search is 100%
  lexical/tokenized, never semantic.**

---

## Summary table

| Surface | Corpus | Index | Query semantics | Where it surfaces | Freshness | Notable gaps |
|---|---|---|---|---|---|---|
| **Core engine** `src/core/search/*` | `*.card` (searchable types only) + standalone `*.md`, incl. `.attach/` scopes; excludes trash, `.claude`, `docs/generated`, non-searchable kinds, email bodies | Persisted Orama index (JSON) at `.callback-box/search-index.json` + manifest for incremental diff | Ranked/boosted full-text (`contains`×3, `title`×2), tokenized, not substring/regex; excerpt display uses substring matching | `cb search`, `cb search --json`, agent shell calls | Lazy, at-query-time re-diff of every file's mtime/size/hash under a file lock; no write hooks | Post-search `pathPrefix` filter caps at 1000 fetched hits; single-box only (no cross-box search found); no archived/trash cards; no binary/attachment content except OCR'd image text folded in; no embeddings |
| **CLI** `cli/commands/search.ts`, `contains.ts` | same as above | n/a (client of core engine) | same | terminal / scripts | triggers refresh each invocation | none beyond engine's |
| **Agent guide** `agent-guide/search.ts`, `commands.ts` | n/a (docs only) | n/a | describes ranked, non-exact semantics to the agent | injected into agent system prompt | static text | agent can still bypass via raw Grep/Read tools — nothing enforces `cb search` usage |
| **tRPC / frontend** | — | — | — | **no dedicated search endpoint or UI page exists**; only a generic `commands.executeSync` bridge that's unused by the frontend today | — | biggest gap: box's own web UI has no search feature at all |
| **Chat history filter** `history-filter.ts`, `HistoryBrowser.tsx` | chat session history metadata (connector/workflow/touchpoint/feedback/session) | none (URL/query-param state only) | exact-match structured filters, not text search | History page | live, client-side | not text search; chat transcripts have zero relationship to the Orama index |
| **Vector/embedding search** | — | — | — | — | — | does not exist anywhere in the repo |
