# Chat TTS development mock is fail-closed

The speech harness can select fixture audio only when the server explicitly
enables development surfaces. A stray `mock: true` request otherwise fails
before any provider lookup or paid call.

```ts setup
import { makeTestServer } from "../../../helpers/doctest-server.js";
import { createFakeTts, createTtsService } from "../../../../src/services/tts.js";
import { getOrCreateAgentToken } from "../../../../src/core/agent/token.js";
```

## Missing opt-in rejects without calling the provider

```ts
const audio = createFakeTts();
const ctx = await makeTestServer({ services: { openaiAudio: audio } });
const warnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
const rejected = await (async () => {
  try {
    return await ctx.request({
      method: "POST",
      url: "/api/chat/tts",
      payload: { text: "fixture speech", mock: true },
    });
  } finally {
    console.warn = originalWarn;
  }
})();
JSON.stringify({ status: rejected.statusCode, body: rejected.body, calls: audio.speeches.length, warned: warnings.length })
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

## A too-short body is a 502, not silence

The failure this guards against is a backend answering HTTP 200 with nothing.
Passing that through would reach the boxholder as silence they blame on their
speakers, so the route refuses it and says why.

```ts
const emptyAudio = createFakeTts({ backend: "gemini", emptyResponse: true });
const emptyCtx = await makeTestServer({ services: { openaiAudio: emptyAudio } });
const emptyRes = await emptyCtx.request({ method: "POST", url: "/api/chat/tts", payload: { text: "Hi." } });
JSON.stringify({ status: emptyRes.statusCode, body: emptyRes.body })
=> {"status":502,"body":{"error":"TTS backend \"gemini\" returned 0 bytes — too short to be speech"}}
```

```ts cleanup
await emptyCtx.cleanup();
```

## A backend that never answers is a 502 that says why

`fetch` reports a connection that never got a response as a `TypeError`
whose message is only "fetch failed"; the reason — DNS, a reset, a
certificate — rides in `cause`. Passing that up as a bare 500 "Internal
server error" loses it (2026-09-08: a TTS play reached the boxholder exactly
that way). The route names the backend's failure instead; the server's error
log gains the cause for everything else.

```ts
const unreachable = {
  backend: "openai" as const,
  stylable: true,
  streamSpeech: async () => {
    throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.openai.com") });
  },
};
const downCtx = await makeTestServer({ services: { openaiAudio: unreachable } });
const errors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
const downRes = await (async () => {
  try {
    return await downCtx.request({ method: "POST", url: "/api/chat/tts", payload: { text: "Hi." } });
  } finally {
    console.error = originalError;
  }
})();
JSON.stringify({ status: downRes.statusCode, body: downRes.body, logged: errors.some((line) => line.includes("ENOTFOUND")) })
=> {"status":502,"body":{"error":"TTS backend unreachable: getaddrinfo ENOTFOUND api.openai.com"},"logged":true}
```

```ts cleanup
await downCtx.cleanup();
```

## A provider's rejection carries the provider's reason

On 2026-10-04 a real Gemini request failed with only "TTS backend answered
400 Bad Request" in the server log and the 502 — the provider's message, the
one thing that says what was wrong, was dropped. The route now reads it from
the error body and puts it in both. This drives the real Gemini service
through ky, with a `fetch` that answers the way Google does.

```ts
const rejecting = createTtsService({
  backend: "gemini",
  apiKey: "AIza-test",
  fetch: async () => Response.json({ error: { message: "Voice name not found", code: "invalid_request" } }, { status: 400, statusText: "Bad Request" }),
});
const rejectCtx = await makeTestServer({ services: { openaiAudio: rejecting } });
const rejectErrors: string[] = [];
const errorBefore = console.error;
console.error = (...args: unknown[]) => rejectErrors.push(args.map(String).join(" "));
const rejectRes = await (async () => {
  try {
    return await rejectCtx.request({ method: "POST", url: "/api/chat/tts", payload: { text: "Hi." } });
  } finally {
    console.error = errorBefore;
  }
})();
({ status: rejectRes.statusCode, body: rejectRes.body, logged: rejectErrors.some((line) => line.includes("Voice name not found")) })
=> { status: 502, body: { error: "TTS backend answered 400 Bad Request: Voice name not found" }, logged: true }
```

```ts cleanup
await rejectCtx.cleanup();
```

A message that echoes a key is masked before it reaches the log or the
browser.

```ts
const echoing = createTtsService({
  backend: "gemini",
  apiKey: "AIza-test",
  fetch: async () => Response.json({ error: { message: "API key AIzaSyFAKEFAKEFAKEFAKEFAKE1234 not valid" } }, { status: 400, statusText: "Bad Request" }),
});
const echoCtx = await makeTestServer({ services: { openaiAudio: echoing } });
const echoBefore = console.error;
console.error = () => {};
const echoRes = await (async () => {
  try {
    return await echoCtx.request({ method: "POST", url: "/api/chat/tts", payload: { text: "Hi." } });
  } finally {
    console.error = echoBefore;
  }
})();
echoRes.body
=> { error: "TTS backend answered 400 Bad Request: API key [redacted key] not valid" }
```

```ts cleanup
await echoCtx.cleanup();
```

Blank text never reaches the provider. Gemini answers it with its own 400
("Input string cannot be empty"), which would read as a backend failure; it is
the caller's, so the route says so.

```ts
const blankAudio = createFakeTts({ backend: "gemini" });
const blankCtx = await makeTestServer({ services: { openaiAudio: blankAudio } });
const blankRes = await blankCtx.request({ method: "POST", url: "/api/chat/tts", payload: { text: "  \n " } });
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
await failCtx.server.listen({ port: 0, host: "127.0.0.1" });
const failAddr = failCtx.server.server.address();
const failPort = typeof failAddr === "object" && failAddr !== null ? failAddr.port : 0;
const failLogs: string[] = [];
const beforeFail = console.error;
console.error = (...args: unknown[]) => failLogs.push(args.map(String).join(" "));
const download = await (async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${failPort}/test/api/chat/tts`, {
      method: "POST",
      headers: { authorization: `Bearer ${getOrCreateAgentToken(failCtx.boxRoot)}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "Hi." }),
    });
    const status = res.status;
    const outcome = await res.arrayBuffer().then(() => "complete", (e: Error) => `broken (${e.name})`);
    return { status, outcome };
  } finally {
    console.error = beforeFail;
  }
})();
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
await slowCtx.server.listen({ port: 0, host: "127.0.0.1" });
const slowAddr = slowCtx.server.server.address();
const slowPort = typeof slowAddr === "object" && slowAddr !== null ? slowAddr.port : 0;
const leaving = new AbortController();
const res = await fetch(`http://127.0.0.1:${slowPort}/test/api/chat/tts`, {
  method: "POST",
  headers: { authorization: `Bearer ${getOrCreateAgentToken(slowCtx.boxRoot)}`, "content-type": "application/json" },
  body: JSON.stringify({ text: "Hi." }),
  signal: leaving.signal,
});
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

