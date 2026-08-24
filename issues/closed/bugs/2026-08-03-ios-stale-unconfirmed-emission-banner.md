---
title: "iOS: a stale 'chat did not confirm the message' banner (with a duplicating Retry) survives when the send actually went through"
workstream: emission-model
area: callback-box
filed-by: agent
discovered-in: main session — boxholder saw the banner without composing anything
priority: important
design: ../../../callback-box/docs/implemented-plans/emission-model.md
resolution: implemented
---

> **Closed 2026-08-24** — the boxholder confirms the behavior has not
> recurred across normal use for a while since the fix landed; calling the
> manual gate met by field exposure rather than a scripted repro.
> **⏳ Awaiting manual testing** — resolved by the emission-model workstream
> rather than by the history-reconciliation this issue proposed (see the
> plan's "Why 'reconcile against durable history' is not the design"):
> history has no message-id to match on; instead the server's durable dedup
> claim answers redelivery idempotently. Since `ef20af7f` (7-day claim) plus
> `c296b95f` (automatic redelivery; the long-pending affordance offers
> Restore/Discard, deliberately no Retry), a replayed pending emission
> resolves itself against the server, and re-sending an already-run message
> answers `deduplicated` instead of running the turn twice. The quoted
> banner string no longer exists in the app (the UI is the generic
> `.rejected` presentation). See Manual testing. Only the developer clears
> this.

## Manual testing

1. With a message pending (e.g. sent while offline), quit and relaunch the
   app, then restore connectivity.
2. The pending emission must resolve itself without any "not confirmed"
   presentation — and without the turn running twice.
3. If a pending row does reach the 30s Restore/Discard affordance, confirm
   it offers no Retry, and that Discard removes it cleanly.

The iOS banner **"The chat did not confirm the message. Try sending it again."**
(`ios-app/CallbackBox/Views/ChatWebView.swift:454`, with Retry / Restore / Discard)
appears **even when the user has not just composed or sent anything** — and even when
the message it refers to actually **did** process (the agent's completed reply was
visible in the same view when the boxholder hit it).

## Cause

The iOS app tracks each send as a **pending emission** (`PendingEmissionStore.swift`,
`Models/ComposerDraft.swift` `PendingEmissionState`). It **persists** pending
emissions and restores them on load (`loadPendingEmissions(boxID:)`), and it clears a
pending emission **only** on an explicit `NativeEmissionReceipt`
(`handleReceipt`, `PendingEmissionStore.swift:203`). There is **no reconciliation
against the durable chat history**.

So if the receipt is lost — box cold/slow, a network blip, the reconnect churn behind
the other "not confirmed" errors — **but the message actually processed** (the turn
ran and the reply landed), the pending emission is never cleared. On reopening the
box it is restored and the banner shows, spuriously, with no fresh send.

## Why it matters: the Retry is a trap

The offered **Retry re-sends** a message that already went through, so it **duplicates
the turn** (the agent redoes the work, and a duplicate `chat-user-message` lands — the
same duplication risk as the server-side send path,
[intermittent-spawn-ebadf-sdk-chat-run](2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md)).
When the turn is visibly complete the correct action is Discard, but the UI offers and
even emphasises Retry — the app can't tell the difference because it never checks
history.

## Fix direction

Reconcile pending emissions against durable chat history, not just the ephemeral
receipt. On load / on a history refresh, if a pending emission's message is already
present in the conversation (the turn completed), **clear it silently** — no banner,
no duplicating Retry. Treat the receipt as an optimization and history as the source
of truth. Only a pending emission with no corresponding message in history is a real
"not confirmed" worth surfacing.

## Related

- [intermittent-spawn-ebadf-sdk-chat-run](2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md)
  — the server-side half of the same "processed but not confirmed → duplicate on
  retry" family, being worked in `worktree-cbserve-fd-leak`. This iOS reconciliation
  is the client half.
- cb-ios-overlap: the native emission path mirrors the web emission path
  (`components/chat/native-emission.ts`); a fix should keep them consistent.
  `docs/mobile-contract.md` governs the receipt contract.
