---
title: "On-device HQ for iOS quick chat thoughts"
status: active
workstream: hq-always
issues:
  - ../../../issues/features/2026-10-09-ios-quick-chat-on-device-hq.md
---
# On-device HQ for iOS quick chat thoughts

Every dictated conversation message gets the HQ pass
([hq-always](hq-always.md)). The iOS box-screen quick chat composer is the one
dictation path still on live text. This plan runs Apple's on-device
`SpeechTranscriber` over a dictated quick chat thought before it is stored,
and tells the box which text it got, so the box marks only live thoughts
`stt="live"`.

**Issues addressed:** `issues/features/2026-10-09-ios-quick-chat-on-device-hq.md`.
Searched `issues/` for "quick chat" and "box screen" HQ items: no other.

## Design

### Situations

- When Priya dictates "remind me to call Odette about the 14th" on the box
  screen while walking, I want the name and date right, so I can trust the
  thought without opening it.
- When the phone cannot run the pass (iOS before 26, language files missing,
  the pass times out), I want the thought to go anyway, so a quick thought is
  never stuck.
- When Priya types a thought, nothing changes.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Dictated thought, send | act: run the pass, then store | composer status "Transcribing…" while it runs | waits to be found |
| Pass skipped or failed | act: store the live text | none beyond today's | quiet |
| Typed thought | quiet | — | — |

### Spirit

- **Serves:** "Messy is fine" — the box does its best with the input; the
  better transcript costs the phone a few seconds and no money.
- **Risks:** "It should feel possible" — a quick thought that hesitates.
  Guard: the pass is bounded (`OnDeviceHqTranscriber`, twice the audio length,
  30 s minimum) and falls back to live text.

### Trust

Takes no new action; the thought goes where it went before.

### When it goes wrong or does nothing

The pass is skipped (old iOS, no assets, unsupported locale, empty result,
timeout, error): the live text is stored, as today, and the box marks it
`stt="live"`. The app is killed during the pass: the draft is still in the
composer (it clears only after the outbox stores the thought).

### Walkthrough

Priya says "remind me to call Odette about the fourteenth send message". The
spotter fires a send. The composer shows "Transcribing…" and disables Send.
`OnDeviceHqTranscriber` returns "Remind me to call Odette about the 14th. Send
message." The resolver turns the trailing command into the send tag. The
outbox stores `{text, origin: voice, hqService: "apple-speech-transcriber"}`
and the draft clears. `quickChat.submit` carries `hqService`; the box frames
the thought as `<speech source="box-screen" stt-service="apple-speech-transcriber">`.

## Smallest fix and budget

Smallest fix: run the pass and send its text with no provenance field; the box
would keep marking every dictated thought `stt="live"`, which would then be
false. The chosen design adds one optional field end to end. Estimate: ~90
Swift source lines, ~20 TypeScript source lines, ~80 test lines; contract doc
§5.11 updated.

## Stated preferences this plan trades against

- Boxholder (2026-10-10): "especially on ios the hq transcription is cheap, and
  it should use it." Waiting seconds for a quick thought is accepted.
- hq-always marker rule: `stt="live"` marks live text; HQ text carries only
  `stt-service`. Quick chat follows it.
- `feedback_minimal_concepts_prefer_primitives`: reuse the native emission's
  provenance name, `hqService`, rather than a new field name.

## What already exists

- `NativeComposerSubmitTarget.voicePolicy` (`ios-app/BeeBox/Views/NativeComposerView.swift:18`)
  gives quick chat `sendsToConversation: false`, and
  `highQualityTranscription` is `sendsToConversation`. Change it to true for
  both targets.
- The send button and `sendKeywordIntent` already build
  `.voicePreparation(liveTranscript:priorInput:action:matchedPhrase:appendsKeywordTag:audioURL:closeMicrophone:)`
  when HQ is on (`NativeComposerView.swift`, `send()` and `sendKeywordIntent`).
  Quick chat currently treats that case as *"Unreachable"* in `submit(_:)`.
  Reuse the submission as is.
- `OnDeviceHqTranscriber.transcribe(fileURL:locale:diarizationRequested:)`
  (`Services/OnDeviceHqTranscriber.swift`) throws a `Skip` for every reason it
  did not produce text. Reuse with `diarizationRequested: false`.
- `VoicePreparationResolver.text(for:hqTranscript:)`
  (`Services/SpeechKeywords.swift`) applies the keyword rule (same command →
  tag, else `heard="live"`). Extract its body into a function over plain
  fields so quick chat can call it without a `VoicePreparation`.
