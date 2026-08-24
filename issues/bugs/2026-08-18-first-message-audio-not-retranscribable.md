---
title: "The first message of a chat can't have its audio retranscribed"
workstream: unattached
area: callback-box
labels: [chat, voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed retranscribe failing on first messages
---

> **Checked 2026-08-18 — could not settle from here; worth a re-test.** Tagged
> `reconfirm`; removed. Confirming or refuting this needs someone to dictate a
> first message and try retranscribing it — an agent cannot produce speech into
> a live box, so this is genuinely a human check rather than one nobody has got
> to.
>
> What changed since filing, and why a re-test is worth doing rather than
> assuming: the cold-start handoff this issue blames has been substantially
> rebuilt. `6e928be6` now acknowledges a send **when it is durably recorded,
> rather than when the engine starts**, and `1110b7b5` gave send acceptance one
> durability point. If the recording was being lost in the gap between
> composing and an established session, that gap is materially different now.
>
> The audio-cache path itself is untouched apart from `a988e2aa` (the error
> wording), so nothing has *deliberately* fixed this — but the surrounding
> transition has moved enough that the old observation may no longer hold.

Retranscription appears to fail on the **first message sent to a chat**, while
later messages in the same conversation work. The boxholder's read: the audio is
"probably lost in the transition" — the handoff from composing/sending into an
established session.

**Unverified.** Nobody has reproduced this deliberately or traced where the
recording goes; the observation is from ordinary use. Reproduce before fixing —
the mechanism below is a hypothesis, not a finding.

## Why it matters more than one missing recording

The failure teaches the wrong lesson. An agent that tries to retranscribe the
first message, fails, and concludes *"audio retranscription doesn't work here"*
will not try again for the rest of the conversation — including on every later
message that would have succeeded. One missing recording turns into a
capability the agent has written off.

That is what makes a first-message-specific failure worse than a random one: the
first message is the one an agent is most likely to reach for, because it is
often where the request being clarified was made.

## Mitigated already (2026-08-18), but not fixed

The blast radius was reduced without touching the cause:

- `src/webapp/routes/chat-last-audio-routes.ts` — the `no-audio` 404 now says
  the miss is about *this* message and that other messages in the conversation
  may still have audio, rather than "no recording is cached for the last
  message". The `no-client` 504 likewise now names itself as transient.
- `src/core/chat/session/prompts.ts` — the chat prompt states that a failure is
  about one recording rather than the capability, and calls out the first
  message specifically as the likely miss.

Both are about how the failure *reads*. The recording is still missing.

## Research (2026-08-18)

Traced the answer path. Retranscription is served by a **per-tab, memory-only
retention store**: `src/frontend/src/lib/audio/last-audio.ts:10-12` —
"Recordings live only in this tab's memory (gone on reload)", capacity 5
(`RETENTION_CAPACITY`, line 33). `cb chat get-last-audio` long-polls
(`src/webapp/routes/chat-last-audio-routes.ts`), the server broadcasts a bus
event, and connected tabs answer from that store. Two distinct mechanisms
fall out:

1. **Native iOS voice sends can never be retranscribed.** The recording is
   captured natively, HQ-transcribed through the stateless
   `/api/chat/transcribe-audio` endpoint (nothing retains the upload —
   `src/webapp/routes/chat-audio-routes.ts`), and the native audio file is
   then deleted (`ios-app/CallbackBox/Views/NativeComposerView.swift:496-498,
   525-527`). The emission crosses the bridge as text (Emission V2 has no
   audio field), so the web tab's retention store never holds the blob — and
   never even gets a tombstone. Every native voice message answers
   `no-audio`, with a message that wrongly suggests "it was typed" or a
   reload is to blame. This is not a first-message quirk; it is the whole
   native composer.
2. **Web voice sends lose retention on any document reload.** The store is
   module-level page memory. The cold-start first send, provisional
   navigation churn, and the iOS content-process-termination reload
   (`ChatWebView.swift` — `webViewWebContentProcessDidTerminate` calls
   `webView.reload()`) all wipe it. This produces exactly the
   "first message fails, later ones work" pattern, and ties this issue to
   the same cold-start/navigation transition as
   [chat send receipts fail](../closed/bugs/2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md).

So "first message" is a proxy axis: the real axes are *which composer
recorded it* (native = always lost today) and *whether the document reloaded
since* (web = lost on reload). A fix direction worth designing rather than
patching: the pending-emission ID exists **before** HQ transcription
(`stageVoicePreparation` creates it), so the transcribe upload could carry
the emission ID and the server could retain the recording keyed by message
ID for a bounded window — making retranscription server-answerable and
removing the tab-lifetime dependency for both composers. That is a
mobile-contract change and belongs with the emission-model plan
(`../../callback-box/docs/implemented-plans/emission-model.md`), not a drive-by.

## What to actually investigate

- **Where the first message's audio is supposed to be cached**, and whether it
  is ever written. The fetch is a loopback long-poll answered by a connected
  chat tab (`chat-last-audio-routes.ts`, `core/last-audio-pending.ts`), so the
  question is whether the tab holds the blob for a message it sent before the
  session existed.
- **Whether "first message" is really the axis**, or whether the true axis is
  something correlated with it — a tab that reloaded on send, a session that was
  created by the send itself, a navigation between composing and the established
  conversation. The 404's own wording ("recorded before the chat tab was last
  loaded") suggests a reload is the mechanism, which would make this about
  *tab lifetime*, not message ordering.
- **Whether the retention/tombstone path is involved** —
  `test/frontend/lib/retention.doctest.md` already models a null-payload
  "no-audio tombstone", so there is existing vocabulary for a recording that is
  known-absent rather than merely missing.

## Related

The cold-start family this may belong to:
[chat send receipts fail](../closed/bugs/2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md)
— the first send after a cold agent races its own receipt. If the first
message's audio is lost during the same transition, these are two symptoms of
one under-specified handoff, and worth investigating together rather than
separately.
