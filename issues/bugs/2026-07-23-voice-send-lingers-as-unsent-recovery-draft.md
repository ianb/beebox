---
title: "Submitting a voice message leaves it behind as an 'unsent' recoverable draft"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder, repeatedly, sending voice messages
---

After submitting a voice message, it still shows up as an unsent message offered
for recovery. Repeated / reliable, not a one-off.

## Mechanism

The "recover an unsent message" surface restores a **persisted emission draft**
kept in localStorage by `hooks/useEmissionPersistence.ts` (`savePersistedEmission`).
That draft mirrors the emission store: the persist subscriber debounces writes,
and when the draft goes empty (`isEmptyDraft`, `:124`/`:149`) it clears the
persisted copy. So a normal **typed** send works because sending resets the store
to empty → the subscriber removes the persisted draft.

The **voice** send path (`components/chat/InteractiveChat-voice.ts`) dispatches
the emission and calls `clearDraftRef.current()`, but the persisted draft
survives. Two hypotheses, both plausible; a repro is needed to pick:

1. **HQ / narration re-population (leading suspect).** After
   `dispatchEmission(...)` + `clearDraftRef.current()`, the path does
   `composerSend({ type: "START_HQ", text: joinTranscript(priorInput, text) })`
   (`InteractiveChat-voice.ts:137`) — it puts the just-sent text *back* into the
   composer for the high-quality transcription pass. That re-populates the store,
   so the persist subscriber saves the sent text again → it lingers as a
   recoverable "unsent" draft. This fits the earlier report where **narration
   mode was active** in the screenshot. The HQ text is in-flight transcription,
   not an unsent user draft, and shouldn't be persisted as one.
2. **Debounce race.** Persistence writes are debounced (`PERSIST_DEBOUNCE_MS`).
   The pre-send save (fired while dictating) lands; the post-send *clear* is
   scheduled but a reload / the recovery check reads localStorage before it
   flushes. Typed send may dodge this via a synchronous path or timing that voice
   doesn't share.

## Fix direction

- On a voice send, clear the persisted emission the **same way a typed send does**
  and **flush synchronously** (bypass the debounce) so there's no window where the
  sent draft is still on disk.
- Ensure the HQ/narration re-population is **excluded from persistence** — the
  second-pass text is transcription state, not a user draft, so mark it
  non-persistable (or clear the persisted key at send and don't let the HQ
  re-populate rewrite it). This is likely the real fix.
- Check ordering: dispatch → persist-clear(flush) → HQ start, so the HQ text
  can't re-save the persisted draft.

## Repro / verify

Send a voice message (try both narration mode ON and OFF — hypothesis 1 predicts
narration reproduces it, plain voice may not), then reload / reopen and confirm
no unsent-message recovery is offered. This is a good `cb-debug` candidate — the
loop is: dictate → send → inspect the persisted-emission localStorage key (should
be absent/empty immediately after send). Pin which hypothesis before fixing.

Web frontend (the persistence + voice path), not shell-specific — but note the
recovery banner has shown on iOS
([both-composers regression](2026-07-22-ios-both-composers-nativecomposer-flag-lost-on-nav.md)
screenshot), so verify there too.
