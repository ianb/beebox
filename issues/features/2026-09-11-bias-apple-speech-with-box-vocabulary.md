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

**2026-10-06:** iOS 26 HQ dictation now runs `SpeechTranscriber` on the
finished recording (`ios-app/BeeBox/Services/OnDeviceHqTranscriber.swift`;
[ios-on-device-hq-transcription](2026-10-06-ios-on-device-hq-transcription.md)).
That text becomes the sent message, so a vocabulary context applied there
affects the final message and not only the live preview.

## 2026-10-20: Voxtral 3 takes context too, in a wider form

Voxtral 3's `context_bias`
([docs](https://docs.mistral.ai/studio/audio/speech-to-text/bias-context-and-vocabulary))
is a list of strings. Each entry is a term ("Alder Creek Design") or a
sentence describing the recording. Mistral's guidance: list every term that
must come out right, and add a description when the subject is clear. It
works on the file models and on the realtime model, where it goes in
`session.update` before the first audio and cannot change after. Entries share
the model's context window (65,536 tokens) with the audio. Mistral reports
keyphrase recall rising from 81.4% to 94.6% with context.

Today the box sends `context_bias` only when a caller passes a prompt
(`beebox/src/core/transcription/voxtral/request.ts`). The one caller found is
re-transcription, which sends the existing text
(`beebox/src/core/preactions/transcribe.ts:113`). The live proxy sends none.

The developer sees context as its own feature, separate from any one
recognizer. That points at one box-level context source, served to every
recognizer in the form it takes: terms and a description for Voxtral, terms
only for Apple. Related:
[move to Voxtral 3](2026-10-20-upgrade-transcription-to-voxtral-3.md).

## 2026-10-23: measured — `SpeechTranscriber` ignores contextual strings

The [Apple speech tuning research](../../research/apple-speech-tuning/README.md)
answers "verify the API contract first". `SpeechAnalyzer.setContext` accepts
an `AnalysisContext`, but `SpeechTranscriber` (the model the app uses, live and
HQ) produced identical text with 0, 5, 88, or 672 contextual strings.
Apple's forum answer says the same. Only `DictationTranscriber` and the
legacy `SFSpeechRecognizer` honor contextual strings and custom language
models (`SFCustomLanguageModelData`). Those are the older dictation model,
which was 4–10 points worse in WER on real speech and much worse in noise.

With the right list, the older model recovers names well on clean speech.
With all 90 names of the synthetic set, `DictationTranscriber` name recall
rose from 58% to 84%, and its WER (5.2%) beat `SpeechTranscriber`
(6.8%). In noise it stayed far worse. So applying box vocabulary on the
phone means a second recognizer pass whose name spellings are merged into the
`SpeechTranscriber` text, not a setting on the current pass. That merge is
unmeasured.

Server engines take the same list better. Whisper's `prompt` raised name
recall on Earnings-21 from 67% to 79%, and voxtral's `context_bias` from 67%
to 77% (single words only; see
[voxtral context_bias rejects multi-word prompt](../closed/bugs/2026-10-23-voxtral-context-bias-rejects-multi-word-prompt.md)).

Re-reviewed 2026-10-30: the title's premise is settled by measurement; passing strings to the current Apple recognizer does nothing. The remaining work is a box-level vocabulary source for the server engines, plus an optional unmeasured second-pass merge on iOS.

Out of date in the body above: Retitle to the box-level vocabulary source served to every recognizer (Whisper prompt, Voxtral context_bias, iOS DictationTranscriber merge), and move 'which strings, when' to the front; set area to beebox if the server part leads.
