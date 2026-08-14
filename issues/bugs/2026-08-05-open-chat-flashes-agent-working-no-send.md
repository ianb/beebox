---
title: "Opening an existing chat briefly flashes 'Agent is working' with no message sent (web + iOS)"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder opened a landmark's most-recent chat
next-action: reconfirm
---

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
