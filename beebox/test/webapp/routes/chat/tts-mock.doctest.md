# Chat TTS development mock is fail-closed

The speech harness can select fixture audio only when the server explicitly
enables development surfaces. A stray `mock: true` request otherwise fails
before any provider lookup or paid call.

```ts setup
import { makeTestServer } from "../../../helpers/doctest-server.js";
import { createFakeTts, createTtsService } from "../../../../src/services/tts.js";
import { getOrCreateAgentToken } from "../../../../src/core/agent/token.js";

/** Runs `fn` with `console[method]` collecting lines instead of printing. */
async function capture<T>(method: "error" | "warn", fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    return { value: await fn(), lines };
  } finally {
    console[method] = original;
  }
}

const postTts = (ctx, text: string) =>
  ctx.request({ method: "POST", url: "/api/chat/tts", payload: { text } });

/** Starts the test server on a real socket (`inject` cannot show a broken download). */
async function listen(ctx): Promise<number> {
  await ctx.server.listen({ port: 0, host: "127.0.0.1" });
  const addr = ctx.server.server.address();
  return typeof addr === "object" && addr !== null ? addr.port : 0;
}

function fetchClip(ctx, port: number, signal?: AbortSignal) {
  return fetch(`http://127.0.0.1:${port}/test/api/chat/tts`, {
    method: "POST",
    headers: { authorization: `Bearer ${getOrCreateAgentToken(ctx.boxRoot)}`, "content-type": "application/json" },
    body: JSON.stringify({ text: "Hi." }),
    ...(signal ? { signal } : {}),
  });
}

