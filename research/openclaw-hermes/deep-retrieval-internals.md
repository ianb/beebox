# Deep Retrieval Internals: OpenClaw memory-core vs Hermes session_search + memory providers

Implementation-level dive into the retrieval/search internals of two agent frameworks. Clones examined:

- **OpenClaw**: `scratchpad/openclaw/` — focus on `extensions/memory-core/` (plus the shared `packages/memory-host-sdk/` it delegates to)
- **Hermes**: `scratchpad/hermes-agent/` — focus on `hermes_state.py`, `tools/session_search_tool.py`, `agent/memory_provider.py`, `agent/memory_manager.py`, `plugins/memory/*`

All file:line citations are relative to each repo's root.

---

# Part 1 — OpenClaw memory search (`extensions/memory-core/`)

## 1.1 What gets indexed

Two corpora exist, distinguished by a per-chunk `source` column: `MemorySource = "memory" | "sessions"` (`src/plugin-sdk/memory-core-host-engine-qmd.ts:41`, re-exported from `packages/memory-host-sdk/src/engine-storage.ts`).

**Memory files (default-on).** File discovery is `listMemoryFiles` (`packages/memory-host-sdk/src/host/internal.ts:150-228`):

- the canonical root `MEMORY.md` (`internal.ts:174-177`),
- a recursive walk of `memory/` for `.md` files (plus multimodal files when enabled) via `collectMemoryFilesFromDir` (`internal.ts:133-148, 178-183`),
- any configured `extraPaths` (`internal.ts:185-210`),
- de-duped by real path (`internal.ts:211-227`).

The watcher watches exactly those roots (`extensions/memory-core/src/memory/manager-sync-ops.ts:849-850`):

```ts
const fileWatchPaths = new Set<string>([path.join(this.workspaceDir, "MEMORY.md")]);
const dirWatchPaths = new Set<string>([path.join(this.workspaceDir, "memory")]);
```

**Session transcripts (opt-in, off by default).** `DEFAULT_SOURCES = ["memory"]` (`src/agents/memory-search.ts:132`); `"sessions"` is only added when `sessionMemoryEnabled` is true, which resolves from `overrides?.experimental?.sessionMemory ?? defaults?.experimental?.sessionMemory ?? false` (`src/agents/memory-search.ts:164-182, 216-217`). So transcripts are **not** searchable unless `agents.defaults.memorySearch.experimental.sessionMemory` (or a per-agent override) is enabled.

When enabled, `buildSessionEntry` (`packages/memory-host-sdk/src/host/session-files.ts:748+`) parses each JSONL transcript line-by-line and flattens it to plain text, keeping a `lineMap: number[]` so chunk `startLine`/`endLine` can be remapped to original JSONL line numbers (`session-files.ts:792-830`; `remapChunkLines` at `internal.ts:502+`, consumed at `extensions/memory-core/src/memory/manager-embedding-ops.ts:840-842`). Session entries then flow through the *same* chunk/embed/write pipeline as memory files, tagged `source: "sessions"`.

## 1.2 Chunking

One shared chunker: `chunkMarkdown(content, { tokens, overlap })` at `packages/memory-host-sdk/src/host/internal.ts:387-490`, called from `manager-embedding-ops.ts:836`.

- **Defaults**: `DEFAULT_CHUNK_TOKENS = 400`, `DEFAULT_CHUNK_OVERLAP = 80` (`src/agents/memory-search.ts:116-117`), configurable via `memorySearch.chunking.{tokens,overlap}` (`src/config/zod-schema.agent-runtime.ts:923-929`).
- **Char conversion**: `CHARS_PER_TOKEN_ESTIMATE = 4` (`src/utils/cjk-chars.ts:18`); `maxChars = max(32, tokens*4)` ≈ 1600 chars, `overlapChars = max(0, overlap*4)` ≈ 320 chars (`internal.ts:395-396`).
- **Boundaries**: a **line-based greedy packer** — not heading- or paragraph-aware. Lines accumulate until the next would exceed `maxChars`; on flush, a suffix of prior lines up to `overlapChars` is carried into the next chunk (`internal.ts:399-421` flush, `423-444` carryOverlap, `446-487` main loop). CJK-heavy lines are sub-line split using weighted char counts (CJK chars weigh 4×), avoiding UTF-16 surrogate-pair splits (`internal.ts:453-476, 463-469`).
- Each chunk records `startLine`/`endLine` (1-indexed), `text`, `hash: hashText(text)`, `embeddingInput` (`internal.ts:411-420`).
- Multimodal files skip chunking entirely — one synthetic chunk via `buildMultimodalChunkForIndexing` (`internal.ts:365-385`).
- Post-chunk, `enforceEmbeddingMaxInputTokens` can split oversized chunks for the embedding provider (`manager-embedding-ops.ts:838`); empty chunks are dropped (`manager-embedding-policy.ts:48-50`).

