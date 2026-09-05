---
title: "iOS: a stuck \"Sending message…\" persists across app restarts and doubles on a real send"
workstream: emission-model
area: beebox
labels: [ios, chat, emissions]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder report from the iOS app
design: ../../../beebox/docs/implemented-plans/emission-model.md
resolution: implemented
---

> **Closed 2026-08-24** — the boxholder confirms the behavior has not
> recurred across normal use for a while since the fix landed; calling the
> manual gate met by field exposure rather than a scripted repro.
> **The fix** (as it awaited that testing) — fixes landed in `d641042c`/`c296b95f`
> (state collapse + in-session redelivery + a Restore/Discard affordance
> after 30s pending; requires a fresh app install). See Manual testing.
> Only the developer clears this.

The iOS app shows **"Sending message…"** for a message that is not being sent.
It survives quitting and relaunching the app, and when a real message is then
sent the app shows the row **twice** — the stale one plus the live one.

## Why restarting doesn't clear it

This is durable state doing exactly what it was built to do.
`ios-app/BeeBox/Storage/PendingEmissionStore.swift` persists an ordered,
box-scoped queue *before* webview delivery and replays it after relaunch —
that is the feature that stops a send being lost when the app dies mid-flight.
`NativeComposerView.swift:1391-1398` renders "Sending message…" for two states:

```swift
case .awaitingWebView, .awaitingReceipt:
```

So an emission that never reaches a terminal state is, correctly, replayed
forever. Restarting the app is the one thing guaranteed *not* to help.

## The likely cause, and the missing rule

`.awaitingReceipt` is the suspect: the message was handed to the webview, and
the receipt confirming it never came back. That failure is already documented —
[chat send receipts fail](2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md),
whose reliable trigger is the first send after a cold agent, fixed on the web
side in `3ef82d85`. This issue is what that failure leaves behind on iOS: the
web-side bug produced a lost receipt, and the native queue has no rule for an
emission that waits forever.

The store already has everything needed to write that rule — entries carry
`createdAt` (lines 89, 170) and `markDeliveryAttempt(id:at:)` records each
attempt (line 186). What is missing is a **staleness bound**: nothing ever
concludes that an emission which has been `.awaitingReceipt` for long enough is
not coming back.

There is also already a terminal state with a user-facing affordance —
`.rejected`, which the UI presents with Retry / Restore / Discard. Aging a stuck
pending into `.rejected` would reuse that instead of inventing new UI, and turns
"a spinner that lies forever" into "a decision the user can make."

## What the fix has to get right

- **Aging out must not resurrect a message that actually sent.** The receipt is
  the confirmation, so an emission with no receipt may still have run — the
  same trap `2026-08-03-ios-stale-unconfirmed-emission-banner.md` names, where
  offering Retry on an already-processed message duplicates the turn.
  Reconciling against durable chat history (the fix direction that issue lands
  on) is what makes an expiry safe.
- **What bound?** A receipt that has not arrived in seconds is suspicious; one
  that has survived an app relaunch is conclusive. "Was pending before this
  launch and still is" may be a better signal than any wall-clock timeout, and
  it needs no clock discipline.
- **The doubling is the tell.** Two rows means the queue holds two entries and
  neither is deduplicated against the conversation, so whatever is built should
  make a stale entry visibly different from a live one rather than identical.

## Reproduction

Not yet established deliberately. Given the receipt bug's trigger, the path to
try is: cold box/agent, send from the native composer, and see whether the
resulting emission ever leaves `.awaitingReceipt`.

## What landed (2026-08-18, emission-model workstream)

- The two non-terminal states collapsed to one `pending(deliveryAttempts,
  lastAttemptAt)` (`d641042c`) — persisted legacy entries migrate, keeping
  their attempt count and timestamp.
- A pending emission whose receipt hasn't arrived now **redelivers on
  backoff** (10s/30s/60s, then every 120s) within a live session; the server
  answers idempotently from its dedup claim, so a message that already ran
  resolves as `sent` on the next attempt (`c296b95f`).
- Past 30 seconds pending, the row swaps "Sending message…" for "Still
  waiting for the box to confirm this message." with **Restore / Discard** —
  a user exit that never manufactures a failure verdict.
- Separately, the server now acks a send when it is durably recorded, before
  the engine spawns (`6e928be6`), so the minutes-long cold-start window that
  produced these wedges is gone at the source.

One thing to check **first**: whether the installed phone build predates
`ef20af7f` (2026-08-15) — its relaunch-redelivery alone should have cured a
stuck entry on restart, so a report of one surviving restarts on a current
build would point somewhere new.

## Manual testing

1. Install the current app build.
2. If a stuck "Sending message…" from the old build is still present, it
   should resolve itself (redelivery + dedup) within seconds of opening the
   box, or offer Restore/Discard after 30s.
3. Fresh wedge attempt: put the phone in airplane mode, send from the native
   composer, keep the app open — after ~30s the row must offer
   Restore/Discard; on restoring connectivity the send must complete exactly
   once and the row clear.
4. Confirm no doubled rows when sending a new message while one is pending.