/** A Gemini-shaped service whose provider answers `fetch` with a JSON error. */
const geminiRejecting = (message: string) => createTtsService({
  backend: "gemini",
  apiKey: "AIza-test",
  fetch: async () => Response.json({ error: { message, code: "invalid_request" } }, { status: 400, statusText: "Bad Request" }),
});
```

## Missing opt-in rejects without calling the provider

```ts
const audio = createFakeTts();
const ctx = await makeTestServer({ services: { openaiAudio: audio } });
const { value: rejected, lines } = await capture("warn", () => ctx.request({
  method: "POST",
  url: "/api/chat/tts",
  payload: { text: "fixture speech", mock: true },
}));
JSON.stringify({ status: rejected.statusCode, body: rejected.body, calls: audio.speeches.length, warned: lines.length })
=> {"status":400,"body":{"error":"mock TTS requires development surfaces"},"calls":0,"warned":1}
```

```ts cleanup
await ctx.cleanup();
```

## Explicit development surfaces serve a fixture

```ts
const audio = createFakeTts();
const ctx = await makeTestServer({
  devSurfaces: true,
  services: { openaiAudio: audio },
});
const response = await ctx.rawRequest({
  method: "POST",
  url: "/api/chat/tts",
  payload: { text: "fixture speech", mock: true, fixture: "seg0.mp3" },
});
JSON.stringify({ status: response.statusCode, contentType: response.headers["content-type"], calls: audio.speeches.length })
=> {"status":200,"contentType":"audio/mpeg","calls":0}
```

```ts cleanup
await ctx.cleanup();
```

## Speech is always MP3, head first

Both backends answer MP3 — Gemini's PCM is encoded on the way — so the
browser's streaming player takes every clip. The body is the clip's head
followed by the rest.

```ts
const gemAudio = createFakeTts({ backend: "gemini", restChunks: [Buffer.alloc(100, 7)] });
const gemCtx = await makeTestServer({ services: { openaiAudio: gemAudio } });
const gemRes = await gemCtx.rawRequest({ method: "POST", url: "/api/chat/tts", payload: { text: "Hi." } });
({ status: gemRes.statusCode, contentType: gemRes.headers["content-type"], bytes: Buffer.byteLength(gemRes.payload, "latin1"), calls: gemAudio.speeches.length })
=> { status: 200, contentType: "audio/mpeg", bytes: «int», calls: 1 }
```

```ts cleanup
await gemCtx.cleanup();
```

## A backend failure before the head is a 502 that says why

Each case below fails before any audio is sent, so the route can still answer
with a status. In every case the reason reaches the boxholder; a bare 500
"Internal server error" would lose it.

- **A too-short body.** A backend answered HTTP 200 with nothing. Passing that
  through would reach the boxholder as silence they blame on their speakers, so
  the route refuses it and says why.
- **A backend that never answers.** `fetch` reports a connection that never got
  a response as a `TypeError` whose message is only "fetch failed"; the reason
  — DNS, a reset, a certificate — rides in `cause` (2026-09-08: a TTS play
  reached the boxholder as a bare 500). The route names the backend's failure
  and the server's error log gains the cause.
- **A provider's rejection carries the provider's reason.** On 2026-10-04 a real
  Gemini request failed with only "TTS backend answered 400 Bad Request" in the
  server log and the 502 — the provider's message, the one thing that says what
  was wrong, was dropped. The route reads it from the error body and puts it in
  both. This drives the real Gemini service through ky, with a `fetch` that
  answers the way Google does.
- **A message that echoes a key** is masked before it reaches the log or the
  browser.
- **A backend that accepts and never finishes.** A provider that takes the
  request and then stalls raises ky's `TimeoutError`, not a `TypeError` — a
  different class entirely, so it fell past the unreachable check and reached
  the boxholder as the same bare 500 (2026-09-16: a real OpenRouter speech
  call timed out and the reason survived only in the server log).

```ts
const { TimeoutError } = await import("ky");
const cases = [
  ["too-short body", createFakeTts({ backend: "gemini", emptyResponse: true }), undefined],
  ["unreachable", {
    backend: "openai" as const,
    stylable: true,
    streamSpeech: async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.openai.com") });
    },
  }, "ENOTFOUND"],
  ["provider rejection", geminiRejecting("Voice name not found"), "Voice name not found"],
  ["key echoed", geminiRejecting("API key AIzaSyFAKEFAKEFAKEFAKEFAKE1234 not valid"), undefined],
  ["stalled", {
    backend: "gemini" as const,
    stylable: true,
    streamSpeech: async () => {
      throw new TimeoutError(new Request("https://openrouter.ai/api/v1/audio/speech", { method: "POST" }));
    },
  }, undefined],
];
const lines: string[] = [];
for (const [label, service, logNeedle] of cases) {
  const ctx = await makeTestServer({ services: { openaiAudio: service } });
  const { value: res, lines: logged } = await capture("error", () => postTts(ctx, "Hi."));
  const result = { status: res.statusCode, body: res.body, ...(logNeedle ? { logged: logged.some((l) => l.includes(logNeedle)) } : {}) };
  lines.push(`${label}: ${JSON.stringify(result)}`);
  await ctx.cleanup();
}

