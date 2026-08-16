---
title: "chat.history parse cost is unbounded per request — concurrent fetches of a fat transcript OOM cb serve (box-family crashes ×4)"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: ios-capture-upload-diag worktree — live-measured on prod during the 2026-08-03/04 box-family incident
resolution: implemented
---

> **Fixed.** Directions 1–3 landed on main (`ac0d7d65`, `add0c339`, `546310cb`)
> and are prod-verified: the 10-parallel `chat.history` storm dropped from
> **+216 MB → +0.04 MB** heap (read coalescing + an oversize-line parse bound +
> client refetch backoff/dedupe). The temporary `cb` instrumentation patch and the
> `/home/callback/diag` dir are removed. Direction 4 (strip/sidecar multi-MB
> payloads at write/render) is the remaining longer-term hardening, spun out to
> [strip-multi-mb-payloads-from-transcript-entries](../../code-quality/2026-08-05-strip-multi-mb-payloads-from-transcript-entries.md).

Four V8 heap OOMs of prod box-family's `cb serve` (2026-08-03 21:39, 2026-08-04
02:09, 02:10, 17:18 UTC — all at the ~1.9GB default cap, all during
phone-attached use; the 17:18 one 48s after `[ChatSession:init] Loaded
session`). The 2026-08-01 bounded-retention fix
(`docs/implemented-plans/chat-history-oom-mobile-lock.md`, `ac0d7d65`) is
working as designed and is NOT leaking — the remaining gap is **per-request
transient parse cost times client concurrency**.

## Mechanism (live-measured on prod, 2026-08-04)

- The active box-family session transcript is 15.5MB across 1,587 lines, with
  **14 lines over 1MB** (~1.3MB each — capture-image/tool payloads). An
  entry-count slice (`tail: 200`) does not bound bytes.
- `parseSessionLog` (`src/cli/lib/session.ts`) still `JSON.parse`s **every
  line** of the file per request to produce the bounded tail; retention is
  bounded, allocation is not.
- Measured via inspector on the live child: one real `chat.history,chat.status`
  fetch (127KB response, 0.2s) cost **+54MB heapUsed**. Ten parallel fetches:
  **+216MB**, roughly linear stacking, not collected between bursts. A forced
  GC (heap snapshot) returned all of it — transient garbage, not a leak.
- The iOS webview fires these in bursts: reconnect after idle/cold-start
  refetches history + bootstrap + status, with retries and (observed) no
  backoff — the 02:09 crash window had a 56-requests-in-one-second storm of one
  view endpoint, and each crash window contained multiple chat.history
  requests. Burst concurrency × ~50MB transient per fetch outruns the GC to
  the heap cap; GC pressure first makes everything slow (mu ≈ 0.3 in the crash
  GC traces — the "super slow but went through" capture of 2026-08-04
  ~17:16), then an allocation fails.

Why only box-family: it's the only box whose active session carries multi-MB
transcript lines (heavy iOS capture use). Estate (32GB annex media, no fat
chat) never crashed — annex itself is not implicated.

## Fix directions (compose; roughly in value order)

Directions 1, 2, and 3 are **done** (2026-08-04). Direction 4 is still open,
and this item stays open regardless because the diagnostic instrumentation
below still needs removal after prod verification.

1. ~~**Coalesce/single-flight history reads per (session, slice)**~~ — done.
   `loadSessionHistory` (`callback-box/src/core/chat/session/load-history.ts`)
   keys in-flight reads on `(logPath, slice)` and hands concurrent callers the
   same promise. The entry is dropped on settle, so it is a coalescing window,
   not a cache. The shared entries array is frozen.
2. ~~**Bound per-line parse cost**~~ — done.
   `callback-box/src/cli/lib/session-oversize.ts` holds the threshold
   (`MAX_SESSION_LINE_BYTES`, 256 KB of UTF-8) and the stub entry the scan
   records in place of a line it refuses to parse. The stub is an ordinary
   `SessionEntry` with one text block, so the frontend needed nothing. It counts
   toward `total`, never counts as a real user message, and cannot receive a
   grafted `tool_result`. An oversize line whose head shows plumbing (a
   `tool_result` turn, a system record, an SDK meta prompt, a synthetic
   assistant turn) is dropped instead of stubbed, so it does not become a
   message the parsed version never was.
3. ~~**Client: backoff + dedupe on the webview's reconnect refetch loop**~~ —
   done (`add0c339`, hardened by cross-model review in `546310cb`). The
   56-req/s storm was a coalescing/backoff gap across several call sites:
   `createFetchCoalescer` (`src/frontend/src/lib/fetch-coalescer.ts`) gives
   keyed load/refetch coalescing with trailing-refetch semantics,
   `createReconnectRefreshGate` (`src/frontend/src/components/chat/reconnect-refresh-gate.ts`)
   trailing-edge-coalesces reconnect-triggered refreshes, and
   `useDeferredResync`/`createDeferredResync`
   (`src/frontend/src/hooks/useDeferredResync.ts`,
   `src/frontend/src/lib/deferred-resync.ts`) defer resync work while the tab
   is backgrounded so a hidden webview stops contributing to the burst. Not
   yet independently verified against the live prod storm — that acceptance
   measurement (parallel history fetches against the running server) is
   pending post-deploy.
4. Longer-term: stop letting multi-MB payloads into transcript entries the
   history path serves at all (strip/sidecar them at write or render time).

## Prod acceptance (2026-08-04, post-deploy of directions 1-3)

Re-ran the confirming measurement against the live box-family child via the
inspector: the 10-parallel `chat.history` storm that cost **+216MB** heap
pre-fix cost **+0.04MB** post-fix (coalesced to one read); sequential fetches
oscillate ±20MB with no cumulative growth; responses stay ~126KB/0.27s. The
concurrency multiplier — the mechanism that reached the 1.9GB cap — is gone.

## Diagnostic infrastructure (REMOVED 2026-08-04 after the acceptance run)

All of the below is torn down: the wrapper patch (deploys had already wiped
it; left stock), the `/home/callback/diag` dir, the inspector helper script,
and the wrapper backup. The technique (SIGUSR1 → inspector → `Runtime.evaluate`
memoryUsage / `HeapProfiler.takeHeapSnapshot`) is reusable without any
pre-arming. Original notes kept below for the record.

Prod serve children run with `--heapsnapshot-near-heap-limit=1
--heapsnapshot-signal=SIGUSR2 --diagnostic-dir=/home/callback/diag` via a
TEMPORARY patch to `/opt/callback/callback-box/bin/cb` (`run_bundle`, serve
subcommand only; backup at `cb.pre-oom-instr`). **Every deploy silently wipes
the patch** (it was wiped twice on 2026-08-04, which is why crash #4 left no
snapshot) — re-apply after deploys while any of this remains under
investigation, or remove it once the fix lands. `kill -USR1 <child>` +
`/tmp/heap-inspect.js` on the server does live memory sampling and on-demand
snapshots through the inspector.
