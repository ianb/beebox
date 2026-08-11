---
title: "Submitting a voice message leaves it behind as an 'unsent' recoverable draft"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder, repeatedly, sending voice messages
---

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
