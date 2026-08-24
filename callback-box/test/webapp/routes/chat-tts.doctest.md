# Chat TTS development mock is fail-closed

The speech harness can select fixture audio only when the server explicitly
enables development surfaces. A stray `mock: true` request otherwise fails
before any provider lookup or paid call.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { createFakeOpenAIAudio } from "../../../src/services/openai-audio.js";
```

## Missing opt-in rejects without calling the provider

```ts
const audio = createFakeOpenAIAudio();
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
const audio = createFakeOpenAIAudio();
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