## 1.3 Embedding provider + FTS-only fallback

- **Default provider: OpenAI** — `DEFAULT_MEMORY_EMBEDDING_PROVIDER = "openai"` (`extensions/memory-core/src/memory/embeddings.ts:37`), used whenever `provider === "auto"` (`embeddings.ts:204, 244`). Adapters resolve through legacy memory-specific providers first, then the generic embedding-provider registry (`getAdapter`, `embeddings.ts:140-156`). A `"local"` id (llama.cpp/GGUF) throws an "install the plugin" error if unregistered (`embeddings.ts:38-49, 152-154`). A configured `fallback` provider id is tried when the primary fails (`createEmbeddingProvider`, `embeddings.ts:240-279`).
- **Requirement modes** — `resolveMemoryEmbeddingProviderRequirement()` (`manager.ts:152-173`): `provider === "none"` → `"fts-only"`; `"auto"`/local-transport → `"optional"`; explicit remote provider → `"required"`.
- **Degrade to FTS-only**: yes, for `"fts-only"` and `"optional"` modes. In `search()` (`manager.ts:707-733`):

  ```ts
  if (!this.provider) {
    this.assertRequiredProviderAvailable("search");   // throws only in "required" mode
    if (!this.fts.enabled || !this.fts.available) { return []; }
    const keywordResults = await this.searchKeywordWithFallback(...);
    ...
  }
  ```

  With `provider === "none"`, provider init is skipped outright and status reports `"No embedding provider available (FTS-only mode)"` (`manager.ts:469-481`). In `"required"` mode a missing provider throws instead of degrading (`manager.ts:545-547, 568-574`).
- **Indexing without a provider** still writes chunks into FTS with sentinel `model: "fts-only"` and no vectors (`manager-embedding-ops.ts:973-981`). A guard refuses to run a *sync* in fts-only fallback over an existing semantic index (`hasSemanticChunks` checks `WHERE model != 'fts-only'`, `manager-sync-ops.ts:528-533`; refusal at `manager-sync-ops.ts:2386-2407`).
- Status surface reports `searchMode: "fts-only" | "hybrid"` (`manager-status-state.ts:39-68`).

## 1.4 When indexing runs

All triggers funnel into `MemoryIndexManager.sync()`:

1. **File watcher** (memory source; on by default) — native recursive `fs.watch` on macOS/Windows, manual tree walk on Linux inotify, chokidar fallback (`manager-sync-ops.ts:838-931, 981-1121, 1126-1316, 1414-1451`). Change → `markDirty()` → debounced `sync({ reason: "watch" })`; `DEFAULT_WATCH_DEBOUNCE_MS = 1500` (`src/agents/memory-search.ts:118`).
2. **Live transcript updates** (sessions source) — `onSessionTranscriptUpdate` subscription → `scheduleSessionDirty()` with a 5000 ms debounce (`manager-sync-ops.ts:1453-1480`; `SESSION_DIRTY_DEBOUNCE_MS = 5000` at `manager-sync-ops.ts:158`).
3. **Interval sync** — `sync.intervalMinutes`, default 0 = disabled (`manager-sync-ops.ts:1912-1924`, comment at `:1041`).
4. **Session-start warm sync** — `warmSession()` gated by `sync.onSessionStart`, once per session key (`manager.ts:576-590`).
5. **On-search (lazy)** — opportunistic non-blocking `sync({ reason: "search" })` when dirty and `sync.onSearch` is set (`manager-async-state.ts:2-17`); plus a **blocking bootstrap**: if nothing is indexed yet, `search()` force-syncs before returning (`manager.ts:631-642`). The `memory_search` tool also retries once with `force: true` on zero results (`tools.ts:571-584`).
6. **Targeted/queued session syncs** — `enqueueMemoryTargetedSessionSync` batches specific dirty session files (`manager-sync-control.ts:119-174`; `manager-targeted-sync.ts:38-90`).
7. **Startup catch-up** — one-time mtime/size diff against indexed state on manager construction (`manager-sync-ops.ts:1490-1496`; `manager-session-sync-state.ts:11-34`).
8. **Readonly-DB recovery** — reopen sqlite + retry once on readonly errors (`manager-sync-control.ts:86-117`).

