# TTS container routing

The TTS backends disagree about container. OpenAI returns `audio/mpeg`; Gemini
asks OpenRouter for `pcm` and wraps it as `audio/wav` (`services/tts.ts`).
MediaSource plays the first and supports **no** WAV type, and appending WAV to a
source buffer opened as `audio/mpeg` does not fail at `addSourceBuffer` — the
element errors later with `MEDIA_ERR_SRC_NOT_SUPPORTED` and the utterance is
silently lost. So the streaming client must decide from the response's own
`Content-Type` rather than assuming one.

```ts setup
import { mediaTypeOf } from "../../src/frontend/src/lib/audio/playable.js";
```

## The media type survives; other parameters do not

`MediaSource.isTypeSupported` accepts a `codecs` parameter and rejects a header
carrying anything else, so only `codecs` is kept.

```ts
mediaTypeOf("audio/mpeg")
=> audio/mpeg

mediaTypeOf("audio/wav")
=> audio/wav

// A charset would make an otherwise-supported type fail the check.
mediaTypeOf("audio/mpeg; charset=utf-8")
=> audio/mpeg

mediaTypeOf('audio/mp4; codecs="mp4a.40.2"')
=> audio/mp4; codecs="mp4a.40.2"

// A response with no Content-Type cannot claim to be streamable.
mediaTypeOf(null)
=> null

mediaTypeOf("")
=> null
```

## The routing decision

`playAudioResponse` streams only what MediaSource actually accepts. This is the
check it makes; a browser reports WAV unsupported, which is the whole reason the
buffered path exists.

```ts
function streams(contentType) {
  return contentType !== null && MediaSource.isTypeSupported(contentType);
}

const support = { "audio/mpeg": true, "audio/wav": false };
globalThis.MediaSource = { isTypeSupported: (t) => support[t] === true };

// OpenAI's mp3 streams.
streams(mediaTypeOf("audio/mpeg"))
=> true

// Gemini's WAV does not, and is buffered whole instead.
streams(mediaTypeOf("audio/wav"))
=> false

// A missing header is treated as unstreamable rather than assumed to be mp3.
streams(mediaTypeOf(null))
=> false
```
