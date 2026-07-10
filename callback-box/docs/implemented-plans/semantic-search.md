# Semantic search (box-search phase 3): hybrid BM25 + vector retrieval

**Status:** implemented 2026-07 — hybrid BM25 + vector search shipped;
see `docs/plans/README.md` for the plan-doc lifecycle.

Add semantic retrieval to `cb search`: embed each searchable card's
`contains` sentence as a 512-dim vector in the existing Orama index, and
switch the query path to Orama's native `mode: "hybrid"` (BM25 + vector
fused) whenever an embedding key is configured — degrading automatically to
today's text-only search when it isn't. This is the phase deliberately
carved out of the shipped box-search plan
(`docs/implemented-plans/box-search.md` § NOT in scope), which pre-committed
the shape: `contains` is the embedding unit, `SEARCH_SCHEMA_VERSION` bump
triggers the rebuild, vectors are computed by a service-pattern provider
(no Orama plugins), and text-only is the no-key fallback.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` #3 (validate at boundaries) — the
  embeddings API response and the secret file are boundary data; both get
  validated once, loudly.
- `docs/engineering-principles.md` #4 (resilient AND never silent) — every
  degrade-to-text-only path carries a visible warning; no silent fallback.
- `docs/engineering-principles.md` #6 (right-sized defensiveness) — the
  embedder can genuinely fail (network, quota, bad key), so the query and
  refresh paths handle it; interior code (vector length, doc ids) asserts
  instead.
- `docs/engineering-principles.md` #8 (one way to do each thing) — key
  resolution copies the `mistral-key.ts` shape rather than inventing a
  second convention; embedding state lives in the existing manifest rather
  than a new sidecar.
- `docs/engineering-principles.md` #10 (testability is architectural) — the
  embedder is a service with a deterministic fake, so hybrid ranking,
  degradation, and persistence round-trips are all doctestable offline.
- `src/services/CLAUDE.md`: *"if a library or function touches external
  things — network… — wrap it in a service"*; interface + real + fake in
  one file, named-params fakes, `describe()`.
- **Never-implicit-key (bill safety)**: the boxholder's standing rule that
  paid APIs are only ever called with a key the box deliberately
  configured — never an ambient `OPENAI_API_KEY` an SDK would auto-grab.
  `src/core/mistral-key.ts` is the precedent this plan copies.
- `callback-box/CLAUDE.md` § Behavioral Notes: *"Read before writing"* —
  every claim below about Orama 3.1.18 behavior was verified in the
  installed `node_modules` source, not its docs.
- Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — degraded
  modes warn once per invocation, in the existing `warnings` envelope.

## What already exists

- **The full-text index and lazy refresh** — `src/core/search/` (shipped
  June 2026). Reused wholesale; this plan only touches `search-store.ts`
  (schema), `refresh.ts`/`refresh-file.ts` (embedding pass), `query.ts`
  (hybrid branch), `manifest.ts` (one new entry field), plus the CLI
  command. Extraction, walking, locking, crash-safety ordering are
  untouched.
- **`SEARCH_SCHEMA_VERSION = 3`** — `search-store.ts:26`, created
  specifically so this plan's schema change forces a rebuild:
  `manifest.ts:55`: *"if (parsed.schemaVersion !== SEARCH_SCHEMA_VERSION)
  return emptyManifest();"*. Reused: bump to 4.
- **`effectiveContains(kind, fields)`** — `extract.ts:62-68`, the single
  source of the `contains` column (explicit field or per-kind
  `description` fallback). Reused as the embedding-text source — the
  vector always embeds exactly what the `contains` column holds.
- **The contains sidecar** — `contains-state.ts` records
  `containsText` per card (the *effective* contains since sidecar v2,
  `contains-state.ts:33-35`), maintained by the same refresh under the
  same lock, completed for manifest-unchanged cards by
  `healContainsState` (`refresh.ts:141,167-184`). Reused read-only: the
  embedding pass itself never re-reads card files — the one file re-read
  in the vicinity is heal's own, which predates this plan.
- **Key resolution precedent** — `src/core/mistral-key.ts:1-25`: secret
  file `config/connectors/mistral.secret.json` (`{apiKey}`) first, env var
  `CALLBACK_MISTRAL_API_KEY` fallback, `null` when neither. Copied for
  OpenAI. Note `THINKING_OPENAI_API_KEY`
  (`src/core/transcription/index.ts:260`) is a different, env-only
  convention scoped to transcription/TTS; this plan deliberately does NOT
  fall back to it — a box that configured a key for voice notes must not
  silently start paying for embeddings (never-implicit-key).
- **Service pattern** — `src/services/openai-audio.ts` is the closest
  analogue (OpenAI REST via `ky`, interface/real/fake in one file); copied
  structurally. `src/services/index.ts` `Services` container gains an
  optional `embeddings` entry.
- **Orama 3.1.18** (installed; `package.json` currently allows
  `^3.1.18` — this plan pins both `@orama/*` packages to the exact
  version, since the verified-in-source behaviors below are load-bearing
  and a lockfile regeneration must not drift them) already supports
  everything needed —
  `node_modules/@orama/orama/dist/esm/types.d.ts:55`:
  `export type Vector = \`vector[${number}]\`;`; hybrid mode in
  `methods/search-hybrid.js`. No dependency change.
- **`getByID`** — `@orama/orama` exports it
  (`dist/esm/index.d.ts:2`), which the embedding pass uses to fetch a
  just-inserted doc for vector re-insert.
- **Backfill job creator** — `createContainsBackfillJob`
  (`src/cli/commands/wakeup-steps.ts:375-402`) drains missing-`contains`
  cards 25 at a time from wakeup. Reused *indirectly*: as agents backfill
  `contains`, the changed cards re-embed automatically at the next
  refresh. No embedding-specific job creator is built (see NOT in scope).

## Prior art (external)

Searched July 2026:

- **OpenAI `dimensions` param / Matryoshka** — text-embedding-3 models are
  Matryoshka-trained; the API's `dimensions` param truncates 1536 → 512
  with modest quality loss
  (<https://openai.com/index/new-embedding-models-and-api-updates/>).
  Pricing $0.02/1M tokens; limits: ≤2,048 inputs per call, ≤8,192 tokens
  per input, ≤300k tokens total per request
  (<https://community.openai.com/t/max-total-embeddings-tokens-per-request/1254699>).
  No newer/cheaper OpenAI embedding model exists as of mid-2026.
- **Provider comparison** — Mistral's `mistral-embed` ($0.10/1M) has no
  documented dimension-truncation; `codestral-embed` supports truncation
  but is code-tuned and $0.15/1M
  (<https://mistral.ai/news/codestral-embed/>). Voyage 4 and Gemini
  embeddings support MRL but run $0.15-0.20/1M with no existing key.
  The shipped plan's "per-box Mistral keys make Mistral the likely
  candidate" note does not survive the lineup: OpenAI text-embedding-3-small
  is 5-9× cheaper and the only natural fit for `vector[512]`.
- **Orama hybrid/vector issues** (github.com/oramasearch/orama) — all
  relevant issues closed as of July 2026. The one that shapes this plan:
  **#834**, embeddings silently not persisted to the serialized index
  (vector search finds nothing after reload). Historical and plugin-related,
  but exactly our costliest silent failure — so a persist→restore→hybrid
  doctest pins the round-trip at our pinned version rather than trusting
  the closed status. Also #730 (hybrid + `where` + pagination miscounts,
  fixed pre-3.1.18) and #619/621 (`hybridWeights` added).
- **Verified in installed source** (`node_modules/@orama/orama@3.1.18`,
  read directly — this is load-bearing, recorded so implementation doesn't
  rediscover it):
  - `mode: "hybrid"` requires BOTH `term` and
    `vector: {value, property}` at runtime. Omitting `vector` is a raw
    `TypeError` (`methods/search-vector.js:9-32` dereferences
    `vector.property` unconditionally), NOT a graceful text-only fallback.
    **Our code must branch fulltext-vs-hybrid itself.**
  - Docs inserted **without** the vector field are fine: insert skips
    `undefined` fields (`components/defaults.js:19-24`), vector search
    skips docs absent from the vector map (`trees/vector.js:52-73`).
    Passing an explicit `null` instead of omitting the key throws a raw
    `TypeError` — the SearchDoc type makes the field optional, never null.
  - Fusion: both halves run independently, text scores are min-max
    normalized, combined as `text*w_t + vector*w_v` with default weights
    0.5/0.5 (`search-hybrid.js:107-116`); a text-only doc still scores.
    `boost`/`properties`/`tolerance` apply to the full-text half only;
    `where` filters apply to both halves.
  - `similarity` (vector cutoff) defaults to **0.8**
    (`trees/vector.js:1`) — far too strict for OpenAI embeddings, whose
    related-text cosine similarities commonly run 0.2-0.5. We set our own
    constant (start ~0.35) and tune while dogfooding; leaving the default
    would make the vector half silently contribute nothing.
  - JSON persistence round-trips vectors correctly (`VectorIndex.toJSON`
    does `Array.from(Float32Array)` before stringify,
    `trees/vector.js:25-34`) — but verbosely, and **twice**: the vector
    persists in both the documents store (the doc as inserted) and the
    vector index. An empirical check (insert N docs with a 512-dim
    vector, `JSON.stringify(save(db))`, run during the cross-model plan
    review) measured **~20 KB per embedded doc**, so ~2,000 embedded
    cards add **~40 MB** to `search-index.json`. Restore latency is
    measured against the large box copy before merge; mitigation levers
    recorded in NOT in scope.
- **Embedding cache keyed by content hash** is the standard pattern
  (<https://zilliz.com/ai-faq/what-caching-strategies-work-best-for-embedding-generation>);
  this plan gets the same effect from a manifest hash field without a
  second cache file (see Direction).

## Tracks / scope

One track — the work is a single vertical slice through the existing
search module. Chunks are ordered under Implementation order.

### Track 1 — embeddings in the index, hybrid at query time

- **What**: an `EmbeddingsService` (OpenAI real + deterministic fake); a
  `vector[512]` `embedding` field on the Orama schema; an embedding pass
  inside the existing refresh that batch-embeds changed `contains` texts
  and re-inserts their whole-card docs with vectors; a query path that
  embeds the query and searches `mode: "hybrid"` when possible, falling
  back to full-text with a visible note when not.
- **Why this needs to change**: BM25 only matches wording. The
  `contains` field was designed as a retrieval summary precisely so "that
  thing about the dentist reschedule" finds the card whose `contains` says
  "moved to June 17" — a vocabulary-mismatch query text search cannot
  serve. All the scaffolding (schema-version rebuild, `contains` as
  embedding unit, hybrid as intended mode) was pre-committed in the
  shipped plan; this closes it.
- **Direction**:
  - **Provider decision (sticky)**: OpenAI `text-embedding-3-small`,
    requested at `dimensions: 512` (Matryoshka truncation), stored as
    `embedding: "vector[512]"`. Model + dims are code constants
    (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`) plus a derived
    `EMBEDDER_ID = "openai:text-embedding-3-small@512"` — not per-box
    config; a per-box model knob would let boxes drift apart for no
    benefit, and changing the model is a code change whose cost
    (re-embedding every card) should look like a code change. `EMBEDDER_ID`
    is folded into every embedded-text hash, so a model/dims change busts
    every hash and re-embeds automatically; a dims change additionally
    bumps `SEARCH_SCHEMA_VERSION` (the declared `vector[N]` changes).
  - **Service**: `src/services/openai-embeddings.ts` —
    ```ts
    export interface EmbeddingsService {
      /** Embed texts in order; result[i] has EMBEDDING_DIMENSIONS entries. */
      embed(texts: string[]): Promise<number[][]>;
    }
    createOpenAIEmbeddingsService(apiKey: string): EmbeddingsService
    createFakeEmbeddings(opts?: { failTimes?: number }): FakeEmbeddingsService
    ```
    Real: `POST /v1/embeddings` via `ky` (`openai-audio.ts` shape), body
    `{model, input: texts, dimensions: 512}`; validates response length
    and per-item `index` against the request; chunks requests at 2,048
    inputs / a conservative token budget (a `contains` is ~30 tokens, so
    chunking is a safety rail, not a hot path). Typed error class on
    failure. Fake: deterministic unit vectors derived from a text hash
    (identical text → identical vector), records calls, `describe()`,
    optional scripted failures for degradation tests. Added to the
    `Services` container (`embeddings?: EmbeddingsService | undefined`).
  - **Key resolution**: `src/core/search/embeddings-key.ts` —
    `getOpenAiEmbeddingsKey(boxRoot)`: `config/connectors/openai.secret.json`
    (`{apiKey}`) first, `CALLBACK_OPENAI_API_KEY` env fallback, `null`
    otherwise — the `mistral-key.ts` resolution *order*, but stricter at
    the boundary: an **absent** file falls through to the env var
    silently (the designed not-configured state), while a **present but
    malformed** file (unparseable JSON, missing/non-string `apiKey`) is a
    loud typed error, never a silent fallback — a box that tried to
    configure paid embeddings must not quietly run without them
    (principle #3/#4; `mistral-key.ts:13` swallows both cases and is the
    anti-pattern here, not the template). No fallback to
    `THINKING_OPENAI_API_KEY` (never-implicit-key: transcription's key is
    consent to pay for transcription, not for search). `null` key =
    text-only search, silently normal — a box that never configured
    embeddings sees exactly today's behavior with no nagging.
  - **Schema**: `searchOramaSchema` gains `embedding: "vector[512]"`;
    `SEARCH_SCHEMA_VERSION` → 4 (v4 note: embedding vector field).
    `SearchDoc` gains `embedding?: number[]` — optional, omitted (never
    null) for docs without one.
  - **What gets a vector**: only the whole-card document (`fragment: ""`)
    of cards whose `effectiveContains` is non-empty. Section docs and
    standalone-markdown docs stay text-only — `contains` is the embedding
    unit, full stop. (All cards are frontmatter cards now — the legacy
    XML loader is gone, `LoadedCard` is only `FrontmatterLoadedCard` —
    so there is no XML-card case to carve out. Embedding raw content
    is explicitly out of scope, and this also keeps the untrusted-content
    quarantine trivially intact: `contains` is agent-written, and email
    bodies were never indexed at all.)
  - **Refresh embedding pass** (the update trigger): the existing per-file
    refresh loop is untouched — docs insert text-only exactly as today.
    After the loop **and after `healContainsState`** (`refresh.ts:141` —
    the heal is what guarantees the sidecar covers cards the manifest
    diff skipped as unchanged, which is exactly the
    box-gains-a-key-later corpus; heal may re-read those card files
    once, which is the existing heal cost, not a new one), still under
    the search lock, before persist, when an embedder is available:
    1. Collect pending cards: every non-skipped manifest entry whose
       sidecar `containsText` is non-empty and whose `embeddedHash` ≠
       `contentHash(EMBEDDER_ID + "\n" + containsText)`. This covers
       changed cards, never-embedded cards (fresh key, schema rebuild),
       and cards whose previous embed attempt failed — one rule, no
       separate backfill state.
    2. One batched `embed()` call for all pending texts (chunked per API
       limits). This post-loop batch is deliberate — the considered
       alternative (embed inline in `refreshOneCard` before first
       insert) would either make one API call per changed card (a
       2,000-call cold build) or require restructuring the loop to
       defer inserts; the cost of the batch shape is an extra in-memory
       remove+insert per embedded doc, which is cheap and already the
       module's idiom.
    3. For each result: `getByID` the whole-card doc, `remove`, re-insert
       `{...doc, embedding}` (the remove+insert idiom `refresh-file.ts`
       already uses), set the manifest entry's `embeddedHash`, mark the
       index dirty.
    4. On embed failure: push one warning naming the failure and the fix,
       leave `embeddedHash` unset — the same cards are pending again next
       refresh. Search still answers text-only. A failed batch never
       blocks persist of the text-side refresh.
    5. `openSearchIndex` returns a new `embeddingsReady: boolean` —
       true only when an embedder is configured AND the pending set is
       empty after the pass (every contains-bearing card holds a
       current-`EMBEDDER_ID` vector). This is the signal the query path
       gates hybrid on: without it, a failed or partial corpus embed
       would still rank hybrid, silently biasing toward the docs that
       happen to have vectors (Orama fuses whichever halves exist). The
       lock-contended stale path **fails closed** (`embeddingsReady:
       false`, one contended query ranks text-only): its restored index
       may predate the lock holder's writes, and an absent sidecar would
       otherwise read as "nothing pending". *(As-built refinement from
       the chunk-3 cross-model review.)*
    6. **Persist ordering (as-built, from the chunk-3 review)**: the
       contains sidecar saves BEFORE index + manifest, making the
       manifest the oldest survivor of any crash. `embeddedHash` asserts
       "the indexed vector embeds this card's sidecar `containsText`" —
       under the old sidecar-last order, a crash between the manifest
       and sidecar writes would durably attach a vector of the *old*
       contains text on the next refresh; sidecar-first makes that
       window re-diff and converge instead.
    Cost reality (why there is no opt-in gate, no job cards, no cache
    file): a full 10k-card box is ~2k searchable `contains` sentences ×
    ~30 tokens ≈ 60k tokens ≈ **$0.001** and one or two API calls; steady
    state is a handful of sentences per refresh. The shipped plan's
    "lazy / cost-gated" instinct predates these numbers. The property
    that mattered — never embed eagerly on every card write — holds:
    embedding happens only at query-time refresh, batched. And because
    `embeddedHash` lives in the manifest, a schema-version rebuild
    re-embeds everything for a tenth of a cent — a separate content-hash
    cache file would be a second source of truth guarding against a cost
    that rounds to zero (principle #8).
  - **Query path** (`query.ts`): resolve the key (or an injected service —
    doctests pass the fake through `SearchBoxOptions`/CLI options). When a
    service is available AND the refresh reported `embeddingsReady`:
    `embed([query])`, then
    `search(db, { mode: "hybrid", term, vector: { value, property:
    "embedding" }, similarity: SIMILARITY, boost, properties, where,
    limit })`. When no key, when the corpus isn't fully embedded
    (`embeddingsReady` false), or when the query embed fails or times
    out: the existing `mode` (fulltext) call, plus — in the failure and
    not-ready cases, not the no-key case — a warning naming the cause. The branch is explicit
    in our code because Orama throws a raw `TypeError` on a missing
    vector (verified above). The result envelope gains
    `searchMode: "hybrid" | "text"` so `--json` consumers and the human
    output can see which ranking answered. New CLI flag
    `--mode <text|hybrid>`: omitted = auto (hybrid when possible);
    `text` forces today's behavior (offline, deterministic, and the
    relevance-comparison lever while tuning); `hybrid` fails loudly with
    the key-setup hint when no key is configured, and — when the corpus
    isn't fully embedded yet — with the refresh-side cause folded into
    the error (the 401/timeout warning would otherwise be swallowed;
    as-built refinement from the chunk-4 review, which also traded the
    planned pending-count for the cause text). `--mode text` skips key
    resolution and corpus embedding entirely — offline means zero
    network calls and immunity to a malformed secret file (enumerated
    values in errors per `docs/ideas.md` § CLI Design for Agents).
  - **Tuning constants** (in `query.ts`, tuned while dogfooding against
    the large box copy): `SIMILARITY = 0.35` to start (Orama's 0.8
    default would filter out virtually every OpenAI-embedding match);
    `hybridWeights` left at Orama's 0.5/0.5 default initially.
- **Vocabulary lock-ins**: schema field `embedding`; manifest field
  `embeddedHash`; `EMBEDDER_ID` format `"<provider>:<model>@<dims>"`;
  secret file `config/connectors/openai.secret.json`; env var
  `CALLBACK_OPENAI_API_KEY`; CLI flag `--mode <text|hybrid>`; result
  fields `searchMode` and `embeddingsReady`; service names
  `EmbeddingsService` / `createOpenAIEmbeddingsService` /
  `createFakeEmbeddings`.
- **First implementation chunk**: the service + key resolution +
  `test/service-openai-embeddings.doctest.md` (fake determinism, call
  recording, chunking boundaries, response-shape validation). No open
  questions inside it.

## Subplans

None. The one candidate — a local/ONNX embedder — was explicitly deferred
at handoff ("fine for later, annoying now"); the `EmbeddingsService`
interface is the seam it will drop into.

## Failure modes

> **Accepted documented risk:** *hybrid ranking quality is unvalidated
> until dogfooded* — similarity cutoff and fusion weights are constants
> chosen from first principles, and no offline metric exists for "the
> boxholder finds the card they meant." Accepted because the failure is
> soft (results no worse than text-only is NOT guaranteed — a bad vector
> match can outrank a good text match), the `--mode text` flag gives an
> instant escape hatch and comparison lever, and pre-merge manual
> validation against the ~10k-card box copy is the gate.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Embeddings API down/timeout during refresh | doctest: fake `failTimes` → warning, text-only docs, re-pending next refresh | batch failure warns and skips; `embeddedHash` unset → retried; text refresh persists regardless | clear (warning in envelope) |
| Embeddings API fails on the query embed | doctest: fake failure at query time → fulltext results + warning | explicit branch to `mode: "fulltext"` | clear (warning + `searchMode: "text"`) |
| Invalid/revoked key (401) | doctest: typed error classification | same degrade path; warning names the secret file / env var to fix | clear |
| Secret file present but malformed (bad JSON, missing `apiKey`) | doctest: loader throws typed error | loud error, never a silent env/null fallback (a box that tried to configure embeddings must know it failed) | clear |
| Corpus partially embedded (batch failed, or mid-first-embed) yet hybrid runs, biasing ranking toward embedded docs | doctest: pending set non-empty → `embeddingsReady` false → text-only + warning | hybrid is gated on `embeddingsReady` (pending set empty), not on key presence | clear |
| No key configured | doctest: no service → text-only, no warning | text-only is the designed normal state | silent by design (not a failure) |
| Vectors silently absent after persist/restore (Orama #834 shape) | doctest: insert embedded docs → persist → restore → hybrid search finds by vector | pinned at our version; `cb search --rebuild` is the remedy | clear once doctest exists |
| `mode: "hybrid"` called without a vector (raw Orama TypeError) | doctest: no-service path never constructs hybrid params | our code branches; hybrid params are only built when an embed succeeded | n/a (unreachable by construction) |
| Response/request mismatch (count or vector length ≠ 512) | doctest: fake with wrong-shape response → typed error | service validates length + per-item index before returning (boundary validation) | clear (typed error → degrade path) |
| Model/dims constant changed without rebuild | n/a (compile-time reasoning) | `EMBEDDER_ID` in every `embeddedHash` busts all hashes → auto re-embed; dims change also bumps `SEARCH_SCHEMA_VERSION` | n/a (self-correcting) |
| Similarity cutoff filters every vector match (vector half contributes nothing) | manual: relevance pass on large box copy | tuned constant (0.35 start), `--mode` comparison lever | silent in any single query — accepted, covered by the documented risk above |
| Index JSON grows ~40 MB (vectors persist in both doc store and vector index, ~20 KB/doc measured); restore slows every search | manual: latency measured on large box copy pre-merge | measured before merge; levers recorded in NOT in scope | clear (measured, not discovered) |
| Batched embed pass extends search-lock hold time | covered by existing lock-contention doctest behavior | contending process already serves stale results without blocking (`refresh.ts:76-79`) | clear (existing stderr note) |
| A pending card is deleted between collection and re-insert | n/a | impossible: collection and re-insert run in one pass under the same lock over the in-memory db | n/a |

No critical gaps: every silent row is either by-design (no key) or the
single accepted documented risk.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED by construction: this plan adds
  no agent-writable surface; agents keep writing `contains` exactly as the
  shipped guidance says, and vectors follow automatically.
- **Stale ref** — ADDRESSED: unchanged from the shipped design; refresh
  runs at query time, results reflect the filesystem as of the query.
- **Two agents touching the same card** — ADDRESSED: embedding state
  (`embeddedHash`) is indexer-owned, single-writer under the existing
  search lock; card edits keep parse-mutate-reserialize semantics.
- **Hand-edit drift** — ADDRESSED: a hand-edited `contains` changes the
  card file → manifest diff re-extracts → `containsText` changes →
  `embeddedHash` mismatches → re-embedded at the same refresh. No
  hand-edit can leave a vector silently describing old text.
- **Fabricated free-form value** — ACCEPTED (inherited): a fabricated
  `contains` (shipped plan's accepted risk 1) now also steers semantic
  retrieval. Same mitigation stack — guidance, staleness sidecar, card
  body remains authoritative. Nothing new to build.
- **Validation error UX** — ADDRESSED: degradation warnings name the
  cause and the fix ("embeddings key invalid — check
  config/connectors/openai.secret.json"); `--mode hybrid` without a key
  errors with the setup path; `--mode` errors enumerate valid values.
- **Partial migration / transition state** — ADDRESSED by design: the
  schema bump makes the first post-deploy search a full rebuild (same
  cold-build path that already exists, with progress on stderr); a box
  with no key runs text-only indefinitely with zero broken state; a box
  that gains a key later back-embeds its whole corpus on the next search
  via the pending rule — no migration step, no job cards.

## NOT in scope

- **Local/ONNX embeddings** — deferred at handoff ("fine for later,
  annoying now"); the `EmbeddingsService` seam is where it lands.
- **Embedding raw card content / section docs / markdown files** —
  `contains` is the designated embedding unit; content embedding is a
  different cost and relevance profile, revisit on real misses.
- **Indexing (or embedding) email bodies** — the untrusted-content
  quarantine stands (`docs/implemented-plans/box-search.md` § NOT in
  scope); embedding `contains` only means this plan doesn't even go near
  it.
- **A separate embedding cache file** — the manifest `embeddedHash` +
  trivial re-embed cost (~$0.001/full box) make a second cache a second
  source of truth with no payoff (principle #8).
- **Embedding backfill job cards / `cb embed` command** — the pending
  rule inside refresh covers cold start, new key, and rebuilds; a job
  surface would be a redundant second mechanism (same reasoning that cut
  the eager `cb mv` hook from the shipped plan).
- **Per-box provider/model config** — constants + `EMBEDDER_ID` hash
  busting; a config knob invites accidental corpus-wide re-embeds and
  cross-box drift for no present need.
- **Compact vector persistence** (binary sidecar, quantization) — the
  ~40 MB JSON growth is measured against the large box copy before
  merge; if restore latency actually hurts, that's a follow-up with data
  in hand, not a preemptive format change (msgpack is off the table —
  radix depth limit, `search-store.ts:4-7`).
- **Query-embedding cache** — one ~$0.0000006 call per search; caching it
  is complexity with no constituency.
- **Web UI / MCP search surfaces, backlink counts** — unchanged deferrals
  from the shipped plan.
- **Reusing `THINKING_OPENAI_API_KEY`** — deliberate non-goal, not an
  oversight: a transcription key is not consent to bill for search
  (never-implicit-key). Recorded here because it will look like an
  obvious "simplification" to a future session.

## Open design questions

- **Similarity cutoff and hybrid weights** — start `similarity: 0.35`,
  weights 0.5/0.5; tuned during the pre-merge relevance pass. Lean: keep
  both as named constants with a comment recording the tuning session's
  findings; no config surface.
- **Should the human output mark hybrid-mode results?** Lean: yes, one
  trailing stderr-style line only when degraded ("semantic ranking
  unavailable: <cause>") and nothing when hybrid works — quiet success,
  visible degradation (principle #4; noisy-output rule).

## Knowledge audits

None land with this plan, deliberately: it introduces no agent-facing
concept. Agents interact with search exactly as before (`cb search`,
existing audit "Reaching for `cb search`"), and `contains` guidance is
unchanged — vectors are infrastructure behind the same command. The one
borderline candidate ("agents may now use conceptual queries, not just
keyword queries") is a capability, not a recallable convention; if
dogfooding shows agents under-using semantic queries, a line in the
agent guide plus an audit entry is a follow-up, not a gate.

## Implementation order

1. **Embeddings service + key resolution**:
   `src/services/openai-embeddings.ts`, `Services` container entry,
   `src/core/search/embeddings-key.ts`, and
   `test/service-openai-embeddings.doctest.md`. Independent of everything
   else.
2. **Schema v4**: `embedding: "vector[512]"` in `searchOramaSchema`,
   `SearchDoc.embedding?: number[]`, `embeddedHash` on
   `ManifestFileEntry`, `SEARCH_SCHEMA_VERSION = 4`; pin `@orama/orama`
   and `@orama/plugin-data-persistence` to exact `3.1.18`. Small,
   unblocks 3-4.
3. **Refresh embedding pass**: pending-collection rule (after
   `healContainsState`), batched embed, remove/re-insert with vector,
   failure handling, `embeddingsReady`; doctests (makeTmpBox + fake
   embedder): cold build embeds all contains-bearing cards; edit
   re-embeds; embed failure degrades visibly, re-pends, and reports
   not-ready; persist → restore → hybrid round-trip (the #834 pin).
   Depends on 1-2.
4. **Query hybrid branch**: query-embed with fallback, explicit
   fulltext/hybrid branching gated on `embeddingsReady`, `searchMode` in
   the envelope, `--mode` flag + errors, human-output degradation note;
   doctests for auto/no-key/not-ready/failure/forced modes. Depends on
   1-3.
5. **Pre-merge validation** (manual, large box copy): cold-build wall
   time and index size, restore latency per search, relevance comparison
   `--mode text` vs hybrid on a dozen real queries, similarity/weights
   tuning recorded in the constants' comments.

Each chunk is a commit-sized unit on this worktree; nothing merges to
main until the plan completes and the boxholder says ship.

## Rollout shape

- **Chunk-5 measurements (July 2026, recorded post-validation)**:
  - *Scale* (2,000 embedded + 200 plain cards, fake embedder, M-series
    laptop): cold build 0.7s → 1.9s with embeddings; index 7.6 MB →
    48.5 MB (21.5 KB/embedded doc — matching the review's estimate);
    restore-only 45ms → 322ms; per-search ~386ms text / ~430ms hybrid,
    restore-bound. The restore cost repeats on every search (no
    in-process cache) — acceptable now, and the compact-persistence
    lever in NOT-in-scope is the recorded mitigation if it grows.
  - *Relevance* (real text-embedding-3-small@512, 20 cards, 12
    vocabulary-mismatch queries): hybrid top-1 on 10/12 vs text-only
    3/12 (both misses rank 1); query↔target cosines 0.467-0.682,
    off-target median 0.161 / max 0.470 — `SIMILARITY = 0.35` passes
    every true match with margin. Weights stay 0.5/0.5.
- **Test posture**: doctests land with their chunks (the shipped plan's
  posture for regression-shaped risks): the service doctest (chunk 1),
  the refresh/degradation/round-trip doctests (chunk 3), the query-mode
  doctests (chunk 4). All run offline via the deterministic fake; no
  doctest ever needs a real key. Relevance and latency are manual
  (chunk 5) because they need real embeddings and a real corpus — the
  same manual-validation posture the shipped plan used for ranking.
- **Knowledge audits**: none (rationale above).
- **Migration**: none in the data-shape sense — cards are untouched; the
  index and manifest are per-checkout caches, and the v4 bump makes every
  box rebuild (and, where a key is configured, back-embed) on its first
  post-deploy search. Boxes without a key are simply today's search,
  indefinitely. Per-box enablement = dropping
  `config/connectors/openai.secret.json` into the box; no code path
  changes.
- **Ship signal**: worktree merges to main only on the boxholder's
  explicit go.
