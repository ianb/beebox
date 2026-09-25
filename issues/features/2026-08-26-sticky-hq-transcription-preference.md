---
title: "Sticky HQ transcription preference — turning HQ dictation on shouldn't be a per-chat ritual"
workstream: hq-settings-broken
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
> **Confirmed 2026-09-20.** The box and landmark writers worked, and
> `chat.newFeatures` resolved their precedence correctly. The failure began
> after a Claude chat was immediately assigned a reserved client id: the reload
> read consulted history, but an unstarted reservation has no history row, so
> inherited `on` silently became the registry default `off`. Pre-start Chat
> toggles lived on that same reservation and were lost by the same read.
>
> A second persistence defect appeared after the first message. The live
> session's `persistPendingFeatures` callback continued diverting toggles into
> the reservation object after the reservation had been released, so the
> history row retained the original seed. Reload then restored that stale
> inherited value.
>
> The fix makes the feature read resolve reservation state first, persisted
> state second, and a non-touching live-session value only for the short
> first-run handoff window. Pending-feature persistence now stops using the
> reservation once its initial feature seed is durable. Regression coverage pins
> box `on` + landmark `inherit`, landmark `on` + Chat `off`, pre-start reload,
> post-start persistence, and persisted state outranking an unloaded live
> session.
>
> Parent-scope edits intentionally seed **new** chats; they do not rewrite an
> already-open chat's per-chat value. One known limitation remains: because an
> unstarted reservation is deliberately process-local, a pre-start Chat
> override can still be lost across a server restart or six-hour reservation
> expiry. Making abandoned-chat state durable (or carrying client state through
> re-reservation) is a separate product decision, not part of this repair.

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
