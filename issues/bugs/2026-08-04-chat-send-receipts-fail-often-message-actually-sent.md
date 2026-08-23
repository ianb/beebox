---
title: "Chat sends often show 'failed'/stay in the composer though the message actually sent — receipts are unreliable"
workstream: emission-model
needs: [manual-testing]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder reports it happening commonly across normal use
priority: important
---

> **⏳ Awaiting manual testing** — superseding fix landed in the
> emission-model workstream (`6e928be6`): the server now acks a send the
> moment it is durably recorded, before the engine spawns, so the cold-Codex
> first send should confirm in about a second instead of remaining pending
> for the spawn. Repeat the cold send and confirm the composer clears
> immediately and the turn still streams. Only the developer clears this.

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
often. The soft grade is the tell: the message is in history, yet the composer is
still holding the text — so composer/emission state is keyed off the receipt, not
off durable history.

## A reliable reproduction (2026-08-15) — the first send after a cold agent

The trigger was unknown when this was filed (guesses: backgrounding the tab,
connection blips). The boxholder has since found a deterministic one:

> "each time the server restarts and I send a message, it happens. I think that
> also means each time the codex process starts up in response to a user
> message, the user message never gets that received receipt."

So it is not fundamentally about backgrounding or flaky networks — those may
widen the window, but **the reproducible case is the first message sent after
the agent process is cold**. Spawning the engine takes seconds; the receipt for
the message that *triggered* the spawn is the one that goes missing. That is a
race with a start-up cost, which is why it looked random: it fires whenever the
agent happens to be cold, and normal use keeps it warm.

**Caveat from the boxholder: only observed with the Codex engine.** Whether a
Claude Code backend has the same gap is untested, and the answer matters — if
Claude Code is fine, the bug is in the Codex spawn path rather than in the
receipt model, and the fix is much narrower.

**This also explains the recovery-draft symptom**, which is filed separately as
[voice send lingers as an unsent recovery draft](2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md).
A draft that never receives its receipt is, correctly, still "unsent" as far as
the persistence layer knows — so it is offered back for recovery after it has
already been sent. Those two issues were checked on 2026-08-14 and confirmed
*not* duplicates (different root causes), and that still holds: this is one
mechanism producing the other's visible symptom, not one bug. Fixing the receipt
may make the recovery-draft symptom disappear without the draft-persistence race
being fixed at all — worth not mistaking one for the other.

**Interaction with in-flight work, worth flagging before it bites.**
[Long-lived processes never reload the rebuilt bundle](../closed/bugs/2026-08-15-long-lived-processes-never-reload-the-rebuilt-bundle.md)
proposes making stale processes restart themselves. Every such restart leaves
the agent cold, so it walks straight into this bug — a fix that makes restarts
*more* frequent will make this fire *more* often. These two should know about
each other.

## Attempted fix through `3ef82d85` (2026-08-15)

The cold-start timing exposed a frontend lifecycle hole rather than a missing
server receipt channel. The streaming actor discarded a completed
`/api/chat/send` outcome when the actor had been cancelled during the in-flight
request. The server could accept and run the message, but the actor returned
before settling its receipt. Send success and failure now settle independently
of the actor's remaining UI work.

A real-browser control after stopping the worktree child found that Claude's
first send cleared immediately. The corresponding resumed Codex send from an
already-open tab returned HTTP 200 and settled after 5.287 seconds; this proved
the cold path is slower, but also showed that raising the 30/35-second web/iOS
backstops would only delay a lifecycle bug rather than fix it. Focused doctests
cover accepted and rejected POST outcomes after actor cancellation.

The developer's subsequent manual test failed. The first send from a fresh
Codex session still ran without returning its receipt.

## Browser reproduction attempts (2026-08-15)

The isolated browser loop has not reproduced the missing receipt on current
`main`. Three Codex sends succeeded after a cold start: two brand-new sessions
after stopping the worktree children, and one existing session after using
**Stop Process** to kill only its Codex subprocess. The measured anomaly trace
for one new-session send recorded HTTP 200 and local receipt settlement after
5.325 seconds. Each message ran once and the composer stayed clear.

This is a red-capable loop, but it is missing a condition from the developer's
failure. Do not use these green controls to close the issue. Compare the failing
client's diagnostic timeline with this control before making another fix.

## Outcome-driven fix through `ef20af7f` (2026-08-15)

Metadata-only field diagnostics supplied the missing condition: the old web
receipt timeout rejected a still-running send, then `/api/chat/send` returned
success after that rejection. The receipt was not lost; the client manufactured
a failure from elapsed time while cold Codex startup was still legitimately
pending.

Web and native delivery now wait for an actual send outcome. Duplicate
expectations for the same emission ID share that outcome rather than rejecting
one another. Native provisional navigation preserves receipts from the old
document until the replacement commits, then redelivers the same persisted ID;
content-process termination follows the same recovery path. Server dedup retains
claimed message IDs for seven days so those navigation and recovery redeliveries
remain idempotent. A 30-second metadata-only diagnostic records that a receipt is
still pending without changing its disposition.

Focused web receipt tests, the full callback-box suite, and simulator request
tests cover these paths. Cold Codex browser controls are green. Physical-device
confirmation remains the final gate.

## Manual testing

1. Open an existing Codex conversation in the iOS app and let it become idle.
2. Restart the box/server so the webview and Codex process are cold.
3. Send one message immediately from the native composer.
4. Confirm the message confirms within a second or two (no minutes-long
   "Sending message…"), does not return to the composer, and runs exactly
   once — the engine spawn now happens after the ack, so cold start should be
   invisible to the send.
5. If the run fails to start (kill the engine to force it), the failure must
   appear as an error on the turn in chat — never as the text bouncing back
   into the composer.

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

## Superseded fix direction

Same principle the reload-time banner issue lands on, extended to the **live** send
path was to **reconcile against durable chat history, not just the ephemeral receipt.**
Before declaring a send failed (receipt timeout / WS drop), check whether the
message is already present in the conversation history; if it is, confirm it
**silently** — no error, no composer-restore, no Retry. Treat the receipt as an
optimization and history as the source of truth. Only a pending emission with **no**
corresponding history entry is a real failure worth surfacing (and Retry should be
safe only then). Field diagnostics instead showed that the actual outcome was
still pending, so removing elapsed-time verdicts is both narrower and avoids
guessing from possibly stale history.

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
