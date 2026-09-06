# Chat TTS development mock is fail-closed

The speech harness can select fixture audio only when the server explicitly
enables development surfaces. A stray `mock: true` request otherwise fails
before any provider lookup or paid call.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { createFakeTts } from "../../../src/services/tts.js";
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

## The backend's content type reaches the browser

A backend that answers WAV rather than MP3 must not have its bytes labelled
`audio/mpeg` — the player picks its playback path from this header, and a
mislabelled body fails in the browser rather than here.

```ts
const wavAudio = createFakeTts({ backend: "gemini", contentType: "audio/wav" });
const wavCtx = await makeTestServer({ services: { openaiAudio: wavAudio } });
const wavRes = await wavCtx.rawRequest({ method: "POST", url: "/api/chat/tts", payload: { text: "Hi." } });
JSON.stringify({ status: wavRes.statusCode, contentType: wavRes.headers["content-type"], calls: wavAudio.speeches.length })
=> {"status":200,"contentType":"audio/wav","calls":1}
```

```ts cleanup
await wavCtx.cleanup();
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
