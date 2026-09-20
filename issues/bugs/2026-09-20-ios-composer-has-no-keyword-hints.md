---
title: "The rotating voice-keyword hint is web-only; the iOS native composer shows nothing"
workstream: unattached
area: beebox
labels: [voice, ios, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder noticing the hint is missing on the phone
---

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