- Quick chat delivery: `submitQuickChat` (`NativeComposerView.swift`) →
  closure → `BoxScreenStore.submitThought` (`Storage/BoxScreenStore.swift:297`)
  → `QuickChatOutbox` entry (`Storage/QuickChatOutbox.swift:13`) →
  `QuickChatAPI.submit` (`Services/QuickChatAPI.swift:30`) →
  `quickChat.submit` (`beebox/src/webapp/trpc/routers/quick-chat.ts:21`) →
  record (`beebox/src/core/chat/routing/quick-chat-record.ts`) → delivery
  framing (`quick-chat.ts:59`).

## Prior art (external)

No decision depends on an external premise beyond `SpeechTranscriber`, which
the shipped on-device HQ work already uses.

## Ontology

- **`hqService`** — existing name (native emission V2,
  `docs/mobile-contract.md` §4.2): the engine that produced HQ text. New on
  the quick chat outbox entry, `quickChat.submit` input, and record. Absent
  means live text. Valid only with `origin: "voice"`.
- **Quick chat thought** — existing (`QuickChatOutboxEntry`, `QuickChatRecord`).

## Tracks / scope

### 1. Box: accept and frame `hqService`

- **Direction:** `quickChatSubmitInput` gains `hqService` (optional string,
  `/^[a-z0-9-]{1,64}$/`, rejected unless `origin: "voice"`). The record's base
  shape gains `hqService` optional. Delivery frames a voice thought as
  `<speech source="box-screen" stt-service="…">` when present, else
  `stt="live"` as today. A repeated submit of a stored id keeps the stored
  value, as `origin` does.
- **First chunk:** schema, submit plumbing, framing, doctest in
  `test/webapp/trpc/routers/quick-chat.submit.doctest.md`.

### 2. iOS: run the pass, carry `hqService`

- **Direction:**
  - `voicePolicy` gives both targets HQ; `keywordSendPlan` returns `.hq` for
    both. `keywordSendClosesMicrophone` is unchanged.
  - Quick chat's `.voicePreparation` case: show "Transcribing…", run
    `OnDeviceHqTranscriber` on the recording, resolve the text with the shared
    keyword rule, then deliver `{text, origin: .voice, hqService}`; on any
    `Skip`, deliver the live transcript with no `hqService`. Delete the
    recording after.
  - The quick chat closure takes a `QuickChatThought { text, origin,
    hqService }`. `submitThought`, `QuickChatOutboxEntry` (decode-if-present),
    and `QuickChatAPI.submit` carry `hqService`.
- **First chunk:** resolver extraction + policy change with XCTest updates.

## Could this be simpler?

The simplest version skips the field and leaves the box marking every
dictated thought live; it fails the hq-always marker rule (the agent would be
told HQ text is rough). Adding the field to the existing quick chat path
reuses the existing name and the existing `.voicePreparation` submission.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Pass skipped (old iOS, assets, locale, timeout, empty) | planned (XCTest on the resolver/fallback seam) | `Skip` → live text, no `hqService` | quiet, marked `stt="live"` |
| Client sends `hqService` on a typed thought | planned (doctest) | input refine rejects | clear (BAD_REQUEST) |
| Hostile `hqService` value breaks the wrapper attribute | planned (doctest) | regex | clear |
| Older outbox entries without the field | planned (XCTest decode) | `decodeIfPresent` | compatible |
| Older box without the field | doctest shows the current schema strips an unknown key | ignored; the thought is framed `stt="live"` until the box updates | quiet, transitional |
| App killed during the pass | no | draft clears only after store | the thought stays in the composer |

## Agent-flow / user-flow edge cases

- Wrong tag — ADDRESSED: same `stt`/`stt-service` vocabulary as chat.
- Fabricated value — ADDRESSED: the value comes from the client's own pass.
- Transition state — ADDRESSED: an old box ignores the field (Open design
  questions).

## NOT in scope

- Server HQ for quick chat: no recording reaches the box.
- A web box-screen dictation path: none exists.
- Siri/App Intents (`origin: "external"`): no audio.

## Open design questions

None. Settled: a new phone on an old box sends `hqService`, which the old
`quickChatSubmitInput` (`z.object`, default strip) drops; the thought is
framed `stt="live"` until the box updates. No version gate.

## Knowledge audits

None: the agent-facing vocabulary (`stt="live"`, `stt-service`) is unchanged
and already audited (`chat-live-transcript-marker`).

## What will hold this after it ships

`quick-chat.submit.doctest.md` for framing and validation; XCTest for the
resolver extraction, the policy change, and outbox decoding. The on-device
pass itself only runs on an iOS 26 device: manual test.

## Implementation order

1. Box: schema, submit, framing, doctest, contract §5.11.
2. iOS: resolver extraction and policy, XCTest.
3. iOS: quick chat pass, `QuickChatThought`, outbox, API; XCTest; simulator build.

## Rollout shape

Done when the quick chat doctest and the iOS XCTest suite pass, the simulator
build is green, and cross-model diff review is adjudicated. Manual device
test on the issue. No migration: every new field is optional.
