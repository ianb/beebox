---
title: "Submitting a voice message leaves it behind as an 'unsent' recoverable draft"
workstream: emission-model
needs: [manual-testing]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder, repeatedly, sending voice messages
priority: important
design: ../../callback-box/docs/plans/emission-model.md
---

> **⏳ Awaiting manual testing** — fix landed in the emission-model
> workstream (track C): an emptied composer now removes the persisted draft
> synchronously (no 400ms debounce window), and the persist scheduler
> flushes instead of dropping a pending write on unmount. See Manual
> testing. Only the developer clears this.

## Manual testing

1. Dictate a message and send it.
2. Immediately (within half a second) switch session/landmark/route.
3. Return: no unsent-message recovery may be offered.
4. Stronger check: right after the send, read
   `localStorage["cb-input-emission:<box>"]` in devtools — the key must be
   gone, not merely blanked.
5. Confirm ordinary draft persistence still works: type without sending,
   reload the tab, and the draft is offered back.

> **Checked 2026-08-14 — not a duplicate.** Tagged `duplicate`; removed, and
> the issue stays open. The nearest neighbour,
> [chat send receipts fail often](2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md),
> already cross-links this one as a *sibling* rather than the same bug, and the
> root causes differ: that one is the live-send receipt model (WS drop,
> reconnect churn, `/api/chat/send` settling); this one is the recovery-draft
> feature's persistence race.
> [iOS stale unconfirmed emission banner](2026-08-03-ios-stale-unconfirmed-emission-banner.md)
> is the same receipt family again but native `PendingEmissionStore`, unrelated
> to the web `usePersistScheduler` path.
> `closed/bugs/2026-08-05-recovered-dictation-needs-minimum-size.md` touches the
> same component but fixed a different defect (no size floor), in `efbf701a`.
>
> The mechanism described below was re-verified as still present:
> `usePersistScheduler.ts:60-66` flushes only on `visibilitychange → hidden`,
> and its effect cleanup removes the listener without flushing.

After submitting a voice message, it still shows up as an unsent message offered
for recovery. Repeated / reliable, not a one-off.

## Mechanism (confirmed — the persisted clear is debounced and dropped on quick navigation)

Boxholder's key observation: *"it's if I navigate away too quickly after
finishing. But the message is sent and I can see it's sent, so it's just too
conservative about deciding it's been sent."* That pins it.

The "recover an unsent message" surface restores a **persisted emission draft**
kept in localStorage by `hooks/useEmissionPersistence.ts`. Writes are
**debounced** via `hooks/usePersistScheduler.ts`, which flushes synchronously
**only on `visibilitychange` → hidden** (tab-hide / app-switch) — and its cleanup
merely removes that listener; **there is no flush on unmount or in-app
navigation** (`usePersistScheduler.ts:60-63`).

The sequence:

1. Dictating → a debounced save persists the draft to localStorage.
2. Send → the store resets to empty → a debounced *clear* (empty-draft →
   remove persisted) is **scheduled**, not run.
3. You navigate away (a route change — the tab stays *visible*, so it is NOT a
   tab-hide) before `PERSIST_DEBOUNCE_MS` elapses → the component unmounts / the
   store instance changes and the pending debounced clear is **canceled, never
   flushed**.
4. The dictation-time draft from step 1 survives on disk → recovery offers it as
   "unsent," even though the message went through fine.

So the send is correct; the clear-on-send just loses a race with navigation
because it's debounced and only flushes on tab-hide, not on nav/unmount. Typed
send hits the same code but you rarely navigate away in the debounce window right
after typing; voice + "send and immediately move on" hits it constantly.

## Fix direction

- **Clear the persisted draft synchronously on send** — an empty-draft-after-send
  is a definitive event, not keystroke-frequency; it should bypass the debounce
  and `removePersistedEmission` *now*. (Debounce is for the save-while-typing
  case, not the clear.)
- And/or **flush pending writes on unmount and on in-app navigation**, not only on
  tab-hide — add a flush to the scheduler's cleanup (`usePersistScheduler.ts:63`)
  so a scheduled clear can't be silently dropped.
- The synchronous-clear-on-send is the smaller, more targeted fix and makes
  navigation timing irrelevant.

(The earlier HQ/narration-re-population theory is a possible secondary
contributor but not the cause the boxholder describes — the message *is* sent and
visible; it's purely the persisted-draft clear not landing before navigation.)

## Repro / verify

Dictate → send → **immediately navigate away** (switch session/landmark/route)
within the debounce window → return and confirm no unsent-message recovery is
offered. Good `cb-debug` loop: after send-then-nav, the persisted-emission
localStorage key should be gone. Then confirm the tab-hide flush and normal
persistence still work.

Web frontend (persistence + scheduler), not shell-specific — but the recovery
banner has shown on iOS
([both-composers regression](../closed/bugs/2026-07-22-ios-both-composers-nativecomposer-flag-lost-on-nav.md)
screenshot), so verify there too.
