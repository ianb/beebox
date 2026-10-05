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

## Gemini: each key goes to its own host

Gemini speech has two routes (`src/core/tts/resolve.ts` picks one from the
box's keys). The route decides the host, the auth header, the request shape,
and whether style direction can travel. These tests stand in for the network
with a recording `fetch`, so what each provider would receive is visible.

```ts setup
import { createTtsService } from "../../src/services/tts.js";

/** A `fetch` that records each request and answers with `respond(url)`. */
function recordingFetch(respond) {
  const calls = [];
  const fetch = async (input) => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push({ url: req.url, headers: Object.fromEntries(req.headers), body: await req.json() });
    return respond(req.url);
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

The direct route sends the `gemini` key to Google's Interactions API in its
own header, puts style in the `speech_metadata` annotation beside the
verbatim text, asks for a stream, and asks Google not to store the request.
The streamed PCM chunks come back joined, as one WAV.

```ts
const direct = recordingFetch(() => interactionStream(pcm));
const tts = createTtsService({ backend: "gemini", route: { via: "direct", apiKey: "AIza-test" }, fetch: direct.fetch });
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

On the OpenRouter route, style direction cannot reach the model: 3.8 would
read a prefix aloud, and the speech request has no field for it. The dropped
direction is named once in the server log, with the fix, rather than on every
reply.

```ts
const viaOr = recordingFetch(() => new Response(pcm));
const tts = createTtsService({ backend: "gemini", route: { via: "openrouter", apiKey: "sk-or-v1-test" }, fetch: viaOr.fetch });
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };
let out;
try {
  out = await tts.textToSpeech("The delivery is late.", { voice: "Kore", instructions: "Speak warmly." });
  await tts.textToSpeech("Second reply.", { voice: "Kore", instructions: "Speak warmly." });
} finally {
  console.warn = originalWarn;
}
warnings
=> ['[tts] Gemini over OpenRouter cannot apply speaking style, so "Speak warmly." is not heard. Grant the "gemini" secret to this box to speak through Google directly, where style works.']
```

The request sends the `openrouter` key as a bearer token, pins it to Google
AI Studio, and carries the text alone; the service reports that it cannot be
styled.

```ts continue
const call = viaOr.calls[0];
({
  url: call.url,
  authorization: call.headers.authorization,
  key: call.headers["x-goog-api-key"] ?? "(none)",
  body: call.body,
  stylable: tts.stylable,
  contentType: out.contentType,
})
=> {
  url: "https://openrouter.ai/api/v1/audio/speech",
  authorization: "Bearer sk-or-v1-test",
  key: "(none)",
  body: {
    model: "google/gemini-3.8-flash-lite-tts",
    provider: { only: ["google-ai-studio"], allow_fallbacks: false, data_collection: "deny" },
    input: "The delivery is late.",
    voice: "Kore",
    response_format: "pcm",
  },
  stylable: false,
  contentType: "audio/wav",
}
```

A direct stream that carries no audio — events of a shape we do not know, or
a completed interaction with nothing in it — is the same silent-200 failure as
an empty body, and throws the same error.

```ts
const empty = recordingFetch(() => new Response("event: done\ndata: [DONE]\n\n"));
const tts = createTtsService({ backend: "gemini", route: { via: "direct", apiKey: "AIza-test" }, fetch: empty.fetch });
await tts.textToSpeech("Hello there.")
=> throws EmptyTtsResponseError: TTS backend "gemini" returned 0 bytes — too short to be speech
```

## A direct rate limit overflows to OpenRouter, when the box has both keys

Google's per-key limit for this model is low (10 requests a minute on Tier 1),
and a conversation can reach it. With an OpenRouter key on hand, the 429 sends
that one clip through OpenRouter at once — on time, without style — instead of
waiting out the provider's `Retry-After`. The OpenRouter key is fetched only
then, and still goes only to OpenRouter.

```ts
const limited = recordingFetch((url) =>
  url.startsWith("https://generativelanguage.googleapis.com/")
    ? new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 })
    : new Response(pcm));
let overflowAsked = 0;
const overflow = async () => { overflowAsked += 1; return "sk-or-v1-overflow"; };
const tts = createTtsService({ backend: "gemini", route: { via: "direct", apiKey: "AIza-test" }, overflow, fetch: limited.fetch });
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };
let out;
try {
  out = await tts.textToSpeech("The delivery is late.", { voice: "Kore", instructions: "Speak warmly." });
} finally {
  console.warn = originalWarn;
}
({
  hosts: limited.calls.map((call) => new URL(call.url).host),
  overflowAuth: limited.calls[1].headers.authorization,
  overflowAsked,
  warnings,
  contentType: out.contentType,
})
=> {
  hosts: ["generativelanguage.googleapis.com", "openrouter.ai"],
  overflowAuth: "Bearer sk-or-v1-overflow",
  overflowAsked: 1,
  warnings: ["[tts] Gemini's direct rate limit was reached (HTTP 429); this clip goes through OpenRouter, without speaking style."],
  contentType: "audio/wav",
}
```

If the OpenRouter key has gone by the time it is needed, the 429 itself is the
failure the route reports.

```ts
const limited = recordingFetch(() => new Response("{}", { status: 429, statusText: "Too Many Requests" }));
const tts = createTtsService({ backend: "gemini", route: { via: "direct", apiKey: "AIza-test" }, overflow: async () => null, fetch: limited.fetch });
await tts.textToSpeech("Hello there.")
=> throws HTTPError: «*»
```