## A backend that accepts and never finishes is a 502 too

A provider that takes the request and then stalls raises ky's `TimeoutError`,
not a `TypeError` — a different class entirely, so it fell past the check above
and reached the boxholder as the same bare 500 that section exists to prevent
(2026-09-16: a real OpenRouter speech call timed out and the reason survived
only in the server log).

```ts
const { TimeoutError } = await import("ky");
const stalled = {
  backend: "gemini" as const,
  stylable: true,
  streamSpeech: async () => {
    throw new TimeoutError(new Request("https://openrouter.ai/api/v1/audio/speech", { method: "POST" }));
  },
};
const stalledCtx = await makeTestServer({ services: { openaiAudio: stalled } });
const stalledErrors: string[] = [];
const priorError = console.error;
console.error = (...args: unknown[]) => stalledErrors.push(args.map(String).join(" "));
const stalledRes = await (async () => {
  try {
    return await stalledCtx.request({ method: "POST", url: "/api/chat/tts", payload: { text: "Hi." } });
  } finally {
    console.error = priorError;
  }
})();
JSON.stringify({ status: stalledRes.statusCode, body: stalledRes.body })
=> {"status":502,"body":{"error":"TTS backend timed out: Request timed out: POST https://openrouter.ai/api/v1/audio/speech"}}
```

```ts cleanup
await stalledCtx.cleanup();
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
