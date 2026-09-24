---
title: "The rotating voice-keyword hint is web-only; the iOS native composer shows nothing"
workstream: ios-keyword-hints
needs: [manual-testing]
area: beebox
labels: [voice, ios, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder noticing the hint is missing on the phone
---

> **Manual test failed (boxholder, 2026-09-24).** The native hint from `f48ae9256` shipped with three defects:
>
> 1. It overlaps the textarea. It could wrap, or sit above the textarea.
> 2. It has no translucent background.
> 3. It sometimes takes up space when the textarea is empty.
>
> The manual-testing gate was removed while the fix was pending; it is restored below for phone verification.

> **⏳ Awaiting manual testing** — layout fix landed in `aa34a8cf9`. Confirm on a
> real iPhone that the hint sits above the mic button at the right, stays clear
> of editor text, remains legible, and rotates during live dictation without
> reserving space when dictation is off. Only the boxholder clears this gate.

Earlier status: the native hint surface landed in `f48ae9256`; exercise the live iOS composer on a simulator or device to confirm its placement, rotation, and accessibility hint. The native list remains local to `SpeechKeywords.swift`, and the HQ phrase is still not represented.

## What is resolved

Commit `f48ae9256` adds a rotating native hint beside the live microphone in
`ios-app/BeeBox/Views/NativeComposerView.swift`. It uses native-owned phrase
lists from `ios-app/BeeBox/Services/SpeechKeywords.swift`, shows only
`"microphone off"` before text exists, and exposes the phrase list through the
microphone control's accessibility hint. The focused
`SpeechKeywordsTests.testKeywordHintsMatchNativeVoiceVocabulary` test passed on
the iPhone 17 Pro simulator.

## Remaining gap

The native and web lists are still separate, as required by the mobile
contract, so this change does not prevent future vocabulary drift. Native's
`sendHq` action still has no displayed hint, and the fixture launch hung after
the focused test run, so placement and rotation have not received visual
runtime verification.

## Manual testing

With the native composer open on an iPhone simulator or device, start the
microphone with and without draft text. Confirm that a phrase appears beside
the microphone, that it changes after 10 seconds while dictation is active,
and that the no-text state shows only `"microphone off"`. Confirm that VoiceOver
announces the microphone's keyword guidance. This check is for visual and
accessibility behavior; it does not close the separate HQ-vocabulary gap.

While the mic is live on the web, the composer shows a rotating one-phrase
reminder of the spoken keywords — `"send message"`, `"clean up and send"`,
`"send and close"`, `"erase message"`, `"cancel message"`, `"microphone off"`,
cycling every 10 seconds and filtered to what is currently valid (before
anything is said, only `"microphone off"` is offered). That is `KeywordHint`
(`beebox/src/frontend/src/components/chat/KeywordHint.tsx`), positioned by
`MicOverlay` beside the volume bars.

The iOS native composer has no equivalent. `NativeComposerView.swift` has no
hint surface; the only match for "hint" in it is an `accessibilityHint` on an
unrelated control.

## Why this matters more on the phone than on the web

The hint's own doc comment says it "keeps the keyword set discoverable without
a help page". Voice is the primary input on a phone, and the phone is where a
user is least able to consult documentation. The surface that most needs the
discoverability is the one that lacks it.

## The constraint that makes this not a port

Keyword detection is deliberately **per-side, not bridged**
(`beebox/docs/mobile-contract.md:487-495`): native detects over its own
transcript in `Services/SpeechKeywords.swift`, web in
`lib/audio/speech-keywords.ts` plus `input/voice-intent.ts`, and only the
resulting tagged text crosses the bridge. The implementations diverge on
purpose where the pipelines differ — native holds a detected keyword's tag
substitution until the composer's send lock accepts it and refuses to match
inside an existing markup tag; web needs neither guard. The contract's words:
"Neither side may assume the other's detector fired."

So the hint text cannot simply be shipped across the bridge as truth about what
native will accept. Either native renders its own hints from its own keyword
table (a second list that can drift from the first), or the two sides get a
shared source of phrases with each side still owning detection. That choice is
the design content here.

Worth checking while in there: whether the *sets* already agree. Native's
`SpeechKeywordAction` has `send`, `sendHq`, `sendClose`, `cancel`, `micOff`,
`erase`. The web hint list offers no HQ phrase at all, so if `sendHq` is
reachable by voice on the phone, the two surfaces already disagree about what
the user can say — which is the drift this issue is about, in the opposite
direction.

## Related

[iOS input-plane parity](../features/2026-07-19-ios-input-plane-parity.md) is
the broader parity effort; its remaining work is a physical-device acceptance
pass, and this gap is not on its list. Whether this belongs to that plan
(`beebox/docs/plans/ios-input-plane-parity.md`, still `status: partial`) or
stands alone is worth deciding before either is picked up.
