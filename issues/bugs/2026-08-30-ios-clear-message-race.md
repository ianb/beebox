---
title: "iOS 'Clear message' sometimes doesn't clear — the unchanged-snapshot guard eats it when text moved underneath"
workstream: unattached
area: callback-box
labels: [ios, voice]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "sometimes doesn't work; seems like a race somewhere"
---

On iOS, the "Clear message" voice keyword (`<erase-message phrase="Clear
message" />`, `ios-app/CallbackBox/Services/SpeechKeywords.swift:46,210`)
sometimes leaves the composer un-cleared.

Prime suspect, found by reading (not yet reproduced):
`NativeComposerView.swift` `clearComposerTextIfUnchanged(from: snapshot)` —

    guard draftStore.draft.text == snapshot else { return }
    draftStore.setText("")

The guard exists for a good reason (its comment: a queued keystroke, restored
draft, or dictation commit landing during a slow batch must not be silently
deleted). But the *dictation commit* case bites the clear keyword itself: the
keyword is recognized from the audio stream, and by the time the clear runs,
later dictated words (including trailing words after "clear message", or the
phrase's own partials being re-finalized) may have changed `draft.text` from
the snapshot — so the clear silently no-ops. A race between transcript
finalization and the keyword's snapshot.

Direction, to verify against the actual flow: the erase keyword's intent is
"clear what was dictated up to and including this command" — snapshot-equality
is the wrong guard for it. Either clear through the transcript pipeline (drop
the segment) rather than comparing composer text, or make the guard tolerate
text that differs only by content the same dictation stream appended after the
snapshot. Reproduce first: dictate, say "clear message" mid-flow without
pausing, watch whether trailing finals defeat the clear. Device territory —
`field-probe` if it won't reproduce in the sim.
