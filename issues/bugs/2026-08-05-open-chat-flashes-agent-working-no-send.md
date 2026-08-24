---
title: "Opening an existing chat briefly flashes 'Agent is working' with no message sent (web + iOS)"
workstream: emission-model
needs: [manual-testing]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder opened a landmark's most-recent chat
---

> **Root-caused and fixed 2026-08-23 (emission-model).** Reopened by the
> boxholder the same day: opening a chat still flashed "Agent working" a couple
> of seconds after load. Not a reconnect, not a busy snapshot, and not the
> `starting` phase — it reproduces deterministically on an idle local chat:
> the reconnect-refresh gate (`components/chat/reconnect-refresh-gate.ts`)
> suppresses the *first* WS connect as "too soon after mount" but arms its
> trailing timer, which fires a `REFRESH` ~5s after every mount. `REFRESH` is a
> global handler, so an idle chat enters `refreshing`, and since `988b2014` the
> strip painted through any `refreshing` (gated only against the
> `"clearing"` confirmation). Visible duration = the history round-trip, so it
> reads as a flash on a heavy box and was sub-100ms locally.
>
> Fix: the machine now records *why* it is refreshing (`context.refreshCause`,
> `"turn"` on every `streaming → refreshing` edge, `"resync"` for the global
> `REFRESH`), and the strip shows through a `turn` refresh only; a `resync`
> refresh falls back to the confirmed-busy rule like `idle`. The `"clearing"`
> confirmation value is gone — the status poll's idle read drops its
> confirmation before sending the (resync) REFRESH. Doctests:
> `test/frontend/chat-machine-refresh-cause.doctest.md`,
> `test/frontend/chat/processing-status-display.doctest.md`. Browser probe on
> the worktree: the ~5s resync still happens, the strip no longer paints.
>
> The mount-time trailing REFRESH itself is left alone: it is one redundant
> history round-trip per open, now invisible, and it incidentally covers
> events between bootstrap and subscription start.
>
> **The delivery fork is not a bug, and this note supersedes the 08-18 read.**
> `starting` is entered only from `send()` (`lifecycle.ts`: `idle → starting`
> is "a send with no open run"); opening/attaching a chat never enters it, so
> "a session that is merely attaching" cannot read busy. The only sends that
> see `starting` are concurrent ones mid-`startRun`, and `enqueue()` is the
> right path for those: there is no open run to send onto, and the queue drains
> when the starting run's first turn completes (the alternative double-started
> a second run). Nothing to change there.

> Cross-model review (Codex) of the fix surfaced one real edge, now also
> fixed: the same trailing REFRESH could fire during a >5s `loading` phase,
> cancelling `fetchInitial` mid-flight and skipping its `initial`-clearing
> onDone. `loading` now ignores REFRESH like `streaming`/`refreshing` do
> (pushed history still lands via the global SET_MESSAGES). Its second note —
> a send queued during `loading`/`refreshing` finishes via a `resync` refresh,
> so the strip drops when the status poll reads idle rather than after the
> reconcile — matches pre-fix timing (the old `"clearing"` path hid that
> refresh too) and the agent genuinely is done then; no change.

## Manual testing

On the box where it was seen (web and iOS): open an existing chat, wait ~10s
without sending anything. Expected: no "Agent is working…" strip at any point.
The earlier (2026-08-06) fix was closed on green tests and reopened, so this one
stays gated until seen on the real box.