Full rebuilds serialize across processes via a sidecar `*.reindex-lock.sqlite` using `BEGIN EXCLUSIVE` (`manager-reindex-lock.ts:1-85`).

## 1.5 FTS5 query construction

**`buildFtsQuery`** (`extensions/memory-core/src/memory/hybrid.ts:32-39`) — the token-AND builder:

```ts
export function buildFtsQuery(raw: string): string | null {
  const tokens = normalizeStringEntries(raw.match(/[\p{L}\p{N}_]+/gu) ?? []);
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}
```

Each token is double-quoted (defusing FTS5 operators) and AND-joined. `planKeywordSearch` (`manager-search.ts:106-137`) wraps this and, for the `trigram` tokenizer, diverts sub-3-char CJK tokens (`SHORT_CJK_TRIGRAM_RE`, `manager-search.ts:16`) into `LIKE '%term%'` substring terms since trigram FTS needs ≥3-char needles.

Executed query (`searchKeyword`, `manager-search.ts:324-436`, SQL at `:369-374`):

```sql
SELECT id, path, source, start_line, end_line, text, bm25(${ftsTable}) AS rank
  FROM ${ftsTable}
 WHERE ${ftsTable} MATCH ? [AND text LIKE ? ESCAPE '\'] [AND EXISTS (... memory_index_chunks ...)] [source filter]
 ORDER BY rank ASC LIMIT ?
```

If `MATCH` throws, it falls back to a pure `LIKE` scan with `rank = 0` (`manager-search.ts:383-402`). Default FTS tokenizer is `unicode61`, with opt-in `tokenize='trigram case_sensitive 0'` (`packages/memory-host-sdk/src/host/memory-schema.ts:396-399`; config at `src/config/zod-schema.agent-runtime.ts:907-912`).

There is **no stemming or stopword removal**. `tokenize.ts` in memory-core is unrelated to FTS — it feeds MMR's Jaccard similarity only (ASCII `[a-z0-9_]+` tokens plus CJK unigrams and bigrams, `tokenize.ts:19, 32, 34-51`).

## 1.6 Hybrid merge, decay, MMR

`mergeHybridResults()` (`hybrid.ts:52-156`): merges vector and keyword hits by chunk id, then scores with a **weighted linear sum** (not RRF):

```ts
const score = params.vectorWeight * entry.vectorScore + params.textWeight * entry.textScore;   // hybrid.ts:125
```

- **Default weights**: `DEFAULT_HYBRID_VECTOR_WEIGHT = 0.7`, `DEFAULT_HYBRID_TEXT_WEIGHT = 0.3`, `DEFAULT_HYBRID_CANDIDATE_MULTIPLIER = 4` (`src/agents/memory-search.ts:124-126`); re-normalized to sum to 1 (`memory-search.ts:363-368`). Candidate pool per channel: `min(200, maxResults * candidateMultiplier)` (`manager.ts:701-704`).
- **BM25 → [0,1]**: `bm25RankToScore` (`hybrid.ts:41-50`): negative rank → `r/(1+r)` with `r = -rank`; non-negative → `1/(1+rank)`.
- **Temporal decay** (opt-in, `enabled: false`, `halfLifeDays: 30`, `temporal-decay.ts:10-13`): exponential `exp(-ln(2)/halfLife * ageDays)` multiplier on the merged score (`temporal-decay.ts:18-43`), applied pre-sort (`hybrid.ts:140-146`) and also on the pure FTS path (`manager.ts:726-731`). **Evergreen exemption**: `MEMORY.md` and non-dated `memory/` files never decay; dated `memory/YYYY-MM-DD.md` files decay from the filename date; everything else (incl. session hits) from file mtime (`temporal-decay.ts:45-115`).
- **MMR** (opt-in, `DEFAULT_MMR_CONFIG = { enabled: false, lambda: 0.7 }`, `mmr.ts:26-29`): classic `λ·relevance − (1−λ)·maxSimToSelected` (`mmr.ts:66-68`, Carbonell & Goldstein), min-max-normalized relevance, Jaccard token similarity; applied post-sort (`hybrid.ts:150-153`).

