# TTS service: streamed speech and the guard against silent failure

`TtsService` (`src/services/tts.ts`) is one interface over several speech
backends. `streamSpeech` resolves once the clip's head has arrived and hands
over the rest as a stream (`docs/plans/tts-streamed-playback.md`). These cover
what the real implementations share: a clip too short to be audio is an error,
not a result.

```ts setup
import { collectAudio, EmptyTtsResponseError } from "../../src/services/tts.js";
```

## Gemini: one key, one host, style beside the text

Gemini speech goes to Google's Interactions API with the box's `gemini` key —
its only route (`src/core/tts/resolve.ts` says why OpenRouter is not one).
These tests stand in for the network with a recording `fetch`, so what Google
would receive is visible.

```ts setup
import { createTtsService } from "../../src/services/tts.js";
import { InteractionStreamError } from "../../src/core/tts/interaction-stream.js";

/** An MP3-looking buffer of `bytes` bytes: a frame header, padded. */
const mp3Head = (bytes) => Buffer.concat([Buffer.from([0xff, 0xf3, 0x84, 0xc4]), Buffer.alloc(bytes - 4)]);

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

// Half a second of 24 kHz 16-bit silence: enough MP3 to pass the head check.
const pcm = Buffer.alloc(24000);

const delta = (part) => `event: step.delta\ndata: ${JSON.stringify({ event_type: "step.delta", delta: { type: "audio", data: part.toString("base64") } })}\n\n`;

/** A streamed Interactions answer carrying `audio` as two SSE delta events. */
function interactionStream(audio) {
  const half = audio.length / 2;
  return new Response(delta(audio.subarray(0, half)) + delta(audio.subarray(half)) + "event: done\ndata: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * A response body that sends `first`, then waits for the test to call
 * `release(last)` (or `fail()`) before it sends the rest. Records whether the
 * consumer cancelled it.
 */
function heldBody(first) {
  const encoder = new TextEncoder();
  const state = { cancelled: false };
  let controllerRef;
  const body = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      controller.enqueue(typeof first === "string" ? encoder.encode(first) : first);
    },
    cancel() { state.cancelled = true; },
  });
  return {
    body,
    state,
    release(last) {
      controllerRef.enqueue(typeof last === "string" ? encoder.encode(last) : last);
      controllerRef.close();
    },
  };
}
```

The request sends the key in Google's own header, puts style in the
`speech_metadata` annotation beside the verbatim text, asks for a stream, and
asks Google not to store the request. The streamed PCM comes back as MP3,
encoded on the way, starting with an MPEG audio frame.

```ts
const direct = recordingFetch(() => interactionStream(pcm));
const tts = createTtsService({ backend: "gemini", apiKey: "AIza-test", fetch: direct.fetch });
const audio = await tts.streamSpeech("The delivery is late.", { voice: "Kore", instructions: "Speak warmly." });
const out = await collectAudio(audio);
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
  contentType: audio.contentType,
  frameSync: out[0] === 0xff && (out[1] & 0xe0) === 0xe0,
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
  contentType: "audio/mpeg",
  frameSync: true,
}
```

Gemini has been observed answering HTTP 200 with a zero-length body. A clip
that short reaches the browser as silence, which the boxholder blames on their
speakers rather than on the backend — so `streamSpeech` rejects before anything
is sent, instead of handing over an empty stream. A stream that carries no
audio — events of a shape we do not know, or a completed interaction with
nothing in it — is the same silent-200 failure and throws the same error.

```ts
const empty = recordingFetch(() => new Response("event: done\ndata: [DONE]\n\n"));
const tts = createTtsService({ backend: "gemini", apiKey: "AIza-test", fetch: empty.fetch });
await tts.streamSpeech("Hello there.")
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
const failure = await tts.streamSpeech("Hello there.").catch((e) => e);
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
const out = await tts.streamSpeech("Hello there.");
({ requests: brief.calls.length, contentType: out.contentType })
=> { requests: 2, contentType: "audio/mpeg" }
```

## The head arrives before the provider finishes

The point of streaming: `streamSpeech` resolves on the first plausible audio,
while the provider is still sending. For Gemini, the first half second of PCM
is held back from the rest until the test releases it; the head is already in
hand by then.

```ts
const held = heldBody(delta(pcm));
const tts = createTtsService({ backend: "gemini", apiKey: "AIza-test", fetch: async () => new Response(held.body) });
const audio = await tts.streamSpeech("The delivery is late.");
const headFirst = { headBytes: audio.head.length >= 512, providerStillOpen: !held.state.cancelled };
held.release(delta(pcm) + "event: done\ndata: [DONE]\n\n");
const total = (await collectAudio(audio)).length;
({ ...headFirst, moreAfterHead: total > audio.head.length })
=> { headBytes: true, providerStillOpen: true, moreAfterHead: true }
```

OpenAI already answers MP3, so its body passes through unchanged, and its head
also arrives before the body ends.

```ts
const first = mp3Head(604);
const held = heldBody(first);
const tts = createTtsService({ backend: "openai", apiKey: "sk-test", fetch: async () => new Response(held.body) });
const audio = await tts.streamSpeech("The delivery is late.");
const headIsFirstChunk = audio.head.equals(first);
held.release(Buffer.alloc(300, 1));
({ headIsFirstChunk, total: (await collectAudio(audio)).length })
=> { headIsFirstChunk: true, total: 904 }
```

## A failure after the head comes out of the rest

Once the head is handed over, the route has started its response. A provider
error after that cannot reject `streamSpeech`; it surfaces while reading
`rest`, for the route to end the response with.

```ts
const held = heldBody(delta(pcm));
const tts = createTtsService({ backend: "gemini", apiKey: "AIza-test", fetch: async () => new Response(held.body) });
const audio = await tts.streamSpeech("The delivery is late.");
held.release(`event: error\ndata: {"event_type":"error","error":{"message":"backend overloaded"}}\n\n`);
await collectAudio(audio)
=> throws InteractionStreamError: Gemini stream failed: backend overloaded
```

## Stopping early cancels the provider

A consumer that stops reading (the route, when the browser leaves) stops the
provider's response, so no audio is generated for nobody.

```ts
const held = heldBody(mp3Head(700));
const tts = createTtsService({ backend: "openai", apiKey: "sk-test", fetch: async () => new Response(held.body) });
const audio = await tts.streamSpeech("The delivery is late.");
audio.cancel();
await eventually(() => held.state.cancelled === true, { label: "provider body cancelled" });
held.state.cancelled
=> true
```
