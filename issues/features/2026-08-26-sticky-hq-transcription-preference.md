---
title: "Sticky HQ transcription preference — turning HQ dictation on shouldn't be a per-chat ritual"
workstream: transcript-confidence
area: beebox
labels: [voice, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "sticky hq transcription preference"
priority: normal
---

>  **Re-encountered 2026-09-20 — the shipped behavior does not work.** The
> boxholder: "Everything about the hq settings is kind of broken. Doesn't
> inherit. Doesn't stick." The `manual-testing` gate is removed: a recurrence
> means the feature is not merely unverified, it is broken. The manual-testing
> steps below are kept as history and as the shape of a real regression test.
>
> Two symptoms, and a reading of the code found a candidate mechanism for each.
> Neither is confirmed by reproduction.
>
> **Does not stick.** `ChatFeatures.persist`
> (`beebox/src/core/chat/session/features.ts:102-127`) returns without writing
> in two cases: when `getSessionId()` is `null`, and when no engine is recorded
> for the session. A toggle in a chat that has not yet started a session — the
> obvious moment to set it, before dictating the first message — is therefore
> kept in memory only. The second branch logs; the first is silent.
>
> **Does not inherit.** Inheritance is a *seed*, not a resolution:
> `seedFeaturesForNewChat` (`core/landmark/features.ts:98`) merges box default,
> landmark, and request, and it is called only when a chat is created
> (`webapp/trpc/routers/chat-control-procedures.ts:153,390`,
> `webapp/routes/chat-send-target.ts`). Changing a landmark or box default
> therefore cannot reach a chat that already exists, and nothing re-reads it.
> Whether that is the reported failure, or whether the seed is also lost on
> some creation paths, needs reproduction.
>
> `mergeSeedFeatures` (`core/chat/features.ts:120-133`) also drops any value
> that fails `isKnownFeature`/`isValidValue` with no diagnostic, so a malformed
> landmark or box value is indistinguishable from an absent one.

Web support landed in `6410124b5`, but physical-device testing found that the
iOS native composer did not receive or honor the HQ state. Keep this open until
the native Send button and spoken-send paths are bridged and verified.

HQ dictation now has the agreed scope controls: a per-chat value by default,
plus adjacent landmark and box defaults with explicit inheritance. The server
resolves the effective value and remains the source of truth.

The remaining gate is native iOS verification. The web setting, native Send
button, and spoken-send path now share that resolved value; native HQ results
also carry provenance so the persistent `HQ` marker is evidence of the pass,
not merely the client's intent.

## Manual testing

- Install a build containing the native bridge changes, then force-quit and reopen it.
- In a fresh chat, set `Chat: on`, dictate a normal message, and tap Send. Confirm the message keeps the microphone stopped and shows the subtle `HQ` provenance marker.
- Set `Chat: off`, dictate and tap Send, and confirm there is no `HQ` marker.
- Set `Chat: on` again, dictate and say the ordinary send keyword, and confirm the resulting message shows `HQ`.
- Start a brand-new chat while an inherited landmark or box setting resolves to on, then repeat the button test to cover session assignment.