## 1.7 Result shape

Manager-level `MemorySearchResult` (`packages/memory-host-sdk/src/engine-storage.ts`, re-export at `src/plugin-sdk/memory-core-host-engine-qmd.ts:43-54`):

```ts
{ path, startLine, endLine, score, vectorScore?, textScore?, snippet, source, citation? }
```

- Snippets truncated to `SNIPPET_MAX_CHARS = 700` UTF-16-safely (`manager.ts:72`; `manager-search.ts:224, 296, 432`).
- **Citations**: `decorateCitations` appends `\n\nSource: path#Lstart[-Lend]` and sets `citation` (`tools.citations.ts:18-38`); mode `"on" | "off" | "auto"` defaults to `"auto"` which cites only in direct 1:1 chats (`tools.citations.ts:10-16, 66-92`).
- **Tool payload** (`memory_search` in `tools.ts:385-704`): each result gains `corpus: MemorySource` (`tools.ts:42-44, 607-610`); final JSON is `{ results, provider, model, fallback, citations, mode, debug }` (`tools.ts:677-685`) with rich timing/backend debug. Unavailability returns `{ results: [], disabled, unavailable, error, warning, action, debug }` with actionable guidance (`tools.shared.ts:112-152`). A `corpus=memory|sessions` param restricts the search (`tools.ts:407-412, 592-596`). `memory_get` (`tools.ts:706-790`) returns whole-file reads, not search hits.

## 1.8 Staleness / sync bookkeeping

- Table `memory_index_sources(path, source, hash, mtime, size)` (`packages/memory-host-sdk/src/host/memory-schema.ts:300-307`); chunks in `memory_index_chunks` carry the `source` tag (`memory-schema.ts:308-319`).
- **Memory files: content-hash staleness** — freshly computed `hashText(content)` (`internal.ts:306`) vs stored hash (`manager-source-state.ts:22-53`, used from `syncMemoryFiles`, `manager-sync-ops.ts:1964+`).
- **Session files: mtime+size staleness** (cheap for startup catch-up) — dirty if new, or `size !== indexedSize || mtimeMs > indexedMtimeMs` (`manager-session-sync-state.ts:11-34`).
- **Index-identity pause**: a composite identity (provider id/model, chunk tokens/overlap, sources, scope hash, vector readiness, FTS tokenizer) is compared against persisted meta (`manager-sync-ops.ts:535-621`; `manager-reindex-state.ts`); on mismatch, `search()` returns `[]` and the tool surfaces a "paused index" warning (`manager.ts:680-685`; `tools.ts:173-188`).

**QMD is an alternative backend, not a cache.** `memory.backend` resolves to `"builtin"` (the sqlite FTS5+vec pipeline above) or `"qmd"`, which shells out to an external `qmd` CLI/process with its own XDG-dir state (`packages/memory-host-sdk/src/host/backend-config.ts:35-44, 469`; `qmd-manager.ts:495-554`). `getMemorySearchManager()` wraps QMD in a `FallbackMemoryManager` that automatically falls back to the builtin manager if the binary is missing or a live search throws, with a 60 s failure cooldown (`search-manager.ts:185-414, 550-745, 566-601`; `QMD_MANAGER_OPEN_FAILURE_COOLDOWN_MS = 60_000` at `:77`). `qmd-runtime-cache.ts` only caches in-process collection validation/probe results; `qmd-compat.ts` is an 8-line re-export shim. The backends are mutually exclusive per agent.

## 1.9 Session transcript search + corpus maintenance

Confirmed: transcripts are a distinct corpus (`source: "sessions"`), off by default (§1.1), kept in sync three ways — live `onSessionTranscriptUpdate` events (5 s debounce), startup mtime/size catch-up, and targeted out-of-band syncs (§1.4 items 2/6/7).

Two access-control and lifecycle layers sit on top:

