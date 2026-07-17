---
title: "iOS HQ-transcription window in the native composer isn't locked"
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
---

`NativeComposerView`'s keyword-send path (the function that kicks off HQ transcription, in
`ios-app/CallbackBox/Views/NativeComposerView.swift`) launches a `Task` that awaits the multi-second
`ChatAPI.transcribeAudio` upload, and only sets `lastSentEmission` (which drives the `isSending`
spinner/lock) *after* that await completes, inside the function that enqueues the prepared voice
message. During the upload window the composer status merely reads "Improving transcription…" but the
UI is otherwise fully live — text field editable, send button tappable, mic togglable.

Concrete failure: user says "send message" via voice keyword → HQ upload runs 2–5s → before it
finishes, the user types "hi" and taps send, or toggles the mic again → a second emission dispatches,
or dictation restarts mid-flight, interleaving with the still-in-flight HQ send.

Fix direction: set a preparing/sending flag before launching the Task (not after the await), so the
composer is locked for the full HQ window, not just after it resolves.
