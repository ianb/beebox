---
title: "Opening an existing chat briefly flashes 'Agent is working' with no message sent (web + iOS)"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder opened a landmark's most-recent chat
---

> **Job to be done:** *When I open a chat I was already in — to read it or pick it
> back up — I want it to just show me the conversation, not a false "Agent is
> working" that makes me think it's off doing something I never asked for.*

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

## Implemented direction

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
