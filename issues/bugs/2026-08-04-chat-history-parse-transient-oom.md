---
title: "chat.history parse cost is unbounded per request — concurrent fetches of a fat transcript OOM cb serve (box-family crashes ×4)"
area: callback-box
filed-by: agent
discovered-in: ios-capture-upload-diag worktree — live-measured on prod during the 2026-08-03/04 box-family incident
---

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

1. **Coalesce/single-flight history reads per (session, slice)** — concurrent
   identical fetches share one parse. Kills the concurrency multiplier, which
   is what actually reaches the cap.
2. **Bound per-line parse cost** — skip/stub entries whose raw line exceeds a
   byte threshold during the scan (render as a "large entry elided" stub the
   frontend already has affordances for), so one fetch of a fat transcript
   costs MBs, not tens of MBs.
3. **Client: backoff + dedupe on the webview's reconnect refetch loop** — the
   56-req/s storm is a bug regardless of server cost (`fetchHistoryActor`,
   reconnect paths in `src/frontend/src/machines/chat-actors.ts`).
4. Longer-term: stop letting multi-MB payloads into transcript entries the
   history path serves at all (strip/sidecar them at write or render time).

## Diagnostic infrastructure (still armed as of filing)

Prod serve children run with `--heapsnapshot-near-heap-limit=1
--heapsnapshot-signal=SIGUSR2 --diagnostic-dir=/home/callback/diag` via a
TEMPORARY patch to `/opt/callback/callback-box/bin/cb` (`run_bundle`, serve
subcommand only; backup at `cb.pre-oom-instr`). **Every deploy silently wipes
the patch** (it was wiped twice on 2026-08-04, which is why crash #4 left no
snapshot) — re-apply after deploys while any of this remains under
investigation, or remove it once the fix lands. `kill -USR1 <child>` +
`/tmp/heap-inspect.js` on the server does live memory sampling and on-demand
snapshots through the inspector.
