---
title: "Sent message disappears then reappears ~20s later when an intermediate history snapshot omits it"
workstream: unknown
needs: [manual-testing]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder; got much worse recently
---

> **⏳ Awaiting manual testing** — fix landed in `4ceb0de6`; send typed, capture,
> and voice messages during a long turn and confirm each message stays visible
> through intermediate history updates. Only Ian clears this.

The fix tracks every optimistic send until a new durable history entry echoes that
specific send. It also preserves distinct repeated messages and messages that the
server merges from its queue. The state-machine regression tests reproduce the
clearing `SET_MESSAGES` event and verify that no disappearance gap or duplicate
entry remains. The work did not capture the live source or frequency of the
mid-turn `chat-history` events, so the real browser behavior still needs the check
above.

> **Job to be done:** *When I send a message — a capture, a voice memo, or typed —
> I want to see it stay put in the conversation. Watching it vanish and only
> reappear 20 seconds later makes me think it failed and re-send, or lose trust
> that anything I send sticks.*

Submitting a message (capture, voice, sometimes typing) often makes it **disappear
from the chat and only reappear ~20 seconds later**. The boxholder reports this got
**much worse recently** — which points squarely at a recent change.

## Confirmed regression lead

The chat's history refresh is wrapped in `useDeferredResync`
(`src/frontend/src/components/chat/InteractiveChat-ws.ts:177` —
`const triggerRefresh = useDeferredResync(useCallback(...))`), which **parks a
resync while `document.hidden` and only fires it when the tab becomes visible
again** (`src/frontend/src/lib/deferred-resync.ts`). That deferral was **added in
`add0c339`** ("fix(chat): client-side refetch storm + background-tab quiescence"),
one of the recent chat-OOM fixes.

Capture and voice **briefly background the tab / webview** (camera, mic,
app-switch), so at send time `document.hidden` is often true. The post-turn refresh
that would render the durable message is therefore **parked** — the optimistic /
streamed message is cleared on the assumption the refresh runs promptly (the chat
finalize contract: `streamText` survives only *until* the authoritative history
lands, then one `assign` swaps it in — see `components/chat/CLAUDE.md`), but that
refresh is deferred, so there's a **gap** where the message is simply gone. It
reappears when the tab is foregrounded and the parked refresh finally fires (~20s =
however long until the tab is visible again). Typing is affected less because it
doesn't background the tab — matching "maybe typing too".

So background-tab quiescence — right for *reactive* background refetches (a hidden
tab shouldn't poll) — is **too aggressive for the reconcile of a message the user
just actively sent**.

## Fix direction

The refresh that renders a **just-sent** message must not be deferred by visibility
— the user acted, show their message. Options (compose):

- Don't route the post-send / turn-finalize refresh through `useDeferredResync`'s
  visibility park; only *reactive/reconnect* refetches should be parked. (The
  deferred-resync's `alwaysVisible` escape hatch, `deferred-resync.ts:48`, may be
  exactly this — a user-initiated send resyncs regardless of visibility.)
- And/or keep the optimistic / pending message visible until *its own* durable
  entry actually lands (`reconcilePending`, `machines/chatMachine.ts`), so a
  deferred refresh can't produce a disappear-gap — the optimistic stays put until
  replaced, never cleared into a void.

## Verify

`deferred-resync` already has a doctest with a **fake tab-visibility timeline**
(`test/frontend/lib/deferred-resync.doctest.md`) — reuse it: send while hidden,
assert the just-sent message stays visible / its refresh isn't parked, while a
reactive background refetch still is. Reproduce the disappear before fixing.

## Related

- [chat-send-receipts-fail-often…](2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md)
  — same optimistic-message-vs-durable-history-timing family; this is the specific
  deferred-resync mechanism.
- `add0c339` / `546310cb` — the OOM/refetch-storm fixes this regressed out of.
- `components/chat/CLAUDE.md` — the streaming→finalize "streamText survives until
  history lands" invariant the deferral breaks.

## Correction (2026-08-06) — the deferred-resync hypothesis is likely WRONG

Boxholder reports it happens **a lot and WITHOUT any tab change** — so the tab is
visible throughout, which rules out the `useDeferredResync` visibility-*park* as the
cause. And on inspection the post-turn refreshes don't go through the deferred/gated
path at all:

- `chat-complete` → **direct** `send({ type: "REFRESH" })` (`InteractiveChat-ws.ts:216`).
- server-injected `<capture>`/`<upload>` (`userMessage.user === null`) → **direct**
  `send({ type: "REFRESH" })` (`:231`).
- only the **reconnect** path (`onConnect` → `notifyReconnect(triggerRefresh)`) is
  deferred/gated, and `PROMPT_SUBSCRIPTION_MS` is **5000ms**, not ~20s.

So the delay is not a deferred refresh. The likelier shape: the optimistic/pending
message shows on send, then an **intermediate `SET_MESSAGES`/`REFRESH`** (a mid-turn
`chat-history` event, or a reconnect-driven REFRESH) lands *server* history that does
**not yet contain the just-sent message** — and `reconcilePending`
(`machines/chatMachine.ts`, the guard added at ~:262 to "keep the optimistic message
visible") **fails to protect it**, so it disappears. It reappears when `chat-complete`
fires at turn end (~20s ≈ the turn duration) and its REFRESH lands the durable entry.

Corrected fix direction: make the optimistic/pending message **survive any
`SET_MESSAGES`/`REFRESH` until its OWN durable entry is present** — i.e. fix
`reconcilePending` to keep an un-echoed pending message rather than dropping it when
an intermediate server-history snapshot omits it. Then no intermediate refresh (from
any source) can open a disappear-gap, regardless of timing. Confirm the exact clearing
event by instrumentation before fixing (cb-debug).
