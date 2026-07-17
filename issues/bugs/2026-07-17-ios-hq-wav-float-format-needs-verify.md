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
transcription provider (`transcribeAudioHq`, dispatching to OpenAI/Deepgram/Voxtral).

## Research (incomplete)

Whether this matters depends on whether the box's HQ transcription path (or an intermediate decode
step) assumes 16-bit integer PCM rather than accepting float WAV generically. The 2026-07-17 review
found no local decoder in the box that assumes 16-bit PCM, and cloud providers generally accept float
WAV, so practical impact looks low — but it wasn't verified end-to-end against each configured HQ
provider. If a provider or an intermediate step does assume int16, the HQ leg would silently no-op
(user gets the on-device transcript with no diarization/HQ improvement, no visible error).

Next step: exercise the transcribe-audio route with an actual float-PCM WAV against each HQ provider
callback-box supports, and confirm the response is a real transcript rather than empty/garbled text.
If any provider mishandles it, either convert to int16 PCM on the iOS side before upload or make the
box-side call explicit about the accepted format.
