---
title: "iOS HQ dictation: use Apple's on-device SpeechTranscriber on the recording instead of server transcription, when available"
workstream: unattached
area: ios
priority: important
labels: [voice, ios]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asked whether Apple has a batch, higher-quality STT
---

When HQ dictation is on, the iOS app records the audio, uploads it to the box
(`POST /api/chat/transcribe-audio`, `beebox/docs/mobile-contract.md` §5.2), and
waits for a server-side transcription before sending
(§4.4a "HQ dictation state"). That costs a network round trip, a paid service,
and a dependency on the box being reachable.

Apple's `SpeechAnalyzer` with `SpeechTranscriber` (iOS 26 and later) can also
transcribe a finished audio file on the device. It is the same model the app
already uses live (`ios-app/BeeBox/Services/SpeechAnalyzerSession.swift`, preset
`.progressiveTranscription`), but run over the whole recording with a
non-progressive preset (`.transcription`, or
`.timeIndexedTranscriptionWithAlternatives`) it gives final results only.
Independent 2026 benchmarks report it faster than Whisper large-v3 turbo and
more accurate than Whisper Small on English. It runs offline, at no cost, with
no length limit.

## Wanted (boxholder decision, 2026-10-06)

- **When the on-device model is available, it is the HQ pass.** The app
  transcribes the recording with `SpeechTranscriber` and sends that text. It
  does not call `/api/chat/transcribe-audio` or any other HQ service.
- **Otherwise, today's behavior is the fallback.** "Available" means: iOS 26
  or later, `SpeechTranscriber.isAvailable`, a supported locale for the
  current language, and its assets installed (or installable now). If any
  check fails, or the on-device pass errors, the app uses the existing server
  HQ path, and failing that the live transcript with `hqFallback:true`, as
  today.

## Details to settle while building

- **Contract.** The emission already carries `hqText` and `hqService`
  (mobile-contract `Emission`). An on-device pass sets `hqText:true` and a new
  `hqService` value naming it, so the box and the transcript can tell which
  engine produced the text. Use the bbx-ios-overlap skill; update the contract
  doc and the web side that reads `hqService`.
- **Locale fallback today.** `SpeechAnalyzerSession` falls back to
  `DictationTranscriber` (the older dictation model) when `SpeechTranscriber`
  lacks the locale. For the batch pass, `DictationTranscriber` is not the
  higher-quality model, so it should count as "not available" and the server
  path should run.
- **Diarization.** The server HQ path can return `diarized: true`.
  `SpeechTranscriber` does not separate speakers. Confirm with the boxholder
  whether any flow depends on diarized HQ text (HQ recordings, not dictation,
  may); if so, that flow keeps the server path.
- **Asset download.** The language model may need a one-time download
  (`AssetInventory`). Decide whether the app downloads it in the background
  ahead of time, so the first HQ send is not slowed or forced onto the
  fallback.
- **Durability.** Keep the current durable HQ preparation behavior (background
  task assertion, retry, recovery after relaunch) for the on-device pass.
- **Measure.** Compare on-device text against the current server service on the
  same recordings (accuracy and time to send) before removing the server path
  from the default, and report the comparison.

Related: the live transcription failure that takes the HQ pass down,
[live-transcription-failure-loses-the-hq-pass](../bugs/2026-09-10-live-transcription-failure-loses-the-hq-pass.md),
may become moot when the HQ pass is on-device.
