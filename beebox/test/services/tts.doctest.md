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

## Gemini: one key, one host, style beside the text

Gemini speech goes to Google's Interactions API with the box's `gemini` key —
its only route (`src/core/tts/resolve.ts` says why OpenRouter is not one).
These tests stand in for the network with a recording `fetch`, so what Google
would receive is visible.

```ts setup
import { createTtsService } from "../../src/services/tts.js";

/** A `fetch` that records each request and answers with `respond()`. */
function recordingFetch(respond) {
  const calls = [];
  const fetch = async (input) => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push({ url: req.url, headers: Object.fromEntries(req.headers), body: await req.json() });
    return respond();
  };
  return { calls, fetch };
}

// 1000 bytes of 24 kHz 16-bit silence — long enough to pass the playability guard.
const pcm = Buffer.alloc(1000);

/** A streamed Interactions answer carrying `audio` as two SSE delta events. */
function interactionStream(audio) {
  const half = audio.length / 2;
  const delta = (part) => `event: step.delta\ndata: ${JSON.stringify({ event_type: "step.delta", delta: { type: "audio", data: part.toString("base64") } })}\n\n`;
  return new Response(delta(audio.subarray(0, half)) + delta(audio.subarray(half)) + "event: done\ndata: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

The request sends the key in Google's own header, puts style in the
`speech_metadata` annotation beside the verbatim text, asks for a stream, and
asks Google not to store the request. The streamed PCM chunks come back
joined, as one WAV.

```ts
const direct = recordingFetch(() => interactionStream(pcm));
const tts = createTtsService({ backend: "gemini", apiKey: "AIza-test", fetch: direct.fetch });
const out = await tts.textToSpeech("The delivery is late.", { voice: "Kore", instructions: "Speak warmly." });
const call = direct.calls[0];
({
  url: call.url,
  key: call.headers["x-goog-api-key"],
  authorization: call.headers.authorization ?? "(none)",
  model: call.body.model,
  stream: call.body.stream,
  store: call.body.store,
  content: call.body.input[0].content[0],
  voice: call.body.generation_config.speech_config[0].voice,
  stylable: tts.stylable,
  contentType: out.contentType,
  riff: out.audio.subarray(0, 4).toString(),
  bytes: out.audio.length,
})
=> {
  url: "https://generativelanguage.googleapis.com/v1beta/interactions",
  key: "AIza-test",
  authorization: "(none)",
  model: "gemini-3.8-flash-lite-tts",
  stream: true,
  store: false,
  content: { type: "text", text: "The delivery is late.", annotations: [{ type: "speech_metadata", style: "Speak warmly." }] },
  voice: "Kore",
  stylable: true,
  contentType: "audio/wav",
  riff: "RIFF",
  bytes: 1044,
}
```

A stream that carries no audio — events of a shape we do not know, or a
completed interaction with nothing in it — is the same silent-200 failure as
an empty body, and throws the same error.

```ts
const empty = recordingFetch(() => new Response("event: done\ndata: [DONE]\n\n"));
const tts = createTtsService({ backend: "gemini", apiKey: "AIza-test", fetch: empty.fetch });
await tts.textToSpeech("Hello there.")
=> throws EmptyTtsResponseError: TTS backend "gemini" returned 0 bytes — too short to be speech
```

## A long rate-limit wait fails at once; a short one is retried

ky honors `Retry-After` in full. A free-tier Gemini key over its daily quota
answered 429 with a wait of about 26 minutes, and every clip then sat silent
until the 90 s stream deadline. A clip is useless by then, so a 429 asking for
more than two seconds fails at once, after one request, with the provider's
status for the route to report.

```ts
const quota = recordingFetch(() =>
  Response.json({ error: { message: "Rate limit exceeded (limit: 10 requests per day on Free Tier)" } }, {
    status: 429,
    statusText: "Too Many Requests",
    headers: { "Retry-After": "1572" },
  }));
const tts = createTtsService({ backend: "gemini", apiKey: "AIza-test", fetch: quota.fetch });
const started = Date.now();
const failure = await tts.textToSpeech("Hello there.").catch((e) => e);
({ error: failure.name, status: failure.response.status, requests: quota.calls.length, fast: Date.now() - started < 1000 })
=> { error: "HTTPError", status: 429, requests: 1, fast: true }
```

A short wait is still worth it: the retry speaks the clip.

```ts
let answered = 0;
const brief = recordingFetch(() => {
  answered += 1;
  return answered === 1
    ? new Response("{}", { status: 429, headers: { "Retry-After": "0" } })
    : interactionStream(pcm);
});
const tts = createTtsService({ backend: "gemini", apiKey: "AIza-test", fetch: brief.fetch });
const out = await tts.textToSpeech("Hello there.");
({ requests: brief.calls.length, contentType: out.contentType })
=> { requests: 2, contentType: "audio/wav" }
```
