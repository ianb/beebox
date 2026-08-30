---
title: "Bounded chat-history loading + fast stale-lock recovery"
status: implemented
workstream: unknown
issues: []
---
# Bounded chat-history loading + fast stale-lock recovery

Two fixes from one prod incident (box-family, 2026-08-01 ~22:08 UTC): a `bbx serve`
process OOM'd at the ~2 GB heap cap while serving a large chat session, and the
OOM-killed process's held mobile device-store lock then caused mobile-auth 500s
("Could not acquire the mobile device-store lock ... within the retry budget")
on the restarted process for minutes.

Design principle (boxholder directive): **never load an entire chat history into
memory** — bound the read, don't raise the heap cap. Decisions already made:
Track B ships the short-stale fix only (no PID-liveness fast path; ~15 s of
post-crash lock unavailability accepted). Track A uses a forward-streaming
capped ring, not a reverse reader (Codex review 2026-08-01, finding 1 — adopted).

## Track A — bound the chat-history read

### Diagnosis

Every history consumer funnels through `parseSessionLog`
(`src/cli/lib/session.ts:317-346`). It streams the JSONL via readline but
**retains a `SessionEntry` for every line in the file** — including full
`tool_use.input` objects (a `Write` call carries entire file contents,
`src/cli/lib/session-content.ts:113-121`) and full base64 image payloads
(`session-content.ts:78-94`) — and only then slices
(`filtered.slice(offset, offset + limit)`, default limit 10 000). The `tail:200`
param on `chat.history`/`chat.bootstrap` bounds the *response*, never the
*allocation*: all three `loadSessionHistory` variants
(`src/core/chat/session/load-history.ts:26`, `src/core/chat/session/state.ts:35`,
`src/webapp/trpc/routers/chat-session-procedures.ts:55`) call `parseSessionLog`
with no limit, then apply `effectiveTailSize` to the already-fully-materialized
array.

Incident timeline fit: `[ChatSession:init] Loaded session` fires on the first
`/chat/send` (`ChatSessionRegistry.getOrCreate`, cheap pointer-file read); the
first turn runs; on completion the frontend's post-turn refresh
(`fetchHistoryActor`, `src/frontend/src/machines/chat-actors.ts:74-89`) refetches
history → unbounded parse of a transcript the turn just grew. Concurrent
fetches of the same session each build an independent full copy, multiplying
the allocation past the cap ~87 s after init. (The specific
concurrency-trigger claims — bootstrap racing the refresh, a second device on
reconnect — are plausible inferences, not proven; a single full parse of a
large-enough session suffices on its own.)

Not implicated: transcript writes (append-only, written by the SDK subprocess;
`transcript-sync.ts` reads only a 512 KB tail), agent context assembly (rebuilt
inside the SDK subprocess), and our own tiny metadata JSON files.

### Fix

One mechanism for every caller: **`parseSessionLog` keeps its forward
streaming scan but stops retaining the whole array.** Exact `total` is still
counted (so no frontend contract change — `totalEntries` keeps driving the
"N earlier messages" / load-older affordance), while live retention is bounded
by the request shape:

1. **Red repro first.** A doctest that synthesizes a large session JSONL
   (thousands of entries; fat `tool_use.input` strings and base64-shaped image
   blocks) into a tmp dir and runs the parse in a child
   `node --max-old-space-size=<small>` process. Red: child OOMs. Green after
   the bound. Permanent regression test; tune file size vs heap cap for CI
   speed (a smaller file with a smaller cap beats a 200 MB fixture).

