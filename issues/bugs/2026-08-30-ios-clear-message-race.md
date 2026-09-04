---
title: "iOS 'Clear message' sometimes doesn't clear — the unchanged-snapshot guard eats it when text moved underneath"
workstream: ios-clear-message-race
needs: [manual-testing]
area: beebox
labels: [ios, voice]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "sometimes doesn't work; seems like a race somewhere"
---

> **⏳ Awaiting manual testing** — fix landed in `9fc27f00e`; while iOS voice
> listening continues, say “Clear message” and confirm the composer clears and
> stays clear. Only the developer clears this.

On iOS, the "Clear message" voice keyword (`<erase-message phrase="Clear
message" />`, `ios-app/BeeBox/Services/SpeechKeywords.swift:46,210`)
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

> 2026-09-04 re-encountered (boxholder, on device): "clear message doesn't
> work on iOS. Some race." Still unreproduced in code; the snapshot-guard
> hypothesis above stands. Second report in five days.

## Implementation

The implementation investigation disproved the original unchanged-snapshot
hypothesis. Spoken erase restarted dictation before the asynchronous draft
discard had cleared the composer, so the restarted recognizer could capture the
old message as its seed and write it back. Commit `9fc27f00e` synchronously
detaches the old draft before restarting dictation; asynchronous persistence and
payload cleanup retain ownership only of that detached snapshot, preserving any
new text entered after erase.

The ordering is covered by a deterministic XCTest, and the iOS XCTest suite
passes on an iPhone 17 Pro simulator. The intermittent behavior itself still
needs confirmation on a physical phone.

## Manual testing

On a physical iPhone, start voice dictation with continuous listening enabled,
dictate a message, then say “Clear message” without pausing. Confirm the composer
clears and does not repopulate from the preceding transcript while listening
continues. Then speak new words and confirm they appear and are not removed by
the old draft's asynchronous cleanup.
