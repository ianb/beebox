---
title: "Sticky HQ dictation on iOS"
status: active
workstream: transcript-confidence
issues:
  - ../../../issues/features/2026-08-26-sticky-hq-transcription-preference.md
---
# Sticky HQ dictation on iOS

When HQ dictation is enabled for a chat, the native iOS composer must use the HQ transcription pass for every voice-send path, just as the web composer does.

**Issues addressed:** `2026-08-26-sticky-hq-transcription-preference.md`.

## Stated preferences this plan trades against

The boxholder requires the setting to work on iOS. The existing mobile contract requires web/native wire changes to update both implementations and `docs/mobile-contract.md`. Existing guidance requires every voice failure or feature to cover button Send and spoken-keyword sends.

## What already exists

- `src/frontend/src/components/chat/use-native-bridge.ts:68` posts narration state to native. Reuse that one-way state pattern for HQ.
- `ios-app/CallbackBox/Views/ChatWebView.swift:702` decodes narration state and passes it to `RootView`. Mirror this path for HQ.
- `ios-app/CallbackBox/Views/NativeComposerView.swift:629` chooses live versus HQ for spoken sends, but only from narration or explicit `sendHq`.
- `ios-app/CallbackBox/Views/NativeComposerView.swift:541` sends the native button path directly from the live transcript. Route voice-origin sends through durable HQ preparation when HQ is enabled.
- `ios-app/CallbackBox/Storage/PendingEmissionStore.swift:63` persists HQ preparation before transcription. Reuse it so app suspension does not lose a send.

## Prior art (external)

No external protocol is involved. The shipped narration bridge and durable native voice-preparation pipeline are the applicable prior art.

## Tracks / scope

### 1. Bridge the resolved session state

Add `callbackboxHqDictationState` with `{ enabled: boolean }`. The web posts whenever the resolved chat feature or session identity changes. `ChatWebView` decodes it, `RootView` resets it on session/box changes, and `NativeComposerView` receives it.

First implementation chunk: bridge, contract documentation, TypeScript doctest, and Swift decoder tests.

### 2. Honor HQ in every native voice send

Spoken `send` and `send and close` choose HQ when either narration or HQ dictation is on; explicit `clean up and send` remains HQ. The native Send button uses durable HQ preparation when its draft contains dictated text and HQ is on, while typed sends remain direct. Existing persisted preparations remain decodable and keep their prior keyword-tag behavior.

The native emission carries optional HQ provenance through the existing V2 envelope so the server persists `stt="hq"` and the chat renders evidence that the pass actually supplied the text. Button sends retain their recording even when HQ is off, preserving later retranscription.

First implementation chunk: extraction of a shared staging path plus button/keyword plan tests.

## Could this be simpler?

Bridging the flag only would make the UI and native state agree but leave the button path live-only. Always forcing native voice through HQ would remove the bridge but violate per-chat off. Both tracks are required for the setting to mean the same thing across composers.

## Subplans

None; the bridge and send semantics are settled.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Older app lacks the channel | yes | web post is optional | fail-local live transcription |
| Malformed bridge payload | yes | native ignores it | fail-local off |
| Session assignment leaves the resolved value unchanged | yes | bridge reposts when session identity changes after native resets | fail-local off until repost |
| HQ request fails | existing | durable preparation falls back to live transcript | clear composer status |
| App suspends during HQ | existing | preparation persists and resumes | clear pending row |
| Existing preparation manifest lacks the new marker | yes | absence preserves keyword behavior | compatible |

## Agent-flow / user-flow edge cases

- ADDRESSED — stale state resets on box and session navigation.
- ADDRESSED — typed messages never enter HQ audio preparation.
- ADDRESSED — explicit HQ keyword works even when the setting is off.
- ADDRESSED — button send does not fabricate a spoken keyword tag.
- ADDRESSED — old native builds ignore the new optional web post.

## NOT in scope

- Android native parity; no Android composer implementation exists here.
- Changing the transcription HTTP endpoint or response shape.
- Making mobile device authentication an owner identity.

## Open design questions

None.

## Knowledge audits

Skipped: no box-agent guidance changes.

## What will hold this after it ships

TypeScript doctests hold the emitted channel and payload. Swift unit tests hold decoding, send-plan selection, and old preparation compatibility. The iOS build holds integration. Physical-device dictation remains the final manual gate.

## Implementation order

1. Bridge state and contract tests/docs.
2. Native button and spoken-send parity with Swift tests.
3. Lint, typecheck, iOS tests/build, cross-model review, and manual-test script.

## Rollout shape

The bridge is additive and older apps ignore it. Missing state fails off. Land web and iOS changes together. Do not clear `needs: [manual-testing]` until the boxholder verifies a normal native Send with HQ on and off.