2. **Bounded retention inside `parseSessionLog`.** Two request shapes, one
   scan:
   - **Tail mode** (`tail: N`, the chat hot path): retain a capped ring of the
     last N entries (evict from the front as the scan advances); count `total`
     as today. `graftToolResults` (`src/cli/lib/session-entry.ts:33-51`) grafts
     into the ring; a `tool_result` whose `tool_use` was already evicted no-op
     grafts — invisible, since the evicted entry isn't returned anyway.
   - **Page mode** (`offset`/`limit`, the history-browser path): retain only
     entries within `[offset, offset+limit)` as the scan passes them; count
     `total`/`hasMore` exactly as today.
   `minRealUserMessages` folds into tail mode: the ring cap is
   `max(tail, hard ceiling for the min-user-messages expansion)` — a strict
   hard max (e.g. 5 000 entries) on any single request, enforced in the input
   schema (below), so no parameter combination can request unbounded retention.
   Memory profile: retained set ≈ the response payload we already return
   today; per-line transient allocations (one JSON.parse at a time) are
   GC-able. Oversized single lines allocate their own size transiently —
   unavoidable and bounded by one line.

3. **Discriminated input schema for `chat.history`** (Codex finding 5): the
   current Zod input permits `tail` + `offset` + `limit` +
   `minRealUserMessages` together with no integer/nonnegative/max constraints
   (`chat-session-procedures.ts:34`), and mixed requests have surprising
   semantics. Split into an explicit tail-shape vs page-shape union with
   integer bounds and hard maxima; update the two frontend call sites
   (`chat-actors.ts`, `ChatPage.tsx`) to the tail shape they already implicitly
   use.

4. **Consolidate the three loaders** (Codex finding 6; also the standing
   consolidate-over-blast-radius preference): `load-history.ts`, `state.ts:35`,
   and the tRPC variant are near-duplicates. Make one canonical
   `loadSessionHistory` that passes `tail`/`minRealUserMessages` down into
   `parseSessionLog`, and delete/delegate the others, so no caller can reach
   the unbounded path by construction. Batch consumers (`transcript-render`,
   `chat/review/discovery`, `retro/discovery`) keep forward-scan semantics but
   inherit bounded retention through the same `parseSessionLog` params they
   already pass (`limit`), or an explicit page shape where they pass nothing.

5. **Defense-in-depth (separate, clearly-labeled commit, not the fix):**
   `--heapsnapshot-near-heap-limit` (and explicit `--max-old-space-size`
   sizing) on the prod serve invocation so a future regression leaves a heap
   snapshot instead of a bare abort. Optional; skip if deploy plumbing makes
   it noisy.

Deliberately NOT in scope: a reverse-from-EOF reader (O(window) I/O — a
latency optimization for huge transcripts, not the OOM fix; today's code
already pays the full forward scan on every fetch, so the ring regresses
nothing) and request coalescing/caching of concurrent identical parses. File
follow-up issues if the forward-scan latency on very large sessions proves
user-visible.

**Follow-up landed (2026-08-04).** The deferred coalescing became necessary:
bounded retention held, but the *transient* per-request parse cost times client
concurrency took prod past the cap four more times
(`issues/bugs/2026-08-04-chat-history-parse-transient-oom.md`). Two additions,
both server-side: `loadSessionHistory` single-flights concurrent reads of the
same `(logPath, slice)`, and the scan refuses to `JSON.parse` a line over
`MAX_SESSION_LINE_BYTES` (`src/cli/lib/session-oversize.ts`), recording a
placeholder entry instead — an entry-count slice never bounded bytes, and the
offending session carried 14 lines over 1 MB.

## Track B — short stale window for request-scoped locks

### Diagnosis

