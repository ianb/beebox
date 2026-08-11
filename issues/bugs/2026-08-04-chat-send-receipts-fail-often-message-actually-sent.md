---
title: "Chat sends often show 'failed'/stay in the composer though the message actually sent — receipts are unreliable"
workstream: send-receipt-logging
area: callback-box
filed-by: agent
discovered-in: main session — boxholder reports it happening commonly across normal use
---

> **Job to be done:** *When I send a message and then lock my phone / switch apps /
> background the tab before the reply starts — or my connection blips for a
> second — I want the app to reliably tell me the message went through, so I don't
> stare at a "failed" error (or my text sitting back in the composer), re-send, and
> either duplicate the turn or lose trust that sending works at all.*

The boxholder reports this is **common**, in two grades of the same failure:

- **Hard:** a sent message **appears not to have sent** — an error banner, or the
  text is **restored into the composer** — even though it **did** send (the turn
  ran, the reply lands).
- **Soft:** the text **lingers in the composer after hitting send and clears only
  later** — *even though the message is already visible in the message log*. So the
  composer clear is itself gated on the (late) receipt rather than on the message
  appearing in history.

The **receipt** side of the emission/receipt model is failing (or arriving late)
often. The exact trigger is unknown; the boxholder's guesses are **backgrounding the
app/tab before the receipt arrives**, or **other connection blips**. The soft grade
is the tell: the message is in history, yet the composer is still holding the text —
so composer/emission state is keyed off the receipt, not off durable history.

## Why it matters

- **Erodes trust** — if "sent" is unreliable, the person can't tell whether any
  message went through.
- **The Retry is a trap** — offering Retry on a message that already processed
  duplicates the turn (same family as
  [ios-stale-unconfirmed-emission-banner](2026-08-03-ios-stale-unconfirmed-emission-banner.md)).

## What we know so far

The emission/receipt model treats the **receipt** as the confirmation signal, and a
lost/late receipt is read as "not sent." Concrete client-log signatures already seen
in the wild (on a deployed box):

- `[chat] send rejected, restored emission into composer: no outcome reported (timeout)`
- `[chat] Send failed with network error, retrying...`
- the iOS `chat did not confirm the message` banner.

These point at the receipt being lost while the send actually completed — plausibly
when the **WebSocket drops on backgrounding / visibility change**, during
**reconnect churn**, or on a brief network blip, so the receipt never reaches the
client but the server already ran the turn. It is likely **not iOS-only** — the
native emission path mirrors the web one (`components/chat/native-emission.ts`), so
the web composer is exposed to the same lost-receipt window.

## Fix direction

Same principle the reload-time banner issue lands on, extended to the **live** send
path: **reconcile against durable chat history, not just the ephemeral receipt.**
Before declaring a send failed (receipt timeout / WS drop), check whether the
message is already present in the conversation history; if it is, confirm it
**silently** — no error, no composer-restore, no Retry. Treat the receipt as an
optimization and history as the source of truth. Only a pending emission with **no**
corresponding history entry is a real failure worth surfacing (and Retry should be
safe only then).

## Research (2026-08-11)

The precise trigger and timing are unknown — this needs instrumentation of the
emission → receipt path to find where receipts get lost:

- Does it correlate with **tab/app backgrounding** (visibility change) or WS
  disconnect? Reproduce by sending then immediately backgrounding.
- Is the send POST completing server-side while the receipt broadcast is missed by a
  reconnecting client?
- Web vs iOS incidence — confirm both, since the emission path is shared.

Instrumentation now records a bounded, metadata-only timeline for each send.
Routine success stays in memory and prints nothing. A rejected or slow receipt,
network retry/offline event, stream error, incomplete stream, or event-bus error
flushes the timeline at `warn` level, so it reaches
`.callback-box/client-debug.log` while the debug panel is closed. The timeline uses
the emission ID to correlate dispatch, each `/api/chat/send` attempt and response,
local receipt settlement, turn-stream frames, durable-history reconciliation,
visibility changes, online state, and global event-bus reconnects. It records text
length and attachment counts, but never text, attachment names or paths, URLs, or
raw error strings.

The code has no separate receipt broadcast. It settles the acceptance receipt
locally from the `/api/chat/send` response. The WebSocket carries the turn stream
and global history events. The diagnostic names these actual boundaries so a future
incident can distinguish a slow POST from a stream or history-ordering problem.

A local browser check backgrounded the chat tab and triggered the anomaly path.
The resulting durable log entry contained `visible -> hidden -> visible` with
millisecond offsets while the debug panel stayed closed. This check verified only
the instrumentation transport. It did not reproduce the reported send failure or
identify its cause, and this work does not change send or reconciliation behavior.

## Related

- [ios-stale-unconfirmed-emission-banner](2026-08-03-ios-stale-unconfirmed-emission-banner.md)
  — the reload-time manifestation (persisted pending emission restored on load);
  this item is the live-send-time counterpart. A history-reconciliation fix should
  cover both.
- [voice-send-lingers-as-unsent-recovery-draft](2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md)
  — a voice-specific sibling of "sent but the client thinks it wasn't."
