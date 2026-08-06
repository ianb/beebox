---
title: "iOS uploads float-format WAV to HQ transcription — decoder tolerance unverified"
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
---

`SpeechDictation` (`ios-app/CallbackBox/`) writes the dictation WAV using the microphone's native
input format (`inputNode.outputFormat`), which is typically 32-bit float PCM, and uploads it to
`POST /api/chat/transcribe-audio` with `Content-Type: audio/wav` unchanged. The server
(`callback-box/src/webapp/routes/chat-audio-routes.ts`) forwards the buffer as-is to the configured HQ
transcription provider (`transcribeAudioHq`, dispatching to OpenAI or Voxtral). The separate general
transcription path also supports Deepgram.

## Research (2026-08-06)

The source path preserves the recorded bytes. It does not decode or convert the WAV:

- `SpeechDictation.start` gets `inputNode.outputFormat(forBus: 0)`. It creates `AVAudioFile` with
  `format.settings`, installs the tap with the same format, and writes each buffer directly. It does
  not request an integer PCM format. Apple's [`AVAudioFormat` documentation](https://developer.apple.com/documentation/avfaudio/avaudioformat/)
  calls deinterleaved 32-bit float Core Audio's standard format. The exact runtime format still
  follows the active input device rather than a hard-coded invariant.
- `ChatAPI.transcribeAudio` reads the file as `Data` and puts those bytes in a multipart file named
  `segment.wav` with `Content-Type: audio/wav`. It does not convert the audio.
- `chat-audio-routes.ts` calls `data.toBuffer()` and passes that buffer and filename to
  `transcribeAudioHq`. The OpenAI and Voxtral clients put the same buffer into their provider
  multipart requests. There is no local PCM decoder or int16 assumption.

The current provider dispatch is narrower than the original issue states. `transcribeAudioHq`
supports OpenAI (`whisper-1`, `gpt-4o-transcribe`, and `gpt-4o-mini-transcribe`) and Mistral Voxtral
(`voxtral` and `voxtral-diarized`). It does **not** dispatch to Deepgram. Deepgram is available through
the separate general `transcribeAudio` path, so its format support is recorded here for completeness.

Provider documentation gives these results:

- **OpenAI: WAV is supported, but float PCM is not explicitly guaranteed.** The
  [audio transcription API reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
  lists `wav` among the accepted file formats for all OpenAI models used here. It does not specify
  accepted WAV codecs or sample widths. That is container-level evidence, not a documented guarantee
  for IEEE float PCM.
- **Deepgram: yes.** Deepgram's [encoding reference](https://developers.deepgram.com/docs/encoding)
  defines `linear32` as "32-bit, little endian, floating-point PCM WAV data." Its
  [supported-formats page](https://developers.deepgram.com/docs/supported-audio-formats) also says it
  handles more than 100 formats and encodings, including WAV and PCM. For containerized audio,
  Deepgram says to omit `encoding` and `sample_rate`; the existing client does that.
- **Mistral Voxtral: WAV/codec support is not documented precisely enough.** The
  [offline transcription guide](https://docs.mistral.ai/studio-api/audio/speech_to_text/offline_transcription)
  documents direct file upload to `voxtral-mini-latest`, and the
  [endpoint reference](https://docs.mistral.ai/api/endpoint/audio/transcriptions) accepts a generic
  uploaded `File`. Neither page lists supported containers, PCM encodings, or sample widths. The docs
  therefore do not establish float-PCM WAV support.

This issue cannot close from documentation alone. OpenAI and Mistral need an end-to-end tiebreaker:
send a short, known-speech IEEE-float WAV through the same provider calls and require a non-empty,
correct transcript. For Voxtral, also verify that the diarized call returns usable text. This was not
run because it requires real provider credentials and billable external requests.

A provider rejection is not silent: the box returns HTTP 500, and iOS shows "HQ transcription
failed; sending live dictation." A provider that returns HTTP 200 with empty or garbled text can still
degrade silently. If either live check fails, normalize the recording to 16-bit linear PCM WAV on iOS
before upload. That makes the wire format deterministic and is preferable to relying on undocumented
provider decoder behavior.
