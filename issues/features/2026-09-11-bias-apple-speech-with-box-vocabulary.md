---
title: "Apple's speech recognizer accepts a vocabulary hint and we pass none — the box knows the proper nouns it keeps mangling"
workstream: unattached
area: ios-app
priority: normal
labels: [ios, transcription, speech, native]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "apparently apple intelligence speech can be prompted or guided somehow?"
---

Apple's on-device recognizer supports **contextual biasing**: you supply a list
of strings — names, jargon, titles — and it weights its hypotheses toward them.
It is not prompting in the LLM sense. You cannot tell it *how* to transcribe,
only *what words to expect*.

Two generations of the same idea:

- `SFSpeechRecognizer` has carried `contextualStrings` on the request object for
  years.
- `SpeechAnalyzer` (iOS 26) carries it through an `AnalysisContext` attached to
  the session rather than per-request.

**We pass nothing.** `ios-app/BeeBox/Services/SpeechAnalyzerSession.swift`
constructs `SpeechTranscriber(locale:preset: .progressiveTranscription)`, or
falls back to `DictationTranscriber(preset: .progressiveLongDictation)`, and
never sets a context. `SpeechDictation.swift:153` keeps an `SFSpeechRecognizer`
as a legacy path and sets no `contextualStrings` either. A grep across
`ios-app/` finds neither symbol.

That is the gap worth closing, because a box is unusually well supplied with
exactly the strings this wants — landmark labels, person card names, the titles
of cards in the directory being discussed, recent chat subjects — and the
realtime transcript is precisely where proper nouns get mangled today.

## Verify the API contract first

Reporting on iOS 26 is muddled. Some write-ups claim `SpeechAnalyzer` dropped
custom vocabulary entirely and that anything needing it should stay on
`SFSpeechRecognizer`; others describe `AnalysisContext` as supplying it. Check
the SDK, not a blog post, before designing around either claim. If the new API
really cannot bias, that is itself the finding — and it makes the legacy path's
`contextualStrings` more interesting rather than less.

## The design question is which strings, and when

`AnalysisContext` is set per session, while the vocabulary that would help
changes as the boxholder navigates — who they are talking about, which landmark
they are in, what card is open. So this is not "pass a list," it is:

- **What supplies the list.** A contract with the web/server side, since the
  box holds the names and the app holds the recognizer. The mobile contract
  (`beebox/docs/mobile-contract.md`) is where that would live.
- **How often it refreshes**, and whether a session is restarted to change it
  or the context can be updated live.
- **How big it can usefully be.** A list of every card title in a large box is
  probably worse than a focused one; there is likely a practical ceiling worth
  measuring rather than guessing.
- **Whether the HQ pass benefits too.** The server-side HQ services take their
  own prompt/vocabulary parameters in some backends; the same box-supplied
  strings may apply there, which would make this more than an iOS feature.

## Related

- `issues/bugs/2026-09-10-live-transcription-failure-loses-the-hq-pass.md` —
  the dormant `hq-recording-resilience` workstream sits in this code.
- `beebox/docs/mobile-contract.md` — changing what the app asks the server for
  touches the shared contract; see the `bbx-ios-overlap` skill.
