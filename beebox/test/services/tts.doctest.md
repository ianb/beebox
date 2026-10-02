# TTS service: the fake, and the guard against silent failure

`TtsService` (`src/services/tts.ts`) is one interface over several speech
backends. These cover the fake every route test uses, and the one behaviour the
real implementations share: a response too short to be audio is an error, not a
result.

```ts setup
import { createFakeTts, EmptyTtsResponseError } from "../../src/services/tts.js";
```

## The fake records what it was asked to say

```ts
const tts = createFakeTts();
const result = await tts.textToSpeech("Hello there.", { voice: "coral", instructions: "Warmly." });
`${result.contentType} ${String(result.audio.length > 0)}`
=> audio/mpeg true

JSON.stringify(tts.speeches)
=> [{"text":"Hello there.","voice":"coral","instructions":"Warmly."}]
```

Its backend and stylability are declarable, because the route and the picker
both branch on them.

```ts
const gem = createFakeTts({ backend: "gemini", stylable: true });
const mute = createFakeTts({ backend: "openai", stylable: false });
`${gem.backend}/${String(gem.stylable)} ${mute.backend}/${String(mute.stylable)}`
=> gemini/true openai/false
```

## A too-short response is an error, never a result

Gemini has been observed answering HTTP 200 with a zero-length body. A buffer
that short reaches the browser as silence, which the boxholder blames on their
speakers rather than on the backend — so the service throws instead of
returning it.

The fake returns a genuinely empty buffer rather than a flag meaning "pretend
it was empty": a mock written by the bug's author encodes the bug, so the guard
is asserted against the real shape.

```ts
const broken = createFakeTts({ backend: "gemini", emptyResponse: true });
await broken.textToSpeech("Hello there.")
=> throws EmptyTtsResponseError: TTS backend "gemini" returned 0 bytes — too short to be speech
```

The call is still recorded, so a test can tell "never asked" from "asked and
got nothing".

```ts
const seen = createFakeTts({ emptyResponse: true });
const swallowed = await seen.textToSpeech("Hi.").catch(() => "threw");
`${String(swallowed)} recorded=${String(seen.speeches.length)}`
=> threw recorded=1
```
