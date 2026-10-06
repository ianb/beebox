# A failed speech request reads as its reason

`ttsRequestError` (`src/lib/audio/tts-client/tts-errors.ts`) turns a failed
`/chat/tts` response into the message the failed speech chunk shows. The
server's `error` text names the provider's reason, so it is the whole message;
the status is kept on the error for code that branches on it.

```ts setup
import { ttsRequestError } from "../../../../src/lib/audio/tts-client/tts-errors.js";
```

```ts
const limited = await ttsRequestError(Response.json(
  { error: "TTS backend answered 429 Too Many Requests: Rate limit exceeded (limit: 10 requests per day on Free Tier)" },
  { status: 502 },
));
({ name: limited.name, status: limited.status, message: limited.message })
=> { name: "TtsRequestError", status: 502, message: "TTS backend answered 429 Too Many Requests: Rate limit exceeded (limit: 10 requests per day on Free Tier)" }
```

A body without that field — a proxy's HTML page, an empty 401 — falls back to
the status and the start of the body.

```ts
(await ttsRequestError(new Response("<html>Bad gateway</html>", { status: 502 }))).message
=> HTTP 502: <html>Bad gateway</html>

(await ttsRequestError(new Response("", { status: 401 }))).message
=> HTTP 401
```