- **Visibility filtering at search time**: `filterMemorySearchHitsBySessionVisibility()` (`extensions/memory-core/src/session-search-visibility.ts:47-176`, called from `tools.ts:585-591`) resolves each sessions-source hit back to its session key(s) and drops hits the caller's session-history ACL (`createSessionVisibilityGuard`) doesn't permit — indexing does not imply visibility.
- **Short-term promotion ("dreaming")**: `short-term-promotion.ts` (2932 lines) records which recall hits were actually surfaced (`recordShortTermRecalls`, wired at `tools.ts:271-278`) and promotes frequently-recalled snippets (`DEFAULT_PROMOTION_MIN_SCORE = 0.75`, `MIN_RECALL_COUNT = 3`, `MIN_UNIQUE_QUERIES = 2`, `short-term-promotion.ts:47-49`) into dated `memory/YYYY-MM-DD.md` files — which the normal `"memory"` watcher then indexes. So session knowledge reaches the default corpus by distillation, not by raw-JSONL indexing.

---

# Part 2 — Hermes

## 2.1 session_search: FTS5 over state.db

### Schema (`hermes_state.py`)

Two FTS5 virtual tables over the `messages` base table, populated purely by insert/delete/update triggers; `rowid` is bound to `messages.id`, and the indexed text is `content || ' ' || tool_name || ' ' || tool_calls` — so tool names and tool-call JSON are searchable too.

Main table (`hermes_state.py:802-825`):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content);
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (
        new.id,
        COALESCE(new.content, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.tool_calls, '')
    );
END;
-- matching _delete / _update triggers
```

Trigram variant for CJK (`hermes_state.py:827-855`, comment: default `unicode61` splits CJK per character):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram USING fts5(content, tokenize='trigram');
```

Availability is probed defensively at open: `_sqlite_supports_fts5` creates/drops a scratch table (`hermes_state.py:1029-1038`); `_is_trigram_unavailable_error` / `_is_fts5_unavailable_error` (`hermes_state.py:985-999`) let trigram be disabled independently of base FTS5 (`self._trigram_available`, e.g. `hermes_state.py:1550-1558`). `optimize_fts()` merges b-tree segments for both tables (`hermes_state.py:5587, 5597+`).

### Query shapes

One agent-facing tool, `session_search` (`tools/session_search_tool.py`), with four shapes inferred from which args are set (no `mode` param); schema at `SESSION_SEARCH_SCHEMA`, `tools/session_search_tool.py:752-897` (params: `query`, `limit` default 3 clamped [1,10], `sort`, `session_id`, `around_message_id`, `window` default 5, `role_filter`, `profile`):

- **Discovery** (`:499-616`): `query` set → `db.search_messages()` (FTS5), lineage-dedupe, then per hit `db.get_anchored_view(sid, msg_id, window=5, bookend=3)` (`:578`) — the ±5-message window plus session bookends.
- **Scroll** (`_scroll`, `:303-424`): `session_id` + `around_message_id` (+ `window` clamped [1,20] at `:331`) → `db.get_messages_around()` — pure pagination, re-anchor on first/last returned id to page.
- **Read** (`_read_session`, `:211-257`): `session_id` alone → full session dump, truncated to `head=20` + `tail=10` when large, with a pointer to scroll the middle.
- **Browse** (`_list_recent_sessions`, `:260-300`): no args → `db.list_sessions_rich()` chronological listing.

DB primitives (`hermes_state.py`):

- `search_messages(query, source_filter, exclude_sources, role_filter, limit=20, offset=0, sort, include_inactive)` (`:4185-4195`) — FTS5 (+trigram/LIKE CJK fallback), snippets via `snippet(messages_fts, 0, '>>>', '<<<', '...', 40)` (`:4285`), plus ±1-message context per match (`:4440-4478`).
- `get_messages_around(session_id, around_message_id, window=5)` (`:3470-3546`) — returns `window`, `messages_before`, `messages_after`; docstring (`:3486-3489`) says it serves both discovery (anchored on the FTS5 hit) and scroll (anchored on any id).
- `get_anchored_view(session_id, around_message_id, window=5, bookend=3, keep_roles=("user","assistant"))` (`:3548-3654+`) — adds `bookend_start` (first N user/assistant messages, non-overlapping) and `bookend_end` (last N), so "an FTS5 hit anywhere in a long session yield[s] the goal (opening) and the resolution (closing) on a single call" (`:3571-3573`).