lines.join("\n")
=>
too-short body: {"status":502,"body":{"error":"TTS backend \"gemini\" returned 0 bytes — too short to be speech"}}
unreachable: {"status":502,"body":{"error":"TTS backend unreachable: getaddrinfo ENOTFOUND api.openai.com"},"logged":true}
provider rejection: {"status":502,"body":{"error":"TTS backend answered 400 Bad Request: Voice name not found"},"logged":true}
key echoed: {"status":502,"body":{"error":"TTS backend answered 400 Bad Request: API key [redacted key] not valid"}}
stalled: {"status":502,"body":{"error":"TTS backend timed out: Request timed out: POST https://openrouter.ai/api/v1/audio/speech"}}
```

Blank text never reaches the provider. Gemini answers it with its own 400
("Input string cannot be empty"), which would read as a backend failure; it is
the caller's, so the route says so.

```ts
const blankAudio = createFakeTts({ backend: "gemini" });
const blankCtx = await makeTestServer({ services: { openaiAudio: blankAudio } });
const blankRes = await postTts(blankCtx, "  \n ");
({ status: blankRes.statusCode, body: blankRes.body, providerCalls: blankAudio.speeches.length })
=> { status: 400, body: { error: "Nothing to speak: the text is empty" }, providerCalls: 0 }
```

```ts cleanup
await blankCtx.cleanup();
```

## A failure after the head breaks the download, and is logged

Once the head is sent, the response is a 200 and cannot become a 502. A
provider failure after that ends the download with an error, so the browser's
streaming player fails the segment instead of playing half a sentence as if it
were whole. The server log names the provider's reason. This needs a real
socket: `inject` cannot show a broken download.

```ts
const failing = createFakeTts({ backend: "gemini", failAfterHead: new TypeError("fetch failed", { cause: new Error("socket hang up") }) });
const failCtx = await makeTestServer({ services: { openaiAudio: failing } });
const failPort = await listen(failCtx);
const { value: download, lines: failLogs } = await capture("error", async () => {
  const res = await fetchClip(failCtx, failPort);
  const outcome = await res.arrayBuffer().then(() => "complete", (e: Error) => `broken (${e.name})`);
  return { status: res.status, outcome };
});
({ ...download, logged: failLogs.some((line) => line.includes("stream failed after") && line.includes("socket hang up")), cancelled: failing.cancels > 0 })
=> { status: 200, outcome: "broken (TypeError)", logged: true, cancelled: true }
```

```ts cleanup
await failCtx.cleanup();
```

## The browser leaving stops the clip

When the browser stops listening — a stop, a new reply, a closed tab — the
connection closes with the body unfinished. The route cancels the clip, which
aborts the provider request and kills any encoder, so no audio is generated
for nobody. The fake here holds its stream open after the head until the test
says otherwise.

```ts
let releaseRest: () => void = () => {};
const restGate = new Promise<void>((resolve) => { releaseRest = resolve; });
const slow = createFakeTts({ backend: "gemini", beforeEachRestChunk: () => restGate });
const slowCtx = await makeTestServer({ services: { openaiAudio: slow } });
const slowPort = await listen(slowCtx);
const leaving = new AbortController();
const res = await fetchClip(slowCtx, slowPort, leaving.signal);
const reader = res.body.getReader();
const firstRead = await reader.read();
leaving.abort();
await eventually(() => slow.cancels === 1, { label: "the route cancels the clip" });
releaseRest();
({ status: res.status, gotHead: firstRead.value.length > 0, cancels: slow.cancels })
=> { status: 200, gotHead: true, cancels: 1 }
```

```ts cleanup
await slowCtx.cleanup();
```

A cancelled clip also breaks off its stream, but that is the browser leaving,
not a provider failure: it stays out of the error log.

```ts
const { SpeechCancelledError } = await import("../../../../src/services/tts.js");
const leftEarly = createFakeTts({ backend: "gemini", beforeEachRestChunk: () => Promise.reject(new SpeechCancelledError()) });
const leftCtx = await makeTestServer({ services: { openaiAudio: leftEarly } });
const leftPort = await listen(leftCtx);
const { lines: leftLogs } = await capture("error", async () => {
  const res = await fetchClip(leftCtx, leftPort);
  await res.arrayBuffer().catch(() => "broken");
});
leftLogs.filter((line) => line.includes("[chat-tts]"))
=> []
```

```ts cleanup
await leftCtx.cleanup();
```

## The retry policy actually applies to these calls

`retry: 2` was inert. ky excludes POST from `retry.methods` by default and sets
`retryOnTimeout: false`, so both failures these endpoints actually produce — a
provider 502 and a stalled request — were single attempts, on an endpoint whose
provider documents 502/503/524/529 as transient and asks callers to retry.

```ts
const ttsSource = await (await import("node:fs/promises"))
  .readFile(new URL("../../../../src/services/tts.ts", import.meta.url), "utf8");
const retryBlock = /const TTS_RETRY = \{([\s\S]*?)\} satisfies/.exec(ttsSource)?.[1] ?? "";
JSON.stringify({
  post: /methods:\s*\["post"\]/.test(retryBlock),
  onTimeout: /retryOnTimeout:\s*true/.test(retryBlock),
  openRouterCodes: [524, 529].every((code) => retryBlock.includes(String(code))),
  bothCallSites: (ttsSource.match(/retry: TTS_RETRY/g) ?? []).length,
})
=> {"post":true,"onTimeout":true,"openRouterCodes":true,"bothCallSites":2}
```
