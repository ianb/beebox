---
title: "iOS HQ dictation: use Apple's on-device SpeechTranscriber on the recording instead of server transcription, when available"
workstream: ios-on-device-hq
area: ios
priority: important
labels: [voice, ios]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asked whether Apple has a batch, higher-quality STT
needs: [manual-testing]
---

> **⏳ Awaiting manual testing** — fix landed in `1917514c9`; run the eight real-iPhone checks under Manual testing. Only the developer clears this.

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

Also related: [bias Apple speech with box vocabulary](2026-09-11-bias-apple-speech-with-box-vocabulary.md).
Once the on-device pass produces the HQ text, the box's proper nouns matter
more; `SpeechAnalyzer` accepts contextual strings, so the two may be done
together.

## Implementation (2026-10-06, worktree `ios-on-device-hq`)

`ios-app/BeeBox/Services/OnDeviceHqTranscriber.swift` runs `SpeechTranscriber`
with the `.transcription` preset over the WAV the durable preparation already
keeps. `NativeComposerView.prepareVoiceMessage` tries it first, inside the
existing background-task hold. When it returns text, the emission carries
`hqText:true`, `hqService:"apple-speech-transcriber"`, `diarized:false`, and
`/api/chat/transcribe-audio` is not called. Every other outcome goes on to the
server path unchanged, with its live-transcript fallback. Contract:
`beebox/docs/mobile-contract.md` §4.4a.

Decisions on the details above:

- **`hqService`** is `apple-speech-transcriber`. Web passes it through to
  `<speech stt-service="…">`; nothing on web enumerates the values, so no web
  code changes for it.
- **Diarization** (boxholder, 2026-10-06): keep the server path. A box whose
  HQ service is `voxtral-diarized` or `mai-diarized` posts `diarized:true` on
  `beeboxHqDictationState`. The preparation captures that value at the send
  gesture and persists it, so a relaunch resumes with the setting the message
  was sent under. Web posts `diarized:true` while it loads or refetches the
  box's transcription config, so a send in that window, including just after
  the setting changes, also stays on the server. Older web omits the field,
  which reads as false.
- **Locale:** `DictationTranscriber` does not count. If `SpeechTranscriber` is
  unavailable or lacks the locale, the server path runs.
- **Assets:** the send never waits on a download; missing assets go to the
  server. When HQ dictation or narration turns on for a box without
  diarization, the app starts the download in the background, once per
  process. It tries again only after a failed download. iOS 26 live dictation
  already installs the same locale's `SpeechTranscriber` assets.
- **Durability:** retry and relaunch recovery are unchanged, because the
  on-device pass runs inside the same durable preparation. A pass that has not
  finished within twice the recording's length (minimum 30 s) goes to the
  server.
- **Diagnostics:** `BoxLog` records `voice HQ on-device … audioMs= elapsedMs=`
  on success and `voice HQ on-device skipped … reason=<label> elapsedMs=` when
  the pass does not run. These lines contain no transcript text.

Related issues, not folded in:

- [live-transcription-failure-loses-the-hq-pass](../bugs/2026-09-10-live-transcription-failure-loses-the-hq-pass.md)
  is in the web client's recorder and submit flow. Native already ran a
  durable HQ preparation, so this change does not fix it. On iOS it removes one
  failure mode: an unreachable box (for example, during a deploy) no longer
  prevents the HQ text.
- [bias-apple-speech-with-box-vocabulary](2026-09-11-bias-apple-speech-with-box-vocabulary.md):
  `SpeechAnalyzer.setContext` could bias this pass too. That needs a source of
  box vocabulary on the phone, which is that issue's design work. The
  on-device pass is now a second place to apply it.

## Measurement (2026-10-06)

The iOS simulator reports `SpeechTranscriber.isAvailable == false`. There, the
pass skips in under 15 ms and the server path runs. To measure the model, the
same `OnDeviceHqTranscriber.swift` was compiled into a macOS 26.5 command-line
tool, which has the same `SpeechTranscriber`. Server results come from
`transcribeAudioHq` called in-process against the worktree test box with its
granted keys. MAI was not measured, because the test box has no OpenRouter
key.

Audio: 73 public LibriSpeech `validation-clean` utterances
(`hf-internal-testing/librispeech_asr_dummy`) converted to the app's recording
format (mono Float32 WAV, 48 kHz), plus three 38–78 s concatenations of ten
utterances each. WER is against the LibriSpeech references after lowercasing
and removing punctuation. All three engines are scored on the same 72 files;
voxtral returned 429 errors on 4 files.

| engine | WER, 69 short (2–35 s) | WER, 3 long (38–78 s) | median time, short | time, long (max) |
|---|---|---|---|---|
| on-device `SpeechTranscriber` (Mac) | 3.2% | 3.1% | 0.14 s | 1.65 s |
| server voxtral | 3.0% | 3.8% | 0.62 s | 3.0 s |
| server whisper (box default) | 4.1% | 6.6% | 1.56 s | 5.1 s |

Accuracy is on par with voxtral and better than whisper. The time figures do
not include the phone's upload, which the server path pays and the on-device
pass does not. The on-device times are on a Mac, not a phone. Phone speed is
the main unknown, and the `elapsedMs` log line will show it.

## Manual testing

A real iPhone on iOS 26 or later, paired to a box whose HQ service is not
diarized, with HQ dictation on:

1. **On-device HQ is used.** Dictate and send. Expected: the message's
   `<speech>` carries `stt="hq" stt-service="apple-speech-transcriber"`; the
   box's `.beebox/client-debug.log` has `voice HQ on-device preparation=…
   elapsedMs=…`; the box server log has no `transcribe-audio` request for it.
   Compare `elapsedMs` with `audioMs` for a 10 s and a 60 s message.
2. **Text quality.** Dictate a few messages with box proper nouns. Expected:
   the text is at least as good as the HQ service it replaces.
3. **Fresh install, assets.** Delete and reinstall the app, then turn on HQ
   dictation before you dictate. Expected: the log shows `assets download
   started` and then `installed`. A send made before the download finishes
   logs `skipped reason=assets-not-installed` and uses the server.
4. **Diarized box keeps the server.** Set the HQ service to "Voxtral +
   diarization" and send. Expected: the log shows `skipped
   reason=diarization-requested`, and the message carries
   `stt-service="voxtral-diarized"` with speaker labels.
5. **Box unreachable.** Turn on airplane mode, dictate, and send. Expected: the
   HQ text is produced on the device. The message is delivered when the
   connection returns.
6. **Mic kept open.** Use the spoken "send" keyword, which keeps the
   microphone open, and keep talking. Expected: the next turn's live
   transcript keeps working while the on-device pass runs.
7. **Background during the pass.** Send a long (60 s or more) message and lock
   the phone at once. Expected: the message is sent with HQ text, either
   on-device or from the server, and does not fall back to live text unless
   both fail.
8. **Older iOS** (if a device is available). Expected: `skipped
   reason=os-too-old`, and behavior is the same as before this change.

