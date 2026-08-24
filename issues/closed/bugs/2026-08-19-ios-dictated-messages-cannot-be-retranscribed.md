---
title: "Messages dictated in the iOS app can never be retranscribed"
workstream: ios-retranscribe
area: callback-box
labels: [chat, voice, transcription, ios]
design: ../../../callback-box/docs/implemented-plans/ios-audio-retranscription.md
filed-by: agent
discovered-by: Ian
discovered-in: worktree-ios-retranscribe — spun off to make retranscription work on iOS
resolution: implemented
---

`cb chat retranscribe --message <id>` and `cb chat ask-about-audio` always fail
for a message dictated in the native iOS composer. Not sometimes — structurally,
every time. The failure is not a bug in the retranscribe path; it is that
nothing on the iOS send path ever puts the recording anywhere the retranscribe
path can reach.

This was already noted as mechanism 1 of
[the first-message issue](../../bugs/2026-08-18-first-message-audio-not-retranscribable.md);
this item is the iOS half, given its own home because the fix is a separate
decision (that issue's other mechanism — web retention dying on reload — is
independent).

## Traced 2026-08-19 — confirmed, with one correction

Verified by reading the code, not by running it (see *Testing reality* below).

**The answer path is web-only.** `cb chat retranscribe` long-polls
`/api/chat/last-audio/request`, which emits `chat-last-audio-request` on the
event bus; connected chat tabs answer from
`callback-box/src/frontend/src/lib/audio/last-audio.ts`, a per-tab in-memory
`RetentionStore` keyed by emission id. `grep -rn "last-audio\|lastAudio\|retranscri" ios-app/`
returns nothing: the native app does not participate at all.

**Native emissions never reach that store.** The web recorder retains at
`InteractiveChat-voice.ts:126`; the two audio-less web send paths tombstone at
`InteractiveChat-dispatch.ts:102,132`. `dispatchNativeEmission`
(`InteractiveChat-dispatch.ts:88`) does neither — a native emission arrives over
the bridge as text (Emission V2 has no audio field), so `retention.get(messageId)`
returns `undefined`, the tab answers `{none: true}`, and the CLI gets the 404
`no-audio` — whose wording ("it was typed, or its audio predates the chat tab's
current load") is misleading here, since neither is true.

**The recording is deleted on the device, on both send shapes.**
`NativeComposerView.sendKeywordIntent` takes the WAV via
`dictation.consumeRecordedAudioURL()` (`:551`) and then:

- `.live` — deletes it immediately (`:559`). It is never uploaded anywhere.
- `.hq` — copies it to `voice-<id>.wav` via `stageVoicePreparation`, deletes the
  temp original (`:588`), uploads it to `/api/chat/transcribe-audio` for the HQ
  pass, and deletes the copy once the message is enqueued
  (`PendingEmissionStore.swift:146`). The server does not persist the upload —
  `chat-audio-routes.ts` transcribes the buffer and drops it.

**Correction to the fix direction sketched in the first-message issue.** That
issue proposes carrying the emission id on the `/api/chat/transcribe-audio`
upload so the server can retain the bytes keyed by message id. That works — but
it only covers `.hq` sends. `NativeVoiceKeywordSendPlan.make`
(`SpeechKeywords.swift:365`) chooses `.hq` only when narration mode is on or the
keyword was the explicit HQ variant; the ordinary send with narration off is
`.live`. So the transcribe-upload hook covers exactly the messages that already
have a high-quality transcript, and misses the ones retranscription exists
for — `chat-audio.ts`'s own description says retranscribe is "for when narration
mode was off, so the message committed with the realtime transcript, and that
transcript looks wrong."

Any fix has to cover `.live` sends, where today the audio exists only as a temp
file for the few milliseconds between keyword-fire and `removeItem`.

## The shape of the decision

The web model is "the tab that recorded it still holds it in memory." That model
does not survive a native shell. Three directions, materially different:

1. **Native retains and answers the long-poll.** iOS keeps the WAV on disk keyed
   by emission id under a bounded policy, the web layer relays
   `chat-last-audio-request` to native over the existing command bridge
   (`native-composer-command.ts` already carries web→native commands with
   acknowledgements; it has one `kind` today), and native uploads to
   `/api/chat/last-audio/:requestId`. Costs no bytes unless an agent asks.
   Survives app relaunch and the WKWebView content-process reload — strictly
   better retention than the web tab has. Requires the app to be reachable
   within the long-poll window (10s default, 30s max), so it fails when the
   phone is asleep, which is much of when agents run.
2. **Upload the audio at send.** The server retains bytes keyed by message id
   for a bounded window; retranscribe reads them with no client present. This is
   the only option that also fixes retranscribing an old message, from a device
   that never recorded it, after a reload — and it fixes the web-reload half of
   the first-message issue too. Costs bandwidth (the WAV is uncompressed at the
   input node's format — on the order of MB per minute of speech, on cellular),
   storage, and puts recordings at rest on the box, which a memory-only cache
   never did.
3. **In between** — retain natively, upload lazily on request, plus a durable
   server-side fallback for the asleep-phone case.

Whether durable server-side audio is *wanted* is a real question with privacy and
storage consequences, not an implementation detail.

**Decided 2026-08-19 (boxholder): option 1.** Audio stays on the device and is
handed over only when an agent asks; nothing sits at rest on the box. The at-rest
question is parked rather than settled — option 2 remains available later for the
asleep-phone case without invalidating option 1. Design:
[iOS audio retranscription](../../../callback-box/docs/implemented-plans/ios-audio-retranscription.md).

## Testing reality

An agent cannot produce speech into a live box. Confirming the failure, and any
fix, needs someone to dictate a message on a phone and run one retranscribe.
Everything above is read off the code; nothing here has been observed running.

## Manual testing — done, 2026-08-19

**Verified on a physical device by the boxholder.** The app was reinstalled with
the fix, a message was dictated in the native composer, and retranscription
returned a transcript. That is the check this issue was held open for, and it is
the only one an agent could not run.

The fix (Track 1-3 of the design doc) is implemented, typechecked, linted, and
covered by XCTest + doctest + simulator UI tests — all green. None of that
exercises a real device.

**What to try:** on a phone with this build installed, dictate one message in
the iOS composer with narration off (an ordinary `.live` send, not the HQ
variant), then run `cb chat retranscribe --message <id>` against it from an
agent or the CLI.

**Expected:** a transcript comes back. **Today's failure mode:** "No recording
is cached for this message."

Known, deliberate limits (not bugs to chase if hit): a phone unreachable within
the long-poll window (10s default, 30s max) still can't answer; recordings made
before this ships are unrecoverable; this does nothing on an already-installed
build that predates it.

## Related

- [The first message of a chat can't have its audio retranscribed](../../bugs/2026-08-18-first-message-audio-not-retranscribable.md)
  — the same "who holds the bytes" question on the web side.
- [Show retranscription in chat](../../features/2026-08-12-show-retranscription-in-chat.md)
  and [Mark low-confidence words in transcripts](../features/2026-08-15-mark-low-confidence-words-in-transcripts.md)
  — both `transcript-confidence`, both about surfacing transcript quality. A fix
  here should feed those rather than grow a parallel display.
- `callback-box/docs/mobile-contract.md` — where a new native duty gets written
  down once decided.
