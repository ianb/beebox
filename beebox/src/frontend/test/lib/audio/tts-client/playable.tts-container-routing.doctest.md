# TTS container routing

The TTS backends disagree about container. OpenAI returns `audio/mpeg`; Gemini
returns raw PCM that the server wraps as `audio/wav` (`services/tts.ts`).
MediaSource plays the first and supports **no** WAV type, and appending WAV to a
source buffer opened as `audio/mpeg` does not fail at `addSourceBuffer` — the
element errors later with `MEDIA_ERR_SRC_NOT_SUPPORTED` and the utterance is
silently lost. So the streaming client must decide from the response's own
`Content-Type` rather than assuming one.

```ts setup
import { mediaTypeOf } from "../../../../src/lib/audio/tts-client/playable.js";
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