### Ranking

Bare FTS5 `rank` — implicit BM25 with SQLite default weights; no `bm25(tbl, w...)` call anywhere. `order_by_sql` is `"ORDER BY rank"` (default, "FTS5 BM25 relevance only. Time-neutral.", `hermes_state.py:4209, 4251`), or `timestamp DESC/ASC, rank` for `sort="newest"/"oldest"` (`:4247-4249`); same clause reused on the trigram path (`:4352-4368`). The short/mixed-CJK LIKE fallback has no ranking at all — recency only, ignores `sort` (`:4213-4215, 4419`).

### Cron-session demotion

Tool-layer, not DB-layer (`tools/session_search_tool.py`):

- `_DEMOTED_SESSION_SOURCES = ("cron",)` (`:50`); rationale comment (`:42-50`): cron runs accumulate repetitive vocabulary, dominate top-N under bare BM25, and starve interactive sessions — "recall blindness" (#19434).
- `_DISCOVER_SCAN_LIMIT = 300` (`:56`) widens the raw scan so demoted rows don't crowd interactive hits out of the candidate pool pre-demotion.
- `_order_for_recall` (`:106-120`) — stable sort pushing cron-source rows to the back, preserving BM25 order within each class:

  ```python
  return sorted(raw_results,
      key=lambda r: 1 if (r.get("source") or "") in _DEMOTED_SESSION_SOURCES else 0)
  ```

  Called in `_discover` right after `search_messages` and before lineage-dedup (`:531`).
- Distinct from `_HIDDEN_SESSION_SOURCES = ("subagent", "tool")` (`:40`), which are fully excluded via `exclude_sources` (`:516`); cron is demoted, not excluded — "reachable when it's the only match" (`:47-49`).
- Sessions acquire `source="cron"` at creation (`hermes_state.py:1635`; `cron/scheduler.py:567, 688, 781`).

### LLM summarization over results

None — deliberately. Module docstring (`tools/session_search_tool.py:21-23`) and the tool description shown to the model (`:756-757`): "No LLM calls — every shape returns actual messages from the DB." A history note (`:25-29`) records that an earlier PR (#20238) seeded a fast/summary dual mode; the current module removed the summary LLM path entirely. (The `compacted=1` "summarized" rows at `hermes_state.py:3411, 4219` belong to context compaction, not search.)

## 2.2 Memory-provider interface

### Lifecycle/hook interface

`MemoryProvider(ABC)` at `agent/memory_provider.py:43`; lifecycle summary in the module docstring (`:1-32`). Abstract: `name` (`:46-49`), `is_available` (`:53-59`), `initialize(session_id, **kwargs)` (`:61-83`), `get_tool_schemas` (`:134-142`). Defaulted/optional:

| Hook | Signature | Lines |
|---|---|---|
| `system_prompt_block` | `() -> str`, default `""` | 85-92 |
| `prefetch` | `(query, *, session_id="") -> str` | 94-106 |
| `queue_prefetch` | `(query, *, session_id="") -> None` | 108-114 |
| `sync_turn` | `(user_content, assistant_content, *, session_id="", messages=None)` | 116-132 |
| `handle_tool_call` | `(tool_name, args, **kwargs) -> str` | 144-150 |
| `shutdown` | `() -> None` | 152-153 |
| `on_turn_start` | `(turn_number, message, **kwargs)` | 157-164 |
| `on_session_end` | `(messages)` | 166-174 |
| `on_session_switch` | `(new_session_id, *, parent_session_id="", reset=False, rewound=False, **kwargs)` | 176-218 |
| `on_pre_compress` | `(messages) -> str` (extract before context compression) | 220-230 |
| `on_delegation` | `(task, result, *, child_session_id="", **kwargs)` | 232-243 |
| `get_config_schema` / `save_config` | config UI plumbing | 245-278 |
| `on_memory_write` | `(action, target, content, metadata=None)` — mirror built-in memory writes | 280-297 |
| `backup_paths` | `() -> list[str]` for `hermes backup` | 299-315 |

Orchestration: `MemoryManager` (`agent/memory_manager.py:353`) — enforces **one external provider at a time** (`add_provider`, `:374-440`), reserves core tool names against shadowing (`:407-424`), and exposes `build_system_prompt` / `prefetch_all` / `sync_all` / `get_all_tool_schemas` / `notify_memory_tool_write` (mirrors builtin writes to providers' `on_memory_write`, `:933+`, skipping the write's source at `:891`). Tools are merged into the agent surface by `inject_memory_provider_tools` (`:100-120+`) with schema normalization (`:49-79`) and a toolset gate (`memory_provider_tools_enabled`, `:82-97`).

### Honcho — dialectic user modeling

`plugins/memory/honcho/__init__.py` (`HonchoMemoryProvider` at `:191`) + `plugins/memory/honcho/session.py` (`HonchoSessionManager`).

"Dialectic" is real server-side reasoning against Honcho's user model: `dialectic_query()` (`session.py:601-664`) — "Runs an LLM on Honcho's backend against the target peer's full representation" — via the SDK peer object's `.chat()`:

```python
result = ai_peer_obj.chat(query, reasoning_level=level) or ""                    # session.py:646
result = ai_peer_obj.chat(query, target=target_peer_id, reasoning_level=level)  # session.py:648-652
result = target_peer.chat(query, reasoning_level=level) or ""                   # session.py:656
```

with output capped at `_dialectic_max_chars` (`:659`) and input truncated to `_dialectic_max_input_chars` (`:633-634`). Non-LLM context retrieval uses `.context(...)` instead (`session.py:729, 968, 1014`).

Provider-side, `_run_dialectic_depth` (`__init__.py:1043-1083`) runs up to `dialecticDepth` (1-3) sequential `.chat()` passes with per-pass prompts (cold-start / gap-synthesis / reconciliation, `_build_dialectic_prompt` `:984-1021`), bailing early on sufficient signal (`_signal_sufficient` `:1023-1041`). `reasoning_level ∈ minimal|low|medium|high|max`, auto-escalated by prompt length (`:946-964`).

**Recall modes** (`cfg.recall_mode`, `:321`): `"context"` (auto-injection only, `get_tool_schemas` returns `[]`, `:1306-1307`), `"tools"`, `"hybrid"`. **Five tools** (`ALL_TOOL_SCHEMAS` at `:184`; schemas `:36-181`): `honcho_profile`, `honcho_search` (raw semantic excerpts, no LLM — "cheaper and faster than honcho_reasoning"), `honcho_reasoning` (the dialectic call), `honcho_context` (raw snapshot: summary + representation + card + recent messages), `honcho_conclude` (persistent conclusion facts → `create_conclusion`/`delete_conclusion`, `session.py:1151, 1200`).

Turn writes: `sync_turn` (`:1214-1248`) adds user/assistant messages with chunking under `message_max_chars` (default 25000; `_chunk_message` `:1112-1155`). Cron guard: `agent_context in {"cron","flush"}` fully disables the provider (`:301-308`, "Port #4053") — the memory-side analogue of session_search's cron demotion.

### Mem0

`plugins/memory/mem0/__init__.py` (`Mem0MemoryProvider` at `:206`; backends in `_backend.py`).

- **Writes**: `sync_turn` (`:464-497`) sends the `{user, assistant}` turn as `backend.add(messages, user_id=…, agent_id=…, infer=True, metadata=…)` — `infer=True` means Mem0's server does LLM fact extraction. The explicit `mem0_add` tool instead uses `infer=False` — verbatim fact, no extraction (`:565-580`; `ADD_SCHEMA` `:150-166`).
- **Reads**: `on_turn_start` (`:399-400`) fires a background `backend.search(query, filters=…, top_k=10, rerank=True)` (`:428-430`); `prefetch` consumes it with a 1.5 s hot-path wait (`_PREFETCH_WAIT_SECS`, `:47`). Reads filter on `{"user_id": …}` only (`:367-373`) — deliberately cross-agent/cross-channel; writes add `metadata={"channel": …}` (`:375-378`) for dashboard filtering without narrowing recall.
- **Circuit breaker**: 5 consecutive failures → 120 s pause (`:43-46, 298-339`).
- **Five tools** (`:110-199, 499-500`): `mem0_list`, `mem0_search`, `mem0_add`, `mem0_update`, `mem0_delete`.
- Modes: `"platform"` (cloud `MemoryClient`) vs `"oss"` (self-hosted vector store) (`_backend.py:52-56`; `_load_config` `:72-103`). User-id precedence: operator config > gateway-native id (Telegram/Discord) > `"hermes-user"` (`:345-359`).

### Supermemory (brief)

`plugins/memory/supermemory/__init__.py`: Supermemory API (`https://api.supermemory.ai/v4/conversations`, `:34`) via `documents.add` (`:317`) and `search.memories` (`:328`), `search_mode ∈ hybrid|memories|documents` (`:29-30, 320-328`). Config (`:57-71`): `container_tag`, `auto_recall`/`auto_capture`, `profile_frequency` (default every 50 turns), and a configurable `entity_context` prompt steering Supermemory's own extraction (`:46-54` — "lasting personal facts… When in doubt, store less"). Four tools: `supermemory_store`, `supermemory_search`, `supermemory_forget`, `supermemory_profile` (`:463-501+`; `get_tool_schemas` `:872`). Also does session-end conversation ingest and trivial-prompt filtering (`_TRIVIAL_RE`, `:36-39`).

### Coexistence with built-in MEMORY.md/USER.md

They run **alongside**, as two separate subsystems wired independently in `agent/agent_init.py`:

1. Built-in file memory is initialized unconditionally (subject only to `memory_enabled`/`user_profile_enabled`): `agent._memory_store = MemoryStore(...)` from `tools/memory_tool.py` (`agent_init.py:1232-1253`). It is *not* a `MemoryProvider`.
2. The external provider is registered right after — comment: "Memory provider plugin (external — one at a time, alongside built-in)" (`agent_init.py:1257`, wiring `:1259-1323`).
3. `MemoryManager` comments reference a conceptual `"builtin"` provider slot (`memory_manager.py:356, 377, 386, 891`) but no code ever constructs one — in practice `_providers` holds at most the one external plugin, while file memory operates outside the manager.
4. One-way coupling: built-in memory-tool writes are mirrored to the active provider via `notify_memory_tool_write` → `on_memory_write` — e.g. Honcho turns a built-in `add`/target=`"user"` write into a Honcho conclusion (`honcho/__init__.py:1250-1281`).
5. One-time seeding: `migrate_memory_files` imports `MEMORY.md`/`USER.md`/`SOUL.md` into a brand-new Honcho session (only when it has no prior messages and strategy isn't `"per-session"`, `honcho/__init__.py:455-472`).

The built-in files stay authoritative — compaction notes state "Your persistent memory (MEMORY.md, USER.md)… remains fully authoritative regardless of compaction" (`agent/context_compressor.py:65, 174, 2880`).

### Tool-name collision policy

`add_provider` drops (with a warning) any provider tool whose name matches a Hermes core tool (`_HERMES_CORE_TOOLS`), and any tool name already claimed by the active provider (`agent/memory_manager.py:400-434`).

---

# Cross-cutting observations

- **Two philosophies of transcript search.** Hermes indexes every message into FTS5 at write time via triggers — zero sync machinery, always current, and its retrieval sophistication is in *presentation* (anchored windows + bookends, cron demotion). OpenClaw treats transcripts as files to be discovered, chunked, embedded, and synced — far more machinery (watchers, debounces, catch-up, identity pause, cross-process locks), off by default, but yielding semantic search and a unified corpus with memory files.
- **Both hit the same BM25 pollution problem, solved differently.** Hermes demotes cron-source sessions post-hoc in the tool layer; OpenClaw's analogues are opt-in temporal decay (with an evergreen exemption for curated memory) and opt-in MMR diversity.
- **Both keep curated markdown authoritative.** OpenClaw promotes frequently-recalled session snippets *into* dated memory files rather than trusting raw transcripts; Hermes keeps MEMORY.md/USER.md "fully authoritative" and treats external providers (Honcho/Mem0/Supermemory) as a parallel channel seeded from and mirrored by the files.
- **Graceful degradation is explicit in both**: OpenClaw's `fts-only` mode when no embedding key exists (with a guard against clobbering an existing vector index); Hermes's FTS5→trigram→LIKE ladder for CJK/short queries and Mem0's circuit breaker.