`src/lib/file-lock.ts` (the canonical lock primitive, built on `proper-lockfile`:
atomic guard-dir mkdir + mtime-CAS stale reclaim) already recovers from dead
holders — but `STALE_MS = 5 min` (`file-lock.ts:128`), while the mobile pairing
caller retries for only 5 s (`LOCK_RETRIES=50 × LOCK_RETRY_MS=100`,
`src/core/mobile/pairing.ts:26-27`). After a holder crashes, every
`withDeviceStoreLock` caller — pairing-session redemption AND every
bearer-token verify (`resolveMobileTokenIdentity` stamps `lastUsedAt`) — fails
loud for up to 5 minutes until the guard mtime ages out. The July rewrite
(`issues/closed/bugs/2026-07-21-file-lock-empty-window-race.md`) flagged this
mismatch deliberately ("fail loud rather than block") but never assessed the
availability consequence on the mobile-auth path. Five sibling stores share the
exposure: `webapp/local-users.ts`, `connectors/transient-state.ts`,
`connectors/google-token-store.ts`, `core/push-subscriptions.ts`,
`core/commands/question-transition.ts`.

### Fix

1. **Red repro first.** A doctest that spawns a child process which acquires a
   lock and is SIGKILL'd mid-hold, then asserts recovery timing with the
   corrected expectations (Codex finding 9): (a) an acquire attempt
   immediately after the crash still fails within the caller's fail-fast
   budget (5 s retry < stale — fail-loud is preserved, by design); (b) an
   acquire after the stale window elapses succeeds. Use a test-scaled stale
   value so the suite doesn't sleep 15 s, plus one non-sleeping assertion on
   the real constants (request-profile stale ≤ a stated recovery SLO).

2. **Per-lock-class stale profiles in `file-lock.ts` only** (never a new
   pattern in callers). API shape (Codex finding 8): `acquireLock`'s second
   arg is already the metadata bag, so the profile rides a distinct options
   argument (or a widened options object that carries both), and the profile
   must thread through **every** surface that computes staleness —
   `lockOptions`, `checkOptions` (`inspectLock`), `scanLocks`'s reclaim, and
   the `onCompromised` message — so diagnostics and acquisition never disagree
   about when a lock is stale. `"request"` profile → 15 s stale; absent →
   the existing 5 min (sized for `bbx tick`'s long-held script locks).
   The reclaim mechanism is untouched — still `proper-lockfile`'s mtime CAS,
   no delete-by-path, no new steal logic.

3. **Declare the profile at the six request-scoped call sites** (pairing,
   local-users, transient-state, google-token-store, push-subscriptions,
   question-transition — *question-transition was reverted to the default
   profile post-review (2026-08-01): its critical section wraps the caller's
   arbitrary `plan()` work plus a git commit, i.e. seconds of subprocess work,
   not the millisecond RMW the 15 s request window assumes; a stall or sleep
   mid-commit would make the lock stealable mid-transition. Five request-scoped
   sites remain*). Callers' 5 s fail-fast retry budgets stay — a crash
   now blocks a store for ≤ ~15 s (accepted), and requests in that window
   still fail loud rather than hang.

4. **Document the tradeoff** in the module comment: a live holder
   paused/slept past 15 s mid-critical-section becomes stealable. These
   critical sections are short (milliseconds — they include fsync + rename +
   dir-fsync, so not "sub-millisecond", but nowhere near 15 s), and
   `onCompromised` still logs loudly if a steal ever happens. Explicitly not
   doing PID-liveness fast reclaim (boxholder decision 2026-08-01); if that
   changes, it must layer on the mkdir CAS, never an independent unlink path.

## Post-fix sweep (boxholder request, 2026-08-01)

After both tracks land: audit the codebase for any OTHER path that loads an
entire chat history (or any similarly unbounded per-session artifact) in one
go — not just the known `parseSessionLog` batch consumers
(`transcript-render`, `chat/review/discovery`, `retro/discovery`) but anything
that reads transcript JSONLs, session stores, or per-turn logs without a
bound. Fix or file each finding.

## Sequencing

Tracks are independent; implement serially in this worktree (same-subproject
parallel agents collide on the whole-tree pre-commit). Order: B first (small,
self-contained), then A. Codex reviewed this plan 2026-08-01 (findings adopted
above; reverse-reader dropped, loaders consolidated, lock-profile threading
made explicit); a second Codex pass reviews the full diff before done.