> **Checked 2026-08-18 — half fixed; the half that isn't cosmetic is still
> live.** Tagged `reconfirm`; removed.
>
> **Fixed:** the visible flash, in `988b2014` (2026-08-06, "confirm busy before
> showing status") — present in current `chat-actors.ts` /
> `processing-status-display.ts`.
>
> **Still live:** the delivery fork this issue calls out as *not* purely
> cosmetic. `lifecycleBusy()`
> (`src/core/chat/session/lifecycle.ts:113-118`) still counts the `starting`
> phase as busy, and `deliver-user-message.ts:184-185` still branches on
> `session.isBusy()` to `enqueue()` rather than `send()`. So a session that is
> merely *attaching* still routes a delivered message — a capture, for instance
> — into the in-memory queue instead of sending it. Nothing since 2026-08-06
> touches `lifecycle.ts` or that branch (`deliver-user-message.ts` has only
> unrelated Codex-history routing, `aabd91e1`).
>
> Worth narrowing the issue's title/scope on the next pass: what remains is a
> delivery-routing bug, not a UI flash.

> **Job to be done:** *When I open a chat I was already in — to read it or pick it
> back up — I want it to just show me the conversation, not a false "Agent is
> working" that makes me think it's off doing something I never asked for.*

**Partial resolution (2026-08-06):** Commit `988b2014` fixes the false status
strip on the shared web/iOS chat surface by confirming a load-time busy snapshot
before displaying it. The backend `isBusy()` delivery fork described below is
unchanged and remains open; the original production session and a physical iOS
device were not used for post-fix validation.

Opening the most-recent chat in a landmark (observed on a heavy prod box's
`Library` landmark) shows the **"Agent is working…"** bar for a moment, then it
clears — **on both web and iOS**, with **no message sent**.

## Mechanism

The bar shows when `chatTargetStatus({ isStreaming, processBusy })` is busy.
`processBusy` is set from the bootstrap load's `event.output.busy`
(`src/frontend/src/machines/chatMachine.ts:139`; also the status poll at `:348`,
driven by `useProcessingStatusPoll`), which comes from the backend
`busy: target.isBusy()` (`src/webapp/trpc/routers/chat-control-procedures.ts:49`).
A `ChatSession` in its `starting` phase **reads as busy** (`start-run.ts:92` calls
this out explicitly). However, opening a chat does **not** create or start a
session: bootstrap uses `registry.get(sessionId)`, while `starting` is entered
only from `send()`. A cold local open therefore reports idle. The production
observation was either a real earlier turn still settling or a transient busy
snapshot that cleared on the next status read; the specific production session
was not inspected from this worktree.

## Two hypotheses to distinguish (this is the diagnosis)

1. **Real lingering turn.** The session had a queued/in-flight turn — this box has
   had stuck/duplicate turns from the receipt-failure family
   ([chat-send-receipts-fail-often…](2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md))
   — and opening it shows the tail finishing, so `busy` is technically correct but
   surprising (the user didn't cause it, and no new output appears).
2. **Spurious starting / status-race flash.** Opening the session momentarily reads
   busy (a `starting`/attach phase, or a load-time status-poll race) before settling
   idle — a false indicator for a session that isn't actually processing a turn.

If it reproduces on a fresh local session that merely cold-starts on open, it's #2;
if only that specific session flashes, it's data-specific (#1).

## Implemented UI direction

Keep backend `busy` unchanged: it remains the authoritative send-admission /
queue signal, including `starting`. The frontend now withholds only the status
strip for 250 ms while it confirms a load-time busy snapshot through the existing
`chat.status` poll. A sustained busy state paints the strip after confirmation;
a snapshot that has already cleared refreshes history without flashing the strip.
Locally initiated streaming remains immediate, and composer queue affordances
still use the raw backend value. Since iOS embeds the same web chat, the behavior
is shared without a native bridge or wire-shape change.

## Related

- `docs/mobile-contract.md` / cb-ios-overlap — both platforms, shared surface.
- The TargetStrip busy bar (`components/chat/TargetStrip.tsx`) is the indicator.

## Second report + server-side evidence (2026-08-05, box-family)

The boxholder independently reported the same flash on **iOS**, on box-family's
active chat: opening the chat shows "agent working" for ~1s, every time, with no
message sent — observed *before* any capture activity, so it is not
capture-specific.

Server logs from that session (`e88dee2e`) support **hypothesis #2, not #1**:
across today's opens, every chat open logs `[ChatSession:init] Loaded session` /
`[ChatSessionRegistry:create]` with **no `[ChatSession:start] Starting SDK chat
run`** — the only run logged all afternoon was the one a real capture delivery
started. So the bar is painted by attach/`starting`-phase busy, not by a real
lingering turn.

**This is not purely cosmetic — the same flag changes delivery behavior.**
`deliverUserMessage` (`src/core/chat/session/deliver-user-message.ts:167`)
branches on `session.isBusy()`: busy → `enqueue()` (message parked for the
in-memory queue, `queued: true`), not busy → `await session.send()`. A session
that reads busy while merely attaching can therefore make a capture (or any
programmatic user message) take the queued path instead of being sent, which is
a real behavioral fork, not a UI artifact. Whichever fix direction is taken,
prefer narrowing the **backend** `isBusy()` so `starting`/attach is not busy —
that fixes the indicator and the delivery fork together; a frontend-only gate
leaves the delivery fork in place.
